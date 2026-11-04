// Cancelar a venda de um negócio (regra em sale-cancel.js).
//
//   POST /api/leads/:id/cancel-sale   { stage?, lostReason?, lostNote?, note? }
//     → { ok, lead, customerRemoved }
//   400 etapa ausente/inválida · 409 sem venda ou com cobrança real do MP

import { cancelLeadSale } from "./sale-cancel.js";

export function registerSaleCancelRoutes(app, repo) {
  app.post("/api/leads/:id/cancel-sale", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "lead não encontrado" });
    const b = req.body || {};
    try {
      const r = await cancelLeadSale(repo, lead, {
        stage: typeof b.stage === "string" ? b.stage : "",
        lostReason: typeof b.lostReason === "string" ? b.lostReason : "",
        lostNote: typeof b.lostNote === "string" ? b.lostNote : "",
        note: typeof b.note === "string" ? b.note : "",
        author: req.authUser?.id || "api",
      });
      return { ok: true, ...r };
    } catch (err) {
      if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      throw err;
    }
  });
}
