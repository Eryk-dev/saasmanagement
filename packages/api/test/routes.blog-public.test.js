// Rotas públicas do blog (/public/blog/*): só publicado sai, noindex sem o
// header do proxy, 404 da marca, preview assinado, sitemap/feed, HEAD.
// Offline: Fastify + mem-repo, `results` e `env` injetados.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerBlogPublicRoutes, isFronted, signPreview, verifyPreview, previewUrlFor, previewSecret } from "../src/routes.blog-public.js";

const ENV = { BLOG_PUBLIC_URL: "https://leverads.com.br/blog", BLOG_PROXY_TOKEN: "segredo-do-proxy", BLOG_PREVIEW_SECRET: "chave-preview" };
const NOW = new Date("2026-09-20T12:00:00.000Z");
const body = "## Um\n\nTexto {{resRitmo||de verdade}}.\n\n## Dois\n\nMais.\n\n## Três\n\nFim.";

async function setup({ env = ENV, results = () => ({ resRitmo: "R$ 10,4 mil" }), now = () => NOW } = {}) {
  const repo = makeMemRepo();
  const mk = (over) => repo.create("blog_posts", { saas: "leverads", status: "publicado", body, category: "Operação multi-contas", tags: ["contas"], readingMin: 3, wordCount: 600, ...over });
  await mk({ id: "bp_pub", slug: "post-publicado", title: "Post publicado", description: "Desc do publicado", publishedAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-11T12:00:00.000Z" });
  await mk({ id: "bp_pub2", slug: "outro-post", title: "Outro post", category: "Shopee", publishedAt: "2026-09-12T12:00:00.000Z" });
  await mk({ id: "bp_futuro", slug: "post-futuro", title: "Futuro", publishedAt: "2026-09-25T12:00:00.000Z" });
  await mk({ id: "bp_rasc", slug: "post-rascunho", title: "Rascunho", status: "rascunho", publishedAt: "" });
  await mk({ id: "bp_outro_saas", slug: "de-outro-produto", title: "Outro produto", saas: "uniquekids", publishedAt: "2026-09-01T12:00:00.000Z" });
  const app = Fastify();
  registerBlogPublicRoutes(app, repo, { saas: "leverads", results, now, env });
  await app.ready();
  return { app, repo };
}

test("/public/blog → 301 pra /public/blog/", async () => {
  const { app } = await setup();
  const r = await app.inject({ method: "GET", url: "/public/blog" });
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location, "/public/blog/");
  await app.close();
});

test("índice: só publicado com publishedAt <= agora, do produto certo; cache SWR; noindex sem header", async () => {
  const { app } = await setup();
  const r = await app.inject({ method: "GET", url: "/public/blog/" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.equal(r.headers["cache-control"], "public, max-age=300, stale-while-revalidate=3600");
  assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
  assert.match(r.body, /<meta name="robots" content="noindex,nofollow">/);
  assert.ok(r.body.includes("Post publicado") && r.body.includes("Outro post"));
  assert.ok(!r.body.includes("Futuro") && !r.body.includes("Rascunho") && !r.body.includes("Outro produto"));
  // mais novo primeiro
  assert.ok(r.body.indexOf("Outro post") < r.body.indexOf("Post publicado"));
  assert.match(r.body, /<link rel="canonical" href="https:\/\/leverads\.com\.br\/blog">/);
  await app.close();
});

test("header x-blog-proxy correto → indexável, sem x-robots-tag; token errado ou env vazio → noindex", async () => {
  const { app } = await setup();
  const ok = await app.inject({ method: "GET", url: "/public/blog/post-publicado", headers: { "x-blog-proxy": "segredo-do-proxy" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["x-robots-tag"], undefined);
  assert.match(ok.body, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  assert.match(ok.body, /<link rel="canonical" href="https:\/\/leverads\.com\.br\/blog\/post-publicado">/);
  const bad = await app.inject({ method: "GET", url: "/public/blog/post-publicado", headers: { "x-blog-proxy": "outro" } });
  assert.equal(bad.headers["x-robots-tag"], "noindex, nofollow");
  await app.close();
  const { app: semToken } = await setup({ env: { ...ENV, BLOG_PROXY_TOKEN: "" } });
  const r = await semToken.inject({ method: "GET", url: "/public/blog/post-publicado", headers: { "x-blog-proxy": "" } });
  assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
  await semToken.close();
});

test("artigo publicado: 200 com corpo, token substituído, relacionados; rascunho/futuro/outro produto → 404 da marca com max-age=60", async () => {
  const { app } = await setup();
  const r = await app.inject({ method: "GET", url: "/public/blog/post-publicado" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes("<h1>Post publicado</h1>"));
  assert.ok(r.body.includes("Texto R$ 10,4 mil."));
  assert.ok(r.body.includes("Leia também") && r.body.includes("Outro post"));
  for (const slug of ["post-rascunho", "post-futuro", "de-outro-produto", "nao-existe"]) {
    const nf = await app.inject({ method: "GET", url: `/public/blog/${slug}` });
    assert.equal(nf.statusCode, 404, slug);
    assert.equal(nf.headers["cache-control"], "public, max-age=60");
    assert.equal(nf.headers["x-robots-tag"], "noindex");
    assert.ok(nf.body.includes("Página não encontrada"));
  }
  await app.close();
});

test("slug fora do padrão → 404 sem consultar o banco", async () => {
  const { app, repo } = await setup();
  let calls = 0;
  const orig = repo.listWhere.bind(repo);
  repo.listWhere = async (...a) => { calls++; return orig(...a); };
  for (const slug of ["Foo", "a_b", "x".repeat(130), "a--b", "-a"]) {
    const r = await app.inject({ method: "GET", url: `/public/blog/${encodeURIComponent(slug)}` });
    assert.equal(r.statusCode, 404, slug);
  }
  assert.equal(calls, 0);
  await app.close();
});

test("?page: 0, abc, 99 e além do fim → 404; page=1 ok", async () => {
  const { app } = await setup();
  for (const q of ["0", "abc", "99", "2", "1.5", "-1", "01"]) {
    const r = await app.inject({ method: "GET", url: `/public/blog/?page=${q}` });
    assert.equal(r.statusCode, 404, q);
  }
  const ok = await app.inject({ method: "GET", url: "/public/blog/?page=1" });
  assert.equal(ok.statusCode, 200);
  await app.close();
});

test("categoria: 200 pela slug da categoria, 404 pra desconhecida", async () => {
  const { app } = await setup();
  const r = await app.inject({ method: "GET", url: "/public/blog/c/shopee" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes("<h1>Categoria: Shopee</h1>"));
  assert.ok(r.body.includes("Outro post") && !r.body.includes(">Post publicado<"));
  const nf = await app.inject({ method: "GET", url: "/public/blog/c/inexistente" });
  assert.equal(nf.statusCode, 404);
  await app.close();
});

test("sitemap e feed: content-type, só publicados, locs na base pública", async () => {
  const { app } = await setup();
  const s = await app.inject({ method: "GET", url: "/public/blog/sitemap.xml" });
  assert.equal(s.statusCode, 200);
  assert.match(s.headers["content-type"], /application\/xml/);
  assert.ok(s.body.includes("<loc>https://leverads.com.br/blog/post-publicado</loc>"));
  assert.ok(s.body.includes("<loc>https://leverads.com.br/blog/c/shopee</loc>"));
  assert.ok(!s.body.includes("post-futuro") && !s.body.includes("post-rascunho"));
  const f = await app.inject({ method: "GET", url: "/public/blog/feed.xml" });
  assert.equal(f.statusCode, 200);
  assert.match(f.headers["content-type"], /application\/rss\+xml/);
  assert.equal((f.body.match(/<item>/g) || []).length, 2);
  assert.ok(f.body.includes("<description>Desc do publicado</description>"));
  await app.close();
});

test("HEAD do artigo: 200 sem corpo, mesmos headers", async () => {
  const { app } = await setup();
  const r = await app.inject({ method: "HEAD", url: "/public/blog/post-publicado" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, "");
  assert.equal(r.headers["cache-control"], "public, max-age=300, stale-while-revalidate=3600");
  await app.close();
});

test("preview: assinatura válida renderiza o rascunho com faixa, no-store e noindex; sem/expirada/adulterada/outro produto → 404", async () => {
  const { app } = await setup();
  const nowSec = Math.floor(NOW.getTime() / 1000);
  const { url, expiresAt } = previewUrlFor({ base: "https://levermoney.com.br/", id: "bp_rasc", secret: "chave-preview", now: NOW.getTime() });
  assert.ok(url.startsWith("https://levermoney.com.br/public/blog/preview/bp_rasc?exp="));
  assert.equal(expiresAt, new Date((nowSec + 1800) * 1000).toISOString());
  const path = url.replace("https://levermoney.com.br", "");
  const ok = await app.inject({ method: "GET", url: path });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.body.includes("Preview · este post não está publicado"));
  assert.ok(ok.body.includes("<h1>Rascunho</h1>"));
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(ok.headers["x-robots-tag"], "noindex, nofollow");
  assert.match(ok.body, /<meta name="robots" content="noindex,nofollow">/);

  const semSig = await app.inject({ method: "GET", url: "/public/blog/preview/bp_rasc" });
  assert.equal(semSig.statusCode, 404);
  const exp = nowSec + 600;
  const expirada = await app.inject({ method: "GET", url: `/public/blog/preview/bp_rasc?exp=${nowSec - 1}&sig=${signPreview("bp_rasc", nowSec - 1, "chave-preview")}` });
  assert.equal(expirada.statusCode, 404);
  const adulterada = await app.inject({ method: "GET", url: `/public/blog/preview/bp_pub?exp=${exp}&sig=${signPreview("bp_rasc", exp, "chave-preview")}` });
  assert.equal(adulterada.statusCode, 404);
  const outroSaas = await app.inject({ method: "GET", url: `/public/blog/preview/bp_outro_saas?exp=${exp}&sig=${signPreview("bp_outro_saas", exp, "chave-preview")}` });
  assert.equal(outroSaas.statusCode, 404);
  const inexistente = await app.inject({ method: "GET", url: `/public/blog/preview/bp_x?exp=${exp}&sig=${signPreview("bp_x", exp, "chave-preview")}` });
  assert.equal(inexistente.statusCode, 404);
  assert.equal(inexistente.headers["cache-control"], "no-store");
  await app.close();
});

test("verifyPreview/isFronted/previewSecret: unitários", () => {
  const sig = signPreview("id1", 2000, "s");
  assert.equal(verifyPreview({ id: "id1", exp: 2000, sig }, "s", 1999), true);
  assert.equal(verifyPreview({ id: "id1", exp: "2000", sig }, "s", 1999), true);
  assert.equal(verifyPreview({ id: "id1", exp: 2000, sig }, "s", 2000), false);
  assert.equal(verifyPreview({ id: "id1", exp: 2000, sig }, "outra", 1999), false);
  assert.equal(verifyPreview({ id: "id2", exp: 2000, sig }, "s", 1999), false);
  assert.equal(verifyPreview({ id: "id1", exp: "2e3", sig }, "s", 1999), false);
  assert.equal(isFronted({ headers: { "x-blog-proxy": "t" } }, { BLOG_PROXY_TOKEN: "t" }), true);
  assert.equal(isFronted({ headers: { "x-blog-proxy": "t" } }, { BLOG_PROXY_TOKEN: "" }), false);
  assert.equal(isFronted({ headers: {} }, { BLOG_PROXY_TOKEN: "t" }), false);
  assert.equal(previewSecret({ BLOG_PREVIEW_SECRET: "a", COCKPIT_API_KEY: "b" }), "a");
  assert.equal(previewSecret({ COCKPIT_API_KEY: "b" }), "b");
  const rnd = previewSecret({});
  assert.ok(rnd.length >= 32 && rnd === previewSecret({}));
});

test("erro de banco → 404 no-store, nunca 5xx; results que lança não derruba a página", async () => {
  const repo = makeMemRepo();
  repo.listWhere = async () => { throw new Error("db caiu"); };
  const app = Fastify();
  registerBlogPublicRoutes(app, repo, { saas: "leverads", results: () => { throw new Error("x"); }, now: () => NOW, env: ENV });
  const r = await app.inject({ method: "GET", url: "/public/blog/" });
  assert.equal(r.statusCode, 404);
  assert.equal(r.headers["cache-control"], "no-store");
  await app.close();
});

test("CTA vem do rules.ctaUrl do doc de config quando existe e é https", async () => {
  const { app, repo } = await setup();
  await repo.create("app_config", { id: "blog_leverads", rules: { ctaUrl: "https://levermoney.com.br/f/fo_outro" } });
  const r = await app.inject({ method: "GET", url: "/public/blog/post-publicado" });
  assert.ok(r.body.includes("https://levermoney.com.br/f/fo_outro?utm_source=blog"));
  await repo.update("app_config", "blog_leverads", { rules: { ctaUrl: "javascript:alert(1)" } });
  const r2 = await app.inject({ method: "GET", url: "/public/blog/post-publicado" });
  assert.ok(!r2.body.includes("javascript:"));
  assert.ok(r2.body.includes("fo_diagnostico_leverads?utm_source=blog"));
  await app.close();
});
