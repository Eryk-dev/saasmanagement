// Consistência entre telas — o contrato do metrics-core: o MESMO dataset
// passado por scoreboard, pace (Análise/faixa de meta), marketing, funil e
// custos tem que devolver os MESMOS números pra mesma pergunta. Se alguém
// reimplementar régua própria (ganho, dia do negócio, lead interno), este
// arquivo quebra antes de virar tela divergente.
//
// A régua de ganho é a do #367: venda como FATO do lead (customerId + wonAt),
// funil com Ganho ANTES da Integração; o fallback pro dado legado (Ganho sem
// carimbo → stageSince; sem nada → startedAt do cliente vinculado) também é
// exercitado aqui.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = new Date("2026-07-13T15:00:00.000Z"); // 12h em Brasília
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Qualificando", kind: "qualificacao", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "No show", kind: "contato", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Acompanhamento", kind: "posvenda", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

// Dataset canônico:
// - won_stamped vendeu em 08/07 (customerId + wonAt) e o card JÁ SEGUIU pra
//   Integração — R$ 5.000 (a receita não pode sumir quando o card anda)
// - won_legacy está em Ganho sem carimbo (pré-migração): fallback stageSince
//   09/07 — R$ 3.000
// - midnight nasceu 23h30 de 09/07 em Brasília (02h30Z de 10/07): dia do
//   negócio = 09/07
// - ghost é lead INTERNO (teste): fora de toda contagem
// - noshow virou call em 05/07 e está parado na etapa No show (furo)
async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, monthlyCashTarget: 100000 });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });

  await repo.create("leads", { id: "won_stamped", saas: "leverads", closer: "leo", stage: "Integração", amount: 5000, customerId: "c1", wonAt: "2026-07-08T12:00:00.000Z", createdAt: "2026-07-02T12:00:00.000Z", stageSince: "2026-07-11T12:00:00.000Z" });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente Carimbado", leadId: "won_stamped", startedAt: "2026-07-08T12:00:00.000Z" });
  await repo.create("leads", { id: "won_legacy", saas: "leverads", closer: "leo", stage: "Ganho", amount: 3000, createdAt: "2026-07-03T12:00:00.000Z", stageSince: "2026-07-09T12:00:00.000Z" });
  await repo.create("leads", { id: "midnight", saas: "leverads", stage: "Novo lead", createdAt: "2026-07-10T02:30:00.000Z" });
  await repo.create("leads", { id: "ghost", saas: "leverads", internal: true, stage: "Novo lead", createdAt: "2026-07-05T12:00:00.000Z" });
  await repo.create("leads", { id: "noshow", saas: "leverads", stage: "No show", createdAt: "2026-07-04T12:00:00.000Z" });
  await repo.create("activities", { id: "b1", saas: "leverads", lead: "noshow", type: "stage", author: "leo", at: "2026-07-05T12:00:00.000Z", meta: { from: "Qualificando", to: "Call agendada" } });

  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", subscription: "s1", status: "paid", amount: 20000, paidAt: "2026-07-06T15:00:00.000Z" });
  await repo.create("invoices", { id: "i2", saas: "leverads", status: "open", amount: 5000, dueDate: "2026-07-20T15:00:00.000Z" });
  await repo.create("expenses", { id: "e1", saas: "leverads", category: "checkout", pct: 10, month: "2026-07" });

  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => NOW } });
  return { app, repo };
}

const MONTH = "?since=2026-07-01&until=2026-07-31";

test("ganho oficial: scoreboard, pace, custos %, marketing e funil contam os MESMOS fechados", async () => {
  const { app } = await buildApp();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  const costs = (await app.inject({ url: "/api/expenses/summary/leverads?month=2026-07" })).json();
  const mkt = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();
  const funnel = (await app.inject({ url: `/api/funnel/leverads${MONTH}` })).json();

  // 2 vendas (carimbada + legado), R$ 8.000 — em TODAS as telas. A carimbada
  // conta MESMO com o card já em Integração (venda é fato do lead).
  assert.equal(sb.team.won, 2);
  assert.equal(sb.team.revenue, 8000);
  assert.equal(pace.context.wonMonth, sb.team.won);
  assert.equal(pace.context.tcvMonth, sb.team.revenue);
  assert.equal(costs.wonBase, pace.context.tcvMonth);          // base do custo % = mesmos fechados
  assert.equal(pace.sale.sold, sb.team.revenue);               // a META persegue o mesmo vendido
  assert.equal(costs.manual[0].amount, 800);                    // 10% de 8.000
  assert.equal(mkt.totals.won, 2);
  assert.equal(mkt.totals.revenue, 8000);
  assert.equal(funnel.wonCount, 2);                             // funil da Análise, mesma régua
  // closer soma igual ao time (uma pessoa só fechou)
  const leo = sb.closer.find((c) => c.user === "leo");
  assert.equal(leo.won, 2);
  assert.equal(leo.revenue, 8000);
  await app.close();
});

test("duas perguntas, dois números DE PROPÓSITO: fechado no período (scoreboard) ≠ coorte (funil/aquisição)", async () => {
  const { app, repo } = await buildApp();
  // Lead que ENTROU antes da janela (30/06) e FECHOU dentro dela (05/07). O
  // scoreboard/pace conta ("quantos FECHAMOS no período", pela data do ganho) —
  // é a régua do Resultado do mês. O funil e a Aquisição NÃO ("dos leads que
  // ENTRARAM no período, quantos fecharam" = coorte) — é a régua de eficiência
  // da aquisição (ROAS/CAC). As duas contas são CERTAS, respondem perguntas
  // diferentes; a tela rotula os dois lados (#492). Este teste TRAVA a diferença
  // pra ninguém "unificar" achando que é bug e quebrar um dos lados.
  await repo.create("leads", { id: "cross", saas: "leverads", closer: "leo", stage: "Ganho", amount: 1000, createdAt: "2026-06-30T12:00:00.000Z", stageSince: "2026-07-05T12:00:00.000Z" });

  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const mkt = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();
  const funnel = (await app.inject({ url: `/api/funnel/leverads${MONTH}` })).json();

  assert.equal(sb.team.won, 3);          // fechados no período: os 2 do dataset + o cross
  assert.equal(sb.team.revenue, 9000);   // 8.000 + 1.000
  assert.equal(mkt.totals.won, 2);       // coorte: o cross entrou ANTES, fica fora
  assert.equal(mkt.totals.revenue, 8000);
  assert.equal(funnel.wonCount, 2);      // mesma régua de coorte da Aquisição
  await app.close();
});

test("lead interno e dia do negócio: mesmas contagens de leads em todas as janelas", async () => {
  const { app } = await buildApp();
  // Mês inteiro: 4 leads reais (ghost interno fora) — scoreboard, marketing e funil iguais.
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const mkt = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();
  const funnel = (await app.inject({ url: `/api/funnel/leverads${MONTH}` })).json();
  assert.equal(sb.team.leadsNew, 4);
  assert.equal(mkt.totals.leads, 4);
  assert.equal(funnel.coverage.leads, 4);

  // midnight nasceu 02h30Z de 10/07 = 23h30 de 09/07 em Brasília → a janela que
  // começa em 10/07 NÃO o conta, em NENHUMA tela (antes cada uma cortava num
  // fuso e ele mudava de dia dependendo da tela).
  const W10 = "?since=2026-07-10&until=2026-07-31";
  assert.equal((await app.inject({ url: `/api/scoreboard/leverads${W10}` })).json().team.leadsNew, 0);
  assert.equal((await app.inject({ url: `/api/marketing/leverads${W10}` })).json().totals.leads, 0);
  assert.equal((await app.inject({ url: `/api/funnel/leverads${W10}` })).json().coverage.leads, 0);
  // ...e a janela que TERMINA em 09/07 o conta.
  const W09 = "?since=2026-07-09&until=2026-07-09";
  assert.equal((await app.inject({ url: `/api/scoreboard/leverads${W09}` })).json().team.leadsNew, 1);
  assert.equal((await app.inject({ url: `/api/marketing/leverads${W09}` })).json().totals.leads, 1);
  await app.close();
});

test("furo de call (etapa No show) conta igual no placar e no pace", async () => {
  const { app } = await buildApp();
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(sb.team.callsBooked, 1);
  assert.equal(sb.team.noShow, 1);
  assert.equal(sb.team.showRate, 0);
  assert.deepEqual(pace.conversions.showRate, { value: 0, source: "history", numerator: 0, denominator: 1 });
  await app.close();
});

test("caixa do mês: faturas pagas + a receber, a mesma conta da faixa de meta", async () => {
  const { app } = await buildApp();
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(pace.sale.target, 100000);
  assert.equal(pace.sale.sold, 8000);      // vendido = os mesmos fechados do placar
  assert.equal(pace.cash.target, 100000);
  assert.equal(pace.cash.collected, 20000);
  assert.equal(pace.cash.receivables, 5000);
  assert.equal(pace.cash.forecastWithReceivables, 25000);
  await app.close();
});
