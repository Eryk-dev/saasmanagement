// "Conectar" das telas Publicidade e Redes sociais: os endpoints que listam o
// que o token Meta alcança (contas de anúncio e páginas com IG vinculado).
// Sem token → { configured: false } e lista vazia (a UI mostra o passo de infra).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMeta } = await import("../src/meta.js");

// fetch fake do Graph: /me/adaccounts pagina em 2; /me/accounts numa página só.
function makeGraphFetch() {
  const accountsPage2 = {
    data: [{ id: "act_222", name: "Elo Ads", account_status: 1, business_name: "Unique" }],
  };
  const accountsPage1 = {
    data: [{ id: "act_111", name: "Lever Ads", account_status: 1 }],
    paging: { next: "https://graph.facebook.com/v23.0/me/adaccounts?after=xyz" },
  };
  const pages = {
    data: [
      { id: "p1", name: "Página Elo", instagram_business_account: { id: "ig9", username: "app.elo" } },
      { id: "p2", name: "Página sem IG" },
    ],
  };
  return async (url) => {
    const u = String(url);
    const body = u.includes("me/accounts") ? pages
      : u.includes("after=xyz") ? accountsPage2
      : accountsPage1;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
}

function buildApp({ configured = true } = {}) {
  const repo = makeMemRepo();
  const app = Fastify();
  const metaClient = makeMeta({ fetch: makeGraphFetch(), accessToken: configured ? "test-token" : "" });
  registerRoutes(app, repo, { meta: metaClient });
  return app;
}

test("adaccounts: pagina, tira o prefixo act_ e marca ativa", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/marketing/meta/adaccounts" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.configured, true);
  assert.deepEqual(body.accounts.map((a) => a.id), ["111", "222"]);
  assert.equal(body.accounts[1].name, "Elo Ads");
  assert.equal(body.accounts[1].business, "Unique");
  assert.equal(body.accounts[0].active, true);
});

test("pages: devolve página com e sem Instagram vinculado", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/social/pages" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.configured, true);
  assert.equal(body.pages.length, 2);
  assert.deepEqual(body.pages[0], { pageId: "p1", name: "Página Elo", igUserId: "ig9", igUsername: "app.elo" });
  assert.equal(body.pages[1].igUserId, "");
});

test("sem META_ACCESS_TOKEN: configured=false e lista vazia nos dois", async () => {
  const app = buildApp({ configured: false });
  const ads = await app.inject({ method: "GET", url: "/api/marketing/meta/adaccounts" });
  assert.deepEqual(ads.json(), { configured: false, accounts: [] });
  const pages = await app.inject({ method: "GET", url: "/api/social/pages" });
  assert.deepEqual(pages.json(), { configured: false, pages: [] });
});
