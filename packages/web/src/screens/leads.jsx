import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// SDR worklist — prioritized leads queue. Persona home for the SDR.

const { useState: useStL } = React;

function LeadsScreen({ persona }) {
  const { LEADS } = window.SEED;
  const [pri, setPri] = useStL("all");
  const filtered = LEADS.filter(l => pri === "all" || l.priority === pri).sort((a,b) => b.score - a.score);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[["all","All"],["P0","P0 · today"],["P1","P1 · this week"],["P2","P2 · backlog"]].map(([k,l]) => (
            <button key={k} onClick={() => setPri(k)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
              border: "1px solid " + (pri === k ? "var(--line-strong)" : "var(--line-1)"),
              background: pri === k ? "var(--bg-3)" : "var(--bg-2)",
              color: pri === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, fontFamily: "var(--mono)",
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="mono dim" style={{ fontSize: 11 }}>round-robin queue · {filtered.length} leads</span>
          <button style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>+ new lead</span></button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.map((l, i) => <LeadCard key={l.id} l={l} idx={i} top={i === 0} />)}
      </div>
    </div>
  );
}

function LeadCard({ l, idx, top }) {
  const { SAAS } = window.SEED;
  const saas = SAAS.find(s => s.id === l.saas);
  const priTone = l.priority === "P0" ? "var(--neg)" : l.priority === "P1" ? "var(--warn)" : "var(--fg-3)";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "32px 200px 1.4fr 80px 100px 100px 180px",
      padding: "14px 24px",
      borderBottom: "1px solid var(--line-1)",
      background: top ? "linear-gradient(90deg, oklch(0.72 0.18 33 / 0.04), transparent)" : "transparent",
      alignItems: "center",
      gap: 12,
    }}>
      <span className="mono tnum dim" style={{ fontSize: 11 }}>{String(idx+1).padStart(2,"0")}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{l.name}</div>
        <div className="mono dim" style={{ fontSize: 10 }}>{l.company} · {l.value}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: "var(--fg-2)" }}>{l.reason}</div>
        <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>{l.source}</div>
      </div>
      <span className="mono" style={{ fontSize: 11, color: priTone, fontWeight: 500 }}>{l.priority}</span>
      <div>
        <div className="mono tnum" style={{ fontSize: 14 }}>{l.score}</div>
        <div className="mono dim" style={{ fontSize: 9 }}>ICP fit {(l.icp*100).toFixed(0)}%</div>
      </div>
      <div className="mono dim tnum" style={{ fontSize: 11 }}>{l.age} old</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
          <span style={{ fontSize: 11 }}>contact</span>
        </button>
        <button style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>dismiss</span></button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 1, background: window.productTone(saas) }} />
          <span className="mono dim" style={{ fontSize: 10 }}>{saas?.name}</span>
        </span>
      </div>
    </div>
  );
}

export { LeadsScreen };
