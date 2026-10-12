// As telas que falam em "recebido" têm que mostrar o MESMO número: Financeiro
// (Resumo e DRE), Clientes (Status pgto. = /billing/received e caixa do período
// = /billing/cash), Planos (/plans/stats), base do imposto (/expenses/summary).
// Antes eram 7 réguas; agora todas passam por metrics-core.cashIn.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

test("recebido do mês bate em /api/fin, /billing/received, /billing/cash, /plans/stats e na base received do summary", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("plans", { id: "plan_x", code: "x", saas: "leverads", v: 2, name: "X", product: "leverads", prices: {} });
  await repo.create("customers", { id: "a", saas: "leverads", name: "A", arr: 12000, leadId: "la", planCode: "x" });
  await repo.create("customers", { id: "b", saas: "leverads", name: "B", arr: 6000, planCode: "x" });
  // a: pagou pelo MP (fatura baixada por ele) + um PIX pelo lead sem fatura.
  await repo.create("mp_payments", { id: "mpp_1", mpId: "1", saas: "leverads", status: "approved", kind: "venda", customer: "a", amount: 1000, methodType: "credit_card", feeAmount: 100, dateApproved: "2026-09-10T12:00:00Z" });
  await repo.create("mp_payments", { id: "mpp_2", mpId: "2", status: "approved", kind: "venda", lead: "la", amount: 250, dateApproved: "2026-09-12T12:00:00Z" });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "a", kind: "renewal", amount: 1000, status: "paid", paidAt: "2026-09-10T12:00:00Z", mpPaymentId: "1" });
  // b: baixa manual com prova + uma presumida (nasceu paga) + interna no espelho.
  await repo.create("invoices", { id: "i2", saas: "leverads", customer: "b", kind: "installment", amount: 400, status: "paid", paidAt: "2026-09-15T12:00:00Z", paidProof: { kind: "manual", method: "pix" } });
  await repo.create("invoices", { id: "i3", saas: "leverads", customer: "b", kind: "renewal", amount: 6000, status: "paid", paidAt: "2026-09-01T12:00:00Z", periodStart: "2026-09-01T12:00:00Z", paidProof: { kind: "closing" } });
  await repo.create("mp_payments", { id: "mpp_9", mpId: "9", status: "approved", kind: "interna", customer: "b", amount: 50000, dateApproved: "2026-09-10T12:00:00Z" });
  await repo.create("expenses", { id: "e1", saas: "leverads", month: "2026-01", category: "taxas", name: "Imposto", pct: 10, base: "received", recurring: true });

  const app = Fastify();
  registerRoutes(app, repo);
  const fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  const received = (await app.inject({ url: "/api/billing/received/leverads" })).json();
  const cash = (await app.inject({ url: "/api/billing/cash/leverads?since=2026-09-01&until=2026-09-30" })).json();
  const stats = (await app.inject({ url: "/api/plans/stats/leverads" })).json();
  const summary = (await app.inject({ url: "/api/expenses/summary/leverads?month=2026-09" })).json();

  const esperado = 1000 + 250 + 400;
  assert.equal(fin.receber.recebidosMes, esperado);
  assert.equal(fin.dre.receitaTotal, esperado, "DRE usa a MESMA régua do tile");
  assert.deepEqual(fin.dre.receita, { renewal: 1000, mp: 250, installment: 400 });
  assert.equal(cash.received, esperado);
  assert.equal(received.a + received.b, esperado);
  assert.deepEqual(received, { a: 1250, b: 400 });
  assert.equal(stats.total.received, esperado);
  assert.equal(summary.receivedBase, esperado);
  assert.equal(summary.manual.find((e) => e.id === "e1").amount, esperado * 0.1);
  // O presumido aparece ao lado, nunca dentro.
  assert.deepEqual([fin.receber.presumido.mes.n, fin.receber.presumido.mes.total], [1, 6000]);
  assert.equal(fin.receber.presumido.items[0].id, "i3");
  assert.equal(cash.presumed, 6000);
  // Interna no espelho: visível no balde, fora de tudo.
  assert.deepEqual(fin.conciliacao.internas, { n: 1, total: 50000 });
  assert.equal(fin.conciliacao.espelhoMes, 1250);
  assert.equal(fin.conciliacao.taxasMes, 100);
  // Resultado: uma fórmula só, no servidor.
  assert.equal(fin.dre.resultado, esperado - esperado * 0.1);
  assert.equal(fin.dre.margemBruta, 0.9);
  await app.close();
});
