// Login pela identidade central (auth-jwt.js): JWT ES256 validado pelo JWKS,
// só staff da org Lever ligado a um usuário do cockpit, e os três AUTH_MODE.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { generateKeyPairSync, sign, createHmac, randomUUID } from "node:crypto";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { userByAuthId } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";
import { makeJwksCache, makeJwtResolver, resolveAuthMode, looksLikeJwt, LEVER_ORG_ID } from "../src/auth-jwt.js";

const { registerRoutes } = await import("../src/routes.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function makeKey(kid = randomUUID()) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" } };
}
function es256(key, claims, header = {}) {
  const head = b64({ alg: "ES256", typ: "JWT", kid: key.kid, ...header });
  const body = b64(claims);
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const staffClaims = (sub, extra = {}) => ({
  sub, aud: "authenticated", role: "authenticated", iat: now(), exp: now() + 600,
  session_id: randomUUID(), aal: "aal1", org_id: LEVER_ORG_ID, org_role: "admin", is_staff: true, staff_roles: ["admin"], ...extra,
});

// JWKS servido por um fetch falso que conta as buscas.
function fakeJwks(keys) {
  const state = { keys, calls: 0 };
  state.fetchImpl = async () => { state.calls++; return { ok: true, json: async () => ({ keys: state.keys.map((k) => k.jwk) }) }; };
  return state;
}

const ERYK_SUB = "0a0a0a0a-0000-4000-8000-000000000001";

async function buildApp({ mode = "dual", keys, jwks } = {}) {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.update("users", "eryk", { authUserId: ERYK_SUB, roles: ["admin"] });
  const state = jwks || fakeJwks(keys);
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => {
      const auth = req.headers.authorization || "";
      return req.headers["x-api-key"] || (auth.startsWith("Bearer ") ? auth.slice(7) : "");
    },
    authMode: mode,
    jwtUser: makeJwtResolver({ jwks: makeJwksCache({ url: "http://identity/jwks", fetchImpl: state.fetchImpl }), findUser: (sub) => userByAuthId(repo, sub) }),
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  return { app, repo, state };
}
const bearer = (t) => ({ authorization: `Bearer ${t}` });

test("AUTH_MODE: padrão legacy; dual/gotrue exigem AUTH_JWKS_URL; valor inválido falha", () => {
  assert.equal(resolveAuthMode({}), "legacy");
  assert.equal(resolveAuthMode({ AUTH_MODE: "dual", AUTH_JWKS_URL: "http://x" }), "dual");
  assert.throws(() => resolveAuthMode({ AUTH_MODE: "gotrue" }), /AUTH_JWKS_URL/);
  assert.throws(() => resolveAuthMode({ AUTH_MODE: "jwt" }), /inválido/);
  assert.equal(looksLikeJwt("a".repeat(64)), false);
  assert.equal(looksLikeJwt("eyJhbGciOi.eyJzdWIi.c2ln"), true);
});

test("JWT de staff da org Lever ligado a um usuário entra como esse usuário", async (t) => {
  const key = makeKey();
  const { app } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer(es256(key, staffClaims(ERYK_SUB))) });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().id, "eryk");
  assert.equal(res.json().authUserId, ERYK_SUB);
  assert.equal((await app.inject({ method: "GET", url: "/api/leads", headers: bearer(es256(key, staffClaims(ERYK_SUB))) })).statusCode, 200);
});

test("JWT recusado: expirado, outra chave, assinatura adulterada, alg trocado, aud errado", async (t) => {
  const key = makeKey();
  const other = makeKey();
  const { app } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const get = (token) => app.inject({ method: "GET", url: "/api/leads", headers: bearer(token) });

  assert.equal((await get(es256(key, staffClaims(ERYK_SUB, { exp: now() - 120 })))).statusCode, 401, "expirado");
  assert.equal((await get(es256(other, staffClaims(ERYK_SUB)))).statusCode, 401, "chave fora do JWKS");
  const good = es256(key, staffClaims(ERYK_SUB));
  const [h, , s] = good.split(".");
  assert.equal((await get(`${h}.${b64(staffClaims(ERYK_SUB, { staff_roles: ["admin", "x"] }))}.${s}`)).statusCode, 401, "payload adulterado");
  // HS256 assinado com um segredo qualquer, mesmo kid: nunca aceito.
  const hsHead = b64({ alg: "HS256", typ: "JWT", kid: key.kid });
  const hsBody = b64(staffClaims(ERYK_SUB));
  const hsSig = createHmac("sha256", "segredo").update(`${hsHead}.${hsBody}`).digest("base64url");
  assert.equal((await get(`${hsHead}.${hsBody}.${hsSig}`)).statusCode, 401, "alg HS256");
  assert.equal((await get(`${b64({ alg: "none", kid: key.kid })}.${hsBody}.`)).statusCode, 401, "alg none");
  assert.equal((await get(es256(key, staffClaims(ERYK_SUB, { aud: "outro-produto" })))).statusCode, 401, "aud");
});

test("JWT válido mas sem acesso: cliente, staff de outra org, conta não ligada", async (t) => {
  const key = makeKey();
  const { app } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const get = (claims) => app.inject({ method: "GET", url: "/api/leads", headers: bearer(es256(key, claims)) });
  assert.equal((await get(staffClaims(ERYK_SUB, { is_staff: false, staff_roles: [] }))).statusCode, 401, "cliente não entra");
  assert.equal((await get(staffClaims(ERYK_SUB, { org_id: randomUUID() }))).statusCode, 401, "org de cliente ativa");
  assert.equal((await get(staffClaims(ERYK_SUB, { org_id: undefined }))).statusCode, 401, "sem org");
  assert.equal((await get(staffClaims(randomUUID()))).statusCode, 401, "sub sem usuário no cockpit");
});

test("AUTH_MODE: legacy ignora JWT; dual aceita os dois; gotrue recusa a sessão antiga", async (t) => {
  const key = makeKey();
  for (const [mode, jwtOk, sessionOk] of [["legacy", false, true], ["dual", true, true], ["gotrue", true, false]]) {
    const { app, repo } = await buildApp({ mode, keys: [key] });
    t.after(() => app.close());
    await repo.create("sessions", { id: "f".repeat(64), user: "eryk", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString() });
    const jwt = await app.inject({ method: "GET", url: "/api/leads", headers: bearer(es256(key, staffClaims(ERYK_SUB))) });
    const session = await app.inject({ method: "GET", url: "/api/leads", headers: { "x-api-key": "f".repeat(64) } });
    assert.equal(jwt.statusCode, jwtOk ? 200 : 401, `${mode}: jwt`);
    assert.equal(session.statusCode, sessionOk ? 200 : 401, `${mode}: sessão`);
    // key mestre segue valendo em qualquer modo (MCP/integrações)
    assert.equal((await app.inject({ method: "GET", url: "/api/leads", headers: { "x-api-key": "test-key" } })).statusCode, 200, `${mode}: key`);
  }
});

test("telas e papel vêm do cockpit, não do token", async (t) => {
  const key = makeKey();
  const { app, repo } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const sub = randomUUID();
  await repo.create("users", { id: "sdr", name: "SDR", role: "admin", roles: ["sdr"], screens: ["pipeline"], authUserId: sub, passwordHash: hashPassword("x".repeat(8)) });
  const H = bearer(es256(key, staffClaims(sub, { staff_roles: ["admin"] })));
  assert.equal((await app.inject({ method: "GET", url: "/api/customers", headers: H })).statusCode, 403, "tela fora da lista");
  // staff_roles admin no token não dá a etiqueta admin do cockpit
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/users", headers: H, payload: { name: "Novo", password: "abcd1234" } })).statusCode, 403);
  // a senha de conta da identidade não se troca aqui
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/password", headers: H, payload: { current: "x", password: "abcd1234" } })).statusCode, 409);
});

test("desligar o vínculo corta o acesso na próxima requisição", async (t) => {
  const key = makeKey();
  const { app } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const H = bearer(es256(key, staffClaims(ERYK_SUB)));
  assert.equal((await app.inject({ method: "GET", url: "/api/leads", headers: H })).statusCode, 200);
  const unlink = await app.inject({ method: "PATCH", url: "/api/auth/users/eryk", headers: { "x-api-key": "test-key" }, payload: { authUserId: "" } });
  assert.equal(unlink.statusCode, 200, unlink.body);
  assert.equal((await app.inject({ method: "GET", url: "/api/leads", headers: H })).statusCode, 401);
});

test("vínculo authUserId: UUID válido e único", async (t) => {
  const key = makeKey();
  const { app } = await buildApp({ keys: [key] });
  t.after(() => app.close());
  const K = { "x-api-key": "test-key" };
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/leonardo", headers: K, payload: { authUserId: "nao-e-uuid" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/leonardo", headers: K, payload: { authUserId: ERYK_SUB } })).statusCode, 409);
  const ok = await app.inject({ method: "PATCH", url: "/api/auth/users/leonardo", headers: K, payload: { authUserId: " 0A0A0A0A-0000-4000-8000-000000000002 " } });
  assert.equal(ok.json().authUserId, "0a0a0a0a-0000-4000-8000-000000000002");
});

test("JWKS: cache, rotação de chave e sem enxurrada de fetch por kid desconhecido", async () => {
  const k1 = makeKey();
  const k2 = makeKey();
  const state = fakeJwks([k1]);
  let clock = Date.now();
  const jwks = makeJwksCache({ url: "http://identity/jwks", fetchImpl: state.fetchImpl, now: () => clock });
  assert.ok(await jwks.get(k1.kid));
  assert.ok(await jwks.get(k1.kid));
  assert.equal(state.calls, 1, "cache");
  // kid desconhecido logo em seguida: não busca de novo (anti-enxurrada)
  assert.equal(await jwks.get("forjado"), null);
  assert.equal(state.calls, 1);
  // chave nova publicada: depois do intervalo mínimo, o kid novo dispara a busca
  state.keys = [k1, k2];
  clock += 31_000;
  assert.ok(await jwks.get(k2.kid));
  assert.equal(state.calls, 2);
});
