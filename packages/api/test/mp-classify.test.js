// Classificação do espelho do Mercado Pago: o que é VENDA de cliente e o que
// é dinheiro da própria casa, saída paga com o saldo ou ruído. Antes tudo que
// o /search devolvia "approved" somava como recebido (R$ 573 mil de reserva
// interna em ago+set/2026). Cobre: classificação pela API (collector/payer),
// heurística sem id da conta, ingest que não casa nem baixa o que não é venda,
// reclassificação pelo poller, e as réguas que só somam isMpSale.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { classifyMpPayment, isMpSale, scrubMpOwnDoc, MP_OWN_DOC } = await import("../src/payments/mp-classify.js");
const { ingestMpPayment, runMpSync } = await import("../src/payments/mp-payments.js");
const { card12xBaseIn, mpFeesIn, cashReceivedByCustomer } = await import("../src/metrics/metrics-core.js");
const { makeMp } = await import("../src/payments/mp.js");
const { registerRoutes } = await import("../src/routes.js");

const ME = "123456";
const raw = (over = {}) => ({
  id: 1, status: "approved", operation_type: "regular_payment", transaction_amount: 1000,
  transaction_details: { net_received_amount: 900 },
  payment_method_id: "master", payment_type_id: "credit_card", installments: 12,
  collector_id: Number(ME), payer: { id: 999, email: "cliente@x.com", first_name: "Cliente", last_name: "Um" },
  description: "Lever OEM · Essencial", external_reference: "",
  date_created: "2026-09-10T10:00:00.000Z", date_approved: "2026-09-10T10:01:00.000Z",
  ...over,
});

test("API: cliente paga e nós recebemos = venda; nós pagamos = saída; nós ↔ nós = interna; maquininha = maquininha", () => {
  assert.equal(classifyMpPayment(raw(), { collectorId: ME }).kind, "venda");
  assert.equal(classifyMpPayment(raw(), { collectorId: ME }).kindSource, "api");
  // DARF pago com o saldo: pagador somos nós, recebedor é outro.
  const out = classifyMpPayment(raw({ payer: { id: Number(ME) }, collector_id: 777, description: "DARF - CÓDIGO DE BARRA" }), { collectorId: ME });
  assert.deepEqual([out.kind, out.direction], ["saida", "out"]);
  // Reserva (POTS): pagador e recebedor somos nós.
  const pots = classifyMpPayment(raw({ payer: { id: Number(ME), email: "lever@netair.com.br" }, external_reference: "POTS_abc_1_0", payment_type_id: "account_money" }), { collectorId: ME });
  assert.equal(pots.kind, "interna");
  // Point: venda presencial.
  assert.equal(classifyMpPayment(raw({ operation_type: "pos_payment", description: "Venda presencial", payer: { id: 5, email: "ventapresencialmlb@gmail.com" } }), { collectorId: ME }).kind, "maquininha");
  // Compra de dólar: nós pagamos, descrição de ruído.
  assert.equal(classifyMpPayment(raw({ payer: { id: Number(ME) }, collector_id: 42, description: "BUY-MUSD" }), { collectorId: ME }).kind, "ruido");
  // Cashback do Mercado Livre: entra, mas não é cliente.
  assert.equal(classifyMpPayment(raw({ payer: { id: 7, email: "mlb_cashbacks_point_negocio@mercadolibre.com" } }), { collectorId: ME }).kind, "ruido");
});

test("heurística (sem id da conta): casa/POTS = interna, DARF/OpenAI = saída, maquininha, resto = venda", () => {
  const h = (over) => classifyMpPayment({ status: "approved", amount: 100, ...over }, {});
  assert.equal(h({ payerDoc: "67.931.740/0001-12" }).kind, "interna");
  assert.equal(h({ payerEmail: "lever@netair.com.br", externalReference: "POTS_x" }).kind, "interna");
  assert.equal(h({ description: "Openai *chatgpt subscr" }).kind, "saida");
  assert.equal(h({ description: "Venda presencial" }).kind, "maquininha");
  assert.equal(h({ description: "BUY-MUSD" }).kind, "ruido");
  const v = h({ payerName: "Fulano", description: "Lever OEM · Essencial" });
  assert.deepEqual([v.kind, v.kindSource], ["venda", "heuristic"]);
});

test("CNPJ do próprio Mercado Pago não é documento de pagador", () => {
  assert.deepEqual(scrubMpOwnDoc({ payerDoc: "10.573.521/0001-91", payerName: "" }), { payerDoc: "", payerDocMp: true, payerName: "" });
  assert.equal(scrubMpOwnDoc({ payerDoc: "34231275000158" }), null);
  // Razão social do MP que a BrasilAPI devolveu pra esse CNPJ também sai.
  assert.equal(scrubMpOwnDoc({ payerDoc: MP_OWN_DOC, cnpjLookup: true, payerName: "MERCADO PAGO INSTITUICAO DE PAGAMENTO LTDA" }).payerName, "");
});

test("isMpSale: só venda/maquininha aprovadas e não ignoradas; doc sem kind (legado) conta", () => {
  assert.equal(isMpSale({ status: "approved" }), true);
  assert.equal(isMpSale({ status: "approved", kind: "venda" }), true);
  assert.equal(isMpSale({ status: "approved", kind: "maquininha" }), true);
  assert.equal(isMpSale({ status: "approved", kind: "interna" }), false);
  assert.equal(isMpSale({ status: "approved", kind: "venda", finIgnored: true }), false);
  assert.equal(isMpSale({ status: "rejected", kind: "venda" }), false);
});

test("ingest: reserva interna com o e-mail da conta NÃO casa com cliente de mesmo e-mail nem baixa fatura", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Casa", email: "lever@netair.com.br" });
  await repo.create("invoices", { id: "in1", saas: "leverads", customer: "c1", status: "open", amount: 1000, dueDate: "2026-09-10" });
  const r = await ingestMpPayment(repo, raw({ payer: { id: Number(ME), email: "lever@netair.com.br" }, external_reference: "POTS_x_1" }), { collectorId: ME });
  assert.equal(r.payment.kind, "interna");
  assert.equal(r.matched, false);
  assert.equal(r.settledNow, null);
  assert.equal((await repo.get("invoices", "in1")).status, "open");
  // Venda de verdade com o mesmo valor casa pelo e-mail do cliente e baixa.
  await repo.update("customers", "c1", { email: "cliente@x.com" });
  const v = await ingestMpPayment(repo, raw({ id: 2 }), { collectorId: ME });
  assert.equal(v.payment.kind, "venda");
  assert.equal(v.payment.feeAmount, 100);
  assert.equal(v.settledNow, "in1");
});

test("ingest: classificação forte da API não regride pra heurística quando o search vem magro", async () => {
  const repo = makeMemRepo();
  const full = raw({ id: 3, payer: { id: Number(ME), email: "" }, collector_id: 42, description: "" });
  await ingestMpPayment(repo, full, { collectorId: ME });
  assert.equal((await repo.get("mp_payments", "mpp_3")).kind, "saida");
  // Mesmo pagamento, agora sem payer.id/collector (doc magro) → fica saída.
  await ingestMpPayment(repo, { ...full, payer: { email: "" }, collector_id: undefined }, { collectorId: "" });
  const d = await repo.get("mp_payments", "mpp_3");
  assert.deepEqual([d.kind, d.kindSource], ["saida", "api"]);
});

test("réguas: card12xBaseIn, mpFeesIn e cashReceivedByCustomer ignoram interna/saída/ignorado", () => {
  const month = "2026-09";
  const mp = [
    { mpId: "1", status: "approved", kind: "venda", methodType: "credit_card", amount: 1000, feeAmount: 100, dateApproved: "2026-09-10T10:00:00Z", customer: "c1" },
    { mpId: "2", status: "approved", kind: "interna", methodType: "account_money", amount: 50000, dateApproved: "2026-09-10T10:00:00Z", customer: "c1" },
    { mpId: "3", status: "approved", kind: "venda", methodType: "credit_card", amount: 2000, netAmount: 1800, dateApproved: "2026-09-12T10:00:00Z", finIgnored: true, customer: "c1" },
    { mpId: "4", status: "approved", kind: "maquininha", methodType: "credit_card", amount: 500, feeAmount: 25, dateApproved: "2026-09-12T10:00:00Z", customer: "c1" },
    { mpId: "5", status: "approved", kind: "venda", methodType: "credit_card", amount: 300, dateApproved: "2026-09-12T10:00:00Z", customer: "c1" }, // sem líquido: fallback %
  ];
  assert.equal(card12xBaseIn(mp, month), 1800);
  assert.equal(mpFeesIn(mp, month), 125);
  assert.equal(mpFeesIn(mp, month, { fallbackPct: 10 }), 155);
  const cash = cashReceivedByCustomer({ customers: [{ id: "c1" }], mpPayments: mp, invoices: [] });
  assert.equal(cash.get("c1"), 1800);
});

test("runMpSync: resolve o id da conta (GET /users/me, carimbado em app_config) e reclassifica o espelho antigo", async () => {
  const repo = makeMemRepo();
  // Espelho antigo: doc da reserva classificado por heurística como venda (sem kind).
  await repo.create("mp_payments", { id: "mpp_9", mpId: "9", status: "approved", amount: 50000, payerName: "x", payerBank: "y", methodType: "account_money", dateApproved: "2026-09-10T10:00:00Z" });
  const calls = [];
  const fetch = async (url) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path === "/users/me") return { status: 200, text: async () => JSON.stringify({ id: Number(ME), nickname: "LEVER" }) };
    if (path === "/v1/payments/search") return { status: 200, text: async () => JSON.stringify({ results: [], paging: { total: 0 } }) };
    if (path === "/v1/payments/9") return { status: 200, text: async () => JSON.stringify(raw({ id: 9, payer: { id: Number(ME) }, collector_id: Number(ME), payment_type_id: "account_money", transaction_amount: 50000, external_reference: "POTS_z" })) };
    return { status: 404, text: async () => "{}" };
  };
  const mp = makeMp({ fetch, accessToken: "t" });
  const r = await runMpSync(repo, mp, {});
  assert.equal(r.collectorId, ME);
  assert.equal(r.reclassified, 1);
  assert.equal((await repo.get("app_config", "mp_account")).collectorId, ME);
  const d = await repo.get("mp_payments", "mpp_9");
  assert.deepEqual([d.kind, d.kindSource, d.classV], ["interna", "api", 1]);
  // 2ª passada: id da conta vem do carimbo (sem novo /users/me) e nada a reclassificar.
  const r2 = await runMpSync(repo, mp, {});
  assert.equal(r2.reclassified, 0);
  assert.equal(calls.filter((p) => p === "/users/me").length, 1);
});

test("rotas: /api/mp/payments?kind= filtra e o vínculo manual recusa o que não é venda", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente" });
  await repo.create("mp_payments", { id: "mpp_1", mpId: "1", status: "approved", kind: "venda", amount: 10, dateCreated: "2026-09-01" });
  await repo.create("mp_payments", { id: "mpp_2", mpId: "2", status: "approved", kind: "interna", amount: 20, dateCreated: "2026-09-02" });
  await repo.create("mp_payments", { id: "mpp_3", mpId: "3", status: "approved", amount: 30, dateCreated: "2026-09-03" }); // legado sem kind
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({ accessToken: "t" }) });
  const sale = (await app.inject({ url: "/api/mp/payments?saas=leverads&kind=sale" })).json().payments.map((p) => p.id);
  assert.deepEqual(sale.sort(), ["mpp_1", "mpp_3"]);
  const interna = (await app.inject({ url: "/api/mp/payments?saas=leverads&kind=interna" })).json().payments.map((p) => p.id);
  assert.deepEqual(interna, ["mpp_2"]);
  const res = await app.inject({ method: "POST", url: "/api/mp/payments/mpp_2/link", payload: { customer: "c1" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /movimentação interna/);
  const ok = await app.inject({ method: "POST", url: "/api/mp/payments/mpp_1/link", payload: { customer: "c1" } });
  assert.equal(ok.statusCode, 200);
  await app.close();
});
