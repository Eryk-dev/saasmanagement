// WhatsApp multi-número POR PRODUTO: cada SaaS conversa pelo seu waPhoneId.
// Cobre: envio usa o número do produto do lead; produto SEM número bloqueia
// (nunca sai pelo número de outro produto); webhook etiqueta a conversa com o
// produto dono do número de entrada e a resposta segue pelo mesmo número;
// migração carimba o env no leverads. Tudo offline.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");
const { ensureWaPhoneId } = await import("../src/migrations.js");

// Cliente fake com a interface nova (phoneId por chamada).
function fakeWa() {
  const sent = [];
  return {
    sent,
    configured: (phoneId) => !!phoneId || true,
    verifyWebhook: () => null,
    async sendText(to, text, { phoneId } = {}) { sent.push({ to, text, phoneId: phoneId || "" }); return { messageId: "wamid.S" + sent.length }; },
    async sendTemplate() { return { messageId: "wamid.T" }; },
    async markRead() {},
    async numberInfo({ phoneId } = {}) { return { phoneNumberId: phoneId || "ENV", display: "+55 41 0000", name: "n" }; },
  };
}

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", waPhoneId: "PN_LEVER" });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids" }); // SEM número ainda
  await repo.create("leads", { id: "lk", saas: "uniquekids", name: "Mãe Ana", phone: "11930434601" });
  await repo.create("leads", { id: "ll", saas: "leverads", name: "Hiago", phone: "11947976232" });
  const wa = fakeWa();
  const app = Fastify();
  registerWhatsappRoutes(app, repo, { whatsapp: wa });
  return { repo, app, wa };
}

test("envio pelo lead usa o número DO PRODUTO; produto sem número bloqueia com aviso", async () => {
  const { app, wa } = await setup();

  // LeverAds: sai pelo PN_LEVER.
  const ok = await app.inject({ method: "POST", url: "/api/leads/ll/whatsapp", payload: { text: "oi" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(wa.sent[0].phoneId, "PN_LEVER");

  // UniqueKids SEM waPhoneId: 503 com instrução, e NADA sai pelo número da LeverAds.
  const blocked = await app.inject({ method: "POST", url: "/api/leads/lk/whatsapp", payload: { text: "oi" } });
  assert.equal(blocked.statusCode, 503);
  assert.match(blocked.json().error, /Ajustes → Integrações/);
  assert.equal(wa.sent.length, 1);
  await app.close();
});

test("webhook etiqueta a conversa com o dono do número de entrada; resposta segue pelo MESMO número", async () => {
  const { repo, app, wa } = await setup();
  await repo.update("products", "uniquekids", { waPhoneId: "PN_KIDS" });

  // Mensagem de um número DESCONHECIDO chega pelo número da UniqueKids.
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: { entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN_KIDS", display_phone_number: "5541900000000" },
    contacts: [{ profile: { name: "Camila" } }],
    messages: [{ id: "wamid.IN1", from: "5511988887777", timestamp: "1789000000", type: "text", text: { body: "vi o quadro de rotina" } }],
  } }] }] } });

  const t = await repo.get("wa_threads", "5511988887777");
  assert.equal(t.saas, "uniquekids", "conversa nova nasce etiquetada com o dono do número");
  assert.equal(t.waPhoneId, "PN_KIDS");

  // A resposta pela thread sai pelo número em que a conversa chegou.
  const r = await app.inject({ method: "POST", url: "/api/whatsapp/threads/5511988887777/send", payload: { text: "oi Camila!" } });
  assert.equal(r.statusCode, 200);
  assert.equal(wa.sent.at(-1).phoneId, "PN_KIDS");
  await app.close();
});

test("GET /number responde o número do produto ativo (?saas=) e avisa quando falta", async () => {
  const { app } = await setup();
  const lever = (await app.inject({ url: "/api/whatsapp/number?saas=leverads" })).json();
  assert.equal(lever.ok, true);
  assert.equal(lever.phoneNumberId, "PN_LEVER");

  const kids = (await app.inject({ url: "/api/whatsapp/number?saas=uniquekids" })).json();
  assert.equal(kids.ok, false);
  assert.equal(kids.reason, "no_number_for_saas");
  await app.close();
});

test("migração ensureWaPhoneId: env vira o waPhoneId do leverads uma vez (e nunca sobrescreve)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const prev = process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_PHONE_NUMBER_ID = "PN_ENV";
  try {
    assert.equal(await ensureWaPhoneId(repo), true);
    assert.equal((await repo.get("products", "leverads")).waPhoneId, "PN_ENV");
    // Segunda passada (marcador) e campo editado na mão nunca são sobrescritos.
    await repo.update("products", "leverads", { waPhoneId: "PN_EDITADO" });
    assert.equal(await ensureWaPhoneId(repo), false);
    assert.equal((await repo.get("products", "leverads")).waPhoneId, "PN_EDITADO");
  } finally {
    if (prev === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = prev;
  }
});
