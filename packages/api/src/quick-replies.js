// Respostas rápidas do Suporte: textos prontos que o atendente insere na
// conversa do ticket, com variáveis resolvidas pelo contexto do ticket.
//
// Dois escopos, sempre presos a um produto (o mesmo isolamento dos tickets):
//   shared    da equipe do produto — edita quem tem a tela Configurações de SLA
//             (admin e chave mestre também);
//   personal  de um atendente (`owner`) — só ele vê e edita. `saas` vazio vale
//             pra todos os produtos que ele atende.
//
// Variáveis: `{{cliente.primeiro_nome}}` (embutidas, com ponto ou palavra
// reservada) e `{{horario_atendimento}}` (customizadas do produto, guardadas em
// ticket_settings.variables). Quem resolve é SEMPRE o servidor
// (variableValues + renderTemplate): a prévia da página e a inserção no chat usam a mesma
// função. Variável desconhecida fica no texto como está e volta em `missing`;
// variável conhecida sem valor vira texto vazio e volta em `empty`.

import { httpError, STATUS_LABEL, PRIORITY_LABEL, sanitizeVariables, RESERVED_VARIABLE_KEYS } from "./tickets-core.js";
import { inScope } from "./support-scope.js";

export { sanitizeVariables };

export const MAX_BODY = 5000;
const SHORTCUT_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TOKEN_RE = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/gi;

const nowIso = () => new Date().toISOString();
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const TZ = "America/Sao_Paulo";
const fmtDay = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const fmtDue = (iso) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(", ", " às ") : "");
const hourBrt = (d) => Number(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d)) % 24;

// Variáveis embutidas: chave, o que é e um exemplo (prévia sem ticket).
export const BUILTIN_VARIABLES = [
  { key: "saudacao", label: "Bom dia, boa tarde ou boa noite (horário de Brasília)", sample: "Boa tarde" },
  { key: "cliente.primeiro_nome", label: "Primeiro nome do solicitante", sample: "Carla" },
  { key: "cliente.nome", label: "Nome completo do solicitante", sample: "Carla Nunes" },
  { key: "cliente.email", label: "E-mail do solicitante", sample: "carla@casabela.com.br" },
  { key: "cliente.empresa", label: "Cliente vinculado ao ticket", sample: "Casa Bela Utilidades" },
  { key: "ticket.numero", label: "Número do ticket", sample: "1042" },
  { key: "ticket.assunto", label: "Assunto do ticket", sample: "Relatório mensal em PDF" },
  { key: "ticket.status", label: "Status atual", sample: "Em atendimento" },
  { key: "ticket.prioridade", label: "Prioridade", sample: "Normal" },
  { key: "ticket.prazo", label: "Prazo de resolução do SLA", sample: "15/09 às 18:00" },
  { key: "ticket.link", label: "Link do chamado no portal do cliente", sample: "https://…/s/…" },
  { key: "atendente.primeiro_nome", label: "Seu primeiro nome", sample: "Lia" },
  { key: "atendente.nome", label: "Seu nome completo", sample: "Lia Souza" },
  { key: "produto.nome", label: "Nome do produto", sample: "LeverAds" },
  { key: "hoje", label: "Data de hoje", sample: "14/09/2026" },
];
// Embutida sem ponto precisa estar em RESERVED_VARIABLE_KEYS (tickets-core.js),
// senão uma customizada com o mesmo nome a sobrescreveria (o teste confere).
export { RESERVED_VARIABLE_KEYS };

export function slugShortcut(s) {
  return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// Valores das variáveis para um ticket (ou a prévia de exemplo, sem ticket).
export async function variableValues(repo, { ticket = null, user = null, saas, baseUrl = "", now = new Date(), settings = null } = {}) {
  const [product, customer, users] = await Promise.all([
    repo.get("products", saas).catch(() => null),
    ticket?.customerId ? repo.get("customers", ticket.customerId).catch(() => null) : null,
    repo.list("users").catch(() => []),
  ]);
  const agent = user?.id ? users.find((u) => u.id === user.id) || user : null;
  const h = hourBrt(now);
  const values = {
    saudacao: h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite",
    "atendente.nome": agent?.name || "",
    "atendente.primeiro_nome": firstName(agent?.name),
    "produto.nome": product?.name || "",
    hoje: fmtDay(now),
  };
  if (ticket) {
    Object.assign(values, {
      "cliente.nome": ticket.requester?.name || "",
      "cliente.primeiro_nome": firstName(ticket.requester?.name),
      "cliente.email": ticket.requester?.email || "",
      "cliente.empresa": customer?.name || "",
      "ticket.numero": String(ticket.number || ""),
      "ticket.assunto": ticket.subject || "",
      "ticket.status": STATUS_LABEL[ticket.status] || "",
      "ticket.prioridade": PRIORITY_LABEL[ticket.priority] || "",
      "ticket.prazo": fmtDue(ticket.sla?.resolutionDue),
      "ticket.link": ticket.portalToken && baseUrl ? `${baseUrl}/s/${ticket.portalToken}` : "",
    });
  } else {
    // Prévia: exemplo nas variáveis do ticket; atendente e produto são reais.
    for (const v of BUILTIN_VARIABLES) if (!(v.key in values) || !values[v.key]) values[v.key] = v.sample;
  }
  for (const v of sanitizeVariables(settings?.variables)) values[v.key] = v.value;
  return values;
}

export function renderTemplate(body, values) {
  const missing = new Set(), empty = new Set();
  const text = String(body || "").replace(TOKEN_RE, (all, rawKey) => {
    const key = rawKey.toLowerCase();
    if (!(key in values)) { missing.add(key); return all; }
    if (!values[key]) empty.add(key);
    return values[key];
  });
  return { text, missing: [...missing], empty: [...empty] };
}

// ── Acesso ──────────────────────────────────────────────────────────────────
// `canEditShared`: quem chama já resolveu (tela support_settings / admin / chave).
export function visibleTo(qr, { scope, userId }) {
  if (qr.scope === "personal") return !!userId && qr.owner === userId;
  return inScope(scope, qr.saas);
}
export function canEdit(qr, { scope, userId, canEditShared }) {
  if (qr.scope === "personal") return !!userId && qr.owner === userId;
  return canEditShared && inScope(scope, qr.saas);
}

export async function listQuickReplies(repo, { saas, scope, userId }) {
  const all = await repo.list("quick_replies");
  return all
    .filter((qr) => visibleTo(qr, { scope, userId }))
    .filter((qr) => (qr.scope === "personal" ? !qr.saas || qr.saas === saas : qr.saas === saas))
    .sort((a, b) => (b.uses || 0) - (a.uses || 0) || String(a.title).localeCompare(String(b.title), "pt-BR"));
}

function sanitizeInput(body, cur = null) {
  const src = body && typeof body === "object" ? body : {};
  const out = {};
  if (!cur || "title" in src) { out.title = str(src.title, 120); if (!out.title) throw httpError(400, "dê um título à resposta rápida", "title_required"); }
  if (!cur || "body" in src) {
    out.body = String(src.body ?? "").slice(0, MAX_BODY + 1);
    if (!out.body.trim()) throw httpError(400, "escreva o texto da resposta rápida", "body_required");
    if (out.body.length > MAX_BODY) throw httpError(400, `texto longo demais (máx. ${MAX_BODY} caracteres)`, "body_too_long");
  }
  if (!cur || "shortcut" in src) {
    out.shortcut = slugShortcut(src.shortcut || out.title || cur?.title);
    if (!SHORTCUT_RE.test(out.shortcut)) throw httpError(400, "atalho inválido: use letras, números e hífen", "shortcut_invalid");
  }
  return out;
}

async function assertShortcutFree(repo, qr) {
  const all = await repo.list("quick_replies");
  const clash = all.find((x) => x.id !== qr.id && x.shortcut === qr.shortcut && x.scope === qr.scope
    && (qr.scope === "personal" ? x.owner === qr.owner && (x.saas || "") === (qr.saas || "") : x.saas === qr.saas));
  if (clash) throw httpError(409, `o atalho /${qr.shortcut} já é usado por "${clash.title}"`, "shortcut_taken");
}

export async function createQuickReply(repo, body, { scope, user, canEditShared, now = nowIso() }) {
  const src = body && typeof body === "object" ? body : {};
  const kind = src.scope === "personal" ? "personal" : "shared";
  const saas = str(src.saas, 80).toLowerCase();
  const userId = user?.id || "";
  if (kind === "personal" && !userId) throw httpError(400, "resposta pessoal exige uma sessão de usuário", "session_required");
  if (kind === "shared" && !saas) throw httpError(400, "informe o produto da resposta da equipe", "saas_required");
  if (saas && !inScope(scope, saas)) throw httpError(403, "você não atende este produto", "saas_out_of_scope");
  if (kind === "shared" && !canEditShared) throw httpError(403, "só quem gerencia o suporte cria respostas da equipe; salve como pessoal", "shared_forbidden");
  if (saas && !(await repo.get("products", saas))) throw httpError(400, "produto não encontrado", "saas_unknown");
  const qr = { ...sanitizeInput(src), scope: kind, saas, owner: kind === "personal" ? userId : "", uses: 0, lastUsedAt: "", createdAt: now, createdBy: userId || "api", updatedAt: now, updatedBy: userId || "api" };
  await assertShortcutFree(repo, qr);
  return repo.create("quick_replies", qr);
}

export async function updateQuickReply(repo, id, body, ctx) {
  const cur = await repo.get("quick_replies", id);
  if (!cur || !visibleTo(cur, ctx)) return null;
  if (!canEdit(cur, ctx)) throw httpError(403, "só quem gerencia o suporte edita as respostas da equipe", "shared_forbidden");
  const next = { ...cur, ...sanitizeInput(body, cur), updatedAt: ctx.now || nowIso(), updatedBy: ctx.userId || "api" };
  await assertShortcutFree(repo, next);
  return repo.update("quick_replies", id, next);
}

export async function deleteQuickReply(repo, id, ctx) {
  const cur = await repo.get("quick_replies", id);
  if (!cur || !visibleTo(cur, ctx)) return null;
  if (!canEdit(cur, ctx)) throw httpError(403, "só quem gerencia o suporte apaga as respostas da equipe", "shared_forbidden");
  await repo.remove("quick_replies", id);
  return { removed: id };
}

