import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { customerCashIn } from "../src/metrics-core.js";
import { registerBillingRoutes } from "../src/routes.billing.js";
import { makeMemRepo } from "./helpers/mem-repo.js";

const period = { saas: "leverads", since: "2026-09-01", until: "2026-09-30" };
const customers = [
  { id: "new", saas: "leverads", startedAt: "2026-09-05", arr: 12000, paymentMethod: "cartao12x" },
  { id: "old", saas: "leverads", startedAt: "2026-01-01", arr: 24000, leadId: "lead-old" },
  { id: "churn", saas: "leverads", endedAt: "2026-08-01", arr: 1200 },
  { id: "other", saas: "uniquekids", arr: 99999 },
];
const calc = (data = {}) => customerCashIn({ ...period, customers, ...data });

test("caixa de Clientes: contrato e tempo de assinatura não presumem recebimento", () => {
  assert.deepEqual(calc(), { ...period, received: 0, receivable: 0, openCount: 0 });
  assert.equal(calc({ invoices: [
    { customer: "new", status: "paid", amount: 12000, paidAt: "2026-09-05", periodStart: "2026-09-05" },
    { customer: "new", status: "paid", amount: 12000 },
  ] }).received, 0);
});

test("recebido usa aprovação/baixa, inclui clientes antigos e churnados e não duplica MP + fatura", () => {
  const mpPayments = [
    { mpId: "p1", saas: "leverads", customer: "new", status: "approved", amount: 1000, dateCreated: "2026-08-01", dateApproved: "2026-09-10" },
    { mpId: "p2", lead: "lead-old", status: "approved", amount: 100, dateApproved: "2026-10-01T02:59:59.999Z" },
    { mpId: "p3", customer: "old", status: "approved", amount: 900, dateApproved: "2026-10-01T03:00:00Z" },
    { mpId: "p4", customer: "old", status: "approved", amount: 800, dateApproved: "2026-09-01T02:59:59.999Z" },
    { mpId: "other", saas: "uniquekids", customer: "other", status: "approved", amount: 99999, dateApproved: "2026-09-10" },
  ];
  const invoices = [
    { customer: "new", status: "paid", amount: 1000, paidAt: "2026-10-01", mpPaymentId: "p1" },
    { customer: "old", status: "paid", amount: 800, paidAt: "2026-09-03", mpPaymentId: "p4" },
    { customer: "old", status: "paid", amount: 50, paidAt: "2026-09-01T03:00:00Z" },
    { customer: "old", kind: "upsell", status: "paid", amount: 25, soldAt: "2026-08-01", paidAt: "2026-09-02" },
    { customer: "old", kind: "upsell", status: "paid", amount: 35, soldAt: "2026-09-01", paidAt: "2026-10-02" },
    { customer: "churn", status: "paid", amount: 100, paidAt: "2026-09-02" },
    { customer: "old", status: "paid", amount: 30, paidAt: "2026-09-02", mpPaymentId: "not-mirrored" },
    { customer: "other", status: "paid", amount: 99999, paidAt: "2026-09-02" },
    { customer: "new", saas: "uniquekids", status: "paid", amount: 99999, paidAt: "2026-09-02" },
  ];
  assert.equal(calc({ mpPayments, invoices }).received, 1305);
  // Outubro conta o pagamento aprovado em outubro e o upsell baixado então;
  // a baixa tardia da fatura p1 não repete o pagamento aprovado em setembro.
  assert.equal(calc({ mpPayments, invoices, since: "2026-10-01", until: "2026-10-31" }).received, 935);
});

test("MP sem data confirmada, pendente, recusado ou estornado não vira caixa por fatura desatualizada", () => {
  const mpPayments = ["approved", "pending", "rejected", "refunded", "cancelled", "charged_back"].map((status) => ({
    mpId: status, customer: "new", status, amount: 999, dateCreated: "2026-09-01",
    dateApproved: status === "approved" ? "" : "2026-09-01",
  }));
  const invoices = mpPayments.map((p) => ({ customer: "new", status: "paid", amount: 999, paidAt: "2026-09-02", mpPaymentId: p.mpId }));
  assert.equal(calc({ mpPayments, invoices }).received, 0);
});

test("vínculo pela fatura usa aprovação do MP e respeita o produto", () => {
  const invoice = { customer: "old", saas: "leverads", status: "paid", amount: 500, paidAt: "2026-09-02", mpPaymentId: "p1" };
  const payment = { mpId: "p1", status: "approved", amount: 500, dateApproved: "2026-08-31" };
  assert.equal(calc({ invoices: [invoice], mpPayments: [payment] }).received, 0);
  assert.equal(calc({ invoices: [invoice], mpPayments: [{ ...payment, dateApproved: "2026-09-02" }] }).received, 500);
  assert.equal(calc({ invoices: [invoice], mpPayments: [{ ...payment, saas: "uniquekids", dateApproved: "2026-09-02" }] }).received, 0);
});

test("a receber considera só cobranças abertas com vencimento na janela, sem renovação presumida", () => {
  const invoices = [
    { customer: "new", status: "open", amount: 200.1, dueDate: "2026-09-01" },
    { customer: "old", status: "overdue", amount: 300.2, dueDate: "2026-09-10" },
    { customer: "old", status: "open", amount: 500, dueDate: "2026-10-01" },
    { customer: "old", status: "overdue", amount: 500, dueDate: "2026-08-01" },
    { customer: "old", status: "cancelled", amount: 500, dueDate: "2026-09-01" },
    { customer: "old", status: "paid", amount: 500, dueDate: "2026-09-01" },
    { customer: "other", status: "open", amount: 99999, dueDate: "2026-09-01" },
    { customer: "new", status: "open", amount: 500, dueDate: "2026-09-01", mpPaymentId: "paid" },
  ];
  const result = calc({ invoices, mpPayments: [{ mpId: "paid", status: "approved", amount: 500, dateApproved: "2026-09-01" }] });
  assert.equal(result.receivable, 500.3);
  assert.equal(result.openCount, 2);
});

test("GET billing/cash aplica período e produto na API sem alterar o acumulado recebido", async (t) => {
  const repo = makeMemRepo();
  for (const customer of customers) await repo.create("customers", customer);
  await repo.create("mp_payments", { mpId: "p1", customer: "old", status: "approved", amount: 700, dateApproved: "2026-08-15" });
  await repo.create("invoices", { customer: "old", saas: "leverads", status: "paid", amount: 150, paidAt: "2026-09-15" });
  await repo.create("invoices", { customer: "new", saas: "leverads", status: "open", amount: 200, dueDate: "2026-09-20" });
  const app = Fastify();
  registerBillingRoutes(app, repo);
  t.after(() => app.close());
  const res = await app.inject("/api/billing/cash/leverads?since=2026-09-01&until=2026-09-30");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ...period, received: 150, receivable: 200, openCount: 1 });
  assert.deepEqual((await app.inject("/api/billing/received/leverads")).json(), { old: 850 });
  assert.equal((await app.inject("/api/billing/cash/uniquekids?since=2026-09-01&until=2026-09-30")).json().received, 0);
  for (const query of ["since=2026-09-31", "until=bad", "since=2026-10-01&until=2026-09-01"]) {
    assert.equal((await app.inject(`/api/billing/cash/leverads?${query}`)).statusCode, 400);
  }
});
