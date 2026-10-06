// Configuração GLOBAL do follow-up em 4 contatos (mensagem, prazo e imagem
// opcional de cada contato), em app_config/followup_contacts. Vale pra todos
// os produtos. Leitura liberada pra qualquer sessão (a fila de Atividades
// também chega pelo bootstrap); escrita (inclusive o upload da imagem) só pela
// tela Configurações (screens.js, prefixo de escrita de settings).

import { randomUUID } from "node:crypto";
import { FOLLOWUP_CONTACTS_KEY, FOLLOWUP_IMAGE_PREFIX, normalizeFollowupContacts } from "../shared/followup-contacts.js";

const MAX_IMAGE = 3 * 1024 * 1024;
// Só raster: a imagem vai pra área de transferência e pro WhatsApp.
const IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/i;
const assetIdOf = (path) => (path ? path.slice(FOLLOWUP_IMAGE_PREFIX.length) : "");

export async function loadFollowupContacts(repo) {
  const rec = await repo.get("app_config", FOLLOWUP_CONTACTS_KEY).catch(() => null);
  return normalizeFollowupContacts(rec?.contacts);
}

export async function saveFollowupContacts(repo, raw, { by = "" } = {}) {
  const contacts = normalizeFollowupContacts(raw);
  const payload = { contacts, updatedBy: by };
  const cur = await repo.get("app_config", FOLLOWUP_CONTACTS_KEY).catch(() => null);
  if (cur) await repo.update("app_config", FOLLOWUP_CONTACTS_KEY, payload);
  else await repo.create("app_config", { id: FOLLOWUP_CONTACTS_KEY, ...payload });
  // Imagem trocada ou removida: o arquivo antigo sai do banco (best-effort).
  const keep = new Set(contacts.map((c) => c.imagem).filter(Boolean));
  for (const old of normalizeFollowupContacts(cur?.contacts).map((c) => c.imagem)) {
    if (old && !keep.has(old)) await repo.remove("followup_assets", assetIdOf(old)).catch(() => {});
  }
  return contacts;
}

export function registerFollowupConfigRoutes(app, repo) {
  app.get("/api/followup-contacts", async () => ({ contacts: await loadFollowupContacts(repo) }));
  app.put("/api/followup-contacts", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const contacts = await saveFollowupContacts(repo, body.contacts ?? body, { by: req.authUser?.id || "api" });
    return { contacts };
  });

  // Imagem de um contato: base64 em `followup_assets`. O upload só devolve o
  // caminho; ela passa a valer quando a configuração é salva com ele.
  app.post("/api/followup-contacts/image", async (req, reply) => {
    let file;
    try { file = await req.file({ limits: { fileSize: MAX_IMAGE } }); }
    catch { return reply.code(413).send({ error: "imagem acima de 3MB: recorte ou comprima" }); }
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!IMAGE_MIME.test(file.mimetype || "")) return reply.code(400).send({ error: "envie PNG, JPG, GIF ou WebP" });
    let buf;
    try { buf = await file.toBuffer(); }
    catch { return reply.code(413).send({ error: "imagem acima de 3MB: recorte ou comprima" }); }
    if (buf.length > MAX_IMAGE) return reply.code(413).send({ error: "imagem acima de 3MB: recorte ou comprima" });
    const id = `fua_${randomUUID()}`;
    await repo.create("followup_assets", {
      id, mime: file.mimetype.toLowerCase(), size: buf.length, name: file.filename || "",
      data: buf.toString("base64"), by: req.authUser?.id || "", at: new Date().toISOString(),
    });
    return { id, url: `${FOLLOWUP_IMAGE_PREFIX}${id}` };
  });

  // Rota ABERTA (a tag <img> não manda header): o id randômico é a chave.
  app.get(`${FOLLOWUP_IMAGE_PREFIX}:id`, async (req, reply) => {
    const doc = await repo.get("followup_assets", req.params.id).catch(() => null);
    if (!doc) return reply.code(404).send({ error: "imagem não encontrada" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("x-content-type-options", "nosniff");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });
}
