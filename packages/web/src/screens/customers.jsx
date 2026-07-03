import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card, Pill } from "../components/viz.jsx";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
// Clientes — a base ativa do produto (redesign fase 1, estilo Attio: tabela +
// painel de detalhe sem trocar de página). A receita vem das assinaturas
// (customer.arr é derivado). A linha do tempo de marcos por tempo de casa
// chega na fase de pós-venda, neste mesmo painel.

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
  const { version, openForm, openDelete } = useData();
  const product = SAAS[0];
  const [subs, setSubs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [sel, setSel] = useState(null);

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
                    {["Cliente", "Plano", "MRR", "Assinatura", "CSM"].map((h, i) => (
                      <th key={h} className="mono" style={{ textAlign: i === 2 ? "right" : "left", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => {
                    const sub = mainSub(c);
                    const st = sub ? SUB_STATUS[sub.status] || { label: sub.status, tone: "mut" } : null;
                    const isSel = selected && selected.id === c.id;
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
                        <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--line-1)" }}>
                          {st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
                        </td>
                        <td style={{ padding: "11px 14px", fontSize: 13, color: "var(--fg-3)", borderBottom: "1px solid var(--line-1)" }}>{c.csm || ""}</td>
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
