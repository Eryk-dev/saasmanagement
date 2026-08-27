// Gerar link de pagamento não pode depender de caixinha marcada. Duas pessoas
// travaram no meio de uma venda por causa disso: o Vitor em 24/08/2026 (faltava
// `offers` na lista dele, virou o piso por papel) e o Jonathan em 27/08 (mesma
// tarefa, outro caminho: cobrar um CLIENTE exigia a tela Clientes inteira).
//
// A régua que ficou:
//   1. `offers` (Links de pagamento) vale pra TODA sessão;
//   2. a AÇÃO de cobrar um cliente anda com essa tela, não com a base de clientes;
//   3. a LEITURA de /api/customers continua exigindo a tela Clientes;
//   4. quem não tem a tela Clientes recebe do bootstrap só o cliente de PICKER
//      (nome e contato), nunca ARR/MRR/saúde/churn.
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeScreenGuardHook, canScreen, screenForRequest } from "../src/screens.js";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";

const { registerRoutes } = await import("../src/routes.js");

const run = async (user, url, method = "GET") => {
  let code = null;
  const reply = { code(c) { code = c; return this; }, send() { return this; } };
  await makeScreenGuardHook()({ authUser: user, url, method }, reply);
  return code;
};

// Igor (mídia social): telas restritas, sem papel nenhum de funil.
const IGOR = { roles: [], screens: ["metrics", "forms", "creative", "social"] };
// Closer com o pacote padrão, sem a tela Clientes (é o caso do Jonathan/José).
const CLOSER = { roles: ["closer"], screens: ["overview", "today", "pipeline", "agenda", "proposals"] };

test("Links de pagamento vale pra qualquer sessão, mesmo sem papel e com lista restrita", async () => {
  assert.equal(canScreen(IGOR, "offers"), true);
  assert.equal(canScreen(CLOSER, "offers"), true);
  assert.equal(await run(IGOR, "/api/offers/leverads"), null);
  assert.equal(await run(IGOR, "/api/payment-links?saas=leverads"), null);
  assert.equal(await run(CLOSER, "/api/payment_links", "POST"), null);
});

test("cobrar um CLIENTE passa pela tela de Links de pagamento, não pela base de clientes", async () => {
  assert.deepEqual(screenForRequest("POST", "/api/customers/cu_1/charge"), ["customers", "offers"]);
  assert.equal(await run(CLOSER, "/api/customers/cu_1/charge", "POST"), null);
  assert.equal(await run(IGOR, "/api/customers/cu_1/charge", "POST"), null);
});

test("ler a base de clientes continua exigindo a tela Clientes", async () => {
  assert.equal(await run(CLOSER, "/api/customers"), 403);
  assert.equal(await run(CLOSER, "/api/customers/cu_1"), 403);
  // (/api/invoices tem carona da Visão geral no GET, então quem testa é quem
  // não tem overview nenhum.)
  assert.equal(await run(IGOR, "/api/invoices"), 403);
  // E o dado sensível de verdade segue fechado.
  assert.equal(await run(CLOSER, "/api/comp_plans"), 403);
  assert.equal(await run(CLOSER, "/api/fin/summary"), 403);
});

test("gerar link no card do lead vale pra quem tem pipeline OU a tela de cobrança", async () => {
  assert.deepEqual(screenForRequest("POST", "/api/leads/le_1/mp/link"), ["pipeline", "today", "offers"]);
  assert.equal(await run(IGOR, "/api/leads/le_1/mp/link", "POST"), null);
  // A lista de leads em si não abriu junto.
  assert.equal(await run(IGOR, "/api/leads"), 403);
});

test("bootstrap: sem a tela Clientes vem o cliente de PICKER, sem número nenhum", async (t) => {
  const repo = makeMemRepo();
  await repo.create("customers", {
    id: "cu_1", saas: "leverads", name: "Distribuidora Galante", email: "rafa@galante.com.br",
    phone: "41999998888", arr: 180000, mrr: 15000, health: 82, plan: "Anual", churnedAt: "",
  });
  await repo.create("users", {
    id: "closer1", name: "Closer", roles: ["closer"], screens: CLOSER.screens,
    passwordHash: hashPassword("segredo123"),
  });

  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/health", "/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => (Array.isArray(req.headers["x-api-key"]) ? req.headers["x-api-key"][0] : req.headers["x-api-key"]) || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  t.after(() => app.close());

  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "closer1", password: "segredo123" } })).json().token;
  const seed = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-api-key": token } })).json();

  assert.equal(seed.CUSTOMERS.length, 1, "sem cliente nenhum o seletor de cobrança fica vazio");
  const c = seed.CUSTOMERS[0];
  assert.equal(c.name, "Distribuidora Galante");
  assert.equal(c.phone, "41999998888");
  for (const k of ["arr", "mrr", "health", "plan"]) {
    assert.equal(c[k], undefined, `${k} não pode viajar pra quem não tem a tela Clientes`);
  }

  // Quem tem a tela continua recebendo a ficha inteira.
  const full = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { "x-api-key": "test-key" } })).json();
  assert.equal(full.CUSTOMERS[0].arr, 180000);
});
