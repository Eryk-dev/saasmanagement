// Desfazer o ganho + reeditar o fechamento. Card puxado de VOLTA da região de
// venda (Ganho/Integração) pra etapa aberta limpa customerId/wonAt (a venda sai
// do placar) e remove cliente/assinatura/faturas nascidos do fechamento —
// billing real (MP) preserva os registros. E plano/valor reeditados no gate da
// Integração re-espelham no cliente e na assinatura (syncWonLeadDeal).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

const FUNNEL = [
  { stage: "Follow-up", kind: "followup" },
  { stage: "Ganho", kind: "ganho" },
  { stage: "Integração", kind: "integracao" },
  { stage: "Perdido", kind: "perdido" },
];

async function seedWon(repo, { mpPreapprovalId = "", mpPaymentId = "" } = {}) {
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("customers", { id: "cu1", saas: "leverads", name: "ACME", leadId: "l1", arr: 7188, plan: "Anual", startedAt: "2026-07-01T12:00:00.000Z" });
  await repo.create("subscriptions", { id: "su1", customer: "cu1", saas: "leverads", status: "active", cycle: "annual", price: 7188, periodStart: "2026-07-01T12:00:00.000Z", periodEnd: "2027-07-01T12:00:00.000Z", ...(mpPreapprovalId ? { mpPreapprovalId } : {}) });
  await repo.create("invoices", { id: "in1", subscription: "su1", customer: "cu1", saas: "leverads", amount: 7188, kind: "renewal", status: "paid", paidAt: "2026-07-01T12:00:00.000Z", ...(mpPaymentId ? { mpPaymentId } : {}) });
  await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Fulano", stage: "Integração",
    amount: 7188, planClosed: "anual", paymentMethod: "pix",
    customerId: "cu1", wonAt: "2026-07-01T12:00:00.000Z",
  });
}

test("Integração → etapa anterior desfaz o ganho (lead limpo + cliente/assinatura/fatura removidos)", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  assert.equal(res.statusCode, 200);
  const lead = res.json();
  assert.equal(lead.customerId, "", "customerId limpo — a venda sai do placar");
  assert.equal(lead.wonAt, "", "wonAt limpo");
  assert.equal(await repo.get("customers", "cu1"), null, "cliente nascido do fechamento removido");
  assert.equal(await repo.get("subscriptions", "su1"), null, "assinatura removida");
  assert.equal(await repo.get("invoices", "in1"), null, "fatura removida");
  const acts = await repo.list("activities");
  assert.ok(acts.some((a) => a.lead === "l1" && a.meta?.event === "won_reverted" && a.meta?.customerRemoved === true), "activity won_reverted logada");
});

test("Integração → Ganho continua na região de venda: nada é desfeito", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().customerId, "cu1");
  assert.ok(await repo.get("customers", "cu1"), "cliente intacto");
});

test("Integração → Perdido NÃO desfaz o ganho (churn é outra história)", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Perdido", lostReason: "desistiu" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().customerId, "cu1", "venda continua sendo fato do lead");
  assert.ok(await repo.get("customers", "cu1"), "cliente intacto");
});

test("billing real (MP) trava a remoção: lead limpa, registros ficam", async () => {
  const repo = makeMemRepo();
  await seedWon(repo, { mpPreapprovalId: "pre_123" });
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().customerId, "", "vínculo do lead limpo mesmo assim");
  assert.ok(await repo.get("customers", "cu1"), "cliente preservado (dinheiro real no meio)");
  assert.ok(await repo.get("subscriptions", "su1"), "assinatura preservada");
  const acts = await repo.list("activities");
  assert.ok(acts.some((a) => a.meta?.event === "won_reverted" && a.meta?.customerRemoved === false));
});

test("re-fechar depois de um desfazer preservado re-vincula o MESMO cliente (não duplica)", async () => {
  const repo = makeMemRepo();
  await seedWon(repo, { mpPreapprovalId: "pre_123" });
  const app = buildApp(repo);
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  assert.equal(res.statusCode, 200);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.customerId, "cu1", "re-vinculado ao cliente de sempre");
  assert.ok(lead.wonAt, "wonAt de volta");
  assert.equal((await repo.list("customers")).length, 1, "nenhum cliente duplicado");
});

test("gate da Integração reedita plano/valor → assinatura e cliente acompanham", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  await repo.update("leads", "l1", { stage: "Ganho" });
  const app = buildApp(repo);
  const res = await app.inject({
    method: "PATCH", url: "/api/leads/l1",
    payload: { stage: "Integração", amount: 11988, planClosed: "anual", paymentMethod: "cartao_12x" },
  });
  assert.equal(res.statusCode, 200);
  const sub = await repo.get("subscriptions", "su1");
  assert.equal(sub.price, 11988, "preço da assinatura acompanha o valor novo");
  assert.equal(sub.cycle, "annual");
  const customer = await repo.get("customers", "cu1");
  assert.equal(customer.arr, 11988, "arr re-sincronizado da assinatura");
  assert.equal(customer.paymentMethod, "cartao_12x");
});

test("lead legado SEM planClosed: editar o valor não cancela a assinatura (só unico explícito cancela)", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  await repo.update("leads", "l1", { planClosed: "" }); // fechamento pré-gate de plano (produção de hoje)
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { amount: 8000 } });
  assert.equal(res.statusCode, 200);
  const sub = await repo.get("subscriptions", "su1");
  assert.equal(sub.status, "active", "recorrência de cliente real fica de pé");
  assert.equal(sub.price, 7188, "sem plano definido não se adivinha preço novo");
});

test("fechamento reeditado pra serviço único encerra a recorrência e o arr vira o valor do negócio", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({
    method: "PATCH", url: "/api/leads/l1",
    payload: { amount: 1490, planClosed: "unico", paymentMethod: "pix" },
  });
  assert.equal(res.statusCode, 200);
  const sub = await repo.get("subscriptions", "su1");
  assert.equal(sub.status, "canceled", "recorrência encerrada");
  const customer = await repo.get("customers", "cu1");
  assert.equal(customer.arr, 1490, "arr = valor do negócio (sem recorrência)");
  assert.equal(customer.plan, "Serviço único");
});
