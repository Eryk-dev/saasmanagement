// Fluxo de permissão de ligação — 1º contato do lead pede pra ligar (interactive
// nativo com a saudação), resposta do lead vira alerta quente (wa_alerts),
// responder resolve o alerta, e o pedido manual funciona pela rota. Tudo offline.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeWhatsapp } = await import("../src/whatsapp.js");
const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");
const { greetingFor, parsePermissionReply, DEFAULT_CALL_GREETING } = await import("../src/wa-call-flow.js");

// Cliente fake: registra envios de texto e de pedido de permissão.
function fakeWa(opts = {}) {
  const sent = [], perms = [];
  return {
    sent, perms,
    configured: () => opts.configured !== false,
    verifyWebhook: () => null,
    async sendText(to, text, { phoneId } = {}) {
      if (opts.throwText) throw Object.assign(new Error("re-engagement"), { code: 131047 });
      sent.push({ to, text, phoneId });
      return { messageId: "wamid.TXT" + sent.length };
    },
    async sendCallPermission(to, text, { phoneId } = {}) {
      if (opts.throwPerm) throw Object.assign(new Error("calling disabled"), { code: 138018 });
      perms.push({ to, text, phoneId });
      return { messageId: "wamid.PERM" + perms.length };
    },
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

// Produto com o fluxo ligado; lead novo casado pelo telefone.
async function seedFlow(repo, { enabled = true, greeting = "" } = {}) {
  await repo.create("products", { id: "leverads", name: "LeverAds", waCallFlow: { enabled, ...(greeting ? { greeting } : {}) } });
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545", name: "Maria Souza", stage: "Novo" });
}

const inText = (from, id, body) => ({
  entry: [{ changes: [{ field: "messages", value: { contacts: [{ profile: { name: "Maria" } }], messages: [{ from, id, timestamp: "1720000000", type: "text", text: { body } }] } }] }],
});
const inPermReply = (from, id, response) => ({
  entry: [{ changes: [{ field: "messages", value: { messages: [{ from, id, timestamp: "1720000100", type: "interactive", interactive: { type: "call_permission_reply", call_permission_reply: { response } } }] } }] }],
});

test("greetingFor: interpola {nome} e some com elegância sem nome; texto do produto vence o padrão", () => {
  assert.equal(greetingFor(null, { name: "Maria Souza" }), DEFAULT_CALL_GREETING.replace("{nome}", "Maria"));
  assert.ok(!greetingFor(null, null).includes("{nome}"));
  assert.ok(!/Olá !/.test(greetingFor(null, null)));
  const p = { waCallFlow: { greeting: "Oi {nome}, sou o Leonardo. Posso te ligar?" } };
  assert.equal(greetingFor(p, { name: "João" }), "Oi João, sou o Leonardo. Posso te ligar?");
});

test("parsePermissionReply: accept/reject nos shapes conhecidos; texto comum → null", () => {
  assert.equal(parsePermissionReply({ type: "interactive", interactive: { type: "call_permission_reply", call_permission_reply: { response: "accept" } } }), "accepted");
  assert.equal(parsePermissionReply({ type: "interactive", interactive: { type: "call_permission_reply", call_permission_reply: { response: "reject" } } }), "declined");
  assert.equal(parsePermissionReply({ type: "interactive", interactive: { type: "call_permission_reply", response: "accept" } }), "accepted");
  assert.equal(parsePermissionReply({ type: "text", text: { body: "pode" } }), null);
  assert.equal(parsePermissionReply({ type: "interactive", interactive: { type: "button_reply", button_reply: { title: "ok" } } }), null);
});

test("client real: sendCallPermission posta o interactive de permissão", async () => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url: String(url), payload: JSON.parse(init.body) }); return { status: 200, text: async () => JSON.stringify({ messages: [{ id: "wamid.P1" }] }) }; };
  const wa = makeWhatsapp({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  const { messageId } = await wa.sendCallPermission("41992516545", "Posso te ligar?");
  assert.equal(messageId, "wamid.P1");
  assert.equal(calls[0].payload.type, "interactive");
  assert.equal(calls[0].payload.interactive.type, "call_permission_request");
  assert.equal(calls[0].payload.interactive.action.name, "call_permission_request");
  assert.equal(calls[0].payload.interactive.body.text, "Posso te ligar?");
  assert.equal(calls[0].payload.to, "5541992516545");
});

test("1º contato de lead conhecido com fluxo ligado → pedido de permissão com a saudação, callFlow pending, sem alerta", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo, { greeting: "Olá {nome}! Sou o Leonardo. Posso te ligar?" });
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "Oi, me chamo Maria e quero saber mais") });

  assert.equal(wa.perms.length, 1);
  assert.equal(wa.perms[0].text, "Olá Maria! Sou o Leonardo. Posso te ligar?");
  const thr = await repo.get("wa_threads", "5541992516545");
  assert.equal(thr.callFlow.permission, "pending");
  assert.equal(thr.callFlow.auto, true);
  // A saudação ficou registrada como mensagem OUT da conversa.
  const out = (await repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Posso te ligar/);
  // O disparo do fluxo NÃO é alerta (alerta é resposta do lead).
  assert.equal((await repo.list("wa_alerts")).length, 0);
  // Re-entrega do mesmo webhook não pede de novo.
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "Oi, me chamo Maria e quero saber mais") });
  assert.equal(wa.perms.length, 1);
  await app.close();
});

test("fluxo NÃO dispara: produto desligado, lead desconhecido, lead ganho, conversa já existente", async () => {
  // desligado
  let repo = makeMemRepo();
  await seedFlow(repo, { enabled: false });
  let wa = fakeWa();
  let app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.A", "oi") });
  assert.equal(wa.perms.length, 0);
  await app.close();

  // número sem lead
  repo = makeMemRepo();
  await repo.create("products", { id: "leverads", waCallFlow: { enabled: true } });
  wa = fakeWa();
  app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5599999990000", "wamid.B", "oi") });
  assert.equal(wa.perms.length, 0);
  await app.close();

  // lead ganho (kind legado "Ganho")
  repo = makeMemRepo();
  await repo.create("products", { id: "leverads", waCallFlow: { enabled: true } });
  await repo.create("leads", { id: "ld9", saas: "leverads", phone: "41988887777", name: "Cliente", stage: "Ganho" });
  wa = fakeWa();
  app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541988887777", "wamid.C", "oi") });
  assert.equal(wa.perms.length, 0);
  await app.close();

  // conversa que já tinha mensagem recebida antes do fluxo ligar
  repo = makeMemRepo();
  await seedFlow(repo);
  await repo.create("wa_messages", { id: "wamid.OLD", thread: "5541992516545", direction: "in", text: "oi de antes", at: "2026-07-01T00:00:00Z" });
  await repo.create("wa_threads", { id: "5541992516545", phone: "5541992516545", leadId: "ld1", saas: "leverads", lastDir: "in" });
  wa = fakeWa();
  app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.D", "oi de novo") });
  assert.equal(wa.perms.length, 0);
  await app.close();
});

test("interactive indisponível → cai pra texto simples com a mesma saudação (not_requested)", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const wa = fakeWa({ throwPerm: true });
  const app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "oi") });
  assert.equal(wa.perms.length, 0);
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /Posso te ligar|formulário/);
  assert.equal((await repo.get("wa_threads", "5541992516545")).callFlow.permission, "not_requested");
  await app.close();
});

test("resposta do lead com fluxo aberto → alerta quente; permissão aceita fica na thread e no alerta", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "oi, quero saber mais") });
  // Lead aceita a ligação (resposta nativa do pedido).
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inPermReply("5541992516545", "wamid.IN2", "accept") });

  const thr = await repo.get("wa_threads", "5541992516545");
  assert.equal(thr.callFlow.permission, "accepted");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, "open");
  assert.equal(alerts[0].permission, "accepted");
  assert.equal(alerts[0].leadId, "ld1");

  // Mais uma mensagem do lead ATUALIZA o alerta aberto (não empilha pop-up).
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN3", "pode ligar agora") });
  const again = await repo.list("wa_alerts");
  assert.equal(again.length, 1);
  assert.equal(again[0].text, "pode ligar agora");

  // GET /alerts entrega enriquecido com o lead.
  const body = (await (await app.inject({ method: "GET", url: "/api/whatsapp/alerts" })).json());
  assert.equal(body.alerts.length, 1);
  assert.equal(body.alerts[0].name, "Maria Souza");
  assert.equal(body.alerts[0].stage, "Novo");
  await app.close();
});

test("responder a conversa (send) resolve o alerta; e o botão resolvido também", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const wa = fakeWa();
  const app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "oi") });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN2", "posso falar agora") });
  assert.equal((await repo.list("wa_alerts")).filter((a) => a.status === "open").length, 1);

  // Resposta do SDR pela conversa fecha o alerta.
  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541992516545/send", payload: { text: "Te ligo em 2 min!" } });
  assert.equal((await repo.list("wa_alerts")).filter((a) => a.status === "open").length, 0);

  // Novo alerta e fechamento explícito pelo botão.
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN3", "combinado") });
  const open = (await repo.list("wa_alerts")).find((a) => a.status === "open");
  assert.ok(open);
  const done = await app.inject({ method: "POST", url: `/api/whatsapp/alerts/${open.id}/done` });
  assert.equal(done.statusCode, 200);
  assert.equal((await repo.get("wa_alerts", open.id)).status, "done");
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/alerts/nope/done" })).statusCode, 404);
  await app.close();
});

test("pedido manual: POST /threads/:id/call-permission manda o interactive e registra o fluxo (mesmo sem conversa prévia)", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/41992516545/call-permission", payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().interactive, true);
  assert.equal(wa.perms.length, 1);
  assert.match(wa.perms[0].text, /Maria/); // saudação interpolada com o lead casado pelo telefone
  const thr = await repo.get("wa_threads", "5541992516545");
  assert.equal(thr.callFlow.permission, "pending");
  assert.equal(thr.callFlow.auto, false); // manual, não é o automático
  await app.close();
});

test("pedido manual fora da janela de 24h → 409 legível (interactive e texto recusados)", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const app = await appWith(repo, fakeWa({ throwPerm: true, throwText: true }));
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/41992516545/call-permission", payload: {} });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /24h|template/);
  await app.close();
});

test("resposta de permissão vira texto legível na conversa", async () => {
  const repo = makeMemRepo();
  await seedFlow(repo);
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("5541992516545", "wamid.IN1", "oi") });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inPermReply("5541992516545", "wamid.IN2", "accept") });
  const msgs = await repo.list("wa_messages");
  const reply = msgs.find((m) => m.id === "wamid.IN2");
  assert.match(reply.text, /topou receber a ligação/);
  await app.close();
});
