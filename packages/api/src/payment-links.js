// Histórico dos LINKS DE PAGAMENTO gerados pelo cockpit (collection payment_links).
//
// Por que existe: o link nasce em três lugares — card do lead (atalho do closer),
// ficha do cliente (cobrança avulsa) e a tela "Links de pagamento" — e até agora
// só sobrava o ÚLTIMO de cada lugar (lead.mpChargeUrl / invoice.mpInitPoint).
// Sem um registro POR GERAÇÃO não dá pra responder "o que eu já mandei e quem
// pagou", que é a pergunta da tela.
//
// O doc é um RECIBO da geração: nasce e não muda. O STATUS é derivado na leitura,
// cruzando com o espelho do Mercado Pago (mp_payments) — a verdade do dinheiro
// mora lá, como no resto do financeiro (mp-payments.js).

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

// Link + status do dinheiro. Cada pagamento é atribuído a UM link só (gerar o
// link de novo não pode mostrar o mesmo pagamento duas vezes): varre do mais
// NOVO pro mais velho, porque o link recém-gerado é o que foi mandado.
//
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

    // Fatura baixada na mão (sem passar pelo MP) também é pagamento.
    const invoice = link.invoice ? invoiceById.get(link.invoice) : null;
    const invoicePaid = invoice?.status === "paid";

    const newer = byNewest.slice(0, i).some((o) =>
      o.kind === link.kind && sameAmount(o.amount, link.amount)
      && ((o.lead && o.lead === link.lead) || (o.customer && o.customer === link.customer) || (o.reference && o.reference === link.reference)));

    const status = payment
      ? (payment.status === "approved" ? "paid" : payment.status)
      : invoicePaid ? "paid"
      : newer ? "superseded"
      : "waiting";

    return {
      ...link,
      status,
      paidAt: payment?.status === "approved" ? (payment.dateApproved || payment.dateCreated) : (invoicePaid ? invoice.paidAt : ""),
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
