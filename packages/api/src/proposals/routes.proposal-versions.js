// Versões da proposta do lead (lógica em proposal-versions.js). Sob
// /api/leads: guard do Pipeline.
//
//   GET /api/leads/:id/proposals   [{ id, version, status, createdAt, views, validUntil, … }]

import { proposalVersions } from "./proposal-versions.js";

export function registerProposalVersionRoutes(app, repo) {
  app.get("/api/leads/:id/proposals", async (req, reply) => {
    if (!(await repo.get("leads", req.params.id))) return reply.code(404).send({ error: "Lead não encontrado." });
    return { proposals: await proposalVersions(repo, req.params.id) };
  });
}
