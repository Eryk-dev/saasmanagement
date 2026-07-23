import React from "react";
import { PageHead, StatTile, Card, LineChart } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";

// Aquisição — os NÚMEROS QUE IMPORTAM de Publicidade + Formulários num lugar só:
// o funil de aquisição (investido → impressões → cliques → visitas no form →
// começaram → leads → ganhos) + CPL, CTR, receita e ROAS. Tudo vem do
// /api/marketing/:saas (que já cruza gasto da Meta com visitas do form e leads
// do Cockpit) + o CAC do /api/metrics. Sem os detalhes de teste A/B (esses ficam
// na tela Formulários).
const { useState, useEffect, useMemo } = React;

const money = (n) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
const intBR = (n) => (Number(n) || 0).toLocaleString("pt-BR");
const dec = (n) => String(Math.round((Number(n) || 0) * 10) / 10).replace(".", ",");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const fmtPct = (n) => (n == null ? "" : `${dec(n)}%`);
const shortDay = (iso) => { const d = new Date(`${iso}T00:00:00`); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", ""); };

function AquisicaoScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  // Janela GLOBAL do cockpit (seletor no topo; aqui só lemos a janela).
  const { period, custom, win } = usePeriod();
  const [mkt, setMkt] = useState(null);
  const [biz, setBiz] = useState(null);

  useEffect(() => {
    if (!product?.id) return;
    let alive = true; setMkt(null); setBiz(null);
    api.marketingMetrics(product.id, { since: win.since, until: win.until }).then((m) => alive && setMkt(m)).catch(() => alive && setMkt(null));
    api.metrics(product.id, { days: win.days }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
    return () => { alive = false; };
  }, [product?.id, period, custom.since, custom.until, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  const t = mkt?.totals || {};
  const w = biz?.window || {};
  const funnel = [
    { label: "Impressões", value: Number(t.impressions) || 0 },
    { label: "Cliques", value: Number(t.clicks) || 0 },
    { label: "Visitas no form", value: Number(t.formViews) || 0 },
    { label: "Começaram", value: Number(t.formStarts) || 0 },
    { label: "Leads", value: Number(t.leads) || 0 },
    { label: "Ganhos", value: Number(t.won) || 0 },
  ];
  const fmax = Math.max(1, ...funnel.map((s) => s.value));
  const spendSeries = (mkt?.series || []).map((d) => ({ x: shortDay(d.date), v: Number(d.spend) || 0 }));
  const leadSeries = (mkt?.series || []).map((d) => ({ x: shortDay(d.date), v: Number(d.leads) || 0 }));
  const loading = mkt === null;

  const kicker = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Análise de Aquisição" sub="investimento em anúncios + conversão dos formulários · o funil de aquisição" />

      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {loading ? (
          <div className="mono dim" style={{ fontSize: 12, padding: "20px 0" }}>carregando…</div>
        ) : (
          <>
            {/* Os números que importam */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <StatTile label="Investido" value={money(t.spend)} delta={t.ctr != null ? `CTR ${dec(t.ctr)}%` : "sem anúncio no período"} />
              <StatTile label="Leads" value={intBR(t.leads)} delta={t.formViews ? `${fmtPct(pct(t.leads, t.formViews))} das visitas` : "no período"} />
              <StatTile label="Custo por lead" value={t.cpl != null ? money(t.cpl) : "—"} delta={t.cplMeta != null ? `Meta: ${money(t.cplMeta)}` : null} />
              <StatTile label="Ganhos" value={intBR(t.won)} delta={t.leads ? `${fmtPct(pct(t.won, t.leads))} dos leads` : null}
                title="Dos leads que ENTRARAM neste período, quantos já fecharam (coorte de aquisição). Pode diferir dos 'ganhos fechados no período' da Visão geral, que conta pela data do fechamento — as duas contas são certas, respondem perguntas diferentes." />
              <StatTile label="Receita" value={money(t.revenue)} delta={w.cac != null ? `CAC ${money(w.cac)}` : null}
                title="Receita dos ganhos desses leads (mesma coorte), pra casar com o investido no cálculo de ROAS e CAC." />
              <StatTile label="ROAS" value={t.roas != null ? `${dec(t.roas)}x` : "—"} tone={t.roas >= 1 ? "up" : t.roas != null ? "down" : "flat"} delta={t.roas != null ? "receita ÷ investido" : "sem receita/gasto"} />
            </div>

            {/* Funil de aquisição: anúncio → formulário → lead → ganho */}
            <Card title="Funil de aquisição" hint="do anúncio ao ganho · o % é a conversão do passo anterior">
              <div style={{ padding: "16px 24px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
                {funnel.map((s, i) => {
                  const prev = i > 0 ? funnel[i - 1].value : null;
                  const conv = prev != null ? pct(s.value, prev) : null;
                  return (
                    <div key={s.label} style={{ display: "grid", gridTemplateColumns: "minmax(72px, 150px) 1fr minmax(56px, 92px) minmax(38px, 60px)", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                      <div style={{ height: 20, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.max(2, Math.round((s.value / fmax) * 100))}%`, background: "var(--accent)", opacity: 0.85, borderRadius: "var(--r-1)" }} />
                      </div>
                      <span className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 700 }}>{intBR(s.value)}</span>
                      <span className="tnum" style={{ textAlign: "right", fontSize: 12, color: conv != null && conv < 100 ? "var(--fg-3)" : "var(--fg-4)" }}>{conv != null ? fmtPct(conv) : ""}</span>
                    </div>
                  );
                })}
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  visitas/leads incluem tráfego orgânico também (não só anúncio) · CTR = cliques ÷ impressões · conversão do form = leads ÷ visitas ({fmtPct(pct(t.leads, t.formViews)) || "—"})
                </div>
              </div>
            </Card>

            {/* Ritmo diário */}
            <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
              <Card title="Investido por dia" hint={mkt?.syncedAt ? "sincronizado da Meta" : "sem gasto sincronizado"}>
                <LineChart data={spendSeries} fmtValue={(v) => money(v)} />
              </Card>
              <Card title="Leads por dia">
                <LineChart data={leadSeries} color="var(--chart-2)" fmtValue={(v) => intBR(v)} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { AquisicaoScreen };
