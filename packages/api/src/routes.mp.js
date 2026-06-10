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

const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", annual: "anual" };

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

export function registerMpRoutes(app, repo, { mp = defaultMp } = {}) {
  // Gera o link de pagamento recorrente (preapproval pending → init_point).
  app.post("/api/subscriptions/:id/mp/link", async (req, reply) => {
    if (!mp.configured()) return reply.code(503).send({ error: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)" });
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
      return reply.code(502).send({ error: "MP recusou a criação do link", detail: String(err.message || err).slice(0, 300) });
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
      const updated = await repo.update("subscriptions", sub.id, {
        mpPreapprovalId: dataId,
        mpStatus: pre.status,
        payerEmail: sub.payerEmail || pre.payer_email || null,
        ...(mapped && sub.status !== mapped ? { status: mapped } : {}),
      });
      await syncCustomerArr(repo, updated.customer);
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
      return { received: true, ...result };
    }

    // ── pagamento avulso aprovado (external_reference = id da assinatura) ───
    if (topic === "payment") {
      let pmt;
      try { pmt = await mp.getPayment(dataId); }
      catch { return { received: true, error: "fetch_failed" }; }
      if (pmt.status !== "approved") return { received: true, ignored: `status ${pmt.status}` };
      const sub = pmt.external_reference ? await repo.get("subscriptions", pmt.external_reference) : null;
      if (!sub) return { received: true, ignored: "non-subscription payment" };
      if (payerMismatch(sub, pmt.payer?.email)) {
        req.log.error({ sub: sub.id, dataId }, "MP webhook: payer mismatch no payment — DROPPED");
        return { received: true, ignored: "payer mismatch" };
      }
      const result = await applyMpPayment(repo, sub, {
        mpPaymentId: String(pmt.id),
        amount: pmt.transaction_amount,
      });
      return { received: true, ...result };
    }

    return { received: true, ignored: `topic ${topic}` };
  });
}

// Mesma base pública do routes.js (link de retorno do checkout).
const PUBLIC_BASE = (process.env.COCKPIT_PUBLIC_URL || `http://localhost:${process.env.API_PORT || 8787}`).replace(/\/+$/, "");
