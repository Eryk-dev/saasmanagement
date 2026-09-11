// Preferências da tela de Tarefas por pessoa e workspace (localStorage):
// visão, colunas recolhidas, ocultar vazias, campos do card, filtros, ordem.
export const DEFAULT_FIELDS = { assignee: true, due: true, priority: true, labels: true, subtasks: true, comments: true, attachments: true, cover: true };
export const DEFAULT_FILTERS = { quick: "all", mine: false, dueThisWeek: false, dueNextWeek: false, overdue: false, unassigned: false, assignees: [], due: { preset: "", since: "", until: "" }, priorities: [], labels: [], creators: [], columns: [] };
export const DEFAULT_PREFS = {
  view: "board",
  collapsed: {},            // { [colKey]: true }
  hideEmpty: false,
  compact: false,
  fields: DEFAULT_FIELDS,
  done: "all",              // all | recent | hidden
  subtasksOnBoard: false,
  sort: { key: "manual", dir: "asc" },
  group: "column",
  filters: DEFAULT_FILTERS,
};
const key = (userId, saasId) => `cockpit_tasks_prefs:${userId || "key"}:${saasId || "all"}`;
export function loadPrefs(userId, saasId) {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key(userId, saasId)) : null;
    const saved = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_PREFS, ...saved,
      fields: { ...DEFAULT_FIELDS, ...(saved.fields || {}) },
      sort: { ...DEFAULT_PREFS.sort, ...(saved.sort || {}) },
      filters: { ...DEFAULT_FILTERS, ...(saved.filters || {}), due: { ...DEFAULT_FILTERS.due, ...(saved.filters?.due || {}) } },
      collapsed: saved.collapsed && typeof saved.collapsed === "object" ? saved.collapsed : {},
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
let timer = null;
export function savePrefs(userId, saasId, prefs) {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(key(userId, saasId), JSON.stringify(prefs)); } catch { /* storage cheio ou bloqueado */ } }, 200);
}
