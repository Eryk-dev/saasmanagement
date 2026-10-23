// Régua de nota/ICP do produto: leitura, prévia, gravação e histórico.
// Ler é aberto (toda tela precisa da régua); prever, gravar e restaurar exigem
// a etiqueta admin ou a etiqueta "Editor de ICP" dada em Ajustes → Equipe —
// a trava fica no guard de telas (auth/screens.js, ICP_EDIT_PATH).

import { validateIcpRules } from "../shared/icp-rules.js";
import { icpPreview, icpState, icpTrend, icpVersions, saveIcp } from "./icp.js";

export function registerIcpRoutes(app, repo) {
  const productOr404 = async (req, reply) => {
    const product = await repo.get("products", req.params.id);
    if (!product) reply.code(404).send({ error: "Produto não encontrado" });
    return product;
  };

  app.get("/api/products/:id/icp", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return reply;
    const forms = await repo.listWhere("forms", { saas: product.id }).catch(() => []);
    return icpState(product, forms);
  });

  app.get("/api/products/:id/icp/versions", async (req, reply) => {
    const product = await productOr404(req, reply);
    return product ? { versions: await icpVersions(repo, product.id) } : reply;
  });

  app.get("/api/products/:id/icp/trend", async (req, reply) => {
    const product = await productOr404(req, reply);
    return product ? icpTrend(repo, product) : reply;
  });

  app.post("/api/products/:id/icp/preview", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return reply;
    const v = validateIcpRules(req.body?.rules);
    if (!v.ok) return reply.code(400).send({ error: v.errors[0], errors: v.errors });
    return icpPreview(repo, product, v.rules);
  });

  // body { text?, rules?, baseVersion?, note? }
  app.put("/api/products/:id/icp", async (req, reply) => {
    const product = await productOr404(req, reply);
    if (!product) return reply;
    try {
      const out = await saveIcp(repo, product, req.body || {}, { by: req.authUser?.id || "api" });
      return { ...icpState(out.product), changed: out.changed, recalculated: out.recalculated, version: out.version };
    } catch (err) {
      if (err?.statusCode) return reply.code(err.statusCode).send({ error: err.message, ...(err.errors ? { errors: err.errors } : {}), ...(err.currentVersion != null ? { currentVersion: err.currentVersion } : {}) });
      throw err;
    }
  });
}
