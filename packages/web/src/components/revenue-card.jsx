// Receita recorrente da carteira (Lever CRM, Fase 3), na análise de Clientes:
// os movimentos de MRR do mês (novo, expansão, contração, churn), o aviso das
// renovações da semana e da inadimplência antiga, e o aging das faturas.
// Lê GET /api/customers/revenue; os números saem do histórico de plano.

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Card } from "./viz.jsx";
import { AvisoTopo, BarraComposicao } from "./story.jsx";
import { openCustomer } from "../lib/open-record.js";

const money = (v) => window.fmt?.moneyFull ? window.fmt.moneyFull(v) : `R$ ${Math.round(v)}`;
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`;
const monthRange = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  const from = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from, to: `${next.getFullYear()}-${p(next.getMonth() + 1)}-01` };
};
const AGING_COLOR = { "1-30": "var(--warn)", "31-60": "color-mix(in srgb, var(--warn) 50%, var(--neg))", "61-90": "var(--neg)", "90+": "color-mix(in srgb, var(--neg) 70%, var(--fg-1))" };

export function RecurringRevenueCard({ saas }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const { from, to } = monthRange();
    api.customerRevenue({ from, to, saas }).then((x) => alive && setR(x)).catch((e) => alive && setError(e.message || "não carregou"));
    return () => { alive = false; };
  }, [saas]);
  if (error) return <Card><p className="mono dim" style={{ padding: "16px var(--inset-x)", margin: 0 }} role="alert">Receita recorrente: {error}</p></Card>;
  if (!r) return <Card><p className="mono dim" style={{ padding: "16px var(--inset-x)", margin: 0 }}>carregando receita recorrente…</p></Card>;
  const t = r.movements.totals;
  const semana = r.renewals[7] || [];
  const antiga = ["61-90", "90+"].reduce((n, k) => n + (r.aging.buckets[k]?.amount || 0), 0);
  const parts = [["Novo", t.novo, "pos"], ["Expansão", t.expansao, "pos"], ["Contração", t.contracao, "neg"], ["Churn", t.churn, "neg"]];
  return <Card>
    <div style={{ padding: "20px var(--inset-x)", display: "flex", flexDirection: "column", gap: 16 }}>
      {semana.length > 0 && <AvisoTopo tom="warn" titulo={`${semana.length} ${semana.length === 1 ? "renovação vence" : "renovações vencem"} em até 7 dias`}
        nota={semana.slice(0, 3).map((x) => `${x.name} (${x.days} d)`).join(" · ")}
        acao={{ label: "Abrir o primeiro", onClick: () => openCustomer(semana[0].customer) }} />}
      {antiga > 0 && <AvisoTopo tom="neg" titulo={`${money(antiga)} em atraso há mais de 60 dias`} nota="Cobrança antiga raramente volta sozinha: fale com o cliente hoje." />}
      <div>
        <div className="kicker accent">Receita recorrente do mês</div>
        <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6, color: t.liquido < 0 ? "var(--neg)" : "var(--fg-1)" }}>{signed(t.liquido)} <span style={{ fontSize: 14, color: "var(--fg-3)", fontWeight: 500 }}>de MRR líquido</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16, paddingTop: 14, borderTop: "1px solid var(--line-1)" }}>
        {parts.map(([label, v, tom]) => <div key={label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{label}</div>
          <div className="tnum" style={{ fontSize: 17, fontWeight: 700, marginTop: 2, color: v ? `var(--${tom})` : "var(--fg-4)" }}>{signed(v)}</div>
        </div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
        {[7, 15, 30, 60].map((d) => <div key={d} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>Renovam em até {d} d</div>
          <div className="tnum" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{(r.renewals[d] || []).length}</div>
          <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{money((r.renewals[d] || []).reduce((n, x) => n + x.mrr, 0))}/mês</div>
        </div>)}
      </div>
      {r.aging.total > 0 && <BarraComposicao bare titulo="Inadimplência por idade do atraso" sub={`${money(r.aging.total)} em aberto`} total={r.aging.total}
        fatias={Object.entries(r.aging.buckets).filter(([, b]) => b.amount > 0).map(([k, b]) => ({ rotulo: `${k} dias`, valor: b.amount, cor: AGING_COLOR[k], texto: money(b.amount) }))} />}
    </div>
  </Card>;
}
