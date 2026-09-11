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
import { columnsOf, doneKeyOf, colKeyOf, byOrder, assigneesOf, taskUrl, fmtDue } from "../../lib/tasks.js";
import { useTasksStore } from "./store.js";
import { useBoardDnd } from "./dnd.js";
import { loadPrefs, savePrefs } from "./prefs.js";
import { parseTaskHash, openTaskHash, clearTaskHash, useTaskHash } from "./hash.js";
import { taskMenuItems } from "./context-menu.jsx";
import { Board } from "./board.jsx";
import { TaskPanel } from "./drawer.jsx";
import { Icon } from "./icons.jsx";

// Tarefas · quadro do time no nível do Asana. Cards = collection `tasks`;
// colunas = 1 registro em `task_boards`. Tudo que escreve passa pelo servidor
// (tasks-core.js): ordem, regras de coluna, carimbos, atividade e avisos.
// Aqui: mutação otimista com desfazer, tempo real por cockpit-change, painel
// ancorado (o quadro continua clicável), deep link #tasks/<id>.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const midpoint = (list, index) => {
  const prev = index > 0 ? Number(list[index - 1].order) || 0 : null;
  const next = index < list.length ? Number(list[index].order) || 0 : null;
  if (prev == null && next == null) return 1;
  if (prev == null) return next - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
};
const newColumnKey = () => `c_${Date.now().toString(36)}`;

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
  const [blockerPick, setBlockerPick] = useState(null); // { id, at }
  const [convertPick, setConvertPick] = useState(null); // { id, at }
  const [panelId, setPanelId] = useState(() => parseTaskHash());
  const [stack, setStack] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [focusHint, setFocusHint] = useState("");
  const [activityVersion, setActivityVersion] = useState(0);
  const boardRef = useRef(null);
  const lastPointer = useRef({ x: 80, y: 120 });
  useEffect(() => {
    const on = (e) => { lastPointer.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("pointerdown", on, true);
    return () => window.removeEventListener("pointerdown", on, true);
  }, []);

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
  const qn = strip(q.trim());
  const inWorkspace = useCallback((t) => t.saas === saasId || !t.saas, [saasId]);
  const shown = useMemo(() => tasks.filter((t) => inWorkspace(t) && (prefs.subtasksOnBoard || !t.parentId)
    && (!qn || strip(`${t.title} ${t.description || ""} ${(t.labels || []).join(" ")}`).includes(qn))), [tasks, inWorkspace, prefs.subtasksOnBoard, qn]);
  const byColumn = useMemo(() => {
    const m = {}; columns.forEach((c) => { m[c.key] = []; });
    shown.forEach((t) => m[colKeyOf(t, columns)].push(t));
    Object.values(m).forEach((l) => l.sort(byOrder));
    return m;
  }, [shown, columns]);
  const hiddenByColumn = useMemo(() => {
    if (!qn) return {};
    const m = {};
    for (const t of tasks) if (inWorkspace(t) && !t.parentId && !shown.includes(t)) { const k = colKeyOf(t, columns); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [tasks, shown, columns, qn, inWorkspace]);
  const totalInWorkspace = useMemo(() => tasks.filter((t) => inWorkspace(t) && !t.parentId).length, [tasks, inWorkspace]);

  // ── Painel (deep link) ───────────────────────────────────────────────────
  useTaskHash((id) => { setPanelId(id); if (!id) { setStack([]); setFocusHint(""); } });
  const panelTask = panelId ? byId.get(panelId) : null;
  useEffect(() => {
    if (!panelId || !state.loaded) return;
    const t = byId.get(panelId);
    if (!t) { if (tasks.length || state.loaded) { toast("Tarefa não encontrada", "warn"); clearTaskHash(); setPanelId(null); } return; }
    if (t.saas && t.saas !== saasId) setActiveSaas(t.saas);
  }, [panelId, state.loaded, byId, tasks.length, saasId]);
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

  // ── Ações (objeto estável: os cards são memoizados) ──────────────────────
  const A = useRef({}); // sempre o closure mais novo
  A.current = {
    activeSaas: () => saasId,
    open: (id, opts) => openPanel(id, opts),
    click: (id) => openPanel(id),
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
    create: async (colKey, title, position = "bottom") => {
      const list = byColumn[colKey] || [];
      const order = position === "top" ? (list.length ? (Number(list[0].order) || 0) - 1 : 1) : (list.length ? (Number(list[list.length - 1].order) || 0) + 1 : 1);
      const tmpId = `tmp_${Date.now().toString(36)}`;
      const draft = { id: tmpId, title, description: "", saas: saasId, assignees: [], column: colKey, priority: "", dueDate: "", labels: [], comments: [], order, completed: colKey === doneKey, _pending: true, createdAt: new Date().toISOString() };
      const r = await mutate({
        ids: [tmpId],
        optimistic: () => dispatch({ type: "UPSERT", task: draft }),
        request: () => api.create("tasks", { title, saas: saasId, column: colKey, order }),
        apply: (saved) => dispatch({ type: "REPLACE", id: tmpId, task: saved }),
        rollback: () => dispatch({ type: "REMOVE", ids: [tmpId] }),
        label: "A tarefa", silent: true,
      });
      return !!r;
    },
    createSubtask: async (parentId, title) => {
      const r = await mutate({
        ids: [parentId], label: "A subtarefa", silent: true,
        request: () => api.taskSubtask(parentId, { title }),
        apply: (saved) => dispatch({ type: "UPSERT", task: saved }),
      });
      return !!r;
    },
    complete: (id, value = true, { isUndo = false } = {}) => {
      const t = byId.get(id); if (!t) return Promise.resolve(null);
      const before = { completed: !!t.completed, completedAt: t.completedAt || "", column: t.column, order: t.order, completedFrom: t.completedFrom || "" };
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
    moveCards: ({ ids, fromKey, toKey, beforeId = "", afterId = "" }) => {
      const list = (byColumn[toKey] || []).filter((t) => !ids.includes(t.id));
      let index = beforeId ? list.findIndex((t) => t.id === beforeId) : afterId ? list.findIndex((t) => t.id === afterId) + 1 : list.length;
      if (index < 0) index = list.length;
      const snapshot = ids.map((id) => { const t = byId.get(id); return t ? { id, column: t.column, order: t.order, completed: !!t.completed, completedFrom: t.completedFrom || "" } : null; }).filter(Boolean);
      const orders = ids.map((id, i) => midpoint([...list.slice(0, index), ...ids.slice(0, i).map((x) => ({ order: 0 })), ...list.slice(index)], index + i));
      let prevId = afterId;
      return mutate({
        label: ids.length > 1 ? `${ids.length} tarefas movidas` : (toKey !== fromKey ? `Movida para ${columns.find((c) => c.key === toKey)?.name || "coluna"}` : ""), ids,
        optimistic: () => ids.forEach((id, i) => dispatch({ type: "PATCH_LOCAL", id, patch: { column: toKey, order: orders[i], ...(toKey === doneKey && doneKey ? { completed: true } : (fromKey === doneKey && toKey !== doneKey ? { completed: false } : {})) } })),
        request: async () => {
          const out = [];
          for (const id of ids) {
            const body = { column: toKey, ...(prevId ? { afterId: prevId } : (beforeId ? { beforeId } : {})) };
            const r = await api.taskMove(id, body);
            out.push(r); prevId = id;
          }
          return out;
        },
        apply: (rs) => rs.forEach((r) => { dispatch({ type: "UPSERT", task: r.task }); if (r.next) dispatch({ type: "UPSERT", task: r.next }); }),
        rollback: () => snapshot.forEach((s) => dispatch({ type: "PATCH_LOCAL", id: s.id, patch: { column: s.column, order: s.order, completed: s.completed, completedFrom: s.completedFrom } })),
        undo: () => A.current.moveCards({ ids, fromKey: toKey, toKey: fromKey }),
      });
    },
    move: (id, colKey) => { const t = byId.get(id); if (t && colKeyOf(t, columns) !== colKey) A.current.moveCards({ ids: [id], fromKey: colKeyOf(t, columns), toKey: colKey }); },
    setDue: (id, ymd) => A.current.patch(id, { dueDate: ymd }, { label: ymd ? `Prazo: ${fmtDue(ymd)}` : "Prazo removido", undo: true, silent: false }),
    pickDue: (id) => setDuePick({ id, at: { ...lastPointer.current } }),
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
      if (to === "task") {
        mutate({ ids: [id], label: "Convertida em tarefa do quadro", request: () => api.taskConvert(id, { to: "task" }), apply: (t) => dispatch({ type: "UPSERT", task: t }) });
      } else setConvertPick({ id, at: { ...lastPointer.current } });
    },
    pickBlocker: (id) => setBlockerPick({ id, at: { ...lastPointer.current } }),
    unblock: (id, blockerId) => mutate({ ids: [id], label: "Bloqueio removido", request: () => api.taskUnblock(id, blockerId), apply: (t) => dispatch({ type: "UPSERT", task: t }) }),
    copyLink: async (id) => {
      try { await navigator.clipboard.writeText(taskUrl(id)); toast("Link copiado", "pos"); }
      catch { toast(taskUrl(id), "neutral", 8000); }
    },
    remove: (id) => { const t = byId.get(id); if (!t) return; if (panelId === id) closePanel(); openDelete("tasks", t); },
  };
  const actions = useMemo(() => {
    const names = ["activeSaas", "open", "click", "focus", "menu", "rename", "renameSave", "patch", "create", "createSubtask", "complete", "moveCards", "move", "setDue", "pickDue", "assignMe", "duplicate", "followUp", "subtask", "convert", "pickBlocker", "unblock", "copyLink", "remove"];
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
    composer: (colKey, position = "bottom") => setComposer(colKey ? { colKey, position } : null),
  }), [board, saveBoard, setPrefs]);

  // ── Arrastar e soltar ────────────────────────────────────────────────────
  const dnd = useBoardDnd({ boardRef, onDrop: (p) => A.current.moveCards(p), getSelection: () => null });
  dndRef.current = dnd;
  const sortManual = prefs.sort?.key === "manual" || !prefs.sort;

  useEsc(focusId || composer ? () => { setComposer(null); setFocusId(null); } : null);

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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Tarefas" sub="quadro do time · arraste para mover · Enter cria · ✓ conclui">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 8, top: 7, color: "var(--fg-4)" }}><Icon name="search" size={14} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefas" className="inp" aria-label="Buscar tarefas" style={{ width: 200, paddingLeft: 28 }}
              onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.target.blur(); } }} />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" style={{ position: "absolute", right: 6, top: 6, color: "var(--fg-4)" }}><Icon name="x" size={13} /></button>}
          </div>
          <PrimaryButton onClick={() => { const key = columns[0].key; setPrefs((p) => ({ ...p, collapsed: { ...p.collapsed, [key]: false } })); setComposer({ colKey: key, position: "top" }); boardRef.current?.scrollTo({ left: 0, behavior: "smooth" }); }}>+ Tarefa</PrimaryButton>
        </div>
      </PageHead>

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
              {qn && shown.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: "10px var(--pad-x) 0" }}>Nenhuma tarefa com "{q.trim()}" · <button type="button" onClick={() => setQ("")} style={{ color: "var(--accent)", fontWeight: 600 }}>limpar busca</button></div>}
              <Board boardRef={boardRef} columns={columns} byColumn={byColumn} hiddenByColumn={hiddenByColumn} prefs={prefs} dnd={dnd} composer={composer}
                focusId={focusId} selection={null} renamingId={renamingId} subCounts={subCounts} blockedIds={blockedIds} usersById={usersById} labelColors={labelColors}
                doneKey={doneKey} actions={actions} colActions={colActions} sortManual={sortManual} />
            </>
          ) : null}
        </div>
        {!isMobile && panel}
      </div>
      {isMobile && panel}

      {menuTask && <Menu {...(menu.at?.x != null && menu.at.width == null ? { x: menu.at.x, y: menu.at.y } : { anchor: menu.at })} items={taskMenuItems(menuTask, { columns, done: !!menuTask.completed, me, actions })} onClose={() => setMenu(null)} title={menuTask.title} />}
      {duePick && byId.get(duePick.id) && <DateQuick anchor={{ left: duePick.at.x, top: duePick.at.y, right: duePick.at.x, bottom: duePick.at.y }} value={byId.get(duePick.id).dueDate} title="Prazo" onChange={(v) => actions.setDue(duePick.id, v)} onClose={() => setDuePick(null)} />}
      {blockerPick && byId.get(blockerPick.id) && (
        <TaskPicker anchor={{ left: blockerPick.at.x, top: blockerPick.at.y, right: blockerPick.at.x, bottom: blockerPick.at.y }} title="Bloqueada por" tasks={tasks.filter((t) => inWorkspace(t) && !t.completed && t.id !== blockerPick.id && !(byId.get(blockerPick.id).blockedBy || []).includes(t.id))}
          onPick={(t) => mutate({ ids: [blockerPick.id], label: `Bloqueada por "${t.title}"`, request: () => api.taskBlocker(blockerPick.id, t.id), apply: (saved) => dispatch({ type: "UPSERT", task: saved }) })} onClose={() => setBlockerPick(null)} />
      )}
      {convertPick && byId.get(convertPick.id) && (
        <TaskPicker anchor={{ left: convertPick.at.x, top: convertPick.at.y, right: convertPick.at.x, bottom: convertPick.at.y }} title="Converter em subtarefa de" tasks={tasks.filter((t) => inWorkspace(t) && !t.parentId && t.id !== convertPick.id)}
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
