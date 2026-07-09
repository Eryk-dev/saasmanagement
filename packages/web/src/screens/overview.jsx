import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, LineChart, Pill } from "../components/viz.jsx";
import { EmptyState, Avatar } from "../atoms.jsx";
import { nextMilestone, dueLabel } from "../lib/milestones.js";
import { openStages, workableStages, isWonStage, stageKind, cadenceOf, nextTouch, nextTouchPill, firstStage as firstStageOf } from "../lib/funnel.js";
import { displayName, currentUser } from "../lib/users.js";
// Visão geral — a home do dia a dia. Responde: como está a receita, quantos
// leads entraram, quanto custa o lead, e — principal — QUEM CONTATAR AGORA
// (fila de trabalho do GPS: atrasados → hoje → sem próximo passo).
// Focada no produto ativo (SAAS[0]).

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
const dayKey = (iso) => String(iso || "").slice(0, 10);
const shortDay = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

function OverviewScreen({ onNav, onOpenLead }) {
  const { SAAS, LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const product = SAAS[0];
  const [marketing, setMarketing] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [costs, setCosts] = useState(null); // custos do mês corrente (tela Custos)
  // Ações da fila (toque dado / adiar) aplicam otimista aqui até o SSE recarregar.
  const [patched, setPatched] = useState({});

  useEffect(() => {
    if (!product) return;
    api.marketingMetrics(product.id).then(setMarketing).catch(() => setMarketing(null));
    api.list("invoices").then((rows) => setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
    api.expensesSummary(product.id).then(setCosts).catch(() => setCosts(null));
  }, [product?.id, version]);

  const leads = useMemo(
    () => (LEADS || []).filter((l) => l.saas === product?.id).map((l) => (patched[l.id] ? { ...l, ...patched[l.id] } : l)),
    [LEADS, product?.id, patched],
  );

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
  // Resultado do mês = valor ganho no pipeline menos os custos operacionais
  // (publicidade + IA + lançamentos manuais da tela Custos).
  const result = costs ? wonValueMonth - (costs.total || 0) : null;

  // ── Fila de trabalho (GPS) ────────────────────────────────────────────────
  // Trabalhável ≠ aberto: filas fora da régua (Nutrição) entram na fila do GPS,
  // mas não nas contagens/forecast de pipeline.
  const openSet = useMemo(() => new Set(workableStages(product)), [product]);
  const isOpenLead = (l) => openSet.has(l.stage) || !l.stage;
  const openLeads = leads.filter(isOpenLead);

  const me = currentUser()?.id || "";
  const [mine, setMine] = useState(() => {
    try { return localStorage.getItem("cockpit_pipeline_person") === "me"; } catch { return false; }
  });
  const setMineP = (v) => {
    setMine(v);
    try { localStorage.setItem("cockpit_pipeline_person", v ? "me" : ""); } catch { /* ignore */ }
  };
  const mineMatch = (l) => !mine || !me || l.owner === me || l.closer === me;

  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);

  const queue = useMemo(() => {
    const late = [], today = [], noNext = [];
    for (const l of openLeads) {
      if (!mineMatch(l)) continue;
      const t = nextTouch(l);
      if (!t) { noNext.push(l); continue; }
      if (t.at < startToday.getTime()) late.push({ l, t });
      else if (t.at <= endToday.getTime()) today.push({ l, t });
    }
    late.sort((a, b) => a.t.at - b.t.at);
    today.sort((a, b) => a.t.at - b.t.at);
    // Sem próximo passo: violação de SLA de 1º toque primeiro (lead novo nunca
    // tocado além do prazo da cadência), depois os mais parados.
    const slaMs = (Number(cadenceOf(product, firstStage).firstTouchHours) || 48) * 3_600_000;
    const breach = (l) => !l.lastActivityAt && l.createdAt && now - new Date(l.createdAt).getTime() > slaMs;
    noNext.sort((a, b) => (breach(b) - breach(a)) || String(a.stageSince || a.createdAt || "").localeCompare(String(b.stageSince || b.createdAt || "")));
    return { late, today, noNext, breach };
  }, [openLeads, mine, me, product, firstStage]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueTotal = queue.late.length + queue.today.length + queue.noNext.length;
  const slaBreaches = queue.noNext.filter(queue.breach).length;

  // Toque dado direto da fila: vira activity (o servidor conta a tentativa e
  // re-agenda o GPS pela cadência) — otimista aqui pro item sair da lista.
  function doneTouch(l) {
    const cad = cadenceOf(product, l.stage || firstStage);
    const nextAt = cad.retryDays ? new Date(now + cad.retryDays * DAY).toISOString() : "";
    setPatched((p) => ({ ...p, [l.id]: { ...(p[l.id] || {}), nextActionAt: nextAt, lastActivityAt: new Date().toISOString(), lastActivityType: "call" } }));
    api.logActivity({ saas: l.saas, lead: l.id, type: "call", text: "toque registrado na fila", author: me }).catch(() => {});
  }
  function snooze(l) {
    const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
    setPatched((p) => ({ ...p, [l.id]: { ...(p[l.id] || {}), nextActionAt: t.toISOString() } }));
    api.update("leads", l.id, { nextActionAt: t.toISOString() }).catch(() => {});
  }

  // Pendências: faturas abertas vencendo em 7d + marcos de pós-venda.
  const dueInvoices = invoices
    .filter((i) => (i.status === "open" || i.status === "overdue") && i.dueDate && new Date(i.dueDate).getTime() - now <= 7 * DAY)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 3);

  const cpl = marketing?.totals?.spend > 0 && marketing?.totals?.cpl != null ? marketing.totals.cpl : null;
  const productCustomers = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
  const activeCustomers = productCustomers.length;

  // Marcos de pós-venda vencidos ou vencendo (régua por tempo de casa).
  const dueMilestones = productCustomers
    .map((c) => ({ customer: c, m: nextMilestone(c, product) }))
    .filter(({ m }) => m && (m.status === "late" || m.status === "soon"))
    .sort((a, b) => String(a.m.dueAt).localeCompare(String(b.m.dueAt)))
    .slice(0, 3);

  if (!product) {
    return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes pra começar a operar o cockpit." />;
  }

  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Visão geral" sub={today} />

      <div style={{ padding: "20px var(--pad-x) 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <StatTile label="Resultado do mês" value={result != null ? window.fmt.money(result) : "…"}
            delta={costs ? `${window.fmt.money(wonValueMonth)} ganhos · ${window.fmt.money(costs.total || 0)} custos` : "ganhos menos custos"}
            tone={result == null ? "flat" : result >= 0 ? "up" : "down"} />
          <StatTile label="MRR" value={window.fmt.money(product.mrr || 0)} delta={`${activeCustomers ? "base de " + window.fmt.money(product.arr || 0) + " ARR" : "sem receita ainda"}`} tone="flat" />
          <StatTile label="Clientes ativos" value={String(activeCustomers)} />
          <StatTile label="Leads · 30 dias" value={String(leads30)}
            delta={leadsDeltaPct == null ? null : `${leadsDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(leadsDeltaPct)}% vs. 30d anteriores`}
            tone={leadsDeltaPct == null ? "flat" : leadsDeltaPct >= 0 ? "up" : "down"} />
          <StatTile label="Custo por lead · 30d" value={cpl != null ? window.fmt.money(cpl) : "sem gasto"}
            delta={cpl != null ? window.fmt.money(marketing.totals.spend) + " investidos" : "conecte o Meta em Publicidade"} tone="flat" />
        </div>

        <div className="resp-cols" style={{ "--cols": "minmax(0,1fr) 340px", gap: 12, alignItems: "start" }}>
          {/* Fila de trabalho — por onde o dia começa. */}
          <Card title="Fila de hoje" hint="o GPS do funil: atrasados → hoje → sem próximo passo">
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px 4px", flexWrap: "wrap" }}>
              <QueueStat n={queue.late.length} label="atrasados" tone="var(--neg)" />
              <QueueStat n={queue.today.length} label="pra hoje" tone="var(--warn)" />
              <QueueStat n={queue.noNext.length} label="sem próximo passo" tone="var(--fg-3)" />
              {slaBreaches > 0 && <QueueStat n={slaBreaches} label="fora do SLA de 1º toque" tone="var(--neg)" />}
              <span style={{ flex: 1 }} />
              <button onClick={() => setMineP(!mine)} disabled={!me}
                title={me ? "só leads onde sou dono ou closer" : "faça login pra filtrar os seus"}
                className="mono" style={{
                  height: 22, padding: "0 9px", borderRadius: 4, fontSize: 10.5,
                  border: "1px solid " + (mine ? "var(--accent-line)" : "var(--line-1)"),
                  background: mine ? "var(--accent-soft)" : "var(--bg-2)",
                  color: mine ? "var(--accent)" : "var(--fg-3)", opacity: me ? 1 : 0.5,
                }}>meus</button>
            </div>
            <div style={{ padding: "4px 8px 8px" }}>
              {queueTotal === 0 && (
                <div style={{ padding: "14px 8px", fontSize: 12.5, color: "var(--fg-4)" }}>
                  Nada vencido — todos os leads abertos têm próximo passo. 🎯
                </div>
              )}
              {queue.late.slice(0, 12).map(({ l }) => (
                <QueueRow key={l.id} l={l} product={product} onOpen={onOpenLead} onDone={doneTouch} onSnooze={snooze} />
              ))}
              {queue.today.slice(0, 12).map(({ l }) => (
                <QueueRow key={l.id} l={l} product={product} onOpen={onOpenLead} onDone={doneTouch} onSnooze={snooze} />
              ))}
              {queue.noNext.slice(0, Math.max(0, 30 - Math.min(12, queue.late.length) - Math.min(12, queue.today.length))).map((l) => (
                <QueueRow key={l.id} l={l} product={product} onOpen={onOpenLead} onDone={doneTouch} onSnooze={snooze} breach={queue.breach(l)} />
              ))}
              {queueTotal > 30 && (
                <button onClick={() => onNav && onNav("pipeline", { saas: product.id })} className="mono" style={{ width: "100%", padding: "8px 0", fontSize: 11, color: "var(--accent)" }}>
                  +{queueTotal - 30} na fila · ver pipeline →
                </button>
              )}
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="Leads por dia" hint="últimos 30 dias">
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
    </div>
  );
}

function QueueStat({ n, label, tone }) {
  if (!n) return null;
  return (
    <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span className="tnum" style={{ fontWeight: 700, color: tone }}>{n}</span> {label}
    </span>
  );
}

// Linha da fila: lead · estágio · quando · últ. toque · responsável · ações.
function QueueRow({ l, product, onOpen, onDone, onSnooze, breach }) {
  const [hover, setHover] = React.useState(false);
  const pill = nextTouchPill(l, { isOpen: true });
  const who = l.closer || l.owner;
  const last = l.lastActivityAt
    ? `${Math.max(0, Math.floor((Date.now() - new Date(l.lastActivityAt).getTime()) / DAY))}d · ${l.lastActivityType || "toque"}`
    : "nunca tocado";
  const kindGlyph = { meeting: "◆" }[pill?.type] || "";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen && onOpen(l)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: "var(--r-1)", cursor: "pointer", background: hover ? "var(--hover)" : "transparent" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {l.name}{l.company ? <span className="dim" style={{ fontWeight: 400, fontSize: 11, marginLeft: 6 }}>{l.company}</span> : null}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", display: "flex", gap: 6, alignItems: "center" }}>
          <span>{l.stage || firstStageLabel(product)}</span>
          <span style={{ color: "var(--fg-4)" }}>· últ. toque {last}</span>
          {l.nextActionNote && <span style={{ color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>· {l.nextActionNote}</span>}
          {breach && <span style={{ color: "var(--neg)" }}>· fora do SLA</span>}
        </div>
      </div>
      {who && <span title={displayName(who)}><Avatar id={who} name={displayName(who)} size={18} /></span>}
      {hover ? (
        <span style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onDone(l)} title="registrar toque agora (re-agenda pela cadência)" className="mono"
            style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 10.5, background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--accent)" }}>✓ toque</button>
          <button onClick={() => onSnooze(l)} title="adiar pra amanhã 9h" className="mono"
            style={{ height: 22, padding: "0 8px", borderRadius: 4, fontSize: 10.5, background: "var(--bg-2)", border: "1px solid var(--line-2)", color: "var(--fg-2)" }}>+1d</button>
        </span>
      ) : (
        pill && <Pill tone={pill.key === "late" ? "neg" : pill.key === "today" ? "warn" : pill.key === "none" ? "warn" : "mut"}>{kindGlyph ? `${kindGlyph} ` : ""}{pill.text}</Pill>
      )}
    </div>
  );
}

function firstStageLabel(product) {
  return product?.funnel?.[0]?.stage || "entrada";
}

export { OverviewScreen };
