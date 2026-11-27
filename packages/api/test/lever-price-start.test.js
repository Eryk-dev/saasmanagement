// Lever Price · Start (27/11/2026) vendido de ponta a ponta. O plano nasce no
// catálogo (plan-catalog.test.js), entra na apresentação (proposal-catalog e
// proposal-deck-config) e aqui fecha: o Ganho nomeia o plano no cliente, a
// assinatura nasce anual com o retrato do plano (1 conta, teto de anúncios),
// o direito é do LeverPrice e o link de pagamento sai com o nome do plano.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ensurePlansCatalog, ensurePriceStartPlan } from "../src/billing/plan-catalog.js";
import { desiredEntitlements, leveradsLimitFields, plansByCodeOf } from "../src/billing/entitlements.js";
import { PRICE_START_LISTINGS } from "../src/shared/plan-resources.js";
import { readFile } from "node:fs/promises";
import { LEVERADS_DECKS } from "../src/training/flashcard-decks.leverads.js";
import { LEVERADS_COMPANY } from "../src/training/company.leverads.js";
import { buildKnowledgePack, pickFlashcards } from "../src/blog/blog-knowledge.js";

const { ensureProposalCatalog, migrateCatalogPricing } = await import("../src/platform/migrations.js");
const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/payments/mp.js");

const FUNNEL = [{ stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" }];

async function seeded() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", status: "draft", calc: {}, slides: [] });
  await ensureProposalCatalog(repo);
  await migrateCatalogPricing(repo);
  await ensurePlansCatalog(repo);
  await ensurePriceStartPlan(repo);
  return repo;
}

test("fechar o Lever Price · Start pelo gate: plano nomeado no cliente, assinatura anual de R$ 4.200 e direito só do LeverPrice", async (t) => {
  const repo = await seeded();
  const app = Fastify();
  registerRoutes(app, repo);
  t.after(() => app.close());
  await repo.create("leads", { id: "l_start", saas: "leverads", name: "Loja Pequena", stage: "Follow-up", dealProduct: "price_start", planClosed: "anual", amount: 4200, paymentMethod: "pix" });
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l_start", payload: { stage: "Ganho" } });
  assert.equal(res.statusCode, 200);

  const customer = (await repo.list("customers"))[0];
  assert.equal(customer.plan, "Lever Price · Start · Anual");
  assert.equal(customer.planCode, "price_start");
  assert.equal(customer.planCustom, "", "é plano do catálogo, não venda personalizada");
  assert.equal(customer.arr, 4200);
  assert.deepEqual(customer.planSnapshot.limits, { listings: PRICE_START_LISTINGS, accounts: 1 });
  assert.equal(customer.planSnapshot.listPrice, 4200);

  const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
  assert.deepEqual(subs.map((s) => [s.planCode, s.cycle, s.price]), [["price_start", "annual", 4200]]);

  // O plano libera o LeverPrice; a conta do plano não vira assento na org do LeverAds.
  const [ent] = desiredEntitlements(customer, subs, plansByCodeOf(await repo.list("plans")));
  assert.equal(ent.product, "leverprice");
  assert.equal(ent.planName, "Lever Price · Start");
  assert.deepEqual(ent.limits, { listings: PRICE_START_LISTINGS, accounts: 1 });
  assert.deepEqual(leveradsLimitFields(ent), { leverprice_enabled: true });
});

test("link de pagamento do Start sai com o nome do plano e carimba o produto no lead", async (t) => {
  const repo = await seeded();
  let preferencia = null;
  const fetch = async (url, init = {}) => {
    if (new URL(url).pathname === "/checkout/preferences" && (init.method || "GET") === "POST") {
      preferencia = JSON.parse(init.body);
      return { status: 200, text: async () => JSON.stringify({ id: "pref_1", init_point: "https://mp.com/pay/pref_1" }) };
    }
    return { status: 404, text: async () => "{}" };
  };
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({ fetch, accessToken: "test-token" }) });
  t.after(() => app.close());
  await repo.create("leads", { id: "l_link", saas: "leverads", name: "Loja Pequena", phone: "11999999999", email: "loja@pequena.com", stage: "Follow-up" });

  const res = await app.inject({ method: "POST", url: "/api/leads/l_link/mp/link", payload: { amount: 4200, plan: "anual", product: "price_start" } });
  assert.equal(res.statusCode, 200);
  assert.equal(preferencia.items[0].title, "Lever Price · Start · Plano Anual");
  const lead = await repo.get("leads", "l_link");
  assert.equal(lead.dealProduct, "price_start");
  assert.equal(lead.planClosed, "anual");
  assert.equal(lead.mpChargeTitle, "Lever Price · Start · Plano Anual");
});

test("treinamento: o card do Price ensina o Start com o teto da constante; o manual cita o pacote sem preço", async () => {
  const teto = String(PRICE_START_LISTINGS).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const card = LEVERADS_DECKS.find((c) => c.id === "ger_n_154");
  assert.ok(card.back.includes(`Start (pra quem fatura até uns R$ 50 mil por mês): 1 conta, até ${teto} anúncios, SÓ no anual, R$ 350/mês = R$ 4.200, sem semestral`), card.back);
  assert.match(card.back, /Essencial: até 1\.000 anúncios, anual R\$ 797\/mês/, "os outros pacotes seguem no card");

  // O manual da empresa também vai pro redator do blog, onde preço não entra:
  // o Start é citado pelo nome, sem valor nem limite.
  const modelo = LEVERADS_COMPANY.facts.find((f) => f.k === "Modelo").v;
  assert.match(modelo, /o Lever Price tem ainda o Start, pacote de entrada vendido só no plano anual/);
  assert.doesNotMatch(modelo, /R\$|350|4\.200/);
  assert.doesNotMatch(JSON.stringify(buildKnowledgePack({ pauta: { title: "Lever Price Start precificação" } }).company), /R\$/);
  assert.ok(!pickFlashcards(LEVERADS_DECKS, "Lever Price Start limites preços", 200).some((c) => c.id === "ger_n_154"), "card com preço segue fora do blog");
  // Espelho da SPA (screens/training.jsx): o mesmo texto.
  const web = await readFile(new URL("../../web/src/screens/training.jsx", import.meta.url), "utf8");
  assert.ok(web.includes(modelo), "o Modelo do manual na SPA precisa andar junto com company.leverads.js");
});
