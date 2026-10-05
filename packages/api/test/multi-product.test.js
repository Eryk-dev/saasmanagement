// Um cliente pode ter MAIS DE UM produto ao mesmo tempo, cada um com a sua
// assinatura. O plano vive na assinatura; o cadastro do cliente espelha a
// principal (a mais antiga) e lista os produtos contratados.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ensurePlansCatalog } from "../src/plan-catalog.js";
import { planHistoryOf } from "../src/plan-history.js";
import { desiredEntitlements, plansByCodeOf } from "../src/entitlements.js";
import { runLeveradsAccessSync } from "../src/leverads-access.js";

const { ensureProposalCatalog, migrateCatalogPricing } = await import("../src/migrations.js");
const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [{ stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" }];

// Cliente que fechou o LeverAds (Ads Escala + OEM, anual) pelo gate.
async function wonCustomer() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  await ensurePlansCatalog(repo);
  const app = Fastify();
  registerRoutes(app, repo);
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Fulano", stage: "Follow-up", dealProduct: "oem_escala", planClosed: "anual", amount: 11988, paymentMethod: "pix" });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  const customer = (await repo.list("customers"))[0];
  return { repo, app, customer };
}
const subsOf = async (repo, id) => (await repo.list("subscriptions")).filter((s) => s.customer === id);

test("adicionar o LeverPrice a quem já tem o LeverAds: segunda assinatura, ARR somado e os dois produtos no cadastro", async (t) => {
  const { repo, app, customer } = await wonCustomer();
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: `/api/customers/${customer.id}/subscriptions`, payload: { plan: "price_escala", cycle: "semestral" } });
  assert.equal(res.statusCode, 201);
  const { subscription } = res.json();
  assert.equal(subscription.planCode, "price_escala");
  assert.equal(subscription.cycle, "semiannual");
  assert.equal(subscription.price, 11382, "sem valor informado, vale o preço de tabela do ciclo");
  assert.equal(subscription.planSnapshot.product, "leverprice");
  assert.ok(subscription.periodEnd, "ciclo aberto");

  const subs = await subsOf(repo, customer.id);
  assert.equal(subs.length, 2);
  const after = await repo.get("customers", customer.id);
  assert.equal(after.arr, 11988 + 11382 * 2, "ARR = soma das duas assinaturas, anualizadas");
  assert.deepEqual(after.products, ["leverads", "leverprice"]);
  assert.equal(after.planCode, "oem_escala", "o cadastro segue espelhando a assinatura principal (a mais antiga)");
  assert.equal(after.plan, "Ads Escala + OEM · Anual");
  // 1ª fatura do produto novo nasce em aberto: adicionar não é receber.
  const inv = (await repo.list("invoices")).find((i) => i.subscription === subscription.id);
  assert.equal(inv.status, "open");
  assert.equal(inv.amount, 11382);
  const history = await planHistoryOf(repo, customer.id);
  assert.equal(history.filter((e) => e.type === "start").length, 2);
  assert.equal(history.find((e) => e.subscription === subscription.id).note, "produto adicionado");
});

test("regras de adicionar produto: mesmo produto é troca de plano, compra única não vira assinatura, valor negociado vale", async (t) => {
  const { repo, app, customer } = await wonCustomer();
  t.after(() => app.close());
  const post = (payload) => app.inject({ method: "POST", url: `/api/customers/${customer.id}/subscriptions`, payload });

  const same = await post({ plan: "ads_escala", cycle: "anual" });
  assert.equal(same.statusCode, 409, "Ads Escala é do mesmo produto (LeverAds) que o cliente já tem");
  assert.equal(same.json().code, "product_already_subscribed");
  assert.equal((await post({ plan: "oem_pack", cycle: "anual" })).statusCode, 422);
  assert.equal((await post({ plan: "nao_existe", cycle: "anual" })).statusCode, 422);
  assert.equal((await post({ plan: "price_escala", cycle: "trienal" })).statusCode, 400);
  assert.equal((await subsOf(repo, customer.id)).length, 1, "nada foi criado nas recusas");

  const ok = await post({ plan: "price_essencial", cycle: "anual", price: 8000 });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().subscription.price, 8000);
  assert.equal(ok.json().subscription.planSnapshot.listPrice, 9564, "o retrato guarda a tabela, não o negociado");
  assert.equal((await post({ plan: "price_escala", cycle: "anual" })).statusCode, 409, "LeverPrice agora também já existe");

  await repo.update("customers", customer.id, { endedAt: "2026-09-01T12:00:00.000Z" });
  assert.equal((await post({ plan: "price_escala", cycle: "anual" })).statusCode, 409, "cliente em churn não ganha produto");
});

test("acesso e limites por produto: cada assinatura dá o direito do produto dela", async (t) => {
  const { repo, app, customer } = await wonCustomer();
  t.after(() => app.close());
  await app.inject({ method: "POST", url: `/api/customers/${customer.id}/subscriptions`, payload: { plan: "price_escala", cycle: "anual" } });
  const plans = plansByCodeOf(await repo.list("plans"));
  const ents = desiredEntitlements(await repo.get("customers", customer.id), await subsOf(repo, customer.id), plans, { defaultProduct: "leverads" });
  assert.deepEqual(ents.map((e) => [e.product, e.planCode, e.access.active]), [["leverads", "oem_escala", true], ["leverprice", "price_escala", true]]);
  assert.deepEqual(ents[0].limits, { accounts: 7, oemPerMonth: null });
  assert.deepEqual(ents[1].limits, { listings: 10000 });

  // LeverPrice cancelado: o direito dele cai, o do LeverAds continua.
  const price = (await subsOf(repo, customer.id)).find((s) => s.planCode === "price_escala");
  await app.inject({ method: "PATCH", url: `/api/subscriptions/${price.id}`, payload: { status: "canceled" } });
  const after = desiredEntitlements(await repo.get("customers", customer.id), await subsOf(repo, customer.id), plans, { defaultProduct: "leverads" });
  assert.deepEqual(after.map((e) => [e.product, e.access.active]), [["leverads", true], ["leverprice", false]]);
  assert.deepEqual((await repo.get("customers", customer.id)).products, ["leverads"]);

  // No relatório do LeverAds: os dois produtos aparecem, e nada além do payment_active é escrito.
  await app.inject({ method: "PATCH", url: `/api/subscriptions/${price.id}`, payload: { status: "active" } });
  await repo.update("customers", customer.id, { leveradsOrgId: "org-1" });
  const updates = [];
  const client = { configured: () => true, listOrgs: async () => [{ id: "org-1", name: "Org", payment_active: true, plan_id: null, paid_seats: 7, creator_enabled: true, creator_quota_limit: null, creator_quota_period: "month", leverprice_enabled: false }], updateOrg: async (id, p) => { updates.push(p); } };
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.deepEqual(report.limits.planned.map((p) => [p.product, p.changes]), [["leverprice", { leverprice_enabled: { from: false, to: true } }]]);
  assert.equal(updates.length, 0);
  const detail = (await app.inject({ url: `/api/entitlements/customers/${customer.id}` })).json();
  assert.deepEqual(detail.entitlements.map((e) => e.product), ["leverads", "leverprice"]);
});

test("cancelar a assinatura principal: o cadastro passa a espelhar o produto que ficou", async (t) => {
  const { repo, app, customer } = await wonCustomer();
  t.after(() => app.close());
  await app.inject({ method: "POST", url: `/api/customers/${customer.id}/subscriptions`, payload: { plan: "price_escala", cycle: "semestral", startAt: "2026-12-01T12:00:00.000Z" } });
  const ads = (await subsOf(repo, customer.id)).find((s) => s.planCode === "oem_escala");
  await app.inject({ method: "PATCH", url: `/api/subscriptions/${ads.id}`, payload: { status: "canceled" } });
  const after = await repo.get("customers", customer.id);
  assert.equal(after.planCode, "price_escala");
  assert.equal(after.plan, "Lever Price · Escala · Semestral");
  assert.deepEqual(after.products, ["leverprice"]);
  assert.equal(after.arr, 11382 * 2, "ARR só do que segue ativo");
});

test("números por plano: cliente com dois produtos conta em cada plano com o valor da assinatura dele, e uma vez no total", async (t) => {
  const { repo, app, customer } = await wonCustomer();
  t.after(() => app.close());
  await app.inject({ method: "POST", url: `/api/customers/${customer.id}/subscriptions`, payload: { plan: "price_escala", cycle: "anual" } });
  await repo.create("invoices", { id: "pago", saas: "leverads", customer: customer.id, amount: 3000, status: "paid", paidAt: "2026-09-20T12:00:00.000Z", kind: "installment" });
  const s = (await app.inject({ url: "/api/plans/stats/leverads" })).json();
  assert.equal(s.plans.oem_escala.active, 1);
  assert.equal(s.plans.oem_escala.arr, 11988);
  assert.equal(s.plans.price_escala.active, 1);
  assert.equal(s.plans.price_escala.arr, 17964);
  assert.equal(s.total.active, 1, "um cliente só");
  assert.equal(s.total.arr, 11988 + 17964);
  // O caixa é do cliente: reparte na proporção do contratado e fecha no total.
  assert.equal(Math.round(s.plans.oem_escala.received + s.plans.price_escala.received), 3000);
  assert.ok(s.plans.price_escala.received > s.plans.oem_escala.received);
});

test("fechar com mais de um produto (Próximo passo das Atividades): uma assinatura por produto recorrente, ARR somado e os produtos no cadastro", async (t) => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  await ensurePlansCatalog(repo);
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Ciclana", stage: "Follow-up" });
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l2", payload: {
    stage: "Ganho", paymentMethod: "pix", dealProduct: "oem_escala", planClosed: "anual", amount: 11988 + 11382,
    dealItems: [
      { product: "oem_escala", planClosed: "anual", amount: 11988 },
      { product: "price_escala", planClosed: "semestral", amount: 11382 },
    ],
  } });
  assert.equal(res.statusCode, 200);
  const customer = (await repo.list("customers"))[0];
  const subs = await subsOf(repo, customer.id);
  assert.deepEqual(subs.map((s) => [s.planCode, s.cycle, s.price]).sort(), [["oem_escala", "annual", 11988], ["price_escala", "semiannual", 11382]]);
  const after = await repo.get("customers", customer.id);
  assert.equal(after.arr, 11988 + 11382 * 2, "cada produto anualizado pelo próprio ciclo");
  assert.deepEqual(after.products, ["leverads", "leverprice"]);
  assert.equal(after.planCode, "oem_escala", "o cadastro espelha o primeiro produto");
});

test("um item só em dealItems é o fechamento de sempre", async (t) => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  await ensurePlansCatalog(repo);
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  await repo.create("leads", { id: "l3", saas: "leverads", name: "Beltrano", stage: "Follow-up" });
  await app.inject({ method: "PATCH", url: "/api/leads/l3", payload: {
    stage: "Ganho", paymentMethod: "pix", dealProduct: "ads_escala", planClosed: "semestral", amount: 7182,
    dealItems: [{ product: "ads_escala", planClosed: "semestral", amount: 7182 }],
  } });
  const customer = (await repo.list("customers"))[0];
  const subs = await subsOf(repo, customer.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].price, 7182);
  assert.equal(customer.arr, 7182 * 2);
});
