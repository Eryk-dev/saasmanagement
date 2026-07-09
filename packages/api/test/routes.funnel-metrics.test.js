// GET /api/funnel/:saas — conversão estágio→estágio, tempo mediano por etapa,
// motivos de perda e SLA de 1º toque, derivados da timeline (activities). Lead
// sem histórico degrada pra aproximação pelo estágio atual (coverage expõe).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 0.5 },
  { stage: "Ganho", kind: "ganho", conv: 0.4 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
  { stage: "Desqualificado", kind: "desqualificado", conv: 0 },
];

const D = (day, h = "12") => `2026-06-${String(day).padStart(2, "0")}T${h}:00:00.000Z`;

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("conversão/mediana por histórico + aproximação pra lead sem histórico", async () => {
  const { app, repo } = await build();
  // l1: Novo → Call (2 dias) → Ganho (2 dias) — histórico completo
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Ganho", createdAt: D(1) });
  await repo.create("activities", { id: "a1", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: D(3) });
  await repo.create("activities", { id: "a2", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Call agendada", to: "Ganho" }, at: D(5) });
  // l2: Novo → Call (4 dias) → Perdido — passou pela call mas perdeu
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Perdido", lostReason: "preco", createdAt: D(1) });
  await repo.create("activities", { id: "a3", saas: "leverads", lead: "l2", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: D(5) });
  await repo.create("activities", { id: "a4", saas: "leverads", lead: "l2", type: "stage", meta: { from: "Call agendada", to: "Perdido", lostReason: "preco" }, at: D(6) });
  // l3: sem histórico, parado em Call agendada — aproximação
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "Call agendada", createdAt: D(2) });
  // l4: sem histórico, em Novo lead
  await repo.create("leads", { id: "l4", saas: "leverads", stage: "Novo lead", createdAt: D(2) });

  const r = (await app.inject({ url: "/api/funnel/leverads?since=2026-06-01&until=2026-06-30" })).json();
  assert.deepEqual(r.coverage, { leads: 4, withHistory: 2 });

  const byStage = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
  assert.equal(byStage["Novo lead"].entered, 4);
  assert.equal(byStage["Call agendada"].entered, 3); // l1, l2 (histórico), l3 (aprox.)
  assert.equal(byStage["Ganho"].entered, 1);
  assert.equal(byStage["Novo lead"].convToNext, 0.75);   // 3/4
  assert.equal(byStage["Call agendada"].convToNext, 0.33); // 1/3
  assert.equal(byStage["Novo lead"].medianDaysInStage, 3); // l1: 2d, l2: 4d → mediana 3
  assert.equal(byStage["Call agendada"].medianDaysInStage, 1.5); // l1: 2d, l2: 1d

  assert.equal(r.wonCount, 1);
  assert.equal(r.lostCount, 1);
  assert.equal(r.winRate, 0.5);
  assert.deepEqual(r.lossReasons, [{ reason: "preco", count: 1 }]);
  await app.close();
});

test("SLA de 1º toque: mediana, buckets e não-tocados", async () => {
  const { app, repo } = await build();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Novo lead", createdAt: D(1, "10") });
  await repo.create("activities", { id: "t1", saas: "leverads", lead: "l1", type: "whatsapp", at: D(1, "10").replace("10:00", "10:30") }); // 0.5h
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Novo lead", createdAt: D(1, "10") });
  await repo.create("activities", { id: "t2", saas: "leverads", lead: "l2", type: "call", at: D(1, "20") }); // 10h
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "Novo lead", createdAt: D(2) }); // nunca tocado
  // nota não é toque
  await repo.create("activities", { id: "t3", saas: "leverads", lead: "l3", type: "note", at: D(3) });

  const r = (await app.inject({ url: "/api/funnel/leverads?since=2026-06-01&until=2026-06-30" })).json();
  assert.equal(r.firstTouch.medianHours, 5.25); // (0.5 + 10) / 2
  assert.deepEqual(r.firstTouch.buckets, { h1: 1, h4: 1, h24: 2 });
  assert.equal(r.firstTouch.touched, 2);
  assert.equal(r.firstTouch.untouched, 1);
  await app.close();
});

test("lossReasons agrupa desqualificado + sem motivo vira nao_informado; 404 pra saas inexistente", async () => {
  const { app, repo } = await build();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Perdido", lostReason: "preco", createdAt: D(1) });
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Perdido", lostReason: "preco", createdAt: D(1) });
  await repo.create("leads", { id: "l3", saas: "leverads", stage: "Desqualificado", lostReason: "sem_fit", createdAt: D(1) });
  await repo.create("leads", { id: "l4", saas: "leverads", stage: "Perdido", createdAt: D(1) }); // sem motivo

  const r = (await app.inject({ url: "/api/funnel/leverads?since=2026-06-01&until=2026-06-30" })).json();
  assert.deepEqual(r.lossReasons, [
    { reason: "preco", count: 2 },
    { reason: "sem_fit", count: 1 },
    { reason: "nao_informado", count: 1 },
  ]);
  assert.equal(r.dqCount, 1);
  assert.equal((await app.inject({ url: "/api/funnel/nao-existe" })).statusCode, 404);
  await app.close();
});
