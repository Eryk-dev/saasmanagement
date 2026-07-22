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

// Meta absoluta (mensal/semanal) reescalada pros DIAS ÚTEIS da janela. O time
// não opera no fim de semana, então a meta se distribui só nos dias úteis (base
// = 21,75 úteis/mês ≈ 261/12; 5 úteis/semana) — cada dia útil carrega a fatia do
// fim de semana. Janela sem dia útil (ex.: "ontem" num domingo) não cobra meta.
export function scaledGoal(goal, bizDays) {
  if (!goal?.target || !(bizDays > 0)) return null;
  const base = goal.period === "week" ? 5 : 21.75;
  return Math.max(1, Math.round(goal.target * (bizDays / base)));
}

// Meta de calls agendadas: a CONFIGURADA vence (a tela Metas a deriva do pace,
// já repartida entre os SDRs, então é ela que fecha com a meta da empresa). Sem
// meta configurada, cai no alvo dinâmico: leads do período anterior × meta de
// taxa de agendamento.
function bookingTarget(p, bizDays) {
  const fixed = scaledGoal(p.sdr?.goals?.callsBooked, bizDays);
  if (fixed) return fixed;
  const rate = p.sdr?.goals?.bookingRate?.target;
  const base = p.sdr?.leadsPrev ?? p.sdr?.leadsNew;
  if (rate > 0 && base > 0) return Math.round((base * rate) / 100);
  return null;
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
// também fecha mostra os dois lados pra nenhum sumir. bizDays = dias ÚTEIS da
// janela (as metas absolutas não contam fim de semana).
// O cartão de cada pessoa mostra AS METAS DA VAGA DELA (as mesmas da tela
// Metas), com o realizado no período. A lista vem do servidor já com a parte de
// cada um (a meta de vaga é do time e o placar reparte), então aqui só resta
// formatar e reescalar a meta do MÊS pros dias úteis da janela — e só a de
// FLUXO: taxa é proporção, ticket é média e contas ativas é saldo.
function targetMetric(t, bizDays, p) {
  const rate = t.unit === "%";
  let target = t.kind === "flow" ? scaledGoal({ target: t.target, period: t.period }, bizDays) : t.target;
  // Sem meta configurada de calls agendadas, cai no alvo dinâmico (leads da
  // janela anterior × taxa de agendamento) em vez de ficar sem régua.
  if (target == null && t.metric === "callsBooked") target = bookingTarget(p, bizDays);
  return {
    label: t.label, value: t.value, target,
    fmt: t.unit === "R$" ? asMoney : rate ? asRate : asInt,
    rate, good: target || undefined,
  };
}

export function metricsFor(p, bizDays) {
  const rows = ["sdr", "closer", "cs", "social"].flatMap((role) => p[role]?.targets || []);
  // Uma pessoa pode acumular vagas (SDR + closer): a mesma métrica não pode
  // aparecer duas vezes no cartão.
  const seen = new Set();
  const metrics = rows.filter((t) => !seen.has(t.metric) && seen.add(t.metric)).map((t) => targetMetric(t, bizDays, p));
  // Vaga sem meta nenhuma configurada ainda: mantém o resumo antigo pra o cartão
  // não ficar vazio enquanto o Leo não preenche a tela Metas.
  return metrics.length ? metrics : legacyMetricsFor(p, bizDays);
}

function legacyMetricsFor(p, bizDays) {
  if (p.sdr && p.closer) return [
    { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p, bizDays), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, bizDays), fmt: asMoney },
    { label: "Conversão na call", value: p.closer.conversaoCall, target: p.closer.goals?.conversaoCall?.target, good: 33, fmt: asRate, rate: true },
  ];
  if (p.closer && p.cs) return [
    { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, bizDays), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, bizDays), fmt: asMoney },
    { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
    { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
  ];
  if (p.closer) return [
    { label: "Ganhos", value: p.closer.won, target: scaledGoal(p.closer.goals?.won, bizDays), fmt: asInt },
    { label: "Receita", value: p.closer.revenue, target: scaledGoal(p.closer.goals?.revenue, bizDays), fmt: asMoney },
    // Fechamento sobre as calls que ACONTECERAM: é a habilidade do closer, limpa
    // de no-show (o furo é cobrado no comparecimento do SDR). Mesma métrica dos
    // outros cartões de closer, pra não haver duas réguas pro mesmo trabalho.
    { label: "Conversão na call", value: p.closer.conversaoCall, target: p.closer.goals?.conversaoCall?.target, good: 33, fmt: asRate, rate: true },
  ];
  if (p.sdr) return [
    { label: "Calls agendadas", value: p.sdr.callsBooked, target: bookingTarget(p, bizDays), fmt: asInt },
    { label: "Contatos", value: p.sdr.contacted, target: scaledGoal(p.sdr.goals?.contacts, bizDays), fmt: asInt },
    { label: "Taxa de agendamento", value: p.sdr.bookingRate, target: p.sdr.goals?.bookingRate?.target, good: 30, fmt: asRate, rate: true },
    { label: "Calls → ganho", value: p.sdr.callWinRate, target: p.sdr.goals?.callWinRate?.target, good: 25, fmt: asRate, rate: true },
  ];
  if (p.cs) return [
    { label: "Contas ativas", value: p.cs.activeAccounts, fmt: asInt },
    { label: "Novas no período", value: p.cs.newAccounts, target: scaledGoal(p.cs.goals?.newAccounts, bizDays), fmt: asInt },
    { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target, good: 95, fmt: asRate, rate: true },
  ];
  return [
    { label: "Posts", value: p.social?.postsPerMonth, target: scaledGoal(p.social?.goals?.postsPerMonth, bizDays), fmt: asInt },
    { label: "Stories", value: p.social?.storiesPerMonth, target: scaledGoal(p.social?.goals?.storiesPerMonth, bizDays), fmt: asInt },
    { label: "Ads", value: p.social?.adsPerMonth, target: scaledGoal(p.social?.goals?.adsPerMonth, bizDays), fmt: asInt },
  ];
}

// Grade de cartões (um por pessoa). Clicar num cartão chama onPerson(userId).
export function TeamCards({ people, bizDays, onPerson, highlight }) {
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
            {metricsFor(person, bizDays).map((metric) => <PersonMetric key={metric.label} metric={metric} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
