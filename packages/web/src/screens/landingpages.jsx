import React from "react";
import "./marketing.css";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, Card, LineChart } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { FunilHorizontal, InfoNota } from "../components/story.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";
import { buildFunnelRows, buildPalavraRows, pickLeader, LEADER_MIN_SESSIONS } from "../lib/lp-funnels.js";

// Visitas são sessões anônimas; pedidos e receita vêm do checkout do Elo.
// A união por origem é agregada: não existe vínculo individual beacon/pedido.
const centavos = (c) => fmt.money((c || 0) / 100);
export const LP_GRID = "minmax(160px, 2fr) minmax(80px, 1fr) minmax(90px, 1fr) minmax(110px, 1fr)";
export const LP_GRID_BUDGET = 524; // pisos 440 + três gaps de 16 + padding 36
// Funis/palavras da DM: 7 colunas (nome + sessões, CTA, pedidos, pagos, receita, conversão)
export const FUNIL_GRID = "minmax(150px, 2fr) repeat(5, minmax(64px, 1fr)) minmax(80px, 1fr)";
export const FUNIL_GRID_BUDGET = 690; // pisos 550 + seis gaps de 16 + padding 36
const centavosOuTraco = (c) => (c == null ? "—" : centavos(c));
const intOuTraco = (v) => (v == null ? "—" : fmt.int(v));

function FunilTabela({ head, rows, leaderId, money }) {
  const grid = { display: "grid", gridTemplateColumns: FUNIL_GRID, gap: 16, padding: "13px 18px", alignItems: "start" };
  const num = { textAlign: "right" };
  return <div className="tbl-x"><div style={{ minWidth: FUNIL_GRID_BUDGET }}>
    <div className="marketing-kicker" style={{ ...grid, marginTop: 14, background: "var(--bg-inset)" }}>
      <span>{head}</span><span style={num}>Sessões</span><span style={num}>CTA</span><span style={num}>Pedidos</span><span style={num}>Pagos</span><span style={num}>Receita</span><span style={num}>Conversão</span>
    </div>
    {rows.map((r) => <div key={r.key} style={{ ...grid, borderTop: "1px solid var(--line-1)", fontSize: 13.5 }}>
      <div style={{ minWidth: 0 }}>
        <strong>{r.name}</strong>{r.key === leaderId && <span title="líder do teste" style={{ marginLeft: 6 }}>👑</span>}
        {r.sub && <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{r.sub}</div>}
      </div>
      <span className="tnum" style={num}>{fmt.int(r.sessions)}</span>
      <span className="tnum" style={num}>{fmt.int(r.ctaSessions)}</span>
      <span className="tnum" style={num}>{money ? intOuTraco(r.created) : "—"}</span>
      <span className="tnum" style={num}>{money ? intOuTraco(r.approved) : "—"}</span>
      <strong className="tnum" style={num}>{money ? centavosOuTraco(r.revenue) : "—"}</strong>
      <span className="tnum" style={num}>{r.conversion == null ? "—" : fmt.pct(r.conversion, 1)}</span>
    </div>)}
  </div></div>;
}

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
  // Funis da DM (teste A/B/C): sessões na página de entrada × dinheiro do checkout.
  const funnelMoney = Boolean(conv?.by_funnel);
  const funnelRows = buildFunnelRows(d);
  const leader = pickLeader(funnelRows);
  const funilLinhas = funnelRows.map((r) => ({
    ...r, key: r.id, name: `${r.label} (${r.id})`,
    sub: r.id === "app" ? `${fmt.int(r.ctaSessions)} abriram a loja · conversão nas lojas` : r.checkoutSessions ? `${fmt.int(r.checkoutSessions)} chegaram ao checkout` : "",
  }));
  const palavraMoney = Boolean(conv?.by_palavra);
  const palavraLinhas = buildPalavraRows(d).map((r) => ({
    ...r, key: r.palavra, name: r.palavra,
    sub: Object.entries(r.byFunnel).map(([f, b]) => `${f}: ${fmt.int(b.sessions || 0)}${b.approved ? ` · ${b.approved} pago${b.approved > 1 ? "s" : ""}` : ""}`).join(" · "),
    conversion: r.approved == null || !r.sessions ? null : r.approved / r.sessions,
  }));
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
          <Card title="Funis" hint="teste A/B/C da DM · /go/<palavra>" style={{ overflow: "hidden" }}>
            <FunilTabela head="Funil" rows={funilLinhas} leaderId={leader?.id} money={funnelMoney} />
          </Card>
          <InfoNota>Sessões contam só a página de entrada de cada funil (LP, quiz ou /app). {leader ? `👑 líder por ${leader.metric} (${fmt.pct(leader.rate, 1)}).` : `Líder aparece com ${LEADER_MIN_SESSIONS}+ sessões por funil.`} O funil app não concorre: a conversão dele acontece nas lojas.{!funnelMoney && conv ? " Pedidos por funil aparecem quando o banco do Elo tiver a atribuição de funil." : ""}</InfoNota>
          <Card title="Palavras" hint="utm_content de cada vídeo" style={{ overflow: "hidden" }}>
            {!palavraLinhas.length ? <EmptyState title="Nenhuma palavra no período" hint="As palavras aparecem quando chegam visitas pelos links /go/<palavra>." />
              : <FunilTabela head="Palavra" rows={palavraLinhas} money={palavraMoney} />}
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
