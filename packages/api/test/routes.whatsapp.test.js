// WhatsApp Cloud API — client (sendText/verifyWebhook/digits + erro de 24h) e
// rotas (verificação do webhook, recebimento → activity no lead casado por
// telefone, dedup, status, número sem lead → wa_messages, envio pelo drawer).
// Tudo offline com fetch/cliente mockado.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeWhatsapp, digits } = await import("../src/whatsapp.js");
const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");

function okFetch(body = { messages: [{ id: "wamid.OUT1" }] }) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, payload: JSON.parse(init.body || "{}") });
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

test("digits: normaliza número BR (adiciona DDI 55 no local, mantém E.164)", () => {
  assert.equal(digits("(41) 99251-6545"), "5541992516545");
  assert.equal(digits("5541992516545"), "5541992516545");
  assert.equal(digits("+55 41 99251-6545"), "5541992516545");
  assert.equal(digits(""), "");
});

test("client: sendText posta no número certo com bearer e verifyWebhook confere token", async () => {
  const f = okFetch();
  const wa = makeWhatsapp({ fetch: f, token: "tok", phoneNumberId: "PN1", verifyToken: "vt" });
  assert.equal(wa.configured(), true);

  const { messageId } = await wa.sendText("41992516545", "oi");
  assert.equal(messageId, "wamid.OUT1");
  const c = f.calls[0];
  assert.ok(c.url.endsWith("/PN1/messages"));
  assert.equal(c.init.headers.authorization, "Bearer tok");
  assert.equal(c.payload.to, "5541992516545");
  assert.equal(c.payload.text.body, "oi");

  assert.equal(wa.verifyWebhook("subscribe", "vt", "CHAL"), "CHAL");
  assert.equal(wa.verifyWebhook("subscribe", "errado", "CHAL"), null);
});

test("client: erro da Meta (fora das 24h) propaga status/code", async () => {
  const f = async () => ({ status: 400, text: async () => JSON.stringify({ error: { message: "re-engagement", code: 131047 } }) });
  const wa = makeWhatsapp({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  await assert.rejects(() => wa.sendText("x", "y"), (e) => e.code === 131047 && e.status === 400);
});

// Cliente fake pras rotas (sem rede): registra o que foi enviado.
function fakeWa() {
  const sent = [];
  return {
    sent,
    configured: () => true,
    verifyWebhook: (mode, tok, ch) => (mode === "subscribe" && tok === "vt" ? String(ch) : null),
    async sendText(to, text) { sent.push({ to, text }); return { messageId: "wamid.SENT" }; },
    async sendTemplate() { return { messageId: "wamid.T" }; },
    async markRead() {},
  };
}

async function appWith(repo, wa) {
  const app = Fastify();
  registerWhatsappRoutes(app, repo, { whatsapp: wa });
  await app.ready();
  return app;
}

test("webhook GET: verifica com o token e devolve o challenge; erra → 403", async () => {
  const app = await appWith(makeMemRepo(), fakeWa());
  const ok = await app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, "42");
  const no = await app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42" });
  assert.equal(no.statusCode, 403);
  await app.close();
});

test("webhook POST: mensagem recebida vira activity no lead casado por telefone (dedup)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545", stage: "novo" });
  const app = await appWith(repo, fakeWa());

  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: "Cliente" } }],
      messages: [{ from: "5541992516545", id: "wamid.IN1", timestamp: "1720000000", type: "text", text: { body: "quero saber mais" } }],
    } }] }],
  };
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload });
  // reentrega (Meta re-tenta) não duplica
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload });

  const acts = (await repo.list("activities")).filter((a) => a.type === "whatsapp");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].lead, "ld1");
  assert.equal(acts[0].meta.direction, "in");
  assert.equal(acts[0].meta.waMessageId, "wamid.IN1");
  assert.equal(acts[0].text, "quero saber mais");
  const lead = await repo.get("leads", "ld1");
  assert.equal(lead.lastActivityType, "whatsapp");
  await app.close();
});

test("webhook POST: número sem lead cai em wa_messages; status atualiza a activity enviada", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41000000000" });
  await repo.create("activities", { id: "ac_x", lead: "ld1", type: "whatsapp", text: "ping", meta: { direction: "out", waMessageId: "wamid.OUT9", status: "sent" } });
  const app = await appWith(repo, fakeWa());

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: {
    entry: [{ changes: [{ value: { messages: [{ from: "5599999999999", id: "wamid.INX", timestamp: "1720000000", type: "text", text: { body: "sou novo" } }] } }] }],
  } });
  const orphan = await repo.get("wa_messages", "wamid.INX");
  assert.equal(orphan.text, "sou novo");
  assert.equal(orphan.from, "5599999999999");

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: {
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.OUT9", status: "read" }] } }] }],
  } });
  const act = await repo.get("activities", "ac_x");
  assert.equal(act.meta.status, "read");
  await app.close();
});

test("POST /api/leads/:id/whatsapp: envia, loga activity out e devolve messageId", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545" });
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  const res = await app.inject({ method: "POST", url: "/api/leads/ld1/whatsapp", payload: { text: "bom dia!" } });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.messageId, "wamid.SENT");
  assert.equal(wa.sent[0].to, "41992516545");
  const acts = (await repo.list("activities")).filter((a) => a.type === "whatsapp");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.direction, "out");
  assert.equal(acts[0].text, "bom dia!");
  await app.close();
});

test("POST /api/leads/:id/whatsapp: lead sem telefone → 400; lead inexistente → 404", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "no-phone", saas: "leverads" });
  const app = await appWith(repo, fakeWa());
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/no-phone/whatsapp", payload: { text: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nope/whatsapp", payload: { text: "x" } })).statusCode, 404);
  await app.close();
});
