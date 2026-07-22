import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { PageHead, Card, Pill, Segmented } from "../components/viz.jsx";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
import { milestonesFor, nextMilestone, tenureLabel, dueLabel } from "../lib/milestones.js";
import { ActivityList } from "../components/timeline.jsx";
import { CallSummaryCard, IntegrationBriefCard } from "./today.jsx";
import { SubscriptionsScreen } from "./subscriptions.jsx";
import { CustomersAnalysis } from "./customers-analysis.jsx";
import { EntityForm } from "../components/EntityForm.jsx";
import { WhatsappChat } from "../components/whatsapp-chat.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { leadTier, waLink, GRADE_STYLE } from "../lib/ui.js";
import { scriptChecklist } from "../lib/scripts.js";
import { displayName } from "../lib/users.js";
import { paymentLabel, PAYMENT_METHODS, CONSULT_PACKAGES, consultPackageLabel, consultPackageOf } from "../lib/payments.js";
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
  // Edição inline do popup (mesmo padrão otimista do concluir marco).
  function patchCustomer(customer, p) {
    Object.assign(customer, p);
    setTick((n) => n + 1);
    api.update("customers", customer.id, p).catch(() => refresh());
  }

  // Workspace de mentoria (UniqueKids): a base não é assinatura recorrente, é
  // pacote de consultas — a tabela troca as colunas de SaaS (plano/MRR/marco/
  // assinatura) pelas da jornada (pacote/valor/próxima consulta/consultas).
  const isKidsWorkspace = product?.id === "uniquekids";
  const [allConsultas, setAllConsultas] = useState([]);

  useEffect(() => {
    api.list("subscriptions").then((rows) => setSubs(rows.filter((s) => s.saas === product?.id))).catch(() => {});
    api.list("plans").then((rows) => setPlans(rows.filter((p) => p.saas === product?.id))).catch(() => {});
    api.list("invoices").then((rows) => setInvoices(rows.filter((i) => i.saas === product?.id))).catch(() => {});
  }, [product?.id, version]);

  useEffect(() => {
    if (!isKidsWorkspace) { setAllConsultas([]); return; }
    let alive = true;
    api.list("consultations").then((rows) => alive && setAllConsultas(rows || [])).catch(() => {});
    return () => { alive = false; };
  }, [isKidsWorkspace, version, tick]);

  const customers = useMemo(() => {
    const list = (CUSTOMERS || []).filter((c) => c.saas === product?.id);
    return list.sort((a, b) => (b.arr || 0) - (a.arr || 0));
  }, [CUSTOMERS, product?.id]);

  const selected = customers.find((c) => c.id === sel) || null;
  const subsOf = (c) => subs.filter((s) => s.customer === c.id);
  const mainSub = (c) => subsOf(c).find((s) => s.status === "active" || s.status === "past_due") || subsOf(c)[0] || null;
  // sub.plan é FK pra `plans` — resolve o nome (nunca mostrar o id cru na UI).
  const planLabel = (s) => plans.find((p) => p.id === s.plan)?.name || CYCLE_LABEL[s.cycle] || s.cycle || "plano";
  // Cliente com endedAt no passado deu churn: fica fora do MRR, da contagem de
  // ativos e da régua (mas segue na tabela e na Análise).
  const isChurned = (c) => c.endedAt && new Date(c.endedAt).getTime() <= Date.now();
  const activeCustomers = customers.filter((c) => !isChurned(c));
  const totalMrr = activeCustomers.reduce((a, c) => a + (c.arr || 0), 0) / 12;
  const totalContratado = activeCustomers.reduce((a, c) => a + (c.arr || 0), 0);
  const money = window.fmt.money;

  // Nível (categoria A/B/C/…) do cliente = grade do lead que virou cliente
  // (mesma régua da Publicidade/Forms). Sem lead qualificado → "sem nível".
  const gradeOf = (c) => {
    const lead = c.leadId ? (LEADS || []).find((l) => l.id === c.leadId) : null;
    return leadTier(lead || null);
  };
  // Distribuição por nível dos clientes ATIVOS (só faz sentido na LeverAds; a
  // mentoria não tem grade de marketplace).
  const gradeDist = useMemo(() => {
    const counts = {}; let sem = 0;
    for (const c of activeCustomers) {
      const t = gradeOf(c);
      if (t.grade) counts[t.grade] = (counts[t.grade] || 0) + 1;
      else sem++;
    }
    return { counts, sem };
  }, [activeCustomers, LEADS]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jornada de consultas do cliente (mesma família da tela Consultas).
  const journeyOf = (c) => {
    const items = allConsultas
      .filter((x) => (x.customerId && x.customerId === c.id) || (c.leadId && x.leadId === c.leadId))
      .sort((a, b) => (a.n || 0) - (b.n || 0));
    const total = items.reduce((a, x) => Math.max(a, Number(x.packageTotal) || 0), 0) || consultPackageOf(c.plan) || 8;
    const done = items.filter((x) => x.status === "done").length;
    const next = items.filter((x) => x.status === "scheduled" && x.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0] || null;
    return { items, total, done, next };
  };
  const fmtNextAt = (at) => new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
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
  // rodapé próprio (a régua ainda não começou). Cliente da mentoria (UniqueKids)
  // fica FORA da régua de SaaS: o pós-venda dele é a jornada de consultas, que
  // vive na tela Consultas e na Agenda.
  const isMentoria = (c) => c.saas === "uniquekids";
  const nextActions = useMemo(() => {
    const order = { late: 0, soon: 1, next: 2 };
    return customers
      .filter((c) => !isChurned(c) && !isMentoria(c))
      .map((c) => ({ customer: c, milestone: nextMilestone(withCycle(c), product) }))
      .filter((x) => x.milestone)
      .sort((a, b) => (order[a.milestone.status] - order[b.milestone.status]) || (new Date(a.milestone.dueAt) - new Date(b.milestone.dueAt)));
  }, [customers, subs, product, tick, version]);
  const noRuler = useMemo(() => customers.filter((c) => !c.startedAt && !isChurned(c) && !isMentoria(c)), [customers]);

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Clientes"
        sub={`${activeCustomers.length} ${activeCustomers.length === 1 ? "ativo" : "ativos"} · ${isKidsWorkspace ? `${money(totalContratado)} contratado` : `MRR ${money(totalMrr)}`}`}>
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
            <CustomersAnalysis customers={customers} subs={subs} isKids={isKidsWorkspace} />

            {!isKidsWorkspace && (
              <Card title="Clientes por nível" hint="categoria (A/B/C…) da carteira ativa, pela grade do lead">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", padding: "6px 24px 20px", alignItems: "center" }}>
                  {["S", "A", "B", "C", "D", "E"].filter((g) => gradeDist.counts[g] > 0).map((g) => {
                    const s = GRADE_STYLE[g];
                    return (
                      <div key={g} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span title={s.label} style={{ width: 22, height: 22, borderRadius: 6, background: s.tone, color: s.badgeFg, fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>{g}</span>
                        <span className="tnum" style={{ fontSize: 19, fontWeight: 700 }}>{gradeDist.counts[g]}</span>
                      </div>
                    );
                  })}
                  {gradeDist.sem > 0 && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span title="sem qualificação (lead não respondeu contas/anúncios)" style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--line-2)", color: "var(--fg-4)", fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>—</span>
                      <span className="tnum" style={{ fontSize: 19, fontWeight: 700, color: "var(--fg-3)" }}>{gradeDist.sem}</span>
                      <span style={{ fontSize: 12, color: "var(--fg-4)" }}>sem nível</span>
                    </div>
                  )}
                  {Object.keys(gradeDist.counts).length === 0 && gradeDist.sem === 0 && (
                    <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>sem clientes ativos ainda</span>
                  )}
                </div>
              </Card>
            )}

            <Card title="Próximas ações" hint="régua de retenção, vencidas primeiro">
              <div style={{ padding: "12px 0 8px" }}>
                {nextActions.length === 0 && (
                  <div style={{ padding: "8px 24px 16px", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                    Nenhuma ação pendente. A régua de retenção está em dia.
                  </div>
                )}
                {(showAllActions ? nextActions : nextActions.slice(0, 2)).map(({ customer: c, milestone: m }, i, shown) => (
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
                {nextActions.length > 2 && (
                  <div style={{ padding: "12px 24px 8px", borderTop: "1px solid var(--line-1)" }}>
                    <button onClick={() => setShowAllActions((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>
                      {showAllActions ? "ver menos" : `ver mais (${nextActions.length - 2})`}
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

            <Card style={{ overflow: "hidden" }}>
              <div className="tbl-x">
              <table style={{ width: "100%", minWidth: isKidsWorkspace ? 880 : 960, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {(isKidsWorkspace
                      ? ["Cliente", "Pacote", "Valor", "Tempo de casa", "Último contato", "Próxima consulta", "Consultas"]
                      : ["Cliente", "Nível", "Plano", "MRR", "Tempo de casa", "Último contato", "Próximo marco", "Assinatura"]
                    ).map((h) => (
                      <th key={h} style={{ textAlign: (h === "MRR" || h === "Valor") ? "right" : "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", padding: "12px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownCustomers.map((c) => {
                    const sub = mainSub(c);
                    const st = sub ? SUB_STATUS[sub.status] || { label: sub.status, tone: "mut" } : null;
                    const kids = isMentoria(c);
                    const nm = kids ? null : nextMilestone(withCycle(c), product);
                    const j = kids ? journeyOf(c) : null;
                    return (
                      <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <td style={{ padding: "14px 20px", fontSize: 13.5, fontWeight: 600, borderBottom: "1px solid var(--line-faint)" }}>{c.name}</td>
                        {/* Nível (categoria A/B/C…) do cliente, pela grade do lead. Só LeverAds. */}
                        {!isKidsWorkspace && (() => { const t = gradeOf(c); return (
                          <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                            {t.grade
                              ? <span title={t.label} style={{ width: 22, height: 22, borderRadius: 6, background: t.tone, color: t.badgeFg, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{t.grade}</span>
                              : <span style={{ fontSize: 13, color: "var(--fg-4)" }}>—</span>}
                          </td>
                        ); })()}
                        {/* Pacote (mentoria) × plano da assinatura (SaaS) */}
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {kids ? consultPackageLabel(j.total) : sub ? planLabel(sub) : c.plan || "sem plano"}
                        </td>
                        {/* Mentoria é compra única: mostra o valor do contrato, não MRR */}
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-faint)" }}>
                          {money(kids ? (c.arr || 0) : (c.arr || 0) / 12)}
                        </td>
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {tenureLabel(c) || <span style={{ color: "var(--fg-4)" }}>defina o início</span>}
                        </td>
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-3)", borderBottom: "1px solid var(--line-faint)" }}>{lastContact(c)}</td>
                        {/* Próxima consulta (mentoria) × próximo marco da régua */}
                        <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                          {kids
                            ? j.next
                              ? <Pill tone="warn">consulta {j.next.n || "?"} · {fmtNextAt(j.next.at)}</Pill>
                              : j.done >= j.total && j.items.length > 0
                                ? <Pill tone="pos">jornada completa</Pill>
                                : <Pill tone="mut">a marcar</Pill>
                            : nm
                              ? <Pill tone={nm.status === "late" ? "neg" : nm.status === "soon" ? "warn" : "mut"}>{nm.label} · {dueLabel(nm.dueAt)}</Pill>
                              : c.startedAt ? <Pill tone="pos">régua completa</Pill> : <Pill tone="mut">sem início</Pill>}
                        </td>
                        {/* Progresso do pacote (mentoria) × status da assinatura */}
                        <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                          {isChurned(c)
                            ? <Pill tone="neg">churn</Pill>
                            : kids
                              ? <Pill tone={j.done >= j.total && j.items.length > 0 ? "pos" : j.done > 0 ? "warn" : "mut"}>{j.done} de {j.total}</Pill>
                              : st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
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
          onPatch={patchCustomer}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  );
}

// Caixa padrão das seções do popup (mesma linguagem do drawer do pipeline).
const BOX = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };

// Nome do formulário de origem do lead (lead.form é o id). Mesmo padrão do
// attributionCache de pains.js: cacheia a PROMESSA por SaaS pra não re-buscar
// a lista de forms a cada popup aberto.
const formsCache = {};
function useFormName(saas, formId) {
  const [name, setName] = useState(null);
  useEffect(() => {
    if (!saas || !formId) { setName(null); return; }
    let alive = true;
    (formsCache[saas] ??= api.list("forms").then((rows) => rows.filter((f) => f.saas === saas)).catch(() => { delete formsCache[saas]; return []; }))
      .then((rows) => { if (alive) setName(rows.find((f) => f.id === formId)?.name || null); });
    return () => { alive = false; };
  }, [saas, formId]);
  return name;
}

// Dados do cliente: os campos comerciais herdados do lead de origem, moldados
// pro pós-venda (contato clicável, potencial, dor do anúncio, valor fechado,
// pagamento e responsáveis). O lápis liga a edição INLINE dos campos do
// cadastro do cliente (nome, contato, e-mail, WhatsApp, plano, pagamento,
// valor e cliente desde), sem trocar de janela; o que vem do lead é leitura.
// Respostas do formulário de diagnóstico (campos do lead), editáveis do popup
// do cliente — mesmo checklist do drawer do pipeline (scriptChecklist). Alterar
// aqui persiste no lead e recalcula o Potencial/Nível do cliente.
function FormAnswersCard({ lead, product, onPatch }) {
  if (!lead) return null;
  const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === (lead.saas || product?.id)) || product;
  const items = scriptChecklist(saasCfg, lead);
  if (!items.length) return null;
  return (
    <div style={BOX}>
      <div className="mono" style={SECTION_LABEL}>Respostas do formulário</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 9px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.raw ? "var(--bg-1)" : "var(--warn-soft)" }}>
            <span style={{ color: c.raw ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 12 }}>{c.raw ? "✓" : "○"}</span>
            <span className="dim" style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>{c.label}</span>
            {c.type === "select" ? (
              <select value={c.raw || ""} onChange={(e) => onPatch({ [c.key]: e.target.value })}
                style={{ flexShrink: 0, maxWidth: "50%", height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: c.raw ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12, fontWeight: 500 }}>
                <option value="">selecionar…</option>
                {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {c.raw && !c.options.some((o) => o.value === c.raw) && <option value={c.raw}>{c.raw}</option>}
              </select>
            ) : (
              <input key={lead.id + c.key} type="text" defaultValue={c.raw || ""} placeholder="preencher…"
                onBlur={(e) => { if (e.target.value !== (c.raw || "")) onPatch({ [c.key]: e.target.value }); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                style={{ flexShrink: 0, width: "50%", height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontWeight: 500 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerFacts({ customer, lead, product, onPatch }) {
  const [edit, setEdit] = useState(false);
  const saasId = customer.saas || product?.id;
  const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === saasId) || product;
  const cat = useAttribution(saasId, !!lead?.utm);
  const pain = lead ? leadPain(lead, cat, saasCfg?.painMap) : null;
  const tier = lead ? leadTier(lead) : null;
  const formName = useFormName(saasId, lead?.form);
  // Anúncio que trouxe o lead: utm.content é o id, o catálogo de atribuição
  // resolve o nome (que já carrega o código de dor "[X]" no título).
  const adName = lead?.utm?.content ? (cat?.ads?.[String(lead.utm.content)]?.name || String(lead.utm.content)) : null;
  const email = customer.email || lead?.email;
  const phone = customer.phone || lead?.phone;
  const wa = phone ? waLink(phone) : null;
  const linkStyle = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };
  const facts = [
    ["Empresa", customer.company || lead?.company],
    ["Contato", customer.contact],
    ["WhatsApp", wa ? <a href={wa} target="_blank" rel="noreferrer" style={linkStyle}>{phone}</a> : phone],
    ["E-mail", email ? <a href={`mailto:${email}`} style={linkStyle}>{email}</a> : null],
    ["Potencial", tier && tier.key !== "sem" ? tier.label : null],
    ["Dor do anúncio", pain ? `[${pain.code}] ${pain.label}` : null],
    ["Origem", lead?.source],
    ["Formulário", formName],
    ["Anúncio", adName],
    ["Faixa de faturamento", lead?.value],
    ["Valor fechado", lead?.amount ? window.fmt.money(lead.amount) : null],
    ["Pagamento", (customer.paymentMethod || lead?.paymentMethod) ? paymentLabel(customer.paymentMethod || lead?.paymentMethod) : null],
    ["SDR", lead?.owner ? displayName(lead.owner) : null],
    ["Closer", lead?.closer ? displayName(lead.closer) : null],
    ["Integrador", lead?.integrator ? displayName(lead.integrator) : null],
    ["Motivo da busca", lead?.reason],
  ].filter(([, v]) => v != null && v !== "");
  const patch = (p) => onPatch && onPatch(p);
  const inputSt = { flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };
  const EditRow = ({ label, children }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono dim" style={{ width: 96, flexShrink: 0, fontSize: 10.5 }}>{label}</span>
      {children}
    </label>
  );
  // Mentoria vende pacote de consultas; os demais produtos, plano recorrente.
  const PLANS = customer.saas === "uniquekids"
    ? CONSULT_PACKAGES.map(consultPackageLabel)
    : ["Anual", "Semestral", "Serviço único", "Trimestral", "Mensal"];
  return (
    <div style={BOX}>
      <div className="mono" style={{ ...SECTION_LABEL, display: "flex", alignItems: "center", gap: 8 }}>
        <span>Dados do cliente</span>
        {onPatch && (
          <button onClick={() => setEdit((v) => !v)} title={edit ? "Concluir edição" : "Editar os dados aqui mesmo"}
            style={{ marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid " + (edit ? "var(--accent)" : "var(--line-2)"), background: edit ? "var(--accent)" : "var(--bg-1)", color: edit ? "var(--accent-fg)" : "var(--fg-3)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
            {edit ? "✓ pronto" : "✎ editar"}
          </button>
        )}
      </div>
      {edit ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <EditRow label="Nome"><input defaultValue={customer.name || ""} onBlur={(e) => e.target.value !== (customer.name || "") && patch({ name: e.target.value })} style={inputSt} /></EditRow>
          <EditRow label="Contato"><input defaultValue={customer.contact || ""} onBlur={(e) => e.target.value !== (customer.contact || "") && patch({ contact: e.target.value })} style={inputSt} /></EditRow>
          <EditRow label="E-mail"><input defaultValue={customer.email || ""} onBlur={(e) => e.target.value !== (customer.email || "") && patch({ email: e.target.value })} style={inputSt} /></EditRow>
          <EditRow label="WhatsApp"><input defaultValue={customer.phone || ""} onBlur={(e) => e.target.value !== (customer.phone || "") && patch({ phone: e.target.value })} style={inputSt} /></EditRow>
          <EditRow label={customer.saas === "uniquekids" ? "Pacote" : "Plano"}>
            <select value={customer.plan || ""} onChange={(e) => patch({ plan: e.target.value })} style={inputSt}>
              <option value="">{customer.saas === "uniquekids" ? "sem pacote" : "sem plano"}</option>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              {customer.plan && !PLANS.includes(customer.plan) && <option value={customer.plan}>{customer.plan}</option>}
            </select>
          </EditRow>
          <EditRow label="Pagamento">
            <select value={customer.paymentMethod || ""} onChange={(e) => patch({ paymentMethod: e.target.value })} style={inputSt}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </EditRow>
          <EditRow label="Valor/ano (R$)"><input type="number" defaultValue={customer.arr ?? ""} onBlur={(e) => { const n = e.target.value === "" ? 0 : Number(e.target.value); if (n !== (customer.arr || 0)) patch({ arr: n }); }} style={inputSt} /></EditRow>
          <EditRow label="Cliente desde"><input type="date" value={String(customer.startedAt || "").slice(0, 10)} onChange={(e) => patch({ startedAt: e.target.value })} style={inputSt} /></EditRow>
        </div>
      ) : facts.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Sem dados ainda. Use o ✎ pra preencher.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: "0 18px" }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line-1)" }}>
              <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
              <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Popup do cliente: tela dividida no padrão do drawer do pipeline (sem scroll
// longo). Esquerda: dados do cliente (edição inline no próprio campo) +
// assinaturas + faturas. Direita: régua de retenção + histórico do funil.
// "Editar" NÃO abre outro popup: troca o corpo pelo form (EntityForm bare)
// dentro deste mesmo modal, pros campos raros (flags, saúde, dono).
function CustomerModal({ customer, lead, product, subs, invoices, planLabel, lastContact, onComplete, onPatch, onClose }) {
  const { refresh } = useData();
  const [editing, setEditing] = useState(false);
  // Edição das RESPOSTAS DO FORMULÁRIO (campos do lead) direto do popup: otimista
  // no objeto do lead (do SEED) + PATCH; o bump re-renderiza o popro pra o
  // Potencial/Nível recalcularem na hora.
  const [, bumpLead] = React.useReducer((x) => x + 1, 0);
  function patchLead(p) {
    if (!lead) return;
    Object.assign(lead, p);
    bumpLead();
    api.update("leads", lead.id, p).catch(() => {});
  }
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") (editing ? setEditing(false) : onClose()); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, editing]);
  const money = window.fmt.money;
  const mainSub = subs.find((s) => s.status === "active" || s.status === "past_due") || subs[0] || null;
  const st = mainSub ? SUB_STATUS[mainSub.status] || { label: mainSub.status, tone: "mut" } : null;

  // Cliente da mentoria (UniqueKids): o pós-venda dele não é régua de SaaS nem
  // assinatura recorrente — é o pacote de consultas comprado no Ganho. O popup
  // troca esses blocos pela jornada real (mesma família da tela Consultas).
  const isKids = customer.saas === "uniquekids";
  const [consultas, setConsultas] = useState([]);
  React.useEffect(() => {
    if (!isKids) { setConsultas([]); return; }
    let alive = true;
    api.list("consultations")
      .then((rows) => alive && setConsultas((rows || [])
        .filter((x) => x.customerId === customer.id || (customer.leadId && x.leadId === customer.leadId))
        .sort((a, b) => (a.n || 0) - (b.n || 0))))
      .catch(() => {});
    return () => { alive = false; };
  }, [isKids, customer.id, customer.leadId]);
  // Tamanho do pacote: o que as consultas carimbam manda; sem consultas ainda,
  // lê o rótulo do cadastro ("Mentoria · 4 consultas"); por último, o padrão 8.
  const consultTotal = consultas.reduce((a, c) => Math.max(a, Number(c.packageTotal) || 0), 0)
    || consultPackageOf(customer.plan) || 8;
  const consultDone = consultas.filter((c) => c.status === "done").length;
  const nextConsult = consultas.filter((c) => c.status === "scheduled" && c.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0] || null;
  const fmtConsultaAt = (at) => at ? new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "";
  const CONSULT_STATUS = { done: { label: "feita", tone: "pos" }, scheduled: { label: "marcada", tone: "warn" }, canceled: { label: "cancelada", tone: "mut" } };

  const summary = isKids ? [
    { label: "Pacote", value: consultPackageLabel(consultTotal) },
    { label: "Tempo de casa", value: tenureLabel(customer) || "defina o início" },
    { label: "Último contato", value: lastContact(customer) },
    { label: "Consultas", value: `${consultDone} de ${consultTotal} feitas` },
  ] : [
    { label: "Plano", value: mainSub ? planLabel(mainSub) : customer.plan || "sem plano" },
    { label: "Tempo de casa", value: tenureLabel(customer) || "defina o início" },
    { label: "Último contato", value: lastContact(customer) },
    { label: "Assinatura", value: st ? st.label : "sem assinatura" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: editing ? "min(640px, 100%)" : "min(1080px, 100%)", maxHeight: "min(92vh, 100%)", display: "flex", flexDirection: "column", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)" }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--line-faint)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 18, fontWeight: 700 }}>{customer.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>
                {isKids
                  ? `${money(customer.arr || 0)} · Mentoria R.O.T.I.N.A`
                  : `${money((customer.arr || 0) / 12)}/mês · ${money(customer.arr || 0)}/ano`}{customer.email ? ` · ${customer.email}` : ""}
              </div>
            </div>
            {!editing && (
              <button onClick={() => setEditing(true)} style={{ height: 30, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, flexShrink: 0 }}>Editar</button>
            )}
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

        {editing && (
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <EntityForm
              entityKey="customers"
              record={customer}
              bare
              onClose={() => setEditing(false)}
              onSaved={async () => { await refresh(); setEditing(false); }}
            />
          </div>
        )}

        {!editing && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <CustomerFacts customer={customer} lead={lead} product={product} onPatch={onPatch ? (p) => onPatch(customer, p) : null} />

        {/* Respostas do formulário (campos do lead) — editáveis daqui; mudou o
            nicho/contas/anúncios, o Potencial e o Nível recalculam. Só quando
            há lead com perguntas (mentoria/produto B2C sem grade não mostra). */}
        {!isKids && <FormAnswersCard lead={lead} product={product} onPatch={patchLead} />}

        {/* Mentoria não é recorrência: pra cliente Kids o bloco de assinaturas
            sai (o pagamento fica em Dados do cliente e nas faturas). */}
        {!isKids && (
        <div style={BOX}>
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
        )}

        <div style={BOX}>
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

        {/* Inbox do WhatsApp conectado: a MESMA conversa da tela #whatsapp,
            pra mandar mensagem pro cliente sem sair do popup. */}
        <WhatsappChat lead={lead} phone={customer.phone} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {isKids ? (
        <div style={BOX}>
          <div className="mono" style={{ ...SECTION_LABEL, display: "flex", alignItems: "center" }}>
            <span>Jornada de consultas</span>
            <button onClick={() => { onClose(); window.location.hash = "consultas"; }}
              style={{ marginLeft: "auto", height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
              abrir Consultas ↗
            </button>
          </div>
          {customer.startedAt && (
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10 }}>
              cliente desde {new Date(customer.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "")} · {nextConsult ? `próxima consulta: ${fmtConsultaAt(nextConsult.at)}` : consultDone >= consultTotal && consultas.length > 0 ? "jornada completa 🎉" : "sem próxima marcada"}
            </div>
          )}
          {consultas.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
              Nenhuma consulta ainda. O pacote nasce sozinho quando o lead vira Ganho; dá pra criar na tela Consultas também.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {consultas.map((c, i) => {
                const cst = CONSULT_STATUS[c.status] || CONSULT_STATUS.scheduled;
                const done = c.status === "done";
                return (
                  <div key={c.id} style={{ display: "flex", gap: 12, position: "relative", paddingBottom: i === consultas.length - 1 ? 0 : 14 }}>
                    {i < consultas.length - 1 && <span style={{ position: "absolute", left: 7, top: 18, bottom: 0, width: 2, background: "var(--line-1)" }} />}
                    <span style={{
                      width: 16, height: 16, borderRadius: 999, flexShrink: 0, marginTop: 1, zIndex: 1,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9,
                      background: done ? "var(--pos-soft)" : c.at ? "var(--warn-soft)" : "var(--bg-2)",
                      color: done ? "var(--pos)" : c.at ? "var(--warn)" : "var(--fg-4)",
                      border: !done && !c.at ? "1px solid var(--line-2)" : "none",
                    }}>
                      {done ? "✓" : c.n || "○"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Consulta {c.n || "?"} de {c.packageTotal || consultTotal}</div>
                      <div style={{ fontSize: 12, color: "var(--fg-3)" }}>
                        {c.at ? fmtConsultaAt(c.at) : "sem data · marque na tela Consultas"}
                        {c.summary ? " · resumo de IA pronto" : ""}
                      </div>
                    </div>
                    <Pill tone={c.at || done ? cst.tone : "mut"}>{!done && !c.at ? "a marcar" : cst.label}</Pill>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        ) : (
        <div style={BOX}>
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
        )}

        <CustomerHistory customer={customer} />
        </div>
        </div>
        </div>
        )}
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
  // Briefing de passagem pro integrador: aqui ele SUBSTITUI o resumo da call de
  // venda (nasce dela e é escrito pra quem vai entregar). O resumo da call de
  // INTEGRAÇÃO, que acontece depois, continua aparecendo.
  const brief = React.useMemo(() => {
    const b = (acts || []).filter((x) => x.meta?.event === "integration_brief" && x.meta?.brief).sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))[0];
    return b ? { ...b.meta.brief, source: b.meta.source || "", recordingUrl: b.meta.recordingUrl || "" } : null;
  }, [acts]);
  if (!customer?.leadId || (acts !== null && acts.length === 0)) return null;
  const shown = expanded ? acts : (acts || []).slice(0, 10);
  const timelineActs = shown.filter((a) => !(a.type === "system" && (a.meta?.event === "call_summary" || a.meta?.event === "integration_brief")));
  const showCallSummary = !!callSummary && !(brief && callSummary.kind === "call");
  return (
    <div style={BOX}>
      {brief && <div style={{ marginBottom: 12 }}><IntegrationBriefCard brief={brief} phone={customer.phone || ""} /></div>}
      {showCallSummary && <div style={{ marginBottom: 12 }}><CallSummaryCard summary={callSummary} phone={customer.phone || ""} /></div>}
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
