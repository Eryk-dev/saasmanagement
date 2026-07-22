// UniqueKids · Protocolo de Rotina — sugestão de solução por IA pra orientar a
// Ana na call, a partir do desafio da família + método R.O.T.I.N.A. Grava em
// lead.sugestaoSolucao (editável pela Ana no drawer). Rota sob /api/leads
// (mesmo guard de pipeline/today — a Ana alcança).

// Rótulo humano de um valor de select (idade/neuro) via leadQuestions do produto.
import { UPSTREAM_FAILED, NOT_CONFIGURED } from "./http-status.js";

function labelFor(product, key, value) {
  if (!value) return "";
  const q = (product?.leadQuestions || []).find((x) => x.key === key);
  const opt = (q?.options || []).find((o) => o.value === value);
  return opt?.label || value;
}

export function registerRoutineRoutes(app, repo, { anthropic } = {}) {
  app.post("/api/leads/:id/routine-suggestion", async (req, reply) => {
    if (!anthropic?.configured?.()) return reply.code(NOT_CONFIGURED).send({ error: "IA não configurada no servidor" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    try {
      const { sugestao } = await anthropic.routineSuggestion({
        productName: product?.name || "UniqueKids",
        idade: labelFor(product, "idade", lead.idade),
        desafio: lead.desafio || "",
        exemplo: lead.desafio_exemplo || "",
        neuro: labelFor(product, "neuro", lead.neuro),
        tentou: lead.tentou || "",
      });
      await repo.update("leads", lead.id, { sugestaoSolucao: sugestao });
      return { ok: true, sugestao };
    } catch (err) {
      return reply.code(UPSTREAM_FAILED).send({ error: String(err.message || err).slice(0, 300) });
    }
  });
}
