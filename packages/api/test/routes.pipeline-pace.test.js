// GET /api/pipeline-pace/:saas — caixa recebido no mês e desdobramento do gap
// em metas operacionais diárias por papel.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = new Date("2026-07-13T15:00:00.000Z"); // 12h em Brasília, segunda
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 0.5 },
  { stage: "Proposta", kind: "proposta", conv: 0.6 },
  { stage: "Ganho", kind: "ganho", conv: 0.4 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function build(product = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads",
    name: "LeverAds",
    funnel: FUNNEL,
    monthlyCashTarget: 120000,
    ...product,
  });
  // Contato = ação HUMANA (autor na collection users): os toques dos fixtures
  // levam author "sdr" pra contarem como contato do time.
  await repo.create("users", { id: "sdr", name: "SDR", roles: ["sdr"] });
  const app = Fastify();
  registerRoutes(app, repo, { pipelinePace: { now: () => NOW } });
  return { app, repo };
}

test("pace usa faturas pagas, dias úteis e desdobra o gap pelas conversões reais", async () => {
  const { app, repo } = await build();

  await repo.create("invoices", { id: "i1", saas: "leverads", subscription: "s1", customer: "c1", status: "paid", amount: 30000, paidAt: "2026-07-03T15:00:00.000Z" });
  await repo.create("invoices", { id: "i2", saas: "leverads", subscription: "s2", customer: "c2", status: "paid", amount: 10000, paidAt: "2026-07-13T15:00:00.000Z" });
  await repo.create("invoices", { id: "i3", saas: "leverads", status: "open", amount: 20000, dueDate: "2026-07-20T15:00:00.000Z" });
  await repo.create("invoices", { id: "i4", saas: "leverads", status: "overdue", amount: 5000, dueDate: "2026-06-30T15:00:00.000Z" });
  await repo.create("invoices", { id: "i5", saas: "leverads", status: "open", amount: 9000, dueDate: "2026-08-02T15:00:00.000Z" });

  await repo.create("customers", { id: "c1", saas: "leverads", arr: 12000, startedAt: "2026-07-03T15:00:00.000Z" });
  await repo.create("customers", { id: "c2", saas: "leverads", arr: 24000, startedAt: "2026-07-13T15:00:00.000Z" });

  const leads = [
    { id: "l1", stage: "Ganho", callAt: "2026-07-10T15:00:00.000Z", stageSince: "2026-07-13T14:00:00.000Z", amount: 40000 },
    { id: "l2", stage: "Proposta", callAt: "2026-07-13T18:00:00.000Z" },
    { id: "l3", stage: "Perdido", callAt: "2026-07-09T15:00:00.000Z", lostReason: "nao_compareceu" },
    { id: "l4", stage: "Call agendada", callAt: "2026-07-08T15:00:00.000Z" },
    { id: "l5", stage: "Novo lead" },
    { id: "l6", stage: "Novo lead" },
    { id: "l7", stage: "Novo lead" },
    { id: "l8", stage: "Novo lead" },
    { id: "l9", stage: "Novo lead" },
    { id: "l10", stage: "Novo lead", createdAt: "2026-07-13T13:00:00.000Z" },
  ];
  for (let i = 0; i < leads.length; i++) {
    await repo.create("leads", {
      saas: "leverads",
      createdAt: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      ...leads[i],
    });
  }
  for (let i = 1; i <= 8; i++) {
    await repo.create("activities", {
      id: `touch${i}`,
      saas: "leverads",
      lead: `l${i}`,
      type: "whatsapp",
      author: "sdr",
      at: i <= 2 ? "2026-07-13T13:30:00.000Z" : "2026-07-06T13:30:00.000Z",
    });
  }
  await repo.create("activities", { id: "b1", saas: "leverads", lead: "l1", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-07T14:00:00.000Z" });
  await repo.create("activities", { id: "b2", saas: "leverads", lead: "l2", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-13T14:00:00.000Z" });
  await repo.create("activities", { id: "b3", saas: "leverads", lead: "l3", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-08T14:00:00.000Z" });
  await repo.create("proposals", { id: "p1", saas: "leverads", lead: "l2", createdAt: "2026-07-13T16:00:00.000Z" });

  const res = await app.inject({ url: "/api/pipeline-pace/leverads" });
  assert.equal(res.statusCode, 200);
  const r = res.json();

  // A META agora é o VENDIDO (contrato cheio); o caixa segue como leitura.
  assert.equal(r.sale.target, 120000);
  assert.equal(r.sale.sold, 40000);        // l1 vendido no mês (wonAt/stageSince)
  assert.equal(r.sale.soldToday, 40000);   // vendido hoje (13/07)
  assert.equal(r.sale.gap, 80000);
  assert.equal(r.sale.requiredDailyPace, 5333.33);
  assert.equal(r.plan.sold.remaining, 80000);
  assert.equal(r.cash.target, 120000);
  assert.equal(r.cash.collected, 40000);
  assert.equal(r.cash.collectedToday, 10000);
  assert.equal(r.cash.gap, 80000);
  assert.equal(r.cash.totalBusinessDays, 23);
  assert.equal(r.cash.elapsedBusinessDays, 9);
  assert.equal(r.cash.remainingBusinessDays, 15); // inclui hoje
  assert.equal(r.cash.requiredDailyPace, 5333.33);
  assert.equal(r.cash.receivables, 25000);
  assert.equal(r.cash.forecastWithReceivables, 65000);

  assert.equal(r.context.tcvMonth, 40000);
  assert.equal(r.context.mrr, 3000);
  assert.equal(r.context.averageEntry, 20000);
  assert.equal(r.context.averageEntrySource, "initial_payments");

  assert.deepEqual(r.conversions.contactRate, { value: 0.8, source: "history", numerator: 8, denominator: 10 });
  assert.deepEqual(r.conversions.bookingRate, { value: 0.375, source: "history", numerator: 3, denominator: 8 });
  assert.equal(r.conversions.showRate.value, 0.6667);
  assert.equal(r.conversions.closeRate.value, 0.5); // call REALIZADA → ganho: 1 ganho ÷ 2 compareceram (mesma safra)

  assert.equal(r.plan.wins.remaining, 4);
  assert.equal(r.plan.calls.remaining, 8);          // 4 / 0,5 (fechamento efetivo, não calibrado aqui)
  assert.equal(r.plan.callsBooked.remaining, 12);   // 8 / 0,6667
  assert.equal(r.plan.leads.remaining, 40);         // 32 / 0,8
  assert.equal(r.plan.contacts.remaining, 32);      // 12 / 0,375
  assert.equal(r.plan.contacts.today, 2);
  assert.equal(r.plan.callsBooked.today, 1);
  assert.equal(r.plan.calls.today, 1);
  assert.equal(r.plan.wins.today, 1);
  assert.equal(r.plan.onboardings.today, 1);
  assert.equal(r.plan.proposals.today, 1);

  await app.close();
});

test("sem histórico usa metas configuradas e depois os benchmarks", async () => {
  const { app, repo } = await build();
  for (const [id, key, metric, target] of [
    ["g1", "sdr", "contactRate", 90],
    ["g2", "sdr", "bookingRate", 40],
    ["g3", "sdr", "showRate", 80],
    ["g4", "closer", "conversaoCall", 20],
    ["g5", "closer", "ticket", 10000],
  ]) await repo.create("goals", { id, saas: "leverads", scope: "role", key, metric, target });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.context.averageEntry, 10000);
  assert.equal(r.context.averageEntrySource, "configured_ticket");
  assert.deepEqual(Object.fromEntries(Object.entries(r.conversions).map(([k, v]) => [k, [v.value, v.source]])), {
    contactRate: [0.9, "goal"],
    bookingRate: [0.4, "goal"],
    showRate: [0.8, "goal"],
    closeRate: [0.2, "goal"],
    // sem leads na janela: ponta a ponta cai no produto da cadeia (benchmark)
    // e o fechamento efetivo repete o configurado.
    leadToWin: [0.0576, "benchmark"],
    closeRateEffective: [0.2, "goal"],
  });
  assert.equal(r.plan.wins.remaining, 12);

  await app.close();
});

test("ponta a ponta real calibra o fechamento e o plano fecha consistente", async () => {
  const { app, repo } = await build();
  // 25 leads criados na janela (amostra ≥20 libera a calibração), 2 ganhos de
  // R$ 4.000: ponta a ponta 2/25 = 8%. As taxas de etapa truncadas dariam
  // 0,4×0,5×0,75×0,2 = 3% — sem calibração o plano pediria ~2,7x mais leads.
  for (let i = 1; i <= 25; i++) {
    await repo.create("leads", { id: `l${i}`, saas: "leverads", stage: "Novo lead", createdAt: "2026-07-01T12:00:00.000Z" });
  }
  await repo.update("leads", "l1", { stage: "Ganho", amount: 4000, stageSince: "2026-07-10T12:00:00.000Z", callAt: "2026-07-08T15:00:00.000Z" });
  await repo.update("leads", "l2", { stage: "Ganho", amount: 4000, stageSince: "2026-07-11T12:00:00.000Z", callAt: "2026-07-09T15:00:00.000Z" });
  await repo.update("leads", "l3", { stage: "Perdido", lostReason: "nao_compareceu", callAt: "2026-07-08T16:00:00.000Z" });
  await repo.update("leads", "l4", { stage: "Perdido", lostReason: "sem_fit", callAt: "2026-07-09T16:00:00.000Z" });
  await repo.update("leads", "l5", { stage: "Call agendada", callAt: "2026-07-12T15:00:00.000Z" });
  // 10 tocados (contato 10/25 = 40%), 5 agendados entre eles (50%)
  for (let i = 1; i <= 10; i++) {
    await repo.create("activities", { id: `t${i}`, saas: "leverads", lead: `l${i}`, type: "whatsapp", author: "sdr", at: "2026-07-03T13:00:00.000Z" });
  }
  for (let i = 1; i <= 5; i++) {
    await repo.create("activities", { id: `bk${i}`, saas: "leverads", lead: `l${i}`, type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-05T14:00:00.000Z" });
  }
  // 5 calls antigas (fora da coorte) poluem o denominador do fechamento de
  // janela — exatamente o caso que a calibração corrige.
  for (let i = 26; i <= 30; i++) {
    await repo.create("leads", { id: `l${i}`, saas: "leverads", stage: "Proposta", createdAt: "2026-05-01T12:00:00.000Z", callAt: "2026-07-07T15:00:00.000Z" });
  }

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.deepEqual(r.conversions.leadToWin, { value: 0.08, source: "history", numerator: 2, denominator: 25 });
  assert.equal(r.conversions.closeRate.value, 0.6667); // realizada → ganho: 2 ganhos ÷ 3 compareceram
  assert.equal(r.conversions.showRate.value, 0.6);     // comparecimento sobre AGENDADAS: 3 ÷ 5 (funil encadeado)
  // efetivo = ponta a ponta ÷ (contato × agendamento × comparecimento) = 0,08 / 0,12
  assert.deepEqual(r.conversions.closeRateEffective, { value: 0.6667, source: "calibrated" });
  // gap do VENDIDO = 120k − 8k já vendidos = 112k; ÷ ticket 4k = 28 ganhos →
  // calls usam o fechamento EFETIVO e a cadeia fecha na ponta a ponta.
  assert.equal(r.plan.wins.remaining, 28);
  assert.equal(r.plan.calls.remaining, 42);       // 28 / 0,6667
  assert.equal(r.plan.callsBooked.remaining, 70); // 42 / 0,6
  assert.equal(r.plan.contacts.remaining, 140);   // 70 / 0,5
  assert.equal(r.plan.leads.remaining, 350);      // 140 / 0,4 (≈ 28 / 0,08)

  await app.close();
});

test("conversão histórica zerada bloqueia o desdobramento sem gerar infinito", async () => {
  const { app, repo } = await build();
  await repo.create("invoices", { id: "i1", saas: "leverads", status: "paid", amount: 10000, paidAt: "2026-06-01T15:00:00.000Z" });
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Novo lead", createdAt: "2026-07-01T15:00:00.000Z" });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.conversions.contactRate.value, 0);
  assert.equal(r.plan.blockedBy, "contactRate");
  assert.equal(r.plan.leads.remaining, null);
  // 12 ganhos ÷ 33% de fechamento = 37 calls ÷ 75% = 50 agendadas ÷ 30% = 167.
  assert.equal(r.plan.contacts.remaining, 167);
  assert.equal(r.plan.wins.remaining, 12);

  await app.close();
});

test("furo pela ETAPA No show entra no comparecimento (não só o motivo de perda)", async () => {
  const { app, repo } = await build({ funnel: [...FUNNEL, { stage: "No show", kind: "contato", conv: 1 }] });
  await repo.create("leads", { id: "n1", saas: "leverads", stage: "Proposta", createdAt: "2026-07-05T12:00:00.000Z" });
  await repo.create("leads", { id: "n2", saas: "leverads", stage: "No show", createdAt: "2026-07-05T12:00:00.000Z" });
  await repo.create("activities", { id: "nb1", saas: "leverads", lead: "n1", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-06T14:00:00.000Z" });
  await repo.create("activities", { id: "nb2", saas: "leverads", lead: "n2", type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-06T14:00:00.000Z" });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.deepEqual(r.conversions.showRate, { value: 0.5, source: "history", numerator: 1, denominator: 2 });
  await app.close();
});

test("paceAdjust: histórico pré-cockpit soma ao funil, que encadeia (cada denom = passo anterior)", async () => {
  const { app, repo } = await build({ paceAdjust: { contacted: 80, booked: 10, shown: 10, won: 7 } });
  // Base logada: 10 leads na janela, 8 contatados, 3 agendados (l1-l3), os 3
  // compareceram, l1 fechou.
  for (let i = 1; i <= 10; i++) {
    await repo.create("leads", { id: `l${i}`, saas: "leverads", stage: "Novo lead", createdAt: "2026-07-05T12:00:00.000Z" });
    if (i <= 8) await repo.create("activities", { id: `t${i}`, saas: "leverads", lead: `l${i}`, type: "whatsapp", author: "sdr", at: "2026-07-06T12:00:00.000Z" });
  }
  await repo.update("leads", "l1", { stage: "Ganho", stageSince: "2026-07-10T12:00:00.000Z", amount: 5000 });
  await repo.update("leads", "l2", { stage: "Proposta" });
  await repo.update("leads", "l3", { stage: "Proposta" });
  for (const i of [1, 2, 3]) await repo.create("activities", { id: `bk${i}`, saas: "leverads", lead: `l${i}`, type: "stage", meta: { from: "Novo lead", to: "Call agendada" }, at: "2026-07-07T12:00:00.000Z" });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.deepEqual(r.paceAdjust, { contacted: 80, booked: 10, shown: 10, won: 7 });
  const c = r.conversions;
  // leads 10 → contatados 8+80=88 → agendados 3+10=13 → compareceram 3+10=13 → ganho 1+7=8
  assert.deepEqual([c.contactRate.numerator, c.contactRate.denominator], [88, 10]);
  assert.deepEqual([c.bookingRate.numerator, c.bookingRate.denominator], [13, 88]);
  assert.deepEqual([c.showRate.numerator, c.showRate.denominator], [13, 13]);   // comparecimento sobre agendados
  assert.deepEqual([c.closeRate.numerator, c.closeRate.denominator], [8, 13]);  // ganho sobre compareceram
  assert.deepEqual([c.leadToWin.numerator, c.leadToWin.denominator], [8, 10]);  // ganho do funil sobre leads
  await app.close();
});

test("sem paceAdjust: paceAdjust é null e o funil não muda", async () => {
  const { app, repo } = await build();
  await repo.create("leads", { id: "x1", saas: "leverads", stage: "Novo lead", createdAt: "2026-07-05T12:00:00.000Z" });
  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.paceAdjust, null);
  await app.close();
});

test("sem monthlyCashTarget a meta cai no padrão e avisa targetConfigured=false", async () => {
  const { app } = await build({ monthlyCashTarget: 0 });
  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.cash.target, 120000);
  assert.equal(r.cash.targetConfigured, false); // a faixa aponta pra Metas → Empresa
  await app.close();
});

test("a meta persegue o VENDIDO, não o caixa (cartão 12x entra cheio)", async () => {
  const { app, repo } = await build({ monthlyCashTarget: 100000 });
  // Caixa do mês: só R$ 5.000 pago; vendido no mês: contrato cheio de R$ 50.000.
  await repo.create("invoices", { id: "iv", saas: "leverads", status: "paid", amount: 5000, paidAt: "2026-07-10T15:00:00.000Z" });
  await repo.create("leads", { id: "big", saas: "leverads", stage: "Ganho", amount: 50000, createdAt: "2026-07-01T12:00:00.000Z", stageSince: "2026-07-08T12:00:00.000Z" });

  const r = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  assert.equal(r.sale.sold, 50000);
  assert.equal(r.sale.gap, 50000);
  assert.equal(r.cash.collected, 5000);   // leitura de caixa intacta, separada da meta
  assert.equal(r.plan.wins.remaining, 10); // gap do VENDIDO ÷ ticket (5.000)
  await app.close();
});

test("produto inexistente retorna 404", async () => {
  const { app } = await build();
  assert.equal((await app.inject({ url: "/api/pipeline-pace/nao-existe" })).statusCode, 404);
  await app.close();
});

// ── Super metas: o pace re-ancora na próxima quando a base cai ──────────────
const { chaseCeiling } = await import("../src/routes.pipeline-pace.js");

test("chaseCeiling: base enquanto não bate; depois 125→150→200; null passado de 200", () => {
  const T = 120000;
  assert.equal(chaseCeiling(T, 0), 120000, "nada vendido: persegue a base");
  assert.equal(chaseCeiling(T, 100000), 120000);
  assert.equal(chaseCeiling(T, 130000), 150000, "bateu a base: vai pra 125% (150k)");
  assert.equal(chaseCeiling(T, 160000), 180000, "bateu 125%: vai pra 150% (180k)");
  assert.equal(chaseCeiling(T, 211106), 240000, "bateu 150%: vai pra 200% (240k)");
  assert.equal(chaseCeiling(T, 260000), null, "passou de 200%: nada acima");
});

test("bateu a meta base: o pace persegue a próxima super meta, não zera", async () => {
  const { app, repo } = await build();
  // Uma venda que estoura a base (120k) e passa de 150% (180k), mas não de 200%.
  const won = { id: "w1", saas: "leverads", stage: "Ganho", amount: 211106, wonAt: NOW.toISOString(), createdAt: NOW.toISOString(), isWon: true };
  await repo.create("leads", won);
  const d = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  const c = d.sale;

  assert.equal(c.gap, 0, "a folga da BASE é zero (marca meta batida na faixa)");
  assert.deepEqual(c.superMetas.map((s) => [s.pct, s.hit]), [[125, true], [150, true], [200, false]]);
  assert.equal(c.chaseTarget, 240000, "persegue a super meta de 200%");
  assert.equal(c.chasePct, 200);
  assert.ok(c.chaseGap > 28000 && c.chaseGap < 30000, "falta ~29k pra 240k");
  assert.ok(c.requiredDailyPace > 0, "e o precisa/dia deixa de ser zero");
  assert.ok(d.plan.wins.remaining > 0, "a cadeia volta a pedir ganhos");
  assert.equal(d.plan.sold.remaining, c.chaseGap, "o desdobramento persegue o gap da super meta");
});

test("passou de 200%: não há teto acima, o pace para de cobrar", async () => {
  const { app, repo } = await build();
  await repo.create("leads", { id: "w1", saas: "leverads", stage: "Ganho", amount: 260000, wonAt: NOW.toISOString(), createdAt: NOW.toISOString(), isWon: true });
  const c = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json().sale;
  assert.equal(c.chaseTarget, null);
  assert.equal(c.chaseGap, 0);
  assert.equal(c.superMetas.every((s) => s.hit), true);
});
