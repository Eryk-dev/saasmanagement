import React from "react";
import "./marketing.css";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, Card, LineChart } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { FunilHorizontal, InfoNota } from "../components/story.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";

// Visitas são sessões anônimas; pedidos e receita vêm do checkout do Elo.
// A união por origem é agregada: não existe vínculo individual beacon/pedido.
const centavos = (c) => fmt.money((c || 0) / 100);
export const LP_GRID = "minmax(160px, 2fr) minmax(80px, 1fr) minmax(90px, 1fr) minmax(110px, 1fr)";
export const LP_GRID_BUDGET = 524; // pisos 440 + três gaps de 16 + padding 36

function LandingPagesScreen() {
  const [product] = useActiveSaas();
  const { win } = usePeriod();
  const days = win.days;
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    setData(null); setError("");
    if (product?.id !== "elo") return;
    let dead = false;
    setLoading(true);
    api.lpSummary("elo", days)
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setError(e?.message || "falhou"); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [product?.id, days, retry]);

  if (product?.id !== "elo") return <EmptyState title="Landing pages é do workspace do Elo" hint="Troque pro Elo no seletor de produto da barra lateral." />;

  const d = data || {};
  const page = (id) => (d.pages || []).find((p) => p.page === id) || { sessions: 0 };
  const conv = d.conversions;
  const byUtm = conv?.by_utm || [];
  const created = byUtm.reduce((n, u) => n + (u.created || 0), 0);
  const approved = byUtm.reduce((n, u) => n + (u.approved || 0), 0);
  const revenue = byUtm.reduce((n, u) => n + (u.revenue_cents || 0), 0);
  const origins = new Map();
  const origin = (k) => {
    if (!origins.has(k)) origins.set(k, { name: k, sessions: 0, created: 0, approved: 0, revenue: 0, campaigns: [] });
    return origins.get(k);
  };
  for (const x of d.sources || []) origin(x.source || "direto").sessions += Number(x.sessions) || 0;
  for (const u of byUtm) {
    const r = origin(u.source || "direto");
    r.created += Number(u.created) || 0;
    r.approved += Number(u.approved) || 0;
    r.revenue += Number(u.revenue_cents) || 0;
    if (u.campaign && !r.campaigns.includes(u.campaign)) r.campaigns.push(u.campaign);
  }
  const rows = [...origins.values()].sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);
  const grid = { display: "grid", gridTemplateColumns: LP_GRID, gap: 16, padding: "13px 18px", alignItems: "start" };
  return <div className="marketing-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
    <PageHead className="marketing-head" title="Landing pages" sub={`visitas e conversão do checkout por origem · ${win.label}`} />
    <div className="marketing-body">
      {error ? <EmptyState title="Não deu pra carregar o resumo" hint={error} action={<button className="inp" onClick={() => setRetry((v) => v + 1)}>Tentar de novo</button>} />
        : loading ? <div className="dim" role="status">carregando…</div> : <>
          <Card title="Da visita ao pagamento" hint={win.label}>
            <div className="marketing-lp-funnel" style={{ padding: "14px 18px 18px" }}>
              <FunilHorizontal bare degraus={[
                { rotulo: "visitas", valor: page("lp").sessions },
                { rotulo: "checkout", valor: page("checkout").sessions },
                ...(conv ? [{ rotulo: "pedidos", valor: created }, { rotulo: "pagos", valor: approved, nota: centavos(revenue) }] : []),
              ]} />
            </div>
          </Card>
          {!d.pages?.length && <InfoNota>Nenhuma visita registrada no período. Os pedidos e pagamentos continuam disponíveis abaixo quando o checkout está conectado.</InfoNota>}
          {!conv && <InfoNota>A conversão do checkout está indisponível. Pedidos e receita aparecem quando a integração do Elo está conectada.</InfoNota>}
          <Card title="Por origem" hint="de onde vêm as visitas e o que elas geram" style={{ overflow: "hidden" }}>
            {!rows.length ? <EmptyState title="Sem visitas nem pedidos no período" hint="Escolha outro período no filtro do topo." /> : <div className="tbl-x">
              <div style={{ minWidth: LP_GRID_BUDGET }}>
                <div className="marketing-kicker" style={{ ...grid, marginTop: 14, background: "var(--bg-inset)" }}><span>Origem</span><span style={{ textAlign: "right" }}>Visitas</span><span style={{ textAlign: "right" }}>Pedidos</span><span style={{ textAlign: "right" }}>Receita</span></div>
                {rows.map((r) => <div key={r.name} style={{ ...grid, borderTop: "1px solid var(--line-1)", fontSize: 13.5 }}>
                  <div style={{ minWidth: 0 }}><strong>{r.name}</strong><div style={{ marginTop: 3, fontSize: 11.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{r.campaigns.join(" · ")}</div></div>
                  <span className="tnum" style={{ textAlign: "right" }}>{fmt.int(r.sessions)}</span>
                  <div className="tnum" style={{ textAlign: "right" }}>{conv ? fmt.int(r.created) : "—"}<div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 3 }}>{conv ? `${fmt.int(r.approved)} pagos` : "indisponível"}</div></div>
                  <strong className="tnum" style={{ textAlign: "right" }}>{conv ? centavos(r.revenue) : "—"}</strong>
                </div>)}
              </div>
            </div>}
          </Card>
          <InfoNota>Visitas são sessões únicas. Pedidos e receita vêm do checkout, agrupados pela origem. A leitura é do período, sem ligação individual entre visita e pedido.</InfoNota>
          <details className="marketing-detail">
            <summary>Mais detalhes · evolução diária, planos e CTAs</summary>
            <div className="marketing-two-col">
              <div><h3 className="card-title">Visitas e pagamentos por dia</h3>
                <div className="marketing-kicker" style={{ marginTop: 12 }}>visitas na LP</div>
                <LineChart data={(d.daily || []).map((r) => ({ x: (r.d || "").slice(5), v: r.lp || 0 }))} height={128} />
                <div className="marketing-kicker">pagamentos</div>
                <LineChart data={(conv?.daily || []).map((r) => ({ x: (r.d || "").slice(5), v: r.approved || 0 }))} height={110} color="var(--chart-2)" />
              </div>
              <div><h3 className="card-title">Plano × método</h3>
                {!(conv?.by_plan || []).length && <p className="dim">Sem pedidos no período.</p>}
                {(conv?.by_plan || []).map((p, i) => <div key={i} className="marketing-toolbar" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12.5 }}><span>{p.plan === "annual" ? "anual" : "mensal"} · {p.method}</span><span className="tnum">{p.approved}/{p.created} pagos · {centavos(p.revenue_cents)}</span></div>)}
                {!!d.ctaLabels?.length && <h3 className="card-title" style={{ marginTop: 18 }}>CTAs mais clicados</h3>}
                {(d.ctaLabels || []).slice(0, 6).map((c) => <div key={c.label} className="marketing-toolbar" style={{ justifyContent: "space-between", padding: "6px 0", fontSize: 12.5 }}><span>{c.label}</span><strong className="tnum">{c.clicks}</strong></div>)}
              </div>
            </div>
          </details>
        </>}
    </div>
  </div>;
}
export { LandingPagesScreen };
