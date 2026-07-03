// Custos operacionais: resumo mensal (ads + IA + manuais) e a correção do
// custo por etapa (estágios pós-Ganho não contam como progresso).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerMetricsRoutes } = await import("../src/routes.metrics.js");
const { registerMarketingRoutes } = await import("../src/routes.marketing.js");

const FUNNEL = ["Inbox", "Qualificação", "Call closer", "Negociação", "Integração", "Ganho", "Sem resposta / Nutrição", "Desqualificado", "Perdido", "Mentoria"]
  .map((stage) => ({ stage, conv: 1 }));

test("custo por etapa: descartados e pós-venda não contam como Ganho", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const today = new Date().toISOString();
  const day = today.slice(0, 10);
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "c", date: day, spend: 600 });
  // 6 leads: 2 Inbox, 1 Call closer, 1 Ganho, 1 Desqualificado, 1 Perdido
  const mk = (id, stage) => repo.create("leads", { id, saas: "leverads", name: id, stage, createdAt: today });
  await mk("l1", "Inbox"); await mk("l2", "Inbox"); await mk("l3", "Call closer");
  await mk("l4", "Ganho"); await mk("l5", "Desqualificado"); await mk("l6", "Perdido");

  const app = Fastify();
  registerMarketingRoutes(app, repo, { meta: { configured: () => false } });
  const res = await app.inject({ method: "GET", url: "/api/marketing/leverads" });
  const per = Object.fromEntries(res.json().perStage.map((s) => [s.stage, s.count]));

  assert.equal(per["Inbox"], 6);           // todos chegaram
  assert.equal(per["Call closer"], 2);     // l3 + l4
  assert.equal(per["Ganho"], 1);           // SÓ o l4 (antes contava descartados)
  assert.equal(per["Desqualificado"], undefined); // régua termina em Ganho
  await app.close();
});

test("GET /api/expenses/summary soma ads + IA (em R$) + manuais do mês", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const month = new Date().toISOString().slice(0, 7);
  const day = new Date().toISOString().slice(0, 10);
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "c", date: day, spend: 1000 });
  await repo.create("ad_insights", { id: "a2", saas: "leverads", campaignId: "c", date: "2020-01-05", spend: 999 }); // fora do mês
  await repo.create("expenses", { id: "e1", saas: "leverads", month, category: "fixo", name: "Servidor", amount: 200 });
  await repo.create("expenses", { id: "e2", saas: "leverads", month, category: "ferramenta", name: "CRM", amount: 100 });
  await repo.create("expenses", { id: "e3", saas: "leverads", month: "2020-01", category: "fixo", name: "antigo", amount: 999 });
  // recorrentes: contador entra todo mês desde 2020; o encerrado em 2020-06 não
  await repo.create("expenses", { id: "e4", saas: "leverads", month: "2020-01", category: "fixo", name: "Contador", amount: 400, recurring: true });
  await repo.create("expenses", { id: "e5", saas: "leverads", month: "2020-01", category: "fixo", name: "Sala", amount: 555, recurring: true, endMonth: "2020-06" });

  const ai = {
    configured: () => true,
    report: async () => ({
      usdBrl: 5,
      providers: [{ provider: "openai", ok: true, series: [{ date: day, spend: 10 }, { date: "2020-01-02", spend: 99 }] }],
    }),
  };
  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai });
  const res = await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  assert.equal(s.ads, 1000);
  assert.equal(s.aiUSD, 10);
  assert.equal(s.ai, 50);            // 10 USD × 5
  assert.equal(s.manualTotal, 700);  // 200 + 100 + 400 do recorrente ativo
  assert.equal(s.total, 1750);
  assert.equal(s.manual.length, 3);
  assert.equal(s.manual[0].name, "Contador"); // recorrente vem primeiro

  // em 2020-03 valem os dois recorrentes (Sala só encerra em 2020-06) + o avulso de jan não
  const past = (await app.inject({ method: "GET", url: "/api/expenses/summary/leverads?month=2020-03" })).json();
  assert.deepEqual(past.manual.map((e) => e.name).sort(), ["Contador", "Sala"]);
  assert.equal(past.manualTotal, 955);
  await app.close();
});
