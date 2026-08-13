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

// ── Desfazer fechamento errado direto da tela de Clientes (Leo, 07/08) ───────
test("revert-win: remove cliente/assinatura/fatura, limpa o carimbo e devolve o card pro funil", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [
    { stage: "Qualificando", kind: "qualificacao" }, { stage: "Follow-up", kind: "followup" },
    { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" },
  ] });
  const app = buildApp(repo);
  await repo.create("leads", { id: "l1", saas: "leverads", name: "New Gift", stage: "Ganho", customerId: "c9", wonAt: "2026-08-01T22:00:00Z", amount: 7180 });
  await repo.create("customers", { id: "c9", saas: "leverads", name: "New Gift", leadId: "l1", arr: 7180 });
  await repo.create("subscriptions", { id: "s9", saas: "leverads", customer: "c9", status: "active", cycle: "annual", price: 7180 });
  await repo.create("invoices", { id: "i9", saas: "leverads", customer: "c9", subscription: "s9", status: "paid", amount: 7180, paidAt: "2026-08-01T22:00:00Z" });

  const res = await app.inject({ method: "POST", url: "/api/customers/c9/revert-win" });
  assert.equal(res.statusCode, 200);
  assert.equal(await repo.get("customers", "c9"), null);
  assert.equal(await repo.get("subscriptions", "s9"), null);
  assert.equal(await repo.get("invoices", "i9"), null);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.customerId, "");
  assert.equal(lead.wonAt, "");
  assert.equal(lead.stage, "Follow-up", "card sai da região de venda pro follow-up");
  await app.close();
});

test("revert-win: card que JÁ voltou pro funil com o carimbo preso (caso New Gift) só limpa", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [
    { stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" },
  ] });
  const app = buildApp(repo);
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Follow-up", customerId: "c9", wonAt: "2026-08-01T22:00:00Z" });
  await repo.create("customers", { id: "c9", saas: "leverads", leadId: "l1", arr: 7180 });

  const res = await app.inject({ method: "POST", url: "/api/customers/c9/revert-win" });
  assert.equal(res.statusCode, 200);
  assert.equal(await repo.get("customers", "c9"), null);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Follow-up", "card não se move");
  assert.equal(lead.customerId, "");
  await app.close();
});

test("revert-win: dinheiro REAL do Mercado Pago bloqueia com 409 e não apaga nada", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Ganho", kind: "ganho" }] });
  const app = buildApp(repo);
  await repo.create("leads", { id: "l1", saas: "leverads", stage: "Ganho", customerId: "c9" });
  await repo.create("customers", { id: "c9", saas: "leverads", leadId: "l1" });
  await repo.create("invoices", { id: "i9", saas: "leverads", customer: "c9", status: "paid", amount: 500, mpPaymentId: "mp_123" });

  const res = await app.inject({ method: "POST", url: "/api/customers/c9/revert-win" });
  assert.equal(res.statusCode, 409);
  assert.ok(await repo.get("customers", "c9"), "cliente fica");
  assert.ok(await repo.get("invoices", "i9"), "fatura real fica");
  await app.close();
});

test("GET /api/billing/received/:saas — só dinheiro FATO: MP aprovado (por cliente ou lead) + baixa real; nascida paga e duplicata do MP ficam fora", async () => {
  const repo = makeMemRepo();
  await setup(repo);
  await repo.create("customers", { id: "c2", name: "Via Lead", saas: "leverads", arr: 0, leadId: "l2" });
  await repo.create("customers", { id: "c3", name: "Fechou no cartão sem pagar", saas: "leverads", arr: 0 });
  await repo.create("customers", { id: "c9", name: "Outro SaaS", saas: "uniquekids", arr: 0 });

  // Espelho do MP: aprovado casado no cliente, aprovado casado pelo lead de
  // origem, rejeitado (não é dinheiro) e aprovado de outro SaaS (fica fora).
  await repo.create("mp_payments", { id: "mpp_1", mpId: "1", status: "approved", amount: 100, customer: "c1" });
  await repo.create("mp_payments", { id: "mpp_2", mpId: "2", status: "approved", amount: 50.5, lead: "l2" });
  await repo.create("mp_payments", { id: "mpp_3", mpId: "3", status: "rejected", amount: 999, customer: "c1" });
  await repo.create("mp_payments", { id: "mpp_4", mpId: "4", status: "approved", amount: 77, customer: "c9" });

  // Fatura baixada PELO pagamento 1 (mpPaymentId) → já contou no espelho, não duplica.
  await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 100, kind: "renewal", status: "paid", mpPaymentId: "1", paidAt: "2026-08-01T10:00:00.000Z" });
  // Parcela baixada NA MÃO (sem MP) → é fato, conta.
  await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 30, kind: "installment", status: "paid", paidAt: "2026-08-02T10:00:00.000Z" });
  // Fatura que NASCE paga no fechamento (paidAt === periodStart) → convenção, fora.
  await repo.create("invoices", { customer: "c3", saas: "leverads", amount: 500, kind: "renewal", status: "paid", paidAt: "2026-08-03T00:00:00.000Z", periodStart: "2026-08-03T00:00:00.000Z" });
  // Fatura aberta não é recebimento.
  await repo.create("invoices", { customer: "c3", saas: "leverads", amount: 200, kind: "renewal", status: "open" });

  const app = buildApp(repo);
  const res = await app.inject({ method: "GET", url: "/api/billing/received/leverads" });
  assert.equal(res.statusCode, 200);
  // c1 = 100 (MP) + 30 (parcela na mão); c2 = 50.5 (MP pelo lead); c3 não recebeu nada.
  assert.deepEqual(res.json(), { c1: 130, c2: 50.5 });
  await app.close();
});

test("closedSubscriptionSpec: assinatura recorrente (cartão mensal) vira ciclo mensal sem cronograma de parcelas", async () => {
  const { closedSubscriptionSpec } = await import("../src/billing.js");
  // Plano mensal fechado na recorrente: parcela = o próprio valor do mês.
  assert.deepEqual(closedSubscriptionSpec({ planClosed: "mensal", amount: 274, paymentMethod: "cartao_recorrente" }), { cycle: "monthly", price: 274 });
  // Mesmo com "paymentInstallments" perdido no lead, recorrente ganha cronograma
  // como o faturado ganharia — o gate não pergunta parcelas pra ela, então o
  // caminho normal é sem schedule (campo vazio).
  assert.deepEqual(closedSubscriptionSpec({ planClosed: "anual", amount: 1200, paymentMethod: "cartao_recorrente", paymentInstallments: "" }), { cycle: "monthly", price: 100 });
});
