// Venda de parceiro (26/11/2026): a Segunda Venda também vende o LeverPrice e
// um negócio pode ter um VENDEDOR EXTERNO no lugar do closer. Contrato que o
// CRM novo copia pelo espelho: `lead.partner` (id de product.partners) e
// `lead.partnerSeller` (nome). O ganho vira cliente/assinatura normal e entra
// no caixa, mas sai da meta, do placar e da remuneração, como a conta grande,
// e volta no balde `partnerSale`.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { partnerPatch } from "../src/crm/lead-partner.js";
import { isPartnerSaleLead, partnerSaleOf } from "../src/metrics/metrics-core.js";
import { ensurePartnersSeed, PARTNER_SEED } from "../src/platform/migrations.js";
import { stampCompMonth, monthPersonId } from "../src/comp/comp-months.js";

const { registerRoutes } = await import("../src/routes.js");
const { registerMetasRoutes } = await import("../src/metrics/routes.metas.js");

const PARTNERS = [{ id: "segunda_venda", label: "Segunda Venda" }];
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function crudApp(product = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, partners: PARTNERS, ...product });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("isPartnerSaleLead: ter parceiro é ser venda de parceiro; vazio não é", () => {
  assert.equal(isPartnerSaleLead({ partner: "segunda_venda" }), true);
  assert.equal(isPartnerSaleLead({ partner: "  " }), false);
  assert.equal(isPartnerSaleLead({ partnerSeller: "Marcos" }), false);
  assert.equal(isPartnerSaleLead(null), false);
  const b = partnerSaleOf([{ partner: "segunda_venda", partnerSeller: "Marcos", amount: 5000 }, { amount: 7000 }], (l) => l.amount, { partners: PARTNERS });
  assert.deepEqual(b, { count: 1, revenue: 5000, partners: ["Segunda Venda"], sellers: ["Marcos"] });
  assert.equal(partnerSaleOf([{ amount: 1 }], (l) => l.amount, {}), null);
});

test("partnerPatch: parceiro da lista, vendedor só com parceiro, tirar o parceiro limpa o vendedor", () => {
  const product = { partners: PARTNERS };
  assert.deepEqual(partnerPatch({ partner: " segunda_venda ", partnerSeller: " Marcos " }, { product }).patch, { partner: "segunda_venda", partnerSeller: "Marcos" });
  assert.match(partnerPatch({ partner: "outro" }, { product }).error, /não está na lista de parceiros/);
  assert.match(partnerPatch({ partnerSeller: "Marcos" }, { product }).error, /só vale com o parceiro/);
  assert.match(partnerPatch({ partner: 3 }, { product }).error, /id de uma opção/);
  assert.deepEqual(partnerPatch({ partner: "" }, { product, current: { partner: "segunda_venda", partnerSeller: "Marcos" } }).patch, { partner: "", partnerSeller: "" });
  assert.deepEqual(partnerPatch({ partner: null, partnerSeller: null }, { product }).patch, { partner: "", partnerSeller: "" });
  // Vendedor novo num lead que já tem parceiro: passa sem reenviar o parceiro.
  assert.deepEqual(partnerPatch({ partnerSeller: "Ana" }, { product, current: { partner: "segunda_venda" } }).patch, { partnerSeller: "Ana" });
  // Parceiro que saiu da lista depois continua valendo no lead que já tinha.
  assert.deepEqual(partnerPatch({ partner: "antigo", partnerSeller: "Zé" }, { product, current: { partner: "antigo" } }).patch, { partner: "antigo", partnerSeller: "Zé" });
  assert.deepEqual(partnerPatch({ name: "x" }, { product }).patch, {});
});

test("POST/PATCH do lead validam parceiro e vendedor (400 em pt-BR)", async () => {
  const { app, repo } = await crudApp();
  const bad = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Loja", saas: "leverads", partner: "nao_existe" } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /não está na lista de parceiros do produto/);
  const solto = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Loja", saas: "leverads", partnerSeller: "Marcos" } });
  assert.equal(solto.statusCode, 400);
  assert.match(solto.json().error, /O nome do vendedor só vale com o parceiro/);

  const ok = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Loja", saas: "leverads", partner: "segunda_venda", partnerSeller: " Marcos " } });
  assert.equal(ok.statusCode, 201);
  const id = ok.json().id;
  assert.equal((await repo.get("leads", id)).partnerSeller, "Marcos");

  const p1 = await app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: { partner: "outro" } });
  assert.equal(p1.statusCode, 400);
  assert.equal((await repo.get("leads", id)).partner, "segunda_venda", "nada gravado no 400");
  const p2 = await app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: { partner: "" } });
  assert.equal(p2.statusCode, 200);
  const off = await repo.get("leads", id);
  assert.deepEqual([off.partner, off.partnerSeller], ["", ""], "desligar a venda de parceiro limpa o vendedor");
  const p3 = await app.inject({ method: "PATCH", url: `/api/leads/${id}`, payload: { partnerSeller: "Marcos" } });
  assert.equal(p3.statusCode, 400, "vendedor sem parceiro no lead");

  // Lead sem parceiro nasce com os campos vazios (contrato do espelho).
  const plain = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Outra", saas: "leverads" } });
  assert.deepEqual([plain.json().partner, plain.json().partnerSeller], ["", ""]);
  await app.close();
});

test("venda de parceiro fecha sem closer: Integração cria cliente e assinatura como qualquer venda", async () => {
  const { app, repo } = await crudApp();
  await repo.create("users", { id: "int", name: "Iara", roles: ["integrator"] });
  await repo.create("leads", { id: "lp", saas: "leverads", name: "Loja Parceira", stage: "Qualificando", owner: "", closer: "", partner: "segunda_venda", partnerSeller: "Marcos", createdAt: "2026-11-20T12:00:00.000Z" });
  const r = await app.inject({ method: "PATCH", url: "/api/leads/lp", payload: {
    stage: "Integração", amount: 5988, planClosed: "anual", paymentMethod: "pix", dealProduct: "price_essencial", integrator: "int",
    partner: "segunda_venda", partnerSeller: "Marcos",
  } });
  assert.equal(r.statusCode, 200);
  const lead = await repo.get("leads", "lp");
  assert.ok(lead.customerId, "virou cliente");
  assert.ok(lead.wonAt, "venda carimbada");
  assert.equal(lead.closer, "", "sem closer");
  assert.equal(lead.partner, "segunda_venda");
  const customer = await repo.get("customers", lead.customerId);
  assert.ok(customer, "cliente criado");
  assert.ok((await repo.list("subscriptions")).some((s) => s.customer === lead.customerId), "assinatura criada");
  await app.close();
});

// Placar, meta e remuneração: a venda de parceiro sai como a conta grande e
// volta no balde próprio. O mesmo mês com uma venda do time e uma do parceiro.
async function metricsRepo() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, partners: PARTNERS, monthlyCashTarget: 100000, monthlyContractsTarget: 20 });
  await repo.create("users", { id: "jon", name: "Jonathan", roles: ["closer"], compLevel: 1 });
  await repo.create("users", { id: "sara", name: "Sara", roles: ["sdr"], compLevel: 1 });
  const sale = async (id, extra) => {
    await repo.create("customers", { id: `c_${id}`, saas: "leverads", name: `Cliente ${id}`, leadId: id, startedAt: "2026-09-10T12:00:00.000Z", paymentMethod: "pix" });
    await repo.create("leads", { id, saas: "leverads", stage: "Ganho", customerId: `c_${id}`, wonAt: "2026-09-10T12:00:00.000Z", paymentMethod: "pix", createdAt: "2026-09-01T12:00:00.000Z", ...extra });
  };
  await sale("l_time", { closer: "jon", owner: "sara", amount: 7000 });
  // Venda de parceiro com closer e SDR preenchidos: mesmo assim não é deles.
  await sale("l_par", { closer: "jon", owner: "sara", amount: 5000, partner: "segunda_venda", partnerSeller: "Marcos" });
  return repo;
}

test("placar: venda de parceiro fora do closer, do SDR e do time; volta em partnerSale", async () => {
  const repo = await metricsRepo();
  const app = Fastify();
  registerRoutes(app, repo, { scoreboard: { now: () => new Date("2026-09-20T15:00:00.000Z") } });
  const sb = (await app.inject({ url: "/api/scoreboard/leverads?since=2026-09-01&until=2026-09-30" })).json();
  const jon = sb.closer.find((c) => c.user === "jon");
  assert.equal(jon.won, 1, "só a venda do time");
  assert.equal(jon.revenue, 7000);
  assert.deepEqual([jon.partnerWon, jon.partnerRevenue], [1, 5000]);
  assert.deepEqual([jon.keyWon, jon.keyRevenue], [0, 0], "não cai no balde da conta grande");
  const sara = sb.sdr.find((c) => c.user === "sara");
  assert.equal(sara.won, 1);
  assert.equal(sara.revenue, 7000);
  assert.deepEqual([sara.partnerWon, sara.partnerRevenue], [1, 5000]);
  assert.equal(sb.team.won, 1);
  assert.equal(sb.team.revenue, 7000);
  assert.deepEqual(sb.team.partnerSale, { won: 1, revenue: 5000, partners: ["Segunda Venda"], sellers: ["Marcos"] });
  assert.equal(sb.team.keyAccount, null);
  await app.close();
});

test("venda de parceiro que também é conta grande conta só como venda de parceiro", async () => {
  const repo = await metricsRepo();
  await repo.update("customers", "c_l_par", { keyAccount: true });
  assert.equal((await repo.get("customers", "c_l_par")).keyAccount, true);
  const app = Fastify();
  registerRoutes(app, repo, { scoreboard: { now: () => new Date("2026-09-20T15:00:00.000Z") } });
  const sb = (await app.inject({ url: "/api/scoreboard/leverads?since=2026-09-01&until=2026-09-30" })).json();
  assert.equal(sb.team.keyAccount, null);
  assert.equal(sb.team.partnerSale.won, 1);
  assert.equal(sb.team.won, 1);
  await app.close();
});

test("meta do mês (pace e histórico): vendido sem a venda de parceiro, que volta no rodapé", async () => {
  const repo = await metricsRepo();
  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => new Date("2026-09-20T15:00:00.000Z") } });
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(pace.sale.sold, 7000);
  assert.equal(pace.contracts.sold, 1);
  assert.deepEqual(
    [pace.partnerSale.count, pace.partnerSale.revenue, pace.partnerSale.soldWith, pace.partnerSale.countWith, pace.partnerSale.partners],
    [1, 5000, 12000, 2, ["Segunda Venda"]],
  );
  await app.close();

  const metas = Fastify();
  registerMetasRoutes(metas, repo, { now: () => new Date("2026-10-07T15:00:00Z") });
  const h = (await metas.inject({ url: "/api/metas/leverads/history" })).json();
  const set = h.months.find((m) => m.month === "2026-09");
  assert.equal(set.sold, 7000);
  assert.equal(set.soldN, 1);
  assert.deepEqual([set.partnerSale.count, set.partnerSale.revenue, set.partnerSale.sellers], [1, 5000, ["Marcos"]]);
  assert.equal(h.months.find((m) => m.month === "2026-10").partnerSale, null);
  await metas.close();
});

test("ticket médio do mês anterior ignora a venda de parceiro", async () => {
  const repo = await metricsRepo();
  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => new Date("2026-10-13T15:00:00.000Z") } });
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.deepEqual(pace.context.previousMonth, { month: "2026-09", sold: 7000, soldN: 1, ticket: 7000 });
  await app.close();
});

test("remuneração: o carimbo do mês do closer não conta a venda de parceiro", async () => {
  const repo = await metricsRepo();
  await stampCompMonth(repo, { id: "leverads", name: "LeverAds", monthlyCashTarget: 100000, monthlyContractsTarget: 20 }, "2026-09", { now: new Date(Date.UTC(2026, 9, 2, 13)) });
  const jon = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "jon", "closer"));
  assert.equal(jon.won, 1);
  assert.equal(jon.revenue, 7000);
});

test("caixa segue cheio: o pagamento da venda de parceiro entra no recebido do mês", async () => {
  const repo = await metricsRepo();
  for (const [id, amount] of [["c_l_time", 7000], ["c_l_par", 5000]]) {
    await repo.create("invoices", { id: `i_${id}`, saas: "leverads", customer: id, status: "paid", amount, paidAt: "2026-09-12T12:00:00.000Z", mpPaymentId: `mp_${id}` });
  }
  const app = Fastify();
  registerRoutes(app, repo, {
    scoreboard: { now: () => new Date("2026-09-20T15:00:00.000Z") },
    pipelinePace: { now: () => new Date("2026-09-20T15:00:00.000Z") },
  });
  const sb = (await app.inject({ url: "/api/scoreboard/leverads?since=2026-09-01&until=2026-09-30" })).json();
  assert.equal(sb.team.won, 1, "a venda sai do resultado do time…");
  assert.equal(sb.team.cash.novos, 12000, "…mas o dinheiro dela entra no caixa");
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(pace.cash.collected, 12000);
  await app.close();
});

test("migração de boot: semeia a Segunda Venda no LeverAds uma vez e respeita a remoção manual", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", partners: [{ id: "outro", label: "Outro" }] });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids" });
  assert.equal(await ensurePartnersSeed(repo), 1);
  const p = await repo.get("products", "leverads");
  assert.deepEqual(p.partners, [{ id: "outro", label: "Outro" }, PARTNER_SEED], "preserva a lista e acrescenta");
  assert.equal(p.partnersSeedV1, true);
  assert.equal((await repo.get("products", "uniquekids")).partners, undefined, "só o produto que vende o LeverPrice");
  assert.equal(await ensurePartnersSeed(repo), 0, "idempotente");
  assert.equal((await repo.get("products", "leverads")).partners.length, 2, "não duplica");
  await repo.update("products", "leverads", { partners: [] });
  assert.equal(await ensurePartnersSeed(repo), 0);
  assert.deepEqual((await repo.get("products", "leverads")).partners, [], "remoção manual não volta");
});
