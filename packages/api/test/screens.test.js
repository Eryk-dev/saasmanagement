// Restrição de telas por usuário (user.screens): o guard de rotas fecha a API
// pras telas que o usuário não tem, o bootstrap sai filtrado e a key mestre
// (MCP/integrações) nunca é restringida.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, ensureDefaultAdmins, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook, screenForRequest, sanitizeScreens } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

// App com a MESMA pilha de hooks do index.js (auth + guard de telas).
function buildApp(repo, apiKey = "test-key") {
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey, repo,
    openPaths: new Set(["/api/health", "/api/auth/login"]),
    openPrefixes: [],
    providedKey,
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  return app;
}

async function loginToken(app, username, password) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  return res.json().token;
}

test("sanitizeScreens: só ids conhecidos passam; não-array vira []", () => {
  assert.deepEqual(sanitizeScreens(["pipeline", "hacker", 42, "tasks"]), ["pipeline", "tasks"]);
  assert.deepEqual(sanitizeScreens("pipeline"), []);
  assert.deepEqual(sanitizeScreens(undefined), []);
});

test("screenForRequest: mapa por prefixo + escritas administrativas", () => {
  assert.deepEqual(screenForRequest("GET", "/api/expenses/summary/leverads"), ["expenses"]);
  assert.deepEqual(screenForRequest("GET", "/api/marketing/leverads"), ["metrics"]);
  assert.deepEqual(screenForRequest("POST", "/api/leads/l1/proposal"), ["pipeline", "today"]);
  assert.deepEqual(screenForRequest("POST", "/api/activities"), ["pipeline", "today"]);
  assert.deepEqual(screenForRequest("GET", "/api/pipeline-pace/leverads"), ["pipeline", "analise"]);
  assert.deepEqual(screenForRequest("GET", "/api/funnel/leverads"), ["pipeline", "analise"]);
  assert.deepEqual(screenForRequest("GET", "/api/scoreboard/leverads"), ["overview", "funcionarios"]);
  assert.deepEqual(screenForRequest("GET", "/api/customers"), ["customers"]);
  assert.equal(screenForRequest("GET", "/api/products"), null);           // catálogo é leitura livre
  assert.deepEqual(screenForRequest("PATCH", "/api/products/leverads"), ["settings"]);
  assert.deepEqual(screenForRequest("POST", "/api/auth/users"), ["settings"]);
  assert.equal(screenForRequest("GET", "/api/auth/users"), null);         // lista de nomes: pickers
  assert.equal(screenForRequest("GET", "/api/bootstrap"), null);          // filtra o payload por conta própria
});

test("usuário restrito (pipeline+tasks): funil libera, financeiro/clientes/ajustes 403", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "sdr", name: "SDR", role: "admin", roles: ["sdr"],
    screens: ["pipeline", "tasks"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "sdr", "1234");
  const H = { "x-api-key": token };

  // O que a tela dele usa: liberado.
  assert.equal((await app.inject({ url: "/api/leads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/tasks", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/pipeline-pace/leverads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/leads", headers: H, payload: { name: "Lead X", saas: "leverads" } })).statusCode, 201);
  assert.equal((await app.inject({ url: "/api/products", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/auth/users", headers: H })).statusCode, 200);

  // Telas que ele NÃO tem: 403 na API, não só menu escondido.
  for (const url of ["/api/customers", "/api/expenses", "/api/expenses/summary/leverads", "/api/marketing/leverads", "/api/metrics/leverads", "/api/proposal_templates", "/api/forms", "/api/portfolio", "/api/ad_insights"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 403, `esperava 403 em ${url}`);
  }
  // Escritas administrativas também.
  assert.equal((await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: H, payload: { name: "X" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/users", headers: H, payload: { name: "Z", password: "abcd" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/sdr", headers: H, payload: { screens: [] } })).statusCode, 403); // não se auto-libera
});

test("usuário só com Meu dia (today): leads e toques liberados, resto 403", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "op", name: "Operação", role: "admin", roles: ["sdr"],
    screens: ["today"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Lead" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "op", "1234");
  const H = { "x-api-key": token };

  // A fila do dia usa leads + registro de toque: liberados.
  assert.equal((await app.inject({ url: "/api/leads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/api/activities", headers: H,
    payload: { saas: "leverads", lead: "l1", type: "call", text: "tentativa" },
  })).statusCode, 201);
  // Bootstrap entrega os leads pra tela.
  const seed = (await app.inject({ url: "/api/bootstrap", headers: H })).json();
  assert.equal(seed.LEADS.length, 1);
  // O que não é da tela continua fechado.
  for (const url of ["/api/customers", "/api/expenses", "/api/funnel/leverads", "/api/pipeline-pace/leverads", "/api/tasks"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 403, `esperava 403 em ${url}`);
  }
});

test("bootstrap filtrado: restrito recebe leads mas NÃO clientes/portfólio/financeiro do produto", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "sdr", name: "SDR", role: "admin", screens: ["pipeline", "tasks"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente", arr: 12000 });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Lead" });
  const app = buildApp(repo);
  t.after(() => app.close());

  const token = await loginToken(app, "sdr", "1234");
  const seed = (await app.inject({ url: "/api/bootstrap", headers: { "x-api-key": token } })).json();
  assert.equal(seed.LEADS.length, 1);
  assert.deepEqual(seed.CUSTOMERS, []);
  assert.equal(seed.PORTFOLIO, null);
  assert.deepEqual(seed.GOALS, []);
  const p = seed.SAAS.find((s) => s.id === "leverads");
  assert.ok(p, "catálogo de produtos continua (funil/config)");
  assert.ok(Array.isArray(p.funnel));
  assert.equal(p.arr, undefined, "receita não chega no navegador de quem não vê telas financeiras");
  assert.equal(p.mrr, undefined);
  assert.equal(p.customers, undefined);

  // Admin (screens vazio) recebe tudo.
  const t2 = await loginToken(app, "eryk", "1234");
  const full = (await app.inject({ url: "/api/bootstrap", headers: { "x-api-key": t2 } })).json();
  assert.equal(full.CUSTOMERS.length, 1);
  assert.equal(full.SAAS.find((s) => s.id === "leverads").arr, 12000);
});

test("key mestre segue com acesso total (MCP/integrações)", async (t) => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": "test-key" };
  assert.equal((await app.inject({ url: "/api/customers", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/portfolio", headers: H })).statusCode, 200);
});

test("screens: create/PATCH sanitizam e expõem; [] volta a ver tudo", async (t) => {
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo); // sem hooks: chamador = key (testes de contrato do campo)
  t.after(() => app.close());

  const created = (await app.inject({
    method: "POST", url: "/api/auth/users",
    payload: { id: "x", name: "X", password: "abcd", screens: ["pipeline", "nada", "tasks"] },
  })).json();
  assert.deepEqual(created.screens, ["pipeline", "tasks"]);

  const patched = (await app.inject({ method: "PATCH", url: "/api/auth/users/x", payload: { screens: [] } })).json();
  assert.deepEqual(patched.screens, []);
});
