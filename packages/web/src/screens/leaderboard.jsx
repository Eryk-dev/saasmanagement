import React from "react";
import { Avatar } from "../atoms.jsx";
import { DeltaInline } from "../charts.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// Leaderboard — Monthly | All-Time toggle. Multiple categories so bottom doesn't get crushed.

const { useState: useStLB } = React;

function LeaderboardScreen() {
  const { LEADERBOARD_MONTH, LEADERBOARD_ALL, PEOPLE } = window.SEED;
  const [scope, setScope] = useStLB("month");
  const data = scope === "month" ? LEADERBOARD_MONTH : LEADERBOARD_ALL;

  // Group by category
  const cats = {};
  data.forEach(r => { (cats[r.cat] = cats[r.cat] || []).push(r); });

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Ranking</h1>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>
            múltiplas categorias de vitória · reseta todo mês · all-time é histórico de carreira imutável
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, padding: 2, background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)" }}>
          {[["month","Este mês"],["all","All-time"]].map(([k,l]) => (
            <button key={k} onClick={() => setScope(k)} style={{
              padding: "5px 12px", borderRadius: 4,
              background: scope === k ? "var(--bg-0)" : "transparent",
              color: scope === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, border: "1px solid " + (scope === k ? "var(--line-2)" : "transparent"),
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
        {Object.entries(cats).map(([cat, rows]) => (
          <div key={cat} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{cat}</span>
              <span className="mono dim" style={{ fontSize: 10 }}>{scope === "month" ? "mai" : "carreira"}</span>
            </div>
            {rows.map(r => {
              const p = PEOPLE[r.person];
              return (
                <div key={r.cat + r.person + r.rank} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "20px auto 1fr auto auto", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 16 }}>{r.badge}</span>
                  <Avatar id={r.person} name={p?.name || r.person} size={26} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p?.name || r.person}</div>
                    <div className="mono dim" style={{ fontSize: 10 }}>{p?.role}</div>
                  </div>
                  <span className="mono tnum" style={{ fontSize: 16, fontWeight: 500 }}>{r.metric}</span>
                  {r.delta != null && <DeltaInline value={r.delta} unit="int" />}
                </div>
              );
            })}
            {scope === "month" && (
              <div style={{ padding: "8px 14px", background: "var(--bg-inset)", color: "var(--fg-4)", fontSize: 10, fontFamily: "var(--mono)" }}>
                3 últimos ocultos · CTA de coaching na fila
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, padding: "14px 16px", border: "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-inset)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Fila de coaching · só fundador</div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <CoachRow person="PR" reason="Ciclo 2.3× a mediana do ICP — pulando Discovery em 4 deals" />
          <CoachRow person="SS" reason="Conversão pra Qualify travada em 31% — abaixo da base do coorte" />
        </div>
      </div>
    </div>
  );
}

function CoachRow({ person, reason }) {
  const { PEOPLE } = window.SEED;
  const p = PEOPLE[person];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar id={person} name={p?.name} size={24} />
        <div>
          <div style={{ fontSize: 13 }}>{p?.name}</div>
          <div className="mono dim" style={{ fontSize: 10 }}>{p?.role}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="mono dim" style={{ fontSize: 11 }}>{reason}</span>
        <button style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
          <span style={{ fontSize: 11 }}>marcar 1:1</span>
        </button>
      </div>
    </div>
  );
}

export { LeaderboardScreen };
