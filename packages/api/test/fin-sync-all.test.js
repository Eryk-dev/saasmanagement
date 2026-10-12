// UM botão de sincronizar: POST /api/fin/:saas/sync roda entradas (espelho),
// saídas (settlement) e regras numa passada; falha de um lado não esconde o outro.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerFinRoutes } = await import("../src/payments/routes.fin.js");

test("sync-all devolve os três blocos e isola falhas", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const mp = {
    configured: () => true,
    me: async () => ({ id: 1 }),
    searchPayments: async () => ({ results: [], paging: { total: 0 } }),
    getPayment: async () => { throw new Error("nope"); },
    settlementReportList: async () => { throw new Error("reports fora do ar"); },
  };
  const app = Fastify();
  registerFinRoutes(app, repo, { mp });
  const r = (await app.inject({ method: "POST", url: "/api/fin/leverads/sync" })).json();
  assert.equal(r.ok, true);
  assert.equal(r.in.seen, 0);
  assert.match(r.out.error, /reports fora do ar/);
  assert.deepEqual(r.rules, { applied: 0, settled: 0 });
  const off = Fastify();
  registerFinRoutes(off, repo, { mp: { configured: () => false } });
  assert.equal((await off.inject({ method: "POST", url: "/api/fin/leverads/sync" })).statusCode, 400);
  await app.close(); await off.close();
});
