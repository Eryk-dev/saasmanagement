// CAC/LTV (GET /api/metrics/:saas) e conversão automática lead→cliente no
// PATCH de estágio. Repo in-memory, via Fastify inject.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox", conv: 1 }, { stage: "Ganho", conv: 1 }], ltvMonths: 10 });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("lead que vira Ganho cria cliente com startedAt e link, sem duplicar", async () => {
  const { app, repo } = await buildApp();
  const lead = await repo.create("leads", { id: "l1", saas: "leverads", name: "Rafael", company: "AutoPrime", email: "r@a.com", phone: "41999", stage: "Inbox" });

  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal(res.statusCode, 200);

  const customers = (await repo.list("customers")).filter((c) => c.saas === "leverads");
  assert.equal(customers.length, 1);
  const c = customers[0];
  assert.equal(c.name, "AutoPrime");
  assert.equal(c.contact, "Rafael");
  assert.equal(c.leadId, "l1");
  assert.ok(c.startedAt);
  assert.equal((await repo.get("leads", "l1")).customerId, c.id);

  // Mover de novo pro mesmo estágio (ou re-ganhar) não duplica.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Inbox" } });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal((await repo.list("customers")).length, 1);
  await app.close();
});

test("GET /api/metrics/:saas calcula CAC, conversão, LTV e série mensal", async () => {
  const { app, repo } = await buildApp();
  // 2 clientes novos na janela de 30d; 1 antigo (fora)
  await repo.create("customers", { id: "c1", saas: "leverads", arr: 12000, startedAt: iso(5) });
  await repo.create("customers", { id: "c2", saas: "leverads", arr: 24000, startedAt: iso(10) });
  await repo.create("customers", { id: "c3", saas: "leverads", arr: 12000, startedAt: iso(200) });
  // assinaturas ativas: ticket médio = (1000 + 2000) / 2 = 1500/mês
  await repo.create("subscriptions", { id: "s1", saas: "leverads", customer: "c1", status: "active", cycle: "monthly", price: 1000 });
  await repo.create("subscriptions", { id: "s2", saas: "leverads", customer: "c2", status: "active", cycle: "annual", price: 24000 });
  await repo.create("subscriptions", { id: "s3", saas: "leverads", customer: "c3", status: "canceled", cycle: "monthly", price: 500 });
  // 10 leads na janela; gasto de 800 na janela
  for (let i = 0; i < 10; i++) await repo.create("leads", { id: `lm${i}`, saas: "leverads", name: `L${i}`, createdAt: iso(i + 1), stage: "Inbox" });
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "x", date: day(3), spend: 500 });
  await repo.create("ad_insights", { id: "a2", saas: "leverads", campaignId: "x", date: day(8), spend: 300 });
  await repo.create("ad_insights", { id: "a3", saas: "leverads", campaignId: "x", date: day(100), spend: 999 });

  const res = await app.inject({ method: "GET", url: "/api/metrics/leverads?days=30&months=6" });
  assert.equal(res.statusCode, 200);
  const m = res.json();

  assert.equal(m.window.spend, 800);
  assert.equal(m.window.newCustomers, 2);
  assert.equal(m.window.leads, 10);
  assert.equal(m.window.cac, 400);           // 800 / 2
  assert.equal(m.window.convRate, 20);       // 2 / 10

  assert.equal(m.ltv.ticket, 1500);          // (1000 + 24000/12) / 2 pagantes
  assert.equal(m.ltv.months, 10);            // premissa do produto
  assert.equal(m.ltv.value, 15000);
  assert.equal(m.ltv.ltvCac, 37.5);
  assert.equal(m.ltv.payingCustomers, 2);

  assert.equal(m.series.length, 6);
  const last = m.series[m.series.length - 1];
  // MRR aproximado do mês corrente inclui os 3 clientes (48000/12 = 4000)
  assert.equal(last.mrr, 4000);
  assert.ok(last.leads >= 1);

  assert.equal((await app.inject({ method: "GET", url: "/api/metrics/nada" })).statusCode, 404);
  await app.close();
});
