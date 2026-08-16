// Mentoria Lever: a régua de verba → oferta, o catálogo que abastece o gate de
// fechamento, a migração do template (apresentação) e a geração da proposta pro
// lead da fila.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const {
  mentoriaFit, mentoriaDealCatalog, mentoriaCalcBlock, mentoriaAmount,
  isMentoriaLead, MENTORIA_TEMPLATE_ID, MENTORIA_LABEL,
} = await import("../src/mentoria.js");
const { ensureMentoriaTemplate, migrateFormMentoriaOferta } = await import("../src/migrations.js");
const { runNativeProposal } = await import("../src/proposal.js");
const { registerProposalRoutes } = await import("../src/routes.proposals.js");

const leadDaFila = (verba) => ({
  id: "l1", saas: "leverads", name: "Ana Souza", phone: "11999999999",
  formExit: "mentoria", aprender_interesse: "sim", aprender_verba: verba,
  stage: "Mentoria",
});

test("verba declarada decide a oferta: até 1k abre no Curso, o resto no Assistido", () => {
  assert.equal(mentoriaFit(leadDaFila("ate-1k")).product, "men_curso");
  assert.equal(mentoriaFit(leadDaFila("1k-5k")).product, "men_assistido");
  assert.equal(mentoriaFit(leadDaFila("5k-20k")).product, "men_assistido");
  assert.equal(mentoriaFit(leadDaFila("20k+")).product, "men_assistido");
  // Preço e nome saem do catálogo do módulo (o web lê do SEED).
  assert.equal(mentoriaFit(leadDaFila("ate-1k")).price, 1000);
  assert.equal(mentoriaFit(leadDaFila("1k-5k")).price, 3000);
});

test("verba grande marca candidato ao upsell de importação; verba curta não", () => {
  assert.equal(mentoriaFit(leadDaFila("ate-1k")).upsell, false);
  assert.equal(mentoriaFit(leadDaFila("1k-5k")).upsell, false);
  assert.equal(mentoriaFit(leadDaFila("5k-20k")).upsell, true);
  assert.equal(mentoriaFit(leadDaFila("20k+")).upsell, true);
});

test("sem verba declarada cai no padrão com instrução de perguntar antes do preço", () => {
  const fit = mentoriaFit(leadDaFila(""));
  assert.equal(fit.product, "men_assistido");
  assert.match(fit.note, /pergunta antes de falar preço/i);
});

test("lead que já vende (sem saída lateral) não é da fila da mentoria", () => {
  const lead = { id: "l2", saas: "leverads", stage: "Novo lead", accounts: "3-5" };
  assert.equal(isMentoriaLead(lead), false);
  assert.equal(mentoriaFit(lead), null);
});

test("catálogo do fechamento sai do template e vem como compra única agrupada", () => {
  const calc = { mentoria: mentoriaCalcBlock() };
  const rows = mentoriaDealCatalog(calc);
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.equal(r.group, "Mentoria");
    assert.equal(r.oneOff, true);
    assert.equal(r.prices[0].plan, "unico");
    assert.equal(r.label, MENTORIA_LABEL[r.id]);
  }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.prices[0].value]));
  assert.equal(byId.men_curso, 1000);
  assert.equal(byId.men_assistido, 3000);
  assert.equal(byId.men_assistido_imp, 5000);
  assert.equal(byId.men_upsell_imp, 2000);
  assert.equal(byId.men_escalar_full, 6000);
});

test("preço mexido no banco vale na hora (o módulo não sobrescreve o template)", () => {
  const calc = { mentoria: mentoriaCalcBlock() };
  calc.mentoria.products.men_assistido.price = 3500;
  delete calc.mentoria.products.men_escalar_full; // produto tirado do catálogo
  const rows = mentoriaDealCatalog(calc);
  assert.equal(rows.find((r) => r.id === "men_assistido").prices[0].value, 3500);
  assert.equal(rows.find((r) => r.id === "men_escalar_full"), undefined);
});

test("outro deck selecionável (sem bloco de mentoria) não arrasta os produtos", () => {
  assert.deepEqual(mentoriaDealCatalog({ seatsMap: {} }), []);
  assert.deepEqual(mentoriaDealCatalog(null), []);
});

test("migração cria a apresentação como rascunho selecionável e é idempotente", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureMentoriaTemplate(repo), true);
  const t = await repo.get("proposal_templates", MENTORIA_TEMPLATE_ID);
  assert.equal(t.saas, "leverads");
  // Rascunho de propósito: o deck padrão do leverads continua sendo o pt_leverads.
  assert.equal(t.status, "draft");
  assert.equal(t.selectable, true);
  assert.ok(t.pickLabel);
  assert.ok(t.calc.mentoria.products.men_assistido.price);
  assert.equal(t.slides.at(-1).type, "pricing");
  // Oferta principal = Assistido; o Curso é o degrau secreto (Shift+1).
  assert.equal(t.slides.at(-1).price, "3.000");
  assert.equal(t.slides.at(-1).offer2.price, "1.000");
  assert.equal(await ensureMentoriaTemplate(repo), false);
});

test("migração repara template antigo sem bloco de preço, sem tocar nos slides", async () => {
  const repo = makeMemRepo();
  await repo.create("proposal_templates", {
    id: MENTORIA_TEMPLATE_ID, saas: "leverads", status: "draft",
    slides: [{ key: "editado", type: "hero", title: "deck do dono" }], calc: {},
  });
  assert.equal(await ensureMentoriaTemplate(repo), true);
  const t = await repo.get("proposal_templates", MENTORIA_TEMPLATE_ID);
  assert.equal(t.slides[0].title, "deck do dono"); // edição do dono é soberana
  assert.equal(t.selectable, true);
  assert.ok(t.calc.mentoria.products.men_curso.price);
});

test("saída lateral do form passa a anunciar a oferta, uma vez só", async () => {
  const repo = makeMemRepo();
  await repo.create("forms", {
    id: "fo_diagnostico_leverads", saas: "leverads",
    exits: { mentoria: { label: "Ainda não vende em marketplace", stage: "Mentoria", title: "velho", subtitle: "te chamamos quando abrir" } },
  });
  assert.equal(await migrateFormMentoriaOferta(repo), true);
  const f = await repo.get("forms", "fo_diagnostico_leverads");
  assert.match(f.exits.mentoria.subtitle, /Mentoria Lever/);
  assert.equal(f.exits.mentoria.stage, "Mentoria"); // coluna preservada
  assert.equal(await migrateFormMentoriaOferta(repo), false);
});

test("proposta da mentoria: deck próprio e valor do card pela verba", async () => {
  const repo = makeMemRepo();
  await ensureMentoriaTemplate(repo);
  // O deck padrão do produto continua existindo e NÃO é o escolhido.
  await repo.create("proposal_templates", {
    id: "pt_leverads", saas: "leverads", status: "published", name: "Proposta · LeverAds",
    slides: [{ key: "hero", type: "hero", title: "LeverAds" }], calc: {},
  });
  const lead = await repo.create("leads", leadDaFila("ate-1k"));
  const r = await runNativeProposal(repo, lead, { template: MENTORIA_TEMPLATE_ID, baseUrl: "https://x" });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.template, MENTORIA_TEMPLATE_ID);
  assert.equal(r.proposal.slides[0].key, "hero");
  assert.match(r.proposal.slides[0].title, /primeira venda/i);
  // Verba de até 1k: o card passa a valer o Curso, não o Assistido do deck.
  assert.equal(r.lead.amount, 1000);
  assert.equal(mentoriaAmount(leadDaFila("20k+"), r.proposal.calc), 3000);
});

test("preview do deck abre e mostra a oferta principal com o degrau secreto", async () => {
  const repo = makeMemRepo();
  await ensureMentoriaTemplate(repo);
  const app = Fastify();
  registerProposalRoutes(app, repo);
  const r = await app.inject({ method: "GET", url: "/p/t/" + MENTORIA_TEMPLATE_ID });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /primeiras 10 vendas/i);
  assert.match(r.body, /MENTORIA ASSISTIDA/);
  assert.match(r.body, /SÓ O CURSO/); // degrau secreto vai no DOM, escondido
  assert.match(r.body, /Mentoria Lever/);
});

test("lead de venda não recebe valor de mentoria nem por engano", async () => {
  const calc = { mentoria: mentoriaCalcBlock() };
  assert.equal(mentoriaAmount({ id: "l9", saas: "leverads" }, calc), 0);
  assert.equal(mentoriaAmount(leadDaFila("1k-5k"), { plans: {} }), 0);
});
