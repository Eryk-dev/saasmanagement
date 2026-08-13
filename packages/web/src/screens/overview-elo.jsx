import React from "react";
import { usePeriod } from "../components/period-picker.jsx";
import { api } from "../lib/api.js";
import { fmt } from "../lib/format.js";
import { PageHead, StatTile, Card } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";

// Visão geral do WORKSPACE ELO — a manchete do app, não da venda assistida.
// O Elo é B2C self-serve: não tem SDR, call nem placar de time, então a tela de
// gestão aqui responde outra pergunta: "o app está vendendo, ativando e
// segurando os casais?". Meta do mês = receita APROVADA no checkout web do mês
// corrente vs. product.monthlyCashTarget (a mesma meta de Metas → Empresa).
// Dados: /api/elo/overview (agregados do banco do app) + custos do mês (aba
// Custos do Financeiro) pro resultado. A OverviewScreen normal continua valendo pros outros
// produtos — o App troca pra cá quando o produto ativo é o Elo.

const { useState, useEffect } = React;

// Mesma tabela da Análise do App: R$/mês por plano pro MRR estimado. IAP cobra
// o mesmo da web hoje; quando reprecificar (R$37,90 / R$259), ajustar aqui.
const PRICE = {
  web: { monthly: 27.9, annual: 197 / 12 },
  iap: { monthly: 27.9, annual: 197 / 12 },
};

const money = (v) => fmt.money(v || 0);

function EloOverviewScreen({ product, onNav }) {
  const [data, setData] = useState(null);
  const [costs, setCosts] = useState(null);
  const [error, setError] = useState("");

  // Janela GLOBAL do cockpit (filtro unico no topo, 08/08).
  const { win } = usePeriod();
  useEffect(() => {
    let alive = true;
    api.eloOverview(win.days)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e?.message || "falhou"));
    api.expensesSummary(product?.id || "elo").then((c) => alive && setCosts(c)).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, win.days]);

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const head = <PageHead title="Visão geral" sub={today} />;

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <EmptyState title="Não deu pra ler o banco do Elo" hint={error} />
      </div>
    );
  }
  if (data && data.configured === false) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {head}
        <EmptyState title="Integração com o banco do Elo não configurada"
          hint="Defina ELO_DB_URL no ambiente da API (role read-only cockpit_reader) e recarregue." />
      </div>
    );
  }

  const d = data || {};
  const subs = d.subs || [];
  const orders = d.orders || {};
  const month = d.month || {};
  const couples = d.couples || {};
  const trials = d.trials || {};
  const missions = d.missions_period || {};
  const streaks = d.streaks || {};

  const count = (rows) => rows.reduce((n, r) => n + (r.n || 0), 0);
  const active = subs.filter((s) => s.status === "active");
  const activeWeb = count(active.filter((s) => s.channel === "web"));
  const activeIap = count(active.filter((s) => s.channel !== "web"));
  const mrr = active.reduce((sum, s) => {
    const table = PRICE[s.channel === "web" ? "web" : "iap"];
    return sum + (table[s.plan === "annual" ? "annual" : "monthly"] || 0) * (s.n || 0);
  }, 0);

  // Meta do mês: receita aprovada no checkout web (MTD) vs. a meta da empresa.
  const target = Number(product?.monthlyCashTarget) || 0;
  const revenue = (month.revenue_cents || 0) / 100;
  const day = month.day || new Date().getDate();
  const daysInMonth = month.days_in_month || 30;
  const expected = target > 0 ? (target * day) / daysInMonth : 0;
  const ratio = target > 0 ? revenue / target : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const expPct = target > 0 ? Math.min(100, Math.round((expected / target) * 100)) : 0;
  const projected = day > 0 ? (revenue / day) * daysInMonth : 0;
  const status = target === 0 ? null
    : revenue >= expected ? { label: "no ritmo", tone: "var(--pos)" }
    : revenue >= expected * 0.75 ? { label: "quase no ritmo", tone: "var(--warn)" }
    : { label: "atrás do ritmo", tone: "var(--neg)" };

  // Resultado do mês = receita web aprovada no mês menos os custos operacionais.
  const result = costs ? revenue - (costs.total || 0) : null;

  // Precisa de atenção — só coisas com AÇÃO, dos dados reais do app.
  const paidNotActivated = ((orders.by_status || []).find((s) => s.status === "approved") || {}).n || 0;
  const attention = [
    paidNotActivated > 0 && {
      key: "ativacao",
      title: `${paidNotActivated} ${paidNotActivated === 1 ? "compra paga esperando" : "compras pagas esperando"} ativação`,
      sub: "pagou e ainda não entrou no app — a régua de 1h/24h está trabalhando; acompanhe o pagou→ativou",
      nav: "eloapp", cta: "ver funil",
    },
    (orders.in_recovery_now || 0) > 0 && {
      key: "recovery",
      title: `${orders.in_recovery_now} ${orders.in_recovery_now === 1 ? "pagamento" : "pagamentos"} em recuperação`,
      sub: "cartão recusado/Pix pendente na régua D0/D3/D7",
      nav: "eloapp", cta: "ver funil",
    },
    (trials.expiring_7d || 0) > 0 && {
      key: "trials",
      title: `${trials.expiring_7d} ${trials.expiring_7d === 1 ? "trial expira" : "trials expiram"} nos próximos 7 dias`,
      sub: "momento da conversão — vale conferir o funil e a comunicação",
      nav: "eloapp", cta: "ver análise",
    },
    (couples.pending || 0) > 0 && {
      key: "convites",
      title: `${couples.pending} ${couples.pending === 1 ? "casal com convite pendente" : "casais com convite pendente"}`,
      sub: "cadastrou e o par ainda não entrou — o lembrete de convite (24–48h) cobre isso",
      nav: "eloapp", cta: "ver análise",
    },
  ].filter(Boolean);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      {head}
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>

        <Card title="Meta do mês" hint="receita aprovada no checkout web · meta em Metas → Empresa">
          <div style={{ padding: "4px 24px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span className="tnum" style={{ fontFamily: "var(--display)", fontSize: 27, fontWeight: 700 }}>{money(revenue)}</span>
              {target > 0 && <span style={{ fontSize: 13, color: "var(--fg-3)" }}>de {money(target)} · {Math.round(ratio * 100)}%</span>}
              {status && (
                <span style={{ fontSize: 11, fontWeight: 700, color: status.tone, border: `1px solid color-mix(in srgb, ${status.tone} 40%, transparent)`, background: `color-mix(in srgb, ${status.tone} 10%, transparent)`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                  {status.label}
                </span>
              )}
            </div>
            {target > 0 && (
              <div title={`esperado até hoje: ${money(expected)}`}
                style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--bg-3)", margin: "10px 0 8px", overflow: "hidden" }}>
                <span style={{ position: "absolute", inset: 0, width: `${pct}%`, borderRadius: 999, background: ratio >= 1 ? "var(--pos)" : "var(--accent)" }} />
                <span style={{ position: "absolute", top: 0, bottom: 0, left: `${expPct}%`, width: 2, background: "var(--fg-2)", opacity: 0.65 }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
              {month.approved || 0} {month.approved === 1 ? "pagamento aprovado" : "pagamentos aprovados"} no mês · projeção {money(projected)} · dia {day} de {daysInMonth}
              {result != null && <> · resultado (receita − custos): <b style={{ color: result >= 0 ? "var(--pos)" : "var(--neg)" }}>{money(result)}</b></>}
            </div>
            {target === 0 && (
              <button onClick={() => onNav && onNav("metas")} style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--warn)", textAlign: "left" }}>
                sem meta de caixa definida · configure em Metas → Empresa
              </button>
            )}
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatTile label="MRR estimado" value={money(mrr)} delta={`${activeWeb + activeIap} pagantes · ${activeWeb} web · ${activeIap} lojas`} title="assinaturas ativas × preço do plano" />
          <StatTile label="Trials ativos" value={String(trials.active ?? "—")} delta={`${trials.new_period ?? 0} novos em 30d · ${trials.expiring_7d ?? 0} expirando em 7d`} />
          <StatTile label="Casais" value={`${couples.accepted ?? 0}/${couples.total ?? 0}`} delta={`convite aceito / total · ${couples.new_period ?? 0} novos em 30d`} />
          <StatTile label="Casais ativos · 30d" value={String(missions.active_couples ?? 0)} delta={`${missions.revealed ?? 0} missões reveladas`} />
          <StatTile label="Streaks vivos" value={String(streaks.active ?? 0)} delta={`recorde histórico: ${streaks.top_record ?? 0} dias`} />
        </div>

        <Card title="Precisa de atenção" hint="riscos e momentos de conversão · dados reais do app">
          <div style={{ padding: "10px 24px 18px" }}>
            {!data && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
            {data && attention.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Tudo em dia por aqui.</div>
            )}
            {attention.map((a) => (
              <button key={a.key} onClick={() => onNav && onNav(a.nav)}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 0", borderBottom: "1px solid var(--line-faint)", textAlign: "left" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>{a.sub}</div>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)", whiteSpace: "nowrap" }}>{a.cta}</span>
              </button>
            ))}
            <div style={{ marginTop: 10, paddingTop: 12, borderTop: "1px solid var(--line-faint)", display: "flex", gap: 14, flexWrap: "wrap" }}>
              <button onClick={() => onNav && onNav("eloapp")} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Análise do App →</button>
              <button onClick={() => onNav && onNav("landingpages")} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Landing pages →</button>
              <button onClick={() => onNav && onNav("expenses")} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>Financeiro →</button>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}

export { EloOverviewScreen };
