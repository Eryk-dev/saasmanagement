// Disparos — mark (fila assistida) grava progresso + loga toque; send-email
// (envio nativo) respeita opt-out/gate e loga; metrics atribui conversão no
// funil; ai-copy valida IA; /u/ descadastra.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerCampaignRoutes } = await import("../src/routes.disparos.js");

// Mesma fórmula do módulo (salt = COCKPIT_API_KEY || default).
const salt = process.env.COCKPIT_API_KEY || "cockpit-unsub-salt";
const unsubToken = (id) => `${id}.${createHash("sha256").update(`${id}:${salt}`).digest("hex").slice(0, 16)}`;

async function buildApp({ anthropic, mailer } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [
    { stage: "Qualificando", kind: "qualificacao" },
    { stage: "Call", kind: "call" },
    { stage: "Ganho", kind: "ganho" },
  ] });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "João Silva", company: "Loja X", phone: "41999998888", email: "joao@x.com", stage: "Qualificando" });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Sem Email", phone: "41988887777", stage: "Qualificando" });
  await repo.create("leads", { id: "l3", saas: "leverads", name: "Optou Fora", email: "out@x.com", emailOptOut: true, stage: "Qualificando" });
  await repo.create("campaigns", { id: "cmp1", saas: "leverads", name: "Reativação julho", status: "draft", sent: {},
    channels: { email: true, whatsapp: true }, email: { subject: "Oi {{nome}}", body: "Novidade pra {{empresa}}" }, wa: { text: "" } });
  const app = Fastify();
  registerCampaignRoutes(app, repo, { anthropic, mailer });
  return { app, repo };
}

test("mark: grava progresso, tira do rascunho e loga o toque na timeline", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l1", channel: "whatsapp" } });
  assert.equal(res.statusCode, 200);
  const camp = res.json();
  assert.ok(camp.sent.l1.whatsapp);
  assert.equal(camp.status, "sending");
  const acts = await repo.list("activities");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].type, "whatsapp");
  assert.equal(acts[0].meta.campaign, "cmp1");
});

test("mark: valida entrada e existência (400/404)", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l1", channel: "sms" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/naoexiste/mark", payload: { leadId: "l1", channel: "whatsapp" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l404", channel: "whatsapp" } })).statusCode, 404);
});

test("send-email: 503 sem Gmail; com mailer envia, pula opt-out/sem-email, loga e marca", async () => {
  // Gate: mailer não pronto → 503.
  const notReady = await buildApp({ mailer: { ready: async () => false, send: async () => {} } });
  assert.equal((await notReady.app.inject({ method: "POST", url: "/api/campaigns/cmp1/send-email", payload: { leadIds: ["l1"] } })).statusCode, 424);

  // Mailer pronto: coleta os envios.
  const outbox = [];
  const mailer = { ready: async () => true, send: async (m) => { outbox.push(m); return { id: "m1" }; } };
  const { app, repo } = await buildApp({ mailer });
  const res = await app.inject({ method: "POST", url: "/api/campaigns/cmp1/send-email", payload: { leadIds: ["l1", "l2", "l3"] } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, 1, "só l1 tem e-mail e não optou fora");
  assert.equal(body.results.find((r) => r.leadId === "l2").reason, "sem e-mail");
  assert.equal(body.results.find((r) => r.leadId === "l3").reason, "descadastrado");

  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "joao@x.com");
  assert.equal(outbox[0].subject, "Oi João", "interpola {{nome}}");
  assert.match(outbox[0].text, /Novidade pra Loja X/, "interpola {{empresa}}");
  assert.match(outbox[0].text, /\/u\//, "inclui link de descadastro");
  assert.ok(outbox[0].headers["List-Unsubscribe"], "header List-Unsubscribe");

  const camp = await repo.get("campaigns", "cmp1");
  assert.ok(camp.sent.l1.email, "carimbou o e-mail no progresso");
  const emailActs = (await repo.list("activities")).filter((a) => a.type === "email");
  assert.equal(emailActs.length, 1);
  assert.equal(emailActs[0].meta.campaign, "cmp1");
});

test("metrics: atribui avançou/call/fechou a partir das transições após o envio", async () => {
  const { app, repo } = await buildApp();
  const T0 = "2026-07-01T10:00:00.000Z";
  await repo.update("campaigns", "cmp1", { sent: { l1: { email: T0 }, l3: { email: T0 } } });
  // l1: Qualificando → Call (avançou + marcou call). l3: Qualificando → Ganho (avançou + fechou).
  await repo.create("activities", { id: "a1", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Qualificando", to: "Call" }, at: "2026-07-02T10:00:00.000Z" });
  await repo.create("activities", { id: "a2", saas: "leverads", lead: "l3", type: "stage", meta: { from: "Qualificando", to: "Ganho" }, at: "2026-07-03T10:00:00.000Z" });
  // ruído: transição ANTES do envio não conta
  await repo.create("activities", { id: "a0", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Novo", to: "Qualificando" }, at: "2026-06-01T10:00:00.000Z" });

  const res = await app.inject({ method: "GET", url: "/api/campaigns/metrics/leverads" });
  assert.equal(res.statusCode, 200);
  const m = res.json().campaigns.find((c) => c.id === "cmp1");
  assert.equal(m.sent, 2);
  assert.equal(m.advanced, 2);
  assert.equal(m.booked, 1);  // só l1 entrou em etapa de call
  assert.equal(m.won, 1);     // só l3 fechou
});

test("unsubscribe: token válido descadastra (idempotente); inválido = 400", async () => {
  const { app, repo } = await buildApp();
  const bad = await app.inject({ method: "GET", url: "/u/l1.deadbeef" });
  assert.equal(bad.statusCode, 400);
  assert.ok(!(await repo.get("leads", "l1")).emailOptOut);

  const ok = await app.inject({ method: "GET", url: `/u/${unsubToken("l1")}` });
  assert.equal(ok.statusCode, 200);
  assert.equal((await repo.get("leads", "l1")).emailOptOut, true);
});

test("ai-copy: sem IA = 400; com IA repassa a sugestão", async () => {
  const off = await buildApp({ anthropic: { configured: () => false } });
  assert.equal((await off.app.inject({ method: "POST", url: "/api/campaigns/ai-copy", payload: { channel: "whatsapp" } })).statusCode, 400);
  const stub = { configured: () => true, suggestCampaignCopy: async () => ({ subject: "S", body: "B", whatsapp: "Oi {{nome}}!" }) };
  const on = await buildApp({ anthropic: stub });
  const res = await on.app.inject({ method: "POST", url: "/api/campaigns/ai-copy", payload: { channel: "whatsapp" } });
  assert.deepEqual(res.json(), { subject: "S", body: "B", whatsapp: "Oi {{nome}}!" });
});
