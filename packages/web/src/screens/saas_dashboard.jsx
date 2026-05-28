import React from "react";
import { HealthArc, Sparkline, TrendBadge } from "../atoms.jsx";
import { BigNumber, FunnelLadder, NNMWaterfall, DeltaInline } from "../charts.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// SaaS Dashboard — single-product cockpit.
// Drilldown from Portfolio. Big NSM, health decomposition, vital tiles, funnel heatmap.

function SaasDashboardScreen({ saasId = "leverads", onNav, onJump }) {
  const { SAAS } = window.SEED;
  const s = SAAS.find(x => x.id === saasId) || SAAS[0];
  const tone = window.productTone(s);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "18px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top — product identity + NSM */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 14 }}>
        <div style={{ border: "1px solid var(--line-1)", borderLeft: `2px solid ${tone}`, borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em" }}>{s.name}</h1>
            <TrendBadge trend={s.healthTrend} />
            <span className="mono dim" style={{ fontSize: 11 }}>{s.tag}</span>
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
            {s.motion} · {s.plan} · ~{s.cycleDays}d cycle · {s.customers.toLocaleString()} customers
          </div>

          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "auto 1fr", gap: 32, alignItems: "end" }}>
            <BigNumber value={window.fmt.money(s.mrr)} label="North-Star · MRR" delta={s.mrrDelta} dUnit="$" sublabel={`ARR ${window.fmt.money(s.arr)}`} size={48} />
            <Sparkline data={s.mrrSeries} width={420} height={64} stroke={tone} />
          </div>
        </div>

        {/* Health decomposition card */}
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "16px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Health score</div>
            <span className="mono dim" style={{ fontSize: 10 }}>weighted decomposition</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center", marginTop: 8 }}>
            <HealthArc value={s.health} size={86} strokeWidth={8} delta={s.healthDelta} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {s.decomp ? s.decomp.map(d => <DecompBar key={d.k} d={d} />) : decompFromVitals(s).map(d => <DecompBar key={d.k} d={d} />)}
            </div>
          </div>
        </div>
      </div>

      {/* Vital tiles — 4 across */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", border: "1px solid var(--line-1)" }}>
        <VitalCard k="Pipeline · TCV"  v={window.fmt.money(s.tcv)} d={s.tcvDelta} dUnit="pct"
          sub={`Coverage ${s.pipelineCoverage ? s.pipelineCoverage.toFixed(1) + "x" : "n/a"} · ACV ${window.fmt.money(s.acv)}`} />
        <VitalCard k="Sales · Velocity" v={s.velocity} d={s.velocityDelta} dUnit="pct"
          sub={`Win ${window.fmt.pct(s.winRate)} · Cycle ${s.cycleDays}d`} />
        <VitalCard k="Customer · NRR"   v={window.fmt.pct(s.nrr)} d={s.nrrDelta} dUnit="pp"
          sub={`GRR ${window.fmt.pct(s.grr)} · Logo ${window.fmt.pct(s.logoRetention)}`} />
        <VitalCard k="Usage · Activation" v={window.fmt.pct(s.activation)} d={s.activationDelta} dUnit="pp"
          sub={`Churn ${window.fmt.pct(s.churnRate, 1)} · NPS ${s.nps}`} />
      </div>

      {/* Funnel heatmap + NNM */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 14 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Funnel · {s.funnel.length} stages</div>
            <button style={chromeBtnStyleSmall} onClick={() => onNav && onNav("pipeline", { saas: s.id })}>
              <span style={{ fontSize: 11 }}>open kanban →</span>
            </button>
          </div>
          <FunnelLadder stages={s.funnel} accent={tone} />
          {s.funnel.some(f => f.flag === "bottleneck") && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--neg-soft)", border: "1px solid oklch(0.68 0.18 25 / 0.30)", borderRadius: "var(--r-2)" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--neg)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Bottleneck detected</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "var(--fg-1)" }}>
                Conversion at <span className="mono tnum">{window.fmt.pct(s.funnel.find(f => f.flag === "bottleneck").conv)}</span> is below the 14d baseline by ≥10pp.
                <button onClick={() => onJump && onJump({ type: "pipeline", id: s.id, stage: s.funnel.find(f => f.flag === "bottleneck").stage })} style={{ marginLeft: 6, color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 11 }}>see stuck deals →</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Net New MRR · this month</div>
            <span className="mono dim" style={{ fontSize: 10 }}>waterfall · $</span>
          </div>
          <NNMWaterfall data={s.nnm} width={320} />
        </div>
      </div>
    </div>
  );
}

function DecompBar({ d }) {
  const tone = d.v >= 75 ? "var(--pos)" : d.v >= 50 ? "var(--warn)" : "var(--neg)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 32px 30px", gap: 8, alignItems: "center" }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>{d.k}</span>
      <div style={{ height: 5, background: "var(--bg-3)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${d.v}%`, background: tone, opacity: 0.85 }} />
      </div>
      <span className="mono tnum" style={{ fontSize: 11, color: "var(--fg-1)", textAlign: "right" }}>{d.v}</span>
      <span className="mono dim" style={{ fontSize: 10, textAlign: "right" }}>w{(d.w*100).toFixed(0)}</span>
    </div>
  );
}

function decompFromVitals(s) {
  // Fallback if .decomp absent
  return [
    { k: "Funnel",   v: Math.round(s.funnel.reduce((a,f)=>a+f.conv,0)/s.funnel.length*100), w: 0.25 },
    { k: "Sales",    v: Math.round(s.winRate * 200),         w: 0.25 },
    { k: "Customer", v: Math.round(s.nrr * 70),              w: 0.25 },
    { k: "Usage",    v: Math.round(s.activation * 100),      w: 0.25 },
  ];
}

function VitalCard({ k, v, d, dUnit, sub, invert }) {
  return (
    <div style={{ padding: "14px 16px", background: "var(--bg-1)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em" }}>{v}</span>
        {d != null && <DeltaInline value={d} unit={dUnit} invert={invert} />}
      </div>
      {sub && <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Hydrate SAAS items with decomposition data for legacy use
window.SEED.SAAS.forEach(s => {
  if (!s.decomp) {
    s.decomp = [
      { k: "Funnel",   v: Math.round(s.funnel.reduce((a,f)=>a+f.conv,0)/s.funnel.length*100), w: 0.25 },
      { k: "Sales",    v: Math.round(Math.min(100, s.winRate * 200)),  w: 0.25 },
      { k: "Customer", v: Math.round(Math.min(100, s.nrr * 70)),       w: 0.25 },
      { k: "Usage",    v: Math.round(Math.min(100, s.activation * 100)),w: 0.25 },
    ];
  }
});

export { SaasDashboardScreen, VitalCard, DecompBar };
