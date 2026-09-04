// Sucesso do cliente (telas Clientes, Contratos e Análise de Integração).
//
// A API guarda a carteira crua: `customers` tem arr ANUAL, startedAt, endedAt e
// pouco mais. Tudo que o time realmente lê — MRR, MRR do núcleo (sem conta
// grande), status de pagamento, quanto o cliente TROUXE, tempo de casa, próximo
// marco de retenção, quando o contrato vence e a fila de cobrança — é junção
// feita no React (customers.jsx, customers-analysis.jsx, lib/milestones.js).
// Fora da tela esses números não existiam: pelo MCP dava pra ler o documento
// cru e recontar errado.
//
// Este módulo refaz as MESMAS réguas do front, com uma regra: churn é endedAt no
// passado (churn.js), arr é anual e o dinheiro recebido vem de
// /api/billing/received (que conta só FATO: MP aprovado + fatura baixada).
// Quem muda receita (churn, unchurn, desfazer venda) passa pela rota oficial —
// gravar endedAt na mão pula o cancelamento das assinaturas no Mercado Pago.

import { z } from "zod";
import { http } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const DAY = 86_400_000;

const UNITS = {
  arr: "BRL", mrr: "BRL", mrrCore: "BRL", mrrKeyAccounts: "BRL", mrrPerdido: "BRL", mrrEmRisco: "BRL",
  mrrEmRenovacao: "BRL", mrrPerdido90d: "BRL", mrrDevolvido: "BRL", mrrRemovido: "BRL", mrrDetratores: "BRL",
  contratado: "BRL", recebido: "BRL", aReceber: "BRL", ticketMedio: "BRL", mensalMedio: "BRL",
  ltv: "BRL", valor: "BRL", amount: "BRL", vencido: "BRL", aVencer: "BRL", upsellRevenue: "BRL",
  churnPct: "%", retencaoPct: "%", share: "%", nps: "pontos (-100 a 100)", score: "0-10", mediaNota: "0-10",
  health: "0-100", tenureDays: "dias", diasSemContato: "dias", diasParaVencer: "dias", vidaMediaMeses: "meses",
  diasAguardando: "dias", esperaMaisAntigaDias: "dias",
};

// ── Réguas copiadas do produto (mantê-las iguais) ────────────────────────────

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : null; };
const dia = (v) => (v ? String(v).slice(0, 10) : "");
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// churn.js: churnado = endedAt no PASSADO. O arr fica congelado como histórico.
const isChurned = (c, at = Date.now()) => { const t = ms(c?.endedAt); return t != null && t <= at; };

const CHURN_LABEL = {
  sem_resultado: "Não viu resultado", preco: "Preço / corte de custos",
  fechou_operacao: "Fechou ou pausou a operação", concorrente: "Trocou por concorrente",
  inadimplencia: "Inadimplência", fim_contrato: "Fim do contrato (não renovou)",
  mp_cancel: "Assinatura cancelada no Mercado Pago", outro: "Outro",
};
const churnLabel = (r) => CHURN_LABEL[r] || String(r || "");

// lib/payments.js: `upfront` = a empresa recebeu tudo no fechamento (à vista,
// cartão 12x que a adquirente antecipa). Meio fora do catálogo = condição
// personalizada, que conta só o que ENTROU.
const PAY_METHOD = {
  pix: { label: "PIX à vista", upfront: true },
  pix_parcelado: { label: "PIX parcelado", upfront: false },
  boleto_vista: { label: "Boleto à vista", upfront: true },
  boleto: { label: "Boleto faturado", upfront: false },
  cartao12x: { label: "Cartão de crédito 12x", upfront: true },
  cartao_recorrente: { label: "Assinatura recorrente (cartão)", upfront: false, recurring: true },
};
const paymentLabel = (id) => PAY_METHOD[id]?.label || String(id || "");
const paymentUpfront = (id) => (!id ? true : PAY_METHOD[id] ? PAY_METHOD[id].upfront !== false : false);
const paymentRecurring = (id) => !!PAY_METHOD[id]?.recurring;

// Fechamento MENSAL acumula: cada 30 dias desde a venda soma outra mensalidade
// (o churn para o relógio). É o denominador do status de pagamento.
function accruedAmount(lead, endedAt, now = Date.now()) {
  const base = num(lead?.amount);
  if (!lead || lead.planClosed !== "mensal") return base;
  const start = ms(lead.wonAt || lead.stageSince);
  if (start == null) return base;
  const fim = ms(endedAt);
  const stop = Math.min(fim != null ? fim : now, now);
  return base * (1 + Math.max(0, Math.floor((stop - start) / (30 * DAY))));
}

// lib/milestones.js: régua de pós-venda por tempo de casa + contato de
// renovação 60 dias antes do fim do contrato.
const DEFAULT_MILESTONES = [
  { key: "onboarding", label: "Onboarding", dueDays: 7 },
  { key: "checkin_m1", label: "Check-in de mês 1", dueDays: 30 },
  { key: "revisao_m3", label: "Revisão de resultado", dueDays: 90 },
  { key: "upsell_m6", label: "Conversa de upsell", dueDays: 180 },
];
const RENEWAL_LEAD_DAYS = 60;
const CYCLE_DAYS = { monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };
const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
// "único" e "consulta" = jornada finita, sem contrato correndo → sem renovação.
const PLAN_HINTS = [["consulta", 0], ["único", 0], ["unico", 0], ["mensal", 30], ["trimestral", 91], ["semestral", 182], ["anual", 365]];

function contractDays(customer, cycle) {
  const plan = String(customer?.plan || "").toLowerCase();
  for (const [hint, days] of PLAN_HINTS) if (plan.includes(hint)) return days;
  return CYCLE_DAYS[cycle] || 365;
}

function milestonesFor(customer, product, cycle, now = Date.now()) {
  const start = ms(customer?.startedAt);
  if (start == null) return [];
  const done = customer.milestonesDone || {};
  const base = Array.isArray(product?.milestones) && product.milestones.length ? product.milestones : DEFAULT_MILESTONES;
  const dias = contractDays(customer, cycle);
  const template = dias > RENEWAL_LEAD_DAYS && !base.some((m) => m.key === "renovacao")
    ? [...base, { key: "renovacao", label: "Contato de renovação", dueDays: dias - RENEWAL_LEAD_DAYS }]
    : base;
  return template
    .map((m) => {
      const dueAt = start + num(m.dueDays) * DAY;
      const doneAt = done[m.key] || null;
      return {
        key: m.key, label: m.label, dueAt: dia(new Date(dueAt).toISOString()), doneAt: dia(doneAt),
        status: doneAt ? "done" : dueAt <= now ? "late" : dueAt - now <= 7 * DAY ? "soon" : "next",
      };
    })
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
}

// Nível A/B/C do cliente = grade do lead de origem (mesma matriz do
// leadGrade da API e do leadTier da web: contas × anúncios).
const GRADE_ACCOUNTS = { "1": 0, "2": 1, "3-5": 2, "6-10": 3, "10+": 4 };
const GRADE_LISTINGS = { "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, "10000+": 4 };
const GRADE_VOLUME = { "0-10": 0, "10-50": 1, "50-200": 2, "200+": 3 };
const GRADE_GRID = [
  ["E", "D", "C", "C", "C"], ["D", "C", "C", "B", "B"], ["C", "B", "B", "A", "A"],
  ["B", "B", "A", "S", "S"], ["A", "A", "A", "S", "S"],
];
function leadGrade(l) {
  const acc = GRADE_ACCOUNTS[l?.accounts];
  const ads = l?.listings != null && l.listings !== "" ? GRADE_LISTINGS[l.listings] : GRADE_VOLUME[l?.volume];
  if (acc == null && ads == null) return null;
  return GRADE_GRID[acc ?? 0][ads ?? 0];
}

// Banda de saúde do filtro `?band=` da API (sobre customer.health).
const bandOf = (c) => (num(c.health) < 50 ? "red" : num(c.health) < 70 ? "yellow" : "green");

// Bucket de plano da Análise da base.
function planBucket(plan) {
  const t = String(plan || "").toLowerCase();
  const pack = t.match(/(\d+)\s*consulta/);
  if (pack) return `Mentoria · ${pack[1]} consultas`;
  if (t.includes("único") || t.includes("unico")) return "Serviço único";
  if (t.includes("semestral")) return "Semestral";
  if (t.includes("trimestral")) return "Trimestral";
  if (t.includes("mensal")) return "Mensal";
  if (t.includes("anual")) return "Anual";
  return "sem plano";
}

// Divide o ARR entre o que JÁ entrou e o que ainda vai entrar, somando sempre ao
// contratado. Cronograma explícito de parcelas vence a heurística do meio de
// pagamento; churnado não gera dinheiro futuro. (customers-analysis.jsx)
function cashSplit(c, invoicesOf, now) {
  const annual = num(c.arr);
  if (annual <= 0) return { cash: 0, future: 0 };
  const schedule = invoicesOf.filter((i) => i.kind === "installment");
  if (schedule.length) {
    const cash = round2(schedule.filter((i) => i.status === "paid").reduce((a, i) => a + num(i.amount), 0));
    const future = isChurned(c, now) ? 0 : round2(schedule.filter((i) => i.status !== "paid").reduce((a, i) => a + num(i.amount), 0));
    return { cash, future };
  }
  const start = ms(c.startedAt) ?? now;
  const fim = ms(c.endedAt);
  const stop = fim != null ? Math.min(fim, now) : now;
  const monthsIn = Math.max(1, Math.floor((stop - start) / (30 * DAY)) + 1);
  const t = String(c.plan || "").toLowerCase();
  let cash;
  if (paymentUpfront(c.paymentMethod)) {
    if (t.includes("semestral")) cash = (annual / 2) * Math.min(2, Math.floor((monthsIn - 1) / 6) + 1);
    else if (t.includes("mensal")) cash = (annual / 12) * Math.min(12, monthsIn);
    else cash = annual;
  } else {
    cash = (annual / 12) * Math.min(12, monthsIn);
  }
  cash = Math.min(annual, cash);
  return { cash: round2(cash), future: isChurned(c, now) ? 0 : round2(annual - cash) };
}

// ── Carga da carteira (uma junção, várias tools) ─────────────────────────────

async function carteira(product, { received = true, leads = true } = {}) {
  const id = product.id;
  const [customers, subs, invoices, plans, allLeads, recebido] = await Promise.all([
    http.get("/api/customers", { saas: id }),
    http.get("/api/subscriptions", { saas: id }),
    http.get("/api/invoices", { saas: id }),
    http.get("/api/plans", { saas: id }).catch(() => []),
    leads ? http.get("/api/leads").catch(() => []) : Promise.resolve([]),
    received ? http.get(`/api/billing/received/${encodeURIComponent(id)}`).catch(() => ({})) : Promise.resolve({}),
  ]);
  const leadById = new Map((allLeads || []).map((l) => [l.id, l]));
  const planName = new Map((plans || []).map((p) => [p.id, p.name]));
  const subsBy = new Map();
  for (const s of subs || []) {
    if (!subsBy.has(s.customer)) subsBy.set(s.customer, []);
    subsBy.get(s.customer).push(s);
  }
  const invBy = new Map();
  for (const i of invoices || []) {
    if (!invBy.has(i.customer)) invBy.set(i.customer, []);
    invBy.get(i.customer).push(i);
  }
  return {
    product, customers: customers || [], subs: subs || [], invoices: invoices || [],
    recebido: recebido || {}, leadById, planName, subsBy, invBy, now: Date.now(),
  };
}

// A linha do cliente como a tela mostra: junta assinatura, lead de origem,
// dinheiro recebido e a régua de marcos num registro plano.
function linhaCliente(c, ctx) {
  const now = ctx.now;
  const lead = c.leadId ? ctx.leadById.get(c.leadId) : null;
  const subsOf = ctx.subsBy.get(c.id) || [];
  const main = subsOf.find((s) => s.status === "active" || s.status === "past_due") || subsOf[0] || null;
  const pm = c.paymentMethod || lead?.paymentMethod || "";
  const contratado = round2(accruedAmount(lead, c.endedAt, now) || num(c.arr));
  const caixa = round2(num(ctx.recebido[c.id]));
  // À vista/cartão 12x: o contrato inteiro entrou no fechamento. Faturado,
  // parcelado e recorrente: só o que caiu de verdade.
  const recebido = paymentUpfront(pm) ? contratado : caixa;
  const auto = contratado > 0 && caixa >= contratado * 0.98 ? "paid" : caixa > 0 ? "partial" : paymentUpfront(pm) ? "unpaid" : "partial";
  const manual = ["paid", "partial", "unpaid"].includes(c.paymentStatus) ? c.paymentStatus : "";
  const churned = isChurned(c, now);
  const marcos = churned ? [] : milestonesFor(c, ctx.product, main?.cycle, now);
  const marco = marcos.find((m) => m.status !== "done") || null;
  const start = ms(c.startedAt);
  const contatoAt = lead?.lastActivityAt || c.lastContactAt || "";
  const contatoT = ms(contatoAt);
  const dias = contractDays(c, main?.cycle);
  return {
    id: c.id,
    name: c.name || "",
    company: c.company || "",
    contact: c.contact || "",
    email: c.email || "",
    phone: c.phone || "",
    nivel: leadGrade(lead) || "",
    plan: c.plan || (main ? (ctx.planName.get(main.plan) || CYCLE_LABEL[main.cycle] || main.cycle || "") : ""),
    arr: num(c.arr),
    mrr: round2(num(c.arr) / 12),
    keyAccount: !!c.keyAccount,
    paymentMethod: pm ? paymentLabel(pm) : "",
    paymentStatus: manual || auto,
    statusOrigem: manual ? "manual" : "automático",
    contratado,
    recebido,
    startedAt: dia(c.startedAt),
    tenureDays: start != null ? Math.max(0, Math.floor((Math.min(ms(c.endedAt) ?? now, now) - start) / DAY)) : null,
    diasSemContato: contatoT != null ? Math.max(0, Math.floor((now - contatoT) / DAY)) : null,
    subStatus: main?.status || "",
    subCiclo: CYCLE_LABEL[main?.cycle] || main?.cycle || "",
    vencimento: main && (main.status === "active" || main.status === "past_due") ? dia(main.periodEnd) : "",
    contratoAte: !churned && start != null && dias > 0 ? dia(new Date(start + dias * DAY).toISOString()) : "",
    proximoMarco: marco?.label || "",
    marcoVence: marco?.dueAt || "",
    marcoStatus: marco?.status || "",
    churned,
    endedAt: dia(c.endedAt),
    churnMotivo: churned ? churnLabel(c.churnReason) : "",
    churnOrigem: churned ? c.churnSource || "" : "",
    owner: c.owner || c.csm || "",
    leadId: c.leadId || "",
    leveradsOrgId: c.leveradsOrgId || "",
    health: num(c.health),
    band: bandOf(c),
    nps: num(c.nps),
    _marcos: marcos,
    _subs: subsOf,
    _lead: lead,
    _pm: pm,
  };
}

const semInternos = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")));

const COLS_CARTEIRA = [
  "name", "nivel", "plan", "mrr", "arr", "paymentMethod", "paymentStatus", "contratado", "recebido",
  "startedAt", "tenureDays", "diasSemContato", "subStatus", "vencimento", "proximoMarco", "marcoStatus",
  "churned", "endedAt", "keyAccount", "owner", "id",
];

// Nota que muda a leitura de qualquer número de saúde: o campo existe, mas
// nada no produto escreve nele.
const NOTA_HEALTH = "customer.health e customer.nps NÃO são calculados por nenhuma rotina do produto: ficam em 0 salvo escrita manual. Toda banda 'red' pode ser só campo vazio — trate risco pelos sinais (fatura vencida, past_due, silêncio, sentimento da integração), não pela banda.";
const NOTA_ARR = "arr é o valor ANUAL do contrato; mrr = arr/12. Cliente churnado sai do MRR e da contagem de ativos, mas o arr fica congelado como histórico.";
const NOTA_RECEBIDO = "recebido conta só FATO: pagamento aprovado no Mercado Pago + fatura baixada (a fatura que nasce paga no fechamento fica fora). Contrato à vista/cartão 12x aparece cheio porque a adquirente antecipa.";

async function resolveCustomer(alvo, saas) {
  const chave = String(alvo || "").trim();
  if (!chave) throw new Error("informe `customer` (id ou nome do cliente).");
  try {
    const c = await http.get(`/api/customers/${encodeURIComponent(chave)}`);
    if (c && c.id) return c;
  } catch { /* não era id: cai na busca por nome */ }
  // `saas` chega como o usuário escreveu ("LeverAds") e o filtro da API compara
  // com o ID exato: sem resolver antes, o recorte devolve vazio e o cliente
  // certo vira "não encontrado".
  const produto = saas ? await resolveProduct(saas).catch(() => null) : null;
  const todos = await http.get("/api/customers", produto ? { saas: produto.id } : undefined);
  const n = norm(chave);
  const hits = (todos || []).filter((c) => norm(c.name).includes(n) || norm(c.company).includes(n));
  if (!hits.length) throw new Error(`cliente "${chave}" não encontrado — use customers_list para achar o id.`);
  if (hits.length > 1) throw new Error(`"${chave}" casa com ${hits.length} clientes (${hits.slice(0, 5).map((c) => `${c.name} [${c.id}]`).join(", ")}) — passe o id.`);
  return hits[0];
}

export function registerCustomersTools(tool) {
  const GRUPO = "Clientes (Customer Success)";

  tool("customers_list", {
    group: GRUPO,
    title: "Carteira de clientes",
    description: "Carteira: MRR/ARR, MRR do núcleo (sem contas grandes), status de pagamento, tempo de casa, próximo marco, vencimento e churn.",
    input: {
      saas: z.string().optional().describe("padrão: o único produto cadastrado"),
      status: z.enum(["active", "churned", "all"]).optional().describe("padrão active; os totais sempre somam ativos e churnados"),
      key_accounts: z.enum(["include", "exclude", "only"]).optional().describe("padrão include"),
      owner: z.string().optional().describe("user id do CS/integrador dono"),
      band: z.enum(["red", "yellow", "green"]).optional().describe("banda de health; campo quase nunca alimentado"),
      payment_status: z.enum(["paid", "partial", "unpaid"]).optional(),
      q: z.string().optional(),
      sort: z.string().optional().describe('campo:asc|desc, padrão "mrr:desc"'),
      limit: z.number().int().optional().describe("padrão 50"),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "active", key_accounts = "include", owner, band, payment_status, q, sort = "mrr:desc", limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const ctx = await carteira(product);
    const todas = ctx.customers.map((c) => linhaCliente(c, ctx));

    const ativos = todas.filter((r) => !r.churned);
    const core = ativos.filter((r) => !r.keyAccount);
    const key = ativos.filter((r) => r.keyAccount);
    const soma = (rows, campo) => round2(rows.reduce((a, r) => a + num(r[campo]), 0));

    let rows = todas;
    if (status === "active") rows = rows.filter((r) => !r.churned);
    if (status === "churned") rows = rows.filter((r) => r.churned);
    if (key_accounts === "exclude") rows = rows.filter((r) => !r.keyAccount);
    if (key_accounts === "only") rows = rows.filter((r) => r.keyAccount);
    if (owner) rows = rows.filter((r) => norm(r.owner) === norm(owner));
    if (band) rows = rows.filter((r) => r.band === band);
    if (payment_status) rows = rows.filter((r) => r.paymentStatus === payment_status);

    const s = select(rows.map(semInternos), { q, qFields: ["name", "company", "contact", "email", "id"], sort, limit, offset });

    const contar = (rows2, campo) => {
      const m = new Map();
      for (const r of rows2) m.set(r[campo] || "—", (m.get(r[campo] || "—") || 0) + 1);
      return [...m.entries()].map(([k, n]) => ({ valor: k, clientes: n })).sort((a, b) => b.clientes - a.clientes);
    };
    const niveis = contar(ativos.map((r) => ({ nivel: r.nivel || "sem nível" })), "nivel");

    return result({
      kind: "customers.list",
      title: `Carteira · ${product.name || product.id}`,
      scope: { saas: product.id, status, key_accounts, owner: owner || null, band: band || null },
      units: UNITS,
      totals: {
        clientes: todas.length,
        ativos: ativos.length,
        churnados: todas.length - ativos.length,
        mrr: round2(soma(ativos, "arr") / 12),
        mrrCore: round2(soma(core, "arr") / 12),
        mrrKeyAccounts: round2(soma(key, "arr") / 12),
        arr: soma(ativos, "arr"),
        keyAccounts: key.length,
        recebido: soma(ativos, "recebido"),
        ticketMedio: ativos.length ? round2(soma(ativos, "arr") / ativos.length) : 0,
      },
      columns: COLS_CARTEIRA,
      rows: s.rows,
      rowsLabel: "Clientes",
      page: s.page,
      tables: {
        niveis: { label: "Clientes ativos por nível (grade do lead)", columns: ["valor", "clientes"], rows: niveis },
        planos: { label: "Clientes ativos por plano", columns: ["valor", "clientes"], rows: contar(ativos.map((r) => ({ plano: planBucket(r.plan) })), "plano") },
        pagamento: { label: "Status de pagamento (ativos)", columns: ["valor", "clientes"], rows: contar(ativos, "paymentStatus") },
      },
      notes: [
        NOTA_ARR, NOTA_RECEBIDO,
        "MRR do núcleo exclui as contas grandes (★): um contrato único de seis dígitos não é receita recorrente.",
        band ? NOTA_HEALTH : "",
        "o filtro `band` do servidor ANULA o filtro por produto — aqui a banda é aplicada localmente, sobre o produto pedido.",
      ].filter(Boolean),
      source: { endpoint: "GET /api/customers + subscriptions + invoices + billing/received" },
    });
  });

  tool("customer_get", {
    group: GRUPO,
    title: "Ficha do cliente",
    description: "Ficha de um cliente: cadastro, lead de origem, contratado × recebido × a receber, assinaturas, faturas, pagamentos do Mercado Pago, marcos, contratos, NPS e timeline.",
    input: {
      customer: z.string().describe("id ou nome do cliente"),
      saas: z.string().optional(),
      include_timeline: z.boolean().optional().describe("padrão true"),
      timeline_limit: z.number().int().optional().describe("padrão 20"),
    },
  }, async ({ customer, saas, include_timeline = true, timeline_limit = 20 }) => {
    const c = await resolveCustomer(customer, saas);
    const product = await resolveProduct(c.saas || saas);
    const vazio = () => [];
    const [subs, invoices, mp, issues, forms, nps, atividades, consultas, manuais, recebido, lead] = await Promise.all([
      http.get("/api/subscriptions", { customer: c.id }).catch(vazio),
      http.get("/api/invoices", { customer: c.id }).catch(vazio),
      http.get("/api/mp/payments", { customer: c.id, status: "approved" }).catch(() => ({ payments: [] })),
      http.get("/api/contract_issues", { customer: c.id }).catch(vazio),
      http.get("/api/integration_forms", { customer: c.id }).catch(vazio),
      http.get("/api/nps", { saas: c.saas }).catch(vazio),
      include_timeline && c.leadId ? http.get("/api/activities", { lead: c.leadId }).catch(vazio) : Promise.resolve([]),
      http.get("/api/consultations").catch(vazio),
      http.get("/api/deliverables").catch(vazio),
      http.get(`/api/billing/received/${encodeURIComponent(c.saas)}`).catch(() => ({})),
      c.leadId ? http.get(`/api/leads/${encodeURIComponent(c.leadId)}`).catch(() => null) : Promise.resolve(null),
    ]);

    const ctx = {
      product, now: Date.now(), recebido, planName: new Map(),
      leadById: new Map(lead ? [[lead.id, lead]] : []),
      subsBy: new Map([[c.id, subs]]), invBy: new Map([[c.id, invoices]]),
    };
    const r = linhaCliente(c, ctx);
    const split = cashSplit(c, invoices, ctx.now);
    const mpPays = (mp?.payments || []).filter((p) => p.customer === c.id);
    const minhas = (consultas || []).filter((x) => (x.customerId && x.customerId === c.id) || (c.leadId && x.leadId === c.leadId));
    const manual = (manuais || []).find((m) => (m.customerId && m.customerId === c.id) || (c.leadId && m.leadId === c.leadId)) || null;

    const tables = {
      assinaturas: { label: "Assinaturas", columns: ["id", "status", "cycle", "price", "periodStart", "periodEnd", "mpPreapprovalId"], rows: subs },
      faturas: (() => {
        const f = select(invoices, { sort: "dueDate:desc", limit: 60 });
        return {
          label: `Faturas (${f.page.returned} de ${f.page.total})`,
          columns: ["id", "kind", "title", "amount", "status", "dueDate", "paidAt", "mpPaymentId"],
          rows: f.rows,
        };
      })(),
      // Só as colunas do dinheiro: o espelho do MP guarda e-mail, nome e CPF/CNPJ
      // do pagador, e nada disso precisa sair daqui pra ler a ficha.
      pagamentos_mp: {
        label: "Pagamentos aprovados no Mercado Pago",
        columns: ["mpId", "amount", "method", "installments", "dateApproved"],
        rows: mpPays.map((p) => ({ mpId: p.mpId, amount: num(p.amount), method: p.method || "", installments: num(p.installments), dateApproved: p.dateApproved || "" })),
      },
      marcos: { label: "Ações de retenção (marcos)", columns: ["key", "label", "dueAt", "status", "doneAt"], rows: r._marcos },
      contratos: { label: "Contratos gerados", columns: ["id", "name", "tag", "createdAt", "author"], rows: (issues || []).map((i) => ({ id: i.id, name: i.name, tag: i.tag, createdAt: i.createdAt, author: i.author })) },
      formularios: { label: "Formulário de integração", columns: ["id", "status", "createdAt", "respondedAt", "respondente"], rows: (forms || []).map((f) => ({ id: f.id, status: f.status, createdAt: f.createdAt, respondedAt: f.respondedAt, respondente: f.respondent?.name || "" })) },
      nps: { label: "Respostas de NPS deste cliente", columns: ["score", "role", "tags", "text"], rows: (nps || []).filter((n) => n.customer === c.id) },
    };
    if (minhas.length || manual) {
      // `summary` é o objeto do resumo por IA — despejado inteiro vira JSON
      // truncado na tabela; aqui sai só a frase que resume a consulta.
      tables.consultas = {
        label: `Jornada de consultas (mentoria) · ${Math.min(minhas.length, 30)} de ${minhas.length}`,
        columns: ["n", "status", "at", "packageTotal", "resumo"],
        rows: select(minhas, { sort: "n", limit: 30 }).rows
          .map((x) => ({ n: num(x.n), status: x.status || "", at: x.at || "", packageTotal: num(x.packageTotal), resumo: x.summary?.resumo || "" })),
      };
      if (manual) tables.manual = { label: `Manual da Família (${manual.status})`, columns: ["key", "title", "preenchida", "updatedAt"], rows: (manual.sections || []).map((s2) => ({ key: s2.key, title: s2.title, preenchida: !!String(s2.content || "").trim(), updatedAt: s2.updatedAt })) };
    }
    if (include_timeline && atividades?.length) {
      tables.timeline = {
        label: "Histórico do funil (lead de origem)",
        columns: ["at", "type", "author", "text"],
        rows: select(atividades, { sort: "at:desc", limit: timeline_limit }).rows.map((a) => ({ at: a.at, type: a.type, author: a.author, text: String(a.text || "").slice(0, 200) })),
      };
    }

    return result({
      kind: "customers.get",
      title: `Cliente · ${c.name || c.id}`,
      scope: { saas: c.saas, customer: c.id, lead: c.leadId || null },
      units: UNITS,
      totals: {
        arr: r.arr, mrr: r.mrr, contratado: r.contratado, recebido: r.recebido,
        aReceber: split.future, paymentStatus: r.paymentStatus, statusOrigem: r.statusOrigem,
        tenureDays: r.tenureDays, churned: r.churned,
      },
      detail: {
        cadastro: semInternos(r),
        churn: r.churned ? { endedAt: c.endedAt, motivo: churnLabel(c.churnReason), nota: c.churnNote || "", origem: c.churnSource || "", por: c.churnedBy || "" } : null,
        origem: lead ? {
          leadId: lead.id, nome: lead.name, empresa: lead.company, source: lead.source,
          nivel: leadGrade(lead) || "", planoFechado: lead.planClosed || "", valorFechado: num(lead.amount),
          meioPagamento: paymentLabel(lead.paymentMethod), sdr: lead.owner || "", closer: lead.closer || "",
          integrador: lead.integrator || "", ganhoEm: dia(lead.wonAt), ultimaAtividade: lead.lastActivityAt || "",
        } : null,
        leverads: c.leveradsOrgId ? { orgId: c.leveradsOrgId } : null,
      },
      tables,
      notes: [NOTA_ARR, NOTA_RECEBIDO, "o link público do formulário de integração é /fi/<id> — o id É o token, trate como segredo (o documento guarda CPF/CNPJ, IP e assinatura eletrônica)."],
      source: { endpoint: `GET /api/customers/${c.id} (+ subscriptions, invoices, mp/payments, contract_issues, integration_forms, nps, activities)` },
    });
  });

  tool("customers_analysis", {
    group: GRUPO,
    title: "Análise da base",
    description: "KPIs da base no período: contratado, recebido, a receber, clientes novos, ticket médio, mensal médio, churn % e LTV, com mix de planos e as entradas e saídas.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      compare: z.boolean().optional().describe("período anterior, padrão true"),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, period, since, until, compare = true, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const ctx = await carteira(product, { leads: false });
    const now = ctx.now;

    const janela = (j) => {
      const de = Date.parse(`${j.since}T00:00:00-03:00`);
      const ate = Math.min(Date.parse(`${j.until}T23:59:59-03:00`), now);
      const dentro = (iso) => { const t = ms(iso); return t != null && t >= de && t <= ate; };
      const cohort = ctx.customers.filter((c) => dentro(c.startedAt));
      const churned = ctx.customers.filter((c) => c.endedAt && dentro(c.endedAt));
      const contratado = round2(cohort.reduce((a, c) => a + num(c.arr), 0));
      let caixa = 0, futuro = 0;
      for (const c of cohort) {
        const s = cashSplit(c, ctx.invBy.get(c.id) || [], now);
        caixa += s.cash; futuro += s.future;
      }
      const comArr = cohort.filter((c) => num(c.arr) > 0);
      const mensalMedio = comArr.length ? round2(comArr.reduce((a, c) => a + num(c.arr) / 12, 0) / comArr.length) : 0;
      const baseInicio = ctx.customers.filter((c) => {
        const s = ms(c.startedAt) ?? 0;
        const e = ms(c.endedAt) ?? Infinity;
        return s < de && e >= de;
      }).length;
      const churnPct = baseInicio > 0 ? round2((churned.length / baseInicio) * 100) : null;
      const meses = Math.max((ate - de) / (30 * DAY), 1);
      const churnMensal = churnPct != null ? churnPct / 100 / meses : null;
      const vidaMeses = churnMensal > 0 ? round2(1 / churnMensal) : null;
      return {
        cohort, churned,
        kpis: {
          contratado, recebido: round2(caixa), aReceber: round2(futuro),
          clientesNovos: cohort.length,
          ticketMedio: cohort.length ? round2(contratado / cohort.length) : 0,
          mensalMedio,
          saidas: churned.length,
          baseInicio,
          churnPct,
          mrrPerdido: round2(churned.reduce((a, c) => a + num(c.arr) / 12, 0)),
          vidaMediaMeses: vidaMeses,
          ltv: vidaMeses != null && mensalMedio > 0 ? round2(mensalMedio * vidaMeses) : null,
        },
      };
    };

    const atual = janela(p);
    const anterior = compare ? janela(p.previous) : null;

    const mix = new Map();
    for (const c of atual.cohort) {
      const sub = (ctx.subsBy.get(c.id) || []).find((s) => s.status === "active" || s.status === "past_due") || (ctx.subsBy.get(c.id) || [])[0];
      const b = planBucket(CYCLE_LABEL[sub?.cycle] || c.plan || "");
      mix.set(b, (mix.get(b) || 0) + 1);
    }
    const totalMix = atual.cohort.length || 1;

    const tables = {
      novos: {
        label: "Clientes novos no período",
        columns: ["name", "startedAt", "arr", "mrr", "plan", "paymentMethod", "id"],
        rows: select(atual.cohort.map((c) => ({
          name: c.name, startedAt: dia(c.startedAt), arr: num(c.arr), mrr: round2(num(c.arr) / 12),
          plan: c.plan || "", paymentMethod: paymentLabel(c.paymentMethod), id: c.id,
        })), { sort: "arr:desc", limit }).rows,
      },
      saidas: {
        label: "Saídas no período (churn)",
        columns: ["name", "endedAt", "motivo", "origem", "arr", "mrrPerdido", "tenureDays", "id"],
        rows: select(atual.churned.map((c) => ({
          name: c.name, endedAt: dia(c.endedAt), motivo: churnLabel(c.churnReason), origem: c.churnSource || "",
          arr: num(c.arr), mrrPerdido: round2(num(c.arr) / 12),
          tenureDays: ms(c.startedAt) != null ? Math.max(0, Math.floor(((ms(c.endedAt) ?? now) - ms(c.startedAt)) / DAY)) : null,
          id: c.id,
        })), { sort: "mrrPerdido:desc", limit }).rows,
      },
      planos: {
        label: "Mix de planos dos clientes novos",
        columns: ["bucket", "clientes", "share"],
        rows: [...mix.entries()].map(([bucket, n]) => ({ bucket, clientes: n, share: round2((n / totalMix) * 100) })).sort((a, b) => b.clientes - a.clientes),
      },
      motivos: {
        label: "Motivos de churn no período",
        columns: ["motivo", "saidas", "mrrPerdido"],
        rows: (() => {
          const m = new Map();
          for (const c of atual.churned) {
            const k = churnLabel(c.churnReason) || "sem motivo";
            const e = m.get(k) || { motivo: k, saidas: 0, mrrPerdido: 0 };
            e.saidas += 1; e.mrrPerdido = round2(e.mrrPerdido + num(c.arr) / 12);
            m.set(k, e);
          }
          return [...m.values()].sort((a, b) => b.saidas - a.saidas);
        })(),
      },
    };

    if (anterior) {
      tables.comparativo = {
        label: `Comparativo vs ${p.previous.since} → ${p.previous.until}`,
        columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
        rows: ["contratado", "recebido", "clientesNovos", "ticketMedio", "mensalMedio", "saidas", "churnPct"]
          .map((k) => {
            const d = delta(atual.kpis[k], anterior.kpis[k]);
            return d && { metrica: k, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
          }).filter(Boolean),
      };
    }

    return result({
      kind: "customers.analysis",
      title: `Análise da base · ${product.name || product.id}`,
      scope: { saas: product.id },
      period: p,
      units: UNITS,
      totals: atual.kpis,
      tables,
      notes: [
        NOTA_ARR,
        "clientes novos = startedAt na janela; churn = endedAt na janela ÷ base ativa no INÍCIO da janela.",
        "recebido/a receber saem do cronograma de parcelas quando existe (faturas kind=installment) e, sem ele, da heurística do meio de pagamento — não é extrato bancário.",
        atual.kpis.ltv == null ? "sem churn na janela não existe divisor: LTV e vida média ficam nulos (não são zero)." : "LTV = preço mensal médio ÷ churn mensal (churn da janela diluído nos meses dela).",
      ],
      source: { endpoint: "GET /api/customers + subscriptions + invoices" },
    });
  });

  tool("customers_renewals", {
    group: GRUPO,
    title: "Cobranças e renovações",
    description: "Fila de cobrança por cliente (vencidos primeiro), contratos vencendo no horizonte e marcos de retenção atrasados.",
    input: {
      saas: z.string().optional(),
      days_ahead: z.number().int().optional().describe("dias, padrão 90"),
      include: z.array(z.enum(["cobranca", "renovacoes", "marcos"])).optional().describe("padrão todos"),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, days_ahead = 90, include, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const ctx = await carteira(product);
    const now = ctx.now;
    const inc = new Set(include?.length ? include : ["cobranca", "renovacoes", "marcos"]);
    const linhas = ctx.customers.map((c) => linhaCliente(c, ctx));
    const byId = new Map(linhas.map((r) => [r.id, r]));
    // Cliente de mentoria fica fora da cobrança: o pós-venda dele é a jornada
    // de consultas, não boleto.
    const elegivel = (r) => !r.churned && product.id !== "uniquekids";

    const fila = new Map();
    for (const i of ctx.invoices) {
      if (i.status !== "open" && i.status !== "overdue") continue;
      const due = ms(i.dueDate);
      const r = byId.get(i.customer);
      if (due == null || !r || !elegivel(r)) continue;
      const atual = fila.get(r.id);
      if (!atual || due < atual._due) {
        fila.set(r.id, {
          _due: due, cliente: r.name, tipo: i.kind || "fatura", descricao: i.title || i.kind || "fatura",
          valor: num(i.amount), vence: dia(i.dueDate), invoice: i.id, telefone: r.phone, customer: r.id,
        });
      }
    }
    for (const r of linhas) {
      if (!elegivel(r) || fila.has(r.id)) continue;
      const sub = r._subs.find((s) => s.status === "active" || s.status === "past_due");
      const due = ms(sub?.periodEnd);
      if (due == null) continue;
      fila.set(r.id, {
        _due: due, cliente: r.name, tipo: "ciclo",
        descricao: paymentRecurring(r._pm) ? "próxima mensalidade · assinatura recorrente" : "próxima cobrança do contrato",
        valor: num(sub.price), vence: dia(sub.periodEnd), invoice: null, telefone: r.phone, customer: r.id,
      });
    }
    // Contrato pago de uma vez (anual à vista) só entra quando venceu ou está
    // a 7 dias: a renovação dele não é rotina de cobrança. Quem recebe AO LONGO
    // (faturado, parcelado, recorrente ou ciclo mensal) aparece sempre.
    const recebeAoLongo = (r) => !!r && (!paymentUpfront(r._pm) || r._subs.some((s) => s.cycle === "monthly" && (s.status === "active" || s.status === "past_due")));
    const cobrancas = [...fila.values()].map((x) => {
      const dias = Math.round((x._due - now) / DAY);
      return { ...x, diasParaVencer: dias, status: dias <= 0 ? "vencida" : dias <= 7 ? "vence em breve" : "próxima" };
    })
      .filter((x) => x.status !== "próxima" || recebeAoLongo(byId.get(x.customer)))
      .sort((a, b) => a._due - b._due)
      .map(({ _due, ...rest }) => rest);

    const vencidas = ctx.invoices.filter((i) => {
      if (i.status !== "open" && i.status !== "overdue") return false;
      const due = ms(i.dueDate);
      const r = byId.get(i.customer);
      return due != null && due <= now && r && elegivel(r);
    });

    const renovacoes = linhas
      .filter((r) => !r.churned && r.contratoAte)
      .map((r) => {
        const fim = ms(r.contratoAte);
        const contato = fim - RENEWAL_LEAD_DAYS * DAY;
        return {
          cliente: r.name, plan: r.plan, arr: r.arr, mrr: r.mrr, startedAt: r.startedAt,
          contratoAte: r.contratoAte, contatoRenovacaoEm: dia(new Date(contato).toISOString()),
          diasParaVencer: Math.round((fim - now) / DAY), subStatus: r.subStatus, customer: r.id,
          status: contato <= now ? "contato atrasado" : fim - now <= days_ahead * DAY ? "na janela" : "futuro",
        };
      })
      .filter((r) => r.diasParaVencer <= days_ahead)
      .sort((a, b) => a.diasParaVencer - b.diasParaVencer);

    const marcos = linhas.flatMap((r) => r._marcos
      .filter((m) => m.status === "late" || m.status === "soon")
      .map((m) => ({ cliente: r.name, marco: m.label, vence: m.dueAt, status: m.status, diasParaVencer: Math.round((ms(m.dueAt) - now) / DAY), owner: r.owner, customer: r.id })))
      .sort((a, b) => a.diasParaVencer - b.diasParaVencer);

    const tables = {};
    if (inc.has("cobranca")) {
      const s = select(cobrancas, { limit });
      tables.cobranca = { label: "Fila de cobrança (uma linha por cliente, vencidos primeiro)", columns: ["cliente", "descricao", "valor", "vence", "diasParaVencer", "status", "tipo", "invoice", "customer"], rows: s.rows, page: s.page };
    }
    if (inc.has("renovacoes")) {
      const s = select(renovacoes, { limit });
      tables.renovacoes = { label: `Contratos que vencem em até ${days_ahead} dias`, columns: ["cliente", "plan", "mrr", "arr", "startedAt", "contratoAte", "contatoRenovacaoEm", "diasParaVencer", "status", "subStatus", "customer"], rows: s.rows, page: s.page };
    }
    if (inc.has("marcos")) {
      const s = select(marcos, { limit });
      tables.marcos = { label: "Marcos de retenção atrasados ou vencendo", columns: ["cliente", "marco", "vence", "diasParaVencer", "status", "owner", "customer"], rows: s.rows, page: s.page };
    }

    return result({
      kind: "customers.renewals",
      title: `Cobranças e renovações · ${product.name || product.id}`,
      scope: { saas: product.id, horizonteDias: days_ahead },
      units: UNITS,
      totals: {
        cobrancasVencidas: vencidas.length,
        vencido: round2(vencidas.reduce((a, i) => a + num(i.amount), 0)),
        aVencer: round2(cobrancas.filter((c) => c.diasParaVencer > 0 && c.diasParaVencer <= 7).reduce((a, c) => a + num(c.valor), 0)),
        contratosVencendo: renovacoes.length,
        mrrEmRenovacao: round2(renovacoes.reduce((a, r) => a + num(r.mrr), 0)),
        marcosAtrasados: marcos.filter((m) => m.status === "late").length,
      },
      notes: [
        product.id === "uniquekids"
          ? "a mentoria fica FORA da fila de cobrança por regra (o pós-venda dela é a jornada de consultas): a fila vazia aqui não significa que não há nada a cobrar."
          : "",
        "a fila mostra só a PRÓXIMA cobrança de cada cliente; o total vencido soma TODAS as faturas em aberto no passado.",
        "contrato sem plano legível assume anual (365 dias); planos 'único' e pacotes de consulta não geram renovação.",
        "o contato de renovação é o marco de 60 dias antes do fim do contrato.",
      ].filter(Boolean),
      tables,
      source: { endpoint: "GET /api/customers + subscriptions + invoices" },
    });
  });

  tool("customers_health", {
    group: GRUPO,
    title: "Saúde e risco",
    description: "Radar de risco por cliente (fatura vencida, past_due, marco atrasado, silêncio, sentimento em risco) com MRR em risco, bandas, NPS e churn recente.",
    input: {
      saas: z.string().optional(),
      silence_days: z.number().int().optional().describe("dias sem contato que viram sinal, padrão 45"),
      min_signals: z.number().int().optional().describe("padrão 1"),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, silence_days = 45, min_signals = 1, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const ctx = await carteira(product);
    const now = ctx.now;
    // Sinais externos são bônus: sem eles o radar ainda vale.
    const [integracao, npsRows] = await Promise.all([
      http.get(`/api/integrations/${encodeURIComponent(product.id)}/summary`).catch(() => null),
      http.get("/api/nps", { saas: product.id }).catch(() => []),
    ]);
    const riscoPorLead = new Map();
    for (const r of integracao?.recent || []) if (r.sentimento === "em risco") riscoPorLead.set(r.leadId, r);
    const npsPorCliente = new Map();
    for (const n of npsRows || []) if (n.customer) npsPorCliente.set(n.customer, n);

    const linhas = ctx.customers.map((c) => linhaCliente(c, ctx));
    const ativos = linhas.filter((r) => !r.churned);

    const contadores = { faturaVencida: 0, assinaturaPastDue: 0, marcoAtrasado: 0, semContato: 0, integracaoEmRisco: 0, detrator: 0 };
    const rows = [];
    for (const r of ativos) {
      const sinais = [];
      const vencidas = (ctx.invBy.get(r.id) || []).filter((i) => (i.status === "open" || i.status === "overdue") && ms(i.dueDate) != null && ms(i.dueDate) <= now);
      if (vencidas.length) { sinais.push(`${vencidas.length} fatura(s) vencida(s) · R$ ${round2(vencidas.reduce((a, i) => a + num(i.amount), 0))}`); contadores.faturaVencida++; }
      if (r._subs.some((s) => s.status === "past_due")) { sinais.push("assinatura em atraso (past_due)"); contadores.assinaturaPastDue++; }
      const atrasado = r._marcos.find((m) => m.status === "late");
      if (atrasado) { sinais.push(`marco atrasado: ${atrasado.label} (venceu ${atrasado.dueAt})`); contadores.marcoAtrasado++; }
      if (r.diasSemContato != null && r.diasSemContato >= silence_days) { sinais.push(`${r.diasSemContato} dias sem contato`); contadores.semContato++; }
      const call = r.leadId ? riscoPorLead.get(r.leadId) : null;
      if (call) { sinais.push(`call de integração com sentimento "em risco" (${dia(call.at)})`); contadores.integracaoEmRisco++; }
      const nps = npsPorCliente.get(r.id);
      if (nps && num(nps.score) <= 6) { sinais.push(`NPS detrator (${num(nps.score)})`); contadores.detrator++; }
      if (sinais.length >= Math.max(1, min_signals)) {
        rows.push({
          cliente: r.name, mrr: r.mrr, arr: r.arr, sinais: sinais.length, motivos: sinais.join(" · "),
          diasSemContato: r.diasSemContato, subStatus: r.subStatus, paymentStatus: r.paymentStatus,
          owner: r.owner, phone: r.phone, customer: r.id,
        });
      }
    }
    rows.sort((a, b) => b.sinais - a.sinais || b.mrr - a.mrr);

    const bandas = ["red", "yellow", "green"].map((b) => ({ banda: b, clientes: ativos.filter((r) => r.band === b).length }));
    const churn90 = linhas.filter((r) => r.churned && ms(r.endedAt) != null && now - ms(r.endedAt) <= 90 * DAY);
    const s = select(rows, { limit });

    const scores = (npsRows || []).map((n) => num(n.score));
    const prom = scores.filter((x) => x >= 9).length;
    const det = scores.filter((x) => x <= 6).length;

    return result({
      kind: "customers.health",
      title: `Saúde e risco · ${product.name || product.id}`,
      scope: { saas: product.id, silence_days },
      units: UNITS,
      totals: {
        ativos: ativos.length,
        clientesComSinal: rows.length,
        mrrEmRisco: round2(rows.reduce((a, r) => a + num(r.mrr), 0)),
        ...contadores,
        churn90d: churn90.length,
        mrrPerdido90d: round2(churn90.reduce((a, r) => a + num(r.mrr), 0)),
        nps: scores.length ? Math.round(((prom - det) / scores.length) * 100) : null,
        respostasNps: scores.length,
        integracoesResumidas: integracao?.count ?? null,
      },
      columns: ["cliente", "mrr", "sinais", "motivos", "diasSemContato", "subStatus", "paymentStatus", "owner", "phone", "customer"],
      rows: s.rows,
      rowsLabel: "Clientes com sinal de risco",
      page: s.page,
      tables: {
        bandas: { label: "Distribuição por banda de saúde (customer.health)", columns: ["banda", "clientes"], rows: bandas },
        churn_recente: { label: "Saídas nos últimos 90 dias", columns: ["name", "endedAt", "churnMotivo", "churnOrigem", "mrr"], rows: churn90.map(semInternos), units: UNITS },
        sentimento_integracao: { label: "Sentimento das calls de integração", rows: integracao ? [integracao.sentimento] : [] },
      },
      notes: [
        NOTA_HEALTH,
        "MRR em risco é a soma do MRR de quem tem ao menos um sinal — é exposição, não perda prevista.",
        integracao ? "" : "não consegui ler a análise de integração deste produto: o sinal de sentimento ficou de fora.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/customers + invoices + subscriptions + /api/integrations/${product.id}/summary + /api/nps` },
    });
  });

  tool("customer_update", {
    group: GRUPO,
    title: "Editar cadastro do cliente",
    description: "Atualiza o cadastro de um cliente; para registrar saída use customer_churn (endedAt é recusado aqui).",
    write: true,
    danger: "mexer em `arr` re-escreve o valor do fechamento no lead e pode refazer a assinatura e o cronograma de parcelas.",
    hint: "confira o id com customers_list; o cliente precisa existir no produto informado.",
    input: {
      customer: z.string().describe("id ou nome do cliente"),
      saas: z.string().optional(),
      name: z.string().optional(),
      company: z.string().optional(),
      contact: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      plan: z.string().optional().describe("texto livre: anual, semestral, mensal, serviço único…"),
      arr: z.number().optional().describe("valor ANUAL em R$ (mensalidade × 12)"),
      payment_method: z.string().optional().describe("pix, pix_parcelado, boleto_vista, boleto, cartao12x, cartao_recorrente ou condição escrita"),
      payment_status: z.enum(["paid", "partial", "unpaid", ""]).optional().describe('override manual; "" volta pro automático'),
      started_at: z.string().optional().describe("cliente desde: ISO ou YYYY-MM-DD"),
      key_account: z.boolean().optional().describe("conta grande: sai do MRR do núcleo"),
      owner: z.string().optional().describe("user id do CS/integrador"),
      csm: z.string().optional(),
      leverads_org_id: z.string().optional().describe("ids em leverads_access action=orgs"),
      flags: z.array(z.string()).optional(),
      milestone_done: z.string().optional().describe("onboarding, checkin_m1, revisao_m3, upsell_m6 ou renovacao; conclui hoje"),
      fields: z.record(z.any()).optional().describe("merge de campos fora da lista; endedAt é recusado"),
    },
  }, async (args) => {
    const c = await resolveCustomer(args.customer, args.saas);
    const patch = {};
    const mapa = {
      name: "name", company: "company", contact: "contact", email: "email", phone: "phone",
      plan: "plan", arr: "arr", payment_method: "paymentMethod", payment_status: "paymentStatus",
      started_at: "startedAt", key_account: "keyAccount", owner: "owner", csm: "csm",
      leverads_org_id: "leveradsOrgId", flags: "flags",
    };
    for (const [arg, campo] of Object.entries(mapa)) if (args[arg] !== undefined) patch[campo] = args[arg];
    if (args.fields) {
      if ("endedAt" in args.fields || "churnReason" in args.fields) {
        throw new Error("churn não se grava por aqui: use customer_churn (cancela as assinaturas e espelha no Mercado Pago) ou customer_unchurn.");
      }
      Object.assign(patch, args.fields);
    }
    if (args.milestone_done) {
      patch.milestonesDone = { ...(c.milestonesDone || {}), [args.milestone_done]: new Date().toISOString() };
    }
    if (!Object.keys(patch).length) throw new Error("nada para atualizar: informe ao menos um campo.");
    const saved = (await http.patch(`/api/customers/${encodeURIComponent(c.id)}`, patch)) || {};
    return result({
      kind: "customers.update",
      title: `Cliente atualizado · ${saved.name || c.id}`,
      scope: { saas: saved.saas, customer: c.id },
      units: UNITS,
      totals: { arr: num(saved.arr), mrr: round2(num(saved.arr) / 12), campos: Object.keys(patch).join(", ") },
      detail: { antes: Object.fromEntries(Object.keys(patch).map((k) => [k, c[k] ?? null])), depois: Object.fromEntries(Object.keys(patch).map((k) => [k, saved[k] ?? null])) },
      notes: "arr" in patch ? ["o valor anual foi espelhado no fechamento do lead e pode ter refeito assinatura/parcelas — confira com customer_get."] : [],
      source: { endpoint: `PATCH /api/customers/${c.id}` },
    });
  });

  tool("customer_churn", {
    group: GRUPO,
    title: "Registrar saída do cliente",
    description: "Registra a saída pelo caminho oficial: data, motivo e cancelamento das assinaturas em aberto; o cliente sai do MRR.",
    write: true, destructive: true, external: true,
    danger: "cancela cobrança REAL no Mercado Pago (para de cobrar o cliente), tira receita do MRR e avisa o time no Discord na primeira marcação.",
    hint: "cliente já churnado? re-marcar só corrige data/motivo. Para desfazer, customer_unchurn.",
    input: {
      customer: z.string().describe("id ou nome do cliente"),
      saas: z.string().optional(),
      ended_at: z.string().optional().describe("ISO ou YYYY-MM-DD, padrão agora"),
      reason: z.string().optional().describe("sem_resultado, preco, fechou_operacao, concorrente, inadimplencia, fim_contrato, outro ou texto livre"),
      note: z.string().optional(),
    },
  }, async ({ customer, saas, ended_at, reason = "", note = "" }) => {
    const c = await resolveCustomer(customer, saas);
    const r = (await http.post(`/api/customers/${encodeURIComponent(c.id)}/churn`, { endedAt: ended_at || "", reason, note })) || {};
    return result({
      kind: "customers.churn",
      title: `Churn registrado · ${c.name || c.id}`,
      scope: { saas: c.saas, customer: c.id },
      units: UNITS,
      totals: {
        endedAt: dia(r.customer?.endedAt), motivo: churnLabel(r.customer?.churnReason),
        mrrPerdido: round2(num(c.arr) / 12), assinaturasCanceladas: (r.canceledSubscriptions || []).length,
      },
      detail: { assinaturasCanceladas: r.canceledSubscriptions || [], nota: r.customer?.churnNote || "" },
      notes: ["o arr fica congelado de propósito: é o histórico da Análise da base. Quem tira do MRR é o endedAt."],
      source: { endpoint: `POST /api/customers/${c.id}/churn` },
    });
  });

  tool("customer_unchurn", {
    group: GRUPO,
    title: "Desfazer churn",
    description: "Limpa a marcação de saída e devolve o cliente ao MRR e à base ativa; não reativa as assinaturas canceladas.",
    write: true, destructive: true,
    danger: "devolve receita ao MRR e à contagem de ativos sem restaurar a cobrança — o cliente pode voltar às métricas sem estar sendo cobrado.",
    input: { customer: z.string().describe("id ou nome do cliente"), saas: z.string().optional() },
  }, async ({ customer, saas }) => {
    const c = await resolveCustomer(customer, saas);
    const r = (await http.post(`/api/customers/${encodeURIComponent(c.id)}/unchurn`)) || {};
    return result({
      kind: "customers.unchurn",
      title: `Churn desfeito · ${c.name || c.id}`,
      scope: { saas: c.saas, customer: c.id },
      units: UNITS,
      totals: { endedAt: r.customer?.endedAt || "(limpo)", mrrDevolvido: round2(num(c.arr) / 12) },
      notes: ["as assinaturas canceladas NÃO voltam: se a cobrança continua, reative na aba Assinaturas (recorrência no Mercado Pago é decisão humana)."],
      source: { endpoint: `POST /api/customers/${c.id}/unchurn` },
    });
  });

  tool("customer_revert_win", {
    group: GRUPO,
    title: "Desfazer fechamento errado",
    description: "Apaga uma venda lançada por engano: remove cliente, assinaturas e faturas e devolve o lead ao funil (≠ churn, que é saída legítima).",
    write: true, destructive: true,
    danger: "APAGA cliente, assinaturas e faturas e é irreversível; MRR, caixa e ganho do mês mudam na hora. Use churn se a venda existiu de verdade.",
    hint: "409 = o cliente tem cobrança ou pagamento REAL do Mercado Pago; nesse caso desfaça pelo Financeiro na mão.",
    input: { customer: z.string().describe("id ou nome do cliente"), saas: z.string().optional() },
  }, async ({ customer, saas }) => {
    const c = await resolveCustomer(customer, saas);
    const r = (await http.post(`/api/customers/${encodeURIComponent(c.id)}/revert-win`)) || {};
    return result({
      kind: "customers.revert_win",
      title: `Fechamento desfeito · ${c.name || c.id}`,
      scope: { saas: c.saas, customer: c.id },
      units: UNITS,
      totals: { removido: c.id, mrrRemovido: round2(num(c.arr) / 12), lead: r.leadId || "(sem lead)", etapa: r.stage || "" },
      notes: ["as métricas descontam sozinhas: tudo derivava dos registros removidos."],
      source: { endpoint: `POST /api/customers/${c.id}/revert-win` },
    });
  });

  tool("nps_report", {
    group: GRUPO,
    title: "NPS",
    description: "NPS do produto: nota final, promotores/neutros/detratores, média, verbatims e detratores com o MRR que representam.",
    input: {
      saas: z.string().optional(),
      customer: z.string().optional().describe("id do cliente"),
      max_score: z.number().int().optional().describe("nota máxima; 6 = só detratores"),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, customer, max_score, q, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const [respostas, clientes] = await Promise.all([
      http.get("/api/nps", { saas: product.id }),
      http.get("/api/customers", { saas: product.id }).catch(() => []),
    ]);
    const byId = new Map((clientes || []).map((c) => [c.id, c]));
    let rows = (respostas || []).map((n) => {
      const c = byId.get(n.customer);
      return {
        score: num(n.score),
        classe: num(n.score) >= 9 ? "promotor" : num(n.score) >= 7 ? "neutro" : "detrator",
        cliente: c?.name || n.customer || "",
        mrr: c ? round2(num(c.arr) / 12) : null,
        role: n.role || "",
        tags: (n.tags || []).join(", "),
        text: n.text || "",
        id: n.id,
        customer: n.customer || "",
      };
    });
    if (customer) rows = rows.filter((r) => r.customer === customer);
    if (max_score != null) rows = rows.filter((r) => r.score <= max_score);

    const prom = rows.filter((r) => r.classe === "promotor");
    const neu = rows.filter((r) => r.classe === "neutro");
    const det = rows.filter((r) => r.classe === "detrator");
    const tagMap = new Map();
    for (const r of rows) for (const t of String(r.tags).split(",").map((x) => x.trim()).filter(Boolean)) {
      const e = tagMap.get(t) || { tag: t, respostas: 0, soma: 0 };
      e.respostas += 1; e.soma += r.score;
      tagMap.set(t, e);
    }
    const s = select(rows, { q, qFields: ["text", "cliente", "tags"], sort: "score", limit });

    return result({
      kind: "customers.nps",
      title: `NPS · ${product.name || product.id}`,
      scope: { saas: product.id, customer: customer || null },
      units: UNITS,
      totals: {
        respostas: rows.length,
        nps: rows.length ? Math.round(((prom.length - det.length) / rows.length) * 100) : null,
        promotores: prom.length, neutros: neu.length, detratores: det.length,
        mediaNota: rows.length ? round2(rows.reduce((a, r) => a + r.score, 0) / rows.length) : null,
        mrrDetratores: round2(det.reduce((a, r) => a + num(r.mrr), 0)),
        clientesCobertos: new Set(rows.filter((r) => r.customer).map((r) => r.customer)).size,
      },
      columns: ["score", "classe", "cliente", "mrr", "role", "tags", "text", "id"],
      rows: s.rows,
      rowsLabel: "Respostas",
      page: s.page,
      tables: {
        detratores: { label: `Contas detratoras (nota ≤ 6) · ${Math.min(det.length, 25)} de ${det.length}, maior MRR primeiro`, columns: ["cliente", "score", "mrr", "text"], rows: det.sort((a, b) => num(b.mrr) - num(a.mrr)).slice(0, 25), units: UNITS },
        tags: { label: "Por tag", columns: ["tag", "respostas", "media"], rows: [...tagMap.values()].map((e) => ({ tag: e.tag, respostas: e.respostas, media: round2(e.soma / e.respostas) })).sort((a, b) => b.respostas - a.respostas) },
      },
      notes: [
        "NPS = % promotores (9-10) − % detratores (0-6). Neutros (7-8) entram só no denominador.",
        "nenhuma tela do produto captura NPS: a coleção só é alimentada por nps_add (ou importação). Amostra pequena não representa a carteira.",
        "as respostas não guardam data — o relatório é do acumulado, não de um período.",
      ],
      source: { endpoint: "GET /api/nps" },
    });
  });

  tool("nps_add", {
    group: GRUPO,
    title: "Registrar resposta de NPS",
    description: "Grava uma resposta de NPS de um cliente.",
    write: true,
    hint: "o `customer` deve ser o id do cliente (customers_list) — sem ele a resposta não entra no NPS por CS do placar.",
    input: {
      saas: z.string().optional(),
      score: z.number().int().min(0).max(10).describe("0 a 10"),
      customer: z.string().optional().describe("id ou nome do cliente"),
      role: z.string().optional().describe("ex.: Admin, Operação"),
      tags: z.array(z.string()).optional(),
      text: z.string().optional().describe("verbatim"),
    },
  }, async ({ saas, score, customer, role = "", tags = [], text = "" }) => {
    const product = await resolveProduct(saas);
    const c = customer ? await resolveCustomer(customer, product.id) : null;
    const criado = (await http.post("/api/nps", {
      saas: product.id, score, customer: c?.id || "", role, tags, text,
      // A coleção não tem campo de data no schema; carimbar `at` é o que
      // permite recortar NPS por período depois.
      at: new Date().toISOString(),
    })) || {};
    return result({
      kind: "customers.nps_add",
      title: `NPS registrado · nota ${score}`,
      scope: { saas: product.id, customer: c?.id || null },
      units: UNITS,
      totals: { id: criado.id, score: num(criado.score), classe: score >= 9 ? "promotor" : score >= 7 ? "neutro" : "detrator", cliente: c?.name || "" },
      source: { endpoint: "POST /api/nps" },
    });
  });

  tool("contracts_issues", {
    group: GRUPO,
    title: "Contratos gerados e modelos",
    description: "Contratos gerados por cliente, a biblioteca de modelos do produto e os clientes ativos sem contrato.",
    input: {
      saas: z.string().optional(),
      customer: z.string().optional().describe("id do cliente"),
      contract: z.string().optional().describe("id do modelo"),
      issue_id: z.string().optional().describe("abre UM contrato gerado"),
      include_body: z.boolean().optional().describe("HTML do snapshot; só com issue_id, é grande"),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, customer, contract, issue_id, include_body = false, q, limit = 50 }) => {
    const product = await resolveProduct(saas);
    // O filtro `saas` do servidor é igualdade exata e sumiria com o registro
    // gerado sem produto — a tela Contratos trata "sem saas" como sendo de
    // todos. Mesma régua aqui, filtrando localmente.
    const [todosIssues, modelos, clientes] = await Promise.all([
      http.get("/api/contract_issues", { customer, contract }),
      http.get("/api/contracts").catch(() => []),
      http.get("/api/customers", { saas: product.id }).catch(() => []),
    ]);
    const doProduto = (modelos || []).filter((m) => !m.saas || m.saas === product.id);
    const issues = (todosIssues || []).filter((i) => !i.saas || i.saas === product.id);

    if (issue_id) {
      const i = (issues || []).find((x) => x.id === issue_id);
      if (!i) throw new Error(`contrato gerado "${issue_id}" não existe neste produto — liste sem issue_id para achar o id.`);
      return result({
        kind: "customers.contract_issue",
        title: `Contrato gerado · ${i.customerName || i.customerId} (${i.name || i.contract})`,
        scope: { saas: product.id, issue: i.id, customer: i.customerId || null },
        totals: { modelo: i.name || i.contract, etiqueta: i.tag || "", gerado: i.createdAt, autor: i.author || "" },
        detail: { valores: i.values || {}, campos: (i.fields || []).map((f) => f.key), ...(include_body ? { body: i.body || "" } : {}) },
        notes: include_body ? [] : ["passe include_body=true para o HTML do snapshot."],
        source: { endpoint: "GET /api/contract_issues" },
      });
    }

    const rows = (issues || []).map((i) => ({
      cliente: i.customerName || "", modelo: i.name || i.contract || "", tag: i.tag || "",
      valor: i.values?.valor_total || "", pagamento: i.values?.forma_pagamento || "",
      gerado: dia(i.createdAt), autor: i.author || "", customer: i.customerId || "", id: i.id,
    }));
    const comContrato = new Set((issues || []).map((i) => i.customerId).filter(Boolean));
    const sem = (clientes || []).filter((c) => !isChurned(c) && !comContrato.has(c.id))
      .map((c) => ({ cliente: c.name, plan: c.plan || "", arr: num(c.arr), startedAt: dia(c.startedAt), customer: c.id }));
    const s = select(rows, { q, qFields: ["cliente", "modelo", "tag"], sort: "gerado:desc", limit });

    return result({
      kind: "customers.contracts",
      title: `Contratos · ${product.name || product.id}`,
      scope: { saas: product.id, customer: customer || null },
      units: UNITS,
      totals: {
        gerados: rows.length, modelos: doProduto.length,
        clientesComContrato: comContrato.size, clientesAtivosSemContrato: sem.length,
      },
      columns: ["cliente", "modelo", "tag", "valor", "pagamento", "gerado", "autor", "customer", "id"],
      rows: s.rows,
      rowsLabel: "Contratos gerados",
      page: s.page,
      tables: {
        modelos: { label: "Modelos disponíveis", columns: ["id", "name", "tag", "note", "updatedAt"], rows: doProduto.map((m) => ({ id: m.id, name: m.name, tag: m.tag || "", note: m.note || "", updatedAt: dia(m.updatedAt) })) },
        pendencias: { label: `Clientes ativos SEM contrato registrado (${Math.min(sem.length, 50)} de ${sem.length})`, columns: ["cliente", "plan", "arr", "startedAt", "customer"], rows: select(sem, { sort: "arr:desc", limit: 50 }).rows, units: UNITS },
      },
      notes: [
        "o histórico registra o que foi impresso/baixado/copiado na tela — cliente sem linha aqui pode ter contrato assinado fora do cockpit.",
        "`valor` é texto livre digitado no preenchimento, não número calculado.",
      ],
      source: { endpoint: "GET /api/contract_issues + /api/contracts" },
    });
  });

  tool("integration_status", {
    group: GRUPO,
    title: "Análise de integração",
    description: "Calls de onboarding: sentimento (satisfeito/neutro/em risco), pendências recorrentes, o que mais é configurado e as integrações recentes.",
    input: {
      saas: z.string().optional(),
      integrator: z.string().optional().describe('user id; "" = sem integrador atribuído'),
      limit: z.number().int().optional().describe("padrão e máximo 25"),
    },
  }, async ({ saas, integrator, limit = 25 }) => {
    const product = await resolveProduct(saas);
    const rota = `/api/integrations/${encodeURIComponent(product.id)}/summary`;
    // `integrator=""` é o recorte "sem integrador atribuído", e o montador de
    // querystring descarta string vazia — por isso o caso vazio vai colado na
    // rota, senão o filtro virava "todos" calado.
    const d = (integrator === ""
      ? await http.get(`${rota}?integrator=`)
      : await http.get(rota, integrator ? { integrator } : undefined)) || {};
    const s = select(d.recent || [], { sort: "at:desc", limit });
    const total = d.count || 0;
    const risco = d.sentimento?.["em risco"] || 0;
    return result({
      kind: "customers.integration_status",
      title: `Análise de integração · ${product.name || product.id}`,
      scope: { saas: product.id, integrador: d.integrator ?? "todos" },
      units: { emRiscoPct: "%" },
      totals: {
        integracoes: total,
        satisfeitos: d.sentimento?.satisfeito || 0,
        neutros: d.sentimento?.neutro || 0,
        emRisco: risco,
        emRiscoPct: total ? round2((risco / total) * 100) : null,
      },
      columns: ["at", "leadName", "company", "integrator", "sentimento", "resumo", "leadId"],
      rows: s.rows,
      rowsLabel: "Integrações recentes",
      page: s.page,
      tables: {
        pendencias: { label: `Pendências recorrentes (e quem resolve) · ${Math.min((d.pendencias || []).length, 30)} de ${(d.pendencias || []).length}`, columns: ["item", "total", "cliente", "equipe"], rows: (d.pendencias || []).slice(0, 30) },
        configurado: { label: `O que mais é configurado · ${Math.min((d.configurado || []).length, 30)} de ${(d.configurado || []).length}`, columns: ["item", "total"], rows: (d.configurado || []).slice(0, 30) },
        integradores: { label: "Integrações por integrador", columns: ["id", "count"], rows: d.integradores || [] },
      },
      notes: [
        total < 5 ? `amostra pequena (${total} integrações resumidas): os padrões só ficam confiáveis a partir de umas 10.` : "",
        "lê os resumos de IA das calls de INTEGRAÇÃO; o integrador vem do campo do lead, não do resumo.",
        `as linhas são as 25 integrações mais recentes que o servidor devolve — os totais e as tabelas de pendências olham as ${total} resumidas.`,
        "sentimento 'em risco' é o sinal de churn precoce — cruze com customers_health.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/integrations/${product.id}/summary` },
    });
  });

  tool("integration_forms", {
    group: GRUPO,
    title: "Formulários de integração",
    description: "Pedidos de formulário de integração: quantos aguardam resposta e há quantos dias, quais foram respondidos e, sob demanda, as respostas ou o questionário.",
    input: {
      saas: z.string().optional(),
      action: z.enum(["list", "questions", "answers"]).optional().describe("padrão list; answers exige form_id"),
      status: z.enum(["pendente", "respondido"]).optional(),
      customer: z.string().optional().describe("id do cliente"),
      form_id: z.string().optional().describe("token do link /fi/:id"),
      limit: z.number().int().optional().describe("padrão 50"),
    },
  }, async ({ saas, action = "list", status, customer, form_id, limit = 50 }) => {
    if (action === "questions") {
      const q = (await http.get("/api/integration-forms/questions")) || {};
      const perguntas = (q.sections || []).flatMap((s) => (s.questions || []).map((x) => ({ secao: s.title, key: x.key, label: x.label, tipo: x.type, condicional: x.showIf ? `${x.showIf.key} ∈ ${(x.showIf.in || []).join("/")}` : "" })));
      return result({
        kind: "customers.integration_questions",
        title: `Questionário de integração (versão ${q.version})`,
        totals: { versao: q.version, secoes: (q.sections || []).length, perguntas: perguntas.length, clausulasDoTermo: (q.term || []).length },
        columns: ["secao", "key", "label", "tipo", "condicional"],
        rows: perguntas,
        rowsLabel: "Perguntas",
        detail: { termo: q.term || [] },
        notes: ["pré-visualização em branco: /fi/preview."],
        source: { endpoint: "GET /api/integration-forms/questions" },
      });
    }

    const product = await resolveProduct(saas);
    const forms = await http.get("/api/integration_forms", { saas: product.id, customer, status });

    if (action === "answers") {
      const f = (forms || []).find((x) => x.id === form_id);
      if (!f) throw new Error("informe `form_id` de um pedido deste produto (liste com action=list).");
      const respostas = Object.entries(f.answers || {}).map(([chave, valor]) => ({
        chave, valor: Array.isArray(valor) ? `${valor.length} item(ns)` : String(valor ?? ""),
      }));
      return result({
        kind: "customers.integration_form",
        title: `Formulário de integração · ${f.customerName || f.customerId}`,
        scope: { saas: product.id, form: f.id, customer: f.customerId || null },
        totals: { status: f.status, criado: dia(f.createdAt), respondido: dia(f.respondedAt), versao: f.version || null },
        columns: ["chave", "valor"],
        rows: respostas,
        rowsLabel: "Respostas",
        detail: { assinatura: f.respondent || null, respostasCompletas: f.answers || {} },
        notes: ["contém dado pessoal e assinatura eletrônica (nome, CPF/CNPJ, IP, user-agent): não repasse fora do time."],
        source: { endpoint: "GET /api/integration_forms" },
      });
    }

    const now = Date.now();
    const rows = (forms || []).map((f) => ({
      cliente: f.customerName || "", status: f.status || "pendente", criado: dia(f.createdAt),
      diasAguardando: f.status === "respondido" ? null : ms(f.createdAt) != null ? Math.floor((now - ms(f.createdAt)) / DAY) : null,
      respondido: dia(f.respondedAt), respondente: f.respondent?.name || "", link: `/fi/${f.id}`,
      customer: f.customerId || "", id: f.id,
    }));
    const s = select(rows, { sort: "criado:desc", limit });
    return result({
      kind: "customers.integration_forms",
      title: `Formulários de integração · ${product.name || product.id}`,
      scope: { saas: product.id, status: status || "todos" },
      units: UNITS,
      totals: {
        pedidos: rows.length,
        pendentes: rows.filter((r) => r.status !== "respondido").length,
        respondidos: rows.filter((r) => r.status === "respondido").length,
        esperaMaisAntigaDias: Math.max(0, ...rows.map((r) => num(r.diasAguardando))),
      },
      columns: ["cliente", "status", "criado", "diasAguardando", "respondido", "respondente", "link", "customer", "id"],
      rows: s.rows,
      rowsLabel: "Pedidos",
      page: s.page,
      notes: ["o id do pedido É o token do link público: quem tem o link abre o formulário daquele cliente."],
      source: { endpoint: "GET /api/integration_forms" },
    });
  });

  tool("integration_form_create", {
    group: GRUPO,
    title: "Criar formulário de integração",
    description: "Cria o pedido de formulário de integração de um cliente e devolve o link público.",
    write: true,
    danger: "gera um link público (o id é o token) feito para ser enviado a uma pessoa real; o formulário coleta CNPJ/CPF e assinatura eletrônica.",
    input: {
      customer: z.string().describe("id ou nome do cliente"),
      saas: z.string().optional(),
      customer_name: z.string().optional().describe("padrão: nome do cliente"),
    },
  }, async ({ customer, saas, customer_name }) => {
    const c = await resolveCustomer(customer, saas);
    const existentes = await http.get("/api/integration_forms", { customer: c.id }).catch(() => []);
    const criado = (await http.post("/api/integration_forms", {
      saas: c.saas, customerId: c.id, customerName: customer_name || c.name || "", leadId: c.leadId || "",
    })) || {};
    return result({
      kind: "customers.integration_form_create",
      title: `Formulário criado · ${criado.customerName || c.name}`,
      scope: { saas: c.saas, customer: c.id, form: criado.id },
      totals: { id: criado.id, link: `${http.base}/fi/${criado.id}`, status: criado.status, criado: dia(criado.createdAt) },
      notes: existentes.length ? [`este cliente já tinha ${existentes.length} pedido(s) — o link antigo continua válido; exclua o que sobra pela tela.`] : [],
      source: { endpoint: "POST /api/integration_forms" },
    });
  });

  tool("leverads_access", {
    group: GRUPO,
    title: "Acesso ao produto LeverAds",
    description: "Auditoria do sync que liga/corta o paywall no produto LeverAds: último report, orgs do produto e de-para com os clientes do cockpit.",
    // `dry_run` roda um tick de verdade na API, e a rota aplica quando o
    // servidor está com LEVERADS_ACCESS_APPLY=1 — mesmo com apply:false no
    // corpo. Marcar como leitura seria mentira: o cliente MCP tem que poder
    // pedir confirmação antes.
    write: true,
    external: true,
    danger: "action=dry_run dispara um tick do sync na API: se o servidor estiver com LEVERADS_ACCESS_APPLY=1, ele LIGA/CORTA o paywall de clientes reais. Confira `modo` na resposta — 'apply' significa que valeu.",
    hint: "424 = sync desligado no servidor (faltam LEVERADS_ADMIN_EMAIL/LEVERADS_ADMIN_PASSWORD).",
    input: {
      action: z.enum(["status", "orgs", "dry_run"]).optional().describe("padrão status (leitura); dry_run roda um tick e APLICA se o servidor tiver LEVERADS_ACCESS_APPLY=1"),
      limit: z.number().int().optional().describe("padrão 100"),
    },
  }, async ({ action = "status", limit = 100 }) => {
    if (action === "orgs") {
      const [orgs, clientes] = await Promise.all([
        http.get("/api/leverads-access/orgs"),
        http.get("/api/customers", { saas: "leverads" }).catch(() => []),
      ]);
      const porOrg = new Map((clientes || []).filter((c) => c.leveradsOrgId).map((c) => [String(c.leveradsOrgId), c]));
      const rows = (orgs || []).map((o) => {
        const c = porOrg.get(String(o.id));
        return {
          org: o.id, nome: o.name, email: o.email, ativa: o.active, paywallLiberado: o.paymentActive,
          cliente: c?.name || "", clienteChurnado: c ? isChurned(c) : null, customer: c?.id || "",
        };
      });
      const semOrg = (clientes || []).filter((c) => !c.leveradsOrgId && !isChurned(c));
      const s = select(rows, { sort: "nome", limit });
      return result({
        kind: "customers.leverads_orgs",
        title: "Orgs do produto LeverAds",
        totals: {
          orgs: rows.length, vinculadas: rows.filter((r) => r.customer).length,
          liberadas: rows.filter((r) => r.paywallLiberado).length,
          clientesAtivosSemOrg: semOrg.length,
        },
        columns: ["org", "nome", "email", "ativa", "paywallLiberado", "cliente", "clienteChurnado", "customer"],
        rows: s.rows,
        rowsLabel: "Orgs",
        page: s.page,
        tables: {
          sem_org: { label: "Clientes ativos sem org vinculada (o sync não os toca)", columns: ["id", "name", "plan"], rows: semOrg.map((c) => ({ id: c.id, name: c.name, plan: c.plan || "" })) },
        },
        notes: ["o vínculo é manual (customer.leveradsOrgId) — sem ele o cliente fica fora do sync de paywall."],
        source: { endpoint: "GET /api/leverads-access/orgs" },
      });
    }

    const r = (action === "dry_run"
      ? await http.post("/api/leverads-access/run", { apply: false }, { timeoutMs: 180_000 })
      : await http.get("/api/leverads-access/status")) || {};

    return result({
      kind: "customers.leverads_access",
      title: `Sync de acesso LeverAds (${r.mode || action})`,
      scope: { modo: r.mode || "never-ran" },
      totals: {
        modo: r.mode || "never-ran", quando: r.at || "", verificados: r.checked ?? 0,
        emDia: r.inSync ?? 0, aplicados: r.applied ?? 0,
        mudancasPendentes: (r.planned || []).length, erros: (r.errors || []).length,
      },
      tables: {
        planejado: { label: `Fora de sincronia (o que o sync mudaria) · ${Math.min((r.planned || []).length, limit)} de ${(r.planned || []).length}`, columns: ["name", "orgName", "from", "to", "reason", "customer", "org"], rows: (r.planned || []).slice(0, limit) },
        ignorados: { label: `Ignorados · ${Math.min((r.skipped || []).length, limit)} de ${(r.skipped || []).length}`, columns: ["name", "reason", "customer"], rows: (r.skipped || []).slice(0, limit) },
        erros: { label: `Erros · ${Math.min((r.errors || []).length, limit)} de ${(r.errors || []).length}`, columns: ["name", "error", "customer", "org"], rows: (r.errors || []).slice(0, limit) },
      },
      notes: [
        "régua: cliente encerrado corta; assinatura past_due corta; ativa libera; só cancelada/pausada corta; sem assinatura não mexe.",
        "`from`/`to` são o payment_active da org — `to:false` significa CORTAR o acesso do cliente.",
        r.mode === "never-ran" ? "o sync ainda não rodou nesta instância da API (o report vive em memória e some no restart) — use action=dry_run." : "",
        "esta tool nunca PEDE o apply (o corpo vai sempre com apply:false); pedir a virada de propósito é decisão humana, pela tela.",
        r.mode === "apply" ? "ATENÇÃO: o report voltou em modo `apply` — o servidor está com LEVERADS_ACCESS_APPLY=1 e as mudanças da tabela `planejado` FORAM aplicadas no paywall dos clientes." : "",
      ].filter(Boolean),
      source: { endpoint: action === "dry_run" ? "POST /api/leverads-access/run {apply:false}" : "GET /api/leverads-access/status" },
    });
  });
}
