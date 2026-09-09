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

test("recorrente sem assinatura: arr soma 12× o delta; cobrar agora zero não gera fatura", async () => {
  const { app, repo } = await buildApp();
  const r = await post(app, { item: "+OEM", mode: "recurring", monthlyDelta: 250, amount: 0, soldBy: "u_cs" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().invoice, null);
  assert.equal((await repo.get("customers", "c1")).arr, 9000); // 6000 + 250 × 12
  assert.equal((await repo.list("invoices")).length, 0);
  assert.equal((await repo.get("customers", "c1")).upsellCount, 1);
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
