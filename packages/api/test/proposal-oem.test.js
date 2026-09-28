// Apresentação de CRIAÇÃO DE ANÚNCIOS por código OEM (28/09/2026). O que este
// teste protege: o deck entra como escolha no card do lead SEM catálogo de
// plano, a conta é quantidade × valor por anúncio (e não inventa número quando
// está em branco), a tela zero só existe no modo closer, o link do cliente sai
// com o total congelado e os prints do anúncio padrão são servidos pela própria
// API — com nome na lista branca, nunca caminho montado com o que veio na URL.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureOemDeck } = await import("../src/migrations.js");
const { runNativeProposal, shareProposalOffer, proposalOffersOf } = await import("../src/proposal.js");
const { registerProposalRoutes } = await import("../src/routes.proposals.js");
const { calcOem, deckOemConfig, proposalOemPageHtml } = await import("../src/proposal-oem-page.js");

const TEMPLATE = {
  id: "pt_leverads",
  saas: "leverads",
  name: "Proposta · LeverAds",
  status: "published",
  theme: { accent: "#23D8D3" },
  acceptStage: "Follow-up",
  calc: { seatsKey: "accounts", seatsMap: { "1": 2, "3-5": 4 }, plans: {}, defaultCycle: "annual" },
  slides: [{ key: "hero", type: "hero", bg: "", title: "Capa" }],
};

async function seedRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  await ensureOemDeck(repo);
  return repo;
}

test("migração: o deck de criação de anúncios nasce selecionável e SEM catálogo; idempotente", async () => {
  const repo = await seedRepo();
  const t = await repo.get("proposal_templates", "pt_leverads_oem");
  assert.equal(t.layout, "oem", "é o renderer novo");
  assert.equal(t.selectable, true, "aparece no select do card do lead");
  assert.equal(t.status, "draft", "não vira o padrão do produto");
  assert.equal(t.acceptStage, "Follow-up", "herda o estágio de aceite do deck padrão");
  assert.equal(t.calc.catalog, undefined, "sem catálogo: este deck não vende plano, vende lote de anúncio");
  assert.equal(await ensureOemDeck(repo), false, "segunda execução não mexe");
});

test("a conta é quantidade × valor por anúncio, com centavos só quando existem", async () => {
  const cheio = calcOem({ qtd: 120, valor: 25 });
  assert.equal(cheio.total, 3000);
  assert.equal(cheio.qtdFmt, "120");
  assert.equal(cheio.valorFmt, "25");
  assert.equal(cheio.totalFmt, "3.000");
  assert.equal(cheio.configurado, true);

  const comCentavos = calcOem({ qtd: 10, valor: 24.9 });
  assert.equal(comCentavos.valorFmt, "24,90", "centavo do preço não some");
  assert.equal(comCentavos.totalFmt, "249");
});

test("em branco, a apresentação mostra colchete em vez de número inventado", async () => {
  const vazio = calcOem({});
  assert.equal(vazio.total, 0);
  assert.equal(vazio.configurado, false);
  assert.equal(vazio.qtdFmt, "[quantidade]");
  assert.equal(vazio.valorFmt, "[valor]");
  assert.equal(vazio.totalFmt, "[total]");

  // Só a quantidade preenchida ainda não é uma oferta.
  assert.equal(calcOem({ qtd: 100 }).configurado, false);
});

test("a configuração nasce do lead e sanea o que vem da tela zero", async () => {
  const c = deckOemConfig({ data: { lead: { name: "Viviane Souza", firstName: "Viviane", company: "Zpack Autopeças" } } });
  assert.equal(c.nome, "Viviane");
  assert.equal(c.empresa, "Zpack Autopeças");
  assert.equal(c.qtd, 0, "quantidade nasce vazia: é combinada na call");
  assert.equal(c.valor, 0, "valor nasce vazio: nenhum preço de catálogo aqui");

  const sujo = deckOemConfig({ state: { deckOem: { qtd: "-40", valor: "abc" } } });
  assert.equal(sujo.qtd, 0);
  assert.equal(sujo.valor, 0);
  const grande = deckOemConfig({ state: { deckOem: { qtd: 99_000_000, valor: 12.345 } } });
  assert.equal(grande.qtd, 1_000_000, "quantidade tem teto");
  assert.equal(grande.valor, 12.35, "valor guarda no máximo os centavos");
});

test("rota: o closer recebe a tela zero; o cliente recebe a apresentação e o aceite", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", {
    id: "ld_oem", saas: "leverads", name: "Cleber Souza", company: "O2 Autopeças", niche: "autopecas",
  });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_oem" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.layout, "oem", "o layout viaja no snapshot");

  const app = Fastify();
  registerProposalRoutes(app, repo);

  const closer = await app.inject({ method: "GET", url: "/p/" + r.proposal.id + "?k=" + r.proposal.editKey });
  assert.equal(closer.statusCode, 200);
  assert.match(closer.body, /Configurar apresentação/, "tela zero no modo closer");
  assert.match(closer.body, /Quantos anúncios e por quanto/);
  assert.match(closer.body, /Título de 200 caracteres/, "a entrega padrão está escrita no deck");
  assert.match(closer.body, /public\/deck\/oem\/anuncio\.jpg/, "o print do anúncio padrão vem da própria API");

  const cliente = await app.inject({ method: "GET", url: "/p/" + r.proposal.id });
  assert.equal(cliente.statusCode, 200);
  assert.doesNotMatch(cliente.body, /Configurar apresentação/, "cliente não vê a tela zero");
  assert.match(cliente.body, /Quero começar/, "o aceite só existe no link do cliente");
  assert.match(cliente.body, /\[quantidade\]/, "sem configurar, o deck mostra colchete");

  const depois = await repo.get("proposals", r.proposal.id);
  assert.equal(depois.views, 1, "abertura do cliente conta view (a do closer não)");

  // Embutido no card do lead (?embed=config): só a tela zero, com o atalho de
  // apresentar. Sem isso o iframe do cockpit abriria a capa do deck.
  const embed = await app.inject({ method: "GET", url: "/p/" + r.proposal.id + "?k=" + r.proposal.editKey + "&embed=config" });
  assert.equal(embed.statusCode, 200);
  assert.match(embed.body, /Quantidade de anúncios/, "os dois números continuam lá");
  assert.match(embed.body, /<a class="cfg-present"/, "o atalho Apresentar ↗ entra no modo embutido");
  assert.match(embed.body, /"configOnly":true/, "a página sabe que está embutida");
  assert.doesNotMatch(closer.body, /<a class="cfg-present"/, "fora do embed o atalho não aparece");

  // Prévia rápida da tela de Propostas: os campos do formulário chegam pela
  // query e a prévia abre com a tela zero já preenchida.
  const cheia = await app.inject({ method: "GET", url: "/p/t/pt_leverads_oem?nome=Cleber&empresa=O2%20Autope%C3%A7as&qtd=200&valor=25" });
  assert.equal(cheia.statusCode, 200);
  assert.match(cheia.body, /"totalFmt":"5\.000"/, "200 × 25 já sai somado na prévia");
  assert.match(cheia.body, /"empresa":"O2 Autope/, "a empresa do formulário entra na capa");
  // Lixo na query cai no padrão em vez de quebrar a página.
  const suja = await app.inject({ method: "GET", url: "/p/t/pt_leverads_oem?qtd=abc&valor=-9" });
  assert.equal(suja.statusCode, 200);
  assert.match(suja.body, /\[total\]/, "sem número válido, o deck volta pro colchete");

  // Pré-visualização do template (tela de Propostas) abre o mesmo deck.
  const preview = await app.inject({ method: "GET", url: "/p/t/pt_leverads_oem" });
  assert.equal(preview.statusCode, 200);
  assert.match(preview.body, /Pré-visualização do template/, "a fita avisa que nada é salvo");
  assert.match(preview.body, /Quantos anúncios e por quanto/, "o preview abre na tela zero");
});

test("PATCH da tela zero grava o lote e vira o valor do card do lead", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", { id: "ld_oem2", saas: "leverads", name: "Ana", company: "Ana Peças" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_oem" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const ok = await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: r.proposal.editKey, deckOem: { nome: "Ana", empresa: "Ana Peças", qtd: 200, valor: 18.5 } },
  });
  assert.equal(ok.statusCode, 200);
  const p2 = await repo.get("proposals", r.proposal.id);
  assert.equal(p2.state.deckOem.qtd, 200);
  assert.equal(p2.state.deckOem.valor, 18.5);
  assert.equal(p2.state.product, undefined, "deck de serviço avulso não escolhe produto de plano");
  const lead2 = await repo.get("leads", lead.id);
  assert.equal(lead2.amount, 3700, "o valor do card é o lote inteiro: 200 × 18,50");

  const negado = await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: "chave-errada", deckOem: { qtd: 1 } },
  });
  assert.equal(negado.statusCode, 401);
  assert.equal((await repo.get("proposals", r.proposal.id)).state.deckOem.qtd, 200, "estado intacto");
});

test("o link do cliente exige o lote montado e vai com o total congelado", async () => {
  const repo = await seedRepo();
  const lead = await repo.create("leads", { id: "ld_oem3", saas: "leverads", name: "Ana", company: "Ana Peças" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_oem" });
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const semLote = await repo.get("proposals", r.proposal.id);
  assert.deepEqual(proposalOffersOf(semLote), [], "sem quantidade e preço não há oferta pra mandar");
  const recusa = await shareProposalOffer(repo, semLote, 1, { baseUrl: "http://x" });
  assert.equal(recusa.ok, false, "não manda apresentação sem preço");

  await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: r.proposal.editKey, deckOem: { qtd: 500, valor: 12 } },
  });
  const mae = await repo.get("proposals", r.proposal.id);
  const ofertas = proposalOffersOf(mae);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0].price, "6.000");
  assert.equal(ofertas[0].label, "Pagamento único");

  const share = await shareProposalOffer(repo, mae, 1, { baseUrl: "http://x" });
  assert.equal(share.ok, true);
  const filho = await repo.get("proposals", share.proposal.id);
  assert.equal(filho.layout, "oem");
  assert.equal(filho.editKey, "", "link do cliente nunca abre a edição");
  assert.equal(filho.state.deckOemOferta.total, 6000, "a oferta vai congelada no snapshot");

  // Reconfigurar depois do envio não pode mudar o número que o cliente já viu.
  await app.inject({
    method: "PATCH", url: "/public/proposals/" + r.proposal.id,
    payload: { k: r.proposal.editKey, deckOem: { qtd: 500, valor: 30 } },
  });
  const pagina = await app.inject({ method: "GET", url: "/p/" + share.proposal.id });
  assert.match(pagina.body, /"totalFmt":"6\.000"/, "o link enviado continua com o total congelado");
});

test("prints: nome na lista branca, arquivo servido da pasta de assets", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);

  // Caminho montado com o que veio na URL nunca é lido.
  for (const url of ["/public/deck/oem/..%2f..%2fdb.js", "/public/deck/oem/anuncio.js", "/public/deck/oem/.env"]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 404, url);
  }
  // Print que ainda não subiu é 404, não erro de servidor (a página trata).
  assert.equal((await app.inject({ method: "GET", url: "/public/deck/oem/nao-existe.jpg" })).statusCode, 404);

  const dir = fileURLToPath(new URL("../src/assets/deck-oem/", import.meta.url));
  const arquivo = dir + "teste-print.png";
  await mkdir(dir, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await writeFile(arquivo, png);
  try {
    const r = await app.inject({ method: "GET", url: "/public/deck/oem/teste-print.png" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.rawPayload.length, png.length, "o arquivo sai inteiro");
  } finally {
    await unlink(arquivo);
  }
});

test("preview do editor mostra os dados do formulário, não o cliente de exemplo", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const t = await repo.get("proposal_templates", "pt_leverads_oem");
  const r = await app.inject({
    method: "POST", url: "/api/proposals/preview",
    payload: { template: t, state: { deckOem: { nome: "Cleber", qtd: 50, valor: 30 } } },
  });
  assert.equal(r.statusCode, 200);
  assert.match(r.json().html, /"totalFmt":"1\.500"/, "o state do formulário mescla com os padrões da prévia");
  assert.match(r.json().html, /Configurar apresentação/, "o deck de OEM abre no modo closer, com a tela zero");
});

test("link avulso: apresentação pro cliente sem lead, com a oferta congelada", async () => {
  // O closer preenche os dados na tela de Propostas e manda o link. Não existe
  // card no pipeline: é uma proposta sem lead.
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);

  const semLote = await app.inject({ method: "POST", url: "/api/proposal_templates/pt_leverads_oem/link", payload: { config: { nome: "Cleber" } } });
  assert.equal(semLote.statusCode, 422, "sem quantidade e valor não sai link");

  const r = await app.inject({
    method: "POST", url: "/api/proposal_templates/pt_leverads_oem/link",
    payload: { config: { nome: "Cleber Souza", empresa: "O2 Autopeças", qtd: 200, valor: 25 } },
  });
  assert.equal(r.statusCode, 200);
  const p = await repo.get("proposals", r.json().id);
  assert.equal(p.lead, "", "não nasce amarrada a nenhum lead");
  assert.equal(p.editKey, "", "o link nunca abre a tela de edição");
  assert.equal(p.showAll, true);
  assert.equal(p.acceptStage, "", "sem lead não existe etapa pra mover no aceite");
  assert.equal(p.state.deckOemOferta.total, 5000, "a oferta vai congelada no snapshot");
  assert.equal(p.data.lead.company, "O2 Autopeças");

  const pagina = await app.inject({ method: "GET", url: "/p/" + p.id });
  assert.equal(pagina.statusCode, 200);
  assert.doesNotMatch(pagina.body, /Configurar apresentação/, "o cliente não vê a tela zero");
  assert.doesNotMatch(pagina.body, /Pré-visualização do template/, "não é prévia");
  assert.match(pagina.body, /"totalFmt":"5\.000"/);
  assert.match(pagina.body, /Quero começar/, "o aceite existe no link do cliente");

  // Aceitar sem lead não pode quebrar (não há etapa nem card pra mover).
  const aceite = await app.inject({ method: "POST", url: "/public/proposals/" + p.id + "/accept" });
  assert.equal(aceite.statusCode, 200);
  assert.equal((await repo.get("proposals", p.id)).accepted, true);

  // Deck campo a campo não tem tela zero: o link dele sai pelo card do lead.
  const campoACampo = await app.inject({ method: "POST", url: "/api/proposal_templates/pt_leverads/link", payload: { config: {} } });
  assert.equal(campoACampo.statusCode, 422);
});

test("a página é um template literal só: sem crase solta no script do cliente", async () => {
  const html = proposalOemPageHtml(
    { id: "pr_x", name: "Proposta", state: {}, data: { lead: { name: "Ana" } }, accepted: false },
    { editable: true },
  );
  const script = html.slice(html.lastIndexOf("<script>"), html.lastIndexOf("</script>"));
  assert.equal(script.includes("`"), false, "crase dentro do script quebraria o template literal do módulo");
});
