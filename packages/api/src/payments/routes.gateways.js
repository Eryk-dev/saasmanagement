// Rotas dos gateways alternativos (Asaas e Appmax):
// - POST /public/asaas/webhook (ABERTA)   → token no header asaas-access-token;
//   o evento traz a cobrança inteira; re-busca por id pra não confiar no body.
// - POST /public/appmax/webhook (ABERTA)  → token na URL (?token=); a Appmax
//   não assina nem permite re-buscar, então o body É a fonte.
// - POST /api/asaas/sync                   → a mesma passada do poller.
// - GET  /api/gateways                     → estado dos três gateways.
//
// Os webhooks SEMPRE respondem 200 depois de autenticar: erro de processamento
// vira log + poller (Asaas pausa a fila depois de falhas seguidas; a Appmax
// re-tenta 3x e desiste).

import { asaas as defaultAsaas } from "./asaas.js";
import { appmax as defaultAppmax, parseAppmaxEvent } from "./appmax.js";
import { ingestAsaasPayment, runAsaasSync } from "./asaas-payments.js";
import { ingestMirrorPayment } from "./mp-payments.js";
import { UPSTREAM_FAILED, NOT_CONFIGURED } from "../platform/http-status.js";

export function registerGatewayRoutes(app, repo, { mp, asaas = defaultAsaas, appmax = defaultAppmax, discord } = {}) {
  app.get("/api/gateways", async () => ({
    mp: { configured: !!mp?.configured?.(), webhook: !!mp?.hasWebhookSecret?.() },
    asaas: { configured: !!asaas?.configured?.(), webhook: !!asaas?.hasWebhookToken?.(), sandbox: !!asaas?.sandbox?.() },
    appmax: { configured: !!appmax?.configured?.() },
  }));

  app.post("/api/asaas/sync", async (req, reply) => {
    if (!asaas?.configured?.()) return reply.code(NOT_CONFIGURED).send({ error: "Asaas não configurado (ASAAS_API_KEY)" });
    try {
      return await runAsaasSync(repo, asaas, { discord, log: req.log });
    } catch (err) {
      req.log.warn({ err: err.message }, "Asaas: sync manual falhou");
      return reply.code(UPSTREAM_FAILED).send({ error: "Asaas não respondeu a busca de cobranças", detail: String(err.message || err).slice(0, 300) });
    }
  });

  // Webhook do Asaas (painel → Integrações → Webhooks; eventos de cobrança).
  app.post("/public/asaas/webhook", async (req, reply) => {
    if (!asaas?.hasWebhookToken?.()) {
      req.log.warn("Asaas webhook: sem ASAAS_WEBHOOK_TOKEN — evento recusado");
      return reply.code(401).send({ error: "webhook não configurado" });
    }
    if (!asaas.verifyWebhookToken(req.headers["asaas-access-token"] || "")) {
      req.log.warn("Asaas webhook: token inválido");
      return reply.code(401).send({ error: "Invalid token" });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const event = String(body.event || "");
    const pmt = body.payment && typeof body.payment === "object" ? body.payment : null;
    if (!event.startsWith("PAYMENT_") || !pmt?.id) return { received: true, ignored: event || "empty payload" };
    // Fonte da verdade = a API (o body é forjável só com o token; e o evento
    // pode ser antigo). Sem resposta da API, segue com o body do evento.
    let full = pmt;
    if (asaas.configured()) {
      try { full = await asaas.getPayment(pmt.id); } catch { full = pmt; }
    }
    try {
      const r = await ingestAsaasPayment(repo, asaas, full, { discord, log: req.log, event, eventAt: body.dateCreated || "" });
      return {
        received: true, ok: true, payment: r.payment.id, matched: r.matched,
        ...(r.settledNow ? { invoice: r.settledNow } : {}),
        ...(r.alreadySettled ? { duplicate: true } : {}),
      };
    } catch (err) {
      req.log.error({ err: err.message, payment: pmt.id }, "Asaas webhook: falha no ingest (o poller recupera)");
      return { received: true, error: "ingest_failed" };
    }
  });

  // Webhook da Appmax (painel → Configurações → Apphooks, modelo padrão).
  app.post("/public/appmax/webhook", async (req, reply) => {
    if (!appmax?.configured?.()) {
      req.log.warn("Appmax webhook: sem APPMAX_WEBHOOK_TOKEN — evento recusado");
      return reply.code(401).send({ error: "webhook não configurado" });
    }
    const token = req.query?.token || req.headers["x-appmax-token"] || "";
    if (!appmax.verifyToken(token)) {
      req.log.warn("Appmax webhook: token inválido");
      return reply.code(401).send({ error: "Invalid token" });
    }
    const base = parseAppmaxEvent(req.body);
    if (!base) return { received: true, ignored: "not an order event" };
    try {
      const r = await ingestMirrorPayment(repo, base, { discord, log: req.log, extra: { payerDetail: 2 }, noRegress: true });
      return {
        received: true, ok: true, payment: r.payment.id, status: r.payment.status, matched: r.matched,
        ...(r.settledNow ? { invoice: r.settledNow } : {}),
        ...(r.alreadySettled ? { duplicate: true } : {}),
      };
    } catch (err) {
      req.log.error({ err: err.message, order: base.mpId }, "Appmax webhook: falha no ingest");
      return { received: true, error: "ingest_failed" };
    }
  });
}
