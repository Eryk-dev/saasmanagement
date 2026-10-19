// Tela Versões e novidades (só admin) e o recorte público das novidades.
//
//   GET    /api/releases/apps                 versão no ar de cada app
//   GET    /api/releases/updates?saas=        novidades (rascunhos + publicadas)
//   POST   /api/releases/updates              cria
//   PATCH  /api/releases/updates/:id          edita / publica / volta a rascunho
//   DELETE /api/releases/updates/:id          apaga
//   GET    /public/updates/:saas              publicadas do produto (aberta)
//
// /api/releases fica na tela `releases` (screens.js); além dela, aqui exige a
// etiqueta admin — sem sessão é a key mestre, que passa.

import { appVersions } from "./app-versions.js";
import { COLLECTION, PRODUCTS, adminUpdates, normalizeUpdate, publicUpdates } from "./product-updates.js";

const isAdmin = (u) => !u || (u.roles || []).includes("admin");

export function registerReleasesRoutes(app, repo, { fetchImpl } = {}) {
  const adminOnly = async (req, reply) => {
    if (!isAdmin(req.authUser)) return reply.code(403).send({ error: "Versões e novidades é só pra quem tem a etiqueta admin" });
  };

  app.get("/api/releases/apps", { preHandler: adminOnly }, async () => appVersions({ fetchImpl }));

  app.get("/api/releases/updates", { preHandler: adminOnly }, async (req) =>
    adminUpdates(await repo.list(COLLECTION), String(req.query?.saas || "")));

  app.post("/api/releases/updates", { preHandler: adminOnly }, async (req, reply) => {
    const { doc, error } = normalizeUpdate(req.body || {}, null, { author: req.authUser?.id || "" });
    if (error) return reply.code(400).send({ error });
    return reply.code(201).send(await repo.create(COLLECTION, doc));
  });

  app.patch("/api/releases/updates/:id", { preHandler: adminOnly }, async (req, reply) => {
    const prev = await repo.get(COLLECTION, req.params.id);
    if (!prev) return reply.code(404).send({ error: "Novidade não encontrada." });
    const { doc, error } = normalizeUpdate(req.body || {}, prev);
    if (error) return reply.code(400).send({ error });
    return repo.update(COLLECTION, prev.id, doc);
  });

  app.delete("/api/releases/updates/:id", { preHandler: adminOnly }, async (req, reply) => {
    const prev = await repo.get(COLLECTION, req.params.id);
    if (!prev) return reply.code(404).send({ error: "Novidade não encontrada." });
    await repo.remove(COLLECTION, prev.id);
    return { ok: true };
  });

  // Aberta (OPEN_PREFIXES). Nunca 5xx: a página do produto mostra a última
  // lista boa que tiver, e um hiccup aqui não pode virar erro lá.
  app.get("/public/updates/:saas", async (req, reply) => {
    reply.header("cache-control", "public, max-age=120");
    const saas = String(req.params.saas || "");
    if (!PRODUCTS.includes(saas)) return reply.code(404).send({ items: [] });
    try {
      return { items: publicUpdates(await repo.list(COLLECTION), saas) };
    } catch {
      return { items: [] };
    }
  });
}
