// Semântica de estágios no SPA — espelho de packages/api/src/stages.js.
// O funil de cada produto é dado (product.funnel[{stage, kind, cadence, ...}]);
// TODA decisão de tela (fase SDR/Closer, terminal, cadência, condicionais do
// drawer) passa por aqui, nunca por nome de estágio hardcoded. Funil sem `kind`
// (pré-migração / SaaS novo) cai na heurística por nome — comportamento idêntico
// ao antigo.

export const KINDS = {
  novo:           { label: "novo lead",      phase: "sdr",     glyph: "◦" },
  contato:        { label: "em contato",     phase: "sdr",     glyph: "◌" },
  qualificacao:   { label: "qualificação",   phase: "sdr",     glyph: "◑" },
  call:           { label: "call",           phase: "closer",  glyph: "◆" },
  proposta:       { label: "proposta",       phase: "closer",  glyph: "▤" },
  followup:       { label: "follow-up",      phase: "closer",  glyph: "↻" },
  integracao:     { label: "integração",     phase: "entrega", glyph: "⚙" },
  posvenda:       { label: "pós-venda (CS)", phase: "entrega", glyph: "❤" },
  ganho:          { label: "ganho",          phase: "fim",     glyph: "✓" },
  perdido:        { label: "perdido",        phase: "fim",     glyph: "✕" },
  desqualificado: { label: "desqualificado", phase: "fim",     glyph: "⊘" },
  outro:          { label: "outro",          phase: "",        glyph: "·" },
};
export const KIND_IDS = Object.keys(KINDS);

export const PHASES = {
  sdr:     { label: "SDR",     tone: "var(--fg-3)" },
  closer:  { label: "CLOSER",  tone: "var(--fg-3)" },
  entrega: { label: "ENTREGA", tone: "var(--fg-4)" },
  fim:     { label: "FIM",     tone: "var(--fg-4)" },
};

// Heurística por nome (funil legado sem kind) — mesma do servidor.
export function guessKind(stageName, index = -1) {
  const n = String(stageName || "").toLowerCase();
  if (/ganho|won|fechad|pago/.test(n)) return "ganho";
  if (/perdid|lost|sem\s*resposta|nutri|churn|descart/.test(n)) return "perdido";
  if (/desqualif|disqualified/.test(n)) return "desqualificado";
  if (/integra/.test(n)) return "integracao";
  if (/acompanhament|p[óo]s.?venda|sucesso|cs\b/.test(n)) return "posvenda";
  if (/follow/.test(n)) return "followup";
  if (/proposta|proposal|negocia/.test(n)) return "proposta";
  if (/call|reuni|demo/.test(n)) return "call";
  if (/qualific/.test(n)) return "qualificacao";
  if (/contato|contact/.test(n)) return "contato";
  if (/novo|inbox|new|entrada/.test(n)) return "novo";
  return index === 0 ? "novo" : "outro";
}

const funnelOf = (s) => (Array.isArray(s?.funnel) ? s.funnel : []);

export function stageKind(saasCfg, stageName) {
  const funnel = funnelOf(saasCfg);
  const i = funnel.findIndex((f) => f && f.stage === stageName);
  if (i >= 0) {
    const k = funnel[i].kind;
    return KINDS[k] ? k : guessKind(stageName, i);
  }
  // fora do funil: nomes legados soltos (ex.: "disqualified" do form)
  if (stageName === "disqualified") return "desqualificado";
  return guessKind(stageName, -1);
}

export const phaseOf = (kind) => KINDS[kind]?.phase || "";
export const isWonKind = (k) => k === "ganho";
export const isLossKind = (k) => k === "perdido" || k === "desqualificado";
export const isTerminalKind = (k) => k === "ganho" || isLossKind(k);

export const isWonStage = (saasCfg, stage) => isWonKind(stageKind(saasCfg, stage));
export const isTerminalStage = (saasCfg, stage) => isTerminalKind(stageKind(saasCfg, stage));

// Nomes terminais do produto (+ marcador legado "disqualified" que vive fora do
// funil) — substitui o Set hardcoded do overview.
export function terminalSet(saasCfg) {
  const t = new Set(["disqualified"]);
  for (const f of funnelOf(saasCfg)) if (isTerminalKind(stageKind(saasCfg, f.stage))) t.add(f.stage);
  return t;
}

export function firstStage(saasCfg) {
  return funnelOf(saasCfg)[0]?.stage || "";
}

export function wonStage(saasCfg) {
  return funnelOf(saasCfg).find((f) => stageKind(saasCfg, f.stage) === "ganho")?.stage || "Ganho";
}

export function stageByKind(saasCfg, kind) {
  return funnelOf(saasCfg).find((f) => stageKind(saasCfg, f.stage) === kind)?.stage || "";
}

// Régua de progresso (até o ganho, inclusive) — o que o forecast/funil linear usa.
export function ladderOf(saasCfg) {
  const names = funnelOf(saasCfg).map((f) => f.stage);
  const cut = names.findIndex((st) => stageKind(saasCfg, st) === "ganho");
  return cut === -1 ? names : names.slice(0, cut + 1);
}

// Estágios "abertos" = régua antes do ganho (Integração conta; terminais não) —
// substitui o `stages.slice(0, wonIdx)` por nome do pipeline/overview. Usado
// por forecast/TCV/contagens: só o que é PROGRESSO de venda.
export function openStages(saasCfg) {
  const lad = ladderOf(saasCfg);
  return lad.length && stageKind(saasCfg, lad[lad.length - 1]) === "ganho" ? lad.slice(0, -1) : lad;
}

// Estágios "trabalháveis" = qualquer kind não-terminal, INCLUSIVE filas fora da
// régua (ex.: Nutrição/Mentoria posicionadas depois do Ganho). É o conjunto da
// fila do GPS e do pill de próximo toque — um lead em nutrição tem próximo
// passo, mas não conta como pipeline aberto no forecast.
export function workableStages(saasCfg) {
  return funnelOf(saasCfg)
    .filter((f) => !isTerminalKind(stageKind(saasCfg, f.stage)))
    .map((f) => f.stage);
}

// Cadência do estágio. Fallback legado: o mapa que era hardcoded no pipeline
// (ATTEMPT_SLOTS; só Qualificação tinha trava diária) — some sozinho quando o
// funil ganhar `cadence`.
const LEGACY_SLOTS = {
  "Qualificação": { maxAttempts: 5, retryDays: 1 },
  "Call closer": { maxAttempts: 3 },
  "Negociação": { maxAttempts: 5 },
};
export function cadenceOf(saasCfg, stageName) {
  const row = funnelOf(saasCfg).find((f) => f && f.stage === stageName);
  if (row?.cadence && typeof row.cadence === "object") return row.cadence;
  return LEGACY_SLOTS[stageName] || {};
}

export function lossReasonsOf(saasCfg) {
  return Array.isArray(saasCfg?.lossReasons) && saasCfg.lossReasons.length
    ? saasCfg.lossReasons
    : [
        { id: "preco", label: "Preço" }, { id: "sem_resposta", label: "Sem resposta" },
        { id: "sem_fit", label: "Sem fit" }, { id: "timing", label: "Timing" },
        { id: "concorrente", label: "Concorrente" }, { id: "outro", label: "Outro" },
      ];
}

export function lossReasonLabel(saasCfg, id) {
  if (!id) return "";
  if (id === "nao_informado") return "não informado";
  return lossReasonsOf(saasCfg).find((r) => r.id === id)?.label || id;
}

// ── Ordem dos "próximos passos" (bloco "Depois da ação" da tela Meu dia) ──────
// Os destinos que o NEXT_KINDS do today.jsx emite — inclui os pseudo-kinds
// `retry` (Retomar amanhã) e `noshow` (cliente furou), que NÃO estão em KINDS.
// A ordem é uma prioridade GLOBAL por produto (product.nextStepOrder): cada
// etapa continua mostrando só o subconjunto válido dela, mas nesta ordem.
export const NEXT_STEP_KINDS = ["retry", "call", "noshow", "contato", "followup", "integracao", "posvenda", "ganho", "desqualificado"];
export const NEXT_STEP_LABELS = {
  retry:          "Retomar amanhã / tentar de novo",
  call:           "Agendar call",
  noshow:         "No show (cliente furou)",
  contato:        "Nutrição / voltar pro contato",
  followup:       "Follow-up",
  integracao:     "Integração (entrega)",
  posvenda:       "Pós-venda (CS)",
  ganho:          "Ganho",
  desqualificado: "Desqualificado",
};

// Normaliza a lista salva: só kinds válidos, sem repetição, completando com os
// que faltarem (na ordem canônica) — nenhum destino some se o catálogo crescer.
export function normalizeNextStepOrder(order) {
  const seen = new Set();
  const out = [];
  for (const k of Array.isArray(order) ? order : []) {
    if (NEXT_STEP_KINDS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const k of NEXT_STEP_KINDS) if (!seen.has(k)) out.push(k);
  return out;
}

// Reordena os destinos resolvidos pela prioridade escolhida. Cada destino traz
// `nk` = o kind de origem no NEXT_KINDS. Estável: empates (ou kinds fora da
// lista) mantêm a ordem original do NEXT_KINDS da etapa.
export function orderNextSteps(dests, order) {
  if (!Array.isArray(order) || !order.length) return dests;
  const rank = new Map(order.map((k, i) => [k, i]));
  return dests
    .map((d, i) => ({ d, i, r: rank.has(d.nk) ? rank.get(d.nk) : order.length + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.d);
}

// O funil trabalha de segunda a sexta: agendamento otimista do GPS que cair em
// sáb/dom rola pra segunda 08:00 (espelho do rollToBusinessDay do servidor; aqui
// no relógio local do navegador — o time opera em BRT).
export function rollToBusinessDay(input) {
  const d = new Date(input);
  const dow = d.getDay();
  if (dow !== 0 && dow !== 6) return d;
  d.setDate(d.getDate() + (dow === 6 ? 2 : 1));
  d.setHours(8, 0, 0, 0);
  return d;
}

// ── Próximo toque (GPS) ─────────────────────────────────────────────────────
// Unifica nextActionAt (toque avulso, ISO UTC) e callAt (reunião, datetime-local
// naive) num só conceito: o compromisso mais próximo do lead.

const parseWhen = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

export function nextTouch(lead) {
  const touch = parseWhen(lead?.nextActionAt);
  const meeting = parseWhen(lead?.callAt);
  if (touch == null && meeting == null) return null;
  if (meeting != null && (touch == null || meeting <= touch)) {
    return { at: meeting, type: "meeting", note: "call" };
  }
  return { at: touch, type: "touch", note: lead?.nextActionNote || "" };
}

// Dados do pill de próximo contato (cards do kanban + fila). Generaliza o antigo
// nextContactPill do pipeline: atrasado / hoje / futuro / sem próximo passo.
export function nextTouchPill(lead, { isOpen = true } = {}) {
  if (!isOpen) return null;
  const t = nextTouch(lead);
  if (!t) return { key: "none", text: "sem próximo passo", tone: "var(--warn)", type: "none" };
  const now = Date.now();
  const glyph = t.type === "meeting" ? "◆" : "●";
  const d = new Date(t.at);
  const sameDay = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (t.at < now && !sameDay) {
    const days = Math.floor((now - t.at) / 86_400_000);
    return { key: "late", text: `${glyph} atrasado ${days >= 1 ? `${days}d` : ""}`.trim(), tone: "var(--neg)", type: t.type, at: t.at };
  }
  if (sameDay) return { key: "today", text: `${glyph} hoje ${hm}`, tone: t.at < now ? "var(--neg)" : "var(--warn)", type: t.type, at: t.at };
  const days = Math.ceil((t.at - now) / 86_400_000);
  const label = days === 1 ? "amanhã" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return { key: "future", text: `${glyph} ${label}`, tone: "var(--fg-3)", type: t.type, at: t.at };
}
