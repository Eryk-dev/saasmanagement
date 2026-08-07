// Histórico de calls (Leo, 07/08): callAt é um campo só — sobrescrever/limpar
// um callAt que JÁ PASSOU arquiva o antigo em lead.callHistory, pra call feita
// nunca sumir da agenda. Futuro remarcado NÃO arquiva (não aconteceu).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Follow-up", kind: "followup" }] });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const PAST = "2026-08-06T16:00";     // já aconteceu
const PAST2 = "2026-08-06T19:30";
const FUTURE = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);

test("remarcar por cima de call PASSADA arquiva em callHistory (com o closer)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Follow-up", closer: "leonardo", callAt: PAST });

  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { callAt: FUTURE } });
  let l = await repo.get("leads", "l1");
  assert.equal(l.callAt, FUTURE);
  assert.deepEqual(l.callHistory, [{ at: PAST, closer: "leonardo" }]);

  // Repetir o MESMO horário não duplica; sobrescrever de novo com outro
  // passado arquiva o segundo também.
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { callAt: FUTURE } });
  await repo.update("leads", "l1", { callAt: PAST2 });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { callAt: "" } }); // limpar também arquiva
  l = await repo.get("leads", "l1");
  assert.deepEqual(l.callHistory.map((h) => h.at), [PAST, PAST2]);
  assert.equal(l.callAt, "");
  await app.close();
});

test("call FUTURA sobrescrita não arquiva (não aconteceu)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Follow-up", callAt: FUTURE });
  await app.inject({ method: "PATCH", url: "/api/leads/l2", payload: { callAt: "" } });
  const l = await repo.get("leads", "l2");
  assert.equal(l.callHistory, undefined);
  await app.close();
});
