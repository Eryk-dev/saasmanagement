// Histórico dos LINKS DE PAGAMENTO gerados pelo cockpit (collection payment_links).
//
// Por que existe: o link nasce em três lugares — card do lead (atalho do closer),
// ficha do cliente (cobrança avulsa) e a tela "Links de pagamento" — e até agora
// só sobrava o ÚLTIMO de cada lugar (lead.mpChargeUrl / invoice.mpInitPoint).
// Sem um registro POR GERAÇÃO não dá pra responder "o que eu já mandei e quem
// pagou", que é a pergunta da tela.
//
// O doc é um RECIBO da geração: nasce e não muda, com UMA exceção: a baixa
// manual (`manualPaid`, dinheiro que entrou fora do link e alguém marcou à mão
// na tela). O STATUS é derivado na leitura, cruzando com o espelho do Mercado
// Pago (mp_payments) — a verdade do dinheiro mora lá, como no resto do
// financeiro (mp-payments.js). A tela agrupa por CLIENTE (groupPaymentLinks):
// o saldo pago × em aberto de cada um sai daqui, nunca do cliente.

import { dayKey } from "./metrics-core.js";

const ORIGINS = new Set(["card", "tela", "cliente", "fatura"]);
const KINDS = new Set(["lead", "customer", "invoice"]);

const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const ts = (iso) => Date.parse(iso || "");

// Grava o recibo da geração. FAIL-OPEN de propósito: o link já existe no MP e já
// está na mão do closer — falhar aqui não pode derrubar a criação do link.
export async function recordPaymentLink(repo, fields = {}, { log } = {}) {
  try {
    const kind = KINDS.has(fields.kind) ? fields.kind : "lead";
    const doc = {
      ...(fields.id ? { id: String(fields.id) } : {}),
      saas: str(fields.saas, 40),
      kind,
      origin: ORIGINS.has(fields.origin) ? fields.origin : (kind === "lead" ? "card" : "cliente"),
      lead: str(fields.lead, 60),
      customer: str(fields.customer, 60),
      invoice: str(fields.invoice, 60),
      targetName: str(fields.targetName, 160),
      targetPhone: str(fields.targetPhone, 40),
      amount: money(fields.amount),
      title: str(fields.title, 160),
      description: str(fields.description, 300),
      url: str(fields.url, 600),
      prefId: str(fields.prefId, 120),
      payerEmail: str(fields.payerEmail, 160).toLowerCase(),
      // external_reference mandado ao MP: é por ele que o pagamento volta casado.
      reference: str(fields.reference, 120),
      plan: str(fields.plan, 40),
      product: str(fields.product, 40),
      // Assinatura recorrente (preapproval) em vez de cobrança única: o link é a
      // AUTORIZAÇÃO, e o MP passa a cobrar sozinho a cada `frequencyMonths`.
      recurring: !!fields.recurring,
      frequencyMonths: Math.round(Number(fields.frequencyMonths) || 0),
      createdAt: fields.createdAt || new Date().toISOString(),
      createdBy: str(fields.createdBy, 60),
    };
    return await repo.create("payment_links", doc);
  } catch (err) {
    log?.warn?.({ err: err.message }, "payment_links: não deu pra registrar o link no histórico");
    return null;
  }
}

const sameAmount = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;

// Um pagamento do espelho pode ser DESTE link?
//
// Duas portas, porque o dinheiro chega casado de dois jeitos (mp-payments.js):
//   · referência — o checkout nasceu com external_reference = lead/fatura; é o
//     vínculo forte, vale sozinho.
//   · entidade — o pagamento casou pelo e-mail do pagador (ou vínculo manual) e
//     ficou no MESMO lead/cliente. Aí exige valor igual, senão a renovação do
//     ano que vem "pagaria" um link velho.
// Nos dois casos o pagamento tem que ser POSTERIOR ao link (1 min de folga pra
// relógio) — link gerado hoje não é pago por dinheiro de ontem.
function matchesLink(link, p) {
  const refOk = !!link.reference && String(p.externalReference || "") === link.reference;
  const entOk = (!!link.lead && p.lead === link.lead) || (!!link.customer && p.customer === link.customer);
  if (!refOk && !entOk) return false;
  if (!refOk && !sameAmount(p.amount, link.amount)) return false;
  const linkAt = ts(link.createdAt), payAt = ts(p.dateCreated);
  if (Number.isFinite(linkAt) && Number.isFinite(payAt) && payAt < linkAt - 60_000) return false;
  return true;
}

// Baldes do status (fonte única: a tela só pinta o que vem daqui).
export const WAITING_STATES = new Set(["waiting", "pending", "in_process", "authorized"]);
export const FAILED_STATES = new Set(["rejected", "cancelled", "refunded", "charged_back"]);
export const bucketOf = (status) =>
  status === "paid" ? "paid" : status === "superseded" ? "superseded" : FAILED_STATES.has(status) ? "failed" : "waiting";

// Baixa MANUAL do link: o cliente pagou por fora (PIX direto, boleto na mão,
// dinheiro) e alguém marca na tela. Guarda data, forma, nota e quem marcou.
export const MANUAL_METHODS = new Set(["pix", "boleto", "cartao", "transferencia", "dinheiro", "outro"]);
export function validateManualPaid(body = {}, now = new Date()) {
  const method = str(body.method, 40).toLowerCase();
  if (!MANUAL_METHODS.has(method)) return { error: "diga como o dinheiro entrou (pix, boleto, cartao, transferencia, dinheiro ou outro)" };
  const raw = str(body.at, 40);
  let at;
  if (!raw) at = now;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) at = new Date(`${raw}T12:00:00-03:00`); // dia BRT, meio-dia
  else at = new Date(raw);
  if (!Number.isFinite(at.getTime())) return { error: "data do pagamento inválida" };
  if (at.getTime() > now.getTime() + 86_400_000) return { error: "data do pagamento no futuro" };
  return { value: { at: at.toISOString(), method, note: str(body.note, 300) } };
}

// Link + status do dinheiro. Cada pagamento é atribuído a UM link só (gerar o
// link de novo não pode mostrar o mesmo pagamento duas vezes): varre do mais
// NOVO pro mais velho, porque o link recém-gerado é o que foi mandado.
//
// Precedência: MP aprovado > baixa manual > fatura baixada > outro status do
// MP (recusado/pendente) > substituído > aguardando. Manual ganha de recusado
// de propósito: o cartão falhou e o cliente pagou por fora.
// `superseded` = link sem pagamento que já tem um mais novo pro mesmo alvo e
// mesmo valor: é o link substituído, não uma cobrança esperando.
export function enrichPaymentLinks(links, payments = [], invoices = []) {
  const byNewest = [...links].sort((a, b) => (ts(b.createdAt) || 0) - (ts(a.createdAt) || 0));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const used = new Set();

  return byNewest.map((link, i) => {
    const cand = payments
      .filter((p) => !used.has(p.id) && matchesLink(link, p))
      .sort((a, b) => (ts(b.dateApproved || b.dateCreated) || 0) - (ts(a.dateApproved || a.dateCreated) || 0));
    // Aprovado ganha de recusado/pendente: o que interessa é "pagou?".
    const payment = cand.find((p) => p.status === "approved") || cand[0] || null;
    if (payment) used.add(payment.id);
    const mpPaid = payment?.status === "approved";

    // Fatura baixada na mão (sem passar pelo MP) também é pagamento.
    const invoice = link.invoice ? invoiceById.get(link.invoice) : null;
    const invoicePaid = invoice?.status === "paid";
    const manual = link.manualPaid && link.manualPaid.at ? link.manualPaid : null;

    const newer = byNewest.slice(0, i).some((o) =>
      o.kind === link.kind && sameAmount(o.amount, link.amount)
      && ((o.lead && o.lead === link.lead) || (o.customer && o.customer === link.customer) || (o.reference && o.reference === link.reference)));

    const paidBy = mpPaid ? "mp" : manual ? "manual" : invoicePaid ? "invoice" : "";
    const status = paidBy ? "paid"
      : payment ? payment.status
      : newer ? "superseded"
      : "waiting";

    return {
      ...link,
      status,
      paidBy,
      paidAt: mpPaid ? (payment.dateApproved || payment.dateCreated) : manual ? manual.at : invoicePaid ? (invoice.paidAt || "") : "",
      // O que ENTROU: o valor do pagamento pode diferir do link em centavos.
      paidAmount: mpPaid ? money(payment.amount) : paidBy ? money(link.amount) : 0,
      // Só o recorte que a tela mostra — o espelho inteiro é da tela Financeiro.
      payment: payment ? {
        id: payment.id, mpId: payment.mpId, status: payment.status, amount: payment.amount,
        method: payment.method, methodType: payment.methodType, installments: payment.installments,
        payerName: payment.payerName, dateCreated: payment.dateCreated, dateApproved: payment.dateApproved,
      } : null,
      invoiceStatus: invoice?.status || "",
    };
  });
}

// Recorte do histórico: produto, janela por dia do negócio (BRT, o mesmo dia
// do resto das telas) e quem gerou. `saas` vazio = todos; link sem produto
// (backfill antigo) aparece em qualquer workspace.
export function filterPaymentLinks(links, { saas = "", since = "", until = "", by = "" } = {}) {
  return links.filter((l) => {
    if (saas && l.saas && l.saas !== saas) return false;
    if (by && String(l.createdBy || "") !== by) return false;
    if (since || until) {
      const day = dayKey(l.createdAt);
      if (since && day < since) return false;
      if (until && day > until) return false;
    }
    return true;
  });
}

// Uma linha por CLIENTE (ou lead ainda sem Ganho): lead que virou cliente entra
// no cliente (lead.customerId / customer.leadId). Saldo sempre calculado AQUI,
// do mesmo enriquecimento que serve a lista — a tela não soma dinheiro.
export function groupPaymentLinks(enriched, { leads = [], customers = [], users = [] } = {}) {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const groups = new Map();
  const sellers = new Map();

  for (const link of [...enriched].sort((a, b) => (ts(b.createdAt) || 0) - (ts(a.createdAt) || 0))) {
    const lead = link.lead ? leadById.get(link.lead) : null;
    const customerId = link.customer || lead?.customerId || "";
    const customer = customerId ? customerById.get(customerId) : null;
    const key = customerId ? `cu:${customerId}` : link.lead ? `le:${link.lead}` : `x:${link.targetPhone || link.targetName || link.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        customer: customerId,
        lead: customer?.leadId || link.lead || "",
        name: customer?.name || lead?.name || link.targetName || "(sem nome)",
        phone: customer?.phone || lead?.phone || link.targetPhone || "",
        kind: customerId ? "customer" : link.lead ? "lead" : "unknown",
        lastAt: link.createdAt || "",
        links: [],
        totals: { generated: 0, paid: 0, waiting: 0, failed: 0 },
        counts: { links: 0, paid: 0, waiting: 0, failed: 0, superseded: 0 },
      };
      groups.set(key, g);
    }
    if (!g.lead && link.lead) g.lead = link.lead;
    g.links.push(link);
    g.counts.links += 1;
    const bucket = bucketOf(link.status);
    g.counts[bucket] += 1;
    // Link substituído não é dinheiro pedido duas vezes: fica fora do gerado.
    if (bucket !== "superseded") g.totals.generated = money(g.totals.generated + (Number(link.amount) || 0));
    if (bucket === "paid") g.totals.paid = money(g.totals.paid + (Number(link.paidAmount) || Number(link.amount) || 0));
    if (bucket === "waiting") g.totals.waiting = money(g.totals.waiting + (Number(link.amount) || 0));
    if (bucket === "failed") g.totals.failed = money(g.totals.failed + (Number(link.amount) || 0));
    const by = String(link.createdBy || "");
    if (by) {
      const s = sellers.get(by) || { id: by, name: userById.get(by)?.name || by, count: 0 };
      s.count += 1;
      sellers.set(by, s);
    }
  }

  const list = [...groups.values()].sort((a, b) =>
    (b.totals.waiting - a.totals.waiting) || ((ts(b.lastAt) || 0) - (ts(a.lastAt) || 0)));
  const totals = { generated: 0, paid: 0, waiting: 0, failed: 0 };
  const counts = { links: 0, paid: 0, waiting: 0, failed: 0, superseded: 0, groups: { todos: list.length, aguardando: 0, pagos: 0, recusados: 0 } };
  for (const g of list) {
    for (const k of Object.keys(totals)) totals[k] = money(totals[k] + g.totals[k]);
    for (const k of ["links", "paid", "waiting", "failed", "superseded"]) counts[k] += g.counts[k];
    if (g.totals.waiting > 0) counts.groups.aguardando += 1;
    if (g.totals.paid > 0) counts.groups.pagos += 1;
    if (g.totals.failed > 0) counts.groups.recusados += 1;
  }
  return {
    groups: list, totals, counts,
    sellers: [...sellers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

// Aba da tela → grupos que entram (o servidor manda as contagens; a tela só
// escolhe).
export const GROUP_TABS = {
  todos: () => true,
  aguardando: (g) => g.totals.waiting > 0,
  pagos: (g) => g.totals.paid > 0,
  recusados: (g) => g.totals.failed > 0,
};

// Backfill idempotente (migração de boot): o histórico não pode nascer vazio —
// os links que já existem vivem no último carimbo do lead (mpChargeUrl) e na
// fatura (mpInitPoint). Id determinístico = rodar de novo não duplica.
export async function backfillPaymentLinks(repo) {
  const existing = new Set((await repo.list("payment_links")).map((l) => l.id));
  const customers = await repo.list("customers");
  const nameOfCustomer = (id) => customers.find((c) => c.id === id)?.name || "";
  let n = 0;

  for (const lead of await repo.list("leads")) {
    const id = `pl_lead_${lead.id}`;
    if (!lead.mpChargeUrl || existing.has(id)) continue;
    await recordPaymentLink(repo, {
      id, saas: lead.saas, kind: "lead", origin: "card",
      lead: lead.id, customer: lead.customerId || "",
      targetName: lead.name || "", targetPhone: lead.phone || "",
      amount: lead.mpChargeAmount, title: lead.mpChargeTitle || "",
      url: lead.mpChargeUrl, payerEmail: lead.email || "",
      reference: lead.id, plan: lead.planClosed || "", product: lead.dealProduct || "",
      createdAt: lead.mpChargeAt || lead.createdAt || "",
      createdBy: lead.owner || "",
    });
    n++;
  }

  for (const inv of await repo.list("invoices")) {
    const id = `pl_inv_${inv.id}`;
    if (!inv.mpInitPoint || existing.has(id)) continue;
    // Cobrança avulsa/upsell nasce na ficha do cliente; o resto é link tirado
    // de uma fatura que já existia (renovação, parcela).
    const fromCustomer = inv.kind === "manual" || inv.kind === "upsell";
    await recordPaymentLink(repo, {
      id, saas: inv.saas, kind: fromCustomer ? "customer" : "invoice",
      origin: fromCustomer ? "cliente" : "fatura",
      customer: inv.customer || "", invoice: inv.id,
      targetName: nameOfCustomer(inv.customer),
      amount: inv.amount, title: inv.title || "",
      url: inv.mpInitPoint, prefId: inv.mpPrefId || "",
      reference: inv.id, createdAt: inv.createdAt || inv.dueDate || "",
    });
    n++;
  }

  return n;
}
