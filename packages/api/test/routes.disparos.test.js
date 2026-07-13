// Disparos — rota de marcar envio (fila assistida) grava o progresso + loga o
// toque na timeline; rota de copy por IA valida configuração e repassa a sugestão.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerCampaignRoutes } = await import("../src/routes.disparos.js");

async function buildApp({ anthropic } = {}) {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads", name: "João Silva", phone: "41999998888", stage: "Nutrição" });
  await repo.create("campaigns", { id: "cmp1", saas: "leverads", name: "Reativação julho", status: "draft", sent: {} });
  const app = Fastify();
  registerCampaignRoutes(app, repo, { anthropic });
  return { app, repo };
}

test("mark: grava progresso, tira do rascunho e loga o toque na timeline", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l1", channel: "whatsapp" } });
  assert.equal(res.statusCode, 200);
  const camp = res.json();
  assert.ok(camp.sent.l1.whatsapp, "carimbou o whatsapp no sent");
  assert.equal(camp.status, "sending", "1º envio tira do rascunho");

  // atividade timeline-only registrada pro lead, com o vínculo da campanha
  const acts = await repo.list("activities");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].lead, "l1");
  assert.equal(acts[0].type, "whatsapp");
  assert.equal(acts[0].meta.campaign, "cmp1");
  assert.equal(acts[0].saas, "leverads");

  // um 2º canal no mesmo lead coexiste (merge, não sobrescreve)
  const res2 = await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l1", channel: "email" } });
  const camp2 = res2.json();
  assert.ok(camp2.sent.l1.whatsapp && camp2.sent.l1.email, "mantém os dois canais");
});

test("mark: valida entrada e existência (400/404)", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l1", channel: "sms" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { channel: "whatsapp" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/naoexiste/mark", payload: { leadId: "l1", channel: "whatsapp" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/campaigns/cmp1/mark", payload: { leadId: "l404", channel: "whatsapp" } })).statusCode, 404);
});

test("ai-copy: sem IA configurada = 400; com IA repassa a sugestão", async () => {
  const off = await buildApp({ anthropic: { configured: () => false } });
  assert.equal((await off.app.inject({ method: "POST", url: "/api/campaigns/ai-copy", payload: { channel: "whatsapp" } })).statusCode, 400);

  const stub = { configured: () => true, suggestCampaignCopy: async () => ({ subject: "S", body: "B", whatsapp: "Oi {{nome}}!" }) };
  const on = await buildApp({ anthropic: stub });
  const res = await on.app.inject({ method: "POST", url: "/api/campaigns/ai-copy", payload: { channel: "whatsapp", publico: "10 leads" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { subject: "S", body: "B", whatsapp: "Oi {{nome}}!" });
});
