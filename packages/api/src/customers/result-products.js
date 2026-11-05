// Visão Resultados da Carteira (05/11/2026): os resultados de UM cliente,
// separados por produto, no molde do card do slide 06 do deck ("Quem já está
// dentro", proposals/proposal-slides-page.js). As definições moram aqui; a tela
// só desenha. Cada produto vira um item normalizado:
//
//   { id, label, status: ok | sem_vinculo | indisponivel, reason, orgId, asOf,
//     since, partial, hero, metrics[], recent: { days, items[] },
//     monthly: { series[], rows[] }, note }
//
// LeverAds: o número é o INFLUENCIADO (o que os anúncios criados pela Lever
// venderam). O faturamento da loja aparece só como contexto (série e linha do
// 30 × 30), nunca como resultado da Lever. Total, pedidos, horas e custo saem
// da régua do card do deck (proposals/cases.js, panelMetricNumber).
//
// LeverPrice: o destaque pedido é o rebate recuperado; o hero é o vendido com
// preço do LeverPrice (venda atribuída ao robô), as definições são as da Home
// do LeverPrice e chegam prontas pela rota de serviço dele.

import { dealProductsOf, signupProductLabel } from "../shared/signup-products.js";
import { panelMetricNumber, PANEL_MINUTES_PER_LISTING, PANEL_SALARY, PANEL_MONTH_HOURS } from "../proposals/cases.js";
import { lastMonthsSP } from "./leverads-results.js";

const RESULT_PRODUCTS = ["leverads", "leverprice"];
const clean = (v) => String(v || "").trim().toLowerCase();

// Org do LeverAds: o vínculo é `leveradsOrgId`; `orgId` (a org do LeverId, que
// preserva o id da org do LeverAds) vale na falta dele, como em customer-status.
export const leveradsOrgOf = (customer) => clean(customer?.leveradsOrgId || customer?.orgId);
export const leverpriceOrgOf = (customer) => clean(customer?.leverpriceOrgId);

// Produtos com resultado que o cliente tem: o que a venda cita
// (dealProductsOf) OU org vinculada. Mentoria não tem sistema e fica de fora.
// Sem informação nenhuma (nem venda, nem org), vale o LeverAds, como o link de
// cadastro (signupProductsOf) e o bloco Resultados de antes.
export function resultProductIds(customer, plans = []) {
  const deal = dealProductsOf({ customer, plans });
  const set = new Set(deal.filter((p) => RESULT_PRODUCTS.includes(p)));
  if (leveradsOrgOf(customer)) set.add("leverads");
  if (leverpriceOrgOf(customer)) set.add("leverprice");
  if (!deal.length && !set.size) set.add("leverads");
  return RESULT_PRODUCTS.filter((p) => set.has(p));
}

const base = (id, extra = {}) => ({
  id, label: signupProductLabel(id), status: "ok", reason: "", orgId: "", asOf: null, since: null, partial: false,
  hero: null, metrics: [], recent: { days: 30, items: [] }, monthly: { series: [], rows: [] }, note: "", ...extra,
});
export const unavailableProduct = (id, status, reason, orgId = "") => base(id, { status, reason, orgId });

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (part, whole) => (num(whole) > 0 ? Math.round(num(part) / num(whole) * 1000) / 10 : null);
const dateBR = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? ymd.split("-").reverse().join("/") : "");
const nfBR = (n) => new Intl.NumberFormat("pt-BR").format(n);

// ── LeverAds ────────────────────────────────────────────────────────────────
// snap: o retrato do orgSnapshot (ou null); monthly: o orgMonthly (ou null).
export function leveradsResultProduct({ orgId = "", snap = null, monthly = null } = {}) {
  if (!snap && !monthly) return unavailableProduct("leverads", "indisponivel", "não consegui ler os números do LeverAds agora", orgId);
  // Sem retrato (banco fora ou org sem linha no painel), o total fica sem
  // valor (null), nunca "R$ 0": zero é afirmação, null é "sem dado".
  const v = (key) => (snap ? Math.round(panelMetricNumber(key, snap) * 100) / 100 : null);
  const last = monthly?.last30, prev = monthly?.prev30;
  return base("leverads", {
    orgId,
    asOf: monthly?.asOf || new Date().toISOString(),
    since: monthly?.since || null,
    partial: !snap || !monthly,
    hero: { key: "gmvTotal", label: "vendido pelos anúncios da Lever", value: v("gmvTotal"), format: "money", period: "desde o início" },
    metrics: [
      { key: "ordersTotal", label: "pedidos gerados", value: v("ordersTotal"), format: "int", period: "desde o início" },
      { key: "hoursSaved", label: "de cadastro manual poupadas", value: v("hoursSaved"), format: "hours", period: "desde o início" },
      { key: "costAvoided", label: "de custo fixo evitado", value: v("costAvoided"), format: "money", period: "desde o início" },
    ],
    recent: {
      days: 30,
      items: monthly ? [
        { key: "leverGmv", label: "vendido pelos anúncios da Lever", format: "money", current: last.leverGmv, previous: prev.leverGmv },
        { key: "leverOrders", label: "pedidos pelos anúncios da Lever", format: "int", current: last.leverOrders, previous: prev.leverOrders },
        { key: "storeGmv", label: "faturamento da loja", format: "money", current: last.storeGmv, previous: prev.storeGmv },
        { key: "leverShare", label: "participação da Lever no faturamento", format: "pct", current: pct(last.leverGmv, last.storeGmv), previous: pct(prev.leverGmv, prev.storeGmv) },
      ] : [],
    },
    monthly: monthly ? {
      series: [
        { key: "storeGmv", label: "Faturamento da loja", format: "money", role: "context" },
        { key: "leverGmv", label: "Vendido pelos anúncios da Lever", format: "money", role: "main" },
        { key: "leverOrders", label: "Pedidos pelos anúncios da Lever", format: "int", role: "extra" },
      ],
      rows: monthly.months.map((m) => ({ month: m.month, storeGmv: m.storeGmv, leverGmv: m.leverGmv, leverOrders: m.leverOrders })),
    } : { series: [], rows: [] },
    note: `Só o que os anúncios criados pela Lever venderam; o faturamento da loja é contexto. Horas: ${PANEL_MINUTES_PER_LISTING} min por anúncio criado; custo: um funcionário de R$ ${nfBR(PANEL_SALARY)} por ${PANEL_MONTH_HOURS} h.`
      + (monthly?.since ? ` Mês a mês desde ${dateBR(monthly.since)}, quando começou o registro de pedidos.` : ""),
  });
}

// ── LeverPrice ──────────────────────────────────────────────────────────────
// Período do total: a cobertura que o LeverPrice declara. `since` dentro da
// retenção → "desde dd/mm/aaaa"; sem `since` (ou mais antigo que a retenção) →
// "nos últimos N meses".
function leverpricePeriod(data, months) {
  const asOf = Date.parse(data?.as_of || "") || Date.now();
  const retentionDays = num(data?.retention_days) || num(data?.retention_months) * 31 || months * 31;
  const since = /^\d{4}-\d{2}-\d{2}/.test(data?.since || "") ? String(data.since).slice(0, 10) : "";
  if (since && Date.parse(`${since}T12:00:00Z`) >= asOf - retentionDays * 86_400_000) return `desde ${dateBR(since)}`;
  const n = num(data?.retention_months) || Math.round(retentionDays / 30.4) || months;
  return `nos últimos ${n} meses`;
}

// data: o corpo da rota do LeverPrice.
export function leverpriceResultProduct({ orgId = "", data = {}, at = Date.now(), months = 12 } = {}) {
  const total = data.total || {}, last = data.last30 || {}, prev = data.prev30 || {};
  const period = leverpricePeriod(data, months);
  const asOfMs = Date.parse(data.as_of || "") || at;
  const byMonth = new Map((Array.isArray(data.monthly) ? data.monthly : []).map((m) => [String(m?.month || ""), m]));
  const accTotal = num(data.accounts_total), accSynced = num(data.accounts_synced);
  const since = /^\d{4}-\d{2}-\d{2}/.test(data.since || "") ? String(data.since).slice(0, 10) : null;
  return base("leverprice", {
    orgId,
    asOf: new Date(asOfMs).toISOString(),
    since,
    partial: Boolean(data.partial),
    hero: { key: "sales", label: "vendido com preço do LeverPrice", value: num(total.sales), format: "money", period },
    metrics: [
      { key: "rebate", label: "de rebate recuperado", value: num(total.rebate), format: "money", period },
      { key: "orders", label: "pedidos com preço do LeverPrice", value: num(total.orders), format: "int", period },
      { key: "automaticPromotions", label: "promoções em que o robô entrou", value: num(last.automatic_promotions), format: "int", period: "últimos 30 dias" },
    ],
    recent: {
      days: 30,
      items: [
        { key: "sales", label: "vendido com preço do LeverPrice", format: "money", current: num(last.sales), previous: num(prev.sales) },
        { key: "rebate", label: "rebate recuperado", format: "money", current: num(last.rebate), previous: num(prev.rebate) },
        { key: "orders", label: "pedidos", format: "int", current: num(last.orders), previous: num(prev.orders) },
        { key: "automaticPromotions", label: "promoções automáticas", format: "int", current: num(last.automatic_promotions), previous: null },
        { key: "automaticPriceChanges", label: "mudanças de preço automáticas", format: "int", current: num(last.automatic_price_changes), previous: null },
      ],
    },
    monthly: {
      series: [
        { key: "sales", label: "Vendido com preço do LeverPrice", format: "money", role: "main" },
        { key: "rebate", label: "Rebate recuperado", format: "money", role: "extra" },
        { key: "orders", label: "Pedidos", format: "int", role: "extra" },
      ],
      rows: lastMonthsSP(months, asOfMs).map((month) => {
        const m = byMonth.get(month) || {};
        return { month, sales: num(m.sales), rebate: num(m.rebate), orders: num(m.orders) };
      }),
    },
    note: "Venda atribuída ao preço que o robô do LeverPrice definiu e rebate confirmado recuperado, pelas regras da Home do LeverPrice."
      + (data.partial && accTotal ? ` Parcial: ${accSynced} de ${accTotal} contas sincronizadas.` : ""),
  });
}

// ── O cliente inteiro ───────────────────────────────────────────────────────
// Um item por produto, em paralelo; a falha de um não derruba o outro. `snapMap`
// é o Map do orgSnapshot já lido pela rota (ou uma Promise dele), para não
// consultar o banco do produto duas vezes.
export async function customerResultProducts(customer, {
  plans = [], snapMap = null, snapshot, monthly, leverprice, months = 12,
} = {}) {
  const ids = resultProductIds(customer, plans);
  const one = async (id) => {
    if (id === "leverads") {
      const org = leveradsOrgOf(customer);
      if (!org) return unavailableProduct(id, "sem_vinculo", "sem org da LeverAds no cadastro");
      const [snapR, monR] = await Promise.allSettled([
        Promise.resolve(snapMap || snapshot([org])),
        monthly(org, { months }),
      ]);
      const map = snapR.status === "fulfilled" && snapR.value instanceof Map ? snapR.value : new Map();
      return leveradsResultProduct({
        orgId: org,
        snap: map.get(org) || map.get(String(customer.leveradsOrgId || customer.orgId || "").trim()) || null,
        monthly: monR.status === "fulfilled" ? monR.value : null,
      });
    }
    const org = leverpriceOrgOf(customer);
    if (!org) return unavailableProduct(id, "sem_vinculo", "sem conta do LeverPrice vinculada");
    const r = await leverprice(org, { months });
    if (r?.status !== "ok") return unavailableProduct(id, "indisponivel", r?.reason || "LeverPrice indisponível agora", org);
    return leverpriceResultProduct({ orgId: org, data: r.data, at: r.at, months });
  };
  const settled = await Promise.allSettled(ids.map(one));
  return settled.map((s, i) => (s.status === "fulfilled" ? s.value
    : unavailableProduct(ids[i], "indisponivel", "não consegui montar os resultados agora")));
}
