// Automações do Inbox — regras reativas sobre mensagem recebida: gatilhos
// (palavra-chave/primeira mensagem/fora do horário), prioridade, cooldown por
// conversa, regra desativada não dispara e o token {{nome}}. Tudo offline,
// pela MESMA superfície do webhook da Meta.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerWhatsappRoutes } = await import("../src/routes.whatsapp.js");
const { renderAutoReply, runWaAutomations } = await import("../src/wa-automations.js");

function fakeWa() {
  const sent = [];
  return {
    sent,
    configured: () => true,
    verifyWebhook: () => null,
    async sendText(to, text, { phoneId } = {}) {
      sent.push({ to, text, phoneId });
      return { messageId: "wamid.TXT" + sent.length };
    },
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

const inText = (from, id, body, ts = "1720000000") => ({
  entry: [{ changes: [{ field: "messages", value: { contacts: [{ profile: { name: "Maria Souza" } }], messages: [{ from, id, timestamp: ts, type: "text", text: { body } }] } }] }],
});

async function seed(repo, rules = []) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "ld1", saas: "leverads", phone: "41992516545", name: "Maria Souza", stage: "Novo" });
  for (const r of rules) await repo.create("wa_automations", { saas: "leverads", active: true, cooldownHours: 24, ...r });
}

test("renderAutoReply: {{nome}} vira o primeiro nome; sem nome o token sai limpo", () => {
  assert.equal(renderAutoReply("Oi {{nome}}, tudo bem?", { name: "Maria Souza" }), "Oi Maria, tudo bem?");
  assert.equal(renderAutoReply("Oi {{nome}}, tudo bem?", { name: "" }), "Oi, tudo bem?");
});

test("palavra-chave: dispara com acento/caixa diferentes, responde 1x e respeita o cooldown", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ id: "au1", name: "preço", trigger: "keyword", keyword: "preço", reply: "Oi {{nome}}! Nossos planos: leverads.com.br/planos" }]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41992516545", "m1", "qual o PRECO de voces?") });
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].text, "Oi Maria! Nossos planos: leverads.com.br/planos");

  // resposta gravada na conversa como autor "automacao"
  const out = (await repo.list("wa_messages")).find((m) => m.direction === "out");
  assert.equal(out.author, "automacao");

  // mesma palavra de novo dentro do cooldown → silêncio
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41992516545", "m2", "e o preço?") });
  assert.equal(wa.sent.length, 1);

  // mensagem sem a palavra também não dispara
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41992516545", "m3", "bom dia") });
  assert.equal(wa.sent.length, 1);
  await app.close();
});

test("primeira mensagem: dispara só na 1ª; regra desativada nunca dispara", async () => {
  const repo = makeMemRepo();
  await seed(repo, [
    { id: "au2", name: "boas-vindas", trigger: "first_message", reply: "Recebemos sua mensagem! Já te respondo." },
    { id: "au3", name: "desligada", trigger: "first_message", reply: "NÃO ERA PRA SAIR", active: false },
  ]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41988887777", "n1", "olá!") });
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].text, "Recebemos sua mensagem! Já te respondo.");

  // 2ª mensagem (outro contato segue elegível; o mesmo não)
  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41988887777", "n2", "tem alguém aí?") });
  assert.equal(wa.sent.length, 1);
  await app.close();
});

test("prioridade: keyword vence first_message na mesma mensagem (dispara UMA regra)", async () => {
  const repo = makeMemRepo();
  await seed(repo, [
    { id: "au4", name: "boas-vindas", trigger: "first_message", reply: "bem-vindo" },
    { id: "au5", name: "preço", trigger: "keyword", keyword: "preço", reply: "tabela de preços" },
  ]);
  const wa = fakeWa();
  const app = await appWith(repo, wa);

  await app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: inText("41977776666", "p1", "oi, qual o preço?") });
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].text, "tabela de preços");
  await app.close();
});

test("fora do horário: usa a régua do waCallFlow (fim de semana = fora) e não dispara em horário comercial", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ id: "au6", name: "plantão", trigger: "off_hours", reply: "Estamos fora do horário, retornamos amanhã cedo!" }]);
  // domingo 12:00 BRT
  const sunday = new Date("2026-07-12T15:00:00.000Z");
  // quarta 11:00 BRT (dentro do padrão 8-18)
  const wednesday = new Date("2026-07-08T14:00:00.000Z");

  await repo.create("wa_threads", { id: "41966665555", phone: "41966665555", name: "João", saas: "leverads" });
  await repo.create("wa_messages", { id: "wmX", thread: "41966665555", direction: "in", text: "oi", at: sunday.toISOString() });

  const sent = [];
  const send = async ({ text }) => sent.push(text);

  const hit = await runWaAutomations(repo, { message: { from: "41966665555", text: "oi" }, send, now: sunday });
  assert.equal(hit, "au6");
  assert.equal(sent.length, 1);

  // dentro do horário (e fora do cooldown): não dispara
  const later = new Date(wednesday.getTime() + 3 * 86_400_000);
  const miss = await runWaAutomations(repo, { message: { from: "41966665555", text: "oi de novo" }, send, now: later });
  assert.equal(miss, null);
  assert.equal(sent.length, 1);
});
