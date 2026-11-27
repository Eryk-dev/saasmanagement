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
const { deckConfig, slimCatalog, proposalSlidesPageHtml } = await import("../src/proposals/proposal-slides-page.js");
const { deckChoices, deckSoAnual, deckPeriodo, deckPricePadrao, calcOferta } = await import("../src/shared/deck-offer.js");
const { ensurePlansCatalog, ensurePriceStartPlan, syncPlanCatalogProjection } = await import("../src/billing/plan-catalog.js");
const { PRICE_START_LISTINGS } = await import("../src/shared/plan-resources.js");

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

// ── Lever Price · Start (27/11/2026): plano só anual e deck só de Price ─────
// Catálogo no formato que a projeção dos planos grava no template: o Start vem
// ANTES do Essencial e não tem `sem`.
const CAT_START = {
  lines: { ads: { name: "Lever Ads" }, price: { name: "Lever Price" } },
  products: {
    ads_essencial: { line: "ads", tier: "essencial", name: "Ads Essencial", contas: 3, anu: { per: 497, total: 5964 }, sem: { per: 597, total: 3582 } },
    price_start: { line: "price", tier: "start", name: "Lever Price · Start", contas: 1, limite: 1000, anu: { per: 350, total: 4200 }, inclui: { motor: ["Precificação automática"], plataforma: ["1 conta conectada"] } },
    price_essencial: { line: "price", tier: "essencial", name: "Lever Price · Essencial", anu: { per: 797, total: 9564 }, sem: { per: 847, total: 5082 } },
  },
};
const ST = { contas: 3, plataforma: true, linha: "ads", tier: "essencial", price: true, priceTier: "start", periodo: "semestral" };

test("plano só anual: com o Start no plano o período é o anual e a conta nunca soma R$ 0", () => {
  // Quem está marcado e não vende no semestral, pelo nome.
  assert.deepEqual(deckSoAnual(CAT_START, ST), ["Lever Price · Start"]);
  assert.deepEqual(deckSoAnual(CAT_START, { ...ST, priceTier: "essencial" }), [], "plano com os dois ciclos");
  assert.deepEqual(deckSoAnual(CAT_START, { ...ST, price: false }), [], "Start desmarcado não trava nada");
  assert.deepEqual(deckSoAnual(CAT_START, { ...ST, plataforma: false }), ["Lever Price · Start"]);
  assert.deepEqual(deckSoAnual({ products: { ...CAT_START.products, ads_essencial: { ...CAT_START.products.ads_essencial, sem: { per: 0 } } } }, { ...ST, price: false }),
    ["Ads Essencial"], "vale pra plano da plataforma também, e preço zerado conta como não vender");
  assert.deepEqual(deckSoAnual(null, ST), []);
  assert.equal(deckPeriodo(CAT_START, ST), "anual");
  assert.equal(deckPeriodo(CAT_START, { ...ST, priceTier: "essencial" }), "semestral");
  assert.equal(deckPeriodo(CAT_START, { ...ST, price: false }), "semestral");
  assert.equal(deckPeriodo(CAT_START, { ...ST, priceTier: "essencial", periodo: "anual" }), "anual");
  assert.equal(deckPeriodo(CAT_START, { ...ST, periodo: "trimestral" }), "anual", "período desconhecido é anual, como sempre");

  // A conta: plataforma + Start sai TODA no anual (497 + 350), nunca 597 + 0.
  const slim = slimCatalog(CAT_START);
  const junto = calcOferta(slim, ST);
  assert.equal(junto.mensal, 847);
  assert.equal(junto.parcelas, 12);
  assert.equal(junto.periodoLabel, "anual");
  assert.equal(junto.vistaFmt, "10.164");
  const soPrice = calcOferta(slim, { ...ST, plataforma: false });
  assert.equal(soPrice.mensal, 350);
  assert.equal(soPrice.mensalFmt, "350");
  assert.equal(soPrice.parcelas, 12);
  assert.equal(soPrice.vistaFmt, "4.200");
  assert.equal(soPrice.planoNome, "Lever Price · Start");
  assert.ok(soPrice.entregaveis[0].itens.includes("1 conta conectada"), "a conta do plano aparece no card do Price");
  // Catálogo cru (sem a chave `sem`) não quebra a conta.
  assert.equal(calcOferta(CAT_START, { ...ST, plataforma: false }).mensal, 350);

  // Plano com os dois ciclos: tudo como antes.
  const semestral = calcOferta(slim, { ...ST, priceTier: "essencial" });
  assert.equal(semestral.mensal, 597 + 847);
  assert.equal(semestral.parcelas, 6);
  assert.equal(semestral.periodoLabel, "semestral");
  assert.equal(calcOferta(slim, { ...ST, price: false }).mensal, 597);
});

test("as três funções da conta rodam sozinhas no script da página, como são injetadas", () => {
  const naPagina = new Function("cat", "st",
    "var deckSoAnual = " + deckSoAnual.toString() + "; var deckPeriodo = " + deckPeriodo.toString()
    + "; var calcOferta = " + calcOferta.toString() + "; return calcOferta(cat, st);");
  assert.equal(naPagina(slimCatalog(CAT_START), ST).mensal, 847);
  const html = proposalSlidesPageHtml(
    { id: "pr_x", name: "Proposta", state: { deckC: ST }, data: { lead: { name: "Ana" } }, accepted: false },
    { editable: true, catalog: CAT_START },
  );
  const iSo = html.indexOf("var deckSoAnual = function deckSoAnual(");
  const iPer = html.indexOf("var deckPeriodo = function deckPeriodo(");
  const iCalc = html.indexOf("var calcOferta = function calcOferta(");
  assert.ok(iSo > 0 && iPer > iSo && iCalc > iPer, "a página injeta as três, antes de usar");
  assert.match(html, /data-so-anual/, "a tela zero tem onde avisar que o plano é só anual");
  // O que a página recebe já vem saneado e calculado no anual.
  const dados = JSON.parse(html.match(/var D = (\{.*\});\n/)[1]);
  assert.equal(dados.cfg.periodo, "anual");
  assert.equal(dados.oferta.mensalFmt, "847");
  assert.equal(dados.oferta.parcelas, 12);
});

test("saneamento: semestral guardado não sobrevive ao Start, e o Start nunca vem escolhido sozinho", () => {
  const cfg = (deckC) => deckConfig({ state: { deckC } }, { catalog: CAT_START });
  assert.equal(cfg(ST).periodo, "anual", "Start + semestral vira anual");
  assert.equal(cfg(ST).priceTier, "start", "o Start é uma escolha válida da tela zero");
  assert.equal(cfg({ ...ST, priceTier: "essencial" }).periodo, "semestral", "sem plano só anual, o semestral fica");
  assert.equal(cfg({ ...ST, price: false }).periodo, "semestral", "Start guardado mas desmarcado não trava o período");
  // Sem pacote do Price escolhido, o padrão pula o Start, mesmo sendo o 1º do catálogo.
  assert.equal(deckChoices(CAT_START).price[0].tier, "start");
  assert.equal(deckPricePadrao(deckChoices(CAT_START).price).tier, "essencial");
  assert.equal(cfg({ linha: "ads", tier: "essencial" }).priceTier, "essencial");
  assert.equal(cfg({ linha: "ads", tier: "essencial", priceTier: "ouro" }).priceTier, "essencial");
  const soStart = { products: { ads_essencial: CAT_START.products.ads_essencial, price_start: CAT_START.products.price_start } };
  assert.equal(deckConfig({ state: { deckC: {} } }, { catalog: soStart }).priceTier, "start", "só existe o Start: é ele");
  // Sem catálogo (as chaves de sempre): o Start passa a ser aceito.
  assert.equal(deckConfig({ state: { deckC: { priceTier: "start" } } }).priceTier, "start");
  assert.equal(deckConfig({ state: { deckC: { priceTier: "ouro" } } }).priceTier, "essencial");
});

// O Start pelo caminho de produção: planos semeados, o plano criado e a
// projeção de volta aos templates.
async function setupComStart() {
  const ctx = await setup();
  await ensurePlansCatalog(ctx.repo);
  await ensurePriceStartPlan(ctx.repo);
  await syncPlanCatalogProjection(ctx.repo, "leverads");
  return ctx;
}
const putCfg = (app, deckC) => app.inject({ method: "PUT", url: "/api/leads/ld_cfg/proposal-config", payload: { deckC } });

test("deck só de Lever Price: o pacote escolhido vira o produto da venda e o valor do card (Start = R$ 4.200)", async () => {
  const { repo, app, proposal } = await setupComStart();
  const base = (await app.inject({ url: "/api/leads/ld_cfg/proposal-config" })).json();
  assert.ok(base.catalog.products.price_start, "o Start chega à tela zero pela projeção dos planos");
  assert.deepEqual(base.catalog.products.price_start.sem, {}, "sem preço semestral");
  assert.equal(base.cfg.priceTier, "essencial", "o Start não vem escolhido sozinho");
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 5964, "o card nasce no produto que a régua sugere");

  // Só o Price, no Start, com o semestral marcado antes: guarda anual e R$ 4.200.
  const put = await putCfg(app, { ...base.cfg, plataforma: false, price: true, priceTier: "start", periodo: "semestral" });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().cfg.periodo, "anual", "o servidor devolve o período já no anual");
  let p = await repo.get("proposals", proposal.id);
  assert.equal(p.state.product, "price_start");
  assert.equal(p.state.cycle, "annual");
  assert.equal(p.state.deckC.periodo, "anual");
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 4200);

  // Oferta e link do cliente: 12× R$ 350, com a conta e o teto de anúncios do plano.
  const offers = (await app.inject({ url: "/api/leads/ld_cfg/proposal-offers" })).json().offers;
  assert.deepEqual(offers.map((o) => [o.label, o.price, o.cycles]), [["Plano anual", "350", "12x de 350 ou 4.200 à vista"]]);
  const share = await app.inject({ method: "POST", url: "/api/leads/ld_cfg/proposal-share", payload: { offer: 1 } });
  assert.equal(share.statusCode, 200);
  const oferta = (await repo.get("proposals", share.json().id)).state.deckOferta;
  assert.equal(oferta.mensalFmt, "350");
  assert.equal(oferta.parcelas, 12);
  assert.equal(oferta.vistaFmt, "4.200");
  const itens = oferta.entregaveis.find((e) => e.tag === "Espiral do lucro").itens;
  assert.ok(itens.includes("1 conta conectada"));
  assert.ok(itens.includes(`Precificação automática de até ${String(PRICE_START_LISTINGS).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} anúncios`));
  const cliente = await app.inject({ url: `/p/${share.json().id}` });
  assert.doesNotMatch(cliente.body, /"mensalFmt":"0"/);

  // Outro pacote do Price, que vende no semestral: o período fica e o produto acompanha.
  await putCfg(app, { ...base.cfg, plataforma: false, price: true, priceTier: "escala", periodo: "semestral" });
  p = await repo.get("proposals", proposal.id);
  assert.equal(p.state.product, "price_escala");
  assert.equal(p.state.cycle, "semiannual");
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 17964, "o valor do card é o anual do produto, como na plataforma");

  // Pacote do Price que não veio na configuração (só o padrão do saneamento) não mexe no produto.
  const { priceTier: _fora, ...semPacote } = base.cfg;
  await putCfg(app, { ...semPacote, plataforma: false, price: true });
  assert.equal((await repo.get("proposals", proposal.id)).state.product, "price_escala", "fica como estava");

  // Com a plataforma no plano, ela segue sendo o produto (nada muda): Essencial + Start.
  await putCfg(app, { ...base.cfg, plataforma: true, linha: "ads", tier: "essencial", price: true, priceTier: "start", periodo: "semestral" });
  p = await repo.get("proposals", proposal.id);
  assert.equal(p.state.product, "ads_essencial");
  assert.equal(p.state.cycle, "annual", "o Start no plano leva tudo pro anual");
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 5964);
  const junto = (await app.inject({ url: "/api/leads/ld_cfg/proposal-offers" })).json().offers[0];
  assert.equal(junto.cycles, "12x de 847 ou 10.164 à vista", "497 + 350");
});

test("deck só de Price pelo PATCH público da tela zero, e os produtos marcados no card", async () => {
  const { repo, app, proposal } = await setupComStart();
  const base = (await app.inject({ url: "/api/leads/ld_cfg/proposal-config" })).json();
  const patch = await app.inject({
    method: "PATCH", url: "/public/proposals/" + proposal.id,
    payload: { k: proposal.editKey, deckC: { ...base.cfg, plataforma: false, price: true, priceTier: "start", periodo: "semestral" } },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(patch.json().state.product, "price_start");
  assert.equal(patch.json().state.cycle, "annual");
  assert.equal((await repo.get("leads", "ld_cfg")).amount, 4200);
  // O closer abre a tela zero: a página já chega com o anual e a parcela certa.
  const closer = await app.inject({ url: `/p/${proposal.id}?k=${proposal.editKey}` });
  const dados = JSON.parse(closer.body.match(/var D = (\{.*\});\n/)[1]);
  assert.equal(dados.cfg.periodo, "anual");
  assert.equal(dados.cfg.priceTier, "start");
  assert.equal(dados.oferta.mensalFmt, "350");
  assert.equal(dados.catalog.products.price_start.contas, 1);

  // Marcar só o Lever Price pelos produtos do card (sem abrir a tela zero): o
  // produto da venda é o pacote que a apresentação mostra, não o da plataforma.
  const outro = await setupComStart();
  const marca = await outro.app.inject({ method: "PUT", url: "/api/leads/ld_cfg/proposal-products", payload: { plataforma: false, price: true } });
  assert.equal(marca.statusCode, 200);
  assert.equal(marca.json().cfg.priceTier, "essencial", "o padrão segue fora do Start");
  assert.equal((await outro.repo.get("proposals", outro.proposal.id)).state.product, "price_essencial");
  assert.equal(marca.json().lead.amount, 9564);
});
