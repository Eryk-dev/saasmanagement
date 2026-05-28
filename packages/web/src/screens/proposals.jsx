import React from "react";
import { Avatar } from "../atoms.jsx";
import { DeltaInline } from "../charts.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
// Proposals — Closer persona's hub. Open proposals + builder.

const { useState: useStPr } = React;

function ProposalsScreen() {
  const { PROPOSALS, PEOPLE } = window.SEED;
  const [tab, setTab] = useStPr("open"); // open | builder

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {[["open","Abertas · rastreadas"],["builder","Editor"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: "5px 12px", borderRadius: "var(--r-2)",
              background: tab === k ? "var(--bg-3)" : "transparent",
              color: tab === k ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12,
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>+ de template</span></button>
          <button style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}><span style={{ fontSize: 11 }}>+ nova proposta</span></button>
        </div>
      </div>

      {tab === "open" && (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
            <SmallStat k="Enviadas (mês)" v="14" d={+3} />
            <SmallStat k="Taxa de abertura"      v="79%" d={+0.04} dU="pp" />
            <SmallStat k="Tempo na seção (mediana)" v="3:21" sub="seção de Preços" />
            <SmallStat k="Aceitação"     v="34%" d={+0.06} dU="pp" />
          </div>
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "1.6fr 80px 100px 90px 1fr 70px 90px",
              padding: "10px 16px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)",
              letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
              <span>Proposta</span><span style={{ textAlign: "right" }}>Valor</span><span>Status</span>
              <span>Aberturas</span><span>Seções vistas</span><span>Última</span><span>Rep</span>
            </div>
            {PROPOSALS.map(p => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 80px 100px 90px 1fr 70px 90px",
                padding: "10px 16px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.title}</div>
                </div>
                <span className="mono tnum" style={{ textAlign: "right" }}>{window.fmt.money(p.amount)}</span>
                <span className={"chip " + (p.status === "stale" ? "neg" : p.status === "negotiation" ? "pos" : p.status === "viewed" ? "info" : "")}>
                  <span className="dot" /> {p.status}
                </span>
                <span className="mono tnum" style={{ fontSize: 12 }}>{p.opens}</span>
                <div style={{ display: "flex", gap: 3 }}>
                  {["Cover","Approach","Pricing","Terms"].map(sec => (
                    <span key={sec} style={{
                      padding: "1px 6px", borderRadius: 3, fontSize: 10, fontFamily: "var(--mono)",
                      background: p.sectionsViewed.includes(sec) ? "var(--accent-soft)" : "var(--bg-3)",
                      color: p.sectionsViewed.includes(sec) ? "var(--accent)" : "var(--fg-4)",
                      border: "1px solid " + (p.sectionsViewed.includes(sec) ? "var(--accent-line)" : "var(--line-1)"),
                    }}>{sec[0]}</span>
                  ))}
                </div>
                <span className="mono dim tnum" style={{ fontSize: 11 }}>{p.lastOpen}</span>
                <Avatar id={p.rep} name={p.rep} size={20} />
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "builder" && <ProposalBuilder />}
    </div>
  );
}

function SmallStat({ k, v, d, dU, sub }) {
  return (
    <div style={{ padding: "12px 14px", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <span className="mono tnum" style={{ fontSize: 18, fontWeight: 500 }}>{v}</span>
        {d != null && <DeltaInline value={d} unit={dU || "int"} />}
      </div>
      {sub && <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────── Proposal Builder
function ProposalBuilder() {
  const [active, setActive] = useStPr("Pricing");
  const sections = [
    { k: "Cover",      icon: "■" },
    { k: "Approach",   icon: "▥" },
    { k: "Pricing",    icon: "$"  },
    { k: "Terms",      icon: "✎"  },
    { k: "Appendix",   icon: "+" },
  ];
  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "200px 1fr 280px", minHeight: 0 }}>
      {/* Block palette */}
      <div style={{ borderRight: "1px solid var(--line-1)", background: "var(--bg-1)", padding: "14px 12px", overflow: "auto" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Seções</div>
        {sections.map(s => (
          <button key={s.k} onClick={() => setActive(s.k)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px",
            borderRadius: "var(--r-2)", marginBottom: 2,
            background: active === s.k ? "var(--bg-3)" : "transparent",
            color: active === s.k ? "var(--fg-1)" : "var(--fg-3)",
            fontSize: 12, textAlign: "left",
          }}>
            <span className="mono dim" style={{ width: 14 }}>{s.icon}</span>
            {s.k}
          </button>
        ))}
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "16px 0 8px" }}>Blocos</div>
        {["Título","Texto rico","Tabela","Tabela de preços","Imagem","Variáveis","Aprovação"].map(b => (
          <div key={b} draggable style={{ padding: "6px 10px", border: "1px dashed var(--line-2)", borderRadius: 4, fontSize: 11, color: "var(--fg-3)", marginBottom: 4, cursor: "grab" }}>
            <span className="mono dim" style={{ marginRight: 6 }}>⋮⋮</span> {b}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div style={{ overflow: "auto", padding: 28, background: "var(--bg-0)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "40px 48px", minHeight: "100%" }}>
          <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em" }}>PROPOSTA · {active.toUpperCase()}</div>
          <h2 style={{ fontSize: 24, fontWeight: 500, margin: "8px 0 6px", letterSpacing: "-0.01em" }}>
            {{ Cover: "Helios Media — Q2 Performance Engagement",
               Approach: "Nossa abordagem para Helios Media",
               Pricing: "Investimento & termos",
               Terms: "Termos e condições",
               Appendix: "Apêndice" }[active]}
          </h2>
          <div className="mono dim" style={{ fontSize: 12 }}>preparado por Mika Kessler · {new Date().toDateString()}</div>

          {active === "Pricing" && (
            <div style={{ marginTop: 22 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 100px", gap: 1, background: "var(--line-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", overflow: "hidden" }}>
                {["Módulo","Assentos","Unitário","Total"].map(h => <div key={h} style={{ padding: "10px 12px", background: "var(--bg-inset)", fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--mono)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{h}</div>)}
                {[["LeverAds Core","50","$1,200","$60,000"],["Multi-touch attribution","50","$280","$14,000"],["Premium support","—","$1,000","$10,000"]].map((row,i)=>(
                  <React.Fragment key={i}>
                    {row.map((c,j) => <div key={j} style={{ padding: "10px 12px", background: "var(--bg-1)", fontSize: 13, fontFamily: j === 0 ? "var(--sans)" : "var(--mono)", color: j === 3 ? "var(--fg-1)" : "var(--fg-2)" }}>{c}</div>)}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, fontFamily: "var(--mono)" }}>
                <div style={{ textAlign: "right" }}>
                  <div className="mono dim" style={{ fontSize: 11 }}>anual</div>
                  <div className="mono tnum" style={{ fontSize: 22, fontWeight: 500 }}>$84,000</div>
                </div>
              </div>
              <p className="mono dim" style={{ fontSize: 11, marginTop: 24, lineHeight: 1.5 }}>
                ▸ Variável dinâmica: deal.amount herda de Helios Media (d1). Edições aqui atualizam o registro do deal.
              </p>
            </div>
          )}
          {active !== "Pricing" && (
            <p style={{ marginTop: 22, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>
              <span className="mono dim">{"{{client.name}}"}</span> está explorando expandir sua operação de marketing de performance
              . Desenhamos um engajamento em fases que unifica o modelo de atribuição num só lugar, mantendo
              keeping <span className="mono dim">{"{{client.team_lead}}"}</span> no controle das decisões de campanha.
            </p>
          )}
        </div>
      </div>

      {/* Tracking */}
      <div style={{ borderLeft: "1px solid var(--line-1)", background: "var(--bg-1)", padding: "14px 14px", overflow: "auto" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Envio & rastreio</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {[
            { l: "Destinatário",    v: "ceo@helios.media" },
            { l: "Link único",      v: "✓ rastrear tempo por seção" },
            { l: "Expira",          v: "em 14 dias" },
            { l: "Auto-avanço",     v: "ao aceitar → Closed Won" },
            { l: "Notificar Slack", v: "#deals · @mika" },
          ].map(r => (
            <div key={r.l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)" }}>
              <span style={{ color: "var(--fg-4)" }}>{r.l}</span>
              <span style={{ color: "var(--fg-2)" }}>{r.v}</span>
            </div>
          ))}
        </div>
        <button style={{ width: "100%", padding: "10px 14px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Enviar proposta</button>
        <div className="mono dim" style={{ fontSize: 10, marginTop: 12 }}>Após enviar, aberturas, tempo por seção e aceite/recusa voltam pra linha do tempo do deal.</div>
      </div>
    </div>
  );
}

export { ProposalsScreen };
