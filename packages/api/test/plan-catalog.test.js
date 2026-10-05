// Catálogo de PLANOS como fonte única (coleção `plans`, v2): a semente nasce do
// catálogo que está no template de proposta, o `calc.catalog` vira projeção
// dos planos, o gate de fechamento lê dos planos e só admin mexe em preço.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeScreenGuardHook } from "../src/screens.js";
import { dealCatalog } from "../src/proposal-catalog.js";
import { mentoriaDealCatalog } from "../src/mentoria.js";
import {
  catalogToPlans, catalogToConfig, mentoriaToPlans, plansToCatalog, plansToMentoriaBlock,
  dealCatalogFromPlans, ensurePlansCatalog, syncPlanCatalogProjection, nextPlan, sameJson, planIdOf,
} from "../src/plan-catalog.js";

const { ensureProposalCatalog, migrateCatalogPricing, ensureMentoriaTemplate } = await import("../src/migrations.js");
const { registerRoutes } = await import("../src/routes.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

// Banco no estado de produção antes da semente: pt_leverads com o catálogo v2
// (pela migração de verdade), o deck oficial gêmeo e o template da mentoria.
async function seededRepo({ plans = true } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  const base = await repo.get("proposal_templates", "pt_leverads");
  await repo.create("proposal_templates", { id: "pt_leverads_slides", saas: "leverads", status: "published", calc: clone(base.calc), slides: [] });
  await ensureMentoriaTemplate(repo);
  if (plans) await ensurePlansCatalog(repo);
  return repo;
}
const catalogOf = async (repo, id = "pt_leverads") => (await repo.get("proposal_templates", id)).calc.catalog;

function providedKey(req) {
  const h = req.headers["x-api-key"];
  return h ? (Array.isArray(h) ? h[0] : h) : "";
}
async function buildApp(repo) {
  await seedTestAdmins(repo);
  await repo.create("users", { id: "chefe", name: "Chefe", roles: ["admin"], screens: [], passwordHash: hashPassword("1234") });
  await repo.create("users", { id: "closer", name: "Closer", roles: ["closer"], screens: [], passwordHash: hashPassword("1234") });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey,
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  const login = async (username) => ({
    "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "1234" } })).json().token,
  });
  return { app, admin: await login("chefe"), closer: await login("closer"), key: { "x-api-key": "test-key" } };
}

test("ida e volta: catálogo → planos → catálogo devolve produtos, linhas, adicionais e pacotes iguais", async () => {
  const repo = await seededRepo({ plans: false });
  const cat = await catalogOf(repo);
  const plans = catalogToPlans(cat, { saas: "leverads" }).map((d) => nextPlan(null, d));
  const back = plansToCatalog(plans, catalogToConfig(cat), cat);
  for (const k of ["products", "lines", "addons", "oemPacks", "tierByAccounts"]) assert.deepEqual(back[k], cat[k], k);
  // Régua, dores/SPIN e marcadores de versão não são do plano: ficam como estavam.
  assert.deepEqual(back.pains, cat.pains);
  assert.deepEqual(back.grid, cat.grid);
  assert.equal(back.pricingV, cat.pricingV);
  assert.ok(sameJson(back, cat));
});

test("planos derivados: limites normalizados, produto de acesso por linha, Enterprise sob consulta e legados arquivados", async () => {
  const repo = await seededRepo({ plans: false });
  const plans = Object.fromEntries(catalogToPlans(await catalogOf(repo), { saas: "leverads" }).map((p) => [p.code, p]));
  assert.equal(plans.oem_escala.id, "plan_leverads_oem_escala");
  assert.deepEqual(plans.oem_escala.limits, { accounts: 7, oemPerMonth: null }); // cota 0 = ilimitado
  assert.deepEqual(plans.oem_essencial.limits, { accounts: 3, oemPerMonth: 200 });
  assert.deepEqual(plans.price_enterprise.limits, { listings: null });
  assert.deepEqual(plans.ads_escala.features, { equalizacao: true });
  assert.equal(plans.ads_escala.access.product, "leverads");
  assert.equal(plans.price_escala.access.product, "leverprice");
  assert.deepEqual(plans.oem_escala.prices.annual, { total: 11988, per: 999, installments: 12 });
  assert.equal(plans.oem_enterprise.pricing, "custom");
  assert.equal(plans.ads_enterprise.pricing, "custom");
  assert.equal(plans.oem_pack.kind, "one_off");
  assert.equal(plans.oem_pack.options.length, 3);
  assert.equal(plans.full.kind, "legacy");
  assert.equal(plans.full.status, "archived");
});

test("gate de fechamento: o catálogo vindo dos planos é IGUAL ao que saía dos templates", async () => {
  const repo = await seededRepo();
  const plans = (await repo.list("plans"));
  const fromTemplates = [
    ...dealCatalog((await repo.get("proposal_templates", "pt_leverads")).calc),
    ...mentoriaDealCatalog((await repo.get("proposal_templates", "pt_mentoria")).calc),
  ];
  assert.deepEqual(dealCatalogFromPlans(plans), fromTemplates);
  // Enterprise sob consulta e legado não são vendáveis pelo select.
  const ids = dealCatalogFromPlans(plans).map((r) => r.id);
  for (const id of ["oem_enterprise", "ads_enterprise", "full"]) assert.ok(!ids.includes(id), id);
});

test("mentoria: ida e volta do bloco de preços", async () => {
  const repo = await seededRepo({ plans: false });
  const block = (await repo.get("proposal_templates", "pt_mentoria")).calc.mentoria;
  const plans = mentoriaToPlans(block).map((d) => nextPlan(null, d));
  assert.deepEqual(plansToMentoriaBlock(plans, block), block);
  assert.equal(plans[0].kind, "one_off");
  assert.equal(plans[0].access.product, "");
});

test("semente: idempotente, fiel ao preço que está no banco e sem regravar template", async () => {
  const repo = await seededRepo({ plans: false });
  // Preço editado pelo dono no banco antes da semente: é ele que vira o plano.
  const t = await repo.get("proposal_templates", "pt_leverads");
  const calc = clone(t.calc);
  calc.catalog.products.oem_escala.anu = { total: 13188, per: 1099 };
  await repo.update("proposal_templates", "pt_leverads", { calc });
  await repo.update("proposal_templates", "pt_leverads_slides", { calc: clone(calc) });

  const created = await ensurePlansCatalog(repo);
  assert.ok(created > 0);
  assert.equal((await repo.get("plans", "plan_leverads_oem_escala")).prices.annual.total, 13188);
  assert.equal((await repo.get("plans", "plan_leverads_men_curso")).prices.once.total, 1000);
  assert.ok(await repo.get("app_config", "plan_catalog_leverads"));
  assert.equal(await ensurePlansCatalog(repo), 0, "segunda rodada não cria nada");
  // A projeção logo após a semente não tem o que mudar, e a migração de preço
  // antiga continua sem efeito (o marcador pricingV foi preservado).
  const rev = repo.writeRev();
  assert.equal(await syncPlanCatalogProjection(repo, "leverads"), 0);
  assert.equal(repo.writeRev(), rev);
  assert.equal(await migrateCatalogPricing(repo), false);
});

test("preço mudado no PLANO chega aos dois templates e ao gate; proposta já gerada não muda", async (t) => {
  const repo = await seededRepo();
  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  const frozen = clone((await repo.get("proposal_templates", "pt_leverads")).calc);
  await repo.create("proposals", { id: "pr_1", saas: "leverads", template: "pt_leverads_slides", calc: frozen });

  const res = await app.inject({
    method: "PATCH", url: "/api/plans/plan_leverads_oem_escala", headers: admin,
    payload: { prices: { annual: { per: 1099 }, semiannual: { per: 1297 } }, code: "outro", saas: "elo" },
  });
  assert.equal(res.statusCode, 200);
  const plan = res.json();
  assert.equal(plan.code, "oem_escala", "código não muda");
  assert.equal(plan.saas, "leverads", "produto não muda");
  assert.deepEqual(plan.prices.annual, { per: 1099, total: 13188, installments: 12 });
  assert.equal(plan.priceVersion, 2);
  assert.equal(plan.priceLog.length, 2);
  assert.equal(plan.priceLog[1].by, "chefe");
  assert.equal(plan.price, 13188, "espelho legado acompanha");
  assert.equal(plan.cycle, "annual");

  for (const id of ["pt_leverads", "pt_leverads_slides"]) {
    const P = (await catalogOf(repo, id)).products.oem_escala;
    assert.deepEqual(P.anu, { per: 1099, total: 13188 }, id);
    assert.deepEqual(P.sem, { per: 1297, total: 7782 }, id);
  }
  const seed = (await app.inject({ url: "/api/bootstrap", headers: admin })).json();
  const row = seed.CONFIG.proposals.catalog.leverads.find((r) => r.id === "oem_escala");
  assert.deepEqual(row.prices.map((p) => p.value), [13188, 7782]);
  assert.equal(seed.CONFIG.plans.leverads.find((p) => p.code === "oem_escala").priceVersion, 2);
  assert.deepEqual((await repo.get("proposals", "pr_1")).calc, frozen, "snapshot da proposta intocado");

  // Edição que não toca preço/limite não sobe a versão.
  const renamed = (await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_oem_escala", headers: admin, payload: { name: "Ads Escala + OEM+" } })).json();
  assert.equal(renamed.priceVersion, 2);
  assert.equal((await catalogOf(repo)).products.oem_escala.name, "Ads Escala + OEM+");
});

test("tabela de preço editada pelo template (tela de Propostas) vira mudança no plano e espelha no gêmeo", async (t) => {
  const repo = await seededRepo();
  const { app, admin, closer } = await buildApp(repo);
  t.after(() => app.close());
  const calc = clone((await repo.get("proposal_templates", "pt_leverads_slides")).calc);
  calc.catalog.products.ads_essencial.anu = { total: 6564, per: 547 };
  calc.catalog.addons.contaExtra.per = 120;

  const denied = await app.inject({ method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides", headers: closer, payload: { calc } });
  assert.equal(denied.statusCode, 403, "preço é coisa de admin");
  assert.equal((await repo.get("plans", "plan_leverads_ads_essencial")).prices.annual.total, 5964);

  const ok = await app.inject({ method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides", headers: admin, payload: { calc } });
  assert.equal(ok.statusCode, 200);
  const plan = await repo.get("plans", "plan_leverads_ads_essencial");
  assert.equal(plan.prices.annual.total, 6564);
  assert.equal(plan.priceVersion, 2);
  assert.equal((await repo.get("plans", "plan_leverads_ads_escala")).priceVersion, 1, "quem não mudou não sobe versão");
  assert.equal((await repo.get("app_config", "plan_catalog_leverads")).addons.contaExtra.per, 120);
  assert.equal((await catalogOf(repo, "pt_leverads")).products.ads_essencial.anu.total, 6564);
  assert.equal((await catalogOf(repo, "pt_leverads")).addons.contaExtra.per, 120);

  // Editar o que NÃO é preço (slides, dores) segue liberado pra quem tem a tela.
  const calc2 = clone((await repo.get("proposal_templates", "pt_leverads_slides")).calc);
  calc2.catalog.pains.A.label = "Outro rótulo";
  const free = await app.inject({ method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides", headers: closer, payload: { calc: calc2, name: "Deck" } });
  assert.equal(free.statusCode, 200);
});

test("só admin escreve plano do catálogo; a key mestre passa; o cadastro antigo segue livre", async (t) => {
  const repo = await seededRepo();
  const { app, admin, closer, key } = await buildApp(repo);
  t.after(() => app.close());
  const novo = { saas: "leverads", code: "ads_plus", name: "Lever Ads · Plus", line: "ads", tier: "plus", prices: { annual: { per: 1500 } }, limits: { accounts: 10 } };

  assert.equal((await app.inject({ method: "POST", url: "/api/plans", headers: closer, payload: novo })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_oem_escala", headers: closer, payload: { name: "X" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/plans/plan_leverads_oem_escala", headers: closer })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/app_config/plan_catalog_leverads", headers: closer, payload: { addons: {} } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/plans?saas=leverads", headers: closer })).statusCode, 200, "ler pode");

  const created = await app.inject({ method: "POST", url: "/api/plans", headers: admin, payload: novo });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().id, planIdOf("leverads", "ads_plus"));
  assert.equal(created.json().prices.annual.total, 18000);
  assert.equal((await catalogOf(repo)).products.ads_plus.contas, 10, "plano novo entra na projeção");
  assert.equal((await app.inject({ method: "POST", url: "/api/plans", headers: admin, payload: novo })).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/plans", headers: admin, payload: { ...novo, code: "tem espaço" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_ads_plus", headers: key, payload: { status: "archived" } })).statusCode, 200);
  assert.equal((await catalogOf(repo)).products.ads_plus, undefined, "arquivado sai do que se vende");

  // Cadastro antigo (sem code): caminho genérico de sempre, sem exigir admin.
  const old = await app.inject({ method: "POST", url: "/api/plans", headers: closer, payload: { saas: "leverads", name: "Avulso", price: 100, cycle: "monthly" } });
  assert.equal(old.statusCode, 201);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/plans/${old.json().id}`, headers: closer })).statusCode, 200);
});

test("plano em uso não se apaga (409); sem uso sai do catálogo e da projeção", async (t) => {
  const repo = await seededRepo();
  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente", dealProduct: "oem_escala" });
  const inUse = await app.inject({ method: "DELETE", url: "/api/plans/plan_leverads_oem_escala", headers: admin });
  assert.equal(inUse.statusCode, 409);
  assert.equal(inUse.json().refs.customers, 1);
  assert.ok(await repo.get("plans", "plan_leverads_oem_escala"));

  const gone = await app.inject({ method: "DELETE", url: "/api/plans/plan_leverads_price_enterprise", headers: admin });
  assert.equal(gone.statusCode, 200);
  assert.equal((await catalogOf(repo)).products.price_enterprise, undefined);
  assert.equal((await catalogOf(repo, "pt_leverads_slides")).products.price_enterprise, undefined);
});

test("régua e adicionais do catálogo (app_config) editados pelo admin chegam aos templates", async (t) => {
  const repo = await seededRepo();
  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  const cfg = await repo.get("app_config", "plan_catalog_leverads");
  const res = await app.inject({
    method: "PATCH", url: "/api/app_config/plan_catalog_leverads", headers: admin,
    payload: { tierByAccounts: { ...cfg.tierByAccounts, "4-6": "escala" } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await catalogOf(repo)).tierByAccounts["4-6"], "escala");
  assert.equal((await catalogOf(repo, "pt_leverads_slides")).tierByAccounts["4-6"], "escala");
});

test("banco sem planos semeados: bootstrap e edição de template seguem pelo caminho antigo", async (t) => {
  const repo = await seededRepo({ plans: false });
  const { app, closer } = await buildApp(repo);
  t.after(() => app.close());
  const seed = (await app.inject({ url: "/api/bootstrap", headers: closer })).json();
  assert.deepEqual(seed.CONFIG.proposals.catalog.leverads, [
    ...dealCatalog((await repo.get("proposal_templates", "pt_leverads_slides")).calc),
    ...mentoriaDealCatalog((await repo.get("proposal_templates", "pt_mentoria")).calc),
  ]);
  assert.deepEqual(seed.CONFIG.plans, {});
  const calc = clone((await repo.get("proposal_templates", "pt_leverads_slides")).calc);
  calc.catalog.products.ads_essencial.anu = { total: 6564, per: 547 };
  assert.equal((await app.inject({ method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides", headers: closer, payload: { calc } })).statusCode, 200);
  assert.equal((await catalogOf(repo, "pt_leverads")).products.ads_essencial.anu.total, 6564, "espelho do gêmeo continua");
  assert.equal((await repo.list("plans")).length, 0);
});

test("recursos do LeverAds: migração preenche cópias/dia e módulos uma vez; edição pelo template não os apaga", async (t) => {
  const { ensurePlanResources } = await import("../src/plan-catalog.js");
  const repo = await seededRepo();
  assert.equal(await ensurePlanResources(repo), 4, "os quatro planos de assinatura do LeverAds (OEM e Ads × Essencial e Escala)");
  const ads = await repo.get("plans", "plan_leverads_ads_essencial");
  const oem = await repo.get("plans", "plan_leverads_oem_escala");
  assert.deepEqual(ads.limits, { accounts: 3, copiesPerDay: 500 }, "Essencial: 500 por dia");
  assert.equal(ads.features.oemCreator, false);
  assert.equal(ads.features.stockMirror, true);
  assert.equal(ads.features.equalizacao, false, "campo do deck segue como estava");
  assert.deepEqual(oem.limits, { accounts: 7, oemPerMonth: null, copiesPerDay: 8000 });
  assert.deepEqual((await repo.get("plans", "plan_leverads_oem_essencial")).limits, { accounts: 3, oemPerMonth: 200, copiesPerDay: 500 });
  assert.equal(oem.features.oemCreator, true);
  assert.equal(oem.prices.annual.total, 11988, "preço não muda");
  // Price, Enterprise sob consulta, pacote avulso e mentoria ficam de fora.
  for (const id of ["plan_leverads_price_escala", "plan_leverads_oem_enterprise", "plan_leverads_oem_pack", "plan_leverads_men_curso"]) {
    assert.equal("copiesPerDay" in ((await repo.get("plans", id)).limits || {}), false, id);
  }
  assert.equal(await ensurePlanResources(repo), null, "roda uma vez por plano");
  // O catálogo das apresentações não ganha campo novo.
  assert.equal(await syncPlanCatalogProjection(repo, "leverads"), 0);

  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  const calc = clone((await repo.get("proposal_templates", "pt_leverads_slides")).calc);
  calc.catalog.products.ads_essencial.contas = 4;
  assert.equal((await app.inject({ method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides", headers: admin, payload: { calc } })).statusCode, 200);
  const after = await repo.get("plans", "plan_leverads_ads_essencial");
  assert.deepEqual(after.limits, { accounts: 4, copiesPerDay: 500 });
  assert.equal(after.features.stockMirror, true);
  assert.equal(after.features.oemCreator, false);
  // Admin desliga um módulo no plano: vale no bootstrap enxuto.
  await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_ads_essencial", headers: admin, payload: { features: { ...after.features, compat: false } } });
  const seed = (await app.inject({ url: "/api/bootstrap", headers: admin })).json();
  assert.equal(seed.CONFIG.plans.leverads.find((p) => p.code === "ads_essencial").features.compat, false);
});

test("produto do plano: LeverAds, LeverPrice e Mentoria; o produto define o acesso da assinatura", async (t) => {
  const { planProductOf, planAccessOf } = await import("../src/plan-resources.js");
  const repo = await seededRepo();
  const by = Object.fromEntries((await repo.list("plans")).map((p) => [p.code, p]));
  assert.equal(by.oem_escala.product, "leverads");
  assert.equal(by.ads_essencial.product, "leverads");
  assert.equal(by.oem_pack.product, "leverads");
  assert.equal(by.price_escala.product, "leverprice");
  assert.equal(by.men_curso.product, "mentoria");
  assert.equal(planProductOf({ line: "price" }), "leverprice", "plano sem o campo cai pela linha");
  assert.equal(planAccessOf("mentoria", "subscription"), "");
  assert.equal(planAccessOf("leverads", "one_off"), "", "compra única não libera sistema");

  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/api/plans", headers: admin, payload: { saas: "leverads", code: "price_plus", name: "Lever Price · Plus", product: "leverprice", prices: { annual: { per: 2000 } } } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().product, "leverprice");
  assert.deepEqual(res.json().access, { product: "leverprice" });
  const seed = (await app.inject({ url: "/api/bootstrap", headers: admin })).json();
  assert.equal(seed.CONFIG.plans.leverads.find((p) => p.code === "men_curso").product, "mentoria");
});

test("nomes da planilha: plano semeado com o nome antigo é renomeado uma vez; nome editado pelo admin fica", async () => {
  const { ensurePlanResources } = await import("../src/plan-catalog.js");
  const repo = await seededRepo();
  // Estado de produção: os planos nasceram do catálogo com os nomes antigos.
  await repo.update("plans", "plan_leverads_oem_escala", { name: "Lever OEM \u00b7 Escala" });
  await repo.update("plans", "plan_leverads_ads_essencial", { name: "Lever Ads \u00b7 Essencial" });
  await repo.update("plans", "plan_leverads_oem_enterprise", { name: "Lever OEM \u00b7 Enterprise" });
  await repo.update("plans", "plan_leverads_ads_escala", { name: "Plano do Leo" });
  await ensurePlanResources(repo);
  const name = async (code) => (await repo.get("plans", `plan_leverads_${code}`)).name;
  assert.equal(await name("oem_escala"), "Ads Escala + OEM");
  assert.equal(await name("ads_essencial"), "Ads Essencial");
  assert.equal(await name("oem_enterprise"), "Ads Enterprise + OEM", "sob consulta também é renomeado");
  assert.equal(await name("ads_enterprise"), "Ads Enterprise");
  assert.equal(await name("ads_escala"), "Plano do Leo");
  assert.equal((await repo.get("plans", "plan_leverads_oem_escala")).priceVersion, 2, "limites novos sobem a versão; o nome sozinho não");
  assert.equal((await repo.get("plans", "plan_leverads_oem_enterprise")).priceVersion, 1);
  // O nome novo chega à apresentação e ao gate de fechamento.
  await syncPlanCatalogProjection(repo, "leverads");
  assert.equal((await catalogOf(repo, "pt_leverads_slides")).products.oem_escala.name, "Ads Escala + OEM");
  assert.equal(dealCatalogFromPlans(await repo.list("plans")).find((r) => r.id === "ads_essencial").label, "Ads Essencial");
});

test("banco sem template de proposta (ambiente novo): os planos do LeverAds nascem do catálogo padrão, mesmo depois da Mentoria", async () => {
  const { runStartupMigrations } = await import("../src/migrations.js");
  const { ensurePlanResources } = await import("../src/plan-catalog.js");
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Ganho", kind: "ganho" }] });
  // Estado em que o banco local ficou: só a Mentoria semeada e o marcador antigo dos recursos gravado.
  await ensureMentoriaTemplate(repo);
  await ensurePlansCatalog(repo);
  await repo.create("app_config", { id: "plan_resources_v1", at: "2026-10-02T12:00:00.000Z", changed: 0 });
  assert.equal((await repo.list("plans")).length, 7, "só os planos da Mentoria");

  const log = console.log; console.log = () => {};
  try { await runStartupMigrations(repo); } finally { console.log = log; }
  const by = Object.fromEntries((await repo.list("plans")).map((p) => [p.code, p]));
  for (const [code, name] of [["ads_essencial", "Ads Essencial"], ["ads_escala", "Ads Escala"], ["ads_enterprise", "Ads Enterprise"],
    ["oem_essencial", "Ads Essencial + OEM"], ["oem_escala", "Ads Escala + OEM"], ["oem_enterprise", "Ads Enterprise + OEM"]]) {
    assert.equal(by[code]?.name, name, code);
  }
  assert.deepEqual(by.oem_essencial.limits, { accounts: 3, oemPerMonth: 200, copiesPerDay: 500 });
  assert.deepEqual(by.ads_escala.limits, { accounts: 7, copiesPerDay: 8000 });
  assert.equal(by.ads_escala.features.oemCreator, false);
  assert.equal(by.oem_escala.features.stockMirror, true);
  assert.equal(by.price_escala.product, "leverprice");
  assert.equal(by.men_curso.product, "mentoria");
  assert.ok(await repo.get("app_config", "plan_catalog_leverads"));
  // Edição do admin depois disso não é desfeita num boot seguinte.
  await repo.update("plans", by.ads_escala.id, { limits: { accounts: 9 } });
  assert.equal(await ensurePlanResources(repo), null);
  assert.deepEqual((await repo.get("plans", by.ads_escala.id)).limits, { accounts: 9 });
});

test("produto que não existe no banco não ganha planos do catálogo padrão", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensurePlansCatalog(repo, { defaults: { leverads: { catalogV: 2, products: {} } } }), 0);
  assert.equal((await repo.list("plans")).length, 0);
});

test("editar plano não troca de produto: o servidor ignora product/access no PATCH", async (t) => {
  const repo = await seededRepo();
  const { app, admin } = await buildApp(repo);
  t.after(() => app.close());
  const res = await app.inject({ method: "PATCH", url: "/api/plans/plan_leverads_ads_escala", headers: admin, payload: { name: "Ads Escala", product: "leverprice", access: { product: "leverprice" } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().product, "leverads");
  assert.deepEqual(res.json().access, { product: "leverads" });
});
