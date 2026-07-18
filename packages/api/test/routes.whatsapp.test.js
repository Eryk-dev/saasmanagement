// WhatsApp Cloud API — client (sendText/verifyWebhook/digits + erro de 24h) e
// rotas do inbox (webhook, recebimento → thread+message casados por telefone,
// dedup, status, número sem lead vira thread órfã, listar/abrir/marcar lida,
// enviar pela conversa e pelo lead). Tudo offline com fetch/cliente mockado.

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
function fakeWa(opts = {}) {
  const sent = [], read = [];
  return {
    sent, read,
    configured: () => opts.configured !== false,
    verifyWebhook: (mode, tok, ch) => (mode === "subscribe" && tok === "vt" ? String(ch) : null),
    async sendText(to, text) { if (opts.throw) throw Object.assign(new Error("re-engagement"), { code: 131047 }); sent.push({ to, text }); return { messageId: "wamid.SENT" + sent.length }; },
    async sendTemplate() { return { messageId: "wamid.T" }; },
    async markRead(id) { read.push(id); },
  };
}

async function appWith(repo, wa) {
  const app = Fastify();
  registerWhatsappRoutes(app, repo, { whatsapp: wa });
  await app.ready();
  return app;
}

const inMsg = (from, id, body, ts = "1720000000") => ({
  entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Cliente" } }], messages: [{ from, id, timestamp: ts, type: "text", text: { body } }] } }] }],
});

test("webhook GET: verifica com o token e devolve o challenge; erra → 403", async () => {
  const app = await appWith(makeMemRepo(), fakeWa());
  const ok = await app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, "42");
  const no = await app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42" });
  assert.equal(no.statusCode, 403);
  await app.close();
});

test("webhook POST: recebida vira thread+message, casa o lead por telefone, dedup e não-lido", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545", name: "Fulano", stage: "novo" });
  const app = await appWith(repo, fakeWa());

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("5541992516545", "wamid.IN1", "quero saber mais") });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("5541992516545", "wamid.IN1", "quero saber mais") }); // reentrega

  const msgs = await repo.list("wa_messages");
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].direction, "in");
  assert.equal(msgs[0].leadId, "ld1");
  const thr = await repo.get("wa_threads", "5541992516545");
  assert.equal(thr.unread, 1);
  assert.equal(thr.leadId, "ld1");
  assert.equal(thr.lastText, "quero saber mais");

  // listThreads enriquece com nome do lead
  const list = (await (await app.inject({ method: "GET", url: "/api/whatsapp/threads" })).json()).threads;
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Fulano");
  assert.equal(list[0].unread, 1);
  await app.close();
});

test("webhook POST: número sem lead vira thread órfã; status atualiza a mensagem enviada", async () => {
  const repo = makeMemRepo();
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("5599999999999", "wamid.INX", "sou novo") });
  const thr = await repo.get("wa_threads", "5599999999999");
  assert.equal(thr.leadId, null);
  assert.equal(thr.unread, 1);

  // manda uma saída e depois um status read pra ela
  await repo.create("wa_messages", { id: "wamid.OUT9", thread: "5599999999999", direction: "out", text: "ping", status: "sent" });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.OUT9", status: "read" }] } }] }] } });
  assert.equal((await repo.get("wa_messages", "wamid.OUT9")).status, "read");
  await app.close();
});

test("GET thread + marcar lida zera o não-lido e dá o visto na Cloud API", async () => {
  const repo = makeMemRepo();
  const wa = fakeWa();
  const app = await appWith(repo, wa);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("5541988887777", "wamid.INa", "oi") });

  const opened = await (await app.inject({ method: "GET", url: "/api/whatsapp/threads/5541988887777" })).json();
  assert.equal(opened.messages.length, 1);
  assert.equal(opened.messages[0].text, "oi");

  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988887777/read" });
  assert.equal((await repo.get("wa_threads", "5541988887777")).unread, 0);
  assert.deepEqual(wa.read, ["wamid.INa"]);
  await app.close();
});

test("POST /threads/:id/send: envia pela conversa e grava a saída", async () => {
  const repo = makeMemRepo();
  const wa = fakeWa();
  const app = await appWith(repo, wa);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988887777/send", payload: { text: "bom dia!" } });
  assert.equal(res.statusCode, 200);
  assert.equal(wa.sent[0].to, "5541988887777");
  const msgs = await repo.list("wa_messages");
  assert.equal(msgs[0].direction, "out");
  assert.equal(msgs[0].text, "bom dia!");
  const thr = await repo.get("wa_threads", "5541988887777");
  assert.equal(thr.lastDir, "out");
  await app.close();
});

test("POST /leads/:id/whatsapp: envia, grava out com leadId; sem telefone → 400; inexistente → 404", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545" });
  await repo.create("leads", { id: "no-phone", saas: "leverads" });
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  const res = await app.inject({ method: "POST", url: "/api/leads/ld1/whatsapp", payload: { text: "oi lead" } });
  assert.equal(res.statusCode, 200);
  const msgs = (await repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.equal(msgs[0].leadId, "ld1");
  assert.ok(res.json().messageId);

  assert.equal((await app.inject({ method: "POST", url: "/api/leads/no-phone/whatsapp", payload: { text: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nope/whatsapp", payload: { text: "x" } })).statusCode, 404);
  await app.close();
});

test("envio fora da janela de 24h → 409 (precisa de template)", async () => {
  const repo = makeMemRepo();
  const app = await appWith(repo, fakeWa({ throw: true }));
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988887777/send", payload: { text: "oi" } });
  assert.equal(res.statusCode, 409);
  await app.close();
});

// A hospedagem troca o CORPO de respostas 5xx pela página de erro dela, então
// erro da Meta que precisa chegar em quem opera não pode sair como 5xx.
test("envio recusado pela Meta (fora das 24h) → 4xx, nunca 5xx", async () => {
  const repo = makeMemRepo();
  const wa = { ...fakeWa(), async sendText() { throw Object.assign(new Error("número inválido"), { code: 131026 }); } };
  const app = await appWith(repo, wa);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988887777/send", payload: { text: "oi" } });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `esperava 4xx, veio ${res.statusCode}`);
  assert.match(res.json().error, /número inválido/);
  await app.close();
});

test("GET /number: confirma o número conectado; falha vira 200 com motivo (nunca 5xx)", async () => {
  const repo = makeMemRepo();

  const ok = await appWith(repo, { ...fakeWa(), async numberInfo() { return { phoneNumberId: "PN1", display: "+55 41 93618-3835", name: "LeverAds", quality: "GREEN" }; } });
  const rOk = await ok.inject({ method: "GET", url: "/api/whatsapp/number" });
  assert.equal(rOk.statusCode, 200);
  // `webhook` = última entrega da Meta aqui (vazio quando nada chegou ainda).
  assert.deepEqual(rOk.json(), { ok: true, webhook: {}, phoneNumberId: "PN1", display: "+55 41 93618-3835", name: "LeverAds", quality: "GREEN" });
  await ok.close();

  // Token só com permissão de ENVIO: leitura falha, mas não é credencial errada.
  const perm = await appWith(repo, { ...fakeWa(), async numberInfo() { throw Object.assign(new Error("(#200) Requires whatsapp_business_management permission"), { code: 200, status: 403 }); } });
  const rPerm = await perm.inject({ method: "GET", url: "/api/whatsapp/number" });
  assert.equal(rPerm.statusCode, 200);
  assert.equal(rPerm.json().ok, false);
  assert.equal(rPerm.json().reason, "no_read_permission");
  await perm.close();

  // Credencial de fato errada continua distinguível.
  const bad = await appWith(repo, { ...fakeWa(), async numberInfo() { throw Object.assign(new Error("Object with ID 'PN9' does not exist"), { code: 100, status: 400 }); } });
  const rBad = await bad.inject({ method: "GET", url: "/api/whatsapp/number" });
  assert.equal(rBad.statusCode, 200);
  assert.equal(rBad.json().reason, "meta_error");
  await bad.close();

  const off = await appWith(repo, fakeWa({ configured: false }));
  const rOff = await off.inject({ method: "GET", url: "/api/whatsapp/number" });
  assert.equal(rOff.statusCode, 200);
  assert.equal(rOff.json().reason, "not_configured");
  await off.close();
});

test("GET /number: id da CONTA no lugar do número vira instrução com o id certo", async () => {
  const repo = makeMemRepo();
  const wrong = Object.assign(new Error("O WHATSAPP_PHONE_NUMBER_ID (WABA1) é o id da CONTA do WhatsApp, não do número. Troque por PN7 (+55 41 99251-6545) e reinicie a API."),
    { code: 100, wrongId: true, numbers: [{ id: "PN7", display: "+55 41 99251-6545", name: "LeverAds" }] });
  const app = await appWith(repo, { ...fakeWa(), async numberInfo() { throw wrong; } });
  const r = await app.inject({ method: "GET", url: "/api/whatsapp/number" });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.reason, "wrong_id");                 // não se confunde com meta_error
  assert.deepEqual(body.numbers, [{ id: "PN7", display: "+55 41 99251-6545", name: "LeverAds" }]);
  assert.match(body.error, /PN7/);
  await app.close();
});

test("webhook: status failed com código de não-entregável marca o número inválido", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "5541992516545" });
  await repo.create("wa_messages", { id: "wamid.OUT1", thread: "5541992516545", leadId: "ld1", direction: "out", status: "sent" });
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.OUT1", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] } });
  const lead = await repo.get("leads", "ld1");
  assert.equal(lead.whatsappInvalid, true);
  assert.match(lead.whatsappInvalidReason, /undeliverable/i);
  await app.close();
});

test("webhook: status failed por RE-ENGAJAMENTO (131047) NÃO marca inválido (número é válido)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "5541992516545" });
  await repo.create("wa_messages", { id: "wamid.OUT2", thread: "5541992516545", leadId: "ld1", direction: "out", status: "sent" });
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.OUT2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }] } }] }] } });
  assert.ok(!(await repo.get("leads", "ld1")).whatsappInvalid);
  await app.close();
});

test("webhook: user_preferences marketing stop/resume descadastra e reinscreve o lead", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "5541992516545" });
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "user_preferences", value: { user_preferences: [{ wa_id: "5541992516545", category: "marketing", value: "stop" }] } }] }] } });
  assert.equal((await repo.get("leads", "ld1")).whatsappOptOut, true);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "user_preferences", value: { user_preferences: [{ wa_id: "5541992516545", category: "marketing", value: "resume" }] } }] }] } });
  assert.equal((await repo.get("leads", "ld1")).whatsappOptOut, false);
  await app.close();
});

test("webhook: número FLAGGED + template RED viram saúde 'danger'", async () => {
  const repo = makeMemRepo();
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "phone_number_quality_update", value: { display_phone_number: "+55 41 99251-6545", event: "FLAGGED", current_limit: "TIER_1K" } }] }] } });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "message_template_quality_update", value: { message_template_name: "nutricao1", new_quality_score: "RED" } }] }] } });
  const { getWaHealth, waHealthSummary } = await import("../src/wa-health.js");
  const s = waHealthSummary(await getWaHealth(repo));
  assert.equal(s.level, "danger");
  assert.equal(s.number.event, "FLAGGED");
  assert.ok(s.messages.some((m) => /SINALIZADO/.test(m)));
  assert.ok(s.messages.some((m) => /VERMELHA/.test(m)));
  await app.close();
});

test("webhook: entrega da Meta fica registrada com o id do número que recebeu", async () => {
  const { getWaHealth } = await import("../src/wa-health.js");
  const repo = makeMemRepo();
  const app = await appWith(repo, fakeWa());
  const deliver = (phoneNumberId, msgId) => app.inject({
    method: "POST", url: "/api/webhooks/whatsapp",
    payload: { entry: [{ changes: [{ field: "messages", value: {
      metadata: { display_phone_number: "+55 41 93618-3835", phone_number_id: phoneNumberId },
      messages: [{ id: msgId, from: "5541999990000", type: "text", text: { body: "oi" } }],
    } }] }] },
  });

  await deliver("PN_CERTO", "wamid.A");
  const h1 = (await getWaHealth(repo)).webhook;
  assert.equal(h1.phoneNumberId, "PN_CERTO");   // é o id que deveria estar no env
  assert.equal(h1.display, "+55 41 93618-3835");
  assert.ok(h1.at);

  // Mesma entrega em rajada não vira enxurrada de escrita (throttle de 1 min)…
  await deliver("PN_CERTO", "wamid.B");
  assert.equal((await getWaHealth(repo)).webhook.at, h1.at);
  // …mas número diferente atualiza na hora (mudou de número no meio do caminho).
  await deliver("PN_OUTRO", "wamid.C");
  assert.equal((await getWaHealth(repo)).webhook.phoneNumberId, "PN_OUTRO");

  // A tela lê isso pra separar "webhook não configurado" de "erro nosso".
  const num = await appWith(repo, { ...fakeWa(), async numberInfo() { return { phoneNumberId: "PN_CERTO", display: "+55 41 93618-3835", name: "LeverAds", quality: "GREEN" }; } });
  const body = (await num.inject({ method: "GET", url: "/api/whatsapp/number" })).json();
  assert.equal(body.webhook.phoneNumberId, "PN_OUTRO");
  await num.close();
  await app.close();
});

test("GET /number: sem nenhuma entrega da Meta, webhook vem vazio", async () => {
  const repo = makeMemRepo();
  const app = await appWith(repo, { ...fakeWa(), async numberInfo() { return { phoneNumberId: "PN1", display: "", name: "", quality: "" }; } });
  const body = (await app.inject({ method: "GET", url: "/api/whatsapp/number" })).json();
  assert.deepEqual(body.webhook, {});
  await app.close();
});

test("GET /insights: números do inbox + saúde do número num payload só", async () => {
  const repo = makeMemRepo();
  const now = new Date().toISOString();
  const hAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
  await repo.create("wa_threads", { id: "5541900000001", phone: "5541900000001", unread: 1, lastAt: hAgo(2), createdAt: hAgo(10) });
  await repo.create("wa_messages", { id: "m1", thread: "5541900000001", direction: "in", at: hAgo(2) });
  await repo.create("app_config", { id: "wa_health", number: { event: "FLAGGED", limit: "TIER_1K" }, templates: {}, account: {}, webhook: { at: now }, updatedAt: now });

  const app = await appWith(repo, fakeWa());
  const body = (await app.inject({ method: "GET", url: "/api/whatsapp/insights?days=7" })).json();
  assert.equal(body.days, 7);
  assert.equal(body.awaiting, 1);          // cliente falou por último
  assert.equal(body.openWindow, 1);        // dentro das 24h: dá pra responder texto livre
  assert.equal(body.unread, 1);
  assert.equal(body.health.level, "danger"); // número FLAGGED entra no mesmo payload
  assert.equal(body.health.number.limit, "TIER_1K");

  // days fora da faixa não explode nem varre a base inteira
  assert.equal((await app.inject({ method: "GET", url: "/api/whatsapp/insights?days=abc" })).json().days, 30);
  assert.equal((await app.inject({ method: "GET", url: "/api/whatsapp/insights?days=9999" })).json().days, 365);
  await app.close();
});
