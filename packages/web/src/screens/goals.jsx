import React from "react";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState } from "../atoms.jsx";
// Goals — pacing gauges with cascading view (portfolio → SaaS → team).
// Auto-alerts when <85% projected.

function GoalsScreen() {
  const { GOALS, SAAS } = window.SEED;
  if (!GOALS.length) return <EmptyState title="Nenhuma meta definida" hint="Crie metas por POST /api/goals (scope, target, current, projected) para acompanhar o pacing verde/amarelo/vermelho aqui." />;
  const grouped = {
    "Portfólio": GOALS.filter(g => g.scope === "Portfolio"),
    LeverAds:  GOALS.filter(g => g.scope === "LeverAds"),
    Quill:     GOALS.filter(g => g.scope === "Quill"),
    Mesa:      GOALS.filter(g => g.scope === "Mesa"),
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Metas · este mês</h1>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>dia 12 / 31 · alerta automático com projeção &lt;85% · cascata portfólio → SaaS → time</div>
        </div>
        <button style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>+ nova meta</span></button>
      </div>

      {Object.entries(grouped).map(([scope, items]) => items.length > 0 && (
        <div key={scope} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{scope}</span>
              <span className="mono dim" style={{ fontSize: 11 }}>{items.length} meta{items.length > 1 ? "s" : ""}</span>
            </div>
            {items.some(g => g.band === "red") && (
              <span className="chip neg"><span className="dot" />faixa vermelha — precisa de ação</span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1, background: "var(--line-1)" }}>
            {items.map(g => <GoalDetail key={g.id} g={g} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function GoalDetail({ g }) {
  const pct  = (g.current   / g.target) * 100;
  const proj = (g.projected / g.target) * 100;
  const tone = g.band === "green" ? "var(--pos)" : g.band === "yellow" ? "var(--warn)" : "var(--neg)";
  const fmt = (v) => g.unit === "$" ? window.fmt.money(v)
                  : g.unit === "pct" ? window.fmt.pct(v, 1)
                  : g.unit === "x"   ? window.fmt.ratio(v)
                  :                    v;
  return (
    <div style={{ padding: "14px 18px", background: "var(--bg-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{g.name}</span>
        <span className={"chip " + (g.band === "green" ? "pos" : g.band === "yellow" ? "warn" : "neg")}>
          <span className="dot" /> {g.band}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "baseline", marginTop: 10 }}>
        <div>
          <div className="mono dim" style={{ fontSize: 10 }}>agora</div>
          <div className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: tone }}>{fmt(g.current)}</div>
        </div>
        <div>
          <div style={{ position: "relative", height: 8, background: "var(--bg-3)", borderRadius: 4 }}>
            <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${Math.min(100, proj)}%`, background: "var(--bg-3)", borderRight: "1px dashed var(--line-strong)" }} />
            <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${Math.min(100, pct)}%`, background: tone, borderRadius: 4, opacity: 0.9 }} />
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
            <span>projetado {fmt(g.projected)} · {Math.round(proj)}%</span>
            <span>meta {fmt(g.target)}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono dim" style={{ fontSize: 10 }}>em risco?</div>
          <div className="mono" style={{ fontSize: 12, color: tone }}>
            {g.band === "red" ? "sim" : g.band === "yellow" ? "atenção" : "não"}
          </div>
        </div>
      </div>
    </div>
  );
}

export { GoalsScreen };
