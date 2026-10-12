// A régua ÚNICA do caixa (metrics-core.cashIn): pagamento de cliente aprovado
// no espelho + fatura baixada com prova; a fatura que nasceu paga no
// fechamento é PRESUMIDA; uma fatura baixada por um pagamento conta UMA vez;
// estorno/cancelamento no MP prevalece; interna/saída/ruído nunca somam.

import test from "node:test";
import assert from "node:assert/strict";
import { cashIn, paidProofKindOf } from "../src/metrics/metrics-core.js";

const customers = [
  { id: "a", saas: "leverads", leadId: "la" },
  { id: "b", saas: "leverads" },
  { id: "x", saas: "outro" },
];
const sept = (iso) => String(iso || "").startsWith("2026-09");

test("paidProofKindOf: carimbo vale; sem carimbo, convenção antiga (paidAt === periodStart = closing)", () => {
  assert.equal(paidProofKindOf({ paidProof: { kind: "manual" } }), "manual");
  assert.equal(paidProofKindOf({ mpPaymentId: "1" }), "mp");
  assert.equal(paidProofKindOf({ paidAt: "2026-09-01", periodStart: "2026-09-01" }), "closing");
  assert.equal(paidProofKindOf({ paidAt: "2026-09-05", periodStart: "2026-09-01" }), "manual_legacy");
});

test("uma fatura + um pagamento do MP = 1 vez, pelo pagamento (data da aprovação) e com o kind da fatura", () => {
  const r = cashIn({
    customers, saas: "leverads", inWin: sept,
    mpPayments: [{ mpId: "1", status: "approved", kind: "venda", customer: "a", amount: 500, dateApproved: "2026-09-10" }],
    invoices: [{ id: "i1", customer: "a", status: "paid", kind: "installment", amount: 500, paidAt: "2026-10-02", mpPaymentId: "1" }],
  });
  assert.equal(r.total, 500);
  assert.deepEqual(r.byKind, { installment: 500 });
  assert.equal(r.byCustomer.get("a"), 500);
  assert.equal(r.items.length, 1);
});

test("presumido: fatura nascida paga não entra no total, fica no balde próprio; manual/legado entram", () => {
  const r = cashIn({
    customers, saas: "leverads", inWin: sept,
    invoices: [
      { id: "c1", customer: "a", status: "paid", kind: "renewal", amount: 5964, paidAt: "2026-09-01", periodStart: "2026-09-01", paidProof: { kind: "closing" } },
      { id: "c2", customer: "b", status: "paid", kind: "renewal", amount: 100, paidAt: "2026-09-01", periodStart: "2026-09-01" }, // sem carimbo: convenção
      { id: "m1", customer: "a", status: "paid", kind: "manual", amount: 300, paidAt: "2026-09-03", paidProof: { kind: "manual", method: "pix" } },
      { id: "m2", customer: "b", status: "paid", kind: "upsell", amount: 200, paidAt: "2026-09-04" }, // legado
      { id: "o", customer: "b", status: "open", amount: 999, dueDate: "2026-09-04" },
    ],
  });
  assert.equal(r.total, 500);
  assert.deepEqual(r.byKind, { manual: 300, upsell: 200 });
  assert.deepEqual([r.presumido.n, r.presumido.total], [2, 6064]);
  assert.deepEqual(r.presumido.items.map((i) => i.id), ["c1", "c2"]);
});

test("estorno/cancelamento no MP derruba a baixa; interna/saída/ruído/ignorado nunca somam; outro produto fica fora", () => {
  const r = cashIn({
    customers, saas: "leverads", inWin: sept,
    mpPayments: [
      { mpId: "r", status: "refunded", kind: "venda", customer: "a", amount: 500, dateApproved: "2026-09-10" },
      { mpId: "i", status: "approved", kind: "interna", customer: "a", amount: 50000, dateApproved: "2026-09-10" },
      { mpId: "s", status: "approved", kind: "saida", customer: "a", amount: 200, dateApproved: "2026-09-10" },
      { mpId: "g", status: "approved", kind: "venda", customer: "a", amount: 70, dateApproved: "2026-09-10", finIgnored: true },
      { mpId: "x", status: "approved", kind: "venda", customer: "x", saas: "outro", amount: 999, dateApproved: "2026-09-10" },
      { mpId: "ok", status: "approved", kind: "maquininha", lead: "la", amount: 80, dateApproved: "2026-09-11" },
    ],
    invoices: [
      { id: "i1", customer: "a", status: "paid", amount: 500, paidAt: "2026-09-10", mpPaymentId: "r" },
      { id: "i2", customer: "x", saas: "outro", status: "paid", amount: 999, paidAt: "2026-09-10" },
    ],
  });
  assert.equal(r.total, 80);
  assert.deepEqual(r.byKind, { mp: 80 });
});

test("pagamento sem cliente mas com fatura baixada herda o cliente da fatura; sem janela conta tudo", () => {
  const r = cashIn({
    customers, saas: "leverads",
    mpPayments: [{ mpId: "1", status: "approved", amount: 300, dateApproved: "2026-01-10" }],
    invoices: [{ id: "i1", customer: "b", status: "paid", kind: "renewal", amount: 300, paidAt: "2026-01-10", mpPaymentId: "1" }],
  });
  assert.equal(r.byCustomer.get("b"), 300);
  assert.deepEqual(r.byKind, { renewal: 300 });
});
