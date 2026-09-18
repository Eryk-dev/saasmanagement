import React from "react";

const { useEffect, useRef } = React;

// Busca do cabeçalho das telas de fila (Tarefas, Tickets): lupa, ✕ pra limpar,
// Esc limpa e sai do campo, e "/" em qualquer lugar da tela foca a busca.
// O atalho não rouba o "/" de quem está digitando, nem age com menu, popover
// ou modal aberto por cima (o painel ancorado das Tarefas não conta).

const inField = (el) => {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
};
const layerOpen = () => !!document.querySelector("[role=menu], [role=dialog]:not([data-panel-root])");

const svg = (d, size) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{d}</svg>
);

export function SearchInput({ value, onChange, placeholder = "Buscar", label, inputRef, width = 190, shortcut = true }) {
  const ownRef = useRef(null);
  const ref = inputRef || ownRef;
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      if (e.key !== "/" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField(e.target) || inField(document.activeElement) || layerOpen()) return;
      const el = ref.current;
      if (!el || !el.offsetParent) return;
      e.preventDefault();
      el.focus();
      el.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, ref]);
  return (
    <div style={{ position: "relative", width, maxWidth: "100%" }}>
      <span style={{ position: "absolute", left: 8, top: 8, color: "var(--fg-4)", display: "inline-flex" }}>{svg(<><circle cx="11" cy="11" r="7" /><path d="M20.4 20.4l-4.2-4.2" /></>, 14)}</span>
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="inp" aria-label={label || placeholder}
        style={{ width: "100%", height: 32, paddingLeft: 28, paddingRight: value ? 26 : 30, boxSizing: "border-box" }}
        onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); e.currentTarget.blur(); } }} />
      {value
        ? <button type="button" onClick={() => { onChange(""); ref.current?.focus(); }} aria-label="Limpar busca" style={{ position: "absolute", right: 6, top: 7, color: "var(--fg-4)", display: "inline-flex" }}>{svg(<path d="M6 6l12 12M18 6L6 18" />, 13)}</button>
        : shortcut && <span className="kbd hide-mobile" style={{ position: "absolute", right: 7, top: 7 }}>/</span>}
    </div>
  );
}
