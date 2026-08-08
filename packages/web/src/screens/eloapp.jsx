import React from "react";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, Segmented, Card, LineChart, StatTile } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { FunnelLadder } from "../charts.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";

// Análise do App — a leitura de performance do Elo (B2C self-serve): aqui não
// existe pipeline de vendas, então o "funil" é o do produto — checkout web
// (pedido → pago → conta ativada), assinaturas por canal (web/IAP), casais,
// missões reveladas e streaks. Dados vêm de GET /api/elo/overview, que consulta
// agregados no Postgres do próprio app (sem PII).

// R$/mês por plano pro MRR ESTIMADO (contagem de assinaturas × preço). Web e
// IAP cobram o mesmo hoje; quando o IAP reprecificar (R$37,90 / R$259), ajustar
// o lado iap aqui.
const PRICE = {
  web: { monthly: 27.9, annual: 197 / 12 },
  iap: { monthly: 27.9, annual: 197 / 12 },
};


function EloAppScreen() {
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
    api.eloOverview(days)
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setError(e?.message || "falhou"); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [product?.id, days]);

  if (product?.id !== "elo") {
    return <EmptyState title="Análise do App é do workspace do Elo" hint="Troque pro Elo no seletor de produto da barra lateral." />;
  }

  const head = (
    <PageHead title="Análise do App" sub="funil do checkout web · assinaturas · casais · missões · streaks · a janela vem do filtro do topo" />
  );

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <EmptyState title="Não deu pra ler o banco do Elo" hint={error} />
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
  if (data && data.configured === false) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <EmptyState title="Integração com o banco do Elo não configurada"
          hint="Defina ELO_DB_URL no ambiente da API (connection string da role read-only cockpit_reader do projeto Supabase do Elo) e recarregue." />
      </div>
    );
  }

  const d = data || {};
  const subs = d.subs || [];
  const orders = d.orders || {};
  const couples = d.couples || {};
  const streaks = d.streaks || {};
  const trials = d.trials || {};
  const missions = d.missions_period || {};

  // Assinaturas ativas por canal + MRR estimado (contagem × preço do plano).
  const active = subs.filter((s) => s.status === "active");
  const count = (rows) => rows.reduce((n, r) => n + (r.n || 0), 0);
  const activeWeb = count(active.filter((s) => s.channel === "web"));
  const activeIap = count(active.filter((s) => s.channel !== "web"));
  const mrr = active.reduce((sum, s) => {
    const table = PRICE[s.channel === "web" ? "web" : "iap"];
    return sum + (table[s.plan === "annual" ? "annual" : "monthly"] || 0) * (s.n || 0);
  }, 0);
  const pastDue = count(subs.filter((s) => ["past_due", "billing_issue"].includes(s.status)));

  const funnel = [
    { stage: "Pedido", count: orders.created_period || 0, conv: 1 },
    { stage: "Pago", count: orders.approved_period || 0, conv: (orders.created_period || 0) > 0 ? (orders.approved_period || 0) / orders.created_period : 0 },
    { stage: "Ativado", count: orders.activated_period || 0, conv: (orders.approved_period || 0) > 0 ? (orders.activated_period || 0) / orders.approved_period : 0 },
  ];

  const series = (rows, key) => (rows || []).map((r) => ({ x: (r.d || "").slice(5), v: r[key] || 0 }));
  const missionsDaily = d.missions_daily || [];
  const soloTotal = missionsDaily.reduce((n, r) => n + (r.solo || 0), 0);
  const revealedTotal = missionsDaily.reduce((n, r) => n + (r.revealed || 0), 0);

  const streakBuckets = [
    { label: "1–6", v: streaks.b1_6 || 0 },
    { label: "7–29", v: streaks.b7_29 || 0 },
    { label: "30–99", v: streaks.b30_99 || 0 },
    { label: "100+", v: streaks.b100 || 0 },
  ];
  const bucketMax = Math.max(1, ...streakBuckets.map((b) => b.v));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      {head}
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="MRR estimado" value={fmt.money(mrr)} title="assinaturas ativas × preço do plano" delta={`${activeWeb + activeIap} assinantes pagantes`} />
          <StatTile label="Assinantes ativos" value={String(activeWeb + activeIap)} delta={`${activeWeb} web · ${activeIap} lojas`} />
          <StatTile label="Trials ativos" value={String(trials.active ?? "—")} delta={`${trials.new_period ?? 0} novos no período`} />
          <StatTile label="Casais" value={`${couples.accepted ?? 0}/${couples.total ?? 0}`} delta="convite aceito / total" />
          <StatTile label="Casais ativos no período" value={String(missions.active_couples ?? 0)} delta={`${missions.revealed ?? 0} missões reveladas`} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Funil do checkout web" hint={`últimos ${d.days || days} dias`}>
            <div style={{ padding: "14px var(--inset-x) 18px" }}>
              <FunnelLadder stages={funnel} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                <span>receita no período: <b style={{ color: "var(--fg-2)" }}>{fmt.money((orders.revenue_cents_period || 0) / 100)}</b></span>
                <span>pago → ativado (mediana): <b style={{ color: "var(--fg-2)" }}>{orders.median_min_paid_to_activated != null ? `${orders.median_min_paid_to_activated} min` : "—"}</b></span>
                <span>em recuperação agora: <b style={{ color: (orders.in_recovery_now || 0) > 0 ? "var(--warn)" : "var(--fg-2)" }}>{orders.in_recovery_now ?? 0}</b></span>
                <span>recuperados no período: <b style={{ color: "var(--fg-2)" }}>{orders.recovered_period ?? 0}</b></span>
                {pastDue > 0 && <span>assinaturas past due: <b style={{ color: "var(--warn)" }}>{pastDue}</b></span>}
              </div>
            </div>
          </Card>

          <Card title="Pagamentos aprovados por dia" hint="checkout web">
            <div style={{ padding: "8px var(--inset-x) 16px" }}>
              <LineChart data={series(d.orders_daily, "approved")} height={170} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>
                pedidos criados no período: {orders.created_period ?? 0}
              </div>
            </div>
          </Card>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card title="Missões reveladas por dia" hint="o coração do produto — casal que revela volta amanhã">
            <div style={{ padding: "8px var(--inset-x) 16px" }}>
              <LineChart data={series(missionsDaily, "revealed")} height={170} />
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                <span>solo no período: {revealedTotal ? `${Math.round((soloTotal / revealedTotal) * 100)}%` : "—"}</span>
                <span>novos casais no período: {couples.new_period ?? 0} ({couples.new_accepted_period ?? 0} já com par)</span>
              </div>
            </div>
          </Card>

          <Card title="Streaks" hint="casais com streak vivo (missão ontem ou hoje)">
            <div style={{ padding: "14px var(--inset-x) 18px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, alignItems: "end", padding: "8px 4px" }}>
                {streakBuckets.map((b) => (
                  <div key={b.label} style={{ textAlign: "center" }}>
                    <div className="mono tnum" style={{ fontSize: 15, fontWeight: 600 }}>{b.v}</div>
                    <div style={{ height: 46, display: "flex", alignItems: "flex-end", justifyContent: "center", margin: "4px 0" }}>
                      <div style={{ width: 26, height: Math.max(3, (b.v / bucketMax) * 46), background: "var(--accent)", opacity: 0.85, borderRadius: 2 }} />
                    </div>
                    <div className="mono dim" style={{ fontSize: 10 }}>{b.label}</div>
                  </div>
                ))}
              </div>
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6, display: "flex", gap: 16 }}>
                <span>ativos: <b style={{ color: "var(--fg-2)" }}>{streaks.active ?? 0}</b></span>
                <span>maior atual: <b style={{ color: "var(--fg-2)" }}>{streaks.top_current ?? 0}</b></span>
                <span>recorde histórico: <b style={{ color: "var(--fg-2)" }}>{streaks.top_record ?? 0}</b></span>
              </div>
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
}

export { EloAppScreen };
