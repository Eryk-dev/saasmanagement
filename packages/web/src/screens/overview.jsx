import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card } from "../components/viz.jsx";
import { EmptyState, Avatar } from "../atoms.jsx";
import { stageKind, isRealLead } from "../lib/funnel.js";
import { bizDay } from "../lib/format.js";
import { currentUser, isAdminUser, canSeeScreen } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
import { buildPeople, roleLabel, scaledGoal } from "../components/team-cards.jsx";
import { usePeriod, businessDaysBetween } from "../components/period-picker.jsx";
// Visão geral — o modelo aprovado pelo Leo em 08/08/2026 (protótipo v9):
//   Meta do mês (réguas de receita contratada e de contratos, com pace)
//   → Desempenho do time (rank + foto + medidores receita/contratos + submetas)
//   → Funil do período (atual vs meta por etapa) → Aquisição + Carteira
//   → Atenção agora (avisos com botão de ação).
// Escala de cores única: vermelho (atrás do caminho) → teal (no pace) → verde
// (meta batida) → dourado (120%+, alinhado às bandas da remuneração).
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

function LvlChip({ lvl, label }) {
  if (!lvl) return null;
  const c = LVL_COLOR[lvl];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label || LVL_LABEL[lvl]}
    </span>
  );
}

// Fração do período que já passou, em dias ÚTEIS (o pace da janela do topo).
function elapsedFracOf(win) {
  const today = bizDay(new Date());
  if (today < win.since) return 0;
  const end = today < win.until ? today : win.until;
  return Math.min(1, businessDaysBetween(win.since, end) / Math.max(1, win.businessDays));
}

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
        <span style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${fill}%`, minWidth: 4, borderRadius: 999, background: lvlColor(lvl, "var(--accent)") }} />
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
// do /api/pipeline-pace: `sale` = vendido no mês (contrato cheio) e `contracts`
// = nº de fechamentos vs. meta (a digitada em Metas vence; senão venda ÷ ticket
// sem contas grandes).
function MetaMesCard({ pace, onNav, links = true }) {
  const s = pace?.sale;
  if (!s) return null;
  const c = pace.contracts || {};
  const sLvl = levelOf(s.sold, s.target, s.expectedProgress);
  const cLvl = c.target != null ? levelOf(c.sold, c.target, c.expectedProgress) : null;
  const saleTitle = `Receita nova contratada no mês (contrato cheio). Hoje: ${money(s.soldToday)} · ritmo ${money(s.actualDailyPace)}/dia útil`
    + (s.requiredDailyPace != null ? ` · precisa ${money(s.requiredDailyPace)}/dia` : "")
    + ` · ${int(s.remainingBusinessDays)} dias úteis restantes · projeção do mês ${money(s.projected)}.`;
  const contractsTitle = c.targetSource === "company"
    ? "Meta de contratos digitada em Metas → Empresa (a da remuneração)."
    : "Meta derivada: venda do mês ÷ ticket médio sem contas grandes.";
  return (
    <Card title="Meta do mês" hint="sempre o mês corrente · o filtro não muda esta faixa"
      action={links ? <button onClick={() => onNav && onNav("analise")} style={{ fontSize: 12.5, fontWeight: 500, color: "var(--accent)" }}>Ver análise completa →</button> : null}>
      <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: "16px 36px", padding: "16px var(--inset-x) 20px" }}>
        <Regua
          label="Régua de receita"
          title={saleTitle}
          valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{money(s.sold)}</strong> / {money(s.target)} · {Math.round((s.progress || 0) * 100)}%</>}
          pct={s.progress} expectedPct={s.expectedProgress} lvl={sLvl}
        />
        {c.target != null ? (
          <Regua
            label="Régua de contratos"
            title={contractsTitle}
            valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{int(c.sold)}</strong> / {int(c.target)} · {Math.round((c.progress || 0) * 100)}%</>}
            pct={c.progress} expectedPct={c.expectedProgress} lvl={cLvl}
          />
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--fg-4)", alignSelf: "center" }}>
            Sem meta de contratos ainda: registre uma venda (pro ticket existir) ou
            {links ? <button onClick={() => onNav && onNav("metas")} style={{ fontWeight: 600, color: "var(--accent)", marginLeft: 4 }}>digite a meta em Metas →</button> : " digite a meta em Metas."}
          </div>
        )}
      </div>
      {links && s.targetConfigured === false && (
        <div style={{ padding: "0 var(--inset-x) 16px" }}>
          <button onClick={() => onNav && onNav("metas")} style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", textAlign: "left" }}>
            essa é a meta padrão do sistema · defina a sua em Metas → Empresa
          </button>
        </div>
      )}
    </Card>
  );
}

// ── Medidor circular (donut) das duas pernas: receita e contratos ────────────
function Donut({ label, value, target, isMoney, lvl }) {
  const pct = target > 0 && value != null ? value / target : null;
  const dash = pct == null ? 0 : Math.min(1, pct) * 188.5;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width="74" height="74" viewBox="0 0 74 74" role="img" aria-label={`${label}: ${pct == null ? "sem meta" : Math.round(pct * 100) + "% da meta"}`}>
        <circle cx="37" cy="37" r="30" fill="none" strokeWidth="8" stroke="var(--bg-2)" />
        {pct != null && pct > 0 && (
          <circle cx="37" cy="37" r="30" fill="none" strokeWidth="8" strokeLinecap="round"
            stroke={lvlColor(lvl, "var(--accent)")} strokeDasharray={`${dash.toFixed(1)} 188.5`} transform="rotate(-90 37 37)" />
        )}
        <text x="37" y="42" textAnchor="middle" className="tnum" style={{ fontSize: 14, fontWeight: 650, fill: "var(--fg-1)" }}>
          {pct == null ? "—" : `${Math.round(pct * 100)}%`}
        </text>
      </svg>
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontWeight: 550 }}>{label}</span>
      <span className="tnum" style={{ fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap" }}>
        {value == null ? "—" : isMoney ? `R$ ${compactMoney(value)}` : int(value)}
        {target > 0 ? ` / ${isMoney ? compactMoney(target) : int(target)}` : " · sem meta"}
      </span>
    </div>
  );
}

// Linha de submeta (label à esquerda, atual / meta à direita, cor pela escala).
// nowrap nos dois lados: valor quebrado no meio ("22," numa linha, "/33" na
// outra) era o bug visual da 1ª versão — a coluna encolhia demais.
function RateRow({ label, valueText, metaText, lvl, title }) {
  return (
    <div title={title} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 12, minWidth: 0 }}>
      <span style={{ color: "var(--fg-3)", whiteSpace: "nowrap" }}>{label}</span>
      <span className="tnum" style={{ whiteSpace: "nowrap" }}>
        <b style={{ fontWeight: 650, color: lvlColor(lvl) }}>{valueText}</b>
        {metaText != null && <span style={{ color: "var(--fg-4)" }}> / {metaText}</span>}
      </span>
    </div>
  );
}

// Submetas por papel — tudo dado que o placar já mede, comparado com a meta.
function personRows(p, bizDays, elapsedFrac) {
  const rows = [];
  const rate = (label, value, target, title) => rows.push({
    label, valueText: pctStr(value), metaText: target != null ? int(target) : null,
    lvl: levelOf(value, target, 1), title,
  });
  const flow = (label, value, target, title) => rows.push({
    label, valueText: int(value), metaText: target != null ? int(target) : null,
    lvl: levelOf(value, target, elapsedFrac), title,
  });
  if (p.sdr) {
    const g = p.sdr.goals || {};
    rate("contato", p.sdr.contactRate, g.contactRate?.target || 80, "Dos leads que entraram, quantos você alcançou");
    rate("agendamento", p.sdr.bookingRate, g.bookingRate?.target || 30, "Dos contatados, quantos marcaram call");
    rate("show", p.sdr.showRate, g.showRate?.target || 75, "Das calls que já deveriam ter acontecido, quantas aconteceram");
    const bookedTarget = scaledGoal(g.callsBooked, bizDays)
      || (g.bookingRate?.target > 0 && p.sdr.leadsPrev > 0 ? Math.round((p.sdr.leadsPrev * g.bookingRate.target) / 100) : null);
    flow("agendadas", p.sdr.callsBooked, bookedTarget, "Calls agendadas no período vs. a meta da vaga");
  }
  if (p.closer) {
    const g = p.closer.goals || {};
    flow("calls", p.closer.callsShown, scaledGoal(g.callsShown, bizDays), "Calls realizadas (sem no-show) vs. meta da vaga");
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
  }
  if (p.cs) {
    const g = p.cs.goals || {};
    rows.push({ label: "contas ativas", valueText: int(p.cs.activeAccounts), metaText: null, lvl: null, title: "Clientes na carteira dele" });
    rate("retenção", p.cs.retentionRate, g.retentionRate?.target || 95, "Base que ficou (100 − churn)");
    if (p.cs.nps != null || g.nps?.target) rate("nps", p.cs.nps, g.nps?.target || 80, "NPS médio das contas dele");
    flow("indicações", p.cs.referrals, scaledGoal(g.referrals, bizDays), "Indicações recebidas na janela (nº do time)");
  }
  if (p.social) {
    const g = p.social.goals || {};
    flow("posts", p.social.postsPerMonth, scaledGoal(g.postsPerMonth, bizDays));
    flow("stories", p.social.storiesPerMonth, scaledGoal(g.storiesPerMonth, bizDays));
    flow("ads", p.social.adsPerMonth, scaledGoal(g.adsPerMonth, bizDays));
  }
  return rows;
}

function PersonCard({ p, rank, bizDays, elapsedFrac, onPerson }) {
  // As duas pernas do plano de remuneração (receita + contratos) — closer e SDR
  // têm meta própria pelo nível (comp_plans); CS/mídia mostram só as submetas.
  const leg = p.closer || p.sdr || null;
  const revTarget = leg ? scaledGoal(leg.goals?.revenue, bizDays) : null;
  const wonTarget = leg ? scaledGoal(leg.goals?.won, bizDays) : null;
  const rows = personRows(p, bizDays, elapsedFrac);
  return (
    <section onClick={() => onPerson && onPerson(p.user)}
      style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: "14px 16px", cursor: onPerson ? "pointer" : "default", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {rank != null && (
          <span className="mono tnum" style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: "var(--r-1)", padding: "1px 6px" }}>{rank}#</span>
        )}
        <Avatar id={p.user} name={p.name} size={30} />
        <span style={{ fontSize: 14, fontWeight: 650 }}>{p.name}</span>
        <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-4)" }}>{roleLabel(p)}</span>
      </div>
      {/* Layout SEMPRE empilhado: medidores centralizados em cima, submetas
          embaixo. A versão lado a lado dependia de wrap e o alignContent
          esticado espalhava as linhas pelo card — era o layout "horrível". */}
      {leg && (
        <div style={{ display: "flex", gap: 26, justifyContent: "center", padding: "2px 0 14px" }}>
          <Donut label="Receita" value={leg.revenue} target={revTarget} isMoney
            lvl={levelOf(leg.revenue, revTarget, elapsedFrac)} />
          <Donut label="Contratos" value={leg.won} target={wonTarget}
            lvl={levelOf(leg.won, wonTarget, elapsedFrac)} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", borderTop: leg ? "1px solid var(--line-faint)" : "none", paddingTop: leg ? 4 : 0 }}>
        {rows.map((r) => <RateRow key={r.label} {...r} />)}
        {!rows.length && <span style={{ fontSize: 12, color: "var(--fg-4)" }}>sem metas configuradas ainda</span>}
      </div>
    </section>
  );
}

// ── Desempenho do time (ranqueado por % da meta) ─────────────────────────────
function TeamBoard({ score, win, onPerson }) {
  const elapsedFrac = elapsedFracOf(win);
  const people = useMemo(() => {
    const list = buildPeople(score);
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
    <Card title="Desempenho do time" hint="ranqueado por % da meta · clique num nome pra abrir o pipeline">
      <div style={{ padding: "8px var(--inset-x) 20px" }}>
        {score == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {score != null && !people.length && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Sem atividade nesse período.</div>}
        {people.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "stretch" }}>
            {people.map(({ p, pct }, i) => (
              <PersonCard key={p.user} p={p} rank={pct >= 0 ? i + 1 : null} bizDays={win.businessDays} elapsedFrac={elapsedFrac} onPerson={onPerson} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Funil do período (atual vs meta · barra = % da meta da etapa) ────────────
function StageBox({ nm, value, meta, lvl, title }) {
  return (
    <div title={title} style={{ flex: "1 1 0", minWidth: 108, padding: "4px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--fg-3)", marginBottom: 4 }}>{nm}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em" }}>{int(value)}</div>
      <div className="tnum" style={{ fontSize: 11.5, color: "var(--fg-4)", minHeight: 17 }}>{meta != null ? `meta ${int(meta)}` : ""}</div>
      <div style={{ position: "relative", height: 7, borderRadius: 999, background: "var(--bg-2)", marginTop: 8 }}>
        <span style={{ position: "absolute", top: 0, bottom: 0, left: 0, minWidth: 4, borderRadius: 999, background: lvlColor(lvl, "var(--accent)"), width: `${meta > 0 ? Math.min(100, Math.round(((value || 0) / meta) * 100)) : 100}%` }} />
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
  // Meta do MÊS por etapa (a cadeia derivada da meta da empresa) reescalada
  // pros dias úteis da janela — mesma convenção do scaledGoal (base 21,75/mês).
  const mt = team.monthTargets || null;
  const scale = win.businessDays / 21.75;
  const sMeta = (v) => (mt && v != null ? Math.max(1, Math.round(v * scale)) : null);
  const elapsedFrac = elapsedFracOf(win);
  const g = team.goals || {};
  const stages = [
    { nm: "Leads", v: team.leadsNew, m: sMeta(mt?.leads), title: "Leads que entraram na janela (sem internos e sem saídas laterais do form)" },
    { nm: "Contatados", v: team.contacted, m: sMeta(mt?.contacts), title: `Leads trabalhados no período (contato humano; inclui lead antigo tocado agora${team.paceAdjust?.contacted ? ` + ${int(team.paceAdjust.contacted)} do histórico pré-cockpit` : ""})` },
    { nm: "Calls marcadas", v: team.callsBooked, m: sMeta(mt?.callsBooked), title: `Calls com data na janela${team.pending > 0 ? ` · ${int(team.pending)} ainda no futuro` : ""}` },
    { nm: "Calls realizadas", v: team.shown, m: sMeta(mt?.callsShown), title: `Calls que aconteceram${team.noShow > 0 ? ` · ${int(team.noShow)} não compareceram` : ""}` },
    { nm: "Ganhos", v: team.won, m: sMeta(mt?.won), title: `Ganhos no período (= soma dos closers)${team.revenue > 0 ? ` · ${money(team.revenue)}` : ""}` },
  ];
  const convs = [
    { pct: team.contactRate, metaPct: 80, num: null, den: null },
    { pct: team.bookingRate, metaPct: g.bookingRate?.target || 30, num: team.callsBooked, den: team.contacted },
    { pct: team.showRate, metaPct: g.showRate?.target || 75, num: team.shown, den: team.shown + team.noShow },
    { pct: team.closeRatePeriod, metaPct: g.closeRate?.target || 33, num: team.won, den: team.shown },
  ];
  const adj = team.paceAdjust;
  return (
    <Card title="Funil do período"
      hint={`${pLabel} · atual vs meta · barra = % da meta da etapa · % entre etapas = comparecimento e conversão`}
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
              <StageBox nm={s.nm} value={s.v} meta={s.m} lvl={levelOf(s.v, s.m, elapsedFrac)} title={s.title} />
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
    <div title={title} style={{ background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "12px 14px", minWidth: 0, cursor: title ? "help" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-3)", fontWeight: 550 }}>
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
  const ativos = customers.filter((c) => !c.endedAt);
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
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1, 12);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, d });
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
  const [pace, setPace] = useState(null); // meta do mês — /api/pipeline-pace
  const [wa, setWa] = useState(null); // inbox do WhatsApp (estado atual do time)
  const { period, custom, win } = usePeriod();

  // Lente por CARGO: quem não é gestão vê as próprias metas + a meta do mês.
  const eu = currentUser();
  const gestao = !eu || isAdminUser();

  const loadedFor = React.useRef(null);
  useEffect(() => {
    if (!product) return;
    if (loadedFor.current !== product.id) {
      loadedFor.current = product.id;
      setMarketing(null); setBiz(null); setInvoices([]); setScore(null); setPace(null);
    }
    let alive = true;
    if (gestao) {
      api.marketingMetrics(product.id, { since: win.since, until: win.until }).then((m) => alive && setMarketing(m)).catch(() => alive && setMarketing(null));
      api.metrics(product.id, { days: win.days }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
      api.list("invoices").then((rows) => alive && setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    }
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, version, period, custom.since, custom.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Meta do mês e inbox: cadência própria (mês corrente / estado atual), não
  // seguem o filtro do topo.
  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.pipelinePace(product.id).then((d) => alive && setPace(d)).catch(() => alive && setPace(null));
    if (gestao) api.waInsights(30).then((d) => alive && setWa(d)).catch(() => alive && setWa(null));
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

  // ── Lente individual: as próprias metas + a meta do mês da empresa ─────────
  if (!gestao) {
    const minha = buildPeople(score).find((p) => p.user === eu?.id) || null;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
        <PageHead title="Suas metas" sub={today} />
        <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
          <MetaMesCard pace={pace} links={false} />
          <Card title={`Suas metas · ${win.label}`} hint="o que a sua vaga precisa entregar no período">
            <div style={{ padding: "8px var(--inset-x) 20px" }}>
              {score == null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
              {score != null && !minha && (
                <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
                  Sua vaga ainda não tem metas configuradas neste produto.<br />
                  Peça pra gestão preencher em <b>Metas</b>, que elas aparecem aqui.
                </div>
              )}
              {minha && (
                <div style={{ maxWidth: 480 }}>
                  <PersonCard p={minha} rank={null} bizDays={win.businessDays} elapsedFrac={elapsedFracOf(win)}
                    onPerson={canSeeScreen("pipeline") ? openPerson : null} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

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
        <MetaMesCard pace={pace} onNav={onNav} />

        <TeamBoard score={score} win={win} onPerson={openPerson} />

        <FunilPeriodo team={score?.team} win={win} pLabel={win.label} />

        <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: 16 }}>
          <AquisicaoCard marketing={marketing} biz={biz} classes={score?.team?.classes} pShort={win.short} />
          <CarteiraCard customers={productCustomers} ltv={biz?.ltv} />
        </div>

        <AtencaoCard items={atencao} />
      </div>
    </div>
  );
}

export { OverviewScreen, MetaMesCard, FunilPeriodo, TeamBoard, PersonCard };
