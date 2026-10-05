// Rotas do pace do pipeline. O cálculo mora em pipeline-pace.js.

import { cachedPipelinePace, computeWindowGoal } from "./pipeline-pace.js";

export function registerPipelinePaceRoutes(app, repo, { now = () => new Date() } = {}) {
  app.get("/api/pipeline-pace/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    return cachedPipelinePace(repo, product, now(), { fresh: String(req.query?.fresh || "") === "1" });
  });
  // Meta de uma janela qualquer (a faixa da Visão geral seguindo o filtro).
  app.get("/api/pipeline-pace/:saas/window", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
    const since = String(req.query.since || "");
    const until = String(req.query.until || "");
    if (!ok(since) || !ok(until) || since > until) return reply.code(400).send({ error: "since/until inválidos (YYYY-MM-DD)" });
    return computeWindowGoal(repo, product, since, until, now());
  });
}
