import React from "react";
import { RowActions } from "../atoms.jsx";
import { BigNumber } from "../charts.jsx";
import { ProposalActions } from "../components/ProposalActions.jsx";
import { leadScoreLabel, leadAge } from "../lib/ui.js";
import { useData } from "../data.jsx";
// Lead detail drawer — slides over the pipeline when a card is opened.
// (Funil unificado: o card do pipeline é um lead, então o detalhe é do lead.)

function LeadDetail({ lead, onClose }) {
  const { openForm, openDelete } = useData();
  if (!lead) return null;
  const { PEOPLE } = window.SEED;
  const owner = PEOPLE[lead.owner];
  const score = lead.score;
  const hasScore = score != null && score !== "";
  const hasIcp = lead.icp != null && lead.icp !== "";
  const icpPct = hasIcp ? `${Math.round(Number(lead.icp) * 100)}%` : null;

  // Campos REAIS do lead — mostra só os preenchidos (sem placeholder/mock).
  const fields = [
    ["Empresa", lead.company],
    ["Faixa", lead.value],
    ["Prioridade", lead.priority],
    ["Score", hasScore ? `${score} · ${leadScoreLabel(score)}` : null],
    ["ICP", icpPct],
    ["Origem", lead.source],
    ["Dono", owner?.name || lead.owner],
    ["E-mail", lead.email],
    ["Telefone", lead.phone],
    ["Motivo", lead.reason],
  ].filter(([, v]) => v != null && v !== "");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)",
      display: "flex", justifyContent: "flex-end", zIndex: 60,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, height: "100%", background: "var(--bg-1)",
        borderLeft: "1px solid var(--line-2)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-pop)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em" }}>LEAD · {String(lead.id).toUpperCase()}</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{lead.name}</div>
            {lead.company && <div className="mono dim" style={{ fontSize: 12, marginTop: 2 }}>{lead.company}</div>}
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lead.stage && <span className="chip">{lead.stage}</span>}
              {lead.source && <span className="chip">{lead.source}</span>}
              {hasScore && <span className={"chip " + (Number(score) >= 75 ? "neg" : Number(score) >= 50 ? "warn" : "")}>{leadScoreLabel(score)}</span>}
              {lead.priority && <span className="chip">{lead.priority}</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <RowActions
              onEdit={() => { onClose(); openForm("leads", lead); }}
              onDelete={() => { onClose(); openDelete("leads", lead); }}
            />
            <button onClick={onClose} className="mono dim" style={{ fontSize: 16 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <BigNumber value={window.fmt.money(lead.amount || 0)} label="Valor" size={28} />
          <BigNumber value={leadAge(lead)} label="Idade" size={28} />
          <BigNumber value={icpPct || (hasScore ? String(score) : "—")} label={icpPct ? "ICP" : "Score"} size={28} />
        </div>

        {fields.length > 0 && (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Campos</div>
            {fields.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Proposta</div>
          <ProposalActions l={lead} />
        </div>

        <div style={{ marginTop: "auto", padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)" }}>
          <button onClick={() => { onClose(); openForm("leads", lead); }} style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Editar lead</button>
          <button style={{ padding: "9px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>⋯</button>
        </div>
      </div>
    </div>
  );
}

export { LeadDetail };
