// Opção C: a apresentação em SLIDES (12/09/2026). O que este teste protege:
// a conta do plano sai do CATÁLOGO (nada de preço escrito no deck), o link do
// cliente não leva a tabela de preço no fonte, a tela zero só existe no modo
// closer e a configuração dela vira `state.product`/`state.cycle` — que é o que
// o resto do cockpit lê (valor do lead, gate de Ganho, link de pagamento).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureSlidesDeck } = await import("../src/migrations.js");
const { runNativeProposal } = await import("../src/proposal.js");
const { registerProposalRoutes } = await import("../src/routes.proposals.js");
const { calcOferta, deckConfig, slimCatalog, proposalSlidesPageHtml } = await import("../src/proposal-slides-page.js");

const TEMPLATE = {
  id: "pt_leverads",
  saas: "leverads",
  name: "Proposta · LeverAds",
  status: "published",
  theme: { accent: "#23D8D3" },
  calc: {
    seatsKey: "accounts",
    seatsMap: { "1": 2, "2": 2, "3-5": 4, "6-10": 8, "10+": 12 },
    volumeKey: "volume", volumeMid: { "0-10": 10 },
    plans: {}, defaultCycle: "annual",
  },
  slides: [{ key: "hero", type: "hero", bg: "", title: "Capa" }],
};

async function seedRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  await ensureSlidesDeck(repo);
  return repo;
}

async function catalogoDoTemplate(repo) {
  const t = await repo.get("proposal_templates", "pt_leverads");
  return slimCatalog(t.calc.catalog);
}

const cfgBase = {
  nome: "Viviane", empresa: "Zpack", contas: 3, pedidos: 300, ticket: 120, vistaPct: 20,
  plataforma: true, linha: "ads", tier: "essencial",
  price: false, priceTier: "essencial", oem: false, oemPack: "1000", periodo: "anual",
};

test("migração: o deck de slides nasce selecionável e com o catálogo do deck padrão; idempotente", async () => {
  const repo = await seedRepo();
  const t = await repo.get("proposal_templates", "pt_leverads_slides");
  assert.equal(t.layout, "slides", "é o renderer novo");
  assert.equal(t.selectable, true, "aparece no select do card do lead");
  assert.equal(t.status, "draft", "não vira o padrão do produto");
  assert.equal(t.calc.catalog.products.ads_escala.anu.per, 999, "preço vem do catálogo, não do deck");
  assert.equal(await ensureSlidesDeck(repo), false, "segunda execução não mexe");

  // Preço novo no deck padrão entra no de slides sozinho.
  const base = await repo.get("proposal_templates", "pt_leverads");
  const catalog = JSON.parse(JSON.stringify(base.calc.catalog));
  catalog.products.ads_escala.anu.per = 1099;
  await repo.update("proposal_templates", "pt_leverads", { calc: { ...base.calc, catalog } });
  assert.equal(await ensureSlidesDeck(repo), true, "o catálogo acompanha");
  const t2 = await repo.get("proposal_templates", "pt_leverads_slides");
  assert.equal(t2.calc.catalog.products.ads_escala.anu.per, 1099);
});

test("a conta do plano sai do catálogo: pacote, conta extra, período e pagamento à vista", async () => {
  const repo = await seedRepo();
  const cat = await catalogoDoTemplate(repo);

  const essencial = calcOferta(cat, cfgBase);
  assert.equal(essencial.parcelas, 12);
  assert.equal(essencial.mensal, 497, "Ads Essencial anual");
  assert.equal(essencial.vistaFmt, "4.771", "12 x 497 com 20% à vista");

  // 5 contas no Essencial (3 inclusas): duas extras a R$ 100.
  const comExtras = calcOferta(cat, { ...cfgBase, contas: 5 });
  assert.equal(comExtras.mensal, 697, "497 + 2 contas extras");
  assert.match(comExtras.entregaveis[0].nota, /2 contas além das 3/, "a nota conta as extras");

  // Escala tem 7 contas inclusas: as mesmas 5 contas não geram extra.
  const escala = calcOferta(cat, { ...cfgBase, contas: 5, tier: "escala" });
  assert.equal(escala.mensal, 999, "Escala anual, sem conta extra");

  const semestral = calcOferta(cat, { ...cfgBase, periodo: "semestral" });
  assert.equal(semestral.parcelas, 6);
  assert.equal(semestral.mensal, 597, "semestral é outra parcela, não o mesmo preço dividido");

  const completo = calcOferta(cat, { ...cfgBase, tier: "escala", price: true, priceTier: "escala", oem: true, oemPack: "2000" });
  assert.equal(completo.mensal, 999 + 1497, "plataforma + Price somam na parcela");
  assert.equal(completo.setupFmt, "3.500", "pacote de OEM é pagamento único, fora da parcela");
  assert.equal(completo.planoNome, "Lever Ads · Escala + Lever Price · Escala + OEM 2.000");
  assert.equal(completo.entregaveis.length, 4, "um card por produto + o lado humano");
  assert.ok(completo.entregaveis[0].itens.length > 0, "entregáveis vêm do catálogo, não escritos no slide");
});

test("sem produto escolhido, a apresentação não inventa preço", async () => {
  const repo = await seedRepo();
  const cat = await catalogoDoTemplate(repo);
  const vazio = calcOferta(cat, { ...cfgBase, plataforma: false });
  assert.equal(vazio.mensal, 0);
  assert.equal(vazio.planoNome, "Selecione um produto");
  assert.equal(vazio.vendasNecessarias, 0, "sem plano não existe 'quantas vendas pagam'");
  assert.equal(vazio.mostra.ads, false, "o slide do produto sai da apresentação");
});

test("a tangibilidade traduz a parcela em vendas com o ticket informado", async () => {
  const repo = await seedRepo();
  const cat = await catalogoDoTemplate(repo);
  const o = calcOferta(cat, { ...cfgBase, tier: "escala", ticket: 200, pedidos: 400 });
  assert.equal(o.vendasNecessarias, 5, "999 / 200 arredondado pra cima");
  assert.equal(o.percentualExtra, "1,3%", "5 vendas sobre 400 pedidos");
});

test("a configuração nasce do lead e do produto que a régua sugere", async () => {
  const p = {
    state: { seats: 4 },
    data: { lead: { name: "Viviane Souza", firstName: "Viviane", company: "Zpack Autopeças" } },
  };
  const c = deckConfig(p, { suggested: "oem_escala" });
  assert.equal(c.nome, "Viviane");
  assert.equal(c.empresa, "Zpack Autopeças");
  assert.equal(c.contas, 4, "contas vêm dos assentos do snapshot");
  assert.equal(c.linha, "oem");
  assert.equal(c.tier, "escala");
  assert.equal(c.periodo, "anual", "a apresentação abre no anual");
  // Lixo não entra: enum inválido cai no padrão e número vira número.
  const sujo = deckConfig({ state: { deckC: { linha: "hack", tier: "ouro", contas: "-3", vistaPct: 999, periodo: "mensal" } } }, { suggested: "ads_essencial" });
  assert.equal(sujo.linha, "ads");
  assert.equal(sujo.tier, "essencial");
  assert.equal(sujo.contas, 2);
  assert.equal(sujo.vistaPct, 90, "desconto à vista tem teto");
  assert.equal(sujo.periodo, "anual");
});

test("rota: o closer recebe a tela zero e a tabela; o cliente recebe só os números", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", {
    id: "ld_slides", saas: "leverads", name: "Cleber Souza", company: "O2 Consultoria",
    niche: "autopecas", accounts: "6-10", listings: "100-500",
  });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_slides" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.layout, "slides", "o layout viaja no snapshot");

  const app = Fastify();
  registerProposalRoutes(app, repo);

  const closer = await app.inject({ method: "GET", url: "/p/" + r.proposal.id + "?k=" + r.proposal.editKey });
  assert.equal(closer.statusCode, 200);
  assert.match(closer.body, /Configurar apresentação/, "tela zero no modo closer");
  assert.match(closer.body, /Monte a proposta antes de começar/);
  assert.match(closer.body, /price_enterprise/, "a tabela vai pro navegador do closer (cálculo ao vivo)");

  const cliente = await app.inject({ method: "GET", url: "/p/" + r.proposal.id });
  assert.equal(cliente.statusCode, 200);
  assert.doesNotMatch(cliente.body, /Configurar apresentação/, "cliente não vê a tela zero");
  assert.doesNotMatch(cliente.body, /price_enterprise/, "cliente não recebe a tabela de preço");
  assert.match(cliente.body, /Quero começar/, "o aceite só existe no link do cliente");
  assert.match(cliente.body, /Proposta comercial/, "a capa do deck");

  const depois = await repo.get("proposals", r.proposal.id);
  assert.equal(depois.views, 1, "abertura do cliente conta view (a do closer não)");
});

test("PATCH da tela zero vira produto e ciclo do resto do cockpit", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", { id: "ld_c2", saas: "leverads", name: "Ana", accounts: "1" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_slides" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const ok = await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: r.proposal.editKey, deckC: { ...cfgBase, linha: "oem", tier: "escala", contas: 9, periodo: "semestral" } },
  });
  assert.equal(ok.statusCode, 200);
  const p2 = await repo.get("proposals", r.proposal.id);
  assert.equal(p2.state.product, "oem_escala", "o produto escolhido no deck é o produto da venda");
  assert.equal(p2.state.cycle, "semiannual");
  assert.equal(p2.state.seats, 9);
  assert.equal(p2.state.deckC.linha, "oem");

  // Sem a chave, nada muda.
  const negado = await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: "chave-errada", deckC: { ...cfgBase, linha: "ads" } },
  });
  assert.equal(negado.statusCode, 401);
  const p3 = await repo.get("proposals", r.proposal.id);
  assert.equal(p3.state.product, "oem_escala", "estado intacto");
});

test("a página é um template literal só: sem crase solta no script do cliente", async () => {
  const repo = await seedRepo();
  const cat = await catalogoDoTemplate(repo);
  const html = proposalSlidesPageHtml(
    { id: "pr_x", name: "Proposta", state: {}, data: { lead: { name: "Ana" } }, accepted: false },
    { editable: true, catalog: (await repo.get("proposal_templates", "pt_leverads")).calc.catalog },
  );
  const script = html.slice(html.lastIndexOf("<script>"), html.lastIndexOf("</script>"));
  assert.equal(script.includes("`"), false, "crase dentro do script quebraria o template literal do módulo");
  assert.ok(cat.products.ads_essencial, "catálogo enxuto tem os produtos");
});
