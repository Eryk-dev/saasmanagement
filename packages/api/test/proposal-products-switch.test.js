// Produtos da proposta marcados no card de Atividades (Leo, 11/11/2026). O que
// este teste protege: marcar o lote de criação de anúncios leva o lead pro deck
// OEM; marcar LeverAds / Lever Price / pacote de OEM leva de volta pro deck de
// slides com a marcação já na tela zero; a troca REAPROVEITA a proposta que o
// lead já tinha daquele modelo (mesmo id, números preservados) em vez de criar
// outra; e deck fixado à mão não é trocado por aqui.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureProposalCatalog, ensureSlidesDeck, ensureOemDeck } = await import("../src/platform/migrations.js");
const { runNativeProposal } = await import("../src/proposals/proposal.js");
const { registerLeadProposalRoutes } = await import("../src/proposals/routes.lead-proposals.js");

const TEMPLATE = {
  id: "pt_leverads", saas: "leverads", name: "Proposta · LeverAds", status: "published",
  theme: {}, calc: { seatsKey: "accounts", seatsMap: { "1": 2, "3-5": 4 }, plans: {}, defaultCycle: "annual" },
  slides: [{ key: "hero", type: "hero", bg: "", title: "Capa" }],
};

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }] });
  await repo.create("proposal_templates", JSON.parse(JSON.stringify(TEMPLATE)));
  await ensureProposalCatalog(repo);
  await ensureSlidesDeck(repo);
  await ensureOemDeck(repo);
  const lead = await repo.create("leads", { id: "ld_prod", saas: "leverads", name: "Leo", company: "Oferta Nacional", formProduct: "oem" });
  const r = await runNativeProposal(repo, lead, { baseUrl: "http://x", template: "pt_leverads_slides" });
  assert.equal(r.ok, true);
  const app = Fastify();
  registerLeadProposalRoutes(app, repo);
  return { repo, app, slides: r.proposal };
}

const put = (app, id, body) => app.inject({ method: "PUT", url: `/api/leads/${id}/proposal-products`, payload: body });
const cfgOf = (app, id) => app.inject({ method: "GET", url: `/api/leads/${id}/proposal-config` }).then((r) => r.json());

test("lote marcado leva o lead pro deck OEM; desmarcar volta pro MESMO deck de slides, com a marcação aplicada", async () => {
  const { repo, app, slides } = await setup();
  // O closer já tinha preenchido a tela zero do deck de slides.
  await app.inject({ method: "PUT", url: "/api/leads/ld_prod/proposal-config", payload: { deckC: { pedidos: 300, ticket: 450, plataforma: true, price: false, oem: false } } });

  let r = await put(app, "ld_prod", { lote: true });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().layout, "oem");
  let lead = await repo.get("leads", "ld_prod");
  assert.notEqual(lead.proposta_id, slides.id, "o lead passou a apontar pra outra proposta");
  const oemId = lead.proposta_id;
  assert.equal((await repo.get("proposals", oemId)).template, "pt_leverads_oem");
  assert.equal(r.json().lead.proposal_edit_url, lead.proposal_edit_url, "a resposta devolve o link novo pro card");
  assert.equal((await cfgOf(app, "ld_prod")).layout, "oem", "o card lê o layout novo");

  // Marcar Lever Price no deck OEM: volta pro deck de slides que já existia.
  r = await put(app, "ld_prod", { plataforma: false, price: true, oem: false });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().layout, "slides");
  lead = await repo.get("leads", "ld_prod");
  assert.equal(lead.proposta_id, slides.id, "reaproveita a proposta de slides em vez de criar outra");
  assert.equal(r.json().cfg.price, true);
  assert.equal(r.json().cfg.plataforma, false);
  assert.equal(r.json().cfg.pedidos, 300, "os números que o closer já tinha preenchido ficam");
  assert.equal(r.json().cfg.ticket, 450);
  assert.equal((await repo.list("proposals")).length, 2, "duas propostas, uma por modelo, e nada além");

  // De volta ao lote: o deck OEM anterior é o mesmo.
  r = await put(app, "ld_prod", { lote: true });
  assert.equal((await repo.get("leads", "ld_prod")).proposta_id, oemId);
  assert.equal((await repo.list("proposals")).length, 2);
});

test("sem booleano no corpo, a marcação do deck de slides fica como estava", async () => {
  const { app } = await setup();
  await app.inject({ method: "PUT", url: "/api/leads/ld_prod/proposal-config", payload: { deckC: { plataforma: true, price: true, oem: false } } });
  await put(app, "ld_prod", { lote: true });
  const r = await put(app, "ld_prod", { lote: false });
  assert.equal(r.json().layout, "slides");
  assert.equal(r.json().cfg.plataforma, true);
  assert.equal(r.json().cfg.price, true);
});

test("deck fixado à mão no lead não é trocado pelo card", async () => {
  const { repo, app, slides } = await setup();
  await repo.update("leads", "ld_prod", { proposalPinned: true });
  const r = await put(app, "ld_prod", { lote: true });
  assert.equal(r.statusCode, 409);
  assert.equal((await repo.get("leads", "ld_prod")).proposta_id, slides.id);
});

test("lead sem proposta nenhuma ganha o deck do produto marcado", async () => {
  const { repo, app } = await setup();
  await repo.update("leads", "ld_prod", { proposta_id: "", proposalUrl: "", proposal_edit_url: "" });
  // Sem proposta anterior do modelo: cria.
  const lead2 = await repo.create("leads", { id: "ld_novo", saas: "leverads", name: "Nova", formProduct: "oem" });
  const r = await put(app, lead2.id, { plataforma: true, price: false, oem: true });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().layout, "slides");
  assert.equal(r.json().cfg.oem, true);
  assert.ok((await repo.get("leads", "ld_novo")).proposal_edit_url);
});
