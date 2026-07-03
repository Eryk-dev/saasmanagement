import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Segmented, StatTile, Card, LineChart } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
// Métricas — aquisição × funil do produto ativo (substitui a tela Marketing).
// Hoje: investimento (Meta), leads, CPL real e custo por etapa, com séries no
// tempo e quebra por campanha. CAC e LTV entram na fase de métricas de receita,
// nesta mesma tela.

const { useState, useEffect } = React;

const DAY = 86_400_000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const shortDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

const PERIODS = [
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

function MetricsScreen() {
  const { SAAS, CONFIG } = window.SEED;
  const { version } = useData();
  const product = SAAS[0];
  const metaOn = !!CONFIG?.meta?.configured;

  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(null);

  const load = () => {
    if (!product) return;
    const since = dayStr(Date.now() - (Number(days) - 1) * DAY);
    setData(null);
    api.marketingMetrics(product.id, { since }).then(setData).catch(() => setData({ error: true }));
  };
  useEffect(load, [product?.id, days, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sync() {
    setSyncing(true); setNote(null);
    try {
      await api.marketingSync({ saas: product.id, since: dayStr(Date.now() - 89 * DAY) });
      setNote({ ok: true, text: "Gasto sincronizado da Meta." });
      load();
    } catch (e) {
      setNote({ ok: false, text: e.message || "Falha ao sincronizar." });
    }
    setSyncing(false);
  }

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra acompanhar as métricas." />;

  const t = data && !data.error ? data.totals : null;
  const perStage = data && !data.error ? data.perStage : [];
  const costOf = (stage) => perStage.find((s) => s.stage === stage)?.costPer ?? null;
  const money = window.fmt.money;

  const spendSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.spend }));
  const leadSeries = (data?.series || []).map((d) => ({ x: shortDay(d.date), v: d.leads }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Métricas" sub={`aquisição e funil · ${product.name}`}>
        {metaOn && (
          <button onClick={sync} disabled={syncing} style={{ padding: "6px 12px", borderRadius: "var(--r-1)", fontSize: 12.5, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", opacity: syncing ? 0.6 : 1 }}>
            {syncing ? "Sincronizando…" : "↻ sincronizar Meta"}
          </button>
        )}
        <Segmented value={days} options={PERIODS} onChange={setDays} />
      </PageHead>

      <div style={{ padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        {note && (
          <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>
        )}

        {data && !data.error && !data.synced && (
          <Card>
            <div style={{ padding: "16px 18px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>Sem dados de anúncio no período</div>
                <div style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.55 }}>
                  {metaOn
                    ? "A integração com a Meta está ativa. Configure a conta de anúncio do produto em Ajustes (Integrações) e sincronize."
                    : "Conecte a Meta (variável META_ACCESS_TOKEN na API + conta de anúncio em Ajustes) ou aguarde a entrada manual de gasto, que chega na fase de marketing."}
                </div>
              </div>
              {metaOn && (
                <button onClick={sync} disabled={syncing} style={{ padding: "8px 14px", borderRadius: "var(--r-1)", fontSize: 13, fontWeight: 600, background: "var(--accent)", color: "var(--accent-fg)", opacity: syncing ? 0.6 : 1 }}>
                  {syncing ? "Sincronizando…" : "Sincronizar agora"}
                </button>
              )}
            </div>
          </Card>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 12 }}>
          <StatTile label="Investimento" value={t ? money(t.spend) : "…"} delta={t?.ctr != null ? `CTR ${String(t.ctr).replace(".", ",")}%` : null} />
          <StatTile label="Leads no período" value={t ? String(t.leads) : "…"} delta={t?.metaLeads ? `${t.metaLeads} reportados pela Meta` : null} />
          <StatTile label="Custo por lead" value={t?.cpl != null ? money(t.cpl) : "sem gasto"} delta={t?.cplMeta != null ? `${money(t.cplMeta)} na visão da Meta` : null} />
          <StatTile label="Custo por call" value={costOf("Call closer") != null ? money(costOf("Call closer")) : "sem dado"} delta="leads que chegaram à call" />
          <StatTile label="Custo por ganho" value={costOf("Ganho") != null ? money(costOf("Ganho")) : "sem dado"} delta="leads que fecharam" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Card title="Investimento por dia" hint="Meta Ads">
            <LineChart data={spendSeries} color="var(--chart-1)" fmtValue={(v) => money(v)} />
          </Card>
          <Card title="Leads por dia" hint="criados no cockpit">
            <LineChart data={leadSeries} color="var(--chart-2)" fmtValue={(v) => String(Math.round(v))} />
          </Card>
        </div>

        {data && !data.error && data.campaigns?.length > 0 && (
          <Card title="Por campanha" hint="CPL na visão da Meta · leads por UTM chegam na fase de marketing">
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Campanha", "Investimento", "Impressões", "Cliques", "Leads (Meta)", "CPL (Meta)"].map((h, i) => (
                      <th key={h} className="mono" style={{ textAlign: i === 0 ? "left" : "right", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 16px", borderTop: "1px solid var(--line-1)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: "11px 16px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--line-1)" }}>{c.name || c.id}</td>
                      <td className="tnum" style={tdNum}>{money(c.spend)}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.impressions)}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.clicks)}</td>
                      <td className="tnum" style={tdNum}>{window.fmt.int(c.metaLeads)}</td>
                      <td className="tnum" style={tdNum}>{c.cplMeta != null ? money(c.cplMeta) : "sem lead"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {perStage.length > 0 && t?.spend > 0 && (
          <Card title="Custo por etapa do funil" hint="investimento dividido pelos leads que chegaram em cada etapa">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(perStage.length, 6)}, minmax(0,1fr))`, gap: 8, padding: "12px 16px 16px" }}>
              {perStage.slice(0, 6).map((s) => (
                <div key={s.stage} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)" }}>
                  <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>
                    {s.costPer != null ? money(s.costPer) : "sem lead"}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.stage} · {s.count}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

const tdNum = { padding: "11px 16px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-1)", fontFamily: "var(--mono)" };

export { MetricsScreen };
