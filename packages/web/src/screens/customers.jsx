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
import { leadTier, waLink, GRADE_STYLE, GRADE_GRID, GRADE_ACCOUNTS, GRADE_LISTINGS } from "../lib/ui.js";
import { scriptChecklist } from "../lib/scripts.js";
import { displayName } from "../lib/users.js";
import { paymentLabel, paymentUpfront, paymentRecurring, PAYMENT_METHODS, PAY_STATUS, CONSULT_PACKAGES, consultPackageLabel, consultPackageOf, mpMethodLabel, accruedAmountOf, isRecurringClose } from "../lib/payments.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { isChurned, CHURN_REASONS, churnReasonLabel } from "../lib/churn.js";
import { fetchLeveradsOrgs } from "../lib/leverads.js";
import { printContract, issueDate, byIssuedDesc } from "../lib/contracts.js";
// Clientes — a base ativa do produto em dois blocos: a tabela de clientes e,
// ao lado, "Próximas ações" (os vencimentos a cobrar do faturado e da
// assinatura recorrente, ordenados por urgência). Clicar num cliente abre um popup com o resumo dele
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
const ACAO_BTN = { height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", flexShrink: 0, display: "inline-flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap" };

function CustomersScreen({ initialTab }) {
  const { CUSTOMERS, LEADS } = window.SEED;
  const { version, openForm, refresh } = useData();
  const [product] = useActiveSaas();
  // Aba persiste entre navegações (rota #subscriptions força billing via prop).
  const [tab, setTabState] = useState(() => { if (initialTab) return initialTab; try { return localStorage.getItem("cockpit_customers_tab") || "base"; } catch { return "base"; } }); // base | billing
  const setTab = (t) => { setTabState(t); try { localStorage.setItem("cockpit_customers_tab", t); } catch { /* ignore */ } };
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
  // Baixa da cobrança direto da fila de ações (a MESMA ação do "marcar paga"
  // da ficha do cliente). Otimista na lista local; o SSE recarrega depois.
  const [payingId, setPayingId] = useState("");
  async function payFromQueue(inv) {
    if (payingId) return;
    setPayingId(inv.id);
    try {
      await api.payInvoice(inv.id);
      setInvoices((rows) => rows.map((i) => (i.id === inv.id ? { ...i, status: "paid", paidAt: new Date().toISOString() } : i)));
      window.toast && window.toast("cobrança baixada", "pos");
    } catch (e) {
      window.toast && window.toast(e?.message || "não deu pra baixar a cobrança", "neg");
    } finally { setPayingId(""); }
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

  // Vínculo com o produto (coluna "Usuário LeverAds"): resolve o
  // customer.leveradsOrgId em nome · e-mail pela mesma lista de orgs do select
  // do cadastro (cache de sessão em lib/leverads.js). Sem credencial
  // LEVERADS_* a busca falha (424) e a coluna mostra o id cru.
  const isLeverads = product?.id === "leverads";
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
  // Plano CONTRATADO do cliente: o cadastro (customer.plan) manda; a assinatura
  // só entra como fallback. O ciclo da assinatura é cadência de COBRANÇA, não o
  // contrato — boleto faturado vira ciclo mensal por design, e mostrar "mensal"
  // pra um contrato semestral faturado estava errado.
  const contractPlan = (c) => c.plan || (mainSub(c) ? planLabel(mainSub(c)) : "");
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

  // Colunas Pagamento e Total fechado da tabela: meio de pagamento (do cliente ou
  // do lead que fechou) e o VALOR FECHADO do contrato (lead.amount lançado no
  // fechamento, fallback no arr do cliente). Fechado, não pago — mostra o valor
  // mesmo quando a fatura ainda está aberta (boleto/pix à vista não baixado).
  const leadById = React.useMemo(() => new Map((LEADS || []).map((l) => [l.id, l])), [LEADS]);
  // Assinatura recorrente (plano mensal) ACUMULA: cada 30 dias desde o
  // fechamento soma outra mensalidade no total — churn (endedAt) para o
  // relógio. É a mesma régua do status de pagamento, então a 2ª mensalidade
  // não paga aparece como Parcial sozinha.
  const fechadoOf = (c) => accruedAmountOf(leadById.get(c.leadId), { endAt: c.endedAt }) || Number(c.arr) || 0;

  // Dinheiro REAL recebido por cliente ({ id: total }): MP aprovado casado com
  // o cliente/lead + baixas de fatura de verdade (o endpoint exclui a fatura
  // que nasce paga no fechamento por convenção).
  const [received, setReceived] = useState({});
  useEffect(() => {
    if (!product?.id) return;
    let alive = true;
    api.billingReceived(product.id).then((m) => alive && setReceived(m || {})).catch(() => {});
    return () => { alive = false; };
  }, [product?.id, version]);

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
    const total = fechadoOf(c);
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
    pagamento: (c) => { const pm = c.paymentMethod || leadById.get(c.leadId)?.paymentMethod; return pm ? paymentLabel(pm).toLowerCase() : null; },
    fechado: (c) => fechadoOf(c) || null,
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
  const [baseFilter, setBaseFilter] = useState("all"); // all | active | churned
  const churnedCount = customers.length - activeCustomers.length;
  const filteredCustomers = baseFilter === "active"
    ? sortedCustomers.filter((c) => !isChurned(c))
    : baseFilter === "churned"
      ? sortedCustomers.filter((c) => isChurned(c))
      : sortedCustomers;
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
  const pagamentoDe = (c) => c.paymentMethod || leadById.get(c.leadId)?.paymentMethod || "";
  const recebeAoLongo = (c) => !paymentUpfront(pagamentoDe(c)) || mainSub(c)?.cycle === "monthly";
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
    return { n: rows.length, total: rows.reduce((a, i) => a + (Number(i.amount) || 0), 0) };
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Clientes"
        sub={`${activeCustomers.length} ${activeCustomers.length === 1 ? "ativo" : "ativos"} · ${isKidsWorkspace ? `${money(totalContratado)} contratado` : `MRR ${money(totalMrr)}`}${!isKidsWorkspace && keyAccounts.length ? ` · ${money(coreMrr)} sem ${keyAccounts.length === 1 ? "a conta grande" : `as ${keyAccounts.length} contas grandes`}` : ""}`}>
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
            <CustomersAnalysis customers={customers} subs={subs} invoices={invoices} isKids={isKidsWorkspace} />

            {/* Contas grandes: ficha própria em vez de linha de tabela. A tabela
                é feita pra assinatura (plano, MRR, marco, vencimento) e um
                contrato bespoke deixa metade das colunas vazia — aqui aparece o
                que importa nele: quanto, desde quando, se pagou e qual o
                próximo toque. Clique abre a mesma ficha do cliente. */}
            {keyAccounts.length > 0 && (
              <Card title="Contas grandes"
                hint="fora das médias e das metas derivadas · o dinheiro segue contando em caixa e vendido">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(288px, 1fr))", gap: 12, padding: "14px var(--inset-x) 20px" }}>
                  {keyAccounts.map((c) => {
                    const nm = isMentoria(c) ? null : nextMilestone(withCycle(c), product);
                    const ps = payStatus(c);
                    const contato = String(c.contact || leadById.get(c.leadId)?.name || "").trim();
                    const fatos = [
                      ["Cliente desde", entradaLabel(c) ? `${entradaLabel(c)}${tenureLabel(c) ? ` · ${tenureLabel(c)}` : ""}` : "defina o início"],
                      ["Último contato", lastContact(c)],
                      ["Fechado por", (() => { const l = leadById.get(c.leadId); const who = l?.closer || l?.owner || c.owner; return who ? displayName(who) : "—"; })()],
                      ["Próximo marco", nm ? `${nm.label} · ${nm.status === "late" ? "venceu " : "vence "}${dueLabel(nm.dueAt)}` : "sem marco em aberto"],
                    ];
                    return (
                      <div key={c.id} onClick={() => setSel(c.id)}
                        style={{ border: "1px solid var(--accent-line)", borderRadius: "var(--r-3)", background: "var(--accent-soft)", padding: "14px 16px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <span title="conta grande" style={{ color: "var(--accent)", fontSize: 14, lineHeight: 1.2, flexShrink: 0 }}>★</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                            {contato && contato.toLowerCase() !== String(c.name || "").trim().toLowerCase() && (
                              <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 1 }}>{contato}</div>
                            )}
                          </div>
                          <Pill tone={ps.tone}>{ps.label}</Pill>
                        </div>
                        <div>
                          <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{money(fechadoOf(c))}</div>
                          <div className="kicker" style={{ marginTop: 3 }}>contrato fechado{c.plan ? ` · ${c.plan}` : ""}</div>
                        </div>
                        <div style={{ display: "grid", gap: 3 }}>
                          {fatos.map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, borderTop: "1px solid var(--line-faint)", paddingTop: 3 }}>
                              <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{k}</span>
                              <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {!isKidsWorkspace && (
              <Card title="Clientes por nível" hint="categoria (A/B/C…) da carteira ativa, pela grade do lead">
                {/* Contagem da carteira e, ao lado, a matriz que DEFINE o nível
                    (contas × anúncios): o resultado e a régua no mesmo bloco. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24, padding: "6px 24px 20px", alignItems: "flex-start" }}>
                <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexWrap: "wrap", gap: "10px 22px", alignItems: "center" }}>
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
                <NivelLegend />
                </div>
              </Card>
            )}

            <Card title="Próximas ações" hint="faturado e assinatura recorrente · vencidos primeiro">
              <div style={{ padding: "12px 0 8px" }}>
                {vencido.n > 0 && (
                  <div style={{ padding: "0 24px 10px", fontSize: 12, color: "var(--fg-3)" }}
                    title="Faturas em aberto com vencimento no passado (parcelas do faturado, mensalidades da assinatura recorrente e cobranças avulsas). Cada cliente entra na fila abaixo com a próxima dele.">
                    <b className="tnum" style={{ color: "var(--neg)" }}>{vencido.n}</b> {vencido.n === 1 ? "cobrança vencida" : "cobranças vencidas"} ·{" "}
                    <b className="tnum" style={{ color: "var(--neg)" }}>{money(vencido.total)}</b> parados
                  </div>
                )}
                {nextActions.length === 0 && (
                  <div style={{ padding: "8px 24px 16px", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
                    Nenhuma cobrança na fila: ninguém com fatura em aberto nem com ciclo pra virar.
                  </div>
                )}
                {(showAllActions ? nextActions : nextActions.slice(0, ACOES_FECHADAS)).map((a, i, shown) => {
                  const c = a.customer;
                  const linha = { display: "flex", alignItems: "center", gap: 12, padding: "11px 24px", cursor: "pointer", borderBottom: i === shown.length - 1 ? "none" : "1px solid var(--line-faint)" };
                  const dot = { width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: a.status === "late" ? "var(--neg)" : a.status === "soon" ? "var(--warn)" : "var(--fg-4)" };
                  const tone = a.status === "late" ? "neg" : a.status === "soon" ? "warn" : "mut";
                  const nome = { fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
                  const enter = (e) => { e.currentTarget.style.background = "var(--hover)"; };
                  const leave = (e) => { e.currentTarget.style.background = "transparent"; };
                  // O vencimento do faturado/recorrente vira toque de cobrança,
                  // com o WhatsApp do cliente do lado e a baixa aqui mesmo (não
                  // precisa abrir a ficha pra confirmar que o dinheiro entrou).
                  // Sem fatura ainda (ciclo por virar) não há o que baixar: a
                  // linha é o radar do que vem, e o botão só aparece quando a
                  // fatura existe.
                  const wa = waLink(c.phone || leadById.get(c.leadId)?.phone);
                  const inv = a.invoice || null;
                  const baixando = inv && payingId === inv.id;
                  return (
                    <div key={inv ? `cob_${inv.id}` : `sub_${c.id}`} onClick={() => setSel(c.id)} style={linha} onMouseEnter={enter} onMouseLeave={leave}>
                      <span style={dot} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={nome}>{c.name}</div>
                        <div style={{ fontSize: 12, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {inv
                            ? `Cobrar ${money(inv.amount)} · ${cobrancaDesc(inv, c)}`
                            : `${money(a.sub.price)} · ${proximaDesc(c)}`}
                        </div>
                      </div>
                      <Pill tone={tone}>{a.status === "late" ? "venceu " : "vence "}{dueLabel(a.dueAt)}</Pill>
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="abrir a conversa pra cobrar" style={ACAO_BTN}>WhatsApp</a>
                      )}
                      {inv && (
                        <button onClick={(e) => { e.stopPropagation(); payFromQueue(inv); }} disabled={baixando}
                          title="marcar como recebida (a mesma baixa da ficha do cliente)" style={ACAO_BTN}>
                          {baixando ? "…" : "dar baixa"}
                        </button>
                      )}
                    </div>
                  );
                })}
                {nextActions.length > ACOES_FECHADAS && (
                  <div style={{ padding: "12px 24px 8px", borderTop: "1px solid var(--line-1)" }}>
                    <button onClick={() => setShowAllActions((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>
                      {showAllActions ? "ver menos" : `ver mais (${nextActions.length - ACOES_FECHADAS})`}
                    </button>
                  </div>
                )}
              </div>
            </Card>

            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <Card style={{ overflow: "hidden", flex: "1 1 560px", minWidth: 0 }}>
              {/* Filtro Todos/Ativos/Churn: só existe quando há churn na base. */}
              {churnedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                  <Segmented value={baseFilter} onChange={setBaseFilter} options={[
                    { value: "all", label: `Todos (${customers.length})` },
                    { value: "active", label: `Ativos (${activeCustomers.length})` },
                    { value: "churned", label: `Churn (${churnedCount})` },
                  ]} />
                </div>
              )}
              <div className="tbl-x">
              <table style={{ width: "100%", minWidth: isKidsWorkspace ? 960 : isLeverads ? 1660 : 1480, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {(isKidsWorkspace
                      ? [["Cliente", "cliente"], ["Pacote", "plano"], ["Valor", "mrr"], ["Entrada", "entrada"], ["Tempo de casa", "casa"], ["Último contato", "contato"], ["Próxima consulta", null], ["Consultas", null]]
                      : [["Cliente", "cliente"], ["Nível", "nivel"], ["Plano", "plano"], ["MRR", "mrr"], ["Pagamento", "pagamento"], ["Status pgto.", "pgto"], ["Total fechado", "fechado"], ["Entrada", "entrada"], ["Tempo de casa", "casa"], ["Último contato", "contato"], ["Próximo marco", null], ["Assinatura", null], ["Vencimento", "venc"], ...(isLeverads ? [["Usuário LeverAds", "lever"]] : [])]
                    ).map(([h, k]) => (
                      <th key={h} className="kicker" title={k ? "ordenar" : undefined}
                        onClick={k ? () => setSort((s) => (s?.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 })) : undefined}
                        style={{ textAlign: (h === "MRR" || h === "Valor" || h === "Total fechado") ? "right" : "left", fontWeight: 600, color: sort?.key === k ? "var(--fg-2)" : "var(--fg-4)", padding: "12px 20px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", cursor: k ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
                        {h}{sort?.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                      </th>
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
                    // Linha de churnado fica esmaecida — visível, mas claramente fora da base ativa.
                    return (
                      <tr key={c.id} onClick={() => setSel(c.id)} style={{ cursor: "pointer", opacity: isChurned(c) ? 0.55 : 1 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        {/* Empresa + nome do contato (do cadastro; fallback no lead). Some quando é a mesma coisa. */}
                        <td style={{ padding: "14px 20px", fontSize: 13.5, fontWeight: 600, borderBottom: "1px solid var(--line-faint)" }}>
                          {isKeyAccount(c) && <span title="conta grande · fora das médias" style={{ color: "var(--accent)", marginRight: 5 }}>★</span>}
                          {c.name}
                          {(() => {
                            const contact = String(c.contact || leadById.get(c.leadId)?.name || "").trim();
                            return contact && contact.toLowerCase() !== String(c.name || "").trim().toLowerCase()
                              ? <div style={{ fontSize: 12, fontWeight: 400, color: "var(--fg-3)", marginTop: 2 }}>{contact}</div>
                              : null;
                          })()}
                        </td>
                        {/* Nível (categoria A/B/C…) do cliente, pela grade do lead. Só LeverAds. */}
                        {!isKidsWorkspace && (() => { const t = gradeOf(c); return (
                          <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                            {t.grade
                              ? <span title={t.label} style={{ width: 22, height: 22, borderRadius: 6, background: t.tone, color: t.badgeFg, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{t.grade}</span>
                              : <span style={{ fontSize: 13, color: "var(--fg-4)" }}>—</span>}
                          </td>
                        ); })()}
                        {/* Pacote (mentoria) × plano contratado (cadastro primeiro, assinatura como fallback) */}
                        <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {kids ? consultPackageLabel(j.total) : contractPlan(c) || "sem plano"}
                        </td>
                        {/* Mentoria é compra única: mostra o valor do contrato, não MRR */}
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, textAlign: "right", borderBottom: "1px solid var(--line-faint)" }}>
                          {money(kids ? (c.arr || 0) : (c.arr || 0) / 12)}
                        </td>
                        {/* Meio de pagamento (cliente > lead) e total já pago (faturas pagas). Só SaaS. */}
                        {!isKidsWorkspace && (() => {
                          const pm = c.paymentMethod || leadById.get(c.leadId)?.paymentMethod;
                          return (
                            <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                              {pm ? paymentLabel(pm) : <span style={{ color: "var(--fg-4)" }}>—</span>}
                            </td>
                          );
                        })()}
                        {/* Status pgto.: Pago / Parcial / Não pago. Clicar na pill abre um select invisível
                            por cima dela — marca na mão sem abrir o popup (o resto da linha segue abrindo). */}
                        {!isKidsWorkspace && (() => {
                          const ps = payStatus(c);
                          return (
                            <td style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-faint)" }}>
                              <span onClick={(e) => e.stopPropagation()} title={ps.hint} style={{ position: "relative", display: "inline-flex" }}>
                                <Pill tone={ps.tone}>{ps.label}</Pill>
                                <select value={ps.manual ? ps.key : ""}
                                  onChange={(e) => patchCustomer(c, { paymentStatus: e.target.value })}
                                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}>
                                  <option value="">automático · {PAY_STATUS[ps.auto].label}</option>
                                  <option value="paid">Pago</option>
                                  <option value="partial">Parcial</option>
                                  <option value="unpaid">Não pago</option>
                                </select>
                              </span>
                            </td>
                          );
                        })()}
                        {!isKidsWorkspace && (() => {
                          const fechado = fechadoOf(c);
                          const lead = leadById.get(c.leadId);
                          const rec = isRecurringClose(lead);
                          return (
                            <td className="tnum" title={rec ? `assinatura de ${money(Number(lead.amount) || 0)}/mês · acumulado desde o fechamento (+1 mensalidade a cada 30 dias)` : undefined}
                              style={{ padding: "14px 20px", fontSize: 13, textAlign: "right", color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>
                              {fechado > 0 ? money(fechado) : <span style={{ color: "var(--fg-4)" }}>—</span>}
                              {rec && fechado > 0 && <span style={{ fontSize: 11, color: "var(--fg-4)" }}> ↻</span>}
                            </td>
                          );
                        })()}
                        {/* Data de entrada (startedAt = "Cliente desde") */}
                        <td className="tnum" style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                          {entradaLabel(c) || <span style={{ color: "var(--fg-4)" }}>—</span>}
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
                            ? <span title={[c.churnReason ? churnReasonLabel(c.churnReason) : "", c.churnNote || ""].filter(Boolean).join(" · ") || "cliente saiu (churn)"}>
                                <Pill tone="neg">churn{c.endedAt ? ` ${fmtDay(parseDay(c.endedAt))}` : ""}</Pill>
                              </span>
                            : kids
                              ? <Pill tone={j.done >= j.total && j.items.length > 0 ? "pos" : j.done > 0 ? "warn" : "mut"}>{j.done} de {j.total}</Pill>
                              : st ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="mut">sem assinatura</Pill>}
                        </td>
                        {/* Vencimento da assinatura: fim do ciclo atual (mesma data do
                            "Ciclo atual até" da aba Assinaturas). Vencido e ainda ativa/em
                            atraso = fatura da renovação não caiu → vermelho. Só SaaS. */}
                        {!isKidsWorkspace && (() => {
                          const d = vencDate(c);
                          if (!d) return <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-4)", borderBottom: "1px solid var(--line-faint)" }}>—</td>;
                          const past = d.getTime() < Date.now();
                          return (
                            <td className="tnum" title="fim do ciclo atual da assinatura"
                              style={{ padding: "14px 20px", fontSize: 13, color: past ? "var(--neg)" : "var(--fg-2)", borderBottom: "1px solid var(--line-faint)", whiteSpace: "nowrap" }}>
                              {fmtDay(d)}
                              <div style={{ fontSize: 11, color: past ? "var(--neg)" : "var(--fg-4)" }}>{past ? "venceu " : "renova "}{dueLabel(d.toISOString())}</div>
                            </td>
                          );
                        })()}
                        {/* Usuário linkado no LeverAds (via customer.leveradsOrgId, o de-para
                            do sync de acesso). Sem match na lista de orgs (ou lista não
                            carregada), mostra o id cru. Só no workspace LeverAds. */}
                        {isLeverads && (() => {
                          if (!c.leveradsOrgId) return <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-4)", borderBottom: "1px solid var(--line-faint)" }}>—</td>;
                          const o = leverOrgOf(c);
                          return (
                            <td title={`org ${c.leveradsOrgId}`} style={{ padding: "14px 20px", fontSize: 13, color: "var(--fg-2)", borderBottom: "1px solid var(--line-faint)" }}>
                              {o ? (
                                <div style={{ minWidth: 0, maxWidth: 220 }}>
                                  <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.email || o.name || c.leveradsOrgId}</div>
                                  {o.email && o.name && <div style={{ fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</div>}
                                </div>
                              ) : (
                                <span className="mono" title="org sem match na lista (ou credencial LEVERADS_* ausente na API)" style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{c.leveradsOrgId}</span>
                              )}
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>mostrando {shownCustomers.length} de {filteredCustomers.length}</span>
                {filteredCustomers.length > 50 && <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>{showAll ? "Mostrar 50" : "Ver todos"}</button>}
              </div>
            </Card>
            </div>
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
          leverOrg={leverOrgOf(selected)}
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
// Legenda da classificação de nível (dentro do card "Clientes por nível"): a
// MESMA matriz que define a grade (GRADE_GRID de lib/ui.js) — contas de
// marketplace × anúncios na maior conta. Mais de cada = nível mais alto
// (S topo, E base).
function NivelLegend() {
  return (
    <div style={{ flex: "0 1 320px", minWidth: 260, border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-inset)", padding: "10px 12px" }}>
      <div className="kicker" style={{ marginBottom: 6 }}>Como o nível é definido</div>
      <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.45, marginBottom: 10 }}>
        Cruzamento de <b style={{ color: "var(--fg-2)" }}>contas de marketplace</b> (linha) × <b style={{ color: "var(--fg-2)" }}>anúncios na maior conta</b> (coluna). Quanto mais de cada, mais alto o nível (S no topo, E na base).
      </div>
      <div className="mono" style={{ fontSize: 8.5, color: "var(--fg-4)", textAlign: "center", marginBottom: 3, paddingLeft: 30 }}>anúncios →</div>
      <div style={{ display: "grid", gridTemplateColumns: "30px repeat(5, 1fr)", gap: 3, alignItems: "center" }}>
        <span />
        {GRADE_LISTINGS.map((l) => <span key={l} className="mono" style={{ fontSize: 8, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.1 }}>{l}</span>)}
        {GRADE_GRID.map((row, r) => (
          <React.Fragment key={r}>
            <span className="mono" style={{ fontSize: 9, color: "var(--fg-4)", textAlign: "right", paddingRight: 4, whiteSpace: "nowrap" }}>{GRADE_ACCOUNTS[r]}</span>
            {row.map((g, c) => {
              const s = GRADE_STYLE[g];
              return <span key={c} title={`${GRADE_ACCOUNTS[r]} conta(s) · ${GRADE_LISTINGS[c]} anúncios = ${s.label}`}
                style={{ height: 20, borderRadius: 4, background: s.tone, color: s.badgeFg, fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{g}</span>;
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 8.5, color: "var(--fg-4)", marginTop: 4 }}>↑ contas</div>
    </div>
  );
}

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
      <div className="kicker" style={{ marginBottom: 8 }}>Respostas do formulário</div>
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
        height: 28, padding: "0 8px", borderRadius: "var(--r-2)", fontSize: 11, fontWeight: 600, cursor: "pointer",
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

function CustomerFacts({ customer, lead, product, leverOrg, onPatch }) {
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
    // Recorrência: mostra a mensalidade E o acumulado (a régua dos 30 dias).
    ["Valor fechado", lead?.amount
      ? (isRecurringClose(lead)
        ? `${window.fmt.money(lead.amount)}/mês · acumulado ${window.fmt.money(accruedAmountOf(lead, { endAt: customer.endedAt }))}`
        : window.fmt.money(lead.amount))
      : null],
    ["Pagamento", (customer.paymentMethod || lead?.paymentMethod) ? paymentLabel(customer.paymentMethod || lead?.paymentMethod) : null],
    ["Status pgto.", PAY_STATUS[customer.paymentStatus] ? `${PAY_STATUS[customer.paymentStatus].label} (manual)` : null],
    // Usuário/org linkado no produto (de-para do sync de acesso); sem match na
    // lista de orgs, fica o id cru mesmo.
    ["Usuário LeverAds", customer.leveradsOrgId
      ? (leverOrg ? (leverOrg.email ? `${leverOrg.name} · ${leverOrg.email}` : leverOrg.name) : customer.leveradsOrgId)
      : null],
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
      <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
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
          <EditRow label="Status pgto.">
            <select value={PAY_STATUS[customer.paymentStatus] ? customer.paymentStatus : ""} onChange={(e) => patch({ paymentStatus: e.target.value })} style={inputSt}>
              <option value="">automático (dinheiro registrado decide)</option>
              <option value="paid">Pago</option>
              <option value="partial">Parcial</option>
              <option value="unpaid">Não pago</option>
            </select>
          </EditRow>
          <ValorContrato customer={customer} onPatch={patch} inputSt={inputSt} />
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
function CustomerModal({ customer, lead, product, subs, invoices, planLabel, lastContact, leverOrg, onComplete, onPatch, onClose }) {
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

  // Registrar upsell (trabalho de CS): cria uma fatura kind:"upsell" PAGA na data
  // informada — assim já entra no CAIXA pela régua existente e conta na meta de
  // upsell do CS (atribuída pelo dono do cliente). O bump do SSE recarrega a lista
  // de faturas sozinho (deps [product, version] no efeito da tela).
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
  const [churnOpen, setChurnOpen] = useState(false);
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

  const [upsellOpen, setUpsellOpen] = useState(false);
  const [upVal, setUpVal] = useState("");
  const [upDate, setUpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [upSaving, setUpSaving] = useState(false);
  async function saveUpsell() {
    const amount = Number(upVal);
    if (!(amount > 0) || !upDate || upSaving) return;
    setUpSaving(true);
    const at = new Date(`${upDate}T12:00:00`).toISOString();
    try {
      await api.create("invoices", {
        customer: customer.id, saas: customer.saas || product?.id || "",
        amount, kind: "upsell", status: "paid", dueDate: at, paidAt: at,
        createdAt: new Date().toISOString(),
      });
      setUpsellOpen(false); setUpVal("");
    } finally { setUpSaving(false); }
  }

  // Cobrança avulsa pelo Mercado Pago: fatura + link de pagamento anexados ao
  // cliente numa tacada (POST /charge). O link vai pro clipboard; a baixa é
  // automática quando o cliente pagar (webhook/poller casam pelo id da fatura).
  const mpOn = !!window.SEED?.CONFIG?.mp?.configured;
  // Cronograma do faturado (faturas kind:"installment"): marcar paga /
  // desmarcar por parcela. O override local dá o feedback imediato; o SSE
  // recarrega a lista de verdade logo depois (deps [product, version]).
  const [invOverride, setInvOverride] = useState({});
  const [invBusy, setInvBusy] = useState("");
  const invStatus = (i) => invOverride[i.id] || i.status;
  async function toggleParcela(i) {
    if (invBusy) return;
    setInvBusy(i.id);
    try {
      if (invStatus(i) === "paid") {
        const r = await api.unpayInvoice(i.id);
        setInvOverride((o) => ({ ...o, [i.id]: r?.status || "open" }));
      } else {
        await api.payInvoice(i.id);
        setInvOverride((o) => ({ ...o, [i.id]: "paid" }));
      }
    } catch (e) {
      window.toast && window.toast(e?.message || "não deu pra atualizar a parcela", "neg");
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
      const t = String(customer.plan || "").toLowerCase();
      const planClosed = t.includes("semestral") ? "semestral" : t.includes("anual") ? "anual" : t.includes("mensal") ? "mensal" : "";
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
  async function saveCharge() {
    const amount = Number(chVal);
    if (!(amount > 0) || chSaving) return;
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
    try {
      const r = await api.invoiceMpLink(inv.id);
      await copyLink(r.url, "link criado e copiado");
      refresh();
    } catch (err) { flashFin(err.message || "MP recusou o link"); }
  }

  const summary = isKids ? [
    { label: "Pacote", value: consultPackageLabel(consultTotal) },
    { label: "Tempo de casa", value: tenureLabel(customer) || "defina o início" },
    { label: "Último contato", value: lastContact(customer) },
    { label: "Consultas", value: `${consultDone} de ${consultTotal} feitas` },
  ] : [
    { label: "Plano", value: customer.plan || (mainSub ? planLabel(mainSub) : "sem plano") },
    { label: "Tempo de casa", value: tenureLabel(customer) || "defina o início" },
    { label: "Último contato", value: lastContact(customer) },
    { label: "Assinatura", value: st ? st.label : "sem assinatura" },
    // Vencimento = fim do ciclo atual; pausada/cancelada não tem ciclo correndo.
    ...(mainSub && (mainSub.status === "active" || mainSub.status === "past_due") && parseDay(mainSub.periodEnd)
      ? [{ label: "Vencimento", value: fmtDay(parseDay(mainSub.periodEnd)) }]
      : []),
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
            {!editing && !churned && (
              <button onClick={() => setChurnOpen((v) => !v)}
                title="Registrar a saída deste cliente (churn): data + motivo. Cancela as assinaturas em aberto (espelha no Mercado Pago quando vinculadas) e tira o cliente do MRR e da base ativa — o histórico e o valor do contrato ficam registrados."
                style={{ height: 30, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid color-mix(in srgb, var(--neg) 40%, transparent)", background: "var(--bg-1)", color: "var(--neg)", fontSize: 12.5, flexShrink: 0 }}>
                {churnOpen ? "cancelar" : "registrar churn"}
              </button>
            )}
            {!editing && (
              <button onClick={() => setEditing(true)} style={{ height: 30, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, flexShrink: 0 }}>Editar</button>
            )}
            <button onClick={onClose} aria-label="Fechar" style={{ height: 30, width: 30, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 14, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginTop: 14 }}>
            {summary.map((s) => (
              <div key={s.label}>
                <div className="kicker">{s.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
          {(customer.flags || []).length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {customer.flags.map((f) => <Pill key={f} tone="warn">{f}</Pill>)}
            </div>
          )}
          {/* Faixa de churn: o cliente saiu — quando, por quê e o desfazer. */}
          {churned && (
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
                style={{ marginLeft: "auto", height: 24, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11, flexShrink: 0, opacity: chuSaving ? 0.5 : 1 }}>
                {chuSaving ? "…" : "desfazer churn"}
              </button>
            </div>
          )}
          {/* Painel do registrar churn: data (padrão hoje) + motivo + observação. */}
          {churnOpen && !churned && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)" }}>
              <span className="mono dim" style={{ fontSize: 10.5 }}>saída</span>
              <input type="date" value={chuDate} onChange={(e) => setChuDate(e.target.value)}
                style={{ height: 28, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--mono)" }} />
              <select value={chuReason} onChange={(e) => setChuReason(e.target.value)}
                style={{ height: 28, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: chuReason ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12.5 }}>
                <option value="">motivo…</option>
                {CHURN_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <input type="text" value={chuNote} onChange={(e) => setChuNote(e.target.value)} placeholder="observação (opcional)"
                onKeyDown={(e) => e.key === "Enter" && saveChurn()}
                style={{ height: 28, flex: "1 1 160px", minWidth: 130, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }} />
              <button onClick={saveChurn} disabled={chuSaving || !chuDate}
                style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "none", background: "var(--neg)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: chuSaving || !chuDate ? 0.5 : 1 }}>
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
              onClose={() => setEditing(false)}
              onSaved={async () => { await refresh(); setEditing(false); }}
            />
          </div>
        )}

        {!editing && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <CustomerFacts customer={customer} lead={lead} product={product} leverOrg={leverOrg} onPatch={onPatch ? (p) => onPatch(customer, p) : null} />

        {/* Respostas do formulário (campos do lead) — editáveis daqui; mudou o
            nicho/contas/anúncios, o Potencial e o Nível recalculam. Só quando
            há lead com perguntas (mentoria/produto B2C sem grade não mostra). */}
        {!isKids && <FormAnswersCard lead={lead} product={product} onPatch={patchLead} />}

        {/* Mentoria não é recorrência: pra cliente Kids o bloco de assinaturas
            sai (o pagamento fica em Dados do cliente e nas faturas). */}
        {!isKids && (
        <div style={BOX}>
          <div className="kicker" style={{ marginBottom: 8 }}>Assinaturas</div>
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
                {lead && !paymentUpfront(customer.paymentMethod || lead.paymentMethod) && (
                  <select value={String(totalN)} disabled={nSaving} onChange={(e) => changeParcelamento(e.target.value)}
                    title="Mudar o parcelamento refaz as parcelas em aberto; as pagas ficam como estão"
                    style={{ height: 22, padding: "0 4px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11 }}>
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
                          title={i.mpInitPoint ? "copiar o link de pagamento desta parcela" : "gerar o link de pagamento desta parcela no Mercado Pago"}
                          style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 10.5 }}>
                          {i.mpInitPoint ? "copiar link" : "link MP"}
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
          if (paymentUpfront(pm) || paymentRecurring(pm)) return null;
          return (
            <div style={BOX}>
              <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Parcelas do faturado</span>
                <select value="" disabled={nSaving} onChange={(e) => e.target.value && changeParcelamento(e.target.value)}
                  title="Gera o cronograma (vencimento mensal a partir do fechamento) pra marcar cada parcela como paga"
                  style={{ marginLeft: "auto", height: 22, padding: "0 4px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11 }}>
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
            <button onClick={() => setUpsellOpen((v) => !v)}
              title="Registrar um upsell (venda extra pra um cliente atual). Vira fatura paga: entra no caixa e conta na meta de upsell do CS."
              style={{ marginLeft: "auto", height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
              {upsellOpen ? "cancelar" : "+ upsell"}
            </button>
            {mpOn && (
              <button onClick={() => setChargeOpen((v) => !v)}
                title="Gerar uma cobrança pelo Mercado Pago: cria a fatura e o link de pagamento anexado ao cliente. A baixa é automática quando pagar."
                style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid var(--accent-line, var(--line-2))", background: "var(--bg-1)", color: "var(--accent)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
                {chargeOpen ? "cancelar" : "+ cobrança"}
              </button>
            )}
            <button onClick={revertWin} disabled={reverting}
              title="Avançou errado? Desfaz o fechamento: remove ESTE cliente, a assinatura e as faturas automáticas, limpa o carimbo de venda e devolve o card do lead pro funil. As métricas (ganho do mês, MRR, caixa) descontam sozinhas. Cobrança real do Mercado Pago bloqueia o desfazer."
              style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid color-mix(in srgb, var(--neg) 40%, transparent)", background: "var(--bg-1)", color: "var(--neg)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
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
                className="tnum" style={{ height: 28, width: 96, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, textAlign: "right" }} />
              <input type="text" value={chTitle} onChange={(e) => setChTitle(e.target.value)} placeholder="descrição (aparece no checkout)"
                onKeyDown={(e) => e.key === "Enter" && saveCharge()}
                style={{ height: 28, flex: "1 1 150px", minWidth: 120, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }} />
              <label className="mono dim" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                até
                <select value={chInst} onChange={(e) => setChInst(e.target.value)}
                  style={{ height: 28, padding: "0 4px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12 }}>
                  {[1, 2, 3, 6, 10, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
                </select>
              </label>
              <button onClick={saveCharge} disabled={!(Number(chVal) > 0) || chSaving}
                style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: !(Number(chVal) > 0) || chSaving ? 0.5 : 1 }}>
                {chSaving ? "gerando…" : "gerar link"}
              </button>
            </div>
          )}
          {upsellOpen && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "2px 0 10px" }}>
              <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus value={upVal}
                onChange={(e) => setUpVal(e.target.value)} placeholder="valor"
                onKeyDown={(e) => e.key === "Enter" && saveUpsell()}
                className="tnum" style={{ height: 28, width: 96, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, textAlign: "right" }} />
              <input type="date" value={upDate} onChange={(e) => setUpDate(e.target.value)}
                style={{ height: 28, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--mono)" }} />
              <button onClick={saveUpsell} disabled={!(Number(upVal) > 0) || upSaving}
                style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: !(Number(upVal) > 0) || upSaving ? 0.5 : 1 }}>
                {upSaving ? "salvando…" : "registrar"}
              </button>
            </div>
          )}
          {invoices.filter((i) => i.kind !== "installment").slice(0, 6).map((i) => (
            <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--fg-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.dueDate ? new Date(i.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : ""} · {i.title || i.kind || "fatura"}
                {/* como o dinheiro entrou de verdade (carimbado pela baixa do MP) */}
                {i.status === "paid" && mpMethodLabel(i) ? <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}> · {mpMethodLabel(i)}</span> : null}
              </span>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {mpOn && i.status !== "paid" && (
                  <button onClick={() => invoiceLink(i)}
                    title={i.mpInitPoint ? "copiar o link de pagamento desta fatura" : "gerar o link de pagamento desta fatura no Mercado Pago"}
                    style={{ height: 20, padding: "0 8px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--accent)", fontSize: 10.5 }}>
                    {i.mpInitPoint ? "copiar link" : "link MP"}
                  </button>
                )}
                <span className="tnum mono" style={{ fontWeight: 500 }}>{money(i.amount || 0)}</span>
                <Pill tone={i.status === "paid" ? "pos" : i.status === "overdue" ? "neg" : "warn"}>
                  {i.status === "paid" ? "paga" : i.status === "overdue" ? "vencida" : "aberta"}
                </Pill>
              </span>
            </div>
          ))}
          {invoices.filter((i) => i.kind !== "installment").length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>{parcelas.length ? "Nenhuma fatura além das parcelas." : "Nenhuma fatura ainda."}</div>
          )}
        </div>

        {/* Inbox do WhatsApp conectado: a MESMA conversa da tela #whatsapp,
            pra mandar mensagem pro cliente sem sair do popup. */}
        <WhatsappChat lead={lead} phone={customer.phone} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {isKids ? (
        <div style={BOX}>
          <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center" }}>
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
          <div className="kicker" style={{ marginBottom: 8 }}>Ações de retenção</div>
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

        <CustomerContracts customer={customer} onClose={onClose} />

        <CustomerHistory customer={customer} />
        </div>
        </div>
        </div>
        )}
      </div>
    </div>
  );
}

// Contratos gerados PRA ESTE CLIENTE: o mesmo histórico da tela Contratos,
// filtrado pelo vínculo que a geração carimba (contract_issues.customerId). É a
// resposta de "o que esse cliente já assinou" sem sair da ficha. Só leitura —
// gerar e excluir registro continuam na tela Contratos, onde o modelo mora; a
// reimpressão sai do SNAPSHOT (corpo + valores do dia), não do modelo atual.
function CustomerContracts({ customer, onClose }) {
  const [rows, setRows] = React.useState(null);
  const [err, setErr] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    setRows(null); setErr(false); setExpanded(false);
    api.list("contract_issues", { customer: customer.id })
      .then((r) => { if (alive) setRows([...(r || [])].sort(byIssuedDesc)); })
      .catch((e) => { console.warn("contratos do cliente não carregaram:", e.message); if (alive) { setRows([]); setErr(true); } });
    return () => { alive = false; };
  }, [customer.id]);
  const shown = expanded ? (rows || []) : (rows || []).slice(0, 5);
  return (
    <div style={BOX}>
      <div className="kicker" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span>Contratos gerados</span>
        {rows && rows.length > 0 && <span className="mono dim tnum" style={{ fontSize: 10 }}>{rows.length}</span>}
        <button onClick={() => { onClose && onClose(); window.location.hash = "contracts"; }}
          style={{ marginLeft: "auto", height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
          abrir Contratos ↗
        </button>
      </div>
      {rows === null && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
      {err && <div style={{ fontSize: 12.5, color: "var(--neg)" }}>Não deu pra carregar os contratos deste cliente · reabra a ficha pra tentar de novo.</div>}
      {rows && !err && rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
          Nenhum contrato gerado pra este cliente. Gere na tela Contratos (escolhendo o cliente) que ele aparece aqui.
        </div>
      )}
      {shown.map((i) => (
        <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13, flexWrap: "wrap" }}>
          <span className="mono dim tnum" style={{ fontSize: 11, flexShrink: 0 }}>{issueDate(i.createdAt)}</span>
          <span style={{ color: "var(--fg-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.name}>{i.name}</span>
          {String(i.values?.valor_total || "").trim() && (
            <span className="mono tnum" style={{ fontSize: 11.5, color: "var(--fg-3)", flexShrink: 0 }}>R$ {String(i.values.valor_total).trim()}</span>
          )}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {i.author && <span className="mono dim" style={{ fontSize: 10 }}>{displayName(i.author)}</span>}
            <button onClick={() => { if (!printContract(i, i.values)) window.toast && window.toast("O navegador bloqueou a janela de impressão · libere o popup deste site", "neg"); }}
              title="reimprimir o contrato exatamente como foi gerado"
              style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-1)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11 }}>
              Imprimir / PDF
            </button>
          </span>
        </div>
      ))}
      {rows && rows.length > shown.length && (
        <button onClick={() => setExpanded(true)} className="mono" style={{ fontSize: 11, color: "var(--accent)", padding: "6px 0" }}>
          +{rows.length - shown.length} mais
        </button>
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
      <div className="kicker" style={{ marginBottom: 8 }}>
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
