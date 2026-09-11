import React from "react";
import { toast } from "../../atoms.jsx";
// Estado do quadro: tarefas + board com mutação OTIMISTA (aplica na hora,
// confirma com a resposta do servidor, desfaz com toast se falhar) e pilha de
// desfazer (⌘Z / botão do toast). O cache de módulo sobrevive ao remount da
// tela (o app remonta as telas quando o SEED recarrega) pra não piscar.

const { useReducer, useRef, useCallback, useMemo } = React;

let cache = { tasks: null, board: null };
const undoStack = [];           // [{ label, undo, at }]
const UNDO_MAX = 20, UNDO_TTL = 60_000;

function upsert(list, task) {
  const i = list.findIndex((t) => t.id === task.id);
  if (i < 0) return [...list, task];
  const next = list.slice(); next[i] = task; return next;
}
function reducer(state, a) {
  switch (a.type) {
    case "LOADED": return { ...state, tasks: a.tasks, board: a.board, loaded: true, error: "" };
    case "ERROR": return { ...state, loaded: true, error: a.error || "erro" };
    case "UPSERT": return { ...state, tasks: upsert(state.tasks, a.task) };
    case "UPSERT_MANY": return { ...state, tasks: a.tasks.reduce((l, t) => upsert(l, t), state.tasks) };
    case "REPLACE": return { ...state, tasks: state.tasks.map((t) => (t.id === a.id ? a.task : t)) };
    case "REMOVE": { const ids = new Set(a.ids); return { ...state, tasks: state.tasks.filter((t) => !ids.has(t.id)) }; }
    case "PATCH_LOCAL": return { ...state, tasks: state.tasks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "PATCH_MANY": { const ids = new Set(a.ids); return { ...state, tasks: state.tasks.map((t) => (ids.has(t.id) ? { ...t, ...(typeof a.patch === "function" ? a.patch(t) : a.patch) } : t)) }; }
    case "BOARD": return { ...state, board: a.board };
    case "RECONCILE": {
      // servidor manda; o que está em voo (ou é rascunho local tmp_) fica.
      const keep = a.keep || new Set();
      const local = new Map(state.tasks.map((t) => [t.id, t]));
      const merged = a.tasks.map((t) => (keep.has(t.id) && local.has(t.id) ? local.get(t.id) : t));
      const fresh = new Set(a.tasks.map((t) => t.id));
      for (const t of state.tasks) if (!fresh.has(t.id) && (keep.has(t.id) || String(t.id).startsWith("tmp_"))) merged.push(t);
      return { ...state, tasks: merged, board: a.keepBoard ? state.board : a.board, loaded: true, error: "" };
    }
    default: return state;
  }
}

export function useTasksStore() {
  const [state, dispatch] = useReducer(reducer, null, () => ({ tasks: cache.tasks || [], board: cache.board, loaded: !!cache.tasks, error: "" }));
  cache = { tasks: state.tasks, board: state.board };
  const inflight = useRef(new Set());
  const [, bump] = useReducer((n) => n + 1, 0);

  const undoLast = useCallback(async () => {
    while (undoStack.length && Date.now() - undoStack[undoStack.length - 1].at > UNDO_TTL) undoStack.pop();
    const entry = undoStack.pop();
    bump();
    if (!entry) { toast("Nada pra desfazer"); return false; }
    try { await entry.undo(); return true; }
    catch (err) { console.warn("desfazer falhou", err); toast("Não deu pra desfazer · tente de novo", "neg"); return false; }
  }, []);

  // mutate: otimista → request → apply(resultado) | rollback + toast.
  // `undo` (função) entra na pilha e o toast ganha o botão Desfazer.
  const mutate = useCallback(async ({ label = "", ids = [], optimistic, request, apply, rollback, undo, silent = false, tone = "pos" }) => {
    ids.forEach((id) => inflight.current.add(id));
    try {
      optimistic && optimistic();
      const r = await request();
      apply && apply(r);
      if (undo) {
        undoStack.push({ label, undo, at: Date.now() });
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        bump();
      }
      if (label && !silent) toast(label, tone, undo ? 6000 : 3500, undo ? { label: "Desfazer", onClick: () => { undoLast(); } } : null);
      return r === undefined ? true : r;
    } catch (err) {
      rollback && rollback();
      console.warn(label || "mutação", err);
      toast(`${label || "A alteração"} não foi salva · ${err?.message || "tente de novo"}`, "neg", 6000);
      return null;
    } finally {
      ids.forEach((id) => inflight.current.delete(id));
    }
  }, [undoLast]);

  const api = useMemo(() => ({ state, dispatch, mutate, inflight, undoLast, canUndo: () => undoStack.length > 0 }), [state, dispatch, mutate, undoLast]);
  return api;
}
