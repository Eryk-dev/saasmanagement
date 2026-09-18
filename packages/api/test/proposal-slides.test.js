// A apresentação em SLIDES (12/09/2026; oficial desde 18/09). O que este teste protege:
// a conta do plano sai do CATÁLOGO (nada de preço escrito no deck), o link do
// cliente não leva a tabela de preço no fonte, a tela zero só existe no modo
// closer e a configuração dela vira `state.product`/`state.cycle` — que é o que
// o resto do cockpit lê (valor do lead, gate de Ganho, link de pagamento).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureSlidesDeck } = await import("../src/migrations.js");
const { runNativeProposal, shareProposalOffer, proposalOffersOf } = await import("../src/proposal.js");
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

test("apresentação C e preview usam apenas autopeças publicadas, sem mudar o nicho do lead", async () => {
  const repo = await seedRepo();
  for (const [name, niche, authorizedAt] of [["Auto A", "Autopeças", "2026-09-01"], ["Casa B", "casa", "2026-09-01"], ["Auto pendente", "autopecas", ""]]) {
    await repo.create("cases", { saas: "leverads", name, niche, authorizedAt, public: true, metrics: [{ value: "R$ 100", label: "vendas", source: "painel" }] });
  }
  const lead = await repo.create("leads", { id: "ld_case_auto", saas: "leverads", name: "Cliente", niche: "casa" });
  const result = await runNativeProposal(repo, lead, { template: "pt_leverads_slides", baseUrl: "http://x" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.proposal.data.cases.map(c => c.name), ["Auto A"]);
  assert.equal((await repo.get("leads", lead.id)).niche, "casa");
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const response = await app.inject({ url: "/p/t/pt_leverads_slides?niche=casa" });
  assert.match(response.body, /"name":"Auto A"/);
  assert.doesNotMatch(response.body, /"name":"Casa B"|"name":"Auto pendente"/);
  await app.close();
});

test("cases sobrevivem à abertura pelo closer, atualização do lead e compartilhamento do mesmo link", async (t) => {
  const repo = await seedRepo();
  const caseDoc = await repo.create("cases", {
    name: "Auto Peças Teste", niche: "Autopeças", public: true, authorizedAt: "2026-09-01",
    metrics: [{ value: "R$ 100 mil", label: "vendas", source: "painel", proofUrl: "https://interno/prova" }],
  });
  const lead = await repo.create("leads", { id: "ld_case_sync", saas: "leverads", name: "Ana", niche: "autopecas", amount: 0 });
  const generated = await runNativeProposal(repo, lead, { template: "pt_leverads_slides" });
  assert.equal(generated.ok, true);
  const originalCases = structuredClone(generated.proposal.data.cases);
  assert.equal(originalCases.length, 1);
  assert.equal(originalCases[0].metrics[0].proofUrl, undefined);
  // Gerar o deck atualiza o valor do lead. A primeira abertura já sincroniza
  // data.lead.amount, que antes descartava os outros campos de data.
  assert.notEqual((await repo.get("leads", lead.id)).amount, generated.proposal.data.lead.amount);
  const app = Fastify();
  t.after(() => app.close());
  registerProposalRoutes(app, repo);
  const editUrl = `/p/${generated.proposal.id}?k=${generated.proposal.editKey}`;
  assert.equal((await app.inject({ url: editUrl })).statusCode, 200);
  let parent = await repo.get("proposals", generated.proposal.id);
  assert.deepEqual(parent.data.cases, originalCases, "abrir o deck mantém o snapshot dos cases");
  await repo.update("proposals", parent.id, { state: { ...parent.state, deckC: cfgBase } });
  parent = await repo.get("proposals", parent.id);
  const sent = await shareProposalOffer(repo, parent, 1);
  assert.equal(sent.ok, true);
  assert.deepEqual(sent.proposal.data.cases, originalCases);
  const sentOffer = structuredClone(sent.proposal.state.deckOferta);

  await repo.update("leads", lead.id, { company: "Auto Peças Nova" });
  await repo.update("cases", caseDoc.id, { name: "Nome alterado no cadastro central" });
  await app.inject({ url: editUrl });
  parent = await repo.get("proposals", parent.id);
  assert.equal(parent.data.lead.company, "Auto Peças Nova");
  assert.deepEqual(parent.data.cases, originalCases, "atualização do lead preserva a prova já selecionada");
  const reshared = await shareProposalOffer(repo, parent, 1);
  assert.equal(reshared.proposal.id, sent.proposal.id, "correção mantém o link enviado");
  assert.deepEqual(reshared.proposal.data.cases, originalCases);
  assert.deepEqual(reshared.proposal.state.deckOferta, sentOffer);
  const clientPage = await app.inject({ url: `/p/${sent.proposal.id}?from=cockpit` });
  assert.match(clientPage.body, /"name":"Auto Peças Teste"/);
  assert.doesNotMatch(clientPage.body, /Nome alterado no cadastro central|https:\/\/interno\/prova/);
});

test("migração: o deck de slides é o publicado do leverads, com o catálogo do pt_leverads; A e B arquivadas; idempotente", async () => {
  const repo = await seedRepo();
  const t = await repo.get("proposal_templates", "pt_leverads_slides");
  assert.equal(t.layout, "slides", "é o renderer novo");
  assert.equal(t.status, "published", "é o padrão do produto: gera sozinho no form e no 'gerar proposta'");
  assert.equal(t.selectable, false, "não aparece duplicado no select (o padrão já é ele)");
  assert.equal(t.officialSince, "2026-09-18");
  assert.equal(t.calc.catalog.products.ads_escala.anu.per, 999, "preço vem do catálogo, não do deck");
  const a = await repo.get("proposal_templates", "pt_leverads");
  assert.equal(a.status, "draft", "a apresentação A saiu do padrão");
  assert.match(a.name, /^\[ARQUIVO 2026-09-18\]/, "carimbada como arquivo, no padrão dos backups");
  assert.ok(a.calc.catalog, "o catálogo continua morando nela (as migrações escrevem lá)");
  assert.equal(await ensureSlidesDeck(repo), false, "segunda execução não mexe");

  // Despublicar de propósito depois não é desfeito pela migração.
  await repo.update("proposal_templates", "pt_leverads_slides", { status: "draft" });
  assert.equal(await ensureSlidesDeck(repo), false, "o carimbo officialSince segura a promoção");
  await repo.update("proposal_templates", "pt_leverads_slides", { status: "published" });

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

test("a tangibilidade traduz a parcela em vendas com o ticket informado; sem ticket/pedidos o slide sai", async () => {
  const repo = await seedRepo();
  const cat = await catalogoDoTemplate(repo);
  const o = calcOferta(cat, { ...cfgBase, tier: "escala", ticket: 200, pedidos: 400 });
  assert.equal(o.vendasNecessarias, 5, "999 / 200 arredondado pra cima");
  assert.equal(o.percentualExtra, "1,3%", "5 vendas sobre 400 pedidos");
  assert.equal(o.mostra.pratica, true);
  // O form não pergunta ticket nem pedidos: em branco, nada de conta falsa.
  const semTicket = calcOferta(cat, { ...cfgBase, ticket: 0, pedidos: 0 });
  assert.equal(semTicket.mensal, 497, "o preço do plano não depende disso");
  assert.equal(semTicket.vendasNecessarias, 0);
  assert.equal(semTicket.percentualExtra, "—");
  assert.equal(semTicket.mostra.pratica, false, "o slide 'Na prática' some da apresentação");
  const soTicket = calcOferta(cat, { ...cfgBase, ticket: 120, pedidos: 0 });
  assert.equal(soTicket.mostra.pratica, false, "sem pedidos/mês também some (o texto compara com o que já vende)");
});

test("a configuração nasce do formulário e do produto que a régua sugere; o que o form não pergunta fica em branco", async () => {
  const p = {
    state: { seats: 4 },
    calc: { seatsKey: "accounts" },
    data: {
      lead: { name: "Viviane Souza", firstName: "Viviane", company: "Zpack Autopeças" },
      answers: { accounts: "3-5", niche: "autopecas" },
    },
  };
  const c = deckConfig(p, { suggested: "oem_escala" });
  assert.equal(c.nome, "Viviane");
  assert.equal(c.empresa, "Zpack Autopeças");
  assert.equal(c.contas, 3, "faixa do form vale o piso (o closer sobe na call), não os assentos da fórmula");
  assert.equal(c.pedidos, 0, "o form não pergunta pedidos/mês: em branco pra call");
  assert.equal(c.ticket, 0, "o form não pergunta ticket médio: em branco pra call");
  assert.equal(c.vistaPct, 0, "desconto à vista é decisão da call, não default");
  assert.equal(c.linha, "oem");
  assert.equal(c.tier, "escala");
  assert.equal(c.periodo, "anual", "a apresentação abre no anual");
  assert.equal(deckConfig({ ...p, data: { ...p.data, answers: { accounts: "2" } } }).contas, 2, "resposta exata vale como está");
  assert.equal(deckConfig({ ...p, data: { ...p.data, answers: { accounts: "10+" } } }).contas, 10);
  assert.equal(deckConfig({ ...p, data: { ...p.data, answers: {} } }).contas, 0, "sem resposta, em branco (não 2)");
  // O que o closer salvou na tela zero vence o form.
  assert.equal(deckConfig({ ...p, state: { deckC: { contas: 7, pedidos: 900, ticket: 85, vistaPct: 10 } } }).contas, 7);
  assert.equal(deckConfig({ ...p, state: { deckC: { pedidos: 900, ticket: 85 } } }).ticket, 85);
  // Lixo não entra: enum inválido cai no padrão e número vira número.
  const sujo = deckConfig({ state: { deckC: { linha: "hack", tier: "ouro", contas: "-3", vistaPct: 999, periodo: "mensal" } } }, { suggested: "ads_essencial" });
  assert.equal(sujo.linha, "ads");
  assert.equal(sujo.tier, "essencial");
  assert.equal(sujo.contas, 0);
  assert.equal(sujo.vistaPct, 90, "desconto à vista tem teto");
  assert.equal(sujo.periodo, "anual");
});

test("sem template escolhido, o lead ganha a apresentação em slides (é o publicado)", async () => {
  // A e B já existem quando a migração roda em produção: a Starter entra antes.
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await repo.create("proposal_templates", { id: "pt_leverads_starter", saas: "leverads", name: "Starter", status: "draft", selectable: true, slides: [] });
  await ensureProposalCatalog(repo);
  await ensureSlidesDeck(repo);
  const lead = await repo.create("leads", { id: "ld_auto", saas: "leverads", name: "Bia Lima", accounts: "6-10", niche: "moda" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.template, "pt_leverads_slides");
  assert.equal(r.proposal.layout, "slides");
  const cfg = deckConfig(r.proposal);
  assert.equal(cfg.nome, "Bia");
  assert.equal(cfg.contas, 6, "contas do form");
  assert.equal(cfg.ticket, 0);
  // A e B não aparecem mais como opção (selectable) nem como padrão.
  const b = await repo.get("proposal_templates", "pt_leverads_starter");
  assert.equal(b.selectable, false);
  assert.match(b.name, /^\[ARQUIVO/);
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

test("o link do cliente do deck de slides existe e vai com o preço congelado", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", { id: "ld_share", saas: "leverads", name: "Ana", company: "Ana Peças", accounts: "6-10", niche: "autopecas" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_slides" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  // A tela zero monta o plano; é ela que define a única oferta que existe.
  await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: r.proposal.editKey, deckC: { ...cfgBase, linha: "oem", tier: "escala", contas: 7 } },
  });
  const mae = await repo.get("proposals", r.proposal.id);

  const ofertas = proposalOffersOf(mae);
  assert.equal(ofertas.length, 1, "deck de slides tem UMA oferta: o plano montado");
  assert.equal(ofertas[0].price, "999");

  const share = await shareProposalOffer(repo, mae, 1, { baseUrl: "http://x" });
  assert.equal(share.ok, true, "o link do cliente é gerado (sem slide de pricing no deck)");
  const filho = await repo.get("proposals", share.proposal.id);
  assert.equal(filho.layout, "slides");
  assert.equal(filho.editKey, "", "link do cliente nunca abre a tela zero");
  assert.equal(filho.state.deckOferta.mensalFmt, "999", "oferta congelada no snapshot");
  assert.equal(filho.state.deckOferta.mostra.pratica, true, "com ticket e pedidos, o slide 'Na prática' vai");
  assert.equal(filho.calc.catalog, undefined, "a tabela de preço não viaja no link do cliente");

  // Preço novo no catálogo não mexe no que o cliente já recebeu.
  const t = await repo.get("proposal_templates", "pt_leverads_slides");
  const cat = JSON.parse(JSON.stringify(t.calc.catalog));
  cat.products.oem_escala.anu.per = 1999;
  await repo.update("proposals", filho.id, { calc: { ...filho.calc, catalog: cat } });
  const html = await app.inject({ method: "GET", url: "/p/" + filho.id });
  assert.match(html.body, /999/, "o número enviado ao cliente é o congelado");
  assert.doesNotMatch(html.body, /1\.999/, "preço novo do catálogo não entra no link já mandado");

  // Sem plano montado não existe link pra mandar (melhor falhar que mandar R$ 0).
  const semPlano = await repo.create("proposals", { ...mae, id: "pr_vazio", state: { deckC: { ...cfgBase, plataforma: false } } });
  const nada = await shareProposalOffer(repo, semPlano, 1, { baseUrl: "http://x" });
  assert.equal(nada.ok, false);
  assert.match(nada.error, /monte o plano/);
});
