// Configuração da apresentação em slides no card de Atividades (06/10/2026).
// O que este teste protege: a tela zero do closer usa os planos de HOJE (a
// projeção de Comercial → Planos no template), não a tabela copiada quando a
// proposta nasceu; as escolhas saem do catálogo, sem lista fixa de pacotes; a
// rota autenticada do lead lê e grava a mesma configuração do PATCH público; e
// o link do cliente continua com a oferta congelada no envio.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureSlidesDeck } = await import("../src/platform/migrations.js");
const { runNativeProposal } = await import("../src/proposals/proposal.js");
const { registerProposalRoutes } = await import("../src/proposals/routes.proposals.js");
const { registerLeadProposalRoutes } = await import("../src/proposals/routes.lead-proposals.js");
const { deckConfig } = await import("../src/proposals/proposal-slides-page.js");
const { deckChoices } = await import("../src/shared/deck-offer.js");

const TEMPLATE = {
  id: "pt_leverads", saas: "leverads", name: "Proposta · LeverAds", status: "published",
  theme: {}, calc: { seatsKey: "accounts", seatsMap: { "1": 2, "2": 2, "3-5": 4, "6-10": 8, "10+": 12 }, plans: {}, defaultCycle: "annual" },
  slides: [{ key: "hero", type: "hero", bg: "", title: "Capa" }],
};

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  await ensureSlidesDeck(repo);
  const lead = await repo.create("leads", { id: "ld_cfg", saas: "leverads", name: "Ana Souza", company: "Ana Peças", accounts: "3-5" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_slides" });
  assert.equal(r.ok, true);
  const app = Fastify();
  registerProposalRoutes(app, repo);
  registerLeadProposalRoutes(app, repo);
  return { repo, app, proposal: r.proposal };
}

// O admin mexe nos planos DEPOIS de a proposta nascer: a projeção regrava o
// catálogo do template (aqui, direto no template, que é o que ela faz).
async function editPlans(repo, edit) {
  const t = await repo.get("proposal_templates", "pt_leverads_slides");
  const catalog = JSON.parse(JSON.stringify(t.calc.catalog));
  edit(catalog.products);
  await repo.update("proposal_templates", t.id, { calc: { ...t.calc, catalog } });
}

test("as escolhas saem do catálogo: plano novo entra com o nome dele, sem lista fixa de pacotes", () => {
  const c = deckChoices({
    lines: { ads: { name: "Lever Ads" }, oem: { name: "Lever OEM" } },
    products: {
      ads_essencial: { line: "ads", tier: "essencial", name: "Ads Essencial", contas: 3, anu: { per: 497 }, sem: { per: 597 } },
      ads_enterprise: { line: "ads", tier: "enterprise", name: "Ads Enterprise", contas: 20, anu: { per: 2997 }, sem: { per: 3297 } },
      oem_escala: { line: "oem", tier: "escala", name: "Ads Escala + OEM", contas: 6, anu: { per: 997 } },
      price_escala: { line: "price", tier: "escala", name: "Lever Price · Escala", anu: { per: 297 } },
      promo: { line: "", name: "Fora do padrão" },
    },
    oemPacks: [{ qty: 1000, price: 4000 }, { qty: 0, price: 1 }],
  });
  assert.deepEqual(c.plataforma.map((x) => [x.key, x.name, x.group]), [
    ["ads_essencial", "Ads Essencial", "Lever Ads"],
    ["ads_enterprise", "Ads Enterprise", "Lever Ads"],
    ["oem_escala", "Ads Escala + OEM", "Lever OEM"],
  ], "chave fora de <linha>_<pacote> não entra");
  assert.deepEqual(c.price.map((x) => x.tier), ["escala"]);
  assert.equal(c.plataforma[0].semestral, 597);
  assert.deepEqual(c.oemPacks, [{ qty: 1000, price: 4000 }]);
});

test("com catálogo, a configuração só aceita plano que ele vende", () => {
  const catalog = {
    products: {
      ads_essencial: { line: "ads", tier: "essencial", name: "Ads Essencial" },
      ads_enterprise: { line: "ads", tier: "enterprise", name: "Ads Enterprise" },
      price_escala: { line: "price", tier: "escala", name: "Price Escala" },
    },
    oemPacks: [{ qty: 2000, price: 7000 }],
  };
  const ok = deckConfig({ state: { deckC: { linha: "ads", tier: "enterprise", priceTier: "escala", oemPack: "2000" } } }, { catalog });
  assert.equal(ok.tier, "enterprise", "pacote do catálogo além de Essencial/Escala vale");
  const sujo = deckConfig({ state: { deckC: { linha: "oem", tier: "ouro", priceTier: "essencial", oemPack: "1000" } } }, { catalog, suggested: "ads_essencial" });
  assert.equal(sujo.linha + "_" + sujo.tier, "ads_essencial", "fora do catálogo cai na sugestão");
  assert.equal(sujo.priceTier, "escala");
  assert.equal(sujo.oemPack, "2000");
});

test("o card lê os planos de hoje e grava a mesma configuração do PATCH público", async () => {
  const { repo, app, proposal } = await setup();
  await editPlans(repo, (products) => {
    products.ads_essencial.name = "Ads Essencial 2026";
    products.ads_essencial.anu = { per: 555, total: 6660 };
    products.ads_enterprise = { ...products.ads_escala, tier: "enterprise", name: "Ads Enterprise", contas: 20, anu: { per: 2997, total: 35964 }, sem: { per: 3297, total: 19782 } };
  });

  const get = await app.inject({ url: "/api/leads/ld_cfg/proposal-config" });
  assert.equal(get.statusCode, 200);
  const body = get.json();
  assert.equal(body.layout, "slides");
  assert.equal(body.proposal, proposal.id);
  assert.equal(body.catalog.products.ads_essencial.name, "Ads Essencial 2026", "nome do plano de hoje");
  assert.equal(body.catalog.products.ads_essencial.anu.per, 555, "preço do plano de hoje");
  assert.ok(body.catalog.products.ads_enterprise, "plano novo aparece");
  assert.equal(body.cfg.empresa, "Ana Peças");
  assert.equal((await repo.get("proposals", proposal.id)).calc.catalog.products.ads_essencial.name, "Ads Essencial 2026",
    "a proposta de trabalho passa a carregar a tabela de hoje");

  const put = await app.inject({ method: "PUT", url: "/api/leads/ld_cfg/proposal-config", payload: { deckC: { ...body.cfg, linha: "ads", tier: "enterprise", periodo: "semestral", pedidos: 400 } } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().cfg.tier, "enterprise");
  const p = await repo.get("proposals", proposal.id);
  assert.equal(p.state.product, "ads_enterprise", "o plano escolhido é o produto da venda");
  assert.equal(p.state.cycle, "semiannual");
  assert.equal(p.state.deckC.pedidos, 400);
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 35964, "o valor do card acompanha o plano (anual do produto ativo)");

  const closer = await app.inject({ url: `/p/${proposal.id}?k=${proposal.editKey}&embed=config` });
  assert.match(closer.body, /Ads Essencial 2026/, "o iframe do deck mostra o mesmo catálogo");

  // Enviado ao cliente com o preço de hoje e congelado: a próxima mudança de
  // plano não mexe no número que ele já viu.
  const share = await app.inject({ method: "POST", url: "/api/leads/ld_cfg/proposal-share", payload: { offer: 1 } });
  assert.equal(share.statusCode, 200);
  const shared = await repo.get("proposals", share.json().id);
  assert.equal(shared.state.deckOferta.mensalFmt, "3.297");
  await editPlans(repo, (products) => { products.ads_enterprise.sem = { per: 9999, total: 59994 }; });
  const cliente = await app.inject({ url: `/p/${shared.id}` });
  assert.doesNotMatch(cliente.body, /9\.999/);
  assert.equal((await repo.get("proposals", shared.id)).calc.catalog, undefined, "o link do cliente não carrega tabela");
});

test("sem apresentação em slides, o card segue no iframe", async () => {
  const { repo, app } = await setup();
  await repo.create("leads", { id: "ld_sem", saas: "leverads", name: "Sem proposta" });
  assert.deepEqual((await app.inject({ url: "/api/leads/ld_sem/proposal-config" })).json(), { proposal: null, layout: "" });
  await repo.create("proposals", { id: "pr_oem", saas: "leverads", layout: "oem", editKey: "k", lead: "ld_oem", state: {}, calc: {} });
  await repo.create("leads", { id: "ld_oem", saas: "leverads", name: "OEM", proposta_id: "pr_oem" });
  assert.deepEqual((await app.inject({ url: "/api/leads/ld_oem/proposal-config" })).json(), { proposal: null, layout: "oem" });
  const put = await app.inject({ method: "PUT", url: "/api/leads/ld_oem/proposal-config", payload: { deckC: {} } });
  assert.equal(put.statusCode, 409);
  assert.equal((await app.inject({ url: "/api/leads/nao_existe/proposal-config" })).statusCode, 404);
});
