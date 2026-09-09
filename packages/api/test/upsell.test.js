// Upsell de cliente — o fluxo completo (upsell.js + POST /api/customers/:id/upsell):
// - avulso pago: fatura kind:"upsell" paga com o que foi vendido e quem vendeu,
//   carimbo no cliente, activity na timeline do lead, aviso no Discord e o
//   balde "upsell" do caixa.
// - recorrente: a assinatura ativa sobe o delta e o arr acompanha; sem
//   assinatura o arr soma 12× o delta; "cobrar agora" zero não gera fatura.
// - a receber: fatura aberta com vencimento.
// - cliente em churn → 409; link sem MP → 424; corpo inválido → 400.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { makeDiscord } = await import("../src/discord.js");
const { parseUpsellBody } = await import("../src/upsell.js");
const { cashBucketsIn } = await import("../src/metrics-core.js");

function makeFakeDiscord() {
  const posts = [];
  const discord = makeDiscord({
    webhookUrl: "https://discord.test/webhook",
    fetch: async (_url, init) => { posts.push(JSON.parse(init.body).embeds[0]); return { status: 204 }; },
  });
  return { discord, posts };
}

async function buildApp({ discord } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("users", { id: "u_cs", name: "Cris CS", roles: ["integrator"] });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Fulano", stage: "Ganho", customerId: "c1" });
  await repo.create("customers", {
    id: "c1", name: "Cliente Um", saas: "leverads", email: "um@x.com", arr: 6000, owner: "u_cs",
    leadId: "l1", startedAt: "2026-05-01T12:00:00.000Z",
  });
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({}), ...(discord ? { discord } : {}) });
  return { app, repo };
}

const post = (app, body) => app.inject({ method: "POST", url: "/api/customers/c1/upsell", payload: body });

test("parseUpsellBody: valida modo, valores e item", () => {
  assert.equal(parseUpsellBody({}).error, "valor do upsell deve ser positivo");
  assert.equal(parseUpsellBody({ amount: 100 }).error, "diga o que foi vendido");
  assert.equal(parseUpsellBody({ mode: "recurring", item: "FULL" }).error, "acréscimo na mensalidade deve ser positivo");
  assert.equal(parseUpsellBody({ mode: "recurring", item: "FULL", monthlyDelta: 200, amount: 0, payment: "link" }).error, "cobrança a receber ou por link precisa de valor");
  const ok = parseUpsellBody({ item: "OEM 250", amount: "1500", payment: "paid", date: "2026-09-08" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.mode, "oneoff");
  assert.equal(ok.at, "2026-09-08T12:00:00.000Z");
  const rec = parseUpsellBody({ mode: "recurring", item: "FULL", monthlyDelta: 300, amount: 0 });
  assert.equal(rec.amount, 0);
  assert.equal(rec.monthlyDelta, 300);
});

test("avulso pago: fatura upsell paga com item e vendedor, carimbo no cliente, activity, Discord e balde do caixa", async () => {
  const { discord, posts } = makeFakeDiscord();
  const { app, repo } = await buildApp({ discord });
  const r = await post(app, { item: "Clonagem avulsa · até 100 anúncios", amount: 996, payment: "paid", date: "2026-09-08", soldBy: "u_cs", note: "fechou na call de check-in" });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.invoice.kind, "upsell");
  assert.equal(body.invoice.status, "paid");
  assert.equal(body.invoice.paidAt, "2026-09-08T12:00:00.000Z");
  assert.equal(body.invoice.title, "Clonagem avulsa · até 100 anúncios");
  assert.equal(body.invoice.soldBy, "u_cs");
  assert.equal(body.invoice.upsellMode, "oneoff");
  assert.equal(body.subscription, null);
  // Cliente: contador + último upsell; arr NÃO muda (venda única).
  const c = await repo.get("customers", "c1");
  assert.equal(c.upsellCount, 1);
  assert.equal(c.lastUpsellItem, "Clonagem avulsa · até 100 anúncios");
  assert.equal(c.arr, 6000);
  // Timeline do lead de origem.
  const acts = (await repo.list("activities")).filter((a) => a.lead === "l1" && a.meta?.event === "customer_upsell");
  assert.equal(acts.length, 1);
  assert.match(acts[0].text, /Upsell registrado: Clonagem avulsa · até 100 anúncios · R\$ 996,00 · pago · fechou na call/);
  assert.equal(acts[0].meta.soldBy, "u_cs");
  // Discord: aviso verde com quem vendeu.
  assert.equal(posts.length, 1);
  assert.match(posts[0].title, /Upsell: Cliente Um/);
  assert.equal(posts[0].fields.find((f) => f.name === "Quem vendeu").value, "Cris CS");
  // Caixa em 3 baldes: cai em "upsell".
  const inWin = (d) => String(d || "").startsWith("2026-09");
  const b = cashBucketsIn(await repo.list("invoices"), await repo.list("customers"), inWin);
  assert.equal(b.upsell, 996);
  assert.equal(b.novos, 0);
  await app.close();
});

test("recorrente com assinatura: mensalidade sobe o delta, arr acompanha e a fatura de agora é o que foi cobrado", async () => {
  const { app, repo } = await buildApp();
  await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "active", cycle: "monthly", price: 500 });
  const r = await post(app, { item: "FULL", mode: "recurring", monthlyDelta: 300, amount: 150, payment: "paid", date: "2026-09-08", soldBy: "u_cs" });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.subscription.price, 800);
  assert.equal(body.invoice.amount, 150); // pró-rata cobrado na virada
  assert.equal(body.invoice.recurringDelta, 300);
  assert.equal((await repo.get("customers", "c1")).arr, 9600); // 800 × 12
  await app.close();
});

test("recorrente sem assinatura: arr soma 12× o delta; cobrar agora zero nasce paga com R$ 0 (é o registro da venda)", async () => {
  const { app, repo } = await buildApp();
  const r = await post(app, { item: "+OEM", mode: "recurring", monthlyDelta: 250, amount: 0, soldBy: "u_cs", date: "2026-09-08" });
  assert.equal(r.statusCode, 200, r.body);
  const inv = r.json().invoice;
  assert.equal(inv.amount, 0);
  assert.equal(inv.status, "paid");
  assert.equal(inv.soldAt, "2026-09-08T12:00:00.000Z");
  assert.equal(inv.recurringDelta, 250);
  assert.equal((await repo.get("customers", "c1")).arr, 9000); // 6000 + 250 × 12
  assert.equal((await repo.list("invoices")).length, 1);
  assert.equal((await repo.get("customers", "c1")).upsellCount, 1);
  await app.close();
});

// ── Upsell É VENDA (Leo, 09/09): metas, placar, pace, marketing e custos % ──
test("upsell conta como venda de quem vendeu: placar (closer + time), pace do mês, marketing e base do custo % — a mesma régua", async () => {
  const repo = makeMemRepo();
  const FUNNEL = [
    { stage: "Novo lead", kind: "novo", conv: 1 }, { stage: "Call agendada", kind: "call", conv: 1 },
    { stage: "Ganho", kind: "ganho", conv: 1 }, { stage: "Perdido", kind: "perdido", conv: 0 },
  ];
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  await repo.create("users", { id: "u_cs", name: "Cris CS", roles: ["integrator"] });
  // 1 fechamento de lead do Leo em julho (à vista, R$ 5.000).
  await repo.create("leads", { id: "l1", saas: "leverads", closer: "leo", stage: "Ganho", amount: 5000, paymentMethod: "pix", customerId: "c1", wonAt: "2026-07-08T12:00:00.000Z", createdAt: "2026-07-02T12:00:00.000Z" });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente Um", leadId: "l1", owner: "u_cs", startedAt: "2026-07-08T12:00:00.000Z", arr: 5000 });
  // Cliente antigo (fechado em maio) que recebe upsell em julho.
  await repo.create("customers", { id: "c2", saas: "leverads", name: "Cliente Dois", owner: "u_cs", startedAt: "2026-05-01T12:00:00.000Z", arr: 6000 });
  await repo.create("expenses", { id: "e1", saas: "leverads", category: "checkout", pct: 10, month: "2026-07" });
  const NOW = new Date("2026-07-28T12:00:00.000Z");
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({}), pipelinePace: { now: () => NOW }, scoreboard: { now: () => NOW } });

  // Upsell PAGO vendido pela CS em julho (R$ 1.200) + um A RECEBER do Leo (R$ 900, não caiu).
  let r = await app.inject({ method: "POST", url: "/api/customers/c2/upsell", payload: { item: "FULL", amount: 1200, payment: "paid", date: "2026-07-15", soldBy: "u_cs" } });
  assert.equal(r.statusCode, 200, r.body);
  r = await app.inject({ method: "POST", url: "/api/customers/c1/upsell", payload: { item: "OEM 250", amount: 900, payment: "open", date: "2026-07-20", dueDate: "2026-08-10", soldBy: "leo" } });
  assert.equal(r.statusCode, 200, r.body);

  const MONTH = "?since=2026-07-01&until=2026-07-31";
  const sb = (await app.inject({ url: `/api/scoreboard/leverads${MONTH}` })).json();
  const pace = (await app.inject({ url: "/api/pipeline-pace/leverads" })).json();
  const costs = (await app.inject({ url: "/api/expenses/summary/leverads?month=2026-07" })).json();
  const mkt = (await app.inject({ url: `/api/marketing/leverads${MONTH}` })).json();

  // Closer Leo: 1 fechamento + 1 upsell (a receber conta no nº, não no R$).
  const leo = sb.closer.find((c) => c.user === "leo");
  assert.equal(leo.won, 2);
  assert.equal(leo.revenue, 5000);
  assert.equal(leo.upsells, 1);
  assert.equal(leo.upsellRevenue, 0);
  assert.equal(leo.contracted, 5900);
  // A CS aparece no placar de closer pelo upsell dela (é venda dela).
  const cris = sb.closer.find((c) => c.user === "u_cs");
  assert.equal(cris.won, 1);
  assert.equal(cris.revenue, 1200);
  assert.equal(cris.calls, 0);
  // Card de CS dela continua com a régua própria.
  assert.equal(sb.cs.find((c) => c.user === "u_cs").upsellRevenue, 1200);
  // Time = soma: 3 vendas, R$ 6.200 reconhecidos, R$ 7.100 contratados.
  assert.equal(sb.team.won, 3);
  assert.equal(sb.team.wonPlatform, 1); // taxas do funil seguem no ganho de lead
  assert.equal(sb.team.upsells, 2);
  assert.equal(sb.team.revenue, 6200);
  assert.equal(sb.team.contracted, 7100);
  // Pace do mês = o mesmo vendido; contratos do mês contam os 3.
  assert.equal(pace.sale.sold, sb.team.revenue);
  assert.equal(pace.sale.contracted, sb.team.contracted);
  assert.equal(pace.sale.upsell.sold, 1200);
  assert.equal(pace.contracts.sold, 3);
  assert.equal(pace.context.wonMonth, sb.team.won);
  assert.equal(pace.sale.byDay.reduce((a, v) => a + v, 0), 6200);
  // Custo % sobre o vendido: base = contratado (com upsell).
  assert.equal(costs.wonBase, pace.context.tcvMonth);
  // Marketing: ganhos e receita do período com upsell (régua do contrato).
  assert.equal(mkt.totals.won, 3);
  assert.equal(mkt.totals.revenue, 7100);
  await app.close();
});

test("a receber: fatura aberta com vencimento; vendedor padrão é quem chamou", async () => {
  const { app, repo } = await buildApp();
  const r = await post(app, { item: "Mentoria de importação", amount: 2000, payment: "open", dueDate: "2026-09-30" });
  assert.equal(r.statusCode, 200, r.body);
  const inv = r.json().invoice;
  assert.equal(inv.status, "open");
  assert.equal(inv.dueDate, "2026-09-30T12:00:00.000Z");
  assert.equal(inv.paidAt, undefined);
  assert.equal(inv.soldBy, "api"); // sem sessão, o autor da chamada
  assert.equal((await repo.list("invoices")).length, 1);
  await app.close();
});

test("cliente em churn recusa (409); link sem MP recusa (424); corpo inválido (400)", async () => {
  const { app, repo } = await buildApp();
  assert.equal((await post(app, { item: "x" })).statusCode, 400);
  assert.equal((await post(app, { item: "x", amount: 100, payment: "link" })).statusCode, 424);
  await repo.update("customers", "c1", { endedAt: "2026-08-01T12:00:00.000Z" });
  const r = await post(app, { item: "x", amount: 100 });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /churn/);
  await app.close();
});
