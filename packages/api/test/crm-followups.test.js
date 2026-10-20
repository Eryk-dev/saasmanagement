// Acompanhamento de CS (customers/cs-followups.js): nasce no cliente com dono,
// fecha com sentimento e próximos passos na timeline, e é onde a reunião da
// ficha cai quando não há integração aberta.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { createFollowup, meetingHostFor, updateFollowup } from "../src/customers/cs-followups.js";
import { registerFollowupRoutes } from "../src/customers/routes.cs-followups.js";

test("acompanhamento nasce com o dono da conta e fecha com sentimento na timeline", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", owner: "bia" });
  const f = await createFollowup(repo, { customer: c.id, kind: "qbr", dueAt: "2026-11-01T13:00:00Z" });
  assert.deepEqual([f.kind, f.status, f.owner, f.dueAt], ["qbr", "aberto", "bia", "2026-11-01T13:00:00.000Z"]);
  const done = await updateFollowup(repo, f.id, { status: "feito", sentiment: "positivo", nextSteps: "upsell do OEM" }, { now: new Date("2026-11-01T15:00:00Z") });
  assert.equal(done.doneAt, "2026-11-01T15:00:00.000Z");
  const tl = (await repo.list("timeline_events")).map((t) => t.kind).filter((k) => k.startsWith("followup.")).sort();
  assert.deepEqual(tl, ["followup.created", "followup.done"]);
  await assert.rejects(updateFollowup(repo, f.id, { sentiment: "eufórico" }), (e) => e.statusCode === 400);
  await assert.rejects(createFollowup(repo, { customer: "nao" }), (e) => e.statusCode === 404);
});

test("reunião da ficha: integração aberta mais recente, senão check-in novo", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja" });
  let host = await meetingHostFor(repo, c);
  assert.equal(host.collection, "cs_followups");
  assert.equal((await repo.get("cs_followups", host.id)).kind, "check_in");
  await repo.create("onboardings", { id: "velha", customer: c.id, stage: "configuracao", createdAt: "2026-09-01" });
  await repo.create("onboardings", { id: "nova", customer: c.id, stage: "kickoff", createdAt: "2026-10-01" });
  await repo.create("onboardings", { id: "feita", customer: c.id, stage: "concluida", createdAt: "2026-10-10" });
  host = await meetingHostFor(repo, c);
  assert.deepEqual(host, { collection: "onboardings", id: "nova" });
});

test("rotas: lista abertas, cria e edita com validação", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja" });
  const app = Fastify();
  registerFollowupRoutes(app, repo);
  const r = await app.inject({ method: "POST", url: `/api/customers/${c.id}/followups`, payload: { kind: "renovacao" } });
  assert.equal(r.statusCode, 201);
  const id = r.json().id;
  assert.equal((await app.inject({ method: "PATCH", url: `/api/customers/followups/${id}`, payload: { status: "talvez" } })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/customers/followups?open=1" })).json().followups.length, 1);
  await app.inject({ method: "PATCH", url: `/api/customers/followups/${id}`, payload: { status: "feito" } });
  assert.equal((await app.inject({ url: "/api/customers/followups?open=1" })).json().followups.length, 0);
  assert.equal((await app.inject({ url: `/api/customers/${c.id}/followups` })).json().followups.length, 1);
});

test("renovação aberta põe o cliente na coluna renovação da carteira; fechar tira", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", health: 85 });
  await repo.create("subscriptions", { customer: c.id, status: "active" });
  const f = await createFollowup(repo, { customer: c.id, kind: "renovacao" });
  assert.equal((await repo.get("customers", c.id)).csStage, "renovacao");
  await updateFollowup(repo, f.id, { status: "feito" });
  assert.equal((await repo.get("customers", c.id)).csStage, "saudavel");
});
