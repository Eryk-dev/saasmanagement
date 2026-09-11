// Catálogo de produto/oferta da proposta (v2, 10/09/2026): migração do
// template, régua nicho → linha / contas → pacote, transform do deck por
// produto (pricing único + tela OEM + ritmo claro/escuro), trava do produto no
// link do cliente e o card de decisão (catalogUI) só no modo closer.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog } = await import("../src/migrations.js");
const { applyCatalog, activeProduct, catalogUI, suggestProduct, dealCatalog, catalogAmount, hasCatalog, DEAL_PRODUCT_LABEL } = await import("../src/proposal-catalog.js");
const { runNativeProposal, shareProposalOffer, publicProposal, syncProposalLeadSnapshot } = await import("../src/proposal.js");
const { registerProposalRoutes } = await import("../src/routes.proposals.js");

// Template no formato do pt_leverads REAL (antes da migração): faixas antigas,
// dois slides de investimento com showIf de nicho, deck com ritmo claro/escuro.
const TEMPLATE = {
  id: "pt_leverads",
  saas: "leverads",
  name: "Proposta · LeverAds",
  status: "published",
  theme: { accent: "#23D8D3" },
  calc: {
    seatsKey: "accounts",
    seatsMap: { "1": 2, "2": 2, "3-5": 4, "6-10": 8, "10+": 12 },
    volumeKey: "volume",
    volumeMid: { "0-10": 10, "50-200": 200 },
    answerLabels: { niche: { autopecas: "Autopeças", outros: "Outros" }, staff: { 1: "1 funcionário" } },
    plans: {},
    defaultCycle: "annual",
  },
  slides: [
    { key: "hero", type: "hero", bg: "", title: "Capa" },
    { key: "como_funciona", type: "steps", bg: "", title: "3 etapas", steps: [{ tag: "E1", title: "Clonagem", text: "..." }] },
    { key: "impacto", type: "compare", bg: "dark", title: "Impacto" },
    {
      key: "investimento_autopecas", type: "pricing", bg: "", title: "Invest auto",
      price: "11.988", cycles: "12x de 999/mês", planTag: "ANUAL",
      showIf: { key: "niche", values: ["autopecas"] },
      features: ["100 anúncios gerados por OEM", "Automação de clonagem ilimitada"],
      benefitGroups: [
        { title: "Motor", items: ["100 anúncios gerados por OEM"] },
        { title: "Plataforma", items: ["Painel"] },
        { title: "Lado humano", items: ["Suporte"] },
      ],
      offer2: { planTag: "SEMESTRAL", price: "7.188" },
      offer3: { planTag: "OEM", price: "4.188" },
    },
    {
      key: "investimento", type: "pricing", bg: "", title: "Invest",
      price: "7.188", cycles: "12x de 599/mês", planTag: "ANUAL",
      showIf: { key: "niche", values: ["casa", "moda", "beleza", "outros", "eletronicos"] },
      features: ["Automação de clonagem ilimitada"],
      benefitGroups: [
        { title: "Motor", items: ["Clonagem"] },
        { title: "Plataforma", items: ["Painel"] },
        { title: "Lado humano", items: ["Suporte"] },
      ],
      offer2: { planTag: "SEMESTRAL", price: "4.188" },
    },
  ],
};

// Catálogo no shape ANTERIOR (v1: FULL / +OEM / OEM avulso com leque / Parcial
// / combo, três formas de pagar, clonagem avulsa): matéria-prima dos testes de
// migração e da guarda de leitura.
function catalogV1(base) {
  const v1 = JSON.parse(JSON.stringify(base));
  delete v1.pricingV;
  delete v1.catalogV;
  delete v1.lines;
  delete v1.addons;
  delete v1.oemPacks;
  delete v1.tierByAccounts;
  v1.products = {
    full: { name: "LeverAds FULL", anu: { total: 8976, per: 748 }, sem: { total: 5094, per: 849 }, rec: { per: 499, setup: 3500 } },
    fulloem: { name: "LeverAds + OEM FULL", cota: 500, anu: { total: 11988, per: 999 }, sem: { total: 7794, per: 1299 }, rec: { per: 774, setup: 3750 } },
    oem: {
      name: "OEM avulso",
      small: { cota: 125, anu: { total: 3288, per: 274 }, sem: { total: 1914, per: 319 }, rec: { per: 379, setup: 0 } },
      mid: { cota: 250, anu: { total: 5388, per: 449 }, sem: { total: 2994, per: 499 }, rec: { per: 599, setup: 0 } },
      big: { cota: 500, anu: { total: 8388, per: 699 }, sem: { total: 4494, per: 749 }, rec: { per: 849, setup: 0 } },
    },
    parcialA: { name: "Parcial", anu: { total: 4536, per: 378 }, sem: { total: 2574, per: 429 }, rec: { per: 299, setup: 1500 } },
    parcialoem: { name: "Parcial + OEM 250", cota: 250, anu: { total: 7188, per: 599 }, sem: { total: 3894, per: 649 }, rec: { per: 499, setup: 1750 } },
  };
  v1.oneOff = { tag: "serviço único", title: "Clonagem entre contas", rows: [{ range: "Até 100 anúncios", price: "R$ 996" }] };
  return v1;
}

// O que interessa é o PAYLOAD (window.__PROPOSAL__), não o fonte estático do
// renderer (que cita catalogUI/como_funciona em código e comentário de CSS).
function payloadOf(html) {
  const m = html.match(/window\.__PROPOSAL__ = (\{[\s\S]*?\});<\/script>/);
  assert.ok(m, "payload presente");
  return JSON.parse(m[1]);
}

async function seedRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  return repo;
}

async function makeProposal(repo, answers = {}) {
  const lead = await repo.create("leads", {
    id: "ld_" + Math.random().toString(36).slice(2, 8),
    saas: "leverads", name: "Cleber Souza", company: "O2 Consultoria",
    niche: "outros", accounts: "1", listings: "100-500", staff: "1",
    ...answers,
  });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x" });
  assert.equal(r.ok, true, "geração ok");
  return r.proposal;
}

const pricingOf = (t) => t.slides.find((s) => s.type === "pricing");

test("migração: faixas de anúncios viram as colunas da régua + catálogo v2 gravado; one-shot", async () => {
  const repo = makeMemRepo();
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  const first = await ensureProposalCatalog(repo);
  assert.equal(first, true, "primeira execução grava");
  const t = await repo.get("proposal_templates", "pt_leverads");
  assert.equal(t.calc.volumeKey, "listings", "volume vem da resposta listings do form");
  assert.deepEqual(Object.keys(t.calc.volumeMid), ["0-100", "100-500", "500-2000", "2000-10000", "10000+"]);
  const cat = t.calc.catalog;
  assert.equal(cat.catalogV, 2, "shape v2");
  assert.equal(cat.products.ads_essencial.anu.total, 5964, "Ads Essencial na tabela de 10/09");
  assert.equal(cat.products.oem_essencial.anu.total, 5964, "OEM e Ads têm o mesmo preço");
  assert.equal(cat.products.price_enterprise.sem.total, 23982, "Price Enterprise semestral");
  assert.equal(cat.products.full, undefined, "catálogo antigo não está no seed");
  assert.equal(cat.products.oem_escala.rec, undefined, "sem recorrente nos planos novos");
  assert.deepEqual(Object.keys(cat.lines), ["oem", "ads", "price"]);
  assert.equal(cat.oemPacks.length, 3, "pacotes de OEM avulsos");
  assert.equal(cat.addons.contaExtra.per, 100);
  assert.equal(cat.tierByAccounts["6-10"], "escala");
  assert.ok(hasCatalog(t.calc));
  const again = await ensureProposalCatalog(repo);
  assert.equal(again, false, "idempotente: segunda execução não mexe");
});

test("snapshot guarda as DUAS bases de pricing (showIf de nicho não filtra com catálogo)", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros" });
  const pricing = p.slides.filter((s) => s.type === "pricing").map((s) => s.key);
  assert.deepEqual(pricing.sort(), ["investimento", "investimento_autopecas"], "as duas bases no snapshot");
  assert.equal(p.state.volume, "100-500", "faixa vem de answers.listings");
});

test("régua: o nicho decide a linha, o nº de contas decide o pacote; Price nunca é sugerido", async () => {
  const repo = await seedRepo();
  const sug = async (answers) => {
    const p = await makeProposal(repo, answers);
    return suggestProduct(p.calc, p.state, p.data.answers);
  };
  assert.equal(await sug({ niche: "outros", accounts: "1", listings: "100-500" }), "ads_essencial");
  assert.equal(await sug({ niche: "outros", accounts: "3-5", listings: "2000-10000" }), "ads_essencial", "até 5 contas é Essencial, mesmo com muitos anúncios");
  assert.equal(await sug({ niche: "outros", accounts: "6-10", listings: "100-500" }), "ads_escala");
  assert.equal(await sug({ niche: "autopecas", accounts: "1", listings: "100-500" }), "oem_essencial");
  assert.equal(await sug({ niche: "autopecas", accounts: "6-10", listings: "2000-10000" }), "oem_escala");
  // 10+ contas = Enterprise, que em OEM/Ads é sob consulta: apresenta o Escala e avisa.
  const big = await makeProposal(repo, { niche: "autopecas", accounts: "10+", listings: "10000+" });
  assert.equal(suggestProduct(big.calc, big.state, big.data.answers), "oem_escala");
  assert.equal(catalogUI(big).enterpriseHint, true, "tela zero avisa que Enterprise é sob consulta");
  assert.match(catalogUI(big).why, /Enterprise é sob consulta/);
  assert.equal(catalogUI(await makeProposal(repo, { niche: "outros", accounts: "6-10", listings: "100-500" })).enterpriseHint, false);
  // A régua nunca sugere Price (cross-sell, escolha do closer).
  for (const a of [{ accounts: "1" }, { accounts: "6-10", listings: "10000+" }, { niche: "autopecas", accounts: "10+" }]) {
    assert.ok(!(await sug(a)).startsWith("price_"));
  }
});

test("Ads Essencial: anual abre, semestral no Shift+1, sem recorrente, sem tela OEM", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  const t = applyCatalog(p);
  assert.equal(t.product, "ads_essencial");
  assert.equal(t.line, "ads");
  assert.equal(t.pkg, "essencial");
  const pricing = pricingOf(t);
  assert.equal(pricing.key, "investimento_ads_essencial");
  assert.equal(pricing.planTag, "ANUAL", "o anual abre a apresentação");
  assert.equal(pricing.price, "5.964");
  assert.equal(pricing.cycles, "12x de *497*/mês", "parcela com marcador de destaque");
  assert.equal(pricing.planPill, "3 contas", "escopo do pacote na pílula");
  assert.equal(pricing.offer2.planTag, "SEMESTRAL");
  assert.equal(pricing.offer2.price, "3.582", "semestral no Shift+1");
  assert.equal(pricing.offer2.cycles, "6x de *597*/mês", "semestre cobra 6 parcelas, não 12");
  assert.equal(pricing.offer3, undefined, "recorrente saiu dos planos novos");
  assert.equal(pricing.offer4, undefined, "escada antiga morta");
  assert.equal(pricing.showIf, undefined);
  assert.equal(pricing.sub, "Lever Ads · Essencial");
  assert.equal(pricing.offer2.sub, "Lever Ads · Essencial", "o subtítulo é do produto, vale nas duas");
  assert.ok(pricing.benefitGroups[0].items.includes("Sincronização das suas contas (Meli + Shopee)"), "entregáveis vêm do catálogo");
  assert.ok(!t.slides.some((s) => s.key === "oem_processo"), "sem tela OEM");
  assert.equal(t.slides.filter((s) => s.type === "pricing").length, 1, "um investimento só");
  assert.equal(t.oem, false);
});

test("linha OEM: tela OEM escura depois do 3 etapas (que fica), ritmo re-alternado, cota do catálogo", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const t = applyCatalog(p);
  assert.equal(t.product, "oem_essencial");
  assert.equal(t.oem, true);
  const keys = t.slides.map((s) => s.key);
  const iSteps = keys.indexOf("como_funciona");
  assert.ok(iSteps !== -1, "OEM entrega tudo do Ads: a clonagem continua no deck");
  assert.equal(keys[iSteps + 1], "oem_processo", "tela OEM logo depois do 3 etapas");
  const oem = t.slides[iSteps + 1];
  assert.equal(oem.bg, "dark");
  assert.match(oem.pills[0], /^200 anúncios OEM/, "cota do Essencial");
  assert.equal(t.slides[iSteps + 2].bg, "", "impacto vira claro");
  const pricing = pricingOf(t);
  assert.equal(pricing.bg, "dark", "investimento fecha escuro");
  assert.equal(pricing.key, "investimento_oem_essencial");
  assert.equal(pricing.price, "5.964");
  assert.equal(pricing.planPill, "3 contas · 200 OEM/mês");
  assert.equal(pricing.sub, "Lever OEM · Essencial");
  assert.equal(pricing.offer3, undefined);
  assert.ok(!JSON.stringify(pricing).includes("100 anúncios gerados por OEM"), "texto velho do slide de autopeças não sobrevive");

  const big = await makeProposal(repo, { niche: "autopecas", accounts: "6-10", listings: "2000-10000" });
  const tb = applyCatalog(big);
  assert.equal(tb.product, "oem_escala");
  assert.match(tb.slides.find((s) => s.key === "oem_processo").pills[0], /sem limite/, "Escala é OEM ilimitado");
  assert.equal(pricingOf(tb).price, "11.988");
  assert.equal(pricingOf(tb).planPill, "7 contas · OEM ilimitado");
});

test("linha Price: sem tela OEM; Enterprise tem preço e entra no deck", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  p.state.product = "price_enterprise";
  const t = applyCatalog(p);
  assert.equal(t.product, "price_enterprise");
  assert.equal(t.line, "price");
  assert.ok(!t.slides.some((s) => s.key === "oem_processo"), "Price não tem tela OEM");
  const pricing = pricingOf(t);
  assert.equal(pricing.key, "investimento_price_enterprise");
  assert.equal(pricing.price, "41.964");
  assert.equal(pricing.offer2.price, "23.982");
  assert.equal(pricing.planPill, "anúncios ilimitados");
  p.state.product = "price_essencial";
  assert.equal(pricingOf(applyCatalog(p)).planPill, "até 1.000 anúncios");
  assert.equal(pricingOf(applyCatalog(p)).price, "9.564");
});

test("dor [OEM] não manda no produto: a régua decide; Apresentar vence tudo", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "oem_essencial");

  p.state = { ...p.state, pain: "OEM" };
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "oem_essencial", "a dor só troca a trilha SPIN");
  assert.equal(pricingOf(applyCatalog(p)).price, "5.964");

  p.state.product = "price_escala"; // cross-sell na mão do closer
  assert.equal(activeProduct(p), "price_escala");
  assert.equal(pricingOf(applyCatalog(p)).price, "17.964");

  p.state.product = "nao_existe";
  assert.equal(activeProduct(p), "oem_essencial", "produto fora do catálogo volta pra régua");
});

test("tela zero: dor OEM entra no select depois das letras e não remonta o deck", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const base = catalogUI(p);
  assert.deepEqual(base.painOrder, ["A", "B", "C", "D", "E", "OEM", "none"], "letras, códigos maiores, sem código");
  assert.ok(base.pains.OEM.spin.N.length > 10, "trilha SPIN da dor OEM embarcada");

  p.state = { ...p.state, pain: "OEM" };
  const ui = catalogUI(p);
  assert.equal(ui.suggested, "oem_essencial", "a régua continua decidindo o produto");
  assert.equal(ui.pain, "OEM", "a dor fica registrada só como trilha SPIN");
});

test("payload público nunca leva o catálogo cru; catalogUI tem linhas, nomes e preços prontos", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const pub = publicProposal(p, { editable: true });
  assert.equal(pub.calc.catalog, undefined, "tabela de preço é do servidor");
  const ui = catalogUI(p);
  assert.deepEqual(Object.keys(ui.names), [
    "oem_essencial", "oem_escala", "ads_essencial", "ads_escala", "price_essencial", "price_escala", "price_enterprise",
  ]);
  assert.equal(ui.names.ads_escala, "Lever Ads · Escala");
  // As duas formas de pagar, na ordem em que o closer apresenta.
  assert.equal(ui.priceLines.ads_essencial, "Anual R$ 5.964 (12x 497) · Shift+1 semestral R$ 3.582 (6x 597)");
  assert.equal(ui.priceLines.price_escala, "Anual R$ 17.964 (12x 1.497) · Shift+1 semestral R$ 11.382 (6x 1.897)");
  assert.ok(!Object.values(ui.priceLines).some((l) => /Shift\+2|recorrente/.test(l)), "sem Shift+2 nos planos novos");
  // Linhas × pacotes pro select agrupado.
  assert.deepEqual(ui.lines.map((l) => l.id), ["oem", "ads", "price"]);
  assert.deepEqual(ui.lines[0].products.map((x) => x.key), ["oem_essencial", "oem_escala"]);
  assert.equal(ui.lines[0].products[0].label, "Essencial · 3 contas · 200 OEM/mês");
  assert.equal(ui.lines[0].enterprise, "sob consulta", "Enterprise OEM é sob consulta");
  assert.equal(ui.lines[1].enterprise, "sob consulta", "Enterprise Ads é sob consulta");
  assert.equal(ui.lines[2].enterprise, "", "Enterprise Price tem preço, é produto");
  assert.deepEqual(ui.lines[2].products.map((x) => x.key), ["price_essencial", "price_escala", "price_enterprise"]);
  assert.equal(ui.oemLevels, undefined, "leque do OEM avulso morreu");
  assert.equal(ui.oneOffCloning, undefined, "clonagem avulsa morreu");
  assert.equal(ui.suggested, "ads_essencial");
  assert.equal(ui.line, "ads");
  assert.equal(ui.pkg, "essencial");
  assert.equal(ui.why, "1 conta(s) · fora de autopeças → Lever Ads · Essencial.");
  assert.equal(ui.tier, "D", "a nota da matriz continua");
  assert.equal(ui.pain, "none", "sem dor marcada → trilha genérica");
  assert.ok(ui.pains.A.spin.S.length > 10, "perguntas SPIN embarcadas");
});

test("tela zero descreve o produto com os empilháveis do slide de investimento", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const ui = catalogUI(p);
  const itemsOf = (key) => {
    const s = pricingOf(applyCatalog({ ...p, state: { ...p.state, product: key } }));
    return s.benefitGroups.slice(0, 2).flatMap((g) => g.items).map((f) => (typeof f === "object" ? f.text : f));
  };
  // Item por item, na mesma ordem: o que o closer lê é o que o lead vai ver.
  for (const key of Object.keys(ui.names)) {
    assert.equal(ui.offerLines[key], itemsOf(key).join(" · "), key + ": linha derivada do slide");
  }
  // O lado humano (grupo 3) é igual em todos: fica fora da linha do produto.
  assert.ok(!ui.offerLines.ads_essencial.includes("Suporte"), "grupo 3 não entra na linha");
  assert.match(ui.offerLines.oem_essencial, /^200 anúncios OEM criados por mês/);
  assert.match(ui.offerLines.oem_escala, /sem limite mensal/);
  assert.match(ui.offerLines.price_escala, /10\.000 anúncios/);
  const all = Object.values(ui.offerLines).join(" ");
  assert.ok(!/\b125 anúncios|500 anúncios|clones/.test(all), "nenhuma cota do catálogo antigo sobrou");
});

test("consulta rápida: adicionais, pacotes de OEM e sob consulta; fora do deck", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const q = catalogUI(p).quickRef;
  assert.equal(q.tag, "consulta rápida");
  assert.deepEqual(q.rows.map((r) => [r.label, r.price]), [
    ["Conta extra no Escala", "R$ 100/mês por conta"],
    ["Pacote de 1.000 anúncios OEM (uma vez)", "R$ 2.000"],
    ["Pacote de 2.000 anúncios OEM (uma vez)", "R$ 3.500"],
    ["Pacote de 3.000 anúncios OEM (uma vez)", "R$ 4.500"],
    ["Setup de Equalização", "sob consulta"],
    ["Setup de Otimização", "sob consulta"],
    ["Lever OEM · Enterprise", "sob consulta"],
    ["Lever Ads · Enterprise", "sob consulta"],
  ]);
  // É consulta do closer: nada disso entra no deck que o cliente recebe.
  const deck = JSON.stringify(applyCatalog(p).slides);
  assert.ok(!deck.includes("sob consulta") && !deck.includes("Pacote de 1.000"));
  // Banco manda: setup com preço entra com R$.
  p.calc.catalog.addons.setups = [{ label: "Setup de Equalização", price: 1500 }];
  assert.deepEqual(catalogUI(p).quickRef.rows.find((r) => r.label === "Setup de Equalização"), { label: "Setup de Equalização", price: "R$ 1.500" });
});

test("link do cliente: deck transformado, oferta travada, sem catálogo no snapshot filho", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const r = await shareProposalOffer(repo, p, 1, { baseUrl: "http://x" });
  assert.equal(r.ok, true);
  const child = r.proposal;
  const pricing = pricingOf(child);
  assert.equal(pricing.key, "investimento_oem_essencial", "produto da tela zero travado");
  assert.equal(pricing.price, "5.964");
  assert.equal(pricing.offer2, undefined, "escada secreta fora do link do cliente");
  assert.equal(pricing.offer3, undefined);
  assert.ok(child.slides.some((s) => s.key === "oem_processo"), "tela OEM viaja junto");
  assert.equal((child.calc || {}).catalog, undefined, "catálogo não viaja");
});

test("link do cliente respeita o produto escolhido pelo closer em Apresentar", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  // A régua sugeriria OEM Essencial; o closer decidiu apresentar o Price Escala.
  p.state = { ...p.state, product: "price_escala" };

  const r = await shareProposalOffer(repo, p, 1, { baseUrl: "http://x" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.state.product, "price_escala");
  assert.equal(pricingOf(r.proposal).key, "investimento_price_escala");
  assert.equal(r.proposal.showAll, true, "preço e benefícios não esperam Espaço");
  assert.equal(r.proposal.editKey, "", "versão do cliente não abre a tela zero");
});

test("rotas: card de decisão só no modo closer; PATCH aceita product/pain/oem e ignora produto inválido", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const closer = await app.inject({ method: "GET", url: "/p/" + p.id + "?k=" + p.editKey });
  const closerPayload = payloadOf(closer.body);
  assert.ok(closerPayload.catalogUI, "payload do card no modo closer");
  assert.ok(closerPayload.slides.some((s) => s.key === "investimento_ads_essencial"), "deck já transformado");

  const cliente = await app.inject({ method: "GET", url: "/p/" + p.id });
  const clientePayload = payloadOf(cliente.body);
  assert.equal(clientePayload.catalogUI, undefined, "cliente não vê o card");
  assert.equal(clientePayload.calc.catalog, undefined, "nem a tabela de preço");

  // O script do cliente é concatenação dentro de template literal: valida que
  // o JS embutido continua parseável com o card novo.
  const scripts = [...closer.body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2, "página tem payload + script");
  for (const [, src] of scripts) {
    assert.doesNotThrow(() => new Function(src.replace(/^window\.__PROPOSAL__ = /, "return ")), "script servido é JS válido");
  }

  const patch = await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, product: "oem_escala", pain: "B", oem: true },
  });
  assert.equal(patch.statusCode, 200);
  const saved = await repo.get("proposals", p.id);
  assert.equal(saved.state.product, "oem_escala");
  assert.equal(saved.state.pain, "B");
  assert.equal(saved.state.oem, true);

  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, product: "fulloem" },
  });
  assert.equal((await repo.get("proposals", p.id)).state.product, "oem_escala", "chave do catálogo antigo não entra");

  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, product: "" },
  });
  assert.equal((await repo.get("proposals", p.id)).state.product, "", "vazio = volta a seguir a régua");

  // Cota do OEM avulso não existe mais: o campo é ignorado.
  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, oemCota: 250 },
  });
  assert.equal((await repo.get("proposals", p.id)).state.oemCota, undefined, "campo morto não grava");
});

// ── Teste A/B da ordem da apresentação (Leo, 12/08; refeito 23/08) ──────────
// B agora é só a tela de setup no modo ?k (client-side): o deck servido não
// muda, então o link do cliente segue o padrão mesmo com o beta ligado.
test("ordem B na proposta: PATCH liga o beta e o deck servido segue o padrão", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const padrao = applyCatalog(await repo.get("proposals", p.id));
  assert.equal(padrao.slides[0].key, "hero", "A abre na capa");
  assert.equal(padrao.slides.filter((s) => s.type === "pricing").length, 1, "um investimento só");

  const patch = await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, deckOrder: "b" },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal((await repo.get("proposals", p.id)).state.deckOrder, "B", "aceita minúsculo");

  const beta = applyCatalog(await repo.get("proposals", p.id));
  assert.deepEqual(beta.slides.map((s) => s.key), padrao.slides.map((s) => s.key), "deck igual: o beta vive na tela de setup");
  assert.ok(!beta.slides.some((s) => s.revealOpen), "sem o slide de fechamento do beta antigo");

  const shared = await shareProposalOffer(repo, await repo.get("proposals", p.id), 1, { baseUrl: "http://x" });
  assert.equal(shared.ok, true);
  assert.equal(shared.proposal.slides[0].key, "hero", "cliente recebe o deck padrão, com capa");

  const closer = await app.inject({ method: "GET", url: "/p/" + p.id + "?k=" + p.editKey });
  assert.equal(payloadOf(closer.body).catalogUI.deckOrder, "B", "pílula A/B abre marcada no beta");

  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, deckOrder: "z" } });
  assert.equal((await repo.get("proposals", p.id)).state.deckOrder, "", "valor estranho volta pro padrão");
});

test("desconto da negociação: PATCH clampa em 0..15 e a tela zero recebe o salvo", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, discountPct: 10 } });
  assert.equal((await repo.get("proposals", p.id)).state.discountPct, 10, "desconto entra");
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, discountPct: 40 } });
  assert.equal((await repo.get("proposals", p.id)).state.discountPct, 15, "acima do teto vira 15");
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, discountPct: -3 } });
  assert.equal((await repo.get("proposals", p.id)).state.discountPct, 0, "negativo vira 0");

  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, discountPct: 12 } });
  const closer = await app.inject({ method: "GET", url: "/p/" + p.id + "?k=" + p.editKey });
  assert.equal(payloadOf(closer.body).catalogUI.discountPct, 12, "tela zero abre com o desconto salvo");
});

test("preview /p/t: simulação via query (produto e dados) sem persistir nada", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const r = await app.inject({ method: "GET", url: "/p/t/pt_leverads?accounts=6-10&volume=2000-10000&niche=autopecas&product=price_escala&pain=A" });
  assert.equal(r.statusCode, 200);
  const payload = payloadOf(r.body);
  assert.ok(payload.catalogUI, "preview roda o card");
  assert.equal(payload.catalogUI.pain, "A", "dor da query aplicada");
  assert.equal(payload.catalogUI.suggested, "oem_escala", "régua da query: autopeças com 6-10 contas");
  assert.ok(payload.slides.some((s) => s.key === "investimento_price_escala"), "produto da query aplicado");
  assert.equal(payload.slides.find((s) => s.key === "investimento_price_escala").price, "17.964");
  assert.ok(payload.slides.some((s) => s.key === "como_funciona"), "3 etapas fica");

  const big = await app.inject({ method: "GET", url: "/p/t/pt_leverads?accounts=10%2B&volume=10000%2B&niche=autopecas" });
  const bp = payloadOf(big.body);
  assert.equal(bp.catalogUI.suggested, "oem_escala", "Enterprise sob consulta: apresenta o Escala");
  assert.equal(bp.catalogUI.enterpriseHint, true);
});

test("retroativo: proposta antiga re-snapshotada no fluxo novo; aceita e compartilhada ficam de fora", async () => {
  const { backfillProposalCatalog } = await import("../src/migrations.js");
  const repo = await seedRepo();
  const oldCalc = {
    seatsKey: "accounts", seatsMap: { "1": 2, "2": 2, "3-5": 4, "6-10": 8, "10+": 12 },
    volumeKey: "volume",
    volumeMid: { "0-10": 10, "10-50": 50, "50-200": 200, "200-1.000": 600, "1.000-5.000": 3000, "15.000-50.000": 30000 },
  };
  const oldSlides = [
    { key: "hero", type: "hero", title: "Capa" },
    { key: "investimento", type: "pricing", price: "7.188", planTag: "ANUAL" },
  ];
  const mk = (id, extra) => repo.create("proposals", {
    id, saas: "leverads", template: "pt_leverads", lead: "ld_x", name: "Proposta",
    calc: JSON.parse(JSON.stringify(oldCalc)), slides: JSON.parse(JSON.stringify(oldSlides)),
    data: { lead: { name: "Ana" }, answers: { niche: "outros", accounts: "2" } },
    state: { accounts: "2", seats: 2, volume: "200-1.000", cycle: "annual", validUntil: "01/09/2026", frozen: true },
    editKey: "k_" + id, views: 3, accepted: false, createdAt: "2026-07-01T00:00:00.000Z",
    ...extra,
  });
  await mk("pr_old");
  await mk("pr_aceita", { accepted: true });
  await mk("pr_filha", { sharedFrom: "pr_old", sharedOffer: 1, editKey: "" });

  const n = await backfillProposalCatalog(repo);
  assert.equal(n, 1, "só a proposta viva e não compartilhada entra");

  const p = await repo.get("proposals", "pr_old");
  assert.ok(p.calc.catalog, "catálogo no snapshot");
  assert.equal(p.state.volume, "500-2000", "faixa antiga (mid 600) vira a coluna equivalente da régua");
  assert.equal(p.state.validUntil, "01/09/2026", "resto do estado preservado");
  assert.equal(p.editKey, "k_pr_old", "link do closer intacto");
  assert.equal(p.views, 3, "tracking preservado");
  const keys = p.slides.map((s) => s.key);
  assert.ok(keys.includes("investimento") && keys.includes("investimento_autopecas"), "as duas bases de pricing");
  assert.ok(keys.includes("como_funciona"), "deck completo do template atual");
  const t = applyCatalog(p);
  assert.equal(t.tier, "C", "2 contas × 500-2000 cai na coluna certa da régua");
  assert.equal(t.product, "ads_essencial", "2 contas fora de autopeças = Ads Essencial");

  assert.equal((await repo.get("proposals", "pr_aceita")).calc.catalog, undefined, "aceita não muda");
  assert.equal((await repo.get("proposals", "pr_filha")).calc.catalog, undefined, "link do cliente não muda");
  assert.equal(await backfillProposalCatalog(repo), 0, "idempotente");
});

test("catálogo v2: template v1 migrado cirurgicamente; abertas ganham a tabela e o produto escolhido é remapeado", async () => {
  const { migrateCatalogPricing, backfillCatalogPricing } = await import("../src/migrations.js");
  const repo = await seedRepo();
  // Volta o template pro shape ANTERIOR (v1), com dor editada pelo dono.
  const t0 = await repo.get("proposal_templates", "pt_leverads");
  const velho = catalogV1(t0.calc.catalog);
  velho.pains = { Z: { label: "dor editada pelo dono" } };
  await repo.update("proposal_templates", "pt_leverads", { calc: { ...t0.calc, catalog: velho } });

  const mk = (id, extra) => repo.create("proposals", {
    id, saas: "leverads", template: "pt_leverads", lead: "ld_x", name: "Proposta",
    calc: { volumeMid: { "100-500": 300 }, catalog: JSON.parse(JSON.stringify(velho)) },
    slides: [], data: { answers: {} },
    state: { accounts: "1", volume: "100-500", product: "parcialoem", pain: "OEM", oemCota: 250 },
    editKey: "k_" + id, accepted: false,
    ...extra,
  });
  await mk("pr_combo");
  await mk("pr_full", { state: { accounts: "3-5", volume: "100-500", product: "full" } });
  await mk("pr_oem", { state: { accounts: "1", volume: "100-500", product: "oem", oemCota: 500 } });
  await mk("pr_estranha", { state: { accounts: "1", volume: "100-500", product: "zzz" } });
  await mk("pr_regua", { state: { accounts: "1", volume: "100-500" } });
  await mk("pr_aceita", { accepted: true });
  await mk("pr_filha", { sharedFrom: "pr_combo", editKey: "" });

  assert.equal(await migrateCatalogPricing(repo), true, "template migrado");
  const cat = (await repo.get("proposal_templates", "pt_leverads")).calc.catalog;
  assert.equal(cat.catalogV, 2);
  assert.equal(cat.products.full, undefined, "catálogo antigo sai");
  assert.equal(cat.products.oem_essencial.sem.total, 3582, "tabela nova no template");
  assert.equal(cat.products.ads_escala.rec, undefined, "sem recorrente");
  assert.equal(cat.oneOff, undefined, "clonagem avulsa sai");
  assert.equal(cat.oemPacks.length, 3);
  assert.ok(cat.lines.price && cat.addons.contaExtra && cat.tierByAccounts["10+"]);
  // Cirúrgico: dor editada pelo dono e matriz ficam.
  assert.deepEqual(Object.keys(cat.pains), ["Z"], "dores do dono preservadas");
  assert.deepEqual(cat.grid, t0.calc.catalog.grid, "matriz preservada");
  assert.equal(await migrateCatalogPricing(repo), false, "idempotente: o marcador pricingV segura");

  assert.equal(await backfillCatalogPricing(repo), 5, "as cinco abertas entram");
  const combo = await repo.get("proposals", "pr_combo");
  assert.equal(combo.calc.catalog.catalogV, 2, "snapshot no shape novo");
  assert.equal(combo.calc.catalog.products.oem_essencial.anu.total, 5964);
  assert.equal(combo.calc.volumeMid["100-500"], 300, "resto do calc preservado");
  assert.equal(combo.state.product, "oem_essencial", "combo Parcial + OEM vira OEM Essencial");
  assert.equal(combo.state.oemCota, undefined, "cota do OEM avulso morreu");
  assert.equal(combo.state.pain, "OEM", "resto do estado preservado");
  assert.equal((await repo.get("proposals", "pr_full")).state.product, "ads_escala", "FULL vira Ads Escala");
  assert.equal((await repo.get("proposals", "pr_oem")).state.product, "oem_essencial", "OEM avulso vira OEM Essencial");
  assert.equal((await repo.get("proposals", "pr_estranha")).state.product, "", "produto desconhecido volta pra régua");
  assert.equal((await repo.get("proposals", "pr_regua")).state.product, undefined, "quem seguia a régua segue");
  assert.equal((await repo.get("proposals", "pr_aceita")).calc.catalog.products.full.anu.total, 8976, "aceita não muda");
  assert.equal((await repo.get("proposals", "pr_filha")).calc.catalog.products.full.anu.total, 8976, "link do cliente não muda");
  assert.equal(await backfillCatalogPricing(repo), 0, "idempotente");
  // A aberta migrada renderiza no produto remapeado.
  assert.equal(activeProduct(combo), "oem_essencial");
  assert.equal(catalogAmount(combo), 5964);
});

test("guarda: snapshot v1 que escapou da migração não quebra (deck cru, sem card, sem valor)", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  p.calc = { ...p.calc, catalog: catalogV1(p.calc.catalog) };
  assert.equal(hasCatalog(p.calc), false);
  assert.equal(applyCatalog(p), null, "deck segue como está");
  assert.equal(catalogUI(p), null, "sem card de decisão");
  assert.equal(catalogAmount(p), 0, "quem chama cai na fórmula por assentos");
  assert.deepEqual(dealCatalog(p.calc), []);
  const app = Fastify();
  registerProposalRoutes(app, repo);
  await repo.update("proposals", p.id, { calc: p.calc });
  const r = await app.inject({ method: "GET", url: "/p/" + p.id + "?k=" + p.editKey });
  assert.equal(r.statusCode, 200, "página serve");
  assert.equal(payloadOf(r.body).catalogUI, undefined);
});

// ── Card do pipeline = preço da apresentação ────────────────────────────────
// O amount do lead É o preço anual do produto que a régua sugere (ou que o
// closer escolheu em Apresentar) — não mais a fórmula por assentos.
test("geração: lead.amount é o preço do produto sugerido, não a fórmula por assentos", async () => {
  const repo = await seedRepo();
  // Até 5 contas fora de autopeças → Ads Essencial (R$ 5.964 no ano).
  const p1 = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p1.lead)).amount, 5964);
  // 6-10 contas → Escala (R$ 11.988), independente do nº de anúncios.
  const p2 = await makeProposal(repo, { niche: "outros", accounts: "6-10", listings: "2000-10000" });
  assert.equal((await repo.get("leads", p2.lead)).amount, 11988);
  // Dor [OEM] do anúncio NÃO muda o produto: autopeças com 1 conta segue a
  // régua → OEM Essencial (mesmo preço do Ads Essencial).
  const p3 = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500", sourcePain: "oem" });
  assert.equal((await repo.get("leads", p3.lead)).amount, 5964);
});

test("tela zero mexeu → o card acompanha o produto ativo; negócio fechado não mexe", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p.lead)).amount, 5964, "nasce no Ads Essencial");
  const app = Fastify();
  registerProposalRoutes(app, repo);

  // Closer decide apresentar o Price Escala (cross-sell): o card segue na hora.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, product: "price_escala" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 17964);

  // Régua re-classificada na call (contas reais) com Apresentar de volta na
  // régua: 6-10 contas = Escala.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, product: "", accounts: "6-10", volume: "2000-10000" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 11988);

  // Dor OEM marcada na tela zero: só trilha SPIN — produto e card não mudam.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, pain: "OEM" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 11988);

  // Negócio fechado: o valor de venda é soberano, a tela zero não sobrescreve.
  await repo.update("leads", p.lead, { amount: 5000, planClosed: "semestral" });
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, product: "ads_essencial" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 5000);
});

test("dor [OEM] inferida na abertura do link entra como trilha SPIN sem mexer no card", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p.lead)).amount, 5964, "nasce no OEM Essencial");
  // A dor chega DEPOIS da geração (ad_insights sincroniza no ciclo de marketing).
  await repo.update("leads", p.lead, { utm: { content: "ad_9" } });
  await repo.create("ad_insights", { id: "ai_9", saas: "leverads", adId: "ad_9", date: "2026-08-14", adName: "peças [OEM]" });

  const synced = await syncProposalLeadSnapshot(repo, await repo.get("proposals", p.id));
  assert.equal(synced.state.pain, "OEM", "trilha SPIN do closer aponta pro OEM");
  assert.equal((await repo.get("leads", p.lead)).amount, 5964, "o produto/preço continua o da régua");
});

test("retroativo: valor do card dos leads abertos re-alinhado ao produto da apresentação", async () => {
  const { syncOpenLeadAmounts } = await import("../src/migrations.js");
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "6-10", listings: "2000-10000" });
  // Simula o lead antigo, com o valor do catálogo anterior gravado.
  await repo.update("leads", p.lead, { amount: 8976 });
  // Fechado e proposta aceita ficam de fora.
  const pWon = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  await repo.update("leads", pWon.lead, { amount: 9999, planClosed: "anual", wonAt: "2026-08-01T00:00:00.000Z" });
  const pAceita = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  await repo.update("proposals", pAceita.id, { accepted: true });
  await repo.update("leads", pAceita.lead, { amount: 5555 });

  const n = await syncOpenLeadAmounts(repo);
  assert.equal(n, 1, "só o lead aberto com valor defasado entra");
  assert.equal((await repo.get("leads", p.lead)).amount, 11988, "Ads Escala sugerido pela régua");
  assert.equal((await repo.get("leads", pWon.lead)).amount, 9999, "fechado não muda");
  assert.equal((await repo.get("leads", pAceita.lead)).amount, 5555, "aceita não muda");
  assert.equal(await syncOpenLeadAmounts(repo), 0, "idempotente");
});

// O closer fecha a venda NO CARD (Call → Integração) e precisa dizer o que
// vendeu, com o preço da apresentação: o cockpit recebe esta lista no SEED.
test("catálogo do fechamento: linhas × pacotes com anual/semestral + pacote de OEM como serviço único", async () => {
  const repo = makeMemRepo();
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  const t = await repo.get("proposal_templates", "pt_leverads");

  const rows = dealCatalog(t.calc);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(rows.map((r) => r.id), [
    "oem_essencial", "oem_escala", "ads_essencial", "ads_escala", "price_essencial", "price_escala", "price_enterprise", "oem_pack",
  ]);
  assert.deepEqual(byId.ads_escala.prices.map((p) => [p.plan, p.label, p.value]),
    [["anual", "Anual", 11988], ["semestral", "Semestral", 7182]],
    "só anual e semestral: a recorrente saiu");
  assert.equal(byId.ads_escala.group, "Lever Ads", "o gate agrupa por linha");
  assert.equal(byId.oem_essencial.group, "Lever OEM");
  assert.equal(byId.price_enterprise.group, "Lever Price");
  assert.equal(byId.price_enterprise.prices[0].value, 41964);
  assert.ok(!rows.some((r) => r.prices.some((p) => p.plan === "mensal")), "nenhum plano mensal");

  // Pacote de OEM avulso: serviço único por quantidade.
  assert.equal(byId.oem_pack.oneOff, true);
  assert.equal(byId.oem_pack.group, "Adicionais");
  assert.deepEqual(byId.oem_pack.prices.map((p) => [p.plan, p.label, p.value]),
    [["unico", "1.000 anúncios OEM", 2000], ["unico", "2.000 anúncios OEM", 3500], ["unico", "3.000 anúncios OEM", 4500]]);
  assert.equal(DEAL_PRODUCT_LABEL.oem_pack, "Pacote de OEM avulso");
  // Venda antiga continua nomeada (coluna Plano, checkout, Integração).
  assert.equal(DEAL_PRODUCT_LABEL.full, "LeverAds FULL");
  assert.equal(DEAL_PRODUCT_LABEL.parcialoem, "Parcial + OEM 250");
  assert.equal(DEAL_PRODUCT_LABEL.avulso, "Clonagem avulsa");
  assert.equal(DEAL_PRODUCT_LABEL.ads_escala, "Lever Ads · Escala");

  // Preço editado no banco vale na hora (sem deploy).
  const calc = JSON.parse(JSON.stringify(t.calc));
  calc.catalog.products.ads_escala.anu.total = 6900;
  calc.catalog.oemPacks = [{ qty: 500, price: 1200 }];
  const edited = Object.fromEntries(dealCatalog(calc).map((r) => [r.id, r]));
  assert.equal(edited.ads_escala.prices[0].value, 6900);
  assert.deepEqual(edited.oem_pack.prices, [{ plan: "unico", label: "500 anúncios OEM", value: 1200 }]);

  // SaaS sem catálogo (mentoria do Kids): nada a oferecer, o campo some.
  assert.deepEqual(dealCatalog({ plans: {} }), []);
});
