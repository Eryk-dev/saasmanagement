// Baixa manual com PROVA: POST /invoices/:id/pay exige quando/como entrou e
// carimba quem marcou; /confirm transforma a fatura presumida (nascida paga no
// fechamento) em recebido; /unpay limpa a prova; o pagamento do MP de valor
// exato confirma a presumida sozinho (settleTarget).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { ingestMpPayment } = await import("../src/payments/mp-payments.js");
const { createClosedSubscription } = await import("../src/billing/billing.js");

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Loja", paymentMethod: "pix" });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("pay: sem prova → 400; com prova grava data/meio/nota/autor e a fatura vira recebido", async () => {
  const { app, repo } = await build();
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 500, status: "open", dueDate: "2026-09-10" });
  const sem = await app.inject({ method: "POST", url: "/api/invoices/i1/pay", payload: {} });
  assert.equal(sem.statusCode, 400);
  assert.match(sem.json().error, /como o dinheiro entrou/);
  const ok = await app.inject({ method: "POST", url: "/api/invoices/i1/pay", payload: { method: "boleto", at: "2026-09-12", note: "comprovante no drive" } });
  assert.equal(ok.statusCode, 200);
  const inv = await repo.get("invoices", "i1");
  assert.equal(inv.status, "paid");
  assert.equal(inv.paidAt, "2026-09-12T15:00:00.000Z");
  assert.equal(inv.paidMethod, "boleto");
  assert.deepEqual([inv.paidProof.kind, inv.paidProof.method, inv.paidProof.note, inv.paidProof.by], ["manual", "boleto", "comprovante no drive", "api"]);
  assert.equal((await app.inject({ method: "POST", url: "/api/invoices/i1/pay", payload: { method: "pix" } })).statusCode, 409, "já paga");
  const fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  assert.equal(fin.receber.recebidosMes, 500);
  // unpay limpa a prova.
  await app.inject({ method: "POST", url: "/api/invoices/i1/unpay" });
  const re = await repo.get("invoices", "i1");
  assert.deepEqual([re.status, re.paidAt, re.paidProof], ["overdue", "", null], "vencimento passou: volta vencida, sem prova");
  await app.close();
});

test("confirm: só a presumida aceita; com prova ela sai de presumido pra recebido", async () => {
  const { app, repo } = await build();
  const sub = await createClosedSubscription(repo, { customerId: "c1", saas: "leverads", planClosed: "anual", amount: 5964, paymentMethod: "pix", startAt: "2026-09-01T12:00:00.000Z" }, new Date("2026-09-20T12:00:00Z"));
  const presumida = (await repo.list("invoices")).find((i) => i.subscription === sub.id);
  assert.equal(presumida.paidProof.kind, "closing");
  let fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  assert.deepEqual([fin.receber.recebidosMes, fin.receber.presumido.n], [0, 1]);
  const aberta = await repo.create("invoices", { id: "i2", saas: "leverads", customer: "c1", amount: 10, status: "open" });
  assert.equal((await app.inject({ method: "POST", url: `/api/invoices/${aberta.id}/confirm`, payload: { method: "pix" } })).statusCode, 409);
  const ok = await app.inject({ method: "POST", url: `/api/invoices/${presumida.id}/confirm`, payload: { method: "pix", at: "2026-09-02" } });
  assert.equal(ok.statusCode, 200);
  const conf = await repo.get("invoices", presumida.id);
  assert.deepEqual([conf.paidProof.kind, conf.paidProof.confirmedFrom], ["manual", "closing"]);
  fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  assert.deepEqual([fin.receber.recebidosMes, fin.receber.presumido.n], [5964, 0]);
  await app.close();
});

test("pagamento do MP de valor exato confirma a presumida sozinho (vira prova mp, sem 'sem fatura' ao lado)", async () => {
  const { app, repo } = await build();
  await createClosedSubscription(repo, { customerId: "c1", saas: "leverads", planClosed: "anual", amount: 5964, paymentMethod: "cartao12x", startAt: "2026-09-01T12:00:00.000Z" }, new Date("2026-09-20T12:00:00Z"));
  await repo.update("customers", "c1", { email: "loja@x.com" });
  const r = await ingestMpPayment(repo, {
    id: 55, status: "approved", operation_type: "regular_payment", transaction_amount: 5964, installments: 12,
    payment_method_id: "master", payment_type_id: "credit_card", collector_id: 1, payer: { id: 2, email: "loja@x.com" },
    date_created: "2026-09-03T10:00:00.000Z", date_approved: "2026-09-03T10:01:00.000Z",
  }, { collectorId: "1" });
  assert.ok(r.settledNow, "a presumida foi o alvo");
  const inv = await repo.get("invoices", r.settledNow);
  assert.deepEqual([inv.paidProof.kind, inv.paidProof.confirmedFrom, inv.mpPaymentId], ["mp", "closing", "55"]);
  const fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  assert.deepEqual([fin.receber.recebidosMes, fin.receber.presumido.n, fin.dre.receita.renewal], [5964, 0, 5964]);
  await app.close();
});
