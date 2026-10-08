// Hermes no suporte: o agente que corrige bug de cliente trabalha no Linear
// (etiqueta "Hermes", colunas Validar / Aguardando resposta / Aprovado…) e o
// cockpit ACOMPANHA pelo espelho que já existe. Não há "ticket do Hermes": o
// ticket é o mesmo de sempre e `ticket.hermes` é só o retrato do card visto
// daqui — em que fase está, se espera alguém, que versão da correção está em
// validação e se o caso saiu para o time.
//
//   com o Hermes   card com a etiqueta e sem ninguém do time atribuído
//                  (regra do Hermes: card com alguém do time fica com o time)
//   fase           pelo ESTADO do card — por id (de-para da configuração) ou
//                  pelo nome da coluna; o tipo do Linear não distingue Validar
//                  de Aprovado (os dois são `started`)
//   card           o comentário de validação do Hermes é LIDO AO VIVO na aba
//                  Linear (hermesView). O texto nunca entra no doc: conversa de
//                  engenharia não chega ao cliente (publicTicket nem conhece o
//                  campo).
//
// Tudo que entra aqui vem do Linear e é gravado com o ator `linear`, fora do
// writeTicket — não gera evento de edição nem volta pela fila de saída.

import { withTaskLock, upsertNotification } from "../tasks/tasks-core.js";
import { canHandleSaas } from "../auth/support-scope.js";
import { ACTOR_LINEAR, recordTicketEvents, ticketTitle } from "./tickets-core.js";
import { HERMES_PHASE_KEYS, HERMES_PHASE_LABEL, phaseByName, fold } from "../shared/hermes-phase.js";

export const HERMES_PHASES = HERMES_PHASE_KEYS;
export const PHASE_LABEL = HERMES_PHASE_LABEL;
export { phaseByName };
const HUMAN = new Set(["pergunta", "validar"]);
const FINAL = new Set(["no_ar", "cancelado"]);
export const PUBLISH_WINDOWS = ["noite", "imediato"];
export const DEFAULT_LABEL = "Hermes";
const HISTORY_MAX = 30;

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const uniq = (arr) => [...new Set(arr)];
const nowIso = () => new Date().toISOString();
const excerpt = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// ── Configuração (ticket_settings.linear.hermes) ─────────────────────────────
// `phases` = { stateIdDoLinear: fase }: o que a tela fixou à mão. Estado fora
// do mapa cai no nome da coluna (phaseByName). `approvers` são usuários do
// cockpit (só admin edita — routes.tickets.js): são eles que aprovam, pedem
// ajuste, recusam e revertem, como "só Eryk e Yudi" do guia do Hermes.
export function normalizeHermesSettings(src) {
  const s = isObj(src) ? src : {};
  const phases = {};
  if (isObj(s.phases)) {
    for (const [id, ph] of Object.entries(s.phases).slice(0, 60)) {
      const k = str(id, 120);
      if (k && HERMES_PHASES.includes(ph)) phases[k] = ph;
    }
  }
  return {
    enabled: s.enabled === true,
    label: str(s.label, 40) || DEFAULT_LABEL,
    linearUserId: str(s.linearUserId, 120),
    phases,
    approvers: uniq((Array.isArray(s.approvers) ? s.approvers : []).map((x) => str(x, 120)).filter(Boolean)).slice(0, 20),
    publishWindow: PUBLISH_WINDOWS.includes(s.publishWindow) ? s.publishWindow : "noite",
    actions: s.actions === true,
  };
}

// ── Fase pelo estado do card ─────────────────────────────────────────────────
// Nome da coluna → fase em shared/hermes-phase.js (a SPA usa a mesma régua).
export const phaseOfState = (state, cfg) => (state?.id && cfg?.phases?.[state.id]) || phaseByName(state);

// Estado do time para uma fase (ação de mover o card): o mapa da configuração
// manda; sem ele, o primeiro estado cujo nome cai na fase.
export function stateForPhase(phase, states = [], cfg = {}) {
  const manual = Object.entries(cfg.phases || {}).find(([id, ph]) => ph === phase && states.some((s) => s.id === id));
  if (manual) return states.find((s) => s.id === manual[0]);
  return states.find((s) => !Object.prototype.hasOwnProperty.call(cfg.phases || {}, s.id) && phaseByName(s) === phase) || null;
}

const hasLabel = (labels, cfg) => labels.some((l) => fold(l) === fold(cfg?.label || DEFAULT_LABEL));

// Retrato do card. `labels` undefined = o payload não trouxe etiquetas (vale o
// que já se sabia); `assignee` undefined = idem; null = ninguém atribuído.
export function hermesStateOf({ state, labels, assignee }, cfg, prev = {}) {
  const labeled = labels === undefined ? !!prev.labeled : hasLabel(labels, cfg);
  const phase = phaseOfState(state, cfg);
  let human = prev.handoff ? true : false;
  let to = prev.handoff?.to || "";
  if (assignee !== undefined) {
    human = !!assignee && !(cfg?.linearUserId && assignee.id === cfg.linearUserId) && !/hermes/i.test(assignee.name || "");
    to = human ? str(assignee.name, 120) || "alguém do time" : "";
  }
  const active = labeled && !human;
  return { labeled, active, holding: active && !FINAL.has(phase), phase, needsHuman: active && HUMAN.has(phase), handedTo: labeled && human ? to : "" };
}

// ── Comentários do Hermes ────────────────────────────────────────────────────
// Rótulos do card de validação (guia do Hermes, página 4). Aceita os três
// jeitos de escrever no markdown do Linear: `**Rótulo:** valor`, `Rótulo: valor`
// e linha de tabela `| Rótulo | valor |`. Valor pode seguir em várias linhas
// (os prints da Tela, por exemplo) até o próximo rótulo.
export const CARD_FIELDS = [
  { key: "problema", label: "O que acontecia", re: /^o que acontec/ },
  { key: "prova", label: "Prova", re: /^prova\b/ },
  { key: "tela", label: "Tela", re: /^(tela|prints?)\b/ },
  { key: "banco", label: "Mexe no banco?", re: /^mexe no banco/ },
  { key: "risco", label: "Risco", re: /^risco\b/ },
  { key: "publica", label: "Quando publica", re: /^quando publica/ },
  { key: "aviso", label: "Aviso ao cliente", re: /^aviso ao cliente/ },
  { key: "versao", label: "Versão", re: /^versao\b/ },
];

const cleanCell = (s) => String(s || "").replace(/\*\*/g, "").replace(/^[-*>\s]+/, "").trim();
function splitLabelLine(line) {
  const raw = String(line || "");
  if (/^\s*\|/.test(raw)) {
    if (/^\s*\|[\s:|-]+$/.test(raw)) return { sep: true };
    const cells = raw.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length >= 2) return { label: cleanCell(cells[0]).replace(/:$/, ""), value: cells.slice(1).join(" | ").trim() };
    return null;
  }
  // `**Rótulo:** valor`, `**Rótulo** valor`, `Rótulo: valor` ou `Pergunta? valor`.
  const m = /^\s*(?:[-*]\s+)?(?:\*\*([^*]{2,40}?)\*\*\s*:?|([A-Za-zÀ-ú][A-Za-zÀ-ú ]{1,30}?\?|[A-Za-zÀ-ú][A-Za-zÀ-ú ]{1,30}?\s*:))\s*(.*)$/.exec(raw);
  if (!m) return null;
  return { label: cleanCell(m[1] || m[2]).replace(/:$/, "").trim(), value: m[3] || "" };
}
const fieldOf = (label) => CARD_FIELDS.find((f) => f.re.test(fold(label)));

export function parseValidationCard(body) {
  const fields = {};
  let cur = null, last = null;
  for (const line of String(body || "").split(/\r?\n/)) {
    const hit = splitLabelLine(line);
    if (hit?.sep) continue;
    const f = hit && fieldOf(hit.label);
    if (f) { cur = last = f.key; fields[cur] = hit.value.trim(); continue; }
    if (!line.trim()) { cur = null; continue; } // linha em branco fecha o campo
    // Prints soltos depois de uma linha em branco ainda são da Tela.
    const alvo = cur || (last === "tela" && /^\s*!\[/.test(line) ? "tela" : null);
    if (alvo) fields[alvo] = `${fields[alvo] ? `${fields[alvo]}\n` : ""}${line.trim()}`;
  }
  const n = Object.keys(fields).length;
  if (n < 3 || !(fields.prova || fields.problema)) return null;
  const v = /v?\s*(\d{1,3})/i.exec(fields.versao || "") || /\bv(\d{1,3})\b/i.exec(String(body || ""));
  const r = fold(fields.risco);
  return {
    fields,
    version: v ? Number(v[1]) : 0,
    risk: /\balt[oa]\b/.test(r) ? "alto" : /\bmedi[oa]\b/.test(r) ? "medio" : /\bbaix[oa]\b/.test(r) ? "baixo" : "",
    touchesDb: fields.banco ? !/^\s*n[aã]o\b/i.test(fields.banco) : null,
    images: [...String(fields.tela || "").matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]),
  };
}

const STALLED_RE = /\bparei\b|\binterrompi\b|bancada (?:instavel|indisponivel|fora do ar|caiu|falhou)|falhas? de infraestrutura|devolvidas? por falha/;
// O motivo é a linha que conta a parada, sem o título "Hermes · validação".
function stalledReason(text) {
  const linhas = String(text || "").split(/\r?\n/).map((l) => l.replace(/\*\*/g, "").replace(/^[-*>#\s]+/, "").trim()).filter(Boolean);
  const linha = linhas.find((l) => STALLED_RE.test(fold(l))) || linhas.find((l) => !/^hermes\b/i.test(l)) || "";
  return excerpt(linha, 240);
}

// Um comentário do Hermes, classificado. O que não se reconhece vira `note`
// (a aba mostra cru) — formato novo do Hermes não quebra nada aqui.
export function parseHermesComment(body) {
  const text = String(body || "").trim();
  const card = parseValidationCard(text);
  if (card) return { kind: "validation", ...card };
  const t = fold(text);
  const live = /no ar (?:as|desde)?\s*(\d{1,2})[:h](\d{2})/.exec(t);
  if (live) return { kind: "live", liveAt: `${live[1].padStart(2, "0")}:${live[2]}` };
  if (/^\s*(?:\W+\s*)?(?:assumi|assumido|hermes assumiu|caso assumido)\b/.test(t)) return { kind: "accepted" };
  if (/nao (?:vou )?assumir|nao assumo|recuso assumir/.test(t)) return { kind: "declined", text };
  // Parada por falha da bancada/infra: o Hermes deixa o card em "Aguardando
  // resposta" sem pergunta nenhuma ("Parei após 3 rodadas: bancada instável").
  // Vem antes da pergunta — o texto pode ter "?" e não é pra cliente.
  if (STALLED_RE.test(t)) return { kind: "stalled", text, reason: stalledReason(text) };
  const draft = /rascunho[^\n:]*:\s*\n?\s*(?:>\s*)?["“]?([\s\S]+?)["”]?\s*$/i.exec(text);
  if (draft) return { kind: "draft", draftReply: draft[1].trim().slice(0, 2000) };
  if (text.includes("?")) return { kind: "question", text };
  return { kind: "note", text };
}

// Autor é o Hermes: o usuário configurado ou, sem configuração, o nome.
export function isHermesAuthor(user, cfg) {
  if (!user) return false;
  if (cfg?.linearUserId) return user.id === cfg.linearUserId;
  return /hermes/i.test(user.name || "");
}

// ── O que a aba Linear mostra (lido ao vivo, nunca gravado) ─────────────────
export function hermesView(ticket, comments = [], cfg = {}) {
  const h = ticket?.hermes || {};
  const out = {
    labeled: !!h.labeled, active: !!h.active, holding: !!h.holding, phase: h.phase || "", needsHuman: !!h.needsHuman,
    version: h.version || 0, liveAt: h.liveAt || "", handoff: h.handoff || null, requested: h.requested || null,
    card: null, question: null, stalled: null, draftReply: "",
  };
  const doHermes = (comments || []).filter((c) => isHermesAuthor(c.user, cfg))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  for (const c of doHermes) {
    const p = parseHermesComment(c.body);
    if (p.kind === "validation") out.card = { commentId: c.id, at: c.createdAt, url: c.url || "", ...p };
    else if (p.kind === "question") { out.question = { commentId: c.id, at: c.createdAt, text: p.text }; out.stalled = null; }
    else if (p.kind === "stalled") { out.stalled = { commentId: c.id, at: c.createdAt, text: p.text, reason: p.reason }; out.question = null; }
    else if (p.kind === "draft") out.draftReply = p.draftReply;
    else if (p.kind === "live") out.liveAt = p.liveAt; // o mais recente vence (novo ciclo, nova publicação)
  }
  if (out.card && !out.version) out.version = out.card.version;
  // Pergunta antiga não vale depois que a fase andou.
  if (out.phase !== "pergunta") { out.question = null; out.stalled = null; }
  return out;
}

// ── Gravar o retrato ─────────────────────────────────────────────────────────
async function writeHermes(repo, ticketId, fn) {
  return withTaskLock(`ticket:${ticketId}`, async () => {
    const cur = await repo.get("tickets", ticketId);
    if (!cur) return null;
    const next = fn(cur.hermes || {}, cur);
    if (!next || JSON.stringify(next) === JSON.stringify(cur.hermes || {})) return { ticket: cur, changed: false };
    const saved = await repo.update("tickets", ticketId, { hermes: next });
    return { ticket: saved, changed: true, before: cur.hermes || {} };
  });
}

// Aprovadores que atendem o produto: são eles que o sino chama quando o caso
// passa a esperar alguém (Validar / Aguardando resposta).
async function notifyApprovers(repo, ticket, cfg, { phase, since, now }) {
  if (!cfg?.approvers?.length) return [];
  const users = await repo.list("users").catch(() => []);
  const titulo = ticketTitle(ticket);
  const ref = ticket.linear?.identifier || "Linear";
  const text = phase === "validar"
    ? `Hermes: correção pronta para validar em ${ref} (${titulo})`
    : `Hermes perguntou algo em ${ref} (${titulo})`;
  const out = [];
  for (const id of cfg.approvers) {
    const u = users.find((x) => x.id === id);
    if (!u || !canHandleSaas(u, ticket.saas)) continue;
    await upsertNotification(repo, {
      user: id, type: "ticket_hermes", task: ticket.id, taskTitle: titulo, saas: ticket.saas, by: ACTOR_LINEAR,
      key: `hermes:${ticket.id}:${phase}:${since}:${id}`, text, link: { screen: "tickets", thread: ticket.id },
    }, { now });
    out.push(id);
  }
  return out;
}

// Issue mudou (webhook, reconciliação, importação ou ação daqui): recalcula o
// retrato. `issueFacts` = { state, labels, assignee } já extraídos pelo espelho.
export async function applyHermesIssue(repo, ticketId, issueFacts, cfg, { now = nowIso(), log } = {}) {
  if (!cfg?.enabled) return null;
  let evs = [];
  const r = await writeHermes(repo, ticketId, (prev) => {
    const s = hermesStateOf(issueFacts, cfg, prev);
    // Card que nunca foi do Hermes (sem etiqueta e sem pedido de entrega) não
    // ganha retrato: ticket comum continua sem o campo.
    if (!s.labeled && !prev.labeled && !prev.requested) return null;
    const next = { ...prev, labeled: s.labeled, active: s.active, holding: s.holding, needsHuman: s.needsHuman };
    evs = [];
    if (s.phase !== prev.phase) {
      next.phase = s.phase; next.phaseSince = now;
      // A parada é da coluna "Aguardando resposta": o card andou, ela acabou.
      if (s.phase !== "pergunta" && prev.stalled) next.stalled = null;
      next.history = [...(prev.history || []), { phase: s.phase, at: now }].slice(-HISTORY_MAX);
      if (s.labeled) evs.push({ type: "hermes_phase", data: { from: prev.phase || "", to: s.phase, state: str(issueFacts.state?.name, 120) } });
    }
    if (s.labeled && !prev.labeled && prev.requested) {
      next.requested = null;
      evs.push({ type: "hermes_accepted", data: {} });
    }
    if (s.handedTo && !prev.handoff) { next.handoff = { at: now, to: s.handedTo }; evs.push({ type: "hermes_handoff", data: { to: s.handedTo } }); }
    else if (!s.handedTo && prev.handoff) next.handoff = null;
    // Publicação nova a cada ciclo: sair do "no ar" (reverter, ajuste) zera a
    // hora; entrar de novo carimba agora até o "no ar às" do Hermes chegar.
    if (s.phase === "no_ar" && prev.phase !== "no_ar") next.liveAt = now;
    else if (s.phase !== "no_ar" && prev.phase === "no_ar") next.liveAt = "";
    return next;
  });
  if (!r?.changed) return r;
  if (evs.length) await recordTicketEvents(repo, r.ticket, evs, { by: ACTOR_LINEAR, now });
  const h = r.ticket.hermes || {};
  if (h.needsHuman && (h.phase !== r.before.phase || !r.before.needsHuman)) {
    await notifyApprovers(repo, r.ticket, cfg, { phase: h.phase, since: h.phaseSince || now, now });
  }
  if (evs.length) log?.info?.(`hermes: ticket #${r.ticket.number} → ${h.phase}${h.handoff ? ` (com ${h.handoff.to})` : ""}`);
  return r;
}

// Comentário novo no card. Só o que é do Hermes muda o retrato: versão em
// validação, pergunta, "no ar às", aceite/recusa do pedido de entrega.
export async function applyHermesComment(repo, ticket, comment, cfg, { now = nowIso() } = {}) {
  if (!cfg?.enabled || !isHermesAuthor(comment?.user || (comment?.userId ? { id: comment.userId } : null), cfg)) return null;
  const p = parseHermesComment(comment.body);
  const ev = [];
  const r = await writeHermes(repo, ticket.id, (prev) => {
    // Card que nunca foi do Hermes não ganha retrato por um comentário solto.
    if (!prev.labeled && !prev.requested) return null;
    const next = { ...prev, lastHermesAt: now };
    // Mesmo comentário de novo (releitura, reentrega): não repete o evento.
    if (p.kind === "validation" && prev.validationCommentId === str(comment.id, 120)) return null;
    if (p.kind === "live" && prev.liveAt === p.liveAt) return null;
    if (p.kind === "stalled" && prev.stalled?.commentId === str(comment.id, 120)) return null;
    // Qualquer outro comentário do Hermes depois da parada = ele retomou.
    if (p.kind !== "stalled" && prev.stalled) next.stalled = null;
    if (p.kind === "validation") {
      if (p.version) next.version = p.version;
      next.validationCommentId = str(comment.id, 120);
      ev.push({ type: "hermes_validation", data: { version: p.version || 0, risk: p.risk || "", touchesDb: p.touchesDb } });
    } else if (p.kind === "live") {
      next.liveAt = p.liveAt;
      ev.push({ type: "hermes_live", data: { at: p.liveAt } });
    } else if (p.kind === "question") {
      ev.push({ type: "hermes_question", data: { excerpt: excerpt(p.text, 140) } });
    } else if (p.kind === "stalled") {
      next.stalled = { commentId: str(comment.id, 120), at: str(comment.createdAt, 40) || now, reason: p.reason };
      ev.push({ type: "hermes_stalled", data: { excerpt: p.reason } });
    } else if (p.kind === "declined" && prev.requested) {
      next.requested = null;
      ev.push({ type: "hermes_declined", data: { excerpt: excerpt(p.text, 140) } });
    }
    // O aceite vale pela etiqueta posta no card (applyHermesIssue); o
    // comentário de aceite sozinho não vira evento, senão contaria duas vezes.
    return next;
  });
  if (r?.ticket && ev.length) await recordTicketEvents(repo, r.ticket, ev, { by: ACTOR_LINEAR, now });
  return { kind: p.kind, version: p.version || 0 };
}

// Rodapé das ações que saem do cockpit pela chave única do Linear: o card
// mostra o dono da chave como autor, então o nome real vai no texto. O
// comando (`ajuste:`, `recusar:`…) fica SEMPRE na primeira linha.
// Reconhece o rodapé: o webhook do comentário pode chegar antes de o id
// entrar em `linear.posted`, e aí é por ele que o eco não vira aviso.
export const isCockpitSigned = (body) => /\n\n— [^\n]{1,120}, via Cockpit\s*$/.test(String(body || ""));
export const signed = (text, name) => `${String(text || "").trim()}\n\n— ${str(name, 120) || "Equipe"}, via Cockpit`;

// O que o Hermes espera ler, por ação (contrato do guia + `hermes: assumir`).
export function commentFor(action, { text = "", name = "", version = 0 } = {}) {
  const t = String(text || "").trim();
  switch (action) {
    case "aprovar": return signed(`Aprovado${version ? ` v${version}` : ""} por ${str(name, 120) || "Equipe"}.`, name);
    case "ajuste": return signed(`ajuste: ${t}`, name);
    case "recusar": return signed(`recusar: ${t}`, name);
    case "reverter": return signed(`reverter: ${t}`, name);
    case "revisao": return signed(`revisão: seguir sem a resposta da pergunta${t ? `\n\n${t}` : ""}\n\nSe aparecer uma dúvida nova, devolva o card para Aguardando resposta.`, name);
    case "entregar": return signed(t ? `hermes: assumir\n\n${t}` : "hermes: assumir", name);
    case "desistir": return signed("Aprovação desfeita: o card volta para Validar antes da publicação.", name);
    case "passar_time": return signed(`Passado para ${t || "o time"} pelo Cockpit.`, name);
    default: return signed(t, name);
  }
}
