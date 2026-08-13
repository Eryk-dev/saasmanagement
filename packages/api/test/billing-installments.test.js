// Boleto faturado em Nx — o gate de fechamento escolhe o parcelamento e o
// recebimento vira um CRONOGRAMA de faturas kind:"installment":
//   · a assinatura fica no ciclo do PLANO com o valor cheio (arr = amount ×
//     fator, igual à vista) e o runBilling só renova no fim do contrato;
//   · as parcelas nascem TODAS abertas (faturado é promessa) e o CS marca
//     paga/desmarcada na tela Clientes (POST /pay e /unpay);
//   · reeditar o fechamento refaz só as parcelas abertas — paga é fato.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const {
  closedSubscriptionSpec, closedInstallments, createClosedSubscription,
  createInstallmentSchedule, runBilling,
} = await import("../src/billing.js");
const { registerRoutes, convertWonLead, syncWonLeadDeal } = await import("../src/routes.js");

const DAY = 86400000;
const capi = { sendPurchase: async () => {} };

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

const sum = (rows) => Math.round(rows.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100;
const parcelasOf = async (repo, customerId) =>
  (await repo.list("invoices")).filter((i) => i.customer === customerId && i.kind === "installment")
    .sort((a, b) => (a.installmentN || 0) - (b.installmentN || 0));

test("spec: faturado com Nº de parcelas fica no ciclo do plano com valor cheio; sem Nº segue o desenho antigo; à vista ignora", () => {
  const comN = closedSubscriptionSpec({ planClosed: "anual", amount: 12000, paymentMethod: "boleto", paymentInstallments: 4 });
  assert.deepEqual(comN, { cycle: "annual", price: 12000, schedule: 4 });
  const legado = closedSubscriptionSpec({ planClosed: "anual", amount: 12000, paymentMethod: "boleto" });
  assert.deepEqual(legado, { cycle: "monthly", price: 1000 }, "fechamento antigo (sem o campo) não muda");
  const vista = closedSubscriptionSpec({ planClosed: "anual", amount: 12000, paymentMethod: "cartao12x", paymentInstallments: 4 });
  assert.deepEqual(vista, { cycle: "annual", price: 12000 }, "cartão 12x a adquirente antecipa — parcela é problema dela");
  assert.equal(closedInstallments({ paymentMethod: "pix_parcelado", paymentInstallments: 6 }), 6);
  assert.equal(closedInstallments({ paymentMethod: "pix", paymentInstallments: 6 }), 0);
});

test("fechamento faturado 4x: parcelas abertas com vencimento mensal, sem fatura inicial paga, arr = valor cheio", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Cliente", saas: "leverads", arr: 0 });
  const sub = await createClosedSubscription(repo, {
    customerId: "c1", saas: "leverads", planClosed: "anual", amount: 10000,
    paymentMethod: "boleto", paymentInstallments: 3, startAt: "2026-08-13T12:00:00.000Z",
  }, new Date("2026-08-13T12:00:00.000Z"));
  assert.equal(sub.cycle, "annual");
  assert.equal(sub.price, 10000);
  const invoices = await repo.list("invoices");
  assert.equal(invoices.some((i) => i.kind === "renewal"), false, "sem a fatura inicial auto-paga — nada entrou ainda");
  const parc = await parcelasOf(repo, "c1");
  assert.equal(parc.length, 3);
  assert.deepEqual(parc.map((i) => i.status), ["open", "open", "open"]);
  assert.deepEqual(parc.map((i) => i.amount), [3333.34, 3333.33, 3333.33], "centavos sobram na 1ª");
  assert.equal(sum(parc), 10000);
  assert.deepEqual(parc.map((i) => i.dueDate.slice(0, 10)), ["2026-08-13", "2026-09-13", "2026-10-13"]);
  assert.equal(parc[1].title, "Parcela 2/3 · boleto faturado");
  assert.equal((await repo.get("customers", "c1")).arr, 10000, "faturado anual: arr = valor do contrato, igual à vista");
});

test("runBilling não fatura por mês no cronograma; parcela vencida derruba pra past_due e a baixa recupera", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Cliente", saas: "leverads", arr: 0 });
  const start = new Date(Date.now() - 40 * DAY).toISOString();
  await createClosedSubscription(repo, {
    customerId: "c1", saas: "leverads", planClosed: "anual", amount: 12000,
    paymentMethod: "boleto", paymentInstallments: 12, startAt: start,
  }, new Date(start));
  await runBilling(repo);
  const invoices = await repo.list("invoices");
  assert.equal(invoices.filter((i) => i.kind === "renewal").length, 0, "renovação só no fim do contrato, não por mês");
  const parc = await parcelasOf(repo, "c1");
  // 1ª parcela venceu há 40 dias (grace 3d) → overdue; a 2ª venceu há ~10 → overdue; 3ª em diante abertas.
  assert.equal(parc[0].status, "overdue");
  assert.equal(parc[1].status, "overdue");
  assert.equal(parc[2].status, "open");
  const sub = (await repo.list("subscriptions"))[0];
  assert.equal(sub.status, "past_due");

  const app = buildApp(repo);
  await app.inject({ method: "POST", url: `/api/invoices/${parc[0].id}/pay` });
  assert.equal((await repo.list("subscriptions"))[0].status, "past_due", "ainda tem a 2ª vencida");
  await app.inject({ method: "POST", url: `/api/invoices/${parc[1].id}/pay` });
  assert.equal((await repo.list("subscriptions"))[0].status, "active", "sem vencida → recupera");
  await app.close();
});

test("desmarcar: baixa manual volta pra aberta/vencida e re-derruba a assinatura; pagamento real do MP não desmarca", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Cliente", saas: "leverads", arr: 0 });
  const sub = await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "active", cycle: "annual", price: 6000, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 300 * DAY).toISOString() });
  const vencida = await repo.create("invoices", { customer: "c1", subscription: sub.id, saas: "leverads", kind: "installment", status: "paid", paidAt: new Date().toISOString(), amount: 3000, dueDate: new Date(Date.now() - 10 * DAY).toISOString(), installmentN: 1, installmentOf: 2 });
  const futura = await repo.create("invoices", { customer: "c1", subscription: sub.id, saas: "leverads", kind: "installment", status: "paid", paidAt: new Date().toISOString(), amount: 3000, dueDate: new Date(Date.now() + 20 * DAY).toISOString(), installmentN: 2, installmentOf: 2 });
  const doMP = await repo.create("invoices", { customer: "c1", saas: "leverads", kind: "manual", status: "paid", paidAt: new Date().toISOString(), mpPaymentId: "123", amount: 500, dueDate: new Date().toISOString() });

  const app = buildApp(repo);
  let r = await app.inject({ method: "POST", url: `/api/invoices/${vencida.id}/unpay` });
  assert.equal(r.json().status, "overdue", "venceu há 10 dias → reabre vencida");
  assert.equal(r.json().paidAt, "");
  assert.equal((await repo.get("subscriptions", "s1")).status, "past_due", "parcela vencida reaberta derruba a assinatura");
  r = await app.inject({ method: "POST", url: `/api/invoices/${futura.id}/unpay` });
  assert.equal(r.json().status, "open", "vencimento futuro → reabre aberta");
  r = await app.inject({ method: "POST", url: `/api/invoices/${doMP.id}/unpay` });
  assert.equal(r.statusCode, 409, "dinheiro real do MP não desmarca");
  assert.equal((await repo.get("invoices", doMP.id)).status, "paid");
  await app.close();
});

test("serviço único faturado em 3x: sem assinatura, cronograma preso só ao cliente, arr manual", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }, { stage: "Ganho", kind: "ganho" }] });
  const lead = await repo.create("leads", {
    saas: "leverads", name: "Rafa", company: "Peças BR", stage: "Ganho",
    amount: 2988, planClosed: "unico", paymentMethod: "boleto", paymentInstallments: 3,
  });
  const customer = await convertWonLead(repo, lead, { metaCapi: capi });
  assert.ok(customer, "cliente nasce");
  assert.equal((await repo.list("subscriptions")).length, 0, "serviço único não é recorrência");
  assert.equal((await repo.get("customers", customer.id)).arr, 2988);
  const parc = await parcelasOf(repo, customer.id);
  assert.equal(parc.length, 3);
  assert.equal(parc[0].subscription, "", "cronograma sem assinatura");
  assert.equal(sum(parc), 2988);
});

test("reeditar o fechamento: parcela paga fica, as abertas são refeitas; virar à vista limpa as abertas", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }, { stage: "Ganho", kind: "ganho" }] });
  const lead0 = await repo.create("leads", {
    saas: "leverads", name: "Duda", company: "Loja X", stage: "Ganho",
    amount: 12000, planClosed: "anual", paymentMethod: "boleto", paymentInstallments: 4,
  });
  const customer = await convertWonLead(repo, lead0, { metaCapi: capi });
  let parc = await parcelasOf(repo, customer.id);
  assert.equal(parc.length, 4);
  // 1ª parcela paga (3.000 no caixa) e o closer muda o parcelamento pra 6x.
  await repo.update("invoices", parc[0].id, { status: "paid", paidAt: new Date().toISOString() });
  let lead = await repo.update("leads", lead0.id, { paymentInstallments: 6 });
  await syncWonLeadDeal(repo, lead);
  parc = await parcelasOf(repo, customer.id);
  assert.equal(parc.length, 6);
  assert.equal(parc[0].status, "paid", "dinheiro que entrou é fato");
  assert.equal(parc[0].amount, 3000);
  const abertas = parc.slice(1);
  assert.ok(abertas.every((i) => i.status === "open"));
  assert.equal(sum(abertas), 9000, "o que falta (12.000 − 3.000) redividido");
  assert.deepEqual(abertas.map((i) => `${i.installmentN}/${i.installmentOf}`), ["2/6", "3/6", "4/6", "5/6", "6/6"]);

  // Virou cartão 12x: cronograma sai de cena, a paga fica no histórico.
  lead = await repo.update("leads", lead.id, { paymentMethod: "cartao12x", paymentInstallments: "" });
  await syncWonLeadDeal(repo, lead);
  parc = await parcelasOf(repo, customer.id);
  assert.equal(parc.length, 1);
  assert.equal(parc[0].status, "paid");
  const sub = (await repo.list("subscriptions")).find((s) => s.status !== "canceled");
  assert.equal(sub.cycle, "annual");
  assert.equal(sub.price, 12000);
});

test("cliente ANTIGO do faturado mensal ganha o cronograma na reedição: renovações abertas e a inicial auto-paga saem, renovação paga de verdade desconta", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Inbox" }, { stage: "Ganho", kind: "ganho" }] });
  const lead0 = await repo.create("leads", {
    saas: "leverads", name: "Igor", company: "Auto Z", stage: "Ganho",
    amount: 12000, planClosed: "anual", paymentMethod: "boleto", // SEM parcelas = desenho antigo
  });
  const customer = await convertWonLead(repo, lead0, { metaCapi: capi });
  let sub = (await repo.list("subscriptions"))[0];
  assert.equal(sub.cycle, "monthly");
  assert.equal(sub.price, 1000);
  // Simula a vida do desenho antigo: a renovação do mês 2 foi PAGA de verdade
  // (baixa manual, paidAt ≠ dueDate) e a do mês 3 está aberta.
  await repo.create("invoices", { customer: customer.id, subscription: sub.id, saas: "leverads", kind: "renewal", status: "paid", amount: 1000, dueDate: "2026-07-13T12:00:00.000Z", paidAt: "2026-07-15T09:00:00.000Z" });
  await repo.create("invoices", { customer: customer.id, subscription: sub.id, saas: "leverads", kind: "renewal", status: "open", amount: 1000, dueDate: "2026-08-13T12:00:00.000Z" });

  const lead = await repo.update("leads", lead0.id, { paymentInstallments: 10 });
  await syncWonLeadDeal(repo, lead);
  sub = (await repo.list("subscriptions")).find((s) => s.status !== "canceled");
  assert.equal(sub.cycle, "annual", "assinatura migra pro ciclo do plano");
  assert.equal(sub.price, 12000);
  const invoices = (await repo.list("invoices")).filter((i) => i.customer === customer.id);
  const renewals = invoices.filter((i) => i.kind === "renewal");
  assert.equal(renewals.length, 1, "aberta e inicial auto-paga (paidAt = dueDate) saem; a paga de verdade fica");
  assert.equal(renewals[0].paidAt, "2026-07-15T09:00:00.000Z");
  const parc = invoices.filter((i) => i.kind === "installment");
  assert.equal(parc.length, 10);
  assert.equal(sum(parc), 11000, "cronograma cobra o contrato menos o R$ 1.000 que já entrou");
});
