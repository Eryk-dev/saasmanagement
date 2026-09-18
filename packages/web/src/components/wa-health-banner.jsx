import React from "react";

// Banner de saúde do WhatsApp (lê CONFIG.whatsapp.health do bootstrap, alimentado
// pelos webhooks de qualidade/status/conta). "danger" = segure os disparos;
// "warn" = fique de olho. Reusado pelo inbox e pela tela de Disparos.
//
// Mora num módulo próprio de propósito: Disparos só precisa destas 14 linhas,
// e importá-las de whatsapp.jsx arrastava o inbox inteiro (e o encoder de
// áudio, 260 KB) pro caminho da tela.
export function WaHealthBanner({ style }) {
  const h = window.SEED?.CONFIG?.whatsapp?.health;
  if (!h || h.level === "ok" || !(h.messages || []).length) return null;
  const danger = h.level === "danger";
  return (
    <div style={{ margin: "12px var(--pad-x) 0", padding: "10px 14px", borderRadius: "var(--r-2)",
      border: "1px solid " + (danger ? "var(--neg)" : "var(--warn)"),
      background: danger ? "var(--neg-soft)" : "var(--warn-soft)", ...style }}>
      <div className="kicker" style={{ fontWeight: 600, marginBottom: 4, color: danger ? "var(--neg)" : "var(--warn)" }}>
        {danger ? "⚠ Saúde do WhatsApp em risco" : "Saúde do WhatsApp · atenção"}
      </div>
      {(h.messages || []).map((m, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.4 }}>· {m}</div>)}
    </div>
  );
}
