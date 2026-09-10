// Superfície PÚBLICA do blog: /public/blog/* (prefixo aberto em index.js).
//
// O copylever faz proxy de https://leverads.com.br/blog/* pra cá mandando o
// header `x-blog-proxy: <BLOG_PROXY_TOKEN>`. Só essa request recebe HTML
// indexável; pedido direto no host do cockpit sai noindex,nofollow (meta +
// X-Robots-Tag) e com canonical em leverads.com.br, então expor por aqui não
// duplica conteúdo. Token vazio = NADA indexável (falha segura).
//
// Nunca 5xx (o proxy do EasyPanel troca o corpo): erro de banco vira 404 da
// marca com no-store + warn no log.
//
// Preview de post NÃO publicado: link assinado (HMAC, 30 min) cunhado pela rota
// autenticada /api/blog/:saas/posts/:id/preview-url (routes.blog.js) usando
// previewUrlFor(). Qualquer falha na verificação devolve o MESMO 404 de slug
// inexistente (nunca 401: não revela que o post existe).

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { listPublished, getPublishedBySlug, toPublicPost } from "./blog-posts.js";
import { leveradsResults } from "./leverads-results.js";
import {
  blogConfig, blogArticleHtml, blogIndexHtml, blogNotFoundHtml, blogSitemapXml, blogFeedXml,
  categorySlug, relatedPosts, PAGE_SIZE,
} from "./blog-page.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE_RE = /^[1-9][0-9]{0,2}$/;
const CACHE_OK = "public, max-age=300, stale-while-revalidate=3600";
const CACHE_404 = "public, max-age=60";
const PREVIEW_TTL_SEC = 30 * 60;

// ── fronted / preview ────────────────────────────────────────────────────────
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

// true só quando o token está configurado E a request trouxe o mesmo valor.
export function isFronted(req, env = process.env) {
  const token = String(env.BLOG_PROXY_TOKEN || "").trim();
  if (!token) return false;
  const h = req?.headers?.["x-blog-proxy"];
  const got = Array.isArray(h) ? h[0] : h;
  return safeEqual(got, token);
}

let processSecret = "";
export function previewSecret(env = process.env) {
  const s = String(env.BLOG_PREVIEW_SECRET || env.COCKPIT_API_KEY || "").trim();
  if (s) return s;
  if (!processSecret) processSecret = randomBytes(32).toString("hex"); // dev sem chave: vale só neste processo
  return processSecret;
}

export function signPreview(id, exp, secret) {
  return createHmac("sha256", String(secret)).update(`${id}.${exp}`).digest("base64url");
}

export function verifyPreview({ id, exp, sig } = {}, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!id || !sig || !secret) return false;
  if (!/^\d{1,12}$/.test(String(exp))) return false;
  const expN = Number(exp);
  if (!Number.isInteger(expN) || expN <= nowSec) return false;
  return safeEqual(sig, signPreview(id, expN, secret));
}

// `base` = host público do COCKPIT (publicBase(req) em routes.js), não o do blog.
export function previewUrlFor({ base, id, secret, now = Date.now(), ttlSec = PREVIEW_TTL_SEC } = {}) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = signPreview(id, exp, secret);
  const root = String(base || "").replace(/\/+$/, "");
  return { url: `${root}/public/blog/preview/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

// ── rotas ────────────────────────────────────────────────────────────────────
export function registerBlogPublicRoutes(app, repo, { saas = "leverads", results = leveradsResults, now = () => new Date(), env = process.env } = {}) {
  const cfg = () => blogConfig(env);
  const tokensNow = () => {
    let t = null;
    try { t = typeof results === "function" ? results() : results; } catch { t = null; }
    return { ...(t && typeof t === "object" ? t : {}), year: String(now().getFullYear()) };
  };
  // O CTA é conteúdo (rules.ctaUrl no doc de config do blog, editável na tela);
  // a base pública é infra (env). Fail-soft: sem doc/valor inválido, cai no env.
  const ctaOverride = async () => {
    try {
      const doc = await repo.get("app_config", `blog_${saas}`);
      const u = String(doc?.rules?.ctaUrl || "").trim();
      return /^https:\/\//i.test(u) ? u : "";
    } catch { return ""; }
  };
  const publishedNow = async () => {
    const cutoff = now().toISOString();
    return (await listPublished(repo, saas)).filter((p) => !p.publishedAt || p.publishedAt <= cutoff);
  };
  const send = (reply, html, { fronted, status = 200, cache = CACHE_OK, robots = !fronted }) => {
    reply.code(status).type("text/html; charset=utf-8").header("cache-control", cache);
    if (robots) reply.header("x-robots-tag", status === 200 ? "noindex, nofollow" : "noindex");
    return reply.send(html);
  };
  const notFound = (reply, { cache = CACHE_404 } = {}) =>
    send(reply, blogNotFoundHtml({ cfg: cfg() }), { fronted: false, status: 404, cache, robots: true });
  const guard = (handler) => async (req, reply) => {
    try { return await handler(req, reply); } catch (err) {
      req.log?.warn?.({ err: err?.message || String(err), url: req.url }, "blog público falhou");
      return notFound(reply, { cache: "no-store" });
    }
  };
  const pageOf = (q) => {
    if (q === undefined || q === null || q === "") return 1;
    const s = Array.isArray(q) ? q[0] : String(q);
    return PAGE_RE.test(s) ? Number(s) : 0;
  };
  const paginate = (posts, page) => {
    const pageCount = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
    if (page < 1 || page > pageCount) return null;
    return { slice: posts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), pageCount };
  };

  app.get("/public/blog", async (_req, reply) => reply.redirect("/public/blog/", 301));

  app.get("/public/blog/", guard(async (req, reply) => {
    const page = pageOf(req.query?.page);
    if (!page) return notFound(reply);
    const posts = await publishedNow();
    const pg = paginate(posts, page);
    if (!pg) return notFound(reply);
    const fronted = isFronted(req, env);
    const html = blogIndexHtml({ cfg: cfg(), fronted, posts: pg.slice, page, pageCount: pg.pageCount, categories: [...new Set(posts.map((p) => p.category).filter(Boolean))], tokens: tokensNow(), ctaUrl: await ctaOverride() });
    return send(reply, html, { fronted });
  }));

  app.get("/public/blog/sitemap.xml", guard(async (req, reply) => {
    const posts = await publishedNow();
    const xml = blogSitemapXml({ cfg: cfg(), posts });
    reply.type("application/xml; charset=utf-8").header("cache-control", CACHE_OK);
    if (!isFronted(req, env)) reply.header("x-robots-tag", "noindex, nofollow");
    return reply.send(xml);
  }));

  app.get("/public/blog/feed.xml", guard(async (req, reply) => {
    const posts = await publishedNow();
    const xml = blogFeedXml({ cfg: cfg(), posts, tokens: tokensNow() });
    reply.type("application/rss+xml; charset=utf-8").header("cache-control", CACHE_OK);
    if (!isFronted(req, env)) reply.header("x-robots-tag", "noindex, nofollow");
    return reply.send(xml);
  }));

  app.get("/public/blog/c/:category", guard(async (req, reply) => {
    const key = String(req.params.category || "");
    if (!SLUG_RE.test(key) || key.length > 120) return notFound(reply);
    const page = pageOf(req.query?.page);
    if (!page) return notFound(reply);
    const all = await publishedNow();
    const label = [...new Set(all.map((p) => p.category).filter(Boolean))].find((k) => categorySlug(k) === key);
    if (!label) return notFound(reply);
    const posts = all.filter((p) => p.category === label);
    const pg = paginate(posts, page);
    if (!pg) return notFound(reply);
    const fronted = isFronted(req, env);
    const html = blogIndexHtml({ cfg: cfg(), fronted, posts: pg.slice, page, pageCount: pg.pageCount, categories: [...new Set(all.map((p) => p.category).filter(Boolean))], category: label, tokens: tokensNow(), ctaUrl: await ctaOverride() });
    return send(reply, html, { fronted });
  }));

  app.get("/public/blog/preview/:id", guard(async (req, reply) => {
    const id = String(req.params.id || "");
    const ok = verifyPreview({ id, exp: req.query?.exp, sig: req.query?.sig }, previewSecret(env), Math.floor(now().getTime() / 1000));
    if (!ok || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return notFound(reply, { cache: "no-store" });
    const doc = await repo.get("blog_posts", id);
    if (!doc || doc.saas !== saas) return notFound(reply, { cache: "no-store" });
    const post = toPublicPost(doc);
    const html = blogArticleHtml(post, { cfg: cfg(), fronted: false, previewBanner: true, related: [], tokens: tokensNow(), ctaUrl: await ctaOverride() });
    return send(reply, html, { fronted: false, cache: "no-store", robots: true });
  }));

  app.get("/public/blog/:slug", guard(async (req, reply) => {
    const slug = String(req.params.slug || "");
    if (!SLUG_RE.test(slug) || slug.length > 120) return notFound(reply);
    const post = await getPublishedBySlug(repo, saas, slug);
    if (!post || (post.publishedAt && post.publishedAt > now().toISOString())) return notFound(reply);
    const all = await publishedNow();
    const fronted = isFronted(req, env);
    const html = blogArticleHtml(post, { cfg: cfg(), fronted, related: relatedPosts(post, all, 3), tokens: tokensNow(), ctaUrl: await ctaOverride() });
    return send(reply, html, { fronted });
  }));
}
