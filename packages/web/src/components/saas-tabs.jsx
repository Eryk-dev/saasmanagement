import React from "react";
// Abas de produto (SaaS) — o seletor padrão das telas de operação. Some com 1
// produto só (aba única é ruído) e volta sozinho quando o portfólio cresce.
// Usado por Pipeline, Visão geral, Clientes, Publicidade e Custos.

export function SaasTabs({ active, onSelect }) {
  const { SAAS } = window.SEED;
  if (SAAS.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
      {SAAS.map(s => (
        <button key={s.id} onClick={() => onSelect(s.id)} style={{
          padding: "4px 10px", borderRadius: 4,
          background: active === s.id ? "var(--bg-0)" : "transparent",
          color: active === s.id ? "var(--fg-1)" : "var(--fg-3)",
          fontSize: 12, fontWeight: 500,
          border: active === s.id ? "1px solid var(--line-2)" : "1px solid transparent",
        }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: window.productTone(s), marginRight: 6 }} />
          {s.name}
        </button>
      ))}
    </div>
  );
}
