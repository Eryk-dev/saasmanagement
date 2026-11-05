// Visão Resultados da Carteira: GET /api/customers/:id/results ganha `products`,
// um item por produto (LeverAds, LeverPrice). O que estes testes travam:
//   · a forma normalizada (hero, metrics, recent, monthly, note) de cada produto;
//   · quais produtos o cliente tem (venda OU org vinculada; Mentoria fora);
//   · LeverAds: número influenciado, régua do deck, meses zerados, 30 × 30, cache;
//   · LeverPrice: sem chave, 404, erro, timeout e cache (último bom fica);
//   · uma falha não derruba o outro produto nem os campos antigos da rota.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { registerCustomerResultsRoutes } from "../src/customers/routes.customer-results.js";
import { orgMonthly, monthlyFromRows, lastMonthsSP, _resetResultsCache } from "../src/customers/leverads-results.js";
import {
  leverpriceResults, makeLeverpriceResultsClient, _resetLeverpriceResultsCache, NOT_CONFIGURED_REASON,
} from "../src/customers/leverprice-results.js";
import { resultProductIds, leveradsResultProduct, leverpriceResultProduct } from "../src/customers/result-products.js";
import { panelMetricNumber, panelMetricValue } from "../src/proposals/cases.js";

const ADS_ORG = "11111111-1111-4111-8111-111111111111";
const LP_ORG = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-05T15:00:00Z");

const SNAP = { gmvTotal: 442140.98, ordersTotal: 3006, listings: 574780, gmv30d: 82000, orders30d: 300 };

// Linhas do MONTHLY_SQL: dois meses com pedido, o 30 × 30 espalhado neles.
const MONTH_ROWS = [
  { since: "2026-07-14", month: "2026-10", store_gmv: 100000, lever_gmv: 20000, orders: 400, lever_orders: 80,
    c_store_gmv: 60000, c_lever_gmv: 15000, c_orders: 240, c_lever_orders: 60,
    p_store_gmv: 40000, p_lever_gmv: 5000, p_orders: 160, p_lever_orders: 20 },
  { since: "2026-07-14", month: "2026-11", store_gmv: 30000, lever_gmv: 9000, orders: 100, lever_orders: 30,
    c_store_gmv: 30000, c_lever_gmv: 9000, c_orders: 100, c_lever_orders: 30,
    p_store_gmv: 0, p_lever_gmv: 0, p_orders: 0, p_lever_orders: 0 },
];

const LP_BODY = {
  org_id: LP_ORG, as_of: "2026-11-05T15:00:00+00:00", timezone: "America/Sao_Paulo", since: "2026-03-02",
  retention_months: 12,
  total: { sales: 250000.5, rebate: 18000.25, orders: 1200, units: 1500 },
  last30: { sales: 40000, rebate: 3000, orders: 200, units: 230, automatic_promotions: 14, automatic_price_changes: 320 },
  prev30: { sales: 30000, rebate: 2500, orders: 150, units: 170 },
  monthly: [{ month: "2026-10", sales: 38000, rebate: 2900, orders: 190, promotions: 12 }, { month: "2026-11", sales: 6000, rebate: 400, orders: 30, promotions: 2 }],
  accounts_total: 3, accounts_synced: 2, partial: true, last_synced_at: "2026-11-05T14:50:00+00:00",
};

const okFetch = (body = LP_BODY, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, status: 200, json: async () => body };
};
const statusFetch = (status) => async () => ({ ok: false, status, json: async () => ({ detail: "x" }) });
const lpClient = (fetchImpl, serviceKey = "k") => makeLeverpriceResultsClient({ baseUrl: "https://lp.test/", serviceKey, fetchImpl });

async function appWith(customer, { snapshot, monthly, leverprice, plans = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", saas: "sa", name: "Loja X", ...customer });
  for (const p of plans) await repo.create("plans", p);
  const app = Fastify();
  registerCustomerResultsRoutes(app, repo, {
    snapshot: snapshot || (async (ids) => new Map(ids.map((id) => [id, SNAP]))),
    monthly: monthly || (async (org) => ({ orgId: org, asOf: new Date(NOW).toISOString(), ...monthlyFromRows(MONTH_ROWS, { months: 12, at: NOW }) })),
    leverprice: leverprice || (async () => ({ status: "ok", data: LP_BODY, at: NOW })),
  });
  return app;
}
const getResults = async (app) => {
  const res = await app.inject({ url: "/api/customers/c1/results" });
  assert.equal(res.statusCode, 200);
  return res.json();
};

test("meses civis de São Paulo: últimos N, do mais antigo ao atual", () => {
  assert.deepEqual(lastMonthsSP(3, NOW), ["2026-09", "2026-10", "2026-11"]);
  // 01/11 às 02h UTC ainda é 31/10 em São Paulo
  assert.deepEqual(lastMonthsSP(2, Date.parse("2026-11-01T02:00:00Z")), ["2026-09", "2026-10"]);
  assert.deepEqual(lastMonthsSP(2, Date.parse("2026-01-15T12:00:00Z")), ["2025-12", "2026-01"]);
  assert.equal(lastMonthsSP(12, NOW).length, 12);
});

test("mês a mês do LeverAds: meses zerados, 30 × 30 somado da mesma varredura e since", () => {
  const m = monthlyFromRows(MONTH_ROWS, { months: 12, at: NOW });
  assert.equal(m.since, "2026-07-14");
  assert.equal(m.months.length, 12);
  assert.equal(m.months[0].month, "2025-12");
  assert.deepEqual(m.months[0], { month: "2025-12", storeGmv: 0, leverGmv: 0, orders: 0, leverOrders: 0 });
  assert.deepEqual(m.months.at(-2), { month: "2026-10", storeGmv: 100000, leverGmv: 20000, orders: 400, leverOrders: 80 });
  assert.deepEqual(m.last30, { storeGmv: 90000, leverGmv: 24000, orders: 340, leverOrders: 90 });
  assert.deepEqual(m.prev30, { storeGmv: 40000, leverGmv: 5000, orders: 160, leverOrders: 20 });
  // org sem pedido: a linha do `since` vem sozinha (left join), tudo zerado
  const vazio = monthlyFromRows([{ since: null, month: null }], { months: 3, at: NOW });
  assert.equal(vazio.since, null);
  assert.deepEqual(vazio.months.map((x) => x.leverGmv), [0, 0, 0]);
  assert.deepEqual(vazio.last30, { storeGmv: 0, leverGmv: 0, orders: 0, leverOrders: 0 });
});

test("orgMonthly: consulta presa à org, cache por org de 3 h, vencido devolve o antigo, falha mantém o último bom", async () => {
  _resetResultsCache();
  let t = NOW;
  const calls = [];
  const query = async (sql, params) => { calls.push(params); return MONTH_ROWS; };
  assert.equal(await orgMonthly("lixo", { query }), null);
  assert.equal(calls.length, 0);
  const a = await orgMonthly(ADS_ORG.toUpperCase(), { query, now: () => t });
  assert.deepEqual(calls[0], [ADS_ORG, 12]);
  assert.equal(a.orgId, ADS_ORG);
  assert.equal(a.asOf, new Date(NOW).toISOString());
  await orgMonthly(ADS_ORG, { query, now: () => t });
  assert.equal(calls.length, 1, "fresco: sem consulta");
  // outra org tem cache próprio
  await orgMonthly(LP_ORG, { query, now: () => t });
  assert.equal(calls.length, 2);
  // vencido: devolve o que tem na hora e recalcula por fora
  t += 3 * 3_600_000 + 1;
  const failing = async () => { calls.push("fail"); throw new Error("offline"); };
  const stale = await orgMonthly(ADS_ORG, { query: failing, now: () => t });
  assert.deepEqual(stale, a);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.at(-1), "fail");
  // falha não apagou o último bom
  assert.deepEqual(await orgMonthly(ADS_ORG, { query: failing, now: () => t }), a);
  // frio + falha → null (indisponível), sem lançar
  _resetResultsCache();
  assert.equal(await orgMonthly(ADS_ORG, { query: failing, now: () => t }), null);
});

test("régua do deck reaproveitada: o número bate com o texto do card", () => {
  assert.equal(panelMetricNumber("hoursSaved", SNAP), 574780 * 10 / 60);
  assert.equal(panelMetricNumber("costAvoided", SNAP), 574780 * 10 / 60 * 3000 / 220);
  assert.equal(panelMetricValue("hoursSaved", SNAP), "95,8 mil h");
  assert.equal(panelMetricNumber("inventada", SNAP), undefined);
});

test("quais produtos o cliente tem: venda OU org; Mentoria fora; sem nada vale o LeverAds", () => {
  assert.deepEqual(resultProductIds({ products: ["leverads"] }), ["leverads"]);
  assert.deepEqual(resultProductIds({ products: ["leverprice"] }), ["leverprice"]);
  assert.deepEqual(resultProductIds({ products: ["leverprice", "leverads"] }), ["leverads", "leverprice"]);
  assert.deepEqual(resultProductIds({ products: ["mentoria"] }), []);
  assert.deepEqual(resultProductIds({ products: ["mentoria"], leverpriceOrgId: LP_ORG }), ["leverprice"]);
  assert.deepEqual(resultProductIds({ leveradsOrgId: ADS_ORG }), ["leverads"]);
  assert.deepEqual(resultProductIds({ orgId: ADS_ORG }), ["leverads"]);
  assert.deepEqual(resultProductIds({ leverpriceOrgId: LP_ORG }), ["leverprice"]);
  assert.deepEqual(resultProductIds({ planCode: "price_pro" }), ["leverprice"]);
  assert.deepEqual(resultProductIds({}), ["leverads"]);
});

test("cliente só com LeverAds: forma do produto, número influenciado e régua do deck", async () => {
  const app = await appWith({ leveradsOrgId: ADS_ORG, products: ["leverads"] });
  const body = await getResults(app);
  // campos antigos intactos
  assert.equal(body.hasOrg, true);
  assert.deepEqual(body.snapshot, SNAP);
  assert.ok(Array.isArray(body.reports));
  assert.equal(typeof body.blocker, "string");
  assert.match(body.preview, /venderam/);
  assert.equal(body.products.length, 1);
  const p = body.products[0];
  assert.deepEqual(Object.keys(p).sort(), ["asOf", "hero", "id", "label", "metrics", "monthly", "note", "orgId", "partial", "reason", "recent", "since", "status"].sort());
  assert.equal(p.id, "leverads");
  assert.equal(p.label, "LeverAds");
  assert.equal(p.status, "ok");
  assert.equal(p.reason, "");
  assert.equal(p.since, "2026-07-14");
  assert.equal(p.partial, false);
  assert.deepEqual(p.hero, { key: "gmvTotal", label: "vendido pelos anúncios da Lever", value: SNAP.gmvTotal, format: "money", period: "desde o início" });
  assert.deepEqual(p.metrics.map((m) => [m.key, m.format]), [["ordersTotal", "int"], ["hoursSaved", "hours"], ["costAvoided", "money"]]);
  assert.equal(p.metrics[1].value, Math.round(panelMetricNumber("hoursSaved", SNAP) * 100) / 100);
  assert.equal(p.metrics[2].value, Math.round(panelMetricNumber("costAvoided", SNAP) * 100) / 100);
  assert.deepEqual(p.recent.items.map((i) => i.key), ["leverGmv", "leverOrders", "storeGmv", "leverShare"]);
  assert.deepEqual(p.recent.items[0], { key: "leverGmv", label: "vendido pelos anúncios da Lever", format: "money", current: 24000, previous: 5000 });
  assert.equal(p.recent.items[3].current, 26.7);
  assert.equal(p.recent.items[3].previous, 12.5);
  assert.deepEqual(p.monthly.series.map((s) => [s.key, s.role]), [["storeGmv", "context"], ["leverGmv", "main"], ["leverOrders", "extra"]]);
  assert.equal(p.monthly.rows.length, 12);
  assert.deepEqual(p.monthly.rows.at(-1), { month: "2026-11", storeGmv: 30000, leverGmv: 9000, leverOrders: 30 });
  assert.match(p.note, /10 min por anúncio/);
  assert.match(p.note, /R\$ 3\.000 por 220 h/);
  assert.match(p.note, /14\/07\/2026/);
  // o GMV da loja nunca é o hero nem uma métrica de resultado
  assert.ok(!p.metrics.some((m) => /storeGmv/.test(m.key)));
  await app.close();
});

test("cliente só com LeverPrice: rebate em destaque, 30 × 30 e meses zerados", async () => {
  const app = await appWith({ leverpriceOrgId: LP_ORG, products: ["leverprice"] });
  const body = await getResults(app);
  assert.equal(body.hasOrg, false);
  assert.equal(body.blocker, "sem org da LeverAds no cadastro");
  assert.equal(body.products.length, 1);
  const p = body.products[0];
  assert.equal(p.id, "leverprice");
  assert.equal(p.label, "LeverPrice");
  assert.equal(p.status, "ok");
  assert.equal(p.since, "2026-03-02");
  assert.equal(p.partial, true);
  assert.equal(p.asOf, "2026-11-05T15:00:00.000Z");
  assert.deepEqual(p.hero, { key: "sales", label: "vendido com preço do LeverPrice", value: 250000.5, format: "money", period: "desde 02/03/2026" });
  assert.deepEqual(p.metrics.map((m) => m.key), ["rebate", "orders", "automaticPromotions"]);
  assert.equal(p.metrics[0].value, 18000.25);
  assert.equal(p.metrics[2].period, "últimos 30 dias");
  assert.deepEqual(p.recent.items.map((i) => [i.key, i.current, i.previous]), [
    ["sales", 40000, 30000], ["rebate", 3000, 2500], ["orders", 200, 150],
    ["automaticPromotions", 14, null], ["automaticPriceChanges", 320, null],
  ]);
  assert.deepEqual(p.monthly.series.map((s) => [s.key, s.role]), [["sales", "main"], ["rebate", "extra"], ["orders", "extra"]]);
  assert.equal(p.monthly.rows.length, 12);
  assert.deepEqual(p.monthly.rows[0], { month: "2025-12", sales: 0, rebate: 0, orders: 0 });
  assert.deepEqual(p.monthly.rows.at(-2), { month: "2026-10", sales: 38000, rebate: 2900, orders: 190 });
  assert.match(p.note, /2 de 3 contas sincronizadas/);
  await app.close();
});

test("LeverPrice sem `since` cai em 'nos últimos N meses'", () => {
  const p = leverpriceResultProduct({ orgId: LP_ORG, data: { ...LP_BODY, since: null, partial: false }, at: NOW });
  assert.equal(p.hero.period, "nos últimos 12 meses");
  assert.equal(p.since, null);
  assert.doesNotMatch(p.note, /Parcial/);
});

test("cliente com os dois produtos: os dois em paralelo, e a falha de um não derruba o outro", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const order = [];
  const app = await appWith({ leveradsOrgId: ADS_ORG, leverpriceOrgId: LP_ORG, products: ["leverads", "leverprice", "mentoria"] }, {
    monthly: async () => { order.push("ads"); await gate; throw new Error("banco fora"); },
    leverprice: async () => { order.push("lp"); release(); return { status: "ok", data: LP_BODY, at: NOW }; },
  });
  const body = await getResults(app);
  assert.deepEqual(order, ["ads", "lp"], "LeverPrice começou antes do LeverAds terminar");
  assert.deepEqual(body.products.map((p) => [p.id, p.status]), [["leverads", "ok"], ["leverprice", "ok"]]);
  const ads = body.products[0];
  assert.equal(ads.partial, true, "sem o mês a mês, o retrato ainda serve");
  assert.equal(ads.hero.value, SNAP.gmvTotal);
  assert.deepEqual(ads.monthly, { series: [], rows: [] });
  await app.close();

  // LeverAds inteiro fora (retrato e mês a mês) + LeverPrice ok
  const app2 = await appWith({ leveradsOrgId: ADS_ORG, leverpriceOrgId: LP_ORG }, {
    snapshot: async () => { throw new Error("fora"); },
    monthly: async () => null,
  });
  const b2 = await getResults(app2);
  assert.equal(b2.hasOrg, true);
  assert.equal(b2.snapshot, null);
  assert.deepEqual(b2.products.map((p) => [p.id, p.status]), [["leverads", "indisponivel"], ["leverprice", "ok"]]);
  assert.ok(b2.products[0].reason);
  await app2.close();

  // LeverPrice lançando não derruba a resposta
  const app3 = await appWith({ leveradsOrgId: ADS_ORG, leverpriceOrgId: LP_ORG }, {
    leverprice: async () => { throw new Error("bug"); },
  });
  const b3 = await getResults(app3);
  assert.deepEqual(b3.products.map((p) => [p.id, p.status]), [["leverads", "ok"], ["leverprice", "indisponivel"]]);
  await app3.close();
});

test("sem vínculo: produto vendido sem org vira sem_vinculo com o motivo", async () => {
  const app = await appWith({ products: ["leverads", "leverprice"] });
  const body = await getResults(app);
  assert.deepEqual(body.products.map((p) => [p.id, p.status, p.reason]), [
    ["leverads", "sem_vinculo", "sem org da LeverAds no cadastro"],
    ["leverprice", "sem_vinculo", "sem conta do LeverPrice vinculada"],
  ]);
  for (const p of body.products) {
    assert.equal(p.hero, null);
    assert.deepEqual(p.metrics, []);
    assert.deepEqual(p.recent, { days: 30, items: [] });
    assert.deepEqual(p.monthly, { series: [], rows: [] });
  }
  await app.close();
});

test("org só em `orgId` (LeverId) vale para o LeverAds em products, sem mexer nos campos antigos", async () => {
  const seen = [];
  const app = await appWith({ orgId: ADS_ORG }, { snapshot: async (ids) => { seen.push(ids); return new Map(ids.map((id) => [id, SNAP])); } });
  const body = await getResults(app);
  assert.equal(body.hasOrg, false);
  assert.equal(body.snapshot, null);
  assert.equal(body.products[0].status, "ok");
  assert.equal(body.products[0].orgId, ADS_ORG);
  assert.deepEqual(seen, [[ADS_ORG]], "uma leitura só do retrato");
  await app.close();
});

test("rota usa o plano do catálogo do produto para descobrir o LeverPrice", async () => {
  const app = await appWith({ planCode: "pacote_x", leverpriceOrgId: "" }, { plans: [{ id: "pl1", saas: "sa", code: "pacote_x", product: "leverprice" }] });
  const body = await getResults(app);
  assert.deepEqual(body.products.map((p) => [p.id, p.status]), [["leverprice", "sem_vinculo"]]);
  await app.close();
});

test("cliente do LeverPrice: sem chave, 404, erro e timeout viram indisponível com motivo", async () => {
  _resetLeverpriceResultsCache();
  const semChave = await leverpriceResults(LP_ORG, { client: lpClient(okFetch(), "") });
  assert.deepEqual(semChave, { status: "indisponivel", reason: NOT_CONFIGURED_REASON });
  const quiet = { warn() {} };
  const r404 = await leverpriceResults(LP_ORG, { client: lpClient(statusFetch(404)), log: quiet });
  assert.deepEqual(r404, { status: "indisponivel", reason: "org não encontrada no LeverPrice" });
  const r401 = await leverpriceResults(LP_ORG, { client: lpClient(statusFetch(401)), log: quiet });
  assert.equal(r401.reason, "o LeverPrice recusou a chave do Cockpit");
  const r500 = await leverpriceResults(LP_ORG, { client: lpClient(statusFetch(503)), log: quiet });
  assert.equal(r500.reason, "LeverPrice indisponível agora");
  const caiu = await leverpriceResults(LP_ORG, { client: lpClient(async () => { throw new TypeError("fetch failed"); }), log: quiet });
  assert.equal(caiu.reason, "não consegui falar com o LeverPrice");
  const lento = makeLeverpriceResultsClient({
    baseUrl: "https://lp.test", serviceKey: "k", timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
  });
  const timeout = await leverpriceResults(LP_ORG, { client: lento, log: quiet });
  assert.equal(timeout.reason, "o LeverPrice não respondeu a tempo");
  const lixo = await leverpriceResults("nao-e-uuid", { client: lpClient(okFetch()) });
  assert.equal(lixo.status, "indisponivel");
});

test("cliente do LeverPrice: URL, header da chave, cache por org de 1 h e último bom na falha", async () => {
  _resetLeverpriceResultsCache();
  const calls = [];
  let t = NOW;
  const quiet = { warn() {} };
  const r = await leverpriceResults(LP_ORG.toUpperCase(), { client: lpClient(okFetch(LP_BODY, calls)), now: () => t });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.data, LP_BODY);
  assert.equal(calls[0].url, `https://lp.test/api/service/cockpit/orgs/${LP_ORG}/results?months=12`);
  assert.equal(calls[0].opts.headers["X-Cockpit-Service-Key"], "k");
  assert.ok(calls[0].opts.signal, "timeout curto via AbortSignal");
  await leverpriceResults(LP_ORG, { client: lpClient(okFetch(LP_BODY, calls)), now: () => t });
  assert.equal(calls.length, 1, "fresco: sem chamada");
  // vencido + LeverPrice fora: devolve o último bom (stale), sem lançar
  t += 3_600_000 + 1;
  const stale = await leverpriceResults(LP_ORG, { client: lpClient(statusFetch(500)), now: () => t, log: quiet });
  assert.equal(stale.status, "ok");
  assert.equal(stale.stale, true);
  await new Promise((res) => setImmediate(res));
  const ainda = await leverpriceResults(LP_ORG, { client: lpClient(statusFetch(500)), now: () => t, log: quiet });
  assert.equal(ainda.status, "ok");
  assert.deepEqual(ainda.data, LP_BODY);
});

test("rota com o cliente real do LeverPrice injetado: 404 vira indisponível e o LeverAds segue", async () => {
  _resetLeverpriceResultsCache();
  const app = await appWith({ leveradsOrgId: ADS_ORG, leverpriceOrgId: LP_ORG }, {
    leverprice: (org, opts) => leverpriceResults(org, { ...opts, client: lpClient(statusFetch(404)), log: { warn() {} } }),
  });
  const body = await getResults(app);
  assert.deepEqual(body.products.map((p) => [p.id, p.status, p.reason]), [
    ["leverads", "ok", ""],
    ["leverprice", "indisponivel", "org não encontrada no LeverPrice"],
  ]);
  assert.equal(body.products[1].orgId, LP_ORG);
  await app.close();
});

test("LeverAds sem retrato nem mês a mês é indisponível; só sem retrato mostra o total como sem dado", () => {
  assert.equal(leveradsResultProduct({ orgId: ADS_ORG }).status, "indisponivel");
  const m = { orgId: ADS_ORG, asOf: new Date(NOW).toISOString(), ...monthlyFromRows(MONTH_ROWS, { at: NOW }) };
  const p = leveradsResultProduct({ orgId: ADS_ORG, monthly: m });
  assert.equal(p.status, "ok");
  assert.equal(p.partial, true);
  assert.equal(p.hero.value, null);
  assert.ok(p.metrics.every((x) => x.value === null));
  assert.equal(p.recent.items[0].current, 24000);
});
