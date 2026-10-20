// Pacotes e pedidos (billing/bundles.js): rateio exato do preço do pacote pelo
// preço de tabela, aplicação no negócio e o pedido que nasce no Ganho com uma
// assinatura por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { bundleDealItems, cleanBundle } from "../src/billing/bundles.js";

const { registerRoutes } = await import("../src/routes.js");

const CATALOG = [
  { id: "ads_escala", prices: [{ plan: "anual", value: 12000 }] },
  { id: "price_pro", prices: [{ plan: "anual", value: 6000 }] },
];

test("rateio proporcional à tabela, somando exatamente o preço do pacote", () => {
  const items = bundleDealItems({ price: 15000.01, items: [{ product: "ads_escala", planClosed: "anual" }, { product: "price_pro", planClosed: "anual" }] }, CATALOG);
  assert.deepEqual(items.map((i) => [i.product, i.amount]), [["ads_escala", 10000.01], ["price_pro", 5000]]);
  assert.equal(Math.round(items.reduce((n, i) => n + i.amount, 0) * 100), 1500001);
  assert.throws(() => bundleDealItems({ price: 100, items: [{ product: "x", planClosed: "anual" }, { product: "y", planClosed: "anual" }] }, CATALOG), /preço de tabela/);
});

test("validação: nome, dois planos e preço", () => {
  assert.throws(() => cleanBundle({ name: "", items: [], price: 1 }), /nome/);
  assert.throws(() => cleanBundle({ name: "Combo", items: [{ product: "a", planClosed: "anual" }], price: 1 }), /dois planos/);
  assert.throws(() => cleanBundle({ name: "Combo", items: [{ product: "a", planClosed: "anual" }, { product: "b", planClosed: "anual" }], price: 0 }), /preço/);
});

const plan = (code, total, product) => ({ id: `plan_leverads_${code}`, v: 2, saas: "leverads", code, name: code, product, kind: "subscription", pricing: "table", status: "active", order: 1, prices: { annual: { total, per: total / 12 } } });

test("pacote aplicado no negócio e o Ganho abre uma assinatura por produto e o pedido", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" }] });
  await repo.create("plans", plan("ads_escala", 12000, "leverads"));
  await repo.create("plans", plan("price_pro", 6000, "leverprice"));
  await repo.create("plans", plan("ads_essencial", 6000, "leverads"));
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Follow-up", paymentMethod: "pix" });
  const app = Fastify();
  registerRoutes(app, repo);

  const b = await app.inject({ method: "POST", url: "/api/bundles", payload: { saas: "leverads", name: "Ads + Price", price: 15000, items: [{ product: "ads_escala", planClosed: "anual" }, { product: "price_pro", planClosed: "anual" }] } });
  assert.equal(b.statusCode, 201, b.body);
  const mesmo = await app.inject({ method: "POST", url: "/api/bundles", payload: { saas: "leverads", name: "Dois Ads", price: 15000, items: [{ product: "ads_escala", planClosed: "anual" }, { product: "ads_essencial", planClosed: "anual" }] } });
  assert.equal(mesmo.statusCode, 400, "dois planos do mesmo produto não viram duas assinaturas");
  const listed = (await app.inject({ url: "/api/bundles?saas=leverads" })).json().bundles[0];
  assert.equal(listed.listTotal, 18000, "a tabela soma 18 mil; o pacote sai por 15");

  const applied = await app.inject({ method: "POST", url: "/api/leads/l1/bundle", payload: { bundleId: b.json().id } });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.deepEqual(applied.json().dealItems.map((i) => [i.product, i.amount]), [["ads_escala", 10000], ["price_pro", 5000]]);
  assert.equal(applied.json().amount, 15000);

  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  const lead = await repo.get("leads", "l1");
  const subs = await repo.listWhere("subscriptions", { customer: lead.customerId });
  assert.equal(subs.length, 2, "uma assinatura por produto");
  const [order] = (await app.inject({ url: `/api/customers/${lead.customerId}/orders` })).json().orders;
  assert.equal(order.bundle, b.json().id);
  assert.equal(order.items.length, 2);
  assert.equal(order.total, 15000);
});
