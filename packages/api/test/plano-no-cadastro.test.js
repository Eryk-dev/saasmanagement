// Plano da venda chegando sozinho na conta criada no LeverAds:
//   · a ficha gera o link de cadastro com convite (vínculo exato, mesmo com
//     outro e-mail);
//   · o cadastro do LeverAds avisa (POST /public/leverads/org-created) e o
//     espelho vincula pelo convite;
//   · o sync de acesso GRAVA o plano (rota de serviço de entitlements) só com
//     apply + LEVERADS_LIMITS_APPLY — sem isso segue relatório.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { runLeveradsAccessSync, makeLeveradsClient } from "../src/billing/leverads-access.js";
import {
  ensureSignupInvite, handleOrgCreated, planInviteLinks, runLeveradsOrgMirror, serviceKeyOk, signupUrl,
} from "../src/customers/leverads-orgs.js";
import { registerLeveradsOrgRoutes } from "../src/customers/routes.leverads-orgs.js";

const ORG = "a0000000-0000-4000-8000-000000000001";
const OUTRA = "b0000000-0000-4000-8000-000000000002";
const SNAP = { code: "ads_essencial_oem", name: "Essencial + OEM", accessProduct: "leverads",
  limits: { accounts: 7, copiesPerDay: 500, oemPerMonth: 200 }, features: { stockMirror: true, compat: false } };

// Cliente falso da rota de serviço: orgs em memória + trilha de escritas.
function serviceClient(orgs) {
  const writes = [];
  return {
    writes,
    mode: "service",
    configured: () => true,
    listOrgs: async () => orgs.map((o) => ({ ...o })),
    updateOrg: async (id, patch) => { Object.assign(orgs.find((o) => o.id === id), patch); writes.push({ id, payment: patch }); },
    applyEntitlements: async (id, body) => {
      const org = orgs.find((o) => o.id === id);
      Object.assign(org, body.fields, {
        payment_active: body.payment_active, cockpit_customer_id: body.customer_id,
        cockpit_plan_code: body.plan_code, cockpit_plan_name: body.plan_name,
      });
      writes.push({ id, entitlements: body });
      return { id, changed: {} };
    },
  };
}

// Org recém-criada no cadastro sales-led: bloqueada, com os padrões do signup.
const novaOrg = (extra = {}) => ({
  id: ORG, name: "Loja Nova", email: "outro@loja.test", active: true, payment_active: false, plan_id: null,
  paid_seats: 5, per_seller_daily_limit: null, unlimited_quota: false, creator_quota_limit: 10, creator_quota_period: "year",
  creator_enabled: true, stock_mirror_enabled: false, compat_enabled: false, cockpit_customer_id: null, cockpit_plan_code: null,
  ...extra,
});

async function vendido(repo, extra = {}) {
  const c = await repo.create("customers", { name: "Cliente", saas: "leverads", email: "compras@cliente.test", leveradsOrgId: ORG, ...extra });
  await repo.create("subscriptions", { status: "active", cycle: "monthly", price: 500, customer: c.id, saas: "leverads",
    planCode: SNAP.code, planSnapshot: SNAP });
  return c;
}

test("sync com apply + applyLimits grava o plano e o payment_active numa escrita só, e fica idempotente", async () => {
  const repo = makeMemRepo();
  const c = await vendido(repo);
  const orgs = [novaOrg()];
  const client = serviceClient(orgs);

  const report = await runLeveradsAccessSync(repo, { client, apply: true, applyLimits: true });
  assert.equal(report.limits.mode, "apply");
  assert.equal(report.limits.applied, 1);
  assert.equal(client.writes.length, 1, "o plano leva o payment_active: nada de PUT de pagamento à parte");
  const [{ entitlements: body }] = client.writes;
  assert.deepEqual(body, {
    product: "leverads", customer_id: c.id, plan_code: "ads_essencial_oem", plan_name: "Essencial + OEM", payment_active: true,
    fields: { paid_seats: 7, per_seller_daily_limit: 500, creator_quota_limit: 200, creator_quota_period: "month",
      stock_mirror_enabled: true, compat_enabled: false, creator_enabled: true },
  });
  assert.equal(orgs[0].payment_active, true);

  const again = await runLeveradsAccessSync(repo, { client, apply: true, applyLimits: true });
  assert.equal(again.limits.applied, 0);
  assert.equal(client.writes.length, 1, "org já no plano e com a origem gravada: não reescreve");
});

test("sem applyLimits (ou sem apply) o plano segue só relatório", async () => {
  const repo = makeMemRepo();
  await vendido(repo);
  const client = serviceClient([novaOrg()]);

  const soPagamento = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(soPagamento.limits.mode, "report");
  assert.equal(soPagamento.limits.planned.length, 1);
  assert.deepEqual(client.writes.map((w) => Object.keys(w)), [["id", "payment"]], "só o payment_active");

  const dry = await runLeveradsAccessSync(repo, { client: serviceClient([novaOrg()]), applyLimits: true });
  assert.equal(dry.limits.mode, "report");
});

test("login de super admin (sem applyEntitlements) nunca grava limite", async () => {
  const repo = makeMemRepo();
  await vendido(repo);
  const client = serviceClient([novaOrg()]);
  delete client.applyEntitlements;
  const report = await runLeveradsAccessSync(repo, { client, apply: true, applyLimits: true });
  assert.equal(report.limits.mode, "report");
  assert.ok(client.writes.every((w) => !w.entitlements));
});

test("org self-service e venda personalizada ficam fora da escrita", async () => {
  const repo = makeMemRepo();
  await vendido(repo);
  const selfService = serviceClient([novaOrg({ plan_id: "plano-mensal" })]);
  const r1 = await runLeveradsAccessSync(repo, { client: selfService, apply: true, applyLimits: true });
  assert.equal(r1.limits.applied, 0);
  assert.match(r1.limits.skipped[0].reason, /self-service/);

  const repo2 = makeMemRepo();
  const c = await repo2.create("customers", { name: "Custom", saas: "leverads", leveradsOrgId: ORG, planCustom: "acerto à mão" });
  await repo2.create("subscriptions", { status: "active", cycle: "monthly", price: 900, customer: c.id, saas: "leverads" });
  const custom = serviceClient([novaOrg()]);
  const r2 = await runLeveradsAccessSync(repo2, { client: custom, apply: true, applyLimits: true });
  assert.equal(r2.limits.applied, 0);
  assert.deepEqual(custom.writes.map((w) => Object.keys(w)), [["id", "payment"]], "libera o acesso, limites ficam manuais");
});

test("falha da rota de entitlements vira erro no relatório e o paywall ainda é liberado", async () => {
  const repo = makeMemRepo();
  await vendido(repo);
  const client = serviceClient([novaOrg()]);
  client.applyEntitlements = async () => { throw new Error("PUT → HTTP 404"); };
  const report = await runLeveradsAccessSync(repo, { client, apply: true, applyLimits: true });
  assert.equal(report.limits.errors.length, 1);
  assert.deepEqual(client.writes, [{ id: ORG, payment: { payment_active: true } }]);
});

test("makeLeveradsClient com chave: applyEntitlements vai na rota de serviço com a chave", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ changed: {} }) }; };
  const cli = makeLeveradsClient({ baseUrl: "https://ads.test/", serviceKey: "k", fetchImpl });
  await cli.applyEntitlements(ORG, { product: "leverads" });
  assert.equal(calls[0].url, `https://ads.test/api/service/cockpit/orgs/${ORG}/entitlements`);
  assert.equal(calls[0].opts.method, "PUT");
  assert.equal(calls[0].opts.headers["X-Cockpit-Service-Key"], "k");
});

// ── Convite ──────────────────────────────────────────────────────────────────

test("ensureSignupInvite: cria uma vez, reaproveita e troca com rotate", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Cliente", saas: "leverads" });
  const a = await ensureSignupInvite(repo, c);
  assert.match(a.token, /^cvt_[A-Za-z0-9_-]{24}$/);
  assert.equal(a.url, `https://leverads.com.br/signup?convite=${a.token}`);
  const b = await ensureSignupInvite(repo, await repo.get("customers", c.id));
  assert.equal(b.token, a.token);
  const r = await ensureSignupInvite(repo, await repo.get("customers", c.id), { rotate: true });
  assert.notEqual(r.token, a.token);
  assert.equal(signupUrl("cvt_x", { LEVERADS_APP_URL: "http://localhost:5173/" }), "http://localhost:5173/signup?convite=cvt_x");
});

test("planInviteLinks: o convite liga mesmo com e-mail diferente; dúvida, recusa ou vínculo prévio não ligam", () => {
  const cust = (id, token, extra = {}) => ({ id, saas: "leverads", email: `${id}@x.test`, signupInvite: { token }, ...extra });
  const links = planInviteLinks({
    orgs: [{ id: ORG, invite: "cvt_um", email: "outro@y.test" }, { id: OUTRA, invite: "cvt_dois" }],
    customers: [cust("c1", "cvt_um"), cust("c2", "cvt_dois"), cust("c3", "cvt_dois")],
  });
  assert.deepEqual(links, [{ customerId: "c1", orgId: ORG }], "cvt_dois está em dois clientes: não liga");

  assert.deepEqual(planInviteLinks({
    orgs: [{ id: ORG, invite: "cvt_um" }],
    customers: [cust("c1", "cvt_um", { orgLinkRejected: [ORG] })],
  }), []);
  assert.deepEqual(planInviteLinks({
    orgs: [{ id: ORG, invite: "cvt_um" }],
    customers: [cust("c1", "cvt_um", { leveradsOrgId: OUTRA })],
  }), []);
});

test("espelho: org com convite vincula ao cliente da venda (via convite) antes do e-mail", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Cliente", saas: "leverads", email: "compras@cliente.test", signupInvite: { token: "cvt_abcdefghijklmnop" } });
  const client = { configured: () => true, listOrgs: async () => [{ ...novaOrg(), cockpit_invite: "cvt_abcdefghijklmnop" }] };
  const report = await runLeveradsOrgMirror(repo, { client, now: () => new Date("2026-10-19T15:00:00Z") });
  assert.equal(report.inviteLinked, 1);
  const saved = await repo.get("customers", c.id);
  assert.equal(saved.leveradsOrgId, ORG);
  assert.equal(saved.orgLink.via, "convite");
});

test("handleOrgCreated: vincula e roda o sync na hora; sem cliente não sincroniza", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { name: "Cliente", saas: "leverads", signupInvite: { token: "cvt_abcdefghijklmnop" } });
  const client = { configured: () => true, listOrgs: async () => [{ ...novaOrg(), cockpit_invite: "cvt_abcdefghijklmnop" }] };
  const mirror = { run: () => runLeveradsOrgMirror(repo, { client }) };
  const syncs = [];
  const syncAccess = async () => { syncs.push(1); return { mode: "apply", limits: { mode: "apply" } }; };

  const r = await handleOrgCreated(repo, mirror, { orgId: ORG.toUpperCase(), syncAccess });
  assert.equal(r.linked, true);
  assert.equal(syncs.length, 1);

  const sem = await handleOrgCreated(repo, mirror, { orgId: OUTRA, syncAccess });
  assert.equal(sem.linked, false);
  assert.equal(syncs.length, 1);
});

test("POST /public/leverads/org-created: exige a chave de serviço e responde 202 sem esperar", async () => {
  const old = process.env.LEVERADS_SERVICE_KEY;
  process.env.LEVERADS_SERVICE_KEY = "chave-de-teste";
  try {
    const repo = makeMemRepo();
    const runs = [];
    const mirror = { configured: () => true, last: () => null, run: async () => { runs.push(1); return {}; } };
    const app = Fastify();
    registerLeveradsOrgRoutes(app, repo, { mirror });
    const post = (headers, payload) => app.inject({ method: "POST", url: "/public/leverads/org-created", headers, payload });

    assert.equal((await post({}, { org_id: ORG })).statusCode, 401);
    assert.equal((await post({ "x-cockpit-service-key": "errada" }, { org_id: ORG })).statusCode, 401);
    assert.equal((await post({ "x-cockpit-service-key": "chave-de-teste" }, { org_id: "nao-e-uuid" })).statusCode, 400);
    assert.equal(runs.length, 0);
    const ok = await post({ "x-cockpit-service-key": "chave-de-teste" }, { org_id: ORG, convite: "cvt_x" });
    assert.equal(ok.statusCode, 202);
    await new Promise((r) => setImmediate(r));
    assert.equal(runs.length, 1);
  } finally {
    if (old === undefined) delete process.env.LEVERADS_SERVICE_KEY; else process.env.LEVERADS_SERVICE_KEY = old;
  }
});

test("serviceKeyOk: sem chave configurada ninguém passa", () => {
  assert.equal(serviceKeyOk("x", {}), false);
  assert.equal(serviceKeyOk("", { LEVERADS_SERVICE_KEY: "k" }), false);
  assert.equal(serviceKeyOk("k", { LEVERADS_SERVICE_KEY: "k" }), true);
  assert.equal(serviceKeyOk("kk", { LEVERADS_SERVICE_KEY: "k" }), false);
});

test("POST /api/customers/:id/leverads-invite: devolve o link e 404 para cliente que não existe", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Cliente", saas: "leverads" });
  const app = Fastify();
  registerLeveradsOrgRoutes(app, repo, { mirror: { configured: () => true, last: () => null, run: async () => ({}) } });
  const res = await app.inject({ method: "POST", url: `/api/customers/${c.id}/leverads-invite`, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().url, /\/signup\?convite=cvt_/);
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/nao-existe/leverads-invite", payload: {} })).statusCode, 404);
});

// ── Nome da empresa pela conta do LeverAds (22/10/2026) ─────────────────────
// Caso real: cliente "Luciana" (contato Luciana) se cadastrou como "Via
// Original" e a busca do cockpit só achava "Luciana".

test("convite: cliente com o nome da pessoa vira o nome da empresa da conta; a pessoa fica no contato e o lead ganha a empresa", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", name: "Luciana Prado", email: "lu@gmail.test", saas: "leverads" });
  const c = await repo.create("customers", { name: "Luciana", contact: "Luciana", saas: "leverads", leadId: "l1", signupInvite: { token: "cvt_abcdefghijklmnop" } });
  const client = { configured: () => true, listOrgs: async () => [{ ...novaOrg({ name: "Via Original" }), cockpit_invite: "cvt_abcdefghijklmnop" }] };
  const report = await runLeveradsOrgMirror(repo, { client, now: () => new Date("2026-10-22T15:00:00Z") });
  assert.equal(report.renamed, 1);
  const saved = await repo.get("customers", c.id);
  assert.equal(saved.name, "Via Original");
  assert.equal(saved.contact, "Luciana");
  assert.equal(saved.leveradsOrgName, "Via Original");
  assert.deepEqual(saved.nameFrom, { via: "leverads_org", previous: "Luciana", at: "2026-10-22T15:00:00.000Z" });
  assert.equal((await repo.get("leads", "l1")).company, "Via Original");
  // Segunda passada não mexe de novo.
  assert.equal((await runLeveradsOrgMirror(repo, { client })).renamed, 0);
});

test("nome de empresa dado à mão fica; a conta só entra no leveradsOrgName (a busca acha pelos dois)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", name: "Luciana", company: "Via Original Ltda", saas: "leverads" });
  const c = await repo.create("customers", { name: "Via Original Ltda", contact: "Luciana", saas: "leverads", leadId: "l1", leveradsOrgId: ORG });
  const client = { configured: () => true, listOrgs: async () => [novaOrg({ name: "Via Original" })] };
  await runLeveradsOrgMirror(repo, { client });
  const saved = await repo.get("customers", c.id);
  assert.equal(saved.name, "Via Original Ltda");
  assert.equal(saved.leveradsOrgName, "Via Original");
  assert.equal((await repo.get("leads", "l1")).company, "Via Original Ltda", "empresa do lead já preenchida não muda");
});

test("empresa renomeada no LeverAds: o nome que veio da conta acompanha; conta com o nome da própria pessoa não renomeia", async () => {
  const repo = makeMemRepo();
  const orgs = [novaOrg({ name: "Via Original" })];
  const client = { configured: () => true, listOrgs: async () => orgs.map((o) => ({ ...o })) };
  const c = await repo.create("customers", { name: "Luciana", contact: "Luciana", saas: "leverads", leveradsOrgId: ORG });
  await runLeveradsOrgMirror(repo, { client });
  orgs[0].name = "Via Original Calçados";
  await runLeveradsOrgMirror(repo, { client });
  assert.equal((await repo.get("customers", c.id)).name, "Via Original Calçados");

  const p = await repo.create("customers", { name: "Marcos", contact: "Marcos Lima", saas: "leverads", leveradsOrgId: OUTRA });
  const own = { configured: () => true, listOrgs: async () => [...orgs, novaOrg({ id: OUTRA, name: "Marcos", email: "m@x.test" })] };
  await runLeveradsOrgMirror(repo, { client: own });
  const saved = await repo.get("customers", p.id);
  assert.equal(saved.name, "Marcos");
  assert.equal(saved.nameFrom, undefined);
});

test("vínculo manual na ficha também troca o nome da pessoa pelo da empresa", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Luciana", contact: "Luciana", saas: "leverads" });
  await repo.create("leverads_orgs", { id: ORG, name: "Via Original", email: "x@y.test", active: true, members: [] });
  const app = Fastify();
  registerLeveradsOrgRoutes(app, repo, { mirror: { configured: () => true, run: async () => ({}), last: () => null } });
  const r = await app.inject({ method: "POST", url: `/api/customers/${c.id}/leverads-org`, payload: { orgId: ORG } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().name, "Via Original", "a resposta já traz o nome novo pra ficha");
  assert.equal((await repo.get("customers", c.id)).leveradsOrgName, "Via Original");
  await app.close();
});
