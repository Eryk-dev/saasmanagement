import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card, Pill, Segmented } from "../components/viz.jsx";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
import { milestonesFor, nextMilestone, tenureLabel, dueLabel } from "../lib/milestones.js";
import { ActivityList } from "../components/timeline.jsx";
import { CallSummaryCard } from "./today.jsx";
import { SubscriptionsScreen } from "./subscriptions.jsx";
import { useActiveSaas } from "../lib/workspace.js";
// Clientes — a base ativa do produto (estilo Attio: tabela + painel de detalhe
// sem trocar de página). A receita vem das assinaturas (customer.arr é
// derivado). Pós-venda: linha do tempo de marcos por tempo de casa
// (startedAt, carimbado na conversão automática do pipeline).
// Assinaturas/faturas/planos moram AQUI, numa aba — cliente e cobrança são a
// mesma conversa (a antiga tela "Assinaturas" virou a aba billing).

const { useState, useEffect, useMemo } = React;

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
const SUB_STATUS = {
  active: { label: "ativa", tone: "pos" },
  past_due: { label: "em atraso", tone: "neg" },
  paused: { label: "pausada", tone: "warn" },
  canceled: { label: "cancelada", tone: "mut" },
};

function CustomersScreen({ initialTab = "base" }) {
  const { CUSTOMERS, LEADS } = window.SEED;
  const { version, openForm, refresh } = useData();
  const [product] = useActiveSaas();
  const [tab, setTab] = useState(initialTab); // base | billing
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [sel, setSel] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Conclusão de marco: otimista no objeto do SEED (a tela lê dele) + PATCH.
  const [, force] = useState(0);
  function completeMilestone(customer, key) {
    const done = { ...(customer.milestonesDone || {}), [key]: new Date().toISOString() };
    customer.milestonesDone = done; // otimista: CUSTOMERS vem do SEED compartilhado
    force((n) => n + 1);
    api.update("customers", customer.id, { milestonesDone: done }).catch(() => refresh());
  }

  useEffect(() => {
    api.list("subscriptions").then((rows) => setSubs(rows.filter((s) => s.saas === product?.id))).catch(() => {});
    api.list("plans").then((rows) => setPlans(rows.filter((p) => p.saas === product?.id))).catch(() => {});
    api.list("invoices").then((rows) => setInvoices(rows.filter((i) => i.saas === product?.id))).catch(() => {});
  }, [product?.id, version]);

  const customers = useMemo(() => {
    const list = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
    return list.sort((a, b) => (b.arr || 0) - (a.arr || 0));
  }, [CUSTOMERS, product?.id]);

  const selected = customers.find((c) => c.id === sel) || customers[0] || null;
  const subsOf = (c) => subs.filter((s) => s.customer === c.id);
  const mainSub = (c) => subsOf(c).find((s) => s.status === "active" || s.status === "past_due") || subsOf(c)[0] || null;
  // sub.plan é FK pra `plans` — resolve o nome (nunca mostrar o id cru na UI).
  const planLabel = (s) => plans.find((p) => p.id === s.plan)?.name || CYCLE_LABEL[s.cycle] || s.cycle || "plano";
  const totalMrr = customers.reduce((a, c) => a + (c.arr || 0), 0) / 12;
  const money = window.fmt.money;
  const shownCustomers = showAll ? customers : customers.slice(0, 6);
  const lastContact = (c) => {
    const lead = (LEADS || []).find((l) => l.id === c.leadId);
    const at = lead?.lastActivityAt || c.lastContactAt;
    if (!at) return "—";
    const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000));
    return days === 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`;
  };

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Clientes" sub={`${customers.length} ${customers.length === 1 ? "ativo" : "ativos"} · MRR ${money(totalMrr)}`}>
        <Segmented value={tab} onChange={setTab} options={[{ value: "base", label: "Clientes" }, { value: "billing", label: "Assinaturas" }]} />
        {tab === "base" && <PrimaryButton onClick={() => openForm("customers", { saas: product.id })}>+ novo cliente</PrimaryButton>}
      </PageHead>

      {tab === "billing" && <SubscriptionsScreen saasId={product.id} />}

      {tab === "base" && (
      <div style={{ padding: "16px var(--pad-x) 56px" }}>
        {customers.length === 0 ? (
          <EmptyState
            title="Nenhum cliente ainda"
            hint="Quando um lead fechar, cadastre o cliente e a assinatura aqui (a conversão automática a partir do pipeline chega na fase de pós-venda)."
            action={<PrimaryButton onClick={() => openForm("customers", { saas: product.id })}>+ Cadastrar cliente</PrimaryButton>}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16, alignItems: "start" }}>
            <Card style={{ overflow: "hidden" }}>
              <div className="tbl-x">
              <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Cliente", "Plano", "MRR", "Tempo de casa", "Último contato", "Próximo marco", "Assinatura"].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 2 ? "right" : "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", padding: "12px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownCustomers.map((c) => {
                    const sub = mainSub(c);
                    const st = sub ? SUB_STATUS[sub.status] || { label: sub.status, tone: "mut" } : null;
                    const isSel = selected && selected.id === c.id;
                    const nm = nextMilestone(c, product);
                    return (
                      <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : "transparent" }}
                        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isSel ? "var(--accent-soft)" : "transparent"; }}>
                        <td style={{ padding: "14px 20px", fontSize: 13.5, fontWeight: 600, borderBottom: "1px solid var(--line-faint)" }}>{c.name}</td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {sub ? planLabel(sub) : c.plan || "sem plano"}
                        </td>
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-faint)" }}>
                          {money((c.arr || 0) / 12)}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {tenureLabel(c) || <span style={{ color: "var(--fg-4)" }}>defina o início</span>}
                        </td>
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-3)", borderBottom: "1px solid var(--line-faint)" }}>{lastContact(c)}</td>
                        <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                          {nm
                            ? <Pill tone={nm.status === "late" ? "neg" : nm.status === "soon" ? "warn" : "mut"}>{nm.label} · {dueLabel(nm.dueAt)}</Pill>
                            : c.startedAt ? <Pill tone="pos">régua completa</Pill> : <Pill tone="mut">sem início</Pill>}
                        </td>
                        <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                          {st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>mostrando {shownCustomers.length} de {customers.length}</span>
                {customers.length > 6 && <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>{showAll ? "Mostrar 6" : "Ver todos"}</button>}
              </div>
            </Card>

            {selected && (
              <Card style={{ position: "sticky", top: 16 }}>
                <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--line-faint)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "var(--display)", fontSize: 17, fontWeight: 700 }}>{selected.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>
                        {money((selected.arr || 0) / 12)}/mês · {money(selected.arr || 0)}/ano{selected.email ? ` · ${selected.email}` : ""}
                      </div>
                    </div>
                    <button onClick={() => openForm("customers", selected)} style={{ height: 30, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5 }}>Editar</button>
                  </div>
                  {(selected.flags || []).length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
                      {selected.flags.map((f) => <Pill key={f} tone="warn">{f}</Pill>)}
                    </div>
                  )}
                </div>

                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line-faint)" }}>
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>Linha do tempo</div>
                  {!selected.startedAt && (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                      Defina "Cliente desde" (editar cliente) pra ativar a régua de marcos: onboarding, check-in de mês 1, revisão de mês 3 e upsell de mês 6.
                    </div>
                  )}
                  {selected.startedAt && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10 }}>
                        cliente desde {new Date(selected.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "")} · {tenureLabel(selected)}
                      </div>
                      {milestonesFor(selected, product).map((m, i, arr) => (
                        <div key={m.key} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === arr.length - 1 ? 0 : 16 }}>
                          {i < arr.length - 1 && <span style={{ position: "absolute", left: 7, top: 18, bottom: 0, width: 2, background: "var(--line-1)" }} />}
                          <span style={{
                            width: 16, height: 16, borderRadius: 999, flexShrink: 0, marginTop: 1, zIndex: 1,
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9,
                            background: m.status === "done" ? "var(--pos-soft)" : m.status === "late" ? "var(--neg-soft)" : m.status === "soon" ? "var(--warn-soft)" : "var(--bg-2)",
                            color: m.status === "done" ? "var(--pos)" : m.status === "late" ? "var(--neg)" : m.status === "soon" ? "var(--warn)" : "var(--fg-4)",
                            border: m.status === "next" ? "1px solid var(--line-2)" : "none",
                          }}>
                            {m.status === "done" ? "✓" : "○"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                              {m.status === "done"
                                ? `concluído ${new Date(m.doneAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}`
                                : `${m.hint || ""}${m.hint ? " · " : ""}${m.status === "late" ? "venceu " : "vence "}${dueLabel(m.dueAt)}`}
                            </div>
                          </div>
                          {m.status !== "done" && (
                            <button onClick={() => completeMilestone(selected, m.key)}
                              style={{ alignSelf: "flex-start", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", flexShrink: 0 }}>
                              concluir
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line-faint)" }}>
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>Assinaturas</div>
                  {subsOf(selected).length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma assinatura. Crie na aba Assinaturas aqui em cima.</div>
                  )}
                  {subsOf(selected).map((s) => {
                    const st = SUB_STATUS[s.status] || { label: s.status, tone: "mut" };
                    return (
                      <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                        <span style={{ color: "var(--fg-2)" }}>{planLabel(s)} · {CYCLE_LABEL[s.cycle] || s.cycle}</span>
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <span className="tnum mono" style={{ fontWeight: 500 }}>{money(s.price || 0)}</span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: "16px 24px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>Últimas faturas</div>
                  {invoices.filter((i) => i.customer === selected.id).slice(0, 4).map((i) => (
                    <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                      <span style={{ color: "var(--fg-2)" }}>
                        {i.dueDate ? new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : ""} · {i.kind || "fatura"}
                      </span>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <span className="tnum mono" style={{ fontWeight: 500 }}>{money(i.amount || 0)}</span>
                        <Pill tone={i.status === "paid" ? "pos" : i.status === "overdue" ? "neg" : "warn"}>
                          {i.status === "paid" ? "paga" : i.status === "overdue" ? "vencida" : "aberta"}
                        </Pill>
                      </span>
                    </div>
                  ))}
                  {invoices.filter((i) => i.customer === selected.id).length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma fatura ainda.</div>
                  )}
                </div>

                <CustomerHistory customer={selected} />
              </Card>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// Histórico do cliente = a timeline do lead de origem (customer.leadId) —
// a jornada comercial inteira continua legível depois do fechamento. Read-only.
function CustomerHistory({ customer }) {
  const [acts, setActs] = React.useState(null);
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    if (!customer?.leadId) { setActs([]); return; }
    let alive = true;
    api.listActivities(customer.leadId).then((a) => alive && setActs(a)).catch(() => alive && setActs([]));
    return () => { alive = false; };
  }, [customer?.leadId]);
  // Último resumo (integração ou venda) em card rico, fora da timeline abaixo.
  const callSummary = React.useMemo(() => {
    const cs = (acts || []).filter((x) => x.meta?.event === "call_summary" && x.meta?.summary).sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))[0];
    return cs ? { ...cs.meta.summary, recordingUrl: cs.meta.recordingUrl || "", kind: cs.meta.kind || "call" } : null;
  }, [acts]);
  if (!customer?.leadId || (acts !== null && acts.length === 0)) return null;
  const shown = expanded ? acts : (acts || []).slice(0, 10);
  const timelineActs = shown.filter((a) => !(a.type === "system" && a.meta?.event === "call_summary"));
  return (
    <div style={{ padding: "12px 16px" }}>
      {callSummary && <div style={{ marginBottom: 12 }}><CallSummaryCard summary={callSummary} phone={customer.phone || ""} /></div>}
      <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
        Histórico do funil
      </div>
      {acts === null
        ? <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>carregando…</div>
        : <ActivityList activities={timelineActs} compact />}
      {acts && acts.length > 10 && !expanded && (
        <button onClick={() => setExpanded(true)} className="mono" style={{ fontSize: 11, color: "var(--accent)", padding: "6px 0" }}>
          ver tudo ({acts.length})
        </button>
      )}
    </div>
  );
}

export { CustomersScreen };
