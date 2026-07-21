// POST /api/webhooks/shopify/uniquekids — pedido pago do "tarefas diárias" (ou
// acima do piso) vira lead da UniqueKids pra Ana, autenticado por HMAC da Shopify.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const SECRET = "shhh-webhook-secret";
const PATH = "/api/webhooks/shopify/uniquekids";

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "uniquekids", name: "UniqueKids",
    funnel: [
      { stage: "Novo lead", kind: "novo", cadence: { firstTouchHours: 2 } },
      { stage: "Call agendada", kind: "call" },
      { stage: "Ganho", kind: "ganho" },
    ],
  });
  // Ana: escopada em uniquekids, closer (não sdr) — o webhook resolve como dona.
  await repo.create("users", { id: "ana", name: "Ana", roles: ["closer"], saas: "uniquekids" });
  const app = Fastify();
  registerRoutes(app, repo, { webhooks: { secret: SECRET } });
  await app.ready();
  return { app, repo };
}

function sign(body, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

function post(app, order, { secret = SECRET, topic = "orders/paid", hmac } = {}) {
  const body = JSON.stringify(order);
  return app.inject({
    method: "POST", url: PATH, payload: body,
    headers: {
      "content-type": "application/json",
      "x-shopify-topic": topic,
      "x-shopify-hmac-sha256": hmac ?? sign(body, secret),
    },
  });
}

test("cria lead da Ana quando compra 'tarefas diárias'", async () => {
  const { app, repo } = await build();
  const res = await post(app, {
    id: 1001, email: "mae@exemplo.com", phone: "5541999990000",
    total_price: "197.00",
    customer: { first_name: "Maria", last_name: "Souza" },
    line_items: [{ title: "Tarefas Diárias" }],
  });
  assert.equal(res.statusCode, 200);
  const leads = await repo.list("leads");
  assert.equal(leads.length, 1);
  const l = leads[0];
  assert.equal(l.saas, "uniquekids");
  assert.equal(l.name, "Maria Souza");
  assert.equal(l.phone, "5541999990000");
  assert.equal(l.owner, "ana");
  assert.equal(l.closer, "ana");
  assert.equal(l.stage, "Novo lead");
  assert.equal(l.shopifyOrderId, "1001");
  assert.match(l.source, /tarefas diárias/i);
  await app.close();
});

test("product-only: pedido caro SEM 'tarefas diárias' NÃO cria lead", async () => {
  const { app, repo } = await build();
  const res = await post(app, {
    id: 1002, email: "outra@exemplo.com",
    total_price: "349.90",
    customer: { first_name: "Joana" },
    line_items: [{ title: "Outro produto qualquer" }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

test("pega todas as variações do nome 'tarefas diárias'", async () => {
  const { app, repo } = await build();
  for (const [i, title] of [
    "Quadro Tarefas Diárias + Bônus",
    "Tarefas Diárias + Método R.O.T.I.N.A. 3.0",
    "Tarefas diárias + Pote da conquista",
  ].entries()) {
    await post(app, { id: 2000 + i, total_price: "150.00", line_items: [{ title }] });
  }
  assert.equal((await repo.list("leads")).length, 3);
  await app.close();
});

test("sem produto e sem piso configurado: não cria lead", async () => {
  const { app, repo } = await build();
  const res = await post(app, {
    id: 1003, total_price: "97.00",
    line_items: [{ title: "Ebook barato" }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

test("rejeita assinatura HMAC inválida (401) e não cria lead", async () => {
  const { app, repo } = await build();
  const res = await post(app, {
    id: 1004, total_price: "500.00", line_items: [{ title: "Tarefas Diárias" }],
  }, { hmac: "assinatura-errada" });
  assert.equal(res.statusCode, 401);
  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

test("idempotente: mesmo pedido entregue 2x cria só 1 lead", async () => {
  const { app, repo } = await build();
  const order = { id: 1005, total_price: "197.00", line_items: [{ title: "Tarefas Diárias" }] };
  const a = await post(app, order);
  const b = await post(app, order);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(JSON.parse(b.body).duplicate, true);
  assert.equal((await repo.list("leads")).length, 1);
  await app.close();
});

test("ignora tópicos que não são de pedido (200, sem lead)", async () => {
  const { app, repo } = await build();
  const res = await post(app, { id: 1 }, { topic: "app/uninstalled" });
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.list("leads")).length, 0);
  await app.close();
});

// Poller de reconciliação (rede de segurança do webhook): puxa os pedidos pagos
// da Shopify e preenche os leads que faltam. Foi construído porque o webhook
// orders/paid ficou 8 dias sem entregar (nenhum lead novo desde o backfill de
// 13/07). Cobre: só "tarefas diárias" entra, dedup por order id, data do PEDIDO.
test("startShopifySync: backfill dos pedidos que o webhook perdeu, com dedup e gatilho", async () => {
  const { startShopifySync } = await import("../src/routes.webhooks.js");
  const repo = makeMemRepo();
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", funnel: [{ stage: "Novo lead", kind: "novo" }] });
  await repo.create("users", { id: "ana", name: "Ana", saas: "uniquekids", roles: ["closer"] });
  // Já existe um lead do pedido 1001 (o webhook pegou esse) — não pode duplicar.
  await repo.create("leads", { id: "le_shp1001", saas: "uniquekids", shopifyOrderId: "1001", stage: "Novo lead", createdAt: "2026-07-13T18:00:00Z" });

  const orders = [
    { id: 1001, created_at: "2026-07-13T18:00:00Z", customer: { first_name: "Maria" }, line_items: [{ title: "Quadro Tarefas Diárias" }], phone: "11999990000" },
    { id: 1002, created_at: "2026-07-15T10:00:00Z", customer: { first_name: "Joana" }, line_items: [{ title: "Tarefas Diárias + Bônus" }], shipping_address: { phone: "11988887777" } },
    { id: 1003, created_at: "2026-07-16T12:00:00Z", customer: { first_name: "Caneca" }, line_items: [{ title: "Caneca personalizada" }] }, // NÃO é tarefas diárias
  ];
  const shopify = { configured: () => true, paidOrdersSince: async () => orders };

  const stop = startShopifySync(repo, { shopify, intervalMs: 1e9, log: { info() {}, warn() {} } });
  await new Promise((r) => setTimeout(r, 50)); // deixa o tick do boot rodar
  stop();

  const leads = await repo.list("leads");
  const kids = leads.filter((l) => l.saas === "uniquekids");
  assert.equal(kids.length, 2, "1001 (dedup) + 1002 (novo); 1003 não é gatilho");
  const novo = kids.find((l) => l.shopifyOrderId === "1002");
  assert.ok(novo, "pedido 1002 virou lead");
  assert.equal(novo.name, "Joana");
  assert.equal(novo.phone, "11988887777");
  assert.equal(novo.closer, "ana");
  assert.equal(novo.createdAt, "2026-07-15T10:00:00Z", "usa a data do PEDIDO, não 'agora'");
  assert.ok(!leads.some((l) => l.shopifyOrderId === "1003"), "caneca não entra");
});
