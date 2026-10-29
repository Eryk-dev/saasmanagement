// Produtos com página de cadastro que o NEGÓCIO do cliente inclui (link de
// cadastro com convite: LeverAds em /signup, LeverPrice em /cadastro). A API
// usa para montar os links (customers/routes.leverads-orgs.js) e o vínculo do
// LeverPrice pelo e-mail (customers/leverprice-orgs.js); a SPA usa para saber
// quais botões mostrar antes do clique (components/leverads-accounts.jsx).
// Sem dependências: a SPA importa este arquivo direto (os Dockerfiles de build
// web copiam `shared/`).
//
// Fontes, da mais forte para a mais fraca:
//   1. `customer.products`: os produtos de todas as assinaturas com plano
//      (billing/plan-history.js, syncCustomerPlanFromSub). Quando existe, manda.
//   2. Sem ela, a união do que a venda diz: `planSnapshot.product` /
//      `accessProduct` (retrato do 1º item), os itens do negócio no lead
//      (`dealItems[].product` / `dealProduct`) e `planCode` / `dealProduct` do
//      cliente. É união porque o retrato guarda só o 1º item: um pacote
//      LeverAds + LeverPrice sem assinatura ainda perderia o segundo.
// Código de plano vira produto pelo plano do catálogo, quando ele é passado
// (`plans`), ou pelo prefixo (`price_*` é LeverPrice, `men_*` é Mentoria, as
// linhas oem/ads e os códigos legados são LeverAds). Código desconhecido
// (venda "Personalizado" com nome livre) não informa nada.
//
// Sem informação nenhuma, devolve ["leverads"] (o link de sempre). Negócio só
// de Mentoria (ou de outro produto sem sistema) devolve [].

import { planProductOf } from "./plan-resources.js";

export const SIGNUP_PRODUCTS = [
  { id: "leverads", label: "LeverAds" },
  { id: "leverprice", label: "LeverPrice" },
];
const SIGNUP_IDS = SIGNUP_PRODUCTS.map((p) => p.id);
const KNOWN = new Set([...SIGNUP_IDS, "mentoria"]);
// Linhas e códigos legados do LeverAds (proposals/proposal-catalog.js).
const LEVERADS_CODES = new Set(["oem_pack", "full", "fulloem", "oem", "parcialA", "parcialoem", "avulso"]);

// Produto de um código de plano/dealProduct; "" quando o código não diz.
export function productOfCode(code, plans = []) {
  const key = String(code || "").trim();
  if (!key) return "";
  const plan = (plans || []).find((p) => p && (p.code === key || p.id === key));
  if (plan) return planProductOf(plan);
  if (/^price(_|$)/.test(key)) return "leverprice";
  if (/^men(_|$)/.test(key) || key === "mentoria") return "mentoria";
  if (/^(oem|ads)_/.test(key) || LEVERADS_CODES.has(key)) return "leverads";
  return "";
}

const fromSnapshot = (snap) => {
  const prod = snap?.product || snap?.accessProduct || "";
  return KNOWN.has(prod) ? prod : "";
};

// Os produtos que a venda cita (sem filtro de página de cadastro).
export function dealProductsOf({ customer, lead, plans = [] } = {}) {
  const listed = Array.isArray(customer?.products) ? customer.products.filter((p) => KNOWN.has(p)) : [];
  if (listed.length) return [...new Set(listed)];
  const items = Array.isArray(lead?.dealItems) ? lead.dealItems.map((i) => i?.product) : [];
  const found = [
    fromSnapshot(customer?.planSnapshot),
    ...items.map((c) => productOfCode(c, plans)),
    productOfCode(lead?.dealProduct, plans),
    productOfCode(customer?.planCode, plans),
    productOfCode(customer?.dealProduct, plans),
  ].filter(Boolean);
  return [...new Set(found)];
}

// Os produtos com página de cadastro, na ordem de SIGNUP_PRODUCTS.
export function signupProductsOf({ customer, lead, plans = [] } = {}) {
  const found = dealProductsOf({ customer, lead, plans });
  if (!found.length) return ["leverads"];
  return SIGNUP_IDS.filter((id) => found.includes(id));
}

export const signupProductLabel = (id) => SIGNUP_PRODUCTS.find((p) => p.id === id)?.label || id;
