// stageSince = quando o card entrou no estágio atual (base do contador "dias na
// coluna" do kanban). Carimbado no POST e recarimbado no PATCH só quando o stage
// muda de fato — patch de outros campos / mesmo stage / rename não zera.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

test("POST lead carimba stageSince e createdAt", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "X", saas: "leverads", stage: "Negociação" } });
  assert.equal(res.statusCode, 201);
  const lead = res.json();
  assert.ok(lead.stageSince, "stageSince carimbado no create");
  assert.ok(lead.createdAt, "createdAt carimbado no create");
});

test("PATCH que muda o stage recarimba stageSince", async () => {
  const repo = makeMemRepo();
  const old = "2020-01-01T00:00:00.000Z";
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Negociação", stageSince: old });
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().stage, "Integração");
  assert.ok(new Date(res.json().stageSince).getTime() > new Date(old).getTime(), "stageSince recarimbado pra agora");
});

test("PATCH de outro campo OU do mesmo stage preserva stageSince", async () => {
  const repo = makeMemRepo();
  const since = "2020-01-01T00:00:00.000Z";
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Negociação", stageSince: since });
  const app = buildApp(repo);

  let res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { proposalValue: 1000 } });
  assert.equal(res.json().stageSince, since, "patch de outro campo não mexe");

  res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Negociação" } });
  assert.equal(res.json().stageSince, since, "mesmo stage não recarimba");
});

test("PATCH com stageSince explícito é respeitado (optimistic move)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Negociação", stageSince: "2020-01-01T00:00:00.000Z" });
  const app = buildApp(repo);
  const explicit = "2026-06-26T10:00:00.000Z";
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração", stageSince: explicit } });
  assert.equal(res.json().stageSince, explicit);
});
