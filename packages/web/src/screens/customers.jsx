import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card, Pill } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { milestonesFor, nextMilestone, tenureLabel, dueLabel } from "../lib/milestones.js";
// Clientes — a base ativa do produto (estilo Attio: tabela + painel de detalhe
// sem trocar de página). A receita vem das assinaturas (customer.arr é
// derivado). Pós-venda: linha do tempo de marcos por tempo de casa
// (startedAt, carimbado na conversão automática do pipeline).

const { useState, useEffect, useMemo } = React;

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
const SUB_STATUS = {
  active: { label: "ativa", tone: "pos" },
  past_due: { label: "em atraso", tone: "neg" },
  paused: { label: "pausada", tone: "warn" },
  canceled: { label: "cancelada", tone: "mut" },
};

function CustomersScreen() {
  const { SAAS, CUSTOMERS } = window.SEED;
  const { version, openForm, openDelete, refresh } = useData();
  const product = SAAS[0];
  const [subs, setSubs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [sel, setSel] = useState(null);
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
    api.list("invoices").then((rows) => setInvoices(rows.filter((i) => i.saas === product?.id))).catch(() => {});
  }, [product?.id, version]);

  const customers = useMemo(() => {
    const list = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
    return list.sort((a, b) => (b.arr || 0) - (a.arr || 0));
  }, [CUSTOMERS, product?.id]);

  const selected = customers.find((c) => c.id === sel) || customers[0] || null;
  const subsOf = (c) => subs.filter((s) => s.customer === c.id);
  const mainSub = (c) => subsOf(c).find((s) => s.status === "active" || s.status === "past_due") || subsOf(c)[0] || null;
  const totalMrr = customers.reduce((a, c) => a + (c.arr || 0), 0) / 12;
  const money = window.fmt.money;

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Clientes" sub={`${customers.length} ${customers.length === 1 ? "ativo" : "ativos"} · MRR ${money(totalMrr)}`}>
        <PrimaryButton onClick={() => openForm("customers")}>+ novo cliente</PrimaryButton>
      </PageHead>

      <div style={{ padding: "20px 24px 40px" }}>
        {customers.length === 0 ? (
          <EmptyState
            title="Nenhum cliente ainda"
            hint="Quando um lead fechar, cadastre o cliente e a assinatura aqui (a conversão automática a partir do pipeline chega na fase de pós-venda)."
            action={<PrimaryButton onClick={() => openForm("customers")}>+ Cadastrar cliente</PrimaryButton>}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 12, alignItems: "start" }}>
            <Card style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Cliente", "Plano", "MRR", "Tempo de casa", "Próximo marco", "Assinatura"].map((h, i) => (
                      <th key={h} className="mono" style={{ textAlign: i === 2 ? "right" : "left", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => {
                    const sub = mainSub(c);
                    const st = sub ? SUB_STATUS[sub.status] || { label: sub.status, tone: "mut" } : null;
                    const isSel = selected && selected.id === c.id;
                    const nm = nextMilestone(c, product);
                    return (
                      <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : "transparent" }}
                        onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isSel ? "var(--accent-soft)" : "transparent"; }}>
                        <td style={{ padding: "11px 14px", fontSize: 13.5, fontWeight: 600, borderBottom: "1px solid var(--line-1)" }}>{c.name}</td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-1)" }}>
                          {c.plan || (sub ? `${sub.plan || ""} ${CYCLE_LABEL[sub.cycle] || ""}`.trim() : "sem plano")}
                        </td>
                        <td className="tnum mono" style={{ padding: "11px 14px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-1)" }}>
                          {money((c.arr || 0) / 12)}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-1)" }}>
                          {tenureLabel(c) || <span style={{ color: "var(--fg-4)" }}>defina o início</span>}
                        </td>
                        <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--line-1)" }}>
                          {nm
                            ? <Pill tone={nm.status === "late" ? "neg" : nm.status === "soon" ? "warn" : "mut"}>{nm.label} · {dueLabel(nm.dueAt)}</Pill>
                            : c.startedAt ? <Pill tone="pos">régua completa</Pill> : <Pill tone="mut">sem início</Pill>}
                        </td>
                        <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--line-1)" }}>
                          {st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            {selected && (
              <Card style={{ position: "sticky", top: 16 }}>
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--line-1)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700 }}>{selected.name}</div>
                      <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 2 }}>
                        {money((selected.arr || 0) / 12)}/mês{selected.email ? ` · ${selected.email}` : ""}
                      </div>
                    </div>
                    <RowActions onEdit={() => openForm("customers", selected)} onDelete={() => openDelete("customers", selected)} />
                  </div>
                  {(selected.flags || []).length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
                      {selected.flags.map((f) => <Pill key={f} tone="warn">{f}</Pill>)}
                    </div>
                  )}
                </div>

                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-1)" }}>
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

                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-1)" }}>
                  <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>Assinaturas</div>
                  {subsOf(selected).length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma assinatura. Crie em Ferramentas, Assinaturas.</div>
                  )}
                  {subsOf(selected).map((s) => {
                    const st = SUB_STATUS[s.status] || { label: s.status, tone: "mut" };
                    return (
                      <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                        <span style={{ color: "var(--fg-2)" }}>{s.plan || "plano"} · {CYCLE_LABEL[s.cycle] || s.cycle}</span>
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <span className="tnum mono" style={{ fontWeight: 500 }}>{money(s.price || 0)}</span>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: "12px 16px" }}>
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
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { CustomersScreen };
