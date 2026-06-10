// Billing (fase 5) — assinaturas como system-of-record. Cobre:
// 1) o INVARIANTE do rollup: toda mutação de assinatura reescreve customer.arr e
//    o produto reflete via rollup (receita deriva de customers, nunca do produto);
// 2) pró-rata (port do copylever): upgrade cobra o diff do ciclo restante já,
//    downgrade/troca de ciclo agendam pro fim do ciclo;
// 3) motor (POST /api/billing/run): renovação no rollover + dunning (overdue →
//    past_due → recupera no pagamento).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const DAY = 86400000;

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

async function setup(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", name: "Cliente Real", saas: "leverads", arr: 0 });
}

test("criar assinatura → período + fatura inicial + customer.arr anualizado + rollup do produto", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  const app = buildApp(repo);

  const res = await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 100, cycle: "monthly" },
  });
  assert.equal(res.statusCode, 201);
  const sub = res.json();
  assert.ok(sub.periodStart && sub.periodEnd, "janela do 1º ciclo preenchida");

  const invoices = (await repo.list("invoices")).filter((i) => i.subscription === sub.id);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].amount, 100);
  assert.equal(invoices[0].kind, "renewal");
  assert.equal(invoices[0].status, "open");

  assert.equal((await repo.get("customers", "c1")).arr, 1200); // 100 × 12

  const product = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(product.arr, 1200);
  assert.equal(product.mrr, 100);

  await app.close();
});

test("ciclo trimestral anualiza ×4; cancelar zera o ARR; deletar re-sincroniza", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  const app = buildApp(repo);

  const sub = (await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 300, cycle: "quarterly" },
  })).json();
  assert.equal((await repo.get("customers", "c1")).arr, 1200); // 300 × 4

  await app.inject({ method: "PATCH", url: `/api/subscriptions/${sub.id}`, payload: { status: "canceled" } });
  assert.equal((await repo.get("customers", "c1")).arr, 0);

  await app.inject({ method: "PATCH", url: `/api/subscriptions/${sub.id}`, payload: { status: "active" } });
  assert.equal((await repo.get("customers", "c1")).arr, 1200);

  await app.inject({ method: "DELETE", url: `/api/subscriptions/${sub.id}` });
  assert.equal((await repo.get("customers", "c1")).arr, 0);

  await app.close();
});

test("upgrade mid-cycle → preço novo já + fatura pró-rata do diff restante", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  const app = buildApp(repo);

  const sub = (await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 100, cycle: "monthly" },
  })).json();
  // Ciclo de 30 dias, metade percorrido (margem de 1h pro floor de daysRemaining).
  const now = Date.now();
  await repo.update("subscriptions", sub.id, {
    periodStart: new Date(now - 15 * DAY).toISOString(),
    periodEnd: new Date(now + 15 * DAY + 3600000).toISOString(),
  });

  const res = (await app.inject({
    method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { price: 200 },
  })).json();
  assert.equal(res.ok, true);
  assert.equal(res.changeType, "upgrade_mid_cycle");
  assert.equal(res.prorata, 50); // (200−100)/30d × 15d restantes

  const updated = await repo.get("subscriptions", sub.id);
  assert.equal(updated.price, 200);
  const prorata = (await repo.list("invoices")).find((i) => i.kind === "prorata");
  assert.equal(prorata.amount, 50);
  assert.equal((await repo.get("customers", "c1")).arr, 2400);

  await app.close();
});

test("downgrade e troca de ciclo agendam pro fim do ciclo; runBilling aplica quando vence", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  const app = buildApp(repo);

  const sub = (await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 200, cycle: "monthly" },
  })).json();

  const res = (await app.inject({
    method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { price: 100 },
  })).json();
  assert.equal(res.changeType, "downgrade_mid_cycle");
  let cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.price, 200); // inalterado até o fim do ciclo
  assert.equal(cur.pendingChange.price, 100);
  assert.equal(cur.pendingChange.applyAt, cur.periodEnd);
  assert.equal((await repo.get("customers", "c1")).arr, 2400); // ainda o preço atual

  // Vence o agendamento (sem vencer o período → sem renovação neste teste).
  await repo.update("subscriptions", sub.id, { pendingChange: { ...cur.pendingChange, applyAt: new Date(Date.now() - DAY).toISOString() } });
  await app.inject({ method: "POST", url: "/api/billing/run" });
  cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.price, 100);
  assert.equal(cur.pendingChange, null);
  assert.equal((await repo.get("customers", "c1")).arr, 1200);

  // Troca de ciclo também agenda (MP não muda frequency in-place).
  const res2 = (await app.inject({
    method: "POST", url: `/api/subscriptions/${sub.id}/change`, payload: { cycle: "annual", price: 1000 },
  })).json();
  assert.equal(res2.changeType, "cycle_change");
  assert.equal((await repo.get("subscriptions", sub.id)).cycle, "monthly");

  await app.close();
});

test("motor: rollover gera fatura de renovação; dunning marca past_due; pagar recupera", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  const app = buildApp(repo);

  const sub = (await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 100, cycle: "monthly" },
  })).json();
  // Paga a fatura inicial pra isolar o rollover.
  const initial = (await repo.list("invoices"))[0];
  await app.inject({ method: "POST", url: `/api/invoices/${initial.id}/pay` });

  // Ciclo venceu há 10 dias → renovação com dueDate no passado (vencida além da carência).
  const now = Date.now();
  await repo.update("subscriptions", sub.id, {
    periodStart: new Date(now - 40 * DAY).toISOString(),
    periodEnd: new Date(now - 10 * DAY).toISOString(),
  });
  const report = (await app.inject({ method: "POST", url: "/api/billing/run" })).json();
  assert.equal(report.renewed, 1);
  assert.equal(report.overdue, 1);  // renovação venceu há 10d (> carência 3d)
  assert.equal(report.pastDue, 1);

  let cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.status, "past_due");
  assert.ok(new Date(cur.periodEnd) > new Date(), "período avançou pro futuro");
  assert.equal((await repo.get("customers", "c1")).arr, 1200); // past_due ainda é receita contratada

  const renewal = (await repo.list("invoices")).find((i) => i.status === "overdue");
  assert.equal(renewal.amount, 100);
  const paid = (await app.inject({ method: "POST", url: `/api/invoices/${renewal.id}/pay` })).json();
  assert.equal(paid.status, "paid");
  assert.equal((await repo.get("subscriptions", sub.id)).status, "active");

  await app.close();
});
