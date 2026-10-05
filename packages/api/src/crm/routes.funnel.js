// Funil do produto: grava as etapas e migra os cards dos estágios renomeados.

export function registerFunnelRoutes(app, repo) {
  // ── Funil do produto com migração de renomes (fase 3) ────────────────────
  // `lead.stage`/`deal.stage` guardam o NOME do estágio sem FK — renomear via
  // PATCH cru órfã os cards. Este endpoint grava o funil e migra os registros:
  // body { funnel: [...], renames: { "Nome antigo": "Nome novo" } }.
  app.put("/api/products/:id/funnel", async (req, reply) => {
    const product = await repo.get("products", req.params.id);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { funnel, renames } = req.body || {};
    if (!Array.isArray(funnel)) return reply.code(400).send({ error: "funnel array required" });
    const map = renames && typeof renames === "object" ? renames : {};
    const valid = new Set(funnel.map((f) => f.stage));
    let migrated = 0;
    for (const collection of ["leads", "deals"]) {
      for (const item of await repo.list(collection)) {
        if (item.saas !== product.id) continue;
        const to = map[item.stage];
        if (to && to !== item.stage && valid.has(to)) {
          await repo.update(collection, item.id, { stage: to });
          migrated++;
        }
      }
    }
    const updated = await repo.update("products", product.id, { funnel });
    return { ok: true, migrated, product: updated };
  });
}
