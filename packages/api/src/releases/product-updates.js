// Novidades de produto (coleção PRIVATE `product_updates`): o que mudou, em
// linguagem de cliente, escrito na tela Versões e novidades. Cada produto lê as
// suas publicadas em GET /public/updates/:saas (o LeverAds mostra na página
// que abre pelo indicador de versão da sidebar).
//
// Doc: { saas, title, body, version, category, status, publishedAt, author,
// createdAt, updatedAt }. `publishedAt` nasce na primeira publicação e não
// muda ao editar (a ordem da página é por ele); voltar a rascunho tira do ar.

export const COLLECTION = "product_updates";
export const PRODUCTS = ["leverads", "leverprice"];
export const CATEGORIES = ["novo", "melhoria", "correcao"];
export const STATUSES = ["draft", "published"];

const LIMITS = { title: 160, body: 8000, version: 32 };
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

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
  };
  if (!PRODUCTS.includes(doc.saas)) return { error: "produto inválido" };
  if (!doc.title) return { error: "informe o título" };
  if (!CATEGORIES.includes(doc.category)) return { error: "categoria inválida" };
  if (!STATUSES.includes(doc.status)) return { error: "status inválido" };
  const at = now().toISOString();
  doc.publishedAt = doc.status === "published" ? (prev?.publishedAt || at) : "";
  doc.updatedAt = at;
  if (!prev) { doc.createdAt = at; doc.author = author; }
  return { doc };
}

const byPublishedDesc = (a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));

// Recorte público: só publicadas do produto, da mais nova, só os campos da
// página (sem autor nem rascunho).
export function publicUpdates(all, saas, { limit = 50 } = {}) {
  return (all || [])
    .filter((u) => u.saas === saas && u.status === "published" && u.publishedAt)
    .sort(byPublishedDesc)
    .slice(0, limit)
    .map((u) => ({
      id: u.id, title: u.title, body: u.body, version: u.version || "",
      category: u.category || "", publishedAt: u.publishedAt,
    }));
}

// Lista da tela de admin: rascunhos primeiro, depois publicadas da mais nova.
export function adminUpdates(all, saas) {
  const mine = (all || []).filter((u) => !saas || u.saas === saas);
  const drafts = mine.filter((u) => u.status !== "published")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return [...drafts, ...mine.filter((u) => u.status === "published").sort(byPublishedDesc)];
}
