import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card } from "../components/viz.jsx";
import { EmptyState, Avatar } from "../atoms.jsx";
import { stageKind, isRealLead } from "../lib/funnel.js";
import { bizDay } from "../lib/format.js";
import { canSeeScreen, userById } from "../lib/users.js";
import { levelLabel } from "../lib/levels.js";
import { useActiveSaas } from "../lib/workspace.js";
import { buildPeople, roleLabel, scaledGoal } from "../components/team-cards.jsx";
import { usePeriod, businessDaysBetween } from "../components/period-picker.jsx";
import { isChurned } from "../lib/churn.js";
// Visão geral — o modelo aprovado pelo Leo em 08/08/2026 (protótipo v9):
//   Meta do mês (réguas de receita contratada e de contratos, com pace)
//   → Funil do período (atual vs meta por etapa)
//   → Desempenho do time (rank + foto + medidores receita/contratos + submetas)
//   → Aquisição + Carteira
//   → Atenção agora (avisos com botão de ação).
// Escala de cores única: vermelho (atrás do caminho) → teal (no pace) → verde
// (meta batida) → dourado (120%+, alinhado às bandas da remuneração).
// Meta batida REARMA a régua: 100% → persegue 120% → 140%… de 20 em 20, sem
// teto (super metas, o mesmo desenho da remuneração acima de 140%).
// Conta grande (customer.keyAccount, ex.: Galante) fica fora das médias; o
// dinheiro segue no caixa/vendido. Explicações moram em tooltips (hover).

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
const money = (v) => window.fmt.money(v || 0);
const int = (v) => window.fmt.int(v || 0);
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
const fmtContracts = (t) => (t == null ? "—" : Number.isInteger(t) ? int(t) : String(t).replace(".", ","));

function MetaMesCard({ pace, goal, onNav, links = true }) {
  if (!goal) return null;
  const s = goal.sale || {};
  const c = goal.contracts || {};
  const { kind, label } = goalLabelOf(goal);
  const title = kind === "mês" ? "Meta do mês" : kind === "semana" ? "Meta da semana" : kind === "dia" ? "Meta do dia" : "Meta do período";
  const endedLabel = (lvl) => (goal.ended ? ({ red: "não bateu", ok: "não bateu", green: "meta batida", gold: "super meta" })[lvl] : null);
  // Conta grande fora do resultado (Leo, 19/08): a régua mostra o núcleo e o
  // rodapé diz o que ficou de fora — o número cheio nunca some de vista.
  const ka = goal.keyAccount;
  // Super metas: bateu 100%, a régua rearma pro próximo degrau (120, 140…) e o
  // "hoje" passa a cobrar o ritmo do degrau novo.
  const sLad = ladderOf(s.sold, s.target, s.expectedProgress);
  const cLad = c.target != null ? ladderOf(c.sold, c.target, c.expectedProgress) : null;
  // No mês CORRENTE o pace mensal completo enriquece o tooltip (ritmo, precisa
  // por dia, projeção); janela histórica fica com a explicação da fatia.
  const curMes = kind === "mês" && goal.current && pace?.sale;
  const saleTitle = curMes
    ? `Receita nova contratada no mês (contrato cheio). Hoje: ${money(pace.sale.soldToday)} · ritmo ${money(pace.sale.actualDailyPace)}/dia útil`
      + (pace.sale.requiredDailyPace != null ? ` · precisa ${money(pace.sale.requiredDailyPace)}/dia` : "")
      + ` · ${int(pace.sale.remainingBusinessDays)} dias úteis restantes · projeção do mês ${money(pace.sale.projected)}.`
    : `Receita nova contratada em ${label} (contrato cheio) vs. a meta da época, repartida pelos ${int(goal.businessDays)} dias úteis da janela.`;
  const contractsTitle = "Meta de contratos da época (a digitada em Metas vence; senão venda ÷ ticket sem contas grandes), repartida pelos dias úteis da janela.";
  return (
    <Card title={title} hint={`${label} · segue o filtro do topo · a meta vive nos dias úteis`}
      action={links ? <button onClick={() => onNav && onNav("analise")} style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)" }}>Ver análise completa →</button> : null}>
      {goal.businessDays === 0 ? (
        <div style={{ padding: "14px var(--inset-x) 20px", fontSize: 12.5, color: "var(--fg-3)" }}>
          Fim de semana: sem meta cobrada (a meta vive nos dias úteis).
          {s.sold > 0 && <> Mesmo assim entrou <b className="tnum" style={{ color: "var(--pos)" }}>{money(s.sold)}</b>{c.sold > 0 ? ` em ${int(c.sold)} ${c.sold === 1 ? "contrato" : "contratos"}` : ""}.</>}
        </div>
      ) : (
        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: "16px 36px", padding: "16px var(--inset-x) 20px" }}>
          {s.target != null ? (
            <Regua
              label="Régua de receita"
              title={saleTitle}
              valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{money(s.sold)}</strong> / {money(s.target)} · {Math.round((s.progress || 0) * 100)}%</>}
              pct={sLad ? sLad.pct : s.progress} expectedPct={goal.ended ? null : s.expectedProgress} lvl={sLad?.lvl} chipLabel={goal.ended ? endedLabel(sLad?.lvl) : sLad?.chip}
            />
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)", alignSelf: "center" }}>Sem meta de venda pra esse período.</div>
          )}
          {c.target != null ? (
            <Regua
              label="Régua de contratos"
              title={contractsTitle}
              valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{int(c.sold)}</strong> / {fmtContracts(c.target)} · {Math.round((c.progress || 0) * 100)}%</>}
              pct={cLad ? cLad.pct : c.progress} expectedPct={goal.ended ? null : c.expectedProgress} lvl={cLad?.lvl} chipLabel={goal.ended ? endedLabel(cLad?.lvl) : cLad?.chip}
            />
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)", alignSelf: "center" }}>
              Sem meta de contratos ainda: registre uma venda (pro ticket existir) ou
              {links ? <button onClick={() => onNav && onNav("metas")} style={{ fontWeight: 600, color: "var(--accent)", marginLeft: 4 }}>digite a meta em Metas →</button> : " digite a meta em Metas."}
            </div>
          )}
        </div>
      )}
      {ka && (
        <div style={{ padding: "0 var(--inset-x) 14px", fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}
          title="Conta grande (Galante, CRGroup) fica fora do resultado desde 19/08: um contrato de R$ 120 mil no meio de vendas de R$ 3 a 7 mil faz o mês parecer batido sem a operação ter rodado. O dinheiro segue cheio no caixa e no Financeiro.">
          Fora do resultado: {int(ka.count)} conta grande{ka.count === 1 ? "" : "s"}
          {ka.names?.length ? ` (${ka.names.join(", ")})` : ""} · {money(ka.revenue)}.
          {ka.soldWith != null ? <> Com {ka.count === 1 ? "ela" : "elas"}: <b className="tnum">{money(ka.soldWith)}</b> em {int(ka.countWith)} contrato{ka.countWith === 1 ? "" : "s"}.</> : null}
        </div>
      )}
      {links && curMes && pace.sale.targetConfigured === false && (
        <div style={{ padding: "0 var(--inset-x) 16px" }}>
          <button onClick={() => onNav && onNav("metas")} style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", textAlign: "left" }}>
            essa é a meta padrão do sistema · defina a sua em Metas → Empresa
          </button>
        </div>
      )}
    </Card>
  );
}

// Submetas por papel — tudo dado que o placar já mede, comparado com a meta.
// Metas de FLUXO (agendadas, calls, posts…) seguem a mesma régua das duas
// pernas: meta CHEIA do mês, com o pace mensal colorindo (vermelho atrás do
// ritmo, teal no ritmo, verde 100%+, ✦ 120%+). Taxa não tem pace (não acumula
// no tempo): abaixo da meta é vermelho direto.
function personRows(p, bizDays, elapsedFrac, monthFrac) {
  const rows = [];
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
    if (p.cs.nps != null || g.nps?.target) rate("nps", p.cs.nps, g.nps?.target || 80, "NPS médio das contas dele");
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

// ── Linha da LISTA do time (aprovada pelo Leo em 08/08, no lugar dos cards) ──
// Uma linha por pessoa: identidade | régua de receita | régua de contratos |
// submetas do papel em linha única. As barras alinhadas em coluna deixam a
// comparação entre as pessoas imediata; ✦ = super meta (120%+).
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
    <div style={{ minWidth: 0, cursor: title ? "help" : undefined }} title={title}>
      <div className="tnum" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: 11.5, marginBottom: 5 }}>
        <span style={{ whiteSpace: "nowrap" }}>
          <b style={{ fontWeight: 650 }}>{value == null ? "—" : fmtV(value)}</b>
          {target > 0 && <span style={{ color: "var(--fg-4)" }}> / {isMoney ? compactMoney(target) : int(target)}</span>}
        </span>
        <span style={{ fontWeight: 700, color: lvlColor(lad?.lvl, "var(--fg-4)"), whiteSpace: "nowrap" }}>
          {ratio == null ? "sem meta" : `${Math.round(ratio * 100)}%${lad.lvl === "gold" ? " ✦" : ""}${lad.tier > 1 ? ` · rumo a ${Math.round(lad.tier * 100)}%` : ""}`}
        </span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 999, background: "var(--bg-2)" }}>
        {lad != null && (
          <span className={lad.lvl === "gold" ? "super-fill" : undefined}
            style={{ position: "absolute", top: 0, bottom: 0, left: 0, minWidth: 4, borderRadius: 999, width: `${Math.min(100, Math.round(lad.pct * 100))}%`, background: lvlColor(lad.lvl, "var(--accent)") }} />
        )}
        {exp != null && (
          <span title="pace: onde a meta deveria estar hoje"
            style={{ position: "absolute", top: -2, bottom: -2, left: `${exp}%`, width: 2, borderRadius: 1, background: "var(--fg-3)" }} />
        )}
      </div>
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

function PersonRow({ p, rank, bizDays, elapsedFrac, monthFrac, onPerson }) {
  // As duas pernas do plano de remuneração (receita + contratos) — closer e SDR
  // têm meta própria pelo nível (comp_plans); CS/mídia mostram só as submetas.
  const leg = p.closer || p.sdr || null;
  const revTarget = leg ? monthGoal(leg.goals?.revenue) : null;
  const wonTarget = leg ? monthGoal(leg.goals?.won) : null;
  const rows = personRows(p, bizDays, elapsedFrac, monthFrac);
  const semPerna = <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>—</span>;
  return (
    <div className="vg-trow" onClick={() => onPerson && onPerson(p.user)} style={{ cursor: onPerson ? "pointer" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {rank != null && (
          <span className="mono tnum" style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: "var(--r-1)", padding: "1px 6px", flexShrink: 0 }}>{rank}#</span>
        )}
        <Avatar id={p.user} name={p.name} size={28} />
        <span style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
        <span className="kicker" style={{ whiteSpace: "nowrap" }}>{roleLabel(p)}</span>
        {nivelDaMeta(leg) && (
          <span className="kicker" style={{ whiteSpace: "nowrap", color: "var(--accent)" }}
            title="Nível de carreira no plano de Remuneração — é ele que define os contratos e a receita do mês desta pessoa. Muda em Metas → Meta por pessoa.">
            {nivelDaMeta(leg)}
          </span>
        )}
      </div>
      {leg ? <MiniRegua value={leg.revenue} target={revTarget} isMoney expectedFrac={monthFrac} /> : semPerna}
      {leg ? <MiniRegua value={leg.won} target={wonTarget} expectedFrac={monthFrac} /> : semPerna}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11.5, minWidth: 0, alignItems: "baseline" }}>
        {rows.map((r) => (
          <span key={r.label} title={r.title} className="tnum" style={{ whiteSpace: "nowrap", color: "var(--fg-3)" }}>
            {r.label} <b style={{ fontWeight: 650, color: lvlColor(r.lvl) }}>{r.valueText}</b>
            {r.metaText != null && <span style={{ color: "var(--fg-4)" }}> / {r.metaText}</span>}
          </span>
        ))}
        {leg?.keyWon > 0 && (
          <span className="tnum" style={{ whiteSpace: "nowrap", color: "var(--fg-4)" }}
            title="Conta grande fica fora do placar desde 19/08 (um bespoke de R$ 120 mil não é a régua da operação). O dinheiro segue cheio no caixa e no Financeiro.">
            fora do placar <b style={{ fontWeight: 650 }}>{leg.keyWon} conta grande</b> · R$ {compactMoney(leg.keyRevenue || 0)}
          </span>
        )}
        {!rows.length && <span style={{ color: "var(--fg-4)" }}>sem metas configuradas ainda</span>}
      </div>
    </div>
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
function TeamBoard({ score, win, onPerson }) {
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
    <Card title="Desempenho do time" hint="ranqueado por % da meta · réguas = meta do mês, o risquinho é o pace · clique num nome pra abrir o pipeline">
      <div style={{ padding: "8px var(--inset-x) 20px" }}>
        {score == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {score != null && !people.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Sem atividade nesse período.</div>}
        {people.length > 0 && (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
            <div className="vg-trow vg-thead">
              <span className="kicker">Pessoa</span>
              <span className="kicker">Receita</span>
              <span className="kicker">Contratos</span>
              <span className="kicker">Submetas do papel</span>
            </div>
            {people.map(({ p, pct }, i) => (
              <PersonRow key={p.user} p={p} rank={pct >= 0 ? i + 1 : null} bizDays={win.businessDays} elapsedFrac={elapsedFrac} monthFrac={monthFrac} onPerson={onPerson} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Funil do período (atual vs meta do mês · barra = % da meta da etapa) ─────
// Mesma régua das pernas do time: meta CHEIA do mês, risquinho do pace e a cor
// pelo ritmo; bateu 100%, a barra rearma pro degrau seguinte (120, 140…).
function StageBox({ nm, value, meta, expectedFrac, title }) {
  const lad = ladderOf(value ?? 0, meta, expectedFrac);
  const exp = lad != null && expectedFrac > 0 && expectedFrac < 1 ? Math.round(expectedFrac * 100) : null;
  return (
    <div title={title} style={{ flex: "1 1 0", minWidth: 108, padding: "4px 6px", textAlign: "center" }}>
      <div className="kicker" style={{ marginBottom: 4 }}>{nm}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>{int(value)}</div>
      <div className="tnum" style={{ fontSize: 11.5, color: "var(--fg-4)", minHeight: 17 }}>
        {meta != null ? `meta ${int(meta)}` : ""}
        {lad != null && lad.tier > 1 && <span style={{ color: lvlColor(lad.lvl), fontWeight: 700 }}> · rumo a {Math.round(lad.tier * 100)}%</span>}
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 999, background: "var(--bg-2)", marginTop: 8 }}>
        <span className={lad?.lvl === "gold" ? "super-fill" : undefined}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, minWidth: 4, borderRadius: 999, background: lvlColor(lad?.lvl, "var(--accent)"), width: `${lad != null ? Math.min(100, Math.round(lad.pct * 100)) : 100}%` }} />
        {exp != null && (
          <span title="pace: onde a meta deveria estar hoje" style={{ position: "absolute", top: -2, bottom: -2, left: `${exp}%`, width: 2, borderRadius: 1, background: "var(--fg-3)" }} />
        )}
      </div>
    </div>
  );
}

function ConvStep({ pct, metaPct, num, den }) {
  const lvl = levelOf(pct, metaPct, 1);
  return (
    <div title={num != null && den != null ? `${int(num)} de ${int(den)}` : undefined}
      style={{ flex: "0 0 auto", alignSelf: "center", textAlign: "center", padding: "0 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650, color: pct == null ? "var(--fg-4)" : lvlColor(lvl, "var(--fg-2)") }}>{pctStr(pct)}</span>
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" style={{ color: "var(--fg-4)" }}>
        <path d="M1 5h10m0 0L8 2m3 3L8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
      <span className="tnum" style={{ fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>meta {metaPct != null ? String(metaPct).replace(".", ",") + "%" : "—"}</span>
    </div>
  );
}

function FunilPeriodo({ team, win, pLabel }) {
  if (team == null) {
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
    // Quem foi trabalhado da base antiga aparece no tooltip, não no card.
    { nm: "Contatados", v: team.contactedCohort ?? team.contacted, m: sMeta(mt?.contacts), title: `Dos leads da janela, os que receberam contato humano${team.paceAdjust?.contacted ? ` (+ ${int(team.paceAdjust.contacted)} do histórico pré-cockpit)` : ""} · no total o time trabalhou ${int(team.contacted)} leads no período (inclui base antiga tocada agora)` },
    { nm: "Calls marcadas", v: team.callsBooked, m: sMeta(mt?.callsBooked), title: `Calls com data na janela${team.pending > 0 ? ` · ${int(team.pending)} ainda no futuro` : ""}` },
    { nm: "Calls realizadas", v: team.shown, m: sMeta(mt?.callsShown), title: `Calls que aconteceram${team.noShow > 0 ? ` · ${int(team.noShow)} não compareceram` : ""}` },
    { nm: "Ganhos", v: team.won, m: sMeta(mt?.won),
      title: `Ganhos no período (= soma dos closers)${team.revenue > 0 ? ` · ${money(team.revenue)}` : ""}`
        + (team.keyAccount ? ` · fora: ${team.keyAccount.won} conta grande (${money(team.keyAccount.revenue)}${team.keyAccount.names?.length ? ` · ${team.keyAccount.names.join(", ")}` : ""})` : "") },
  ];
  const convs = [
    { pct: team.contactRate, metaPct: 80, num: team.contactedCohort ?? null, den: team.leadsNew },
    // Agendamento em COORTE encadeada (régua #650): calls de leads DA janela
    // sobre os alcançados da janela — o hover mostra o N de M.
    { pct: team.bookingRate, metaPct: g.bookingRate?.target || 30, num: team.bookedCohort ?? team.callsBooked, den: team.contactedCohort ?? team.contacted },
    { pct: team.showRate, metaPct: g.showRate?.target || 75, num: team.shown, den: team.shown + team.noShow },
    { pct: team.closeRatePeriod, metaPct: g.closeRate?.target || 33, num: team.won, den: team.shown },
  ];
  const adj = team.paceAdjust;
  return (
    <Card title="Funil do período"
      hint={`${pLabel} · atual vs meta do MÊS por etapa (risquinho = pace) · % entre etapas = comparecimento e conversão`}
      action={adj ? (
        <span className="dim" style={{ fontSize: 11.5, cursor: "help" }}
          title={`Inclui histórico pré-cockpit: ${["leads", "contacted", "booked", "shown"].filter((k) => adj[k]).map((k) => `+${adj[k]} ${({ leads: "leads", contacted: "contatos", booked: "agendadas", shown: "realizadas" })[k]}`).join(" · ")}. Ganhos seguem os registros.`}>
          inclui histórico ⓘ
        </span>
      ) : null}>
      <div className="tbl-x" style={{ padding: "8px var(--inset-x) 18px" }}>
        <div style={{ display: "flex", gap: 0, alignItems: "stretch", minWidth: 680 }}>
          {stages.map((s, i) => (
            <React.Fragment key={s.nm}>
              {i > 0 && <ConvStep {...convs[i - 1]} />}
              <StageBox nm={s.nm} value={s.v} meta={s.m} expectedFrac={monthFrac} title={s.title} />
            </React.Fragment>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Tiles pequenos (Aquisição / Carteira) ────────────────────────────────────
function MiniTile({ label, dot, big, sub, title }) {
  return (
    <div title={title} style={{ background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px", minWidth: 0, cursor: title ? "help" : "default", textAlign: "center" }}>
      <div className="kicker" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: 3, background: dot, flexShrink: 0 }} />}
        {label}
      </div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em", marginTop: 2, whiteSpace: "nowrap" }}>{big}</div>
      {sub != null && <div className="tnum" style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// 3 tiles por linha, fixo (pedido do Leo: 3 em cima, 3 embaixo) — auto-fit
// quebrava em 4+2 e as duas metades ficavam tortas.
const tilesGrid = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 };

function AquisicaoCard({ marketing, biz, classes, pShort }) {
  const cpl = marketing?.totals?.spend > 0 && marketing?.totals?.cpl != null ? marketing.totals.cpl : null;
  const roas = marketing?.totals?.roas != null ? marketing.totals.roas : null;
  const cac = biz?.window?.cac ?? null;
  return (
    <Card title="Aquisição" hint={`${pShort} · dinheiro pela data da venda`}>
      <div style={{ padding: "14px var(--inset-x) 18px", ...tilesGrid }}>
        <MiniTile label="CPL" big={cpl != null ? money(cpl) : "sem gasto"} sub="custo por lead · Meta"
          title={cpl != null ? `${money(marketing.totals.spend)} investidos no período` : "conecte o Meta em Publicidade"} />
        <MiniTile label="CAC" big={cac != null ? money(cac) : "—"} sub="custo por cliente"
          title="Investimento em anúncios ÷ clientes novos do período" />
        <MiniTile label="ROAS" big={roas != null ? String(roas).replace(".", ",") + "x" : "—"} sub="receita ÷ investimento"
          title="Receita dos ganhos atribuída pela data da venda ÷ investimento" />
        <MiniTile label="Leads Semente" dot="var(--chart-1)" big={int(classes?.semente?.leads)} sub="indicação e base"
          title={`Indicação e boca a boca · ${int(classes?.semente?.won)} ganhos no período`} />
        <MiniTile label="Leads Rede" dot="var(--chart-2)" big={int(classes?.rede?.leads)} sub="marketing"
          title={`Tráfego pago, form, social · ${int(classes?.rede?.won)} ganhos no período`} />
        <MiniTile label="Leads Alvo" dot="var(--chart-3)" big={int(classes?.alvo?.leads)} sub="outbound"
          title={`Prospecção ativa · ${int(classes?.alvo?.won)} ganhos no período`} />
      </div>
    </Card>
  );
}

function CarteiraCard({ customers, ltv }) {
  // Estado ACUMULADO da base — não muda com o filtro. Conta grande (keyAccount,
  // ex.: Galante) fica fora das médias; o número grande é sempre o cheio.
  // Churnado = régua única de lib/churn.js (endedAt no PASSADO) — antes esta
  // tela churnava qualquer endedAt, até futuro, e divergia da tela Clientes.
  const ativos = customers.filter((c) => !isChurned(c));
  const churned = customers.length - ativos.length;
  const cg = ativos.filter((c) => !!c.keyAccount);
  const core = ativos.filter((c) => !c.keyAccount);
  const arrAll = ativos.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  const arrCore = core.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  const ticketAll = ativos.length ? arrAll / ativos.length : null;
  const ticketCore = core.length ? arrCore / core.length : null;
  const churnPct = customers.length ? Math.round((churned / customers.length) * 1000) / 10 : 0;
  const semCG = (v) => (cg.length ? money(v) : null);
  return (
    <Card title="Carteira" hint="estado acumulado · não muda com o filtro">
      <div style={{ padding: "14px var(--inset-x) 18px", ...tilesGrid }}>
        <MiniTile label="MRR" big={money(arrAll / 12)} sub={semCG(arrCore / 12)}
          title={cg.length ? "Valor de baixo: sem conta grande" : "contratos ÷ 12"} />
        <MiniTile label="Clientes" big={int(ativos.length)} sub={cg.length ? `${int(core.length)} CP · ${int(cg.length)} CG` : null}
          title="CP = cliente padrão · CG = conta grande (fora das médias)" />
        <MiniTile label="Ticket médio" big={ticketAll != null ? money(ticketAll) : "—"} sub={cg.length && ticketCore != null ? money(ticketCore) : null}
          title={cg.length ? "Valor de baixo: sem conta grande — o ticket que alimenta as metas por contrato" : "valor médio de contrato da base"} />
        <MiniTile label="ARR" big={money(arrAll)} sub={semCG(arrCore)}
          title={cg.length ? "Valor de baixo: sem conta grande" : "soma dos contratos ativos"} />
        <MiniTile label="LTV" big={ltv?.value != null ? money(ltv.value) : "—"}
          title={ltv?.value != null ? `Estimado: ticket mensal × ${ltv.months} meses de permanência (premissa até existir churn real)${ltv.ltvCac ? ` · LTV/CAC ${String(ltv.ltvCac).replace(".", ",")}x` : ""}` : "precisa de assinaturas ativas"} />
        <MiniTile label="Churn" big={`${String(churnPct).replace(".", ",")}%`}
          title={churned ? `${int(churned)} ${churned === 1 ? "cliente saiu" : "clientes saíram"} da base` : "nenhuma renovação vencida ainda"} />
      </div>
    </Card>
  );
}

// ── Atenção agora (avisos com botão de ação) ─────────────────────────────────
const CHIP_TONE = {
  neg: { bg: "var(--neg-soft)", fg: "var(--neg)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  pos: { bg: "var(--pos-soft)", fg: "var(--pos)" },
};

function AtencaoCard({ items }) {
  return (
    <Card title="Atenção agora" hint="riscos primeiro · cada aviso tem o botão da ação">
      <div style={{ padding: "14px var(--inset-x) 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {!items.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Tudo em dia por aqui.</div>}
        {items.map((it) => {
          const tone = CHIP_TONE[it.tone] || CHIP_TONE.info;
          return (
            <div key={it.key} style={{ display: "flex", flexDirection: "column", gap: 6, background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px" }}>
              <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: "var(--r-1)", fontSize: 11, fontWeight: 600, background: tone.bg, color: tone.fg }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />{it.chip}
              </span>
              <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{it.title}</span>
              <span style={{ fontSize: 11.5, color: "var(--fg-3)", flex: 1 }}>{it.sub}</span>
              {it.onClick && (
                <button onClick={it.onClick} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 2, padding: "4px 10px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, background: "var(--bg-1)" }}>
                  {it.action} →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Filtro por mês (atalho que escreve na janela global do cockpit) ──────────
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function MonthSelect() {
  const { period, custom, setPeriod, setCustom } = usePeriod();
  const now = new Date();
  const months = [];
  // Piso: junho/2026 (início da operação no cockpit) — antes disso não há mês
  // pra olhar; o histórico pré-cockpit entra pela régua do paceAdjust, não aqui.
  const MIN_MONTH = "2026-06";
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1, 12);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key < MIN_MONTH) continue;
    months.push({ key, d });
  }
  const currentKey = months[months.length - 1].key;
  const lastDayOf = (key) => {
    const [y, m] = key.split("-").map(Number);
    return `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  };
  // Seleção atual: preset "month" = mês corrente; custom cobrindo um mês
  // inteiro = aquele mês; qualquer outra janela = placeholder.
  let value = "";
  if (period === "month") value = currentKey;
  else if (period === "custom" && custom?.since?.endsWith("-01") && custom.until === lastDayOf(custom.since.slice(0, 7))) value = custom.since.slice(0, 7);
  const pick = (key) => {
    if (!key) return;
    if (key === currentKey) { setPeriod("month"); return; }
    setCustom({ since: `${key}-01`, until: lastDayOf(key) });
    setPeriod("custom");
  };
  return (
    <select value={value} onChange={(e) => pick(e.target.value)} aria-label="Filtrar por mês"
      style={{ height: 32, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
      <option value="" disabled>Mês…</option>
      {months.map(({ key, d }) => (
        <option key={key} value={key}>{MONTH_NAMES[d.getMonth()]} {d.getFullYear()}</option>
      ))}
    </select>
  );
}

// ── A tela ───────────────────────────────────────────────────────────────────
function OverviewScreen({ onNav }) {
  const { LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const [product] = useActiveSaas();
  const [marketing, setMarketing] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/LTV — mesmo endpoint da Publicidade
  const [invoices, setInvoices] = useState([]);
  const [score, setScore] = useState(null); // placar do time da janela do topo
  const [pace, setPace] = useState(null); // pace do mês corrente — /api/pipeline-pace
  const [goal, setGoal] = useState(null); // meta DA JANELA (segue o filtro) — /window
  const [wa, setWa] = useState(null); // inbox do WhatsApp (estado atual do time)
  const { period, custom, win } = usePeriod();

  // A Visão geral é UMA só, a de gestão, pra todo o time: receita, placar e
  // fila de atenção na frente de todo mundo (transparência de operação). O
  // guard da API acompanha — quem tem a tela overview LÊ o que os painéis
  // buscam (OVERVIEW_READ_PREFIXES no screens.js do servidor).
  const loadedFor = React.useRef(null);
  useEffect(() => {
    if (!product) return;
    if (loadedFor.current !== product.id) {
      loadedFor.current = product.id;
      setMarketing(null); setBiz(null); setInvoices([]); setScore(null); setPace(null);
    }
    let alive = true;
    api.marketingMetrics(product.id, { since: win.since, until: win.until }).then((m) => alive && setMarketing(m)).catch(() => alive && setMarketing(null));
    api.metrics(product.id, { days: win.days }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
    api.list("invoices").then((rows) => alive && setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => {});
    // Meta da JANELA do filtro (mês histórico, semana, dia): preset de
    // calendário estica até o fim do período — a régua cobra o mês/semana
    // inteiros com o pace marcando o "hoje".
    api.paceWindow(product.id, goalWindowOf(period, win)).then((g) => alive && setGoal(g)).catch(() => alive && setGoal(null));
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meta do mês e inbox: cadência própria (mês corrente / estado atual), não
  // seguem o filtro do topo.
  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.pipelinePace(product.id).then((d) => alive && setPace(d)).catch(() => alive && setPace(null));
    api.waInsights(30).then((d) => alive && setWa(d)).catch(() => alive && setWa(null));
    return () => { alive = false; };
  }, [product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const leads = useMemo(() => (LEADS || []).filter((l) => l.saas === product?.id && isRealLead(l)), [LEADS, product?.id]);
  const productCustomers = useMemo(() => (CUSTOMERS || []).filter((c) => c.saas === product?.id), [CUSTOMERS, product?.id]);

  if (!product) {
    return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra começar a operar o cockpit." />;
  }

  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Visão geral" sub={today}>
        <MonthSelect />
      </PageHead>

      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <MetaMesCard pace={pace} goal={goal} onNav={onNav} />

        <FunilPeriodo team={score?.team} win={win} pLabel={win.label} />

        <TeamBoard score={score} win={win} onPerson={canSeeScreen("pipeline") ? openPerson : null} />

        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 16 }}>
          <AquisicaoCard marketing={marketing} biz={biz} classes={score?.team?.classes} pShort={win.short} />
          <CarteiraCard customers={productCustomers} ltv={biz?.ltv} />
        </div>

        <AtencaoCard items={atencao} />
      </div>
    </div>
  );
}

export { OverviewScreen, MetaMesCard, FunilPeriodo, TeamBoard, PersonRow };
