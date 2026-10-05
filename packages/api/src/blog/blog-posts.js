// Documento do blog (collection PRIVATE `blog_posts`): helpers puros e os
// acessores de leitura que o renderizador público usa. A máquina de estados
// (pauta → rascunho → agendado → publicado → arquivado) é aplicada em
// routes.blog.js e blog-engine.js; aqui só o que é compartilhado.

import { slugify, countWords, readingMinutes } from "./blog-markdown.js";

export { slugify, countWords, readingMinutes };

export const BLOG_STATUSES = ["pauta", "rascunho", "agendado", "publicado", "arquivado"];

// Campos que saem pro renderizador público (nunca fontes internas, lint,
// histórico ou dados de IA).
export function toPublicPost(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    slug: doc.slug || "",
    title: doc.title || "",
    description: doc.description || "",
    body: doc.body || "",
    category: doc.category || "",
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    faq: Array.isArray(doc.faq) ? doc.faq.filter((f) => f && f.q && f.a) : [],
    keyword: doc.keyword || "",
    author: doc.author && doc.author !== "cockpit" ? doc.author : "Equipe LeverAds",
    publishedAt: doc.publishedAt || "",
    updatedAt: doc.updatedAt || doc.publishedAt || "",
    readingMin: doc.readingMin || readingMinutes(doc.wordCount || countWords(doc.body)),
    wordCount: doc.wordCount || countWords(doc.body),
  };
}

const PUBLIC_LIST_FIELDS = ["saas", "status", "slug", "title", "description", "category", "tags", "keyword", "author", "publishedAt", "updatedAt", "readingMin", "wordCount"];

// Publicados do produto, mais novo primeiro. Sem `body` por padrão (índice,
// sitemap e feed não precisam dele); passe { fields } pra projetar outra coisa.
export async function listPublished(repo, saas, { fields = PUBLIC_LIST_FIELDS } = {}) {
  const rows = await repo.listWhere("blog_posts", { saas, status: "publicado" }, { fields });
  return rows
    .filter((r) => r && r.slug)
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")))
    .map(toPublicPost);
}

// Um post publicado pelo slug (null pra qualquer outro status). Em empate de
// slug (não deveria acontecer: uniqueSlug), vence o publicado mais novo.
export async function getPublishedBySlug(repo, saas, slug) {
  if (!slug) return null;
  const rows = await repo.listWhere("blog_posts", { saas, slug });
  const pub = rows.filter((r) => r.status === "publicado")
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  return pub[0] ? toPublicPost(pub[0]) : null;
}

// ── Identidade, slug e links ─────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

// "bp_" + timestamp base36 + 6 hex: legível na URL do cockpit e sem colisão em burst.
export function newPostId() {
  return `bp_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

// Segmentos que o renderizador público usa como rota fixa (routes.blog-public.js):
// um post com esse slug ficaria inalcançável, então o save recusa.
export const RESERVED_SLUGS = new Set(["c", "preview", "sitemap.xml", "feed.xml", "p", "page", "tag"]);
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug) {
  const s = String(slug || "");
  return s.length > 0 && s.length <= 80 && SLUG_RE.test(s) && !RESERVED_SLUGS.has(s);
}

// Slug único dentro do produto: base normalizada + "-2", "-3"... quando já
// existe. `taken` = slugs de TODOS os status (arquivado inclusive: URL é pra sempre).
export function uniqueSlug(base, taken = []) {
  let s = slugify(base) || "post";
  if (RESERVED_SLUGS.has(s)) s = `${s}-blog`;
  const used = new Set([...taken].map((t) => String(t || "")));
  if (!used.has(s)) return s;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const cand = `${s.slice(0, 80 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(cand)) return cand;
  }
  return `${s.slice(0, 60)}-${Date.now().toString(36)}`;
}

const UTM = { utm_source: "blog", utm_medium: "organic", utm_campaign: "blog" };

// Todo link em markdown pro host do CTA (form de diagnóstico) ganha as UTMs de
// atribuição do blog. Idempotente: link que já tem utm_source fica como está.
export function injectUtm(body, ctaUrl, slug) {
  let host = "";
  try { host = new URL(String(ctaUrl || "")).host; } catch { return String(body || ""); }
  if (!host) return String(body || "");
  return String(body || "").replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, text, url) => {
    let u;
    try { u = new URL(url); } catch { return m; }
    if (u.host !== host || u.searchParams.has("utm_source")) return m;
    for (const [k, v] of Object.entries(UTM)) u.searchParams.set(k, v);
    u.searchParams.set("utm_content", String(slug || ""));
    return `[${text}](${u.toString()})`;
  });
}

// ── Máquina de estados ───────────────────────────────────────────────────────
// pauta → rascunho|arquivado · rascunho → agendado|publicado|arquivado ·
// agendado → publicado|rascunho|arquivado · publicado → rascunho (despublicar)
// |arquivado · arquivado → pauta|rascunho (restaurar). Quem exige admin/lint é
// a rota; aqui só a topologia.
export const TRANSITIONS = {
  pauta: ["rascunho", "arquivado"],
  rascunho: ["agendado", "publicado", "arquivado"],
  agendado: ["publicado", "rascunho", "arquivado"],
  publicado: ["rascunho", "arquivado"],
  arquivado: ["pauta", "rascunho"],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// Campos derivados do corpo, recalculados em todo save (fonte única: blog-markdown.js).
export function withDerived(doc) {
  const wordCount = countWords(doc?.body || "");
  return { ...doc, wordCount, readingMin: readingMinutes(wordCount) };
}

const HISTORY_MAX = 30;

// Devolve o histórico novo (mais recente no fim), com teto de 30 entradas.
export function pushHistory(doc, entry) {
  const prev = Array.isArray(doc?.history) ? doc.history : [];
  const item = { at: entry?.at || new Date().toISOString(), by: entry?.by || "cockpit", action: entry?.action || "", ...(entry?.note ? { note: String(entry.note).slice(0, 300) } : {}) };
  return [...prev, item].slice(-HISTORY_MAX);
}
