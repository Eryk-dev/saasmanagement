// Resolver de produto (SaaS/workspace). Quase toda tool é escopada por produto,
// e o modelo escreve "LeverAds" onde o id é "leverads" — resolver isso aqui, uma
// vez, evita 404 com mensagem inútil espalhado por 60 tools.
//
// Quando o produto é ambíguo (ou não existe), o erro JÁ traz a lista: assim a
// resposta seguinte acerta, em vez de gastar uma chamada perguntando.

import { http, ApiError } from "./http.js";

let cache = { at: 0, rows: null };
const TTL_MS = 60_000;

export async function listProducts({ fresh = false } = {}) {
  if (!fresh && cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = (await http.get("/api/products")) || [];
  cache = { at: Date.now(), rows };
  return rows;
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export async function resolveProduct(saas, { requireAdAccount = false } = {}) {
  const products = await listProducts();
  const disponiveis = products.map((p) => `${p.id}${p.name && p.name !== p.id ? ` (${p.name})` : ""}`).join(", ");

  if (!saas) {
    const candidatos = requireAdAccount ? products.filter((p) => p.metaAdAccount) : products;
    if (candidatos.length === 1) return candidatos[0];
    throw new ApiError(
      `informe o produto em \`saas\`. Disponíveis: ${disponiveis || "(nenhum)"}`,
      { detail: requireAdAccount ? "com conta de anúncio configurada: " + (candidatos.map((p) => p.id).join(", ") || "nenhum") : "" },
    );
  }
  const alvo = norm(saas);
  const found = products.find((p) => norm(p.id) === alvo)
    || products.find((p) => norm(p.name) === alvo)
    || products.find((p) => norm(p.id).startsWith(alvo) || norm(p.name).startsWith(alvo));
  if (!found) throw new ApiError(`produto "${saas}" não existe. Disponíveis: ${disponiveis || "(nenhum)"}`);
  if (requireAdAccount && !found.metaAdAccount) {
    throw new ApiError(
      `o produto "${found.id}" não tem conta de anúncio da Meta configurada`,
      { detail: "configure em Ajustes → Integrações (campo metaAdAccount do produto) ou use ads_accounts para ver as contas disponíveis." },
    );
  }
  return found;
}

export const invalidateProducts = () => { cache = { at: 0, rows: null }; };
