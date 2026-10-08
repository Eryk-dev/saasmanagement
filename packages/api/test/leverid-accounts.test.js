// Badge de LeverId na tela Clientes: quem do cliente já tem conta na
// identidade central (GET /api/customers/leverid).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { parseOrgIds, groupOrgAccounts, makeLeverIdAccounts, customerOrgId } from "../src/customers/leverid-accounts.js";

const { registerRoutes } = await import("../src/routes.js");

const ORG = "b1111111-1111-4111-8111-111111111111";
const VAZIA = "b2222222-2222-4222-8222-222222222222";
const ROWS = [
  { org_id: ORG, org_name: "Loja Teste", org_status: "active", user_id: "a1", email: "dona@loja.test", role: "owner",
    created_at: "2026-10-08T19:00:00Z", last_sign_in_at: null, email_confirmed: true, mfa: true, source: "leverads" },
  { org_id: ORG, org_name: "Loja Teste", org_status: "active", user_id: "a2", email: "op@loja.test", role: "member",
    created_at: "2026-10-08T19:00:00Z", last_sign_in_at: null, email_confirmed: true, mfa: false, source: "leverads" },
  { org_id: VAZIA, org_name: "Org Vazia", org_status: "suspended", user_id: null },
];

function fakeIdentity(rows = ROWS) {
  const calls = [];
  return {
    calls, fail: false,
    async orgAccounts(ids) {
      calls.push(ids);
      if (this.fail) throw new Error("fora do ar");
      return rows.filter((r) => ids.includes(r.org_id));
    },
  };
}

test("parseOrgIds: só uuid, sem repetição, em minúsculas", () => {
  assert.deepEqual(parseOrgIds(` ${ORG.toUpperCase()},lixo,,${ORG}, ${VAZIA}`), [ORG, VAZIA]);
  assert.deepEqual(parseOrgIds(undefined), []);
});

test("customerOrgId: orgId do LeverId vale antes do leveradsOrgId", () => {
  assert.equal(customerOrgId({ orgId: VAZIA, leveradsOrgId: ORG }), VAZIA);
  assert.equal(customerOrgId({ leveradsOrgId: ` ${ORG.toUpperCase()} ` }), ORG);
  assert.equal(customerOrgId({}), "");
});

test("groupOrgAccounts: contas por org; org sem conta fica com lista vazia", () => {
  const g = groupOrgAccounts(ROWS);
  assert.deepEqual(g[ORG].accounts.map((a) => [a.email, a.role, a.mfa]), [["dona@loja.test", "owner", true], ["op@loja.test", "member", false]]);
  assert.deepEqual(g[VAZIA], { name: "Org Vazia", status: "suspended", accounts: [] });
});

test("cache: pede à identidade só as orgs que faltam e renova depois do TTL", async () => {
  let t = 0;
  const identity = fakeIdentity();
  const accounts = makeLeverIdAccounts({ identity, ttl: 1000, now: () => t });
  assert.deepEqual(Object.keys(await accounts.forOrgs([ORG])), [ORG]);
  await accounts.forOrgs([ORG, VAZIA]);
  assert.deepEqual(identity.calls, [[ORG], [VAZIA]]);
  t = 1500;
  await accounts.forOrgs([ORG, VAZIA]);
  assert.deepEqual(identity.calls.at(-1), [ORG, VAZIA]);
});

async function buildApp(identity = fakeIdentity()) {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", { id: "sdr", name: "SDR", role: "sdr", roles: ["sdr"], screens: ["pipeline"], passwordHash: hashPassword("senha-do-sdr") });
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
const get = (app, orgs, headers = K) => app.inject({ method: "GET", url: `/api/customers/leverid?orgs=${orgs}`, headers });

test("rota: devolve as contas por org e ignora org que não está no LeverId", async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const res = await get(app, `${ORG},c9999999-9999-4999-8999-999999999999`);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.configured, true);
  assert.deepEqual(Object.keys(body.orgs), [ORG]);
  assert.equal(body.orgs[ORG].accounts.length, 2);
  assert.ok(!JSON.stringify(body).includes("hash"), "nada de hash na resposta");
});

test("rota: sem identidade configurada responde configured=false", async (t) => {
  const { app } = await buildApp(null);
  t.after(() => app.close());
  const res = await get(app, ORG);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { configured: false, orgs: {} });
});

test("rota: identidade fora do ar vira 424 com o motivo", async (t) => {
  const identity = fakeIdentity();
  identity.fail = true;
  const { app } = await buildApp(identity);
  t.after(() => app.close());
  const res = await get(app, ORG);
  assert.equal(res.statusCode, 424);
  assert.equal(res.json().code, "leverid_unavailable");
});

test("rota: sem a tela Clientes não alcança", async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "sdr", password: "senha-do-sdr" } });
  assert.equal(login.statusCode, 200, login.body);
  const res = await get(app, ORG, { "x-api-key": login.json().token });
  assert.equal(res.statusCode, 403);
});
