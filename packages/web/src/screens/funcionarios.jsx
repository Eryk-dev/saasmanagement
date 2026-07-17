import React from "react";
import { PageHead, FilterTab } from "../components/viz.jsx";
import { Avatar, EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { periodWindow, PRESETS } from "./overview.jsx";

// Funcionários — desempenho por pessoa. Reusa o placar por papel (SDR/closer/CS)
// da Visão geral (TeamPerformance + /api/scoreboard), mas como tela dedicada no
// menu Análises, com o próprio seletor de período. Clicar num nome abre o
// pipeline daquela pessoa.
const { useState, useEffect, useMemo } = React;

const asInt = (value) => window.fmt.int(Number(value) || 0);
const asMoney = (value) => window.fmt.money(Number(value) || 0);
const asRate = (value) => value == null ? "—" : `${String(Math.round(value * 10) / 10).replace(".", ",")}%`;

function scaledGoal(goal, days) {
  if (!goal?.target) return null;
  const base = goal.period === "week" ? 7 : 30.4;
  return Math.max(1, Math.round(goal.target * ((days || 30.4) / base)));
}

function PersonMetric({ metric }) {
  const hasTarget = metric.target > 0;
  const progress = hasTarget ? Math.min(100, Math.round((metric.value / metric.target) * 100)) : 0;
  const target = hasTarget ? metric.fmt(metric.target) : null;
  const color = metric.rate
    ? metric.value >= (metric.target || metric.good) ? "var(--pos)" : metric.value >= (metric.target || metric.good) * .66 ? "var(--warn)" : "var(--neg)"
    : "var(--fg-1)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontSize: 13.5 }}>
        <span style={{ color: "var(--fg-2)" }}>{metric.label}</span>
        <span className="tnum" style={{ fontWeight: 600, color }}>
          {metric.fmt(metric.value)}{target && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--fg-4)" }}> / {target}</span>}
        </span>
      </div>
      {hasTarget && !metric.rate && (
        <div style={{ height: 5, borderRadius: 999, background: "var(--bg-2)", overflow: "hidden", marginTop: 7 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: progress >= 100 ? "var(--pos)" : "var(--accent)", borderRadius: 999 }} />
        </div>
      )}
    </div>
  );
}

function FuncionariosScreen({ onNav }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("cockpit_func_period") || "30d"; } catch { return "30d"; } });
  const setP = (p) => { setPeriod(p); try { localStorage.setItem("cockpit_func_period", p); } catch { /* ignore */ } };
  const win = useMemo(() => periodWindow(period, {}), [period]);
  const [score, setScore] = useState(null);

  useEffect(() => {
    if (!product?.id) return;
    let alive = true; setScore(null);
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => alive && setScore(null));
    return () => { alive = false; };
  }, [product?.id, period, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicar num nome abre o pipeline filtrado por aquela pessoa (o pipeline lê a
  // pessoa do localStorage) — mesmo comportamento da Visão geral.
  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
  };

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  const people = [];
  const byUser = new Map();
  const merge = (role, row) => {
    if (!byUser.has(row.user)) {
      const person = { user: row.user, name: row.name || row.user };
      byUser.set(row.user, person); people.push(person);
    }
    byUser.get(row.user)[role] = row;
  };
  for (const role of ["sdr", "closer", "cs", "social"]) for (const row of score?.[role] || []) merge(role, row);

  const roleLabel = (p) => p.sdr && p.closer ? "SDR + closer" : p.closer && p.cs ? "CS + closer" : p.closer ? "closer" : p.sdr ? "SDR" : p.cs ? "CS / integrador" : "mídia social";
  const bookingTarget = (p) => {
    const rate = p.sdr?.goals?.bookingRate?.target;
    const base = p.sdr?.leadsPrev ?? p.sdr?.leadsNew;
    if (rate > 0 && base > 0) return Math.round((base * rate) / 100);
    return scaledGoal(p.sdr?.goals?.callsBooked, win.days);
  };
  const metricsFor = (p) => {
    if (p.sdr && p.closer) return [
      { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p), fmt: asInt },
      { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, win.days), fmt: asMoney },
      { label: "Conversão na call", value: p.closer.conversaoCall, target: p.closer.goals?.conversaoCall?.target, good: 40, fmt: asRate, rate: true },
    ];
    // CS que também fecha (integrador com ganho no campo closer): mostra o
    // fechamento E a carteira, senão um dos dois lados some do card.
    if (p.closer && p.cs) return [
      { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, win.days), fmt: asInt },
      { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, win.days), fmt: asMoney },
      { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
      { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
    ];
    if (p.closer) return [
      { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, win.days), fmt: asInt },
      { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, win.days), fmt: asMoney },
      { label: "Win rate", value: p.closer.winRateCall, target: p.closer.goals?.winRateCall?.target, good: 25, fmt: asRate, rate: true },
    ];
    if (p.sdr) return [
      { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p), fmt: asInt },
      { label: "Taxa de agendamento", value: p.sdr.bookingRate, target: p.sdr.goals?.bookingRate?.target, good: 30, fmt: asRate, rate: true },
      { label: "Calls → ganho", value: p.sdr.callWinRate, target: p.sdr.goals?.callWinRate?.target, good: 25, fmt: asRate, rate: true },
    ];
    if (p.cs) return [
      { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
      { label: "Novas no período", value: p.cs.newAccounts, target: scaledGoal(p.cs.goals?.newAccounts, win.days), fmt: asInt },
      { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
    ];
    return [
      { label: "Posts", value: p.social?.postsPerMonth, target: scaledGoal(p.social?.goals?.postsPerMonth, win.days), fmt: asInt },
      { label: "Stories", value: p.social?.storiesPerMonth, target: scaledGoal(p.social?.goals?.storiesPerMonth, win.days), fmt: asInt },
      { label: "Ads", value: p.social?.adsPerMonth, target: scaledGoal(p.social?.goals?.adsPerMonth, win.days), fmt: asInt },
    ];
  };
  const highlight = [...people].sort((a, b) => ((b.closer?.revenue || 0) + (b.sdr?.callsBooked || 0) * 100) - ((a.closer?.revenue || 0) + (a.sdr?.callsBooked || 0) * 100))[0]?.user;
  const coaching = people.flatMap((p) => {
    const checks = [
      p.closer && { label: "Win rate", value: p.closer.winRateCall, target: p.closer.goals?.winRateCall?.target || 25, advice: "revisar ancoragem de preço nas calls" },
      p.sdr && { label: "Calls → ganho", value: p.sdr.callWinRate, target: p.sdr.goals?.callWinRate?.target || 25, advice: "apertar o follow-up pós-call" },
      p.sdr && { label: "Taxa de agendamento", value: p.sdr.bookingRate, target: p.sdr.goals?.bookingRate?.target || 30, advice: "revisar a abordagem de qualificação" },
      p.cs && { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target || 95, advice: "revisar os pontos de risco do onboarding" },
    ].filter(Boolean).filter((c) => c.value != null && c.value < c.target);
    return checks.map((c) => ({ ...c, person: p, gap: c.target - c.value }));
  }).sort((a, b) => b.gap - a.gap).slice(0, 3);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Funcionários" sub="desempenho por pessoa · placar por papel (SDR · closer · CS)">
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {PRESETS.filter((p) => ["7d", "15d", "30d", "90d"].includes(p.key)).map((p) => (
            <FilterTab key={p.key} active={period === p.key} onClick={() => setP(p.key)}>{p.label}</FilterTab>
          ))}
        </div>
      </PageHead>
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {score == null && <div className="dim" style={{ fontSize: 12.5 }}>carregando…</div>}
        {score != null && !people.length && <EmptyState title="Sem atividade no período" hint="O desempenho por pessoa aparece quando o time movimenta leads e clientes." />}
        {people.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            {people.map((person) => (
              <section key={person.user} onClick={() => openPerson(person.user)} style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: 24, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar id={person.user} name={person.name} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{person.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>{roleLabel(person)}</div>
                  </div>
                  {person.user === highlight && <span className="chip accent">destaque</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                  {metricsFor(person).map((metric) => <PersonMetric key={metric.label} metric={metric} />)}
                </div>
              </section>
            ))}
          </div>
        )}

        {people.length > 0 && (
          <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px" }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Fila de coaching</h3>
              <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>onde cada pessoa está mais longe da meta</span>
            </div>
            {!coaching.length && <div style={{ borderTop: "1px solid var(--line-faint)", padding: "18px 24px", fontSize: 13, color: "var(--fg-3)" }}>Ninguém abaixo das metas principais neste período.</div>}
            {coaching.map((item) => (
              <div key={`${item.person.user}-${item.label}`} style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 24px", borderTop: "1px solid var(--line-faint)" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, width: 120, flexShrink: 0 }}>{item.person.name}</span>
                <span style={{ fontSize: 13, color: "var(--fg-2)", flex: 1 }}>{item.label} {asRate(item.value)} vs. meta {asRate(item.target)} — {item.advice}</span>
                <button onClick={() => openPerson(item.person.user)} style={{ height: 30, padding: "0 12px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", fontSize: 12.5, fontWeight: 600 }}>Abrir pipeline</button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export { FuncionariosScreen };
