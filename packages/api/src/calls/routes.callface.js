// Webhook de saída da Callface (rota ABERTA sob /api/webhooks/: a Callface chama
// sem key; quem autentica é o X-Callface-Signature). A lógica mora em callface.js.
//
// Postura igual à do Asaas: sem CALLFACE_WEBHOOK_SECRET no env, recusa tudo.
// Com a assinatura certa, responde 200 mesmo quando o lead não casa ou o
// ingest falha (o registro fica em callface_calls / no log), pra Callface não
// ficar reenviando a mesma ligação.

import { ingestCallfaceCall } from "./callface.js";

export function registerCallfaceRoutes(app, repo, { callface } = {}) {
  app.register(async (wh) => {
    // Guarda o corpo cru só nesta instância (a assinatura pode ser HMAC dele),
    // sem mexer no parse JSON das demais rotas. Transcrição inteira vem no
    // payload, por isso o limite maior que o 1 MB padrão.
    wh.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 4 * 1024 * 1024 }, (req, body, done) => {
      req.rawBody = body;
      try { done(null, body && body.length ? JSON.parse(body.toString("utf8")) : {}); }
      catch (err) { err.statusCode = 400; done(err); }
    });

    wh.post("/api/webhooks/callface", { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
      if (!callface?.configured?.()) {
        req.log.warn("Callface webhook: sem CALLFACE_WEBHOOK_SECRET no env, evento recusado");
        return reply.code(401).send({ error: "webhook não configurado" });
      }
      if (!callface.verifySignature(req.headers["x-callface-signature"] || "", req.rawBody)) {
        req.log.warn("Callface webhook: assinatura inválida");
        return reply.code(401).send({ error: "Invalid signature" });
      }
      try {
        const result = await ingestCallfaceCall(repo, req.body, { log: req.log });
        return { received: true, ...result };
      } catch (err) {
        req.log.error({ err: err?.message }, "Callface webhook: falha ao registrar a ligação");
        return { received: true, error: "ingest_failed" };
      }
    });
  });
}
