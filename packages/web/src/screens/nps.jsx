import React from "react";
import { HealthArc, Sparkline } from "../atoms.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// NPS aggregate — gauge + trend + breakdown + tag clusters + recent detractor drilldown

const { useState: useStN } = React;

function NPSScreen() {
  const { NPS, SAAS } = window.SEED;
  const [scope, setScope] = useStN("all"); // all | leverads | quill | mesa
  const list = scope === "all" ? NPS : NPS.filter(n => n.saas === scope);

  const promoters  = list.filter(n => n.score >= 9).length;
  const passives   = list.filter(n => n.score >= 7 && n.score <= 8).length;
  const detractors = list.filter(n => n.score <= 6).length;
  const total = list.length || 1;
  const score = Math.round((promoters/total - detractors/total) * 100);
  const trend = [40, 38, 42, 36, 30, 26, 22, 18];

  // Tag frequency
  const tagFreq = {};
  list.forEach(n => n.tags.forEach(t => tagFreq[t] = (tagFreq[t]||0)+1));
  const topTags = Object.entries(tagFreq).sort((a,b) => b[1]-a[1]).slice(0, 8);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {[["all","Portfólio"],["leverads","LeverAds"],["quill","Quill"],["mesa","Mesa"]].map(([k,l]) => (
          <button key={k} onClick={() => setScope(k)} style={{
            height: 26, padding: "0 12px", borderRadius: "var(--r-2)",
            border: "1px solid " + (scope === k ? "var(--line-strong)" : "var(--line-1)"),
            background: scope === k ? "var(--bg-3)" : "var(--bg-2)",
            color: scope === k ? "var(--fg-1)" : "var(--fg-3)",
            fontSize: 12, fontFamily: "var(--mono)",
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "18px 20px" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>NPS atual</div>
          <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
            <HealthArc value={Math.max(0, score + 100) / 2} size={140} strokeWidth={12} />
          </div>
          <div style={{ textAlign: "center" }}>
            <span className="mono tnum" style={{ fontSize: 38, fontWeight: 500 }}>{score}</span>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>últimos 90 dias · {total} respostas</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, marginTop: 16, background: "var(--line-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", overflow: "hidden" }}>
            <NPSCell label="Promotores"  v={promoters}  pct={promoters/total}  tone="var(--pos)" />
            <NPSCell label="Passivos"   v={passives}   pct={passives/total}   tone="var(--warn)" />
            <NPSCell label="Detratores" v={detractors} pct={detractors/total} tone="var(--neg)" />
          </div>
        </div>

        <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "18px 20px" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Tendência · 8 semanas</div>
          <Sparkline data={trend} width={600} height={64} stroke={trend[trend.length-1] < trend[0] ? "var(--neg)" : "var(--pos)"} />
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
            {trend[trend.length-1] - trend[0]} pts em 8sem — {trend[trend.length-1] < trend[0] ? "caindo" : "melhorando"} · concentração em <span style={{ color: "var(--fg-1)" }}>Quill</span>
          </div>

          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "20px 0 8px" }}>Top tags · {topTags.length}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {topTags.map(([t, n]) => (
              <span key={t} className="chip" style={{ height: 24, padding: "0 10px" }}>
                <span>{t}</span><span className="mono tnum dim">{n}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px", borderBottom: "1px solid var(--line-1)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Detratores recentes · {list.filter(n => n.score <= 6).length}</div>
          <span className="mono dim" style={{ fontSize: 11 }}>texto aberto · agrupado por tag</span>
        </div>
        {list.filter(n => n.score <= 6).map(n => {
          const saas = SAAS.find(s => s.id === n.saas);
          return (
            <div key={n.id} style={{ display: "grid", gridTemplateColumns: "60px 90px 1fr auto auto", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line-1)", alignItems: "start" }}>
              <span className="mono tnum" style={{ fontSize: 18, color: n.score <= 3 ? "var(--neg)" : "var(--warn)", fontWeight: 500 }}>{n.score}</span>
              <span className="mono dim" style={{ fontSize: 11, alignSelf: "center" }}>{saas?.name}</span>
              <div>
                <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.45 }}>{n.text}</div>
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {n.tags.map(t => <span key={t} className="chip neg" style={{ height: 18, padding: "0 6px" }}>{t}</span>)}
                </div>
              </div>
              <span className="mono dim" style={{ fontSize: 10 }}>{n.age}</span>
              <button style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>abrir ↗</span></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NPSCell({ label, v, pct, tone }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--bg-1)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 18, color: tone, marginTop: 2, fontWeight: 500 }}>{v}</div>
      <div className="mono dim" style={{ fontSize: 10 }}>{(pct*100).toFixed(0)}%</div>
    </div>
  );
}

export { NPSScreen };
