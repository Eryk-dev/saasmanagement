import { goalMilestone } from "../lib/goal-milestone.js";
import React from "react";
import "./overview.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Card } from "../components/viz.jsx";
import { EmptyState, Avatar } from "../atoms.jsx";
import { stageKind, isRealLead, isWonLead, wonAtOf, openStages } from "../lib/funnel.js";
import { bizDay } from "../lib/format.js";
import { canSeeScreen, userById, displayName } from "../lib/users.js";
import { levelLabel } from "../lib/levels.js";
import { useActiveSaas } from "../lib/workspace.js";
import { buildPeople, roleLabel, scaledGoal } from "../components/team-cards.jsx";
import { usePeriod, businessDaysBetween } from "../components/period-picker.jsx";
import { isChurned } from "../lib/churn.js";
import { dealProductLabel, closedPlanLabel } from "../lib/payments.js";
// CRM final: meta/funil e vendas na primeira linha; equipe/atenção e
// carteira/aquisição na segunda. As réguas e fontes financeiras são mantidas.

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
// Offset do fuso do NEGÓCIO (America/Sao_Paulo, o mesmo do bizDay). O Brasil
// não tem mais horário de verão desde 2019, então -03:00 vale o ano todo.
// Só serve pra virar um DIA da janela em instante; o resto da tela compara
// por string de bizDay.
const BIZ_TZ = "-03:00";
const moneyFull = (v) => window.fmt.moneyFull(v).replace(/^R\$(?!\s)/, "R$ ");
const money = (v) => window.fmt.money(v || 0);
const int = (v) => window.fmt.int(v || 0);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pctStr = (n) => (n == null ? "—" : String(Math.round(n * 10) / 10).replace(".", ",") + "%");
const compactMoney = (v) => {
  const n = Number(v) || 0;
  return n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(n));
};

// ── Escala de cores da meta ──────────────────────────────────────────────────
// vermelho = atrás do caminho · teal = no pace (a caminho, período aberto) ·
// verde = meta batida (100%+) · dourado = super meta (120%+). Pra taxa (que não
// acumula no tempo) o pace é 1: abaixo da meta é vermelho direto.
const LVL_COLOR = { red: "var(--neg)", ok: "var(--accent)", green: "var(--pos)", gold: "var(--gold)" };
const LVL_LABEL = { red: "atrás do pace", ok: "no pace", green: "meta batida", gold: "super meta" };
export function levelOf(value, target, expectedFrac = 1) {
  if (!(target > 0) || value == null) return null;
  const r = value / target;
  if (r >= 1.2) return "gold";
  if (r >= 1) return "green";
  return r >= Math.min(1, expectedFrac) - 1e-9 ? "ok" : "red";
}
const lvlColor = (lvl, fallback = "var(--fg-1)") => (lvl ? LVL_COLOR[lvl] : fallback);

// ── Super metas: de 20 em 20, sem teto ───────────────────────────────────────
// Bateu 100%, a régua rearma pro próximo degrau (120%, depois 140%, 160%…) e o
// "hoje" volta a cobrar ritmo contra ele — espelha a remuneração, que acima de
// 140% segue pagando por degrau de 20%. pct = quanto do degrau atual já foi.
export function ladderOf(value, target, expectedFrac = 1) {
  if (!(target > 0) || value == null) return null;
  const ratio = value / target;
  if (ratio < 1) return { ratio, tier: 1, pct: ratio, lvl: levelOf(value, target, expectedFrac), chip: null };
  const tier = 1.2 + 0.2 * Math.floor((ratio - 1) / 0.2 + 1e-9);
  const lvl = ratio >= 1.2 ? "gold" : "green";
  return { ratio, tier, pct: ratio / tier, lvl, chip: `${LVL_LABEL[lvl]} · rumo a ${Math.round(tier * 100)}%` };
}

function LvlChip({ lvl, label }) {
  if (!lvl) return null;
  if (lvl === "gold") return <span className="super-chip">✦ {label || "super meta"}</span>;
  const c = LVL_COLOR[lvl];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label || LVL_LABEL[lvl]}
    </span>
  );
}

// Dias ÚTEIS da janela que já passaram — e a fração deles (o pace do topo).
function elapsedBizDaysOf(win) {
  const today = bizDay(new Date());
  if (today < win.since) return 0;
  const end = today < win.until ? today : win.until;
  return businessDaysBetween(win.since, end);
}
function elapsedFracOf(win) {
  return Math.min(1, elapsedBizDaysOf(win) / Math.max(1, win.businessDays));
}
// Fração do MÊS que a janela já cobriu (base 21,75 úteis) — o pace de quem é
// medido contra a meta CHEIA do mês (as duas pernas da remuneração).
const monthFracOf = (win) => Math.min(1, elapsedBizDaysOf(win) / 21.75);

// ── Régua (barra de progresso com pace) ──────────────────────────────────────
// Exportada: a tela Metas usa a MESMA régua pra mostrar o efeito da meta que
// está sendo editada, senão as duas telas divergem no desenho.
export function Regua({ label, valueText, pct, expectedPct, lvl, chipLabel, title, sub }) {
  const fill = Math.min(100, Math.round((pct || 0) * 100));
  const exp = expectedPct != null ? Math.min(100, Math.round(expectedPct * 100)) : null;
  return (
    <div title={title} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</span>
        <span className="tnum" style={{ fontSize: 13, color: "var(--fg-2)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          {valueText}
          <LvlChip lvl={lvl} label={chipLabel} />
        </span>
      </div>
      <div style={{ position: "relative", height: 10, borderRadius: 999, background: "var(--bg-2)" }}>
        <span className={lvl === "gold" ? "super-fill" : undefined}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${fill}%`, minWidth: 4, borderRadius: 999, background: lvlColor(lvl, "var(--accent)") }} />
        {exp != null && (
          <span title="pace: onde a meta deveria estar hoje" style={{ position: "absolute", top: -4, bottom: -4, left: `${exp}%`, width: 2, borderRadius: 1, background: "var(--fg-3)" }}>
            <span style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", fontSize: 9.5, color: "var(--fg-4)", letterSpacing: "0.04em" }}>hoje</span>
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

// ── Meta do mês (réguas de receita contratada + contratos) ───────────────────
// Sempre o MÊS CORRENTE (meta é mensal), independente do filtro do topo. Dados
// do /api/pipeline-pace/:saas/window: a faixa SEGUE O FILTRO do topo (Leo,
// 08/08) — julho mostra a meta e o resultado DE JULHO, semana mostra a fatia
// da semana, dia a do dia. A meta se reparte só pelos dias úteis (fim de
// semana não cobra meta); janela fechada mostra o veredito final.
const MONTH_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const endOfMonthDay = (day) => {
  const [y, m] = day.split("-").map(Number);
  return `${day.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
const plusDays = (day, n) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// Janela da META: preset ancorado em calendário (este mês/esta semana) estica
// até o FIM do período — a régua cobra o mês/semana inteiros, com o pace
// marcando onde deveria estar hoje. Janela corrida (últimos 7d, custom) vale
// como está.
function goalWindowOf(period, win) {
  if (period === "month") return { since: win.since, until: endOfMonthDay(win.since) };
  if (period === "week") return { since: win.since, until: plusDays(win.since, 6) };
  return { since: win.since, until: win.until };
}
// Rótulo do período da meta: mês cheio → "julho 2026"; um dia → a data; senão
// o intervalo. `kind` escolhe o título do card.
function goalLabelOf(goal) {
  if (!goal) return { kind: "mês", label: "" };
  const { since, until } = goal;
  if (since.slice(0, 7) === until.slice(0, 7) && since.endsWith("-01") && until === endOfMonthDay(since)) {
    const [y, m] = since.split("-").map(Number);
    return { kind: "mês", label: `${MONTH_LONG[m - 1]} ${y}` };
  }
  const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  if (since === until) return { kind: "dia", label: fmt(since) };
  const days = Math.round((new Date(`${until}T12:00:00`) - new Date(`${since}T12:00:00`)) / DAY) + 1;
  return { kind: days === 7 ? "semana" : "período", label: `${fmt(since)} a ${fmt(until)}` };
}

// ── Termômetro da meta ──────────────────────────────────────────────────────
// Coluna de 96×300: fechado no teal com superfície líquida em movimento,
// em follow-up empilhado por cima num tom mais claro, a marca tracejada
// do pace atravessando e o rodapé com a porcentagem na cor do estado. A altura
// acompanha o alvo atual (100%, 120%, 140%...), preservando a meta original
// no percentual realizado. O pace fica acima dos efeitos, apenas como marca.
function LiquidoMeta({ height, followup = false }) {
  if (!(height > 0)) return null;
  // Dois períodos idênticos: deslocar metade da largura fecha o loop sem salto.
  const onda = "M0 6 Q12 0 24 6 T48 6 T72 6 T96 6 V12 H0Z";
  return (
    <div className={`vg-meta-liquid ${followup ? "vg-meta-liquid-followup" : "meta-sobe"}`}
      style={{ height: `${height}%` }} aria-hidden="true">
      <svg className="vg-meta-wave vg-meta-wave-back" viewBox="0 0 96 12" preserveAspectRatio="none"><path d={onda} /></svg>
      <svg className="vg-meta-wave" viewBox="0 0 96 12" preserveAspectRatio="none"><path d={onda} /></svg>
      <span className="vg-meta-liquid-reflection" />
    </div>
  );
}

function Termometro({ s, goal, lad, label, milestone }) {
  const alvo = milestone?.target ?? (Number(s.target) || 0);
  const base = Number(s.target) || 0;
  const extended = milestone?.percent > 100;
  const pctDe = (v) => (alvo > 0 ? Math.max(0, Math.min(100, (v / alvo) * 100)) : 0);
  const fechado = pctDe(Number(s.sold) || 0);
  // A camada clara indica a distância até o pace; follow-up continua na pílula.
  const mesa = goal.ended ? 0 : Math.max(0, Math.min(100 - fechado, (s.expectedProgress || 0) * 100 - fechado));
  const pacePct = !goal.ended && s.expectedProgress != null ? Math.max(0, Math.min(100, s.expectedProgress * 100)) : null;
  const pctTxt = `${Math.round(alvo > 0 ? Math.max(0, (Number(s.sold) || 0) / base) * 100 : 0)}%`;
  return (
    <div className="vg-meta-thermometer" >
      <div className="vg-meta-label">
        <div className="kicker">{extended ? `Próximo alvo · ${milestone.percent}%` : label}</div>
        <div className="vg-meta-target">{moneyFull(alvo)}</div>
        {extended && <div className="vg-meta-base">{label}: {moneyFull(base)}</div>}
      </div>
      <div className="vg-meta-thermometer-bar" >
        <div className="vg-meta-liquid-track" role="progressbar" aria-label={extended ? `Próximo alvo: ${milestone.percent}% da meta` : label} aria-valuemin={0} aria-valuemax={milestone?.percent || 100} aria-valuenow={Math.min(milestone?.percent || 100, base > 0 ? Math.max(0, s.sold / base * 100) : 0)} aria-valuetext={`${pctTxt} da meta original; ${moneyFull(s.sold)} de ${moneyFull(alvo)} do alvo atual`} style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <LiquidoMeta height={mesa} followup />
          <LiquidoMeta height={fechado} />
          {pacePct != null && <span className="vg-meta-pace-marker" aria-hidden="true"
            style={{ bottom: `clamp(0px, ${pacePct}%, calc(100% - 3px))` }}><span>PACE</span></span>}
        </div>
      </div>
      <span className="vg-meta-percent">
        <span aria-hidden="true" />
        <strong>{pctTxt}</strong><small>{goal.ended ? (s.sold >= alvo ? "meta batida" : "fechou abaixo") : extended ? "da meta original" : LVL_LABEL[lad?.lvl] || "da meta"}</small>
      </span>
    </div>
  );
}

function MetaMesCard({ pace, goal, children }) {
  if (!goal) return null;
  const s = goal.sale || {};
  const c = goal.contracts || {};
  const { kind } = goalLabelOf(goal);
  const title = kind === "mês" ? "Meta do mês" : kind === "semana" ? "Meta da semana" : kind === "dia" ? "Meta do dia" : "Meta do período";
  const sLad = ladderOf(s.sold, s.target, s.expectedProgress);
  const curMes = kind === "mês" && goal.current && pace?.sale;
  const milestone = goalMilestone({ ...s, ended: goal.ended, remainingBusinessDays: pace?.sale?.remainingBusinessDays });
  const activeTarget = milestone?.target ?? s.target;
  const falta = milestone?.missing ?? (s.target != null ? Math.max(0, r2((s.target || 0) - (s.sold || 0))) : null);
  const requiredDaily = milestone?.requiredDailyPace ?? null;
  const excedente = s.target != null ? Math.max(0, r2((s.sold || 0) - (s.target || 0))) : 0;
  // A distância pro pace EM DINHEIRO (o risquinho só dizia onde a marca está).
  const esperadoAteAqui = s.target != null && s.expectedProgress != null ? r2((activeTarget || 0) * s.expectedProgress) : 0;
  const paceDelta = milestone?.paceDelta ?? r2((s.sold || 0) - esperadoAteAqui);
  // "Em follow-up": o que está aberto no funil. MESMA régua do "em jogo" do
  // Pipeline (leads em etapa aberta do produto), pra as duas telas nunca
  // discordarem sobre o tamanho da mesa.
  const naMesa = (() => {
    const cfg = (window.SEED?.SAAS || []).find((x) => x.id === goal.saas) || (window.SEED?.SAAS || [])[0];
    if (!cfg) return { n: 0, valor: 0 };
    const abertas = new Set(openStages(cfg));
    let n = 0, valor = 0;
    for (const l of window.SEED?.LEADS || []) {
      if (l.saas !== cfg.id || !isRealLead(l) || !abertas.has(l.stage)) continue;
      n++; valor += Number(l.amount) || 0;
    }
    return { n, valor: r2(valor) };
  })();
  return (
    <section className="vg-meta-card" aria-label={title}>
      {goal.businessDays === 0 ? (
        <div className="vg-meta-empty">
          Fim de semana: sem meta cobrada (a meta vive nos dias úteis).
          {s.sold > 0 && <> Mesmo assim entrou <b className="tnum">{money(s.sold)}</b>{c.sold > 0 ? ` em ${int(c.sold)} contratos` : ""}.</>}
        </div>
      ) : (
        <div className="vg-meta-columns">
          {s.target != null && <Termometro s={s} goal={goal} lad={sLad} label={title} milestone={milestone} />}
          <div className="vg-meta-story">
            <div>
              <h2 className="vg-section-label">Funil de vendas</h2>
              <div className="vg-meta-numbers">
                <span className="vg-sold">{moneyFull(s.sold)}</span>
                {s.target != null && <span className={`vg-pace-pill ${(goal.ended ? s.sold >= s.target : paceDelta >= 0) ? "is-positive" : "is-negative"}`}>
                  <span aria-hidden="true" />{goal.ended
                    ? `${moneyFull(falta || excedente)} ${falta > 0 ? "abaixo" : "acima"} da meta`
                    : `${paceDelta >= 0 ? "+" : "−"}${moneyFull(Math.abs(paceDelta))} ${paceDelta >= 0 ? "acima" : "abaixo"} do pace`}
                </span>}
              </div>
              <div className="vg-meta-facts">
                {falta != null && <div className="vg-meta-fact">
                  <span>{falta > 0 ? (goal.ended ? "Faltou" : milestone?.percent > 100 ? `Falta para ${milestone.percent}%` : "Falta") : "Meta batida"}</span>
                  <strong>{moneyFull(falta || excedente)}</strong>
                </div>}
                {curMes && requiredDaily != null && <div className="vg-meta-fact"><span>por dia útil</span><strong>{moneyFull(requiredDaily)}</strong><small>{int(pace.sale.remainingBusinessDays)} restam</small></div>}
                <div className="vg-meta-fact is-followup"><span>follow-up · {int(naMesa.n)}</span><strong>{moneyFull(naMesa.valor)}</strong></div>
                {curMes && pace.sale.projected != null && <div className="vg-meta-fact"><span>projeção</span><strong style={{ color: pace.sale.projected >= activeTarget ? "var(--pos)" : "var(--neg)" }}>{moneyFull(pace.sale.projected)}</strong></div>}
              </div>
              <div className="vg-meta-caption">{int(c.sold)} contratos assinados{c.sold > 0 && s.sold > 0 ? ` · ticket médio ${moneyFull(s.sold / c.sold)}` : ""}{curMes ? ` · ritmo atual ${moneyFull(pace.sale.actualDailyPace)}/dia útil` : ""}</div>
              {s.target == null && <div className="vg-meta-caption">Sem meta de venda para este período.</div>}
            </div>
            {children}
          </div>
        </div>
      )}

    </section>
  );
}

// Submetas por papel — tudo dado que o placar já mede, comparado com a meta.
// Metas de FLUXO (agendadas, calls, posts…) seguem a mesma régua das duas
// pernas: meta CHEIA do mês, com o pace mensal colorindo (vermelho atrás do
// ritmo, teal no ritmo, verde 100%+, ✦ 120%+). Taxa não tem pace (não acumula
// no tempo): abaixo da meta é vermelho direto.
function personRows(p, bizDays, elapsedFrac, monthFrac) {
  const rows = [];
  // `lvl` é o que a linha do time usa: pinta o badge de cada submeta pelo pace
  // (vermelho = atrás), então a cor faz o papel que a coluna da "mais
  // atrasada" fazia antes.
  const rate = (label, value, target, title) => rows.push({
    label, valueText: pctStr(value), metaText: target != null ? int(target) : null,
    lvl: levelOf(value, target, 1), title,
  });
  const flow = (label, value, target, title, frac = monthFrac) => rows.push({
    label, valueText: int(value), metaText: target != null ? int(target) : null,
    lvl: levelOf(value, target, frac), title,
  });
  if (p.sdr) {
    const g = p.sdr.goals || {};
    rate("contato", p.sdr.contactRate, g.contactRate?.target || 80, "Dos leads que entraram, quantos você alcançou");
    rate("agendamento", p.sdr.bookingRate, g.bookingRate?.target || 30, "Dos leads da janela que ele alcançou, quantos marcaram call (base antiga trabalhada não entra na taxa)");
    rate("show", p.sdr.showRate, g.showRate?.target || 75, "Das calls que já deveriam ter acontecido, quantas aconteceram");
    // Sem meta digitada, o alvo dinâmico é da JANELA (leads anteriores × taxa),
    // então o pace nesse caso é o da janela, não o do mês.
    const bookedMonth = monthGoal(g.callsBooked);
    const bookedTarget = bookedMonth
      || (g.bookingRate?.target > 0 && p.sdr.leadsPrev > 0 ? Math.round((p.sdr.leadsPrev * g.bookingRate.target) / 100) : null);
    flow("agendadas", p.sdr.callsBooked, bookedTarget, "Calls agendadas no período vs. a meta do mês da vaga", bookedMonth ? monthFrac : elapsedFrac);
    // Mentoria: a fatia dos contratos dele que veio da fila da mentoria (já
    // está dentro das duas pernas acima). Só entra na linha de quem tem fila ou
    // venda, pra não pendurar uma submeta vazia em todo mundo.
    if (p.sdr.mentoriaQueue > 0 || p.sdr.mentoriaWon > 0) {
      flow("mentoria", p.sdr.mentoriaWon, monthGoal(g.mentoriaWon),
        `Dos contratos dele, quantos vieram da mentoria · ${int(p.sdr.mentoriaQueue)} na fila${p.sdr.mentoriaRevenue ? ` · ${money(p.sdr.mentoriaRevenue)} fechados` : ""}`);
    }
  }
  if (p.closer) {
    const g = p.closer.goals || {};
    flow("calls", p.closer.callsShown, monthGoal(g.callsShown), "Calls realizadas (sem no-show) vs. a meta do mês da vaga");
    rate("conversão", p.closer.conversaoCall, g.conversaoCall?.target || 33, "Das calls que aconteceram, quantas fecharam");
    if (p.closer.followupNow > 0 || p.closer.followupCohort > 0) {
      const onTime = p.closer.followupOnTime || 0;
      const total = p.closer.followupNow || 0;
      rows.push({
        label: "follow-ups", valueText: int(onTime), metaText: int(total),
        lvl: total === 0 ? null : onTime >= total ? "green" : onTime / total >= 0.75 ? "ok" : "red",
        title: "Follow-ups com o GPS em dia (tocados dentro da cadência) / na fila agora",
      });
      rate("resgate", p.closer.followupWinRate, p.closer.goals?.followupWinRate?.target || 15, "Dos leads que caíram em follow-up na janela, quantos ele trouxe de volta pra ganho");
    }
    // Ticket médio dos contratos fechados na janela (receita ÷ contratos, já
    // vem pronto do scoreboard). Meta é opcional (goals.ticket em Metas); sem
    // meta a linha é informativa, sem cor.
    if (p.closer.ticket != null) {
      const tTarget = g.ticket?.target > 0 ? g.ticket.target : null;
      rows.push({
        label: "ticket médio", valueText: `R$ ${compactMoney(p.closer.ticket)}`,
        metaText: tTarget != null ? `R$ ${compactMoney(tTarget)}` : null,
        lvl: tTarget != null ? levelOf(p.closer.ticket, tTarget, 1) : null,
        title: `Valor médio por contrato fechado na janela (R$ ${compactMoney(p.closer.revenue)} em ${int(p.closer.won)} contrato${p.closer.won === 1 ? "" : "s"})`,
      });
    }
  }
  if (p.cs) {
    const g = p.cs.goals || {};
    rows.push({ label: "contas ativas", valueText: int(p.cs.activeAccounts), metaText: null, lvl: null, title: "Clientes na carteira dele" });
    rate("retenção", p.cs.retentionRate, g.retentionRate?.target || 95, "Base que ficou (100 − churn)");
    // NPS é índice (-100 a 100), não taxa: sai da régua do rate(), que
    // carimbaria "%" num número que não é percentual.
    if (p.cs.nps != null || g.nps?.target) {
      const alvo = g.nps?.target || 80;
      rows.push({
        label: "nps", valueText: p.cs.nps == null ? "—" : int(p.cs.nps), metaText: int(alvo),
        lvl: p.cs.nps == null ? null : levelOf(p.cs.nps, alvo, 1),
        title: p.cs.npsCount
          ? `Índice de NPS das contas dele (promotores − detratores) · ${int(p.cs.npsCount)} ${p.cs.npsCount === 1 ? "resposta" : "respostas"}${p.cs.npsCount < 5 ? ", amostra pequena" : ""}`
          : "Índice de NPS das contas dele (promotores − detratores) · nenhuma resposta ainda",
      });
    }
    flow("indicações", p.cs.referrals, monthGoal(g.referrals), "Indicações recebidas na janela vs. a meta do mês (nº do time)");
  }
  if (p.social) {
    const g = p.social.goals || {};
    flow("posts", p.social.postsPerMonth, monthGoal(g.postsPerMonth));
    flow("stories", p.social.storiesPerMonth, monthGoal(g.storiesPerMonth));
    flow("ads", p.social.adsPerMonth, monthGoal(g.adsPerMonth));
  }
  return rows;
}

// ── Cards compactos do time (Leo, 15/09) ─────────────────────────────────────
// Uma pessoa por card, duas réguas curtas e detalhes recolhidos. A grade
// aproveita a largura disponível; ✦ continua indicando super meta (120%+).
// As duas pernas mostram a meta CHEIA do mês (Leo, 08/08: "Manuela
// R$19,5k/90k"), com o risquinho do pace e a cor dizendo se está no ritmo;
// bateu 100%, a barra rearma pro degrau seguinte (120, 140… de 20 em 20).
function MiniRegua({ value, target, isMoney, expectedFrac }) {
  const lad = ladderOf(value, target, expectedFrac);
  const ratio = lad?.ratio ?? null;
  const fmtV = (v) => (isMoney ? `R$ ${compactMoney(v)}` : int(Math.round(v)));
  const title = lad == null ? undefined
    : lad.tier > 1
      ? `Meta do mês batida (${Math.round(ratio * 100)}%) · a régua agora persegue ${Math.round(lad.tier * 100)}% = ${fmtV(target * lad.tier)}`
      : `Meta do mês: ${fmtV(target)} · pace: deveria estar em ${fmtV(target * Math.min(1, expectedFrac ?? 1))} hoje`;
  const exp = lad != null && expectedFrac > 0 && expectedFrac < 1 ? Math.round(expectedFrac * 100) : null;
  return (
    <div className="vg-team-meter" style={{ minWidth: 0, cursor: title ? "help" : undefined }} title={title}>
      <div className="vg-team-meter-line">
        <span className="vg-team-meter-label">{isMoney ? "Receita" : "Contratos"}</span>
        <span className="vg-team-meter-value">
          <b style={{ fontWeight: 650 }}>{value == null ? "—" : fmtV(value)}</b>
          {target > 0 && <span style={{ color: "var(--fg-4)" }}> / {isMoney ? compactMoney(target) : int(target)}</span>}
        </span>
        <span style={{ fontWeight: 700, color: lvlColor(lad?.lvl, "var(--fg-4)"), whiteSpace: "nowrap" }}>
          {ratio == null ? "sem meta" : `${Math.round(ratio * 100)}%${lad.lvl === "gold" ? " ✦" : ""}`}
        </span>
      </div>
      <div className="vg-team-meter-track">
        {lad != null && (
          <span className={lad.lvl === "gold" ? "super-fill" : undefined}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, minWidth: 4, borderRadius: 2, width: `${Math.min(100, Math.round(lad.pct * 100))}%`, background: lvlColor(lad.lvl, "var(--accent)") }} />
        )}
        {exp != null && (
          <span title="pace: onde a meta deveria estar hoje"
            style={{ position: "absolute", top: -2, bottom: -2, left: `${exp}%`, width: 2, borderRadius: 1, background: "var(--fg-3)" }} />
        )}
      </div>
      {lad?.tier > 1 && <div className="vg-team-meter-tier">rumo a {Math.round(lad.tier * 100)}%</div>}
    </div>
  );
}

// Meta CHEIA do mês (as pernas da remuneração são mensais; vaga com meta
// semanal vira mês pela base 21,75/5) — a linha não reescala pra janela.
const monthGoal = (g) => (g?.target > 0 ? Math.round(g.period === "week" ? g.target * (21.75 / 5) : g.target) : null);

// Nome do nível quando a meta da pessoa vem do plano de Remuneração (scope
// "remuneracao" no goalFor do servidor). Meta digitada por pessoa vence o
// plano — aí o chip some, senão apontaria pra uma régua que não é a que vale.
const nivelDaMeta = (leg) => {
  const g = leg?.goals?.revenue?.scope === "remuneracao" ? leg.goals.revenue
    : leg?.goals?.won?.scope === "remuneracao" ? leg.goals.won : null;
  return g ? levelLabel(g.level) : "";
};

// Badge de submeta (Leo, 12/09): o desenho que era só da "mais atrasada" virou
// o de TODAS — fundo suave na cor do nível, então a linha se lê pela cor (o que
// está vermelho está atrás do pace) sem precisar de coluna separada.
// Sem meta configurada (ticket médio, contas ativas) o badge é neutro.
const LVL_SOFT = {
  red: { fg: "var(--neg)", bg: "var(--neg-soft)" },
  ok: { fg: "var(--accent)", bg: "var(--accent-soft)" },
  green: { fg: "var(--pos)", bg: "var(--pos-soft)" },
  gold: { fg: "var(--pos)", bg: "var(--pos-soft)" },
  none: { fg: "var(--fg-2)", bg: "var(--bg-2)" },
};
function SubBadge({ r }) {
  const t = LVL_SOFT[r.lvl] || LVL_SOFT.none;
  return (
    <span className="tnum" title={r.title}
      style={{ display: "inline-flex", flexWrap: "wrap", maxWidth: "100%", alignItems: "baseline", gap: 4, fontSize: 11, borderRadius: "var(--r-1)", padding: "3px 9px", background: t.bg, color: t.fg, cursor: r.title ? "help" : undefined }}>
      <span style={{ opacity: 0.75 }}>{r.label}</span>
      <b style={{ fontWeight: 650 }}>{r.valueText}</b>
      {r.metaText != null && <span style={{ opacity: 0.6 }}>/ {r.metaText}</span>}
    </span>
  );
}

function PersonCard({ p, rank, bizDays, elapsedFrac, monthFrac, onPerson }) {
  // As duas pernas do plano de remuneração (receita + contratos) — closer e SDR
  // têm meta própria pelo nível (comp_plans); CS/mídia mostram só as submetas.
  const leg = p.closer || p.sdr || null;
  const revTarget = leg ? monthGoal(leg.goals?.revenue) : null;
  const wonTarget = leg ? monthGoal(leg.goals?.won) : null;
  const allRows = personRows(p, bizDays, elapsedFrac, monthFrac);
  const rows = leg ? allRows : allRows.slice(2);
  return (
    <article className="vg-team-card" aria-label={p.name}>
      <button className="vg-team-person" onClick={() => onPerson?.(p.user)} disabled={!onPerson}>
        <span className="vg-team-avatar"><Avatar id={p.user} name={p.name} size={34} />{rank != null && <span className="vg-team-rank">{rank}</span>}</span>
        <div style={{ minWidth: 0 }}>
          <div className="vg-team-name" title={p.name}>{p.name}</div>
          <div className="vg-team-role">
            {roleLabel(p)}
            {nivelDaMeta(leg) && (
              <span style={{ color: "var(--accent)" }}
                title="Nível de carreira no plano de Remuneração — é ele que define os contratos e a receita do mês desta pessoa. Muda em Metas → Meta por pessoa.">
                {" · "}{nivelDaMeta(leg)}
              </span>
            )}
          </div>
        </div>
      </button>
      {leg ? <div className="vg-team-card-metrics">
        <MiniRegua value={leg.revenue} target={revTarget} isMoney expectedFrac={monthFrac} />
        <MiniRegua value={leg.won} target={wonTarget} expectedFrac={monthFrac} />
      </div> : <dl className="vg-team-role-metrics">
        {allRows.slice(0, 2).map((r) => <div key={r.label} title={r.title}>
          <dt>{r.label}</dt><dd><strong>{r.valueText}</strong>{r.metaText != null && <span> / {r.metaText}</span>}</dd>
        </div>)}
      </dl>}
      <details className="vg-team-details"><summary aria-label={`Submetas de ${p.name}`}>submetas · {rows.length}<span aria-hidden="true">▾</span></summary><div className="vg-team-details-body">
        {rows.map((r) => <SubBadge key={r.label} r={r} />)}
        {!rows.length && <span>Sem submetas configuradas.</span>}
      </div></details>
    </article>
  );
}

// Os papéis CONFIGURADOS (Ajustes → Equipe) mandam no CARTÃO (Leo, 08/08): a
// Manuela é SDR e o Vitor é CS — um fechamento avulso registrado neles não
// pinta bloco de closer no card (os números seguem valendo no funil/placar).
// Usuário sem cadastro ou sem nome (id cru de registro antigo) fica fora da
// parede — não existe card de "us_xxxx".
const ROLE_BLOCK = { sdr: "sdr", closer: "closer", cs: "integrator", social: "social" };
function displayPerson(p) {
  const u = userById(p.user);
  if (!u || !String(u.name || "").trim()) return null;
  const roles = u.roles || [];
  if (!roles.length) return p; // sem etiquetas ainda: mostra tudo
  const out = { user: p.user, name: p.name };
  for (const [block, role] of Object.entries(ROLE_BLOCK)) {
    if (p[block] && roles.includes(role)) out[block] = p[block];
  }
  return out.sdr || out.closer || out.cs || out.social ? out : null;
}

// ── Desempenho do time (ranqueado por % da meta) ─────────────────────────────
function TeamBoard({ score, win, onPerson, state }) {
  const elapsedFrac = elapsedFracOf(win);
  const monthFrac = monthFracOf(win);
  const people = useMemo(() => {
    const list = buildPeople(score).map(displayPerson).filter(Boolean);
    const pctOf = (p) => {
      const leg = p.closer || p.sdr;
      if (!leg) return -1; // CS/mídia vão pro fim (sem as duas pernas)
      const rt = scaledGoal(leg.goals?.revenue, win.businessDays);
      const wt = scaledGoal(leg.goals?.won, win.businessDays);
      return Math.max(rt > 0 ? (leg.revenue || 0) / rt : 0, wt > 0 ? (leg.won || 0) / wt : 0);
    };
    return list.map((p) => ({ p, pct: pctOf(p) })).sort((a, b) => b.pct - a.pct);
  }, [score, win.businessDays]);
  return (
    <OverviewCard title="Desempenho do time" className="vg-team-section">
      <div>
        {score == null && <OverviewState state={state} label="desempenho do time" />}
        {score != null && !people.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Sem atividade nesse período.</div>}
        {people.length > 0 && (
          <div className="vg-team-grid">
            {people.map(({ p, pct }, i) => (
              <PersonCard key={p.user} p={p} rank={pct >= 0 ? i + 1 : null} bizDays={win.businessDays} elapsedFrac={elapsedFrac} monthFrac={monthFrac} onPerson={onPerson} />
            ))}
          </div>
        )}
      </div>
    </OverviewCard>
  );
}

// ── Funil do período (vertical: etapa → conversão → etapa) ──────────────────
// Reorganizado em 12/09: o funil era uma faixa horizontal de 5 caixas que só
// caber na tela já consumia a largura toda e rolava no mobile. Vertical, cada
// etapa é uma linha (nome · barra · número) e a conversão aparece ENTRE as
// linhas, na ordem em que o lead anda. A régua é a mesma das pernas do time:
// meta CHEIA do mês, risquinho do pace e a cor pelo ritmo; bateu 100%, a barra
// rearma pro degrau seguinte (120, 140…).
const funilGrid = { display: "grid", gridTemplateColumns: "minmax(120px, 150px) minmax(0, 1fr) 90px", gap: 16, alignItems: "center" };

function StageRow({ nm, value, meta, expectedFrac, title }) {
  const lad = ladderOf(value ?? 0, meta, expectedFrac);
  const exp = lad != null && expectedFrac > 0 && expectedFrac < 1 ? Math.round(expectedFrac * 100) : null;
  return (
    <div title={title} style={{ ...funilGrid, padding: "10px 0", cursor: title ? "help" : undefined }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{nm}</div>
        <div className="tnum" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
          {meta != null ? `meta ${int(meta)}` : "sem meta"}
          {lad != null && lad.tier > 1 && <span style={{ color: lvlColor(lad.lvl), fontWeight: 700 }}> · rumo a {Math.round(lad.tier * 100)}%</span>}
        </div>
      </div>
      <div style={{ position: "relative", height: 22, borderRadius: "var(--r-1)", background: "var(--bg-2)" }}>
        <span className={lad?.lvl === "gold" ? "super-fill" : undefined}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, minWidth: 4, borderRadius: "var(--r-1)", background: lvlColor(lad?.lvl, "var(--accent)"), width: `${lad != null ? Math.min(100, Math.round(lad.pct * 100)) : 100}%` }} />
        {exp != null && (
          <span title="pace: onde a meta deveria estar hoje" style={{ position: "absolute", top: -3, bottom: -3, left: `${exp}%`, width: 2, borderRadius: 1, background: "var(--fg-3)" }} />
        )}
      </div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 650, letterSpacing: "-0.02em", textAlign: "right" }}>{int(value)}</div>
    </div>
  );
}

// Conversão entre duas etapas. `worst` = o gargalo do período (a taxa mais
// longe da própria meta): em vez de o gestor comparar 4 porcentagens, a tela
// nomeia a etapa que está travando.
function ConvRow({ label, pct, metaPct, num, den, worst }) {
  const lvl = levelOf(pct, metaPct, 1);
  return (
    <div style={{ ...funilGrid, padding: "2px 0" }}>
      <div />
      <div className="tnum" title={num != null && den != null ? `${int(num)} de ${int(den)}` : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, justifySelf: "start", fontSize: 11.5, color: worst ? "var(--neg)" : "var(--fg-3)", background: worst ? "var(--neg-soft)" : "transparent", borderRadius: "var(--r-2)", padding: worst ? "6px 10px" : "2px 0", cursor: "help" }}>
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" style={{ color: worst ? "currentColor" : "var(--fg-4)", flexShrink: 0 }}>
          <path d="M5 1v10m0 0L2 8m3 3l3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
        {label} <b style={{ fontWeight: 650, color: worst ? "currentColor" : lvlColor(lvl, "var(--fg-2)") }}>{pctStr(pct)}</b>
        <span style={{ color: "var(--fg-4)" }}>meta {metaPct != null ? String(metaPct).replace(".", ",") + "%" : "—"}</span>
        {worst && <span style={{ fontWeight: 600 }}>· gargalo do período</span>}
      </div>
      <div />
    </div>
  );
}

// `bare`: o funil desenhado DENTRO do card da meta, como a prancha (14/09).
// Era um card separado embaixo, o que separava a meta do funil que a explica.
function FunilPeriodo({ team, win, pLabel, bare = false, onNav, state }) {
  if (team == null) {
    if (bare) return <div className="vg-funnel"><OverviewState state={state} label="funil" /></div>;
    return (
      <Card title="Funil do período" hint={pLabel}>
        <div style={{ padding: "8px var(--inset-x) 18px" }}><div className="mono dim" style={{ fontSize: 12 }}>carregando…</div></div>
      </Card>
    );
  }
  // Meta do MÊS por etapa (a cadeia derivada da meta da empresa) CHEIA — sem
  // reescalar pra janela; o risquinho do pace mensal diz onde deveria estar.
  const mt = team.monthTargets || null;
  const sMeta = (v) => (mt && v != null ? Math.max(1, Math.round(v)) : null);
  const monthFrac = monthFracOf(win);
  const g = team.goals || {};
  const stages = [
    { nm: "Leads", v: team.leadsNew, m: sMeta(mt?.leads), title: "Leads que entraram na janela (sem internos e sem saídas laterais do form)" },
    // COORTE, não workload: funil tem que ser monotônico (contatados ≤ leads).
    // Contato = 1ª resposta por QUALQUER canal, SDR automático incluído (Leo,
    // 03/09) — antes só humano contava e a etapa lia 40% com o robô cobrindo
    // 100%. O recorte humano e o workload seguem no tooltip.
    { nm: "Contatados", v: team.reachedCohort ?? team.contactedCohort ?? team.contacted, m: sMeta(mt?.contacts), title: `Dos leads da janela, os que receberam contato — humano ou SDR automático${team.paceAdjust?.contacted ? ` (+ ${int(team.paceAdjust.contacted)} do histórico pré-cockpit)` : ""}${team.contactedCohort != null ? ` · com toque humano: ${int(team.contactedCohort)}` : ""} · no total o time trabalhou ${int(team.contacted)} leads no período (inclui base antiga tocada agora)` },
    { nm: "Calls marcadas", v: team.callsBooked, m: sMeta(mt?.callsBooked), title: `Calls com data na janela${team.bookedCohort != null ? ` · ${int(team.bookedCohort)} de leads da própria janela (o resto é safra antiga trabalhada agora)` : ""}${team.pending > 0 ? ` · ${int(team.pending)} ainda no futuro` : ""}` },
    { nm: "Calls realizadas", v: team.shown, m: sMeta(mt?.callsShown), title: `Calls que aconteceram${team.noShow > 0 ? ` · ${int(team.noShow)} não compareceram` : ""}` },
    { nm: "Ganhos", v: team.won, m: sMeta(mt?.won),
      title: `Ganhos no período (= soma dos closers)${team.revenue > 0 ? ` · ${money(team.revenue)}` : ""}${team.upsells > 0 ? ` · ${int(team.upsells)} upsell${team.upsells > 1 ? "s" : ""} (${money(team.upsellRevenue || 0)})` : ""}`
        + (team.keyAccount ? ` · fora: ${team.keyAccount.won} conta grande (${money(team.keyAccount.revenue)}${team.keyAccount.names?.length ? ` · ${team.keyAccount.names.join(", ")}` : ""})` : "") },
  ];
  const convs = [
    { label: "contato", pct: team.contactRate, metaPct: 80, num: team.reachedCohort ?? team.contactedCohort ?? null, den: team.leadsNew },
    // Agendamento em COORTE encadeada (régua #650): calls de leads DA janela
    // sobre os alcançados da janela (robô incluído) — o hover mostra o N de M.
    { label: "agendamento", pct: team.bookingRate, metaPct: g.bookingRate?.target || 30, num: team.bookedCohort ?? team.callsBooked, den: team.reachedCohort ?? team.contactedCohort ?? team.contacted },
    { label: "comparecimento", pct: team.showRate, metaPct: g.showRate?.target || 75, num: team.shown, den: team.shown + team.noShow },
    // Numerador = ganho da PLATAFORMA (sem mentoria e sem upsell, que não nascem de call) — o mesmo que o servidor divide.
    { label: "conversão", pct: team.closeRatePeriod, metaPct: g.closeRate?.target || 33, num: team.wonPlatform ?? team.won, den: team.shown },
  ];
  // Gargalo = a taxa mais longe da própria meta (só quando está abaixo dela).
  let worstIdx = -1;
  let worstRatio = 1;
  convs.forEach((cv, i) => {
    if (cv.pct == null || !(cv.metaPct > 0)) return;
    const r = cv.pct / cv.metaPct;
    if (r < worstRatio) { worstRatio = r; worstIdx = i; }
  });
  const adj = team.paceAdjust;
  const historico = adj ? (
    <span className="dim" style={{ fontSize: 11.5, cursor: "help" }}
      title={`Inclui histórico pré-cockpit: ${["leads", "contacted", "booked", "shown"].filter((k) => adj[k]).map((k) => `+${adj[k]} ${({ leads: "leads", contacted: "contatos", booked: "agendadas", shown: "realizadas" })[k]}`).join(" · ")}. Ganhos seguem os registros.`}>
      inclui histórico ⓘ
    </span>
  ) : null;
  const linhas = stages.map((s, i) => (
    <React.Fragment key={s.nm}>
      {i > 0 && <ConvRow {...convs[i - 1]} worst={worstIdx === i - 1} />}
      <StageRow nm={s.nm} value={s.v} meta={s.m} expectedFrac={monthFrac} title={s.title} />
    </React.Fragment>
  ));
  if (bare) {
    const max = Math.max(1, ...stages.map((s) => Number(s.v) || 0));
    return <div className="vg-funnel">

      {stages.map((s, i) => {
        const cv = i > 0 ? convs[i - 1] : null;
        const tip = `${s.nm}: ${int(s.v)}${cv ? ` · conversão ${pctStr(cv.pct)} · meta ${cv.metaPct}%` : ""} · abre o pipeline`;
        return <button key={s.nm} className={`vg-funnel-row${i === 4 && cv?.pct < cv?.metaPct ? " is-below" : ""}`} title={tip} disabled={!onNav} onClick={() => onNav?.("pipeline")}>
          <span>{s.nm}</span>
          <span className="vg-funnel-track"><span style={{ width: `${Math.max(0, (Number(s.v) || 0) / max * 100)}%`, background: `var(--vg-funnel-${i})` }} /></span>
          <strong className="tnum">{int(s.v)}</strong>
          <span className="tnum" style={{ color: cv?.pct != null && cv.pct < cv.metaPct ? "var(--neg)" : cv ? "var(--pos)" : "var(--fg-4)" }}>{cv ? pctStr(cv.pct) : "—"}</span>
        </button>;
      })}
    </div>;
  }
  return (
    <Card title="Funil do período"
      hint={`${pLabel} · atual vs meta do MÊS por etapa (risquinho = pace) · a conversão entre etapas fica na linha do meio`}
      action={historico}>
      <div style={{ padding: "12px var(--inset-x) 18px" }}>{linhas}</div>
    </Card>
  );
}

// ── Resumos da Carteira e Aquisição ─────────────────────────────────────────
function OverviewCard({ title, className = "", children }) {
  return <section className={`vg-card ${className}`} aria-label={title}><h2 className="vg-section-label">{title}</h2>{children}</section>;
}

function AquisicaoCard({ marketing, biz, classes }) {
  const cpl = marketing?.totals?.spend > 0 && marketing?.totals?.cpl != null ? marketing.totals.cpl : null;
  const roas = marketing?.totals?.roas ?? null;
  const cac = biz?.window?.cac ?? null;
  const origins = [["semente", "Semente", "indicação e base", "var(--chart-1)"], ["rede", "Rede", "marketing", "var(--chart-2)"], ["alvo", "Alvo", "outbound", "var(--chart-3)"]];
  const total = origins.reduce((sum, [key]) => sum + (classes?.[key]?.leads || 0), 0);
  return <section className="vg-acquisition" aria-label="Aquisição">
    <h2 className="vg-section-label">Aquisição</h2>
    <dl className="vg-acquisition-metrics">
      {[["CPL", cpl != null ? money(cpl) : "sem gasto"], ["CAC", cac != null ? money(cac) : "—"], ["ROAS", roas != null ? String(roas).replace(".", ",") + "x" : "—"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <h3 className="vg-origins-label">Leads por origem · {int(total)}</h3>
    <div className="vg-origins-bar" aria-hidden="true">{origins.map(([key,,, color]) => <span key={key} style={{ width: `${total ? (classes?.[key]?.leads || 0) / total * 100 : 0}%`, background: color }} />)}</div>
    <dl className="vg-origins">{origins.map(([key, label, channel, color]) => <div key={key}><span className="vg-origin-dot" style={{ background: color }} /><dt>{label}<span> · {channel}</span><small>{int(classes?.[key]?.won)} ganhos no período</small></dt><dd>{int(classes?.[key]?.leads)}</dd></div>)}</dl>
  </section>;
}

// ── Últimas vendas (Leo, 12/09) ─────────────────────────────────────────────
// O trilho da direita abre com o que JÁ ENTROU, no lugar do "Agora" (que foi
// pro fim da página): cada venda com cliente, produto, valor e quem fechou.
// A ordem é por RECÊNCIA e a lista NÃO segue o filtro do topo — "as últimas
// vendas" precisa ter conteúdo mesmo com a janela num período vazio, e a data
// de cada linha já diz de quando é.
// DUAS FONTES, as mesmas do placar: o ganho do lead (isWonLead + wonAtOf) e o
// UPSELL, que é venda desde 09/09 (fatura kind:"upsell" na ficha do cliente,
// creditada a quem vendeu). Sem o upsell a lista contava metade do que o time
// fez no mês.
const MAX_VENDAS = 8;
// Espelho do upsellSoldAt do metrics-core (api) — a mesma ordem de fallback,
// pra data aqui bater com a do placar.
const upsellSoldAtOf = (i) => i?.soldAt || i?.paidAt || i?.dueDate || i?.createdAt || "";

function VendasCard({ leads, invoices, product, customers, onNav, onOpenLead }) {
  // Nome do CLIENTE: o cadastro vence (é o nome que o time usa em Clientes e
  // no Financeiro); sem cliente convertido ainda, a empresa do lead e, por
  // último, o nome da pessoa.
  const nomeDoCadastro = (id) => String((customers || []).find((x) => x.id === id)?.name || "").trim();
  const vendas = useMemo(() => {
    const doLead = (leads || []).filter((l) => isWonLead(product, l)).map((l) => ({
      id: `l_${l.id}`, lead: l, at: wonAtOf(l), amount: l.amount, who: l.closer || l.owner || "",
      cliente: nomeDoCadastro(l.customerId) || String(l.company || l.name || "").trim() || "cliente sem nome",
      // O produto do fechamento; sem ele, a oferta que estava na mesa.
      produto: dealProductLabel(l.proposalProduct, l.saas)
        || (l.proposalOffer && l.proposalOffer !== "nenhuma" ? closedPlanLabel(l.proposalOffer) || l.proposalOffer : ""),
      upsell: false,
    }));
    const doUpsell = (invoices || []).filter((i) => i.kind === "upsell").map((i) => ({
      id: `i_${i.id}`, at: upsellSoldAtOf(i), amount: i.amount, who: i.soldBy || "",
      cliente: nomeDoCadastro(i.customer) || "cliente sem nome",
      produto: String(i.title || "").trim() || dealProductLabel(i.product, i.saas),
      upsell: true,
    }));
    return [...doLead, ...doUpsell]
      .filter((v) => v.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, MAX_VENDAS);
  }, [leads, invoices, customers, product]); // eslint-disable-line react-hooks/exhaustive-deps
  const dia = (at) => { const d = bizDay(at); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ""; };
  return (
    <OverviewCard title="Últimas vendas" className="vg-sales">
      <div className="vg-sales-list">
        {!vendas.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "6px 0" }}>Nenhuma venda registrada ainda.</div>}
        {vendas.map((v, i) => (
            <button key={v.id} onClick={() => v.lead && onOpenLead ? onOpenLead(v.lead) : onNav?.("customers")} className="vg-sale">
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {v.who && <Avatar id={v.who} name={displayName(v.who)} size={26} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.cliente}</span>
                    {v.upsell && (
                      <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "var(--accent)", background: "var(--accent-soft)", borderRadius: "var(--r-1)", padding: "1px 5px" }}
                        title="Upsell: venda registrada na ficha do cliente, creditada a quem vendeu (conta na meta desde 09/09).">UPSELL</span>
                    )}
                  </div>
                  {/* Sem .kicker aqui: nome de produto e de pessoa em caixa
                      alta com letter-spacing fica gritado ("ESCALA ANUAL"). */}
                  <div style={{ fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>
                    {v.produto || "produto não informado"}{v.who ? ` · ${displayName(v.who)}` : " · sem responsável"}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="vg-sale-amount">{moneyFull(v.amount)}</div>
                <div className="tnum" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 1 }}>{dia(v.at)}</div>
              </div>
            </button>
        ))}
      </div>
      {onNav && <button className="vg-sales-all" onClick={() => onNav("pipeline", { saas: product.id })}>Ver todas no pipeline →</button>}
    </OverviewCard>
  );
}

function CarteiraCard({ customers, ltv, win, children }) {
  // A carteira SEGUE O FILTRO do topo desde 12/09 (Leo). Como ela é ESTADO e
  // não fluxo, o que a janela escolhe é o MOMENTO: a base como estava no FIM
  // do período. No mês corrente isso é hoje (o número não muda); numa janela
  // histórica ela volta no tempo em vez de mostrar a base de agora.
  // Comparação por dia de NEGÓCIO em string, como no resto da tela — win.since
  // e win.until já chegam YYYY-MM-DD.
  // Conta grande (keyAccount, ex.: Galante) segue fora das médias; o número
  // grande é sempre o cheio.
  // O churn continua na RÉGUA ÚNICA do lib/churn.js (isChurned = endedAt no
  // passado), só que avaliada no instante que a janela escolhe. `Math.min` com
  // agora mantém o mês corrente idêntico ao que era antes (corte = agora, não
  // fim do dia), então um churn marcado pra mais tarde hoje segue fora.
  const fimMs = Math.min(Date.now(), new Date(`${win.until}T23:59:59.999${BIZ_TZ}`).getTime());
  const inicioMs = new Date(`${win.since}T00:00:00${BIZ_TZ}`).getTime();
  const nasceuAte = (c, ate) => { const d = bizDay(c.startedAt); return !d || d <= ate; }; // sem startedAt = base antiga, sempre existiu

  const naBase = customers.filter((c) => nasceuAte(c, win.until));
  const ativos = naBase.filter((c) => !isChurned(c, fimMs));
  const cg = ativos.filter((c) => !!c.keyAccount);
  const core = ativos.filter((c) => !c.keyAccount);
  const arrAll = ativos.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  const arrCore = core.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  const ticketAll = ativos.length ? arrAll / ativos.length : null;
  const ticketCore = core.length ? arrCore / core.length : null;
  // Churn DO PERÍODO: quem saiu DENTRO da janela ÷ a base que existia no
  // começo dela (a régua clássica). Antes era "todos que já saíram ÷ todos que
  // já entraram", um número que só crescia e não dizia nada do mês.
  // Saiu DENTRO da janela = estava de pé no começo e está churnado no fim.
  const churned = naBase.filter((c) => !isChurned(c, inicioMs) && isChurned(c, fimMs)).length;
  const baseInicio = customers.filter((c) => nasceuAte(c, win.since) && !isChurned(c, inicioMs));
  const churnPct = baseInicio.length ? Math.round((churned / baseInicio.length) * 1000) / 10 : null;
  const values = [
    ["Clientes", int(ativos.length), cg.length ? `${int(core.length)} padrão · ${int(cg.length)} CG` : null],
    ["Ticket médio", ticketAll != null ? moneyFull(ticketAll) : "—", cg.length && ticketCore != null ? `${money(ticketCore)} sem CG` : null],
    ["ARR", moneyFull(arrAll)],
    ["LTV", ltv?.value != null ? moneyFull(ltv.value) : "—", ltv?.ltvCac ? `LTV/CAC ${String(ltv.ltvCac).replace(".", ",")}x` : null],
    ["Churn", churnPct == null ? "—" : `${String(churnPct).replace(".", ",")}%`, churned ? `${int(churned)} ${churned === 1 ? "saiu" : "saíram"}` : null],
  ];
  return <OverviewCard title="Carteira" className="vg-portfolio">
    <div className="vg-portfolio-mrr"><div><span>MRR</span><strong>{moneyFull(arrAll / 12)}</strong></div>{cg.length > 0 && <small>{moneyFull(arrCore / 12)} sem CG</small>}</div>
    <dl className="vg-portfolio-values">{values.map(([label, value, sub]) => <div key={label}><dt>{label}</dt><dd>{value}</dd>{sub && <small>{sub}</small>}</div>)}</dl>
    {children}
  </OverviewCard>;
}

// ── Atenção agora (avisos com botão de ação) ─────────────────────────────────
const CHIP_TONE = {
  neg: { bg: "var(--neg-soft)", fg: "var(--neg)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  pos: { bg: "var(--pos-soft)", fg: "var(--pos)" },
};

function AtencaoCard({ items }) {
  return <OverviewCard title="Agora" className="vg-attention"><h3>{items.length ? `${items.length} ${items.length === 1 ? "coisa esperando decisão" : "coisas esperando decisão"}` : "Tudo em dia"}</h3>
    {!items.length && <div className="vg-meta-empty">Tudo em dia por aqui.</div>}
    {items.map((it) => <div className="vg-attention-row" key={it.key}>
      <span className="vg-attention-line" style={{ background: (CHIP_TONE[it.tone] || CHIP_TONE.info).fg }} />
      <div className="vg-attention-copy">
        <strong style={{ color: (CHIP_TONE[it.tone] || CHIP_TONE.info).fg }}>{it.title}</strong>
        <span>{it.sub}</span>
      </div>
      {it.onClick && <button className="vg-attention-action" onClick={it.onClick}>{it.action} →</button>}
    </div>)}
  </OverviewCard>;
}

// Each read keeps its own state: a failed or slow chart does not hide the page.
// Keying the value prevents a previous product/period flashing during a switch.
function useOverviewRead(read, key, version) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ key, value: null, error: false, pending: true });
  useEffect(() => {
    let active = true;
    setState(previous => ({ key, value: previous.key === key ? previous.value : null, error: false, pending: true }));
    Promise.resolve().then(read).then(value => {
      if (active) setState({ key, value, error: false, pending: false });
    }).catch(() => {
      if (active) setState({ key, value: null, error: true, pending: false });
    });
    return () => { active = false; };
  }, [key, version, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...(state.key === key ? state : { value: null, pending: true, error: false }), retry: () => setAttempt(n => n + 1) };
}

function OverviewState({ state, label }) {
  if (state?.error) return <div className="vg-load-state" role="alert">Não foi possível carregar {label}. <button onClick={state.retry}>Tentar novamente</button></div>;
  return <div className="vg-load-state" role="status">{state?.pending !== false ? `Carregando ${label}…` : `Sem dados de ${label} neste período.`}</div>;
}

function OverviewScreen({ onNav, onOpenLead }) {
  const { LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const [product] = useActiveSaas();
  const { period, win } = usePeriod();
  const periodKey = `${product?.id}:${win.since}:${win.until}:${period}`;
  const marketingState = useOverviewRead(() => api.marketingMetrics(product.id, { since: win.since, until: win.until }), periodKey, version);
  const bizState = useOverviewRead(() => api.metrics(product.id, { days: win.days }), periodKey, version);
  const invoiceState = useOverviewRead(() => api.list("invoices").then(rows => rows.filter(i => i.saas === product.id)), product?.id, version);
  const scoreState = useOverviewRead(() => api.scoreboard(product.id, win), periodKey, version);
  const goalState = useOverviewRead(() => api.paceWindow(product.id, goalWindowOf(period, win)), periodKey, version);
  const paceState = useOverviewRead(() => api.pipelinePace(product.id), product?.id, version);
  const waState = useOverviewRead(() => api.waInsights(30), product?.id, version);
  const marketing = marketingState.value, biz = bizState.value, invoices = invoiceState.value || [];
  const score = scoreState.value, goal = goalState.value, pace = paceState.value, wa = waState.value;

  const leads = useMemo(() => (LEADS || []).filter((l) => l.saas === product?.id && isRealLead(l)), [LEADS, product?.id]);
  const productCustomers = useMemo(() => (CUSTOMERS || []).filter((c) => c.saas === product?.id), [CUSTOMERS, product?.id]);

  if (!product) {
    return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra começar a operar o cockpit." />;
  }

  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_today_person", userId); } catch { /* ignore */ }
    onNav && onNav("today", { saas: product.id });
  };

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  // ── Atenção agora: avisos calculados do dado que já existe ─────────────────
  const todayKey = bizDay(new Date());
  const plus7 = bizDay(new Date(Date.now() + 7 * DAY));
  const openInv = invoices.filter((i) => i.status === "open" || i.status === "overdue");
  const overdue = openInv.filter((i) => i.dueDate && bizDay(i.dueDate) < todayKey);
  const due7 = openInv.filter((i) => i.dueDate && bizDay(i.dueDate) >= todayKey && bizDay(i.dueDate) <= plus7);
  const sumInv = (list) => list.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const custName = (id) => productCustomers.find((c) => c.id === id)?.name?.trim() || "cliente";
  const nameList = (list) => {
    const names = [...new Set(list.map((i) => custName(i.customer)))];
    return names.slice(0, 2).join(" · ") + (names.length > 2 ? ` · +${names.length - 2}` : "");
  };
  const qualif = leads.filter((l) => stageKind(product, l.stage) === "qualificacao");
  const qualifStalled = qualif.filter((l) => l.stageSince && Date.now() - new Date(l.stageSince).getTime() > 3 * DAY);
  const weekCalls = leads.filter((l) => l.callAt && bizDay(l.callAt) >= todayKey && bizDay(l.callAt) <= plus7);
  const slaBreached = (score?.sdr || []).reduce((s, p) => s + (Number(p.breached) || 0), 0);
  const waAwaiting = wa?.awaiting || 0;

  const atencao = [];
  if (overdue.length) atencao.push({
    key: "vencidas", tone: "neg", chip: "cobrar hoje",
    title: `${money(sumInv(overdue))} vencidos`,
    sub: `${nameList(overdue)} · ${overdue.length === 1 ? "1 fatura em aberto" : `${overdue.length} faturas em aberto`}`,
    action: "Cobrar agora", onClick: () => onNav && onNav("subscriptions", { saas: product.id }),
  });
  if (slaBreached > 0) atencao.push({
    key: "sla", tone: "neg", chip: "1º toque",
    title: `${int(slaBreached)} ${slaBreached === 1 ? "lead fora" : "leads fora"} do SLA`,
    sub: "novos nunca contatados além do prazo do 1º toque",
    action: "Abrir pipeline", onClick: () => onNav && onNav("pipeline", { saas: product.id }),
  });
  if (qualif.length) atencao.push({
    key: "fila", tone: "warn", chip: "fila parada",
    title: `${int(qualif.length)} leads em Qualificação`,
    sub: qualifStalled.length ? `${int(qualifStalled.length)} sem avançar há 3+ dias` : "maior estoque do funil",
    action: "Abrir fila", onClick: () => onNav && onNav("pipeline", { saas: product.id }),
  });
  if (waAwaiting > 0) atencao.push({
    key: "wa", tone: "warn", chip: "whatsapp",
    title: `${int(waAwaiting)} ${waAwaiting === 1 ? "conversa esperando" : "conversas esperando"}`,
    sub: `${wa?.openWindow === 1 ? "1 janela de 24h aberta" : `${wa?.openWindow || 0} janelas de 24h abertas`} · inbox do time`,
    action: "Abrir inbox", onClick: () => onNav && onNav("whatsapp"),
  });
  if (due7.length) atencao.push({
    key: "areceber", tone: "info", chip: "a receber",
    title: `${money(sumInv(due7))} nos próximos 7 dias`,
    sub: `${nameList(due7)} · ${due7.length === 1 ? "1 fatura vence" : `${due7.length} faturas vencem`} na semana`,
    action: "Ver faturas", onClick: () => onNav && onNav("subscriptions", { saas: product.id }),
  });
  if (weekCalls.length) atencao.push({
    key: "calls", tone: "pos", chip: "semana",
    title: `${int(weekCalls.length)} calls marcadas`,
    sub: "confirmar presença 1h antes reduz no-show",
    action: "Abrir agenda", onClick: () => onNav && onNav("agenda"),
  });

  return (
    <div className="overview-screen">
      <header className="vg-page-head" title={`${today} · ${win.label}`}>
        <h1 className="page-title">Visão geral</h1>
      </header>
      <div className="vg-layout">
        {goal ? <MetaMesCard pace={pace} goal={goal}>
          {paceState.error && <OverviewState state={paceState} label="ritmo" />}
          <FunilPeriodo team={score?.team} state={scoreState} win={win} pLabel={win.label} bare onNav={canSeeScreen("pipeline") ? onNav : null} />
        </MetaMesCard> : <OverviewCard title="Meta do período" className="vg-meta-pending"><OverviewState state={goalState} label="meta" /></OverviewCard>}
        <VendasCard leads={leads} invoices={invoices} product={product} customers={productCustomers} onNav={onNav} onOpenLead={onOpenLead} />
        <div className="vg-main">
          <TeamBoard score={score} state={scoreState} win={win} onPerson={canSeeScreen("today") ? openPerson : null} />
          <AtencaoCard items={atencao} />
          {invoiceState.error && <OverviewState state={invoiceState} label="faturas" />}
          {waState.error && <OverviewState state={waState} label="conversas" />}
        </div>
        <CarteiraCard customers={productCustomers} ltv={biz?.ltv} win={win}>
          {bizState.error && <OverviewState state={bizState} label="LTV e CAC" />}
          {marketingState.value ? <AquisicaoCard marketing={marketing} biz={biz} classes={score?.team?.classes} /> : <OverviewState state={marketingState} label="aquisição" />}
        </CarteiraCard>
      </div>
    </div>
  );
}

export { OverviewScreen, MetaMesCard, FunilPeriodo, TeamBoard, PersonCard, PersonCard as PersonRow };
