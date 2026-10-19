// Tela Versões e novidades (só admin) e o recorte público das novidades.
//
//   GET    /api/releases/apps                 versão no ar de cada app
//   GET    /api/releases/updates?saas=        novidades (rascunhos + publicadas)
//   POST   /api/releases/updates              cria
//   PATCH  /api/releases/updates/:id          edita / publica / volta a rascunho
//   DELETE /api/releases/updates/:id          apaga
//   POST   /api/releases/assets               print (multipart `file`, imagem ≤ 5MB)
//   GET    /public/updates/:saas              publicadas do produto (aberta)
//   GET    /public/updates/assets/:id         o print (aberta, cache imutável)
//
// /api/releases fica na tela `releases` (screens.js); além dela, aqui exige a
// etiqueta admin — sem sessão é a key mestre, que passa.

import { randomUUID } from "node:crypto";
import { appVersions } from "./app-versions.js";
import { ASSETS, ASSET_PREFIX, COLLECTION, PRODUCTS, adminUpdates, normalizeUpdate, publicUpdates } from "./product-updates.js";

const MAX_ASSET = 5 * 1024 * 1024;
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;

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

  // Print da novidade: base64 na coleção PRIVATE (como os anexos de tarefa);
  // o id randômico é a chave do <img>.
  app.post("/api/releases/assets", { preHandler: adminOnly }, async (req, reply) => {
    let file;
    try { file = await req.file({ limits: { fileSize: MAX_ASSET } }); }
    catch { return reply.code(413).send({ error: "imagem acima de 5MB: recorte ou comprima", code: "asset_too_large" }); }
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!IMAGE_MIME.test(file.mimetype || "")) return reply.code(400).send({ error: "só PNG, JPEG, WebP ou GIF" });
    let buf;
    try { buf = await file.toBuffer(); }
    catch { return reply.code(413).send({ error: "imagem acima de 5MB: recorte ou comprima", code: "asset_too_large" }); }
    if (buf.length > MAX_ASSET) return reply.code(413).send({ error: "imagem acima de 5MB: recorte ou comprima", code: "asset_too_large" });
    const id = `pua_${randomUUID()}`;
    await repo.create(ASSETS, {
      id, mime: file.mimetype, size: buf.length, name: String(file.filename || "").slice(0, 120),
      data: buf.toString("base64"), by: req.authUser?.id || "", at: new Date().toISOString(),
    });
    return reply.code(201).send({ id, url: `${ASSET_PREFIX}${id}`, size: buf.length });
  });

  app.get("/public/updates/assets/:id", async (req, reply) => {
    const doc = await repo.get(ASSETS, req.params.id).catch(() => null);
    if (!doc) return reply.code(404).send({ error: "imagem não encontrada" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("x-content-type-options", "nosniff");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
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
