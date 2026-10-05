// Foto anexada aos toques da timeline (activity_assets).

import { randomUUID } from "node:crypto";

export function registerActivityAssetRoutes(app, repo) {
  // Foto anexada a um toque da timeline (print da conversa, comprovante de
  // pagamento). Bytes na collection `activity_assets` e URL em
  // /public/activities/:id — a tag <img> não manda header, então a rota é aberta
  // e o id randômico é a chave, mesmo desenho de /public/training e
  // /public/social, que já rodam. O anexo entra em `activity.meta.photo`, sem
  // coluna nova: quem não conhece o campo simplesmente não mostra a foto.
  // Precede o CRUD genérico (POST /api/:collection não pega 2 segmentos, mas
  // deixar antes evita surpresa se alguém criar /api/:collection/:id um dia).
  app.post("/api/activities/asset", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!/^image\//.test(file.mimetype || "")) return reply.code(400).send({ error: "só aceito imagem" });
    const buf = await file.toBuffer();
    if (buf.length > 5 * 1024 * 1024) return reply.code(413).send({ error: "imagem acima de 5MB — recorte ou comprima" });
    const id = `aa_${randomUUID()}`;
    await repo.create("activity_assets", {
      id, mime: file.mimetype, size: buf.length, name: file.filename || "",
      data: buf.toString("base64"), by: req.authUser?.id || "", at: new Date().toISOString(),
    });
    return { id, url: `/public/activities/${id}` };
  });

  app.get("/public/activities/:id", async (req, reply) => {
    const doc = await repo.get("activity_assets", req.params.id);
    if (!doc) return reply.code(404).send({ error: "imagem não encontrada" });
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });
}
