import React from "react";
import { Avatar } from "../atoms.jsx";

// Cartões de desempenho por pessoa — a "quadradinho". Fonte ÚNICA usada tanto na
// Visão geral ("Desempenho do time") quanto na tela Análises → Equipe, pra os
// dois lugares mostrarem exatamente o mesmo layout e os mesmos números. Um
// cartão por pessoa, com as métricas do papel (SDR/closer/CS/mídia) e barra de
// progresso vs. meta (Ajustes → Equipe) onde há meta configurada.

export const asInt = (value) => window.fmt.int(Number(value) || 0);
export const asMoney = (value) => window.fmt.money(Number(value) || 0);
export const asRate = (value) => value == null ? "—" : `${String(Math.round(value * 10) / 10).replace(".", ",")}%`;

// Meta absoluta (mensal/semanal) reescalada pra QUANTIDADE DE DIAS da janela.
function scaledGoal(goal, days) {
  if (!goal?.target) return null;
  const base = goal.period === "week" ? 7 : 30.4;
  return Math.max(1, Math.round(goal.target * ((days || 30.4) / base)));
}

// Meta de calls agendadas DERIVADA do volume: leads do período anterior × meta
// de taxa de agendamento; sem isso, cai numa meta absoluta de callsBooked.
function bookingTarget(p, days) {
  const rate = p.sdr?.goals?.bookingRate?.target;
  const base = p.sdr?.leadsPrev ?? p.sdr?.leadsNew;
  if (rate > 0 && base > 0) return Math.round((base * rate) / 100);
  return scaledGoal(p.sdr?.goals?.callsBooked, days);
}

export function PersonMetric({ metric }) {
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

// Junta os papéis (sdr/closer/cs/social) numa pessoa só — a mesma pessoa pode
// aparecer em mais de um papel (ex.: SDR + closer).
export function buildPeople(score) {
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
  return people;
}

export const roleLabel = (p) => p.sdr && p.closer ? "SDR + closer" : p.closer && p.cs ? "CS + closer" : p.closer ? "closer" : p.sdr ? "SDR" : p.cs ? "CS / integrador" : "mídia social";

// Destaque = maior peso de receita + calls agendadas no período.
export const topPerformer = (people) => [...people].sort((a, b) => ((b.closer?.revenue || 0) + (b.sdr?.callsBooked || 0) * 100) - ((a.closer?.revenue || 0) + (a.sdr?.callsBooked || 0) * 100))[0]?.user;

// As métricas mostradas no cartão dependem do papel. Uma pessoa que é SDR E
// closer mostra o topo (agendamento) e o fundo (receita) do funil; um CS que
// também fecha mostra os dois lados pra nenhum sumir.
export function metricsFor(p, days) {
  if (p.sdr && p.closer) return [
    { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p, days), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, days), fmt: asMoney },
    { label: "Conversão na call", value: p.closer.conversaoCall, target: p.closer.goals?.conversaoCall?.target, good: 40, fmt: asRate, rate: true },
  ];
  if (p.closer && p.cs) return [
    { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, days), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, days), fmt: asMoney },
    { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
    { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
  ];
  if (p.closer) return [
    { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, days), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, days), fmt: asMoney },
    { label: "Win rate", value: p.closer.winRateCall, target: p.closer.goals?.winRateCall?.target, good: 25, fmt: asRate, rate: true },
  ];
  if (p.sdr) return [
    { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p, days), fmt: asInt },
    { label: "Taxa de agendamento", value: p.sdr.bookingRate, target: p.sdr.goals?.bookingRate?.target, good: 30, fmt: asRate, rate: true },
    { label: "Calls → ganho", value: p.sdr.callWinRate, target: p.sdr.goals?.callWinRate?.target, good: 25, fmt: asRate, rate: true },
  ];
  if (p.cs) return [
    { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
    { label: "Novas no período", value: p.cs.newAccounts, target: scaledGoal(p.cs.goals?.newAccounts, days), fmt: asInt },
    { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
  ];
  return [
    { label: "Posts", value: p.social?.postsPerMonth, target: scaledGoal(p.social?.goals?.postsPerMonth, days), fmt: asInt },
    { label: "Stories", value: p.social?.storiesPerMonth, target: scaledGoal(p.social?.goals?.storiesPerMonth, days), fmt: asInt },
    { label: "Ads", value: p.social?.adsPerMonth, target: scaledGoal(p.social?.goals?.adsPerMonth, days), fmt: asInt },
  ];
}

// Grade de cartões (um por pessoa). Clicar num cartão chama onPerson(userId).
export function TeamCards({ people, days, onPerson, highlight }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      {people.map((person) => (
        <section key={person.user} onClick={() => onPerson && onPerson(person.user)} style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: 24, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar id={person.user} name={person.name} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{person.name}</div>
              <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>{roleLabel(person)}</div>
            </div>
            {person.user === highlight && <span className="chip accent">destaque</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
            {metricsFor(person, days).map((metric) => <PersonMetric key={metric.label} metric={metric} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
