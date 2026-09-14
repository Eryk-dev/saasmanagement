// Núcleo do módulo de Suporte (tickets). Mesmo desenho de tasks-core.js: as
// rotas dedicadas (routes.tickets.js), o portal público do cliente
// (routes.support-portal.js), o runner de SLA e o MCP passam por AQUI, então
// eventos, notificações e SLA saem iguais por qualquer porta.
//
// Modelo (doc JSONB em `tickets`): ver composeTicket.
//   status    semântica fixa em TICKET_STATUSES (`kind` open/waiting/done) —
//             kanban, contadores e SLA leem o kind, nunca o rótulo.
//   messages  conversa embutida: `reply` é pública (o cliente vê no portal) e
//             `note` é interna. NOTA INTERNA NUNCA SAI PELO PORTAL.
//   sla       prazos e marcos calculados por tickets-sla.js.
//
// O isolamento por produto (support-scope.js) é aplicado por quem chama: aqui
// só se valida que responsável e cliente pertencem ao produto do ticket.
// Toda escrita num ticket passa por withTaskLock("ticket:<id>") — o repo grava
// o doc inteiro (last-write-wins).

import { randomUUID } from "node:crypto";
import { httpError, withTaskLock, parseMentions, upsertNotification, ACTOR_API } from "./tasks-core.js";
import { nextSla, normalizeHours } from "./tickets-sla.js";
import { canHandleSaas } from "./support-scope.js";

export { httpError, ACTOR_API };
export const ACTOR_PORTAL = "portal"; // cliente pelo portal público (sem sessão)

export const TICKET_STATUSES = [
  { key: "new", label: "Novo", kind: "open" },
  { key: "open", label: "Em atendimento", kind: "open" },
  { key: "pending_customer", label: "Aguardando cliente", kind: "waiting" },
  { key: "on_hold", label: "Em espera", kind: "waiting" },
  { key: "resolved", label: "Resolvido", kind: "done" },
  { key: "closed", label: "Fechado", kind: "done" },
];
export const STATUS_KIND = Object.fromEntries(TICKET_STATUSES.map((s) => [s.key, s.kind]));
export const STATUS_LABEL = Object.fromEntries(TICKET_STATUSES.map((s) => [s.key, s.label]));
export const TICKET_PRIORITIES = ["urgent", "high", "normal", "low"];
export const PRIORITY_LABEL = { urgent: "Urgente", high: "Alta", normal: "Normal", low: "Baixa" };
export const TICKET_CHANNELS = ["internal", "portal", "whatsapp", "email"];
export const MESSAGE_KINDS = ["reply", "note"];
export const BULK_ACTIONS = ["assign", "status", "priority"];
export const MAX_BULK = 200;
export const MAX_TEXT = 10000;

// Minutos (úteis, quando o expediente está ligado) por prioridade.
export const DEFAULT_POLICIES = {
  urgent: { firstResponseMin: 60, resolutionMin: 480 },
  high: { firstResponseMin: 240, resolutionMin: 1440 },
  normal: { firstResponseMin: 480, resolutionMin: 2880 },
  low: { firstResponseMin: 1440, resolutionMin: 7200 },
};
export const SETTINGS_DEFAULTS = {
  pauseOn: ["pending_customer"],
  categories: ["Dúvida", "Problema técnico", "Financeiro", "Sugestão"],
  autoCloseResolvedDays: 7,
  warnAt: 0.8,
};

// ── Utilitários ──────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const uniq = (arr) => [...new Set(arr)];
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const strArr = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const shortId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const excerpt = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const posInt = (v, d, max = 60 * 24 * 365) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 && n <= max ? n : d; };
const lockKey = (id) => `ticket:${id}`;
export const ticketTitle = (t) => `#${t.number || "?"} ${t.subject || "(sem assunto)"}`;

// ── Configurações por produto ────────────────────────────────────────────────
export function normalizeSettings(doc, saas, product = null) {
  const src = isObj(doc) ? doc : {};
  const policies = {};
  for (const p of TICKET_PRIORITIES) {
    const d = DEFAULT_POLICIES[p];
    const s = isObj(src.policies?.[p]) ? src.policies[p] : {};
    policies[p] = { firstResponseMin: posInt(s.firstResponseMin, d.firstResponseMin), resolutionMin: posInt(s.resolutionMin, d.resolutionMin) };
  }
  // Expediente: o do suporte quando configurado, senão o do comercial do produto.
  const wa = product?.waCallFlow || {};
  const bh = isObj(src.businessHours) ? src.businessHours : {};
  const businessHours = normalizeHours({ enabled: bh.enabled, hourStart: bh.hourStart ?? wa.hourStart, hourEnd: bh.hourEnd ?? wa.hourEnd });
  const pauseOn = Array.isArray(src.pauseOn) ? uniq(src.pauseOn.filter((k) => STATUS_KIND[k] === "waiting")) : [...SETTINGS_DEFAULTS.pauseOn];
  const categories = Array.isArray(src.categories) ? uniq(strArr(src.categories).map((c) => c.slice(0, 60))).slice(0, 50) : [...SETTINGS_DEFAULTS.categories];
  const days = Math.floor(Number(src.autoCloseResolvedDays));
  const warn = Number(src.warnAt);
  return {
    id: String(saas), saas: String(saas),
    policies, businessHours, pauseOn, categories,
    autoCloseResolvedDays: Number.isFinite(days) && days >= 0 && days <= 90 ? days : SETTINGS_DEFAULTS.autoCloseResolvedDays,
    warnAt: Number.isFinite(warn) && warn >= 0.5 && warn <= 0.95 ? warn : SETTINGS_DEFAULTS.warnAt,
    portal: { enabled: src.portal?.enabled === true, intro: String(src.portal?.intro ?? "").slice(0, 1000) },
    notifyCustomerByEmail: src.notifyCustomerByEmail === true,
    updatedAt: String(src.updatedAt || ""), updatedBy: String(src.updatedBy || ""),
  };
}
const slaSettings = (s) => ({ ...s, statusKinds: STATUS_KIND });

export async function loadSettings(repo, saas) {
  const [doc, product] = await Promise.all([
    repo.get("ticket_settings", saas).catch(() => null),
    repo.get("products", saas).catch(() => null),
  ]);
  return normalizeSettings(doc, saas, product);
}

// PUT parcial: políticas mesclam por prioridade; o resto troca pelo enviado.
export async function saveSettings(repo, saas, body, { by = ACTOR_API, now = nowIso() } = {}) {
  const product = await repo.get("products", saas).catch(() => null);
  if (!product) throw httpError(404, "produto não encontrado", "saas_unknown");
  const doc = await repo.get("ticket_settings", saas).catch(() => null);
  const cur = normalizeSettings(doc, saas, product);
  const src = isObj(body) ? body : {};
  const merged = { ...cur };
  for (const k of ["pauseOn", "categories", "autoCloseResolvedDays", "warnAt", "notifyCustomerByEmail"]) if (k in src) merged[k] = src[k];
  if (isObj(src.businessHours)) merged.businessHours = { ...cur.businessHours, ...src.businessHours };
  if (isObj(src.portal)) merged.portal = { ...cur.portal, ...src.portal };
  if (isObj(src.policies)) {
    merged.policies = { ...cur.policies };
    for (const p of TICKET_PRIORITIES) if (isObj(src.policies[p])) merged.policies[p] = { ...cur.policies[p], ...src.policies[p] };
  }
  const next = normalizeSettings({ ...merged, updatedAt: now, updatedBy: by }, saas, product);
  for (const p of TICKET_PRIORITIES) {
    if (next.policies[p].resolutionMin < next.policies[p].firstResponseMin) {
      throw httpError(400, `prioridade ${PRIORITY_LABEL[p]}: o prazo de resolução não pode ser menor que o da 1ª resposta`, "policy_invalid");
    }
  }
  return doc ? repo.update("ticket_settings", saas, next) : repo.create("ticket_settings", next);
}

// ── Pessoas ──────────────────────────────────────────────────────────────────
const nameOf = (users, id, ticket = null) => {
  if (id === ACTOR_PORTAL) return ticket?.requester?.name || "O cliente";
  if (!id || id === ACTOR_API) return "API";
  return users.find((u) => u.id === id)?.name || id;
};
const mentionUsers = (users) => users.map((u) => ({ id: String(u.id), name: String(u.name || u.id) }));

// Atendentes que recebem ticket novo sem responsável: etiqueta `support` e o
// produto no escopo.
export const agentsOf = (users, saas) =>
  users.filter((u) => (u.roles || []).includes("support") && canHandleSaas(u, saas));

function assertAssignee(users, assignee, saas) {
  const id = str(assignee, 120);
  if (!id) return "";
  const u = users.find((x) => x.id === id);
  if (!u) throw httpError(400, "responsável não encontrado", "assignee_unknown");
  if (!canHandleSaas(u, saas)) throw httpError(400, "essa pessoa não atende tickets deste produto", "assignee_out_of_scope");
  return id;
}
async function assertCustomer(repo, customerId, saas) {
  const c = await repo.get("customers", customerId).catch(() => null);
  if (!c) throw httpError(400, "cliente não encontrado", "customer_not_found");
  if (c.saas && c.saas !== saas) throw httpError(400, "o cliente é de outro produto", "customer_other_saas");
  return c;
}

// Número legível (#1042), único e crescente. Sem o contador (ambiente novo ou
// doc perdido), parte do maior número já gravado.
async function nextNumber(repo) {
  return withTaskLock("ticket_seq", async () => {
    const doc = await repo.get("app_config", "ticket_seq").catch(() => null);
    let base = Number(doc?.value) || 0;
    if (!doc) {
      const all = await repo.list("tickets");
      base = all.reduce((m, t) => Math.max(m, Number(t.number) || 0), 0);
    }
    const value = base + 1;
    if (doc) await repo.update("app_config", "ticket_seq", { value }, { silent: true });
    else await repo.create("app_config", { id: "ticket_seq", value });
    return value;
  });
}

// ── Composição e saneamento ──────────────────────────────────────────────────
const cleanRequester = (r, cur = {}) => {
  const src = isObj(r) ? r : {};
  const out = { name: "", email: "", phone: "", ...cur };
  if ("name" in src) out.name = str(src.name, 200);
  if ("email" in src) out.email = str(src.email, 200).toLowerCase();
  if ("phone" in src) out.phone = str(src.phone, 40);
  return out;
};
const cleanTags = (v) => uniq(strArr(v).map((t) => t.slice(0, 40))).slice(0, 20);

export function composeTicket(input, { by = ACTOR_API, now = nowIso() } = {}) {
  const src = isObj(input) ? input : {};
  return {
    number: 0,
    saas: str(src.saas, 80).toLowerCase(),
    subject: str(src.subject, 200),
    description: String(src.description ?? "").slice(0, MAX_TEXT),
    status: "new",
    priority: TICKET_PRIORITIES.includes(src.priority) ? src.priority : "normal",
    category: str(src.category, 60),
    tags: cleanTags(src.tags),
    channel: TICKET_CHANNELS.includes(src.channel) ? src.channel : "internal",
    customerId: str(src.customerId, 120),
    leadId: str(src.leadId, 120),
    requester: cleanRequester(src.requester),
    assignee: str(src.assignee, 120),
    followers: [],
    messages: [],
    attachments: [],
    sla: {},
    portalToken: randomUUID().replaceAll("-", ""),
    lastMessageAt: "", lastCustomerAt: "", lastAgentAt: "",
    createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, closedAt: "",
    version: 0,
  };
}

const MANAGED = new Set(["id", "number", "saas", "channel", "messages", "attachments", "sla", "portalToken", "createdAt", "createdBy",
  "updatedAt", "updatedBy", "closedAt", "version", "lastMessageAt", "lastCustomerAt", "lastAgentAt"]);

export function sanitizeTicketPatch(body, cur) {
  const src = isObj(body) ? body : {};
  if ("saas" in src && str(src.saas, 80).toLowerCase() !== cur.saas) throw httpError(400, "o produto do ticket não muda depois de aberto", "saas_immutable");
  const p = {};
  for (const [k, v] of Object.entries(src)) if (!MANAGED.has(k)) p[k] = v;
  const out = {};
  if ("subject" in p) { out.subject = str(p.subject, 200); if (!out.subject) throw httpError(400, "o ticket precisa de um assunto", "subject_required"); }
  if ("description" in p) out.description = String(p.description ?? "").slice(0, MAX_TEXT);
  if ("status" in p) { out.status = String(p.status ?? ""); if (!STATUS_KIND[out.status]) throw httpError(400, "status inválido", "status_invalid"); }
  if ("priority" in p) { out.priority = String(p.priority ?? ""); if (!TICKET_PRIORITIES.includes(out.priority)) throw httpError(400, "prioridade inválida (urgent, high, normal, low)", "priority_invalid"); }
  if ("category" in p) out.category = str(p.category, 60);
  if ("tags" in p) out.tags = cleanTags(p.tags);
  if ("customerId" in p) out.customerId = str(p.customerId, 120);
  if ("leadId" in p) out.leadId = str(p.leadId, 120);
  if ("requester" in p) out.requester = cleanRequester(p.requester, cur.requester || {});
  if ("assignee" in p) out.assignee = str(p.assignee, 120);
  if ("followers" in p) out.followers = uniq(strArr(p.followers));
  return out;
}

// ── Diferença → eventos ──────────────────────────────────────────────────────
export function diffTicket(before, after) {
  const ev = [];
  if (before.status !== after.status) ev.push({ type: "status_changed", data: { from: before.status, to: after.status } });
  if (before.priority !== after.priority) ev.push({ type: "priority_changed", data: { from: before.priority, to: after.priority } });
  if ((before.assignee || "") !== (after.assignee || "")) ev.push({ type: "assigned", data: { from: before.assignee || "", to: after.assignee || "" } });
  const fields = ["subject", "description", "category", "tags", "customerId", "leadId", "requester"]
    .filter((k) => JSON.stringify(before[k] ?? "") !== JSON.stringify(after[k] ?? ""));
  if (fields.length) ev.push({ type: "updated", data: { fields } });
  const oldM = new Set((before.messages || []).map((m) => m.id));
  for (const m of after.messages || []) {
    if (!oldM.has(m.id)) ev.push({ type: "message", data: { messageId: m.id, kind: m.kind, authorType: m.author?.type || "agent", excerpt: excerpt(m.text, 140), mentions: m.mentions || [] } });
  }
  const oldA = new Set((before.attachments || []).map((a) => a.id));
  const newA = new Set((after.attachments || []).map((a) => a.id));
  for (const a of after.attachments || []) if (!oldA.has(a.id)) ev.push({ type: "attachment_added", data: { id: a.id, name: a.name, public: !!a.public } });
  for (const a of before.attachments || []) if (!newA.has(a.id)) ev.push({ type: "attachment_removed", data: { id: a.id, name: a.name } });
  return ev;
}

let eventSeq = 0;
const nextEventId = () => `tke_${Date.now().toString(36)}${(eventSeq = (eventSeq + 1) % 46656).toString(36).padStart(3, "0")}`;
export async function recordTicketEvents(repo, ticket, events, { by = ACTOR_API, now = nowIso() } = {}) {
  const out = [];
  for (const e of events) {
    out.push(await repo.create("ticket_events", { id: nextEventId(), ticket: ticket.id, saas: ticket.saas, type: e.type, by, at: now, data: e.data || {} }));
  }
  return out;
}

// ── Notificações (caixa de entrada do sino) ─────────────────────────────────
// `task` carrega o id do ticket só pra deduplicação/limpeza; o destino real é
// o `link` (o sino abre #tickets/<id>). Quem perdeu o produto do escopo não
// recebe texto do ticket.
export async function notifyTicketEvents(repo, ticket, events, { by = ACTOR_API, users = [], now = nowIso() } = {}) {
  const who = nameOf(users, by, ticket);
  const title = ticketTitle(ticket);
  const followers = ticket.followers || [];
  const items = [];
  const push = (recipients, type, text) => {
    for (const id of uniq(recipients || [])) {
      const u = users.find((x) => x.id === id);
      if (!u || id === by || !canHandleSaas(u, ticket.saas)) continue;
      items.push({ user: id, type, text });
    }
  };
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case "assigned": if (d.to) push([d.to], "ticket_assigned", `${who} te atribuiu o ticket ${title}`); break;
      case "unassigned_new": push(d.agents, "ticket_new", `Novo ticket sem responsável: ${title}`); break;
      case "priority_changed": push([ticket.assignee], "ticket_priority", `${who} mudou a prioridade de ${title} para ${PRIORITY_LABEL[d.to] || d.to}`); break;
      case "status_changed":
        if (STATUS_KIND[d.to] === "done" && STATUS_KIND[d.from] !== "done") push(followers, "ticket_resolved", `${who} marcou ${title} como ${STATUS_LABEL[d.to].toLowerCase()}`);
        break;
      case "message": {
        if (d.authorType === "customer") { push([ticket.assignee, ...followers], "ticket_reply", `${who} respondeu no ticket ${title}: ${excerpt(d.excerpt, 60)}`); break; }
        const mentioned = d.mentions || [];
        push(mentioned, "ticket_mention", `${who} mencionou você em ${title}`);
        push(followers.filter((f) => !mentioned.includes(f)), d.kind === "note" ? "ticket_note" : "ticket_reply",
          `${who} ${d.kind === "note" ? "deixou uma nota" : "respondeu"} em ${title}: ${excerpt(d.excerpt, 60)}`);
        break;
      }
      default: break;
    }
  }
  const out = [];
  for (const it of items) {
    out.push(await upsertNotification(repo, {
      ...it, task: ticket.id, taskTitle: title, saas: ticket.saas, by,
      link: { screen: "tickets", thread: ticket.id },
    }, { now }));
  }
  return out;
}

// ── Leitura ──────────────────────────────────────────────────────────────────
// Lista sem a conversa (o drawer busca o ticket inteiro).
export function summarizeTicket(t) {
  const { messages = [], ...rest } = t;
  const last = messages[messages.length - 1];
  return {
    ...rest,
    messageCount: messages.length,
    lastMessage: last ? { kind: last.kind, authorType: last.author?.type || "agent", at: last.at, excerpt: excerpt(last.text, 120) } : null,
  };
}

export async function listTickets(repo, scope, query = {}) {
  const q = isObj(query) ? query : {};
  const saas = str(q.saas, 80).toLowerCase();
  let rows;
  if (saas) rows = scope === null || scope.includes(saas) ? await repo.listWhere("tickets", { saas }) : [];
  else if (scope === null) rows = await repo.list("tickets");
  else rows = (await Promise.all(scope.map((s) => repo.listWhere("tickets", { saas: s })))).flat();
  const list = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const statuses = list(q.status);
  if (statuses.length) rows = rows.filter((t) => statuses.includes(t.status));
  const priorities = list(q.priority);
  if (priorities.length) rows = rows.filter((t) => priorities.includes(t.priority));
  if (q.assignee === "none") rows = rows.filter((t) => !t.assignee);
  else if (q.assignee) rows = rows.filter((t) => t.assignee === String(q.assignee));
  if (q.customerId) rows = rows.filter((t) => t.customerId === String(q.customerId));
  if (q.channel) rows = rows.filter((t) => t.channel === String(q.channel));
  if (q.open === "1" || q.open === "true") rows = rows.filter((t) => STATUS_KIND[t.status] !== "done");
  return rows.sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0)).map(summarizeTicket);
}

export async function ticketActivity(repo, ticket, { limit = 300 } = {}) {
  const events = (await repo.listWhere("ticket_events", { ticket: ticket.id }))
    .map((e) => ({ kind: "event", id: e.id, type: e.type, by: e.by, at: e.at, data: e.data || {} }));
  const n = Math.max(1, Math.min(2000, Number(limit) || 300));
  return events.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")) || String(a.id).localeCompare(String(b.id))).slice(-n);
}

// ── Escrita ──────────────────────────────────────────────────────────────────
// Carimbo + SLA + eventos + notificações: caminho único de toda alteração.
async function writeTicket(repo, cur, draft, { by, now, users, settings, extraEvents = [] }) {
  const next = { ...draft };
  next.sla = nextSla(cur, next, slaSettings(settings), now);
  if (next.status === "closed" && cur.status !== "closed") next.closedAt = now;
  if (next.status !== "closed") next.closedAt = "";
  next.updatedAt = now; next.updatedBy = by; next.version = (Number(cur.version) || 0) + 1;
  const saved = await repo.update("tickets", cur.id, next);
  const events = [...diffTicket(cur, saved), ...extraEvents];
  await recordTicketEvents(repo, saved, events, { by, now });
  await notifyTicketEvents(repo, saved, events, { by, users, now });
  return { ticket: saved, events };
}

export async function createTicket(repo, input, { by = ACTOR_API, now = nowIso() } = {}) {
  const t = composeTicket(input, { by, now });
  if (!t.saas) throw httpError(400, "informe o produto do ticket", "saas_required");
  const product = await repo.get("products", t.saas).catch(() => null);
  if (!product) throw httpError(400, "produto não encontrado", "saas_unknown");
  if (!t.subject) throw httpError(400, "o ticket precisa de um assunto", "subject_required");
  const [users, settings] = await Promise.all([repo.list("users"), loadSettings(repo, t.saas)]);
  if (t.customerId) {
    const c = await assertCustomer(repo, t.customerId, t.saas);
    t.requester = {
      name: t.requester.name || c.contact || c.name || "",
      email: t.requester.email || String(c.email || "").toLowerCase(),
      phone: t.requester.phone || String(c.phone || ""),
    };
    t.leadId = t.leadId || String(c.leadId || "");
  }
  t.assignee = assertAssignee(users, t.assignee, t.saas);
  if (t.assignee) t.status = "open";
  if (t.category && settings.categories.length && !settings.categories.includes(t.category)) t.category = "";
  t.followers = uniq([by, t.assignee].filter((u) => u && users.some((x) => x.id === u)));
  t.number = await nextNumber(repo);
  t.sla = nextSla(null, t, slaSettings(settings), now);
  const saved = await repo.create("tickets", t);
  const events = [{ type: "created", data: { channel: saved.channel } }];
  if (saved.assignee) events.push({ type: "assigned", data: { from: "", to: saved.assignee } });
  await recordTicketEvents(repo, saved, events, { by, now });
  const notify = [...events];
  if (!saved.assignee) notify.push({ type: "unassigned_new", data: { agents: agentsOf(users, saved.saas).map((u) => u.id) } });
  await notifyTicketEvents(repo, saved, notify, { by, users, now });
  return saved;
}

export async function patchTicket(repo, id, body, { by = ACTOR_API, now = nowIso() } = {}) {
  return withTaskLock(lockKey(id), async () => {
    const cur = await repo.get("tickets", id);
    if (!cur) return null;
    const [users, settings] = await Promise.all([repo.list("users"), loadSettings(repo, cur.saas)]);
    const p = sanitizeTicketPatch(body, cur);
    if ("customerId" in p && p.customerId && p.customerId !== cur.customerId) {
      const c = await assertCustomer(repo, p.customerId, cur.saas);
      if (!("leadId" in p)) p.leadId = String(c.leadId || "");
    }
    if ("assignee" in p) {
      p.assignee = assertAssignee(users, p.assignee, cur.saas);
      if (p.assignee && (p.status ?? cur.status) === "new") p.status = "open";
    }
    if ("followers" in p) p.followers = p.followers.filter((u) => users.some((x) => x.id === u));
    const next = { ...cur, ...p };
    next.followers = uniq([...(next.followers || []), next.assignee].filter(Boolean));
    return writeTicket(repo, cur, next, { by, now, users, settings });
  });
}

// Mensagem na conversa. `author.type` "customer" = veio do portal (sempre
// pública); atendente escolhe resposta (pública) ou nota (interna) e pode
// mudar o status no mesmo envio (ex.: responder e aguardar o cliente).
export async function addMessage(repo, id, { kind = "reply", text = "", status = "", attachments = [] } = {}, { by = ACTOR_API, now = nowIso(), customerName = "" } = {}) {
  const body = String(text ?? "").trim();
  const isCustomer = by === ACTOR_PORTAL;
  const wanted = strArr(attachments);
  if (!body && !wanted.length) throw httpError(400, "escreva a mensagem antes de enviar", "message_empty");
  if (body.length > MAX_TEXT) throw httpError(400, `mensagem longa demais (máx. ${MAX_TEXT} caracteres)`, "message_too_long");
  const msgKind = isCustomer ? "reply" : (MESSAGE_KINDS.includes(kind) ? kind : "reply");
  if (status && !STATUS_KIND[status]) throw httpError(400, "status inválido", "status_invalid");
  return withTaskLock(lockKey(id), async () => {
    const cur = await repo.get("tickets", id);
    if (!cur) return null;
    if (isCustomer && cur.status === "closed") throw httpError(409, "este ticket foi fechado; abra um novo pedido", "ticket_closed");
    const [users, settings] = await Promise.all([repo.list("users"), loadSettings(repo, cur.saas)]);
    const known = new Set((cur.attachments || []).map((a) => a.id));
    const mentions = isCustomer ? [] : parseMentions(body, mentionUsers(users));
    const message = {
      id: shortId("tm"), kind: msgKind,
      author: isCustomer ? { type: "customer", name: str(customerName, 200) || cur.requester?.name || "" } : { type: "agent", id: by },
      text: body, at: now, mentions,
      attachments: wanted.filter((a) => known.has(a)),
    };
    const next = { ...cur, messages: [...(cur.messages || []), message], lastMessageAt: now, sla: { ...(cur.sla || {}) } };
    if (msgKind === "reply" && isCustomer) {
      next.lastCustomerAt = now;
      if (STATUS_KIND[cur.status] !== "open") next.status = "open";
    }
    if (msgKind === "reply" && !isCustomer) {
      next.lastAgentAt = now;
      if (!next.sla.firstResponseAt) next.sla.firstResponseAt = now;
      if (cur.status === "new") next.status = "open";
    }
    if (!isCustomer && status) next.status = status;
    if (!isCustomer) next.followers = uniq([...(cur.followers || []), ...(users.some((u) => u.id === by) ? [by] : []), ...mentions]);
    // Anexo citado numa resposta pública passa a ser visível no portal.
    if (msgKind === "reply" && message.attachments.length) {
      next.attachments = (cur.attachments || []).map((a) => (message.attachments.includes(a.id) ? { ...a, public: true } : a));
    }
    const r = await writeTicket(repo, cur, next, { by, now, users, settings });
    return { message, ticket: r.ticket };
  });
}

export async function addTicketAttachment(repo, id, asset, { by = ACTOR_API, now = nowIso(), isPublic = false } = {}) {
  if (!asset?.id) throw httpError(400, "anexo inválido", "attachment_invalid");
  return withTaskLock(lockKey(id), async () => {
    const cur = await repo.get("tickets", id);
    if (!cur) return null;
    if ((cur.attachments || []).some((a) => a.id === asset.id)) return { ticket: cur };
    const [users, settings] = await Promise.all([repo.list("users"), loadSettings(repo, cur.saas)]);
    const a = {
      id: String(asset.id), name: str(asset.name, 200), mime: str(asset.mime, 120),
      size: Math.max(0, Math.floor(Number(asset.size) || 0)), by, at: now, public: isPublic === true,
    };
    const next = { ...cur, attachments: [...(cur.attachments || []), a] };
    const r = await writeTicket(repo, cur, next, { by, now, users, settings });
    return { attachment: a, ticket: r.ticket };
  });
}

export async function removeTicketAttachment(repo, id, attachmentId, { by = ACTOR_API, now = nowIso() } = {}) {
  const aid = String(attachmentId || "");
  const r = await withTaskLock(lockKey(id), async () => {
    const cur = await repo.get("tickets", id);
    if (!cur) return null;
    if (!(cur.attachments || []).some((a) => a.id === aid)) throw httpError(404, "anexo não encontrado", "attachment_not_found");
    const [users, settings] = await Promise.all([repo.list("users"), loadSettings(repo, cur.saas)]);
    const next = {
      ...cur,
      attachments: cur.attachments.filter((a) => a.id !== aid),
      messages: (cur.messages || []).map((m) => ((m.attachments || []).includes(aid) ? { ...m, attachments: m.attachments.filter((x) => x !== aid) } : m)),
    };
    return writeTicket(repo, cur, next, { by, now, users, settings });
  });
  if (r) { try { await repo.remove("ticket_assets", aid); } catch { /* best-effort */ } }
  return r;
}

export async function deleteTicket(repo, id) {
  return withTaskLock(lockKey(id), async () => {
    const cur = await repo.get("tickets", id);
    if (!cur) return null;
    for (const ev of await repo.listWhere("ticket_events", { ticket: id }, { fields: [] })) await repo.remove("ticket_events", ev.id);
    for (const n of await repo.listWhere("notifications", { task: id }, { fields: [] })) await repo.remove("notifications", n.id);
    for (const a of cur.attachments || []) { try { await repo.remove("ticket_assets", a.id); } catch { /* best-effort */ } }
    await repo.remove("tickets", id);
    return { removed: id };
  });
}

// Ação em massa: cada id passa pelo caminho de uma edição normal. `allowed`
// decide o escopo (id fora dele conta como inexistente).
export async function bulkTickets(repo, { ids = [], action = "", value = null } = {}, { by = ACTOR_API, now = nowIso(), allowed = () => true } = {}) {
  const list = uniq(strArr(ids)).slice(0, MAX_BULK);
  if (!list.length) throw httpError(400, "informe os tickets", "ids_required");
  if (!BULK_ACTIONS.includes(action)) throw httpError(400, `ação desconhecida (${BULK_ACTIONS.join(", ")})`, "action_unknown");
  const field = { assign: "assignee", status: "status", priority: "priority" }[action];
  const out = { ok: [], missing: [], failed: [] };
  for (const id of list) {
    try {
      const cur = await repo.get("tickets", id);
      if (!cur || !allowed(cur)) { out.missing.push(id); continue; }
      const r = await patchTicket(repo, id, { [field]: String(value ?? "") }, { by, now });
      if (r === null) out.missing.push(id); else out.ok.push(id);
    } catch (err) {
      out.failed.push({ id, error: err?.message || String(err), code: err?.code || "" });
    }
  }
  return out;
}
