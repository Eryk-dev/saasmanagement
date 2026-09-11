import React from "react";
import { Avatar } from "../atoms.jsx";
import { Popover } from "./popover.jsx";
import { userColor } from "../lib/users.js";
// Seletor de pessoas (popover): busca, avatar com o anel da cor da pessoa e
// marca de seleção. `multi` alterna e devolve o array na hora (autosave);
// single devolve o id e fecha. `allowNone` = opção "Ninguém".

const { useEffect, useMemo, useRef, useState } = React;
const strip = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function UserAvatarRing({ id, name, size = 22 }) {
  return (
    <span style={{ display: "inline-flex", borderRadius: 999, boxShadow: `0 0 0 2px ${userColor(id) || "var(--line-2)"}`, flexShrink: 0 }}>
      <Avatar id={id} name={name} size={size} />
    </span>
  );
}

export function UserPicker({ anchor, users, value, multi = true, onChange, onClose, title, allowNone = false, noneLabel = "Ninguém" }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const selected = multi ? (Array.isArray(value) ? value : []) : (value ? [value] : []);
  const list = useMemo(() => {
    const k = strip(q);
    const base = (users || []).filter((u) => !k || strip(u.name).includes(k) || strip(u.id).includes(k));
    return allowNone && !k ? [{ id: "", name: noneLabel, none: true }, ...base] : base;
  }, [users, q, allowNone, noneLabel]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [q]);

  const pick = (u) => {
    if (!u) return;
    if (multi) {
      const has = selected.includes(u.id);
      onChange(has ? selected.filter((x) => x !== u.id) : [...selected, u.id]);
    } else {
      onChange(u.none ? "" : u.id);
      onClose && onClose();
    }
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(list[active]); }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} title={title}>
      <input ref={inputRef} className="inp" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
        placeholder="Buscar pessoa…" style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }} />
      <div role="listbox" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {list.map((u, i) => {
          const on = !u.none && selected.includes(u.id);
          return (
            <button key={u.id || "__none"} role="option" aria-selected={on} onMouseEnter={() => setActive(i)} onClick={() => pick(u)}
              className={"tk-menu-item" + (active === i ? " is-active" : "")}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 13, color: "var(--fg-1)", background: "transparent" }}>
              {u.none ? <span style={{ width: 22, height: 22, borderRadius: 999, border: "1px dashed var(--line-2)", flexShrink: 0 }} /> : <UserAvatarRing id={u.id} name={u.name} size={22} />}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
              {on && <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}
        {list.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: 8 }}>ninguém com esse nome</div>}
      </div>
    </Popover>
  );
}
