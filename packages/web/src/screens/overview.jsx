import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, LineChart, Pill } from "../components/viz.jsx";
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
const dayKey = (iso) => String(iso || "").slice(0, 10);
const shortDay = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const pctStr = (n) => (n == null ? "" : String(n).replace(".", ",") + "%");

function OverviewScreen({ onNav, onOpenLead }) {
  const { SAAS, LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const [product, setActiveSaas] = useActiveSaas();
  const [marketing, setMarketing] = useState(null);
  const [biz, setBiz] = useState(null); // CAC/conversão (30d) — mesmo endpoint da Publicidade
  const [invoices, setInvoices] = useState([]);
  const [costs, setCosts] = useState(null); // custos do mês corrente (tela Custos)
  const [score, setScore] = useState(null); // placar por pessoa/papel (mês corrente)

  // Troca de PRODUTO zera os painéis; refresh por versão (SSE) só refaz o fetch.
  const loadedFor = React.useRef(null);
  useEffect(() => {
    if (!product) return;
    if (loadedFor.current !== product.id) {
      loadedFor.current = product.id;
      setMarketing(null); setInvoices([]); setCosts(null); setScore(null);
    }
    let alive = true;
    api.marketingMetrics(product.id).then((m) => alive && setMarketing(m)).catch(() => alive && setMarketing(null));
    api.metrics(product.id, { days: 30 }).then((b) => alive && setBiz(b)).catch(() => alive && setBiz(null));
    api.list("invoices").then((rows) => alive && setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    api.expensesSummary(product.id).then((c) => alive && setCosts(c)).catch(() => alive && setCosts(null));
    api.scoreboard(product.id, { since: monthStart() }).then((s) => alive && setScore(s)).catch(() => alive && setScore(null));
    return () => { alive = false; };
  }, [product?.id, version]);

  const leads = useMemo(() => (LEADS || []).filter((l) => l.saas === product?.id), [LEADS, product?.id]);

  const now = Date.now();
  const in30 = (iso) => iso && now - new Date(iso).getTime() <= 30 * DAY;
  const inPrev30 = (iso) => {
    if (!iso) return false;
    const age = now - new Date(iso).getTime();
    return age > 30 * DAY && age <= 60 * DAY;
  };
  const leads30 = leads.filter((l) => in30(l.createdAt)).length;
  const leadsPrev30 = leads.filter((l) => inPrev30(l.createdAt)).length;
  const leadsDeltaPct = leadsPrev30 > 0 ? Math.round(((leads30 - leadsPrev30) / leadsPrev30) * 100) : null;

  // Série leads/dia (30 dias) a partir de createdAt.
  const series = useMemo(() => {
    const byDay = {};
    for (const l of leads) if (in30(l.createdAt)) byDay[dayKey(l.createdAt)] = (byDay[dayKey(l.createdAt)] || 0) + 1;
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * DAY);
      out.push({ x: shortDay(d), v: byDay[dayKey(d.toISOString())] || 0 });
    }
    return out;
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Funil aberto (régua antes do ganho, pelos kinds — pós-venda/descarte fora).
  const funnelStages = useMemo(() => openStages(product), [product]);
  const firstStage = firstStageOf(product);
  const countByStage = (stage) => leads.filter((l) => l.stage === stage || (!l.stage && stage === firstStage)).length;
  const maxStage = Math.max(1, ...funnelStages.map(countByStage));
  const thisMonth = (iso) => iso && dayKey(iso).slice(0, 7) === new Date(now).toISOString().slice(0, 7);
  const wonLeadsMonth = leads.filter((l) => isWonStage(product, l.stage) && thisMonth(l.stageSince));
  const wonMonth = wonLeadsMonth.length;
  const wonValueMonth = wonLeadsMonth.reduce((a, l) => a + (l.amount || 0), 0);
  // Resultado do mês = valor ganho no pipeline menos os custos operacionais.
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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Visão geral" sub={today} />

      <div style={{ padding: "20px var(--pad-x) 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Resultado do mês" value={result != null ? window.fmt.money(result) : "…"}
            delta={costs ? `${window.fmt.money(wonValueMonth)} ganhos · ${window.fmt.money(costs.total || 0)} custos` : "ganhos menos custos"}
            tone={result == null ? "flat" : result >= 0 ? "up" : "down"} />
          <StatTile label="MRR" value={window.fmt.money(product.mrr || 0)} delta={activeCustomers ? "base de " + window.fmt.money(product.arr || 0) + " ARR" : "sem receita ainda"} tone="flat" />
          <StatTile label="Clientes ativos" value={String(activeCustomers)} />
          <StatTile label="Leads · 30 dias" value={String(leads30)}
            delta={leadsDeltaPct == null ? null : `${leadsDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(leadsDeltaPct)}% vs. 30d anteriores`}
            tone={leadsDeltaPct == null ? "flat" : leadsDeltaPct >= 0 ? "up" : "down"} />
          <StatTile label="Custo por lead · 30d" value={cpl != null ? window.fmt.money(cpl) : "sem gasto"}
            delta={cpl != null ? window.fmt.money(marketing.totals.spend) + " investidos" : "conecte o Meta em Publicidade"} tone="flat" />
          <StatTile label="ROAS · 30d" value={roas != null ? String(roas).replace(".", ",") + "x" : "sem receita"}
            delta={roas != null ? "receita ÷ investimento" : "precisa de ganho atribuído"} tone={roas == null ? "flat" : roas >= 1 ? "up" : "down"} />
          <StatTile label="Lead → cliente · 30d" value={biz?.window?.convRate != null ? pctStr(biz.window.convRate) : "sem dado"}
            delta={biz?.window?.newCustomers != null ? `${biz.window.newCustomers} ${biz.window.newCustomers === 1 ? "cliente novo" : "clientes novos"}` : null} tone="flat" />
        </div>

        {/* Desempenho do time — placar por papel, cada pessoa vs. meta (mês). */}
        <TeamPerformance score={score} onPerson={openPerson} onNav={onNav} product={product} />

        <div className="resp-cols" style={{ "--cols": "minmax(0,1fr) 340px", gap: 12, alignItems: "start" }}>
          <Card title="Leads por dia" hint="últimos 30 dias · clique numa etapa pra abrir o pipeline">
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
                <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{wonMonth}</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)", display: "block" }}>Ganho no mês</span>
                <span style={{ display: "block", height: 3, borderRadius: 999, background: "var(--pos)", marginTop: 6, width: `${Math.min(100, Math.round((wonMonth / maxStage) * 100))}%` }} />
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

const PANELS = [
  {
    key: "sdr", title: "SDR", hint: "topo de funil: qualifica e agenda a call",
    cols: [
      { label: "Calls agendadas", meta: true, render: (p) => <MetaCell value={p.callsBooked} goal={p.goals?.callsBooked} /> },
      { label: "Taxa agend.", render: (p) => <span className="tnum">{pctStr(p.bookingRate) || "—"}</span> },
      { label: "SLA 1º toque", render: (p) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {p.firstTouchMedianH != null ? `${String(p.firstTouchMedianH).replace(".", ",")}h` : "—"}
          {p.leadsNew > 0 && <span className="dim"> · {Math.round((p.withinSla / p.leadsNew) * 100)}%</span>}
          {p.breached > 0 && <span style={{ color: "var(--neg)" }}> · {p.breached} fora</span>}
        </span>
      ) },
      { label: "% compareceram", render: (p) => (
        <span className="tnum" title={p.showRate != null ? `${p.noShow} não compareceram` : "sem call resolvida no período"}>
          {p.showRate != null ? pctStr(p.showRate) : "—"}
        </span>
      ) },
      { label: "Calls → ganho", render: (p) => (
        <span className="tnum" title={p.wonFromCalls != null ? `${p.wonFromCalls} das ${p.callsBooked} calls fecharam` : ""}>
          {p.callWinRate != null ? pctStr(p.callWinRate) : "—"}
        </span>
      ) },
    ],
  },
  {
    key: "closer", title: "Closers", hint: "da call ao fechamento",
    cols: [
      { label: "Calls", render: (p) => <span className="tnum">{int(p.calls)}</span> },
      { label: "Propostas", render: (p) => <span className="tnum">{int(p.proposals)}</span> },
      { label: "Ganhos", meta: true, render: (p) => <MetaCell value={p.won} goal={p.goals?.won} /> },
      { label: "Receita", meta: true, render: (p) => <MetaCell value={p.revenue} goal={p.goals?.revenue} fmt={money} /> },
      { label: "Fechamento", render: (p) => <span className="tnum">{pctStr(p.closeRate) || "—"}</span> },
    ],
  },
  {
    key: "cs", title: "CS / Retenção", hint: "pós-venda e carteira",
    cols: [
      { label: "Contas", render: (p) => <span className="tnum">{int(p.activeAccounts)}</span> },
      { label: "Novas", meta: true, render: (p) => <MetaCell value={p.newAccounts} goal={p.goals?.newAccounts} /> },
      { label: "Churn", render: (p) => <span className="tnum" style={{ color: p.churned > 0 ? "var(--neg)" : "var(--fg-3)" }}>{int(p.churned)}</span> },
    ],
  },
];

function TeamPerformance({ score, onPerson, onNav }) {
  const anyRows = score && PANELS.some((p) => (score[p.key] || []).length > 0);
  return (
    <Card title="Desempenho do time" hint="este mês · progresso vs. meta (defina em Ajustes → Equipe) · clique num nome pra abrir o pipeline dele">
      <div style={{ padding: "6px 8px 12px" }}>
        {score == null && <div className="mono dim" style={{ padding: "10px 8px", fontSize: 12 }}>carregando…</div>}
        {score && !anyRows && (
          <div style={{ padding: "10px 8px", fontSize: 12.5, color: "var(--fg-4)" }}>
            Sem atividade no mês ainda. Assim que o time trabalhar leads e fechar negócios, o placar aparece aqui.
          </div>
        )}
        {score && anyRows && PANELS.map((panel) => {
          const rows = score[panel.key] || [];
          if (!rows.length) return null;
          const gridCols = `minmax(120px, 1.4fr) repeat(${panel.cols.length}, minmax(84px, 1fr))`;
          return (
            <div key={panel.key} style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 8px 4px" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{panel.title}</span>
                <span className="mono dim" style={{ fontSize: 10.5 }}>{panel.hint}</span>
              </div>
              <div className="tbl-x">
                <div style={{ minWidth: 520 }}>
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
                      {panel.cols.map((c) => <div key={c.label}>{c.render(p)}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export { OverviewScreen };
