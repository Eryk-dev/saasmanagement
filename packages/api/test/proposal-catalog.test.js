// Catálogo de produto/oferta da proposta (tela zero com régua): migração do
// template, sugestão pela matriz S-E, transform do deck por produto (pricing
// único + tela OEM + ritmo claro/escuro), trava do produto no link do cliente
// e o card de decisão (catalogUI) só no modo closer.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog } = await import("../src/migrations.js");
const { applyCatalog, activeProduct, catalogUI, suggestProduct, dealCatalog, DEAL_PRODUCT_LABEL, orderDeck } = await import("../src/proposal-catalog.js");
const { runNativeProposal, shareProposalOffer, publicProposal } = await import("../src/proposal.js");
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

test("migração: faixas de anúncios viram as colunas da régua + catálogo gravado; one-shot", async () => {
  const repo = makeMemRepo();
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  const first = await ensureProposalCatalog(repo);
  assert.equal(first, true, "primeira execução grava");
  const t = await repo.get("proposal_templates", "pt_leverads");
  assert.equal(t.calc.volumeKey, "listings", "volume vem da resposta listings do form");
  assert.deepEqual(Object.keys(t.calc.volumeMid), ["0-100", "100-500", "500-2000", "2000-10000", "10000+"]);
  assert.ok(t.calc.catalog.products.parcialA, "catálogo presente");
  assert.equal(t.calc.catalog.products.parcialA.sem.total, 2100, "Parcial preço fechado 04/08");
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

test("cliente D fora de autopeças → Parcial (preço fechado, sem OEM, sem tela OEM)", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "parcialA");
  const t = applyCatalog(p);
  assert.equal(t.product, "parcialA");
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.key, "investimento_parcial");
  assert.equal(pricing.price, "2.100");
  assert.equal(pricing.cycles, "12x de *175*/mês", "parcela com marcador de destaque");
  assert.equal(pricing.offer2.price, "3.588", "anual no Shift+1");
  assert.equal(pricing.offer3, undefined, "escada antiga morta");
  assert.ok(!t.slides.some((s) => s.key === "oem_processo"), "sem tela OEM");
  assert.equal(t.slides.filter((s) => s.type === "pricing").length, 1, "um investimento só");
});

test("autopeças pequeno → Parcial + OEM 50; tela OEM escura depois do 3 etapas e ritmo re-alternado", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const t = applyCatalog(p);
  assert.equal(t.product, "parcialoem");
  const keys = t.slides.map((s) => s.key);
  const iSteps = keys.indexOf("como_funciona");
  assert.equal(keys[iSteps + 1], "oem_processo", "tela OEM logo depois do 3 etapas");
  const oem = t.slides[iSteps + 1];
  assert.equal(oem.bg, "dark");
  assert.match(oem.pills[0], /^50 anúncios OEM/, "cota do combo");
  assert.equal(t.slides[iSteps + 2].bg, "", "impacto vira claro");
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.bg, "dark", "investimento fecha escuro");
  assert.equal(pricing.price, "3.288");
  assert.equal(pricing.sub, "soma: Parcial + OEM 50/mês");
});

test("OEM avulso: 3 etapas SAI, tela OEM entra clara no lugar; cota segue o porte", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  p.state.product = "oem";
  const t = applyCatalog(p);
  const keys = t.slides.map((s) => s.key);
  assert.ok(!keys.includes("como_funciona"), "clonagem não entra pra quem não compra clonagem");
  const oem = t.slides.find((s) => s.key === "oem_processo");
  assert.equal(oem.bg, "", "clara, na posição do 3 etapas (ritmo original)");
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.price, "1.188", "OEM 50 pro pequeno");
  assert.match(pricing.sub, /50 anúncios por mês/);

  const big = await makeProposal(repo, { niche: "outros", accounts: "10+", listings: "10000+" });
  big.state.product = "oem";
  const tb = applyCatalog(big);
  assert.equal(tb.slides.find((s) => s.type === "pricing").price, "2.988", "OEM 200 pro grande");
});

test("dor [OEM]: o anúncio de part number manda no produto, acima da régua", async () => {
  const repo = await seedRepo();
  // Autopeças pequeno: a régua sozinha mandaria pro combo Parcial + OEM 50.
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "parcialoem");

  p.state = { ...p.state, pain: "OEM" };
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "oem", "quem clicou no anúncio de OEM não veio comprar clonagem");
  const t = applyCatalog(p);
  assert.equal(t.product, "oem");
  assert.ok(!t.slides.some((s) => s.key === "como_funciona"), "o 3 etapas (clonagem) sai do deck");
  assert.equal(t.slides.find((s) => s.type === "pricing").price, "1.188", "cota 50 pelo porte D/E");

  const big = await makeProposal(repo, { niche: "autopecas", accounts: "10+", listings: "10000+" });
  big.state = { ...big.state, pain: "OEM" };
  assert.equal(applyCatalog(big).slides.find((s) => s.type === "pricing").price, "2.988", "cota 200 pro grande");

  big.state.product = "fulloem"; // Apresentar continua vencendo tudo.
  assert.equal(activeProduct(big), "fulloem");
});

test("tela zero: dor OEM entra no select depois das letras e avisa que ela troca o deck", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const base = catalogUI(p);
  assert.deepEqual(base.painOrder, ["A", "B", "C", "D", "E", "OEM", "none"], "letras, códigos maiores, sem código");
  assert.deepEqual(base.painProducts, { OEM: "oem" }, "só a dor de produto obriga recarregar a página");
  assert.equal(base.suggestedBy, "grid");
  assert.ok(base.pains.OEM.spin.N.length > 10, "trilha SPIN da dor OEM embarcada");

  p.state = { ...p.state, pain: "OEM" };
  const ui = catalogUI(p);
  assert.equal(ui.suggested, "oem");
  assert.equal(ui.suggestedBy, "pain", "o card diz que quem decidiu foi a dor, não a matriz");
  assert.equal(ui.oemNeeded, false, "veio de anúncio de OEM: nada a confirmar no rapport");
});

test("cliente grande: FULL sugerido; override +OEM FULL usa a base de autopeças com 200/mês", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "3-5", listings: "2000-10000" });
  assert.equal(applyCatalog(p).product, "full");
  assert.equal(applyCatalog(p).slides.find((s) => s.type === "pricing").price, "7.188");
  p.state.product = "fulloem";
  const t = applyCatalog(p);
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.price, "11.988");
  assert.ok(JSON.stringify(pricing).includes("200 anúncios gerados por OEM"), "100→200 na base de autopeças");
  assert.ok(t.slides.some((s) => s.key === "oem_processo"), "tela OEM presente");
});

test("payload público nunca leva o catálogo cru; catalogUI tem nomes/preços prontos", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const pub = publicProposal(p, { editable: true });
  assert.equal(pub.calc.catalog, undefined, "tabela de preço é do servidor");
  const ui = catalogUI(p);
  assert.deepEqual(Object.keys(ui.names).sort(), ["full", "fulloem", "oem", "parcialA", "parcialoem"]);
  assert.match(ui.priceLines.full, /R\$ 7\.188 no semestre \(12x 599\)/);
  assert.match(ui.priceLines.parcialA, /R\$ 2\.100 no semestre \(12x 175\)/);
  assert.equal(ui.tier, "D");
  assert.equal(ui.pain, "none", "sem dor marcada → trilha genérica");
  assert.ok(ui.pains.A.spin.S.length > 10, "perguntas SPIN embarcadas");
});

test("serviço único: tabela por faixa na tela zero, fora do deck e sobrescrita pelo banco", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const one = catalogUI(p).oneOffCloning;
  assert.equal(one.tag, "serviço único");
  assert.deepEqual(one.rows.map((r) => r.price), ["R$ 996", "R$ 2.184", "R$ 2.988"]);
  assert.match(one.rows[0].range, /100 anúncios/);
  // É consulta do closer: nada disso entra no deck que o cliente recebe.
  assert.equal(JSON.stringify(applyCatalog(p).slides).includes("serviço único"), false);

  p.calc.catalog.oneOff = { tag: "serviço único", title: "Outro", rows: [{ range: "Tudo", price: "R$ 1" }] };
  assert.deepEqual(catalogUI(p).oneOffCloning.rows, [{ range: "Tudo", price: "R$ 1" }], "banco manda no preço");
});

test("link do cliente: deck transformado, oferta travada, sem catálogo no snapshot filho", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const r = await shareProposalOffer(repo, p, 1, { baseUrl: "http://x" });
  assert.equal(r.ok, true);
  const child = r.proposal;
  const pricing = child.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.key, "investimento_combo", "produto da tela zero travado");
  assert.equal(pricing.price, "3.288");
  assert.equal(pricing.offer2, undefined, "escada secreta fora do link do cliente");
  assert.ok(child.slides.some((s) => s.key === "oem_processo"), "tela OEM viaja junto");
  assert.equal((child.calc || {}).catalog, undefined, "catálogo não viaja");
});

test("link do cliente respeita o produto escolhido pelo closer em Apresentar", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  // A régua sugeriria Parcial + OEM; o closer decidiu apresentar OEM avulso.
  p.state = { ...p.state, product: "oem" };

  const r = await shareProposalOffer(repo, p, 1, { baseUrl: "http://x" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.state.product, "oem");
  assert.equal(r.proposal.slides.find((s) => s.type === "pricing").key, "investimento_oem");
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
  assert.ok(closerPayload.slides.some((s) => s.key === "investimento_parcial"), "deck já transformado");

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
    payload: { k: p.editKey, product: "fulloem", pain: "B", oem: true },
  });
  assert.equal(patch.statusCode, 200);
  const saved = await repo.get("proposals", p.id);
  assert.equal(saved.state.product, "fulloem");
  assert.equal(saved.state.pain, "B");
  assert.equal(saved.state.oem, true);

  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, product: "nao_existe" },
  });
  assert.equal((await repo.get("proposals", p.id)).state.product, "fulloem", "produto inválido não entra");

  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, product: "" },
  });
  assert.equal((await repo.get("proposals", p.id)).state.product, "", "vazio = volta a seguir a régua");
});

// ── Teste A/B da ordem da apresentação (Leo, 12/08) ─────────────────────────
const DECK_REAL = [
  { key: "hero", type: "hero", bg: "" },
  { key: "nossa_operacao", type: "custom", bg: "dark" },
  { key: "perfis_ig", type: "custom", bg: "" },
  { key: "sobre_nos", type: "cards", bg: "dark" },
  { key: "como_funciona", type: "steps", bg: "" },
  { key: "oem_processo", type: "steps", bg: "dark" },
  { key: "impacto", type: "compare", bg: "dark" },
  { key: "investimento_combo", type: "pricing", bg: "" },
];

test("ordem B: mecanismo → OEM → preço → impacto → história, sem capa e com ritmo refeito", () => {
  const b = orderDeck(DECK_REAL, "B");
  assert.deepEqual(b.map((s) => s.key), [
    "como_funciona", "oem_processo", "investimento_combo", "impacto", "nossa_operacao", "perfis_ig", "sobre_nos",
  ]);
  assert.deepEqual(b.map((s) => s.bg), ["", "dark", "", "dark", "", "dark", ""], "claro/escuro alternado do zero");
  assert.equal(DECK_REAL[0].key, "hero", "não mexe no array original");
  assert.deepEqual(orderDeck(DECK_REAL, "").map((s) => s.key), DECK_REAL.map((s) => s.key), "A = ordem de sempre");
  // Sem OEM a fila é a mesma, só sem a tela do processo.
  const semOem = orderDeck(DECK_REAL.filter((s) => s.key !== "oem_processo"), "B");
  assert.deepEqual(semOem.map((s) => s.key), [
    "como_funciona", "investimento_combo", "impacto", "nossa_operacao", "perfis_ig", "sobre_nos",
  ]);
  // Slide que a régua não conhece não some: fica no fim, na ordem original.
  const comExtra = orderDeck([...DECK_REAL, { key: "novo_slide", type: "custom" }], "B");
  assert.equal(comExtra.length, DECK_REAL.length, "capa sai, o resto fica");
  assert.equal(comExtra[comExtra.length - 1].key, "novo_slide");
});

test("ordem B na proposta: PATCH liga o beta e o deck servido já vem reordenado", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const padrao = applyCatalog(await repo.get("proposals", p.id));
  assert.equal(padrao.slides[0].key, "hero", "A abre na capa");

  const patch = await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, deckOrder: "b" },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal((await repo.get("proposals", p.id)).state.deckOrder, "B", "aceita minúsculo");

  const beta = applyCatalog(await repo.get("proposals", p.id));
  assert.deepEqual(beta.slides.map((s) => s.key).slice(0, 3), ["como_funciona", "oem_processo", "investimento_combo"]);
  assert.ok(!beta.slides.some((s) => s.type === "hero"), "capa fora do beta");
  assert.equal(beta.slides.length, padrao.slides.length - 1, "só a capa saiu");

  const closer = await app.inject({ method: "GET", url: "/p/" + p.id + "?k=" + p.editKey });
  assert.equal(payloadOf(closer.body).catalogUI.deckOrder, "B", "pílula A/B abre marcada no beta");

  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, deckOrder: "z" } });
  assert.equal((await repo.get("proposals", p.id)).state.deckOrder, "", "valor estranho volta pro padrão");
});

test("preview /p/t: simulação via query (produto e dados) sem persistir nada", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const r = await app.inject({ method: "GET", url: "/p/t/pt_leverads?accounts=10%2B&volume=10000%2B&niche=autopecas&product=oem&pain=A" });
  assert.equal(r.statusCode, 200);
  const payload = payloadOf(r.body);
  assert.ok(payload.catalogUI, "preview roda o card");
  assert.equal(payload.catalogUI.pain, "A", "dor da query aplicada");
  assert.ok(payload.slides.some((s) => s.key === "investimento_oem"), "produto da query aplicado");
  assert.ok(!payload.slides.some((s) => s.key === "como_funciona"), "OEM avulso sem a tela de clonagem");
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
  assert.equal(t.product, "full", "tier C = perfil de FULL");

  assert.equal((await repo.get("proposals", "pr_aceita")).calc.catalog, undefined, "aceita não muda");
  assert.equal((await repo.get("proposals", "pr_filha")).calc.catalog, undefined, "link do cliente não muda");
  assert.equal(await backfillProposalCatalog(repo), 0, "idempotente");
});

// O closer fecha a venda NO CARD (Call → Integração) e precisa dizer o que
// vendeu, com o preço da apresentação: o cockpit recebe esta lista no SEED.
test("catálogo do fechamento: produtos com preço + clonagem avulsa como serviço único", async () => {
  const repo = makeMemRepo();
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  const t = await repo.get("proposal_templates", "pt_leverads");

  const rows = dealCatalog(t.calc);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(rows.map((r) => r.id), ["full", "fulloem", "oem", "parcialA", "parcialoem", "avulso"]);

  const full = byId.full.prices;
  assert.deepEqual(full.map((p) => [p.plan, p.value]), [["semestral", 7188], ["anual", 11988]]);

  // OEM avulso tem dois níveis de cota: cada um vira uma opção nomeada.
  assert.deepEqual(byId.oem.prices.map((p) => `${p.label} ${p.value}`), [
    "Semestral · 50 anúncios 1188", "Anual · 50 anúncios 1788",
    "Semestral · 200 anúncios 2988", "Anual · 200 anúncios 4188",
  ]);

  // Clonagem avulsa: serviço único por faixa de anúncios (preço em texto no
  // catálogo vira número pro cockpit preencher o valor do negócio). Sem oneOff
  // no banco valem as faixas padrão do código.
  const semBanco = JSON.parse(JSON.stringify(t.calc));
  delete semBanco.catalog.oneOff;
  const avulso = dealCatalog(semBanco).find((r) => r.id === "avulso");
  assert.equal(avulso.oneOff, true);
  assert.deepEqual(avulso.prices.map((p) => [p.plan, p.value]), [["unico", 996], ["unico", 2184], ["unico", 2988]]);
  assert.equal(DEAL_PRODUCT_LABEL.avulso, "Clonagem avulsa");

  // Preço editado no banco vale na hora (sem deploy).
  const calc = JSON.parse(JSON.stringify(t.calc));
  calc.catalog.products.full.sem.total = 6900;
  calc.catalog.oneOff = { rows: [{ range: "Até 100 anúncios", price: "R$ 1.200" }] };
  const edited = Object.fromEntries(dealCatalog(calc).map((r) => [r.id, r]));
  assert.equal(edited.full.prices[0].value, 6900);
  assert.deepEqual(edited.avulso.prices, [{ plan: "unico", label: "Até 100 anúncios", value: 1200 }]);

  // SaaS sem catálogo (mentoria do Kids): nada a oferecer, o campo some.
  assert.deepEqual(dealCatalog({ plans: {} }), []);
});
