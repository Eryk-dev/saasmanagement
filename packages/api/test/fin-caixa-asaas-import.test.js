// Financeiro 17/10/2026: Caixa por conta (saldos em app_config fin_accounts),
// import manual do Asaas chaveado pelo nº da fatura (mesmo doc que a API vai
// completar depois, com migração do id do pagamento na fatura), classificação
// manual/regra que não regride no poller e regra `interna` por banco de origem.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/payments/mp.js");
const { makeAsaas } = await import("../src/payments/asaas.js");
const { makeAppmax } = await import("../src/payments/appmax.js");
const { ingestAsaasPayment, normalizeAsaasImportRow, asaasMirrorId } = await import("../src/payments/asaas-payments.js");
const { ingestMpPayment, ingestMirrorPayment } = await import("../src/payments/mp-payments.js");
const { badRuleReason, ruleMatches } = await import("../src/payments/fin-rules.js");
const { caixaOf, writeFinAccount } = await import("../src/payments/fin-accounts.js");
const { cashIn } = await import("../src/metrics/metrics-core.js");

function fakeFetch(routes) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    const hit = routes[key];
    if (!hit) return { status: 404, text: async () => "{}" };
    const body = typeof hit === "function" ? hit({ query: Object.fromEntries(u.searchParams) }) : hit;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
}
function buildApp(repo, { asaasRoutes = {}, asaasOn = false } = {}) {
  const asaas = makeAsaas({ fetch: fakeFetch(asaasRoutes), apiKey: asaasOn ? "k" : "", webhookToken: "t" });
  const mp = makeMp({ fetch: fakeFetch({}), accessToken: "mp", webhookSecret: "" });
  const app = Fastify();
  registerRoutes(app, repo, { mp, asaas, appmax: makeAppmax({ webhookToken: "" }) });
  return { app, asaas, mp };
}
async function seed(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", name: "Silene", saas: "leverads", email: "silene@x.com", phone: "11985324961", arr: 0 });
  await repo.create("invoices", { id: "inv_s", customer: "c1", saas: "leverads", amount: 299, kind: "renewal", status: "overdue", dueDate: "2026-10-02T12:00:00.000Z", createdAt: "2026-09-02T12:00:00.000Z" });
}

const row = (over = {}) => ({
  invoiceNumber: "898847813", name: "Silene Nunes Siqueira", email: "silene@x.com", cpfCnpj: "", phone: "11985324961",
  billingType: "Cartão de Crédito", status: "Confirmada", dueDate: "02/10/2026", confirmedDate: "05/10/2026", paymentDate: "",
  value: "299,00", netValue: "292,56", description: "Descrição não informada", ...over,
});

test("normalizeAsaasImportRow: dialeto pt-BR do export vira o da API; asaasMirrorId usa o nº da fatura", () => {
  const r = normalizeAsaasImportRow(row());
  assert.equal(r.pmt.id, "inv_898847813");
  assert.equal(r.pmt.invoiceNumber, "898847813");
  assert.equal(r.pmt.billingType, "CREDIT_CARD");
  assert.equal(r.pmt.status, "CONFIRMED");
  assert.equal(r.pmt.value, 299);
  assert.equal(r.pmt.netValue, 292.56);
  assert.equal(r.pmt.dueDate, "2026-10-02");
  assert.equal(r.pmt.confirmedDate, "2026-10-05");
  assert.equal(r.customer.name, "Silene Nunes Siqueira");
  assert.equal(asaasMirrorId({ id: "pay_1", invoiceNumber: "898847813" }), "asa_inv_898847813");
  assert.equal(asaasMirrorId({ id: "pay_1" }), "asa_pay_1");
  assert.match(normalizeAsaasImportRow({ value: "10" }).error, /fatura/);
  assert.equal(normalizeAsaasImportRow(row({ value: "1.234,56" })).pmt.value, 1234.56);
  assert.equal(normalizeAsaasImportRow(row({ status: "Estornada" })).pmt.status, "REFUNDED");
});

test("POST /api/asaas/import: cria asa_inv_*, casa pelo e-mail, baixa a fatura vencida; reimport não dobra; depois a API migra o id", async () => {
  const repo = makeMemRepo();
  const { app, asaas } = buildApp(repo, {
    asaasRoutes: {
      "GET /v3/payments/pay_9": { id: "pay_9", invoiceNumber: "898847813", customer: "cus_1", value: 299, netValue: 292.56, billingType: "CREDIT_CARD", status: "RECEIVED", dateCreated: "2026-10-02", confirmedDate: "2026-10-05", paymentDate: "2026-11-05" },
      "GET /v3/customers/cus_1": { id: "cus_1", name: "Silene Nunes Siqueira", email: "silene@x.com", cpfCnpj: "" },
    },
  });
  await seed(repo);
  const r1 = (await app.inject({ method: "POST", url: "/api/asaas/import", payload: { rows: [row(), { value: "5" }] } })).json();
  assert.equal(r1.created, 1);
  assert.equal(r1.settled, 1);
  assert.equal(r1.errors.length, 1);
  const doc = await repo.get("mp_payments", "asa_inv_898847813");
  assert.equal(doc.gateway, "asaas");
  assert.equal(doc.mpId, "inv_898847813");
  assert.equal(doc.status, "approved");
  assert.equal(doc.customer, "c1");
  assert.equal(doc.invoice, "inv_s");
  assert.equal(doc.feeAmount, 6.44);
  let inv = await repo.get("invoices", "inv_s");
  assert.equal(inv.status, "paid");
  assert.equal(inv.mpPaymentId, "inv_898847813");
  assert.equal(inv.paidGateway, "asaas");
  assert.equal(inv.paidProof.kind, "asaas");

  const r2 = (await app.inject({ method: "POST", url: "/api/asaas/import", payload: { rows: [row()] } })).json();
  assert.equal(r2.created, 0);
  assert.equal(r2.updated, 1);
  assert.equal(r2.settled, 0);
  assert.equal((await repo.list("mp_payments")).length, 1);

  // A API chega (mesmo nº da fatura, id real pay_9): mesmo doc, id migrado na fatura.
  asaas.getPayment = async () => ({ id: "pay_9", invoiceNumber: "898847813", customer: "cus_1", value: 299, netValue: 292.56, billingType: "CREDIT_CARD", status: "RECEIVED", dateCreated: "2026-10-02", confirmedDate: "2026-10-05" });
  const res = await ingestAsaasPayment(repo, asaas, await asaas.getPayment(), {});
  assert.equal(res.payment.id, "asa_inv_898847813");
  assert.equal(res.payment.mpId, "pay_9");
  assert.equal(res.alreadySettled, "inv_s");
  assert.equal((await repo.list("mp_payments")).length, 1);
  inv = await repo.get("invoices", "inv_s");
  assert.equal(inv.mpPaymentId, "pay_9");
  assert.equal(inv.paidProof.mpPaymentId, "pay_9");
  const cash = cashIn({ customers: await repo.list("customers"), invoices: await repo.list("invoices"), mpPayments: await repo.list("mp_payments"), saas: "leverads" });
  assert.equal(cash.total, 299);
  await app.close();
});

test("doc legado asa_pay_* (webhook antes da chave por fatura) migra pro asa_inv_* preservando o vínculo", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  await repo.create("mp_payments", { id: "asa_pay_7", gateway: "asaas", mpId: "pay_7", status: "approved", amount: 100, kind: "venda", customer: "c1", matchedBy: "manual", finIgnored: true, dateCreated: "2026-10-01T15:00:00.000Z", dateApproved: "2026-10-01T15:00:00.000Z" });
  const base = { gateway: "asaas", mirrorId: "asa_inv_555", invoiceNumber: "555", mpId: "pay_7", status: "approved", amount: 100, kind: "venda", direction: "in", kindSource: "api", dateCreated: "2026-10-01T15:00:00.000Z", dateApproved: "2026-10-01T15:00:00.000Z", payerEmail: "", payerName: "" };
  const r = await ingestMirrorPayment(repo, base, {});
  assert.equal(r.payment.id, "asa_inv_555");
  assert.equal(r.payment.customer, "c1");
  assert.equal(r.payment.finIgnored, true);
  assert.equal(await repo.get("mp_payments", "asa_pay_7"), null);
  assert.equal((await repo.list("mp_payments")).length, 1);
});

test("parcelas do export fecham o grupo: 2× 500 confirmadas baixam a fatura presumida de 1.000", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo);
  await seed(repo);
  await repo.create("invoices", { id: "inv_g", customer: "c1", saas: "leverads", amount: 1000, kind: "renewal", status: "paid", paidAt: "2026-09-17T12:00:00.000Z", periodStart: "2026-09-17T12:00:00.000Z", dueDate: "2026-09-17T12:00:00.000Z", paidProof: { kind: "closing", at: "2026-09-17T12:00:00.000Z" }, createdAt: "2026-09-17T12:00:00.000Z" });
  const rows = [1, 2].map((n) => row({ invoiceNumber: `9000${n}`, value: "500,00", netValue: "485,00", installmentNumber: String(n), installmentCount: "2", installmentGroup: "imp_900", description: `Parcela ${n} de 2`, confirmedDate: "17/09/2026", dueDate: `17/${n === 1 ? "09" : "10"}/2026` }));
  const r = (await app.inject({ method: "POST", url: "/api/asaas/import", payload: { rows } })).json();
  assert.equal(r.created, 2);
  const a = await repo.get("mp_payments", "asa_inv_90001");
  assert.equal(a.installmentId, "imp_900");
  assert.equal(a.installmentTotal, 1000);
  assert.equal(a.installmentAllPaid, true);
  assert.equal(a.installments, 2);
  const inv = await repo.get("invoices", "inv_g");
  assert.equal(inv.paidProof.kind, "asaas");
  assert.equal(inv.paidProof.confirmedFrom, "closing");
  assert.equal(inv.mpPaymentId, "inv_90001");
  const cash = cashIn({ customers: await repo.list("customers"), invoices: await repo.list("invoices"), mpPayments: await repo.list("mp_payments"), saas: "leverads" });
  assert.equal(cash.total, 1000);
  assert.equal(cash.presumido.n, 0);
  await app.close();
});

test("kind manual/regra não regride no poller; regra `interna` por banco de origem", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const pmt = { id: 500, status: "approved", transaction_amount: 7800, payment_method_id: "pix", payment_type_id: "bank_transfer", operation_type: "regular_payment", collector_id: 1, payer: { id: 2, email: "" }, point_of_interaction: { transaction_data: { bank_info: { payer: { long_name: "ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTO S.A." } } } }, date_created: "2026-10-13T12:00:00.000Z", date_approved: "2026-10-13T12:00:00.000Z" };
  // 1) sem regra: venda sem dono
  let r = await ingestMpPayment(repo, pmt, { collectorId: "1" });
  assert.equal(r.payment.kind, "venda");
  // 2) humano marca interna → o próximo tick respeita
  await repo.update("mp_payments", r.payment.id, { kind: "interna", direction: "in", kindSource: "manual" });
  r = await ingestMpPayment(repo, pmt, { collectorId: "1" });
  assert.equal(r.payment.kind, "interna");
  assert.equal(r.payment.kindSource, "manual");
  // 3) regra por banco: um PIX novo do mesmo banco já nasce interna
  assert.equal(badRuleReason({ matchField: "payerBank", matchValue: "asaas", action: "interna" }), "");
  assert.match(badRuleReason({ matchField: "payerBank", matchValue: "asa", action: "interna" }), /curto/);
  assert.match(badRuleReason({ matchField: "payerBank", matchValue: "asaas", action: "vincular", customer: "c1" }), /não identifica/);
  assert.equal(ruleMatches({ matchField: "payerBank", matchValue: "ASAAS" }, { payerBank: "Asaas Gestão Financeira" }), true);
  await repo.create("fin_rules", { id: "r1", saas: "", matchField: "payerBank", matchValue: "asaas", action: "interna" });
  const r2 = await ingestMpPayment(repo, { ...pmt, id: 501, transaction_amount: 174.01 }, { collectorId: "1" });
  assert.equal(r2.payment.kind, "interna");
  assert.equal(r2.payment.kindSource, "rule");
  assert.equal(r2.payment.customer, "");
  // Regra desconsiderar continua funcionando e a interna por regra não vincula pelo e-mail do cliente
  const r3 = await ingestMpPayment(repo, { ...pmt, id: 502, payer: { id: 2, email: "silene@x.com" } }, { collectorId: "1" });
  assert.equal(r3.payment.kind, "interna");
  assert.equal(r3.matched, false);
});

test("Caixa por conta: GET devolve o retrato, PUT grava saldo com data; reserva separada do disponível", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo);
  await seed(repo);
  const g0 = (await app.inject({ method: "GET", url: "/api/fin/leverads?month=2026-10" })).json();
  assert.equal(g0.caixa.total, 0);
  assert.equal(g0.caixa.contas.length, 6);
  assert.equal(g0.caixa.informadas, 0);
  const p1 = await app.inject({ method: "PUT", url: "/api/fin/leverads/bank/accounts/sicredi", payload: { balance: 58.29, asOf: "2026-10-13" } });
  assert.equal(p1.statusCode, 200, p1.body);
  const p2 = await app.inject({ method: "PUT", url: "/api/fin/leverads/bank/accounts/btg_inv", payload: { balance: "186919.70", asOf: "2026-10-13", note: "CDB + conta investimento" } });
  assert.equal(p2.statusCode, 200, p2.body);
  const bad = await app.inject({ method: "PUT", url: "/api/fin/leverads/bank/accounts/nubank", payload: { balance: 1 } });
  assert.equal(bad.statusCode, 400);
  const badDate = await app.inject({ method: "PUT", url: "/api/fin/leverads/bank/accounts/asaas", payload: { balance: 1, asOf: "13/10/2026" } });
  assert.equal(badDate.statusCode, 400);
  const g = (await app.inject({ method: "GET", url: "/api/fin/leverads?month=2026-10" })).json();
  assert.equal(g.caixa.total, 186977.99);
  assert.equal(g.caixa.reserva, 186919.7);
  assert.equal(g.caixa.disponivel, 58.29);
  assert.equal(g.caixa.informadas, 2);
  const sic = g.caixa.contas.find((c) => c.id === "sicredi");
  assert.equal(sic.asOf, "2026-10-13");
  assert.equal(sic.source, "manual");
  // writeFinAccount direto (seed por script) e caixaOf puro
  const cfg = await writeFinAccount(repo, "asaas", { balance: 1350.1, asOf: "2026-10-17", source: "import" });
  assert.equal(caixaOf(cfg).informadas, 3);
  assert.equal(caixaOf(cfg).disponivel, 1408.39);
  await app.close();
});
