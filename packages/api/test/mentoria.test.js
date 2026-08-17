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

test("sem escolher deck, o lead da fila já recebe a apresentação da mentoria", async () => {
  const repo = makeMemRepo();
  await ensureMentoriaTemplate(repo);
  await repo.create("proposal_templates", {
    id: "pt_leverads", saas: "leverads", status: "published", name: "Proposta · LeverAds",
    slides: [{ key: "hero", type: "hero", title: "LeverAds" }], calc: {},
  });
  // O SDR não tem a tela de Propostas, então nunca manda `template`: o deck
  // precisa seguir o lead sozinho.
  const daFila = await repo.create("leads", leadDaFila("1k-5k"));
  const r1 = await runNativeProposal(repo, daFila, { baseUrl: "https://x" });
  assert.equal(r1.proposal.template, MENTORIA_TEMPLATE_ID);
  assert.equal(r1.lead.amount, 3000);
  // Lead de venda segue no deck publicado do produto.
  const deVenda = await repo.create("leads", { id: "l2", saas: "leverads", name: "Loja", stage: "Novo lead" });
  const r2 = await runNativeProposal(repo, deVenda, { baseUrl: "https://x" });
  assert.equal(r2.proposal.template, "pt_leverads");
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

// ── Contabilizar a mentoria (Leo, 16/08) ───────────────────────────────────
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Desqualificado", kind: "desqualificado", conv: 0 },
  { stage: "Mentoria", kind: "outro", conv: 1 },
];
const NOW = new Date("2026-08-16T15:00:00.000Z");
const MONTH = "?since=2026-08-01&until=2026-08-31";

async function buildBoard() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "sdr", name: "Manuela", saas: "leverads", roles: ["sdr"] });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  // Fila: dois cards abertos (verbas diferentes) e um fechado no mês.
  await repo.create("leads", { id: "m1", saas: "leverads", owner: "sdr", stage: "Mentoria", formExit: "mentoria", aprender_verba: "ate-1k", createdAt: "2026-08-02T12:00:00.000Z" });
  await repo.create("leads", { id: "m2", saas: "leverads", owner: "sdr", stage: "Mentoria", formExit: "mentoria", aprender_verba: "20k+", createdAt: "2026-08-03T12:00:00.000Z" });
  await repo.create("leads", { id: "m3", saas: "leverads", owner: "sdr", stage: "Ganho", formExit: "mentoria", aprender_verba: "1k-5k", amount: 3000, customerId: "cm1", wonAt: "2026-08-10T12:00:00.000Z", createdAt: "2026-08-01T12:00:00.000Z" });
  await repo.create("customers", { id: "cm1", saas: "leverads", name: "Aluno", leadId: "m3", startedAt: "2026-08-10T12:00:00.000Z" });
  // Venda de plataforma no mesmo mês: a régua do LeverAds não pode mudar.
  await repo.create("leads", { id: "v1", saas: "leverads", owner: "sdr", closer: "leo", stage: "Ganho", amount: 7188, customerId: "cv1", wonAt: "2026-08-05T12:00:00.000Z", createdAt: "2026-08-01T12:00:00.000Z" });
  await repo.create("customers", { id: "cv1", saas: "leverads", name: "Loja", leadId: "v1", startedAt: "2026-08-05T12:00:00.000Z" });
  const { registerRoutes } = await import("../src/routes.js");
  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => NOW }, scoreboard: { now: () => NOW } });
  return { app, repo };
}

test("placar: a mentoria vira bloco próprio, com fila, potencial e venda", async () => {
  const { app } = await buildBoard();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  assert.equal(sb.mentoria.queue, 2);                       // o fechado sai da fila
  assert.equal(sb.mentoria.queueByVerba["ate-1k"], 1);
  assert.equal(sb.mentoria.queueByVerba["20k+"], 1);
  assert.equal(sb.mentoria.queuePotential, 4000);           // Curso 1.000 + Assistido 3.000
  assert.equal(sb.mentoria.won, 1);
  assert.equal(sb.mentoria.revenue, 3000);
  assert.equal(sb.mentoria.unowned, 0);
  assert.deepEqual(sb.mentoria.byUser.find((b) => b.user === "sdr"), { user: "sdr", queue: 2, contacted: 0, won: 1, revenue: 3000 });
});

test("a mentoria entra como CONTRATO e RECEITA (pessoa, time e dinheiro das telas)", async () => {
  const { app } = await buildBoard();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const manu = sb.sdr.find((p) => p.user === "sdr");
  // As duas pernas do plano dela somam plataforma + mentoria (Leo, 16/08).
  assert.equal(manu.won, 2);
  assert.equal(manu.revenue, 10188); // 7.188 da plataforma + 3.000 da mentoria
  // E seguem detalhadas no campo próprio, pra saber de onde veio.
  assert.equal(manu.mentoriaWon, 1);
  assert.equal(manu.mentoriaRevenue, 3000);
  assert.equal(manu.mentoriaQueue, 2);
  // Time e as telas de dinheiro contam o mesmo.
  assert.equal(sb.team.won, 2);
  assert.equal(sb.team.revenue, 10188);
  const mk = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();
  assert.equal(mk.totals.won, 2);
  assert.equal(mk.totals.revenue, 10188); // o anúncio que trouxe a pessoa leva o crédito
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(pace.context.wonMonth, 2);
  assert.equal(pace.context.tcvMonth, 10188);
});

test("mas o FUNIL e as TAXAS seguem só da plataforma (o CPL não dilui)", async () => {
  const { app } = await buildBoard();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const manu = sb.sdr.find((p) => p.user === "sdr");
  // Lead da fila não conta como lead do produto: é o que protege o CPL e
  // impede o pixel de aprender a caçar quem não pode comprar a plataforma.
  assert.equal(sb.team.leadsNew, 1);
  assert.equal(manu.leadsNew, 1);
  const mk = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();
  assert.equal(mk.totals.leads, 1);
  // Conversão do closer divide pelas calls da plataforma, então usa o ganho da
  // plataforma: com a mentoria dentro, uma venda sem call passaria de 100%.
  const leo = sb.closer.find((c) => c.user === "leo");
  assert.equal(leo.won, 1);          // ele fechou só a da plataforma
  assert.equal(leo.revenue, 7188);
  assert.equal(sb.team.leadToWin, 100); // 1 ganho de plataforma ÷ 1 lead novo
});

test("migração dá dono pra fila da Mentoria, uma vez e sem tocar em card terminal", async () => {
  const { assignMentoriaOwner } = await import("../src/migrations.js");
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "sdr", name: "Manuela", saas: "leverads", roles: ["sdr"] });
  await repo.create("leads", { id: "m1", saas: "leverads", stage: "Mentoria", formExit: "mentoria", aprender_verba: "ate-1k" });
  await repo.create("leads", { id: "m2", saas: "leverads", stage: "Desqualificado", formExit: "mentoria" });
  await repo.create("leads", { id: "m3", saas: "leverads", stage: "Mentoria", formExit: "mentoria", owner: "leo" });
  await repo.create("leads", { id: "v1", saas: "leverads", stage: "Novo lead" });
  assert.equal(await assignMentoriaOwner(repo), 1);
  assert.equal((await repo.get("leads", "m1")).owner, "sdr");
  assert.equal((await repo.get("leads", "m2")).owner, undefined); // terminal fica como está
  assert.equal((await repo.get("leads", "m3")).owner, "leo");     // dono existente é soberano
  assert.equal((await repo.get("leads", "v1")).owner, undefined);
  assert.equal(await assignMentoriaOwner(repo), 0);
});
