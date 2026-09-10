// Motor do blog (blog-engine.js): ciclo com IA fake e relógio parado. Cobre
// mineração com dedup, 1 rascunho por ciclo, revisão única pelo lint, agenda
// na cadência BRT, publicação do que venceu, caps diários, idempotência em
// restart e single-flight do poller.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeBlogEngine, startBlogEngine, nextSlots, BlogEngineError, brtWeekday, isoWeekKey } from "../src/blog-engine.js";
import { ensureBlogSettings } from "../src/migrations.js";
import { blogCfgId } from "../src/blog-config.js";
import { lintPost } from "../src/blog-lint.js";

const CTA = "https://levermoney.com.br/f/fo_diagnostico_leverads";
// Segunda-feira 14/09/2026 às 10:00 de Brasília (13:00Z).
const MONDAY_10 = new Date("2026-09-14T13:00:00Z");
const iso = (d) => new Date(d).toISOString();
const minutesAgo = (base, min) => iso(base.getTime() - min * 60000);

// Corpo limpo no lint: 2 H2, mais de 700 palavras sem número, sem travessão,
// sem "clon", e um link pro CTA (que ganha as UTMs no motor).
function goodBody() {
  const frase = "Operar mais de uma conta no marketplace exige processo e ferramenta, não horas extras do time. ";
  const par = frase.repeat(26).trim();
  return [
    "## Por que a operação trava quando entra a segunda conta",
    "", par, "",
    "## O que muda quando a publicação é sincronizada",
    "", par, "",
    "## Como a LeverAds entra nisso",
    "", "A gente mostra a operação rodando na sua conta. Vale [fazer o diagnóstico gratuito](" + CTA + ") e conversar com um especialista.",
  ].join("\n");
}

const goodDraft = (over = {}) => ({
  title: "Como operar várias contas no Mercado Livre sem inchar o time",
  slug: "operar-varias-contas-mercado-livre",
  description: "Guia prático pra quem já vende em mais de uma conta e quer manter catálogo, estoque e anúncios em dia sem contratar mais gente.",
  body_md: goodBody(),
  faq: [{ q: "Preciso de uma pessoa por conta?", a: "Não. Com publicação sincronizada uma pessoa opera várias contas." }, { q: "Funciona na Shopee?", a: "Sim, Mercado Livre e Shopee." }],
  tags: ["multi-contas", "mercado livre", "operação"],
  sourcesUsed: ["ger_n_1", "digest:objecoes"],
  ...over,
});

const pautaOf = (over = {}) => ({
  title: "Como operar várias contas no Mercado Livre", keyword: "operar várias contas mercado livre", intent: "guia",
  category: "Operação multi-contas", painCode: "C", angle: "a gente opera isso todo dia",
  outline: ["Por que trava", "O que muda", "Como começar"], evidence: ["12% dos leads têm mais de duas contas"], faqSeeds: ["Preciso de uma pessoa por conta?"], priority: 2,
  ...over,
});

function makeAi({ pautas = [], draft = goodDraft(), revised = null, configured = true } = {}) {
  const calls = { pautas: [], draft: [], revise: [] };
  return {
    calls,
    configured: () => configured,
    async blogPautas(args) { calls.pautas.push(args); return { pautas: typeof pautas === "function" ? pautas(args) : pautas, usage: { input_tokens: 10, output_tokens: 5 }, model: "fake" }; },
    async blogDraft(args) { calls.draft.push(args); const d = typeof draft === "function" ? draft(args) : draft; if (d instanceof Error) throw d; return { draft: d, usage: { input_tokens: 100, output_tokens: 50 }, model: "fake" }; },
    async blogRevise(args) { calls.revise.push(args); const r = typeof revised === "function" ? revised(args) : revised; return { revised: r || {}, usage: { input_tokens: 20, output_tokens: 10 }, model: "fake" }; },
  };
}

async function setup({ rules = {}, ai, now = MONDAY_10 } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", painMap: { C: "gerenciar SKUs em múltiplas contas" } });
  await ensureBlogSettings(repo);
  if (Object.keys(rules).length) {
    const cfg = await repo.get("app_config", blogCfgId("leverads"));
    await repo.update("app_config", cfg.id, { rules: { ...cfg.rules, ...rules } });
  }
  const anthropic = ai || makeAi();
  const clock = { t: now };
  const engine = makeBlogEngine({ repo, anthropic, results: () => ({ resRitmo: "R$ 10,4 mil" }), decks: [], log: { warn() {}, info() {} }, now: () => clock.t });
  return { repo, engine, ai: anthropic, clock, cfg: () => repo.get("app_config", blogCfgId("leverads")), posts: () => repo.list("blog_posts") };
}

const seedPost = (repo, over = {}) => repo.create("blog_posts", {
  saas: "leverads", status: "pauta", title: "T", keyword: "", category: "Operação multi-contas", priority: 3,
  slug: "", slugLocked: false, description: "", body: "", faq: [], tags: [], sources: [], lint: [], outline: [], evidence: [], faqSeeds: [],
  createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z", scheduledAt: "", publishedAt: "", draftingAt: "", author: "cockpit", history: [],
  ...over,
});

// ── helpers de calendário ────────────────────────────────────────────────────

test("brtWeekday/isoWeekKey: segunda 14/09/2026 10h BRT", () => {
  assert.equal(brtWeekday(MONDAY_10), "seg");
  assert.equal(isoWeekKey(MONDAY_10), "2026-W38");
  // 23:30 BRT de segunda ainda é segunda (02:30Z de terça)
  assert.equal(brtWeekday("2026-09-15T02:30:00Z"), "seg");
});

test("nextSlots: de segunda 10h BRT com ter/qui 9h → terça 12:00Z; de terça 9h30 → quinta; cap semanal empurra; taken pula", () => {
  const rules = { diasPublicacao: ["ter", "qui"], horaPublicacao: "09:00", cadenciaSemanal: 2 };
  assert.deepEqual(nextSlots(rules, MONDAY_10, 1), ["2026-09-15T12:00:00.000Z"]);
  assert.deepEqual(nextSlots(rules, "2026-09-15T12:30:00Z", 1), ["2026-09-17T12:00:00.000Z"]);
  // semana 38 já tem 2 publicações → próximo slot é a terça da semana 39
  const taken = ["2026-09-15T12:00:00.000Z", "2026-09-17T12:00:00.000Z"];
  assert.deepEqual(nextSlots(rules, MONDAY_10, 1, taken), ["2026-09-22T12:00:00.000Z"]);
  // só a terça ocupada → quinta é o próximo, e a semana seguinte fecha em 2
  assert.deepEqual(nextSlots(rules, MONDAY_10, 3, ["2026-09-15T12:00:00.000Z"]), ["2026-09-17T12:00:00.000Z", "2026-09-22T12:00:00.000Z", "2026-09-24T12:00:00.000Z"]);
  // exatamente no horário do slot: já passou
  assert.deepEqual(nextSlots(rules, "2026-09-15T12:00:00Z", 1), ["2026-09-17T12:00:00.000Z"]);
});

// ── mineração ────────────────────────────────────────────────────────────────

test("tick minera pautas quando falta, dedup por keyword e título parecido, e grava contadores", async () => {
  const ai = makeAi({
    pautas: [
      pautaOf({ title: "Guia de estoque sincronizado entre contas", keyword: "estoque sincronizado" }),
      pautaOf({ title: "Qualquer coisa", keyword: "Operar Várias Contas Mercado Livre" }),          // keyword já existe
      pautaOf({ title: "Como operar várias contas no Mercado Livre hoje", keyword: "outra" }),        // título quase igual
      pautaOf({ title: "x".repeat(71), keyword: "longa" }),                                            // título comprido
      pautaOf({ title: "Conta suspensa: como anunciar de novo", keyword: "conta suspensa", category: "Categoria inexistente", priority: 9 }),
    ],
  });
  const { repo, engine, cfg, posts } = await setup({ ai, rules: { autoRascunho: false } });
  await seedPost(repo, { title: "Como operar várias contas no Mercado Livre", keyword: "operar várias contas mercado livre" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.mined, 2);
  assert.deepEqual(rep.errors, []);
  const all = await posts();
  assert.equal(all.filter((p) => p.status === "pauta").length, 3);
  const nova = all.find((p) => p.keyword === "conta suspensa");
  assert.equal(nova.category, "Operação multi-contas"); // fora da lista → primeira
  assert.equal(nova.priority, 5);                       // clamp 1..5
  assert.equal(nova.ai.task, "pautas");
  assert.ok(nova.id.startsWith("bp_"));
  assert.ok(ai.calls.pautas[0].existing.includes("Como operar várias contas no Mercado Livre"));
  assert.ok(ai.calls.pautas[0].digest.includes("JÁ EXISTE NO BLOG"));
  const c = await cfg();
  assert.equal(c.state.pautaRounds, 1);
  assert.equal(c.state.lastMineAt, iso(MONDAY_10));
  assert.equal(c.state.lastTickAt, iso(MONDAY_10));
  assert.equal(c.state.day, "2026-09-14");
});

// ── rascunho ─────────────────────────────────────────────────────────────────

test("tick rascunha UMA pauta por ciclo (menor priority), slug único com -2 e UTM no link do CTA", async () => {
  const ai = makeAi({ draft: goodDraft({ slug: "guia-x" }) });
  const { repo, engine, posts, cfg } = await setup({ ai, rules: { autoPauta: false } });
  await seedPost(repo, { id: "bp_old", status: "arquivado", slug: "guia-x", title: "Velho" });
  await seedPost(repo, { id: "bp_p2", title: "Pauta 2", priority: 2, createdAt: "2026-09-02T00:00:00Z" });
  await seedPost(repo, { id: "bp_p1", title: "Pauta 1", priority: 1, createdAt: "2026-09-03T00:00:00Z" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.drafted, 1);
  assert.deepEqual(rep.errors, []);
  assert.equal(ai.calls.draft.length, 1);
  assert.equal(ai.calls.draft[0].pauta.id, "bp_p1");
  assert.equal(ai.calls.draft[0].ctaUrl, CTA);
  assert.ok(ai.calls.draft[0].knowledge.includes("QUEM SOMOS"));
  const p1 = await repo.get("blog_posts", "bp_p1");
  assert.equal(p1.status, "rascunho");
  assert.equal(p1.slug, "guia-x-2");
  assert.equal(p1.draftingAt, "");
  assert.equal(p1.edited, false);
  assert.equal(p1.ai.task, "draft");
  assert.ok(p1.body.includes("utm_source=blog"));
  assert.ok(p1.body.includes("utm_content=guia-x-2"));
  assert.ok(p1.wordCount > 700);
  assert.deepEqual(p1.lint.filter((i) => i.level === "erro"), []);
  assert.deepEqual(p1.sources, [{ type: "flashcard", ref: "ger_n_1" }, { type: "digest", ref: "digest:objecoes" }]);
  assert.equal(p1.history.at(-1).action, "rascunho");
  assert.equal((await repo.get("blog_posts", "bp_p2")).status, "pauta");
  assert.equal(ai.calls.revise.length, 0);
  assert.equal((await cfg()).state.rascunhos, 1);
  assert.equal((await posts()).length, 3);
});

test("rascunho com travessão: UMA revisão; se continuar ruim fica rascunho com lint e nunca é auto-agendado", async () => {
  const bad = goodDraft({ body_md: goodBody().replace("exige processo", "exige — processo") });
  const ai = makeAi({ draft: bad, revised: { body_md: bad.body_md } }); // a revisão não conserta
  const { repo, engine, posts } = await setup({ ai, rules: { autoPauta: false, autoPublicar: true } });
  await seedPost(repo, { id: "bp_a", title: "A" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.drafted, 1);
  assert.equal(ai.calls.revise.length, 1);
  assert.ok(ai.calls.revise[0].lintIssues.some((i) => i.code === "travessao"));
  const a = await repo.get("blog_posts", "bp_a");
  assert.equal(a.status, "rascunho");
  assert.ok(a.lint.some((i) => i.code === "travessao" && i.level === "erro"));
  // segundo ciclo com autoPublicar: continua rascunho (lint bloqueia)
  const [rep2] = await engine.tick({ saas: "leverads" });
  assert.equal(rep2.scheduled, 0);
  assert.equal((await repo.get("blog_posts", "bp_a")).status, "rascunho");
  assert.equal((await posts()).filter((p) => p.status === "agendado").length, 0);
});

test("rascunho com travessão: a revisão que conserta é a versão salva", async () => {
  const bad = goodDraft({ body_md: goodBody().replace("exige processo", "exige — processo") });
  const ai = makeAi({ draft: bad, revised: { body_md: goodBody(), title: bad.title, description: bad.description, faq: bad.faq, tags: bad.tags } });
  const { repo, engine } = await setup({ ai, rules: { autoPauta: false } });
  await seedPost(repo, { id: "bp_a", title: "A" });
  await engine.tick({ saas: "leverads" });
  const a = await repo.get("blog_posts", "bp_a");
  assert.equal(ai.calls.revise.length, 1);
  assert.deepEqual(a.lint.filter((i) => i.level === "erro"), []);
  assert.ok(!a.body.includes("—"));
  assert.equal(a.ai.usage.input_tokens, 120); // soma das duas chamadas
  assert.match(a.history.at(-1).note, /revisado/);
});

test("IA falha no rascunho: erro no relatório, trava liberada, pauta continua pauta", async () => {
  const ai = makeAi({ draft: new Error("429 rate limit") });
  const { repo, engine, cfg } = await setup({ ai, rules: { autoPauta: false } });
  await seedPost(repo, { id: "bp_a", title: "A" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.drafted, 0);
  assert.equal(rep.errors.length, 1);
  assert.match(rep.errors[0], /rascunho: IA falhou: 429/);
  const a = await repo.get("blog_posts", "bp_a");
  assert.equal(a.status, "pauta");
  assert.equal(a.draftingAt, "");
  assert.match((await cfg()).state.lastError, /429/);
});

// ── publicação ───────────────────────────────────────────────────────────────

test("publishDue: publica o agendado vencido (slug travado, publishedAt = agora), mantém o futuro, e sem IA só faz isso", async () => {
  const { repo, engine } = await setup({ ai: makeAi({ configured: false }) });
  const draft = goodDraft();
  const base = { status: "agendado", slug: "vencido", title: draft.title, description: draft.description, body: draft.body_md, faq: draft.faq, tags: draft.tags };
  await seedPost(repo, { ...base, id: "bp_due", scheduledAt: "2026-09-14T12:00:00.000Z" });
  await seedPost(repo, { ...base, id: "bp_fut", slug: "futuro", scheduledAt: "2026-09-15T12:00:00.000Z" });
  await seedPost(repo, { id: "bp_pauta", title: "pauta" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.published, 1);
  assert.equal(rep.mined, 0);
  assert.equal(rep.drafted, 0);
  const due = await repo.get("blog_posts", "bp_due");
  assert.equal(due.status, "publicado");
  assert.equal(due.slugLocked, true);
  assert.equal(due.publishedAt, iso(MONDAY_10));
  assert.equal(due.scheduledAt, "");
  assert.ok(due.body.includes("utm_content=vencido"));
  assert.equal((await repo.get("blog_posts", "bp_fut")).status, "agendado");
  const c = await repo.get("app_config", blogCfgId("leverads"));
  assert.equal(c.state.lastError, "IA não configurada");
  assert.equal(c.state.lastPublishAt, iso(MONDAY_10));
});

test("publishDue: agendado que reprova no lint na hora volta pra rascunho em vez de publicar", async () => {
  const { repo, engine } = await setup({ ai: makeAi({ configured: false }) });
  const draft = goodDraft();
  await seedPost(repo, { id: "bp_due", status: "agendado", slug: "x", title: draft.title, description: draft.description, body: draft.body_md + "\n\nCusta R$ 349 por mês.", scheduledAt: "2026-09-14T12:00:00.000Z" });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.published, 0);
  const d = await repo.get("blog_posts", "bp_due");
  assert.equal(d.status, "rascunho");
  assert.ok(d.lint.some((i) => i.code === "preco"));
  assert.match(d.history.at(-1).note, /lint reprovou/);
});

test("approve → publish → unpublish → publish preserva publishedAt e slug travado; approve com lint erro dá 422", async () => {
  const { repo, engine, clock } = await setup({ ai: makeAi({ configured: false }) });
  const draft = goodDraft();
  await seedPost(repo, { id: "bp_r", status: "rascunho", slug: "meu-post", title: draft.title, description: draft.description, body: draft.body_md, faq: draft.faq, tags: draft.tags });
  const ag = await engine.approvePost("bp_r", { by: "leo" });
  assert.equal(ag.status, "agendado");
  assert.equal(ag.scheduledAt, "2026-09-15T12:00:00.000Z");
  assert.equal(ag.history.at(-1).by, "leo");
  const pub = await engine.publishPost("bp_r", { by: "leo" });
  assert.equal(pub.status, "publicado");
  assert.equal(pub.publishedAt, iso(MONDAY_10));
  assert.equal(pub.slugLocked, true);
  clock.t = new Date("2026-09-20T13:00:00Z");
  const un = await engine.unpublishPost("bp_r", { by: "leo" });
  assert.equal(un.status, "rascunho");
  assert.equal(un.publishedAt, iso(MONDAY_10));
  assert.equal(un.slugLocked, true);
  assert.equal(un.unpublishedAt, "2026-09-20T13:00:00.000Z");
  const re = await engine.publishPost("bp_r", { by: "leo" });
  assert.equal(re.publishedAt, iso(MONDAY_10)); // data SEO preservada
  assert.equal(re.updatedAt, "2026-09-20T13:00:00.000Z");
  // lint erro bloqueia aprovar
  await seedPost(repo, { id: "bp_bad", status: "rascunho", slug: "ruim", title: "T", description: "d", body: "curto" });
  await assert.rejects(() => engine.approvePost("bp_bad"), (e) => e instanceof BlogEngineError && e.status === 422 && Array.isArray(e.lint) && e.lint.some((i) => i.code === "body_curto"));
  // status errado
  await assert.rejects(() => engine.approvePost("bp_r"), (e) => e.status === 409);
  await assert.rejects(() => engine.publishPost("bp_r"), (e) => e.status === 409);
  await assert.rejects(() => engine.approvePost("nope"), (e) => e.status === 404);
  // data no passado
  await seedPost(repo, { id: "bp_r2", status: "rascunho", slug: "meu-post-2", title: draft.title, description: draft.description, body: draft.body_md });
  await assert.rejects(() => engine.approvePost("bp_r2", { scheduledAt: "2026-09-01T00:00:00Z" }), (e) => e.status === 409);
  const ag2 = await engine.approvePost("bp_r2", { scheduledAt: "2026-10-01T12:00:00Z" });
  assert.equal(ag2.scheduledAt, "2026-10-01T12:00:00.000Z");
  const back = await engine.unschedulePost("bp_r2");
  assert.equal(back.status, "rascunho");
  assert.equal(back.scheduledAt, "");
});

test("archive/restore/createPauta e nextSlotFor", async () => {
  const { repo, engine } = await setup({ ai: makeAi({ configured: false }) });
  const p = await engine.createPauta("leverads", { title: "Pauta manual", keyword: "kw", category: "Shopee", by: "leo" });
  assert.equal(p.status, "pauta");
  assert.equal(p.category, "Shopee");
  assert.equal(p.priority, 3);
  assert.equal(p.author, "leo");
  await assert.rejects(() => engine.createPauta("leverads", { title: "  " }), (e) => e.status === 409);
  await assert.rejects(() => engine.createPauta("nada", { title: "x" }), (e) => e.status === 404);
  const arch = await engine.archivePost(p.id);
  assert.equal(arch.status, "arquivado");
  const rest = await engine.restorePost(p.id);
  assert.equal(rest.status, "pauta"); // sem corpo volta pra pauta
  await seedPost(repo, { id: "bp_b", status: "arquivado", body: "## x\n\ntexto" });
  assert.equal((await engine.restorePost("bp_b")).status, "rascunho");
  await assert.rejects(() => engine.restorePost("bp_b"), (e) => e.status === 409);
  assert.equal(await engine.nextSlotFor("leverads"), "2026-09-15T12:00:00.000Z");
  await seedPost(repo, { id: "bp_ag", status: "agendado", scheduledAt: "2026-09-15T12:00:00.000Z" });
  assert.equal(await engine.nextSlotFor("leverads"), "2026-09-17T12:00:00.000Z");
});

test("autoPublicar respeita bufferAgendados e a ordem de prioridade", async () => {
  const { repo, engine, posts } = await setup({ ai: makeAi({ configured: false }), rules: { autoPublicar: true, bufferAgendados: 2 } });
  const d = goodDraft();
  const base = { status: "rascunho", title: d.title, description: d.description, body: d.body_md, faq: d.faq, tags: d.tags };
  await seedPost(repo, { ...base, id: "bp_1", slug: "um", priority: 3, createdAt: "2026-09-01T00:00:00Z" });
  await seedPost(repo, { ...base, id: "bp_2", slug: "dois", priority: 1, createdAt: "2026-09-02T00:00:00Z" });
  await seedPost(repo, { ...base, id: "bp_3", slug: "tres", priority: 2, createdAt: "2026-09-03T00:00:00Z" });
  await seedPost(repo, { ...base, id: "bp_4", slug: "quatro", priority: 1, draftingAt: iso(MONDAY_10) }); // rascunho em andamento: ignorado
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.scheduled, 2);
  const ag = (await posts()).filter((p) => p.status === "agendado").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  assert.deepEqual(ag.map((p) => p.id), ["bp_2", "bp_3"]);
  assert.deepEqual(ag.map((p) => p.scheduledAt), ["2026-09-15T12:00:00.000Z", "2026-09-17T12:00:00.000Z"]);
  const [rep2] = await engine.tick({ saas: "leverads" });
  assert.equal(rep2.scheduled, 0); // buffer cheio
});

// ── idempotência, caps e restart ─────────────────────────────────────────────

test("segundo ciclo no mesmo minuto não minera de novo; contadores sobrevivem a um motor novo no mesmo repo", async () => {
  const temas = ["Estoque sincronizado entre lojas", "Ficha técnica completa com inteligência", "Conta suspensa e o que fazer", "Precificação por canal de venda", "Catálogo grande sem retrabalho", "Equipe enxuta operando muitas contas"];
  const ai = makeAi({ pautas: (a) => temas.slice(0, a.n).map((t, i) => pautaOf({ title: t, keyword: `tema ${i}` })) });
  const { repo, engine, posts } = await setup({ ai, rules: { autoRascunho: false } });
  const [r1] = await engine.tick({ saas: "leverads" });
  assert.equal(r1.mined, 6);
  const [r2] = await engine.tick({ saas: "leverads" });
  assert.equal(r2.mined, 0);
  assert.equal(ai.calls.pautas.length, 1);
  // motor novo (restart) no mesmo repo: lê pautaRounds/lastMineAt do doc
  const engine2 = makeBlogEngine({ repo, anthropic: ai, results: () => null, decks: [], log: { warn() {} }, now: () => MONDAY_10 });
  // some as pautas pra forçar a condição de minerar
  for (const p of await posts()) await repo.remove("blog_posts", p.id);
  const [r3] = await engine2.tick({ saas: "leverads", force: true });
  assert.equal(r3.mined, 0); // maxRodadasPautaDia = 1 já usada hoje
  assert.equal(ai.calls.pautas.length, 1);
});

test("caps diários: maxRascunhosDia segura o segundo rascunho; o dia vira e libera", async () => {
  const { repo, engine, clock, cfg } = await setup({ rules: { autoPauta: false, maxRascunhosDia: 1, minRascunhos: 5 } });
  await seedPost(repo, { id: "bp_1", title: "A", priority: 1 });
  await seedPost(repo, { id: "bp_2", title: "B", priority: 2 });
  const [r1] = await engine.tick({ saas: "leverads" });
  assert.equal(r1.drafted, 1);
  const [r2] = await engine.tick({ saas: "leverads" });
  assert.equal(r2.drafted, 0);
  assert.equal((await cfg()).state.rascunhos, 1);
  clock.t = new Date("2026-09-15T13:00:00Z"); // terça
  const [r3] = await engine.tick({ saas: "leverads" });
  assert.equal(r3.drafted, 1);
  const c = await cfg();
  assert.equal(c.state.day, "2026-09-15");
  assert.equal(c.state.rascunhos, 1);
});

test("draftingAt: trava fresca (2 min) é respeitada, trava velha (20 min) é ignorada", async () => {
  const { repo, engine } = await setup({ rules: { autoPauta: false } });
  await seedPost(repo, { id: "bp_fresh", title: "fresca", priority: 1, draftingAt: minutesAgo(MONDAY_10, 2) });
  await seedPost(repo, { id: "bp_stale", title: "velha", priority: 2, draftingAt: minutesAgo(MONDAY_10, 20) });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.drafted, 1);
  assert.equal((await repo.get("blog_posts", "bp_stale")).status, "rascunho");
  assert.equal((await repo.get("blog_posts", "bp_fresh")).status, "pauta");
  await assert.rejects(() => engine.draftPost("bp_fresh"), (e) => e.status === 409 && /andamento/.test(e.message));
});

test("enabled:false → skipped; produto sem doc de config é pulado; sem saas roda todos os produtos com doc", async () => {
  const { repo, engine } = await setup({ rules: { enabled: false } });
  const [rep] = await engine.tick({ saas: "leverads" });
  assert.equal(rep.skipped, "desligado");
  await repo.create("products", { id: "outro", name: "Outro" });
  const [semDoc] = await engine.tick({ saas: "outro" });
  assert.equal(semDoc.skipped, "sem configuração");
  const all = await engine.tick();
  assert.deepEqual(all.map((r) => r.saas), ["leverads"]);
  await assert.rejects(() => engine.tick({ saas: "nada" }), (e) => e.status === 404);
});

test("minePautas/draftPost sem IA → 424; revisePost exige instrução e devolve 422 em publicado que ficaria com erro", async () => {
  const { repo, engine } = await setup({ ai: makeAi({ configured: false }) });
  await assert.rejects(() => engine.minePautas("leverads"), (e) => e.status === 424);
  await seedPost(repo, { id: "bp_a", title: "A" });
  await assert.rejects(() => engine.draftPost("bp_a"), (e) => e.status === 424);

  const ai = makeAi({ revised: { body_md: goodBody() + "\n\nSó 12x de 99." } });
  const { repo: repo2, engine: engine2 } = await setup({ ai });
  const d = goodDraft();
  await seedPost(repo2, { id: "bp_pub", status: "publicado", slug: "pub", slugLocked: true, publishedAt: "2026-09-01T12:00:00.000Z", title: d.title, description: d.description, body: d.body_md });
  await assert.rejects(() => engine2.revisePost("bp_pub", { instruction: "" }), (e) => e.status === 409);
  await assert.rejects(() => engine2.revisePost("bp_pub", { instruction: "ponha preço" }), (e) => e.status === 422 && e.lint.some((i) => i.code === "preco"));
  assert.equal((await repo2.get("blog_posts", "bp_pub")).body, d.body_md); // nada salvo
  // agendado revisado volta pra rascunho
  const ai3 = makeAi({ revised: { body_md: goodBody(), changeNote: "trocou o tom" } });
  const { repo: repo3, engine: engine3 } = await setup({ ai: ai3 });
  await seedPost(repo3, { id: "bp_ag", status: "agendado", slug: "ag", scheduledAt: "2026-09-15T12:00:00.000Z", title: d.title, description: d.description, body: d.body_md });
  const { post } = await engine3.revisePost("bp_ag", { instruction: "mais direto", by: "leo" });
  assert.equal(post.status, "rascunho");
  assert.equal(post.scheduledAt, "");
  assert.equal(post.ai.task, "revise");
  assert.equal(post.history.at(-1).note, "mais direto");
  assert.ok(ai3.calls.revise[0].knowledge.includes("QUEM SOMOS"));
});

test("digest fica em cache 6h e refresh força reconstrução", async () => {
  const { engine, clock } = await setup();
  const a = await engine.getDigest("leverads");
  const b = await engine.getDigest("leverads");
  assert.equal(a, b);
  clock.t = new Date(MONDAY_10.getTime() + 7 * 3600 * 1000);
  const c = await engine.getDigest("leverads");
  assert.notEqual(a, c);
  const d = await engine.getDigest("leverads", { refresh: true });
  assert.notEqual(c, d);
  assert.ok(lintPost({ title: "t", description: "d", body: d.text, slug: "x" }).every((i) => i.code !== "travessao"));
});

test("startBlogEngine: single-flight (run duas vezes = um tick) e busy() enquanto roda", async () => {
  let resolve;
  let ticks = 0;
  const engine = { aiConfigured: () => true, tick: () => new Promise((r) => { ticks++; resolve = r; }) };
  const h = startBlogEngine({}, { engine, intervalMs: 3_600_000, log: { info() {}, warn() {} } });
  const p1 = h.run();
  const p2 = h.run();
  assert.equal(ticks, 1);
  resolve([]);
  await Promise.all([p1, p2]);
  const p3 = h.run();
  assert.equal(ticks, 2);
  resolve([]);
  await p3;
  h.stop();

  const { engine: real } = await setup({ ai: makeAi({ configured: false }) });
  assert.equal(real.busy(), false);
  const t = real.tick({ saas: "leverads" });
  assert.equal(real.busy(), true);
  await t;
  assert.equal(real.busy(), false);
});
