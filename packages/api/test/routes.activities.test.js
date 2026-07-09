// Collection `activities` (timeline do lead) — CRUD genérico + stamps do POST
// (id ac_ randômico, at/createdAt) + filtros ?lead/?saas/?type/?since.
// Os auto-logs (stage move, lead_created, proposta) têm testes em lead-flow.test.js.

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

test("POST activity aplica defaults + id ac_ + at/createdAt", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo);

  const res = await app.inject({
    method: "POST", url: "/api/activities",
    payload: { lead: "l1", saas: "leverads", type: "whatsapp", text: "mandei o link", author: "eryk" },
  });
  assert.equal(res.statusCode, 201);
  const a = res.json();
  assert.match(a.id, /^ac_/);
  assert.equal(a.type, "whatsapp");
  assert.deepEqual(a.meta, {});
  assert.ok(a.at, "at carimbado");
  assert.ok(a.createdAt, "createdAt carimbado");

  // `at` explícito (backdate) é respeitado; createdAt continua sendo agora.
  const back = await app.inject({
    method: "POST", url: "/api/activities",
    payload: { lead: "l1", type: "note", at: "2026-01-01T10:00:00.000Z" },
  });
  assert.equal(back.json().at, "2026-01-01T10:00:00.000Z");
  assert.notEqual(back.json().createdAt, "2026-01-01T10:00:00.000Z");

  await app.close();
});

test("filtros ?lead / ?saas / ?type / ?since", async () => {
  const repo = makeMemRepo();
  await repo.create("activities", { id: "a1", lead: "l1", saas: "leverads", type: "note", at: "2026-07-01T00:00:00Z" });
  await repo.create("activities", { id: "a2", lead: "l1", saas: "leverads", type: "call", at: "2026-07-05T00:00:00Z" });
  await repo.create("activities", { id: "a3", lead: "l2", saas: "outro", type: "note", at: "2026-07-03T00:00:00Z" });
  const app = buildApp(repo);

  assert.deepEqual((await app.inject({ url: "/api/activities?lead=l1" })).json().map((a) => a.id).sort(), ["a1", "a2"]);
  assert.deepEqual((await app.inject({ url: "/api/activities?saas=outro" })).json().map((a) => a.id), ["a3"]);
  assert.deepEqual((await app.inject({ url: "/api/activities?lead=l1&type=call" })).json().map((a) => a.id), ["a2"]);
  assert.deepEqual((await app.inject({ url: "/api/activities?since=2026-07-02" })).json().map((a) => a.id).sort(), ["a2", "a3"]);

  await app.close();
});

test("lead novo nasce com os campos do CRM (GPS/perda/denorm)", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Ana", saas: "leverads" } });
  const lead = res.json();
  assert.equal(lead.nextActionAt, "");
  assert.equal(lead.nextActionNote, "");
  assert.equal(lead.lostReason, "");
  assert.equal(lead.lostNote, "");
  assert.equal(lead.closer, "");
  assert.equal(lead.lastActivityAt, "");
  assert.equal(lead.stageAttempts, 0);
  await app.close();
});
