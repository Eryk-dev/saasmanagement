// Filtrar / ordenar / agrupar: funções puras sobre a lista de tarefas. A tela
// só compõe; nada aqui toca em estado ou rede. Datas são "YYYY-MM-DD" e o
// "hoje" é o dia de negócio (America/Sao_Paulo).
import { assigneesOf, colKeyOf, isDone, addDays, byOrder } from "../../lib/tasks.js";
import { DEFAULT_FILTERS } from "./prefs.js";

export const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Semana começa na segunda (period-picker.jsx faz igual).
export function weekRanges(today) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 = domingo
  const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
  return {
    thisWeek: { since: monday, until: addDays(monday, 6) },
    nextWeek: { since: addDays(monday, 7), until: addDays(monday, 13) },
  };
}
export function dueBucket(due, today) {
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  const { thisWeek, nextWeek } = weekRanges(today);
  if (due <= thisWeek.until) return "week";
  if (due >= nextWeek.since && due <= nextWeek.until) return "nextweek";
  return "later";
}
export const BUCKETS = [
  { key: "overdue", name: "Atrasadas" }, { key: "today", name: "Hoje" }, { key: "week", name: "Esta semana" },
  { key: "nextweek", name: "Próxima semana" }, { key: "later", name: "Depois" }, { key: "none", name: "Sem prazo" },
];

export function matchesSearch(t, qn) {
  if (!qn) return true;
  return strip(`${t.title} ${t.description || ""} ${(t.labels || []).join(" ")}`).includes(qn);
}

export function activeFilterCount(f = DEFAULT_FILTERS) {
  let n = 0;
  if (f.quick && f.quick !== "all") n++;
  for (const k of ["mine", "dueThisWeek", "dueNextWeek", "overdue", "unassigned"]) if (f[k]) n++;
  for (const k of ["assignees", "priorities", "labels", "creators", "columns"]) if (f[k]?.length) n++;
  if (f.due?.preset) n++;
  return n;
}

// `done`: "all" mostra tudo, "recent" só concluídas dos últimos 14 dias, "hidden" nenhuma.
export function applyFilters(tasks, { filters = DEFAULT_FILTERS, q = "", done = "all", today, me = "", board, saas = null, subtasksOnBoard = false, recent = new Set() } = {}) {
  const qn = strip(q.trim());
  const f = { ...DEFAULT_FILTERS, ...filters };
  const { thisWeek, nextWeek } = weekRanges(today);
  const cutoff = addDays(today, -14);
  return tasks.filter((t) => {
    if (saas != null && !(t.saas === saas || !t.saas)) return false;
    if (t.parentId && !subtasksOnBoard) return false;
    if (!matchesSearch(t, qn)) return false;
    const dn = isDone(t, board);
    if (f.quick === "open" && dn && !recent.has(t.id)) return false;
    if (f.quick === "done" && !dn) return false;
    if (f.quick === "all" && dn && !recent.has(t.id)) {
      if (done === "hidden") return false;
      if (done === "recent" && String(t.completedAt || "").slice(0, 10) < cutoff) return false;
    }
    const a = assigneesOf(t);
    if (f.mine && !(me && a.includes(me))) return false;
    if (f.unassigned && a.length) return false;
    if (f.overdue && !(t.dueDate && t.dueDate < today && !dn)) return false;
    if (f.dueThisWeek && !(t.dueDate && t.dueDate >= thisWeek.since && t.dueDate <= thisWeek.until)) return false;
    if (f.dueNextWeek && !(t.dueDate && t.dueDate >= nextWeek.since && t.dueDate <= nextWeek.until)) return false;
    if (f.assignees?.length && !f.assignees.some((u) => a.includes(u))) return false;
    if (f.priorities?.length && !f.priorities.includes(t.priority || "")) return false;
    if (f.labels?.length && !f.labels.some((l) => (t.labels || []).includes(l))) return false;
    if (f.creators?.length && !f.creators.includes(t.createdBy || "")) return false;
    if (f.columns?.length && board && !f.columns.includes(colKeyOf(t, board.columns))) return false;
    const d = f.due || {};
    if (d.preset === "none" && t.dueDate) return false;
    if (d.preset === "overdue" && !(t.dueDate && t.dueDate < today && !dn)) return false;
    if (d.preset === "today" && t.dueDate !== today) return false;
    if (d.preset === "week" && !(t.dueDate && t.dueDate >= thisWeek.since && t.dueDate <= thisWeek.until)) return false;
    if (d.preset === "nextweek" && !(t.dueDate && t.dueDate >= nextWeek.since && t.dueDate <= nextWeek.until)) return false;
    if (d.preset === "range" && !(t.dueDate && (!d.since || t.dueDate >= d.since) && (!d.until || t.dueDate <= d.until))) return false;
    return true;
  });
}

export const SORTS = [
  ["manual", "Manual (padrão)"], ["due", "Prazo"], ["priority", "Prioridade"], ["assignee", "Responsável"],
  ["created", "Data de criação"], ["updated", "Última modificação"], ["alpha", "Alfabética"], ["likes", "Curtidas"],
];
const PRI_RANK = { P0: 0, P1: 1, P2: 2, "": 3 };
export function sortTasks(tasks, sort = { key: "manual", dir: "asc" }, { usersById = new Map() } = {}) {
  const key = sort?.key || "manual";
  if (key === "manual") return [...tasks].sort(byOrder);
  const name = (t) => { const id = assigneesOf(t)[0]; return id ? strip(usersById.get(id)?.name || id) : "￿"; };
  const cmp = {
    due: (a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")),
    priority: (a, b) => (PRI_RANK[a.priority || ""] ?? 3) - (PRI_RANK[b.priority || ""] ?? 3),
    assignee: (a, b) => name(a).localeCompare(name(b)),
    created: (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
    updated: (a, b) => String(a.updatedAt || a.createdAt || "").localeCompare(String(b.updatedAt || b.createdAt || "")),
    alpha: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "pt-BR"),
    likes: (a, b) => (b.likes || []).length - (a.likes || []).length,
  }[key] || byOrder;
  const list = [...tasks].sort((a, b) => cmp(a, b) || byOrder(a, b));
  return sort?.dir === "desc" ? list.reverse() : list;
}

export const GROUPS = [["column", "Coluna (padrão)"], ["assignee", "Responsável"], ["due", "Prazo"], ["priority", "Prioridade"], ["label", "Label"]];
// Devolve as "colunas" da visão: as do quadro (group = column) ou grupos
// virtuais por campo. Cada grupo diz que patch aplicar quando um card cai nele.
export function groupTasks(tasks, group, { columns, users = [], today, doneKey = "", labelOrder = [] }) {
  if (group === "assignee") {
    const groups = users.map((u) => ({ key: u.id, name: u.name, color: "", virtual: true, tasks: [], dropPatch: () => ({ assignees: [u.id] }) }));
    const none = { key: "__none", name: "Sem responsável", color: "", virtual: true, tasks: [], dropPatch: () => ({ assignees: [] }) };
    const byKey = new Map(groups.map((g) => [g.key, g]));
    for (const t of tasks) { const g = byKey.get(assigneesOf(t)[0]) || none; g.tasks.push(t); }
    const extra = [...new Set(tasks.flatMap((t) => assigneesOf(t).slice(0, 1)))].filter((id) => !byKey.has(id) && id).map((id) => ({ key: id, name: id, color: "", virtual: true, tasks: tasks.filter((t) => assigneesOf(t)[0] === id), dropPatch: () => ({ assignees: [id] }) }));
    return [...groups, ...extra, none];
  }
  if (group === "due") {
    const { thisWeek, nextWeek } = weekRanges(today);
    const target = { overdue: null, today, week: thisWeek.until, nextweek: nextWeek.since, later: addDays(nextWeek.until, 1), none: "" };
    const groups = BUCKETS.map((b) => ({ key: b.key, name: b.name, color: "", virtual: true, tasks: [], dropPatch: target[b.key] == null ? null : () => ({ dueDate: target[b.key] }) }));
    const byKey = new Map(groups.map((g) => [g.key, g]));
    for (const t of tasks) byKey.get(dueBucket(t.dueDate, today)).tasks.push(t);
    return groups;
  }
  if (group === "priority") {
    const groups = [["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["", "Sem prioridade"]].map(([k, n]) => ({ key: k || "__none", name: n, color: "", virtual: true, tasks: [], dropPatch: () => ({ priority: k }) }));
    const byKey = new Map(groups.map((g) => [g.key, g]));
    for (const t of tasks) (byKey.get(t.priority || "__none") || byKey.get("__none")).tasks.push(t);
    return groups;
  }
  if (group === "label") {
    const names = [...new Set([...labelOrder, ...tasks.flatMap((t) => t.labels || [])])];
    const groups = names.map((l) => ({ key: `l:${l}`, name: l, color: "", virtual: true, tasks: tasks.filter((t) => (t.labels || []).includes(l)), dropPatch: (t, fromKey) => ({ labels: [...new Set([...(t.labels || []).filter((x) => `l:${x}` !== fromKey), l])] }) }));
    const none = { key: "__none", name: "Sem label", color: "", virtual: true, tasks: tasks.filter((t) => !(t.labels || []).length), dropPatch: (t, fromKey) => ({ labels: (t.labels || []).filter((x) => `l:${x}` !== fromKey) }) };
    return [...groups, none];
  }
  const groups = columns.map((c) => ({ key: c.key, name: c.name, color: c.color || "", virtual: false, tasks: [], dropPatch: null, column: c }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const t of tasks) byKey.get(colKeyOf(t, columns)).tasks.push(t);
  return groups;
}
