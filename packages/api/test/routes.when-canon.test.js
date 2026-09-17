// callAt/followupAt/integrationAt entram SEMPRE na forma canônica naive BRT
// (Leo, 17/09): um cliente mandou "…T13:00:00.000Z" (10h BRT) e o lembrete do
// robô disse "hoje às 13h" (caso Renan). POST e PATCH convertem na entrada.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "Follow-up", kind: "followup" },
];

test("POST/PATCH leads: data-hora com fuso vira relógio BRT; naive fica como está", async (t) => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "jonathan", name: "Jonathan", roles: ["closer"] });
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());

  const created = await app.inject({ method: "POST", url: "/api/leads", payload: {
    name: "Renan", saas: "leverads", stage: "Call agendada", closer: "jonathan", source: "Outbound", callAt: "2026-09-16T13:00:00.000Z",
  } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().callAt, "2026-09-16T10:00");

  const id = created.json().id;
  const patched = await app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: { callAt: "2026-09-17T17:00:00.000Z", followupAt: "" } });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal((await repo.get("leads", id)).callAt, "2026-09-17T14:00");

  const naive = await app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: { callAt: "2026-09-18T09:30" } });
  assert.equal(naive.statusCode, 200, naive.body);
  assert.equal((await repo.get("leads", id)).callAt, "2026-09-18T09:30");
});
