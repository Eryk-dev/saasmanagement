// Custos operacionais: resumo mensal (ads + IA + manuais) e a correção do
// custo por etapa (estágios pós-Ganho não contam como progresso).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerMetricsRoutes } = await import("../src/routes.metrics.js");
const { registerMarketingRoutes } = await import("../src/routes.marketing.js");

const FUNNEL = ["Inbox", "Qualificação", "Call closer", "Negociação", "Integração", "Ganho", "Sem resposta / Nutrição", "Desqualificado", "Perdido", "Mentoria"]
  .map((stage) => ({ stage, conv: 1 }));

test("custo por etapa: descartados e pós-venda não contam como Ganho", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const today = new Date().toISOString();
  const day = today.slice(0, 10);
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "c", date: day, spend: 600 });
  // 6 leads: 2 Inbox, 1 Call closer, 1 Ganho, 1 Desqualificado, 1 Perdido
  const mk = (id, stage) => repo.create("leads", { id, saas: "leverads", name: id, stage, createdAt: today });
  await mk("l1", "Inbox"); await mk("l2", "Inbox"); await mk("l3", "Call closer");
  await mk("l4", "Ganho"); await mk("l5", "Desqualificado"); await mk("l6", "Perdido");

  const app = Fastify();
  registerMarketingRoutes(app, repo, { meta: { configured: () => false } });
  const res = await app.inject({ method: "GET", url: "/api/marketing/leverads" });
  const per = Object.fromEntries(res.json().perStage.map((s) => [s.stage, s.count]));

  assert.equal(per["Inbox"], 6);           // todos chegaram
  assert.equal(per["Call closer"], 2);     // l3 + l4
  assert.equal(per["Ganho"], 1);           // SÓ o l4 (antes contava descartados)
  assert.equal(per["Desqualificado"], undefined); // régua termina em Ganho
  await app.close();
});

test("GET /api/expenses/summary soma ads + IA (em R$) + manuais do mês", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const month = new Date().toISOString().slice(0, 7);
  const day = new Date().toISOString().slice(0, 10);
  await repo.create("ad_insights", { id: "a1", saas: "leverads", campaignId: "c", date: day, spend: 1000 });
  await repo.create("ad_insights", { id: "a2", saas: "leverads", campaignId: "c", date: "2020-01-05", spend: 999 }); // fora do mês
  await repo.create("expenses", { id: "e1", saas: "leverads", month, category: "fixo", name: "Servidor", amount: 200 });
  await repo.create("expenses", { id: "e2", saas: "leverads", month, category: "ferramenta", name: "CRM", amount: 100 });
  await repo.create("expenses", { id: "e3", saas: "leverads", month: "2020-01", category: "fixo", name: "antigo", amount: 999 });
  // recorrentes: contador entra todo mês desde 2020; o encerrado em 2020-06 não
  await repo.create("expenses", { id: "e4", saas: "leverads", month: "2020-01", category: "fixo", name: "Contador", amount: 400, recurring: true });
  await repo.create("expenses", { id: "e5", saas: "leverads", month: "2020-01", category: "fixo", name: "Sala", amount: 555, recurring: true, endMonth: "2020-06" });

  const ai = {
    configured: () => true,
    report: async () => ({
      usdBrl: 5,
      providers: [{ provider: "openai", ok: true, series: [{ date: day, spend: 10 }, { date: "2020-01-02", spend: 99 }] }],
    }),
  };
  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai });
  const res = await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  assert.equal(s.ads, 1000);
  assert.equal(s.aiUSD, 10);
  assert.equal(s.ai, 50);            // 10 USD × 5
  assert.equal(s.manualTotal, 700);  // 200 + 100 + 400 do recorrente ativo
  assert.equal(s.total, 1750);
  assert.equal(s.manual.length, 3);
  assert.equal(s.manual[0].name, "Contador"); // recorrente vem primeiro

  // em 2020-03 valem os dois recorrentes (Sala só encerra em 2020-06) + o avulso de jan não
  const past = (await app.inject({ method: "GET", url: "/api/expenses/summary/leverads?month=2020-03" })).json();
  assert.deepEqual(past.manual.map((e) => e.name).sort(), ["Contador", "Sala"]);
  assert.equal(past.manualTotal, 955);
  await app.close();
});

test("custo de IA é global: só o PRIMEIRO produto (ordem de id) carrega, sem dobrar no portfólio", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", funnel: FUNNEL });
  const month = new Date().toISOString().slice(0, 7);
  const day = new Date().toISOString().slice(0, 10);
  const ai = {
    configured: () => true,
    report: async () => ({ usdBrl: 5, providers: [{ provider: "openai", ok: true, series: [{ date: day, spend: 10 }] }] }),
  };
  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai });

  const first = (await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` })).json();
  assert.equal(first.ai, 50); // dono: "leverads" < "uniquekids" na ordem de id

  const second = (await app.inject({ method: "GET", url: `/api/expenses/summary/uniquekids?month=${month}` })).json();
  assert.equal(second.ai, null);
  assert.equal(second.aiUSD, null);
  assert.equal(second.total, 0); // nada de IA duplicada no segundo produto
  await app.close();
});

test("custo percentual (checkout/imposto): % sobre os ganhos do mês no pipeline", async () => {
  const repo = makeMemRepo();
  const funnel = [{ stage: "Novo lead", kind: "novo", conv: 1 }, { stage: "Ganho", kind: "ganho", conv: 1 }];
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel });
  const month = new Date().toISOString().slice(0, 7);
  const nowIso = new Date().toISOString();

  // Ganhos do mês: 7.000 + 3.000 = 10.000. Fora: lead aberto, ganho antigo, outro saas.
  await repo.create("leads", { id: "w1", saas: "leverads", stage: "Ganho", amount: 7000, stageSince: nowIso });
  await repo.create("leads", { id: "w2", saas: "leverads", stage: "Ganho", amount: 3000, stageSince: nowIso });
  await repo.create("leads", { id: "o1", saas: "leverads", stage: "Novo lead", amount: 9999, stageSince: nowIso });
  await repo.create("leads", { id: "w3", saas: "leverads", stage: "Ganho", amount: 5000, stageSince: "2020-01-10T00:00:00Z" });
  await repo.create("leads", { id: "w4", saas: "outro", stage: "Ganho", amount: 4000, stageSince: nowIso });

  // Checkout 12% recorrente desde um mês antigo + um fixo pra somar junto.
  await repo.create("expenses", { id: "e1", saas: "leverads", month: "2020-01", category: "taxas", name: "Checkout", pct: 12, recurring: true });
  await repo.create("expenses", { id: "e2", saas: "leverads", month, category: "fixo", name: "Servidor", amount: 200 });

  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai: { configured: () => false } });

  const s = (await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` })).json();
  assert.equal(s.wonBase, 10000);
  const checkout = s.manual.find((e) => e.id === "e1");
  assert.equal(checkout.amount, 1200); // 12% de 10.000
  assert.equal(checkout.pct, 12);
  assert.equal(s.manualTotal, 1400);   // 1.200 + 200
  assert.equal(s.total, 1400);

  // Mês sem ganho: percentual vale 0 (e a base reportada é 0).
  const past = (await app.inject({ method: "GET", url: "/api/expenses/summary/leverads?month=2021-05" })).json();
  const pc = past.manual.find((e) => e.id === "e1");
  assert.equal(pc.amount, 0);
  assert.equal(past.wonBase, 0);
});

test("custo percentual com base: checkout sobre o dinheiro de cartão que entrou no mês (espelho, D+0), imposto sobre os recebidos", async () => {
  const repo = makeMemRepo();
  const funnel = [{ stage: "Novo lead", kind: "novo", conv: 1 }, { stage: "Ganho", kind: "ganho", conv: 1 }];
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel });
  const month = new Date().toISOString().slice(0, 7);
  const nowIso = new Date().toISOString();

  // Ganhos do mês: 10.000 (wonBase). A base do CARTÃO vem do que ENTROU no
  // espelho MP (4.000 + 3.000 aprovados no crédito = 7.000) — a MARCAÇÃO
  // "cartão 12x" do fechamento (w1) NÃO gera base sozinha; PIX, recusado e
  // outra conta ficam fora.
  await repo.create("leads", { id: "w1", saas: "leverads", stage: "Ganho", amount: 7000, stageSince: nowIso, paymentMethod: "cartao12x" });
  await repo.create("leads", { id: "w2", saas: "leverads", stage: "Ganho", amount: 3000, stageSince: nowIso, paymentMethod: "pix" });
  await repo.create("mp_payments", { id: "mpp_1", saas: "leverads", status: "approved", methodType: "credit_card", amount: 4000, installments: 12, dateApproved: nowIso });
  await repo.create("mp_payments", { id: "mpp_2", saas: "leverads", status: "approved", methodType: "credit_card", amount: 3000, installments: 1, dateApproved: nowIso });
  await repo.create("mp_payments", { id: "mpp_3", saas: "leverads", status: "approved", methodType: "bank_transfer", amount: 500, dateApproved: nowIso });
  await repo.create("mp_payments", { id: "mpp_4", saas: "leverads", status: "rejected", methodType: "credit_card", amount: 900, dateApproved: nowIso });
  await repo.create("mp_payments", { id: "mpp_5", saas: "outro", status: "approved", methodType: "credit_card", amount: 800, dateApproved: nowIso });
  // Recebidos do mês: 599 + 401 pagos; aberta, paga em mês antigo e outro saas ficam fora.
  await repo.create("invoices", { id: "i1", saas: "leverads", amount: 599, status: "paid", paidAt: nowIso });
  await repo.create("invoices", { id: "i2", saas: "leverads", amount: 401, status: "paid", paidAt: nowIso });
  await repo.create("invoices", { id: "i3", saas: "leverads", amount: 999, status: "open", dueDate: nowIso });
  await repo.create("invoices", { id: "i4", saas: "leverads", amount: 888, status: "paid", paidAt: "2020-02-10T00:00:00Z" });
  await repo.create("invoices", { id: "i5", saas: "outro", amount: 777, status: "paid", paidAt: nowIso });

  await repo.create("expenses", { id: "e1", saas: "leverads", month: "2020-01", category: "taxas", name: "Checkout", pct: 12, base: "cartao12x", recurring: true });
  await repo.create("expenses", { id: "e2", saas: "leverads", month: "2020-01", category: "taxas", name: "Imposto", pct: 20, base: "received", recurring: true });
  await repo.create("expenses", { id: "e3", saas: "leverads", month: "2020-01", category: "taxas", name: "Genérico", pct: 10, recurring: true }); // sem base = ganhos

  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai: { configured: () => false } });
  const s = (await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` })).json();

  assert.equal(s.wonBase, 10000);
  assert.equal(s.cardBase, 7000, "só o que ENTROU no cartão; a marcação do lead não conta");
  assert.equal(s.receivedBase, 1000);
  assert.equal(s.manual.find((e) => e.id === "e1").amount, 840);  // 12% de 7.000
  assert.equal(s.manual.find((e) => e.id === "e2").amount, 200);  // 20% de 1.000
  assert.equal(s.manual.find((e) => e.id === "e3").amount, 1000); // 10% de 10.000
  assert.equal(s.manual.find((e) => e.id === "e2").base, "received"); // base ecoada pra pill da tela
  await app.close();
});

test("summary soma as contas a pagar do mês no total (tudo conversa com o Financeiro)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const month = new Date().toISOString().slice(0, 7);
  await repo.create("expenses", { id: "e1", saas: "leverads", month, category: "ferramenta", name: "Softwares", amount: 300 });
  await repo.create("payables", { id: "p1", saas: "leverads", month, description: "Salário", category: "pessoal_com", amount: 2000, dueDate: `${month}-05`, status: "aberta" });
  await repo.create("payables", { id: "p2", saas: "leverads", month: "2020-01", description: "Antiga", category: "outros", amount: 999, dueDate: "2020-01-05", status: "paga" });
  const app = Fastify();
  registerMetricsRoutes(app, repo, { ai: { configured: () => false } });
  const s = (await app.inject({ method: "GET", url: `/api/expenses/summary/leverads?month=${month}` })).json();
  assert.equal(s.payablesTotal, 2000, "só a competência do mês");
  assert.equal(s.payablesCount, 1);
  assert.equal(s.total, 2300);
  await app.close();
});
