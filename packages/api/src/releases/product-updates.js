// Novidades de produto (coleção PRIVATE `product_updates`): o que mudou, em
// linguagem de cliente, escrito na tela Versões e novidades (ou subido pela
// skill `novidades` do repo LeverAds). Cada produto lê as suas publicadas em
// GET /public/updates/:saas (o LeverAds mostra na página que abre pelo
// indicador de versão da sidebar).
//
// Dois formatos, pela categoria:
//   · feature (`novo`, `melhoria`): título, resumo, passo a passo de uso
//     (`steps`), prints (`images`) e, opcional, o atalho para a tela
//     (`linkPath` + `linkLabel`). Só publica com ao menos 1 print e 1 passo;
//   · correção (`correcao`): nota curta — título e uma frase, sem print nem
//     passos. Só bug que atingia todo mundo; bug de uma conta não entra.
//
// Nunca dado de cliente: publicar recusa texto com e-mail, telefone, CNPJ/CPF
// ou id de anúncio (MLB…). Nome de cliente não dá pra detectar — é regra da
// skill e da revisão.
//
// `publishedAt` nasce na primeira publicação e não muda ao editar; voltar a
// rascunho tira do ar.

export const COLLECTION = "product_updates";
export const ASSETS = "product_update_assets";
export const ASSET_PREFIX = "/public/updates/assets/";
export const PRODUCTS = ["leverads", "leverprice"];
export const CATEGORIES = ["novo", "melhoria", "correcao"];
export const FEATURE_CATEGORIES = ["novo", "melhoria"];
export const STATUSES = ["draft", "published"];

const LIMITS = { title: 120, body: 1200, fixBody: 280, version: 32, step: 240, steps: 8, images: 4, caption: 140, linkLabel: 40 };
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const LINK_RE = /^\/[a-z0-9/_-]{0,80}$/;
const ASSET_URL_RE = /^\/public\/updates\/assets\/pua_[0-9a-f-]{36}$/;

// O que denuncia dado de cliente no texto. Telefone: 10–11 dígitos com DDD,
// com ou sem máscara; CNPJ/CPF com ou sem pontuação; id de anúncio do ML.
const SENSITIVE = [
  ["e-mail", /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ["CNPJ", /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/],
  ["CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["telefone", /(\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b)/],
  ["id de anúncio", /\bML[A-Z]-?\d{6,}\b/i],
];

export function sensitiveHits(doc) {
  const text = [doc.title, doc.body, ...(doc.steps || []), ...(doc.images || []).map((i) => i.caption)].join("\n");
  return SENSITIVE.filter(([, re]) => re.test(text)).map(([label]) => label);
}

const cleanSteps = (v) => (Array.isArray(v) ? v : String(v || "").split("\n"))
  .map((s) => clip(String(s).replace(/^\s*(\d+[.)]|[-•])\s*/, ""), LIMITS.step)).filter(Boolean).slice(0, LIMITS.steps);

const cleanImages = (v) => (Array.isArray(v) ? v : [])
  .map((i) => ({ url: String(i?.url || ""), caption: clip(i?.caption, LIMITS.caption) }))
  .filter((i) => ASSET_URL_RE.test(i.url)).slice(0, LIMITS.images);

// Regras de publicação por formato; rascunho aceita qualquer coisa incompleta.
function publishError(doc) {
  if (FEATURE_CATEGORIES.includes(doc.category)) {
    if (!doc.body) return "feature publica com o resumo do que mudou";
    if (!doc.steps.length) return "feature publica com o passo a passo de uso";
    if (!doc.images.length) return "feature publica com ao menos 1 print";
  } else {
    if (doc.images.length || doc.steps.length) return "correção é nota curta: sem print nem passo a passo";
    if (doc.body.length > LIMITS.fixBody) return `correção é nota curta: até ${LIMITS.fixBody} caracteres`;
  }
  const hits = sensitiveHits(doc);
  if (hits.length) return `tem cara de dado de cliente (${hits.join(", ")}): tire do texto antes de publicar`;
  return "";
}

// Valida e normaliza o que veio da tela. Devolve { error } ou { doc } com só os
// campos conhecidos. `prev` = documento atual (edição).
export function normalizeUpdate(input = {}, prev = null, { now = () => new Date(), author = "" } = {}) {
  const merged = { ...(prev || {}), ...input };
  const doc = {
    saas: String(merged.saas || ""),
    title: clip(merged.title, LIMITS.title),
    body: clip(merged.body, LIMITS.body),
    version: clip(merged.version, LIMITS.version).replace(/^v/i, ""),
    category: String(merged.category || "novo"),
    status: String(merged.status || "draft"),
    steps: cleanSteps(merged.steps),
    images: cleanImages(merged.images),
    linkPath: LINK_RE.test(String(merged.linkPath || "")) ? String(merged.linkPath) : "",
    linkLabel: clip(merged.linkLabel, LIMITS.linkLabel),
  };
  if (!PRODUCTS.includes(doc.saas)) return { error: "produto inválido" };
  if (!doc.title) return { error: "informe o título" };
  if (!CATEGORIES.includes(doc.category)) return { error: "categoria inválida" };
  if (!STATUSES.includes(doc.status)) return { error: "status inválido" };
  if (doc.status === "published") {
    const error = publishError(doc);
    if (error) return { error };
  }
  const at = now().toISOString();
  doc.publishedAt = doc.status === "published" ? (prev?.publishedAt || at) : "";
  doc.updatedAt = at;
  if (!prev) { doc.createdAt = at; doc.author = author; }
  return { doc };
}

const byPublishedDesc = (a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));

// Recorte público: só publicadas do produto, da mais nova, só os campos da
// página (sem autor nem rascunho).
export function publicUpdates(all, saas, { limit = 80 } = {}) {
  return (all || [])
    .filter((u) => u.saas === saas && u.status === "published" && u.publishedAt)
    .sort(byPublishedDesc)
    .slice(0, limit)
    .map((u) => ({
      id: u.id, title: u.title, body: u.body, version: u.version || "",
      category: u.category || "", publishedAt: u.publishedAt,
      steps: u.steps || [], images: u.images || [],
      linkPath: u.linkPath || "", linkLabel: u.linkLabel || "",
    }));
}

// Lista da tela de admin: rascunhos primeiro, depois publicadas da mais nova.
export function adminUpdates(all, saas) {
  const mine = (all || []).filter((u) => !saas || u.saas === saas);
  const drafts = mine.filter((u) => u.status !== "published")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return [...drafts, ...mine.filter((u) => u.status === "published").sort(byPublishedDesc)];
}
