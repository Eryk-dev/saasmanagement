// GET /api/pipeline-pace/:saas — caixa recebido no mês e desdobramento do gap
// em metas operacionais diárias por papel.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = new Date("2026-07-13T15:00:00.000Z"); // 12h em Brasília, segunda
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 0.5 },
  { stage: "Proposta", kind: "proposta", conv: 0.6 },
  { stage: "Ganho", kind: "ganho", conv: 0.4 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function build(product = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads",
    name: "LeverAds",
    funnel: FUNNEL,
    monthlyCashTarget: 120000,
    ...product,
  });
  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => NOW } });
  return { app, repo };
}

test("pace usa faturas pagas, dias úteis e desdobra o gap pelas conversões reais", async () => {
  const { app, repo } = await build();

  await repo.create("invoices", { id: "i1", saas: "leverads", subscription: "s1", customer: "c1", status: "paid", amount: 30000, paidAt: "2026-07-03T15:00:00.000Z" });
  await repo.create("invoices", { id: "i2", saas: "leverads", subscription: "s2", customer: "c2", status: "paid", amount: 10000, paidAt: "2026-07-13T15:00:00.000Z" });
  await repo.create("invoices", { id: "i3", saas: "leverads", status: "open", amount: 20000, dueDate: "2026-07-20T15:00:00.000Z" });
  await repo.create("invoices", { id: "i4", saas: "leverads", status: "overdue", amount: 5000, dueDate: "2026-06-30T15:00:00.000Z" });
  await repo.create("invoices", { id: "i5", saas: "leverads", status: "open", amount: 9000, dueDate: "2026-08-02T15:00:00.000Z" });

  await repo.create("customers", { id: "c1", saas: "leverads", arr: 12000, startedAt: "2026-07-03T15:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", arr: 24000, startedAt: "2026-07-13T15:00:00.000Z" });

  const leads = [
    { id: "l1", stage: "Ganho", callAt: "2026-07-10T15:00:00.000Z", stageSince: "2026-07-13T14:00:00.000Z", amount: 40000 },
    { id: "l2", stage: "Proposta", callAt: "2026-07-13T18:00:00.000Z" },
    { id: "l3", stage: "Perdido", callAt: "2026-07-09T15:00:00.000Z", lostReason: "nao_compareceu" },
    { id: "l4", stage: "Call agendada", callAt: "2026-07-08T15:00:00.000Z" },
    { id: "l5", stage: "Novo lead" },
    { id: "l6", stage: "Novo lead" },
    { id: "l7", stage: "Novo lead" },
    { id: "l8", stage: "Novo lead" },
    { id: "l9", stage: "Novo lead" },
    { id: "l10", stage: "Novo lead", createdAt: "2026-07-13T13:00:00.000Z" },
  ];
  for (let i = 0; i < leads.length; i++) {
    await repo.create("leads", {
      saas: "leverads",
      createdAt: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      ...leads[i],
    });
  }
  for (let i = 1; i <= 8; i++) {
    await repo.create("activities", {
      id: `touch${i}`,
      saas: "leverads",
      lead: `l${i}`,
      type: "whatsapp",
      at: i <= 2 ? "2026-07-13T13:30:00.000Z" : "2026-07-06T13:30:00.000Z",
    });
  }
  await repo.create("activities", { id: "b1", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-07T14:00:00.000Z" });
  await repo.create("activities", { id: "b2", saas: "leverads", lead: "l2", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-13T14:00:00.000Z" });
  await repo.create("activities", { id: "b3", saas: "leverads", lead: "l3", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-08T14:00:00.000Z" });
  await repo.create("proposals", { id: "p1", saas: "leverads", lead: "l2", createdAt: "2026-07-13T16:00:00.000Z" });

  const res = await app.inject({ url: "/api/pipeline-pace/leverads" });
  assert.equal(res.statusCode, 200);
  const r = res.json();

  assert.equal(r.cash.target, 120000);
  assert.equal(r.cash.collected, 40000);
  assert.equal(r.cash.collectedToday, 10000);
  assert.equal(r.cash.gap, 80000);
  assert.equal(r.cash.totalBusinessDays, 23);
  assert.equal(r.cash.elapsedBusinessDays, 9);
  assert.equal(r.cash.remainingBusinessDays, 15); // inclui hoje
  assert.equal(r.cash.requiredDailyPace, 5333.33);
  assert.equal(r.cash.receivables, 25000);
  assert.equal(r.cash.forecastWithReceivables, 65000);

  assert.equal(r.context.tcvMonth, 40000);
  assert.equal(r.context.mrr, 3000);
  assert.equal(r.context.averageEntry, 20000);
  assert.equal(r.context.averageEntrySource, "initial_payments");

  assert.deepEqual(r.conversions.contactRate, { value: 0.8, source: "history", numerator: 8, denominator: 10 });
  assert.deepEqual(r.conversions.bookingRate, { value: 0.375, source: "history", numerator: 3, denominator: 8 });
  assert.equal(r.conversions.showRate.value, 0.6667);
  assert.equal(r.conversions.closeRate.value, 0.25);

  assert.equal(r.plan.wins.remaining, 4);
  assert.equal(r.plan.calls.remaining, 16);
  assert.equal(r.plan.callsBooked.remaining, 24);
  assert.equal(r.plan.leads.remaining, 80);
  assert.equal(r.plan.contacts.remaining, 64);
  assert.equal(r.plan.contacts.today, 2);
  assert.equal(r.plan.callsBooked.today, 1);
  assert.equal(r.plan.calls.today, 1);
  assert.equal(r.plan.wins.today, 1);
  assert.equal(r.plan.onboardings.today, 1);
  assert.equal(r.plan.proposals.today, 1);

  await app.close();
});

test("sem histórico usa metas configuradas e depois os benchmarks", async () => {
  const { app, repo } = await build();
  for (const [id, key, metric, target] of [
    ["g1", "sdr", "contactRate", 90],
    ["g2", "sdr", "bookingRate", 40],
    ["g3", "sdr", "showRate", 80],
    ["g4", "closer", "winRateCall", 20],
    ["g5", "closer", "ticket", 10000],
  ]) await repo.create("goals", { id, saas: "leverads", scope: "role", key, metric, target });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.context.averageEntry, 10000);
  assert.equal(r.context.averageEntrySource, "configured_ticket");
  assert.deepEqual(Object.fromEntries(Object.entries(r.conversions).map(([k, v]) => [k, [v.value, v.source]])), {
    contactRate: [0.9, "goal"],
    bookingRate: [0.4, "goal"],
    showRate: [0.8, "goal"],
    closeRate: [0.2, "goal"],
  });
  assert.equal(r.plan.wins.remaining, 12);

  await app.close();
});

test("conversão histórica zerada bloqueia o desdobramento sem gerar infinito", async () => {
  const { app, repo } = await build();
  await repo.create("invoices", { id: "i1", saas: "leverads", status: "paid", amount: 10000, paidAt: "2026-06-01T15:00:00.000Z" });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Novo lead", createdAt: "2026-07-01T15:00:00.000Z" });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.conversions.contactRate.value, 0);
  assert.equal(r.plan.blockedBy, "contactRate");
  assert.equal(r.plan.leads.remaining, null);
  assert.equal(r.plan.contacts.remaining, 214);
  assert.equal(r.plan.wins.remaining, 12);

  await app.close();
});

test("produto inexistente retorna 404", async () => {
  const { app } = await build();
  assert.equal((await app.inject({ url: "/api/pipeline-pace/nao-existe" })).statusCode, 404);
  await app.close();
});
