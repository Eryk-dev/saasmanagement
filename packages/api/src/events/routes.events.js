// Rotas da caixa de entrada de eventos e da timeline única (lógica em
// events-core.js e timeline.js).
//
//   POST /public/events/v1            evento assinado de um produto (aberta no
//                                     gate de sessão; a assinatura é a credencial)
//   GET  /api/customers/:id/timeline  timeline do cliente (guard de Clientes)
//   GET  /api/leads/:id/timeline      timeline do lead, com a do cliente dele
//   GET  /api/crm-events?status=      caixa de entrada: contagem por estado e
//                                     os últimos eventos (guard de Clientes)

import { EVENTS, ingestEvent, parseEnvelope, processEvent, secretFor, verifySignature } from "./events-core.js";
import { buildTimeline } from "./timeline.js";

const STATUSES = ["pending", "processed", "unmatched", "failed", "dead"];
const limitOf = (q) => Number.parseInt(q?.limit, 10) || 200;

export function registerEventRoutes(app, repo) {
  app.register(async (pub) => {
    // Corpo cru guardado para conferir a assinatura (mesmo truque do webhook da
    // Shopify), sem mudar o parse JSON das demais rotas.
    pub.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
      req.rawBody = body;
      try { done(null, body && body.length ? JSON.parse(body.toString("utf8")) : {}); }
      catch (err) { err.statusCode = 400; done(err); }
    });

    pub.post("/public/events/v1", async (req, reply) => {
      const source = String(req.headers["x-lever-source"] || "").trim().toLowerCase();
      const secret = secretFor(source);
      if (!secret) return reply.code(401).send({ error: "Emissor desconhecido" });
      const ok = verifySignature({
        rawBody: req.rawBody, secret,
        timestamp: req.headers["x-lever-timestamp"], signature: req.headers["x-lever-signature"],
      });
      if (!ok) return reply.code(401).send({ error: "Assinatura inválida" });
      const { record, error } = parseEnvelope(req.body, source);
      if (error) return reply.code(400).send({ error });
      const { event, duplicate } = await ingestEvent(repo, record);
      if (!duplicate) {
        processEvent(repo, event).catch((err) =>
          req.log.warn({ err: err.message, event: event.id }, "crm events: processamento falhou (o runner tenta de novo)"));
      }
      return reply.code(202).send({ received: true, duplicate, id: event.id });
    });
  });

  app.get("/api/customers/:id/timeline", async (req, reply) => {
    if (!(await repo.get("customers", req.params.id))) return reply.code(404).send({ error: "Cliente não encontrado." });
    return buildTimeline(repo, { customer: req.params.id, limit: limitOf(req.query) });
  });

  app.get("/api/leads/:id/timeline", async (req, reply) => {
    if (!(await repo.get("leads", req.params.id))) return reply.code(404).send({ error: "Lead não encontrado." });
    return buildTimeline(repo, { lead: req.params.id, limit: limitOf(req.query) });
  });

  app.get("/api/crm-events", async (req) => {
    const counts = Object.fromEntries(await Promise.all(STATUSES.map(async (s) =>
      [s, (await repo.listWhere(EVENTS, { status: s }, { fields: [] })).length])));
    const status = STATUSES.includes(req.query?.status) ? req.query.status : "";
    const rows = status ? await repo.listWhere(EVENTS, { status }) : [];
    rows.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    return { counts, events: rows.slice(0, Math.min(limitOf(req.query), 500)) };
  });
}
