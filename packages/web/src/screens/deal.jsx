import React from "react";
import { Avatar } from "../atoms.jsx";
import { BigNumber } from "../charts.jsx";
// Deal detail drawer — slides over the pipeline when a card is opened.

function DealDetail({ deal, onClose }) {
  if (!deal) return null;
  const { PEOPLE, SAAS } = window.SEED;
  const owner = PEOPLE[deal.owner];

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
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em" }}>DEAL · {deal.id.toUpperCase()}</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{deal.title}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="chip">{deal.stage}</span>
              <span className="chip">{deal.source}</span>
              <span className={"chip " + (deal.score === "hot" ? "neg" : deal.score === "warm" ? "warn" : "")}>{deal.score}</span>
              {deal.flag === "stuck" && <span className="chip neg">travado {deal.age}d</span>}
            </div>
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <BigNumber value={window.fmt.money(deal.amount)} label="Valor" size={28} />
          <BigNumber value={`${deal.age}d`} label="Idade" size={28} />
          <BigNumber value={`${deal.contacts}`} label="Contatos" size={28} />
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Linha do tempo</div>
          {[
            { d: "há 1h",   t: `Proposta aberta ${deal.proposal ? "pela 4ª vez" : ""}`, k: "track" },
            { d: "há 2d",   t: "Notas da call de Discovery adicionadas", k: "note" },
            { d: "há 5d",   t: "Estágio movido Qualify → Discovery", k: "stage" },
            { d: "há 11d",  t: "Lead criado do form /pricing", k: "lead" },
          ].map((x,i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 60px 1fr", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-1)" }}>
              <span className="mono dim" style={{ fontSize: 10 }}>{x.d}</span>
              <span className="mono" style={{ fontSize: 10, color: x.k === "track" ? "var(--accent)" : x.k === "stage" ? "var(--pos)" : "var(--fg-3)", textTransform: "uppercase" }}>{x.k}</span>
              <span style={{ fontSize: 12 }}>{x.t}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Contatos</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Array.from({ length: deal.contacts }).slice(0,4).map((_, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar id={`c${i}${deal.id}`} name={"PA"[i]||"A"} size={22} />
                  <div>
                    <div style={{ fontSize: 12 }}>{["Sam Liu","Pat Werner","Asha P.","Niko B."][i]}</div>
                    <div className="mono dim" style={{ fontSize: 10 }}>{["Diretor Ops","VP Eng","Champion","Decisor"][i]}</div>
                  </div>
                </div>
                <span className="mono dim" style={{ fontSize: 10 }}>último contato há 2d</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Campos custom</div>
          {[
            ["Segmento ICP",         "Enterprise · 200+"],
            ["Comitê de compra",     "5–7"],
            ["Email do champion",    "champion@…"],
            ["Concorrência",         "Salesforce · ganhou"],
            ["Calc de ROI",          "abrir ↗"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12 }}>
              <span className="mono dim">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: "auto", padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)" }}>
          <button style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Registrar atividade</button>
          <button style={{ flex: 1, padding: "9px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Enviar proposta</button>
          <button style={{ padding: "9px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>⋯</button>
        </div>
      </div>
    </div>
  );
}

export { DealDetail };
