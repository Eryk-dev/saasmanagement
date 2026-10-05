// Anexos dos tickets (upload e download), usados pelo painel de Tickets e
// pelo portal do Suporte.

import { randomUUID } from "node:crypto";

const MAX_ASSET = 5 * 1024 * 1024;

// Arquivo do ticket: bytes em base64 em `ticket_assets`, preso ao ticket
// (`ticket`), servido só por rota com escopo (interna) ou pelo token (portal).
export async function readTicketUpload(req, reply, repo, ticketId, by) {
  let file;
  try { file = await req.file({ limits: { fileSize: MAX_ASSET } }); }
  catch (err) { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large", detail: err?.message }); return null; }
  if (!file) { reply.code(400).send({ error: "envie um arquivo (multipart, campo file)" }); return null; }
  let buf;
  try { buf = await file.toBuffer(); }
  catch { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large" }); return null; }
  if (buf.length > MAX_ASSET) { reply.code(413).send({ error: "arquivo acima de 5MB", code: "asset_too_large" }); return null; }
  const id = `tia_${randomUUID()}`;
  await repo.create("ticket_assets", {
    id, ticket: ticketId, mime: file.mimetype || "application/octet-stream", size: buf.length, name: file.filename || "",
    data: buf.toString("base64"), by, at: new Date().toISOString(),
  });
  return { id, name: file.filename || "", mime: file.mimetype || "", size: buf.length };
}

export async function sendTicketAsset(reply, repo, ticket, aid) {
  const ref = (ticket.attachments || []).find((a) => a.id === aid);
  const doc = ref ? await repo.get("ticket_assets", aid) : null;
  if (!doc || doc.ticket !== ticket.id) return reply.code(404).send({ error: "arquivo não encontrado" });
  const mime = doc.mime || "application/octet-stream";
  // O mime vem de quem enviou (inclusive o cliente anônimo do portal): só
  // imagem raster e PDF abrem no navegador; SVG/HTML baixam, e o sandbox impede
  // script de rodar na origem do cockpit.
  const inline = /^image\/(png|jpe?g|gif|webp)$/i.test(mime) || mime === "application/pdf";
  const safeName = String(doc.name || doc.id).replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  reply.header("cache-control", "private, max-age=3600");
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
  return reply.type(mime).send(Buffer.from(doc.data || "", "base64"));
}
