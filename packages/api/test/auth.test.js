// Sistema de usuários: admins padrão (hash, nunca plaintext), login (case-
// insensitive, senha errada → 401), token de sessão aceito pelo hook de auth no
// lugar da key, logout invalida, e users/sessions FORA do CRUD genérico.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { ensureDefaultAdmins, makeAuthHook, hashPassword, verifyPassword } = await import("../src/auth.js");

function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

// App com o MESMO hook do index.js (key OU sessão), pra testar o fluxo inteiro.
function buildApp(repo, apiKey = "test-key") {
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey, repo,
    openPaths: new Set(["/api/health", "/api/auth/login"]),
    openPrefixes: [],
    providedKey,
  }));
  registerRoutes(app, repo);
  return app;
}

test("hash de senha: scrypt, nunca plaintext, verify funciona", () => {
  const stored = hashPassword("1234");
  assert.match(stored, /^scrypt:/);
  assert.ok(!stored.includes("1234"));
  assert.equal(verifyPassword("1234", stored), true);
  assert.equal(verifyPassword("errada", stored), false);
});

test("admins padrão: Eryk e Leonardo criados uma vez; senha guardada com hash", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureDefaultAdmins(repo), 2);
  assert.equal(await ensureDefaultAdmins(repo), 0); // idempotente: não recria

  const users = await repo.list("users");
  assert.deepEqual(users.map((u) => u.id).sort(), ["eryk", "leonardo"]);
  for (const u of users) {
    assert.equal(u.role, "admin");
    assert.match(u.passwordHash, /^scrypt:/);
  }
});

test("login → token; token passa no hook; senha errada → 401; logout invalida", async () => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  const app = buildApp(repo);

  // Sem credencial → 401. Login é aberto.
  assert.equal((await app.inject({ method: "GET", url: "/api/products" })).statusCode, 401);
  const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Eryk", password: "errada" } });
  assert.equal(bad.statusCode, 401);

  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "eryk", password: "1234" } });
  assert.equal(res.statusCode, 200);
  const { token, user } = res.json();
  assert.equal(user.name, "Eryk");
  assert.ok(token.length >= 64);
  assert.ok(!("passwordHash" in user));

  // Token funciona como credencial nas rotas protegidas (mesmo header da key).
  const list = await app.inject({ method: "GET", url: "/api/products", headers: { "x-api-key": token } });
  assert.equal(list.statusCode, 200);
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { "x-api-key": token } });
  assert.equal(me.json().id, "eryk");

  // Logout mata a sessão.
  await app.inject({ method: "POST", url: "/api/auth/logout", headers: { "x-api-key": token } });
  assert.equal((await app.inject({ method: "GET", url: "/api/products", headers: { "x-api-key": token } })).statusCode, 401);

  // A key continua valendo (MCP/integrações).
  assert.equal((await app.inject({ method: "GET", url: "/api/products", headers: { "x-api-key": "test-key" } })).statusCode, 200);

  await app.close();
});

test("users/sessions ficam fora do CRUD genérico (hash/token não vazam)", async () => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  const app = buildApp(repo);
  const H = { "x-api-key": "test-key" };

  assert.equal((await app.inject({ method: "GET", url: "/api/users", headers: H })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/sessions", headers: H })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/users/eryk", headers: H })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/sessions", headers: H, payload: { id: "x" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/users/eryk", headers: H })).statusCode, 404);

  // Lista sanitizada via rota dedicada.
  const users = (await app.inject({ method: "GET", url: "/api/auth/users", headers: H })).json();
  assert.equal(users.length, 2);
  for (const u of users) assert.ok(!("passwordHash" in u));

  // Criar usuário novo já entra com hash e consegue logar.
  const created = await app.inject({ method: "POST", url: "/api/auth/users", headers: H, payload: { name: "Mika", password: "abcd" } });
  assert.equal(created.statusCode, 201);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Mika", password: "abcd" } });
  assert.equal(login.statusCode, 200);

  await app.close();
});

test("trocar senha: exige sessão + senha atual; nova senha passa a valer", async () => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  const app = buildApp(repo);

  const { token } = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "eryk", password: "1234" } })).json();

  // Key não troca senha (sem usuário); senha atual errada → 401.
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/password", headers: { "x-api-key": "test-key" }, payload: { current: "1234", password: "nova1" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/password", headers: { "x-api-key": token }, payload: { current: "errada", password: "nova1" } })).statusCode, 401);

  const ok = await app.inject({ method: "POST", url: "/api/auth/password", headers: { "x-api-key": token }, payload: { current: "1234", password: "nova1" } });
  assert.equal(ok.statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "eryk", password: "1234" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "eryk", password: "nova1" } })).statusCode, 200);

  await app.close();
});

// ── Roles (etiquetas de capacidade do funil) ────────────────────────────────

test("roles: create sanitiza, list expõe, PATCH edita e reseta senha", async (t) => {
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo); // registra /api/auth/* junto
  t.after(() => app.close());

  const created = (await app.inject({
    method: "POST", url: "/api/auth/users",
    payload: { name: "Jonathan", password: "abcd", roles: ["closer", "hacker", 42] },
  })).json();
  assert.deepEqual(created.roles, ["closer"]); // desconhecidas caem

  const listed = (await app.inject({ url: "/api/auth/users" })).json();
  assert.deepEqual(listed.find((u) => u.id === created.id).roles, ["closer"]);

  // PATCH roles + nome
  const patched = (await app.inject({
    method: "PATCH", url: `/api/auth/users/${created.id}`,
    payload: { roles: ["sdr", "closer"], name: "Jon" },
  })).json();
  assert.deepEqual(patched.roles, ["sdr", "closer"]);
  assert.equal(patched.name, "Jon");
  assert.equal(patched.passwordHash, undefined, "hash nunca vaza");

  // reset de senha: a nova loga, a antiga não
  const reset = await app.inject({ method: "PATCH", url: `/api/auth/users/${created.id}`, payload: { password: "nova1" } });
  assert.equal(reset.statusCode, 200);
  const ok = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Jon", password: "nova1" } });
  assert.equal(ok.statusCode, 200);
  const bad = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Jon", password: "abcd" } });
  assert.equal(bad.statusCode, 401);

  // senha curta é rejeitada; usuário inexistente 404
  assert.equal((await app.inject({ method: "PATCH", url: `/api/auth/users/${created.id}`, payload: { password: "ab" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/nao-existe", payload: { roles: [] } })).statusCode, 404);
});

test("saas do usuário: escopo por produto (ex.: Ana só na UniqueKids), vazio = todos", async (t) => {
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());

  // create com saas (sanitizado pra minúsculas/trim) e exposto na listagem
  const ana = (await app.inject({
    method: "POST", url: "/api/auth/users",
    payload: { id: "ana", name: "Ana", password: "abcd", roles: ["closer"], saas: " UniqueKids " },
  })).json();
  assert.equal(ana.saas, "uniquekids");

  const listed = (await app.inject({ url: "/api/auth/users" })).json();
  assert.equal(listed.find((u) => u.id === "ana").saas, "uniquekids");

  // usuário sem saas volta "" (todos os produtos)
  const leo = (await app.inject({
    method: "POST", url: "/api/auth/users",
    payload: { id: "leo", name: "Leo", password: "abcd", roles: ["closer"] },
  })).json();
  assert.equal(leo.saas, "");

  // PATCH muda o escopo; "" limpa (volta a valer pra todos)
  const patched = (await app.inject({
    method: "PATCH", url: "/api/auth/users/ana", payload: { saas: "leverads" },
  })).json();
  assert.equal(patched.saas, "leverads");
  const cleared = (await app.inject({
    method: "PATCH", url: "/api/auth/users/ana", payload: { saas: "" },
  })).json();
  assert.equal(cleared.saas, "");
});
