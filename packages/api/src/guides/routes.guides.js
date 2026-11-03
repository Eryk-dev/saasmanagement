// Guias (lógica em guides.js). Ler: quem tem Guias, Clientes, Pipeline,
// Atividades ou Análise de Integração (auth/screens.js). Escrever: etiqueta
// admin ou Editor de guias.
//
//   GET    /api/guides?saas=            os guias do produto (rascunhos só para quem edita)
//   GET    /api/guides/:id              um guia
//   POST   /api/guides                  { saas, title, summary, audience, product, status, steps }
//   PATCH  /api/guides/:id              os mesmos campos + rev (409 se outro salvou antes)
//   DELETE /api/guides/:id              apaga o guia e os prints só dele
//   POST   /api/guides/starter          { saas } cria o guia de implantação e liga o checklist padrão
//   GET    /api/guides/pack?saas=       o pacote de guias da Lever: faltando, atual, desatualizado ou editado
//   POST   /api/guides/pack             { saas } instala o que falta e atualiza o que ninguém editou (guide-pack.js)
//   POST   /api/guides/assets?saas=     print (multipart, campo file, até 5 MB) → { id }
//   GET    /api/guides/assets/:id       os bytes do print (com sessão; a tela mostra em blob)

import {
  GUIDE_ASSETS, canEditGuides, createGuide, createStarterGuide, deleteGuide, getGuide,
  listGuides, saveGuideAsset, updateGuide,
} from "./guides.js";
import { installGuidePack, packStatus } from "./guide-pack.js";

async function guard(reply, fn) {
  try { return await fn(); }
  catch (err) {
    if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
}

const by = (req) => req.authUser?.id || "api";
const denied = (reply) => reply.code(403).send({ error: "Editar guias exige a etiqueta admin ou Editor de guias (Ajustes → Equipe)" });

export function registerGuideRoutes(app, repo) {
  app.get("/api/guides", async (req) => ({
    guides: await listGuides(repo, { saas: String(req.query?.saas || ""), editor: canEditGuides(req.authUser) }),
    canEdit: canEditGuides(req.authUser),
  }));

  app.post("/api/guides/starter", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    if (!(await repo.get("products", String(req.body?.saas || "")))) return reply.code(400).send({ error: "Produto do cockpit inválido." });
    return createStarterGuide(repo, String(req.body.saas), { by: by(req) });
  }));

  app.get("/api/guides/pack", async (req) => ({ guides: await packStatus(repo, String(req.query?.saas || "")) }));

  app.post("/api/guides/pack", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    if (!(await repo.get("products", String(req.body?.saas || "")))) return reply.code(400).send({ error: "Produto do cockpit inválido." });
    return installGuidePack(repo, String(req.body.saas), { by: by(req) });
  }));

  app.post("/api/guides/assets", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    const saas = String(req.query?.saas || "");
    if (!(await repo.get("products", saas))) return reply.code(400).send({ error: "Produto do cockpit inválido." });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Envie o print (multipart, campo file)." });
    const buf = await file.toBuffer();
    return reply.code(201).send(await saveGuideAsset(repo, { saas, mime: file.mimetype, buf, by: by(req) }));
  }));

  app.get("/api/guides/assets/:id", async (req, reply) => {
    const doc = await repo.get(GUIDE_ASSETS, req.params.id);
    if (!doc) return reply.code(404).send({ error: "Print não encontrado." });
    reply.header("cache-control", "private, max-age=86400, immutable");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });

  app.get("/api/guides/:id", async (req, reply) => guard(reply, () =>
    getGuide(repo, req.params.id, { editor: canEditGuides(req.authUser) })));

  app.post("/api/guides", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    return reply.code(201).send(await createGuide(repo, req.body, { by: by(req) }));
  }));

  app.patch("/api/guides/:id", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    return updateGuide(repo, req.params.id, req.body, { by: by(req) });
  }));

  app.delete("/api/guides/:id", async (req, reply) => guard(reply, async () => {
    if (!canEditGuides(req.authUser)) return denied(reply);
    return deleteGuide(repo, req.params.id);
  }));
}
