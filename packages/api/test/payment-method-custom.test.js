// Condição de pagamento PERSONALIZADA: id `custom` + texto em paymentTerms
// (antes o texto livre virava o próprio id). Metas: conta só o que caiu (como
// faturado); cronograma só quando o closer informa o Nº de parcelas.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { closedInstallments, closedSubscriptionSpec, createClosedSubscription } = await import("../src/billing/billing.js");
const { isPayOnReceipt } = await import("../src/metrics/metrics-core.js");
const { migratePaymentMethodCustom } = await import("../src/platform/migrations-fin.js");

test("custom conta no recebimento; cronograma só com Nº de parcelas", () => {
  assert.equal(isPayOnReceipt("custom"), true);
  assert.equal(closedInstallments({ paymentMethod: "custom" }), 0);
  assert.equal(closedInstallments({ paymentMethod: "custom", paymentInstallments: 4 }), 4);
  assert.equal(closedInstallments({ paymentMethod: "pix", paymentInstallments: 4 }), 0, "à vista não parcela");
  const spec = closedSubscriptionSpec({ planClosed: "anual", amount: 18000, paymentMethod: "custom", paymentInstallments: 2 });
  assert.deepEqual(spec, { cycle: "annual", price: 18000, schedule: 2 });
});

test("fechamento custom sem parcelas: a 1ª fatura nasce ABERTA (não presume recebimento)", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "X" });
  await createClosedSubscription(repo, { customerId: "c1", saas: "leverads", planClosed: "anual", amount: 18000, paymentMethod: "custom", paymentTerms: "6 mil cartão e 12 mil 12x no boleto" });
  const inv = (await repo.list("invoices"))[0];
  assert.equal(inv.status, "open");
  assert.equal(inv.paidProof, undefined);
});

test("migração: texto livre vira custom + paymentTerms e a leitura do valor não muda", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", paymentMethod: "Cartão de crédito em 2x", amount: 2388 });
  await migratePaymentMethodCustom(repo);
  const l = await repo.get("leads", "l1");
  assert.deepEqual([l.paymentMethod, l.paymentTerms, isPayOnReceipt(l.paymentMethod)], ["custom", "Cartão de crédito em 2x", true]);
});
