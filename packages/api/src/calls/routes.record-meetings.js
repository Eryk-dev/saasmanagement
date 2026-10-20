// Reuniões com Meet próprio nos registros do cliente (lógica em
// record-meetings.js). Sob /api/customers, então segue o guard de Clientes.
//
//   POST   /api/customers/{onboardings|followups}/:id/meetings            { at, label?, responsible?, guests? }
//   PATCH  /api/customers/{onboardings|followups}/:id/meetings/:mid       { at } remarca (o convite acompanha)
//   DELETE /api/customers/{onboardings|followups}/:id/meetings/:mid       cancela e apaga o evento
//   POST   /api/customers/{onboardings|followups}/:id/meetings/:mid/summary   resume agora (o poller resume sozinho)
//   GET    /api/customers/:id/record-meetings     as reuniões de todos os registros do cliente

import { makeRecordMeetings, meetingsOfCustomer } from "./record-meetings.js";

const SEGMENTS = [["onboardings", "onboardings"], ["followups", "cs_followups"]];

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message, ...(err.reason ? { reason: err.reason } : {}) });
    throw err;
  }
}

export function registerRecordMeetingRoutes(app, repo, { google, googleUser, anthropic }) {
  const meetings = makeRecordMeetings({ repo, google, googleUser, anthropic, log: app.log });
  const by = (req) => req.authUser?.id || "api";
  app.get("/api/customers/:id/record-meetings", async (req) => ({ meetings: await meetingsOfCustomer(repo, req.params.id) }));
  for (const [segment, collection] of SEGMENTS) {
    const base = `/api/customers/${segment}/:id/meetings`;
    app.post(base, async (req, reply) => guard(reply, async () =>
      reply.code(201).send(await meetings.schedule(collection, req.params.id, req.body || {}, { by: by(req) }))));
    app.patch(`${base}/:mid`, async (req, reply) => guard(reply, () =>
      meetings.reschedule(collection, req.params.id, req.params.mid, req.body || {})));
    app.delete(`${base}/:mid`, async (req, reply) => guard(reply, () =>
      meetings.cancel(collection, req.params.id, req.params.mid)));
    app.post(`${base}/:mid/summary`, async (req, reply) => guard(reply, () =>
      meetings.summarize(collection, req.params.id, req.params.mid, { force: req.body?.force === true })));
  }
}
