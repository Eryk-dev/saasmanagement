import { LeadGrade } from "../components/lead-card.jsx";

import React from "react";
import { createPortal } from "react-dom";
import "./customers.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { Card, Pill, FilterTab } from "../components/viz.jsx";

import { Modal, Drawer } from "../components/overlay.jsx";
import { ManualPaidModal } from "../components/manual-paid-modal.jsx";
import { useConfirmLink } from "../components/confirm-link-modal.jsx";
import { EmptyState, PrimaryButton, MoreMenu } from "../atoms.jsx";
import { Icon } from "./tasks/icons.jsx";
import { milestonesFor, nextMilestone, tenureLabel, dueLabel } from "../lib/milestones.js";

import { SubscriptionsScreen, ChangeModal } from "./subscriptions.jsx";
import { EntityForm } from "../components/EntityForm.jsx";

import { useActiveSaas } from "../lib/workspace.js";
import { leadTier, waLink } from "../lib/ui.js";

import { displayName } from "../lib/users.js";

import { paymentLabel, paymentUpfront, paymentRecurring, paymentCustom, PAY_STATUS, consultPackageLabel, consultPackageOf, mpMethodLabel, accruedAmountOf, CYCLE_LABEL, closedPlanFromLabel, anyGatewayOn, defaultGateway, gatewayLabel } from "../lib/payments.js";
import { CustomerPlanPanel, CustomerContractForm, CustomerProducts } from "../components/customer-plan.jsx";

import { UpsellPanel } from "../components/UpsellPanel.jsx";
import { CustomerMeetingForm } from "../components/customer-meeting.jsx";
import { CustomerHistoryView } from "../components/customer-history.jsx";

import { isChurned, CHURN_REASONS, churnReasonLabel } from "../lib/churn.js";
import { fetchLeveradsOrgs } from "../lib/leverads.js";
import { fetchLeverIdOrgs, customerOrgId } from "../lib/leverid.js";
import { LeverIdBadge } from "../components/leverid-badge.jsx";
import { MilestoneStrip } from "../components/milestone-strip.jsx";
import { FreeAccountsTab, CustomerOrgLink } from "../components/leverads-accounts.jsx";

import { CustomerContacts, CustomerDeals, CustomerNow, CustomerStateChips } from "../components/customer-crm.jsx";
import { RecordTimeline } from "../components/record-timeline.jsx";
import { CsPortfolioTab } from "../components/cs-portfolio.jsx";
import { OPEN_CUSTOMER_KEY, onOpenRecord } from "../lib/open-record.js";

// Cinco colunas da referência, com rolagem interna quando os pisos não cabem.
export const TABLE_GRID = "minmax(244px,1.5fr) minmax(190px,1fr) minmax(130px,1.05fr) minmax(182px,.9fr) minmax(90px,.85fr)";
export const TABLE_GRID_GAP = 12;
export const TABLE_GRID_BUDGET = 884; // soma dos pisos e gaps (sem o padding externo)
// Clientes — a base ativa do produto em dois blocos: a tabela de clientes e,
// ao lado, "Próximas ações" (os vencimentos a cobrar do faturado e da
// assinatura recorrente, ordenados por urgência). Clicar num cliente abre um popup com o resumo dele
// e o histórico de ações de retenção (régua de marcos + funil de origem).
// A receita vem das assinaturas (customer.arr é derivado); a régua nasce em
// startedAt (carimbado na conversão automática do pipeline).
// Assinaturas/faturas/planos moram AQUI, numa aba — cliente e cobrança são a
// mesma conversa (a antiga tela "Assinaturas" virou a aba billing).

const { useState, useEffect, useMemo } = React;

const SUB_STATUS = {
  active: { label: "ativa", tone: "pos" },
  past_due: { label: "em atraso", tone: "neg" },
  paused: { label: "pausada", tone: "warn" },
  canceled: { label: "cancelada", tone: "mut" },
};

// Data pura vira meia-noite LOCAL (new Date("YYYY-MM-DD") seria UTC e voltaria
// um dia no Brasil); ISO completo passa direto.
const parseDay = (v) => {
  if (!v) return null;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00") : new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};
const fmtDay = (d) => (d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).replace(".", "") : "");

// Quantas linhas a fila de "Próximas ações" mostra fechada: com o faturado e a
// recorrente inteiros na lista (não só os vencidos), 2 escondia quase tudo
// atrás do "ver mais".
const ACOES_FECHADAS = 6;

// Botão das linhas de "Próximas ações" (concluir marco, cobrar, dar baixa).
const ACAO_BTN = { height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, border: "1px solid var(--line-1)", background: "var(--bg-2)", color: "var(--fg-2)", flexShrink: 0, display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap" };

function CustomersScreen({ initialTab }) {
  const { CUSTOMERS, LEADS } = window.SEED;
  const { version, openForm, refresh } = useData();
  const [product] = useActiveSaas();
  // Aba persiste entre navegações (rota #subscriptions força billing via prop).
  const [tab, setTabState] = useState(() => { if (initialTab) return initialTab; try { return localStorage.getItem("cockpit_customers_tab") || "base"; } catch { return "base"; } }); // base | indicacoes | billing
  const setTab = (t) => { setTabState(t); try { localStorage.setItem("cockpit_customers_tab", t); } catch { /* ignore */ } };
  const [subs, setSubs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [sel, setSel] = useState(null); // id do cliente aberto no popup
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");        // busca da tabela
  const [refSummary, setRefSummary] = useState(""); // resumo da fila de indicação (vira o sub do cabeçalho)
  const [showAllActions, setShowAllActions] = useState(false);
  // Conclusão de marco: otimista no objeto do SEED (a tela lê dele) + PATCH.
  const [tick, setTick] = useState(0);
  // Nome plantado na integração → lead de verdade, já com o cliente indicador
  // preenchido (é o que torna a indicação comissionável). O coletor sai da
  // sessão no servidor: quem registra leva o crédito.
  function newReferral(customer, seed = {}) {
    openForm("leads", {
      saas: customer.saas,
      referredByCustomer: customer.id,
      source: "Indicação",
      ...(seed.name ? { name: seed.name } : {}),
      ...(seed.phone ? { phone: seed.phone } : {}),
    });
  }
  function completeMilestone(customer, key) {
    const done = { ...(customer.milestonesDone || {}), [key]: new Date().toISOString() };
    customer.milestonesDone = done; // otimista: CUSTOMERS vem do SEED compartilhado
    setTick((n) => n + 1);
    api.update("customers", customer.id, { milestonesDone: done }).catch((error) => { window.toast?.(error.message || "Não foi possível salvar o marco.", "neg"); refresh(); });
  }
  // Baixa da cobrança direto da fila de ações (a MESMA ação do "marcar paga"
  // da ficha do cliente). Otimista na lista local; o SSE recarrega depois.
  // Dar baixa pede a PROVA (quando/como entrou) — o modal grava; sem prova o
  // servidor recusa (12/10/2026). Otimista na lista local; o SSE recarrega.
  const [payingId, setPayingId] = useState("");
  const [payingInv, setPayingInv] = useState(null);
  function payFromQueue(inv) {
    if (payingId) return;
    setPayingInv(inv);
  }
  async function paidFromQueue(inv) {
    setPayingInv(null);
    setInvoices((rows) => rows.map((i) => (i.id === inv.id ? { ...i, status: "paid", paidAt: new Date().toISOString() } : i)));
    window.toast && window.toast("cobrança baixada", "pos");
  }
  // Edição inline do popup (mesmo padrão otimista do concluir marco).
  function patchCustomer(customer, p) {
    Object.assign(customer, p);
    setTick((n) => n + 1);
    // Plano trocado: o servidor refaz o rótulo e o retrato do plano; a ficha
    // mostra o que voltou dele.
    const planEdit = ["planCode", "planCycle", "planCustom"].some((k) => k in p);
    api.update("customers", customer.id, p).then((saved) => {
      if (planEdit && saved) { Object.assign(customer, saved); setTick((n) => n + 1); }
    }).catch((error) => { window.toast?.(error.message || "Não foi possível salvar o cliente.", "neg"); refresh(); });
  }

  // Workspace de mentoria (UniqueKids): a base não é assinatura recorrente, é
  // pacote de consultas — a tabela troca as colunas de SaaS (plano/MRR/marco/
  // assinatura) pelas da jornada (pacote/valor/próxima consulta/consultas).
  const isKidsWorkspace = product?.id === "uniquekids";
  const [allConsultas, setAllConsultas] = useState([]);

  // Vínculo com o produto (coluna "Usuário LeverAds"): resolve o
  // customer.leveradsOrgId em nome · e-mail pela mesma lista de orgs do select
  // do cadastro (cache de sessão em lib/leverads.js). Sem credencial
  // LEVERADS_* a busca falha (424) e a coluna mostra o id cru.
  const isLeverads = product?.id === "leverads";
  // A aba Gratuitas só existe no LeverAds: trocar de produto nela volta pra base.
  useEffect(() => { if (!isLeverads && tab === "gratuitas") setTab("base"); }, [isLeverads, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [leverOrgs, setLeverOrgs] = useState(null); // Map(orgId → org) | null (não carregou)
  const leverOrgOf = (c) => (c.leveradsOrgId ? leverOrgs?.get(String(c.leveradsOrgId)) || null : null);
  useEffect(() => {
    if (!isLeverads) { setLeverOrgs(null); return; }
    let alive = true;
    fetchLeveradsOrgs()
      .then((rows) => alive && setLeverOrgs(new Map(rows.map((o) => [String(o.id), o]))))
      .catch(() => {});
    return () => { alive = false; };
  }, [isLeverads]);

  const [reads, setReads] = useState({key:null,loaded:false,error:null});
  const [readAttempt, setReadAttempt] = useState(0);
  useEffect(() => { setSel(null); }, [product?.id]);
  // Atalho de fora (cartão do cliente nos Tickets): abre a ficha pedida. Roda
  // depois do reset acima no mesmo commit, então prevalece.
  useEffect(() => {
    let id = null;
    try { id = sessionStorage.getItem(OPEN_CUSTOMER_KEY); sessionStorage.removeItem(OPEN_CUSTOMER_KEY); } catch { /* ignore */ }
    if (id) { setTab("base"); setSel(id); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Pedido de abrir vindo de outro card (Negócio, Integração) com a tela já
  // aberta: o sessionStorage acima só é lido na montagem.
  useEffect(() => onOpenRecord(({ kind, id }) => {
    if (kind !== "customer") return;
    try { sessionStorage.removeItem(OPEN_CUSTOMER_KEY); } catch { /* ignore */ }
    setTab("base");
    setSel(id);
  }), []);
  useEffect(() => {
    if (!product?.id) return;
    let alive = true;
    const id=product.id, query={saas:id};
    setReads(previous=>previous.key===id ? {...previous,error:null} : {key:id,loaded:false,error:null});
    Promise.all([api.list("subscriptions",query),api.list("plans",query),api.list("invoices",query),api.billingReceived(id)])
      .then(([ss,pp,ii,rr])=>{if(!alive)return;setSubs((ss||[]).filter(row=>row.saas===id));setPlans((pp||[]).filter(row=>row.saas===id));setInvoices((ii||[]).filter(row=>row.saas===id));setReceived(rr||{});setReads({key:id,loaded:true,error:null});})
      .catch(error=>{if(alive)setReads({key:id,loaded:false,error});});
    return ()=>{alive=false;};
  }, [product?.id,version,readAttempt]);

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

  // Badge de LeverId: quem do cliente já tem conta na identidade central. Uma
  // busca para todas as orgs da lista (a API guarda 60 s); sem LeverId
  // configurado ou fora do ar, a badge só não aparece.
  const leverIdKey = useMemo(() => [...new Set(customers.map(customerOrgId).filter(Boolean))].sort().join(","), [customers]);
  const [leverIdOrgs, setLeverIdOrgs] = useState({});
  const leverIdOf = (c) => leverIdOrgs[customerOrgId(c)] || null;
  useEffect(() => {
    if (!leverIdKey) { setLeverIdOrgs({}); return; }
    let alive = true;
    fetchLeverIdOrgs(leverIdKey.split(","), api.leveridOrgs)
      .then((res) => alive && setLeverIdOrgs(res.orgs || {}))
      .catch(() => {});
    return () => { alive = false; };
  }, [leverIdKey]);

  const selected = customers.find((c) => c.id === sel) || null;
  const subsOf = (c) => subs.filter((s) => s.customer === c.id);
  const mainSub = (c) => subsOf(c).find((s) => s.status === "active" || s.status === "past_due") || subsOf(c)[0] || null;
  // sub.plan é FK pra `plans` — resolve o nome (nunca mostrar o id cru na UI).
  const planLabel = (s) => plans.find((p) => p.id === s.plan)?.name || CYCLE_LABEL[s.cycle] || s.cycle || "plano";
  // Plano CONTRATADO do cliente: o cadastro (customer.plan) manda; a assinatura
  // só entra como fallback. O ciclo da assinatura é cadência de COBRANÇA, não o
  // contrato — boleto faturado vira ciclo mensal por design, e mostrar "mensal"
  // pra um contrato semestral faturado estava errado.
  // Cliente com mais de um produto: o rótulo é o da assinatura principal, com
  // a contagem dos demais ("Ads Escala · Anual +1").
  const contractPlan = (c) => (c.plan || (mainSub(c) ? planLabel(mainSub(c)) : "")) + ((c.products || []).length > 1 ? ` +${c.products.length - 1}` : "");
  // Cliente com endedAt no passado deu churn (régua única em lib/churn.js —
  // marcado pelo botão da ficha ou pelo cancelamento da recorrência no MP):
  // fica fora do MRR, da contagem de ativos e da régua de marcos, mas segue
  // na tabela (esmaecido, com o filtro Todos/Ativos/Churn) e na Análise.
  const activeCustomers = customers.filter((c) => !isChurned(c));
  const totalMrr = activeCustomers.reduce((a, c) => a + (c.arr || 0), 0) / 12;
  // CONTA GRANDE (customer.keyAccount): cliente fora da régua (Galante, CRGroup).
  // Ele tem ficha própria aqui em cima e segue na tabela com o ★ — some da
  // tabela seria pior, porque ninguém acha o cliente depois. O que ele NÃO faz
  // é entrar nas médias: o MRR do núcleo aparece ao lado do cheio, porque um
  // contrato único de R$ 300 mil não é receita recorrente de R$ 25 mil/mês.
  const isKeyAccount = (c) => !!c.keyAccount;
  const keyAccounts = activeCustomers.filter(isKeyAccount);
  const coreMrr = activeCustomers.filter((c) => !isKeyAccount(c)).reduce((a, c) => a + (c.arr || 0), 0) / 12;
  const totalContratado = activeCustomers.reduce((a, c) => a + (c.arr || 0), 0);
  const money = window.fmt.money;

  // Coluna Pagamento (o meio com que fechou) e a base do contrato: `fechadoOf` é
  // o VALOR FECHADO (lead.amount do fechamento, fallback no arr do cliente) —
  // é ele que o Status pgto. usa como denominador e o card de conta grande
  // mostra. O que a tabela EXIBE na coluna do dinheiro é o `trazidoOf` (mais
  // abaixo): o que o cliente de fato trouxe.
  const leadById = React.useMemo(() => new Map((LEADS || []).map((l) => [l.id, l])), [LEADS]);
  // Assinatura recorrente (plano mensal) ACUMULA: cada 30 dias desde o
  // fechamento soma outra mensalidade no total — churn (endedAt) para o
  // relógio. É a mesma régua do status de pagamento, então a 2ª mensalidade
  // não paga aparece como Parcial sozinha.
  const fechadoOf = (c) => accruedAmountOf(leadById.get(c.leadId), { endAt: c.endedAt }) || Number(c.arr) || 0;

  // Meio de pagamento do cliente (cadastro manda, o lead é o fallback) e a
  // régua do DINHEIRO: quem recebe ao longo do contrato (boleto faturado, PIX
  // parcelado, assinatura recorrente) contra quem recebeu tudo no fechamento
  // (à vista, cartão 12x, que a adquirente antecipa).
  const pagamentoDe = (c) => c.paymentMethod || leadById.get(c.leadId)?.paymentMethod || "";
  const recebeParcelado = (c) => !paymentUpfront(pagamentoDe(c));

  // PRÓXIMA COBRANÇA do cliente (o subtítulo da coluna Pagamento, Leo 12/09):
  // quem recebe ao longo do contrato (boleto faturado, PIX parcelado,
  // assinatura recorrente, condição personalizada) é cobrado outra vez mês a
  // mês, e a data da próxima só aparecia abrindo a ficha. Mesma régua da fila
  // "Próximas ações" mais abaixo: a fatura EM ABERTO mais antiga e, quando não
  // há nenhuma, a virada do ciclo da assinatura — que é o que o motor de
  // billing vai faturar (na recorrente, a fatura só nasce quando o ciclo vira).
  const proxCobrancaPorCliente = useMemo(() => {
    const by = new Map();
    for (const i of invoices) {
      if (!i.customer || (i.status !== "open" && i.status !== "overdue")) continue;
      const due = parseDay(i.dueDate);
      if (!due) continue;
      const atual = by.get(i.customer);
      if (!atual || due < atual.due) by.set(i.customer, { due, invoice: i });
    }
    for (const c of customers) {
      if (by.has(c.id)) continue;
      const s = mainSub(c);
      if (!s || !(s.status === "active" || s.status === "past_due")) continue;
      const due = parseDay(s.periodEnd);
      if (due) by.set(c.id, { due, sub: s });
    }
    return by;
  }, [invoices, customers, subs, version]);
  // Quem pagou à vista (cartão 12x, PIX/boleto à vista) não tem próxima
  // cobrança: o contrato inteiro entrou no fechamento. Churnado também não.
  const proxCobrancaDe = (c) => {
    if (isChurned(c) || !recebeParcelado(c)) return null;
    const x = proxCobrancaPorCliente.get(c.id);
    if (!x) return null;
    const i = x.invoice;
    const oque = !i
      ? (paymentRecurring(pagamentoDe(c)) ? "mensalidade da assinatura" : "renovação do contrato")
      : i.kind === "installment" ? `parcela ${i.installmentN || 1}/${i.installmentOf || 1}`
      : i.kind === "upsell" ? "upsell"
      : (i.title || "fatura em aberto");
    return { ...x, oque, late: x.due.getTime() < Date.now() };
  };

  // Dinheiro REAL recebido por cliente ({ id: total }): MP aprovado casado com
  // o cliente/lead + baixas de fatura de verdade (o endpoint exclui a fatura
  // que nasce paga no fechamento por convenção).
  const [received, setReceived] = useState({});


  // Quanto esse cliente TROUXE de verdade (coluna "Total recebido", Leo 29/08).
  // À vista e cartão 12x: o contrato inteiro, porque o dinheiro entrou no
  // fechamento (a adquirente antecipa). Faturado, parcelado e recorrente: só o
  // que ENTROU — parcela baixada e pagamento do MP casado com o cliente —, em
  // vez do contrato cheio de um ano que ainda vai ser cobrado mês a mês. É a
  // mesma régua da receita reconhecida do placar e da meta.
  //
  // O `received` de propósito NÃO conta a fatura que nasce paga no fechamento:
  // no faturado ela nem existe (o recebimento é o cronograma) e na recorrente
  // ela é só o carimbo do contrato, não uma cobrança que rodou.
  //
  // UPSELL (Leo, 09/09): a venda extra registrada na ficha entra no que o
  // cliente trouxe. Faturado/recorrente já vem no `received` (a fatura de
  // upsell baixada é recebimento real); à vista soma o upsell PAGO por cima do
  // contrato. O Status pgto. compara com contrato + upsell contratado.
  const upsellByCustomer = React.useMemo(() => {
    const by = new Map();
    for (const i of invoices) {
      if (i.kind !== "upsell") continue;
      const cur = by.get(i.customer) || { paid: 0, total: 0, n: 0 };
      const amt = Number(i.amount) || 0;
      cur.total = Math.round((cur.total + amt) * 100) / 100;
      if (i.status === "paid") cur.paid = Math.round((cur.paid + amt) * 100) / 100;
      cur.n += 1;
      by.set(i.customer, cur);
    }
    return by;
  }, [invoices]);
  const upsellOf = (c) => upsellByCustomer.get(c.id) || { paid: 0, total: 0, n: 0 };
  const trazidoOf = (c) => (recebeParcelado(c) ? Number(received[c.id]) || 0 : fechadoOf(c) + upsellOf(c).paid);

  // Estado do pagamento (coluna Status pgto.): a marcação MANUAL no cliente
  // manda (paymentStatus — muita venda entra por PIX/cartão fora do rastreio do
  // MP, só o time sabe o que caiu na conta). Sem marcação, decide o FATO: o
  // recebido real contra o valor fechado, com 2% de folga (link do MP sai com
  // centavos de diferença — Zpack 6.488 de 6.500). Sem registro nenhum, o meio
  // de pagamento dá o padrão: faturado/recorrente/parcelado é Parcial por
  // natureza; à vista/cartão 12x fica Não pago até alguém confirmar — fechar no
  // cartão NÃO é receber (caso Marianna, 13/08).
  const payStatus = (c) => {
    const cash = Number(received[c.id]) || 0;
    const total = fechadoOf(c) + upsellOf(c).total; // contrato + upsells registrados
    const pm = c.paymentMethod || leadById.get(c.leadId)?.paymentMethod;
    const auto = total > 0 && cash >= total * 0.98 ? "paid" : cash > 0 ? "partial" : paymentUpfront(pm) ? "unpaid" : "partial";
    const manual = PAY_STATUS[c.paymentStatus] ? c.paymentStatus : "";
    const key = manual || auto;
    return {
      ...PAY_STATUS[key], key, auto, manual: !!manual,
      hint: manual
        ? "marcado na mão — clique pra mudar"
        : cash > 0
          ? `${money(cash)} recebido de ${money(total)} (MP + baixas de fatura) — clique pra marcar na mão`
          : "nenhum pagamento registrado — clique pra marcar",
    };
  };

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

  // Data de entrada (startedAt = "Cliente desde").
  const entradaDate = (c) => parseDay(c.startedAt);
  const entradaLabel = (c) => fmtDay(entradaDate(c));

  // Vencimento da assinatura (coluna): fim do ciclo atual (periodEnd) da
  // assinatura principal — a mesma data do "Ciclo atual até" da aba
  // Assinaturas. Pausada/cancelada não tem ciclo correndo → sem vencimento.
  const vencDate = (c) => {
    const s = mainSub(c);
    if (!s || !(s.status === "active" || s.status === "past_due")) return null;
    return parseDay(s.periodEnd);
  };

  // Ordenação por clique no cabeçalho (alterna ↑/↓). Sem clique, mantém o
  // padrão histórico (maior contrato primeiro). Vazio sempre no fim.
  const [sort, setSort] = useState(null); // { key, dir: 1|-1 }
  const GRADE_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };
  const SORT_VALS = {
    cliente: (c) => String(c.name || "").toLowerCase() || null,
    nivel: (c) => { const g = gradeOf(c).grade; return g in GRADE_RANK ? GRADE_RANK[g] : null; },
    plano: (c) => String(isMentoria(c) ? consultPackageLabel(journeyOf(c).total) : contractPlan(c)).toLowerCase() || null,
    mrr: (c) => (c.arr || 0),
    pagamento: (c) => { const pm = c.paymentMethod || leadById.get(c.leadId)?.paymentMethod; return pm ? paymentLabel(pm, c.paymentTerms || leadById.get(c.leadId)?.paymentTerms).toLowerCase() : null; },
    recebido: (c) => trazidoOf(c) || null,
    pgto: (c) => payStatus(c).rank,
    entrada: (c) => entradaDate(c)?.getTime() ?? null,
    casa: (c) => { const d = entradaDate(c); return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null; },
    contato: (c) => {
      const at = (LEADS || []).find((l) => l.id === c.leadId)?.lastActivityAt || c.lastContactAt;
      return at ? Math.floor((Date.now() - new Date(at).getTime()) / 86400000) : null;
    },
    venc: (c) => vencDate(c)?.getTime() ?? null,
    lever: (c) => {
      if (!c.leveradsOrgId) return null;
      const o = leverOrgOf(c);
      return String(o?.email || o?.name || c.leveradsOrgId).toLowerCase();
    },
  };
  const sortedCustomers = useMemo(() => {
    const val = sort && SORT_VALS[sort.key];
    if (!val) return customers;
    return [...customers].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.dir * (typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb);
    });
  }, [customers, sort, subs, plans, received, LEADS, allConsultas, leverOrgs, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Filtro Todos/Ativos/Churn da tabela — só aparece quando existe churn na
  // base (sem churn a tela fica idêntica). Padrão "Todos": o churnado continua
  // visível (esmaecido), ninguém some da lista.
  const [baseFilter, setBaseFilter] = useState("active"); // all | active | churned | noowner
  const churnedCount = customers.length - activeCustomers.length;
  // Cliente ativo sem dono da conta: ninguém responde pelo pós-venda dele (o
  // placar de CS e a régua de marcos dependem do owner). Mentoria não tem CS.
  const noOwnerCount = isKidsWorkspace ? 0 : activeCustomers.filter((c) => !c.owner).length;
  // BUSCA (o único estado novo do redesign): nome, contato e e-mail, sem acento
  // e sem caixa. Entra ANTES do filtro Ativos/Churn, então "mostrando N de M"
  // reflete os dois. useMemo porque a base cresce e o render é por linha.
  const fold = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchedCustomers = useMemo(() => {
    const needle = fold(q).trim();
    if (!needle) return sortedCustomers;
    return sortedCustomers.filter((c) => {
      const lead = (LEADS || []).find((l) => l.id === c.leadId);
      return [c.name, c.contact, c.email, c.leveradsOrgName, lead?.name, lead?.email, lead?.company].some((v) => fold(v).includes(needle));
    });
  }, [sortedCustomers, q, LEADS]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredCustomers = baseFilter === "active"
    ? searchedCustomers.filter((c) => !isChurned(c))
    : baseFilter === "churned"
      ? searchedCustomers.filter((c) => isChurned(c))
      : baseFilter === "noowner"
        ? searchedCustomers.filter((c) => !isChurned(c) && !c.owner)
        : searchedCustomers;
  const shownCustomers = showAll ? filteredCustomers : filteredCustomers.slice(0, 50);
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

  // Bloco "Próximas ações": a fila de COBRANÇA — o vencimento a cobrar de cada
  // cliente, vencidos primeiro. A régua de retenção (onboarding, check-in,
  // upsell, renovação) saiu daqui em 29/08 a pedido do Leo: ela continua
  // inteira na ficha do cliente, no bloco "Ações de retenção", e volta pra cá
  // quando ele retomar o pós-venda. Cliente da mentoria (UniqueKids) fica FORA:
  // o pós-venda dele é a jornada de consultas, na tela Consultas e na Agenda.
  const isMentoria = (c) => c.saas === "uniquekids";
  const ACTION_ORDER = { late: 0, soon: 1, next: 2 };
  // COBRANÇA (Leo, 29/08): boleto faturado e assinatura recorrente recebem ao
  // longo do contrato, então cada vencimento é um toque de cobrança — e sem
  // isso o vencimento só aparecia se alguém abrisse a ficha do cliente.
  //
  // Uma linha por cliente, sempre a PRÓXIMA cobrança dele (as outras 11
  // parcelas não viram 11 linhas):
  //   1. a fatura EM ABERTO mais antiga; e, quando não há nenhuma,
  //   2. a RENOVAÇÃO da assinatura (periodEnd) — é o que a coluna Vencimento
  //      mostra e o que o motor de billing vai faturar. É por aqui que a
  //      assinatura recorrente no cartão aparece: a fatura dela só nasce
  //      quando o ciclo vira.
  //
  // Quem RECEBE AO LONGO do contrato aparece SEMPRE, mesmo a vencer (o Leo quer
  // saber quando vem a próxima e se ela caiu): faturado, PIX parcelado,
  // assinatura recorrente e qualquer contrato de ciclo MENSAL (um PIX mensal
  // também é cobrança todo mês, mesmo o meio sendo "à vista"). O contrato anual
  // ou semestral pago de uma vez só entra quando venceu ou vence em até 7 dias:
  // a renovação dele não é rotina de cobrança, e a fatura do fechamento já
  // nasce paga.
  const COBRANCA_SOON_DAYS = 7;
  // Mais larga que a régua do DINHEIRO (recebeParcelado): pra COBRAR, um PIX de
  // ciclo mensal também vence todo mês, mesmo o meio sendo "à vista".
  const recebeAoLongo = (c) => recebeParcelado(c) || mainSub(c)?.cycle === "monthly";
  // O que é essa cobrança, na língua do time: a parcela do faturado já vem com
  // título pronto ("Parcela 2/12 · boleto faturado"); a mensalidade da
  // assinatura e a renovação do contrato ganham o rótulo do meio de pagamento.
  const cobrancaDesc = (i, c) => {
    const minuscula = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : "");
    if (i.title) return minuscula(i.title); // parcela do cronograma e cobrança avulsa já vêm nomeadas
    if (i.kind === "installment") return `parcela ${i.installmentN || 1}/${i.installmentOf || 1}`;
    if (i.kind === "upsell") return "upsell";
    const pm = pagamentoDe(c);
    if (paymentRecurring(pm)) return "mensalidade da assinatura recorrente";
    return pm ? `renovação · ${paymentLabel(pm).toLowerCase()}` : "renovação do contrato";
  };
  // Linha que ainda NÃO tem fatura: a próxima virada do ciclo. O texto diz que
  // a cobrança está por vir, pra não parecer que tem boleto esperando baixa.
  const proximaDesc = (c) => {
    const pm = pagamentoDe(c);
    if (paymentRecurring(pm)) return "próxima mensalidade · assinatura recorrente";
    return pm ? `próxima cobrança · ${paymentLabel(pm).toLowerCase()}` : "próxima cobrança do contrato";
  };
  const cobrancas = useMemo(() => {
    const now = Date.now();
    const porCliente = new Map();
    for (const i of invoices) {
      if (i.status !== "open" && i.status !== "overdue") continue;
      const due = parseDay(i.dueDate);
      if (!due) continue;
      const c = customers.find((x) => x.id === i.customer);
      if (!c || isChurned(c) || isMentoria(c)) continue;
      const atual = porCliente.get(c.id);
      if (!atual || due < atual.due) porCliente.set(c.id, { customer: c, invoice: i, due });
    }
    for (const c of customers) {
      if (isChurned(c) || isMentoria(c) || porCliente.has(c.id)) continue;
      const sub = mainSub(c);
      if (!sub || !(sub.status === "active" || sub.status === "past_due")) continue;
      const due = parseDay(sub.periodEnd);
      if (!due) continue;
      porCliente.set(c.id, { customer: c, sub, due });
    }
    return [...porCliente.values()]
      .map((x) => {
        const dias = (x.due.getTime() - now) / 86400000;
        return { ...x, kind: "cobranca", dueAt: x.due.toISOString(), status: dias <= 0 ? "late" : dias <= COBRANCA_SOON_DAYS ? "soon" : "next" };
      })
      .filter((x) => x.status !== "next" || recebeAoLongo(x.customer));
  }, [invoices, customers, subs, tick, version]);
  // Dinheiro parado: TODAS as faturas vencidas (a fila mostra só a próxima de
  // cada cliente, mas o que está preso é a soma de todas).
  const vencido = useMemo(() => {
    const hoje = Date.now();
    const rows = invoices.filter((i) => {
      if (i.status !== "open" && i.status !== "overdue") return false;
      const due = parseDay(i.dueDate);
      if (!due || due.getTime() > hoje) return false;
      const c = customers.find((x) => x.id === i.customer);
      return !!c && !isChurned(c) && !isMentoria(c);
    });
    // A mais antiga é a que o aviso do topo baixa: sem ela o aviso seria um
    // número sem ação, que é a regra 2 do handoff invertida.
    const maisAntiga = [...rows].sort((a, b) => (parseDay(a.dueDate)?.getTime() || 0) - (parseDay(b.dueDate)?.getTime() || 0))[0] || null;
    return { n: rows.length, total: rows.reduce((a, i) => a + (Number(i.amount) || 0), 0), maisAntiga };
  }, [invoices, customers, tick, version]);
  // A fila é SÓ COBRANÇA (Leo, 29/08): a régua de retenção (onboarding,
  // check-in, upsell, renovação) saiu daqui e continua viva na ficha do
  // cliente, no bloco "Ações de retenção" — é lá que o Leo vai retomar ela
  // quando a operação estiver madura pra isso. Ordem: vencidas primeiro,
  // depois por data.
  const nextActions = useMemo(
    () => [...cobrancas].sort((a, b) => (ACTION_ORDER[a.status] - ACTION_ORDER[b.status]) || (new Date(a.dueAt) - new Date(b.dueAt))),
    [cobrancas],
  );

  if (!product) return <EmptyState title="Nenhum produto cadastrado" hint="Crie o produto em Ajustes." />;

  return (
    <div className="customers-page">
      {payingInv && createPortal(<ManualPaidModal target={{ kind: "invoice", id: payingInv.id, amount: payingInv.amount, title: payingInv.title || (payingInv.kind === "installment" ? `parcela ${payingInv.installmentN || 1}/${payingInv.installmentOf || 1}` : "fatura"), targetName: (customers.find((c) => c.id === payingInv.customer) || {}).name }}
        onClose={() => setPayingInv(null)} onDone={() => paidFromQueue(payingInv)} />, document.body)}
      <header className="customers-header">
        <h1 className="page-title">Clientes</h1>
        <div className="customers-header-actions">
          <div className="customers-tabs" aria-label="Visualização">{[["base","Clientes"],["carteira","Carteira CS"],...(isLeverads?[["gratuitas","Gratuitas"]]:[]),["indicacoes","Indicações"],["cases","Cases"],["billing","Cobranças"]].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
          <button className="customers-create" onClick={()=>openForm("customers",{saas:product.id})}>Cadastrar cliente</button>
        </div>
      </header>

      {tab === "billing" && <SubscriptionsScreen key={product.id} compact saasId={product.id} />}

      {tab === "cases" && <CasesTab key={product.id} product={product} customers={customers} />}
      {tab === "carteira" && <CsPortfolioTab customers={customers} onOpen={(id) => { setTab("base"); setSel(id); }} />}

      {tab === "gratuitas" && isLeverads && (
        <FreeAccountsTab key={product.id} customers={customers} leads={LEADS} onOpenCustomer={(id) => { setTab("base"); setSel(id); }} />
      )}

      {tab === "indicacoes" && (
        <ReferralsTab key={product.id} saasId={product.id} onRegister={newReferral} customers={CUSTOMERS}
          onSummary={setRefSummary} onOpenCustomer={setSel} />
      )}

      {tab === "base" && (
      <div className="customers-base">
        {reads.key!==product.id || (!reads.loaded&&!reads.error) ? <div className="customers-load" role="status">Carregando clientes…</div> : reads.error ? <div className="customers-load" role="alert">Não foi possível carregar as cobranças e os recebimentos. <button onClick={()=>setReadAttempt(n=>n+1)}>Tentar novamente</button></div> : <>
        <div className="customers-summary">
            {/* ── O AVISO SOBE PRO TOPO (14/09, protótipo) ──────────────────
                "Cobrar agora" era um card no TRILHO, competindo com a fila de
                cobrança logo abaixo dele e sem ação nenhuma: o número que
                decide o dia de quem cobra ficava na terceira posição da
                terceira coluna. Agora abre a aba, com a baixa da mais antiga
                ao lado, que é a regra 2 do handoff. */}
            {vencido.n > 0 && <section className="customers-overdue capsule-navy">
              <div><h2><i/>a receber</h2><div className="customers-overdue-amount"><strong>{window.fmt.moneyFull(vencido.total)}</strong><span>vencidos a receber</span></div>
                <p>{vencido.n} {vencido.n===1?"cobrança vencida":"cobranças vencidas"}{nextActions.some(a=>a.status==="soon")?` · ${nextActions.filter(a=>a.status==="soon").length} vencem em 7 dias`:""}</p>
              </div>
              <button disabled={!!payingId} onClick={()=>payFromQueue(vencido.maisAntiga)}>{payingId===vencido.maisAntiga.id?"Dando baixa…":`Dar baixa na mais antiga · ${window.fmt.moneyFull(vencido.maisAntiga.amount)}`}</button>
            </section>}
            {/* ── A faixa de quatro números (prancha, 14/09) ────────────────
                Resumo operacional da base: ativos, MRR, quem ainda não
                terminou a integração e churn. */}
            <div className="customers-kpis">
              {(() => {
                const emIntegracao = activeCustomers.filter((c) => {
                  const nm = isKidsWorkspace ? null : nextMilestone(withCycle(c), product);
                  return !!nm;
                }).length;
                const churnRecente = customers
                  .filter((c) => isChurned(c) && c.endedAt)
                  .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))[0];
                const diasChurn = churnRecente ? Math.max(0, Math.round((Date.now() - new Date(churnRecente.endedAt)) / 86400000)) : null;
                return [
                  { rot: "clientes ativos", val: String(activeCustomers.length), nota: "base do produto" },
                  { rot: "MRR", val: window.fmt.moneyFull(totalMrr), nota: keyAccounts.length ? `${window.fmt.moneyFull(coreMrr)} sem ${keyAccounts.length === 1 ? "a conta grande" : "as contas grandes"}` : "receita recorrente da base" },
                  { rot: "em integração", val: String(emIntegracao), tom: emIntegracao > 0 ? "var(--warn)" : null, nota: "ainda não terminaram a régua" },
                  { rot: "churn", val: String(churnedCount), tom: churnedCount > 0 ? "var(--neg)" : null, nota: diasChurn == null ? "nenhum encerramento" : `o mais recente há ${diasChurn} d` },
                ];
              })().map((k) => (
                <div key={k.rot} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{k.rot}</div>
                  <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, marginTop: 3, color: k.tom || "var(--fg-1)" }}>{k.val}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 2 }}>{k.nota}</div>
                </div>
              ))}
            </div>

        </div>
        {customers.length === 0 ? (
          <EmptyState
            title="Nenhum cliente ainda"
            hint="Cadastre um cliente ou conclua a venda no Pipeline."
            action={<PrimaryButton onClick={() => openForm("customers", { saas: product.id })}>+ Cadastrar cliente</PrimaryButton>}
          />
        ) : (
          <div className="customers-columns">
            <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            {/* Cinco colunas; dados financeiros e réguas continuam nos helpers existentes. */}
            <section className="customers-table-card">
              {/* Pílulas à ESQUERDA e busca à direita, como a prancha: o
                  filtro é o que se usa primeiro, a busca é o escape. */}
              <div className="customers-filters">
                <div className="customers-segment">{[["active","Ativos",activeCustomers.length],["all","Todos",customers.length],["churned","Churn",churnedCount],["noowner","Sem dono",noOwnerCount]].map(([id,label,n])=><button key={id} aria-pressed={baseFilter===id} onClick={()=>setBaseFilter(id)}>{label} <span>{n}</span></button>)}</div>
                <label className="customers-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20.4 20.4-4.2-4.2"/></svg><input aria-label="Buscar cliente" value={q} onChange={e=>setQ(e.target.value)} placeholder="buscar cliente…"/></label>
              </div>
              <div className="tbl-x customers-table-scroll">
                <div style={{ minWidth: 920 }}>
                  {(() => {
                    const GRID = TABLE_GRID;
                    const HEADS = isKidsWorkspace
                      ? [["Cliente", "cliente"], ["Pacote e valor", "mrr"], ["Dinheiro", "recebido"], ["Jornada", null], ["Situação", "venc"]]
                      : [["Cliente", "cliente"], ["Plano e MRR", "mrr"], ["Dinheiro", "recebido"], ["Marcos", null], ["Situação", "venc"]];
                    const th = (h, k, i) => (
                      <button key={h} className="kicker" disabled={!k} title={k ? "ordenar" : undefined}
                        onClick={k ? () => setSort((so) => (so?.key === k ? { key: k, dir: -so.dir } : { key: k, dir: 1 })) : undefined}
                        style={{ fontWeight: 600, color: sort?.key === k ? "var(--fg-2)" : "var(--fg-4)", cursor: k ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {h}{sort?.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                      </button>
                    );
                    return (
                      <>
                        <div className="customers-table-head" style={{ display: "grid", gridTemplateColumns: GRID, gap: TABLE_GRID_GAP, padding: "11px 16px", borderBottom: "1px solid var(--line-1)" }}>
                          {HEADS.map(([h, k], i) => th(h, k, i))}
                        </div>
                        {shownCustomers.map((c) => {
                          const sub = mainSub(c);
                          const st = sub ? SUB_STATUS[sub.status] || { label: sub.status, tone: "mut" } : null;
                          const kids = isMentoria(c);
                          const nm = kids ? null : nextMilestone(withCycle(c), product);
                          const j = kids ? journeyOf(c) : null;
                          const t = gradeOf(c);
                          const contato = String(c.contact || leadById.get(c.leadId)?.name || "").trim();
                          const mesmoNome = contato && contato.toLowerCase() === String(c.name || "").trim().toLowerCase();
                          const email = String(c.email || leadById.get(c.leadId)?.email || "").trim();
                          const casa = tenureLabel(c) || (entradaLabel(c) ? "" : "sem início");
                          const ps = payStatus(c);
                          const prox = proxCobrancaDe(c);
                          const trazido = trazidoOf(c);
                          const contrato = fechadoOf(c) + upsellOf(c).total;
                          const pago = contrato > 0 ? Math.min(100, (trazido / contrato) * 100) : 0;
                          return (
                            <div key={c.id} className="customers-table-row" role="button" tabIndex={0} aria-label={`Abrir cliente: ${c.name}`} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSel(c.id);}}} onClick={() => setSel(c.id)}
                              style={{ display: "grid", gridTemplateColumns: GRID, gap: TABLE_GRID_GAP, padding: "12px 16px", alignItems: "center", borderBottom: "1px solid var(--line-1)", cursor: "pointer", opacity: isChurned(c) ? 0.55 : 1 }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                              {/* Cliente: conta grande, nível, nome com o tempo de casa em etiqueta
                                  e a sub-linha com contato e e-mail */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                {isKeyAccount(c) && <span title="conta grande · fora das médias" style={{ color: "var(--accent)", flexShrink: 0 }}>★</span>}
                                {!isKidsWorkspace && (t.grade
                                  ? <LeadGrade tier={t} size={20} />
                                  : <span title="sem nível (lead não respondeu contas/anúncios)" style={{ width: 20, height: 20, borderRadius: 999, border: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>—</span>)}
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                    <div style={{ minWidth: 0, fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                                    <LeverIdBadge org={leverIdOf(c)} orgId={customerOrgId(c)} />
                                    {casa && <Pill title={entradaLabel(c) ? `cliente desde ${entradaLabel(c)}` : undefined}>{casa}</Pill>}
                                  </div>
                                  <div style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                    title={[contato, email, entradaLabel(c) ? `cliente desde ${entradaLabel(c)}` : "", lastContact(c) ? `último contato ${lastContact(c)}` : ""].filter(Boolean).join(" · ")}>
                                    {[mesmoNome ? "" : contato, email].filter(Boolean).join(" · ") || "—"}
                                  </div>
                                </div>
                              </div>
              {/* PLANO E MRR numa célula só (prancha): o plano é o rótulo e o
                  valor mensal é a leitura de baixo. Eram duas colunas pra uma
                  informação só. */}
                              <div style={{ minWidth: 0 }} title={kids ? consultPackageLabel(j.total) : contractPlan(c) || "sem plano"}>
                                <div style={{ fontSize: 13, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: contractPlan(c) || kids ? "var(--fg-1)" : "var(--fg-4)" }}>
                                  {kids ? consultPackageLabel(j.total) : contractPlan(c) || "sem plano"}
                                </div>
                                <div className="tnum" style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap" }}>
                                  {kids ? window.fmt.moneyFull(c.arr || 0) : `${window.fmt.moneyFull((c.arr || 0) / 12)} /mês`}
                                </div>
                              </div>
                              {/* Dinheiro: quanto entrou de quanto, a barra e o status (com o select de marcação manual por cima do rótulo) */}
                              <div className="customers-money" style={{ minWidth: 0 }}>
                                <div className="tnum" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                                  <b style={{ color: trazido > 0 ? "var(--fg-1)" : "var(--fg-4)" }}>{window.fmt.moneyFull(trazido)}</b>
                                  <span style={{ color: "var(--fg-4)",display:"block",fontSize:11 }}>de {window.fmt.moneyFull(contrato)}</span>
                                </div>
                                <div style={{ height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", margin: "5px 0 4px" }}>
                                  <div style={{ width: `${pago}%`, height: "100%", borderRadius: 999, background: ps.key === "paid" ? "var(--pos)" : ps.key === "partial" ? "var(--warn)" : "var(--neg)" }} />
                                </div>
                                <span onClick={(e) => e.stopPropagation()} style={{ position: "relative", display: "inline-flex", fontSize: 11, color: ps.key === "paid" ? "var(--pos)" : ps.key === "partial" ? "var(--warn)" : "var(--neg)", fontWeight: 600 }}>
                                  {ps.label.toLowerCase()}
                                  <select aria-label={`Status de pagamento de ${c.name}`} value={ps.manual ? ps.key : ""}
                                    onChange={(e) => patchCustomer(c, { paymentStatus: e.target.value })}
                                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}>
                                    <option value="">automático · {PAY_STATUS[ps.auto].label}</option>
                                    <option value="paid">Pago</option>
                                    <option value="partial">Parcial</option>
                                    <option value="unpaid">Não pago</option>
                                  </select>
                                </span>
                              </div>
                              {/* MARCOS (prancha): onde o cliente está na régua
                                  de entrega. "Próxima cobrança" saiu daqui: a
                                  fila de cobrança do trilho é exatamente ela. */}
                              <div style={{ minWidth: 0 }}>
                                {kids ? (
                                  j.next
                                    ? <div className="tnum" style={{ fontSize: 12.5, color: "var(--warn)", whiteSpace: "nowrap" }}>consulta {j.next.n || "?"}<div style={{ fontSize: 11, color: "var(--fg-4)" }}>{fmtNextAt(j.next.at)}</div></div>
                                    : <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>a marcar</span>
                                ) : (() => {
                                  const regua = milestonesFor(withCycle(c), product) || [];
                                  const feitos = regua.filter((m) => m.doneAt).length;
                                  const pct = regua.length ? Math.round((feitos / regua.length) * 100) : 0;
                                  return (
                                    <div title={nm ? `falta: ${nm.label}` : "régua concluída"}>
                                      <div className="tnum" style={{ fontSize: 13, fontWeight: 650, whiteSpace: "nowrap" }}>{`${feitos} de ${regua.length || 0}`}</div>
                                      <div style={{ height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", margin: "5px 0 4px" }}>
                                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: pct === 100 ? "var(--pos)" : "var(--accent)" }} />
                                      </div>
                                      <div style={{ fontSize: 11, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {nm ? `falta: ${nm.label}` : "régua concluída"}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                              {/* Situação: assinatura (ou churn) + o próximo marco embaixo */}
                              <div style={{ minWidth: 0 }}>
                                {isChurned(c)
                                  ? <span title={[c.churnReason ? churnReasonLabel(c.churnReason) : "", c.churnNote || ""].filter(Boolean).join(" · ") || "cliente saiu (churn)"}>
                                      <Pill tone="neg">churn{c.endedAt ? ` ${fmtDay(parseDay(c.endedAt))}` : ""}</Pill>
                                    </span>
                                  : kids
                                    ? <Pill tone={j.done >= j.total && j.items.length > 0 ? "pos" : j.done > 0 ? "warn" : "mut"}>{j.done} de {j.total}</Pill>
                                    : st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
                                {!kids && !isChurned(c) && nm && (
                                  <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                    title={`próximo marco: ${nm.label} · ${nm.status === "late" ? "venceu" : "vence"} ${dueLabel(nm.dueAt)}`}>
                                    {nm.label} · {dueLabel(nm.dueAt)}
                                  </div>
                                )}
                                {!kids && !isChurned(c) && !nm && c.startedAt && (
                                  <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 3 }}>régua completa</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </div>
              {!shownCustomers.length && <div className="customers-empty">nenhum cliente com esses filtros</div>}
              {filteredCustomers.length > 50 && <div className="customers-pagination"><span>mostrando {shownCustomers.length} de {filteredCustomers.length}</span><button onClick={()=>setShowAll(v=>!v)}>{showAll?"Mostrar 50":"Ver todos"}</button></div>}
            </section>

            </div>

            <aside className="customers-rail">
              <section className="customers-queue"><h2><i/>fila de cobrança</h2><p>faturado e assinatura recorrente · vencidos primeiro</p>
                <div className="customers-queue-list">{(showAllActions?nextActions:nextActions.slice(0,ACOES_FECHADAS)).map(a=>{
                  const c=a.customer,inv=a.invoice;
                  return <div className="customers-queue-row" data-tone={a.status} key={c.id} role="button" tabIndex={0} aria-label={`Cobrança de ${c.name}`} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSel(c.id);}}} onClick={()=>setSel(c.id)}>
                    <div><strong>{c.name}</strong><small>{a.status==="late"?"venceu ":"vence "}{dueLabel(a.dueAt)}</small></div><b>{window.fmt.moneyFull(inv?.amount??a.sub?.price??0)}</b>
                    {inv&&<button disabled={!!payingId} aria-label={`Dar baixa em ${c.name}`} onClick={e=>{e.stopPropagation();payFromQueue(inv);}}>{payingId===inv.id?"…":"Baixa"}</button>}
                  </div>;
                })}{!nextActions.length&&<div className="customers-empty">nenhuma cobrança em aberto</div>}</div>
                {nextActions.length>ACOES_FECHADAS&&<button className="customers-more" onClick={()=>setShowAllActions(v=>!v)}>{showAllActions?"ver menos":`ver mais (${nextActions.length-ACOES_FECHADAS})`}</button>}
              </section>
              {keyAccounts.length>0&&<section className="customers-key-accounts"><h2><i/>contas grandes</h2><p>fora das médias · o dinheiro segue contando</p><div>{keyAccounts.map(c=><button key={c.id} onClick={()=>setSel(c.id)}><span>★</span><div><strong>{c.name}</strong><small>{contractPlan(c)||"sem plano"}</small></div><b>{window.fmt.moneyFull((c.arr||0)/12)}</b></button>)}</div></section>}
            </aside>
          </div>
        )}
      </>}
      </div>
      )}

      {selected && (
        <CustomerPeek
          key={selected.id}
          financial={{ contracted: fechadoOf(selected) + upsellOf(selected).total, received: trazidoOf(selected), plan: contractPlan(selected), status: payStatus(selected) }}
          customer={selected}
          lead={(LEADS || []).find((l) => l.id === selected.leadId) || null}
          product={product}
          subs={subsOf(selected)}
          invoices={invoices.filter((i) => i.customer === selected.id)}
          planLabel={planLabel}
          lastContact={lastContact}
          leverOrg={leverOrgOf(selected)}
          leverId={leverIdOf(selected)}
          onComplete={completeMilestone}
          onPatch={patchCustomer}
          onClose={() => setSel(null)}
          onNewReferral={newReferral}
        />
      )}
    </div>
  );
}

// Caixa padrão das seções do popup (mesma linguagem do drawer do pipeline).
const BOX = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };


// Valor do contrato com UNIDADE (mês ou ano). O banco guarda sempre o ANUAL
// (customer.arr; o MRR das telas é arr/12), mas quem vende assinatura recorrente
// pensa em "699 por mês" e digitava 699 num campo chamado "Valor/ano": o ARR do
// cliente ficava em 1/12 do real e sujava MRR, portfólio, metas e o placar de
// CS, sem ninguém perceber (foi o caso do Phillype, 27/08/2026). Agora dá pra
// digitar por mês (grava mês × 12) e a linha de baixo mostra OS DOIS números,
// pra não sobrar dúvida do que foi salvo.
//
// A unidade abre em "por mês" quando o cliente é de assinatura recorrente ou de
// plano mensal — é como a pessoa pensa naquele contrato.
const brl = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;

export function ValorContrato({ customer, onPatch, inputSt }) {
  const mensalPorPadrao = paymentRecurring(customer.paymentMethod) || /mensal/i.test(customer.plan || "");
  const [unit, setUnit] = useState(mensalPorPadrao ? "mes" : "ano");
  const arr = Number(customer.arr) || 0;
  const doArr = (u) => (!arr ? "" : String(u === "mes" ? Math.round((arr / 12) * 100) / 100 : arr));
  const [txt, setTxt] = useState(doArr(mensalPorPadrao ? "mes" : "ano"));
  // Valor salvo por outro caminho (gate de Ganho, assinatura, MP) ou troca de
  // unidade: o campo reflete o que está no banco, nunca o que sobrou na tela.
  useEffect(() => { setTxt(doArr(unit)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [arr, unit]);

  function salvar(raw) {
    const n = String(raw).trim() === "" ? 0 : Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) { setTxt(doArr(unit)); return; }
    const anual = Math.round(unit === "mes" ? n * 12 : n);
    if (anual !== arr) onPatch({ arr: anual });
  }

  const tab = (id, label) => (
    <button key={id} onClick={() => setUnit(id)} title={id === "mes" ? "digitar a mensalidade" : "digitar o valor do ano"}
      style={{
        height: 28, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: "pointer",
        border: "1px solid " + (unit === id ? "var(--accent-line)" : "var(--line-2)"),
        background: unit === id ? "var(--accent-soft)" : "var(--bg-1)",
        color: unit === id ? "var(--accent)" : "var(--fg-3)",
      }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono dim" style={{ width: 96, flexShrink: 0, fontSize: 10.5 }}>Valor (R$)</span>
        <input type="number" min="0" step="0.01" value={txt} onChange={(e) => setTxt(e.target.value)}
          onBlur={(e) => salvar(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          style={inputSt} />
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>{tab("mes", "por mês")}{tab("ano", "por ano")}</div>
      </label>
      <div className="mono dim" style={{ marginLeft: 104, fontSize: 10.5 }}>
        {arr ? `${brl(Math.round((arr / 12) * 100) / 100)}/mês · ${brl(arr)}/ano` : "sem valor registrado"}
      </div>
    </div>
  );
}


// Popup do cliente: tela dividida no padrão do drawer do pipeline (sem scroll
// longo). Esquerda: dados do cliente (edição inline no próprio campo) +
// assinaturas + faturas. Direita: régua de retenção + histórico do funil.
// "Editar" NÃO abre outro popup: troca o corpo pelo form (EntityForm bare)
// dentro deste mesmo modal, pros campos raros (flags, saúde, dono).
// Aba Cases: a lista dos cases e, ao lado, quem tem prova no painel e ainda não
// virou case. A prova vem da MESMA fila de indicação (o R$ que a Lever vendeu na
// conta nos últimos 30 dias), então pedir case e pedir indicação olham o mesmo
// sinal e nunca discordam.
function CasesTab({ product, customers }) {
  const [cases, setCases] = useState(null);
  const [fila, setFila] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const recarregar = React.useCallback(() => {
    setErro("");
    api.list("cases", { saas: product.id }).then(setCases).catch((e) => setErro(e?.message || "não consegui carregar"));
  }, [product.id]);
  React.useEffect(() => { recarregar(); }, [recarregar]);
  React.useEffect(() => {
    api.referralQueue(product.id).then((r) => setFila(r?.rows || r?.queue || [])).catch(() => setFila([]));
  }, [product.id]);

  const comCase = new Set((cases || []).map((c) => c.customerId).filter(Boolean));
  const candidatos = (fila || []).filter((r) => r.bucket === "pedir" && !comCase.has(r.customer)).slice(0, 8);

  async function virarCase(customerId) {
    if (ocupado) return;
    setOcupado(customerId);
    try { await api.caseFromCustomer(customerId); recarregar(); }
    catch (e) { window.alert(e?.message || "não consegui criar o rascunho"); }
    finally { setOcupado(""); }
  }
  async function publicar(c) {
    if (ocupado) return;
    setOcupado(c.id);
    try { await api.casePublish(c.id, !c.public); recarregar(); }
    catch (e) { window.alert(e?.message || "não consegui publicar"); }
    finally { setOcupado(""); }
  }

  return (
    <div className="sec" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <Card style={{ padding: "14px 16px" }}>
        <div className="card-title" style={{ marginBottom: 10 }}>Cases</div>
        {erro && <div role="alert" className="customers-load">{erro} <button onClick={recarregar}>Tentar novamente</button></div>}
        {!erro && cases === null && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>carregando…</div>}
        {cases?.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
            Nenhum case ainda. Quem já tem resultado no painel aparece aqui embaixo, com o número pronto.
          </div>
        )}
        {(cases || []).map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-1)", fontSize: 13, flexWrap: "wrap" }}>
            <Pill tone={c.public ? "pos" : "mut"}>{c.public ? "público" : "rascunho"}</Pill>
            <span style={{ fontWeight: 600 }}>{c.name || "sem nome"}</span>
            {c.niche && <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{c.niche}</span>}
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
              {(c.metrics || []).length} {(c.metrics || []).length === 1 ? "número" : "números"}
              {c.authorizedAt ? " · autorizado" : " · sem autorização"}
              {/* Número com chave é refeito no painel a cada abertura do deck
                  (cases-live.js): quem olha a lista precisa saber que o card da
                  apresentação não está preso ao dia do cadastro. */}
              {(c.metrics || []).some((m) => m?.metric) ? " · o painel atualiza sozinho" : ""}
            </span>
            <button onClick={() => publicar(c)} disabled={!!ocupado}
              style={{ marginLeft: "auto", height: 26, padding: "0 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, border: "1px solid var(--line-1)", background: "var(--bg-2)", color: "var(--fg-2)", cursor: ocupado ? "default" : "pointer" }}>
              {c.public ? "despublicar" : "publicar"}
            </button>
          </div>
        ))}
      </Card>

      <Card style={{ padding: "14px 16px" }}>
        <div className="card-title" style={{ marginBottom: 4 }}>Quem tem prova pra virar case</div>
        <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10 }}>
          clientes com venda influenciada nos últimos 30 dias e ainda sem case
        </div>
        {candidatos.length === 0 && <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Ninguém na fila agora.</div>}
        {candidatos.map((r) => (
          <div key={r.customer} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--line-1)", fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{r.name || (customers || []).find((c) => c.id === r.customer)?.name || r.customer}</span>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{window.fmt.money(r.influenced30d || 0)}</span>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>em 30 dias</span>
            <button onClick={() => virarCase(r.customer)} disabled={!!ocupado}
              style={{ marginLeft: "auto", height: 26, padding: "0 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, border: 0, background: "var(--accent)", color: "oklch(1 0 0)", cursor: ocupado ? "default" : "pointer" }}>
              virar case
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}


// Compact fiche: the same amounts/status as the table, with operational forms
// opened separately. No second financial calculation or legacy summary.
function CustomerPeek(props) {
  const { customer, lead, product, subs, invoices, financial, onClose, onPatch, onComplete } = props;
  const [operation,setOperation]=useState(null), [busy,setBusy]=useState(null), [feedback,setFeedback]=useState(null);
  const sub=subs.find(s=>s.status==='active'||s.status==='past_due')||subs[0];
  const kids=customer.saas==='uniquekids', churned=isChurned(customer), tier=leadTier(lead);
  const milestones=milestonesFor({...customer,contractCycle:sub?.cycle},product);
  const pending=invoices.filter(i=>i.status==='open'||i.status==='overdue').sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||'')));
  const money=window.fmt.moneyFull;
  const totalOpen=pending.reduce((sum,i)=>sum+(Number(i.amount)||0),0);
  async function createCase() {
    if(busy)return;
    setBusy('case');setFeedback(null);
    try { const result=await api.caseFromCustomer(customer.id);setFeedback({text:`Rascunho criado. ${result.blockers?.length ? `Falta ${result.blockers.join(', ')}. ` : ''}Abra Cases para completar e publicar.`}); }
    catch(error){setFeedback({error:true,text:error.message||'Não foi possível criar o rascunho.'});}
    finally{setBusy(null);}
  }
  const [confirmEl, askLink] = useConfirmLink();
  async function chargeNext() {
    if(busy||!pending.length)return;
    if(!window.SEED?.CONFIG?.mp?.configured){setOperation('money');return;}
    const invoice=pending[0];
    if(!invoice.mpInitPoint && !(await askLink({ amount: invoice.amount, who: customer.name, title: invoice.title || "" }))) return;
    setBusy('charge');setFeedback(null);
    try {
      const url=invoice.mpInitPoint||(await api.invoiceMpLink(invoice.id)).url;
      try{await navigator.clipboard.writeText(url);setFeedback({text:'Link da próxima cobrança copiado.'});}
      catch{window.prompt('Link de pagamento:',url);}
    }catch(error){setFeedback({error:true,text:error.message||'Não foi possível gerar o link.'});}
    finally{setBusy(null);}
  }
  const facts=kids?[["Produto",product.name],["Pacote",customer.plan],["Contrato",money(financial.contracted)],["Dono da conta",displayName(customer.owner)||'sem dono']]:[
    ["Produto",product.name],["Ciclo",financial.plan||'sem plano'],["MRR",`${money((customer.arr||0)/12)} /mês`],["Contrato",money(financial.contracted)],["ARR",money(customer.arr||0)],["Dono da conta",customer.owner?displayName(customer.owner):'sem dono'],
  ];
  return createPortal(<>
    <Drawer onClose={onClose} fechavel={!busy} label={`Cliente · ${customer.name}`} largura={420} style={{background:'transparent',padding:0}} painelStyle={{position:'fixed',right:26,top:90,bottom:26,height:'auto',maxWidth:'calc(100vw - 28px)',overflow:'hidden'}}>
      <div className="customer-peek">
        <header className="customer-peek-head">
          <LeadGrade tier={tier} placeholder />
          <div><div className="customer-peek-title"><h2>{customer.name}</h2><LeverIdBadge org={props.leverId} orgId={customerOrgId(customer)} /><button className="customer-peek-edit" aria-label="Editar cliente" title="Editar cliente" onClick={()=>setOperation('edit')} disabled={!!busy}><Icon name="pencil" size={13}/></button></div><p>{[customer.contact,customer.keyAccount?'conta grande':null,tenureLabel(customer)?`${tenureLabel(customer)} de casa`:null].filter(Boolean).join(' · ')}</p><CustomerStateChips customer={customer}/></div>
          <button aria-label="Fechar ficha" onClick={onClose} disabled={!!busy}>✕</button>
        </header>
        <div className="customer-peek-body">
          <section className="customer-peek-contract">
            <div className="customer-peek-kicker"><span>contrato</span><span className="customer-peek-state" data-tone={churned?'neg':financial.status.key==='paid'?'pos':'mut'}>{churned?`churn ${fmtDay(parseDay(customer.endedAt))}`:financial.status.key==='paid'?'em dia':'ativa'}</span></div>
            {facts.map(([label,value])=><div className="customer-peek-fact" key={label}><span>{label}</span><strong>{value||'—'}</strong></div>)}
            <div className="customer-peek-menu"><MoreMenu size={22} items={[
              {label:'Gerenciar cobranças',onClick:()=>setOperation('money')},
              {label:'Histórico e resumos',onClick:()=>setOperation('history')},
              !churned&&{label:'Registrar upsell',onClick:()=>setOperation('upsell')},
              {label:churned?'Desfazer churn':'Registrar churn',tone:'neg',onClick:()=>setOperation('churn')},
              {label:'Registrar indicação',onClick:()=>props.onNewReferral(customer)},
            ]}/></div>
          </section>
          {/* O que está aberto agora (integração, acompanhamento, reunião) e o
              "+ novo" de tudo que se abre a partir do cliente. */}
          {!kids&&<CustomerNow customer={customer} lead={lead} onLeave={onClose} onScheduleMeeting={()=>setOperation('meeting')}/>}
          {product?.id==='leverads'&&<CustomerOrgLink customer={customer} lead={lead}/>}
          <section className="customer-peek-milestones">
            <div className="customer-peek-kicker"><span>{kids?'jornada de consultas':'régua de marcos'}</span>{!kids&&<b>{milestones.filter(m=>m.status==='done').length} de {milestones.length}</b>}</div>
            {kids?<button className="customer-peek-consult" onClick={()=>{onClose();window.location.hash='consultas';}}>Abrir consultas →</button>:milestones.length?<MilestoneStrip milestones={milestones} onToggle={m=>{
                if(m.status==='done'){const done={...customer.milestonesDone};delete done[m.key];onPatch(customer,{milestonesDone:done});}
                else onComplete(customer,m.key);
              }}/>:<p className="customer-peek-note">Defina “Cliente desde” na edição para ativar a régua.</p>}
          </section>
          <section className="customer-peek-money">
            <div className="customer-peek-kicker">dinheiro</div>
            <div className="customer-peek-amount"><strong>{money(financial.received)}</strong><span>de {money(financial.contracted)}</span></div>
            <div className="customer-peek-bar"><i style={{width:`${financial.contracted>0?Math.min(100,financial.received/financial.contracted*100):0}%`,background:`var(--${financial.status.key==='paid'?'pos':financial.status.key==='partial'?'warn':'neg'})`}}/></div>
            <p>{pending.length?`${pending.length} cobrança${pending.length===1?'':'s'} em aberto · ${money(totalOpen)}`:financial.status.key==='paid'?'nada em aberto':'sem cobrança gerada ainda'}</p>
          </section>
          <CustomerDeals customer={customer} onLeave={onClose}/>
          <CustomerContacts customer={customer}/>
          <section><div className="customer-peek-kicker"><span>linha do tempo</span></div><RecordTimeline customerId={customer.id} limit={5}/></section>
          {feedback&&<p role={feedback.error?'alert':'status'} className="customer-peek-feedback">{feedback.text}</p>}
        </div>
        <footer className="customer-peek-footer"><button disabled={!!busy||!pending.length} onClick={chargeNext}>{busy==='charge'?'Gerando link…':pending.length?'Cobrar próxima':'Nada a cobrar'}</button><button disabled={!!busy||kids||churned} onClick={createCase}>{busy==='case'?'Criando rascunho…':'Virar case'}</button></footer>
      </div>
    </Drawer>
    {operation&&<CustomerModal key={operation} {...props} operation={operation} onOperation={setOperation} onClose={()=>setOperation(null)}/>}
    {confirmEl}
  </>, document.body);
}

function CustomerModal({ operation = null, customer, lead, product, subs, invoices, planLabel, lastContact, leverOrg, leverId = null, onComplete, onPatch, onClose, onNewReferral, onOperation }) {
  const { refresh } = useData();
  const [editing, setEditing] = useState(operation === "edit");
  const [changing, setChanging] = useState(null); // { sub, plans }: assinatura no "Mudar plano"
  // QUATRO ABAS (redesign de 12/09): a ficha era uma rolagem única com doze
  // blocos — dados, assinatura, parcelas, faturas, MP, upsell, régua, conversa,
  // indicações, contratos, histórico. Nada saiu; cada bloco tem lugar agora.
  // A ficha abre sempre por uma OPERAÇÃO do card do cliente (CustomerPeek):
  // editar, cobranças, histórico, reunião, upsell ou churn. As abas antigas
  // (Resumo, Indicações, Histórico) não tinham mais por onde ser abertas e
  // saíram; o que elas mostravam está no próprio card.
  const aba = operation === "money" ? "dinheiro" : "";
  const [meetingBusy, setMeetingBusy] = useState(false);
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

  // Desfazer um fechamento ERRADO (Leo, 07/08): remove o cliente, a assinatura
  // e as faturas automáticas, limpa o carimbo de venda e devolve o card pro
  // funil — as métricas (ganho do mês, MRR, caixa) descontam sozinhas.
  // Dinheiro real do Mercado Pago bloqueia no servidor (409 com o motivo).
  const [reverting, setReverting] = useState(false);
  async function revertWin() {
    if (reverting) return;
    if (!window.confirm(`Desfazer o fechamento de ${customer.name || "este cliente"}?\n\nRemove o cliente, a assinatura e as faturas automáticas; o card do lead volta pro funil e as métricas descontam. Não dá pra desfazer o desfazer.`)) return;
    setReverting(true);
    try {
      await api.customerRevertWin(customer.id);
      await refresh();
      onClose && onClose();
    } catch (e) {
      window.alert(e.message || "não deu pra desfazer o fechamento");
    } finally { setReverting(false); }
  }

  // Registrar CHURN (a saída de verdade, diferente do "desfazer venda" que é
  // correção de erro): data + motivo + observação → POST /churn, que carimba
  // endedAt, cancela as assinaturas em aberto (espelhando no MP quando
  // vinculadas) e tira o cliente do MRR e da base ativa — o histórico fica.
  // Clientes com recorrência no MP churnam sozinhos quando o MP cancela; este
  // botão cobre os que pagam por fora (não sincronizados).
  const churned = isChurned(customer);
  const [churnOpen, setChurnOpen] = useState(operation === "churn");
  const [chuDate, setChuDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chuReason, setChuReason] = useState("");
  const [chuNote, setChuNote] = useState("");
  const [chuSaving, setChuSaving] = useState(false);
  async function saveChurn() {
    if (chuSaving || !chuDate) return;
    setChuSaving(true);
    try {
      const r = await api.customerChurn(customer.id, { endedAt: chuDate, reason: chuReason, note: chuNote.trim() });
      Object.assign(customer, r.customer || {}); // otimista: o objeto vem do SEED compartilhado
      setChurnOpen(false);
      if (operation) onClose();
      window.toast && window.toast("churn registrado — cliente fora da base ativa; assinaturas em aberto canceladas", "pos");
      refresh();
    } catch (e) {
      window.toast ? window.toast(e.message || "não deu pra registrar o churn", "neg") : window.alert(e.message || "não deu pra registrar o churn");
    } finally { setChuSaving(false); }
  }
  async function undoChurn() {
    if (chuSaving) return;
    setChuSaving(true);
    try {
      const r = await api.customerUnchurn(customer.id);
      Object.assign(customer, r.customer || {});
      window.toast && window.toast("churn desfeito — se a cobrança continua, reative a assinatura na aba Assinaturas", "pos");
      refresh();
    } catch (e) {
      window.toast && window.toast(e.message || "não deu pra desfazer o churn", "neg");
    } finally { setChuSaving(false); }
  }

  // Registrar UPSELL (venda extra pra cliente atual, trabalho de CS): o painel
  // (components/UpsellPanel.jsx) grava pelo POST /customers/:id/upsell — fatura
  // kind:"upsell" com o que foi vendido e quem vendeu; no modo recorrente a
  // assinatura sobe e o MRR acompanha. Caixa, placar do CS e Financeiro leem
  // a fatura pelas réguas existentes; o SSE recarrega a lista de faturas.
  const [upsellOpen, setUpsellOpen] = useState(operation === "upsell");
  function upsellDone(r) {
    Object.assign(customer, r?.customer || {}); // otimista: o objeto vem do SEED compartilhado
    setUpsellOpen(false);
    if (operation) onClose();
    window.toast && window.toast(r?.url
      ? "upsell registrado — link de pagamento copiado, manda pro cliente; a baixa é automática"
      : r?.subscription ? "upsell registrado — mensalidade e MRR atualizados" : "upsell registrado", "pos");
    refresh();
  }

  // Cobrança avulsa pelo Mercado Pago: fatura + link de pagamento anexados ao
  // cliente numa tacada (POST /charge). O link vai pro clipboard; a baixa é
  // automática quando o cliente pagar (webhook/poller casam pelo id da fatura).
  // Qualquer gateway ligado libera cobrar (modal escolhe por onde); o atalho
  // de link da fatura/parcela usa o gateway padrão (defaultGateway).
  const mpOn = anyGatewayOn();
  // Cronograma do faturado (faturas kind:"installment"): marcar paga /
  // desmarcar por parcela. O override local dá o feedback imediato; o SSE
  // recarrega a lista de verdade logo depois (deps [product, version]).
  const [invOverride, setInvOverride] = useState({});
  const [invBusy, setInvBusy] = useState("");
  const [invPaying, setInvPaying] = useState(null);
  const invStatus = (i) => invOverride[i.id] || i.status;
  async function toggleParcela(i) {
    if (invBusy) return;
    setInvBusy(i.id);
    try {
      if (invStatus(i) === "paid") {
        const r = await api.unpayInvoice(i.id);
        setInvOverride((o) => ({ ...o, [i.id]: r?.status || "open" }));
      } else {
        // Marcar paga pede a prova (quando/como entrou): abre o modal.
        setInvPaying(i);
      }
    } catch (e) {
      window.toast && window.toast(e?.message || "não deu pra atualizar a fatura", "neg");
    } finally { setInvBusy(""); }
  }
  const parcelas = invoices.filter((i) => i.kind === "installment")
    .sort((a, b) => (a.installmentN || 0) - (b.installmentN || 0) || String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
  // Mudar (ou CRIAR) o parcelamento depois do fechamento: PATCH no lead
  // re-espelha via syncWonLeadDeal — refaz as parcelas em aberto, as pagas
  // ficam. Fechamento ANTIGO (pré-gate): o lead pode não ter paymentMethod/
  // planClosed, e sem o método o re-espelho não gera cronograma nenhum —
  // backfill do cadastro do cliente na mesma tacada, só no que falta.
  const [nSaving, setNSaving] = useState(false);
  async function changeParcelamento(n) {
    if (!lead || nSaving) return;
    setNSaving(true);
    const patch = { paymentInstallments: Number(n) || "" };
    if (!lead.paymentMethod && customer.paymentMethod) patch.paymentMethod = customer.paymentMethod;
    if (!lead.planClosed) {
      const planClosed = closedPlanFromLabel(customer.plan);
      if (planClosed) patch.planClosed = planClosed;
    }
    try { await api.update("leads", lead.id, patch); }
    catch (e) { window.toast && window.toast(e?.message || "não deu pra mudar o parcelamento", "neg"); }
    finally { setNSaving(false); }
  }
  const [chargeOpen, setChargeOpen] = useState(false);
  const [chVal, setChVal] = useState("");
  const [chTitle, setChTitle] = useState("");
  const [chInst, setChInst] = useState("12");
  const [chSaving, setChSaving] = useState(false);
  const [finMsg, setFinMsg] = useState(null);
  function flashFin(msg) { setFinMsg(msg); setTimeout(() => setFinMsg(null), 4200); }
  async function copyLink(url, okMsg) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); flashFin(okMsg); }
    catch { window.prompt("Link de pagamento:", url); }
  }
  const [confirmLinkEl, askLink] = useConfirmLink();
  async function saveCharge() {
    const amount = Number(chVal);
    if (!(amount > 0) || chSaving) return;
    if (!(await askLink({ amount, installments: Number(chInst) || 0, gateway: defaultGateway(), title: chTitle.trim(), who: customer.name }))) return;
    if (chSaving) return;
    setChSaving(true);
    try {
      const r = await api.createCharge(customer.id, {
        amount, title: chTitle.trim(), maxInstallments: Number(chInst) || undefined,
      });
      setChargeOpen(false); setChVal(""); setChTitle("");
      await copyLink(r.url, "link de cobrança copiado — manda pro cliente; a baixa é automática quando pagar");
      refresh();
    } catch (err) { flashFin(err.message || "MP recusou a cobrança"); }
    finally { setChSaving(false); }
  }
  // Link de pagamento de uma fatura já existente (aberta/vencida): copia o que
  // já tem ou gera na hora.
  async function invoiceLink(inv) {
    if (inv.mpInitPoint) return copyLink(inv.mpInitPoint, "link da fatura copiado");
    if (!(await askLink({ amount: inv.amount, gateway: defaultGateway(), title: inv.title || "", who: customer.name }))) return;
    try {
      const r = await api.invoiceMpLink(inv.id, { gateway: defaultGateway() });
      await copyLink(r.url, `link criado no ${gatewayLabel(r.gateway)} e copiado`);
      refresh();
    } catch (err) { flashFin(err.message || "o gateway recusou o link"); }
  }

  // O antigo grid de `summary` (plano, casa, último contato, assinatura,
  // upsells, vencimento) saiu do cabeçalho: a assinatura virou Pill ao lado do
  // nome, o tempo de casa entrou no subtítulo e o resto está nos Dados do
  // cliente, na seção Contrato — cada um com contexto em vez de seis rótulos
  // soltos competindo com o nome.

  return (
    <Modal onClose={onClose} fechavel={!chuSaving && !chSaving && !invBusy && !reverting && !meetingBusy} label={operation ? "Ação do cliente" : "ficha do cliente"} largura={operation === "history" ? 1000 : operation || editing ? 640 : 1080} padding={20}
      painelStyle={{ maxHeight: "min(92dvh, 100%)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--line-faint)", flexShrink: 0 }}>
          {operation && <div className="customer-operation-head"><h2>{({edit:"Editar cliente", money:"Gerenciar cobranças", referral:"Registrar indicação", upsell:"Registrar upsell", churn:"Registrar churn", meeting:"Reunião com o cliente", history:"Histórico e resumos"})[operation]} · {customer.name}</h2><button aria-label="Fechar ação" onClick={onClose}>✕</button></div>}
          {/* Faixa de churn: o cliente saiu — quando, por quê e o desfazer. */}
          {churned && (!operation || operation === "churn") && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", borderRadius: "var(--r-2)", background: "var(--neg-soft)", border: "1px solid color-mix(in srgb, var(--neg) 30%, transparent)" }}>
              <Pill tone="neg">churn</Pill>
              <span style={{ fontSize: 12.5, color: "var(--fg-2)", minWidth: 0 }}>
                saiu em <b>{fmtDay(parseDay(customer.endedAt))}</b>
                {customer.churnReason ? ` · ${churnReasonLabel(customer.churnReason)}` : ""}
                {customer.churnNote ? ` · ${customer.churnNote}` : ""}
                {customer.churnSource === "mp" ? " · marcado pelo Mercado Pago" : ""}
              </span>
              <button onClick={undoChurn} disabled={chuSaving}
                title="Desfaz a marcação de churn (o cliente volta pra base ativa). As assinaturas canceladas NÃO voltam sozinhas — reative na aba Assinaturas se a cobrança continua."
                style={{ marginLeft: "auto", height: 24, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11, flexShrink: 0, opacity: chuSaving ? 0.5 : 1 }}>
                {chuSaving ? "…" : "desfazer churn"}
              </button>
            </div>
          )}
          {/* Painel do registrar upsell: item, modo, valor, pagamento e quem vendeu. */}
          {upsellOpen && !churned && !editing && (
            <UpsellPanel customer={customer} product={product} mpOn={mpOn} onDone={upsellDone} onCancel={() => operation ? onClose() : setUpsellOpen(false)} />
          )}
          {/* Painel do registrar churn: data (padrão hoje) + motivo + observação. */}
          {churnOpen && !churned && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)" }}>
              <span className="mono dim" style={{ fontSize: 10.5 }}>saída</span>
              <input type="date" value={chuDate} onChange={(e) => setChuDate(e.target.value)}
                style={{ height: 28, padding: "0 6px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--mono)" }} />
              <select value={chuReason} onChange={(e) => setChuReason(e.target.value)}
                style={{ height: 28, padding: "0 6px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: chuReason ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12.5 }}>
                <option value="">motivo…</option>
                {CHURN_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <input type="text" value={chuNote} onChange={(e) => setChuNote(e.target.value)} placeholder="observação (opcional)"
                onKeyDown={(e) => e.key === "Enter" && saveChurn()}
                style={{ height: 28, flex: "1 1 160px", minWidth: 130, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }} />
              <button onClick={saveChurn} disabled={chuSaving || !chuDate}
                style={{ height: 28, padding: "0 12px", borderRadius: 999, border: "none", background: "var(--neg)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: chuSaving || !chuDate ? 0.5 : 1 }}>
                {chuSaving ? "registrando…" : "confirmar churn"}
              </button>
            </div>
          )}
        </div>

        {editing && (
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <EntityForm
              entityKey="customers"
              record={customer}
              bare
              onClose={() => operation ? onClose() : setEditing(false)}
              onSaved={async () => { await refresh(); operation ? onClose() : setEditing(false); }}
            />
          </div>
        )}

        {!editing && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "14px 16px" }}>

        {operation === "history" && (
          <CustomerHistoryView customer={customer} lead={lead} onSchedule={onOperation ? () => onOperation("meeting") : null} />
        )}

        {operation === "meeting" && (
          <CustomerMeetingForm customer={customer} lead={lead} onBusy={setMeetingBusy} onCancel={onClose}
            onDone={async () => { await refresh(); onClose(); }} />
        )}

        {/* ── DINHEIRO: assinatura, parcelas, faturas, MP e upsells ───────── */}
        {aba === "dinheiro" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {/* Contrato: plano, status do pagamento, valor anual e datas, num lugar só. */}
        {/* Produtos: uma assinatura por produto, cada uma com o seu plano. */}
        {!isKids && <CustomerProducts customer={customer} subs={subs} churned={!!customer.endedAt}
          onChangePlan={async (s) => { setChanging({ sub: s, plans: await api.list("plans", { saas: customer.saas }).catch(() => []) }); }}
          onAdded={async (r) => { if (r?.customer) Object.assign(customer, r.customer); await refresh(); }} />}
        <CustomerContractForm key={customer.id} customer={customer} hasSubscription={subs.some((s) => s.status === "active" || s.status === "past_due")}
          hasLiveSubscription={subs.some((s) => s.status !== "canceled")}
          onSaved={async (saved) => { if (saved) Object.assign(customer, saved); await refresh(); }} />
        {!isKids && <CustomerPlanPanel customer={customer} subs={subs} />}
        {changing && createPortal(<ChangeModal sub={changing.sub} plans={changing.plans} customerName={customer.name} onClose={() => setChanging(null)}
          onDone={async (msg) => { setChanging(null); window.toast?.(msg, "pos"); await refresh(); }} />, document.body)}
        {invPaying && createPortal(<ManualPaidModal target={{ kind: "invoice", id: invPaying.id, amount: invPaying.amount, title: invPaying.title || (invPaying.kind === "installment" ? `parcela ${invPaying.installmentN || 1}/${invPaying.installmentOf || 1}` : "fatura"), targetName: customer.name }}
          onClose={() => setInvPaying(null)} onDone={async () => { setInvPaying(null); setInvOverride((o) => ({ ...o, [invPaying.id]: "paid" })); window.toast?.("fatura baixada", "pos"); await refresh(); }} />, document.body)}
        {parcelas.length > 0 && (() => {
          const pagas = parcelas.filter((i) => invStatus(i) === "paid");
          const recebido = pagas.reduce((a, i) => a + (Number(i.amount) || 0), 0);
          const aReceber = parcelas.reduce((a, i) => a + (Number(i.amount) || 0), 0) - recebido;
          const totalN = Number(parcelas[parcelas.length - 1]?.installmentOf) || parcelas.length;
          return (
            <div style={BOX}>
              <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Parcelas do faturado · {pagas.length}/{parcelas.length} pagas</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-3)", textTransform: "none", letterSpacing: 0 }}>
                  {money(recebido)} recebido · {money(aReceber)} a receber
                </span>
                {lead && !paymentUpfront(customer.paymentMethod || lead.paymentMethod) && !paymentCustom(customer.paymentMethod || lead.paymentMethod) && (
                  <select value={String(totalN)} disabled={nSaving} onChange={(e) => changeParcelamento(e.target.value)}
                    title="Mudar o parcelamento refaz as parcelas em aberto; as pagas ficam como estão"
                    style={{ height: 22, padding: "0 4px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11 }}>
                    {Array.from({ length: 12 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
                  </select>
                )}
              </div>
              {parcelas.map((i) => {
                const st = invStatus(i);
                return (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                    <span style={{ color: "var(--fg-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i.dueDate ? new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : ""} · {i.title || `Parcela ${i.installmentN || "?"}/${i.installmentOf || parcelas.length}`}
                      {st === "paid" && mpMethodLabel(i) ? <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}> · {mpMethodLabel(i)}</span> : null}
                    </span>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      {mpOn && st !== "paid" && (
                        <button onClick={() => invoiceLink(i)}
                          title={i.mpInitPoint ? `copiar o link de pagamento desta parcela${i.paymentGateway && i.paymentGateway !== "mp" ? ` (${gatewayLabel(i.paymentGateway)})` : ""}` : `gerar o link de pagamento desta parcela no ${gatewayLabel(defaultGateway())}`}
                          style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 10.5 }}>
                          {i.mpInitPoint ? "copiar link" : "gerar link"}
                        </button>
                      )}
                      <span className="tnum mono" style={{ fontWeight: 500 }}>{money(i.amount || 0)}</span>
                      <Pill tone={st === "paid" ? "pos" : st === "overdue" ? "neg" : "warn"}>
                        {st === "paid" ? "paga" : st === "overdue" ? "vencida" : "aberta"}
                      </Pill>
                      {/* baixa REAL do MP não desmarca (o dinheiro existiu) */}
                      {!(st === "paid" && i.mpPaymentId) && (
                        <button onClick={() => toggleParcela(i)} disabled={invBusy === i.id}
                          title={st === "paid" ? "desfazer a baixa manual desta parcela" : "registrar que esta parcela foi paga"}
                          style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid " + (st === "paid" ? "var(--line-2)" : "var(--pos, var(--accent))"), background: "var(--bg-1)", color: st === "paid" ? "var(--fg-3)" : "var(--pos, var(--accent))", fontSize: 10.5, fontWeight: 600, opacity: invBusy === i.id ? 0.5 : 1 }}>
                          {invBusy === i.id ? "…" : st === "paid" ? "desmarcar" : "marcar paga"}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Fechou FATURADO/PARCELADO mas está sem cronograma (fechamento antigo,
            sem o Nº de parcelas do gate): oferece gerar daqui. Mesmo caminho do
            "mudar parcelamento" — o re-espelho tira as faturas de renovação
            abertas/auto-pagas, ajusta a assinatura pro valor cheio e cria as N
            parcelas; cada uma marcada paga conta no caixa e no Status pgto.
            Recorrente fica fora: a cobrança dela é a renovação mensal, sem fim. */}
        {parcelas.length === 0 && lead && Number(lead.amount) > 0 && (() => {
          const pm = customer.paymentMethod || lead.paymentMethod;
          // Condição personalizada fica fora do cronograma do faturado: o que o
          // closer escreveu não é N parcelas iguais (recebido = MP/baixa manual).
          if (paymentUpfront(pm) || paymentRecurring(pm) || paymentCustom(pm)) return null;
          return (
            <div style={BOX}>
              <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Parcelas do faturado</span>
                <select value="" disabled={nSaving} onChange={(e) => e.target.value && changeParcelamento(e.target.value)}
                  title="Gera o cronograma (vencimento mensal a partir do fechamento) pra marcar cada parcela como paga"
                  style={{ marginLeft: "auto", height: 22, padding: "0 4px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11 }}>
                  <option value="">{nSaving ? "gerando…" : "gerar cronograma…"}</option>
                  {Array.from({ length: 12 }, (_, k) => k + 1).map((n) => (
                    <option key={n} value={n}>{n}x de {money((Number(lead.amount) || 0) / n)}</option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                Cliente faturado sem cronograma de parcelas. Escolha em quantas vezes pra
                criar as parcelas e ir marcando cada pagamento — o que for pago conta no
                caixa e no Status pgto.
              </div>
            </div>
          );
        })()}

        <div style={BOX}>
          <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span>Últimas faturas</span>
            {!churned && (
              <button onClick={() => { setUpsellOpen(true); setChurnOpen(false); }}
                title="Registrar um upsell (venda extra pra este cliente) — abre o painel no topo da ficha."
                style={{ marginLeft: "auto", height: 22, padding: "0 9px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
                + upsell
              </button>
            )}
            {mpOn && (
              <button onClick={() => setChargeOpen((v) => !v)}
                title="Gerar uma cobrança (Mercado Pago, Asaas ou Appmax): cria a fatura e o link de pagamento anexado ao cliente. A baixa é automática quando pagar."
                style={{ marginLeft: churned ? "auto" : 0, height: 22, padding: "0 9px", borderRadius: 999, border: "1px solid var(--accent-line, var(--line-2))", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
                {chargeOpen ? "cancelar" : "+ cobrança"}
              </button>
            )}
            <button onClick={revertWin} disabled={reverting}
              title="Avançou errado? Desfaz o fechamento: remove ESTE cliente, a assinatura e as faturas automáticas, limpa o carimbo de venda e devolve o card do lead pro funil. As métricas (ganho do mês, MRR, caixa) descontam sozinhas. Cobrança real do Mercado Pago bloqueia o desfazer."
              style={{ height: 22, padding: "0 9px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--neg) 40%, transparent)", background: "var(--bg-1)", color: "var(--neg)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
              {reverting ? "desfazendo…" : "desfazer venda"}
            </button>
          </div>
          {finMsg && <div className="mono" style={{ fontSize: 10.5, color: "var(--accent)", padding: "0 0 8px" }}>{finMsg}</div>}
          {chargeOpen && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "2px 0 10px" }}>
              <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={chVal}
                onChange={(e) => setChVal(e.target.value)} placeholder="valor"
                onKeyDown={(e) => e.key === "Enter" && saveCharge()}
                className="tnum" style={{ height: 28, width: 96, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, textAlign: "right" }} />
              <input type="text" value={chTitle} onChange={(e) => setChTitle(e.target.value)} placeholder="descrição (aparece no checkout)"
                onKeyDown={(e) => e.key === "Enter" && saveCharge()}
                style={{ height: 28, flex: "1 1 150px", minWidth: 120, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }} />
              <label className="mono dim" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                até
                <select value={chInst} onChange={(e) => setChInst(e.target.value)}
                  style={{ height: 28, padding: "0 4px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12 }}>
                  {[1, 2, 3, 6, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
                </select>
              </label>
              <button onClick={saveCharge} disabled={!(Number(chVal) > 0) || chSaving}
                style={{ height: 28, padding: "0 12px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: !(Number(chVal) > 0) || chSaving ? 0.5 : 1 }}>
                {chSaving ? "gerando…" : "gerar link"}
              </button>
            </div>
          )}
          {/* Cada fatura tem "marcar paga" / "desmarcar" (Leo, 07/10): o dinheiro
              entra por PIX/cartão fora do rastreio do MP seja qual for o meio de
              pagamento, e a fatura de renovação de quem fechou à vista ficava
              "aberta" sem jeito de dar baixa. MESMA função das parcelas
              (toggleParcela → POST /invoices/:id/pay|unpay); baixa real do MP
              não desmarca. */}
          {invoices.filter((i) => i.kind !== "installment").slice(0, 6).map((i) => { const st = invStatus(i); return (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--fg-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.dueDate ? new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : ""} · {i.title || i.kind || "fatura"}
                {/* como o dinheiro entrou de verdade (carimbado pela baixa do MP) */}
                {st === "paid" && mpMethodLabel(i) ? <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}> · {mpMethodLabel(i)}</span> : null}
                {/* upsell: o acréscimo recorrente e quem vendeu (atribuição do placar do CS) */}
                {i.kind === "upsell" && (i.recurringDelta > 0 || i.soldBy)
                  ? <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{i.recurringDelta > 0 ? ` · +${money(i.recurringDelta)}/mês` : ""}{i.soldBy ? ` · por ${displayName(i.soldBy)}` : ""}</span>
                  : null}
              </span>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {mpOn && st !== "paid" && (
                  <button onClick={() => invoiceLink(i)}
                    title={i.mpInitPoint ? `copiar o link de pagamento desta fatura${i.paymentGateway && i.paymentGateway !== "mp" ? ` (${gatewayLabel(i.paymentGateway)})` : ""}` : `gerar o link de pagamento desta fatura no ${gatewayLabel(defaultGateway())}`}
                    style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 10.5 }}>
                    {i.mpInitPoint ? "copiar link" : "gerar link"}
                  </button>
                )}
                <span className="tnum mono" style={{ fontWeight: 500 }}>{money(i.amount || 0)}</span>
                <Pill tone={st === "paid" ? "pos" : st === "overdue" ? "neg" : "warn"}>
                  {st === "paid" ? "paga" : st === "overdue" ? "vencida" : "aberta"}
                </Pill>
                {/* baixa REAL do MP não desmarca (o dinheiro existiu) */}
                {!(st === "paid" && i.mpPaymentId) && (
                  <button onClick={() => toggleParcela(i)} disabled={invBusy === i.id}
                    title={st === "paid" ? "desfazer a baixa manual desta fatura" : "registrar que esta fatura foi paga, seja qual for o meio de pagamento"}
                    style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid " + (st === "paid" ? "var(--line-2)" : "var(--pos, var(--accent))"), background: "var(--bg-1)", color: st === "paid" ? "var(--fg-3)" : "var(--pos, var(--accent))", fontSize: 10.5, fontWeight: 600, opacity: invBusy === i.id ? 0.5 : 1 }}>
                    {invBusy === i.id ? "…" : st === "paid" ? "desmarcar" : "marcar paga"}
                  </button>
                )}
              </span>
            </div>
          ); })}
          {invoices.filter((i) => i.kind !== "installment").length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{parcelas.length ? "Nenhuma fatura além das parcelas." : "Nenhuma fatura ainda."}</div>
          )}
        </div>
        </div>
        )}
        </div>
        )}
        {confirmLinkEl}
    </Modal>
  );
}


function ReferralsTab({ saasId, onRegister, customers, onSummary, onOpenCustomer }) {
  const [data, setData] = useState(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState("");
  const [bucket, setBucket] = useState("pedir");   // pedir | descanso | sem_prova
  const [verGap, setVerGap] = useState(false);
  const money = window.fmt.money;

  const load = React.useCallback(() => {
    setErro("");
    api.referralQueue(saasId).then(setData).catch((e) => setErro(e?.message || "não deu pra carregar a fila"));
  }, [saasId]);
  React.useEffect(() => { load(); }, [load]);
  // O resumo vira o subtítulo do cabeçalho da tela (o número do dia fica junto
  // do título, não dentro de um card competindo com a fila).
  React.useEffect(() => {
    if (!onSummary) return;
    onSummary(data
      ? `${data.totals.pedir} com resultado fresco · ${money(data.totals.influencedSum)} vendidos pela Lever nas contas deles em 30 dias`
      : "");
  }, [data, onSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pedir(row) {
    setBusy(row.customer);
    // Abre o WhatsApp ANTES do await: navegador só deixa abrir aba nova no
    // gesto do clique, e o pedido é o que a pessoa veio fazer aqui.
    const wa = waLink(row.phone);
    if (wa) window.open(`${wa}?text=${encodeURIComponent(row.script || "")}`, "_blank", "noreferrer");
    try {
      await api.referralAsk({ customer: row.customer, influenced30d: row.influenced30d });
      load();
    } catch (e) { setErro(e?.message || "o pedido não foi registrado"); }
    finally { setBusy(""); }
  }

  if (erro && !data) return <div className="customers-load" role="alert"><EmptyState title="Fila indisponível" hint={erro} /><button onClick={load}>Tentar novamente</button></div>;
  if (!data) return <div style={{ padding: "16px var(--pad-x)", fontSize: 13, color: "var(--fg-3)" }}>Calculando o resultado de cada cliente…</div>;

  const rows = data.rows.filter((r) => r.bucket === bucket);
  const gap = data.coverage.customers - data.coverage.withOrg;
  // Quem está sem conta do LeverAds no cadastro: sai da própria base da tela
  // (a fila não traz quem tem menos de 30 dias de casa).
  const semOrg = (customers || []).filter((c) => c.saas === saasId && !isChurned(c) && !String(c.leveradsOrgId || "").trim());
  const FILTROS = [
    ["pedir", "Pra pedir", data.totals.pedir],
    ["descanso", "Em descanso", data.totals.descanso],
    ["prova_fraca", "Resultado pequeno", data.totals.provaFraca],
    ["sem_prova", "Sem prova", data.totals.semProva],
  ].filter(([, , n]) => n > 0 || bucket === "pedir");
  // Cabe em 1280px (a aba usa a largura inteira); em 1024 rola na horizontal
  // preservando o Cliente, que é a régua do .tbl-x.
  const GRID = "minmax(150px,1.3fr) 120px 70px 96px minmax(160px,1fr) 150px";

  return (
    <div style={{ padding: "16px var(--pad-x) 56px", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {FILTROS.map(([key, label, n]) => (
          <FilterTab key={key} active={bucket === key} count={n} onClick={() => setBucket(key)}>{label}</FilterTab>
        ))}
        {!!gap && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--fg-4)" }}>
            {`${gap} ${gap === 1 ? "cliente ativo está" : "clientes ativos estão"} sem conta do LeverAds no cadastro`}
            <button onClick={() => setVerGap((v) => !v)} className="mono"
              style={{ background: "none", border: 0, padding: "0 0 0 6px", fontSize: 11.5, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
              {verGap ? "esconder ▴" : "ver quem ▾"}
            </button>
          </span>
        )}
      </div>

      {verGap && semOrg.length > 0 && (
        <Card>
          <div style={{ padding: "14px var(--inset-x)" }}>
            <div className="kicker" style={{ marginBottom: 6 }}>Sem conta do LeverAds no cadastro</div>
            <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 8 }}>
              Sem a conta vinculada não há como provar resultado, e o pedido volta a ser genérico. O campo fica na ficha, na seção Contato.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px" }}>
              {semOrg.map((c) => (
                <button key={c.id} onClick={() => onRegister && onRegister(c)} title="abrir o cadastro pra vincular"
                  style={{ ...ACAO_BTN, cursor: "pointer" }}>{c.name}</button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {erro && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{erro}</div>}

      {!rows.length ? (
        <EmptyState title={bucket === "pedir" ? "Ninguém pra pedir agora" : "Nada nesta lista"}
          hint={bucket === "pedir"
            ? "Todo mundo com resultado fresco já foi pedido nos últimos 90 dias. Veja em 'Em descanso'."
            : "Troque o filtro pra ver as outras listas."} />
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div className="tbl-x">
            <div>
              <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "10px 16px", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }}>
                <span className="kicker">Cliente</span>
                <span className="kicker">Vendeu em 30d</span>
                <span className="kicker">Casa</span>
                <span className="kicker">Já indicou</span>
                <span className="kicker">O que dizer</span>
                <span className="kicker" style={{ textAlign: "right" }}>Ação</span>
              </div>
              {rows.map((r) => {
                const cliente = (customers || []).find((c) => c.id === r.customer);
                const descanso = r.bucket === "descanso";
                return (
                  <div key={r.customer} style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "12px 16px", alignItems: "center", borderBottom: "1px solid var(--line-1)", opacity: descanso ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <Avatar id={r.customer} name={r.name} size={28} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {[r.contact, r.ownerName && `CS ${r.ownerName}`].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                    {/* A PROVA é o que autoriza o pedido: é o número que manda na linha. */}
                    <div style={{ minWidth: 0 }}>
                      <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: r.influenced30d ? "var(--pos)" : "var(--fg-4)", whiteSpace: "nowrap" }}>
                        {r.influenced30d ? money(r.influenced30d) : "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{r.influenced30d ? "na conta dele" : "sem venda ainda"}</div>
                    </div>
                    <div className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{r.daysAsClient}d</div>
                    <div style={{ fontSize: 12.5, color: r.collected ? "var(--fg-2)" : "var(--fg-4)", minWidth: 0 }}>
                      {r.collected
                        ? `${r.collected}${r.closed ? ` · ${r.closed} fechou` : ""}`
                        : (r.seeds ? `${r.seeds} plantado${r.seeds > 1 ? "s" : ""}` : "—")}
                    </div>
                    {/* O script deixa de aparecer só depois do clique, já dentro
                        do WhatsApp: quem vai pedir lê antes o que vai dizer. */}
                    <div title={r.script} style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.4, minWidth: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {r.script}
                    </div>
                    <div style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {descanso
                        ? <Pill tone="mut">em descanso</Pill>
                        : <button onClick={() => pedir(r)} disabled={busy === r.customer}
                            style={{ ...ACAO_BTN, background: "var(--bg-1)", color: "var(--fg-1)", fontWeight: 600, cursor: "pointer" }}>
                            {busy === r.customer ? "…" : "pedir no WhatsApp"}
                          </button>}
                      {cliente && (
                        <button onClick={() => onRegister(cliente)} style={{ ...ACAO_BTN, cursor: "pointer" }}>registrar</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}


// CustomersScreen é o que o app monta. CustomerModal e ReferralsTab saem daqui
// pro smoke de render exercitar os estados que a tela inteira não alcança no
// SSR (as quatro abas da ficha, a fila de indicação): os dados chegam por
// efeito, que não roda no servidor.
export { CustomersScreen, CustomerModal, ReferralsTab };
