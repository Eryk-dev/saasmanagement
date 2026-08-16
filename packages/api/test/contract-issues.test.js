// Histórico de contratos GERADOS (`contract_issues`): o registro que a tela
// Contratos grava quando o contrato preenchido sai pro cliente. O que se
// garante aqui:
//   1. a ficha do cliente pede só os contratos DELE (?customer=) — sem o filtro,
//      o bloco mostraria contrato dos outros clientes;
//   2. quem gerou e quando são carimbados pelo SERVIDOR (registro de auditoria);
//   3. a tela Clientes LÊ o histórico, mas gerar/excluir continua da tela
//      Contratos (leitura de carona, nunca escrita).
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, ensureDefaultAdmins, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook, screenForRequest } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

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

const loginToken = async (app, username, password) =>
  (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } })).json().token;

const ISSUE = {
  saas: "leverads", contract: "co_consultoria_logistica", name: "Consultoria logística",
  tag: "serviço", values: { razao_social: "Loja do João", valor_total: "12.000,00" },
  fields: [{ key: "razao_social", label: "razão social" }], body: "<h1>{{razao_social}}</h1>",
};

test("contratos gerados: ?customer= devolve só os do cliente da ficha", async (t) => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": "test-key" };

  for (const [id, customerId, customerName] of [["ci1", "c1", "Loja do João"], ["ci2", "c2", "Outra Loja"], ["ci3", "c1", "Loja do João"]]) {
    await repo.create("contract_issues", { ...ISSUE, id, customerId, customerName, createdAt: "2026-08-1" + id.slice(-1) + "T12:00:00.000Z" });
  }
  // Registro sem vínculo (razão social digitada na mão) não entra na ficha de ninguém.
  await repo.create("contract_issues", { ...ISSUE, id: "ci4", customerId: "", customerName: "Cliente Avulso" });

  const doCliente = (await app.inject({ url: "/api/contract_issues?customer=c1", headers: H })).json();
  assert.deepEqual(doCliente.map((i) => i.id).sort(), ["ci1", "ci3"]);
  assert.equal((await app.inject({ url: "/api/contract_issues?customer=c2", headers: H })).json().length, 1);
  assert.equal((await app.inject({ url: "/api/contract_issues", headers: H })).json().length, 4);
  // Filtros do histórico da tela: por produto e por modelo.
  assert.equal((await app.inject({ url: "/api/contract_issues?saas=outro", headers: H })).json().length, 0);
  assert.equal((await app.inject({ url: "/api/contract_issues?contract=co_consultoria_logistica", headers: H })).json().length, 4);
});

test("contratos gerados: servidor carimba quem gerou e quando", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "closer", name: "Closer", role: "admin", roles: ["closer"],
    screens: ["contracts"], passwordHash: hashPassword("1234"),
  });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "closer", "1234");

  // A tela manda author, mas quem vale é a SESSÃO (auditoria não se falsifica).
  const res = await app.inject({
    method: "POST", url: "/api/contract_issues", headers: { "x-api-key": token },
    payload: { ...ISSUE, customerId: "c1", customerName: "Loja do João", author: "outro" },
  });
  assert.equal(res.statusCode, 201);
  const created = res.json();
  assert.equal(created.author, "closer");
  assert.ok(created.createdAt, "createdAt carimbado pelo servidor");
  assert.equal(created.customerId, "c1");
  assert.deepEqual(created.values, ISSUE.values); // snapshot preservado inteiro

  // Key mestre (MCP/integração) não tem sessão: o autor do corpo é respeitado.
  const viaKey = await app.inject({
    method: "POST", url: "/api/contract_issues", headers: { "x-api-key": "test-key" },
    payload: { ...ISSUE, customerId: "c1", customerName: "Loja do João", author: "integracao" },
  });
  assert.equal(viaKey.json().author, "integracao");
});

test("contratos gerados: a ficha do cliente LÊ o histórico, mas só a tela Contratos escreve", async (t) => {
  // O mapa: GET ganha "customers" de carona; POST/DELETE seguem só de contracts.
  assert.deepEqual(screenForRequest("GET", "/api/contract_issues"), ["contracts", "customers"]);
  assert.deepEqual(screenForRequest("POST", "/api/contract_issues"), ["contracts"]);
  assert.deepEqual(screenForRequest("DELETE", "/api/contract_issues/ci1"), ["contracts"]);
  assert.deepEqual(screenForRequest("GET", "/api/contracts"), ["contracts"]); // modelo continua fechado

  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "cs", name: "CS", role: "admin", roles: ["cs"],
    screens: ["customers"], passwordHash: hashPassword("1234"),
  });
  await repo.create("contract_issues", { ...ISSUE, id: "ci1", customerId: "c1", customerName: "Loja do João" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": await loginToken(app, "cs", "1234") };

  assert.equal((await app.inject({ url: "/api/contract_issues?customer=c1", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/contract_issues", headers: H, payload: ISSUE })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/contract_issues/ci1", headers: H })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/contracts", headers: H })).statusCode, 403); // biblioteca de modelos: não
});
