// Entitlements: o direito do cliente em cada produto sai do billing + do retrato
// do plano contratado. O adaptador do LeverAds segue escrevendo SÓ o
// payment_active; a diferença de limites é relatório, nunca escrita.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { desiredEntitlements, leveradsLimitFields, limitsDiff, orgRefOf, plansByCodeOf } from "../src/billing/entitlements.js";
import { runLeveradsAccessSync, registerLeveradsAccessRoutes } from "../src/billing/leverads-access.js";

const SNAP = (over = {}) => ({
  code: "oem_escala", name: "Ads Escala + OEM", cycle: "annual", closedPlan: "anual",
  limits: { accounts: 7, oemPerMonth: null }, accessProduct: "leverads", ...over,
});
const PLANS = plansByCodeOf([
  { saas: "leverads", code: "ads_escala", name: "Ads Escala", access: { product: "leverads" }, features: { equalizacao: true } },
  { saas: "leverads", code: "men_curso", name: "Mentoria · Curso", access: { product: "" } },
]);

function fakeClient(orgs) {
  const updates = [];
  return {
    updates,
    configured: () => true,
    listOrgs: async () => orgs.map((o) => ({ ...o })),
    updateOrg: async (id, patch) => { Object.assign(orgs.find((o) => String(o.id) === String(id)), patch); updates.push({ id, ...patch }); },
  };
}

test("desiredEntitlements: acesso pelo status da assinatura, limites do retrato da venda", () => {
  const customer = { id: "c1", saas: "leverads" };
  assert.equal(desiredEntitlements(customer, [], PLANS), null, "sem assinatura não mexe");

  const [ent] = desiredEntitlements(customer, [{ id: "s1", status: "active", planCode: "oem_escala", planSnapshot: SNAP() }], PLANS);
  assert.deepEqual(ent, {
    product: "leverads", access: { active: true, kind: "paid", reason: "assinatura em dia" },
    planCode: "oem_escala", planName: "Ads Escala + OEM", limits: { accounts: 7, oemPerMonth: null },
    features: {}, ref: "s1", source: "plan",
  });

  const [late] = desiredEntitlements(customer, [{ id: "s1", status: "past_due", planCode: "oem_escala", planSnapshot: SNAP() }], PLANS);
  assert.equal(late.access.active, false);
  assert.deepEqual(late.limits, { accounts: 7, oemPerMonth: null }, "inadimplente corta o acesso, não o plano");

  const [ended] = desiredEntitlements({ ...customer, endedAt: "2026-09-01" }, [{ id: "s1", status: "active", planSnapshot: SNAP() }], PLANS);
  assert.equal(ended.access.active, false);
});

test("desiredEntitlements: o retrato do cliente vale quando a assinatura não tem; Price vai pro produto leverprice", () => {
  const customer = { id: "c1", saas: "leverads", planCode: "price_escala", planSnapshot: SNAP({ code: "price_escala", name: "Lever Price · Escala", limits: { listings: 10000 }, accessProduct: "leverprice" }) };
  const [ent] = desiredEntitlements(customer, [{ id: "s1", status: "active" }], PLANS);
  assert.equal(ent.product, "leverprice");
  assert.deepEqual(ent.limits, { listings: 10000 });
  assert.deepEqual(leveradsLimitFields(ent), { leverprice_enabled: true });
});

test("desiredEntitlements: personalizado e sem plano ficam sem limites; compra única não dá acesso a produto", () => {
  const subs = [{ id: "s1", status: "active" }];
  const [custom] = desiredEntitlements({ id: "c1", saas: "leverads", planCustom: "Combo" }, subs, PLANS, { defaultProduct: "leverads" });
  assert.equal(custom.source, "custom");
  assert.equal(custom.limits, null);
  assert.equal(custom.product, "leverads");
  const [unknown] = desiredEntitlements({ id: "c2", saas: "leverads" }, subs, PLANS, { defaultProduct: "leverads" });
  assert.equal(unknown.source, "unknown");
  assert.deepEqual(desiredEntitlements({ id: "c3", saas: "leverads", planCode: "men_curso" }, subs, PLANS, { defaultProduct: "leverads" }), []);
  // Módulos vêm do plano vivo (o retrato só guarda limites).
  const [ads] = desiredEntitlements({ id: "c4", saas: "leverads", planCode: "ads_escala" }, [{ id: "s1", status: "active", planCode: "ads_escala", planSnapshot: SNAP({ code: "ads_escala", limits: { accounts: 7 } }) }], PLANS);
  assert.deepEqual(ads.features, { equalizacao: true });
});

test("de-para pros campos do LeverAds e diferença contra a org", () => {
  const escala = { product: "leverads", limits: { accounts: 7, oemPerMonth: null } };
  assert.deepEqual(leveradsLimitFields(escala), { paid_seats: 7, creator_enabled: true, creator_quota_limit: null, creator_quota_period: "month" });
  assert.deepEqual(leveradsLimitFields({ product: "leverads", limits: { accounts: 3, oemPerMonth: 200 } }),
    { paid_seats: 3, creator_enabled: true, creator_quota_limit: 200, creator_quota_period: "month" });
  assert.deepEqual(leveradsLimitFields({ product: "leverads", limits: { accounts: 3 } }), { paid_seats: 3 }, "Ads não mexe na cota de OEM");
  assert.deepEqual(leveradsLimitFields({ product: "leverads", limits: null }), {});

  const { changes, unsupported } = limitsDiff(
    { paid_seats: 3, creator_enabled: 1, creator_quota_limit: 200 },
    leveradsLimitFields(escala),
  );
  assert.deepEqual(changes, { paid_seats: { from: 3, to: 7 }, creator_quota_limit: { from: 200, to: null } });
  assert.deepEqual(unsupported, ["creator_quota_period"], "campo que a listagem não devolve não se compara");
});

test("orgRefOf: vínculo de hoje (leveradsOrgId) e o do LeverId (orgId), com reaproveitamento opcional", () => {
  const c = { leveradsOrgId: "org-1" };
  assert.deepEqual(orgRefOf(c, {}), { leverads: "org-1", leverprice: "", leverid: "" });
  assert.equal(orgRefOf(c, { LEVERID_ORG_FROM_LEVERADS: "1" }).leverid, "org-1");
  assert.equal(orgRefOf({ ...c, orgId: "org-novo" }, { LEVERID_ORG_FROM_LEVERADS: "1" }).leverid, "org-novo");
});

async function seed(repo) {
  // Escala contratado, org ainda com os limites do Essencial.
  await repo.create("customers", { id: "c1", name: "Escala", saas: "leverads", leveradsOrgId: "org-1", planCode: "oem_escala" });
  await repo.create("subscriptions", { id: "s1", status: "active", cycle: "annual", price: 11988, customer: "c1", saas: "leverads", planCode: "oem_escala", planSnapshot: SNAP() });
  // Personalizado: limites manuais.
  await repo.create("customers", { id: "c2", name: "Sob medida", saas: "leverads", leveradsOrgId: "org-2", planCustom: "Combo" });
  await repo.create("subscriptions", { id: "s2", status: "active", cycle: "annual", price: 9000, customer: "c2", saas: "leverads" });
  // Org com assinatura self-service do produto: não se compara.
  await repo.create("customers", { id: "c3", name: "Self-service", saas: "leverads", leveradsOrgId: "org-3", planCode: "oem_escala" });
  await repo.create("subscriptions", { id: "s3", status: "active", cycle: "annual", price: 11988, customer: "c3", saas: "leverads", planSnapshot: SNAP() });
  // Inadimplente: corta o acesso, limites nem entram.
  await repo.create("customers", { id: "c4", name: "Devedor", saas: "leverads", leveradsOrgId: "org-4", planCode: "oem_escala" });
  await repo.create("subscriptions", { id: "s4", status: "past_due", cycle: "annual", price: 11988, customer: "c4", saas: "leverads", planSnapshot: SNAP() });
  return fakeClient([
    { id: "org-1", name: "Org 1", payment_active: true, paid_seats: 3, creator_enabled: true, creator_quota_limit: 200, creator_quota_period: "month", plan_id: null },
    { id: "org-2", name: "Org 2", payment_active: true, paid_seats: 3, plan_id: null },
    { id: "org-3", name: "Org 3", payment_active: true, paid_seats: 2, creator_enabled: false, creator_quota_limit: null, creator_quota_period: "month", plan_id: "plan-anual" },
    { id: "org-4", name: "Org 4", payment_active: true, paid_seats: 3, plan_id: null },
  ]);
}

test("sync: limites saem só como relatório; com apply o único write continua sendo payment_active", async () => {
  const repo = makeMemRepo();
  const client = await seed(repo);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });

  assert.deepEqual(client.updates, [{ id: "org-4", payment_active: false }], "nenhum limite é escrito");
  assert.equal(report.applied, 1);
  assert.equal(report.limits.mode, "report");
  assert.deepEqual(report.limits.planned, [{
    customer: "c1", name: "Escala", org: "org-1", orgName: "Org 1", product: "leverads", plan: "oem_escala",
    changes: { paid_seats: { from: 3, to: 7 }, creator_quota_limit: { from: 200, to: null } },
  }]);
  assert.deepEqual(report.limits.skipped.map((s) => [s.customer, s.reason]), [
    ["c2", "plano personalizado ou não identificado: limites manuais"],
    ["c3", "org com assinatura self-service no produto (plan_id)"],
  ]);
  assert.deepEqual(report.limits.unsupported, []);
});

test("sync: org cuja listagem não traz os campos de limite cai em unsupported, sem erro", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Escala", saas: "leverads", leveradsOrgId: "org-1", planCode: "oem_escala" });
  await repo.create("subscriptions", { id: "s1", status: "active", cycle: "annual", price: 11988, customer: "c1", saas: "leverads", planSnapshot: SNAP() });
  // Rota de serviço (auth novo) devolve só id/nome/ativo/payment_active.
  const client = fakeClient([{ id: "org-1", name: "Org 1", active: true, payment_active: true }]);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(report.errors.length, 0);
  assert.equal(report.inSync, 1);
  assert.deepEqual(report.limits.planned, []);
  assert.deepEqual([...report.limits.unsupported[0].fields].sort(), ["creator_enabled", "creator_quota_limit", "creator_quota_period", "paid_seats"]);
  assert.equal(client.updates.length, 0);
});

test("rotas /api/entitlements: status, run (alias) e o direito de um cliente", async (t) => {
  const repo = makeMemRepo();
  const client = await seed(repo);
  const app = Fastify();
  t.after(() => app.close());
  registerLeveradsAccessRoutes(app, repo, { client });

  const before = (await app.inject({ url: "/api/entitlements/customers/c1" })).json();
  assert.equal(before.lastReport, null);
  assert.deepEqual(before.orgs, { leverads: "org-1", leverprice: "", leverid: "" });
  assert.equal(before.entitlements[0].planCode, "oem_escala");
  assert.deepEqual(before.entitlements[0].limits, { accounts: 7, oemPerMonth: null });

  const run = (await app.inject({ method: "POST", url: "/api/entitlements/run", payload: {} })).json();
  assert.equal(run.mode, "dry-run");
  assert.equal(client.updates.length, 0);
  assert.deepEqual((await app.inject({ url: "/api/entitlements/status" })).json(), (await app.inject({ url: "/api/leverads-access/status" })).json());

  const after = (await app.inject({ url: "/api/entitlements/customers/c1" })).json();
  assert.equal(after.lastReport.limits.planned[0].changes.paid_seats.to, 7);
  const devedor = (await app.inject({ url: "/api/entitlements/customers/c4" })).json();
  assert.equal(devedor.entitlements[0].access.active, false);
  assert.equal(devedor.lastReport.access[0].to, false);
  assert.equal((await app.inject({ url: "/api/entitlements/customers/nao-existe" })).statusCode, 404);
});

// ── Recursos do plano modelados em cima da org do LeverAds ─────────────────
test("recursos do plano viram os campos da org: cópias/dia, módulos e Criador OEM só na linha + OEM", async () => {
  const { leveradsOrgFields, defaultResources, limitsSummary, featuresIncluded, PLAN_FEATURES } = await import("../src/shared/plan-resources.js");
  const ads = defaultResources({ limits: { accounts: 3 }, features: {} });
  const oem = defaultResources({ limits: { accounts: 7, oemPerMonth: null }, features: { equalizacao: true } });
  assert.deepEqual(ads.limits, { accounts: 3, copiesPerDay: 8000 }, "sem pacote conhecido fica no teto");
  assert.equal(defaultResources({ tier: "essencial", limits: { accounts: 3 } }).limits.copiesPerDay, 500);
  // Criador OEM: a cota que o plano já tem (200 por mês no Essencial + OEM).
  const essencial = defaultResources({ tier: "essencial", limits: { accounts: 3, oemPerMonth: 200 } });
  assert.deepEqual(essencial.limits, { accounts: 3, oemPerMonth: 200, copiesPerDay: 500 });
  assert.equal(essencial.features.oemCreator, true);
  const fields = leveradsOrgFields({ product: "leverads", ...essencial });
  assert.equal(fields.creator_quota_limit, 200);
  assert.equal(fields.creator_quota_period, "month");
  // Plano com cota ANUAL (opção do editor) manda a cota com o período do ano.
  assert.equal(leveradsOrgFields({ product: "leverads", limits: { oemPerYear: 2000 } }).creator_quota_period, "year");
  assert.equal(ads.features.oemCreator, false, "Ads sem OEM não tem o Criador");
  assert.equal(oem.features.oemCreator, true);
  assert.equal(oem.features.equalizacao, true, "o que o plano já dizia fica");
  assert.deepEqual(featuresIncluded(ads.features), PLAN_FEATURES.filter((f) => f.key !== "oemCreator").map((f) => f.label));
  assert.equal(limitsSummary(oem.limits), "7 contas · 8.000 cópias/dia · OEMs/mês ilimitados");

  assert.deepEqual(leveradsOrgFields({ product: "leverads", ...ads }), {
    paid_seats: 3, per_seller_daily_limit: 8000,
    edit_enabled: true, copy_rules_enabled: true, stock_mirror_enabled: true, messages_enabled: true,
    questions_enabled: true, auto_answer_enabled: true, compat_enabled: true, creator_enabled: false,
  });
  const oemFields = leveradsOrgFields({ product: "leverads", ...oem });
  assert.equal(oemFields.creator_enabled, true);
  assert.equal(oemFields.creator_quota_limit, null);
  assert.equal(oemFields.creator_quota_period, "month");
  // Cópias ilimitadas é a flag da org, não um número; módulo fora do plano sai como false.
  assert.deepEqual(leveradsOrgFields({ product: "leverads", limits: { copiesPerDay: null }, features: { sac: false } }), { unlimited_quota: true, messages_enabled: false });
  // Só o que o plano declara é comparado: retrato antigo, sem recursos, não fala de módulos.
  assert.deepEqual(leveradsOrgFields({ product: "leverads", limits: { accounts: 3 }, features: {} }), { paid_seats: 3 });
});

test("sync: módulo que o plano inclui e está desligado na org aparece no relatório (sem escrever)", async () => {
  const { defaultResources } = await import("../src/shared/plan-resources.js");
  const repo = makeMemRepo();
  const res = defaultResources({ limits: { accounts: 7 }, features: {} });
  await repo.create("customers", { id: "c1", name: "Ads Escala", saas: "leverads", leveradsOrgId: "org-1", planCode: "ads_escala" });
  await repo.create("subscriptions", { id: "s1", status: "active", cycle: "annual", price: 11988, customer: "c1", saas: "leverads",
    planCode: "ads_escala", planSnapshot: SNAP({ code: "ads_escala", name: "Ads Escala", ...res }) });
  const client = fakeClient([{
    id: "org-1", name: "Org 1", payment_active: true, plan_id: null, paid_seats: 7, per_seller_daily_limit: null, unlimited_quota: false,
    edit_enabled: true, copy_rules_enabled: true, stock_mirror_enabled: false, messages_enabled: true,
    questions_enabled: true, auto_answer_enabled: true, compat_enabled: true, creator_enabled: true,
  }]);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.deepEqual(report.limits.planned[0].changes, {
    per_seller_daily_limit: { from: null, to: 8000 },
    stock_mirror_enabled: { from: false, to: true },
    creator_enabled: { from: true, to: false },
  });
  assert.equal(client.updates.length, 0);
});
