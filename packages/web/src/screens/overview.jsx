import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, LineChart, Pill, Segmented } from "../components/viz.jsx";
import { EmptyState, Avatar } from "../atoms.jsx";
import { nextMilestone, dueLabel } from "../lib/milestones.js";
import { openStages, isWonStage, firstStage as firstStageOf } from "../lib/funnel.js";
import { displayName } from "../lib/users.js";
import { useActiveSaas } from "../lib/workspace.js";
// Visão geral — cockpit de GESTÃO. Responde: como está o negócio (receita, CAC,
// ROAS) e como está o DESEMPENHO de cada papel (SDR/closer/CS), pessoa a pessoa,
// contra a meta. A execução ("quem contatar agora") mora no Meu dia, não aqui.
// Focada no produto ativo (abas por SaaS quando o portfólio tem mais de um).

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
const shortDay = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pctStr = (n) => (n == null ? "" : String(n).replace(".", ",") + "%");

// Janela do período (governa a Visão geral inteira): semana (segunda→hoje),
// mês (1º→hoje) ou trimestre (início do trimestre→hoje). A janela ANTERIOR é
// sempre a COMPLETA, que é estável (a atual ainda não fechou) — base da meta
// dinâmica de calls do SDR.
function scoreWindow(period, now = new Date()) {
  if (period === "week") {
    const day = (now.getDay() + 6) % 7; // 0 = segunda
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - day);
    return { since: ymd(monday), prevSince: ymd(new Date(monday.getTime() - 7 * DAY)), prevUntil: ymd(new Date(monday.getTime() - DAY)) };
  }
  if (period === "quarter") {
    const qStart = Math.floor(now.getMonth() / 3) * 3; // 0,3,6,9
    return {
      since: ymd(new Date(now.getFullYear(), qStart, 1)),
      prevSince: ymd(new Date(now.getFullYear(), qStart - 3, 1)),
      prevUntil: ymd(new Date(now.getFullYear(), qStart, 0)),
    };
  }
  return { since: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), prevSince: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), prevUntil: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
}
const PERIOD_LABEL = { week: "esta semana", month: "este mês", quarter: "este trimestre" };
const PERIOD_SHORT = { week: "semana", month: "mês", quarter: "trimestre" };
const daysSince = (ymdStr) => Math.max(1, Math.round((Date.now() - new Date(`${ymdStr}T00:00:00`).getTime()) / DAY) + 1);

function OverviewScreen({ onNav, onOpenLead }) {
  const { SAAS, LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const [product, setActiveSaas] = useActiveSaas();
  const [marketing, setMarketing] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/conversão (30d) — mesmo endpoint da Publicidade
  const [invoices, setInvoices] = useState([]);
  const [costs, setCosts] = useState(null); // custos do mês corrente (tela Custos)
  const [scoreByPeriod, setScoreByPeriod] = useState({}); // { week: {...}, month: {...} } — placar por período
  // Período do TOPO governa os tiles de aquisição e o gráfico. Snapshots
  // financeiros (MRR, Clientes, Resultado do mês) seguem a cadência própria.
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("cockpit_ov_period") || "week"; } catch { return "week"; } });
  const setPeriodP = (p) => { setPeriod(p); try { localStorage.setItem("cockpit_ov_period", p); } catch { /* ignore */ } };
  const win = useMemo(() => scoreWindow(period), [period]);
  const pLabel = PERIOD_LABEL[period];
  const pShort = PERIOD_SHORT[period];

  // Troca de PRODUTO zera os painéis; refresh por versão (SSE) ou período refaz.
  const loadedFor = React.useRef(null);
  useEffect(() => {
    if (!product) return;
    if (loadedFor.current !== product.id) {
      loadedFor.current = product.id;
      setMarketing(null); setInvoices([]); setCosts(null); setScoreByPeriod({});
    }
    let alive = true;
    const until = ymd(new Date());
    api.marketingMetrics(product.id, { since: win.since, until }).then((m) => alive && setMarketing(m)).catch(() => alive && setMarketing(null));
    api.metrics(product.id, { days: daysSince(win.since) }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
    api.list("invoices").then((rows) => alive && setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    api.expensesSummary(product.id).then((c) => alive && setCosts(c)).catch(() => alive && setCosts(null));
    return () => { alive = false; };
  }, [product?.id, version, period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Placar do time: um fetch pro período do topo (o filtro único rege tudo).
  useEffect(() => {
    if (!product) return;
    let alive = true;
    api.scoreboard(product.id, win).then((s) => alive && setScoreByPeriod((prev) => ({ ...prev, [period]: s }))).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, version, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const leads = useMemo(() => (LEADS || []).filter((l) => l.saas === product?.id), [LEADS, product?.id]);

  const now = Date.now();
  const dstr = (iso) => String(iso || "").slice(0, 10);
  const untilStr = ymd(new Date());
  const inPeriod = (iso) => { const d = dstr(iso); return d >= win.since && d <= untilStr; };
  const inPrevPeriod = (iso) => { const d = dstr(iso); return d >= win.prevSince && d <= win.prevUntil; };
  const leadsPeriod = leads.filter((l) => inPeriod(l.createdAt)).length;
  const leadsPrev = leads.filter((l) => inPrevPeriod(l.createdAt)).length;
  const leadsDeltaPct = leadsPrev > 0 ? Math.round(((leadsPeriod - leadsPrev) / leadsPrev) * 100) : null;

  // Série leads/dia do período (semana ~7 pts, mês ~30, trimestre ~90).
  const series = useMemo(() => {
    const byDay = {};
    for (const l of leads) { const d = dstr(l.createdAt); if (d >= win.since && d <= untilStr) byDay[d] = (byDay[d] || 0) + 1; }
    const start = new Date(`${win.since}T00:00:00`);
    const n = daysSince(win.since);
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(start.getTime() + i * DAY);
      out.push({ x: shortDay(d), v: byDay[ymd(d)] || 0 });
    }
    return out;
  }, [leads, win.since]); // eslint-disable-line react-hooks/exhaustive-deps

  // Funil aberto (snapshot atual do pipeline — não é fluxo, não segue o período).
  const funnelStages = useMemo(() => openStages(product), [product]);
  const firstStage = firstStageOf(product);
  const countByStage = (stage) => leads.filter((l) => l.stage === stage || (!l.stage && stage === firstStage)).length;
  const maxStage = Math.max(1, ...funnelStages.map(countByStage));
  // Ganho no PERÍODO (fluxo); Resultado usa o mês (custos são mensais).
  const wonLeadsPeriod = leads.filter((l) => isWonStage(product, l.stage) && inPeriod(l.stageSince));
  const wonPeriod = wonLeadsPeriod.length;
  const thisMonth = (iso) => iso && dstr(iso).slice(0, 7) === new Date(now).toISOString().slice(0, 7);
  const wonValueMonth = leads.filter((l) => isWonStage(product, l.stage) && thisMonth(l.stageSince)).reduce((a, l) => a + (l.amount || 0), 0);
  // Resultado do mês = ganhos do mês menos os custos operacionais (mensais).
  const result = costs ? wonValueMonth - (costs.total || 0) : null;

  // Pendências: faturas abertas vencendo em 7d + marcos de pós-venda.
  const dueInvoices = invoices
    .filter((i) => (i.status === "open" || i.status === "overdue") && i.dueDate && new Date(i.dueDate).getTime() - now <= 7 * DAY)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 3);

  const cpl = marketing?.totals?.spend > 0 && marketing?.totals?.cpl != null ? marketing.totals.cpl : null;
  const roas = marketing?.totals?.roas != null ? marketing.totals.roas : null;
  const productCustomers = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
  const activeCustomers = productCustomers.length;

  const dueMilestones = productCustomers
    .map((c) => ({ customer: c, m: nextMilestone(c, product) }))
    .filter(({ m }) => m && (m.status === "late" || m.status === "soon"))
    .sort((a, b) => String(a.m.dueAt).localeCompare(String(b.m.dueAt)))
    .slice(0, 3);

  if (!product) {
    return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra começar a operar o cockpit." />;
  }

  // Clicar num nome do time abre o pipeline filtrado por aquela pessoa (o
  // pipeline lê a pessoa do localStorage; setamos antes de navegar).
  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
  };

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  // Total do TIME no período: soma o que já foi realizado das métricas que
  // cobramos do SDR e do closer (+ a soma das metas individuais). Segue o
  // mesmo período do topo (score é scoreByPeriod[period]).
  const score = scoreByPeriod[period];
  const teamAgg = (() => {
    const sdrRows = score?.sdr || [], cloRows = score?.closer || [];
    const sum = (rows, f) => rows.reduce((a, p) => a + (Number(f(p)) || 0), 0);
    return {
      hasAny: sdrRows.length + cloRows.length > 0,
      contacted: sum(sdrRows, (p) => p.contacted),
      callsBooked: sum(sdrRows, (p) => p.callsBooked),
      callsMeta: sum(sdrRows, (p) => bookingGoal(p)?.target || 0),
      proposals: sum(cloRows, (p) => p.proposals),
      won: sum(cloRows, (p) => p.won),
      wonMeta: sum(cloRows, (p) => scaleGoal(p.goals?.won, period)?.target || 0),
      revenue: sum(cloRows, (p) => p.revenue),
      revenueMeta: sum(cloRows, (p) => scaleGoal(p.goals?.revenue, period)?.target || 0),
    };
  })();
  const ofMeta = (m) => (m > 0 ? `de ${m} · meta ${pShort}` : "somando o time");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Visão geral" sub={today}>
        <Segmented value={period} onChange={setPeriodP}
          options={[{ value: "week", label: "Semana" }, { value: "month", label: "Mês" }, { value: "quarter", label: "Trimestre" }]} />
      </PageHead>

      <div style={{ padding: "20px var(--pad-x) 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Resultado do mês" value={result != null ? window.fmt.money(result) : "…"}
            delta={costs ? `${window.fmt.money(wonValueMonth)} ganhos · ${window.fmt.money(costs.total || 0)} custos` : "ganhos menos custos"}
            tone={result == null ? "flat" : result >= 0 ? "up" : "down"} />
          <StatTile label="MRR" value={window.fmt.money(product.mrr || 0)} delta={activeCustomers ? "base de " + window.fmt.money(product.arr || 0) + " ARR" : "sem receita ainda"} tone="flat" />
          <StatTile label="Clientes ativos" value={String(activeCustomers)} />
          <StatTile label={`Leads · ${pShort}`} value={String(leadsPeriod)}
            delta={leadsDeltaPct == null ? `${leadsPrev} no ${pShort} anterior` : `${leadsDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(leadsDeltaPct)}% vs. ${pShort} anterior`}
            tone={leadsDeltaPct == null ? "flat" : leadsDeltaPct >= 0 ? "up" : "down"} />
          <StatTile label={`Custo por lead · ${pShort}`} value={cpl != null ? window.fmt.money(cpl) : "sem gasto"}
            delta={cpl != null ? window.fmt.money(marketing.totals.spend) + " investidos" : "conecte o Meta em Publicidade"} tone="flat" />
          <StatTile label={`ROAS · ${pShort}`} value={roas != null ? String(roas).replace(".", ",") + "x" : "sem receita"}
            delta={roas != null ? "receita ÷ investimento" : "precisa de ganho atribuído"} tone={roas == null ? "flat" : roas >= 1 ? "up" : "down"} />
          <StatTile label={`Lead → cliente · ${pShort}`} value={biz?.window?.convRate != null ? pctStr(biz.window.convRate) : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : null} tone="flat" />
        </div>

        {/* Total do time no período: o realizado somado das métricas do SDR + closer. */}
        {teamAgg.hasAny && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <StatTile label={`Contatados · time · ${pShort}`} value={String(teamAgg.contacted)} delta="somando o time" tone="flat" />
            <StatTile label={`Calls agendadas · time · ${pShort}`} value={String(teamAgg.callsBooked)} delta={ofMeta(teamAgg.callsMeta)} tone="flat" />
            <StatTile label={`Propostas · time · ${pShort}`} value={String(teamAgg.proposals)} delta="somando o time" tone="flat" />
            <StatTile label={`Ganhos · time · ${pShort}`} value={String(teamAgg.won)} delta={ofMeta(teamAgg.wonMeta)} tone="flat" />
            <StatTile label={`Receita · time · ${pShort}`} value={window.fmt.money(teamAgg.revenue)}
              delta={teamAgg.revenueMeta > 0 ? `de ${window.fmt.money(teamAgg.revenueMeta)} · meta ${pShort}` : "somando o time"} tone="flat" />
          </div>
        )}

        {/* Desempenho do time — placar por papel (segue o período do topo). */}
        <TeamPerformance score={scoreByPeriod[period]} period={period} onPerson={openPerson} product={product} />

        <div className="resp-cols" style={{ "--cols": "minmax(0,1fr) 340px", gap: 12, alignItems: "start" }}>
          <Card title="Leads por dia" hint={`${pLabel} · clique numa etapa pra abrir o pipeline`}>
            <LineChart data={series} fmtValue={(v) => String(Math.round(v))} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, padding: "4px 16px 16px" }}>
              {funnelStages.map((s) => (
                <button key={s} onClick={() => onNav && onNav("pipeline", { saas: product.id, stage: s })}
                  style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)", textAlign: "left" }}>
                  <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{countByStage(s)}</span>
                  <span style={{ fontSize: 11, color: "var(--fg-3)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                  <span style={{ display: "block", height: 3, borderRadius: 999, background: "var(--accent)", opacity: 0.85, marginTop: 6, width: `${Math.round((countByStage(s) / maxStage) * 100)}%` }} />
                </button>
              ))}
              <button onClick={() => onNav && onNav("pipeline", { saas: product.id })}
                style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)", textAlign: "left" }}>
                <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{wonPeriod}</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)", display: "block" }}>Ganho · {pShort}</span>
                <span style={{ display: "block", height: 3, borderRadius: 999, background: "var(--pos)", marginTop: 6, width: `${Math.min(100, Math.round((wonPeriod / maxStage) * 100))}%` }} />
              </button>
            </div>
          </Card>

          <Card title="Precisa de atenção" hint="pós-venda e cobrança">
            <div style={{ padding: "8px 16px 14px" }}>
              {dueInvoices.length === 0 && dueMilestones.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Tudo em dia por aqui.</div>
              )}
              {dueMilestones.map(({ customer, m }) => (
                <button key={customer.id + m.key} onClick={() => onNav && onNav("customers")}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 0", textAlign: "left" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                      {customer.name} · {m.status === "late" ? "venceu" : "vence"} {dueLabel(m.dueAt)}
                    </div>
                  </div>
                  <Pill tone={m.status === "late" ? "neg" : "warn"}>ver</Pill>
                </button>
              ))}
              {dueInvoices.map((i) => (
                <button key={i.id} onClick={() => onNav && onNav("subscriptions", { saas: product.id })}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 0", textAlign: "left" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{i.status === "overdue" ? "Fatura vencida" : "Fatura vencendo"}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                      {window.fmt.money(i.amount || 0)} · vence {new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}
                    </div>
                  </div>
                  <Pill tone={i.status === "overdue" ? "neg" : "warn"}>ver</Pill>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Desempenho do time ───────────────────────────────────────────────────────
// Um painel por papel (SDR/closer/CS); cada pessoa é uma linha com as métricas
// do papel e a barra de PROGRESSO VS META onde há meta configurada (Ajustes →
// Equipe). Some o painel do papel sem ninguém no período.
const money = (v) => window.fmt.money(v || 0);
const int = (v) => window.fmt.int(v || 0);

function MetaCell({ value, goal, fmt = int }) {
  const has = goal && goal.target > 0;
  const pct = has ? Math.min(100, Math.round((value / goal.target) * 100)) : 0;
  const done = has && value >= goal.target;
  return (
    <div style={{ minWidth: 74 }}>
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>
        {fmt(value)}{has && <span className="dim" style={{ fontWeight: 400, fontSize: 11 }}> / {fmt(goal.target)}</span>}
      </span>
      {has && (
        <span style={{ display: "block", height: 4, borderRadius: 999, background: "var(--bg-3)", marginTop: 4, overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${pct}%`, borderRadius: 999, background: done ? "var(--pos)" : "var(--accent)" }} />
        </span>
      )}
    </div>
  );
}

// Cor por saúde das TAXAS do SDR (maior = melhor). Cortes padrão abaixo — ajuste
// fácil aqui se o Leo quiser outra régua:
//   taxa de agendamento  bom ≥30%  ok ≥15%
//   % compareceram       bom ≥70%  ok ≥50%
//   calls → ganho        bom ≥25%  ok ≥10%
const rateTone = (pct, good, ok) => (pct == null ? "var(--fg-3)" : pct >= good ? "var(--pos)" : pct >= ok ? "var(--warn)" : "var(--neg)");

// Cortes de cor da taxa: a META (quando configurada em Ajustes → Equipe) vira o
// "bom"; "ok" é 2/3 dela. Sem meta, cai no benchmark padrão do argumento.
const tiers = (goal, fallbackGood) => {
  const good = goal?.target > 0 ? goal.target : fallbackGood;
  return { good, ok: Math.round(good * 0.66) };
};

// Meta de calls agendadas DERIVADA do volume: leads do período ANTERIOR (semana
// passada completa) × meta de taxa de agendamento. Base estável — a semana atual
// ainda não fechou. Sem período anterior (mês legado), cai nos leads atuais;
// sem meta de taxa, cai numa meta absoluta de callsBooked.
const bookingGoal = (p) => {
  const rate = p.goals?.bookingRate?.target;
  const base = p.leadsPrev != null ? p.leadsPrev : p.leadsNew;
  if (rate > 0 && base > 0) return { target: Math.round((base * rate) / 100), period: "week" };
  return p.goals?.callsBooked;
};

// Meta absoluta (closer/CS) reescalada pro período da tela: meta mensal vista na
// semana vira ~meta/4,3. Rates não escalam (uma taxa é uma taxa).
const PERIOD_DAYS = { week: 7, month: 30.4, quarter: 91.3 };
const scaleGoal = (goal, period) => {
  if (!goal || !(goal.target > 0)) return goal;
  const factor = PERIOD_DAYS[period] / PERIOD_DAYS[goal.period || "month"];
  return factor === 1 ? goal : { ...goal, target: Math.max(1, Math.round(goal.target * factor)) };
};

// Célula de taxa: número colorido por saúde + fração crua (num/den) + mini-barra.
function RateCell({ pct, num, den, good, ok }) {
  if (pct == null) return <span className="dim" style={{ fontSize: 13 }}>—</span>;
  const tone = rateTone(pct, good, ok);
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ minWidth: 78 }}>
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: tone }}>
        {pctStr(pct)}
        {num != null && den != null && <span className="dim" style={{ fontWeight: 400, fontSize: 10.5 }}> {int(num)}/{int(den)}</span>}
      </span>
      <span style={{ display: "block", height: 4, borderRadius: 999, background: "var(--bg-3)", marginTop: 4, overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${w}%`, borderRadius: 999, background: tone }} />
      </span>
    </div>
  );
}

// Contagem com taxa embaixo (ex.: Contatados = 12 · 24% dos leads), colorida
// por saúde e com mini-barra da taxa.
function CountRate({ count, pct, good, ok }) {
  const tone = rateTone(pct, good, ok);
  const w = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  return (
    <div style={{ minWidth: 78 }}>
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>
        {int(count)}
        {pct != null && <span style={{ fontWeight: 400, fontSize: 10.5, color: tone }}> · {pctStr(pct)}</span>}
      </span>
      {pct != null && (
        <span style={{ display: "block", height: 4, borderRadius: 999, background: "var(--bg-3)", marginTop: 4, overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${w}%`, borderRadius: 999, background: tone }} />
        </span>
      )}
    </div>
  );
}

// SLA de 1º toque: mediana em horas + % no prazo (colorido) + fora do prazo.
function SlaCell({ p }) {
  const within = p.leadsNew > 0 ? Math.round((p.withinSla / p.leadsNew) * 100) : null;
  const tone = rateTone(within, 80, 50);
  return (
    <div style={{ minWidth: 92 }}>
      <span className="mono" style={{ fontSize: 12 }}>
        {p.firstTouchMedianH != null ? `${String(p.firstTouchMedianH).replace(".", ",")}h` : "—"}
        {within != null && <span style={{ color: tone, fontWeight: 700 }}> · {within}%</span>}
      </span>
      {p.breached > 0 && <span style={{ display: "block", fontSize: 10, color: "var(--neg)" }}>{p.breached} fora do prazo</span>}
    </div>
  );
}

// Motivos de perda do closer: total + top motivos (tooltip com a lista toda).
function LossCell({ p, lossLabel }) {
  if (!p.lost) return <span className="dim" style={{ fontSize: 13 }}>—</span>;
  const top = (p.lossReasons || []).slice(0, 2).map((r) => `${lossLabel(r.reason)} ${r.count}`).join(", ");
  const full = (p.lossReasons || []).map((r) => `${lossLabel(r.reason)}: ${r.count}`).join("\n");
  return (
    <span title={full} style={{ fontSize: 12, minWidth: 120, display: "inline-block" }}>
      <span className="tnum" style={{ fontWeight: 600, color: "var(--neg)" }}>{int(p.lost)}</span>
      <span className="dim" style={{ fontSize: 10.5 }}> · {top}</span>
    </span>
  );
}

// Alerta do painel: total de leads novos sem 1º toque além do prazo.
function SlaAlarm({ n }) {
  if (!n) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 8px 8px", padding: "8px 12px", borderRadius: "var(--r-2)", background: "color-mix(in srgb, var(--neg) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--neg) 30%, transparent)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 14 }}>⚠</span>
      <span style={{ fontSize: 12.5, color: "var(--neg)", fontWeight: 700 }}>{int(n)} {n === 1 ? "lead novo fora" : "leads novos fora"} do SLA de 1º toque</span>
      <span className="mono dim" style={{ fontSize: 10.5 }}>· nunca tocados além do prazo da cadência</span>
    </div>
  );
}

const PANELS = [
  {
    key: "sdr", title: "SDR", hint: "topo de funil: qualifica e agenda a call",
    alarm: (rows) => <SlaAlarm n={rows.reduce((a, p) => a + (p.breached || 0), 0)} />,
    cols: [
      { label: "Contatados", render: (p) => <CountRate count={p.contacted} pct={p.contactRate} {...tiers(p.goals?.contactRate, 70)} /> },
      // Alvo de calls DINÂMICO: leads da semana passada × meta de agendamento.
      { label: "Calls agendadas", render: (p) => <MetaCell value={p.callsBooked} goal={bookingGoal(p)} /> },
      { label: "Taxa agend.", render: (p) => <RateCell pct={p.bookingRate} num={p.callsBooked} den={p.leadsNew} {...tiers(p.goals?.bookingRate, 30)} /> },
      { label: "SLA 1º toque", render: (p) => <SlaCell p={p} /> },
      { label: "% compareceram", render: (p) => (
        <span title={p.showRate != null ? `${p.noShow} não compareceram` : "sem call resolvida no período"}>
          <RateCell pct={p.showRate} num={p.shown} den={p.showRate != null ? p.shown + p.noShow : null} {...tiers(p.goals?.showRate, 70)} />
        </span>
      ) },
      { label: "Calls → ganho", render: (p) => <RateCell pct={p.callWinRate} num={p.wonFromCalls} den={p.callsBooked} {...tiers(p.goals?.callWinRate, 25)} /> },
    ],
  },
  {
    key: "closer", title: "Closers", hint: "da call ao fechamento",
    cols: [
      { label: "Propostas", render: (p) => <CountRate count={p.proposals} pct={p.proposalRate} {...tiers(p.goals?.proposalRate, 60)} /> },
      { label: "Fecha. proposta", render: (p) => <RateCell pct={p.proposalWinRate} num={p.won} den={p.proposals} {...tiers(p.goals?.proposalWinRate, 30)} /> },
      { label: "Win rate", render: (p) => <RateCell pct={p.winRateCall} num={p.won} den={p.calls} {...tiers(p.goals?.winRateCall, 25)} /> },
      { label: "Ganhos", render: (p, ctx) => <MetaCell value={p.won} goal={scaleGoal(p.goals?.won, ctx.period)} /> },
      { label: "Receita", render: (p, ctx) => <MetaCell value={p.revenue} goal={scaleGoal(p.goals?.revenue, ctx.period)} fmt={money} /> },
      { label: "Ticket médio", render: (p) => <MetaCell value={p.ticket || 0} goal={p.goals?.ticket} fmt={money} /> },
      { label: "Ciclo", render: (p) => <span className="tnum" title="dias da criação ao ganho">{p.cycleDays != null ? `${String(p.cycleDays).replace(".", ",")}d` : "—"}</span> },
      { label: "Motivos de perda", render: (p, ctx) => <LossCell p={p} lossLabel={ctx.lossLabel} /> },
    ],
  },
  {
    key: "cs", title: "CS / Retenção", hint: "pós-venda e carteira",
    cols: [
      { label: "Contas", render: (p) => <span className="tnum">{int(p.activeAccounts)}</span> },
      { label: "Novas", render: (p, ctx) => <MetaCell value={p.newAccounts} goal={scaleGoal(p.goals?.newAccounts, ctx.period)} /> },
      { label: "Retenção", render: (p) => <RateCell pct={p.retentionRate} {...tiers(p.goals?.retentionRate, 95)} /> },
      { label: "Churn", render: (p) => <span className="tnum" style={{ color: p.churned > 0 ? "var(--neg)" : "var(--fg-3)" }}>{int(p.churned)}</span> },
      { label: "NPS", render: (p) => <span className="tnum" title={p.npsCount ? `${p.npsCount} respostas` : "sem resposta ainda"}>{p.nps != null ? String(p.nps).replace(".", ",") : "—"}</span> },
    ],
  },
  {
    key: "social", title: "Mídia social", hint: "conteúdo e criativos · produção conectada em breve (alvo definido em Metas)",
    cols: [
      { label: "Posts", render: (p, ctx) => <MetaCell value={p.postsPerMonth} goal={scaleGoal(p.goals?.postsPerMonth, ctx.period)} /> },
      { label: "Stories", render: (p, ctx) => <MetaCell value={p.storiesPerMonth} goal={scaleGoal(p.goals?.storiesPerMonth, ctx.period)} /> },
      { label: "Ads", render: (p, ctx) => <MetaCell value={p.adsPerMonth} goal={scaleGoal(p.goals?.adsPerMonth, ctx.period)} /> },
    ],
  },
];

// O placar do time segue o FILTRO ÚNICO do topo da página (period): todos os
// painéis (SDR/closer/CS) usam o mesmo período, sem toggle por bloco.
function TeamPerformance({ score, period, onPerson, product }) {
  const lossLabel = React.useMemo(() => {
    const m = Object.fromEntries((product?.lossReasons || []).map((r) => [r.id, r.label]));
    return (id) => m[id] || (id === "nao_informado" ? "não informado" : id);
  }, [product]);
  return (
    <Card title="Desempenho do time" hint="segue o período do topo da página · SDR: meta = leads do período anterior × taxa · clique num nome pra abrir o pipeline">
      <div style={{ padding: "6px 8px 12px" }}>
        {PANELS.map((panel) => {
          const data = score;
          const rows = data?.[panel.key] || [];
          const ctx = { period, lossLabel };
          // Larguras FIXAS (não fr) pra os painéis alinharem entre si: a coluna
          // Pessoa e as de métrica começam no mesmo x em todos os papéis.
          const PERSON_W = 160, COL_W = 116;
          const gridCols = `${PERSON_W}px repeat(${panel.cols.length}, ${COL_W}px)`;
          const minW = PERSON_W + panel.cols.length * COL_W;
          return (
            <div key={panel.key} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{panel.title}</span>
                <span className="mono dim" style={{ fontSize: 10.5 }}>{panel.hint} · {PERIOD_LABEL[period]}</span>
              </div>
              {data == null && <div className="mono dim" style={{ padding: "8px", fontSize: 12 }}>carregando…</div>}
              {data != null && !rows.length && (
                <div style={{ padding: "8px", fontSize: 12.5, color: "var(--fg-4)" }}>Sem atividade {PERIOD_LABEL[period]}.</div>
              )}
              {rows.length > 0 && panel.alarm && panel.alarm(rows)}
              {rows.length > 0 && (
                <div className="tbl-x">
                  <div style={{ minWidth: minW }}>
                    <div className="mono" style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, padding: "6px 10px", fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", borderBottom: "1px solid var(--line-1)" }}>
                      <span>Pessoa</span>
                      {panel.cols.map((c) => <span key={c.label}>{c.label}</span>)}
                    </div>
                    {rows.map((p) => (
                      <div key={p.user} style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, padding: "8px 10px", alignItems: "center", borderBottom: "1px solid var(--line-1)" }}>
                        <button onClick={() => onPerson && onPerson(p.user)} title="abrir o pipeline dele"
                          style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", minWidth: 0 }}>
                          <Avatar id={p.user} name={p.name} size={20} />
                          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        </button>
                        {panel.cols.map((c) => <div key={c.label}>{c.render(p, ctx)}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export { OverviewScreen };
