// Mídia recebida no inbox (áudio/imagem/…): o webhook guarda a REFERÊNCIA (id da
// Meta) na mensagem, e GET /api/whatsapp/media/:id baixa o binário (com o token),
// cacheia em wa_media e serve — o player toca via blob. Sem cachear, o id da
// Meta expira e o áudio se perderia.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");

function fakeWa({ fetchMediaCalls = [], sent = [], bytes = Buffer.from("OPUSAUDIO") } = {}) {
  return {
    configured: () => true,
    verifyWebhook: () => null,
    async sendText() { return { messageId: "x" }; },
    async fetchMedia(id) { fetchMediaCalls.push(id); return { buf: bytes, mime: "audio/ogg; codecs=opus" }; },
    async uploadMedia(buf, opts) { sent.push({ step: "upload", size: buf.length, mime: opts.mime, filename: opts.filename }); return "UP_1"; },
    async sendMedia(to, m, opts) { sent.push({ step: "send", to, ...m }); return { messageId: "wamid.OUT_MEDIA" }; },
    sent,
  };
}

function buildMultipart(bytes, { name = "nota-de-voz.ogg", type = "audio/ogg" } = {}) {
  const boundary = "----cockpitMediaBoundary";
  const chunks = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function appWith(repo, wa) {
  const app = Fastify();
  await app.register(multipart);
  registerWhatsappRoutes(app, repo, { whatsapp: wa });
  await app.ready();
  return app;
}

const inAudio = (from, id, mediaId) => ({
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name: "Cliente" } }],
    messages: [{ from, id, timestamp: "1720000000", type: "audio", audio: { id: mediaId, mime_type: "audio/ogg; codecs=opus", voice: true } }],
  } }] }],
});

test("webhook de áudio guarda a referência da mídia na mensagem", async () => {
  const repo = makeMemRepo();
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inAudio("5541999", "wamid.A1", "MEDIA_123") });
  const msg = (await repo.list("wa_messages"))[0];
  assert.equal(msg.text, "🎤 áudio");           // texto legível como antes
  assert.deepEqual(msg.media, { kind: "audio", id: "MEDIA_123", mime: "audio/ogg; codecs=opus", filename: "" });
  await app.close();
});

test("GET media baixa da Graph na 1ª vez, cacheia e serve o binário; 2ª vez vem do cache", async () => {
  const repo = makeMemRepo();
  const calls = [];
  const app = await appWith(repo, fakeWa({ fetchMediaCalls: calls }));
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inAudio("5541999", "wamid.A1", "MEDIA_123") });

  const r1 = await app.inject({ method: "GET", url: "/api/whatsapp/media/wamid.A1" });
  assert.equal(r1.statusCode, 200);
  assert.match(r1.headers["content-type"], /audio\/ogg/);
  assert.equal(r1.rawPayload.toString(), "OPUSAUDIO");
  assert.equal(calls.length, 1);               // bateu na Graph 1x
  assert.ok(await repo.get("wa_media", "wamid.A1")); // cacheou

  const r2 = await app.inject({ method: "GET", url: "/api/whatsapp/media/wamid.A1" });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.rawPayload.toString(), "OPUSAUDIO");
  assert.equal(calls.length, 1);               // NÃO bateu de novo (veio do cache)
  await app.close();
});

test("enviar áudio: sobe (uploadMedia) + envia (sendMedia), grava a msg out com a mídia e cacheia o binário", async () => {
  const repo = makeMemRepo();
  const sent = [];
  const app = await appWith(repo, fakeWa({ sent }));
  const mp = buildMultipart(Buffer.from("MEUOPUS12345678"), { name: "nota-de-voz.ogg", type: "audio/ogg" });
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541999/media", payload: mp.body, headers: { "content-type": mp.contentType } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, messageId: "wamid.OUT_MEDIA", kind: "audio" });

  // 2 passos na ordem certa, com o mime do arquivo
  assert.equal(sent[0].step, "upload");
  assert.equal(sent[0].mime, "audio/ogg");
  assert.equal(sent[1].step, "send");
  assert.equal(sent[1].kind, "audio");
  assert.equal(sent[1].mediaId, "UP_1");

  // mensagem out com a referência da mídia (a bolha vira player no nosso inbox)
  const msg = await repo.get("wa_messages", "wamid.OUT_MEDIA");
  assert.equal(msg.direction, "out");
  assert.equal(msg.text, "🎤 áudio");
  assert.equal(msg.media.kind, "audio");
  assert.equal(msg.media.id, "UP_1");
  // binário cacheado sob o id da mensagem → toca de volta sem re-baixar
  const media = await repo.get("wa_media", "wamid.OUT_MEDIA");
  assert.ok(media?.data);
  assert.equal(Buffer.from(media.data, "base64").toString(), "MEUOPUS12345678");
  await app.close();
});

test("enviar imagem detecta o kind pelo mime", async () => {
  const repo = makeMemRepo();
  const sent = [];
  const app = await appWith(repo, fakeWa({ sent }));
  const mp = buildMultipart(Buffer.from("PNGDATA"), { name: "foto.png", type: "image/png" });
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541999/media", payload: mp.body, headers: { "content-type": mp.contentType } });
  assert.equal(res.json().kind, "image");
  assert.equal(sent[1].kind, "image");
  await app.close();
});

test("media de mensagem sem mídia → 404; id expirado na Graph → 502 legível", async () => {
  const repo = makeMemRepo();
  await repo.create("wa_messages", { id: "txt1", thread: "5541999", direction: "in", text: "oi" });
  const boom = {
    configured: () => true, verifyWebhook: () => null, async sendText() { return {}; },
    async fetchMedia() { throw new Error("a Meta não devolveu a URL da mídia (id expirado?)"); },
  };
  const app = await appWith(repo, boom);
  assert.equal((await app.inject({ method: "GET", url: "/api/whatsapp/media/txt1" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/whatsapp/media/naoexiste" })).statusCode, 404);

  await repo.create("wa_messages", { id: "aud1", thread: "5541999", direction: "in", text: "🎤 áudio", media: { kind: "audio", id: "EXP", mime: "audio/ogg" }, waPhoneId: "PN1" });
  const exp = await app.inject({ method: "GET", url: "/api/whatsapp/media/aud1" });
  assert.equal(exp.statusCode, 502);
  assert.match(exp.json().error, /expirado/);
  await app.close();
});
