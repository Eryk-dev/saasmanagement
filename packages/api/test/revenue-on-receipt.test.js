// Receita RECONHECIDA (Leo, 29/08/2026): boleto faturado, PIX parcelado e
// assinatura recorrente no cartão contam na meta só pelo que ENTROU de verdade
// na janela do fechamento — o contrato cheio deixa de virar meta no dia da
// venda. À vista e cartão 12x seguem contando inteiro (a adquirente antecipa).
//
// Este arquivo trava a régua nos dois níveis: a função do metrics-core e as
// telas que a consomem (placar do SDR/closer/time e a meta do mês/da janela).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  saleValuer, cashReceivedByCustomer, revenueOf, isPayOnReceipt,
  isRealReceipt, paymentMethodOf, cashCollectedIn, cashBucketsIn,
} from "../src/metrics-core.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = new Date("2026-07-13T15:00:00.000Z"); // 12h em Brasília
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];
const inJuly = (iso) => String(iso || "").startsWith("2026-07");

test("meio à vista (ou em branco) conta o contrato cheio no fechamento", () => {
  const valueOf = saleValuer({ invoices: [], mpPayments: [], customers: [{ id: "c1" }], inWin: inJuly });
  assert.equal(valueOf({ amount: 5000, customerId: "c1", paymentMethod: "pix" }), 5000);
  assert.equal(valueOf({ amount: 5000, customerId: "c1", paymentMethod: "cartao12x" }), 5000);
  assert.equal(valueOf({ amount: 5000, customerId: "c1", paymentMethod: "boleto_vista" }), 5000);
  assert.equal(valueOf({ amount: 5000, customerId: "c1" }), 5000); // fechamento antigo, sem o campo
  assert.equal(isPayOnReceipt("pix"), false);
  assert.equal(isPayOnReceipt("boleto"), true);
  assert.equal(isPayOnReceipt("cartao_recorrente"), true);
  assert.equal(isPayOnReceipt("pix_parcelado"), true);
});

test("faturado conta só a parcela que caiu na janela — nem mais, nem o contrato cheio", () => {
  const customers = [{ id: "c1", leadId: "l1" }];
  const invoices = [
    { customer: "c1", kind: "installment", status: "paid", amount: 1000, paidAt: "2026-07-05T12:00:00.000Z" },
    { customer: "c1", kind: "installment", status: "open", amount: 1000, dueDate: "2026-08-05T12:00:00.000Z" },
    { customer: "c1", kind: "installment", status: "paid", amount: 1000, paidAt: "2026-09-05T12:00:00.000Z" }, // fora da janela
  ];
  const valueOf = saleValuer({ invoices, mpPayments: [], customers, inWin: inJuly });
  const lead = { id: "l1", amount: 12000, customerId: "c1", paymentMethod: "boleto" };
  assert.equal(valueOf(lead), 1000);
  // Sem nenhuma baixa, faturado é promessa: zero na meta.
  const semBaixa = saleValuer({ invoices: [], mpPayments: [], customers, inWin: inJuly });
  assert.equal(semBaixa(lead), 0);
});

test("assinatura recorrente: a fatura que NASCE paga no fechamento não é recebimento; o pagamento do MP é", () => {
  const customers = [{ id: "c1", leadId: "l1" }];
  const lead = { id: "l1", amount: 1000, customerId: "c1", paymentMethod: "cartao_recorrente" };
  // A fatura inicial do createClosedSubscription nasce paga com paidAt =
  // periodStart: fechar no cartão não é receber (mesma régua do Status pgto.).
  const nasceuPaga = [{ customer: "c1", kind: "renewal", status: "paid", amount: 1000, paidAt: "2026-07-02T12:00:00.000Z", periodStart: "2026-07-02T12:00:00.000Z" }];
  assert.equal(saleValuer({ invoices: nasceuPaga, mpPayments: [], customers, inWin: inJuly })(lead), 0);
  // Cobrança de verdade no Mercado Pago (preapproval autorizado) → conta.
  const mp = [{ mpId: "p1", status: "approved", amount: 1000, customer: "c1", dateApproved: "2026-07-03T12:00:00.000Z" }];
  assert.equal(saleValuer({ invoices: nasceuPaga, mpPayments: mp, customers, inWin: inJuly })(lead), 1000);
});

test("o mesmo dinheiro não conta duas vezes (pagamento do MP + fatura baixada por ele) e nunca passa do contrato", () => {
  const customers = [{ id: "c1", leadId: "l1" }];
  const mpPayments = [{ mpId: "p1", status: "approved", amount: 1000, lead: "l1", dateApproved: "2026-07-04T12:00:00.000Z" }];
  const invoices = [
    { customer: "c1", kind: "installment", status: "paid", amount: 1000, paidAt: "2026-07-04T12:00:00.000Z", mpPaymentId: "p1" },
    { customer: "c1", kind: "upsell", status: "paid", amount: 9000, paidAt: "2026-07-09T12:00:00.000Z" },
  ];
  const cash = cashReceivedByCustomer({ invoices, mpPayments, customers, inWin: inJuly });
  assert.equal(cash.get("c1"), 10000); // 1.000 (contado uma vez) + 9.000 do upsell
  // Teto no contrato: o upsell do mês não faz a venda de 3.000 valer 10.000.
  const valueOf = saleValuer({ invoices, mpPayments, customers, inWin: inJuly });
  assert.equal(valueOf({ id: "l1", amount: 3000, customerId: "c1", paymentMethod: "boleto" }), 3000);
});

test("meio de pagamento do CLIENTE vale quando o lead não tem (ficha editada depois)", () => {
  const customers = [{ id: "c1", leadId: "l1", paymentMethod: "boleto" }];
  const valueOf = saleValuer({ invoices: [], mpPayments: [], customers, inWin: inJuly });
  assert.equal(valueOf({ id: "l1", amount: 8000, customerId: "c1" }), 0);
  assert.equal(revenueOf([{ id: "l1", amount: 8000, customerId: "c1" }], valueOf), 0);
});

test("Recebido do mês ignora a fatura que nasce paga no fechamento do faturado/recorrente", () => {
  const customers = [
    { id: "cr", paymentMethod: "cartao_recorrente", startedAt: "2026-07-02T12:00:00.000Z" },
    { id: "cv", paymentMethod: "pix", startedAt: "2026-07-02T12:00:00.000Z" },
  ];
  const invoices = [
    // Nasceram pagas no fechamento (paidAt = periodStart), as duas.
    { customer: "cr", kind: "renewal", status: "paid", amount: 599, paidAt: "2026-07-02T12:00:00.000Z", periodStart: "2026-07-02T12:00:00.000Z" },
    { customer: "cv", kind: "renewal", status: "paid", amount: 5000, paidAt: "2026-07-02T12:00:00.000Z", periodStart: "2026-07-02T12:00:00.000Z" },
    // Cobrança de verdade do MP no mês seguinte da recorrente.
    { customer: "cr", kind: "renewal", status: "paid", amount: 599, paidAt: "2026-07-20T12:00:00.000Z", periodStart: "2026-08-02T12:00:00.000Z", mpPaymentId: "p9" },
  ];
  const methodOf = paymentMethodOf(customers);
  assert.equal(isRealReceipt(invoices[0], methodOf), false, "autorizar a assinatura não é receber");
  assert.equal(isRealReceipt(invoices[1], methodOf), true, "à vista: o fechamento É o recebimento");
  assert.equal(isRealReceipt(invoices[2], methodOf), true, "cobrança do MP é dinheiro de verdade");
  assert.equal(cashCollectedIn(invoices, "2026-07", methodOf), 5599);
  assert.equal(cashCollectedIn(invoices, "2026-07"), 6198, "sem o meio de pagamento, o comportamento antigo");
  const buckets = cashBucketsIn(invoices, customers, (iso) => String(iso).startsWith("2026-07"));
  assert.equal(buckets.total, 5599);
});

// ── As telas ────────────────────────────────────────────────────────────────
// Duas vendas no mesmo mês: uma no PIX (5.000, entra cheia) e uma faturada em
// 12 boletos (12.000, com só a 1ª parcela paga). O placar e a meta têm que
// contar 6.000, não 17.000 — e mostrar o contratado ao lado.
async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, monthlyCashTarget: 100000 });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  await repo.create("users", { id: "manu", name: "Manuela", roles: ["sdr"] });

  await repo.create("leads", {
    id: "vista", saas: "leverads", owner: "manu", closer: "leo", stage: "Ganho", amount: 5000,
    paymentMethod: "pix", planClosed: "anual", customerId: "cv", wonAt: "2026-07-06T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z", stageSince: "2026-07-06T12:00:00.000Z",
  });
  await repo.create("customers", { id: "cv", saas: "leverads", name: "À vista", leadId: "vista", startedAt: "2026-07-06T12:00:00.000Z", paymentMethod: "pix" });

  await repo.create("leads", {
    id: "faturado", saas: "leverads", owner: "manu", closer: "leo", stage: "Ganho", amount: 12000,
    paymentMethod: "boleto", paymentInstallments: 12, planClosed: "anual", customerId: "cf",
    wonAt: "2026-07-08T12:00:00.000Z", createdAt: "2026-07-02T12:00:00.000Z", stageSince: "2026-07-08T12:00:00.000Z",
  });
  await repo.create("customers", { id: "cf", saas: "leverads", name: "Faturado", leadId: "faturado", startedAt: "2026-07-08T12:00:00.000Z", paymentMethod: "boleto" });
  // Cronograma: 12 parcelas de 1.000, a 1ª baixada em julho, o resto em aberto.
  await repo.create("invoices", { id: "p1", saas: "leverads", customer: "cf", kind: "installment", status: "paid", amount: 1000, paidAt: "2026-07-08T13:00:00.000Z", dueDate: "2026-07-08T12:00:00.000Z" });
  for (let n = 2; n <= 12; n++) {
    await repo.create("invoices", { id: `p${n}`, saas: "leverads", customer: "cf", kind: "installment", status: "open", amount: 1000, dueDate: `2026-${String(6 + n).padStart(2, "0")}-08T12:00:00.000Z` });
  }
  // Recebimento do PIX (baixa manual da fatura à vista) — não muda o valor da
  // venda à vista, que já conta cheia, mas mantém o caixa realista.
  await repo.create("invoices", { id: "v1", saas: "leverads", customer: "cv", kind: "renewal", status: "paid", amount: 5000, paidAt: "2026-07-06T13:00:00.000Z" });

  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => NOW }, scoreboard: { now: () => NOW } });
  return { app, repo };
}

const MONTH = "?since=2026-07-01&until=2026-07-31";

test("placar e meta contam 6.000 (5.000 à vista + 1 parcela), não os 17.000 contratados", async () => {
  const { app } = await buildApp();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  const janela = (await app.inject({ url: "/api/pipeline-pace/leverads/window?since=2026-07-01&until=2026-07-31" })).json();

  assert.equal(sb.team.won, 2);            // os DOIS contratos continuam contando
  assert.equal(sb.team.revenue, 6000);     // o R$ é só o que entrou
  assert.equal(sb.team.contracted, 17000); // o contrato cheio segue à vista, ao lado

  const leo = sb.closer.find((c) => c.user === "leo");
  assert.equal(leo.won, 2);
  assert.equal(leo.revenue, 6000);
  assert.equal(leo.contracted, 17000);
  assert.equal(leo.ticket, 3000);          // won × ticket = receita (o card fecha)

  const manu = sb.sdr.find((p) => p.user === "manu");
  assert.equal(manu.won, 2);
  assert.equal(manu.revenue, 6000);
  assert.equal(manu.contracted, 17000);

  // Meta da empresa: o mês e a janela perseguem o MESMO número do placar.
  assert.equal(pace.sale.sold, 6000);
  assert.equal(pace.sale.contracted, 17000);
  assert.equal(pace.context.tcvMonth, 17000); // contexto (e base do custo %) segue o contratado
  assert.equal(janela.sale.sold, 6000);
  assert.equal(janela.sale.contracted, 17000);
  // Série do gráfico de pace: soma dia a dia = o vendido reconhecido.
  assert.equal(pace.sale.byDay.reduce((a, v) => a + v, 0), 6000);
  await app.close();
});

test("parcela do mês seguinte NÃO volta a contar: a venda conta uma vez, no mês em que fechou", async () => {
  const { app, repo } = await buildApp();
  // Agosto: a 2ª parcela cai, mas o fechamento foi em julho — a janela de
  // agosto não tem venda nenhuma, então a meta de agosto segue zerada (o
  // dinheiro dela aparece no caixa do Financeiro, não na meta de ninguém).
  await repo.update("invoices", "p2", { status: "paid", paidAt: "2026-08-08T13:00:00.000Z" });
  const ago = (await app.inject({ url: "/api/scoreboard/leverads?since=2026-08-01&until=2026-08-31" })).json();
  assert.equal(ago.team.won, 0);
  assert.equal(ago.team.revenue, 0);
  // E julho continua valendo 6.000 (não vira 7.000 retroativamente).
  const jul = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  assert.equal(jul.team.revenue, 6000);
  await app.close();
});

test("baixar a parcela dentro do mês do fechamento aumenta a meta na hora", async () => {
  const { app, repo } = await buildApp();
  // Entrada de 3 mil paga no mesmo mês (acordo com sinal): a venda passa a
  // valer 4.000 na meta de julho (1.000 da parcela + 3.000 da entrada).
  await repo.create("invoices", { id: "sinal", saas: "leverads", customer: "cf", kind: "installment", status: "paid", amount: 3000, paidAt: "2026-07-20T13:00:00.000Z" });
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  assert.equal(sb.team.revenue, 9000); // 5.000 à vista + 4.000 recebidos do faturado
  await app.close();
});
