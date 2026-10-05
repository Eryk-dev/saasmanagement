// Páginas públicas do blog (índice, categoria, artigo, 404, sitemap, feed).
// Server-rendered puro, sem client script, tema claro sempre. Servido em
// /public/blog/* (routes.blog-public.js) e exposto em leverads.com.br/blog
// pelo proxy do copylever; por isso TODA URL absoluta (canonical, OG, sitemap,
// links internos) sai de `cfg.base` (env BLOG_PUBLIC_URL), nunca do host da
// request.
//
// Visual: os tokens abaixo foram copiados de copylever
// frontend/src/styles/home.css (seletor main.hm, Lever Premium). Mudou lá,
// muda aqui. Namespace `bl-*` pra não colidir com nada.
//
// Copy do cromo: sem travessão e sem preço (regras de copy do Leo).

import { esc, escJson, slugify, renderMarkdown, plainText, substituteTokens, countWords, readingMinutes } from "./blog-markdown.js";

export const BLOG_DEFAULT_OG = "https://leverads.com.br/og-leverads.png";
const SITE_NAME = "LeverAds";
const BLOG_NAME = "Blog LeverAds";
const LOGO = "https://leverads.com.br/logo-lever-light.svg";
const LOGO_LD = "https://leverads.com.br/logo-lever.svg"; // mesmo do index.html do copylever
const FAVICON = "https://leverads.com.br/favicon.svg";
const ORG_ID = "https://leverads.com.br/#organization"; // MESMO @id do index.html do copylever: o Google funde a entidade
const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";
const DEFAULT_FORM = "https://levermoney.com.br/f/fo_diagnostico_leverads";
export const PAGE_SIZE = 12;
const FEED_SIZE = 20;

export function blogConfig(env = process.env) {
  const base = String(env.BLOG_PUBLIC_URL || "https://leverads.com.br/blog").trim().replace(/\/+$/, "");
  let siteUrl = "https://leverads.com.br";
  try { siteUrl = new URL(base).origin; } catch { /* base inválida: fica o default */ }
  const formUrl = String(env.BLOG_FORM_URL || DEFAULT_FORM).trim() || DEFAULT_FORM;
  return { base, siteUrl, formUrl, saas: String(env.BLOG_SAAS || "leverads") };
}

// Sufixo entra só se o título inteiro couber em 60 (nunca trunca: o Google faz).
export function seoTitle(title) {
  const t = String(title || "").trim() || BLOG_NAME;
  const full = `${t} · ${BLOG_NAME}`;
  return full.length <= 60 ? full : t;
}

// CTA dos posts: o form de diagnóstico com as 4 UTMs (utm_source=blog é o que
// vira origem "Blog" no cockpit, metrics-core.js leadOrigin).
export function ctaUrl(cfg, slug = "", override = "") {
  const target = String(override || cfg?.formUrl || DEFAULT_FORM).trim();
  const sep = target.includes("?") ? "&" : "?";
  const utm = ["utm_source=blog", "utm_medium=organic", "utm_campaign=blog"];
  if (slug) utm.push(`utm_content=${encodeURIComponent(slug)}`);
  return `${target}${sep}${utm.join("&")}`;
}

export const categorySlug = (label) => slugify(label);

// Mesma categoria primeiro, depois sobreposição de tags, depois o mais novo.
export function relatedPosts(post, all = [], n = 3) {
  const tags = new Set((post?.tags || []).map((t) => String(t).toLowerCase()));
  return (all || [])
    .filter((p) => p && p.slug && p.slug !== post?.slug && p.id !== post?.id)
    .map((p) => {
      const overlap = (p.tags || []).filter((t) => tags.has(String(t).toLowerCase())).length;
      const score = (p.category && p.category === post?.category ? 10 : 0) + overlap;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score || String(b.p.publishedAt || "").localeCompare(String(a.p.publishedAt || "")))
    .slice(0, n)
    .map((x) => x.p);
}

// ── helpers ──────────────────────────────────────────────────────────────────
const validDate = (iso) => { const d = new Date(iso || ""); return Number.isFinite(d.getTime()) ? d : null; };
export const fmtDate = (iso) => {
  const d = validDate(iso);
  return d ? d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }) : "";
};
const isoDate = (iso) => { const d = validDate(iso); return d ? d.toISOString() : ""; };
const rfc822 = (iso) => { const d = validDate(iso); return d ? d.toUTCString() : ""; };
const postUrl = (cfg, p) => `${cfg.base}/${encodeURIComponent(p.slug)}`;
const catUrl = (cfg, label) => `${cfg.base}/c/${categorySlug(label)}`;
const pageUrl = (cfg, page, category) => {
  const root = category ? catUrl(cfg, category) : cfg.base;
  return page > 1 ? `${root}?page=${page}` : root;
};
const uniqueCategories = (posts) => [...new Set((posts || []).map((p) => p.category).filter(Boolean))];

function robotsMeta(fronted) {
  return fronted
    ? '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">'
    : '<meta name="robots" content="noindex,nofollow">';
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
/* Tokens copiados de copylever frontend/src/styles/home.css (main.hm). Mudou lá, muda aqui. */
.bl{--paper:#F7F8FA;--paper-card:#FFFFFF;--paper-tinted:#EEF1F3;--paper-subtle:#FBFCFD;--ink:#0C1D2B;--ink-soft:#3D4F5C;--ink-muted:#5A6B77;--ink-faint:#8B99A4;--line:#E4E8EB;--line-strong:#CBD4DA;--line-faint:#EEF1F3;--brand:#0F766E;--brand-deep:#0B5D57;--brand-soft:#E9F5F3;--success:#177A4C;--info:#175CD3;--info-soft:#EDF3FC;--btn-primary-bg:var(--ink);--btn-primary-bg-hover:#1B3140;--btn-primary-text:#FFFFFF;--font-sans:'Instrument Sans',-apple-system,'Segoe UI',sans-serif;--font-mono:'JetBrains Mono',monospace;--text-badge:11px;--text-meta:12.5px;--text-dense:13px;--text-control:13.5px;--text-body:14px;--text-body-lg:14.5px;--text-card-title:15.5px;--weight-regular:400;--weight-medium:500;--weight-semibold:600;--weight-bold:700;--tracking-title:-0.02em;--tracking-card:-0.01em;--radius-card:12px;--radius-inner:10px;--radius-control:8px;--radius-badge:5px;--radius-pill:999px;--shadow-card:0 1px 2px rgba(16,24,40,.03);--shadow-btn:0 1px 2px rgba(16,24,40,.1);--transition-ui:background .12s,border-color .12s,color .12s;--bl-max:1120px;--bl-measure:720px;--bl-gutter:clamp(20px,5vw,40px);--bl-h1:clamp(30px,4.6vw,44px);--bl-h2:clamp(22px,3vw,26px)}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}
.bl{background:var(--paper);color:var(--ink);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column}
.bl a{color:var(--brand);text-decoration:none}
.bl a:hover{color:var(--brand-deep);text-decoration:underline}
.bl-wrap{width:100%;max-width:var(--bl-max);margin:0 auto;padding:0 var(--bl-gutter)}
.bl-measure{max-width:var(--bl-measure);margin-left:auto;margin-right:auto}
.bl-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:var(--radius-control);font-size:var(--text-control);font-weight:var(--weight-semibold);border:1px solid var(--line-strong);background:var(--paper-card);color:var(--ink);box-shadow:var(--shadow-btn);transition:var(--transition-ui);white-space:nowrap}
.bl-btn:hover{text-decoration:none;border-color:var(--ink-faint);color:var(--ink)}
.bl-btn--primary{background:var(--btn-primary-bg);border-color:var(--btn-primary-bg);color:var(--btn-primary-text)}
.bl-btn--primary:hover{background:var(--btn-primary-bg-hover);border-color:var(--btn-primary-bg-hover);color:var(--btn-primary-text)}
.bl-nav{position:sticky;top:0;z-index:5;background:rgba(247,248,250,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bl-nav .bl-wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:64px}
.bl-brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-weight:var(--weight-bold);font-size:16px;letter-spacing:var(--tracking-card)}
.bl-brand:hover{text-decoration:none;color:var(--ink)}
.bl-brand img{height:26px;width:auto;display:block}
.bl-nav-links{display:flex;align-items:center;gap:18px}
.bl-nav-links a{color:var(--ink-soft);font-size:var(--text-body-lg);font-weight:var(--weight-medium)}
.bl-nav-links a:hover{color:var(--ink)}
.bl-main{flex:1;padding:40px 0 64px}
.bl-kicker{display:inline-block;font-size:var(--text-badge);font-weight:var(--weight-semibold);letter-spacing:.08em;text-transform:uppercase;color:var(--brand);background:var(--brand-soft);border-radius:var(--radius-badge);padding:4px 8px}
.bl-kicker:hover{text-decoration:none;background:#DDEFEC}
.bl-hero h1,.bl-article h1{font-size:var(--bl-h1);line-height:1.12;letter-spacing:var(--tracking-title);font-weight:var(--weight-bold);margin:14px 0 12px}
.bl-hero p{font-size:clamp(15px,1.7vw,18px);color:var(--ink-soft);max-width:640px;margin:0}
.bl-meta{color:var(--ink-muted);font-size:var(--text-meta);margin:0 0 28px}
.bl-chips{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 32px}
.bl-chip{font-size:var(--text-dense);font-weight:var(--weight-medium);color:var(--ink-soft);background:var(--paper-card);border:1px solid var(--line);border-radius:var(--radius-pill);padding:6px 12px}
.bl-chip:hover,.bl-chip.is-on{text-decoration:none;border-color:var(--brand);color:var(--brand)}
.bl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:18px}
.bl-card{display:flex;flex-direction:column;gap:10px;background:var(--paper-card);border:1px solid var(--line);border-radius:var(--radius-card);padding:20px;box-shadow:var(--shadow-card)}
.bl-card h2,.bl-card h3{font-size:18px;line-height:1.3;letter-spacing:var(--tracking-card);margin:0}
.bl-card h2 a,.bl-card h3 a{color:var(--ink)}
.bl-card p{margin:0;color:var(--ink-soft);font-size:var(--text-body-lg);line-height:1.55}
.bl-card .bl-meta{margin:auto 0 0}
.bl-empty{color:var(--ink-muted);padding:40px 0}
.bl-pager{display:flex;justify-content:space-between;gap:12px;margin-top:32px}
.bl-toc{background:var(--paper-card);border:1px solid var(--line);border-radius:var(--radius-card);padding:16px 20px;margin:0 0 28px}
.bl-toc strong{display:block;font-size:var(--text-badge);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:8px}
.bl-toc ol{margin:0;padding-left:18px;font-size:var(--text-body-lg)}
.bl-toc li{margin:4px 0}
.bl-body{font-size:17px;line-height:1.7;color:var(--ink)}
.bl-body h2{font-size:var(--bl-h2);line-height:1.25;letter-spacing:var(--tracking-title);margin:40px 0 14px;scroll-margin-top:84px}
.bl-body h3{font-size:19px;line-height:1.3;margin:28px 0 10px;scroll-margin-top:84px}
.bl-body h4{font-size:17px;margin:22px 0 8px}
.bl-body p{margin:0 0 18px}
.bl-body ul,.bl-body ol{margin:0 0 18px;padding-left:24px}
.bl-body li{margin:6px 0}
.bl-body blockquote{margin:0 0 18px;padding:4px 0 4px 18px;border-left:3px solid var(--brand);color:var(--ink-soft)}
.bl-body blockquote p:last-child{margin-bottom:0}
.bl-body hr{border:0;border-top:1px solid var(--line);margin:32px 0}
.bl-body code{font-family:var(--font-mono);font-size:.9em;background:var(--paper-tinted);border-radius:var(--radius-badge);padding:1px 5px}
.bl-body pre{background:var(--ink);color:#F3FBFF;border-radius:var(--radius-inner);padding:16px 18px;overflow-x:auto;font-size:14px;line-height:1.5;margin:0 0 18px}
.bl-body pre code{background:none;padding:0;color:inherit}
.bl-cta{background:var(--ink);color:#FFFFFF;border-radius:var(--radius-card);padding:28px 28px;margin:36px 0}
.bl-cta h2{font-size:22px;line-height:1.25;margin:0 0 8px;letter-spacing:var(--tracking-title)}
.bl-cta p{margin:0 0 16px;color:#C9D4DC;font-size:var(--text-body-lg);line-height:1.55}
.bl-cta .bl-proof{font-size:var(--text-meta);color:#9FB2BF;margin-top:14px;margin-bottom:0}
.bl-cta .bl-btn--primary{background:#FFFFFF;border-color:#FFFFFF;color:var(--ink)}
.bl-cta .bl-btn--primary:hover{background:#E9F5F3;border-color:#E9F5F3;color:var(--ink)}
.bl-faq{margin:40px 0 0}
.bl-faq h2{font-size:var(--bl-h2);letter-spacing:var(--tracking-title);margin:0 0 14px}
.bl-faq details{background:var(--paper-card);border:1px solid var(--line);border-radius:var(--radius-inner);padding:0 18px;margin:0 0 10px}
.bl-faq summary{cursor:pointer;font-weight:var(--weight-semibold);padding:14px 0;font-size:var(--text-card-title);list-style:none;display:flex;justify-content:space-between;gap:12px}
.bl-faq summary::-webkit-details-marker{display:none}
.bl-faq summary::after{content:"+";color:var(--ink-faint);font-weight:var(--weight-regular)}
.bl-faq details[open] summary::after{content:"·"}
.bl-faq details p{margin:0 0 14px;color:var(--ink-soft);line-height:1.6;font-size:var(--text-body-lg)}
.bl-related{margin:48px 0 0}
.bl-related h2{font-size:var(--bl-h2);letter-spacing:var(--tracking-title);margin:0 0 16px}
.bl-preview{background:#FFF4D6;color:#5C4300;text-align:center;font-size:var(--text-dense);font-weight:var(--weight-semibold);padding:8px 12px;border-bottom:1px solid #F1DFA6}
.bl-footer{border-top:1px solid var(--line);background:var(--paper-card);padding:40px 0 28px;font-size:var(--text-body-lg)}
.bl-footer-top{display:grid;grid-template-columns:2fr 1fr 1fr;gap:32px}
.bl-footer-about p{color:var(--ink-soft);line-height:1.55;max-width:420px;margin:12px 0 0}
.bl-footer-col h4{margin:0 0 10px;font-size:var(--text-badge);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted)}
.bl-footer-col ul{list-style:none;margin:0;padding:0}
.bl-footer-col li{margin:6px 0}
.bl-footer-col a{color:var(--ink-soft)}
.bl-footer-legal{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:32px;padding-top:18px;border-top:1px solid var(--line-faint);color:var(--ink-muted);font-size:var(--text-meta)}
.bl-footer-legal address{font-style:normal;line-height:1.5}
.bl-404{text-align:center;padding:80px 0}
.bl-404 h1{font-size:var(--bl-h1);letter-spacing:var(--tracking-title)}
@media (max-width:720px){.bl-footer-top{grid-template-columns:1fr}.bl-nav-links{gap:12px}.bl-nav-links .bl-nav-login{display:none}.bl-cta{padding:22px 20px}}
@media (max-width:480px){.bl-nav-links .bl-nav-blog{display:none}}
`;

// ── Layout comum ─────────────────────────────────────────────────────────────
function layout({ cfg, fronted = false, previewBanner = false, head = "", body = "", cta = "" }) {
  const cta_ = cta || ctaUrl(cfg, "");
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
${robotsMeta(fronted)}
<meta name="theme-color" content="#F7F8FA">
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<link rel="alternate" type="application/rss+xml" title="${BLOG_NAME}" href="${esc(cfg.base)}/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS_HREF}" rel="stylesheet">
<style>${CSS}</style>
</head>
<body class="bl">
${previewBanner ? '<div class="bl-preview">Preview · este post não está publicado. Nada é salvo por aqui.</div>' : ""}
<header class="bl-nav">
  <div class="bl-wrap">
    <a class="bl-brand" href="${esc(cfg.siteUrl)}/"><img src="${LOGO}" alt="" width="104" height="26"><span>${SITE_NAME}</span></a>
    <nav class="bl-nav-links" aria-label="Principal">
      <a class="bl-nav-blog" href="${esc(cfg.base)}">Blog</a>
      <a class="bl-nav-login" href="${esc(cfg.siteUrl)}/login">Entrar</a>
      <a class="bl-btn bl-btn--primary" href="${esc(cta_)}">Quero aplicar</a>
    </nav>
  </div>
</header>
<main class="bl-main">
${body}
</main>
<footer class="bl-footer">
  <div class="bl-wrap">
    <div class="bl-footer-top">
      <div class="bl-footer-about">
        <a class="bl-brand" href="${esc(cfg.siteUrl)}/"><img src="${LOGO}" alt="" width="104" height="26"><span>${SITE_NAME}</span></a>
        <p>O LeverAds gerencia todas as suas contas de Mercado Livre e Shopee num painel só: catálogo, preço, estoque e atendimento no mesmo lugar.</p>
      </div>
      <div class="bl-footer-col">
        <h4>Produto</h4>
        <ul>
          <li><a href="${esc(cfg.siteUrl)}/#como-funciona">Como funciona</a></li>
          <li><a href="${esc(cta_)}">Diagnóstico</a></li>
          <li><a href="${esc(cfg.base)}">Blog</a></li>
          <li><a href="${esc(cfg.siteUrl)}/login">Entrar</a></li>
        </ul>
      </div>
      <div class="bl-footer-col">
        <h4>Legal</h4>
        <ul>
          <li><a href="${esc(cfg.siteUrl)}/termos">Termos</a></li>
          <li><a href="${esc(cfg.siteUrl)}/privacidade">Privacidade</a></li>
          <li><a href="${esc(cfg.siteUrl)}/cookies">Cookies</a></li>
        </ul>
      </div>
    </div>
    <div class="bl-footer-legal">
      <address>Lever Ads Software House LTDA · CNPJ 67.931.740/0001-12<br>Av. Itamarati, 2800 · Parque Erasmo Assunção · Santo André/SP · CEP 09271-410</address>
      <span>&copy; ${year} ${SITE_NAME}</span>
    </div>
  </div>
</footer>
</body>
</html>`;
}

function commonHead({ title, description, canonical, ogType = "website", extra = "" }) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:image" content="${BLOG_DEFAULT_OG}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${BLOG_DEFAULT_OG}">`,
    extra,
  ].filter(Boolean).join("\n");
}

const ldScript = (graph) => `<script type="application/ld+json">${escJson({ "@context": "https://schema.org", "@graph": graph })}</script>`;
const organization = (cfg) => ({ "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, url: `${cfg.siteUrl}/`, logo: LOGO_LD });
const breadcrumb = (items) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
});

function ctaBlock({ href, tokens }) {
  const ritmo = tokens?.resRitmo && String(tokens.resRitmo).trim();
  return `<aside class="bl-cta">
  <h2>Faça seu diagnóstico e converse com um especialista</h2>
  <p>Em dois minutos você conta como opera hoje e a gente mostra o que muda na sua rotina com a LeverAds.</p>
  <a class="bl-btn bl-btn--primary" href="${esc(href)}">Quero aplicar</a>
  ${ritmo ? `<p class="bl-proof">Na mediana, um cliente vende ${esc(ritmo)} por mês em anúncios criados pela LeverAds.</p>` : ""}
</aside>`;
}

// Bloco CTA depois da seção do 2º H2 (antes do 3º); com menos de 3 H2, no fim.
function injectCta(html, cta) {
  const idx = [...html.matchAll(/<h2 /g)].map((m) => m.index);
  if (idx.length >= 3) return `${html.slice(0, idx[2])}${cta}\n${html.slice(idx[2])}`;
  return `${html}\n${cta}`;
}

function postCard(cfg, p) {
  return `<article class="bl-card">
  ${p.category ? `<a class="bl-kicker" href="${esc(catUrl(cfg, p.category))}">${esc(p.category)}</a>` : ""}
  <h2><a href="${esc(postUrl(cfg, p))}">${esc(p.title)}</a></h2>
  ${p.description ? `<p>${esc(p.description)}</p>` : ""}
  <p class="bl-meta"><time datetime="${esc(isoDate(p.publishedAt))}">${esc(fmtDate(p.publishedAt))}</time> · ${Number(p.readingMin) || 1} min de leitura</p>
</article>`;
}

// ── Artigo ───────────────────────────────────────────────────────────────────
export function blogArticleHtml(post, { cfg, fronted = false, previewBanner = false, related = [], tokens = {}, ctaUrl: ctaOverride = "" } = {}) {
  const c = cfg || blogConfig();
  const canonical = postUrl(c, post);
  const cta = ctaUrl(c, post.slug, ctaOverride);
  const rendered = renderMarkdown(post.body, { base: c.base, tokens });
  const description = String(post.description || "").trim() || plainText(post.body, 155, tokens);
  const title = seoTitle(post.title);
  const words = Number(post.wordCount) || rendered.words || countWords(post.body);
  const minutes = Number(post.readingMin) || readingMinutes(words);
  const published = isoDate(post.publishedAt);
  const modified = isoDate(post.updatedAt || post.publishedAt) || published;
  const faq = (post.faq || []).filter((f) => f && f.q && f.a);
  const tags = (post.tags || []).map(String).filter(Boolean);
  const authorLd = !post.author || post.author === "Equipe LeverAds"
    ? { "@type": "Organization", name: SITE_NAME, url: `${c.siteUrl}/` }
    : { "@type": "Person", name: String(post.author) };

  const graph = [
    {
      "@type": "BlogPosting",
      "@id": `${canonical}#article`,
      headline: String(post.title || ""),
      description,
      url: canonical,
      mainEntityOfPage: canonical,
      ...(published ? { datePublished: published } : {}),
      ...(modified ? { dateModified: modified } : {}),
      inLanguage: "pt-BR",
      ...(post.category ? { articleSection: String(post.category) } : {}),
      keywords: [post.keyword, ...tags].filter(Boolean),
      wordCount: words,
      timeRequired: `PT${minutes}M`,
      image: [BLOG_DEFAULT_OG],
      author: authorLd,
      publisher: { "@id": ORG_ID },
      isPartOf: { "@id": `${c.base}#blog` },
    },
    organization(c),
    breadcrumb([
      ["Início", `${c.siteUrl}/`],
      ["Blog", c.base],
      ...(post.category ? [[String(post.category), catUrl(c, post.category)]] : []),
      [String(post.title || ""), canonical],
    ]),
  ];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: plainText(f.q, 300, tokens),
        acceptedAnswer: { "@type": "Answer", text: plainText(f.a, 2000, tokens) },
      })),
    });
  }

  const head = commonHead({
    title, description, canonical, ogType: "article",
    extra: [
      published ? `<meta property="article:published_time" content="${published}">` : "",
      modified ? `<meta property="article:modified_time" content="${modified}">` : "",
      post.category ? `<meta property="article:section" content="${esc(post.category)}">` : "",
      ...tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`),
      ldScript(graph),
    ].filter(Boolean).join("\n"),
  });

  const h2s = rendered.headings.filter((h) => h.level === 2);
  const toc = h2s.length >= 3
    ? `<nav class="bl-toc" aria-label="Neste artigo"><strong>Neste artigo</strong><ol>${h2s.map((h) => `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join("")}</ol></nav>`
    : "";
  const bodyHtml = injectCta(rendered.html, ctaBlock({ href: cta, tokens }));
  const faqHtml = faq.length
    ? `<section class="bl-faq"><h2>Perguntas frequentes</h2>${faq.map((f) => `<details><summary>${esc(substituteTokens(f.q, tokens))}</summary>${renderMarkdown(f.a, { base: c.base, tokens }).html || "<p></p>"}</details>`).join("")}</section>`
    : "";
  const rel = (related || []).filter((p) => p && p.slug && p.slug !== post.slug).slice(0, 3);
  const relatedHtml = rel.length
    ? `<section class="bl-related"><div class="bl-wrap"><h2>Leia também</h2><div class="bl-grid">${rel.map((p) => postCard(c, p)).join("")}</div></div></section>`
    : "";

  const body = `<article class="bl-article">
  <div class="bl-wrap"><div class="bl-measure">
    ${post.category ? `<a class="bl-kicker" href="${esc(catUrl(c, post.category))}">${esc(post.category)}</a>` : ""}
    <h1>${esc(post.title)}</h1>
    <p class="bl-meta"><time datetime="${published}">${esc(fmtDate(post.publishedAt))}</time> · ${minutes} min de leitura</p>
    ${toc}
    <div class="bl-body">
${bodyHtml}
    </div>
    ${faqHtml}
  </div></div>
  ${relatedHtml}
</article>`;

  return layout({ cfg: c, fronted, previewBanner, head, body, cta });
}

// ── Índice e categoria ───────────────────────────────────────────────────────
export function blogIndexHtml({ cfg, fronted = false, posts = [], page = 1, pageCount = 1, categories = [], category = null, tokens = {}, ctaUrl: ctaOverride = "" } = {}) {
  const c = cfg || blogConfig();
  const cats = categories && categories.length ? categories : uniqueCategories(posts);
  const canonical = pageUrl(c, page, category);
  const isCat = !!category;
  const baseTitle = isCat ? `${category} · ${BLOG_NAME}` : `${BLOG_NAME} · Mercado Livre e Shopee com várias contas`;
  const title = page > 1 ? `${baseTitle} · página ${page}` : baseTitle;
  const description = isCat
    ? `Artigos sobre ${category} para quem vende no Mercado Livre e na Shopee com mais de uma conta.`
    : "Guias práticos para quem vende no Mercado Livre e na Shopee com mais de uma conta: operação, catálogo, anúncios e crescimento sem inchar o time.";
  const cta = ctaUrl(c, "", ctaOverride);

  const graph = [
    isCat
      ? { "@type": "CollectionPage", "@id": `${canonical}#page`, name: `Categoria: ${category}`, url: canonical, inLanguage: "pt-BR", isPartOf: { "@id": `${c.base}#blog` } }
      : { "@type": "Blog", "@id": `${c.base}#blog`, name: BLOG_NAME, url: c.base, inLanguage: "pt-BR", publisher: { "@id": ORG_ID } },
    organization(c),
    breadcrumb([["Início", `${c.siteUrl}/`], ["Blog", c.base], ...(isCat ? [[String(category), catUrl(c, category)]] : [])]),
  ];
  const head = commonHead({
    title, description, canonical,
    extra: [
      page > 1 ? `<link rel="prev" href="${esc(pageUrl(c, page - 1, category))}">` : "",
      page < pageCount ? `<link rel="next" href="${esc(pageUrl(c, page + 1, category))}">` : "",
      ldScript(graph),
    ].filter(Boolean).join("\n"),
  });

  const chips = cats.length
    ? `<nav class="bl-chips" aria-label="Categorias"><a class="bl-chip${isCat ? "" : " is-on"}" href="${esc(c.base)}">Tudo</a>${cats.map((k) => `<a class="bl-chip${k === category ? " is-on" : ""}" href="${esc(catUrl(c, k))}">${esc(k)}</a>`).join("")}</nav>`
    : "";
  const list = posts.length
    ? `<div class="bl-grid">${posts.map((p) => postCard(c, p)).join("")}</div>`
    : `<p class="bl-empty">Os primeiros artigos estão a caminho.</p>`;
  const pager = pageCount > 1
    ? `<nav class="bl-pager" aria-label="Paginação"><span>${page > 1 ? `<a class="bl-btn" href="${esc(pageUrl(c, page - 1, category))}" rel="prev">Mais recentes</a>` : ""}</span><span>${page < pageCount ? `<a class="bl-btn" href="${esc(pageUrl(c, page + 1, category))}" rel="next">Mais antigos</a>` : ""}</span></nav>`
    : "";

  const body = `<div class="bl-wrap">
  <header class="bl-hero">
    ${isCat ? `<a class="bl-kicker" href="${esc(c.base)}">Blog</a>` : ""}
    <h1>${isCat ? `Categoria: ${esc(category)}` : BLOG_NAME}</h1>
    <p>${isCat ? esc(description) : "Guias práticos para quem vende no Mercado Livre e na Shopee com mais de uma conta."}</p>
  </header>
  ${chips}
  ${list}
  ${pager}
  ${ctaBlock({ href: cta, tokens })}
</div>`;

  return layout({ cfg: c, fronted, head, body, cta });
}

export function blogNotFoundHtml({ cfg } = {}) {
  const c = cfg || blogConfig();
  const head = [
    `<title>Página não encontrada · ${BLOG_NAME}</title>`,
    `<meta name="description" content="Esse endereço não existe no blog da LeverAds.">`,
  ].join("\n");
  const body = `<div class="bl-wrap bl-404"><h1>Página não encontrada</h1><p>Esse endereço não existe ou o artigo saiu do ar.</p><p><a class="bl-btn" href="${esc(c.base)}">Ver todos os artigos</a></p></div>`;
  return layout({ cfg: c, fronted: false, head, body });
}

// ── Sitemap e feed ───────────────────────────────────────────────────────────
export function blogSitemapXml({ cfg, posts = [], categories = [] } = {}) {
  const c = cfg || blogConfig();
  const cats = categories && categories.length ? categories : uniqueCategories(posts);
  const newest = posts.map((p) => isoDate(p.updatedAt || p.publishedAt)).filter(Boolean).sort().pop() || "";
  const url = (loc, lastmod) => `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</url>`;
  const rows = [
    url(c.base, newest),
    ...cats.map((k) => url(catUrl(c, k), posts.filter((p) => p.category === k).map((p) => isoDate(p.updatedAt || p.publishedAt)).filter(Boolean).sort().pop() || "")),
    ...posts.map((p) => url(postUrl(c, p), isoDate(p.updatedAt || p.publishedAt))),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

export function blogFeedXml({ cfg, posts = [], tokens = {} } = {}) {
  const c = cfg || blogConfig();
  const items = posts.slice(0, FEED_SIZE).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(postUrl(c, p))}</link>
      <guid isPermaLink="true">${esc(postUrl(c, p))}</guid>
      ${p.publishedAt ? `<pubDate>${esc(rfc822(p.publishedAt))}</pubDate>` : ""}
      ${p.category ? `<category>${esc(p.category)}</category>` : ""}
      <description>${esc(String(p.description || "").trim() || plainText(p.body, 300, tokens))}</description>
    </item>`);
  const last = posts.map((p) => p.publishedAt).filter(Boolean).sort().pop();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${BLOG_NAME}</title>
    <link>${esc(c.base)}</link>
    <atom:link href="${esc(c.base)}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Guias práticos para quem vende no Mercado Livre e na Shopee com mais de uma conta.</description>
    <language>pt-BR</language>
    ${last ? `<lastBuildDate>${esc(rfc822(last))}</lastBuildDate>` : ""}
${items.join("\n")}
  </channel>
</rss>
`;
}
