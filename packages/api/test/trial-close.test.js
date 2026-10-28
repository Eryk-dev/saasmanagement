// Teste grátis do Lever Price (Leo, 28/10/2026): o cliente usa 15 dias sem
// pagar e decide depois. É venda (entra no Ganho e nas últimas vendas como
// "Teste grátis"), mas vale R$ 0: sem assinatura, sem fatura, arr 0 e o
// pagamento "Não pago" até ele converter. A modalidade é um PLANO do catálogo
// (price_teste, `trial.days`), vendido pelo gate como plano de fechamento
// "teste"; uma venda já lançada paga que vira teste perde a assinatura e as
// faturas que não eram dinheiro real.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { CLOSED_PLAN_DAYS, isTrialPlan, trialEndsAt, TRIAL_PLAN } from "../src/shared/plan-cycles.js";
import { closedSubscriptionSpec } from "../src/billing/billing.js";
import { dealCatalogFromPlans, ensurePlansCatalog, ensurePriceTrialPlan, plansToCatalog, slimPlan } from "../src/billing/plan-catalog.js";
import { convertWonLead, syncWonLeadDeal, isTrialDeal } from "../src/crm/won-lead.js";
import { TRIAL_KEY } from "../src/proposals/proposal-catalog.js";

const { ensureProposalCatalog, migrateCatalogPricing } = await import("../src/platform/migrations.js");
const capi = { sendPurchase: async () => {} };

async function seededRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }, { stage: "Ganho", kind: "ganho" }] });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  await ensurePlansCatalog(repo);
  return repo;
}

test("régua: 'teste' é plano de fechamento sem ciclo (spec null), 15 dias, fim contado da venda", () => {
  assert.equal(isTrialPlan(TRIAL_PLAN), true);
  assert.equal(isTrialPlan("anual"), false);
  assert.equal(CLOSED_PLAN_DAYS.teste, 15);
  assert.equal(closedSubscriptionSpec({ planClosed: "teste", amount: 0, paymentMethod: "" }), null);
  assert.equal(closedSubscriptionSpec({ planClosed: "teste", amount: 9564, paymentMethod: "cartao12x" }), null, "teste nunca vira assinatura, mesmo com valor digitado");
  assert.equal(trialEndsAt("2026-10-28T18:02:43.206Z", "teste"), "2026-11-12T18:02:43.206Z");
  assert.equal(trialEndsAt("2026-10-28T18:02:43.206Z", "anual"), "");
});

test("catálogo: o plano de teste nasce do Essencial uma vez, sai no gate com R$ 0/plano 'teste' e fica fora do deck", async () => {
  const repo = await seededRepo();
  assert.equal(await ensurePriceTrialPlan(repo), 1);
  assert.equal(await ensurePriceTrialPlan(repo), 0, "idempotente");
  const plan = await repo.get("plans", "plan_leverads_price_teste");
  assert.equal(plan.code, TRIAL_KEY);
  assert.equal(plan.name, "Lever Price · Teste grátis");
  assert.equal(plan.product, "leverprice");
  assert.equal(plan.access.product, "leverprice");
  assert.deepEqual(plan.trial, { days: 15 });
  assert.deepEqual(plan.limits, (await repo.get("plans", "plan_leverads_price_essencial")).limits, "mesmos limites do Essencial");
  assert.deepEqual(plan.prices, {});
  assert.deepEqual(slimPlan(plan).trial, { days: 15 });
  const plans = await repo.list("plans");
  const row = dealCatalogFromPlans(plans).find((r) => r.id === TRIAL_KEY);
  assert.deepEqual(row, { id: TRIAL_KEY, label: "Lever Price · Teste grátis", group: "Lever Price", trial: 15, prices: [{ plan: "teste", label: "Teste grátis · 15 dias", value: 0 }] });
  // Projeção pros templates de proposta: o teste não vira produto do deck.
  const cat = plansToCatalog(plans, null, (await repo.get("proposal_templates", "pt_leverads")).calc.catalog);
  assert.equal(TRIAL_KEY in cat.products, false);
  assert.ok("price_essencial" in cat.products);
});

test("ganho em teste grátis: cliente nasce sem assinatura nem fatura, arr 0, 'Não pago' e com o fim do teste", async () => {
  const repo = await seededRepo();
  await ensurePriceTrialPlan(repo);
  const lead = await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Rodrigo", company: "Roma", stage: "Ganho",
    dealProduct: TRIAL_KEY, planClosed: "teste", amount: 0, paymentMethod: "cartao12x", closer: "leonardo",
  });
  assert.equal(isTrialDeal(lead), true);
  const customer = await convertWonLead(repo, lead, { metaCapi: capi });
  const saved = await repo.get("customers", customer.id);
  assert.equal(saved.plan, "Lever Price · Teste grátis · 15 dias");
  assert.equal(saved.planCode, TRIAL_KEY);
  assert.equal(saved.arr, 0);
  assert.equal(saved.paymentStatus, "unpaid");
  assert.equal(saved.trialEndsAt, trialEndsAt(saved.startedAt, "teste"));
  assert.deepEqual(await repo.list("subscriptions"), []);
  assert.deepEqual(await repo.list("invoices"), []);
});

test("venda lançada paga que vira teste: assinatura cancelada, faturas presumidas/abertas somem, arr 0, 'Não pago'", async () => {
  const repo = await seededRepo();
  await ensurePriceTrialPlan(repo);
  const lead0 = await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Rodrigo", company: "Roma", stage: "Ganho",
    dealProduct: "price_essencial", planClosed: "anual", amount: 5964, paymentMethod: "cartao12x", closer: "leonardo",
  });
  const customer = await convertWonLead(repo, lead0, { metaCapi: capi });
  const [sub] = await repo.list("subscriptions");
  assert.equal(sub.status, "active");
  // Pró-rata aberta de uma troca de plano no meio + a inicial presumida.
  await repo.create("invoices", { customer: customer.id, saas: "leverads", subscription: sub.id, kind: "prorata", amount: 3590, status: "open", dueDate: "2026-10-28" });
  // Fatura com pagamento REAL do MP é fato: fica.
  await repo.create("invoices", { customer: customer.id, saas: "leverads", subscription: sub.id, kind: "renewal", amount: 100, status: "paid", mpPaymentId: "mp1", paidAt: "2026-10-01", dueDate: "2026-10-01", paidProof: { kind: "mp" } });
  assert.equal((await repo.list("invoices")).length, 3);
  assert.equal((await repo.get("customers", customer.id)).arr, 5964);

  const lead = await repo.update("leads", lead0.id, { dealProduct: TRIAL_KEY, planClosed: "teste", amount: 0 });
  await syncWonLeadDeal(repo, lead);
  const saved = await repo.get("customers", customer.id);
  assert.equal(saved.arr, 0);
  assert.equal(saved.paymentStatus, "unpaid");
  assert.equal(saved.planCode, TRIAL_KEY);
  assert.equal(saved.plan, "Lever Price · Teste grátis · 15 dias");
  assert.ok(saved.trialEndsAt);
  assert.equal((await repo.get("subscriptions", sub.id)).status, "canceled");
  const left = await repo.list("invoices");
  assert.deepEqual(left.map((i) => i.mpPaymentId), ["mp1"], "só a fatura com dinheiro real do MP fica");

  // Converteu depois do teste: reeditar pro plano pago volta a ser venda normal.
  const paid = await repo.update("leads", lead.id, { dealProduct: "price_essencial", planClosed: "anual", amount: 7164 });
  await syncWonLeadDeal(repo, paid);
  const after = await repo.get("customers", customer.id);
  assert.equal(after.arr, 7164);
  assert.equal(after.trialEndsAt, "", "deixou de ser teste");
  assert.equal((await repo.list("subscriptions")).filter((s) => s.status !== "canceled").length, 1);
});
