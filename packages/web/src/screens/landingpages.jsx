import React from "react";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, Segmented, Card, LineChart, StatTile } from "../components/viz.jsx";
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
const pct = (r) => `${((r || 0) * 100).toFixed(1)}%`;

// Teste A/B das LPs mulher — uma dor por variante. O rotator público /lp/ab
// distribui o tráfego (atribuição fixa por visitante); cada variante manda o
// beacon com page="lp/mN" e carimba o pedido do checkout com lp_variant.
const AB_VARIANTS = [
  { id: "m1", dor: "Carga mental" },
  { id: "m2", dor: "Colegas de casa" },
  { id: "m3", dor: "Ele não se abre" },
  { id: "m4", dor: "Medo de esfriar" },
  { id: "m5", dor: "Celular no meio" },
];
// Amostra mínima por variante pra coroar líder — abaixo disso é ruído.
const AB_MIN_SESSIONS = 30;

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
  // "Visita LP" soma a LP principal e as variantes do teste A/B (lp/m1…m5).
  const lp = pages
    .filter((p) => p.page === "lp" || /^lp\/m[1-5]$/.test(p.page))
    .reduce(
      (acc, p) => ({
        sessions: acc.sessions + (p.sessions || 0),
        ctaSessions: acc.ctaSessions + (p.ctaSessions || 0),
        ctaClicks: acc.ctaClicks + (p.ctaClicks || 0),
      }),
      { sessions: 0, ctaSessions: 0, ctaClicks: 0 },
    );
  const checkout = page("checkout");

  // Placar do teste A/B: tráfego (beacon) × dinheiro (by_lp do banco do Elo).
  const byLp = conv?.by_lp || [];
  const lpMoney = (id) => byLp.find((r) => r.lp === id) || { created: 0, approved: 0, activated: 0, revenue_cents: 0 };
  const ab = AB_VARIANTS.map((v) => {
    const t = page(`lp/${v.id}`);
    const m = lpMoney(v.id);
    return {
      ...v,
      sessions: t.sessions,
      ctaSessions: t.ctaSessions,
      created: m.created,
      approved: m.approved,
      revenue: m.revenue_cents,
      ctaRate: t.sessions ? t.ctaSessions / t.sessions : 0,
      payRate: t.sessions ? m.approved / t.sessions : 0,
    };
  });
  const abHasTraffic = ab.some((v) => v.sessions > 0);
  const abHasPaid = ab.some((v) => v.approved > 0);
  // Líder: maior pago/sessão (ou CTA/sessão enquanto não há pagamento), com amostra mínima.
  const abLeader = (() => {
    const eligible = ab.filter((v) => v.sessions >= AB_MIN_SESSIONS);
    if (!eligible.length) return null;
    const key = abHasPaid ? "payRate" : "ctaRate";
    const best = [...eligible].sort((a, b) => b[key] - a[key])[0];
    return best && best[key] > 0 ? best.id : null;
  })();
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Sessões na LP" value={String(lp.sessions)} delta={`${lp.ctaClicks} cliques em CTA`} />
          <StatTile label="Sessões no checkout" value={String(checkout.sessions)} delta={lp.sessions ? `${Math.round((checkout.sessions / lp.sessions) * 100)}% da LP` : "—"} />
          <StatTile label="Pedidos no período" value={created != null ? String(created) : "—"} delta={approved != null ? `${approved} pagos` : "banco do Elo não configurado"} />
          <StatTile label="Receita no período" value={revenue != null ? centavos(revenue) : "—"} delta={created ? `conversão pedido→pago: ${created ? Math.round(((approved || 0) / created) * 100) : 0}%` : undefined} />
        </div>

        <Card title="Teste A/B — LPs mulher" hint="uma dor por variante · tráfego do beacon · dinheiro do checkout (lp_variant)">
          <div style={{ padding: "10px var(--inset-x) 16px" }}>
            {!abHasTraffic && (
              <div className="dim" style={{ fontSize: 12.5, padding: "8px 0", lineHeight: 1.55 }}>
                Sem visitas nas variantes no período. O rotator <span className="mono">/lp/ab</span> divide o tráfego
                entre <span className="mono">/lp/m1…m5</span> com atribuição fixa por visitante — cada variante manda o
                beacon e carimba o pedido do checkout com a variante.
              </div>
            )}
            {abHasTraffic && (
              <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ color: "var(--fg-4)", textAlign: "right" }}>
                    <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 500 }}>variante</th>
                    <th style={{ fontWeight: 500 }}>sessões</th>
                    <th style={{ fontWeight: 500 }}>CTA</th>
                    <th style={{ fontWeight: 500 }}>pedidos</th>
                    <th style={{ fontWeight: 500 }}>pagos</th>
                    <th style={{ fontWeight: 500 }}>receita</th>
                    <th style={{ fontWeight: 500 }}>conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {ab.map((v) => (
                    <tr key={v.id} style={{ borderTop: "1px solid var(--line-1)", textAlign: "right", background: v.id === abLeader ? "var(--bg-3)" : "transparent" }}>
                      <td style={{ textAlign: "left", padding: "5px 8px 5px 0", color: "var(--fg-2)", whiteSpace: "nowrap" }}>
                        {v.id} · {v.dor}
                        {v.id === abLeader && (
                          <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: "var(--accent)", color: "var(--bg-1, #111)", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em" }}>LÍDER</span>
                        )}
                      </td>
                      <td className="tnum">{v.sessions}</td>
                      <td className="tnum">{v.ctaSessions} <span style={{ color: "var(--fg-4)" }}>({pct(v.ctaRate)})</span></td>
                      <td className="tnum">{v.created}</td>
                      <td className="tnum" style={{ color: v.approved ? "var(--fg-1)" : "var(--fg-4)" }}>{v.approved}</td>
                      <td className="tnum">{centavos(v.revenue)}</td>
                      <td className="tnum">{v.sessions ? pct(abHasPaid ? v.payRate : v.ctaRate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12, lineHeight: 1.5 }}>
              conv. = {abHasPaid ? "pagos/sessão" : "CTA/sessão (ainda sem pagamento no período)"} · líder exige ≥{AB_MIN_SESSIONS} sessões na variante.
              Rotator <span className="mono">/lp/ab</span> mantém o visitante sempre na mesma variante; <span className="mono">?v=mN</span> força pra QA.
            </div>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Funil da página" hint={`últimos ${d.days || days} dias`}>
            <div style={{ padding: "14px var(--inset-x) 18px" }}>
              <FunnelLadder stages={funnel} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12 }}>
                visitas = sessões únicas do beacon · pedido/pago = checkout web (banco do Elo). Sem ligação 1:1 — leitura agregada do período.
              </div>
            </div>
          </Card>

          <Card title="Visitas na LP por dia" hint="sessões únicas">
            <div style={{ padding: "8px var(--inset-x) 16px" }}>
              <LineChart data={dailySeries} height={170} />
            </div>
          </Card>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Conversão por origem" hint="pedidos do checkout por UTM (utm_source · utm_campaign)">
            <div style={{ padding: "10px var(--inset-x) 16px" }}>
              {!conv && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>Configure ELO_DB_URL na API pra ver pedidos e receita por origem.</div>}
              {conv && !byUtm.length && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>sem pedidos no período</div>}
              {byUtm.length > 0 && (
                <div style={{ overflowX: "auto" }}><table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "var(--fg-4)", textAlign: "right" }}>
                      <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 500 }}>origem</th>
                      <th style={{ fontWeight: 500 }}>pedidos</th>
                      <th style={{ fontWeight: 500 }}>pagos</th>
                      <th style={{ fontWeight: 500 }}>ativados</th>
                      <th style={{ fontWeight: 500 }}>receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byUtm.map((u, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--line-1)", textAlign: "right" }}>
                        <td style={{ textAlign: "left", padding: "5px 8px 5px 0", color: "var(--fg-2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {u.source}{u.campaign ? ` · ${u.campaign}` : ""}
                        </td>
                        <td className="tnum">{u.created}</td>
                        <td className="tnum" style={{ color: u.approved ? "var(--fg-1)" : "var(--fg-4)" }}>{u.approved}</td>
                        <td className="tnum">{u.activated}</td>
                        <td className="tnum">{centavos(u.revenue_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </Card>

          <Card title="Visitas por origem" hint="sessões do beacon (UTM ou referrer derivado)">
            <div style={{ padding: "10px var(--inset-x) 16px" }}>
              {!sources.length && <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>sem visitas no período</div>}
              {sources.map((s) => {
                const max = Math.max(1, ...sources.map((x) => x.sessions));
                return (
                  <div key={s.source} style={{ display: "grid", gridTemplateColumns: "140px 1fr 56px", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 11 }} className="mono">
                    <span style={{ color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.source}</span>
                    <div style={{ height: 12, background: "var(--bg-3)", borderRadius: 2, position: "relative" }}>
                      <div style={{ position: "absolute", inset: 0, width: `${(s.sessions / max) * 100}%`, background: "var(--accent)", opacity: 0.85, borderRadius: 2 }} />
                    </div>
                    <span className="tnum" style={{ textAlign: "right", color: "var(--fg-2)" }}>{s.sessions}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Pagamentos por dia" hint="checkout web">
            <div style={{ padding: "8px var(--inset-x) 16px" }}>
              <LineChart data={paidSeries} height={150} />
            </div>
          </Card>

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
