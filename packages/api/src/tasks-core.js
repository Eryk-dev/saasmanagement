// Núcleo do quadro de Tarefas (nível Asana): as regras de domínio usadas pelas
// rotas dedicadas (routes.tasks.js) E pelos hooks do CRUD genérico (routes.js),
// pra que o SPA antigo (PATCH cru do doc) e o novo (rotas /move, /complete,
// /comments...) produzam os MESMOS eventos, notificações e regras de coluna.
//
// Modelo (doc JSONB em `tasks`): ver TASK_DEFAULTS. `column` = key estável da
// coluna do board; `completed` é a régua ÚNICA de "concluída" (a coluna de
// concluído do board só acompanha, via regra de coluna); `parentId` = subtarefa;
// `order` = float por coluna (renumerado quando o vão fica pequeno demais).
//
// Toda escrita numa tarefa passa por withTaskLock(id): o repo grava o doc
// inteiro (last-write-wins), então dois comentários simultâneos se atropelavam.
// O processo da API é único (db.js), a fila em memória basta.

import { randomUUID } from "node:crypto";

export const PRIORITIES = ["", "P0", "P1", "P2"];
export const DEFAULT_COLUMNS = [
  { key: "todo", name: "A fazer", color: "" },
  { key: "doing", name: "Em andamento", color: "" },
  { key: "done", name: "Concluído", color: "" },
];
export const TASK_DEFAULTS = {
  title: "", description: "", saas: "", assignees: [], column: "", priority: "",
  startDate: "", dueDate: "", labels: [], comments: [], order: 0,
  photo: "", cover: "", attachments: [],
  completed: false, completedAt: "", completedBy: "", completedFrom: "",
  parentId: "", followUpOf: "", duplicatedFrom: "", recurrenceOf: "", recurrence: null,
  blockedBy: [], followers: [], likes: [],
  createdAt: "", createdBy: "", updatedAt: "", updatedBy: "", version: 0,
};
export const BOARD_DEFAULTS = { name: "Tarefas", columns: [], doneKey: "", completeMovesToDone: true, labels: [] };
export const BULK_ACTIONS = ["assign", "unassign", "due", "priority", "move", "complete", "reopen", "label", "unlabel", "delete"];
export const MAX_DEPTH = 5;          // subtarefa de subtarefa... até aqui
export const MAX_BULK = 200;
export const ASSET_PREFIX = "/public/tasks/";
export const ACTOR_API = "api";      // chave mestre / MCP (sem sessão de usuário)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEDUPE_MS = 10 * 60 * 1000;   // notificação igual (tipo+tarefa+pessoa) em 10 min só atualiza

// ── Utilitários ──────────────────────────────────────────────────────────────
export function httpError(statusCode, message, code = "") {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
const nowIso = () => new Date().toISOString();
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const strArr = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const uniq = (arr) => [...new Set(arr)];
const shortId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Dia de negócio em São Paulo ("YYYY-MM-DD"). en-CA formata exatamente assim.
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export const brtToday = (now = new Date()) => DAY_FMT.format(now);

// Datas puras: aritmética em UTC ao meio-dia pra nunca escorregar de dia.
const ymdToUtc = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return Date.UTC(y, m - 1, d, 12); };
const utcToYmd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (ymd, n) => utcToYmd(ymdToUtc(ymd) + n * 86400000);
export const diffDays = (a, b) => Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000);
const weekdayOf = (ymd) => new Date(ymdToUtc(ymd)).getUTCDay(); // 0 = domingo
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0, 12)).getUTCDate(); // m = 1..12

function cleanDate(v, field) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!DATE_RE.test(s)) throw httpError(400, `${field} precisa ser uma data no formato AAAA-MM-DD`, "date_invalid");
  return s;
}
export function cleanRecurrence(r) {
  if (!isObj(r)) return null;
  const every = ["day", "week", "month"].includes(r.every) ? r.every : "";
  if (!every) return null;
  const interval = Math.max(1, Math.floor(num(r.interval) || 1));
  const weekdays = uniq((Array.isArray(r.weekdays) ? r.weekdays : []).map((n) => Math.floor(num(n))).filter((n) => n >= 0 && n <= 6)).sort((a, b) => a - b);
  const until = DATE_RE.test(String(r.until || "")) ? String(r.until) : "";
  const monthDay = num(r.monthDay) >= 1 && num(r.monthDay) <= 31 ? Math.floor(num(r.monthDay)) : 0;
  return { every, interval, weekdays, until, monthDay };
}
export const assetIdFromUrl = (url) => (String(url || "").startsWith(ASSET_PREFIX) ? String(url).slice(ASSET_PREFIX.length).split(/[?#]/)[0] : "");
const cleanAssetUrl = (u) => (assetIdFromUrl(u) ? `${ASSET_PREFIX}${assetIdFromUrl(u)}` : "");
export function cleanAttachment(a) {
  if (!isObj(a)) return null;
  const url = cleanAssetUrl(a.url || (a.id ? `${ASSET_PREFIX}${a.id}` : ""));
  const id = assetIdFromUrl(url);
  if (!id) return null;
  return { id, url, name: String(a.name || "").slice(0, 200), mime: String(a.mime || ""), size: Math.max(0, Math.floor(num(a.size))), by: String(a.by || ""), at: String(a.at || "") };
}
const cleanAttachments = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(cleanAttachment).filter((a) => a && !seen.has(a.id) && seen.add(a.id));
};
const isImage = (mime) => /^image\//.test(String(mime || ""));
// Ids de asset que uma tarefa referencia (anexos + capa).
export const assetIdsOf = (t) => uniq([...(t.attachments || []).map((a) => a.id), assetIdFromUrl(t.cover), assetIdFromUrl(t.photo)].filter(Boolean));

// ── Fila por tarefa ──────────────────────────────────────────────────────────
const locks = new Map();
export function withTaskLock(id, fn) {
  const key = String(id ?? "");
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}
// Vários ids em ordem fixa (evita deadlock entre duas operações cruzadas).
export function withTaskLocks(ids, fn) {
  const sorted = uniq(ids.map((x) => String(x ?? ""))).sort();
  const go = (i) => (i >= sorted.length ? fn() : withTaskLock(sorted[i], () => go(i + 1)));
  return go(0);
}

// ── Board ────────────────────────────────────────────────────────────────────
export function cleanRules(r) {
  if (!isObj(r)) return null;
  const out = {};
  if (r.complete === true || r.complete === false) out.complete = r.complete;
  const assign = uniq(strArr(r.assign));
  if (assign.length) out.assign = assign;
  if (PRIORITIES.includes(r.priority) && r.priority) out.priority = r.priority;
  return Object.keys(out).length ? out : null;
}
export function cleanColumn(c) {
  if (!isObj(c)) return null;
  const key = String(c.key ?? "").trim();
  if (!key) return null;
  const col = { key, name: String(c.name ?? "").trim() || "Coluna", color: String(c.color ?? "") };
  const rules = cleanRules(c.rules);
  if (rules) col.rules = rules;
  return col;
}
export function cleanLabels(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((l) => (isObj(l) ? { name: String(l.name ?? "").trim(), color: String(l.color ?? "") } : { name: String(l ?? "").trim(), color: "" }))
    .filter((l) => l.name && !seen.has(l.name.toLowerCase()) && seen.add(l.name.toLowerCase()));
}
// A coluna de concluído de um board que nasceu antes do `doneKey` (a regex de
// antes do SPA: key "done" ou nome com "conclu"). Só vale quando o campo NÃO
// existe no doc; doneKey "" explícito = "nenhuma coluna conclui".
export const legacyDoneKey = (columns) => (columns.find((c) => c.key === "done" || /conclu/i.test(c.name || "")) || {}).key || "";

export function normalizeBoard(doc) {
  const cleaned = (Array.isArray(doc?.columns) ? doc.columns : []).map(cleanColumn).filter(Boolean);
  const columns = cleaned.length ? cleaned : DEFAULT_COLUMNS.map((c) => ({ ...c }));
  let doneKey = String(doc?.doneKey ?? "");
  if (!doc || doc.doneKey === undefined) doneKey = legacyDoneKey(columns);
  else if (!columns.some((c) => c.key === doneKey)) doneKey = "";
  return {
    id: doc?.id || "",
    name: String(doc?.name || BOARD_DEFAULTS.name),
    columns, doneKey,
    completeMovesToDone: doc?.completeMovesToDone !== false,
    labels: cleanLabels(doc?.labels),
  };
}
export async function loadBoard(repo) {
  const boards = await repo.list("task_boards");
  return normalizeBoard(boards[0] || null);
}
// PATCH/POST de task_boards: só as chaves enviadas, saneadas; `doneKey` que
// deixou de apontar pra uma coluna existente vira "" (nunca órfão).
export function sanitizeBoardPatch(body, cur = null) {
  const src = isObj(body) ? body : {};
  const patch = {};
  const curColumns = normalizeBoard(cur).columns;
  let columns = curColumns;
  if ("columns" in src) {
    const cleaned = (Array.isArray(src.columns) ? src.columns : []).map(cleanColumn).filter(Boolean);
    const seen = new Set();
    columns = cleaned.filter((c) => !seen.has(c.key) && seen.add(c.key));
    if (!columns.length) throw httpError(400, "o quadro precisa de pelo menos uma coluna", "columns_empty");
    patch.columns = columns;
  }
  if ("doneKey" in src) patch.doneKey = columns.some((c) => c.key === String(src.doneKey ?? "")) ? String(src.doneKey) : "";
  else if (!cur) patch.doneKey = legacyDoneKey(columns);
  else if ("columns" in src && cur.doneKey !== undefined && !columns.some((c) => c.key === cur.doneKey)) patch.doneKey = "";
  if ("labels" in src) patch.labels = cleanLabels(src.labels);
  if ("completeMovesToDone" in src) patch.completeMovesToDone = src.completeMovesToDone !== false;
  if ("name" in src) patch.name = String(src.name ?? "").trim() || BOARD_DEFAULTS.name;
  if (!cur) return { ...BOARD_DEFAULTS, ...patch, columns: patch.columns || [] };
  return patch;
}
export const colKeyOf = (t, board) => (board.columns.some((c) => c.key === t.column) ? t.column : board.columns[0].key);

// ── Pessoas e menções ────────────────────────────────────────────────────────
export async function usersOf(repo) {
  const list = await repo.list("users");
  return list.map((u) => ({ id: String(u.id), name: String(u.name || u.id) }));
}
export const nameOf = (users, id) => (id === ACTOR_API || !id ? "API" : (users.find((u) => u.id === id)?.name || id));

// "@leonardo", "@Leonardo Parra" ou "@Leo" (primeiro nome, quando só uma pessoa
// tem). Devolve ids existentes, sem repetir.
export function parseMentions(text, users = []) {
  const out = [];
  const re = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_.-]+(?:[ \u00a0][\p{L}\p{N}_.-]+)?)/gu;
  for (const m of String(text || "").matchAll(re)) {
    const raw = m[2];
    const candidates = [raw, raw.split(/[ \u00a0]/)[0]];
    let hit = null;
    for (const cand of candidates) {
      const key = strip(cand).replace(/[.,;:!?)]+$/, "");
      if (!key) continue;
      hit = users.find((u) => strip(u.id) === key || strip(u.name) === key) || null;
      if (!hit) {
        const byFirst = users.filter((u) => strip(u.name).split(" ")[0] === key);
        if (byFirst.length === 1) hit = byFirst[0];
      }
      if (hit) break;
    }
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

function normalizeComment(c, { by = ACTOR_API, now = nowIso(), users = [] } = {}) {
  const src = isObj(c) ? c : { text: String(c ?? "") };
  const text = String(src.text ?? "");
  const author = by !== ACTOR_API ? by : String(src.author || ACTOR_API);
  return {
    id: src.id ? String(src.id) : shortId("c"),
    author, text,
    at: String(src.at || "") || now,
    editedAt: String(src.editedAt || ""),
    likes: uniq(strArr(src.likes)),
    mentions: users.length ? parseMentions(text, users) : uniq(strArr(src.mentions)),
  };
}
// PATCH cru do array de comentários (SPA antigo): comentário que já existe
// mantém autor/hora/curtidas (só o autor troca o texto); id novo é carimbado
// com quem gravou; comentário que sumiu do array foi apagado.
export function mergeComments(current, incoming, ctx) {
  const byId = new Map((Array.isArray(current) ? current : []).map((c) => [String(c.id), c]));
  return (Array.isArray(incoming) ? incoming : []).map((raw) => {
    const c = isObj(raw) ? raw : { text: String(raw ?? "") };
    const old = c.id != null ? byId.get(String(c.id)) : null;
    if (!old) return normalizeComment(c, ctx);
    const text = c.text == null ? old.text : String(c.text);
    const canEdit = old.author === ctx.by || ctx.by === ACTOR_API;
    const changed = canEdit && text !== old.text;
    return { ...old, text: changed ? text : old.text, editedAt: changed ? ctx.now : (old.editedAt || ""), mentions: changed ? parseMentions(text, ctx.users || []) : (old.mentions || []) };
  });
}

// ── Composição e saneamento ──────────────────────────────────────────────────
const MANAGED = new Set(["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "version", "completedAt", "completedBy", "completedFrom", "recurrenceOf", "duplicatedFrom", "likes", "attachments", "_reorder", "_dedup"]);

export function composeTask(input, { by = ACTOR_API, board = null, now = nowIso(), users = [] } = {}) {
  const b = board || normalizeBoard(null);
  const src = isObj(input) ? input : {};
  const t = { ...TASK_DEFAULTS, ...src };
  t.title = String(src.title ?? "").trim();
  t.description = String(src.description ?? "");
  t.saas = String(src.saas ?? "");
  t.assignees = uniq(strArr(Array.isArray(src.assignees) ? src.assignees : (src.assignee ? [src.assignee] : [])));
  delete t.assignee;
  t.labels = uniq(strArr(src.labels));
  t.column = b.columns.some((c) => c.key === src.column) ? src.column : b.columns[0].key;
  t.priority = PRIORITIES.includes(src.priority) ? src.priority : "";
  t.startDate = cleanDate(src.startDate, "startDate");
  t.dueDate = cleanDate(src.dueDate, "dueDate");
  t.order = num(src.order);
  t.recurrence = cleanRecurrence(src.recurrence);
  t.attachments = cleanAttachments(src.attachments);
  const cover = cleanAssetUrl(src.cover || src.photo);
  t.cover = cover; t.photo = cover;
  t.comments = (Array.isArray(src.comments) ? src.comments : []).map((c) => normalizeComment(c, { by, now, users }));
  t.parentId = String(src.parentId ?? "");
  t.followUpOf = String(src.followUpOf ?? "");
  t.duplicatedFrom = String(src.duplicatedFrom ?? "");
  t.recurrenceOf = String(src.recurrenceOf ?? "");
  t.blockedBy = uniq(strArr(src.blockedBy)).filter((x) => x !== String(src.id ?? ""));
  t.likes = uniq(strArr(src.likes));
  t.completed = src.completed === true;
  t.completedAt = t.completed ? (String(src.completedAt || "") || now) : "";
  t.completedBy = t.completed ? (String(src.completedBy || "") || by) : "";
  t.completedFrom = t.completed ? String(src.completedFrom || "") : "";
  const person = by && by !== ACTOR_API ? [by] : [];
  t.followers = uniq([...person, ...t.assignees, ...strArr(src.followers)]);
  t.createdAt = String(src.createdAt || "") || now;
  t.createdBy = by !== ACTOR_API ? by : String(src.createdBy || ACTOR_API);
  t.updatedAt = now; t.updatedBy = by; t.version = 0;
  delete t._reorder; delete t._dedup;
  if (src.id != null) t.id = String(src.id); else delete t.id;
  return t;
}

// Patch vindo de fora (PATCH genérico, /bulk, drawer): só o que pode ser
// editado, já saneado. Campos gerenciados (carimbos, curtidas, anexos) caem.
export function sanitizeTaskPatch(body, cur, board) {
  const src = isObj(body) ? body : {};
  const p = {};
  for (const [k, v] of Object.entries(src)) if (!MANAGED.has(k)) p[k] = v;
  if ("title" in p) p.title = String(p.title ?? "").trim();
  if ("description" in p) p.description = String(p.description ?? "");
  if ("saas" in p) p.saas = String(p.saas ?? "");
  if ("assignees" in p || "assignee" in p) { p.assignees = uniq(strArr(Array.isArray(p.assignees) ? p.assignees : (p.assignee ? [p.assignee] : []))); delete p.assignee; }
  if ("labels" in p) p.labels = uniq(strArr(p.labels));
  if ("column" in p) {
    p.column = String(p.column ?? "");
    if (!board.columns.some((c) => c.key === p.column)) throw httpError(400, "coluna desconhecida no quadro", "column_unknown");
  }
  if ("priority" in p) { p.priority = String(p.priority ?? ""); if (!PRIORITIES.includes(p.priority)) throw httpError(400, "prioridade inválida (P0, P1, P2 ou vazio)", "priority_invalid"); }
  if ("startDate" in p) p.startDate = cleanDate(p.startDate, "startDate");
  if ("dueDate" in p) p.dueDate = cleanDate(p.dueDate, "dueDate");
  if ("order" in p) p.order = num(p.order);
  if ("recurrence" in p) p.recurrence = cleanRecurrence(p.recurrence);
  if ("cover" in p || "photo" in p) { const c = cleanAssetUrl(p.cover ?? p.photo); p.cover = c; p.photo = c; }
  if ("parentId" in p) p.parentId = String(p.parentId ?? "");
  if ("followUpOf" in p) p.followUpOf = String(p.followUpOf ?? "");
  if ("blockedBy" in p) p.blockedBy = uniq(strArr(p.blockedBy)).filter((x) => x !== cur.id);
  if ("followers" in p) p.followers = uniq(strArr(p.followers));
  if ("completed" in p) p.completed = p.completed === true;
  if ("comments" in p && !Array.isArray(p.comments)) delete p.comments;
  return p;
}

// ── Ordem dentro da coluna ───────────────────────────────────────────────────
export const byOrder = (a, b) => (num(a.order) - num(b.order)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id));
// Irmãos = mesma coluna no topo do quadro; pra subtarefa, os filhos do mesmo pai.
export function siblingsOf(all, task, board, { column = null } = {}) {
  const col = column ?? colKeyOf(task, board);
  const parent = task.parentId || "";
  return all.filter((t) => t.id !== task.id && (t.parentId || "") === parent && (parent ? true : colKeyOf(t, board) === col)).sort(byOrder);
}
// Onde o card entra: antes/depois de um irmão ou no fim. Ponto médio entre
// vizinhos; quando o vão some (float esgotado), pede renumeração.
export function placement(siblings, { beforeId = "", afterId = "" } = {}) {
  let index;
  if (beforeId) {
    index = siblings.findIndex((t) => t.id === beforeId);
    if (index < 0) throw httpError(400, "o card de referência não está na mesma coluna", "anchor_not_sibling");
  } else if (afterId) {
    const i = siblings.findIndex((t) => t.id === afterId);
    if (i < 0) throw httpError(400, "o card de referência não está na mesma coluna", "anchor_not_sibling");
    index = i + 1;
  } else index = siblings.length;
  const prev = index > 0 ? num(siblings[index - 1].order) : null;
  const next = index < siblings.length ? num(siblings[index].order) : null;
  let order;
  if (prev == null && next == null) order = 1;
  else if (prev == null) order = next - 1;
  else if (next == null) order = prev + 1;
  else order = (prev + next) / 2;
  const rebalance = !Number.isFinite(order) || (prev != null && next != null && next - prev < 1e-6);
  return { order, index, rebalance };
}
const endOrder = (siblings) => (siblings.length ? num(siblings[siblings.length - 1].order) + 1 : 1);

// ── Regras de coluna e conclusão ─────────────────────────────────────────────
// Concluir/reabrir: carimbos + (quando o pedido não fixou a coluna) leva pra
// coluna de concluído guardando de onde saiu, e reabrir devolve pra lá.
export function setCompleted(task, value, { by = ACTOR_API, now = nowIso(), board = null, columnExplicit = false } = {}) {
  const t = { ...task };
  if (value) {
    t.completed = true; t.completedAt = now; t.completedBy = by;
    if (!columnExplicit && board?.completeMovesToDone !== false && board?.doneKey && t.column !== board.doneKey) {
      t.completedFrom = t.column; t.column = board.doneKey; t._reorder = "end";
    }
  } else {
    t.completed = false; t.completedAt = ""; t.completedBy = "";
    if (!columnExplicit && board?.doneKey && t.column === board.doneKey) {
      t.column = board.columns.some((c) => c.key === t.completedFrom) ? t.completedFrom : board.columns[0].key;
      t._reorder = "end";
    }
    t.completedFrom = "";
  }
  return t;
}
// Entrar na coluna de concluído (ou numa coluna com regra) conclui; sair
// reabre; regra pode somar responsável e fixar prioridade.
export function applyColumnRules(board, task, fromKey, toKey, ctx = {}) {
  const col = board.columns.find((c) => c.key === toKey);
  const rules = col?.rules || {};
  let t = { ...task, column: toKey };
  const applied = [];
  const entersDone = toKey === board.doneKey || rules.complete === true;
  const leavesDone = (fromKey === board.doneKey && toKey !== board.doneKey) || rules.complete === false;
  if (entersDone && !t.completed) { t = setCompleted(t, true, { ...ctx, board, columnExplicit: true }); applied.push("complete"); }
  else if (leavesDone && t.completed) { t = setCompleted(t, false, { ...ctx, board, columnExplicit: true }); applied.push("reopen"); }
  if (Array.isArray(rules.assign) && rules.assign.length) {
    const merged = uniq([...(t.assignees || []), ...rules.assign]);
    if (merged.length !== (t.assignees || []).length) { t.assignees = merged; applied.push("assign"); }
  }
  if (rules.priority && t.priority !== rules.priority) { t.priority = rules.priority; applied.push("priority"); }
  return { task: t, applied };
}

// ── Recorrência ──────────────────────────────────────────────────────────────
// Próximo prazo a partir do prazo da instância concluída (ou de hoje, se ela
// não tinha prazo). Semana com dias marcados: o próximo dia marcado depois da
// base; acabou a semana, pula `interval` semanas. Mês: mesmo dia (monthDay),
// apertado no fim do mês curto sem perder a âncora.
export function nextDueDate(rec, baseYmd, todayYmd = brtToday()) {
  const r = cleanRecurrence(rec);
  if (!r) return "";
  const base = DATE_RE.test(String(baseYmd || "")) ? baseYmd : todayYmd;
  let cand = "";
  if (r.every === "day") cand = addDays(base, r.interval);
  else if (r.every === "week") {
    if (!r.weekdays.length) cand = addDays(base, 7 * r.interval);
    else {
      const dow = weekdayOf(base);
      const later = r.weekdays.find((w) => w > dow);
      cand = later != null ? addDays(base, later - dow) : addDays(base, 7 * r.interval - (dow - r.weekdays[0]));
    }
  } else if (r.every === "month") {
    const [y, m, d] = base.split("-").map(Number);
    const anchor = r.monthDay || d;
    const total = (y * 12 + (m - 1)) + r.interval;
    const ny = Math.floor(total / 12), nm = (total % 12) + 1;
    cand = `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(anchor, daysInMonth(ny, nm))).padStart(2, "0")}`;
  }
  if (r.until && cand > r.until) return "";
  return cand;
}

// ── Diferença → eventos da atividade ─────────────────────────────────────────
const setDiff = (a, b) => (a || []).filter((x) => !(b || []).includes(x));
export function diffTask(before, after) {
  const ev = [];
  const added = setDiff(after.assignees, before.assignees);
  const removed = setDiff(before.assignees, after.assignees);
  if (added.length) ev.push({ type: "assigned", data: { users: added } });
  if (removed.length) ev.push({ type: "unassigned", data: { users: removed } });
  if ((before.dueDate || "") !== (after.dueDate || "")) ev.push({ type: "due_changed", data: { from: before.dueDate || "", to: after.dueDate || "" } });
  if ((before.priority || "") !== (after.priority || "")) ev.push({ type: "priority_changed", data: { from: before.priority || "", to: after.priority || "" } });
  if ((before.column || "") !== (after.column || "")) ev.push({ type: "moved", data: { from: before.column || "", to: after.column || "" } });
  if (!before.completed && after.completed) ev.push({ type: "completed", data: {} });
  if (before.completed && !after.completed) ev.push({ type: "reopened", data: {} });
  const fields = ["title", "description", "labels", "recurrence", "cover", "startDate", "parentId", "saas"].filter((k) => JSON.stringify(before[k] ?? "") !== JSON.stringify(after[k] ?? ""));
  if (fields.length) ev.push({ type: "updated", data: { fields } });
  const oldC = new Map((before.comments || []).map((c) => [c.id, c]));
  const newC = new Map((after.comments || []).map((c) => [c.id, c]));
  for (const [id, c] of newC) {
    if (!oldC.has(id)) ev.push({ type: "comment", data: { commentId: id, author: c.author, excerpt: String(c.text || "").slice(0, 140), mentions: c.mentions || [] } });
    else if (oldC.get(id).text !== c.text) ev.push({ type: "comment_edited", data: { commentId: id } });
  }
  for (const id of oldC.keys()) if (!newC.has(id)) ev.push({ type: "comment_deleted", data: { commentId: id } });
  const oldA = new Set((before.attachments || []).map((a) => a.id));
  const newA = new Set((after.attachments || []).map((a) => a.id));
  for (const a of after.attachments || []) if (!oldA.has(a.id)) ev.push({ type: "attachment_added", data: { id: a.id, name: a.name, mime: a.mime } });
  for (const a of before.attachments || []) if (!newA.has(a.id)) ev.push({ type: "attachment_removed", data: { id: a.id, name: a.name } });
  for (const b of setDiff(after.blockedBy, before.blockedBy)) ev.push({ type: "blocked_by_added", data: { taskId: b } });
  for (const b of setDiff(before.blockedBy, after.blockedBy)) ev.push({ type: "blocked_by_removed", data: { taskId: b } });
  for (const f of setDiff(after.followers, before.followers)) ev.push({ type: "follower_added", data: { user: f } });
  for (const f of setDiff(before.followers, after.followers)) ev.push({ type: "follower_removed", data: { user: f } });
  return ev;
}

// Id ORDENÁVEL (timestamp + contador): os eventos de um mesmo pedido nascem no
// mesmo ms e a atividade precisa sair na ordem em que aconteceram.
let eventSeq = 0;
const nextEventId = () => `te_${Date.now().toString(36)}${(eventSeq = (eventSeq + 1) % 46656).toString(36).padStart(3, "0")}`;
export async function recordEvents(repo, task, events, { by = ACTOR_API, now = nowIso() } = {}) {
  const out = [];
  for (const e of events) {
    out.push(await repo.create("task_events", {
      id: nextEventId(), task: task.id, parentId: task.parentId || "", saas: task.saas || "",
      type: e.type, by, at: now, data: e.data || {},
    }));
  }
  return out;
}

// ── Notificações ─────────────────────────────────────────────────────────────
const fmtDay = (ymd) => (DATE_RE.test(String(ymd || "")) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}` : "");
const excerpt = (s) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 60)}…` : t; };

// Cria (ou, se a mesma pessoa já tem a mesma notificação não lida da mesma
// tarefa há menos de 10 min, atualiza) — o burst de edições não vira spam.
export async function upsertNotification(repo, n, { now = nowIso() } = {}) {
  const same = await repo.listWhere("notifications", { user: n.user, task: n.task, type: n.type });
  const recent = same.find((x) => !x.read && Date.now() - new Date(x.at || 0).getTime() < DEDUPE_MS);
  if (recent) return repo.update("notifications", recent.id, { text: n.text, by: n.by, at: now, taskTitle: n.taskTitle });
  return repo.create("notifications", {
    id: "no_" + randomUUID(), user: n.user, type: n.type, task: n.task, taskTitle: n.taskTitle || "",
    saas: n.saas || "", text: n.text, by: n.by || ACTOR_API, at: now, read: false, readAt: "", key: n.key || "",
  });
}
export async function notifyEvents(repo, task, events, { by = ACTOR_API, users = [], now = nowIso() } = {}) {
  const who = nameOf(users, by);
  const title = task.title || "(sem título)";
  const followers = task.followers || [];
  const assignees = task.assignees || [];
  const exists = (u) => users.some((x) => x.id === u);
  const items = [];
  const push = (recipients, type, text) => { for (const u of uniq(recipients || [])) if (u && u !== by && exists(u)) items.push({ user: u, type, text }); };
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case "assigned": push(d.users, "assigned", `${who} te atribuiu a tarefa "${title}"`); break;
      case "unassigned": push(d.users, "unassigned", `${who} tirou você da tarefa "${title}"`); break;
      case "comment": {
        const mentioned = d.mentions || [];
        push(mentioned, "mention", `${who} mencionou você em "${title}"`);
        push(followers.filter((f) => !mentioned.includes(f)), "comment", `${who} comentou em "${title}": ${excerpt(d.excerpt)}`);
        break;
      }
      case "completed": push(followers, "completed", `${who} concluiu "${title}"`); break;
      case "due_changed": push(assignees, "due_changed", d.to ? `${who} mudou o prazo de "${title}" para ${fmtDay(d.to)}` : `${who} tirou o prazo de "${title}"`); break;
      case "priority_changed": push(assignees, "priority_changed", `${who} mudou a prioridade de "${title}" para ${d.to || "nenhuma"}`); break;
      case "attachment_added": push(followers, "attachment", `${who} anexou ${d.name || "um arquivo"} em "${title}"`); break;
      case "liked": push(assignees, "like", `${who} curtiu "${title}"`); break;
      case "comment_liked": push([d.author], "like", `${who} curtiu seu comentário em "${title}"`); break;
      case "subtask_added": push(followers, "subtask", `${who} criou a subtarefa "${d.title}" em "${title}"`); break;
      case "followup_created": push(followers, "followup", `${who} criou a tarefa de acompanhamento "${d.title}" a partir de "${title}"`); break;
      case "unblocked": push(d.users, "unblocked", `"${d.blockerTitle}" foi concluída, "${title}" está desbloqueada`); break;
      default: break;
    }
  }
  const out = [];
  for (const it of items) out.push(await upsertNotification(repo, { ...it, task: task.id, taskTitle: title, saas: task.saas || "", by }, { now }));
  return out;
}
export async function listNotifications(repo, user, { unread = false, limit = 50 } = {}) {
  const all = (await repo.listWhere("notifications", { user })).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const unreadCount = all.filter((n) => !n.read).length;
  const items = (unread ? all.filter((n) => !n.read) : all).slice(0, Math.max(1, Math.min(200, num(limit) || 50)));
  return { items, unread: unreadCount };
}
export async function markNotificationsRead(repo, user, { ids = [], all = false } = {}, { now = nowIso() } = {}) {
  const mine = (await repo.listWhere("notifications", { user })).filter((n) => !n.read);
  const targets = all ? mine : mine.filter((n) => ids.map(String).includes(String(n.id)));
  for (let i = 0; i < targets.length; i++) {
    await repo.update("notifications", targets[i].id, { read: true, readAt: now }, { silent: i < targets.length - 1 });
  }
  return targets.length;
}

// ── Persistência das operações ───────────────────────────────────────────────
async function assertParentOk(repo, id, parentId, all = null) {
  if (!parentId) return;
  if (parentId === id) throw httpError(400, "uma tarefa não pode ser subtarefa dela mesma", "parent_self");
  const tasks = all || await repo.list("tasks");
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (!byId.has(parentId)) throw httpError(400, "tarefa-mãe não encontrada", "parent_not_found");
  // ciclo: o pai (ou um ancestral dele) é descendente desta tarefa?
  let cur = parentId, depth = 1;
  const seen = new Set();
  while (cur) {
    if (cur === id) throw httpError(409, "isso criaria um ciclo de subtarefas", "parent_cycle");
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = byId.get(cur)?.parentId || "";
    depth++;
  }
  // profundidade: ancestrais do pai + esta + os descendentes dela
  const below = (tid, d) => { let max = d; for (const t of tasks) if ((t.parentId || "") === tid) max = Math.max(max, below(t.id, d + 1)); return max; };
  if (below(id, depth) > MAX_DEPTH) throw httpError(409, `subtarefas só até ${MAX_DEPTH} níveis`, "parent_depth");
}
// Descendentes (filhos, netos...) de uma tarefa, na lista dada.
export function descendantsOf(all, id) {
  const out = [];
  const walk = (pid) => { for (const t of all) if ((t.parentId || "") === pid && !out.includes(t)) { out.push(t); walk(t.id); } };
  walk(id);
  return out;
}

// Depois de concluir: quem estava bloqueada por esta tarefa fica sabendo.
async function afterCompleted(repo, task, { by, now, users }) {
  const all = await repo.list("tasks");
  for (const t of all) {
    if (t.completed || !(t.blockedBy || []).includes(task.id)) continue;
    const ev = [{ type: "unblocked", data: { blocker: task.id, blockerTitle: task.title || "", users: uniq([...(t.assignees || []), ...(t.followers || [])]) } }];
    await recordEvents(repo, t, ev, { by, now });
    await notifyEvents(repo, t, ev, { by, users, now });
  }
}
// Concluiu uma tarefa recorrente: nasce a próxima instância (a concluída fica
// como história, sem a recorrência, pra reabrir não gerar outra).
async function spawnNext(repo, done, recurrence, { by, now, board }) {
  const today = brtToday();
  const base = done.dueDate || today;
  const rec = { ...recurrence };
  if (rec.every === "month" && !rec.monthDay) rec.monthDay = Number(base.slice(8, 10));
  const due = nextDueDate(rec, base, today);
  if (!due) return null;
  const start = done.startDate && done.dueDate ? addDays(done.startDate, diffDays(done.dueDate, due)) : "";
  const backTo = board.columns.some((c) => c.key === done.completedFrom) ? done.completedFrom : (done.column !== board.doneKey ? done.column : board.columns[0].key);
  return createTask(repo, {
    title: done.title, description: done.description, saas: done.saas, assignees: done.assignees, labels: done.labels,
    priority: done.priority, attachments: done.attachments, followers: done.followers, parentId: done.parentId,
    startDate: start, dueDate: due, recurrence: rec, recurrenceOf: done.id, column: backTo,
  }, { by, now });
}
async function finishWrite(repo, before, saved, { by, now, users, spawn = null, board }) {
  const events = diffTask(before, saved);
  await recordEvents(repo, saved, events, { by, now });
  await notifyEvents(repo, saved, events, { by, users, now });
  if (!before.completed && saved.completed) await afterCompleted(repo, saved, { by, now, users });
  const next = spawn ? await spawnNext(repo, saved, spawn, { by, now, board }) : null;
  return { events, next };
}
// Carimbos + limpeza do marcador `_reorder` (fim da coluna nova).
async function stampAndPlace(repo, cur, next, { by, now, board }) {
  const t = { ...next, updatedAt: now, updatedBy: by, version: (num(cur.version) || 0) + 1 };
  if (t._reorder === "end") {
    const all = await repo.list("tasks");
    t.order = endOrder(siblingsOf(all, t, board));
  }
  delete t._reorder;
  return t;
}

export async function createTask(repo, input, { by = ACTOR_API, now = nowIso() } = {}) {
  const board = await loadBoard(repo);
  const users = await usersOf(repo);
  let t = composeTask(input, { by, board, now, users });
  if (!t.title && !t.description) throw httpError(400, "a tarefa precisa de um título", "title_required");
  const all = await repo.list("tasks");
  if (t.parentId) await assertParentOk(repo, t.id || "__new__", t.parentId, all);
  if (input?.order == null) t.order = endOrder(siblingsOf(all, { ...t, id: t.id || "__new__" }, board));
  const r = applyColumnRules(board, t, "", t.column, { by, now });
  t = r.task; delete t._reorder;
  const saved = await repo.create("tasks", t);
  const events = [{ type: "created", data: {} }];
  if (saved.assignees.length) events.push({ type: "assigned", data: { users: saved.assignees } });
  if (saved.completed) events.push({ type: "completed", data: {} });
  await recordEvents(repo, saved, events, { by, now });
  await notifyEvents(repo, saved, events, { by, users, now });
  if (saved.parentId) {
    const parent = await repo.get("tasks", saved.parentId);
    if (parent) {
      const ev = [{ type: "subtask_added", data: { child: saved.id, title: saved.title } }];
      await recordEvents(repo, parent, ev, { by, now });
      await notifyEvents(repo, parent, ev, { by, users, now });
    }
  }
  return saved;
}

export async function patchTask(repo, id, body, { by = ACTOR_API, now = nowIso() } = {}) {
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    const board = await loadBoard(repo);
    const users = await usersOf(repo);
    const p = sanitizeTaskPatch(body, cur, board);
    if ("parentId" in p && p.parentId !== (cur.parentId || "")) await assertParentOk(repo, id, p.parentId);
    let next = { ...cur, ...p };
    let applied = [];
    const newCommenters = [], mentioned = [];
    if ("comments" in p) {
      next.comments = mergeComments(cur.comments, p.comments, { by, now, users });
      const oldIds = new Set((cur.comments || []).map((c) => c.id));
      for (const c of next.comments) if (!oldIds.has(c.id)) { if (users.some((u) => u.id === c.author)) newCommenters.push(c.author); mentioned.push(...(c.mentions || [])); }
    }
    if ("column" in p && p.column !== (cur.column || "")) {
      const r = applyColumnRules(board, next, cur.column || "", p.column, { by, now });
      next = r.task; applied = r.applied;
    }
    if ("completed" in p && p.completed !== !!cur.completed && !applied.includes("complete") && !applied.includes("reopen")) {
      next = setCompleted(next, p.completed, { by, now, board, columnExplicit: "column" in p });
    }
    next.followers = uniq([...(next.followers || []), ...(next.assignees || []), ...newCommenters.filter((a) => a !== ACTOR_API), ...mentioned]);
    const spawn = next.completed && !cur.completed && next.recurrence ? next.recurrence : null;
    if (spawn) next.recurrence = null;
    next = await stampAndPlace(repo, cur, next, { by, now, board });
    const saved = await repo.update("tasks", id, next);
    const { next: created } = await finishWrite(repo, cur, saved, { by, now, users, spawn, board });
    return { task: saved, next: created, applied };
  });
}

export async function moveTask(repo, id, { column, beforeId = "", afterId = "" } = {}, { by = ACTOR_API, now = nowIso() } = {}) {
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    const board = await loadBoard(repo);
    const users = await usersOf(repo);
    const toKey = column == null || column === "" ? colKeyOf(cur, board) : String(column);
    if (!board.columns.some((c) => c.key === toKey)) throw httpError(400, "coluna desconhecida no quadro", "column_unknown");
    const all = await repo.list("tasks");
    const sibs = siblingsOf(all, cur, board, { column: toKey });
    const { order, index, rebalance } = placement(sibs, { beforeId: String(beforeId || ""), afterId: String(afterId || "") });
    let next = { ...cur, column: toKey, order };
    let applied = [];
    if (toKey !== (cur.column || "")) {
      const r = applyColumnRules(board, next, cur.column || "", toKey, { by, now });
      next = r.task; applied = r.applied;
    }
    let rebalanced = false;
    if (rebalance) {
      const list = [...sibs.slice(0, index), next, ...sibs.slice(index)];
      for (let i = 0; i < list.length; i++) {
        const o = i + 1;
        if (list[i].id === id) next.order = o;
        else if (num(list[i].order) !== o) await repo.update("tasks", list[i].id, { order: o }, { silent: true });
      }
      rebalanced = true;
    }
    const spawn = next.completed && !cur.completed && next.recurrence ? next.recurrence : null;
    if (spawn) next.recurrence = null;
    delete next._reorder;
    next = { ...next, updatedAt: now, updatedBy: by, version: (num(cur.version) || 0) + 1 };
    const saved = await repo.update("tasks", id, next);
    const { next: created } = await finishWrite(repo, cur, saved, { by, now, users, spawn, board });
    return { task: saved, rebalanced, applied, next: created };
  });
}

export async function completeTask(repo, id, value = true, { by = ACTOR_API, now = nowIso() } = {}) {
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    if (!!cur.completed === !!value) return { task: cur, next: null, unchanged: true };
    const board = await loadBoard(repo);
    const users = await usersOf(repo);
    let next = setCompleted(cur, !!value, { by, now, board, columnExplicit: false });
    const spawn = next.completed && !cur.completed && next.recurrence ? next.recurrence : null;
    if (spawn) next.recurrence = null;
    next = await stampAndPlace(repo, cur, next, { by, now, board });
    const saved = await repo.update("tasks", id, next);
    const { next: created } = await finishWrite(repo, cur, saved, { by, now, users, spawn, board });
    return { task: saved, next: created };
  });
}

// Gravação simples de um patch já pronto (curtida, seguidor, anexo, bloqueio):
// mesmo caminho de carimbo + eventos + notificações.
async function writeSimple(repo, id, mutate, { by, now, extraEvents = [] } = {}) {
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    const board = await loadBoard(repo);
    const users = await usersOf(repo);
    const draft = await mutate(cur, { board, users });
    if (!draft) return { task: cur };
    let next = await stampAndPlace(repo, cur, draft, { by, now, board });
    const saved = await repo.update("tasks", id, next);
    await finishWrite(repo, cur, saved, { by, now, users, board });
    if (extraEvents.length) {
      await recordEvents(repo, saved, extraEvents, { by, now });
      await notifyEvents(repo, saved, extraEvents, { by, users, now });
    }
    return { task: saved };
  });
}

export async function addComment(repo, id, text, { by = ACTOR_API, now = nowIso() } = {}) {
  const body = String(text || "").trim();
  if (!body) throw httpError(400, "escreva o comentário antes de enviar", "comment_empty");
  if (body.length > 4000) throw httpError(400, "comentário longo demais (máx. 4000 caracteres)", "comment_too_long");
  let comment = null;
  const r = await writeSimple(repo, id, (cur, { users }) => {
    comment = normalizeComment({ text: body }, { by, now, users });
    const followers = uniq([...(cur.followers || []), ...(by !== ACTOR_API ? [by] : []), ...comment.mentions]);
    return { ...cur, comments: [...(cur.comments || []), comment], followers };
  }, { by, now });
  return r ? { comment, task: r.task } : null;
}
export async function editComment(repo, id, cid, text, { by = ACTOR_API, now = nowIso(), admin = false } = {}) {
  const body = String(text || "").trim();
  if (!body) throw httpError(400, "o comentário não pode ficar vazio", "comment_empty");
  return writeSimple(repo, id, (cur, { users }) => {
    const c = (cur.comments || []).find((x) => String(x.id) === String(cid));
    if (!c) throw httpError(404, "comentário não encontrado", "comment_not_found");
    if (!(c.author === by || by === ACTOR_API || admin)) throw httpError(403, "só quem escreveu edita o comentário", "comment_forbidden");
    if (c.text === body) return null;
    const mentions = parseMentions(body, users);
    const followers = uniq([...(cur.followers || []), ...mentions]);
    return { ...cur, followers, comments: cur.comments.map((x) => (x.id === c.id ? { ...x, text: body, editedAt: now, mentions } : x)) };
  }, { by, now });
}
export async function deleteComment(repo, id, cid, { by = ACTOR_API, now = nowIso(), admin = false } = {}) {
  return writeSimple(repo, id, (cur) => {
    const c = (cur.comments || []).find((x) => String(x.id) === String(cid));
    if (!c) throw httpError(404, "comentário não encontrado", "comment_not_found");
    if (!(c.author === by || by === ACTOR_API || admin)) throw httpError(403, "só quem escreveu apaga o comentário", "comment_forbidden");
    return { ...cur, comments: cur.comments.filter((x) => x.id !== c.id) };
  }, { by, now });
}
export async function toggleCommentLike(repo, id, cid, { by, now = nowIso() } = {}) {
  if (!by || by === ACTOR_API) throw httpError(400, "curtir exige uma sessão de usuário", "session_required");
  let liked = false, author = "";
  const r = await writeSimple(repo, id, (cur) => {
    const c = (cur.comments || []).find((x) => String(x.id) === String(cid));
    if (!c) throw httpError(404, "comentário não encontrado", "comment_not_found");
    const likes = c.likes || [];
    liked = !likes.includes(by); author = c.author;
    return { ...cur, comments: cur.comments.map((x) => (x.id === c.id ? { ...x, likes: liked ? [...likes, by] : likes.filter((u) => u !== by) } : x)) };
  }, { by, now });
  if (!r) return null;
  if (liked && author && author !== by) {
    const ev = [{ type: "comment_liked", data: { commentId: cid, author } }];
    await recordEvents(repo, r.task, ev, { by, now });
    await notifyEvents(repo, r.task, ev, { by, users: await usersOf(repo), now });
  }
  const c = (r.task.comments || []).find((x) => String(x.id) === String(cid));
  return { likes: c?.likes || [], liked, task: r.task };
}
export async function toggleLike(repo, id, { by, now = nowIso() } = {}) {
  if (!by || by === ACTOR_API) throw httpError(400, "curtir exige uma sessão de usuário", "session_required");
  let liked = false;
  const r = await writeSimple(repo, id, (cur) => {
    const likes = cur.likes || [];
    liked = !likes.includes(by);
    return { ...cur, likes: liked ? [...likes, by] : likes.filter((u) => u !== by) };
  }, { by, now });
  if (!r) return null;
  if (liked) {
    const ev = [{ type: "liked", data: {} }];
    await recordEvents(repo, r.task, ev, { by, now });
    await notifyEvents(repo, r.task, ev, { by, users: await usersOf(repo), now });
  }
  return { likes: r.task.likes || [], liked, task: r.task };
}
export async function setFollower(repo, id, user, add, { by = ACTOR_API, now = nowIso() } = {}) {
  const u = String(user || "").trim();
  if (!u) throw httpError(400, "informe a pessoa", "user_required");
  return writeSimple(repo, id, (cur) => {
    const has = (cur.followers || []).includes(u);
    if (add === has) return null;
    return { ...cur, followers: add ? [...(cur.followers || []), u] : (cur.followers || []).filter((x) => x !== u) };
  }, { by, now });
}
export async function setBlocker(repo, id, blockerId, add, { by = ACTOR_API, now = nowIso() } = {}) {
  const b = String(blockerId || "").trim();
  if (!b) throw httpError(400, "informe a tarefa que bloqueia", "blocker_required");
  if (b === String(id)) throw httpError(400, "uma tarefa não bloqueia a si mesma", "blocker_self");
  return writeSimple(repo, id, async (cur) => {
    const has = (cur.blockedBy || []).includes(b);
    if (add === has) return null;
    if (add) {
      const other = await repo.get("tasks", b);
      if (!other) throw httpError(404, "tarefa bloqueadora não encontrada", "blocker_not_found");
      if ((other.blockedBy || []).includes(String(id))) throw httpError(409, "as duas tarefas bloqueariam uma à outra", "blocker_cycle");
    }
    return { ...cur, blockedBy: add ? [...(cur.blockedBy || []), b] : (cur.blockedBy || []).filter((x) => x !== b) };
  }, { by, now });
}
export async function addAttachment(repo, id, asset, { by = ACTOR_API, now = nowIso() } = {}) {
  const a = cleanAttachment({ ...asset, by: asset?.by || by, at: asset?.at || now });
  if (!a) throw httpError(400, "anexo inválido", "attachment_invalid");
  return writeSimple(repo, id, (cur) => {
    if ((cur.attachments || []).some((x) => x.id === a.id)) return null;
    const attachments = [...(cur.attachments || []), a];
    const cover = cur.cover || (isImage(a.mime) ? a.url : "");
    return { ...cur, attachments, cover, photo: cover };
  }, { by, now });
}
export async function removeAttachment(repo, id, attachmentId, { by = ACTOR_API, now = nowIso() } = {}) {
  const aid = String(attachmentId || "");
  const r = await writeSimple(repo, id, (cur) => {
    const a = (cur.attachments || []).find((x) => x.id === aid);
    if (!a) throw httpError(404, "anexo não encontrado", "attachment_not_found");
    const cover = assetIdFromUrl(cur.cover) === aid ? "" : (cur.cover || "");
    return { ...cur, attachments: cur.attachments.filter((x) => x.id !== aid), cover, photo: cover };
  }, { by, now });
  if (r) await removeOrphanAssets(repo, [aid]);
  return r;
}
export async function setCover(repo, id, attachmentId, { by = ACTOR_API, now = nowIso() } = {}) {
  const aid = String(attachmentId || "");
  return writeSimple(repo, id, (cur) => {
    if (!aid) return cur.cover ? { ...cur, cover: "", photo: "" } : null;
    const a = (cur.attachments || []).find((x) => x.id === aid);
    if (!a) throw httpError(404, "anexo não encontrado", "attachment_not_found");
    const url = a.url;
    return cur.cover === url ? null : { ...cur, cover: url, photo: url };
  }, { by, now });
}
// Apaga do task_assets os ids que NENHUMA tarefa referencia mais (só get,
// nunca list de assets: são blobs base64, fora do cache do repo).
async function removeOrphanAssets(repo, ids) {
  const all = await repo.list("tasks");
  const used = new Set();
  for (const t of all) for (const a of assetIdsOf(t)) used.add(a);
  for (const aid of uniq(ids)) {
    if (used.has(aid)) continue;
    try { if (await repo.get("task_assets", aid)) await repo.remove("task_assets", aid); } catch { /* best-effort */ }
  }
}

export async function convertTask(repo, id, { to, parentId = "" } = {}, { by = ACTOR_API, now = nowIso() } = {}) {
  if (!["subtask", "task"].includes(to)) throw httpError(400, "converter em: subtask ou task", "convert_invalid");
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    const board = await loadBoard(repo);
    const users = await usersOf(repo);
    const all = await repo.list("tasks");
    const pid = to === "subtask" ? String(parentId || "") : "";
    if (to === "subtask" && !pid) throw httpError(400, "informe a tarefa-mãe", "parent_required");
    if (pid === (cur.parentId || "")) return { task: cur, unchanged: true };
    await assertParentOk(repo, id, pid, all);
    const parent = pid ? all.find((t) => t.id === pid) : null;
    let next = { ...cur, parentId: pid };
    if (parent) next.column = colKeyOf(parent, board);
    next.order = endOrder(siblingsOf(all, next, board));
    next = { ...next, updatedAt: now, updatedBy: by, version: (num(cur.version) || 0) + 1 };
    const saved = await repo.update("tasks", id, next);
    await finishWrite(repo, cur, saved, { by, now, users, board });
    await recordEvents(repo, saved, [{ type: "converted", data: { to, parentId: pid } }], { by, now });
    if (cur.parentId) {
      const old = all.find((t) => t.id === cur.parentId);
      if (old) await recordEvents(repo, old, [{ type: "subtask_removed", data: { child: id, title: saved.title } }], { by, now });
    }
    if (parent) {
      const ev = [{ type: "subtask_added", data: { child: id, title: saved.title } }];
      await recordEvents(repo, parent, ev, { by, now });
      await notifyEvents(repo, parent, ev, { by, users, now });
    }
    return { task: saved };
  });
}

export async function duplicateTask(repo, id, { title = "", includeSubtasks = true, includeAttachments = true } = {}, { by = ACTOR_API, now = nowIso() } = {}) {
  const cur = await repo.get("tasks", id);
  if (!cur) return null;
  const all = await repo.list("tasks");
  const clone = async (src, parentId, name) => createTask(repo, {
    title: name, description: src.description, saas: src.saas, assignees: src.assignees, labels: src.labels,
    priority: src.priority, startDate: src.startDate, dueDate: src.dueDate, recurrence: src.recurrence,
    attachments: includeAttachments ? src.attachments : [], cover: includeAttachments ? src.cover : "",
    column: src.column, parentId, duplicatedFrom: src.id, blockedBy: src.blockedBy,
  }, { by, now });
  const copy = await clone(cur, cur.parentId || "", String(title || "").trim() || `${cur.title} (cópia)`);
  if (includeSubtasks) {
    const walk = async (fromId, toId) => {
      for (const child of all.filter((t) => (t.parentId || "") === fromId).sort(byOrder)) {
        const c = await clone(child, toId, child.title);
        await walk(child.id, c.id);
      }
    };
    await walk(cur.id, copy.id);
  }
  await recordEvents(repo, cur, [{ type: "duplicated", data: { newId: copy.id } }], { by, now });
  return copy;
}
export async function followUpTask(repo, id, { title = "", dueDate = "", assignees = null } = {}, { by = ACTOR_API, now = nowIso() } = {}) {
  const cur = await repo.get("tasks", id);
  if (!cur) return null;
  const users = await usersOf(repo);
  const created = await createTask(repo, {
    title: String(title || "").trim() || `Follow-up: ${cur.title}`, saas: cur.saas,
    assignees: Array.isArray(assignees) ? assignees : cur.assignees, labels: cur.labels, priority: cur.priority,
    column: cur.column, parentId: cur.parentId || "", dueDate: dueDate || "", followUpOf: cur.id,
  }, { by, now });
  const ev = [{ type: "followup_created", data: { newId: created.id, title: created.title } }];
  await recordEvents(repo, cur, ev, { by, now });
  await notifyEvents(repo, cur, ev, { by, users, now });
  return created;
}

export async function deleteTask(repo, id, { by = ACTOR_API, now = nowIso() } = {}) {
  return withTaskLock(id, async () => {
    const cur = await repo.get("tasks", id);
    if (!cur) return null;
    const all = await repo.list("tasks");
    const victims = [cur, ...descendantsOf(all, id)];
    const victimIds = new Set(victims.map((v) => v.id));
    const keep = new Set();
    for (const t of all) if (!victimIds.has(t.id)) for (const a of assetIdsOf(t)) keep.add(a);
    for (const v of victims) {
      for (const ev of await repo.listWhere("task_events", { task: v.id }, { fields: [] })) await repo.remove("task_events", ev.id);
      for (const n of await repo.listWhere("notifications", { task: v.id }, { fields: [] })) await repo.remove("notifications", n.id);
      for (const aid of assetIdsOf(v)) if (!keep.has(aid)) { try { await repo.remove("task_assets", aid); } catch { /* best-effort */ } }
      await repo.remove("tasks", v.id);
    }
    for (const t of all) {
      if (victimIds.has(t.id) || !(t.blockedBy || []).some((b) => victimIds.has(b))) continue;
      await repo.update("tasks", t.id, { blockedBy: t.blockedBy.filter((b) => !victimIds.has(b)) }, { silent: true });
    }
    if (cur.parentId && !victimIds.has(cur.parentId)) {
      const parent = all.find((t) => t.id === cur.parentId);
      if (parent) await recordEvents(repo, parent, [{ type: "subtask_removed", data: { child: id, title: cur.title } }], { by, now });
    }
    return { removed: [...victimIds] };
  });
}

export async function activityOf(repo, id, { limit = 300 } = {}) {
  const task = await repo.get("tasks", id);
  if (!task) return null;
  const events = (await repo.listWhere("task_events", { task: id })).map((e) => ({ kind: "event", id: e.id, type: e.type, by: e.by, at: e.at, data: e.data || {} }));
  const comments = (task.comments || []).map((c) => ({ kind: "comment", ...c }));
  return [...events, ...comments].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")) || String(a.id).localeCompare(String(b.id))).slice(-Math.max(1, Math.min(2000, num(limit) || 300)));
}

// Ação em massa: cada id passa pelo mesmo caminho de uma edição normal.
export async function bulkTasks(repo, { ids = [], action = "", value = null } = {}, { by = ACTOR_API, now = nowIso() } = {}) {
  const list = uniq(strArr(ids)).slice(0, MAX_BULK);
  if (!list.length) throw httpError(400, "informe as tarefas", "ids_required");
  if (!BULK_ACTIONS.includes(action)) throw httpError(400, `ação desconhecida (${BULK_ACTIONS.join(", ")})`, "action_unknown");
  const out = { ok: [], missing: [], failed: [] };
  for (const id of list) {
    try {
      let r = null;
      const cur = await repo.get("tasks", id);
      if (!cur) { out.missing.push(id); continue; }
      const v = value;
      switch (action) {
        case "assign": r = await patchTask(repo, id, { assignees: uniq([...(cur.assignees || []), ...strArr(Array.isArray(v) ? v : [v])]) }, { by, now }); break;
        case "unassign": { const rm = strArr(Array.isArray(v) ? v : [v]); r = await patchTask(repo, id, { assignees: (cur.assignees || []).filter((u) => !rm.includes(u)) }, { by, now }); break; }
        case "due": r = await patchTask(repo, id, { dueDate: String(v ?? "") }, { by, now }); break;
        case "priority": r = await patchTask(repo, id, { priority: String(v ?? "") }, { by, now }); break;
        case "move": r = await moveTask(repo, id, { column: String(v ?? "") }, { by, now }); break;
        case "complete": r = await completeTask(repo, id, true, { by, now }); break;
        case "reopen": r = await completeTask(repo, id, false, { by, now }); break;
        case "label": r = await patchTask(repo, id, { labels: uniq([...(cur.labels || []), ...strArr(Array.isArray(v) ? v : [v])]) }, { by, now }); break;
        case "unlabel": { const rm = strArr(Array.isArray(v) ? v : [v]); r = await patchTask(repo, id, { labels: (cur.labels || []).filter((l) => !rm.includes(l)) }, { by, now }); break; }
        case "delete": r = await deleteTask(repo, id, { by, now }); break;
        default: break;
      }
      if (r === null) out.missing.push(id); else out.ok.push(id);
    } catch (err) {
      out.failed.push({ id, error: err?.message || String(err), code: err?.code || "" });
    }
  }
  return out;
}
