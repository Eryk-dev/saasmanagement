// Trocar o nome de um plano em tudo que mostra o nome de hoje (Leo,
// 27/11/2026: a linha OEM virou "LeverOEM <pacote>"). O que este teste
// protege: o plano, a projeção nas apresentações, o retrato das assinaturas
// vivas e o cadastro do cliente andam juntos; o que é registro do dia
// (assinatura encerrada, histórico, preço e limites do retrato) fica; rótulo
// escrito à mão fica e é avisado; o ensaio não grava nada; rodar de novo não
// muda nada.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, migrateCatalogPricing } = await import("../src/platform/migrations.js");
const { ensurePlansCatalog } = await import("../src/billing/plan-catalog.js");
const { syncCustomerPlanFromSub } = await import("../src/billing/plan-history.js");
const { renamePlan } = await import("../src/billing/plan-rename.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const ID = "plan_leverads_oem_essencial";

async function seededRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  const base = await repo.get("proposal_templates", "pt_leverads");
  await repo.create("proposal_templates", { id: "pt_leverads_slides", saas: "leverads", status: "published", calc: clone(base.calc), slides: [] });
  await ensurePlansCatalog(repo);
  // Estado de produção em 27/11/2026: o plano e as cópias com o nome anterior.
  await repo.update("plans", ID, { name: "Ads Essencial + OEM" });
  for (const id of ["pt_leverads", "pt_leverads_slides"]) {
    const t = await repo.get("proposal_templates", id);
    t.calc.catalog.products.oem_essencial.name = "Ads Essencial + OEM";
    await repo.update("proposal_templates", id, { calc: t.calc });
  }
  const snap = { code: "oem_essencial", name: "Ads Essencial + OEM", cycle: "annual", listPrice: 5964, limits: { accounts: 3, oemPerMonth: 200 } };
  const sub = (id, customer, status, name = snap.name) => repo.create("subscriptions", { id, saas: "leverads", customer, status, planCode: "oem_essencial", plan: ID, periodStart: "2026-10-01", price: 5964, planSnapshot: { ...snap, name } });
  const cli = (id, plan, extra = {}) => repo.create("customers", { id, saas: "leverads", name: id, planCode: "oem_essencial", planCycle: "anual", plan, planSnapshot: { ...snap }, ...extra });
  await cli("cu_ads", "Ads Essencial + OEM · Anual");
  await cli("cu_antigo", "Lever OEM · Essencial · Semestral", { planCycle: "semestral" });
  await cli("cu_mao", "Plano negociado na call");
  await cli("cu_outro", "Ads Escala · Anual", { planCode: "ads_escala", planSnapshot: { code: "ads_escala", name: "Ads Escala" } });
  await sub("su_ativa", "cu_ads", "active");
  await sub("su_atraso", "cu_antigo", "past_due", "Lever OEM · Essencial");
  await sub("su_cancelada", "cu_mao", "canceled");
  return repo;
}

const opts = { saas: "leverads", code: "oem_essencial", name: "LeverOEM Essencial", aliases: ["Ads Essencial + OEM", "Lever OEM · Essencial"] };

test("ensaio: diz o que mudaria e não grava nada", async () => {
  const repo = await seededRepo();
  const r = await renamePlan(repo, opts);
  assert.equal(r.from, "Ads Essencial + OEM");
  assert.equal(r.planRenamed, true);
  assert.deepEqual(r.subscriptions.map((s) => s.id).sort(), ["su_ativa", "su_atraso"], "assinatura cancelada fica de fora");
  assert.deepEqual(r.customers.map((c) => [c.id, c.to]).sort(), [
    ["cu_ads", "LeverOEM Essencial · Anual"],
    ["cu_antigo", "LeverOEM Essencial · Semestral"],
    ["cu_mao", "Plano negociado na call"],
  ]);
  assert.deepEqual(r.labelsKept.map((k) => k.id), ["cu_mao"]);
  assert.equal((await repo.get("plans", ID)).name, "Ads Essencial + OEM");
  assert.equal((await repo.get("customers", "cu_ads")).plan, "Ads Essencial + OEM · Anual");
  assert.equal((await repo.get("subscriptions", "su_ativa")).planSnapshot.name, "Ads Essencial + OEM");
});

test("para valer: plano, apresentações, assinaturas vivas e clientes com o nome novo; histórico, preço e limites ficam", async () => {
  const repo = await seededRepo();
  const antes = await repo.get("plans", ID);
  await renamePlan(repo, { ...opts, apply: true });

  const plano = await repo.get("plans", ID);
  assert.equal(plano.name, "LeverOEM Essencial");
  assert.equal(plano.priceVersion, antes.priceVersion, "o nome sozinho não sobe a versão de preço");
  for (const id of ["pt_leverads", "pt_leverads_slides"]) {
    assert.equal((await repo.get("proposal_templates", id)).calc.catalog.products.oem_essencial.name, "LeverOEM Essencial", id);
  }

  const ativa = await repo.get("subscriptions", "su_ativa");
  assert.equal(ativa.planSnapshot.name, "LeverOEM Essencial");
  assert.equal(ativa.planSnapshot.listPrice, 5964);
  assert.deepEqual(ativa.planSnapshot.limits, { accounts: 3, oemPerMonth: 200 });
  assert.equal((await repo.get("subscriptions", "su_atraso")).planSnapshot.name, "LeverOEM Essencial");
  assert.equal((await repo.get("subscriptions", "su_cancelada")).planSnapshot.name, "Ads Essencial + OEM", "assinatura encerrada é registro");

  assert.equal((await repo.get("customers", "cu_ads")).plan, "LeverOEM Essencial · Anual");
  assert.equal((await repo.get("customers", "cu_ads")).planSnapshot.name, "LeverOEM Essencial");
  assert.equal((await repo.get("customers", "cu_antigo")).plan, "LeverOEM Essencial · Semestral", "nome de antes de 02/10 também troca");
  assert.equal((await repo.get("customers", "cu_mao")).plan, "Plano negociado na call", "rótulo escrito à mão fica");
  assert.equal((await repo.get("customers", "cu_mao")).planSnapshot.name, "LeverOEM Essencial");
  assert.equal((await repo.get("customers", "cu_outro")).plan, "Ads Escala · Anual", "cliente de outro plano não é tocado");

  // A próxima sincronização da assinatura não devolve o nome antigo ao cadastro.
  await syncCustomerPlanFromSub(repo, ativa);
  assert.equal((await repo.get("customers", "cu_ads")).plan, "LeverOEM Essencial · Anual");

  // Rodar de novo não muda nada.
  const de_novo = await renamePlan(repo, { ...opts, apply: true });
  assert.equal(de_novo.planRenamed, false);
  assert.deepEqual([de_novo.subscriptions.length, de_novo.customers.length], [0, 0]);
});

test("apelido que é começo de outro não corta o rótulo no meio", async () => {
  const repo = await seededRepo();
  // "Lever OEM" é começo de "Lever OEM · Essencial": o mais longo vale primeiro.
  const r = await renamePlan(repo, { ...opts, aliases: ["Lever OEM", "Lever OEM · Essencial"] });
  assert.equal(r.customers.find((c) => c.id === "cu_antigo").to, "LeverOEM Essencial · Semestral");
});

test("plano que não existe é erro, e nome vazio também", async () => {
  const repo = await seededRepo();
  await assert.rejects(renamePlan(repo, { ...opts, code: "oem_nao_existe" }), /não existe/);
  await assert.rejects(renamePlan(repo, { ...opts, name: "  " }), /vazio/);
});
