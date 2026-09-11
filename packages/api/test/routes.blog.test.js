// Rotas da redação do blog (/api/blog/:saas): HTTP, validação, gating de admin
// e códigos. Offline: Fastify + mem-repo + motor FAKE (o contrato do
// blog-engine.js), sem tocar em IA de verdade.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerBlogRoutes } from "../src/routes.blog.js";
import { ensureBlogSettings } from "../src/migrations.js";

class FakeEngineError extends Error {
  constructor(message, { status = 409, lint = null } = {}) { super(message); this.status = status; this.lint = lint; }
}

function fakeEngine(repo, over = {}) {
  const calls = [];
  const get = (id) => repo.get("blog_posts", id);
  const set = (id, patch) => repo.update("blog_posts", id, patch);
  return {
    calls,
    busy: () => false,
    nextSlotFor: async () => "2026-09-15T12:00:00.000Z",
    getDigest: async (saas, opts) => { calls.push(["getDigest", saas, opts]); return { text: "## PERFIL", json: {}, builtAt: "x", counts: {} }; },
    tick: async ({ saas }) => { calls.push(["tick", saas]); return [{ saas, published: 0, scheduled: 0, drafted: 1, mined: 2, errors: [] }]; },
    minePautas: async (saas, opts) => { calls.push(["minePautas", saas, opts]); return { created: [], dropped: 0, usage: {} }; },
    createPauta: async (saas, o) => repo.create("blog_posts", { id: "bp_new", saas, status: "pauta", title: o.title, keyword: o.keyword, author: o.by }),
    draftPost: async (id, o) => { calls.push(["draftPost", id, o]); return { post: await get(id), usage: {} }; },
    revisePost: async (id, o) => { calls.push(["revisePost", id, o]); return { post: await get(id), usage: {} }; },
    approvePost: async (id) => { const d = await get(id); if (d.lint?.some((i) => i.level === "erro")) throw new FakeEngineError("lint com erro", { status: 422, lint: d.lint }); return set(id, { status: "agendado" }); },
    unschedulePost: async (id) => set(id, { status: "rascunho" }),
    publishPost: async (id) => set(id, { status: "publicado", slugLocked: true, publishedAt: "2026-09-10T12:00:00.000Z" }),
    unpublishPost: async (id) => { const d = await get(id); return set(id, { status: "rascunho", publishedAt: d.publishedAt }); },
    archivePost: async (id) => set(id, { status: "arquivado" }),
    restorePost: async (id) => set(id, { status: "rascunho" }),
    ...over,
  };
}

async function setup({ authUser = undefined, aiOn = true, engineOver = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await ensureBlogSettings(repo);
  const engine = fakeEngine(repo, engineOver);
  const anthropic = { configured: () => aiOn };
  const app = Fastify();
  if (authUser !== undefined) app.addHook("onRequest", async (req) => { req.authUser = authUser; });
  registerBlogRoutes(app, repo, { anthropic, engine, publicBase: () => "https://levermoney.com.br" });
  await app.ready();
  return { app, repo, engine };
}

const seedPost = (repo, over = {}) => repo.create("blog_posts", {
  id: over.id || "bp_1", saas: "leverads", status: "rascunho", title: "Como operar várias contas no Mercado Livre",
  slug: "como-operar-varias-contas", slugLocked: false, description: "Guia prático pra operar várias contas de marketplace sem inchar o time e sem perder o controle do catálogo.",
  body: "## Intro\n\n" + "palavra ".repeat(720) + "\n\n## Como a LeverAds entra nisso\n\n[fazer o diagnóstico gratuito](https://levermoney.com.br/f/fo_diagnostico_leverads?utm_source=blog)",
  keyword: "várias contas mercado livre", tags: ["ml"], faq: [{ q: "a?", a: "b" }, { q: "c?", a: "d" }], lint: [],
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
});

test("GET /api/blog/:saas: lista sem corpo, contagens, aiConfigured, regras e próximo slot", async () => {
  const { app, repo } = await setup();
  await seedPost(repo);
  await seedPost(repo, { id: "bp_2", status: "pauta", slug: "outra" });
  const res = await app.inject({ method: "GET", url: "/api/blog/leverads" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.posts.length, 2);
  assert.ok(!("body" in body.posts[0]));
  assert.deepEqual(body.counts, { pauta: 1, rascunho: 1, agendado: 0, publicado: 0, arquivado: 0 });
  assert.equal(body.aiConfigured, true);
  assert.equal(body.rules.cadenciaSemanal, 2);
  assert.equal(body.nextSlot, "2026-09-15T12:00:00.000Z");
  const only = await app.inject({ method: "GET", url: "/api/blog/leverads?status=pauta" });
  assert.equal(only.json().posts.length, 1);
  const missing = await app.inject({ method: "GET", url: "/api/blog/nope" });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("GET /posts/:id devolve o doc completo; outro saas é 404", async () => {
  const { app, repo } = await setup();
  await seedPost(repo);
  await seedPost(repo, { id: "bp_x", saas: "outro", slug: "s2" });
  const ok = await app.inject({ method: "GET", url: "/api/blog/leverads/posts/bp_1" });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().body.includes("## Intro"));
  const nope = await app.inject({ method: "GET", url: "/api/blog/leverads/posts/bp_x" });
  assert.equal(nope.statusCode, 404);
  await app.close();
});

test("settings: GET devolve rules/state/log; PATCH exige admin e sanitiza", async () => {
  const { app } = await setup({ authUser: { id: "u1", roles: [] } });
  const get = await app.inject({ method: "GET", url: "/api/blog/leverads/settings" });
  assert.equal(get.statusCode, 200);
  assert.ok(Array.isArray(get.json().log));
  const denied = await app.inject({ method: "PATCH", url: "/api/blog/leverads/settings", payload: { rules: { cadenciaSemanal: 3 } } });
  assert.equal(denied.statusCode, 403);
  await app.close();

  const { app: admin, repo } = await setup({ authUser: { id: "leo", roles: ["admin"] } });
  const ok = await admin.inject({ method: "PATCH", url: "/api/blog/leverads/settings", payload: { rules: { cadenciaSemanal: 99, diasPublicacao: ["seg", "xxx"], autoPublicar: true } } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().rules.cadenciaSemanal, 7); // teto da régua
  assert.deepEqual(ok.json().rules.diasPublicacao, ["seg"]);
  assert.equal(ok.json().rules.autoPublicar, true);
  const saved = await repo.get("app_config", "blog_leverads");
  assert.equal(saved.rules.cadenciaSemanal, 7);
  const bad = await admin.inject({ method: "PATCH", url: "/api/blog/leverads/settings", payload: {} });
  assert.equal(bad.statusCode, 400);
  await admin.close();
});

test("PATCH /posts/:id: slug travado → 409; slug inválido → 400; slug duplicado → 409", async () => {
  const { app, repo } = await setup();
  await seedPost(repo, { slugLocked: true });
  await seedPost(repo, { id: "bp_2", slug: "ja-existe", status: "pauta" });
  const locked = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { slug: "novo-slug" } });
  assert.equal(locked.statusCode, 409);
  const invalid = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_2", payload: { slug: "Slug Inválido" } });
  assert.equal(invalid.statusCode, 400);
  const dup = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_2", payload: { slug: "como-operar-varias-contas" } });
  assert.equal(dup.statusCode, 409);
  const ok = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_2", payload: { slug: "slug-bom" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().slug, "slug-bom");
  await app.close();
});

test("PATCH /posts/:id: marca edited, recalcula palavras e lint, grava histórico", async () => {
  const { app, repo } = await setup({ authUser: { id: "manu", roles: [] } });
  await seedPost(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { title: "Título com — travessão", body: "## Curto\n\nSó isso." } });
  assert.equal(res.statusCode, 200);
  const doc = res.json();
  assert.equal(doc.edited, true);
  assert.equal(doc.updatedBy, "manu");
  assert.ok(doc.wordCount < 50);
  assert.ok(doc.lint.some((i) => i.code === "travessao" && i.level === "erro"));
  assert.ok(doc.lint.some((i) => i.code === "body_curto"));
  assert.equal(doc.history.at(-1).action, "edit");
  assert.equal(doc.history.at(-1).by, "manu");
  // validações de forma
  const badIntent = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { intent: "qualquer" } });
  assert.equal(badIntent.statusCode, 400);
  const badPrio = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { priority: 9 } });
  assert.equal(badPrio.statusCode, 400);
  const badFaq = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { faq: "x" } });
  assert.equal(badFaq.statusCode, 400);
  const sched = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { scheduledAt: "2099-01-01T12:00:00Z" } });
  assert.equal(sched.statusCode, 409); // só agendado
  await app.close();
});

test("PATCH em post publicado: não-admin 403; admin com erro de lint 422 carrega o lint", async () => {
  const { app, repo } = await setup({ authUser: { id: "manu", roles: [] } });
  await seedPost(repo, { status: "publicado", slugLocked: true, publishedAt: "2026-09-01T12:00:00.000Z" });
  const denied = await app.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { title: "x" } });
  assert.equal(denied.statusCode, 403);
  await app.close();

  const { app: admin, repo: r2 } = await setup({ authUser: { id: "leo", roles: ["admin"] } });
  await seedPost(r2, { status: "publicado", slugLocked: true, publishedAt: "2026-09-01T12:00:00.000Z" });
  const bad = await admin.inject({ method: "PATCH", url: "/api/blog/leverads/posts/bp_1", payload: { body: "## Só\n\nCusta R$ 349 por mês." } });
  assert.equal(bad.statusCode, 422);
  assert.ok(bad.json().lint.some((i) => i.code === "preco"));
  const unchanged = await r2.get("blog_posts", "bp_1");
  assert.ok(unchanged.body.includes("## Intro"));
  await admin.close();
});

test("approve: erro de lint vira 422 com o lint no corpo; sem erro agenda", async () => {
  const { app, repo } = await setup();
  await seedPost(repo, { lint: [{ code: "preco", level: "erro", msg: "x" }] });
  const bad = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/approve" });
  assert.equal(bad.statusCode, 422);
  assert.equal(bad.json().lint[0].code, "preco");
  await seedPost(repo, { id: "bp_2", slug: "ok", lint: [] });
  const ok = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_2/approve", payload: { scheduledAt: "2099-01-01T12:00:00Z" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, "agendado");
  await app.close();
});

test("publish/unpublish exigem admin (sessão sem etiqueta 403; admin e chave mestre passam); unpublish preserva publishedAt", async () => {
  const { app: plain, repo: r1 } = await setup({ authUser: { id: "manu", roles: [] } });
  await seedPost(r1);
  assert.equal((await plain.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/publish" })).statusCode, 403);
  assert.equal((await plain.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/unpublish" })).statusCode, 403);
  await plain.close();

  const { app: admin, repo: r2 } = await setup({ authUser: { id: "leo", roles: ["admin"] } });
  await seedPost(r2);
  const pub = await admin.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/publish" });
  assert.equal(pub.statusCode, 200);
  assert.equal(pub.json().status, "publicado");
  assert.equal(pub.json().slugLocked, true);
  const unpub = await admin.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/unpublish" });
  assert.equal(unpub.statusCode, 200);
  assert.equal(unpub.json().status, "rascunho");
  assert.equal(unpub.json().publishedAt, "2026-09-10T12:00:00.000Z");
  await admin.close();

  const { app: master, repo: r3 } = await setup(); // sem authUser = chave mestre
  await seedPost(r3);
  assert.equal((await master.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/publish" })).statusCode, 200);
  await master.close();
});

test("archive de publicado exige admin; restore, unschedule e DELETE seguem a topologia", async () => {
  const { app, repo } = await setup({ authUser: { id: "manu", roles: [] } });
  await seedPost(repo, { status: "publicado", slugLocked: true });
  assert.equal((await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/archive" })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/blog/leverads/posts/bp_1" })).statusCode, 409);
  await seedPost(repo, { id: "bp_2", slug: "s2", status: "agendado" });
  const un = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_2/unschedule" });
  assert.equal(un.json().status, "rascunho");
  const ar = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_2/archive" });
  assert.equal(ar.json().status, "arquivado");
  const del = await app.inject({ method: "DELETE", url: "/api/blog/leverads/posts/bp_2" });
  assert.equal(del.statusCode, 200);
  assert.equal(await repo.get("blog_posts", "bp_2"), null);
  await seedPost(repo, { id: "bp_3", slug: "s3", status: "arquivado" });
  const rs = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_3/restore" });
  assert.equal(rs.json().status, "rascunho");
  await app.close();
});

test("revise: instrução vazia ou longa → 400; publicado exige admin; chama o motor com by", async () => {
  const { app, repo, engine } = await setup({ authUser: { id: "manu", roles: [] } });
  await seedPost(repo);
  assert.equal((await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/revise", payload: {} })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/revise", payload: { instruction: "x".repeat(601) } })).statusCode, 400);
  const ok = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/revise", payload: { instruction: "mais curto" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(engine.calls.find((c) => c[0] === "revisePost").slice(1), ["bp_1", { instruction: "mais curto", by: "manu" }]);
  await seedPost(repo, { id: "bp_p", slug: "sp", status: "publicado", slugLocked: true });
  assert.equal((await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_p/revise", payload: { instruction: "x" } })).statusCode, 403);
  await app.close();
});

test("pautas/draft/revise sem IA → 424; motor ocupado → 409", async () => {
  const { app, repo } = await setup({ aiOn: false });
  await seedPost(repo, { status: "pauta" });
  const res = await app.inject({ method: "POST", url: "/api/blog/leverads/pautas", payload: { n: 3 } });
  assert.equal(res.statusCode, 424);
  assert.match(res.json().error, /IA não configurada/);
  assert.equal((await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/draft" })).statusCode, 424);
  await app.close();

  const { app: busy } = await setup({ engineOver: { busy: () => true } });
  assert.equal((await busy.inject({ method: "POST", url: "/api/blog/leverads/pautas" })).statusCode, 409);
  assert.equal((await busy.inject({ method: "POST", url: "/api/blog/leverads/tick" })).statusCode, 409);
  await busy.close();
});

test("pautas passa n/refresh/by ao motor; falha do provedor sai 424, nunca 5xx", async () => {
  const { app, engine } = await setup({ authUser: { id: "manu", roles: [] } });
  const ok = await app.inject({ method: "POST", url: "/api/blog/leverads/pautas", payload: { n: 4, refresh: true } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(engine.calls.find((c) => c[0] === "minePautas").slice(1), ["leverads", { n: 4, refresh: true, by: "manu" }]);
  await app.close();

  const { app: failing } = await setup({ engineOver: { minePautas: async () => { throw new Error("OpenRouter -> 429: rate limit"); } } });
  const bad = await failing.inject({ method: "POST", url: "/api/blog/leverads/pautas" });
  assert.equal(bad.statusCode, 424);
  assert.match(bad.json().error, /429/);
  await failing.close();
});

test("tick devolve o relatório do produto; digest devolve o texto; POST /posts cria pauta manual", async () => {
  const { app, repo } = await setup({ authUser: { id: "manu", roles: [] } });
  const tick = await app.inject({ method: "POST", url: "/api/blog/leverads/tick" });
  assert.equal(tick.statusCode, 200);
  assert.equal(tick.json().mined, 2);
  const digest = await app.inject({ method: "GET", url: "/api/blog/leverads/digest" });
  assert.equal(digest.json().text, "## PERFIL");
  const noTitle = await app.inject({ method: "POST", url: "/api/blog/leverads/posts", payload: { keyword: "x" } });
  assert.equal(noTitle.statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/blog/leverads/posts", payload: { title: "  Pauta manual  ", keyword: "kw" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().title, "Pauta manual");
  assert.equal(created.json().author, "manu");
  assert.equal((await repo.get("blog_posts", "bp_new")).status, "pauta");
  await app.close();
});

test("draft repassa force e by; preview-url devolve link assinado do renderizador público", async () => {
  const { app, repo, engine } = await setup();
  await seedPost(repo, { status: "pauta" });
  const d = await app.inject({ method: "POST", url: "/api/blog/leverads/posts/bp_1/draft?force=1" });
  assert.equal(d.statusCode, 200);
  assert.deepEqual(engine.calls.find((c) => c[0] === "draftPost").slice(1), ["bp_1", { by: "api", force: true }]);
  const pv = await app.inject({ method: "GET", url: "/api/blog/leverads/posts/bp_1/preview-url" });
  assert.equal(pv.statusCode, 200);
  assert.ok(pv.json().url.startsWith("https://levermoney.com.br/public/blog/preview/bp_1?exp="));
  assert.ok(pv.json().url.includes("&sig="));
  assert.ok(new Date(pv.json().expiresAt).getTime() > Date.now());
  assert.equal((await app.inject({ method: "GET", url: "/api/blog/leverads/posts/nada/preview-url" })).statusCode, 404);
  await app.close();
});
