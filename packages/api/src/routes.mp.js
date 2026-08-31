// Rotas Mercado Pago (fase 4 · billing) — liga o MP ao motor da fase 5:
// - POST /api/subscriptions/:id/mp/link  → cria preapproval (pending) e devolve
//   o init_point pro cliente autorizar; external_reference = id da assinatura.
// - POST /public/mp/webhook (ABERTA)     → assinatura HMAC verificada quando há
//   secret + SEMPRE re-fetch do recurso na API (o body é forjável). Autoriza/
//   cancela a assinatura e dá baixa automática nas faturas.
//
// Segurança (padrões do copylever): payer cross-check (payer do evento ≠ payer
// salvo na assinatura → DROP + log), idempotência por mpPaymentId na fatura,
// fetch_failed responde 200 pra não virar retry storm.

import { mp as defaultMp, parseWebhookPayload } from "./mp.js";
import { CYCLE_MONTHS, syncCustomerArr } from "./billing.js";
import { ingestMpPayment, runMpSync, settleInvoice } from "./mp-payments.js";
import { recordPaymentLink } from "./payment-links.js";
import { attachPreapprovalToSub, linkableSubs, runPreapprovalSync } from "./mp-subscriptions.js";
import { applyMpCancellationChurn, applyMpReactivationRescue } from "./churn.js";
import { DEAL_PRODUCT_LABEL } from "./proposal-catalog.js";
import { MENTORIA_LABEL } from "./mentoria.js";
import { logActivity } from "./lead-flow.js";
import { baseUrl } from "./disparos-util.js";
import { UPSTREAM_FAILED, NOT_CONFIGURED } from "./http-status.js";

// ── E-mail do pagador: conveniência, nunca requisito ────────────────────────
// `payer.email` só PRÉ-PREENCHE o checkout. Mas o campo de e-mail do lead nem
// sempre é um e-mail (form com resposta livre, "não tenho", telefone digitado
// no lugar), e o Mercado Pago recusa a preferência INTEIRA quando ele não
// presta. O closer via "MP recusou a criação do link" no meio da venda, sem
// motivo na tela, e ficava sem cobrar. Duas defesas: só mandar o que parece
// e-mail, e, se o MP recusar mesmo assim, tentar de novo SEM ele.
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
export const payerEmailOrNone = (v) => (looksLikeEmail(v) ? String(v).trim().toLowerCase() : undefined);

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
// Recorrência do preapproval: o MP só cobra de 1, 3, 6 ou 12 em 12 meses.
const RECURRING_MONTHS = new Set([1, 3, 6, 12]);
const FREQ_LABEL = { 1: "mês", 3: "3 meses", 6: "6 meses", 12: "12 meses" };
const KIND_LABEL = { renewal: "renovação", prorata: "pró-rata", upsell: "upsell", manual: "cobrança", installment: "parcela" };

// Baixa automática de uma cobrança do MP: paga a fatura aberta/vencida mais
// antiga da assinatura (ou registra uma paga, se não houver) e recupera o
// status. Idempotente por mpPaymentId — webhook duplicado não dá baixa 2x.
export async function applyMpPayment(repo, sub, { mpPaymentId, amount }, now = new Date()) {
  const invoices = (await repo.list("invoices")).filter((i) => i.subscription === sub.id);
  if (mpPaymentId && invoices.some((i) => i.mpPaymentId === mpPaymentId)) {
    return { ok: true, duplicate: true };
  }
  const open = invoices
    .filter((i) => i.status === "open" || i.status === "overdue")
    .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")))[0];
  const nowIso = now.toISOString();
  let invoice;
  if (open) {
    invoice = await repo.update("invoices", open.id, { status: "paid", paidAt: nowIso, mpPaymentId });
  } else {
    invoice = await repo.create("invoices", {
      subscription: sub.id, customer: sub.customer, saas: sub.saas,
      amount: Number(amount) || Number(sub.price) || 0,
      kind: "renewal", status: "paid", dueDate: nowIso, paidAt: nowIso,
      createdAt: nowIso, mpPaymentId,
    });
  }
  const stillOverdue = (await repo.list("invoices"))
    .some((i) => i.subscription === sub.id && i.status === "overdue");
  if (sub.status === "past_due" && !stillOverdue) {
    await repo.update("subscriptions", sub.id, { status: "active" });
    await syncCustomerArr(repo, sub.customer);
  }
  return { ok: true, invoice: invoice.id };
}

// Espelha mudança de status do Cockpit no preapproval (best-effort, fail-open):
// cancelar/pausar/reativar a assinatura aqui não pode deixar o MP cobrando.
export async function mirrorSubscriptionToMp(mpClient, before, updated, log) {
  if (!mpClient?.configured() || !updated?.mpPreapprovalId) return;
  if (!before || before.status === updated.status) return;
  try {
    if (updated.status === "canceled") await mpClient.cancelPreapproval(updated.mpPreapprovalId);
    else if (updated.status === "paused") await mpClient.pausePreapproval(updated.mpPreapprovalId);
    else if (updated.status === "active" && before.status === "paused") await mpClient.resumePreapproval(updated.mpPreapprovalId);
  } catch (err) {
    log?.warn({ sub: updated.id, err: err.message }, "MP: falha ao espelhar status no preapproval");
  }
}

async function findSubForPreapproval(repo, pre, dataId) {
  const byRef = pre.external_reference ? await repo.get("subscriptions", pre.external_reference) : null;
  if (byRef) return byRef;
  return (await repo.list("subscriptions")).find((s) => s.mpPreapprovalId === dataId) || null;
}

// Recorrência nascida no CARD DO LEAD: external_reference é o id do LEAD, não o
// de uma assinatura (que só existe depois do Ganho).
async function findLeadForPreapproval(repo, pre, dataId) {
  const byRef = pre.external_reference ? await repo.get("leads", pre.external_reference) : null;
  if (byRef) return byRef;
  return (await repo.list("leads")).find((l) => l.mpPreapprovalId === dataId) || null;
}

// Carimba no lead o retrato da recorrência e conta a mudança na timeline — é
// por ela que o closer sabe que o cliente autorizou (ou cancelou) sem precisar
// abrir o Mercado Pago. Só a TRANSIÇÃO vira nota: redelivery não repete.
const PRE_STATUS_NOTE = {
  authorized: "Assinatura recorrente AUTORIZADA no Mercado Pago, a cobrança automática já começou",
  cancelled: "Assinatura recorrente CANCELADA no Mercado Pago",
  paused: "Assinatura recorrente pausada no Mercado Pago",
};
async function stampLeadPreapproval(repo, lead, pre, dataId, log) {
  const changed = lead.mpPreapprovalStatus !== pre.status;
  await repo.update("leads", lead.id, {
    mpPreapprovalId: dataId,
    mpPreapprovalStatus: pre.status || "",
    ...(lead.mpPayerEmail ? {} : { mpPayerEmail: pre.payer_email || "" }),
  });
  if (changed && PRE_STATUS_NOTE[pre.status]) {
    try {
      await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "system", author: "mercadopago",
        text: PRE_STATUS_NOTE[pre.status],
        meta: { event: "mp_preapproval", preapprovalId: dataId, status: pre.status },
      });
    } catch { /* timeline nunca quebra o webhook */ }
  }
  log?.info?.({ lead: lead.id, mpStatus: pre.status }, "MP webhook: recorrência do lead atualizada");
}

function payerMismatch(sub, eventPayer) {
  return !!(sub.payerEmail && eventPayer && String(eventPayer).toLowerCase() !== String(sub.payerEmail).toLowerCase());
}

export function registerMpRoutes(app, repo, { mp = defaultMp, discord } = {}) {
  // Fatura baixada pelo webhook avisa no Discord (fail-open; duplicado não tem
  // result.invoice, então não re-avisa).
  async function notifyPaid(sub, result) {
    if (!result.invoice || !discord?.configured()) return;
    const [invoice, customer] = await Promise.all([
      repo.get("invoices", result.invoice),
      repo.get("customers", sub.customer),
    ]);
    await discord.invoicePaid({ invoice, customerName: customer?.name, via: "Mercado Pago" });
  }

  // Gera o link de pagamento recorrente (preapproval pending → init_point).
  // Cria a preferência e, se o MP recusar COM e-mail do pagador, tenta de novo
  // sem ele. Link sem pré-preenchimento é melhor que venda travada; o cliente
  // digita o e-mail no próprio checkout.
  async function createPreference(args, log) {
    try {
      return await mp.createCheckoutPreference(args);
    } catch (err) {
      if (!args.payerEmail) throw err;
      log?.warn?.({ err: err.message }, "MP recusou com payer.email — tentando sem o e-mail do pagador");
      return await mp.createCheckoutPreference({ ...args, payerEmail: undefined });
    }
  }

  app.post("/api/subscriptions/:id/mp/link", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    const sub = await repo.get("subscriptions", req.params.id);
    if (!sub) return reply.code(404).send({ error: "Not found" });
    const customer = await repo.get("customers", sub.customer);
    const payerEmail = req.body?.payerEmail || customer?.email;
    if (!payerEmail) return reply.code(400).send({ error: "cliente sem e-mail — preencha o e-mail do cliente ou envie payerEmail" });

    const product = await repo.get("products", sub.saas);
    const plan = sub.plan ? await repo.get("plans", sub.plan) : null;
    const reason = [product?.name || sub.saas, plan?.name, `(${CYCLE_LABEL[sub.cycle] || sub.cycle})`]
      .filter(Boolean).join(" · ");
    try {
      const pre = await mp.createPreapproval({
        payerEmail,
        externalReference: sub.id,
        ...mpUrls(req),
        amount: Number(sub.price) || 0,
        frequencyMonths: CYCLE_MONTHS[sub.cycle] || 1,
        reason,
      });
      const updated = await repo.update("subscriptions", sub.id, {
        mpPreapprovalId: pre.id,
        mpInitPoint: pre.init_point || null,
        mpStatus: pre.status || "pending",
        payerEmail,
      });
      return { ok: true, initPoint: pre.init_point, preapprovalId: pre.id, subscription: updated };
    } catch (err) {
      req.log.warn({ sub: sub.id, err: err.message }, "MP: falha ao criar preapproval");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP recusou a criação do link", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // ── Financeiro (espelho de pagamentos + cobrança avulsa) ─────────────────

  // Lista do espelho pra tela Financeiro (aba Pagamentos). Pagamento sem saas = não identificado:
  // aparece em qualquer produto até alguém vincular.
  app.get("/api/mp/payments", async (req) => {
    const q = req.query || {};
    let items = await repo.list("mp_payments");
    if (q.saas) items = items.filter((p) => !p.saas || p.saas === q.saas);
    if (q.status) items = items.filter((p) => p.status === q.status);
    if (q.customer) items = items.filter((p) => p.customer === q.customer);
    if (q.from) items = items.filter((p) => String(p.dateCreated || "") >= q.from);
    if (q.to) items = items.filter((p) => String(p.dateCreated || "") <= q.to);
    items.sort((a, b) => String(b.dateCreated || "").localeCompare(String(a.dateCreated || "")));
    const sync = await repo.get("app_config", "mp_sync");
    return {
      payments: items,
      sync: sync ? { lastAt: sync.lastAt, lastSeen: sync.lastSeen } : null,
      configured: mp.configured(),
    };
  });

  // Sincronizar agora (botão da UI) — mesma passada do poller.
  app.post("/api/mp/sync", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    try {
      return await runMpSync(repo, mp, { discord, log: req.log });
    } catch (err) {
      req.log.warn({ err: err.message }, "MP: sync manual falhou");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP não respondeu a busca de pagamentos", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // Vínculo manual pagamento ↔ cliente (pros que não casaram sozinhos). Com
  // valor exato batendo numa única fatura aberta, a baixa acontece junto.
  app.post("/api/mp/payments/:id/link", async (req, reply) => {
    const p = await repo.get("mp_payments", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    const customerId = String(req.body?.customer || "");
    const invoices = await repo.list("invoices");
    const settled = invoices.find((i) => i.mpPaymentId === p.mpId) || null;
    if (!customerId) {
      if (settled) return reply.code(400).send({ error: "pagamento já deu baixa numa fatura — não dá pra desvincular" });
      const cleared = await repo.update("mp_payments", p.id, { customer: "", lead: "", subscription: "", invoice: "", saas: "", matchedBy: "" });
      return { ok: true, payment: cleared };
    }
    const customer = await repo.get("customers", customerId);
    if (!customer) return reply.code(400).send({ error: "cliente não encontrado" });
    const patch = { customer: customer.id, saas: customer.saas || p.saas || "", lead: "", matchedBy: "manual" };
    let settledInv = null;
    if (p.status === "approved" && !settled) {
      const cand = invoices.filter((i) =>
        i.customer === customer.id && (i.status === "open" || i.status === "overdue")
        && Math.abs(Number(i.amount) - Number(p.amount)) < 0.01);
      if (cand.length === 1) {
        settledInv = await settleInvoice(repo, cand[0], {
          id: p.mpId, date_approved: p.dateApproved, date_created: p.dateCreated,
          payment_method_id: p.method, payment_type_id: p.methodType, installments: p.installments,
        }, { discord, log: req.log });
        patch.invoice = settledInv.id;
      }
    }
    const updated = await repo.update("mp_payments", p.id, patch);
    return { ok: true, payment: updated, invoice: settledInv?.id || null };
  });

  // ── Assinaturas recorrentes da conta (preapprovals) ──────────────────────
  // Espelho das recorrências que JÁ cobram — inclusive as criadas fora do
  // cockpit — pra ligar cada uma ao cliente certo. Recorrência ainda sem dono
  // aparece em qualquer produto (mesma regra do espelho de pagamentos).
  app.get("/api/mp/preapprovals", async (req) => {
    const q = req.query || {};
    let items = await repo.list("mp_preapprovals");
    if (q.saas) items = items.filter((p) => !p.saas || p.saas === q.saas);
    if (q.status) items = items.filter((p) => p.status === q.status);
    if (q.customer) items = items.filter((p) => p.customer === q.customer);
    items.sort((a, b) => String(b.dateCreated || "").localeCompare(String(a.dateCreated || "")));
    const sync = await repo.get("app_config", "mp_preapproval_sync");
    return {
      preapprovals: items,
      sync: sync ? { lastAt: sync.lastAt, lastSeen: sync.lastSeen } : null,
      configured: mp.configured(),
    };
  });

  app.post("/api/mp/preapprovals/sync", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    try {
      return await runPreapprovalSync(repo, mp, { log: req.log, discord });
    } catch (err) {
      req.log.warn({ err: err.message }, "MP: sync de recorrências falhou");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP não respondeu a busca de assinaturas", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // Vínculo recorrência do MP ↔ assinatura do cockpit. Carimba mpPreapprovalId
  // na assinatura: daí em diante o webhook espelha o status, a cobrança mensal
  // dá baixa na fatura sozinha e cancelar aqui CANCELA no MP. Body vazio
  // desvincula. `customer` sozinho só resolve quando o cliente tem UMA
  // assinatura candidata — na dúvida a tela manda a assinatura.
  app.post("/api/mp/preapprovals/:id/link", async (req, reply) => {
    const doc = await repo.get("mp_preapprovals", req.params.id);
    if (!doc) return reply.code(404).send({ error: "Not found" });
    const subId = String(req.body?.subscription || "");
    const customerId = String(req.body?.customer || "");

    if (!subId && !customerId) {
      if (doc.subscription) {
        const cur = await repo.get("subscriptions", doc.subscription);
        // Só limpa o carimbo se for MESMO desta recorrência.
        if (cur?.mpPreapprovalId === doc.mpId) {
          await repo.update("subscriptions", cur.id, { mpPreapprovalId: "", mpStatus: "" });
        }
      }
      const cleared = await repo.update("mp_preapprovals", doc.id, { customer: "", subscription: "", saas: "", matchedBy: "" });
      return { ok: true, preapproval: cleared };
    }

    const subs = await repo.list("subscriptions");
    let sub = subId ? subs.find((s) => s.id === subId) || null : null;
    if (subId && !sub) return reply.code(400).send({ error: "assinatura não encontrada" });
    if (!sub) {
      const customer = await repo.get("customers", customerId);
      if (!customer) return reply.code(400).send({ error: "cliente não encontrado" });
      const cand = linkableSubs(subs, customer.id);
      if (!cand.length) return reply.code(400).send({ error: "cliente sem assinatura ativa no cockpit — crie a assinatura antes de vincular" });
      if (cand.length > 1) return reply.code(400).send({ error: "cliente tem mais de uma assinatura — escolha qual delas recebe a recorrência" });
      sub = cand[0];
    }
    if (sub.mpPreapprovalId && sub.mpPreapprovalId !== doc.mpId) {
      return reply.code(400).send({ error: "essa assinatura já está ligada a outra recorrência do MP" });
    }
    const taken = (await repo.list("mp_preapprovals"))
      .find((p) => p.id !== doc.id && p.subscription === sub.id);
    if (taken) return reply.code(400).send({ error: "outra recorrência do MP já está vinculada a essa assinatura" });

    const updatedSub = await attachPreapprovalToSub(repo, sub, doc);
    const updated = await repo.update("mp_preapprovals", doc.id, {
      customer: updatedSub.customer || "", subscription: updatedSub.id,
      saas: updatedSub.saas || "", matchedBy: "manual",
      suggestedCustomer: "", suggestedSubscription: "", suggestedBy: "",
    });
    return { ok: true, preapproval: updated, subscription: updatedSub };
  });

  // Cobrança avulsa anexada ao cliente: fatura (registro no billing) + link de
  // pagamento (checkout preference) com external_reference = id da fatura — o
  // webhook/poller dá a baixa sozinho quando o cliente pagar.
  app.post("/api/customers/:id/charge", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Not found" });
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!(amount > 0)) return reply.code(400).send({ error: "valor da cobrança deve ser positivo" });
    const product = customer.saas ? await repo.get("products", customer.saas) : null;
    const title = String(req.body?.title || "").trim()
      || [product?.name || customer.saas, "cobrança"].filter(Boolean).join(" · ");
    const nowIso = new Date().toISOString();
    const invoice = await repo.create("invoices", {
      customer: customer.id, saas: customer.saas || "", amount,
      kind: req.body?.kind === "upsell" ? "upsell" : "manual", status: "open",
      title, dueDate: req.body?.dueDate || nowIso, createdAt: nowIso,
    });
    try {
      const pref = await createPreference({
        title, amount, externalReference: invoice.id,
        payerEmail: payerEmailOrNone(customer.email),
        ...mpUrls(req),
        maxInstallments: Number(req.body?.maxInstallments) || undefined,
      });
      const updated = await repo.update("invoices", invoice.id, { mpPrefId: pref.id, mpInitPoint: pref.init_point || null });
      await recordPaymentLink(repo, {
        saas: customer.saas || "", kind: "customer", origin: req.body?.origin || "cliente",
        customer: customer.id, invoice: invoice.id,
        targetName: customer.name || "", targetPhone: customer.phone || "",
        amount, title, url: pref.init_point || "", prefId: pref.id || "",
        payerEmail: customer.email || "", reference: invoice.id,
        createdBy: req.authUser?.id || "",
      }, { log: req.log });
      return { ok: true, invoice: updated, url: pref.init_point || null };
    } catch (err) {
      await repo.remove("invoices", invoice.id); // fatura sem link não fica órfã
      req.log.warn({ customer: customer.id, err: err.message }, "MP: falha ao criar link de cobrança");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP recusou a criação do link de cobrança", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // Link de pagamento pra uma fatura JÁ existente (renovação em aberto etc).
  app.post("/api/invoices/:id/mp/link", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    const invoice = await repo.get("invoices", req.params.id);
    if (!invoice) return reply.code(404).send({ error: "Not found" });
    if (invoice.status === "paid") return reply.code(400).send({ error: "fatura já está paga" });
    if (!(Number(invoice.amount) > 0)) return reply.code(400).send({ error: "fatura sem valor" });
    const customer = invoice.customer ? await repo.get("customers", invoice.customer) : null;
    const product = invoice.saas ? await repo.get("products", invoice.saas) : null;
    const title = String(req.body?.title || "").trim()
      || [product?.name || invoice.saas, invoice.title || KIND_LABEL[invoice.kind] || "fatura"].filter(Boolean).join(" · ");
    try {
      const pref = await createPreference({
        title, amount: Number(invoice.amount), externalReference: invoice.id,
        payerEmail: payerEmailOrNone(customer?.email),
        ...mpUrls(req),
        maxInstallments: Number(req.body?.maxInstallments) || undefined,
      });
      const updated = await repo.update("invoices", invoice.id, { mpPrefId: pref.id, mpInitPoint: pref.init_point || null });
      await recordPaymentLink(repo, {
        saas: invoice.saas || "", kind: "invoice", origin: "fatura",
        customer: invoice.customer || "", invoice: invoice.id,
        targetName: customer?.name || "", targetPhone: customer?.phone || "",
        amount: Number(invoice.amount), title, url: pref.init_point || "", prefId: pref.id || "",
        payerEmail: customer?.email || "", reference: invoice.id,
        createdBy: req.authUser?.id || "",
      }, { log: req.log });
      return { ok: true, invoice: updated, url: pref.init_point || null };
    } catch (err) {
      req.log.warn({ invoice: invoice.id, err: err.message }, "MP: falha ao criar link da fatura");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP recusou a criação do link", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // Link de pagamento pelo CARD DO LEAD (atalho do closer): o checkout nasce
  // com external_reference = id do lead — o pagamento entra no espelho JÁ
  // casado com a origem (e com o cliente, quando o lead converte), sem depender
  // do e-mail do pagador. NÃO cria fatura: fatura é do cliente, pós-Ganho; o
  // link fica no lead (mpChargeUrl) e a criação vira atividade no card.
  //
  // O modal também manda o FECHAMENTO (plan/contractValue/paymentMethod): são
  // os MESMOS campos que o gate de Ganho pede (planClosed/amount/paymentMethod)
  // — gravados aqui, o card vira Ganho num clique e o cliente/assinatura nascem
  // com plano, duração e valor certos (convertWonLead). Campo vazio não apaga
  // o que o lead já tem.
  //
  // `mode: "recurring"` (Leo, 27/08) troca o checkout avulso por uma ASSINATURA
  // RECORRENTE (preapproval): o cliente autoriza UMA vez e o Mercado Pago cobra
  // sozinho a cada N meses. É o mesmo botão do closer — antes a recorrência só
  // existia na tela Assinaturas, ou seja, DEPOIS do Ganho, e a venda no cartão
  // recorrente saía com um link avulso na frente e outro link depois.
  app.post("/api/leads/:id/mp/link", async (req, reply) => {
    if (!mp.configured()) return reply.code(NOT_CONFIGURED).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!(amount > 0)) return reply.code(400).send({ error: "valor deve ser positivo" });
    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const PLAN_LABEL = { anual: "Plano Anual", semestral: "Plano Semestral", unico: "Serviço único" };
    const plan = PLAN_LABEL[req.body?.plan] ? String(req.body.plan) : "";
    // Produto do catálogo da apresentação (FULL/OEM/Parcial): nomeia o checkout
    // e fica no lead (dealProduct) — segue pro cliente e pro card da Integração.
    // (a Mentoria vende pelo mesmo campo, com o catálogo dela).
    const PRODUCT_LABEL_ALL = { ...DEAL_PRODUCT_LABEL, ...MENTORIA_LABEL };
    const dealProduct = PRODUCT_LABEL_ALL[req.body?.product] ? String(req.body.product) : "";
    const title = String(req.body?.title || "").trim()
      || [PRODUCT_LABEL_ALL[dealProduct] || product?.name || lead.saas, plan ? PLAN_LABEL[plan] : "pagamento"].filter(Boolean).join(" · ");
    const description = String(req.body?.description || "").trim() || undefined;
    const payerEmail = payerEmailOrNone(req.body?.payerEmail ?? lead.email);
    // Recorrência: o MP só aceita 1/3/6/12 meses no preapproval, e EXIGE um
    // e-mail que preste (é a conta que vai autorizar a cobrança automática) —
    // aqui não cabe o fallback "tenta sem e-mail" do checkout avulso.
    const recurring = String(req.body?.mode || "") === "recurring";
    const frequencyMonths = Math.round(Number(req.body?.frequencyMonths) || 1);
    if (recurring && !RECURRING_MONTHS.has(frequencyMonths)) {
      return reply.code(400).send({ error: "a cobrança recorrente só aceita mensal, trimestral, semestral ou anual" });
    }
    if (recurring && !payerEmail) {
      return reply.code(400).send({ error: "assinatura recorrente precisa do e-mail do pagador (o Mercado Pago exige um e-mail válido pra autorizar a cobrança automática)" });
    }
    try {
      const pref = recurring
        ? await mp.createPreapproval({
          payerEmail, externalReference: lead.id, ...mpUrls(req),
          amount, frequencyMonths, reason: title.slice(0, 255),
        })
        : await createPreference({
          title, description, amount, externalReference: lead.id,
          payerEmail,
          ...mpUrls(req),
          maxInstallments: Number(req.body?.maxInstallments) || undefined,
        });
      const contractValue = Math.round(Number(req.body?.contractValue) * 100) / 100;
      // Recorrência sem forma combinada escolhida assume o cartão recorrente —
      // é o que ela É, e o gate de Ganho já entende esse meio (ciclo mensal,
      // sem Nº de parcelas).
      const paymentMethod = String(req.body?.paymentMethod || "").trim()
        || (recurring && !lead.paymentMethod ? "cartao_recorrente" : "");
      const updated = await repo.update("leads", lead.id, {
        mpChargeUrl: pref.init_point || null, mpChargeAmount: amount,
        mpChargeTitle: title, mpChargeAt: new Date().toISOString(),
        // Que tipo de link é o ÚLTIMO gerado (a tela e o card mostram isso).
        mpChargeKind: recurring ? "recurring" : "once",
        ...(plan ? { planClosed: plan } : {}),
        ...(dealProduct ? { dealProduct } : {}),
        ...(contractValue > 0 ? { amount: contractValue } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
        // A recorrência é um FATO do lead: o preapproval fica carimbado aqui até
        // o Ganho, quando a assinatura que nasce do fechamento a adota
        // (convertWonLead / webhook). Gerar um avulso depois não apaga.
        ...(recurring ? {
          mpPreapprovalId: pref.id || "", mpPreapprovalStatus: pref.status || "pending",
          mpPreapprovalMonths: frequencyMonths, mpPayerEmail: payerEmail || "",
        } : {}),
      });
      await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "note",
        text: (recurring
          ? `Link de assinatura recorrente criado: R$ ${amount.toFixed(2).replace(".", ",")} a cada ${FREQ_LABEL[frequencyMonths]} (${title})`
          : `Link de pagamento criado: R$ ${amount.toFixed(2).replace(".", ",")} (${title})`)
          + (contractValue > 0 && contractValue !== amount ? ` · contrato R$ ${contractValue.toFixed(2).replace(".", ",")}` : ""),
        author: req.authUser?.id || "system",
      });
      // Recibo da geração pro histórico da tela de links (o lead só guarda o
      // ÚLTIMO link; aqui fica cada um, com quem gerou e de onde).
      await recordPaymentLink(repo, {
        saas: lead.saas || "", kind: "lead", origin: req.body?.origin || "card",
        lead: lead.id, customer: lead.customerId || "",
        targetName: lead.name || "", targetPhone: lead.phone || "",
        amount, title, description, url: pref.init_point || "", prefId: pref.id || "",
        payerEmail, reference: lead.id, plan, product: dealProduct,
        recurring, frequencyMonths: recurring ? frequencyMonths : 0,
        createdBy: req.authUser?.id || "",
      }, { log: req.log });
      return { ok: true, lead: updated, url: pref.init_point || null, recurring };
    } catch (err) {
      req.log.warn({ lead: lead.id, recurring, err: err.message }, "MP: falha ao criar link do lead");
      return reply.code(UPSTREAM_FAILED).send({
        error: recurring ? "MP recusou a criação da assinatura recorrente" : "MP recusou a criação do link",
        detail: String(err.message || err).slice(0, 300),
      });
    }
  });

  // Webhook do MP (configurar no painel: https://<host>/public/mp/webhook).
  app.post("/public/mp/webhook", async (req, reply) => {
    const { topic, dataId } = parseWebhookPayload(req.body);
    if (!topic || !dataId) return { received: true, ignored: "empty or invalid payload" };

    if (mp.hasWebhookSecret()) {
      const ok = mp.verifyWebhookSignature(req.headers["x-signature"] || "", req.headers["x-request-id"] || "", dataId);
      if (!ok) {
        req.log.warn({ dataId }, "MP webhook: assinatura inválida");
        return reply.code(400).send({ error: "Invalid signature" });
      }
    }

    // ── preapproval mudou (authorized | paused | cancelled | pending) ───────
    if (topic === "subscription_preapproval" || topic === "preapproval") {
      let pre;
      try { pre = await mp.getPreapproval(dataId); }
      catch { return { received: true, error: "fetch_failed" }; }

      let sub = await findSubForPreapproval(repo, pre, dataId);
      // Recorrência gerada no card do lead: antes do Ganho não existe assinatura
      // pra espelhar — o retrato mora no LEAD (e a timeline conta ao closer que
      // o cliente autorizou). Depois do Ganho, a assinatura que nasceu do
      // fechamento adota a recorrência aqui e segue o fluxo normal.
      if (!sub) {
        const lead = await findLeadForPreapproval(repo, pre, dataId);
        if (!lead) return { received: true, ignored: "no matching subscription" };
        // Cross-check com o pagador que NÓS mandamos pro MP (mpPayerEmail) — o
        // campo de e-mail do lead não serve: ele vem do form e guarda de tudo
        // ("não tenho", telefone), e derrubaria evento legítimo.
        const leadPayer = String(lead.mpPayerEmail || "");
        if (leadPayer && pre.payer_email && String(pre.payer_email).toLowerCase() !== leadPayer.toLowerCase()) {
          req.log.error({ lead: lead.id, dataId, eventPayer: pre.payer_email }, "MP webhook: payer mismatch no lead — DROPPED");
          return { received: true, ignored: "payer mismatch" };
        }
        await stampLeadPreapproval(repo, lead, pre, dataId, req.log);
        // Uma única assinatura candidata (do cliente que nasceu deste lead, sem
        // recorrência) = fato, não palpite — mesma régua do mp-subscriptions.
        // Ela segue pelo caminho normal daqui pra baixo (status espelhado, ARR,
        // churn e aviso no Discord), como qualquer recorrência vinculada.
        if (lead.customerId) {
          const cand = linkableSubs(await repo.list("subscriptions"), lead.customerId).filter((x) => !x.mpPreapprovalId);
          if (cand.length === 1) sub = cand[0];
        }
        if (!sub) return { received: true, lead: lead.id, mpStatus: pre.status || "" };
      }
      if (payerMismatch(sub, pre.payer_email)) {
        req.log.error({ sub: sub.id, dataId, eventPayer: pre.payer_email }, "MP webhook: payer mismatch — DROPPED");
        return { received: true, ignored: "payer mismatch" };
      }

      const mapped = { authorized: "active", cancelled: "canceled", paused: "paused" }[pre.status];
      const mpStatusChanged = sub.mpStatus !== pre.status;
      const updated = await repo.update("subscriptions", sub.id, {
        mpPreapprovalId: dataId,
        mpStatus: pre.status,
        payerEmail: sub.payerEmail || pre.payer_email || null,
        ...(mapped && sub.status !== mapped ? { status: mapped } : {}),
        ...(mapped === "canceled" && !sub.canceledAt ? { canceledAt: new Date().toISOString() } : {}),
      });
      // Cancelou no MP sem outra assinatura viva → o CLIENTE churna sozinho
      // (endedAt + motivo "mp_cancel"); reativou → desfaz churn que o próprio
      // MP marcou. ANTES do syncCustomerArr: cliente churnado congela o arr
      // (guard no billing.js), preservando quanto ele valia quando saiu.
      if (pre.status === "cancelled") await applyMpCancellationChurn(repo, updated, { discord, log: req.log });
      else if (pre.status === "authorized") await applyMpReactivationRescue(repo, updated, { log: req.log });
      await syncCustomerArr(repo, updated.customer);
      // Aviso no Discord pela transição do mpStatus (autorizou/cancelou/pausou) —
      // status Cockpit pode já nascer "active" (CREATE_DEFAULTS), o evento que
      // importa é o cliente ter mexido no MP. Redelivery não re-avisa.
      if (mapped && mpStatusChanged && discord?.configured()) {
        const customer = await repo.get("customers", updated.customer);
        await discord.subscriptionStatus({ sub: updated, customerName: customer?.name, status: mapped });
      }
      req.log.info({ sub: sub.id, mpStatus: pre.status, status: updated.status }, "MP webhook: preapproval atualizado");
      return { received: true, subscription: updated.id, status: updated.status };
    }

    // ── cobrança recorrente da assinatura ────────────────────────────────────
    if (topic === "subscription_authorized_payment" || topic === "authorized_payment") {
      let ap;
      try { ap = await mp.getAuthorizedPayment(dataId); }
      catch { return { received: true, error: "fetch_failed" }; }
      if (ap.status !== "processed") return { received: true, ignored: `status ${ap.status}` };
      const sub = (await repo.list("subscriptions")).find((s) => s.mpPreapprovalId === ap.preapproval_id);
      if (!sub) return { received: true, ignored: "no matching subscription" };
      const result = await applyMpPayment(repo, sub, {
        mpPaymentId: String(ap.payment?.id || dataId),
        amount: ap.transaction_amount,
      });
      await notifyPaid(sub, result);
      return { received: true, ...result };
    }

    // ── pagamento (avulso ou de link) — TODO status entra no espelho ────────
    // O ingest casa por fatura/assinatura/e-mail, baixa a fatura se aprovado
    // (idempotente por mpPaymentId, payer cross-check no caso de assinatura) e
    // deixa o resto visível na tela Financeiro pro vínculo manual.
    if (topic === "payment") {
      let pmt;
      try { pmt = await mp.getPayment(dataId); }
      catch { return { received: true, error: "fetch_failed" }; }
      // extra payerDetail: o doc do webhook JÁ é o completo — o sync não
      // precisa re-buscar esse pagamento pra procurar nome (2 = versão atual
      // da extração, PAYER_DETAIL_V do mp-payments.js).
      const r = await ingestMpPayment(repo, pmt, { discord, log: req.log, extra: { payerDetail: 2 } });
      return {
        received: true, ok: true, payment: r.payment.id, matched: r.matched,
        ...(r.settledNow ? { invoice: r.settledNow } : {}),
        ...(r.alreadySettled ? { duplicate: true } : {}),
      };
    }

    return { received: true, ignored: `topic ${topic}` };
  });
}

// URLs públicas dos links do MP, POR REQUEST: COCKPIT_PUBLIC_URL > host da
// request (x-forwarded-*) > localhost — a mesma cadeia do publicBase de
// routes.js (via baseUrl, que existe fora dele pra não criar ciclo de import).
// Era uma constante só da env: deploy sem COCKPIT_PUBLIC_URL mandava back_url
// "http://localhost:8787" e o /preapproval recusava a assinatura recorrente
// inteira ("Invalid value for back_url" — ali o MP exige URL https válida; o
// checkout avulso engole). Env sem esquema ganha https:// pelo mesmo motivo.
// notification_url só vale com base pública https (MP recusa localhost).
function mpUrls(req) {
  const base = baseUrl(req).trim();
  const backUrl = /^https?:\/\//.test(base) ? base : `https://${base}`;
  return {
    backUrl,
    notificationUrl: backUrl.startsWith("https://") ? `${backUrl}/public/mp/webhook` : undefined,
  };
}
