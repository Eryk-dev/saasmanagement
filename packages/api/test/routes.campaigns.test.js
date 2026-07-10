// Gerenciamento de campanha Meta: client (listCampaigns/status/budget, com
// fetch mockado) e rotas /api/marketing/... com meta injetada.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeMeta } = await import("../src/meta.js");
const { registerMarketingRoutes } = await import("../src/routes.marketing.js");

test("meta client: listCampaigns converte centavos e pagina; escrita valida entradas", async () => {
  const calls = [];
  const fetchMock = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes("/campaigns?")) {
      return { status: 200, text: async () => JSON.stringify({ data: [
        { id: "c1", name: "Lookalike", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "15000" },
        { id: "c2", name: "Remarketing", status: "PAUSED", effective_status: "PAUSED", lifetime_budget: "90000" },
      ] }) };
    }
    return { status: 200, text: async () => JSON.stringify({ success: true }) };
  };
  const meta = makeMeta({ fetch: fetchMock, accessToken: "tok" });

  const rows = await meta.listCampaigns("123");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dailyBudget, 150);          // 15000 centavos → R$ 150
  assert.equal(rows[1].lifetimeBudget, 900);
  assert.ok(String(calls[0].url).includes("act_123/campaigns"));

  const st = await meta.setObjectStatus("c1", "PAUSED");
  assert.deepEqual(st, { id: "c1", status: "PAUSED" });
  const body = String(calls.at(-1).opts.body);
  assert.ok(body.includes("status=PAUSED"));

  const bud = await meta.setObjectBudget("c1", 199.9);
  assert.equal(bud.dailyBudget, 199.9);
  assert.ok(String(calls.at(-1).opts.body).includes("daily_budget=19990"));

  await assert.rejects(() => meta.setObjectStatus("c1", "DELETED"), /status inválido/);
  await assert.rejects(() => meta.setObjectBudget("c1", 0), /orçamento inválido/);
  await app_noop();
  async function app_noop() {} // simetria com os outros testes
});

async function buildApp(metaFake) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [], metaAdAccount: "act_9" });
  await repo.create("products", { id: "semconta", name: "SemConta", funnel: [] });
  const app = Fastify();
  registerMarketingRoutes(app, repo, { meta: metaFake });
  return app;
}

test("rotas de gerenciamento: lista, valida e repassa erros da Meta", async () => {
  const fake = {
    configured: () => true,
    listCampaigns: async () => [{ id: "c1", name: "Lookalike", status: "ACTIVE" }],
    setObjectStatus: async (id, status) => ({ id, status }),
    setObjectBudget: async (id, v) => ({ id, dailyBudget: v }),
  };
  const app = await buildApp(fake);

  const list = await app.inject({ method: "GET", url: "/api/marketing/leverads/campaigns" });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().campaigns[0].id, "c1");

  // produto sem conta configurada → 400; produto inexistente → 404
  assert.equal((await app.inject({ method: "GET", url: "/api/marketing/semconta/campaigns" })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/marketing/nada/campaigns" })).statusCode, 404);

  const pause = await app.inject({ method: "POST", url: "/api/marketing/campaigns/c1/status", payload: { status: "PAUSED" } });
  assert.equal(pause.statusCode, 200);
  assert.equal(pause.json().status, "PAUSED");
  assert.equal((await app.inject({ method: "POST", url: "/api/marketing/campaigns/c1/status", payload: { status: "DELETED" } })).statusCode, 400);

  const bud = await app.inject({ method: "POST", url: "/api/marketing/campaigns/c1/budget", payload: { dailyBudget: 150 } });
  assert.equal(bud.statusCode, 200);
  assert.equal(bud.json().dailyBudget, 150);
  assert.equal((await app.inject({ method: "POST", url: "/api/marketing/campaigns/c1/budget", payload: { dailyBudget: -1 } })).statusCode, 400);
  await app.close();
});

test("rotas de gerenciamento: 503 sem token e 502 quando a Meta falha", async () => {
  const off = await buildApp({ configured: () => false });
  assert.equal((await off.inject({ method: "GET", url: "/api/marketing/leverads/campaigns" })).statusCode, 503);
  await off.close();

  const broken = await buildApp({
    configured: () => true,
    listCampaigns: async () => { throw new Error("Meta API -> 400: (#100) permissao"); },
    setObjectStatus: async () => { throw new Error("Meta API -> 400: sem ads_management"); },
  });
  assert.equal((await broken.inject({ method: "GET", url: "/api/marketing/leverads/campaigns" })).statusCode, 502);
  const res = await broken.inject({ method: "POST", url: "/api/marketing/campaigns/c1/status", payload: { status: "PAUSED" } });
  assert.equal(res.statusCode, 502);
  assert.ok(res.json().error.includes("ads_management"));
  await broken.close();
});
