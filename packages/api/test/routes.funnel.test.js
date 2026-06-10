// PUT /api/products/:id/funnel — grava o funil e MIGRA lead.stage/deal.stage
// renomeados (sem FK, um PATCH cru órfã os cards). Garante: migra só o SaaS do
// produto, ignora rename pra estágio que não existe no funil novo, e valida body.

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

test("rename de estágio migra leads e deals do SaaS — e só dele", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Discovery", conv: 1 }, { stage: "Demo", conv: 0.5 }] });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Demo" });
  await repo.create("leads", { id: "l2", saas: "leverads", stage: "Discovery" });
  await repo.create("leads", { id: "l3", saas: "outro", stage: "Demo" });
  await repo.create("deals", { id: "d1", saas: "leverads", stage: "Demo" });
  const app = buildApp(repo);

  const res = await app.inject({
    method: "PUT", url: "/api/products/leverads/funnel",
    payload: {
      funnel: [{ stage: "Discovery", conv: 1 }, { stage: "Qualificação", conv: 0.5 }],
      renames: { "Demo": "Qualificação" },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.migrated, 2); // l1 + d1
  assert.equal(body.product.funnel[1].stage, "Qualificação");

  assert.equal((await repo.get("leads", "l1")).stage, "Qualificação");
  assert.equal((await repo.get("leads", "l2")).stage, "Discovery"); // não renomeado
  assert.equal((await repo.get("leads", "l3")).stage, "Demo");      // outro SaaS intocado
  assert.equal((await repo.get("deals", "d1")).stage, "Qualificação");

  await app.close();
});

test("rename pra estágio fora do funil novo é ignorado (não órfã pior)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "p1", funnel: [{ stage: "A", conv: 1 }] });
  await repo.create("leads", { id: "l1", saas: "p1", stage: "A" });
  const app = buildApp(repo);

  const res = await app.inject({
    method: "PUT", url: "/api/products/p1/funnel",
    payload: { funnel: [{ stage: "B", conv: 1 }], renames: { "A": "Inexistente" } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().migrated, 0);
  assert.equal((await repo.get("leads", "l1")).stage, "A");
  await app.close();
});

test("validações: produto inexistente → 404; body sem funnel → 400", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "p1", funnel: [] });
  const app = buildApp(repo);

  assert.equal((await app.inject({ method: "PUT", url: "/api/products/nao-existe/funnel", payload: { funnel: [] } })).statusCode, 404);
  assert.equal((await app.inject({ method: "PUT", url: "/api/products/p1/funnel", payload: { renames: {} } })).statusCode, 400);
  await app.close();
});
