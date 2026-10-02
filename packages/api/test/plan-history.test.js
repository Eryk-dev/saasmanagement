// Plano estruturado no cliente/assinatura (planCode, planCycle, planSnapshot) e
// o histórico append-only `plan_changes`. O rótulo `customer.plan` e as contas
// de receita (arr, preço, ciclo) seguem exatamente como eram.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ensurePlansCatalog } from "../src/plan-catalog.js";
import { backfillCustomerPlans, planHistoryOf } from "../src/plan-history.js";
import { runBilling } from "../src/billing.js";

const { ensureProposalCatalog, migrateCatalogPricing } = await import("../src/migrations.js");
const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Follow-up", kind: "followup" },
  { stage: "Ganho", kind: "ganho" },
  { stage: "Integração", kind: "integracao" },
  { stage: "Perdido", kind: "perdido" },
];

async function baseRepo({ plans = true } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  if (plans) {
    await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
    await ensureProposalCatalog(repo);
    await migrateCatalogPricing(repo);
    await ensurePlansCatalog(repo);
  }
  return repo;
}
function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}
const types = async (repo, customerId) => (await planHistoryOf(repo, customerId)).map((e) => e.type).reverse();

// Fecha um lead pelo gate (PATCH de estágio) e devolve cliente + assinatura.
async function win(app, repo, lead) {
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Fulano", stage: "Follow-up", closer: "vitor", ...lead });
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal(res.statusCode, 200);
  const customer = (await repo.list("customers")).find((c) => c.leadId === "l1");
  const sub = (await repo.list("subscriptions")).find((s) => s.customer === customer.id) || null;
  return { customer, sub };
}

test("ganho: cliente e assinatura nascem com código, ciclo e retrato do plano; rótulo e arr iguais aos de sempre", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer, sub } = await win(app, repo, { dealProduct: "oem_escala", planClosed: "anual", amount: 10000, paymentMethod: "pix" });

  assert.equal(customer.plan, "Ads Escala + OEM · Anual");
  assert.equal(customer.arr, 10000);
  assert.equal(customer.planCode, "oem_escala");
  assert.equal(customer.planCycle, "anual");
  assert.equal(customer.planCustom, "");
  assert.equal(customer.planSnapshot.listPrice, 11988, "preço de TABELA, não o valor negociado");
  assert.equal(customer.planSnapshot.priceVersion, 1);
  assert.deepEqual(customer.planSnapshot.limits, { accounts: 7, oemPerMonth: null });
  assert.equal(customer.planSnapshot.accessProduct, "leverads");

  assert.equal(sub.plan, "plan_leverads_oem_escala");
  assert.equal(sub.planCode, "oem_escala");
  assert.equal(sub.price, 10000);
  assert.equal(sub.cycle, "annual");

  const [start] = await planHistoryOf(repo, customer.id);
  assert.equal(start.type, "start");
  assert.equal(start.to.planCode, "oem_escala");
  assert.equal(start.to.arr, 10000);
  assert.equal(start.listPrice, 11988);
  assert.equal(start.amount, 10000);
  assert.equal(start.subscription, sub.id);
  assert.equal(start.author, "vitor");
});

test("venda fora do catálogo (Personalizado) guarda o texto em planCustom, sem retrato", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer, sub } = await win(app, repo, { dealProduct: "Pacote sob medida", planClosed: "semestral", amount: 9000, paymentMethod: "pix" });
  assert.equal(customer.planCode, "");
  assert.equal(customer.planCustom, "Pacote sob medida");
  assert.equal(customer.planCycle, "semestral");
  assert.equal(customer.planSnapshot, null);
  assert.equal(customer.plan, "Pacote sob medida · Semestral");
  assert.equal(sub.plan, "");
  assert.equal(sub.planCode, undefined);
});

test("sem catálogo de planos semeado, o fechamento segue como antes e o arr é o mesmo", async (t) => {
  const com = await baseRepo();
  const sem = await baseRepo({ plans: false });
  const appCom = buildApp(com), appSem = buildApp(sem);
  t.after(() => { appCom.close(); appSem.close(); });
  const deal = { dealProduct: "ads_escala", planClosed: "semestral", amount: 7182, paymentMethod: "boleto", paymentInstallments: 6 };
  const a = await win(appCom, com, deal);
  const b = await win(appSem, sem, deal);
  assert.equal(a.customer.arr, b.customer.arr);
  assert.equal(a.customer.plan, b.customer.plan);
  assert.equal(a.sub.price, b.sub.price);
  assert.equal(a.sub.cycle, b.sub.cycle);
  assert.equal(b.customer.planCode, "", "sem plano no catálogo: vira personalizado, não quebra");
  assert.equal(b.sub.plan, "");
});

test("reeditar o fechamento troca o plano no cliente e na assinatura e registra deal_edit; mesma venda mantém o retrato", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer, sub } = await win(app, repo, { dealProduct: "oem_essencial", planClosed: "anual", amount: 5964, paymentMethod: "pix" });
  const original = customer.planSnapshot;

  // Preço de tabela sobe DEPOIS da venda; reeditar só o meio de pagamento não troca o retrato.
  await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_oem_essencial", payload: { prices: { annual: { per: 597 } } } });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { paymentMethod: "cartao12x" } });
  assert.deepEqual((await repo.get("customers", customer.id)).planSnapshot, original);
  assert.deepEqual(await types(repo, customer.id), ["start"]);

  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { dealProduct: "oem_escala", amount: 11988 } });
  const after = await repo.get("customers", customer.id);
  assert.equal(after.planCode, "oem_escala");
  assert.equal(after.plan, "Ads Escala + OEM · Anual");
  assert.equal(after.arr, 11988);
  assert.equal((await repo.get("subscriptions", sub.id)).planCode, "oem_escala");
  const history = await planHistoryOf(repo, customer.id);
  assert.deepEqual(history.map((e) => e.type), ["deal_edit", "start"]);
  assert.equal(history[0].from.planCode, "oem_essencial");
  assert.equal(history[0].to.planCode, "oem_escala");
});

test("troca de plano: upgrade aplica já e atualiza o cliente; downgrade agenda e o billing aplica", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer, sub } = await win(app, repo, { dealProduct: "ads_essencial", planClosed: "anual", amount: 5964, paymentMethod: "pix" });

  const up = await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { plan: "ads_escala", price: 11988 } });
  assert.equal(up.json().changeType, "upgrade_mid_cycle");
  const upSub = await repo.get("subscriptions", sub.id);
  assert.equal(upSub.plan, "plan_leverads_ads_escala");
  assert.equal(upSub.planCode, "ads_escala");
  assert.equal(upSub.planSnapshot.listPrice, 11988);
  const upCustomer = await repo.get("customers", customer.id);
  assert.equal(upCustomer.planCode, "ads_escala");
  assert.equal(upCustomer.plan, "Ads Escala · Anual");
  assert.equal(upCustomer.arr, 11988);

  const down = await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { plan: "plan_leverads_ads_essencial", price: 5964 } });
  assert.equal(down.json().changeType, "downgrade_mid_cycle");
  assert.equal((await repo.get("customers", customer.id)).planCode, "ads_escala", "agendado ainda não vale");
  assert.equal((await repo.get("subscriptions", sub.id)).pendingChange.planCode, "ads_essencial");

  await runBilling(repo, { now: new Date(new Date(upSub.periodEnd).getTime() + 1000) });
  const applied = await repo.get("subscriptions", sub.id);
  assert.equal(applied.planCode, "ads_essencial");
  assert.equal(applied.price, 5964);
  assert.equal((await repo.get("customers", customer.id)).planCode, "ads_essencial");
  assert.equal((await repo.get("customers", customer.id)).plan, "Ads Essencial · Anual");
  assert.deepEqual(await types(repo, customer.id), ["start", "upgrade", "scheduled", "applied"]);

  // Mesmo plano por código não é mudança (o id e o código são a mesma coisa).
  const noop = await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { plan: "ads_essencial" } });
  assert.equal(noop.json().changeType, "no_op");
});

test("edição manual do plano no cadastro: valida o código, recalcula o rótulo e carimba a assinatura", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer, sub } = await win(app, repo, { dealProduct: "oem_essencial", planClosed: "anual", amount: 5964, paymentMethod: "pix" });

  const bad = await app.inject({ method: "PATCH", url: `/api/customers/${customer.id}`, payload: { planCode: "nao_existe" } });
  assert.equal(bad.statusCode, 422);

  const ok = await app.inject({ method: "PATCH", url: `/api/customers/${customer.id}`, payload: { planCode: "price_escala", planCycle: "semestral" } });
  assert.equal(ok.statusCode, 200);
  const c = ok.json();
  assert.equal(c.plan, "Lever Price · Escala · Semestral");
  assert.equal(c.planSnapshot.listPrice, 11382);
  assert.equal(c.planSnapshot.accessProduct, "leverprice");
  assert.equal(c.arr, 5964, "editar o plano não mexe em receita");
  const stamped = await repo.get("subscriptions", sub.id);
  assert.equal(stamped.planCode, "price_escala");
  assert.equal(stamped.price, 5964);
  assert.equal(stamped.cycle, "annual");

  const custom = (await app.inject({ method: "PATCH", url: `/api/customers/${customer.id}`, payload: { planCode: "", planCustom: "Combo antigo" } })).json();
  assert.equal(custom.planCode, "");
  assert.equal(custom.planSnapshot, null);
  assert.equal(custom.plan, "Combo antigo · Semestral");
  assert.deepEqual(await types(repo, customer.id), ["start", "manual_edit", "manual_edit"]);
});

test("upsell, churn e volta entram no histórico; o feed e a coleção só saem pelas rotas dedicadas", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer } = await win(app, repo, { dealProduct: "oem_escala", planClosed: "anual", amount: 11988, paymentMethod: "pix" });

  const upsell = await app.inject({ method: "POST", url: `/api/customers/${customer.id}/upsell`, payload: { item: "Pacote de 1.000 OEMs", amount: 2000, payment: "paid" } });
  assert.equal(upsell.statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${customer.id}/churn`, payload: { reason: "preco" } })).statusCode, 200);
  await app.inject({ method: "POST", url: `/api/customers/${customer.id}/churn`, payload: { reason: "outro" } }); // re-marcar não duplica
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${customer.id}/unchurn`, payload: {} })).statusCode, 200);
  assert.deepEqual(await types(repo, customer.id), ["start", "upsell", "churn", "reactivation"]);

  const history = (await app.inject({ url: `/api/customers/${customer.id}/plan-history` })).json();
  assert.equal(history[0].type, "reactivation");
  assert.equal(history.find((e) => e.type === "upsell").amount, 2000);
  assert.match(history.find((e) => e.type === "churn").note, /Preço/);
  const feed = (await app.inject({ url: "/api/plan-changes?saas=leverads" })).json();
  assert.equal(feed.length, 4);
  assert.equal((await app.inject({ url: "/api/plan_changes" })).statusCode, 404, "CRUD genérico não expõe");
  assert.equal((await app.inject({ method: "POST", url: "/api/plan_changes", payload: { customer: customer.id, type: "start" } })).statusCode, 404);
});

test("desfazer o ganho leva o histórico junto", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  const { customer } = await win(app, repo, { dealProduct: "oem_escala", planClosed: "anual", amount: 11988, paymentMethod: "pix" });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  assert.equal(await repo.get("customers", customer.id), null);
  assert.deepEqual(await repo.list("plan_changes"), []);
});

test("backfill: preenche código e ciclo dos clientes antigos sem tocar arr, rótulo, preço nem ciclo; roda uma vez", async () => {
  const repo = await baseRepo();
  await repo.create("leads", { id: "la", saas: "leverads", name: "A", dealProduct: "ads_escala", planClosed: "semestral" });
  await repo.create("customers", { id: "ca", saas: "leverads", name: "A", leadId: "la", plan: "Ads Escala · Semestral", arr: 14364, startedAt: "2026-09-12T12:00:00.000Z" });
  await repo.create("subscriptions", { id: "sa", customer: "ca", saas: "leverads", status: "active", cycle: "semiannual", price: 7182, plan: "" });
  await repo.create("customers", { id: "cb", saas: "leverads", name: "B", dealProduct: "full", plan: "LeverAds FULL · Anual", arr: 7188 });
  await repo.create("customers", { id: "cc", saas: "leverads", name: "C", dealProduct: "Combo especial", plan: "Combo especial · Anual", arr: 9000 });
  await repo.create("customers", { id: "cd", saas: "leverads", name: "D", plan: "", arr: 0 });
  const before = Object.fromEntries((await repo.list("customers")).map((c) => [c.id, c]));

  const report = await backfillCustomerPlans(repo);
  assert.deepEqual(report, { stamped: 2, custom: 1, unknown: 1 });
  const ca = await repo.get("customers", "ca");
  assert.equal(ca.planCode, "ads_escala");
  assert.equal(ca.planCycle, "semestral");
  assert.equal(ca.planSnapshot.listPrice, null, "não inventa preço de tabela histórico");
  assert.equal(ca.planSnapshot.backfilled, true);
  assert.deepEqual(ca.planSnapshot.limits, { accounts: 7 });
  assert.equal((await repo.get("customers", "cb")).planCode, "full", "venda do catálogo anterior aponta pro plano legado");
  assert.equal((await repo.get("customers", "cc")).planCustom, "Combo especial");
  assert.equal("planCode" in (await repo.get("customers", "cd")), false);
  for (const id of ["ca", "cb", "cc", "cd"]) {
    const c = await repo.get("customers", id);
    assert.equal(c.arr, before[id].arr, id);
    assert.equal(c.plan, before[id].plan, id);
  }
  const sub = await repo.get("subscriptions", "sa");
  assert.equal(sub.plan, "plan_leverads_ads_escala");
  assert.equal(sub.price, 7182);
  assert.equal(sub.cycle, "semiannual");
  const [evt] = await planHistoryOf(repo, "ca");
  assert.equal(evt.type, "backfill");
  assert.equal(evt.at, "2026-09-12T12:00:00.000Z");

  assert.equal(await backfillCustomerPlans(repo), null, "marcador impede a segunda rodada");
  assert.equal((await repo.list("plan_changes")).length, 3);
});

test("backfill espera o catálogo de planos existir (não grava marcador antes)", async () => {
  const repo = await baseRepo({ plans: false });
  await repo.create("customers", { id: "ca", saas: "leverads", name: "A", dealProduct: "ads_escala", plan: "Ads Escala · Anual", arr: 11988 });
  assert.equal(await backfillCustomerPlans(repo), null);
  assert.equal(await repo.get("app_config", "customer_plans_v1"), null);
});

test("GET /api/plans/stats/:saas: assinantes, contratado e recebido por plano; fora do catálogo em baldes próprios", async (t) => {
  const repo = await baseRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  await repo.create("customers", { id: "a", saas: "leverads", name: "A", planCode: "oem_escala", planCycle: "anual", arr: 11988, startedAt: "2026-09-01T12:00:00.000Z", planSnapshot: { listPrice: 11988, priceVersion: 1 } });
  await repo.create("customers", { id: "b", saas: "leverads", name: "B", planCode: "oem_escala", planCycle: "semestral", arr: 14364 });
  await repo.create("customers", { id: "c", saas: "leverads", name: "C saiu", planCode: "oem_escala", arr: 9000, endedAt: "2026-08-01T12:00:00.000Z" });
  await repo.create("customers", { id: "d", saas: "leverads", name: "D", planCustom: "Combo", arr: 6000 });
  await repo.create("customers", { id: "e", saas: "leverads", name: "E", arr: 1200 });
  await repo.create("customers", { id: "z", saas: "elo", name: "Outro produto", planCode: "oem_escala", arr: 99999 });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "a", amount: 999, status: "paid", paidAt: "2026-09-10T12:00:00.000Z", kind: "installment" });
  await repo.create("invoices", { id: "i2", saas: "leverads", customer: "a", amount: 999, status: "open", kind: "installment" });

  const s = (await app.inject({ url: "/api/plans/stats/leverads" })).json();
  const escala = s.plans.oem_escala;
  assert.equal(escala.active, 2);
  assert.equal(escala.churned, 1);
  assert.equal(escala.arr, 26352, "churnado fica fora do contratado");
  assert.equal(escala.mrr, 2196);
  assert.equal(escala.received, 999, "só fatura paga de verdade");
  assert.deepEqual(escala.customers.map((c) => c.id), ["b", "a", "c"], "ativos por valor, churnados no fim");
  assert.equal(escala.customers[1].listPrice, 11988);
  assert.equal(s.plans.ads_escala.active, 0);
  assert.equal(s.custom.active, 1);
  assert.equal(s.none.arr, 1200);
  assert.deepEqual(s.total, { active: 4, churned: 1, arr: 33552, mrr: 2796, received: 999 });
});
