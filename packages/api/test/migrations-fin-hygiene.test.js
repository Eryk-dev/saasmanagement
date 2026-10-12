// Higiene do Financeiro (migrations-fin.js): cada migração roda 2x e produz o
// mesmo estado, e nenhuma muda valor/status/data — só carimba.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  dedupeExpensePct, prestampMpPaymentKinds, stampMpPaymentSaas, migratePaymentMethodCustom,
  fixPayableDescriptions, stampInvoicePaidProof, purgeBadFinRules, migrateCheckoutToRealFee, runFinMigrations,
} from "../src/platform/migrations-fin.js";

const twice = async (fn, repo) => { const a = await fn(repo); const b = await fn(repo); return [a, b]; };

test("dedupeExpensePct: Checkout e Imposto em dobro (recorrente + avulso) ficam só com o recorrente", async () => {
  const repo = makeMemRepo();
  await repo.create("expenses", { id: "e1", saas: "leverads", name: "Checkout", pct: 12, base: "cartao12x", recurring: true, month: "2026-07" });
  await repo.create("expenses", { id: "e2", saas: "leverads", name: "Checkout MercadoPago", pct: 12, base: "cartao12x", recurring: false, month: "2026-07" });
  await repo.create("expenses", { id: "e3", saas: "leverads", name: "Imposto", pct: 20, base: "received", recurring: false, month: "2026-07" });
  await repo.create("expenses", { id: "e4", saas: "leverads", name: "Imposto", pct: 20, base: "received", recurring: true, month: "2026-07" });
  await repo.create("expenses", { id: "e5", saas: "leverads", name: "Imposto", pct: 6, base: "received", recurring: true, month: "2026-07" }); // outro %, fica
  await repo.create("expenses", { id: "e6", saas: "leverads", name: "Supabase", amount: 250, recurring: true, month: "2026-07" });
  assert.deepEqual(await twice(dedupeExpensePct, repo), [2, 0]);
  assert.deepEqual((await repo.list("expenses")).map((e) => e.id), ["e1", "e4", "e5", "e6"]);
});

test("migrateCheckoutToRealFee: lançamento de checkout sobre cartão passa a ler a taxa real", async () => {
  const repo = makeMemRepo();
  await repo.create("expenses", { id: "e1", saas: "leverads", name: "Checkout", pct: 12, base: "cartao12x" });
  await repo.create("expenses", { id: "e2", saas: "leverads", name: "Comissão", pct: 5, base: "cartao12x" });
  assert.deepEqual(await twice(migrateCheckoutToRealFee, repo), [1, 0]);
  assert.equal((await repo.get("expenses", "e1")).base, "taxa_real");
  assert.equal((await repo.get("expenses", "e2")).base, "cartao12x");
});

test("prestampMpPaymentKinds: classifica por heurística só quem não tem kind e tira o CNPJ do MP do pagador", async () => {
  const repo = makeMemRepo();
  await repo.create("mp_payments", { id: "a", status: "approved", amount: 100000, payerDoc: "67931740000112", payerEmail: "lever@netair.com.br", externalReference: "POTS_1" });
  await repo.create("mp_payments", { id: "b", status: "approved", amount: 5964, payerDoc: "10573521000191", payerName: "", description: "" });
  await repo.create("mp_payments", { id: "c", status: "approved", amount: 18000, description: "Venda presencial" });
  await repo.create("mp_payments", { id: "d", status: "approved", amount: 200, description: "Openai *chatgpt subscr" });
  await repo.create("mp_payments", { id: "e", status: "approved", amount: 1, kind: "venda", kindSource: "api", classV: 1 });
  assert.deepEqual(await twice(prestampMpPaymentKinds, repo), [4, 0]);
  const k = async (id) => (await repo.get("mp_payments", id));
  assert.equal((await k("a")).kind, "interna");
  assert.equal((await k("b")).kind, "venda");
  assert.deepEqual([(await k("b")).payerDoc, (await k("b")).payerDocMp], ["", true]);
  assert.equal((await k("c")).kind, "maquininha");
  assert.equal((await k("d")).kind, "saida");
  assert.deepEqual([(await k("e")).kind, (await k("e")).kindSource], ["venda", "api"]);
  assert.equal((await k("a")).amount, 100000, "valor intocado");
});

test("stampMpPaymentSaas: produto herdado do cliente/lead/fatura; sem vínculo fica vazio", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", saas: "leverads" });
  await repo.create("leads", { id: "l1", saas: "elo" });
  await repo.create("mp_payments", { id: "a", customer: "c1", saas: "" });
  await repo.create("mp_payments", { id: "b", lead: "l1", saas: "" });
  await repo.create("mp_payments", { id: "c", saas: "" });
  await repo.create("mp_payments", { id: "d", customer: "c1", saas: "outro" });
  assert.deepEqual(await twice(stampMpPaymentSaas, repo), [2, 0]);
  assert.equal((await repo.get("mp_payments", "a")).saas, "leverads");
  assert.equal((await repo.get("mp_payments", "b")).saas, "elo");
  assert.equal((await repo.get("mp_payments", "c")).saas, "");
  assert.equal((await repo.get("mp_payments", "d")).saas, "outro");
});

test("migratePaymentMethodCustom: texto livre vira custom + paymentTerms, ids válidos ficam", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", paymentMethod: "6 mil cartao e 12 mil 12x no boleto" });
  await repo.create("leads", { id: "l2", paymentMethod: "cartao12x" });
  await repo.create("customers", { id: "c1", paymentMethod: "Cartão de crédito em 2x" });
  await repo.create("customers", { id: "c2" });
  assert.deepEqual(await twice(migratePaymentMethodCustom, repo), [2, 0]);
  const l1 = await repo.get("leads", "l1");
  assert.deepEqual([l1.paymentMethod, l1.paymentTerms], ["custom", "6 mil cartao e 12 mil 12x no boleto"]);
  assert.equal((await repo.get("leads", "l2")).paymentMethod, "cartao12x");
  assert.equal((await repo.get("customers", "c1")).paymentMethod, "custom");
  assert.equal((await repo.get("customers", "c2")).paymentMethod, undefined);
});

test("fixPayableDescriptions: 'Salário set' na instância de outubro vira 'Salário'; conta avulsa não é tocada", async () => {
  const repo = makeMemRepo();
  await repo.create("payables", { id: "t", description: "Salário set", recurring: true, month: "2026-09" });
  await repo.create("payables", { id: "i", description: "Salário set", templateId: "t", month: "2026-10" });
  await repo.create("payables", { id: "j", description: "Salário setembro/26", templateId: "t", month: "2026-11" });
  await repo.create("payables", { id: "x", description: "Viagem set", month: "2026-09" });
  assert.deepEqual(await twice(fixPayableDescriptions, repo), [3, 0]);
  assert.equal((await repo.get("payables", "i")).description, "Salário");
  assert.equal((await repo.get("payables", "j")).description, "Salário");
  assert.equal((await repo.get("payables", "x")).description, "Viagem set");
});

test("stampInvoicePaidProof: mp / closing / manual_legacy, sem mexer em status, valor ou data", async () => {
  const repo = makeMemRepo();
  await repo.create("invoices", { id: "a", status: "paid", paidAt: "2026-09-01T00:00:00Z", mpPaymentId: "1", amount: 10 });
  await repo.create("invoices", { id: "b", status: "paid", paidAt: "2026-09-01T00:00:00Z", periodStart: "2026-09-01T00:00:00Z", amount: 20 });
  await repo.create("invoices", { id: "c", status: "paid", paidAt: "2026-09-05T00:00:00Z", periodStart: "2026-09-01T00:00:00Z", amount: 30 });
  await repo.create("invoices", { id: "d", status: "open", amount: 40 });
  assert.deepEqual(await twice(stampInvoicePaidProof, repo), [3, 0]);
  assert.equal((await repo.get("invoices", "a")).paidProof.kind, "mp");
  assert.equal((await repo.get("invoices", "b")).paidProof.kind, "closing");
  assert.equal((await repo.get("invoices", "c")).paidProof.kind, "manual_legacy");
  assert.equal((await repo.get("invoices", "d")).paidProof, undefined);
  const b = await repo.get("invoices", "b");
  assert.deepEqual([b.status, b.amount, b.paidAt], ["paid", 20, "2026-09-01T00:00:00Z"]);
});

test("purgeBadFinRules: regra por CNPJ do MP ou da casa sai; regra por cliente fica", async () => {
  const repo = makeMemRepo();
  await repo.create("fin_rules", { id: "r1", matchField: "payerDoc", matchValue: "10.573.521/0001-91", action: "vincular" });
  await repo.create("fin_rules", { id: "r2", matchField: "payerDoc", matchValue: "67931740000112", action: "desconsiderar" });
  await repo.create("fin_rules", { id: "r3", matchField: "payerDoc", matchValue: "34231275000158", action: "vincular" });
  await repo.create("fin_rules", { id: "r4", matchField: "payerEmail", matchValue: "lever@netair.com.br", action: "desconsiderar" });
  assert.deepEqual(await twice(purgeBadFinRules, repo), [2, 0]);
  assert.deepEqual((await repo.list("fin_rules")).map((r) => r.id), ["r3", "r4"]);
});

test("runFinMigrations: roda todas, isola falha e devolve o resumo", async () => {
  const repo = makeMemRepo();
  await repo.create("invoices", { id: "a", status: "paid", paidAt: "x", mpPaymentId: "1" });
  const out = await runFinMigrations(repo, { log: { log() {}, error() {} } });
  assert.equal(out.stampInvoicePaidProof, 1);
  assert.equal(out.dedupeExpensePct, 0);
  const again = await runFinMigrations(repo, { log: { log() {}, error() {} } });
  assert.equal(again.stampInvoicePaidProof, 0);
});
