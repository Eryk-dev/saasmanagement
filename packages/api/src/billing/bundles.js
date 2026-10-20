// Pacotes (bundles) e pedidos — Fase 2 do plano do Lever CRM.
//
// Pacote = planos de um ou mais produtos vendidos juntos por um preço só
// (ex.: LeverAds Escala anual + LeverPrice anual). Aplicar o pacote num
// negócio preenche `lead.dealItems` — o mesmo campo do fechamento com mais de
// um produto —, com o preço do pacote RATEADO entre os itens pelo preço de
// tabela de cada um. Assim o Ganho abre uma assinatura por produto, cada uma
// com a sua parcela: MRR, churn e renovação continuam medidos por produto, e o
// cancelamento de um item não derruba o outro.
//
// Pedido = o agrupador comercial do fechamento: quais assinaturas nasceram de
// qual negócio (e de qual pacote), com o total. Nasce no Ganho.

import { randomUUID } from "node:crypto";
import { dealCatalogFromPlans } from "./plan-catalog.js";
import { planProductOf } from "../shared/plan-resources.js";

export const BUNDLES = "bundles";
export const ORDERS = "deal_orders";
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const cents = (v) => Math.round(Number(v) * 100);

// Preço de tabela de um item (código do plano × ciclo fechado) no catálogo.
export function listPriceOf(catalog, item) {
  const p = catalog.find((x) => x.id === item.product);
  return p?.prices.find((x) => x.plan === item.planClosed)?.value || 0;
}

// Itens do fechamento a partir do pacote: rateio proporcional à tabela; o
// último item absorve o arredondamento (os itens somam exatamente o preço).
export function bundleDealItems(bundle, catalog) {
  const list = bundle.items.map((it) => ({ ...it, list: listPriceOf(catalog, it) }));
  const totalList = list.reduce((n, it) => n + it.list, 0);
  if (!totalList) throw fail(422, "Os planos do pacote não têm preço de tabela nesse ciclo.");
  const price = cents(bundle.price);
  let used = 0;
  return list.map((it, i) => {
    const share = i === list.length - 1 ? price - used : Math.round((price * it.list) / totalList);
    used += share;
    return { product: it.product, planClosed: it.planClosed, amount: share / 100, listAmount: it.list };
  });
}

export function cleanBundle(body, { saas = "" } = {}) {
  const name = s(body?.name, 80);
  const items = (Array.isArray(body?.items) ? body.items : [])
    .map((it) => ({ product: s(it?.product, 60), planClosed: s(it?.planClosed, 20) }))
    .filter((it) => it.product && it.planClosed);
  const price = Number(body?.price);
  if (!name) throw fail(400, "Dê um nome ao pacote.");
  if (items.length < 2) throw fail(400, "Um pacote junta pelo menos dois planos.");
  if (!(price > 0)) throw fail(400, "Informe o preço do pacote.");
  return {
    saas: s(body?.saas, 40) || saas, name, items, price: Math.round(price * 100) / 100,
    status: body?.status === "archived" ? "archived" : "active", validUntil: s(body?.validUntil, 10),
  };
}

// O fechamento abre UMA assinatura viva por produto: dois planos do mesmo
// produto no pacote fariam o segundo sumir em silêncio. Recusa na criação.
export async function assertOnePerProduct(repo, bundle) {
  const plans = new Map((await repo.list("plans")).filter((p) => p.saas === bundle.saas).map((p) => [p.code, p]));
  const seen = new Set();
  for (const it of bundle.items) {
    const plan = plans.get(it.product);
    if (!plan) throw fail(400, `Plano ${it.product} não existe neste produto.`);
    const product = planProductOf(plan);
    if (seen.has(product)) throw fail(400, "Um pacote junta produtos diferentes: dois planos do mesmo produto não viram duas assinaturas.");
    seen.add(product);
  }
  return bundle;
}

export async function catalogOf(repo, saas) {
  return dealCatalogFromPlans((await repo.list("plans")).filter((p) => p.saas === saas));
}

// Aplica o pacote no negócio: itens rateados, valor = preço do pacote.
export async function applyBundle(repo, leadId, bundleId) {
  const lead = await repo.get("leads", leadId);
  if (!lead) throw fail(404, "Lead não encontrado.");
  const bundle = await repo.get(BUNDLES, bundleId);
  if (!bundle || bundle.saas !== lead.saas) throw fail(404, "Pacote não encontrado neste produto.");
  if (bundle.status !== "active") throw fail(422, "Pacote arquivado.");
  const items = bundleDealItems(bundle, await catalogOf(repo, lead.saas));
  return repo.update("leads", lead.id, {
    dealItems: items.map(({ product, planClosed, amount }) => ({ product, planClosed, amount })),
    dealProduct: items[0].product, planClosed: items[0].planClosed, amount: bundle.price, bundleId: bundle.id,
  });
}

// Pedido do fechamento: as assinaturas que nasceram deste negócio.
export async function recordOrder(repo, { lead, customer, subscriptions = [], now = new Date() }) {
  if (!lead?.id || !customer?.id) return null;
  const existing = (await repo.listWhere(ORDERS, { lead: lead.id }))[0];
  if (existing) return existing;
  const items = subscriptions.map((sub) => ({
    subscription: sub.id, product: sub.planCode || "", planClosed: sub.cycle || "", amount: Number(sub.price) || 0,
  }));
  return repo.create(ORDERS, {
    id: "or_" + randomUUID(), saas: lead.saas || "", customer: customer.id, lead: lead.id, bundle: lead.bundleId || "",
    dealType: lead.dealType || "nova_venda", items, total: Number(lead.amount) || items.reduce((n, i) => n + i.amount, 0),
    createdAt: now.toISOString(),
  });
}
