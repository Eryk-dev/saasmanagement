// Acompanhamentos de CS do cliente (lógica em cs-followups.js). Sob
// /api/customers, então segue o guard de Clientes.
//
//   GET   /api/customers/followups?open=1        todos (ou só os abertos)
//   GET   /api/customers/followups/:id           um acompanhamento
//   PATCH /api/customers/followups/:id           status, sentimento, notas, próximos passos, prazo, dono
//   GET   /api/customers/:id/followups           os acompanhamentos do cliente
//   POST  /api/customers/:id/followups           { kind, dueAt, owner, notes }

import { FOLLOWUPS, createFollowup, followupsOf, updateFollowup } from "./cs-followups.js";

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
}

export function registerFollowupRoutes(app, repo) {
  app.get("/api/customers/followups", async (req) => {
    const all = await repo.list(FOLLOWUPS);
    return { followups: req.query?.open ? all.filter((f) => f.status === "aberto") : all };
  });
  app.get("/api/customers/followups/:id", async (req, reply) => {
    const f = await repo.get(FOLLOWUPS, req.params.id);
    return f || reply.code(404).send({ error: "Acompanhamento não encontrado." });
  });
  app.patch("/api/customers/followups/:id", async (req, reply) => guard(reply, () =>
    updateFollowup(repo, req.params.id, req.body, { by: req.authUser?.id || "api" })));
  app.get("/api/customers/:id/followups", async (req) => ({ followups: await followupsOf(repo, req.params.id) }));
  app.post("/api/customers/:id/followups", async (req, reply) => guard(reply, async () =>
    reply.code(201).send(await createFollowup(repo, { ...req.body, customer: req.params.id }, { by: req.authUser?.id || "api" }))));
}
