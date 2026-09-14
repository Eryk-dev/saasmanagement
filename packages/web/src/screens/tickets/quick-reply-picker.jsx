import React from "react";
import { api } from "../../lib/api.js";
import { Popover } from "../../components/popover.jsx";
import { fold } from "../../lib/tickets.js";

// Respostas rápidas no chat do ticket. Duas portas pra mesma lista:
//   · botão "Respostas rápidas" no composer (lista com busca);
//   · digitar "/" no começo da linha ou depois de um espaço (a busca é o que
//     vem depois da barra, e o foco fica no campo: ↑↓ escolhe, Enter/Tab insere,
//     Esc fecha).
// A lista vem com cache curto por produto e se renova no cockpit-change.

const { useEffect, useRef, useState } = React;
const TTL = 60_000;
const cache = new Map(); // saas -> { at, items }

export function useQuickReplies(saas) {
  const [items, setItems] = useState(() => cache.get(saas)?.items || null);
  const load = useRef(null);
  load.current = async (force = false) => {
    if (!saas) return;
    const hit = cache.get(saas);
    if (!force && hit && Date.now() - hit.at < TTL) { setItems(hit.items); return; }
    try {
      const r = await api.quickReplies(saas);
      const list = r?.items || [];
      cache.set(saas, { at: Date.now(), items: list });
      setItems(list);
    } catch { setItems((cur) => cur || []); }
  };
  useEffect(() => { load.current(); }, [saas]);
  useEffect(() => {
    let t = 0;
    const on = (e) => { if (e.detail?.collection !== "quick_replies") return; clearTimeout(t); t = setTimeout(() => load.current(true), 500); };
    window.addEventListener("cockpit-change", on);
    return () => { clearTimeout(t); window.removeEventListener("cockpit-change", on); };
  }, []);
  return { items, reload: () => load.current(true) };
}

// Atalho que começa com o termo vem primeiro; depois título e texto.
export function filterQuickReplies(items, query) {
  const k = fold(query || "").replace(/^\//, "");
  if (!k) return items || [];
  const rank = (q) => (fold(q.shortcut).startsWith(k) ? 0 : fold(q.title).includes(k) ? 1 : fold(q.body).includes(k) ? 2 : 9);
  return (items || []).map((q) => [rank(q), q]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0]).map(([, q]) => q);
}

// A barra digitada logo antes do cursor: { start, query } ou null.
export function slashTokenAt(text, caret) {
  const before = String(text || "").slice(0, caret);
  const m = before.match(/(^|\s)\/([a-z0-9_-]{0,40})$/i);
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

const excerpt = (s, n = 90) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

export function QuickReplyList({ anchor, items, query, active, onActive, onPick, onClose, withSearch = false, onQuery, loading }) {
  const boxRef = useRef(null), inputRef = useRef(null);
  useEffect(() => { if (withSearch) inputRef.current?.focus(); }, [withSearch]);
  useEffect(() => { boxRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const shared = items.filter((q) => q.scope === "shared");
  const mine = items.filter((q) => q.scope === "personal");
  const ordered = [...mine, ...shared];
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); onActive(Math.min(ordered.length - 1, active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); onActive(Math.max(0, active - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (ordered[active]) onPick(ordered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={420} align="start" title={withSearch ? "Respostas rápidas" : undefined} maxHeight={340}>
      {withSearch && (
        <input ref={inputRef} className="inp" value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={onKey}
          placeholder="Buscar por atalho, título ou texto…" aria-label="Buscar respostas rápidas"
          style={{ width: "100%", boxSizing: "border-box", height: 30, fontSize: 12.5, marginBottom: 6 }} />
      )}
      <div ref={boxRef} role="listbox" aria-label="Respostas rápidas">
        {loading && <div className="mono dim" style={{ fontSize: 12, padding: 8 }}>carregando…</div>}
        {!loading && ordered.map((q, i) => (
          <React.Fragment key={q.id}>
            {(i === 0 || ordered[i - 1].scope !== q.scope) && <div className="kicker" style={{ padding: "6px 8px 2px" }}>{q.scope === "personal" ? "Suas" : "Da equipe"}</div>}
            <button type="button" role="option" aria-selected={active === i} data-idx={i}
              className={"tk-menu-item qr-picker-item" + (active === i ? " is-active" : "")}
              onMouseEnter={() => onActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(q)}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0 }}>
                <span className="support-ellipsis" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{q.title}</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-4)", flexShrink: 0 }}>/{q.shortcut}</span>
              </span>
              <span className="support-ellipsis" style={{ fontSize: 11.5, color: "var(--fg-3)", width: "100%" }}>{excerpt(q.body)}</span>
            </button>
          </React.Fragment>
        ))}
        {!loading && ordered.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--fg-3)", padding: 8 }}>
            {query ? `nenhuma resposta com "${query}"` : "nenhuma resposta rápida ainda"} · crie em Suporte → Respostas rápidas
          </div>
        )}
      </div>
    </Popover>
  );
}

export const orderForPicker = (items) => [...items.filter((q) => q.scope === "personal"), ...items.filter((q) => q.scope === "shared")];
