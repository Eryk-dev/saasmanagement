// A tela de Propostas passou a girar em torno da apresentação OFICIAL (Leo,
// 28/09/2026): o cartão dela mostra as telas que o cliente vê e o editor deixa
// mexer no que muda sem deploy — a tabela de preço. O que este teste protege:
//
//  1. o esqueleto do deck sai do PRÓPRIO renderer (deckOutline), então slide
//     novo aparece no cockpit sem uma segunda lista pra alguém esquecer;
//  2. editar a tabela de preço no deck oficial grava também no pt_leverads
//     (onde o catálogo mora e de onde o boot copia) — sem isso o próximo
//     deploy devolveria o preço velho, calado;
//  3. o preview do editor renderiza o deck de slides, não a página do deck
//     antigo (que saía em branco, porque a apresentação em slides não tem
//     slides no documento).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureSlidesDeck } = await import("../src/migrations.js");
const { registerRoutes } = await import("../src/routes.js");
const { registerProposalRoutes } = await import("../src/routes.proposals.js");
const { deckOutline } = await import("../src/proposal-slides-page.js");

async function seedRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", {
    id: "pt_leverads", saas: "leverads", name: "Proposta · LeverAds", status: "published",
    theme: {}, calc: { seatsKey: "accounts", seatsMap: { "1": 2 } }, slides: [{ key: "hero", type: "hero", title: "Capa" }],
  });
  await ensureProposalCatalog(repo);
  await ensureSlidesDeck(repo);
  return repo;
}

test("o esqueleto do deck é lido do renderer, com a condição de cada tela", () => {
  const telas = deckOutline();
  const rotulos = telas.map((t) => t.label);
  assert.equal(rotulos[0], "Capa");
  assert.ok(rotulos.includes("08 Investimento"), "o slide de investimento tem que estar na lista");
  assert.ok(!rotulos.includes("Configurar"), "a tela zero é do closer, não é tela da apresentação");
  // As telas de produto e a de tangibilidade só entram conforme o plano.
  assert.equal(telas.find((t) => t.label === "02a OEM")?.cond, "oem");
  assert.equal(telas.find((t) => t.label === "09 Tangibilidade")?.cond, "pratica");
  assert.equal(telas.find((t) => t.label === "Capa")?.cond, undefined);
});

test("preço editado no deck oficial grava também no template onde o catálogo mora", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerRoutes(app, repo);
  const deck = await repo.get("proposal_templates", "pt_leverads_slides");
  const catalog = JSON.parse(JSON.stringify(deck.calc.catalog));
  catalog.products.ads_essencial.anu = { per: 597, total: 7164 };

  const res = await app.inject({
    method: "PATCH", url: "/api/proposal_templates/pt_leverads_slides",
    payload: { calc: { ...deck.calc, catalog } },
  });
  assert.equal(res.statusCode, 200);

  const depois = await repo.get("proposal_templates", "pt_leverads_slides");
  const fonte = await repo.get("proposal_templates", "pt_leverads");
  assert.equal(depois.calc.catalog.products.ads_essencial.anu.per, 597);
  assert.equal(fonte.calc.catalog.products.ads_essencial.anu.per, 597, "o pt_leverads é a fonte: sem o espelho o boot devolveria o preço velho");
  assert.equal(depois.layout, "slides", "o PATCH da tela não pode derrubar o layout da apresentação");
  // O espelho é uma CÓPIA: editar um depois não pode vazar pro outro.
  assert.notEqual(fonte.calc.catalog.products, depois.calc.catalog.products);
  // E o boot seguinte não tem mais nada pra sincronizar (os dois batem).
  assert.equal(await ensureSlidesDeck(repo), false);
  await app.close();
});

test("preview do editor renderiza o deck de slides, não a página do deck antigo", async () => {
  const repo = await seedRepo();
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const deck = await repo.get("proposal_templates", "pt_leverads_slides");
  const res = await app.inject({ method: "POST", url: "/api/proposals/preview", payload: { template: deck } });
  assert.equal(res.statusCode, 200);
  const html = res.json().html;
  assert.match(html, /data-screen-label="08 Investimento"/);
  assert.match(html, /data-cfg-screen/, "o deck de slides abre na tela zero do closer");
  await app.close();
});
