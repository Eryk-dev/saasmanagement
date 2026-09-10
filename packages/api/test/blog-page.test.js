// Templates do blog público: head SEO, JSON-LD, CTA com UTM, índice, sitemap,
// feed e 404. Tudo sobre uma base configurável, nunca o host da request.
import test from "node:test";
import assert from "node:assert/strict";
import {
  blogConfig, seoTitle, ctaUrl, categorySlug, relatedPosts, blogArticleHtml, blogIndexHtml,
  blogNotFoundHtml, blogSitemapXml, blogFeedXml, BLOG_DEFAULT_OG,
} from "../src/blog-page.js";

const cfg = blogConfig({ BLOG_PUBLIC_URL: "https://exemplo.com.br/blog/" });
const post = {
  id: "bp_1", slug: "como-vender-em-varias-contas", title: "Como vender em várias contas no Mercado Livre",
  description: "Um guia direto pra operar mais de uma conta sem virar refém da rotina.",
  body: "## Por que uma conta só trava\n\nTexto {{resRitmo||de verdade}}.\n\n## O que muda com duas\n\nMais.\n\n## Como começar\n\nFim.",
  category: "Operação multi-contas", tags: ["mercado livre", "contas"], keyword: "vender em várias contas",
  faq: [{ q: "Precisa de CNPJ novo?", a: "Depende do marketplace." }], author: "Equipe LeverAds",
  publishedAt: "2026-09-15T12:00:00.000Z", updatedAt: "2026-09-16T12:00:00.000Z", readingMin: 4, wordCount: 800,
};
const ldOf = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "JSON-LD ausente");
  return JSON.parse(m[1]);
};

test("blogConfig: base sem barra final, siteUrl = origin, form default", () => {
  assert.equal(cfg.base, "https://exemplo.com.br/blog");
  assert.equal(cfg.siteUrl, "https://exemplo.com.br");
  assert.match(cfg.formUrl, /fo_diagnostico_leverads$/);
  assert.equal(blogConfig({}).base, "https://leverads.com.br/blog");
});

test("seoTitle: sufixo só quando cabe em 60; ctaUrl carrega as 4 UTMs; categorySlug", () => {
  assert.equal(seoTitle("Curto"), "Curto · Blog LeverAds");
  const longo = "Um título bem comprido que passa de sessenta caracteres fácil";
  assert.equal(seoTitle(longo), longo);
  const u = ctaUrl(cfg, "meu-post");
  assert.ok(u.startsWith(cfg.formUrl + "?"));
  for (const p of ["utm_source=blog", "utm_medium=organic", "utm_campaign=blog", "utm_content=meu-post"]) assert.ok(u.includes(p), u);
  assert.ok(ctaUrl({ formUrl: "https://x.com/f?a=1" }, "s").includes("?a=1&utm_source=blog"));
  assert.ok(ctaUrl(cfg, "s", "https://override.com/f").startsWith("https://override.com/f?utm_source=blog"));
  assert.equal(categorySlug("Operação multi-contas"), "operacao-multi-contas");
});

test("relatedPosts: mesma categoria primeiro, depois tags, sem o próprio, máximo 3", () => {
  const all = [
    post,
    { id: "a", slug: "a", category: "Shopee", tags: ["contas"], publishedAt: "2026-01-01" },
    { id: "b", slug: "b", category: "Operação multi-contas", tags: [], publishedAt: "2026-02-01" },
    { id: "c", slug: "c", category: "Operação multi-contas", tags: ["mercado livre", "contas"], publishedAt: "2026-01-15" },
    { id: "d", slug: "d", category: "Autopeças", tags: [], publishedAt: "2026-03-01" },
    { id: "e", slug: "e", category: "Autopeças", tags: ["contas"], publishedAt: "2026-04-01" },
  ];
  assert.deepEqual(relatedPosts(post, all).map((p) => p.slug), ["c", "b", "e"]);
});

test("artigo: head SEO completo, canonical na base configurada, robots por fronted", () => {
  const html = blogArticleHtml(post, { cfg, fronted: true, tokens: { resRitmo: "R$ 10,4 mil" } });
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /<title>Como vender em várias contas no Mercado Livre<\/title>/); // 47 chars + sufixo passaria de 60
  assert.match(html, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog\/como-vender-em-varias-contas">/);
  assert.match(html, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">/);
  assert.match(html, /<meta property="og:type" content="article">/);
  assert.match(html, /<meta property="article:published_time" content="2026-09-15T12:00:00.000Z">/);
  assert.match(html, /<meta property="article:modified_time" content="2026-09-16T12:00:00.000Z">/);
  assert.match(html, /<meta property="article:section" content="Operação multi-contas">/);
  assert.match(html, /<meta property="article:tag" content="mercado livre">/);
  assert.ok(html.includes(`<meta property="og:image" content="${BLOG_DEFAULT_OG}">`));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<link rel="alternate" type="application\/rss\+xml" title="Blog LeverAds" href="https:\/\/exemplo\.com\.br\/blog\/feed\.xml">/);
  const noindex = blogArticleHtml(post, { cfg, fronted: false });
  assert.match(noindex, /<meta name="robots" content="noindex,nofollow">/);
});

test("artigo: JSON-LD parseável com BlogPosting, Organization (@id do site), BreadcrumbList e FAQPage só com faq", () => {
  const ld = ldOf(blogArticleHtml(post, { cfg, fronted: true }));
  const types = ld["@graph"].map((g) => g["@type"]);
  assert.deepEqual(types, ["BlogPosting", "Organization", "BreadcrumbList", "FAQPage"]);
  const [bp, org, bc, faq] = ld["@graph"];
  assert.equal(bp.headline, post.title);
  assert.equal(bp.datePublished, post.publishedAt);
  assert.equal(bp.dateModified, post.updatedAt);
  assert.equal(bp.timeRequired, "PT4M");
  assert.equal(bp.wordCount, 800);
  assert.equal(bp.author["@type"], "Organization");
  assert.equal(bp.publisher["@id"], "https://leverads.com.br/#organization");
  assert.equal(org["@id"], "https://leverads.com.br/#organization");
  assert.equal(bc.itemListElement.length, 4);
  assert.equal(bc.itemListElement[2].item, "https://exemplo.com.br/blog/c/operacao-multi-contas");
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, "Depende do marketplace.");
  const semFaq = ldOf(blogArticleHtml({ ...post, faq: [], author: "Leonardo" }, { cfg }));
  assert.ok(!semFaq["@graph"].some((g) => g["@type"] === "FAQPage"));
  assert.equal(semFaq["@graph"][0].author["@type"], "Person");
});

test("artigo: corpo renderizado, sumário com 3 h2, CTA com utm_content do slug, linha de prova só com token, FAQ em details, relacionados ≤ 3 sem o próprio", () => {
  const rel = [post, { id: "r1", slug: "r1", title: "R1", category: "Shopee", publishedAt: "2026-01-01" }, { id: "r2", slug: "r2", title: "R2" }, { id: "r3", slug: "r3", title: "R3" }, { id: "r4", slug: "r4", title: "R4" }];
  const html = blogArticleHtml(post, { cfg, fronted: true, related: rel, tokens: { resRitmo: "R$ 10,4 mil" } });
  assert.match(html, /<h1>Como vender em várias contas no Mercado Livre<\/h1>/);
  assert.match(html, /<h2 id="por-que-uma-conta-so-trava">/);
  assert.match(html, /<p>Texto R\$ 10,4 mil\.<\/p>/);
  assert.match(html, /<nav class="bl-toc"[^>]*>.*<a href="#como-comecar">Como começar<\/a>/s);
  assert.ok(html.includes("utm_content=como-vender-em-varias-contas"));
  assert.ok(html.includes("Na mediana, um cliente vende R$ 10,4 mil por mês"));
  // CTA entra antes do 3º h2 (depois da seção do 2º)
  const ctaAt = html.indexOf('<aside class="bl-cta">');
  assert.ok(ctaAt > html.indexOf('<h2 id="o-que-muda-com-duas">') && ctaAt < html.indexOf('<h2 id="como-comecar">'));
  assert.match(html, /<details><summary>Precisa de CNPJ novo\?<\/summary><p>Depende do marketplace\.<\/p><\/details>/);
  const cards = html.slice(html.indexOf('class="bl-related"')).match(/<article class="bl-card">/g) || [];
  assert.equal(cards.length, 3);
  const relSec = html.slice(html.indexOf('class="bl-related"'), html.indexOf("</section>", html.indexOf('class="bl-related"')));
  assert.ok(!relSec.includes('href="https://exemplo.com.br/blog/como-vender-em-varias-contas"'), "relacionados não podem repetir o próprio post");
  assert.ok(html.includes("CNPJ 67.931.740/0001-12"));
  const semToken = blogArticleHtml(post, { cfg, tokens: {} });
  assert.ok(!semToken.includes("Na mediana"));
  assert.match(semToken, /<p>Texto de verdade\.<\/p>/);
});

test("artigo: description cai no texto do corpo quando vazia; sem travessão nem R$ no cromo", () => {
  const html = blogArticleHtml({ ...post, description: "", faq: [] }, { cfg, tokens: {} });
  assert.match(html, /<meta name="description" content="Por que uma conta só trava Texto de verdade\. O que muda com duas Mais\. Como começar Fim\.">/);
  assert.ok(!html.includes("—"), "travessão no template");
  assert.ok(!html.includes("R$"), "preço no template");
  const vazio = blogArticleHtml({ slug: "x", title: "T", body: "" }, { cfg });
  assert.ok(vazio.includes("<h1>T</h1>"));
});

test("índice: canonical, prev/next, JSON-LD Blog + breadcrumb, cards, chips, paginação", () => {
  const posts = [post, { ...post, id: "p2", slug: "segundo", title: "Segundo", category: "Shopee" }];
  const html = blogIndexHtml({ cfg, fronted: true, posts, page: 2, pageCount: 3, categories: ["Operação multi-contas", "Shopee"] });
  assert.match(html, /<title>Blog LeverAds · Mercado Livre e Shopee com várias contas · página 2<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog\?page=2">/);
  assert.match(html, /<link rel="prev" href="https:\/\/exemplo\.com\.br\/blog">/);
  assert.match(html, /<link rel="next" href="https:\/\/exemplo\.com\.br\/blog\?page=3">/);
  const ld = ldOf(html);
  assert.equal(ld["@graph"][0]["@type"], "Blog");
  assert.equal(ld["@graph"][0]["@id"], "https://exemplo.com.br/blog#blog");
  assert.equal(ld["@graph"][2]["@type"], "BreadcrumbList");
  assert.equal((html.match(/<article class="bl-card">/g) || []).length, 2);
  assert.match(html, /<a class="bl-chip" href="https:\/\/exemplo\.com\.br\/blog\/c\/shopee">Shopee<\/a>/);
  assert.match(html, /rel="prev">Mais recentes<\/a>/);
  assert.match(html, /rel="next">Mais antigos<\/a>/);
  assert.match(html, /<meta property="og:type" content="website">/);
  const p1 = blogIndexHtml({ cfg, posts: [], page: 1, pageCount: 1 });
  assert.match(p1, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog">/);
  assert.ok(!p1.includes('rel="prev"') && !p1.includes('rel="next"'));
  assert.ok(p1.includes("Os primeiros artigos estão a caminho."));
});

test("categoria: H1, canonical própria, CollectionPage + breadcrumb com a categoria", () => {
  const html = blogIndexHtml({ cfg, fronted: true, posts: [post], page: 1, pageCount: 1, categories: ["Operação multi-contas"], category: "Operação multi-contas" });
  assert.match(html, /<h1>Categoria: Operação multi-contas<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/exemplo\.com\.br\/blog\/c\/operacao-multi-contas">/);
  const ld = ldOf(html);
  assert.equal(ld["@graph"][0]["@type"], "CollectionPage");
  assert.equal(ld["@graph"][2].itemListElement.length, 3);
  assert.match(html, /<a class="bl-chip is-on" href="https:\/\/exemplo\.com\.br\/blog\/c\/operacao-multi-contas">/);
});

test("404: noindex, título próprio e link pro índice", () => {
  const html = blogNotFoundHtml({ cfg });
  assert.match(html, /<title>Página não encontrada · Blog LeverAds<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.ok(html.includes('href="https://exemplo.com.br/blog">Ver todos os artigos'));
});

test("sitemap: índice, categorias e posts na base configurada, com lastmod", () => {
  const xml = blogSitemapXml({ cfg, posts: [post, { ...post, id: "p2", slug: "segundo", category: "Shopee", updatedAt: "2026-09-20T00:00:00.000Z" }] });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<loc>https://exemplo.com.br/blog</loc><lastmod>2026-09-20</lastmod>"));
  assert.ok(xml.includes("<loc>https://exemplo.com.br/blog/c/operacao-multi-contas</loc><lastmod>2026-09-16</lastmod>"));
  assert.ok(xml.includes("<loc>https://exemplo.com.br/blog/c/shopee</loc>"));
  assert.ok(xml.includes("<loc>https://exemplo.com.br/blog/como-vender-em-varias-contas</loc><lastmod>2026-09-16</lastmod>"));
  assert.ok(xml.includes("<loc>https://exemplo.com.br/blog/segundo</loc>"));
});

test("feed: RSS 2.0 com self link, no máximo 20 itens, pubDate RFC 822 e description escapada", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ ...post, id: `p${i}`, slug: `post-${i}`, title: `Post ${i} <b>`, description: "", body: "Corpo & tal", publishedAt: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z` }));
  const xml = blogFeedXml({ cfg, posts: many });
  assert.ok(xml.includes('<atom:link href="https://exemplo.com.br/blog/feed.xml" rel="self" type="application/rss+xml"/>'));
  assert.equal((xml.match(/<item>/g) || []).length, 20);
  assert.ok(xml.includes("<title>Post 0 &lt;b&gt;</title>"));
  assert.ok(xml.includes("<description>Corpo &amp; tal</description>"));
  assert.match(xml, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} 2026 10:00:00 GMT<\/pubDate>/);
  assert.ok(xml.includes("<language>pt-BR</language>"));
});
