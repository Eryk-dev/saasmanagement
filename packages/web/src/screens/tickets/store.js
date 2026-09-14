import React from "react";
import { toast } from "../../atoms.jsx";
// Estado da fila de tickets: mesmo desenho do store de Tarefas — mutação
// OTIMISTA (aplica na hora, confirma com o servidor, desfaz com toast se
// falhar) e cache de módulo pra tela não piscar ao remontar. A lista vem SEM a
// conversa (resumo do servidor); o ticket inteiro mora no painel.

const { useReducer, useRef, useCallback, useMemo } = React;

let cache = null;

function upsert(list, t) {
  const i = list.findIndex((x) => x.id === t.id);
  if (i < 0) return [t, ...list];
  const next = list.slice(); next[i] = { ...list[i], ...t }; return next;
}
// O ticket inteiro (com messages) vira resumo antes de entrar na lista.
export function toSummary(t) {
  if (!t || !Array.isArray(t.messages)) return t;
  const { messages, ...rest } = t;
  const last = messages[messages.length - 1];
  return {
    ...rest,
    messageCount: messages.length,
    lastMessage: last ? { kind: last.kind, authorType: last.author?.type || "agent", at: last.at, excerpt: String(last.text || "").slice(0, 120) } : null,
  };
}

function reducer(state, a) {
  switch (a.type) {
    case "ERROR": return { ...state, loaded: true, error: a.error || "erro" };
    case "UPSERT": return { ...state, tickets: upsert(state.tickets, toSummary(a.ticket)) };
    case "REMOVE": { const ids = new Set(a.ids); return { ...state, tickets: state.tickets.filter((t) => !ids.has(t.id)) }; }
    case "PATCH_LOCAL": return { ...state, tickets: state.tickets.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) };
    case "RECONCILE": {
      // Servidor manda; o que está em voo fica com a versão local.
      const keep = a.keep || new Set();
      const local = new Map(state.tickets.map((t) => [t.id, t]));
      const tickets = a.tickets.map((t) => (keep.has(t.id) && local.has(t.id) ? local.get(t.id) : t));
      return { ...state, tickets, loaded: true, error: "" };
    }
    default: return state;
  }
}

export function useTicketsStore(saasKey) {
  const [state, dispatch] = useReducer(reducer, null, () => (cache && cache.key === saasKey
    ? { tickets: cache.tickets, loaded: true, error: "" }
    : { tickets: [], loaded: false, error: "" }));
  cache = { key: saasKey, tickets: state.tickets };
  const inflight = useRef(new Set());

  // mutate: otimista → request → apply(resultado) | rollback + toast.
  const mutate = useCallback(async ({ label = "", ids = [], optimistic, request, apply, rollback, silent = true, tone = "pos" }) => {
    ids.forEach((id) => inflight.current.add(id));
    try {
      optimistic && optimistic();
      const r = await request();
      apply && apply(r);
      if (label && !silent) toast(label, tone);
      return r === undefined ? true : r;
    } catch (err) {
      rollback && rollback();
      console.warn(label || "ticket", err);
      toast(`${label || "A alteração"} não foi salva · ${err?.message || "tente de novo"}`, "neg", 6000);
      return null;
    } finally {
      ids.forEach((id) => inflight.current.delete(id));
    }
  }, []);

  return useMemo(() => ({ state, dispatch, mutate, inflight }), [state, mutate]);
}
