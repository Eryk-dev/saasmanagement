import React from "react";
import { Popover } from "./popover.jsx";
// Seletor de uma opção no desenho do cockpit (14/09/2026). O <select> nativo
// abre a lista desenhada pelo sistema operacional — fonte, cor e altura do
// navegador no meio de um modal com tokens — e o seletor de pessoa
// (UserPicker) já abria pelo Popover. Este é o mesmo molde pra qualquer lista:
// gatilho com a medida do .inp, lista com marca de seleção, ↑↓ Enter Esc e
// busca quando a lista passa de 8 opções.
//
// options: [{ value, label, tone?, color?, hint? }]
//   tone  = cor do ponto de 6px (status, prioridade)
//   color = cor do texto no gatilho e na linha (ex.: urgente em --neg)

const { useEffect, useMemo, useRef, useState } = React;
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const Dot = ({ tone }) => <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: tone, flexShrink: 0 }} />;

function SelectList({ anchor, options, value, onPick, onClose, title, searchable, width }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const k = fold(q.trim());
    return k ? options.filter((o) => fold(o.label).includes(k) || fold(o.hint).includes(k)) : options;
  }, [options, q]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const boxRef = useRef(null), inputRef = useRef(null);
  useEffect(() => { (searchable ? inputRef.current : boxRef.current)?.focus(); }, [searchable]);
  useEffect(() => { if (q) setActive(0); }, [q]);
  useEffect(() => { boxRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (list[active]) onPick(list[active]); }
    else if (e.key === "Tab") onClose();
    e.stopPropagation();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={width} title={title} maxHeight={360}>
      {searchable && (
        <input ref={inputRef} className="inp" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Buscar…" aria-label={`Buscar em ${title || "opções"}`} style={{ width: "100%", marginBottom: 6, boxSizing: "border-box", height: 30, fontSize: 12.5 }} />
      )}
      <div ref={boxRef} role="listbox" aria-label={title} tabIndex={searchable ? -1 : 0} onKeyDown={searchable ? undefined : onKey}
        style={{ display: "flex", flexDirection: "column", gap: 1, outline: "none" }}>
        {list.map((o, i) => {
          const on = o.value === value;
          return (
            <button key={String(o.value) || "__vazio"} type="button" role="option" aria-selected={on} data-idx={i}
              className={"tk-menu-item" + (active === i ? " is-active" : "")}
              onMouseEnter={() => setActive(i)} onClick={() => onPick(o)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5, color: o.color || "var(--fg-1)", background: "transparent", fontWeight: on ? 600 : 400 }}>
              {o.tone ? <Dot tone={o.tone} /> : null}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              {o.hint && <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{o.hint}</span>}
              <span style={{ width: 14, color: "var(--accent)", fontWeight: 700, flexShrink: 0, textAlign: "right" }}>{on ? "✓" : ""}</span>
            </button>
          );
        })}
        {list.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: 8 }}>nada encontrado</div>}
      </div>
    </Popover>
  );
}

export function SelectPopover({ value, options, onChange, placeholder = "Selecionar…", label, searchable, disabled = false, width, style, size = "md" }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const current = options.find((o) => o.value === value);
  const busca = searchable ?? options.length > 8;
  const h = size === "sm" ? 28 : 34;
  return (
    <>
      <button ref={btnRef} type="button" className="inp" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label ? `${label}: ${current?.label || placeholder}` : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", minWidth: 0, height: h, textAlign: "left", fontSize: 12.5, cursor: disabled ? "default" : "pointer",
          borderColor: open ? "var(--accent-line)" : undefined, opacity: disabled ? 0.6 : 1, ...style }}>
        {current?.tone ? <Dot tone={current.tone} /> : null}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: current ? (current.color || "var(--fg-1)") : "var(--fg-4)", fontWeight: current?.color ? 600 : 400 }}>
          {current ? current.label : placeholder}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ flexShrink: 0, color: "var(--fg-4)", transform: open ? "rotate(180deg)" : "none", transition: "transform .12s" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <SelectList anchor={btnRef} options={options} value={value} title={label} searchable={busca}
          width={Math.max(width || 0, btnRef.current?.getBoundingClientRect().width || 0, 200)}
          onClose={() => { setOpen(false); btnRef.current?.focus(); }}
          onPick={(o) => { setOpen(false); btnRef.current?.focus(); if (o.value !== value) onChange(o.value); }} />
      )}
    </>
  );
}
