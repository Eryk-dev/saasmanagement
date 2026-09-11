import React from "react";
import { api } from "../../lib/api.js";
import { useData } from "../../data.jsx";
import { EmptyState, PrimaryButton, toast, useEsc } from "../../atoms.jsx";
import { PageHead } from "../../components/viz.jsx";
import { Menu } from "../../components/menu.jsx";
import { DateQuick } from "../../components/date-quick.jsx";
import { UserPicker } from "../../components/user-picker.jsx";
import { Popover } from "../../components/popover.jsx";
import { ErrorBoundary } from "../../components/error-boundary.jsx";
import { useActiveSaas, setActiveSaas } from "../../lib/workspace.js";
import { allUsers, currentUser } from "../../lib/users.js";
import { useIsMobile } from "../../lib/responsive.js";
import { columnsOf, doneKeyOf, colKeyOf, byOrder, assigneesOf, taskUrl, fmtDue, todayYmd } from "../../lib/tasks.js";
import { useTasksStore } from "./store.js";
import { useBoardDnd } from "./dnd.js";
import { loadPrefs, savePrefs, DEFAULT_FILTERS } from "./prefs.js";
import { parseTaskHash, openTaskHash, clearTaskHash, useTaskHash } from "./hash.js";
import { applyFilters, sortTasks, groupTasks, strip } from "./filters.js";
import { taskMenuItems } from "./context-menu.jsx";
import { Board } from "./board.jsx";
import { TaskPanel } from "./drawer.jsx";
import { Toolbar, ActiveFiltersStrip } from "./toolbar.jsx";
import { BulkBar } from "./bulk-bar.jsx";
import { useShortcuts } from "./shortcuts.js";
import { ShortcutsHelp } from "./help.jsx";

// Tarefas · quadro do time no nível do Asana. Cards = collection `tasks`;
// colunas = 1 registro em `task_boards`. Tudo que escreve passa pelo servidor
// (tasks-core.js): ordem, regras de coluna, carimbos, atividade e avisos.
// Aqui: mutação otimista com desfazer, tempo real por cockpit-change, painel
// ancorado (o quadro continua clicável), deep link #tasks/<id>, filtrar /
// ordenar / agrupar sem mexer nos dados, seleção múltipla e atalhos.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const midpoint = (list, index) => {
  const prev = index > 0 ? Number(list[index - 1].order) || 0 : null;
  const next = index < list.length ? Number(list[index].order) || 0 : null;
  if (prev == null && next == null) return 1;
  if (prev == null) return next - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
};
const newColumnKey = () => `c_${Date.now().toString(36)}`;
const rectOf = (id) => document.querySelector(`[data-task="${CSS.escape(id)}"]`)?.getBoundingClientRect() || null;

export function TasksScreen() {
  const { version, openDelete } = useData();
  const [activeProduct] = useActiveSaas();
  const saasId = activeProduct?.id || "";
  const isMobile = useIsMobile();
  const me = currentUser()?.id || "";
  const users = useMemo(() => allUsers().filter((u) => !u.saas || u.saas === saasId), [saasId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const { state, dispatch, mutate, inflight, undoLast } = useTasksStore();
  const { tasks, board } = state;
  const today = todayYmd();

  // ── Preferências (por pessoa e workspace) ───────────────────────────────
  const [prefs, setPrefsState] = useState(() => loadPrefs(me, saasId));
  useEffect(() => { setPrefsState(loadPrefs(me, saasId)); }, [me, saasId]);
  const setPrefs = useCallback((patch) => setPrefsState((p) => { const n = typeof patch === "function" ? patch(p) : { ...p, ...patch }; savePrefs(me, saasId, n); return n; }), [me, saasId]);

  // ── UI ───────────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [composer, setComposer] = useState(null);       // { colKey, position }
  const [focusId, setFocusId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [menu, setMenu] = useState(null);               // { id, at }
  const [duePick, setDuePick] = useState(null);         // { id, at }
  const [assignPick, setAssignPick] = useState(null);   // { id, at }
  const [blockerPick, setBlockerPick] = useState(null); // { id, at }
  const [convertPick, setConvertPick] = useState(null); // { id, at }
  const [panelId, setPanelId] = useState(() => parseTaskHash());
  const [stack, setStack] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [focusHint, setFocusHint] = useState("");
  const [activityVersion, setActivityVersion] = useState(0);
  const [selection, setSelection] = useState(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [help, setHelp] = useState(false);
  const [hint, setHint] = useState("");
  const [recentTick, setRecentTick] = useState(0);
  const recent = useRef(new Map()); // id -> timeout (card concluído fica 1,2s no lugar)
  const lastClick = useRef(null);
  const boardRef = useRef(null);
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const lastPointer = useRef({ x: 80, y: 120 });
  useEffect(() => {
    const on = (e) => { lastPointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", on, true);
    return () => window.removeEventListener("pointerdown", on, true);
  }, []);
  const pointAnchor = (at) => ({ left: at.x, top: at.y, right: at.x, bottom: at.y });

  // ── Carga + tempo real ───────────────────────────────────────────────────
  const dndRef = useRef(null);
  const queued = useRef(false);
  const refetch = useCallback(async () => {
    if (dndRef.current?.dragRef.current || inflight.current.size) { queued.current = true; return; }
    try {
      const [ts, boards] = await Promise.all([api.list("tasks"), api.list("task_boards")]);
      dispatch({ type: "RECONCILE", tasks: ts || [], board: (boards || [])[0] || null, keep: new Set(inflight.current) });
    } catch (err) {
      if (!state.loaded) dispatch({ type: "ERROR", error: err.message || "erro" });
      else toast("Não deu pra atualizar as tarefas · tente de novo", "neg");
    }
  }, [dispatch, inflight]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refetch(); }, [refetch, version]);
  useEffect(() => {
    let t = 0;
    const on = (e) => {
      const c = e.detail?.collection;
      if (!["tasks", "task_boards", "task_events"].includes(c)) return;
      clearTimeout(t);
      t = setTimeout(() => { if (c !== "task_events") refetch(); else setActivityVersion((v) => v + 1); }, 500);
    };
    window.addEventListener("cockpit-change", on);
    const iv = setInterval(() => { if (queued.current && !dndRef.current?.dragRef.current && !inflight.current.size) { queued.current = false; refetch(); } }, 800);
    return () => { clearTimeout(t); clearInterval(iv); window.removeEventListener("cockpit-change", on); };
  }, [refetch, inflight]);

  // ── Derivados ────────────────────────────────────────────────────────────
  const columns = useMemo(() => columnsOf(board), [board]);
  const doneKey = doneKeyOf(board);
  const labelColors = useMemo(() => new Map((board?.labels || []).map((l) => [l.name, l.color || ""])), [board]);
  const labelOptions = useMemo(() => {
    const set = new Set((board?.labels || []).map((l) => l.name));
    for (const t of tasks) for (const l of t.labels || []) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [board, tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const subCounts = useMemo(() => {
    const m = new Map();
    for (const t of tasks) if (t.parentId) { const c = m.get(t.parentId) || { done: 0, total: 0 }; c.total++; if (t.completed) c.done++; m.set(t.parentId, c); }
    return m;
  }, [tasks]);
  const blockedIds = useMemo(() => new Set(tasks.filter((t) => (t.blockedBy || []).some((b) => byId.get(b) && !byId.get(b).completed)).map((t) => t.id)), [tasks, byId]);
  const inWorkspace = useCallback((t) => t.saas === saasId || !t.saas, [saasId]);
  const boardForDone = useMemo(() => ({ columns, doneKey }), [columns, doneKey]);
  const filtered = useMemo(() => applyFilters(tasks, { filters: prefs.filters, q, done: prefs.done, today, me, board: boardForDone, saas: saasId, subtasksOnBoard: !!prefs.subtasksOnBoard, recent: new Set(recent.current.keys()) }),
    [tasks, prefs.filters, prefs.done, prefs.subtasksOnBoard, q, today, me, boardForDone, saasId, recentTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupTasks(filtered, prefs.group || "column", { columns, users, today, doneKey, labelOrder: labelOptions })
    .map((g) => ({ ...g, tasks: sortTasks(g.tasks, prefs.sort, { usersById }) })), [filtered, prefs.group, prefs.sort, columns, users, today, doneKey, labelOptions, usersById]);
  const groupsRef = useRef(groups); groupsRef.current = groups;
  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);
  const hiddenByColumn = useMemo(() => {
    if ((prefs.group || "column") !== "column") return {};
    const shownIds = new Set(filtered.map((t) => t.id));
    const m = {};
    for (const t of tasks) if (inWorkspace(t) && !t.parentId && !shownIds.has(t.id)) { const k = colKeyOf(t, columns); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [tasks, filtered, columns, prefs.group, inWorkspace]);
  const totalInWorkspace = useMemo(() => tasks.filter((t) => inWorkspace(t) && !t.parentId).length, [tasks, inWorkspace]);
  const sortManual = !prefs.sort?.key || prefs.sort.key === "manual";
  const grouped = (prefs.group || "column") !== "column";

  // ── Painel (deep link) ───────────────────────────────────────────────────
  useTaskHash((id) => { setPanelId(id); if (!id) { setStack([]); setFocusHint(""); } });
  const panelTask = panelId ? byId.get(panelId) : null;
  useEffect(() => {
    if (!panelId || !state.loaded) return;
    const t = byId.get(panelId);
    if (!t) { toast("Tarefa não encontrada", "warn"); clearTaskHash(); setPanelId(null); return; }
    if (t.saas && t.saas !== saasId) setActiveSaas(t.saas);
  }, [panelId, state.loaded, byId, saasId]);
  const openPanel = useCallback((id, { push = false, hint = "" } = {}) => {
    setPanelId((cur) => { if (push && cur && cur !== id) setStack((s) => [...s, cur]); return id; });
    setFocusHint(hint);
    openTaskHash(id);
  }, []);
  const closePanel = useCallback(() => { clearTaskHash(); setPanelId(null); setStack([]); setFocusHint(""); }, []);
  const backPanel = useCallback(() => {
    setStack((s) => { const prev = s[s.length - 1]; if (prev) { openTaskHash(prev); setPanelId(prev); } return s.slice(0, -1); });
  }, []);

  // ── Board ────────────────────────────────────────────────────────────────
  const saveBoard = useCallback((patch, label = "") => {
    const before = board;
    return mutate({
      label, silent: !label, ids: ["__board__"],
      optimistic: () => dispatch({ type: "BOARD", board: { ...(board || { name: "Tarefas", columns: columnsOf(board), doneKey: doneKeyOf(board), labels: [] }), ...patch } }),
      request: () => (board?.id ? api.update("task_boards", board.id, patch) : api.create("task_boards", { columns: columnsOf(board), doneKey: doneKeyOf(board), ...patch })),
      apply: (saved) => dispatch({ type: "BOARD", board: saved }),
      rollback: () => dispatch({ type: "BOARD", board: before }),
    });
  }, [board, dispatch, mutate]);

  // ── Seleção ──────────────────────────────────────────────────────────────
  const visibleIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups]);
  const select = (ids, on) => setSelection((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const clearSelection = useCallback(() => { setSelection(new Set()); setSelectMode(false); }, []);
  useEffect(() => { setSelection((s) => { const n = new Set([...s].filter((id) => byId.has(id))); return n.size === s.size ? s : n; }); }, [byId]);

  // ── Ações (objeto estável: os cards são memoizados) ──────────────────────
  const A = useRef({}); // sempre o closure mais novo
  A.current = {
    activeSaas: () => saasId,
    open: (id, opts) => openPanel(id, opts),
    click: (id, e) => {
      if (e?.shiftKey && lastClick.current) {
        const g = groupsRef.current.find((x) => x.tasks.some((t) => t.id === id));
        const ids = g ? g.tasks.map((t) => t.id) : [];
        const a = ids.indexOf(lastClick.current), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) { select(ids.slice(Math.min(a, b), Math.max(a, b) + 1), true); return; }
      }
      if (e?.metaKey || e?.ctrlKey || selectMode) { select([id], !selection.has(id)); lastClick.current = id; setFocusId(id); return; }
      lastClick.current = id;
      openPanel(id);
    },
    focus: (id) => setFocusId(id),
    menu: (id, at) => setMenu({ id, at }),
    rename: (id) => setRenamingId(id),
    renameSave: (id, value) => {
      setRenamingId(null);
      if (value == null) return;
      const v = value.trim(); const t = byId.get(id);
      if (!t || !v || v === t.title) return;
      A.current.patch(id, { title: v }, { label: "" });
    },
    patch: (id, patch, { label = "", undo = null, silent = true } = {}) => {
      const t = byId.get(id); if (!t) return Promise.resolve(null);
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k]]));
      return mutate({
        label, silent, ids: [id],
        optimistic: () => dispatch({ type: "PATCH_LOCAL", id, patch }),
        request: () => api.update("tasks", id, patch),
        apply: (saved) => dispatch({ type: "UPSERT", task: saved }),
        rollback: () => dispatch({ type: "PATCH_LOCAL", id, patch: before }),
        undo: undo === true ? () => A.current.patch(id, before, { label: "" }) : undo,
      });
    },
    create: async (groupKey, title, position = "bottom") => {
      const g = groupByKey.get(groupKey);
      const list = g ? g.tasks : [];
      const colKey = g && !g.virtual ? groupKey : columns[0].key;
      const extra = g?.virtual && g.dropPatch ? (g.dropPatch({ labels: [], assignees: [] }, "") || {}) : {};
      const order = position === "top" ? (list.length ? (Number(list[0].order) || 0) - 1 : 1) : (list.length ? (Number(list[list.length - 1].order) || 0) + 1 : 1);
      const tmpId = `tmp_${Date.now().toString(36)}`;
      const draft = { id: tmpId, title, description: "", saas: saasId, assignees: [], column: colKey, priority: "", dueDate: "", labels: [], comments: [], order, completed: colKey === doneKey, ...extra, _pending: true, createdAt: new Date().toISOString() };
      const r = await mutate({
        ids: [tmpId],
        optimistic: () => dispatch({ type: "UPSERT", task: draft }),
        request: () => api.create("tasks", { title, saas: saasId, column: colKey, order, ...extra }),
        apply: (saved) => dispatch({ type: "REPLACE", id: tmpId, task: saved }),
        rollback: () => dispatch({ type: "REMOVE", ids: [tmpId] }),
        label: "A tarefa", silent: true,
      });
      return !!r;
    },
    createSubtask: async (parentId, title) => {
      const r = await mutate({ ids: [parentId], label: "A subtarefa", silent: true, request: () => api.taskSubtask(parentId, { title }), apply: (saved) => dispatch({ type: "UPSERT", task: saved }) });
      return !!r;
    },
    complete: (id, value = true, { isUndo = false } = {}) => {
      const t = byId.get(id); if (!t) return Promise.resolve(null);
      const before = { completed: !!t.completed, completedAt: t.completedAt || "", column: t.column, order: t.order, completedFrom: t.completedFrom || "" };
      if (value) { clearTimeout(recent.current.get(id)); recent.current.set(id, setTimeout(() => { recent.current.delete(id); setRecentTick((n) => n + 1); }, 1200)); setRecentTick((n) => n + 1); }
      return mutate({
        label: value ? "Tarefa concluída" : "Tarefa reaberta", ids: [id],
        optimistic: () => dispatch({ type: "PATCH_LOCAL", id, patch: { completed: value, completedAt: value ? new Date().toISOString() : "" } }),
        request: () => api.taskComplete(id, value),
        apply: (r) => {
          // dá tempo do ✓ animar antes do card trocar de coluna
          setTimeout(() => {
            dispatch({ type: "UPSERT", task: r.task });
            if (r.next) { dispatch({ type: "UPSERT", task: r.next }); toast(`Próxima ocorrência criada para ${fmtDue(r.next.dueDate)}`, "pos"); }
          }, value ? 650 : 0);
        },
        rollback: () => dispatch({ type: "PATCH_LOCAL", id, patch: before }),
        undo: isUndo ? null : () => A.current.complete(id, !value, { isUndo: true }),
      });
    },
    // Soltar num grupo virtual (responsável, prazo, prioridade, label) = mudar o campo.
    groupDrop: ({ ids, fromKey, toKey }) => {
      const g = groupByKey.get(toKey); if (!g) return;
      if (!g.dropPatch) { toast("Não dá pra soltar aqui: mude o prazo pelo card", "warn"); return; }
      for (const id of ids) {
        const t = byId.get(id); if (!t) continue;
        const patch = g.dropPatch(t, fromKey);
        if (patch) A.current.patch(id, patch, { label: `Movida para ${g.name}`, undo: true, silent: ids.length > 1 });
      }
      if (ids.length > 1) toast(`${ids.length} tarefas movidas para ${g.name}`, "pos");
      clearSelection();
    },
    moveCards: ({ ids, fromKey, toKey, beforeId = "", afterId = "" }) => {
      if (grouped) return A.current.groupDrop({ ids, fromKey, toKey });
      const list = (groupByKey.get(toKey)?.tasks || []).filter((t) => !ids.includes(t.id));
      let index = beforeId ? list.findIndex((t) => t.id === beforeId) : afterId ? list.findIndex((t) => t.id === afterId) + 1 : list.length;
      if (index < 0) index = list.length;
      const snapshot = ids.map((id) => { const t = byId.get(id); return t ? { id, column: t.column, order: t.order, completed: !!t.completed, completedFrom: t.completedFrom || "" } : null; }).filter(Boolean);
      const orders = ids.map((id, i) => midpoint([...list.slice(0, index), ...ids.slice(0, i).map(() => ({ order: 0 })), ...list.slice(index)], index + i));
      let prevId = afterId;
      const r = mutate({
        label: ids.length > 1 ? `${ids.length} tarefas movidas` : (toKey !== fromKey ? `Movida para ${columns.find((c) => c.key === toKey)?.name || "coluna"}` : ""), ids,
        optimistic: () => ids.forEach((id, i) => dispatch({ type: "PATCH_LOCAL", id, patch: { column: toKey, order: orders[i], ...(toKey === doneKey && doneKey ? { completed: true } : (fromKey === doneKey && toKey !== doneKey ? { completed: false } : {})) } })),
        request: async () => {
          const out = [];
          for (const id of ids) {
            const body = { column: toKey, ...(prevId ? { afterId: prevId } : (beforeId ? { beforeId } : {})) };
            const res = await api.taskMove(id, body);
            out.push(res); prevId = id;
          }
          return out;
        },
        apply: (rs) => rs.forEach((res) => { dispatch({ type: "UPSERT", task: res.task }); if (res.next) dispatch({ type: "UPSERT", task: res.next }); }),
        rollback: () => snapshot.forEach((s) => dispatch({ type: "PATCH_LOCAL", id: s.id, patch: { column: s.column, order: s.order, completed: s.completed, completedFrom: s.completedFrom } })),
        undo: () => A.current.moveCards({ ids, fromKey: toKey, toKey: fromKey }),
      });
      if (ids.length > 1) clearSelection();
      return r;
    },
    move: (id, colKey) => { const t = byId.get(id); if (t && colKeyOf(t, columns) !== colKey) A.current.moveCards({ ids: [id], fromKey: colKeyOf(t, columns), toKey: colKey }); },
    setDue: (id, ymd) => A.current.patch(id, { dueDate: ymd }, { label: ymd ? `Prazo: ${fmtDue(ymd)}` : "Prazo removido", undo: true, silent: false }),
    pickDue: (id, at) => setDuePick({ id, at: at || pointAnchor(lastPointer.current) }),
    pickAssignee: (id, at) => setAssignPick({ id, at: at || pointAnchor(lastPointer.current) }),
    assignMe: (id) => {
      const t = byId.get(id); if (!t || !me) return;
      const cur = assigneesOf(t); const on = cur.includes(me);
      A.current.patch(id, { assignees: on ? cur.filter((x) => x !== me) : [...cur, me] }, { label: on ? "Você saiu da tarefa" : "Tarefa atribuída a você", undo: true, silent: false });
    },
    duplicate: async (id) => {
      const copy = await mutate({ ids: [id], label: "Tarefa duplicada", request: () => api.taskDuplicate(id), apply: (c) => dispatch({ type: "UPSERT", task: c }) });
      if (copy?.id) { refetch(); openPanel(copy.id); }
    },
    followUp: async (id) => {
      const created = await mutate({ ids: [id], label: "Tarefa de acompanhamento criada", request: () => api.taskFollowUp(id), apply: (c) => dispatch({ type: "UPSERT", task: c }) });
      if (created?.id) openPanel(created.id);
    },
    subtask: (id) => openPanel(id, { hint: "subtask" }),
    convert: (id, { to }) => {
      if (to === "task") mutate({ ids: [id], label: "Convertida em tarefa do quadro", request: () => api.taskConvert(id, { to: "task" }), apply: (t) => dispatch({ type: "UPSERT", task: t }) });
      else setConvertPick({ id, at: pointAnchor(lastPointer.current) });
    },
    pickBlocker: (id) => setBlockerPick({ id, at: pointAnchor(lastPointer.current) }),
    unblock: (id, blockerId) => mutate({ ids: [id], label: "Bloqueio removido", request: () => api.taskUnblock(id, blockerId), apply: (t) => dispatch({ type: "UPSERT", task: t }) }),
    copyLink: async (id) => {
      try { await navigator.clipboard.writeText(taskUrl(id)); toast("Link copiado", "pos"); }
      catch { toast(taskUrl(id), "neutral", 8000); }
    },
    remove: (id) => { const t = byId.get(id); if (!t) return; if (panelId === id) closePanel(); openDelete("tasks", t); },
    // Ação em massa na seleção (rota /bulk); desfazer devolve cada uma ao que era.
    bulk: async (action, value) => {
      const ids = [...selection].filter((id) => byId.has(id));
      if (!ids.length) return;
      const snap = ids.map((id) => { const t = byId.get(id); return { id, assignees: assigneesOf(t), dueDate: t.dueDate || "", priority: t.priority || "", column: t.column, completed: !!t.completed }; });
      const labels = { assign: "Responsável definido", unassign: "Responsáveis removidos", due: value ? `Prazo: ${fmtDue(value)}` : "Prazo removido", priority: value ? `Prioridade ${value}` : "Prioridade removida", move: `Movidas para ${columns.find((c) => c.key === value)?.name || "coluna"}`, complete: "Tarefas concluídas", reopen: "Tarefas reabertas", delete: "Tarefas excluídas" };
      const local = { assign: () => ({ assignees: [value] }), unassign: () => ({ assignees: [] }), due: () => ({ dueDate: value }), priority: () => ({ priority: value }), move: () => ({ column: value, ...(value === doneKey ? { completed: true } : {}) }), complete: () => ({ completed: true }), reopen: () => ({ completed: false }) }[action];
      const restore = async () => {
        for (const s of snap) {
          if (action === "assign" || action === "unassign") await api.update("tasks", s.id, { assignees: s.assignees });
          else if (action === "due") await api.update("tasks", s.id, { dueDate: s.dueDate });
          else if (action === "priority") await api.update("tasks", s.id, { priority: s.priority });
          else if (action === "move") await api.taskMove(s.id, { column: s.column });
          else if (action === "complete" || action === "reopen") await api.taskComplete(s.id, s.completed);
        }
        refetch();
      };
      const r = await mutate({
        label: `${labels[action] || "Ação"} (${ids.length})`, ids,
        optimistic: () => { if (local) dispatch({ type: "PATCH_MANY", ids, patch: local() }); if (action === "delete") dispatch({ type: "REMOVE", ids }); },
        request: () => api.tasksBulk(ids, action === "assign" && !value ? "unassign" : action, action === "assign" ? [value] : value),
        apply: (res) => { if (res?.failed?.length) toast(`${res.failed.length} não foram alteradas`, "warn"); refetch(); },
        rollback: () => refetch(),
        undo: action === "delete" ? null : () => mutate({ ids, request: restore, silent: true }),
      });
      clearSelection();
      return r;
    },
  };
  const actions = useMemo(() => {
    const names = ["activeSaas", "open", "click", "focus", "menu", "rename", "renameSave", "patch", "create", "createSubtask", "complete", "groupDrop", "moveCards", "move", "setDue", "pickDue", "pickAssignee", "assignMe", "duplicate", "followUp", "subtask", "convert", "pickBlocker", "unblock", "copyLink", "remove", "bulk"];
    return Object.fromEntries(names.map((n) => [n, (...args) => A.current[n](...args)]));
  }, []);

  const colActions = useMemo(() => ({
    rename: (key, name) => saveBoard({ columns: columnsOf(board).map((c) => (c.key === key ? { ...c, name } : c)) }),
    add: (index) => { const cols = columnsOf(board); const next = [...cols]; next.splice(index, 0, { key: newColumnKey(), name: "Nova coluna", color: "" }); saveBoard({ columns: next }); },
    shift: (key, dir) => { const cols = [...columnsOf(board)]; const i = cols.findIndex((c) => c.key === key); const j = i + dir; if (i < 0 || j < 0 || j >= cols.length) return; [cols[i], cols[j]] = [cols[j], cols[i]]; saveBoard({ columns: cols }); },
    color: (key, color) => saveBoard({ columns: columnsOf(board).map((c) => (c.key === key ? { ...c, color } : c)) }),
    setDone: (key) => saveBoard({ doneKey: key }, key ? "Coluna de concluído definida" : "Nenhuma coluna conclui automaticamente"),
    remove: (key, name, n) => {
      if (!window.confirm(`Excluir a coluna "${name}"?${n ? ` ${n} card(s) vão para a primeira coluna.` : ""}`)) return;
      saveBoard({ columns: columnsOf(board).filter((c) => c.key !== key) }, "Coluna excluída");
    },
    collapse: (key, on) => setPrefs((p) => ({ ...p, collapsed: { ...p.collapsed, [key]: !!on } })),
    toggleHideEmpty: () => setPrefs((p) => ({ ...p, hideEmpty: !p.hideEmpty })),
    ungroup: () => setPrefs((p) => ({ ...p, group: "column" })),
    composer: (colKey, position = "bottom") => setComposer(colKey ? { colKey, position } : null),
  }), [board, saveBoard, setPrefs]);

  // ── Arrastar e soltar ────────────────────────────────────────────────────
  const selRef = useRef(selection); selRef.current = selection;
  const dnd = useBoardDnd({ boardRef, onDrop: (p) => A.current.moveCards(p), getSelection: () => selRef.current });
  dndRef.current = dnd;

  // ── Teclado ──────────────────────────────────────────────────────────────
  const focusCard = (id) => {
    setFocusId(id);
    const el = document.querySelector(`[data-task="${CSS.escape(id)}"]`);
    if (el) { el.scrollIntoView({ block: "nearest", inline: "nearest" }); el.focus({ preventScroll: true }); }
  };
  useShortcuts({
    rootRef,
    get: () => ({ focusId, selectionSize: selection.size }),
    actions: {
      moveFocus: (key) => {
        const gs = groupsRef.current.filter((g) => g.tasks.length && !prefs.collapsed[g.key]);
        if (!gs.length) return;
        let gi = gs.findIndex((g) => g.tasks.some((t) => t.id === focusId));
        if (gi < 0) { focusCard(gs[0].tasks[0].id); return; }
        let ti = gs[gi].tasks.findIndex((t) => t.id === focusId);
        if (key === "ArrowDown") ti = Math.min(gs[gi].tasks.length - 1, ti + 1);
        else if (key === "ArrowUp") ti = Math.max(0, ti - 1);
        else if (key === "ArrowRight" && gi < gs.length - 1) { gi++; ti = Math.min(ti, gs[gi].tasks.length - 1); }
        else if (key === "ArrowLeft" && gi > 0) { gi--; ti = Math.min(ti, gs[gi].tasks.length - 1); }
        focusCard(gs[gi].tasks[ti].id);
      },
      open: (id) => openPanel(id),
      compose: (id) => { const g = groupsRef.current.find((x) => x.tasks.some((t) => t.id === id)) || groupsRef.current[0]; if (g) { setPrefs((p) => ({ ...p, collapsed: { ...p.collapsed, [g.key]: false } })); setComposer({ colKey: g.key, position: "top" }); } },
      search: () => searchRef.current?.focus(),
      help: () => setHelp(true),
      remove: () => { if (selection.size > 1) A.current.bulkDelete(); else if (focusId) A.current.remove(focusId); },
      menu: (id) => { const r = rectOf(id); setMenu({ id, at: r ? { x: r.left + 24, y: r.top + 24 } : pointAnchor(lastPointer.current) }); },
      undo: () => undoLast(),
      completeFocused: () => { if (selection.size > 1) A.current.bulk("complete"); else if (focusId) { const t = byId.get(focusId); if (t) A.current.complete(focusId, !t.completed); } },
      nudge: (key) => {
        if (!focusId) return;
        const gs = groupsRef.current;
        const gi = gs.findIndex((g) => g.tasks.some((t) => t.id === focusId)); if (gi < 0) return;
        if (key === "ArrowLeft" || key === "ArrowRight") { const j = gi + (key === "ArrowLeft" ? -1 : 1); if (j < 0 || j >= gs.length) return; A.current.moveCards({ ids: [focusId], fromKey: gs[gi].key, toKey: gs[j].key }); return; }
        if (!sortManual || grouped) return;
        const list = gs[gi].tasks; const ti = list.findIndex((t) => t.id === focusId);
        if (key === "ArrowUp" && ti > 0) A.current.moveCards({ ids: [focusId], fromKey: gs[gi].key, toKey: gs[gi].key, beforeId: list[ti - 1].id });
        if (key === "ArrowDown" && ti < list.length - 1) A.current.moveCards({ ids: [focusId], fromKey: gs[gi].key, toKey: gs[gi].key, afterId: list[ti + 1].id });
      },
      hint: (t) => setHint(t),
      assignMe: (id) => A.current.assignMe(id),
      pickAssignee: (id) => A.current.pickAssignee(id, rectOf(id)),
      pickDue: (id) => A.current.pickDue(id, rectOf(id)),
      openComment: (id) => openPanel(id, { hint: "comment" }),
      newColumn: () => colActions.add(columns.length),
      toggleSelectMode: () => setSelectMode((v) => { if (v) setSelection(new Set()); return !v; }),
    },
  });
  A.current.bulkDelete = () => { const n = selection.size; if (n && window.confirm(`Excluir ${n} ${n === 1 ? "tarefa" : "tarefas"}? Esta ação não pode ser desfeita.`)) A.current.bulk("delete"); };
  useEsc(selection.size || selectMode ? clearSelection : (focusId || composer ? () => { setComposer(null); setFocusId(null); } : null));

  const saveField = useCallback((id, patch) => A.current.patch(id, patch).then((r) => !!r), []);
  const onTaskChange = useCallback((t) => { if (t?.id) dispatch({ type: "UPSERT", task: t }); }, [dispatch]);
  const menuTask = menu ? byId.get(menu.id) : null;
  const panel = panelTask ? (
    <ErrorBoundary variant="modal" label="tarefa" resetKey={panelTask.id} onReset={closePanel}>
      <TaskPanel task={panelTask} tasks={tasks} columns={columns} board={board} users={users} usersById={usersById} labelColors={labelColors} labelOptions={labelOptions}
        me={me} mobile={isMobile} expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} onClose={closePanel} onOpen={openPanel} stack={stack} onBack={backPanel}
        saveField={saveField} actions={actions} activityVersion={activityVersion} onTaskChange={onTaskChange} focusHint={focusHint} />
    </ErrorBoundary>
  ) : null;
  const qn = strip(q.trim());

  return (
    <div ref={rootRef} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Tarefas" sub={selectMode ? "modo seleção: clique marca os cards · Esc sai" : "quadro do time · arraste para mover · Enter cria · ✓ conclui · ? atalhos"}>
        <Toolbar prefs={prefs} setPrefs={setPrefs} users={users} labelOptions={labelOptions} labelColors={labelColors} columns={columns} q={q} setQ={setQ} searchRef={searchRef} onHelp={() => setHelp(true)}
          onNew={<PrimaryButton onClick={() => { const key = groups[0]?.key || columns[0].key; setPrefs((p) => ({ ...p, collapsed: { ...p.collapsed, [key]: false } })); setComposer({ colKey: key, position: "top" }); boardRef.current?.scrollTo({ left: 0, behavior: "smooth" }); }}>+ Tarefa</PrimaryButton>} />
      </PageHead>
      <ActiveFiltersStrip prefs={prefs} setPrefs={setPrefs} users={users} columns={columns} />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {!state.loaded && !state.error && <div className="mono dim" style={{ fontSize: 12, padding: "24px var(--pad-x)" }}>carregando…</div>}
          {state.error && !tasks.length && (
            <div style={{ margin: "16px var(--pad-x)", padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5, display: "flex", gap: 10, alignItems: "center" }}>
              Não deu pra carregar as tarefas ({state.error}). <button type="button" onClick={refetch} style={{ fontWeight: 700, color: "inherit", textDecoration: "underline" }}>recarregar</button>
            </div>
          )}
          {state.loaded && totalInWorkspace === 0 && !composer ? (
            <EmptyState title="Nenhuma tarefa ainda" hint="Crie a primeira tarefa do time: atribua a uma pessoa, defina o prazo, arraste entre colunas e comente no card."
              action={<PrimaryButton onClick={() => setComposer({ colKey: columns[0].key, position: "top" })}>+ Criar tarefa</PrimaryButton>} />
          ) : state.loaded ? (
            <>
              {filtered.length === 0 && totalInWorkspace > 0 && <div className="mono dim" style={{ fontSize: 12, padding: "10px var(--pad-x) 0" }}>Nenhuma tarefa {qn ? `com "${q.trim()}"` : "com esses filtros"} · <button type="button" onClick={() => { setQ(""); setPrefs((p) => ({ ...p, filters: { ...DEFAULT_FILTERS }, done: "all" })); }} style={{ color: "var(--accent)", fontWeight: 600 }}>limpar filtros</button></div>}
              <Board boardRef={boardRef} groups={groups} hiddenByColumn={hiddenByColumn} prefs={prefs} dnd={dnd} composer={composer}
                focusId={focusId} selection={selection.size ? selection : null} renamingId={renamingId} subCounts={subCounts} blockedIds={blockedIds} usersById={usersById} labelColors={labelColors}
                doneKey={doneKey} actions={actions} colActions={colActions} sortManual={sortManual} />
            </>
          ) : null}
        </div>
        {!isMobile && panel}
      </div>
      {isMobile && panel}

      <BulkBar count={selection.size} users={users} columns={columns} mobile={isMobile}
        onAssign={(id) => actions.bulk(id ? "assign" : "unassign", id)} onDue={(v) => actions.bulk("due", v)} onPriority={(v) => actions.bulk("priority", v)}
        onMove={(k) => actions.bulk("move", k)} onComplete={() => actions.bulk("complete")} onDelete={() => A.current.bulkDelete()} onClear={clearSelection} />
      {hint && <div className="kbd" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 63, fontSize: 12, padding: "4px 8px" }}>{hint}</div>}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}

      {menuTask && <Menu {...(menu.at?.x != null && menu.at.width == null ? { x: menu.at.x, y: menu.at.y } : { anchor: menu.at })} items={taskMenuItems(menuTask, { columns, done: !!menuTask.completed, me, actions })} onClose={() => setMenu(null)} title={menuTask.title} />}
      {duePick && byId.get(duePick.id) && <DateQuick anchor={duePick.at} value={byId.get(duePick.id).dueDate} title="Prazo" onChange={(v) => actions.setDue(duePick.id, v)} onClose={() => setDuePick(null)} />}
      {assignPick && byId.get(assignPick.id) && <UserPicker anchor={assignPick.at} users={users} value={assigneesOf(byId.get(assignPick.id))} multi title="Responsáveis" onChange={(ids) => actions.patch(assignPick.id, { assignees: ids })} onClose={() => setAssignPick(null)} />}
      {blockerPick && byId.get(blockerPick.id) && (
        <TaskPicker anchor={blockerPick.at} title="Bloqueada por" tasks={tasks.filter((t) => inWorkspace(t) && !t.completed && t.id !== blockerPick.id && !(byId.get(blockerPick.id).blockedBy || []).includes(t.id))}
          onPick={(t) => mutate({ ids: [blockerPick.id], label: `Bloqueada por "${t.title}"`, request: () => api.taskBlocker(blockerPick.id, t.id), apply: (saved) => dispatch({ type: "UPSERT", task: saved }) })} onClose={() => setBlockerPick(null)} />
      )}
      {convertPick && byId.get(convertPick.id) && (
        <TaskPicker anchor={convertPick.at} title="Converter em subtarefa de" tasks={tasks.filter((t) => inWorkspace(t) && !t.parentId && t.id !== convertPick.id)}
          onPick={(t) => mutate({ ids: [convertPick.id], label: `Agora é subtarefa de "${t.title}"`, request: () => api.taskConvert(convertPick.id, { to: "subtask", parentId: t.id }), apply: (saved) => dispatch({ type: "UPSERT", task: saved }) })} onClose={() => setConvertPick(null)} />
      )}
    </div>
  );
}

// Escolher uma tarefa (bloqueio, tarefa-mãe): busca por título.
function TaskPicker({ anchor, title, tasks, onPick, onClose }) {
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const k = strip(q);
  const list = tasks.filter((t) => !k || strip(t.title).includes(k)).slice(0, 12);
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} title={title}>
      <input ref={ref} className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefa…" style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && list[0]) { onPick(list[0]); onClose(); } }} />
      {list.map((t) => <button key={t.id} type="button" onClick={() => { onPick(t); onClose(); }} className="tk-menu-item" style={{ display: "block", width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "(sem título)"}</button>)}
      {list.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: 6 }}>nenhuma tarefa</div>}
    </Popover>
  );
}
