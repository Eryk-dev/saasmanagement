// WhatsApp Business Calling — cliente (habilitar/status/re-assinar/permissão/
// iniciar/encerrar) e rota de enable com retry de re-assinatura no 138018.
// Offline com fetch/cliente mockado.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { makeWaCalling } = await import("../src/wa-calling.js");
const { registerWaCallingRoutes } = await import("../src/routes.wa-calling.js");

function fetchMock(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization };
    calls.push(entry);
    const r = handler(entry) || {};
    return { status: r.status || 200, text: async () => JSON.stringify(r.body ?? {}) };
  };
  f.calls = calls;
  return f;
}

test("enableCalling: POST settings com calling.status ENABLED e bearer", async () => {
  const f = fetchMock(() => ({ body: { success: true } }));
  const wc = makeWaCalling({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  assert.equal(wc.configured(), true);
  await wc.enableCalling();
  const c = f.calls[0];
  assert.equal(c.method, "POST");
  assert.ok(c.url.endsWith("/PN1/settings"));
  assert.equal(c.auth, "Bearer tok");
  assert.deepEqual(c.body, { calling: { status: "ENABLED" } });
});

test("callingStatus: lê calling.status", async () => {
  const f = fetchMock(() => ({ body: { id: "PN1", calling: { status: "ENABLED" } } }));
  const wc = makeWaCalling({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  const s = await wc.callingStatus();
  assert.equal(s.status, "ENABLED");
  assert.ok(f.calls[0].url.includes("fields=calling"));
});

test("requestCallPermission e initiateCall montam o payload certo", async () => {
  const f = fetchMock((e) => e.url.endsWith("/calls") ? { body: { calls: [{ id: "wacid.1" }] } } : { body: {} });
  const wc = makeWaCalling({ fetch: f, token: "tok", phoneNumberId: "PN1" });

  await wc.requestCallPermission("5541999", "Posso te ligar?");
  const perm = f.calls[0];
  assert.ok(perm.url.endsWith("/PN1/messages"));
  assert.equal(perm.body.interactive.type, "call_permission_request");
  assert.equal(perm.body.to, "5541999");

  const { callId } = await wc.initiateCall("5541999", "v=0...");
  assert.equal(callId, "wacid.1");
  const call = f.calls[1];
  assert.ok(call.url.endsWith("/PN1/calls"));
  assert.equal(call.body.action, "connect");
  assert.equal(call.body.session.sdp_type, "offer");
});

test("erro da Meta propaga code (138018)", async () => {
  const f = fetchMock(() => ({ status: 400, body: { error: { message: "pre-reqs", code: 138018 } } }));
  const wc = makeWaCalling({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  await assert.rejects(() => wc.enableCalling(), (e) => e.code === 138018);
});

// Cliente fake pra rota
function fakeWc({ enableFails = 0, wabaId = "WABA1" } = {}) {
  let fails = enableFails;
  const log = [];
  return {
    log,
    configured: () => true,
    async enableCalling() { log.push("enable"); if (fails > 0) { fails--; throw Object.assign(new Error("pre"), { code: 138018 }); } return { success: true }; },
    async resubscribeWaba() { if (!wabaId) throw new Error("no waba"); log.push("resubscribe"); return {}; },
    async callingStatus() { return { status: "ENABLED" }; },
  };
}

async function appWith(wc) {
  const app = Fastify();
  registerWaCallingRoutes(app, {}, { waCalling: wc });
  await app.ready();
  return app;
}

test("POST enable: sucesso direto", async () => {
  const app = await appWith(fakeWc());
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/calling/enable" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "ENABLED");
  await app.close();
});

test("POST enable: 138018 → re-assina a WABA e tenta de novo", async () => {
  const wc = fakeWc({ enableFails: 1 });
  const app = await appWith(wc);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/calling/enable" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(wc.log, ["enable", "resubscribe", "enable"]);
  await app.close();
});

test("GET status devolve o estado", async () => {
  const app = await appWith(fakeWc());
  const res = await app.inject({ method: "GET", url: "/api/whatsapp/calling/status" });
  assert.equal(res.json().status, "ENABLED");
  await app.close();
});
