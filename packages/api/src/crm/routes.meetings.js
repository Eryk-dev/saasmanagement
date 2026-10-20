// Calls de venda como registro (lógica em meetings.js).
//
//   GET /api/leads/:id/meetings              as calls do lead, da mais nova pra mais velha (guard do Pipeline)
//   GET /api/meetings/report?from&to&saas    placar por closer: marcadas, realizadas, no-show, comparecimento

import { MEETINGS, meetingsReport } from "./meetings.js";

const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || "")) ? String(v).slice(0, 10) : "");

export function registerMeetingRoutes(app, repo) {
  app.get("/api/leads/:id/meetings", async (req, reply) => {
    if (!(await repo.get("leads", req.params.id))) return reply.code(404).send({ error: "Lead não encontrado." });
    const rows = await repo.listWhere(MEETINGS, { lead: req.params.id });
    return { meetings: rows.sort((a, b) => String(b.at).localeCompare(String(a.at))) };
  });
  app.get("/api/meetings/report", async (req) => meetingsReport(repo, {
    from: day(req.query?.from), to: day(req.query?.to), saas: String(req.query?.saas || ""),
  }));
}
