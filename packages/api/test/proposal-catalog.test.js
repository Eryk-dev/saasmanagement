// Catálogo de produto/oferta da proposta (tela zero com régua): migração do
// template, sugestão pela matriz S-E, transform do deck por produto (pricing
// único + tela OEM + ritmo claro/escuro), trava do produto no link do cliente
// e o card de decisão (catalogUI) só no modo closer.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog } = await import("../src/migrations.js");
const { applyCatalog, activeProduct, catalogUI, suggestProduct, dealCatalog, DEAL_PRODUCT_LABEL } = await import("../src/proposal-catalog.js");
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
  assert.equal(t.calc.catalog.products.parcialA.anu.total, 4536, "Parcial na tabela de 21/08");
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
  assert.equal(pricing.planTag, "ANUAL", "o anual abre a apresentação");
  assert.equal(pricing.price, "4.536");
  assert.equal(pricing.cycles, "12x de *378*/mês", "parcela com marcador de destaque");
  assert.equal(pricing.offer2.planTag, "SEMESTRAL");
  assert.equal(pricing.offer2.price, "2.574", "semestral no Shift+1");
  assert.equal(pricing.offer2.cycles, "6x de *429*/mês", "semestre cobra 6 parcelas, não 12");
  assert.equal(pricing.offer3.planTag, "RECORRENTE");
  assert.equal(pricing.offer3.price, "299", "mensalidade da recorrente no Shift+2");
  assert.equal(pricing.offer3.cycles, "+ R$ 1.500 de clonagem na entrada", "a entrada aparece no card");
  assert.equal(pricing.offer4, undefined, "escada antiga morta");
  assert.ok(!t.slides.some((s) => s.key === "oem_processo"), "sem tela OEM");
  assert.equal(t.slides.filter((s) => s.type === "pricing").length, 1, "um investimento só");
});

test("autopeças pequeno → Parcial + OEM 250; tela OEM escura depois do 3 etapas e ritmo re-alternado", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const t = applyCatalog(p);
  assert.equal(t.product, "parcialoem");
  const keys = t.slides.map((s) => s.key);
  const iSteps = keys.indexOf("como_funciona");
  assert.equal(keys[iSteps + 1], "oem_processo", "tela OEM logo depois do 3 etapas");
  const oem = t.slides[iSteps + 1];
  assert.equal(oem.bg, "dark");
  assert.match(oem.pills[0], /^250 anúncios OEM/, "cota do combo");
  assert.equal(t.slides[iSteps + 2].bg, "", "impacto vira claro");
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.bg, "dark", "investimento fecha escuro");
  assert.equal(pricing.price, "7.188");
  assert.equal(pricing.sub, "soma: Parcial + OEM 250/mês");
  assert.equal(pricing.offer3.sub, "soma: Parcial + OEM 250/mês", "o subtítulo é do produto, vale nas três");
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
  assert.equal(pricing.price, "3.288", "OEM 125 pro pequeno");
  assert.match(pricing.sub, /125 anúncios por mês/);
  assert.equal(pricing.offer3.cycles, "sem entrada, cancela quando quiser", "OEM avulso não tem clonagem");

  const big = await makeProposal(repo, { niche: "outros", accounts: "10+", listings: "10000+" });
  big.state.product = "oem";
  const tb = applyCatalog(big);
  assert.equal(tb.slides.find((s) => s.type === "pricing").price, "8.388", "OEM 500 pro grande");
});

test("leque do OEM avulso: o closer troca a cota na tela zero (state.oemCota)", async () => {
  const repo = await seedRepo();
  const big = await makeProposal(repo, { niche: "outros", accounts: "10+", listings: "10000+" });
  big.state.product = "oem";
  big.state.oemCota = 250;
  const t = applyCatalog(big);
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.price, "5.388", "cota 250 escolhida pelo closer");
  assert.equal(pricing.cycles, "12x de *449*/mês");
  assert.equal(pricing.offer2.price, "2.994", "semestral da cota 250 no Shift+1");
  assert.match(pricing.sub, /250 anúncios por mês/);
  assert.equal(t.oemCota, 250, "tela do processo OEM acompanha a cota");

  big.state.oemCota = 999;
  assert.equal(applyCatalog(big).slides.find((s) => s.type === "pricing").price, "8.388", "cota fora do leque volta pro porte");
});

test("dor [OEM] não manda no produto: a régua decide; OEM avulso é escolha do closer", async () => {
  const repo = await seedRepo();
  // Autopeças pequeno: régua → combo Parcial + OEM 250, com ou sem dor OEM
  // (pedido do Leo, 15/08/2026: quem veio pelo OEM também serve pro LeverAds).
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "parcialoem");

  p.state = { ...p.state, pain: "OEM" };
  assert.equal(suggestProduct(p.calc, p.state, p.data.answers), "parcialoem", "a dor só troca a trilha SPIN");
  const t = applyCatalog(p);
  assert.equal(t.product, "parcialoem");
  assert.equal(t.slides.find((s) => s.type === "pricing").price, "7.188", "preço da régua, não do OEM avulso");

  // Tier alto de autopeças segue no +OEM FULL mesmo com dor OEM.
  const big = await makeProposal(repo, { niche: "autopecas", accounts: "10+", listings: "10000+" });
  big.state = { ...big.state, pain: "OEM" };
  assert.equal(activeProduct(big), "fulloem");
  assert.equal(applyCatalog(big).slides.find((s) => s.type === "pricing").price, "11.988");

  big.state.product = "oem"; // Apresentar continua vencendo tudo.
  assert.equal(activeProduct(big), "oem");
  assert.equal(applyCatalog(big).slides.find((s) => s.type === "pricing").price, "8.388", "cota 500 pro grande, na mão do closer");
});

test("tela zero: dor OEM entra no select depois das letras e não remonta o deck", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const base = catalogUI(p);
  assert.deepEqual(base.painOrder, ["A", "B", "C", "D", "E", "OEM", "none"], "letras, códigos maiores, sem código");
  assert.ok(base.pains.OEM.spin.N.length > 10, "trilha SPIN da dor OEM embarcada");

  p.state = { ...p.state, pain: "OEM" };
  const ui = catalogUI(p);
  assert.equal(ui.suggested, "parcialoem", "a régua continua decidindo o produto");
  assert.equal(ui.pain, "OEM", "a dor fica registrada só como trilha SPIN");
});

test("cliente grande: FULL sugerido; override +OEM FULL usa a base de autopeças com 500/mês", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "3-5", listings: "2000-10000" });
  assert.equal(applyCatalog(p).product, "full");
  assert.equal(applyCatalog(p).slides.find((s) => s.type === "pricing").price, "8.976");
  p.state.product = "fulloem";
  const t = applyCatalog(p);
  const pricing = t.slides.find((s) => s.type === "pricing");
  assert.equal(pricing.price, "11.988");
  assert.ok(JSON.stringify(pricing).includes("500 anúncios gerados por OEM"), "a cota do texto sai do catálogo (100→500)");
  assert.ok(t.slides.some((s) => s.key === "oem_processo"), "tela OEM presente");
});

test("payload público nunca leva o catálogo cru; catalogUI tem nomes/preços prontos", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, {});
  const pub = publicProposal(p, { editable: true });
  assert.equal(pub.calc.catalog, undefined, "tabela de preço é do servidor");
  const ui = catalogUI(p);
  assert.deepEqual(Object.keys(ui.names).sort(), ["full", "fulloem", "oem", "parcialA", "parcialoem"]);
  // As três formas de pagar, na ordem em que o closer apresenta.
  assert.match(ui.priceLines.full, /^Anual R\$ 8\.976 \(12x 748\)/);
  assert.match(ui.priceLines.full, /Shift\+1 semestral R\$ 5\.094 \(6x 849\)/);
  assert.match(ui.priceLines.full, /Shift\+2 recorrente R\$ 499\/mês \+ R\$ 3\.500 de clonagem \(12 meses = R\$ 9\.488\)/,
    "o custo em 12 meses da recorrente vem pronto: é o número que vira economia na frente do lead");
  assert.match(ui.priceLines.parcialA, /^Anual R\$ 4\.536 \(12x 378\)/);
  // Leque do OEM avulso no card: cota ativa pelo porte + os 3 níveis com preço.
  assert.match(ui.priceLines.oem, /^OEM 125\/mês: Anual R\$ 3\.288 \(12x 274\)/, "porte D abre no menor nível");
  assert.match(ui.priceLines.oem, /recorrente R\$ 379\/mês sem entrada/, "OEM avulso não cobra clonagem");
  assert.equal(ui.oemCota, 125);
  assert.deepEqual(ui.oemLevels.map((l) => l.cota), [125, 250, 500]);
  assert.equal(ui.oemLevels[1].short, "R$ 5.388 anu (12x 449) · R$ 2.994 sem (6x 499) · R$ 599/mês rec");
  assert.equal(ui.tier, "D");
  assert.equal(ui.pain, "none", "sem dor marcada → trilha genérica");
  assert.ok(ui.pains.A.spin.S.length > 10, "perguntas SPIN embarcadas");
});

test("tela zero descreve o produto com os empilháveis do slide de investimento", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  const ui = catalogUI(p);
  const itemsOf = (key) => {
    const s = applyCatalog({ ...p, state: { ...p.state, product: key } }).slides.find((x) => x.type === "pricing");
    return s.benefitGroups.slice(0, 2).flatMap((g) => g.items).map((f) => (typeof f === "object" ? f.text : f));
  };
  // Item por item, na mesma ordem: o que o closer lê é o que o lead vai ver.
  for (const key of ["full", "fulloem", "oem", "parcialA", "parcialoem"]) {
    assert.equal(ui.offerLines[key], itemsOf(key).join(" · "), key + ": linha derivada do slide");
  }
  // O lado humano (grupo 3) é igual nos cinco: fica fora da linha do produto.
  assert.ok(!ui.offerLines.full.includes("Suporte"), "grupo 3 não entra na linha");
  // As cotas saem do catálogo, nunca do texto: era aqui que a tela zero
  // prometia 50 OEM/mês e 2.000 clones no semestre com o slide já em 125/1.000.
  assert.match(ui.offerLines.parcialoem, /250 anúncios OEM por mês/);
  assert.match(ui.offerLines.oem, /^125 anúncios OEM criados por mês/, "porte D abre no menor nível");
  const all = Object.values(ui.offerLines).join(" ");
  // \b: "250 anúncios OEM" (cota real do combo) não pode casar como "50 ...".
  assert.ok(!/\b50 anúncios OEM|2\.000 clones/.test(all), "nenhuma cota escrita à mão sobrou");
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
  assert.equal(pricing.price, "7.188");
  assert.equal(pricing.offer2, undefined, "escada secreta fora do link do cliente");
  assert.equal(pricing.offer3, undefined, "nem a recorrente: o cliente vê só a oferta travada");
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

  // Cota do OEM avulso: só cota do leque entra; fora do leque volta pro porte.
  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, oemCota: 250 },
  });
  assert.equal((await repo.get("proposals", p.id)).state.oemCota, 250, "cota do leque entra");
  await app.inject({
    method: "PATCH", url: "/public/proposals/" + p.id,
    payload: { k: p.editKey, oemCota: 75 },
  });
  assert.equal((await repo.get("proposals", p.id)).state.oemCota, "", "cota fora do leque = segue o porte");
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
  const r = await app.inject({ method: "GET", url: "/p/t/pt_leverads?accounts=10%2B&volume=10000%2B&niche=autopecas&product=oem&pain=A&oemCota=250" });
  assert.equal(r.statusCode, 200);
  const payload = payloadOf(r.body);
  assert.ok(payload.catalogUI, "preview roda o card");
  assert.equal(payload.catalogUI.pain, "A", "dor da query aplicada");
  assert.ok(payload.slides.some((s) => s.key === "investimento_oem"), "produto da query aplicado");
  assert.ok(!payload.slides.some((s) => s.key === "como_funciona"), "OEM avulso sem a tela de clonagem");
  assert.equal(payload.slides.find((s) => s.key === "investimento_oem").price, "5.388", "cota da query aplicada (leque)");
  assert.equal(payload.catalogUI.oemCota, 250, "select de cota abre no valor simulado");
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

test("tabela de 21/08: template reprecificado, propostas abertas junto e cota de OEM remapeada", async () => {
  const { migrateCatalogPricing, backfillCatalogPricing } = await import("../src/migrations.js");
  const repo = await seedRepo();
  // Volta o template pro estado ANTERIOR à tabela nova: preços velhos, leque
  // 50/100/200 e sem o marcador pricingV.
  const t0 = await repo.get("proposal_templates", "pt_leverads");
  const velho = JSON.parse(JSON.stringify(t0.calc.catalog));
  delete velho.pricingV;
  velho.products.full = { name: "LeverAds FULL", sem: { total: 7188, per: 599 }, anu: { total: 11988, per: 999 } };
  velho.products.oem = {
    name: "OEM avulso",
    small: { cota: 50, sem: { total: 1788, per: 149 }, anu: { total: 3288, per: 274 } },
    mid: { cota: 100, sem: { total: 2988, per: 249 }, anu: { total: 5388, per: 449 } },
    big: { cota: 200, sem: { total: 4788, per: 399 }, anu: { total: 8388, per: 699 } },
  };
  velho.pains = { Z: { label: "dor editada pelo dono" } };
  velho.oneOff = { rows: [{ range: "Tudo", price: "R$ 7" }] };
  await repo.update("proposal_templates", "pt_leverads", { calc: { ...t0.calc, catalog: velho } });

  const mk = (id, extra) => repo.create("proposals", {
    id, saas: "leverads", template: "pt_leverads", lead: "ld_x", name: "Proposta",
    calc: { volumeMid: { "100-500": 300 }, catalog: JSON.parse(JSON.stringify(velho)) },
    slides: [], data: { answers: {} },
    state: { accounts: "1", volume: "100-500", product: "oem", pain: "OEM", oemCota: 100 },
    editKey: "k_" + id, accepted: false,
    ...extra,
  });
  await mk("pr_aberta");
  await mk("pr_sem_cota", { state: { accounts: "1", volume: "100-500" } });
  await mk("pr_aceita", { accepted: true });
  await mk("pr_filha", { sharedFrom: "pr_aberta", editKey: "" });

  assert.equal(await migrateCatalogPricing(repo), true, "template reprecificado");
  const cat = (await repo.get("proposal_templates", "pt_leverads")).calc.catalog;
  assert.equal(cat.products.full.anu.total, 8976, "tabela nova no template");
  assert.equal(cat.products.full.rec.setup, 3500, "clonagem entra como entrada da recorrente");
  assert.deepEqual(["small", "mid", "big"].map((k) => cat.products.oem[k].cota), [125, 250, 500]);
  // Cirúrgico: só os produtos. Dor e clonagem avulsa editadas pelo dono ficam.
  assert.deepEqual(Object.keys(cat.pains), ["Z"], "dores do dono preservadas");
  assert.deepEqual(cat.oneOff.rows, [{ range: "Tudo", price: "R$ 7" }], "clonagem avulsa do banco preservada");
  assert.equal(await migrateCatalogPricing(repo), false, "idempotente: o marcador pricingV segura");

  assert.equal(await backfillCatalogPricing(repo), 2, "as duas abertas entram");
  const aberta = await repo.get("proposals", "pr_aberta");
  assert.equal(aberta.calc.catalog.products.full.anu.total, 8976, "snapshot reprecificado");
  assert.equal(aberta.calc.volumeMid["100-500"], 300, "resto do calc preservado");
  assert.equal(aberta.state.oemCota, 250, "cota 100 vira 250: a escolha do closer sobrevive ao limite novo");
  assert.equal(aberta.state.pain, "OEM", "resto do estado preservado");
  assert.equal((await repo.get("proposals", "pr_sem_cota")).state.oemCota, undefined, "quem não escolheu cota segue sem");
  assert.equal((await repo.get("proposals", "pr_aceita")).calc.catalog.products.full.anu.total, 11988, "aceita não muda");
  assert.equal((await repo.get("proposals", "pr_filha")).calc.catalog.products.full.anu.total, 11988, "link do cliente não muda");
  assert.equal(await backfillCatalogPricing(repo), 0, "idempotente");
});

test("retroativo do leque OEM: aberta ganha a tabela nova; aceita, link de cliente e já-migrada ficam", async () => {
  const { backfillOemLeque } = await import("../src/migrations.js");
  const repo = await seedRepo();
  const novo = (await repo.get("proposal_templates", "pt_leverads")).calc.catalog;
  // Snapshot com o catálogo ANTIGO: leque de 2 cotas e preços de antes de 14/08.
  const antigo = JSON.parse(JSON.stringify(novo));
  antigo.products.oem = {
    name: "OEM avulso",
    small: { cota: 50, sem: { total: 1188, per: 99 }, anu: { total: 1788, per: 149 } },
    big: { cota: 200, sem: { total: 2988, per: 249 }, anu: { total: 4188, per: 349 } },
  };
  const mk = (id, extra) => repo.create("proposals", {
    id, saas: "leverads", template: "pt_leverads", lead: "ld_x", name: "Proposta",
    calc: { volumeMid: { "100-500": 300 }, catalog: JSON.parse(JSON.stringify(antigo)) },
    slides: [], data: { answers: {} },
    state: { accounts: "1", volume: "100-500", product: "oem", pain: "OEM" },
    editKey: "k_" + id, accepted: false,
    ...extra,
  });
  // A tabela v1 de 14/08 (preços errados, corrigidos no mesmo dia): também
  // entra no conserto — ela só existiu por automação, nunca por edição do dono.
  const v1 = JSON.parse(JSON.stringify(novo));
  v1.products.oem = {
    name: "OEM avulso",
    small: { cota: 50, sem: { total: 2976, per: 248 }, anu: { total: 4176, per: 348 } },
    mid: { cota: 100, sem: { total: 4776, per: 398 }, anu: { total: 5976, per: 498 } },
    big: { cota: 200, sem: { total: 7176, per: 598 }, anu: { total: 8376, per: 698 } },
  };
  await mk("pr_aberta");
  await mk("pr_v1", { calc: { catalog: v1 } });
  await mk("pr_aceita", { accepted: true });
  await mk("pr_filha", { sharedFrom: "pr_aberta", editKey: "" });
  await mk("pr_nova", { calc: { catalog: JSON.parse(JSON.stringify(novo)) } });
  // Snapshot com mid e preço PRÓPRIO (edição do dono): soberano, não muda.
  const editada = JSON.parse(JSON.stringify(novo));
  editada.products.oem.small.sem.total = 999;
  await mk("pr_editada", { calc: { catalog: editada } });

  const n = await backfillOemLeque(repo);
  assert.equal(n, 2, "a pré-leque e a v1 entram");

  for (const id of ["pr_aberta", "pr_v1"]) {
    const p = await repo.get("proposals", id);
    assert.deepEqual(
      ["small", "mid", "big"].map((k) => [p.calc.catalog.products.oem[k].cota, p.calc.catalog.products.oem[k].sem.total]),
      [[125, 1914], [250, 2994], [500, 4494]],
      "tabela atual no snapshot de " + id,
    );
  }
  const p = await repo.get("proposals", "pr_aberta");
  assert.equal(p.state.product, "oem", "escolhas do closer preservadas");
  assert.equal(p.calc.volumeMid["100-500"], 300, "resto do calc preservado");
  assert.equal((await repo.get("proposals", "pr_aceita")).calc.catalog.products.oem.mid, undefined, "aceita não muda");
  assert.equal((await repo.get("proposals", "pr_filha")).calc.catalog.products.oem.mid, undefined, "link do cliente não muda");
  assert.equal((await repo.get("proposals", "pr_editada")).calc.catalog.products.oem.small.sem.total, 999, "edição do dono é soberana");
  assert.equal(await backfillOemLeque(repo), 0, "idempotente");
});

// ── Card do pipeline = preço da apresentação ────────────────────────────────
// O amount do lead É o preço semestral do produto que a régua sugere (ou que o
// closer escolheu em Apresentar) — não mais a fórmula por assentos.
test("geração: lead.amount é o preço do produto sugerido, não a fórmula por assentos", async () => {
  const repo = await seedRepo();
  // D fora de autopeças → Parcial (R$ 4.536 no ano).
  const p1 = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p1.lead)).amount, 4536);
  // Tier alto → FULL (R$ 8.976 no ano), independente do nº de contas — era a
  // fórmula por assentos que inflava o card pra 8,4k/10,8k.
  const p2 = await makeProposal(repo, { niche: "outros", accounts: "3-5", listings: "2000-10000" });
  assert.equal((await repo.get("leads", p2.lead)).amount, 8976);
  // Dor [OEM] do anúncio NÃO rebaixa: autopeças porte D segue a régua →
  // combo Parcial + OEM 250 (R$ 7.188 no ano).
  const p3 = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500", sourcePain: "oem" });
  assert.equal((await repo.get("leads", p3.lead)).amount, 7188);
});

test("tela zero mexeu → o card acompanha o produto ativo; negócio fechado não mexe", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p.lead)).amount, 4536, "nasce no Parcial");
  const app = Fastify();
  registerProposalRoutes(app, repo);

  // Closer decide apresentar o FULL: o card segue na hora.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, product: "full" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 8976);

  // Régua re-classificada na call (contas/anúncios reais) com Apresentar de
  // volta na régua: tier A continua FULL.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, product: "", accounts: "3-5", volume: "2000-10000" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 8976);

  // Dor OEM marcada na tela zero: só trilha SPIN — produto e card não mudam.
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, pain: "OEM" } });
  assert.equal((await repo.get("leads", p.lead)).amount, 8976);

  // Negócio fechado: o valor de venda é soberano, a tela zero não sobrescreve.
  await repo.update("leads", p.lead, { amount: 5000, planClosed: "semestral" });
  await app.inject({ method: "PATCH", url: "/public/proposals/" + p.id, payload: { k: p.editKey, oemCota: 250 } });
  assert.equal((await repo.get("leads", p.lead)).amount, 5000);
});

test("dor [OEM] inferida na abertura do link entra como trilha SPIN sem mexer no card", async () => {
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "autopecas", accounts: "1", listings: "100-500" });
  assert.equal((await repo.get("leads", p.lead)).amount, 7188, "nasce no combo Parcial + OEM 250");
  // A dor chega DEPOIS da geração (ad_insights sincroniza no ciclo de marketing).
  await repo.update("leads", p.lead, { utm: { content: "ad_9" } });
  await repo.create("ad_insights", { id: "ai_9", saas: "leverads", adId: "ad_9", date: "2026-08-14", adName: "peças [OEM]" });

  const synced = await syncProposalLeadSnapshot(repo, await repo.get("proposals", p.id));
  assert.equal(synced.state.pain, "OEM", "trilha SPIN do closer aponta pro OEM");
  assert.equal((await repo.get("leads", p.lead)).amount, 7188, "o produto/preço continua o da régua");
});

test("retroativo: valor do card dos leads abertos re-alinhado ao produto da apresentação", async () => {
  const { syncOpenLeadAmounts } = await import("../src/migrations.js");
  const repo = await seedRepo();
  const p = await makeProposal(repo, { niche: "outros", accounts: "3-5", listings: "2000-10000" });
  // Simula o lead antigo, com o valor da fórmula por assentos gravado.
  await repo.update("leads", p.lead, { amount: 8388 });
  // Fechado e proposta aceita ficam de fora.
  const pWon = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  await repo.update("leads", pWon.lead, { amount: 9999, planClosed: "anual", wonAt: "2026-08-01T00:00:00.000Z" });
  const pAceita = await makeProposal(repo, { niche: "outros", accounts: "1", listings: "100-500" });
  await repo.update("proposals", pAceita.id, { accepted: true });
  await repo.update("leads", pAceita.lead, { amount: 5555 });

  const n = await syncOpenLeadAmounts(repo);
  assert.equal(n, 1, "só o lead aberto com valor defasado entra");
  assert.equal((await repo.get("leads", p.lead)).amount, 8976, "FULL sugerido pela régua");
  assert.equal((await repo.get("leads", pWon.lead)).amount, 9999, "fechado não muda");
  assert.equal((await repo.get("leads", pAceita.lead)).amount, 5555, "aceita não muda");
  assert.equal(await syncOpenLeadAmounts(repo), 0, "idempotente");
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
  assert.deepEqual(full.map((p) => [p.plan, p.value]),
    [["anual", 8976], ["semestral", 5094], ["mensal", 499]],
    "a recorrente fecha como plano `mensal` (valor = mensalidade), que o billing já entende");

  // OEM avulso tem o leque de cotas (125/250/500): cada nível vira três opções.
  assert.deepEqual(byId.oem.prices.map((p) => `${p.label} ${p.value}`), [
    "Anual · 125 anúncios 3288", "Semestral · 125 anúncios 1914", "Recorrente · 125 anúncios 379",
    "Anual · 250 anúncios 5388", "Semestral · 250 anúncios 2994", "Recorrente · 250 anúncios 599",
    "Anual · 500 anúncios 8388", "Semestral · 500 anúncios 4494", "Recorrente · 500 anúncios 849",
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
  calc.catalog.products.full.anu.total = 6900;
  calc.catalog.oneOff = { rows: [{ range: "Até 100 anúncios", price: "R$ 1.200" }] };
  const edited = Object.fromEntries(dealCatalog(calc).map((r) => [r.id, r]));
  assert.equal(edited.full.prices[0].value, 6900);
  assert.deepEqual(edited.avulso.prices, [{ plan: "unico", label: "Até 100 anúncios", value: 1200 }]);

  // SaaS sem catálogo (mentoria do Kids): nada a oferecer, o campo some.
  assert.deepEqual(dealCatalog({ plans: {} }), []);
});
