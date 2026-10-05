// Rota do placar por pessoa. O cálculo mora em scoreboard.js.

import { memoCompute } from "../platform/compute-cache.js";
import { dayKey } from "./metrics-core.js";
import { computeScoreboard } from "./scoreboard.js";

export function registerScoreboardRoutes(app, repo, { now = () => new Date() } = {}) {
  // Placar com cache de resultado (compute-cache.js): Visão geral, Análise de
  // Equipe e Análise de Desempenho pedem o mesmo placar da mesma janela; vale
  // até a próxima escrita no banco (ou 60 s). ?fresh=1 pula o cache.
  app.get("/api/scoreboard/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const q = req.query || {};
    const key = `scoreboard:${product.id}:${q.since || ""}:${q.until || ""}:${q.prevSince || ""}:${q.prevUntil || ""}:${dayKey(now())}`;
    return memoCompute(repo, key, () => computeScoreboard(repo, product, q, { now }), { fresh: String(q.fresh || "") === "1" });
  });
}
