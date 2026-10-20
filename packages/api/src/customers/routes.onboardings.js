// Integrações do cliente (lógica em onboardings.js). Sob /api/customers, então
// segue o guard de Clientes.
//
//   GET   /api/customers/onboardings?open=1       todas (ou só as abertas)
//   POST  /api/customers/onboardings/backfill     { apply } carga a partir dos leads
//   GET   /api/customers/onboardings/:id          uma integração, com o progresso
//   PATCH /api/customers/onboardings/:id          etapa, datas, integrador, checklist
//   GET   /api/customers/:id/onboardings          as integrações do cliente
//   POST  /api/customers/:id/onboardings          { kind, product, integrator, kickoffAt, plannedGoLiveAt, items }

import { ONBOARDINGS, backfillOnboardings, createOnboarding, onboardingsOf, progressOf, updateOnboarding } from "./onboardings.js";

const withProgress = (o) => ({ ...o, progress: progressOf(o) });
const OPEN = (o) => !["concluida", "cancelada"].includes(o.stage);

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
}

export function registerOnboardingRoutes(app, repo) {
  app.get("/api/customers/onboardings", async (req) => {
    const all = await repo.list(ONBOARDINGS);
    return { onboardings: (req.query?.open ? all.filter(OPEN) : all).map(withProgress) };
  });

  app.post("/api/customers/onboardings/backfill", async (req) => backfillOnboardings(repo, { apply: req.body?.apply === true }));

  app.get("/api/customers/onboardings/:id", async (req, reply) => {
    const o = await repo.get(ONBOARDINGS, req.params.id);
    return o ? withProgress(o) : reply.code(404).send({ error: "Integração não encontrada." });
  });

  app.patch("/api/customers/onboardings/:id", async (req, reply) => guard(reply, async () =>
    withProgress(await updateOnboarding(repo, req.params.id, req.body, { by: req.authUser?.id || "api" }))));

  app.get("/api/customers/:id/onboardings", async (req) => ({ onboardings: (await onboardingsOf(repo, req.params.id)).map(withProgress) }));

  app.post("/api/customers/:id/onboardings", async (req, reply) => guard(reply, async () =>
    reply.code(201).send(withProgress(await createOnboarding(repo, { ...req.body, customer: req.params.id }, { by: req.authUser?.id || "api" })))));
}
