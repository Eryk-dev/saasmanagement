// Atividades ligadas a registros (lógica em activity-cards.js).
//
//   POST /api/crm-activities                 { type, record: { kind, id }, owner, dueDate, title?, note? }
//   GET  /api/crm-activities?lead=|customer= as atividades do registro
//   POST /api/crm-activities/:id/complete    { completed } conclui ou reabre
//
// Guard: /api/crm-activities vale pra quem trabalha lead ou cliente (screens.js).

import { activitiesOf, completeActivityCard, createActivityCard } from "./activity-cards.js";

export function registerActivityCardRoutes(app, repo) {
  app.post("/api/crm-activities", async (req, reply) => {
    try {
      return reply.code(201).send(await createActivityCard(repo, req.body, { by: req.authUser?.id || "api" }));
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
  app.post("/api/crm-activities/:id/complete", async (req, reply) => {
    try {
      return await completeActivityCard(repo, req.params.id, req.body?.completed, { by: req.authUser?.id || "api" });
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
  app.get("/api/crm-activities", async (req) => ({
    activities: await activitiesOf(repo, { lead: String(req.query?.lead || ""), customer: String(req.query?.customer || "") }),
  }));
}
