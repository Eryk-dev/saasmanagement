// Fase 3 do PLANO-AUTH: ligar o staff a uma conta Lever pelo e-mail e migrar a
// senha no login antigo, sem nunca sobrescrever a senha de conta do LeverAds.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";
import { makeIdentityAdmin, staffRolesFor } from "../src/identity-admin.js";

const { registerRoutes } = await import("../src/routes.js");

// Identidade falsa: contas por e-mail, registro das chamadas.
function fakeIdentity() {
  const accounts = new Map(); // email -> { userId, source, password }
  const calls = [];
  let n = 0;
  return {
    accounts, calls,
    fail: false,
    async findUserByEmail(email) {
      calls.push(["find", email]);
      if (this.fail) throw new Error("fora do ar");
      const a = accounts.get(email.toLowerCase());
      return a ? { userId: a.userId, source: a.source, hasPassword: !!a.password } : null;
    },
    async createUser(email) {
      calls.push(["create", email]);
      const userId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      accounts.set(email, { userId, source: "cockpit", password: "" });
      return userId;
    },
    async setPassword(userId, password) {
      calls.push(["password", userId]);
      if (this.fail) throw new Error("fora do ar");
      for (const a of accounts.values()) if (a.userId === userId) a.password = password;
    },
    async setStaff(userId, roles) { calls.push(["staff", userId, roles]); },
    async sendPasswordEmail(email, redirectTo) {
      calls.push(["email", email, redirectTo]);
      if (this.fail) throw new Error("fora do ar");
    },
  };
}

async function buildApp(identity = fakeIdentity()) {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.update("users", "eryk", { roles: ["admin"] });
  await repo.create("users", { id: "ana", name: "Ana", role: "admin", roles: ["sdr", "support"], passwordHash: hashPassword("senha-da-ana") });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, { identity });
  return { app, repo, identity };
}
const K = { "x-api-key": "test-key" };
const link = (app, id, email, headers = K) => app.inject({ method: "POST", url: `/api/auth/users/${id}/identity`, headers, payload: { email } });
const login = (app, username, password) => app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });

test("e-mail sem conta: cria a conta Lever, marca como staff e migra a senha no próximo login antigo", async (t) => {
  const { app, repo, identity } = await buildApp();
  t.after(() => app.close());
  const res = await link(app, "ana", " Ana@Lever.test ");
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.email, "ana@lever.test");
  assert.equal(body.identityCreated, true);
  assert.equal(body.identityPasswordSet, false);
  assert.ok(body.authUserId);
  assert.deepEqual(identity.calls.find((c) => c[0] === "staff"), ["staff", body.authUserId, ["team", "support"]]);
  assert.equal(body.passwordHash, undefined);

  assert.equal((await login(app, "ana", "senha-da-ana")).statusCode, 200);
  assert.equal(identity.accounts.get("ana@lever.test").password, "senha-da-ana", "mesma senha levada ao GoTrue");
  assert.ok((await repo.get("users", "ana")).identityPasswordAt);

  // segundo login não chama a identidade de novo
  const before = identity.calls.length;
  assert.equal((await login(app, "ana", "senha-da-ana")).statusCode, 200);
  assert.equal(identity.calls.length, before);
});

test("conta que já existe (LeverAds) é reaproveitada e a senha de lá nunca é sobrescrita", async (t) => {
  const { app, identity } = await buildApp();
  t.after(() => app.close());
  identity.accounts.set("eryk@lever.test", { userId: "11111111-1111-4111-8111-111111111111", source: "leverads", password: "senha-leverads" });
  const res = await link(app, "eryk", "eryk@lever.test");
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().authUserId, "11111111-1111-4111-8111-111111111111");
  assert.equal(res.json().identityCreated, false);
  assert.equal(res.json().identityPasswordSet, true);
  assert.deepEqual(identity.calls.find((c) => c[0] === "staff")[2], ["team", "admin"]);
  assert.equal((await login(app, "eryk", "1234")).statusCode, 200);
  assert.equal(identity.accounts.get("eryk@lever.test").password, "senha-leverads");
  assert.equal(identity.calls.some((c) => c[0] === "password"), false);
});

test("conta criada pelo cockpit que já ganhou senha pelo e-mail não é sobrescrita", async (t) => {
  const { app, identity } = await buildApp();
  t.after(() => app.close());
  await link(app, "ana", "ana@lever.test");
  identity.accounts.get("ana@lever.test").password = "definida-pelo-email";
  assert.equal((await login(app, "ana", "senha-da-ana")).statusCode, 200);
  assert.equal(identity.accounts.get("ana@lever.test").password, "definida-pelo-email");
});

test("identidade fora do ar não impede o login antigo; a migração tenta de novo depois", async (t) => {
  const { app, repo, identity } = await buildApp();
  t.after(() => app.close());
  await link(app, "ana", "ana@lever.test");
  identity.fail = true;
  assert.equal((await login(app, "ana", "senha-da-ana")).statusCode, 200);
  assert.equal((await repo.get("users", "ana")).identityPasswordAt, "");
  identity.fail = false;
  assert.equal((await login(app, "ana", "senha-da-ana")).statusCode, 200);
  assert.equal(identity.accounts.get("ana@lever.test").password, "senha-da-ana");
});

test("vínculo: e-mail inválido, e-mail ou conta já ligados, sem identidade, sem etiqueta admin", async (t) => {
  const { app, identity } = await buildApp();
  t.after(() => app.close());
  assert.equal((await link(app, "ana", "sem-arroba")).statusCode, 400);
  assert.equal((await link(app, "ninguem", "x@lever.test")).statusCode, 404);
  await link(app, "ana", "ana@lever.test");
  assert.equal((await link(app, "leonardo", "ana@lever.test")).statusCode, 409, "e-mail de outra pessoa");
  identity.accounts.set("apelido@lever.test", identity.accounts.get("ana@lever.test"));
  assert.equal((await link(app, "leonardo", "apelido@lever.test")).statusCode, 409, "mesma conta por outro e-mail");

  const ana = { "x-api-key": (await login(app, "ana", "senha-da-ana")).json().token };
  assert.equal((await link(app, "ana", "outro@lever.test", ana)).statusCode, 403, "só admin liga conta");

  const bare = await buildApp(null);
  t.after(() => bare.app.close());
  assert.equal((await link(bare.app, "ana", "ana@lever.test")).statusCode, 424);
});

test("papéis, desligar e remover sincronizam o staff na identidade", async (t) => {
  const { app, identity } = await buildApp();
  t.after(() => app.close());
  const { authUserId } = (await link(app, "ana", "ana@lever.test")).json();
  identity.calls.length = 0;
  await app.inject({ method: "PATCH", url: "/api/auth/users/ana", headers: K, payload: { roles: ["sdr", "admin"] } });
  assert.deepEqual(identity.calls, [["staff", authUserId, ["team", "admin"]]]);

  identity.calls.length = 0;
  const off = await app.inject({ method: "DELETE", url: "/api/auth/users/ana/identity", headers: K });
  assert.equal(off.json().authUserId, "");
  assert.deepEqual(identity.calls, [["staff", authUserId, []]]);

  const again = (await link(app, "ana", "ana@lever.test")).json();
  identity.calls.length = 0;
  await app.inject({ method: "DELETE", url: "/api/auth/users/ana?force=1", headers: K });
  assert.deepEqual(identity.calls, [["staff", again.authUserId, []]]);
});

test("e-mail de definir senha: só com conta ligada, volta para a origem do cockpit", async (t) => {
  const { app, identity } = await buildApp();
  t.after(() => app.close());
  const send = (id, redirectTo, headers = K) => app.inject({ method: "POST", url: `/api/auth/users/${id}/identity/password-email`, headers, payload: { redirectTo } });
  assert.equal((await send("ana", "http://localhost:5173/")).statusCode, 409, "sem conta ligada");
  await link(app, "ana", "ana@lever.test");
  assert.equal((await send("ana", "javascript:alert(1)")).statusCode, 400);
  assert.equal((await send("ana", "nada")).statusCode, 400);
  const ok = await send("ana", "http://localhost:5173/app#ajustes?x=1");
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(identity.calls.at(-1), ["email", "ana@lever.test", "http://localhost:5173/"], "só a origem");
  identity.fail = true;
  assert.equal((await send("ana", "http://localhost:5173/")).statusCode, 424);
  identity.fail = false;
  const ana = { "x-api-key": (await login(app, "ana", "senha-da-ana")).json().token };
  assert.equal((await send("ana", "http://localhost:5173/", ana)).statusCode, 403, "só admin dispara");
});

test("cliente da identidade: desligado sem env; chama as rotas certas com as chaves certas", async () => {
  assert.equal(makeIdentityAdmin({ env: {} }), null);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([init.method, url, init.headers.authorization]);
    const body = url.includes("find_user_by_email") ? [{ user_id: "u1", source: "leverads", has_password: true }] : url.endsWith("/admin/users") ? { id: "u2" } : null;
    return { ok: true, status: 200, text: async () => (body ? JSON.stringify(body) : "") };
  };
  const idn = makeIdentityAdmin({ env: { IDENTITY_AUTH_URL: "http://auth/", IDENTITY_REST_URL: "http://rest", IDENTITY_SERVICE_KEY: "svc", IDENTITY_COCKPIT_KEY: "ck" }, fetchImpl });
  assert.deepEqual(await idn.findUserByEmail("a@b.c"), { userId: "u1", source: "leverads", hasPassword: true });
  assert.equal(await idn.createUser("n@b.c"), "u2");
  await idn.setPassword("u2", "x");
  await idn.setStaff("u2", ["team"]);
  await idn.sendPasswordEmail("n@b.c", "http://x/");
  assert.deepEqual(seen, [
    ["POST", "http://rest/rpc/find_user_by_email", "Bearer ck"],
    ["POST", "http://auth/admin/users", "Bearer svc"],
    ["PUT", "http://auth/admin/users/u2", "Bearer svc"],
    ["POST", "http://rest/rpc/set_staff", "Bearer ck"],
    ["POST", "http://auth/recover?redirect_to=http%3A%2F%2Fx%2F", "Bearer svc"],
  ]);
  assert.deepEqual(staffRolesFor({ roles: ["closer"] }), ["team"]);
  assert.deepEqual(staffRolesFor({ roles: ["admin", "support", "sdr"] }), ["team", "admin", "support"]);
});
