import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, StatTile, Card, LineChart, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { nextMilestone, dueLabel } from "../lib/milestones.js";
// Visão geral — a home do dia a dia (substitui Portfólio + dashboard do SaaS).
// Responde: como está a receita, quantos leads entraram, quanto custa o lead,
// e o que preciso fazer HOJE. Focada no produto ativo (SAAS[0]).

const { useState, useEffect, useMemo } = React;

const DAY = 86_400_000;
const dayKey = (iso) => String(iso || "").slice(0, 10);
const shortDay = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

// Estágios terminais não contam como "aberto" nem geram pendência.
const TERMINAL = new Set(["Ganho", "Perdido", "Desqualificado", "disqualified"]);

function OverviewScreen({ onNav, onOpenLead }) {
  const { SAAS, LEADS, CUSTOMERS } = window.SEED;
  const { version } = useData();
  const product = SAAS[0];
  const [marketing, setMarketing] = useState(null);
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    if (!product) return;
    api.marketingMetrics(product.id).then(setMarketing).catch(() => setMarketing(null));
    api.list("invoices").then((rows) => setInvoices(rows.filter((i) => i.saas === product.id))).catch(() => {});
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

  // Funil até "Ganho" (estágios pós-venda/descarte ficam fora da régua).
  const funnelStages = useMemo(() => {
    const all = (product?.funnel || []).map((f) => f.stage);
    const cut = all.indexOf("Ganho");
    return cut >= 0 ? all.slice(0, cut) : all.slice(0, 6);
  }, [product]);
  const countByStage = (stage) => leads.filter((l) => l.stage === stage).length;
  const maxStage = Math.max(1, ...funnelStages.map(countByStage));
  const thisMonth = (iso) => iso && dayKey(iso).slice(0, 7) === new Date(now).toISOString().slice(0, 7);
  const wonMonth = leads.filter((l) => l.stage === "Ganho" && thisMonth(l.stageSince)).length;

  // Hoje: próximos contatos (callAt vencido ou até o fim do dia), em estágio aberto.
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const contacts = leads
    .filter((l) => l.callAt && !TERMINAL.has(l.stage) && new Date(l.callAt) <= endOfDay)
    .sort((a, b) => String(a.callAt).localeCompare(String(b.callAt)))
    .slice(0, 6);

  // Pendências: leads parados no 1º estágio há 48h+; faturas abertas vencendo em 7d.
  const firstStage = funnelStages[0];
  const stuck = leads.filter((l) => l.stage === firstStage && l.stageSince && now - new Date(l.stageSince).getTime() > 2 * DAY);
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

      <div style={{ padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
          <StatTile label="MRR" value={window.fmt.money(product.mrr || 0)} delta={`${activeCustomers ? "base de " + window.fmt.money(product.arr || 0) + " ARR" : "sem receita ainda"}`} tone="flat" />
          <StatTile label="Clientes ativos" value={String(activeCustomers)} />
          <StatTile label="Leads · 30 dias" value={String(leads30)}
            delta={leadsDeltaPct == null ? null : `${leadsDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(leadsDeltaPct)}% vs. 30d anteriores`}
            tone={leadsDeltaPct == null ? "flat" : leadsDeltaPct >= 0 ? "up" : "down"} />
          <StatTile label="Custo por lead · 30d" value={cpl != null ? window.fmt.money(cpl) : "sem gasto"}
            delta={cpl != null ? window.fmt.money(marketing.totals.spend) + " investidos" : "conecte o Meta em Métricas"} tone="flat" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 330px", gap: 12, alignItems: "start" }}>
          <Card title="Leads por dia" hint="form de diagnóstico · últimos 30 dias">
            <LineChart data={series} fmtValue={(v) => String(Math.round(v))} />
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${funnelStages.length + 1}, minmax(0,1fr))`, gap: 8, padding: "4px 16px 16px" }}>
              {funnelStages.map((s) => (
                <button key={s} onClick={() => onNav && onNav("pipeline", { saas: product.id, stage: s })}
                  style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)", textAlign: "left" }}>
                  <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 20, fontWeight: 700 }}>{countByStage(s)}</span>
                  <span style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                  <span style={{ display: "block", height: 3, borderRadius: 999, background: "var(--accent)", opacity: 0.85, marginTop: 7, width: `${Math.round((countByStage(s) / maxStage) * 100)}%` }} />
                </button>
              ))}
              <button onClick={() => onNav && onNav("pipeline", { saas: product.id, stage: "Ganho" })}
                style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "9px 11px", background: "var(--bg-inset)", textAlign: "left" }}>
                <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 20, fontWeight: 700 }}>{wonMonth}</span>
                <span style={{ fontSize: 11.5, color: "var(--fg-3)", display: "block" }}>Ganho no mês</span>
                <span style={{ display: "block", height: 3, borderRadius: 999, background: "var(--pos)", marginTop: 7, width: `${Math.min(100, Math.round((wonMonth / maxStage) * 100))}%` }} />
              </button>
            </div>
          </Card>

          <Card title="Hoje" hint="contatos e pendências">
            <div style={{ padding: "8px 8px 4px" }}>
              {contacts.length === 0 && (
                <div style={{ padding: "10px 8px", fontSize: 12.5, color: "var(--fg-4)" }}>
                  Nenhum contato marcado pra hoje. Marque o próximo contato nos cards do pipeline.
                </div>
              )}
              {contacts.map((l) => {
                const t = new Date(l.callAt);
                const late = t < new Date(new Date().setHours(0, 0, 0, 0));
                return (
                  <button key={l.id} onClick={() => onOpenLead && onOpenLead(l)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 8, borderRadius: "var(--r-1)", textAlign: "left" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{l.stage}</div>
                    </div>
                    <Pill tone={late ? "neg" : "pos"}>
                      {late ? "atrasado" : t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </Pill>
                  </button>
                );
              })}
            </div>
            <div style={{ borderTop: "1px solid var(--line-1)", padding: "12px 16px 14px" }}>
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
                Precisa de atenção
              </div>
              {stuck.length === 0 && dueInvoices.length === 0 && dueMilestones.length === 0 && (
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
              {stuck.length > 0 && (
                <button onClick={() => onNav && onNav("pipeline", { saas: product.id, stage: firstStage })}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 0", textAlign: "left" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{stuck.length} {stuck.length === 1 ? "lead parado" : "leads parados"}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-3)" }}>há mais de 48h em {firstStage}</div>
                  </div>
                  <Pill tone="warn">ver</Pill>
                </button>
              )}
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

export { OverviewScreen };
