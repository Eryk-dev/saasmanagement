import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, useEsc } from "../atoms.jsx";
import { mpMethodLabel, MP_SUB_STATUS } from "../lib/payments.js";
// Assinaturas (fase 5) — Cockpit como system-of-record de billing: assinaturas,
// faturas (renovação/pró-rata/dunning) e planos por SaaS. O pagamento em si fica
// no MP/app (fase 4) — aqui a fatura recebe baixa manual ("marcar paga").
// customer.arr é derivado das assinaturas pelo servidor (invariante do rollup).

const { useState, useEffect, useCallback } = React;

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const annualized = (s) => (Number(s.price) || 0) * (12 / (CYCLE_MONTHS[s.cycle] || 1));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

const SUB_STATUS = {
  active:   { label: "ativa",      cls: "pos" },
  past_due: { label: "inadimplente", cls: "warn" },
  paused:   { label: "pausada",    cls: "" },
  canceled: { label: "cancelada",  cls: "" },
};
const INV_STATUS = {
  open:    { label: "aberta",  cls: "" },
  overdue: { label: "vencida", cls: "warn" },
  paid:    { label: "paga",    cls: "pos" },
};

function SubscriptionsScreen({ saasId }) {
  const { SAAS, CUSTOMERS } = window.SEED;
  const { version, refresh, openForm, openDelete } = useData();
  const [active, setActive] = useState(saasId || SAAS[0]?.id);
  // Embutida em Clientes (saasId controlado): segue o produto da tela-mãe e
  // não mostra seletor próprio — um seletor de SaaS por tela basta.
  useEffect(() => { if (saasId) setActive(saasId); }, [saasId]);
  const [tab, setTab] = useState("subs"); // subs | invoices | plans | mp
  const [subs, setSubs] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [plans, setPlans] = useState([]);
  const [mpData, setMpData] = useState(null); // { preapprovals, sync } — recorrências da conta MP
  const [changing, setChanging] = useState(null); // assinatura no modal de mudança
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!active) return;
    const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
    const [ss, ii, pp, mm] = await Promise.all([
      api.list("subscriptions", { saas: active }),
      api.list("invoices", { saas: active }),
      api.list("plans", { saas: active }),
      mpOn ? api.mpPreapprovals({ saas: active }).catch(() => null) : Promise.resolve(null),
    ]);
    setSubs(ss); setInvoices(ii); setPlans(pp); setMpData(mm);
    // O EntityForm de assinatura monta o select de planos daqui (padrão window.SEED).
    window.PLANS_CACHE = pp;
  }, [active]);
  useEffect(() => { load(); }, [load, version]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  async function runBilling() {
    const r = await api.runBilling();
    flash(`motor: ${r.renewed} renovação(ões) · ${r.applied} mudança(s) aplicada(s) · ${r.overdue} fatura(s) vencida(s) · ${r.pastDue} inadimplente(s) · ${r.recovered} recuperada(s)`);
    await refresh();
  }
  async function setStatus(sub, status) {
    await api.update("subscriptions", sub.id, { status });
    await refresh();
  }
  async function pay(inv) {
    await api.payInvoice(inv.id);
    flash("fatura baixada");
    await refresh();
  }
  // Link de pagamento da fatura (checkout MP, avulso): copia o que já existe ou
  // gera um. O pagamento baixa a fatura sozinho (external_reference = fatura).
  async function invLink(inv) {
    const copy = async (url, msg) => {
      try { await navigator.clipboard.writeText(url); flash(msg); }
      catch { window.prompt("Link de pagamento:", url); }
    };
    if (inv.mpInitPoint) return copy(inv.mpInitPoint, "link da fatura copiado");
    try {
      const r = await api.invoiceMpLink(inv.id);
      if (r.url) await copy(r.url, "link criado e copiado — manda pro cliente; a baixa é automática");
      await load();
    } catch (err) { flash(`MP: ${err.message}`); }
  }
  // Gera (ou copia) o link de autorização do MP. O cliente abre, autoriza, e o
  // webhook ativa a assinatura + dá baixa nas faturas sozinho.
  async function mpLink(sub) {
    try {
      const r = await api.mpLink(sub.id);
      if (r.initPoint) {
        try { await navigator.clipboard.writeText(r.initPoint); flash("link MP copiado — mande pro cliente autorizar"); }
        catch { window.prompt("Link de autorização MP:", r.initPoint); }
      }
      await refresh();
    } catch (err) {
      flash(err.status === 400 ? "cliente sem e-mail — edite o cliente e preencha o e-mail" : `MP: ${err.message}`);
    }
  }
  // Sincroniza o espelho das recorrências da conta MP (aba MP).
  async function syncPreapprovals() {
    try {
      const r = await api.mpSyncPreapprovals();
      flash(`MP: ${r.seen} recorrência(s) na conta · ${r.linked} já vinculada(s)`);
      await load();
    } catch (err) { flash(`MP: ${err.message}`); }
  }
  // Liga uma recorrência do MP a uma assinatura do cockpit (ou desfaz o vínculo).
  async function linkPreapproval(p, subscription) {
    try {
      await api.mpLinkPreapproval(p.id, subscription ? { subscription } : {});
      flash(subscription ? "recorrência vinculada — o MP agora conversa com essa assinatura" : "vínculo desfeito");
      await refresh();
      await load();
    } catch (err) { flash(err.message || "não deu pra vincular"); }
  }

  const mpConfigured = !!window.SEED?.CONFIG?.mp?.configured;
  const MP_LABEL = { pending: "MP: aguardando", authorized: "MP: ativo", paused: "MP: pausado", cancelled: "MP: cancelado" };
  const preapprovals = mpData?.preapprovals || [];
  const mpUnlinked = preapprovals.filter((p) => !p.subscription).length;

  const customerName = (id) => CUSTOMERS.find((c) => c.id === id)?.name || id || "—";
  const planName = (id) => plans.find((p) => p.id === id)?.name || (id ? id : "avulso");

  if (!SAAS.length) return (
    <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — assinaturas, faturas e planos pertencem a um SaaS." />
  );

  const TabBtn = ({ k, label }) => (
    <button onClick={() => setTab(k)} style={{
      padding: "4px 10px", borderRadius: 4,
      background: tab === k ? "var(--bg-3)" : "transparent",
      color: tab === k ? "var(--fg-1)" : "var(--fg-3)",
      fontSize: 12, border: "1px solid " + (tab === k ? "var(--line-2)" : "transparent"),
    }}>{label}</button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px var(--pad-x)", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!saasId && SAAS.length > 1 && (
            <div style={{ display: "flex", gap: 6 }}>
              {SAAS.map((x) => (
                <button key={x.id} onClick={() => setActive(x.id)} style={{
                  height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
                  border: "1px solid " + (active === x.id ? "var(--line-strong)" : "var(--line-1)"),
                  background: active === x.id ? "var(--bg-3)" : "var(--bg-2)",
                  color: active === x.id ? "var(--fg-1)" : "var(--fg-3)",
                  fontSize: 12, fontFamily: "var(--mono)",
                }}>{x.name}</button>
              ))}
            </div>
          )}
          {!saasId && SAAS.length > 1 && <span style={{ color: "var(--line-2)" }}>·</span>}
          <TabBtn k="subs" label={`Assinaturas (${subs.length})`} />
          <TabBtn k="invoices" label={`Faturas (${invoices.length})`} />
          <TabBtn k="plans" label={`Planos (${plans.length})`} />
          {mpConfigured && <TabBtn k="mp" label={`MP recorrentes (${preapprovals.length})${mpUnlinked ? ` · ${mpUnlinked} sem cliente` : ""}`} />}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {tab === "mp" ? (
            <button onClick={syncPreapprovals} style={chromeBtnStyleSmall} title="busca as assinaturas recorrentes da conta MP agora (o servidor também faz sozinho a cada 30 min)">
              <span className="mono" style={{ fontSize: 11 }}>↻ sincronizar MP</span>
            </button>
          ) : (
            <button onClick={runBilling} style={chromeBtnStyleSmall} title="aplica mudanças agendadas, gera renovações e roda o dunning">
              <span className="mono" style={{ fontSize: 11 }}>▸ rodar billing</span>
            </button>
          )}
          {tab === "plans"
            ? <PrimaryButton onClick={() => openForm("plans", { saas: active })}>+ novo plano</PrimaryButton>
            : tab !== "mp" && <PrimaryButton onClick={() => openForm("subscriptions", { saas: active })}>+ nova assinatura</PrimaryButton>}
        </div>
      </div>

      {toast && <div className="mono" style={{ padding: "8px var(--pad-x)", fontSize: 11, color: "var(--accent)", borderBottom: "1px solid var(--line-1)" }}>{toast}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "20px var(--pad-x)" }}>
        {tab === "subs" && (
          !subs.length ? (
            <EmptyState title="Nenhuma assinatura neste SaaS" hint="Crie uma assinatura ligando um cliente a um plano (ou preço avulso). O ARR do cliente passa a ser derivado daqui — e o MRR do produto via rollup." action={<PrimaryButton onClick={() => openForm("subscriptions", { saas: active })}>+ Criar assinatura</PrimaryButton>} />
          ) : (
            <Table
              cols="1.4fr 1fr 0.7fr 0.8fr 0.8fr 0.9fr 0.9fr 260px"
              head={["Cliente", "Plano", "Ciclo", "Preço/ciclo", "ARR", "Status", "Ciclo atual até", ""]}
            >
              {subs.map((s) => {
                const st = SUB_STATUS[s.status] || { label: s.status, cls: "" };
                return (
                  <div key={s.id} style={rowStyle("1.4fr 1fr 0.7fr 0.8fr 0.8fr 0.9fr 0.9fr 260px")}>
                    <span style={{ fontWeight: 500 }}>{customerName(s.customer)}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>{planName(s.plan)}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>{CYCLE_LABEL[s.cycle] || s.cycle}</span>
                    <span className="mono tnum" style={{ fontSize: 12 }}>{window.fmt.money(s.price || 0)}</span>
                    <span className="mono tnum" style={{ fontSize: 12 }}>{window.fmt.money(annualized(s))}</span>
                    <span>
                      <span className={"chip " + st.cls} style={{ height: 20 }}>{st.label}</span>
                      {s.mpStatus && <span className="mono" style={{ fontSize: 9, display: "block", marginTop: 2, color: s.mpStatus === "authorized" ? "var(--pos)" : "var(--fg-4)" }}>{MP_LABEL[s.mpStatus] || `MP: ${s.mpStatus}`}</span>}
                      {s.pendingChange && <span className="mono dim" style={{ fontSize: 9, display: "block", marginTop: 2 }}>muda em {fmtDate(s.pendingChange.applyAt)}</span>}
                    </span>
                    <span className="mono dim tnum" style={{ fontSize: 12 }}>{fmtDate(s.periodEnd)}</span>
                    <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {mpConfigured && s.status !== "canceled" && (
                        <button onClick={() => mpLink(s)} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }} title={s.mpInitPoint ? "re-gerar/copiar link de autorização" : "gerar link de autorização no Mercado Pago"}>
                          <span style={{ fontSize: 11 }}>{s.mpPreapprovalId ? "link MP" : "cobrar via MP"}</span>
                        </button>
                      )}
                      {s.status !== "canceled" && (
                        <button onClick={() => setChanging(s)} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>mudar plano</span></button>
                      )}
                      {s.status === "active" && <button onClick={() => setStatus(s, "paused")} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>pausar</span></button>}
                      {s.status === "paused" && <button onClick={() => setStatus(s, "active")} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>reativar</span></button>}
                      {s.status !== "canceled" && (
                        <button onClick={() => setStatus(s, "canceled")} style={{ ...chromeBtnStyleSmall, color: "var(--neg)" }}><span style={{ fontSize: 11 }}>cancelar</span></button>
                      )}
                      <button onClick={() => openDelete("subscriptions", s)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
                    </span>
                  </div>
                );
              })}
            </Table>
          )
        )}

        {tab === "invoices" && (
          !invoices.length ? (
            <EmptyState title="Nenhuma fatura" hint="Faturas nascem da assinatura: 1ª do ciclo na criação, renovações e pró-rata de upgrade pelo motor de billing." />
          ) : (
            <Table
              cols="1.4fr 0.9fr 0.8fr 0.9fr 0.9fr 0.8fr 200px"
              head={["Cliente", "Tipo", "Valor", "Vencimento", "Status", "Paga em", ""]}
            >
              {[...invoices].sort((a, b) => String(b.dueDate || "").localeCompare(String(a.dueDate || ""))).map((i) => {
                const st = INV_STATUS[i.status] || { label: i.status, cls: "" };
                return (
                  <div key={i.id} style={rowStyle("1.4fr 0.9fr 0.8fr 0.9fr 0.9fr 0.8fr 200px")}>
                    <span style={{ fontWeight: 500 }}>{customerName(i.customer)}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>
                      {i.title || ({ renewal: "renovação", prorata: "pró-rata", upsell: "upsell", manual: "manual" })[i.kind] || i.kind}
                      {/* como o dinheiro entrou de verdade (baixa via MP) */}
                      {i.status === "paid" && mpMethodLabel(i) ? <span style={{ display: "block", fontSize: 9, color: "var(--pos)" }}>{mpMethodLabel(i)}</span> : null}
                    </span>
                    <span className="mono tnum" style={{ fontSize: 12 }}>{window.fmt.money(i.amount || 0)}</span>
                    <span className="mono dim tnum" style={{ fontSize: 12 }}>{fmtDate(i.dueDate)}</span>
                    <span><span className={"chip " + st.cls} style={{ height: 20 }}>{st.label}</span></span>
                    <span className="mono dim tnum" style={{ fontSize: 12 }}>{fmtDate(i.paidAt)}</span>
                    <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {i.status !== "paid" && mpConfigured && (
                        <button onClick={() => invLink(i)} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }} title={i.mpInitPoint ? "copiar o link de pagamento desta fatura" : "gerar link de pagamento avulso desta fatura no MP"}>
                          <span style={{ fontSize: 11 }}>{i.mpInitPoint ? "copiar link" : "link MP"}</span>
                        </button>
                      )}
                      {i.status !== "paid" && (
                        <button onClick={() => pay(i)} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>marcar paga</span></button>
                      )}
                    </span>
                  </div>
                );
              })}
            </Table>
          )
        )}

        {tab === "plans" && (
          !plans.length ? (
            <EmptyState title="Nenhum plano" hint="Planos são o catálogo do SaaS (nome + preço por ciclo). A assinatura pode referenciar um plano ou usar preço avulso." action={<PrimaryButton onClick={() => openForm("plans", { saas: active })}>+ Criar plano</PrimaryButton>} />
          ) : (
            <Table cols="1.4fr 0.8fr 0.8fr 0.8fr 120px" head={["Plano", "Ciclo", "Preço/ciclo", "Assinaturas", ""]}>
              {plans.map((p) => (
                <div key={p.id} style={rowStyle("1.4fr 0.8fr 0.8fr 0.8fr 120px")}>
                  <span style={{ fontWeight: 500 }}>{p.name || p.id}</span>
                  <span className="mono dim" style={{ fontSize: 12 }}>{CYCLE_LABEL[p.cycle] || p.cycle}</span>
                  <span className="mono tnum" style={{ fontSize: 12 }}>{window.fmt.money(p.price || 0)}</span>
                  <span className="mono dim tnum" style={{ fontSize: 12 }}>{subs.filter((s) => s.plan === p.id && s.status !== "canceled").length}</span>
                  <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => openForm("plans", p)} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>editar</span></button>
                    <button onClick={() => openDelete("plans", p)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
                  </span>
                </div>
              ))}
            </Table>
          )
        )}
        {tab === "mp" && (
          <MpRecurringTab
            preapprovals={preapprovals}
            sync={mpData?.sync}
            subs={subs}
            customerName={customerName}
            onLink={linkPreapproval}
            onSync={syncPreapprovals}
          />
        )}
      </div>

      {changing && (
        <ChangeModal
          sub={changing}
          plans={plans}
          customerName={customerName(changing.customer)}
          onClose={() => setChanging(null)}
          onDone={async (msg) => { setChanging(null); flash(msg); await refresh(); }}
        />
      )}
    </div>
  );
}

// Aba MP recorrentes — as assinaturas que a conta do Mercado Pago cobra HOJE,
// inclusive as criadas fora do cockpit (painel do MP, copylever). Vincular uma
// delas a uma assinatura daqui é o que faz o cockpit e o MP falarem a mesma
// língua: o status do MP passa a ser espelhado, a cobrança do ciclo dá baixa na
// fatura sozinha e cancelar/pausar aqui vale lá.
function MpRecurringTab({ preapprovals, sync, subs, customerName, onLink, onSync }) {
  const [picked, setPicked] = useState({}); // preapprovalId -> subscriptionId escolhido
  const money = window.fmt.money;

  // Assinaturas que podem receber uma recorrência: deste SaaS, não canceladas e
  // ainda sem preapproval (uma recorrência por assinatura).
  const free = subs.filter((s) => s.status !== "canceled" && !s.mpPreapprovalId);
  const subLabel = (s) => `${customerName(s.customer)} · ${money(s.price || 0)}/${CYCLE_LABEL[s.cycle] || s.cycle}`;
  const cycleLabel = (p) => CYCLE_LABEL[p.cycle] || (p.frequency ? `a cada ${p.frequency} ${p.frequencyType || ""}`.trim() : "—");

  if (!preapprovals.length) {
    return (
      <EmptyState
        title="Nenhuma assinatura recorrente na conta do Mercado Pago"
        hint="Clique em “↻ sincronizar MP”. O cockpit lê as recorrências (preapproval) da conta — as criadas aqui e as criadas direto no painel do MP — pra você ligar cada uma ao cliente."
        action={<PrimaryButton onClick={onSync}>↻ sincronizar MP</PrimaryButton>}
      />
    );
  }

  const cols = "1.3fr 1.2fr 0.9fr 0.9fr 0.9fr 1.6fr";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
        vincular carimba a recorrência na assinatura: o status do MP passa a ser espelhado, a cobrança do ciclo dá baixa na fatura e cancelar/pausar aqui vale no MP
        {sync?.lastAt ? ` · último sync ${new Date(sync.lastAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
      </div>
      <Table
        cols={cols}
        head={["Pagador", "Cobrança", "Valor / ciclo", "Status no MP", "Próxima cobrança", "Cliente no cockpit"]}
      >
        {preapprovals.map((p) => {
          const st = MP_SUB_STATUS[p.status] || { label: p.status || "—", tone: "mut" };
          const linked = p.subscription ? subs.find((s) => s.id === p.subscription) : null;
          // Vinculada a uma assinatura de OUTRO produto: o doc some da lista do
          // SaaS ativo só quando tem saas — aqui o fallback evita "—" sem sentido.
          const linkedName = linked ? customerName(linked.customer) : (p.customer ? customerName(p.customer) : "");
          const diverge = linked && Math.abs(Number(linked.price) - Number(p.amount)) >= 0.01;
          // Sem escolha manual, o seletor já vem na sugestão do servidor (e-mail
          // do pagador = e-mail de um único cliente) — um clique resolve.
          const choice = picked[p.id] ?? (free.some((s) => s.id === p.suggestedSubscription) ? p.suggestedSubscription : "");
          return (
            <div key={p.id} style={rowStyle(cols)}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{p.payerEmail || "pagador não informado"}</span>
                <span className="mono dim" style={{ fontSize: 9.5 }}>{p.mpId}</span>
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="mono dim" style={{ fontSize: 11, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{p.reason || "—"}</span>
                {p.chargedQuantity > 0 && (
                  <span className="mono dim" style={{ fontSize: 9.5 }}>já cobrou {p.chargedQuantity}× · {money(p.chargedAmount || 0)}</span>
                )}
              </span>
              <span className="mono tnum" style={{ fontSize: 12 }}>
                {money(p.amount || 0)}
                <span className="dim" style={{ display: "block", fontSize: 10 }}>{cycleLabel(p)}</span>
              </span>
              <span>
                <span className={"chip " + (st.tone === "pos" ? "pos" : st.tone === "warn" ? "warn" : "")} style={{ height: 20 }}>{st.label}</span>
              </span>
              <span className="mono dim tnum" style={{ fontSize: 12 }}>
                {fmtDate(p.nextPaymentDate)}
                {p.lastChargedDate && <span style={{ display: "block", fontSize: 9.5 }}>última {fmtDate(p.lastChargedDate)}</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {p.subscription ? (
                  <>
                    <span style={{ fontWeight: 500 }}>{linkedName || p.subscription}</span>
                    {diverge && (
                      <span className="mono" title={`a assinatura do cockpit está em ${money(linked.price || 0)} e o MP cobra ${money(p.amount || 0)}`}
                        style={{ fontSize: 9.5, color: "var(--warn)" }}>valor difere</span>
                    )}
                    <button onClick={() => onLink(p, "")} style={chromeBtnStyleSmall} title="desfaz o vínculo (não mexe na recorrência do MP)">
                      <span style={{ fontSize: 11 }}>desvincular</span>
                    </button>
                  </>
                ) : !free.length ? (
                  <span className="mono dim" style={{ fontSize: 10.5 }}>nenhuma assinatura livre neste produto</span>
                ) : (
                  <>
                    <select
                      value={choice}
                      onChange={(e) => setPicked((m) => ({ ...m, [p.id]: e.target.value }))}
                      style={{ height: 26, maxWidth: 200, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}
                    >
                      <option value="">vincular a…</option>
                      {free.map((s) => <option key={s.id} value={s.id}>{subLabel(s)}</option>)}
                    </select>
                    {choice && (
                      <button onClick={() => onLink(p, choice)} style={{ ...chromeBtnStyleSmall, borderColor: "var(--accent-line)", color: "var(--accent)" }}>
                        <span style={{ fontSize: 11 }}>vincular</span>
                      </button>
                    )}
                    {p.suggestedBy === "email" && choice === p.suggestedSubscription && (
                      <span className="mono dim" title="sugerido pelo e-mail do pagador" style={{ fontSize: 9.5 }}>sugestão</span>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </Table>
    </div>
  );
}

// Modal de mudança de plano/preço/ciclo — o servidor decide: upgrade aplica já e
// fatura o pró-rata do resto do ciclo; downgrade/troca de ciclo agendam pro fim.
function ChangeModal({ sub, plans, customerName, onClose, onDone }) {
  useEsc(onClose);
  const [plan, setPlan] = useState(sub.plan || "");
  const [price, setPrice] = useState(String(sub.price ?? ""));
  const [cycle, setCycle] = useState(sub.cycle || "monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function pickPlan(id) {
    setPlan(id);
    const p = plans.find((x) => x.id === id);
    if (p) { setPrice(String(p.price ?? "")); setCycle(p.cycle || "monthly"); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.changeSubscription(sub.id, { plan: plan || null, price: Number(price) || 0, cycle });
      const msg = {
        no_op: "nada a mudar",
        upgrade_mid_cycle: res.prorata > 0 ? `upgrade aplicado · pró-rata de ${window.fmt.money(res.prorata)} faturado` : "upgrade aplicado (sem pró-rata)",
        downgrade_mid_cycle: `downgrade agendado pro fim do ciclo (${new Date(res.applyAt).toLocaleDateString("pt-BR")})`,
        cycle_change: `troca de ciclo agendada pro fim do ciclo (${new Date(res.applyAt).toLocaleDateString("pt-BR")})`,
      }[res.changeType] || "ok";
      onDone(msg);
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  }

  const input = { width: "100%", height: 30, padding: "0 8px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: "min(420px, calc(100vw - 24px))", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="kicker">Mudar plano</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{customerName}</div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>hoje: {window.fmt.money(sub.price || 0)}/{CYCLE_LABEL[sub.cycle] || sub.cycle} · upgrade fatura o pró-rata do resto do ciclo; downgrade/troca de ciclo valem no fim do ciclo</div>
        </div>
        {!!plans.length && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Plano</span>
            <select value={plan} onChange={(e) => pickPlan(e.target.value)} style={input}>
              <option value="">(avulso — só preço/ciclo)</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {window.fmt.money(p.price || 0)}/{CYCLE_LABEL[p.cycle] || p.cycle}</option>)}
            </select>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Preço por ciclo</span>
            <input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Ciclo</span>
            <select value={cycle} onChange={(e) => setCycle(e.target.value)} style={input}>
              <option value="monthly">Mensal</option>
              <option value="quarterly">Trimestral</option>
              <option value="semiannual">Semestral</option>
              <option value="annual">Anual</option>
            </select>
          </label>
        </div>
        {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy} style={{ flex: 1, padding: "9px 12px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Aplicando…" : "Aplicar mudança"}
          </button>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function Table({ cols, head, children }) {
  return (
    <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
      <div className="kicker" style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "10px 14px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
        {head.map((h, i) => <span key={i} style={i === head.length - 1 ? { textAlign: "right" } : undefined}>{h}</span>)}
      </div>
      {children}
    </div>
  );
}
const rowStyle = (cols) => ({ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 });

export { SubscriptionsScreen };
