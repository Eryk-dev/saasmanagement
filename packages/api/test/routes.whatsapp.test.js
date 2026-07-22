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
  const sent = [], read = [], created = [];
  return {
    sent, read, created,
    configured: () => opts.configured !== false,
    verifyWebhook: (mode, tok, ch) => (mode === "subscribe" && tok === "vt" ? String(ch) : null),
    async sendText(to, text) { if (opts.throw) throw Object.assign(new Error("re-engagement"), { code: 131047 }); sent.push({ to, text }); return { messageId: "wamid.SENT" + sent.length }; },
    async sendTemplate() { return { messageId: "wamid.T" }; },
    async markRead(id) { read.push(id); },
    async tokenWabaIds() { return ["WABA1"]; },
    async createTemplate(wabaId, spec) { created.push({ wabaId, spec }); return { id: "tpl_1", status: "PENDING", category: spec.category }; },
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

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Follow-up", kind: "followup" },
];

test("POST /threads/:id/send: 1º contato num lead NOVO registra o toque e promove pra qualificação", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: FUNNEL });
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "5541988887777", name: "Novo", stage: "Novo lead" });
  await repo.create("wa_threads", { id: "5541988887777", phone: "5541988887777", leadId: "ld1", saas: "leverads" });
  const app = await appWith(repo, fakeWa());

  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988887777/send", payload: { text: "oi, vim pelo anúncio" } });

  const lead = await repo.get("leads", "ld1");
  assert.equal(lead.stage, "Qualificando");         // 1º contato promoveu o card
  assert.equal(lead.lastActivityType, "whatsapp");  // toque gravado (deixou de ser "sem atividade")
  const acts = (await repo.list("activities")).filter((a) => a.lead === "ld1");
  assert.equal(acts.filter((a) => a.type === "whatsapp").length, 1); // exatamente 1 toque de 1º contato (+ o "stage" da promoção)
  await app.close();
});

test("POST /threads/:id/send: lead JÁ no funil não vira toque a cada mensagem (não infla tentativa)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: FUNNEL });
  await repo.create("leads", { id: "ld2", saas: "leverads", phone: "5541988886666", name: "Meio", stage: "Follow-up" });
  await repo.create("wa_threads", { id: "5541988886666", phone: "5541988886666", leadId: "ld2", saas: "leverads" });
  const app = await appWith(repo, fakeWa());

  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5541988886666/send", payload: { text: "seguindo o follow" } });

  const lead = await repo.get("leads", "ld2");
  assert.equal(lead.stage, "Follow-up");            // não mexe na etapa
  assert.equal((await repo.list("activities")).filter((a) => a.lead === "ld2").length, 0); // sem toque automático
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

// ── Lead que escreveu de OUTRO número ───────────────────────────────────────
// O form leva a pessoa pro WhatsApp com uma mensagem pronta que tem o NOME
// dela. Se o aparelho tem número diferente do que ela digitou, o casamento por
// telefone falha e a conversa nasce órfã: sem contexto pro SDR e sem fluxo
// automático (prod 20/07 — form 11 94356-3980, mensagem de 11 4321-3413).

const NOW_TS = String(Math.floor(Date.now() / 1000)); // o helper inMsg usa ts fixo de 2024
const PREFILL = (nome) => `Oi, me chamo ${nome} e quero saber mais sobre a LeverAds. Resumo da minha operação: segmento - Outros, contas no ML/Shopee - 1 conta.`;

test("conversa nova casa pelo NOME da mensagem do form quando o número não bate", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Fernando", phone: "11943563980", createdAt: new Date().toISOString() });
  const app = await appWith(repo, fakeWa());

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("551143213413", "wamid.A", PREFILL("Fernando"), NOW_TS) });

  const thread = await repo.get("wa_threads", "551143213413");
  assert.equal(thread.leadId, "le_1", "a conversa tem que achar o lead pelo nome");
  // O telefone do FORM fica intacto; o do WhatsApp entra em campo próprio.
  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.phone, "11943563980");
  assert.equal(lead.waPhone, "551143213413");
});

test("não casa: dois leads com o mesmo nome na janela, nome curto, ou lead antigo", async () => {
  const agora = new Date().toISOString();
  const velho = new Date(Date.now() - 3 * 3600e3).toISOString();

  // Ambíguo: dois "Fernando" recentes → deixa órfã pro vínculo manual.
  const r1 = makeMemRepo();
  await r1.create("leads", { id: "a", saas: "leverads", name: "Fernando", phone: "11900000001", createdAt: agora });
  await r1.create("leads", { id: "b", saas: "leverads", name: "Fernando", phone: "11900000002", createdAt: agora });
  await (await appWith(r1, fakeWa())).inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("551143213413", "wamid.B", PREFILL("Fernando"), NOW_TS) });
  assert.equal((await r1.get("wa_threads", "551143213413")).leadId, null);

  // Lead de 3h atrás não é o do redirect que acabou de acontecer.
  const r2 = makeMemRepo();
  await r2.create("leads", { id: "c", saas: "leverads", name: "Fernando", phone: "11900000003", createdAt: velho });
  await (await appWith(r2, fakeWa())).inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("551143213414", "wamid.C", PREFILL("Fernando"), NOW_TS) });
  assert.equal((await r2.get("wa_threads", "551143213414")).leadId, null);

  // Mensagem curta não casa com ninguém.
  const r3 = makeMemRepo();
  await r3.create("leads", { id: "d", saas: "leverads", name: "Fernando", phone: "11900000004", createdAt: agora });
  await (await appWith(r3, fakeWa())).inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("551143213415", "wamid.D", "oi", NOW_TS) });
  assert.equal((await r3.get("wa_threads", "551143213415")).leadId, null);
});

test("casamento por TELEFONE continua ganhando e não inventa waPhone", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Fernando", phone: "5511943213413", createdAt: new Date().toISOString() });
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("5511943213413", "wamid.E", PREFILL("Fernando"), NOW_TS) });
  assert.equal((await repo.get("wa_threads", "5511943213413")).leadId, "le_1");
  assert.equal((await repo.get("leads", "le_1")).waPhone, undefined);
});

test("POST /threads/:id/link vincula na mão, carimba as mensagens e desvincula", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_9", saas: "leverads", name: "Zulmira", phone: "11988887777" });
  const app = await appWith(repo, fakeWa());
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inMsg("551143213413", "wamid.F", "oi, tudo bem?", NOW_TS) });
  assert.equal((await repo.get("wa_threads", "551143213413")).leadId, null);

  const res = await app.inject({ method: "POST", url: "/api/whatsapp/threads/551143213413/link", payload: { leadId: "le_9" } });
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.get("wa_threads", "551143213413")).leadId, "le_9");
  // Mensagem já gravada também passa a apontar pro lead.
  assert.equal((await repo.list("wa_messages")).find((m) => m.id === "wamid.F").leadId, "le_9");
  assert.equal((await repo.get("leads", "le_9")).waPhone, "551143213413");

  const nao = await app.inject({ method: "POST", url: "/api/whatsapp/threads/551143213413/link", payload: { leadId: "naoexiste" } });
  assert.equal(nao.statusCode, 404);

  await app.inject({ method: "POST", url: "/api/whatsapp/threads/551143213413/link", payload: { leadId: "" } });
  assert.equal((await repo.get("wa_threads", "551143213413")).leadId, null);
});

test("client: createTemplate submete pra Meta com BODY + exemplo por variável", async () => {
  const f = okFetch({ id: "tpl_9", status: "PENDING", category: "UTILITY" });
  const wa = makeWhatsapp({ fetch: f, token: "tok", phoneNumberId: "PN1" });
  const r = await wa.createTemplate("WABA1", { name: "call_no_show", category: "UTILITY", language: "pt_BR", body: "Oi {{1}}, sumiu da call?", example: ["João"] });
  assert.equal(r.id, "tpl_9");
  assert.equal(r.status, "PENDING");
  const c = f.calls[0];
  assert.ok(c.url.endsWith("/WABA1/message_templates"));
  assert.equal(c.init.headers.authorization, "Bearer tok");
  assert.equal(c.payload.name, "call_no_show");
  assert.equal(c.payload.category, "UTILITY");
  assert.equal(c.payload.components[0].type, "BODY");
  assert.deepEqual(c.payload.components[0].example, { body_text: [["João"]] });
});

test("POST /whatsapp/templates: cria o template (nome saneado, wabaId resolvido) e fura o cache", async () => {
  const wa = fakeWa();
  const app = await appWith(makeMemRepo(), wa);
  const res = await app.inject({ method: "POST", url: "/api/whatsapp/templates", payload: {
    name: "Call No-Show!", category: "UTILITY", body: "Oi {{1}}, sumiu da call?", example: ["João"],
  } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "PENDING");
  assert.equal(wa.created.length, 1);
  assert.equal(wa.created[0].wabaId, "WABA1");
  assert.equal(wa.created[0].spec.name, "call_no_show"); // saneado: minúsculo, sem espaço/!
});

test("POST /whatsapp/templates: variável sem exemplo → 400; sem nome/corpo → 400", async () => {
  const app = await appWith(makeMemRepo(), fakeWa());
  const semEx = await app.inject({ method: "POST", url: "/api/whatsapp/templates", payload: { name: "x_tpl", body: "Oi {{1}}" } });
  assert.equal(semEx.statusCode, 400);
  const semNome = await app.inject({ method: "POST", url: "/api/whatsapp/templates", payload: { body: "Oi" } });
  assert.equal(semNome.statusCode, 400);
  const semCorpo = await app.inject({ method: "POST", url: "/api/whatsapp/templates", payload: { name: "x_tpl" } });
  assert.equal(semCorpo.statusCode, 400);
});
