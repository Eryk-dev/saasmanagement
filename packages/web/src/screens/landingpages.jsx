import React from "react";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, Card, LineChart } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { FunnelLadder } from "../charts.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";

// Landing pages — desempenho das páginas públicas do Elo em relação a CONVERSÃO.
// Duas metades que se completam:
//   · visitas: beacon anônimo (/public/lp/events) que as páginas mandam por
//     sessão — view (carregou) e cta (clicou num botão de ação);
//   · dinheiro: pedidos do checkout web (criado → pago → ativado) por origem
//     UTM, lidos do banco do Elo.
// O funil da página junta as duas: sessão na LP → sessão no checkout → pedido
// criado → pago. Beacon e pedido não se ligam 1:1 (sem PII no beacon) — a
// junção é agregada, por período e por origem.


const centavos = (c) => fmt.money((c || 0) / 100);

function LandingPagesScreen() {
  const [product] = useActiveSaas();
  // Janela GLOBAL do cockpit (filtro unico no topo, 08/08).
  const { win } = usePeriod();
  const days = win.days;
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (product?.id !== "elo") return;
    let dead = false;
    setLoading(true);
    setError("");
    api.lpSummary("elo", days)
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setError(e?.message || "falhou"); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [product?.id, days]);

  if (product?.id !== "elo") {
    return <EmptyState title="Landing pages é do workspace do Elo" hint="Troque pro Elo no seletor de produto da barra lateral." />;
  }

  const head = (
    <PageHead title="Landing pages" sub="visitas do beacon · conversão do checkout web por origem · a janela vem do filtro do topo" />
  );

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <EmptyState title="Não deu pra carregar o resumo" hint={error} />
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <div className="dim" style={{ padding: "24px var(--pad-x)", fontSize: 12.5 }}>carregando…</div>
      </div>
    );
  }

  const d = data || {};
  const pages = d.pages || [];
  const sources = d.sources || [];
  const conv = d.conversions || null;
  const byUtm = conv?.by_utm || [];
  const byPlan = conv?.by_plan || [];

  const page = (id) => pages.find((p) => p.page === id) || { sessions: 0, ctaSessions: 0, ctaClicks: 0 };
  const lp = page("lp");
  const checkout = page("checkout");
  const created = conv ? byUtm.reduce((n, u) => n + (u.created || 0), 0) : null;
  const approved = conv ? byUtm.reduce((n, u) => n + (u.approved || 0), 0) : null;
  const revenue = conv ? byUtm.reduce((n, u) => n + (u.revenue_cents || 0), 0) : null;

  const noEvents = !pages.length;

  // Funil da página: sessões (beacon) até pedido/pago (banco do Elo).
  const funnel = [
    { stage: "Visita LP", count: lp.sessions, conv: 1 },
    { stage: "Checkout", count: checkout.sessions, conv: lp.sessions ? checkout.sessions / lp.sessions : 0 },
    ...(conv ? [
      { stage: "Pedido", count: created, conv: checkout.sessions ? created / checkout.sessions : 0 },
      { stage: "Pago", count: approved, conv: created ? approved / created : 0 },
    ] : []),
  ];

  const dailySeries = (d.daily || []).map((r) => ({ x: (r.d || "").slice(5), v: r.lp || 0 }));
  const paidSeries = (conv?.daily || []).map((r) => ({ x: (r.d || "").slice(5), v: r.approved || 0 }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      {head}
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>

        {noEvents && (
          <Card title="Beacon ainda sem visitas" hint="as páginas do Elo precisam mandar eventos pra cá">
            <div style={{ padding: "12px var(--inset-x) 18px", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55 }}>
              Nenhum evento de visita no período. O snippet do beacon (POST <span className="mono">/public/lp/events</span>)
              precisa estar publicado nas páginas <span className="mono">/lp</span>, <span className="mono">/checkout</span> e{" "}
              <span className="mono">/obrigado</span> do Elo. A parte de conversão (pedidos por origem) abaixo funciona
              mesmo sem o beacon.
            </div>
          </Card>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Funil da página" hint={`últimos ${d.days || days} dias`}>
            <div style={{ padding: "14px var(--inset-x) 18px" }}>
              <FunnelLadder stages={funnel} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12 }}>
                visitas = sessões únicas do beacon · pedido/pago = checkout web (banco do Elo). Sem ligação 1:1 — leitura agregada do período.
              </div>
            </div>
          </Card>

          {/* As duas curvas juntas: visita e pagamento no mesmo cartão, uma
              embaixo da outra, com a mesma escala de dias — comparar duas
              tendências em dois cartões distantes não funciona. */}
          <Card title="Visitas e pagamentos por dia" hint="beacon da LP e pedidos pagos do checkout">
            <div style={{ padding: "8px var(--inset-x) 16px" }}>
              <div className="kicker" style={{ marginBottom: 2 }}>visitas na LP</div>
              <LineChart data={dailySeries} height={128} />
              <div className="kicker" style={{ margin: "6px 0 2px" }}>pagamentos</div>
              <LineChart data={paidSeries} height={110} color="var(--chart-2)" />
            </div>
          </Card>
        </div>

        {/* POR ORIGEM, uma tabela só (13/09): eram dois cartões lado a lado
            respondendo a mesma pergunta — "de onde vem e o que rende" — com o
            leitor casando as linhas no olho. Visitas vêm do beacon e pedidos do
            checkout; a junção é por ORIGEM (não há ligação 1:1 sem PII). */}
        <Card title="Por origem" hint="visitas do beacon e pedidos do checkout na mesma linha">
          <div style={{ padding: "10px var(--inset-x) 16px" }}>
            {!conv && !sources.length && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>sem visitas nem pedidos no período</div>}
            {!conv && sources.length > 0 && <div className="dim" style={{ fontSize: 12.5, padding: "0 0 8px" }}>Configure ELO_DB_URL na API pra ver pedidos e receita por origem.</div>}
            {(sources.length > 0 || byUtm.length > 0) && (() => {
              const linhas = new Map();
              const pega = (k) => { if (!linhas.has(k)) linhas.set(k, { origem: k, sessions: 0, created: 0, approved: 0, revenue: 0, campanhas: [] }); return linhas.get(k); };
              for (const x of sources) pega(x.source || "direto").sessions += Number(x.sessions) || 0;
              for (const u of byUtm) {
                const r = pega(u.source || "direto");
                r.created += Number(u.created) || 0;
                r.approved += Number(u.approved) || 0;
                r.revenue += Number(u.revenue_cents) || 0;
                if (u.campaign) r.campanhas.push(u.campaign);
              }
              const lista = [...linhas.values()].sort((a, b) => (b.revenue - a.revenue) || (b.sessions - a.sessions));
              const maxSes = Math.max(1, ...lista.map((x) => x.sessions));
              return (
                <div className="tbl-x">
                  <div>
                    <div className="kicker" style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.4fr) minmax(90px,1fr) 84px 84px 110px", gap: 10, padding: "6px 0", fontWeight: 600 }}>
                      <span>Origem</span><span>Visitas</span><span style={{ textAlign: "right" }}>Pedidos</span><span style={{ textAlign: "right" }}>Pagos</span><span style={{ textAlign: "right" }}>Receita</span>
                    </div>
                    {lista.map((r) => (
                      <div key={r.origem} style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.4fr) minmax(90px,1fr) 84px 84px 110px", gap: 10, padding: "8px 0", alignItems: "center", borderTop: "1px solid var(--line-faint)", fontSize: 12.5 }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.origem}</span>
                          {r.campanhas.length > 0 && (
                            <span className="mono dim" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {r.campanhas.slice(0, 2).join(" · ")}{r.campanhas.length > 2 ? ` +${r.campanhas.length - 2}` : ""}
                            </span>
                          )}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span className="tnum" style={{ minWidth: 42 }}>{r.sessions || "—"}</span>
                          <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-3)", minWidth: 24 }}>
                            <span style={{ display: "block", height: "100%", width: `${Math.round((r.sessions / maxSes) * 100)}%`, background: "var(--accent)", borderRadius: 3, opacity: 0.85 }} />
                          </span>
                        </span>
                        <span className="tnum" style={{ textAlign: "right" }}>{r.created || "—"}</span>
                        <span className="tnum" style={{ textAlign: "right", color: r.approved ? "var(--pos)" : "var(--fg-4)" }}>{r.approved || "—"}</span>
                        <span className="tnum" style={{ textAlign: "right", fontWeight: 600 }}>{r.revenue ? centavos(r.revenue) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 10 }}>
              visitas = sessões únicas do beacon (UTM ou referrer derivado) · pedidos e receita = checkout web, por utm_source
            </div>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Plano × método" hint="pedidos do período">
            <div style={{ padding: "10px var(--inset-x) 16px" }}>
              {!byPlan.length && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>sem pedidos no período</div>}
              {byPlan.map((p, i) => (
                <div key={i} className="mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderTop: i ? "1px solid var(--line-1)" : "none", fontSize: 11 }}>
                  <span style={{ color: "var(--fg-2)" }}>{p.plan === "annual" ? "anual" : "mensal"} · {p.method}</span>
                  <span className="tnum">{p.approved}/{p.created} pagos · {centavos(p.revenue_cents)}</span>
                </div>
              ))}
              {(d.ctaLabels || []).length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="kicker" style={{ marginBottom: 4 }}>CTAs mais clicados</div>
                  {(d.ctaLabels || []).slice(0, 6).map((c) => (
                    <div key={c.label} className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0" }}>
                      <span style={{ color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                      <span className="tnum">{c.clicks}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

export { LandingPagesScreen };
