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
import { DEAL_PRODUCT_LABEL } from "./proposal-catalog.js";
import { logActivity } from "./lead-flow.js";
import { UPSTREAM_FAILED, NOT_CONFIGURED } from "./http-status.js";

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
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
        backUrl: PUBLIC_BASE,
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
  // notification_url só vale com base pública https (MP recusa localhost).
  const notificationUrl = PUBLIC_BASE.startsWith("https://") ? `${PUBLIC_BASE}/public/mp/webhook` : undefined;

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
      const pref = await mp.createCheckoutPreference({
        title, amount, externalReference: invoice.id,
        payerEmail: customer.email || undefined,
        backUrl: PUBLIC_BASE, notificationUrl,
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
      const pref = await mp.createCheckoutPreference({
        title, amount: Number(invoice.amount), externalReference: invoice.id,
        payerEmail: customer?.email || undefined,
        backUrl: PUBLIC_BASE, notificationUrl,
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
    const dealProduct = DEAL_PRODUCT_LABEL[req.body?.product] ? String(req.body.product) : "";
    const title = String(req.body?.title || "").trim()
      || [DEAL_PRODUCT_LABEL[dealProduct] || product?.name || lead.saas, plan ? PLAN_LABEL[plan] : "pagamento"].filter(Boolean).join(" · ");
    const description = String(req.body?.description || "").trim() || undefined;
    const payerEmail = String(req.body?.payerEmail ?? lead.email ?? "").trim().toLowerCase() || undefined;
    try {
      const pref = await mp.createCheckoutPreference({
        title, description, amount, externalReference: lead.id,
        payerEmail,
        backUrl: PUBLIC_BASE, notificationUrl,
        maxInstallments: Number(req.body?.maxInstallments) || undefined,
      });
      const contractValue = Math.round(Number(req.body?.contractValue) * 100) / 100;
      const paymentMethod = String(req.body?.paymentMethod || "").trim();
      const updated = await repo.update("leads", lead.id, {
        mpChargeUrl: pref.init_point || null, mpChargeAmount: amount,
        mpChargeTitle: title, mpChargeAt: new Date().toISOString(),
        ...(plan ? { planClosed: plan } : {}),
        ...(dealProduct ? { dealProduct } : {}),
        ...(contractValue > 0 ? { amount: contractValue } : {}),
        ...(paymentMethod ? { paymentMethod } : {}),
      });
      await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "note",
        text: `Link de pagamento criado: R$ ${amount.toFixed(2).replace(".", ",")} (${title})`
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
        createdBy: req.authUser?.id || "",
      }, { log: req.log });
      return { ok: true, lead: updated, url: pref.init_point || null };
    } catch (err) {
      req.log.warn({ lead: lead.id, err: err.message }, "MP: falha ao criar link do lead");
      return reply.code(UPSTREAM_FAILED).send({ error: "MP recusou a criação do link", detail: String(err.message || err).slice(0, 300) });
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

      const sub = await findSubForPreapproval(repo, pre, dataId);
      if (!sub) return { received: true, ignored: "no matching subscription" };
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
      });
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

// Mesma base pública do routes.js (link de retorno do checkout).
const PUBLIC_BASE = (process.env.COCKPIT_PUBLIC_URL || `http://localhost:${process.env.API_PORT || 8787}`).replace(/\/+$/, "");
