// GET /api/fin não escreve nada: não cria conta a pagar, não vincula, não
// baixa fatura, não mexe em regra. O que escrevia virou POST (materialize,
// rules/apply) e tick do billing.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { billingTick } = await import("../src/billing/billing-runner.js");
const { ensurePayables, materializeUpcomingPayables } = await import("../src/payments/payables.js");

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Loja", email: "ze@loja.com" });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 990, status: "open", dueDate: "2026-08-10" });
  await repo.create("mp_payments", { id: "mpp_9", mpId: "9", saas: "leverads", status: "approved", kind: "venda", amount: 990, payerEmail: "ze@loja.com", dateApproved: "2026-08-05T12:00:00Z" });
  await repo.create("fin_rules", { id: "r1", saas: "leverads", matchField: "payerEmail", matchValue: "ze@loja.com", action: "vincular", customer: "c1" });
  await repo.create("payables", { id: "t1", saas: "leverads", description: "Salário", category: "pessoal_com", counterpartyType: "colaborador", userId: "u", amount: 3000, month: "2026-06", dueDate: "2026-06-05", status: "aberta", recurring: true });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("GET /api/fin (inclusive 2 em paralelo) não cria nem altera nada; aponta regra pendente e instância faltando", async () => {
  const { app, repo } = await build();
  const before = repo.writeRev();
  const [a, b] = await Promise.all([
    app.inject({ url: "/api/fin/leverads?month=2026-08" }),
    app.inject({ url: "/api/fin/leverads?month=2026-08" }),
  ]);
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  assert.equal(repo.writeRev(), before, "zero escritas");
  const r = a.json();
  assert.equal(r.conciliacao.pendentes.n, 1);
  assert.equal(r.conciliacao.regrasPendentes, 1, "tem regra que resolveria, mas o GET não aplica");
  assert.equal(r.payablesMissing, 1);
  assert.equal((await repo.get("invoices", "i1")).status, "open");
  assert.equal((await repo.list("payables")).length, 1);
  await app.close();
});

test("POST rules/apply vincula e baixa (a mesma baixa do manual); POST materialize cria a instância uma vez só", async () => {
  const { app, repo } = await build();
  const ap = (await app.inject({ method: "POST", url: "/api/fin/leverads/rules/apply" })).json();
  assert.deepEqual([ap.applied, ap.settled], [1, 1]);
  const inv = await repo.get("invoices", "i1");
  assert.deepEqual([inv.status, inv.mpPaymentId, inv.paidProof.kind], ["paid", "9", "mp"]);
  assert.equal((await repo.get("mp_payments", "mpp_9")).matchedBy, "rule");
  assert.equal((await repo.get("fin_rules", "r1")).autoCount, 1);

  const [m1, m2] = await Promise.all([
    app.inject({ method: "POST", url: "/api/fin/leverads/materialize?month=2026-08" }),
    app.inject({ method: "POST", url: "/api/fin/leverads/materialize?month=2026-08" }),
  ]);
  assert.equal(m1.statusCode, 200); assert.equal(m2.statusCode, 200);
  const instances = (await repo.list("payables")).filter((p) => p.templateId === "t1");
  // (o mem-repo não recusa id repetido como o Postgres; o que importa é que
  // o id determinístico faz a 2ª passada colidir em vez de nascer outro doc)
  assert.equal(instances.length, 2, "jul e ago, uma de cada — sem duplicata mesmo em paralelo");
  assert.equal(instances.find((p) => p.month === "2026-08").id, "pay_t1_2026-08");
  await app.close();
});

test("tick do billing materializa mês atual e próximo pra todos os produtos", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "elo", name: "Elo" });
  await repo.create("payables", { id: "t1", saas: "leverads", description: "Aluguel", category: "escritorio", counterpartyType: "fornecedor", amount: 1000, month: "2020-01", dueDate: "2020-01-05", status: "aberta", recurring: true });
  await repo.create("payables", { id: "t2", saas: "elo", description: "Infra", category: "infra", counterpartyType: "fornecedor", amount: 100, month: "2020-01", dueDate: "2020-01-31", status: "aberta", recurring: true });
  const report = await billingTick(repo, { discordClient: { configured: () => false } });
  assert.equal(report.payables, 4, "2 templates × (mês atual + próximo)");
  const again = await materializeUpcomingPayables(repo);
  assert.equal(again, 0, "idempotente");
  assert.equal(await ensurePayables(repo, "elo", "2020-02"), 1, "mês antigo sob demanda");
  assert.equal((await repo.get("payables", "pay_t2_2020-02")).dueDate, "2020-02-29", "dia 31 clampado");
});
