// Churn de cliente — o mecanismo completo (churn.js + rotas):
// - POST /api/customers/:id/churn: endedAt + motivo, cancela assinaturas em
//   aberto (canceledAt), ARR congelado, rollup do produto desconta, aviso no
//   Discord e activity na timeline do lead.
// - POST /api/customers/:id/unchurn: limpa a saída e o rollup volta a contar.
// - Cancelamento no MP com OUTRA assinatura viva → troca de recorrência, sem churn.
// - Estorno/chargeback no espelho de pagamentos → aviso no Discord + activity
//   (transição de status; primeiro ingest de estorno antigo não avisa).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { makeDiscord } = await import("../src/discord.js");
const { ingestMpPayment } = await import("../src/mp-payments.js");
const { isChurnedCustomer } = await import("../src/churn.js");

// Discord fake: captura os embeds postados (mesmo padrão do routes.discord.test).
function makeFakeDiscord() {
  const posts = [];
  const discord = makeDiscord({
    webhookUrl: "https://discord.test/webhook",
    fetch: async (_url, init) => { posts.push(JSON.parse(init.body).embeds[0]); return { status: 204 }; },
  });
  return { discord, posts };
}

function buildApp(repo, { discord } = {}) {
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({}), ...(discord ? { discord } : {}) });
  return app;
}

async function seed(repo, { withLead = false } = {}) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  if (withLead) await repo.create("leads", { id: "l1", saas: "leverads", name: "Fulano", stage: "Ganho", customerId: "c1" });
  await repo.create("customers", {
    id: "c1", name: "Cliente Um", saas: "leverads", email: "um@x.com", arr: 6000,
    startedAt: "2026-05-01T12:00:00.000Z", ...(withLead ? { leadId: "l1" } : {}),
  });
}

test("isChurnedCustomer: só endedAt no PASSADO churna", () => {
  assert.equal(isChurnedCustomer({ endedAt: "" }), false);
  assert.equal(isChurnedCustomer({}), false);
  assert.equal(isChurnedCustomer({ endedAt: "2020-01-01" }), true);
  assert.equal(isChurnedCustomer({ endedAt: "2999-01-01" }), false); // saída agendada não churna ainda
});

test("churn manual: endedAt + motivo, assinatura cancelada com canceledAt, ARR congelado, rollup desconta, Discord + activity", async () => {
  const repo = makeMemRepo();
  const { discord, posts } = makeFakeDiscord();
  const app = buildApp(repo, { discord });
  await seed(repo, { withLead: true });
  await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "active", cycle: "monthly", price: 500 });

  // Antes: o rollup do produto conta o cliente e o ARR.
  let prod = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(prod.customers, 1);
  assert.equal(prod.arr, 6000);

  const res = await app.inject({
    method: "POST", url: "/api/customers/c1/churn",
    payload: { endedAt: "2026-08-20", reason: "preco", note: "apertou o caixa" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().canceledSubscriptions, ["s1"]);

  const c = await repo.get("customers", "c1");
  assert.equal(c.endedAt, "2026-08-20");
  assert.equal(c.churnReason, "preco");
  assert.equal(c.churnNote, "apertou o caixa");
  assert.equal(c.churnSource, "manual");
  assert.equal(c.arr, 6000); // congelado: o endedAt é quem tira das réguas

  const s = await repo.get("subscriptions", "s1");
  assert.equal(s.status, "canceled");
  assert.ok(s.canceledAt);

  // Rollup do produto desconta o churnado (nº de clientes e ARR).
  prod = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(prod.customers, 0);
  assert.equal(prod.arr, 0);

  // Aviso no Discord com motivo legível; activity na timeline do lead.
  const churnPost = posts.find((p) => p.title.includes("Churn"));
  assert.ok(churnPost);
  assert.ok(churnPost.fields.some((f) => f.name === "Motivo" && f.value.includes("Preço")));
  const acts = await repo.list("activities");
  assert.ok(acts.some((a) => a.lead === "l1" && a.meta?.event === "customer_churn"));

  await app.close();
});

test("unchurn: limpa a saída, rollup volta a contar; re-churn corrige motivo sem duplicar aviso", async () => {
  const repo = makeMemRepo();
  const { discord, posts } = makeFakeDiscord();
  const app = buildApp(repo, { discord });
  await seed(repo);

  await app.inject({ method: "POST", url: "/api/customers/c1/churn", payload: { reason: "preco" } });
  // Re-marcar (corrigir o motivo) não posta aviso de novo no Discord.
  await app.inject({ method: "POST", url: "/api/customers/c1/churn", payload: { reason: "sem_resultado" } });
  assert.equal((await repo.get("customers", "c1")).churnReason, "sem_resultado");
  assert.equal(posts.filter((p) => p.title.includes("Churn")).length, 1);

  const res = await app.inject({ method: "POST", url: "/api/customers/c1/unchurn" });
  assert.equal(res.statusCode, 200);
  const c = await repo.get("customers", "c1");
  assert.equal(c.endedAt, "");
  assert.equal(c.churnReason, "");
  const prod = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(prod.customers, 1);
  assert.equal(prod.arr, 6000);

  await app.close();
});

test("PATCH genérico: assinatura cancelada pela tela ganha canceledAt sozinha", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  await seed(repo);
  await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "active", cycle: "monthly", price: 500 });

  await app.inject({ method: "PATCH", url: "/api/subscriptions/s1", payload: { status: "canceled" } });
  const s = await repo.get("subscriptions", "s1");
  assert.equal(s.status, "canceled");
  assert.ok(s.canceledAt);

  await app.close();
});

test("cancelamento no MP com OUTRA assinatura viva = troca de recorrência, sem churn", async () => {
  const repo = makeMemRepo();
  const { applyMpCancellationChurn } = await import("../src/churn.js");
  await seed(repo);
  await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "canceled", cycle: "monthly", price: 500 });
  await repo.create("subscriptions", { id: "s2", customer: "c1", saas: "leverads", status: "active", cycle: "annual", price: 6000 });

  const r = await applyMpCancellationChurn(repo, await repo.get("subscriptions", "s1"), {});
  assert.equal(r, null);
  assert.equal((await repo.get("customers", "c1")).endedAt || "", "");

  // Sem outra viva → churna com motivo mp_cancel.
  await repo.update("subscriptions", "s2", { status: "canceled" });
  const r2 = await applyMpCancellationChurn(repo, await repo.get("subscriptions", "s1"), {});
  assert.ok(r2.endedAt);
  assert.equal(r2.churnReason, "mp_cancel");
  assert.equal(r2.churnSource, "mp");
});

test("estorno no espelho de pagamentos: transição approved → refunded avisa no Discord e loga no lead", async () => {
  const repo = makeMemRepo();
  const { discord, posts } = makeFakeDiscord();
  await seed(repo, { withLead: true });

  const payment = (over = {}) => ({
    id: 777, status: "approved", transaction_amount: 500,
    payer: { email: "um@x.com", first_name: "Fulano" },
    payment_method_id: "pix", payment_type_id: "bank_transfer",
    external_reference: "l1", date_created: "2026-08-01T10:00:00.000Z",
    ...over,
  });

  // 1º ingest (aprovado): nada de estorno.
  await ingestMpPayment(repo, payment(), { discord });
  assert.equal(posts.filter((p) => p.title.includes("Estorno")).length, 0);

  // Mesmo pagamento volta como refunded → aviso + activity (uma vez só).
  await ingestMpPayment(repo, payment({ status: "refunded" }), { discord });
  await ingestMpPayment(repo, payment({ status: "refunded" }), { discord }); // redelivery não re-avisa
  assert.equal(posts.filter((p) => p.title.includes("Estorno")).length, 1);
  const acts = await repo.list("activities");
  assert.equal(acts.filter((a) => a.lead === "l1" && a.meta?.event === "mp_refund").length, 1);

  // Estorno ANTIGO que o espelho nunca viu (backfill): entra sem aviso.
  await ingestMpPayment(repo, payment({ id: 888, status: "refunded" }), { discord });
  assert.equal(posts.filter((p) => p.title.includes("Estorno")).length, 1);
});

test("churn congela o arr: mutação de assinatura depois do churn não zera o histórico", async () => {
  const repo = makeMemRepo();
  const { syncCustomerArr } = await import("../src/billing.js");
  await seed(repo);
  await repo.update("customers", "c1", { endedAt: "2026-08-01" });
  await repo.create("subscriptions", { id: "s1", customer: "c1", saas: "leverads", status: "canceled", cycle: "monthly", price: 500 });

  await syncCustomerArr(repo, "c1");
  assert.equal((await repo.get("customers", "c1")).arr, 6000);
});
