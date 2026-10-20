// Carteira de CS (Lever CRM, Fase 3): os clientes do produto em colunas pelo
// estágio da carteira (customer.csStage, calculado no servidor a partir do
// estágio de vida, do health e da renovação aberta). Cliente em integração
// fica de fora: ele está no pipeline da integração. O clique abre o card.

import React from "react";
import { Card } from "./viz.jsx";
import { displayName } from "../lib/users.js";

export const CS_COLUMNS = [
  { id: "saudavel", label: "Saudável", tone: "pos" },
  { id: "atencao", label: "Atenção", tone: "warn" },
  { id: "em_risco", label: "Em risco", tone: "neg" },
  { id: "renovacao", label: "Renovação em negociação", tone: "info" },
  { id: "churn", label: "Churn", tone: "neg" },
];
const money = (v) => (window.fmt?.moneyFull ? window.fmt.moneyFull(v) : `R$ ${Math.round(v)}`);

export function CsPortfolioTab({ customers, onOpen }) {
  const byStage = Object.fromEntries(CS_COLUMNS.map((c) => [c.id, []]));
  for (const c of customers) if (byStage[c.csStage]) byStage[c.csStage].push(c);
  for (const list of Object.values(byStage)) list.sort((a, b) => (Number(a.health) || 0) - (Number(b.health) || 0));
  const total = Object.values(byStage).reduce((n, l) => n + l.length, 0);
  if (!total) {
    return <Card><p style={{ padding: "18px var(--inset-x)", margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
      A carteira aparece depois que o servidor calcula o estágio dos clientes (rotina de 15 em 15 minutos).
    </p></Card>;
  }
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
    {CS_COLUMNS.map((col) => <Card key={col.id}>
      <div style={{ padding: "14px 14px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: `var(--${col.tone})` }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{col.label}</span>
        <span className="tnum dim" style={{ marginLeft: "auto", fontSize: 12 }}>{byStage[col.id].length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 8px 10px" }}>
        {byStage[col.id].map((c) => <button key={c.id} type="button" onClick={() => onOpen(c.id)}
          style={{ textAlign: "left", padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg-1)" }}>{c.name}</span>
          <span style={{ fontSize: 11, color: "var(--fg-3)" }}>
            {[c.health ? `health ${c.health}` : "", c.arr ? `${money(c.arr / 12)}/mês` : "", c.owner ? displayName(c.owner) : "sem dono"].filter(Boolean).join(" · ")}
          </span>
        </button>)}
        {!byStage[col.id].length && <span style={{ fontSize: 11.5, color: "var(--fg-4)", padding: "4px 6px" }}>ninguém aqui</span>}
      </div>
    </Card>)}
  </div>;
}
