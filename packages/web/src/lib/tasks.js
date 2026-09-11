// Régua única das tarefas no SPA: o que é "concluída", como ler prazo, ordem
// dentro da coluna e a fila pessoal. Tela de Tarefas, Meu dia e o widget de
// feedback leem daqui (antes cada um tinha a própria regex de "Concluído").
import { bizDay } from "./format.js";

export const DEFAULT_COLUMNS = [
  { key: "todo", name: "A fazer", color: "" },
  { key: "doing", name: "Em andamento", color: "" },
  { key: "done", name: "Concluído", color: "" },
];
export const COLUMN_COLORS = [
  "", "oklch(0.62 0.13 240)", "oklch(0.58 0.15 277)", "oklch(0.62 0.13 165)",
  "oklch(0.70 0.13 85)", "oklch(0.64 0.16 25)", "oklch(0.66 0.14 330)",
];
export const PRIORITIES = [["", "Sem prioridade"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"]];
export const priTone = (p) => (p === "P0" ? "var(--neg)" : p === "P1" ? "var(--warn)" : p === "P2" ? "var(--info)" : "var(--fg-4)");
export const priSoft = (p) => (p === "P0" ? "var(--neg-soft)" : p === "P1" ? "var(--warn-soft)" : p === "P2" ? "var(--info-soft)" : "var(--bg-2)");

// Compat: tarefas de antes do multi-responsável têm `assignee` string.
export const assigneesOf = (t) => (Array.isArray(t?.assignees) ? t.assignees : (t?.assignee ? [t.assignee] : []));
export const columnsOf = (board) => (board?.columns?.length ? board.columns : DEFAULT_COLUMNS);
// Key desconhecida cai na primeira coluna (mesma régua do servidor).
export const colKeyOf = (t, columns) => (columns.some((c) => c.key === t.column) ? t.column : columns[0].key);
// Coluna de concluído: o campo do board manda; board antigo sem o campo usa a
// regra de antes (key "done" ou nome com "conclu"); sem board = "done".
export function doneKeyOf(board) {
  const cols = columnsOf(board);
  if (board && board.doneKey !== undefined) return cols.some((c) => c.key === board.doneKey) ? board.doneKey : "";
  return (cols.find((c) => c.key === "done" || /conclu/i.test(c.name || "")) || {}).key || "";
}
export function isDone(t, board) {
  if (t?.completed === true) return true;
  if (t?.completed === false) return false;
  const k = doneKeyOf(board);
  return !!k && t?.column === k;
}
export const todayYmd = () => bizDay(new Date());
const ymdToUtc = (ymd) => { const [y, m, d] = String(ymd).split("-").map(Number); return Date.UTC(y, m - 1, d, 12); };
export const addDays = (ymd, n) => new Date(ymdToUtc(ymd) + n * 86400000).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000);
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtDue(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return String(ymd || "");
  const [y, m, d] = ymd.split("-").map(Number);
  const thisYear = Number(todayYmd().slice(0, 4)) === y;
  return `${d} ${MONTHS[m - 1]}${thisYear ? "" : ` ${y}`}`;
}
// Como o card fala do prazo: Hoje / Amanhã / dia da semana (até 6 dias) / dd mmm.
// Atrasada em vermelho, hoje em âmbar; concluída fica neutra.
export function dueState(due, { completed = false, today = todayYmd() } = {}) {
  if (!due) return null;
  const diff = diffDays(today, due);
  let label = fmtDue(due);
  if (diff === 0) label = "Hoje";
  else if (diff === 1) label = "Amanhã";
  else if (diff === -1) label = "Ontem";
  else if (diff > 1 && diff < 7) label = WEEKDAYS[new Date(ymdToUtc(due)).getUTCDay()];
  const tone = completed ? "var(--fg-4)" : diff < 0 ? "var(--neg)" : diff === 0 ? "var(--warn)" : "var(--fg-3)";
  return { label, tone, overdue: !completed && diff < 0, today: diff === 0, diff };
}
export const byOrder = (a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id));
// Fila pessoal: abertas, do quadro (sem subtarefa), do produto (ou geral), da
// pessoa ou sem responsável; vencidas primeiro, depois prioridade.
export function myOpenTasks(tasks, board, { person = "", saas = null } = {}) {
  return (tasks || [])
    .filter((t) => !isDone(t, board) && !t.parentId && (saas == null || t.saas === saas || !t.saas))
    .filter((t) => { const a = assigneesOf(t); return !a.length || !person || a.includes(person); })
    .sort((a, b) => String(a.dueDate || "9999-99-99").localeCompare(String(b.dueDate || "9999-99-99")) || String(a.priority || "P9").localeCompare(String(b.priority || "P9")));
}
export const taskHash = (id) => `#tasks/${id}`;
export const taskUrl = (id) => (typeof location === "undefined" ? taskHash(id) : `${location.origin}${location.pathname}${taskHash(id)}`);
export const dueDateSubtasksCount = (tasks, id) => {
  const subs = (tasks || []).filter((t) => t.parentId === id);
  return { total: subs.length, done: subs.filter((s) => s.completed).length };
};
