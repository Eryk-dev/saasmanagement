// Fluxos de conversa do Inbox (wa-flows.js): gatilho, cadeia de mensagens até
// a pergunta, roteamento da resposta por ramificação, fallback, captura da
// conversa (regras simples não rodam por cima), cooldown de reinício e o corte
// de ciclo. Tudo offline pela superfície do webhook da Meta.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");
const { runWaFlows } = await import("../src/wa-flows.js");
const { findThreadByPhone } = await import("../src/wa-store.js");

function fakeWa() {
  const sent = [];
  return {
    sent,
    configured: () => true,
    verifyWebhook: () => null,
    async sendText(to, text, { phoneId } = {}) { sent.push({ to, text, phoneId }); return { messageId: "wamid.TXT" + sent.length }; },
    async sendCallPermission() { return { messageId: "wamid.PERM" }; },
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

const inText = (from, id, body) => ({
  entry: [{ changes: [{ field: "messages", value: { contacts: [{ profile: { name: "Maria Souza" } }], messages: [{ from, id, timestamp: "1720000000", type: "text", text: { body } }] } }] }],
});

// Fluxo de qualificação: saudação → pergunta (sim/não) → fecho por ramo.
const QUALIFY_FLOW = {
  id: "fl1", saas: "leverads", name: "qualificação", active: true,
  trigger: { type: "keyword", keyword: "anunciar" },
  nodes: [
    { id: "n1", kind: "message", text: "Oi {{nome}}! Vi seu interesse.", next: "n2" },
    { id: "n2", kind: "question", text: "Você já vende em marketplace? (sim/não)", branches: [{ contains: "sim", to: "n3" }, { contains: "não", to: "n4" }], fallbackTo: null },
    { id: "n3", kind: "message", text: "Perfeito, nosso time já vai te chamar!", next: null },
    { id: "n4", kind: "message", text: "Sem problema, te explico do zero.", next: null },
  ],
};

async function seed(repo, flows = []) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  for (const f of flows) await repo.create("wa_flows", f);
}

test("fluxo: gatilho por palavra dispara a cadeia até a pergunta; resposta roteia pelo ramo e encerra", async () => {
  const repo = makeMemRepo();
  await seed(repo, [QUALIFY_FLOW]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  // gatilho: manda saudação + pergunta na mesma rajada e fica esperando
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41911112222", "f1", "quero anunciar em várias contas") });
  assert.equal(wa.sent.length, 2);
  assert.equal(wa.sent[0].text, "Oi Maria! Vi seu interesse.");
  assert.match(wa.sent[1].text, /marketplace/);
  let thread = await findThreadByPhone(repo, "41911112222");
  assert.deepEqual({ flow: thread.waFlow.flow, node: thread.waFlow.node }, { flow: "fl1", node: "n2" });

  // resposta "Sim" → ramo do n3, fluxo encerra e o estado limpa
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41911112222", "f2", "Sim, já vendo!") });
  assert.equal(wa.sent.length, 3);
  assert.equal(wa.sent[2].text, "Perfeito, nosso time já vai te chamar!");
  thread = await findThreadByPhone(repo, "41911112222");
  assert.ok(!thread.waFlow);

  await app.close();
});

test("fluxo: resposta sem match cai no fallback; sem fallback encerra em silêncio (SDR assume)", async () => {
  const repo = makeMemRepo();
  await seed(repo, [QUALIFY_FLOW]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41933334444", "g1", "anunciar") });
  assert.equal(wa.sent.length, 2);

  // resposta fora dos ramos e sem fallback → nada enviado, estado limpo
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41933334444", "g2", "me liga amanhã") });
  assert.equal(wa.sent.length, 2);
  const thread = await findThreadByPhone(repo, "41933334444");
  assert.ok(!thread.waFlow);
  await app.close();
});

test("fluxo captura a conversa: regra simples de palavra-chave NÃO atropela a pergunta pendente", async () => {
  const repo = makeMemRepo();
  await seed(repo, [QUALIFY_FLOW]);
  await repo.create("wa_automations", { id: "au9", saas: "leverads", name: "preço", trigger: "keyword", keyword: "sim", reply: "NÃO ERA PRA SAIR", active: true, cooldownHours: 24 });
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41955556666", "h1", "anunciar") });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41955556666", "h2", "sim") });
  assert.ok(!wa.sent.some((s) => s.text === "NÃO ERA PRA SAIR"));
  assert.equal(wa.sent.at(-1).text, "Perfeito, nosso time já vai te chamar!");
  await app.close();
});

test("fluxo desativado não dispara; o mesmo fluxo não recomeça na mesma conversa antes de 24h", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ ...QUALIFY_FLOW, id: "fl2", active: false }]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41977778888", "i1", "anunciar") });
  assert.equal(wa.sent.length, 0);

  // liga o fluxo: dispara; terminar e falar a palavra de novo NÃO recomeça (24h)
  await repo.update("wa_flows", "fl2", { active: true });
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41977778888", "i2", "anunciar") });
  const afterFirst = wa.sent.length;
  assert.ok(afterFirst >= 2);
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41977778888", "i3", "não") }); // encerra pelo ramo
  const afterBranch = wa.sent.length;
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41977778888", "i4", "anunciar de novo") });
  assert.equal(wa.sent.length, afterBranch); // sem recomeço dentro das 24h
  await app.close();
});

test("ciclo message→message mal desenhado corta em 8 envios", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{
    id: "fl3", saas: "leverads", name: "loop", active: true,
    trigger: { type: "keyword", keyword: "loop" },
    nodes: [
      { id: "a", kind: "message", text: "ping", next: "b" },
      { id: "b", kind: "message", text: "pong", next: "a" },
    ],
  }]);
  await repo.create("wa_threads", { id: "41900001111", phone: "41900001111", name: "X", saas: "leverads" });
  await repo.create("wa_messages", { id: "wl1", thread: "41900001111", direction: "in", text: "loop", at: new Date().toISOString() });

  const sent = [];
  const r = await runWaFlows(repo, { message: { from: "41900001111", text: "loop" }, send: async ({ text }) => sent.push(text) });
  assert.equal(sent.length, 8);
  assert.equal(r.ended, true);
  assert.ok(!(await repo.get("wa_threads", "41900001111")).waFlow);
});
