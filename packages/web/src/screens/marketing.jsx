import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, Sparkline } from "../atoms.jsx";
// Marketing — Meta Ads × funil por SaaS: investimento, CPL real (leads do
// Cockpit), custo por estágio (custo por call / por ganho emergem do funil),
// campanhas e série diária. Dados entram pelo sync (POST /api/marketing/sync);
// a conta de anúncio é configurada em Ajustes → Integrações.

const { useState, useEffect, useCallback } = React;

const RANGES = [["7", "7d"], ["30", "30d"], ["90", "90d"]];
const dayStr = (d) => d.toISOString().slice(0, 10);

function MarketingScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { version } = useData();
  const [active, setActive] = useState(saasId || SAAS[0]?.id);
  const [days, setDays] = useState("30");
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const metaConfigured = !!window.SEED?.CONFIG?.meta?.configured;
  const s = SAAS.find((x) => x.id === active);
  const hasAccount = !!s?.metaAdAccount;

  const range = useCallback(() => {
    const now = new Date();
    return { since: dayStr(new Date(now.getTime() - (Number(days) - 1) * 86400000)), until: dayStr(now) };
  }, [days]);

  const load = useCallback(async () => {
    if (!active) return;
    setM(await api.marketingMetrics(active, range()));
  }, [active, range]);
  useEffect(() => { load().catch(() => setM(null)); }, [load, version]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  async function sync() {
    setBusy(true);
    try {
      const r = await api.marketingSync({ saas: active, ...range() });
      const rep = r.report?.[active];
      flash(rep?.ok ? `sincronizado · ${rep.rows} linha(s) de campanha` : `falhou: ${rep?.error || "?"}`);
      await load();
    } catch (err) {
      flash(err.status === 503 ? "META_ACCESS_TOKEN não configurado no servidor" : `erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!SAAS.length) return <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes." />;

  const t = m?.totals;
  const money = (v) => (v == null ? "—" : window.fmt.money(v));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {SAAS.map((x) => (
              <button key={x.id} onClick={() => setActive(x.id)} style={{
                height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
                border: "1px solid " + (active === x.id ? "var(--line-strong)" : "var(--line-1)"),
                background: active === x.id ? "var(--bg-3)" : "var(--bg-2)",
                color: active === x.id ? "var(--fg-1)" : "var(--fg-3)",
                fontSize: 12, fontFamily: "var(--mono)",
              }}>{x.name}</button>
            ))}
          </div>
          <span style={{ color: "var(--line-2)" }}>·</span>
          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map(([k, l]) => (
              <button key={k} onClick={() => setDays(k)} style={{
                height: 24, padding: "0 9px", borderRadius: 4,
                border: "1px solid " + (days === k ? "var(--accent-line)" : "var(--line-1)"),
                background: days === k ? "var(--accent-soft)" : "var(--bg-2)",
                color: days === k ? "var(--accent)" : "var(--fg-3)",
                fontSize: 11, fontFamily: "var(--mono)",
              }}>{l}</button>
            ))}
          </div>
        </div>
        {metaConfigured && hasAccount && (
          <PrimaryButton onClick={sync} disabled={busy}>{busy ? "Sincronizando…" : "⟳ sincronizar Meta"}</PrimaryButton>
        )}
      </div>

      {toast && <div className="mono" style={{ padding: "8px 24px", fontSize: 11, color: "var(--accent)", borderBottom: "1px solid var(--line-1)" }}>{toast}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {!metaConfigured ? (
          <EmptyState title="Meta Ads não conectada" hint="Defina META_ACCESS_TOKEN no servidor (token de system user com ads_read). Depois configure a conta de anúncio de cada SaaS em Ajustes → Integrações." />
        ) : !hasAccount ? (
          <EmptyState title={`${s?.name || "Este SaaS"} sem conta de anúncio`} hint="Configure o ad account (act_…) em Ajustes → Integrações → Meta Ads e sincronize." />
        ) : !m ? (
          <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>
        ) : !m.synced && !m.totals.leads ? (
          <EmptyState title="Sem dados no período" hint="Clique em “sincronizar Meta” pra puxar as campanhas deste período." action={<PrimaryButton onClick={sync} disabled={busy}>{busy ? "Sincronizando…" : "⟳ sincronizar Meta"}</PrimaryButton>} />
        ) : (
          <>
            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
              <Kpi k="Investimento" v={money(t.spend)} />
              <Kpi k="Leads (Cockpit)" v={t.leads} sub={`Meta reporta ${t.metaLeads}`} />
              <Kpi k="CPL real" v={money(t.cpl)} sub="investimento / leads criados" accent />
              <Kpi k="CPL Meta" v={money(t.cplMeta)} />
              <Kpi k="CPC" v={money(t.cpc)} sub={`${t.clicks.toLocaleString("pt-BR")} cliques`} />
              <Kpi k="CPM" v={money(t.cpm)} sub={`${t.impressions.toLocaleString("pt-BR")} impressões`} />
              <Kpi k="CTR" v={t.ctr == null ? "—" : t.ctr + "%"} />
            </div>

            {/* Série diária */}
            {m.series.length > 1 && (
              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px", marginBottom: 18 }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>investimento por dia</div>
                <Sparkline data={m.series.map((d) => d.spend)} width={Math.min(900, m.series.length * 30)} height={48} stroke="var(--accent)" />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(380px, 1.4fr)", gap: 14, alignItems: "start" }}>
              {/* Custo por estágio do funil */}
              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
                <div className="mono" style={{ padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
                  custo por estágio do funil
                </div>
                {m.perStage.map((st) => (
                  <div key={st.stage} style={{ display: "grid", gridTemplateColumns: "1fr 60px 100px", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--line-1)", fontSize: 13, alignItems: "center" }}>
                    <span>{st.stage}</span>
                    <span className="mono tnum dim" style={{ textAlign: "right", fontSize: 12 }}>{st.count}</span>
                    <span className="mono tnum" style={{ textAlign: "right", color: "var(--accent)" }}>{money(st.costPer)}</span>
                  </div>
                ))}
                <div className="mono dim" style={{ padding: "8px 14px", fontSize: 10 }}>leads que CHEGARAM no estágio (estágio atual ou posterior) ÷ investimento</div>
              </div>

              {/* Campanhas */}
              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", overflow: "hidden" }}>
                <div className="mono" style={{ display: "grid", gridTemplateColumns: "1.6fr 90px 90px 70px 90px", gap: 10, padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
                  <span>Campanha</span><span style={{ textAlign: "right" }}>Invest.</span><span style={{ textAlign: "right" }}>Cliques</span><span style={{ textAlign: "right" }}>Leads</span><span style={{ textAlign: "right" }}>CPL Meta</span>
                </div>
                {!m.campaigns.length && <div className="mono dim" style={{ padding: "14px", fontSize: 12 }}>sem campanhas no período — sincronize</div>}
                {m.campaigns.map((c) => (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 90px 90px 70px 90px", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--line-1)", fontSize: 13, alignItems: "center" }}>
                    <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || c.id}</span>
                    <span className="mono tnum" style={{ textAlign: "right", fontSize: 12 }}>{window.fmt.money(c.spend)}</span>
                    <span className="mono tnum dim" style={{ textAlign: "right", fontSize: 12 }}>{c.clicks.toLocaleString("pt-BR")}</span>
                    <span className="mono tnum dim" style={{ textAlign: "right", fontSize: 12 }}>{c.metaLeads}</span>
                    <span className="mono tnum" style={{ textAlign: "right", fontSize: 12 }}>{money(c.cplMeta)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ k, v, sub, accent }) {
  return (
    <div style={{ padding: "12px 14px", border: "1px solid " + (accent ? "var(--accent-line)" : "var(--line-1)"), borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{k}</div>
      <div className="mono tnum" style={{ fontSize: 20, marginTop: 4, color: accent ? "var(--accent)" : "var(--fg-1)" }}>{v}</div>
      {sub && <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export { MarketingScreen };
