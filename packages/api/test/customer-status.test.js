// Status do cliente num lugar só (Carteira, 03/11/2026): uma linha por cliente
// com ciclo, saúde, pagamento, assinatura, produtos, integração, próximo
// acompanhamento, tickets e NPS — e o recorte por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { customerStatusBoard, milestoneSummary, paymentSummary, productsFromPlanText, productsSummary, subscriptionSummary } from "../src/customers/customer-status.js";
import { registerRevenueRoutes } from "../src/customers/routes.revenue.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-03T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("assinatura: a atrasada representa o cliente e a renovação conta em dias", () => {
  const subs = [
    { id: "a", status: "active", cycle: "monthly", periodEnd: iso(NOW + 20 * DAY) },
    { id: "b", status: "past_due", cycle: "annual", periodEnd: iso(NOW + 200 * DAY) },
    { id: "c", status: "canceled", periodEnd: iso(NOW - 10 * DAY) },
  ];
  const s = subscriptionSummary(subs, NOW);
  assert.equal(s.id, "b");
  assert.equal(s.renewInDays, 200);
  assert.deepEqual([s.live, s.total], [2, 3]);
  assert.equal(subscriptionSummary([], NOW), null);
  const so = subscriptionSummary([{ id: "x", status: "canceled", periodEnd: iso(NOW - DAY) }], NOW);
  assert.deepEqual([so.status, so.renewInDays, so.live], ["canceled", null, 0], "só encerrada: mostra a última, sem renovação");
});

test("pagamento: vencida é a régua do billing e o status bate com o do sweep", () => {
  const subs = [{ status: "past_due" }];
  const invoices = [
    { status: "overdue", amount: 300, dueDate: iso(NOW - 12 * DAY) },
    { status: "overdue", amount: 200, dueDate: iso(NOW - 3 * DAY) },
    { status: "open", amount: 300, dueDate: iso(NOW + 5 * DAY) },
    { status: "open", amount: 300, dueDate: iso(NOW + 35 * DAY) },
    { status: "paid", amount: 300, paidAt: "2026-10-03T10:00:00Z" },
  ];
  const p = paymentSummary(invoices, subs, NOW);
  assert.deepEqual([p.status, p.overdueCount, p.overdueAmount, p.overdueDays], ["inadimplente", 2, 500, 12]);
  assert.equal(p.nextDue.amount, 300);
  assert.equal(p.nextDue.dueDate, iso(NOW + 5 * DAY));
  assert.equal(p.lastPaidAt, "2026-10-03T10:00:00Z");
  assert.equal(paymentSummary([{ status: "paid", paidAt: "2026-10-01" }], [{ status: "active" }], NOW).status, "adimplente");
});

test("produtos: o que a venda inclui e se já tem conta em cada sistema", () => {
  assert.deepEqual(productsSummary({ products: ["leverads", "leverprice"], leveradsOrgId: "org1" }), [
    { id: "leverads", account: true }, { id: "leverprice", account: false },
  ]);
  assert.deepEqual(productsSummary({ products: ["mentoria"] }), [{ id: "mentoria", account: null }]);
});

test("produtos: conta vinculada entra mesmo sem produto na venda (cliente antigo, plano só em texto)", () => {
  assert.deepEqual(productsSummary({ plan: "Anual", leveradsOrgId: "org1" }), [{ id: "leverads", account: true }]);
  assert.deepEqual(productsSummary({ plan: "Anual", leverpriceOrgId: "lp1" }), [{ id: "leverprice", account: true }]);
  assert.deepEqual(productsSummary({ planCode: "men_assistido", leveradsOrgId: "org1" }), [
    { id: "mentoria", account: null }, { id: "leverads", account: true },
  ]);
  assert.deepEqual(productsSummary({ plan: "Anual" }), [], "sem venda e sem conta, nada");
});

test("produtos: o plano escrito à mão completa a venda (os dois produtos do pacote antigo)", () => {
  assert.deepEqual(productsSummary({ plan: "LeverAds + LeverPrice · Anual", leveradsOrgId: "org1" }), [
    { id: "leverads", account: true }, { id: "leverprice", account: false },
  ]);
  assert.deepEqual(productsSummary({ plan: "ADS + PRICE · Anual" }), [{ id: "leverads", account: false }, { id: "leverprice", account: false }]);
  assert.deepEqual(productsSummary({ products: ["leverads"], plan: "LeverAds + LeverPrice · Anual" }), [{ id: "leverads", account: false }],
    "produtos das assinaturas mandam");
});

test("productsFromPlanText: o que os nomes de plano antigos citam", () => {
  const cases = {
    "LeverAds (15 contas) + LeverPrice (6 contas) · Anual": ["leverads", "leverprice"],
    "1000 SKUS (4.00) + PRICE (640.00) · Anual": ["leverads", "leverprice"],
    "LeverPrice + LeveraAds · Anual": ["leverads", "leverprice"],
    "LeverOEM Escala + LeverPrice Essencial · Anual": ["leverads", "leverprice"],
    "LeverAds Full + Lever Price + OEM · Anual": ["leverads", "leverprice"],
    "Lever Price · Essencial · Anual": ["leverprice"],
    "Criação 1000 anúncios + Otimização 600 anúncios · Serviço único": ["leverads"],
    "1 MES OEM · Serviço único": ["leverads"],
    "MENTORIA GABI 6 MESES · Serviço único": ["mentoria"],
    "Anual": [], "Teste grátis · Serviço único": [], "": [],
  };
  for (const [text, want] of Object.entries(cases)) assert.deepEqual(productsFromPlanText(text), want, text);
});

test("régua: feitos, atrasados, a barra por marco e o próximo em aberto", () => {
  const start = iso(NOW - 40 * DAY);
  const r = milestoneSummary({ saas: "leverads", startedAt: start, plan: "Anual", milestonesDone: { onboarding: "2026-10-01" } }, null, [], NOW);
  assert.deepEqual([r.done, r.late, r.next.key, r.next.status], [1, 1, "checkin_m1", "late"]);
  assert.equal(r.total, r.steps.length);
  assert.deepEqual(r.steps.slice(0, 3).map((x) => x.status), ["done", "late", "next"]);
  assert.equal(milestoneSummary({ saas: "uniquekids", startedAt: start }, null, [], NOW), null, "mentoria fica fora");
  assert.equal(milestoneSummary({ saas: "leverads", startedAt: "" }, null, [], NOW), null, "sem data de entrada");
  // Ciclo da assinatura ativa como fallback do contrato (semestral: renovação no dia 122).
  const sem = milestoneSummary({ saas: "leverads", startedAt: start }, null, [{ status: "active", cycle: "semiannual" }], NOW);
  assert.ok(sem.steps.some((x) => x.key === "renovacao"));
});

test("quadro: uma linha por cliente do produto, com tudo junto", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", {
    saas: "leverads", name: "Loja Azul", owner: "bia", arr: 12000, plan: "Full · mensal", products: ["leverads"], leveradsOrgId: "o1",
    lifecycle: "ativo", csStage: "atencao", health: 62, healthParts: { pagamento: 40, nps: 10, suporte: 2, resultado: 10 },
  });
  const ido = await repo.create("customers", { saas: "leverads", name: "Saiu", arr: 6000, endedAt: "2026-09-01T00:00:00Z", lifecycle: "churn", csStage: "churn" });
  await repo.create("customers", { saas: "leverprice", name: "Outro produto" });
  await repo.create("subscriptions", { saas: "leverads", customer: c.id, status: "active", cycle: "monthly", periodEnd: iso(NOW + 9 * DAY) });
  await repo.create("invoices", { saas: "leverads", customer: c.id, status: "paid", amount: 1000, paidAt: "2026-10-04T00:00:00Z" });
  await repo.create("cs_followups", { saas: "leverads", customer: c.id, kind: "renovacao", status: "aberto", owner: "bia", dueAt: iso(NOW - DAY), title: "Contato de renovação", milestone: "renovacao" });
  await repo.create("cs_followups", { saas: "leverads", customer: c.id, kind: "check_in", status: "aberto", dueAt: iso(NOW + 10 * DAY) });
  await repo.create("cs_followups", { saas: "leverads", customer: c.id, kind: "qbr", status: "feito", dueAt: iso(NOW - 30 * DAY) });
  await repo.create("onboardings", { saas: "leverads", customer: c.id, stage: "treinamento", kind: "novo_produto", items: [{ doneAt: "x" }, { doneAt: "" }], createdAt: "2026-10-20" });
  await repo.create("tickets", { saas: "leverads", customerId: c.id, status: "open", priority: "high", messages: [{ text: "pesado" }] });
  await repo.create("tickets", { saas: "leverads", customerId: c.id, status: "closed", priority: "urgent" });
  await repo.create("nps", { saas: "leverads", customer: c.id, status: "answered", score: 9, answeredAt: "2026-10-10" });

  const { rows } = await customerStatusBoard(repo, { saas: "leverads", now: NOW });
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Loja Azul", "Saiu"], "só o produto pedido");
  const r = rows.find((x) => x.id === c.id);
  assert.equal(r.mrr, 1000);
  assert.deepEqual([r.lifecycle, r.csStage, r.health, r.healthParts.suporte], ["ativo", "atencao", 62, 2]);
  assert.equal(r.payment.status, "adimplente");
  assert.deepEqual([r.subscription.status, r.subscription.renewInDays], ["active", 9]);
  assert.deepEqual(r.products, [{ id: "leverads", account: true }]);
  assert.deepEqual([r.onboarding.stage, r.onboarding.progress], ["treinamento", 50]);
  assert.deepEqual([r.followup.kind, r.followup.late, r.followup.open, r.followup.title, r.followup.milestone], ["renovacao", true, 2, "Contato de renovação", "renovacao"], "o mais urgente dos abertos");
  assert.equal(r.milestones, null, "sem data de entrada não há régua");
  assert.deepEqual(r.tickets, { open: 1, urgent: 1 });
  assert.deepEqual(r.nps, { score: 9, at: "2026-10-10" });
  const saiu = rows.find((x) => x.id === ido.id);
  assert.deepEqual([saiu.churned, saiu.mrr, saiu.subscription, saiu.followup], [true, 0, null, null], "churn sai do MRR, sem inventar assinatura");
});

test("rota: GET /api/customers/status filtra pelo produto da query", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { saas: "leverads", name: "A" });
  await repo.create("customers", { saas: "leverprice", name: "B" });
  const app = Fastify();
  registerRevenueRoutes(app, repo);
  const res = await app.inject({ url: "/api/customers/status?saas=leverprice" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().rows.map((r) => r.name), ["B"]);
});
