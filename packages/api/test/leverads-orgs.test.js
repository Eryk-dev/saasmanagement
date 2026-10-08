// Espelho das orgs do LeverAds e o vínculo cliente × org (aba Gratuitas,
// vínculo na ficha e o automático pelo e-mail).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { planEmailLinks, runLeveradsOrgMirror, ORGS } from "../src/customers/leverads-orgs.js";

const { registerRoutes } = await import("../src/routes.js");

const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const C = "c0000000-0000-4000-8000-000000000003";
const org = (id, email, extra = {}) => ({ id, name: `Org ${id[0]}`, email, active: true, payment_active: false, created_at: "2026-10-08T12:00:00Z", ...extra });
const cust = (id, email, extra = {}) => ({ id, name: `Cliente ${id}`, saas: "leverads", email, ...extra });

test("planEmailLinks: liga o par 1 × 1 pelo e-mail do cliente ou do lead", () => {
  const links = planEmailLinks({
    orgs: [{ id: A, email: "dona@a.test" }, { id: B, email: "outra@b.test", members: ["compras@cli2.test"] }],
    customers: [cust("c1", "Dona@A.test"), cust("c2", "", { leadId: "l2" })],
    leads: [{ id: "l2", email: "compras@cli2.test" }],
  });
  assert.deepEqual(links.map((l) => [l.customerId, l.orgId, l.email]), [["c1", A, "dona@a.test"], ["c2", B, "compras@cli2.test"]]);
});

test("planEmailLinks: qualquer dúvida não grava", () => {
  const orgs = [{ id: A, email: "x@a.test" }, { id: B, email: "x@a.test" }, { id: C, email: "y@c.test" }];
  const links = planEmailLinks({
    orgs,
    customers: [
      cust("dois-orgs", "x@a.test"), // casa com A e B
      cust("y1", "y@c.test"), cust("y2", "y@c.test"), // C casa com dois clientes
      cust("encerrado", "z@a.test", { endedAt: "2026-01-01T00:00:00Z" }),
      cust("outro-produto", "x@a.test", { saas: "leverprice" }),
    ],
    leads: [],
  });
  assert.deepEqual(links, []);
});

test("planEmailLinks: respeita org recusada e org já vinculada", () => {
  const orgs = [{ id: A, email: "dona@a.test" }, { id: B, email: "dona@b.test" }];
  const customers = [
    cust("c1", "dona@a.test", { orgLinkRejected: [A] }),
    cust("c2", "dona@b.test"),
    cust("c3", "", { leveradsOrgId: B }),
  ];
  assert.deepEqual(planEmailLinks({ orgs, customers, leads: [] }), []);
});

test("runLeveradsOrgMirror: espelha, vincula pelo e-mail e conta gratuitas e pagantes sem cliente", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", cust("c1", "dona@a.test"));
  const client = { configured: () => true, listOrgs: async () => [org(A, "Dona@A.test"), org(B, "b@b.test"), org(C, "c@c.test", { payment_active: true })] };
  const identity = { orgAccounts: async (ids) => (ids.includes(B) ? [{ org_id: B, user_id: "u", email: "Membro@B.test" }] : []) };
  const report = await runLeveradsOrgMirror(repo, { client, identity, now: () => new Date("2026-10-08T15:00:00Z") });
  assert.deepEqual({ orgs: report.orgs, linked: report.linked, free: report.free, paying: report.payingWithoutCustomer, auto: report.autoLinked },
    { orgs: 3, linked: 1, free: 1, paying: 1, auto: 1 });
  const c1 = await repo.get("customers", "c1");
  assert.equal(c1.leveradsOrgId, A);
  assert.equal(c1.orgLink.via, "email");
  assert.equal((await repo.get(ORGS, A)).customerId, "c1");
  assert.deepEqual((await repo.get(ORGS, B)).members, ["membro@b.test"]);

  // Org que sumiu do LeverAds fica marcada; a primeira vez vista não muda.
  const first = (await repo.get(ORGS, B)).firstSeenAt;
  client.listOrgs = async () => [org(A, "dona@a.test"), org(B, "b@b.test")];
  await runLeveradsOrgMirror(repo, { client, now: () => new Date("2026-10-08T16:00:00Z") });
  assert.equal((await repo.get(ORGS, C)).gone, true);
  assert.equal((await repo.get(ORGS, B)).firstSeenAt, first);
});

async function buildApp({ client } = {}) {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", { id: "sdr", name: "SDR", role: "sdr", roles: ["sdr"], screens: ["pipeline"], passwordHash: hashPassword("senha-do-sdr") });
  await repo.create("customers", cust("c1", "dona@a.test"));
  await repo.create("customers", cust("c2", "outra@cli.test"));
  const cli = client || { configured: () => true, listOrgs: async () => [org(A, "dona@a.test"), org(B, "novo@b.test")] };
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, { identity: null, leveradsOrgs: { client: cli } });
  return { app, repo };
}
const K = { "x-api-key": "test-key" };

test("rotas: atualizar, vincular na mão, conflito e desfazer sem religar", async (t) => {
  const { app, repo } = await buildApp();
  t.after(() => app.close());
  const refresh = await app.inject({ method: "POST", url: "/api/customers/leverads-orgs/refresh", headers: K });
  assert.equal(refresh.statusCode, 200, refresh.body);
  assert.deepEqual(refresh.json().orgs.map((o) => [o.id, o.customerId]).sort(), [[A, "c1"], [B, ""]]);

  const link = await app.inject({ method: "POST", url: "/api/customers/c2/leverads-org", headers: K, payload: { orgId: B.toUpperCase() } });
  assert.equal(link.statusCode, 200, link.body);
  assert.equal(link.json().leveradsOrgId, B);
  assert.equal(link.json().orgLink.via, "manual");
  assert.equal((await repo.get(ORGS, B)).customerId, "c2");

  const taken = await app.inject({ method: "POST", url: "/api/customers/c2/leverads-org", headers: K, payload: { orgId: A } });
  assert.equal(taken.statusCode, 409);

  const unlink = await app.inject({ method: "DELETE", url: "/api/customers/c1/leverads-org", headers: K });
  assert.equal(unlink.statusCode, 200);
  assert.equal(unlink.json().leveradsOrgId, "");
  await app.inject({ method: "POST", url: "/api/customers/leverads-orgs/refresh", headers: K });
  assert.equal((await repo.get("customers", "c1")).leveradsOrgId, "", "o automático não religa a org desfeita");
  assert.equal((await repo.get(ORGS, A)).customerId, "");
});

test("rotas: org fora do espelho é 404 e sem a tela Clientes não alcança", async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const missing = await app.inject({ method: "POST", url: "/api/customers/c2/leverads-org", headers: K, payload: { orgId: C } });
  assert.equal(missing.statusCode, 404);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "sdr", password: "senha-do-sdr" } });
  const res = await app.inject({ method: "GET", url: "/api/customers/leverads-orgs", headers: { "x-api-key": login.json().token } });
  assert.equal(res.statusCode, 403);
});

test("rotas: espelho sem credencial responde 424 no atualizar", async (t) => {
  const { app } = await buildApp({ client: { configured: () => false, listOrgs: async () => [] } });
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/api/customers/leverads-orgs/refresh", headers: K });
  assert.equal(res.statusCode, 424);
  const list = await app.inject({ method: "GET", url: "/api/customers/leverads-orgs", headers: K });
  assert.equal(list.json().configured, false);
});
