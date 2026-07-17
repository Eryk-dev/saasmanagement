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
import { leadTier, waLink } from "../lib/ui.js";
import { displayName } from "../lib/users.js";
import { paymentLabel } from "../lib/payments.js";
import { useAttribution, leadPain } from "../lib/pains.js";
// Clientes — a base ativa do produto em dois blocos: a tabela de clientes e,
// ao lado, "Próximas ações" (o próximo marco de retenção de cada cliente,
// ordenado por urgência). Clicar num cliente abre um popup com o resumo dele
// e o histórico de ações de retenção (régua de marcos + funil de origem).
// A receita vem das assinaturas (customer.arr é derivado); a régua nasce em
// startedAt (carimbado na conversão automática do pipeline).
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
const SECTION_LABEL = { fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 };

function CustomersScreen({ initialTab = "base" }) {
  const { CUSTOMERS, LEADS } = window.SEED;
  const { version, openForm, refresh } = useData();
  const [product] = useActiveSaas();
  const [tab, setTab] = useState(initialTab); // base | billing
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [sel, setSel] = useState(null); // id do cliente aberto no popup
  const [showAll, setShowAll] = useState(false);
  const [showAllActions, setShowAllActions] = useState(false);
  // Conclusão de marco: otimista no objeto do SEED (a tela lê dele) + PATCH.
  const [tick, setTick] = useState(0);
  function completeMilestone(customer, key) {
    const done = { ...(customer.milestonesDone || {}), [key]: new Date().toISOString() };
    customer.milestonesDone = done; // otimista: CUSTOMERS vem do SEED compartilhado
    setTick((n) => n + 1);
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

  const selected = customers.find((c) => c.id === sel) || null;
  const subsOf = (c) => subs.filter((s) => s.customer === c.id);
  const mainSub = (c) => subsOf(c).find((s) => s.status === "active" || s.status === "past_due") || subsOf(c)[0] || null;
  // sub.plan é FK pra `plans` — resolve o nome (nunca mostrar o id cru na UI).
  const planLabel = (s) => plans.find((p) => p.id === s.plan)?.name || CYCLE_LABEL[s.cycle] || s.cycle || "plano";
  const totalMrr = customers.reduce((a, c) => a + (c.arr || 0), 0) / 12;
  const money = window.fmt.money;
  const shownCustomers = showAll ? customers : customers.slice(0, 50);
  const lastContact = (c) => {
    const lead = (LEADS || []).find((l) => l.id === c.leadId);
    const at = lead?.lastActivityAt || c.lastContactAt;
    if (!at) return "—";
    const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000));
    return days === 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`;
  };

  // O marco de renovação depende do ciclo do contrato: injeta o ciclo da
  // assinatura ativa no cliente antes de calcular a régua.
  const withCycle = (c) => ({ ...c, contractCycle: mainSub(c)?.cycle });

  // Bloco "Próximas ações": o próximo marco em aberto de cada cliente,
  // vencidos primeiro, depois por data. Clientes sem startedAt ficam num
  // rodapé próprio (a régua ainda não começou).
  const nextActions = useMemo(() => {
    const order = { late: 0, soon: 1, next: 2 };
    return customers
      .map((c) => ({ customer: c, milestone: nextMilestone(withCycle(c), product) }))
      .filter((x) => x.milestone)
      .sort((a, b) => (order[a.milestone.status] - order[b.milestone.status]) || (new Date(a.milestone.dueAt) - new Date(b.milestone.dueAt)));
  }, [customers, subs, product, tick, version]);
  const noRuler = useMemo(() => customers.filter((c) => !c.startedAt), [customers]);

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
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, alignItems: "start" }}>
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
                    const nm = nextMilestone(withCycle(c), product);
                    return (
                      <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
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
                {customers.length > 50 && <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>{showAll ? "Mostrar 50" : "Ver todos"}</button>}
              </div>
            </Card>

            <Card title="Próximas ações" hint="régua de retenção, vencidas primeiro">
              <div style={{ padding: "12px 0 8px" }}>
                {nextActions.length === 0 && (
                  <div style={{ padding: "8px 24px 16px", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                    Nenhuma ação pendente. A régua de retenção está em dia.
                  </div>
                )}
                {(showAllActions ? nextActions : nextActions.slice(0, 5)).map(({ customer: c, milestone: m }, i, shown) => (
                  <div key={c.id} onClick={() => setSel(c.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 24px", cursor: "pointer", borderBottom: i === shown.length - 1 ? "none" : "1px solid var(--line-faint)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                      background: m.status === "late" ? "var(--neg)" : m.status === "soon" ? "var(--warn)" : "var(--fg-4)",
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{m.label}{m.hint ? ` · ${m.hint}` : ""}</div>
                    </div>
                    <Pill tone={m.status === "late" ? "neg" : m.status === "soon" ? "warn" : "mut"}>
                      {m.status === "late" ? "venceu " : "vence "}{dueLabel(m.dueAt)}
                    </Pill>
                    <button onClick={(e) => { e.stopPropagation(); completeMilestone(c, m.key); }}
                      style={{ height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", flexShrink: 0 }}>
                      concluir
                    </button>
                  </div>
                ))}
                {nextActions.length > 5 && (
                  <div style={{ padding: "12px 24px 8px", borderTop: "1px solid var(--line-1)" }}>
                    <button onClick={() => setShowAllActions((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>
                      {showAllActions ? "ver menos" : `ver mais (${nextActions.length - 5})`}
                    </button>
                  </div>
                )}
                {noRuler.length > 0 && (
                  <div style={{ padding: "14px 24px 8px", borderTop: nextActions.length ? "1px solid var(--line-1)" : "none" }}>
                    <div className="mono" style={SECTION_LABEL}>Sem régua ativa</div>
                    {noRuler.map((c) => (
                      <div key={c.id} onClick={() => setSel(c.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer", fontSize: 13 }}>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ fontSize: 12, color: "var(--fg-4)" }}>defina "cliente desde" pra ativar a régua</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
      )}

      {selected && (
        <CustomerModal
          customer={selected}
          lead={(LEADS || []).find((l) => l.id === selected.leadId) || null}
          product={product}
          subs={subsOf(selected)}
          invoices={invoices.filter((i) => i.customer === selected.id)}
          planLabel={planLabel}
          lastContact={lastContact}
          onComplete={completeMilestone}
          onEdit={() => openForm("customers", selected)}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  );
}

// Dados do cliente: os campos comerciais herdados do lead de origem, moldados
// pro pós-venda (contato clicável, potencial, dor do anúncio, valor fechado,
// pagamento e responsáveis). Só o que está preenchido aparece; sem lead
// vinculado, mostra o que o cadastro do cliente tiver.
function CustomerFacts({ customer, lead, product }) {
  const saasId = customer.saas || product?.id;
  const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === saasId) || product;
  const cat = useAttribution(saasId, !!lead?.utm);
  const pain = lead ? leadPain(lead, cat, saasCfg?.painMap) : null;
  const tier = lead ? leadTier(lead) : null;
  const email = customer.email || lead?.email;
  const phone = customer.phone || lead?.phone;
  const wa = phone ? waLink(phone) : null;
  const linkStyle = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };
  const facts = [
    ["Empresa", customer.company || lead?.company],
    ["WhatsApp", wa ? <a href={wa} target="_blank" rel="noreferrer" style={linkStyle}>{phone}</a> : phone],
    ["E-mail", email ? <a href={`mailto:${email}`} style={linkStyle}>{email}</a> : null],
    ["Potencial", tier && tier.key !== "sem" ? tier.label : null],
    ["Dor do anúncio", pain ? `[${pain.code}] ${pain.label}` : null],
    ["Origem", lead?.source],
    ["Faixa de faturamento", lead?.value],
    ["Valor fechado", lead?.amount ? window.fmt.money(lead.amount) : null],
    ["Pagamento", lead?.paymentMethod ? paymentLabel(lead.paymentMethod) : null],
    ["SDR", lead?.owner ? displayName(lead.owner) : null],
    ["Closer", lead?.closer ? displayName(lead.closer) : null],
    ["Integrador", lead?.integrator ? displayName(lead.integrator) : null],
    ["Motivo da busca", lead?.reason],
  ].filter(([, v]) => v != null && v !== "");
  if (facts.length === 0) return null;
  return (
    <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line-faint)" }}>
      <div className="mono" style={SECTION_LABEL}>Dados do cliente</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 20px" }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line-faint)" }}>
            <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
            <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Popup do cliente: resumo (números + assinatura + faturas) e o histórico de
// ações de retenção (régua de marcos com concluir + funil de origem).
function CustomerModal({ customer, lead, product, subs, invoices, planLabel, lastContact, onComplete, onEdit, onClose }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const money = window.fmt.money;
  const mainSub = subs.find((s) => s.status === "active" || s.status === "past_due") || subs[0] || null;
  const st = mainSub ? SUB_STATUS[mainSub.status] || { label: mainSub.status, tone: "mut" } : null;
  const summary = [
    { label: "Plano", value: mainSub ? planLabel(mainSub) : customer.plan || "sem plano" },
    { label: "Tempo de casa", value: tenureLabel(customer) || "defina o início" },
    { label: "Último contato", value: lastContact(customer) },
    { label: "Assinatura", value: st ? st.label : "sem assinatura" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "min(86vh, 940px)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--line-faint)", position: "sticky", top: 0, background: "var(--bg-1)", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{customer.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>
                {money((customer.arr || 0) / 12)}/mês · {money(customer.arr || 0)}/ano{customer.email ? ` · ${customer.email}` : ""}
              </div>
            </div>
            <button onClick={onEdit} style={{ height: 30, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, flexShrink: 0 }}>Editar</button>
            <button onClick={onClose} aria-label="Fechar" style={{ height: 30, width: 30, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 14, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginTop: 14 }}>
            {summary.map((s) => (
              <div key={s.label}>
                <div className="mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>{s.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
          {(customer.flags || []).length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {customer.flags.map((f) => <Pill key={f} tone="warn">{f}</Pill>)}
            </div>
          )}
        </div>

        <CustomerFacts customer={customer} lead={lead} product={product} />

        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--line-faint)" }}>
          <div className="mono" style={SECTION_LABEL}>Ações de retenção</div>
          {!customer.startedAt && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
              Defina "Cliente desde" (editar cliente) pra ativar a régua de marcos: onboarding, check-in de mês 1, revisão de mês 3, upsell de mês 6 e contato de renovação (2 meses antes do fim do contrato).
            </div>
          )}
          {customer.startedAt && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10 }}>
                cliente desde {new Date(customer.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "")} · {tenureLabel(customer)}
              </div>
              {milestonesFor({ ...customer, contractCycle: mainSub?.cycle }, product).map((m, i, arr) => (
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
                    <button onClick={() => onComplete(customer, m.key)}
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
          <div className="mono" style={SECTION_LABEL}>Assinaturas</div>
          {subs.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma assinatura. Crie na aba Assinaturas.</div>
          )}
          {subs.map((s) => {
            const stt = SUB_STATUS[s.status] || { label: s.status, tone: "mut" };
            return (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                <span style={{ color: "var(--fg-2)" }}>{planLabel(s)} · {CYCLE_LABEL[s.cycle] || s.cycle}</span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span className="tnum mono" style={{ fontWeight: 500 }}>{money(s.price || 0)}</span>
                  <Pill tone={stt.tone}>{stt.label}</Pill>
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "16px 24px 20px", borderBottom: "1px solid var(--line-faint)" }}>
          <div className="mono" style={SECTION_LABEL}>Últimas faturas</div>
          {invoices.slice(0, 4).map((i) => (
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
          {invoices.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nenhuma fatura ainda.</div>
          )}
        </div>

        <CustomerHistory customer={customer} />
      </div>
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
