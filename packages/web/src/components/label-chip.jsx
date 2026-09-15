import React from "react";

// Etiqueta dos cards (labels das Tarefas, categoria dos Tickets): fundo tingido
// pela cor com a bolinha na frente; sem cor, fundo neutro. `onRemove` põe o ✕.
export function LabelChip({ label, color, small, onRemove }) {
  const bg = color ? `color-mix(in srgb, ${color} 16%, var(--bg-1))` : "var(--bg-2)";
  return (
    <span className="chip" style={{ background: bg, color: "var(--fg-1)", minHeight: small ? 18 : 20, fontSize: small ? 10.5 : 11, maxWidth: 140 }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Tirar ${label}`} style={{ marginLeft: 2, color: "var(--fg-4)", fontSize: 11, lineHeight: 1 }}>✕</button>}
    </span>
  );
}
