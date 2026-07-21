// Mídia recebida no inbox (áudio/imagem/…): o webhook guarda a REFERÊNCIA (id da
// Meta) na mensagem, e GET /api/whatsapp/media/:id baixa o binário (com o token),
// cacheia em wa_media e serve — o player toca via blob. Sem cachear, o id da
// Meta expira e o áudio se perderia.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");

function fakeWa({ fetchMediaCalls = [], bytes = Buffer.from("OPUSAUDIO") } = {}) {
  return {
    configured: () => true,
    verifyWebhook: () => null,
    async sendText() { return { messageId: "x" }; },
    async fetchMedia(id) { fetchMediaCalls.push(id); return { buf: bytes, mime: "audio/ogg; codecs=opus" }; },
  };
}

async function appWith(repo, wa) {
  const app = Fastify();
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
