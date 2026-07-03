// Gasto com IA: agregação por provedor com fetch mockado + rota /api/ai-costs.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeAiCosts } = await import("../src/ai-costs.js");
const { registerMetricsRoutes } = await import("../src/routes.metrics.js");

const json = (obj, status = 200) => ({ status, text: async () => JSON.stringify(obj) });

test("report agrega os 3 provedores e isola falhas por provedor", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const fetchMock = async (url) => {
    const u = String(url);
    if (u.includes("openrouter.ai/api/v1/credits")) return json({ data: { total_credits: 20, total_usage: 3.9 } });
    if (u.includes("openrouter.ai/api/v1/activity")) return json({ error: { message: "Only management keys", code: 403 } }, 403);
    if (u.includes("api.openai.com/v1/organization/costs")) {
      return json({ data: [{ start_time: Date.now() / 1000, results: [{ amount: { value: 12.5, currency: "usd" } }] }], has_more: false });
    }
    if (u.includes("api.anthropic.com/v1/organizations/cost_report")) {
      return json({ data: [{ starting_at: today + "T00:00:00Z", results: [{ amount: "7.25", currency: "USD" }] }], has_more: false });
    }
    if (u.includes("economia.awesomeapi.com.br")) return json({ USDBRL: { bid: "5.50" } });
    return json({}, 404);
  };
  const ai = makeAiCosts({ fetch: fetchMock, openrouterKey: "or", openaiKey: "oa", anthropicKey: "an" });
  const r = await ai.report(30);

  const by = Object.fromEntries(r.providers.map((p) => [p.provider, p]));
  assert.equal(by.openrouter.ok, true);
  assert.equal(by.openrouter.lifetimeSpend, 3.9);
  assert.equal(by.openrouter.remaining, 16.1);
  assert.equal(by.openrouter.spend, undefined);      // activity 403 → sem série, sem spend do período
  assert.equal(by.openai.ok, true);
  assert.equal(by.openai.spend, 12.5);
  assert.equal(by.anthropic.ok, true);
  assert.equal(by.anthropic.spend, 7.25);
  assert.equal(r.totalPeriod, 19.75);                // só quem tem série entra no total
  assert.equal(r.currency, "USD");
  assert.equal(r.usdBrl, 5.5);                       // câmbio pro front converter em R$
});

test("provedor sem chave fica fora do report; erro de permissão explica o motivo", async () => {
  const fetchMock = async (url) => {
    if (String(url).includes("openai")) return json({ error: "insufficient permissions. Missing scopes: api.usage.read" }, 401);
    return json({}, 404);
  };
  const ai = makeAiCosts({ fetch: fetchMock, openaiKey: "oa" });
  const r = await ai.report(30);
  // só a OpenAI tem chave: OpenRouter e Anthropic nem aparecem
  assert.deepEqual(r.providers.map((p) => p.provider), ["openai"]);
  assert.equal(r.providers[0].ok, false);
  assert.ok(r.providers[0].error.includes("ADMIN key"));
  assert.equal(r.totalPeriod, 0);
});

test("GET /api/ai-costs responde agregado; 503 sem nenhuma chave", async () => {
  const repo = makeMemRepo();
  const app = Fastify();
  const ai = { configured: () => true, report: async (days) => ({ days, currency: "USD", totalPeriod: 5, providers: [] }) };
  registerMetricsRoutes(app, repo, { ai });
  const res = await app.inject({ method: "GET", url: "/api/ai-costs?days=30" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().totalPeriod, 5);
  await app.close();

  const off = Fastify();
  registerMetricsRoutes(off, repo, { ai: { configured: () => false } });
  assert.equal((await off.inject({ method: "GET", url: "/api/ai-costs" })).statusCode, 503);
  await off.close();
});
