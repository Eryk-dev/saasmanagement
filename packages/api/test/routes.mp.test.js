// Mercado Pago (fase 4) — client portado do copylever + webhook ligado no motor
// da fase 5. Cobre: assinatura HMAC do webhook (manifest id;request-id;ts),
// criação do link (preapproval pending → init_point salvo na assinatura),
// webhook preapproval (authorized → active; cancelled → canceled + ARR),
// baixa automática de fatura idempotente por mpPaymentId, payer mismatch DROP.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp, parseWebhookPayload } = await import("../src/mp.js");

const SECRET = "test-webhook-secret";

// fetch fake: responde por (method, path) registrados; grava as chamadas.
function makeFakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const key = `${init.method || "GET"} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const hit = routes[key];
    if (!hit) return { status: 404, text: async () => JSON.stringify({ error: `no fake for ${key}` }) };
    const body = typeof hit === "function" ? hit(calls[calls.length - 1]) : hit;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

function buildApp(repo, mpRoutes = {}) {
  const fakeFetch = makeFakeFetch(mpRoutes);
  const mp = makeMp({ fetch: fakeFetch, accessToken: "test-token", webhookSecret: SECRET });
  const app = Fastify();
  registerRoutes(app, repo, { mp });
  return { app, fakeFetch };
}

function sign(dataId, requestId = "req-1", ts = "1700000000") {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

async function setupSub(repo, app) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", name: "Cliente Real", saas: "leverads", email: "payer@x.com", arr: 0 });
  const res = await app.inject({
    method: "POST", url: "/api/subscriptions",
    payload: { customer: "c1", saas: "leverads", price: 449, cycle: "monthly" },
  });
  return res.json();
}

test("parseWebhookPayload normaliza v2 (Webhooks) e v1 (IPN)", () => {
  assert.deepEqual(parseWebhookPayload({ type: "subscription_preapproval", data: { id: "abc" } }), { topic: "subscription_preapproval", dataId: "abc" });
  assert.deepEqual(parseWebhookPayload({ topic: "preapproval", id: "xyz" }), { topic: "preapproval", dataId: "xyz" });
  assert.deepEqual(parseWebhookPayload(null), { topic: "", dataId: "" });
});

test("verifyWebhookSignature: válida passa, adulterada não, sem secret não", () => {
  const mp = makeMp({ accessToken: "t", webhookSecret: SECRET });
  const h = sign("123");
  assert.equal(mp.verifyWebhookSignature(h["x-signature"], "req-1", "123"), true);
  assert.equal(mp.verifyWebhookSignature(h["x-signature"], "req-1", "999"), false);
  assert.equal(mp.verifyWebhookSignature("ts=1,v1=deadbeef", "req-1", "123"), false);
  const noSecret = makeMp({ accessToken: "t" });
  assert.equal(noSecret.verifyWebhookSignature(h["x-signature"], "req-1", "123"), false);
});

test("mp/link: cria preapproval pending e salva id/init_point/payer na assinatura", async () => {
  const repo = makeMemRepo();
  const { app, fakeFetch } = buildApp(repo, {
    "POST /preapproval": (call) => ({ id: "pre_1", status: "pending", init_point: "https://mp.com/pay/pre_1", payer_email: call.body.payer_email }),
  });
  const sub = await setupSub(repo, app);

  const res = await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().initPoint, "https://mp.com/pay/pre_1");

  const saved = await repo.get("subscriptions", sub.id);
  assert.equal(saved.mpPreapprovalId, "pre_1");
  assert.equal(saved.mpStatus, "pending");
  assert.equal(saved.payerEmail, "payer@x.com"); // veio do customer.email

  // payload pro MP: valor em reais, ciclo em meses, external_reference = sub.id
  const call = fakeFetch.calls.find((c) => c.key === "POST /preapproval");
  assert.equal(call.body.auto_recurring.transaction_amount, 449);
  assert.equal(call.body.auto_recurring.frequency, 1);
  assert.equal(call.body.external_reference, sub.id);

  await app.close();
});

test("webhook preapproval: assinatura HMAC inválida → 400; authorized → active; cancelled → canceled + ARR 0", async () => {
  const repo = makeMemRepo();
  let preStatus = "authorized";
  const { app } = buildApp(repo, {
    "POST /preapproval": { id: "pre_1", status: "pending", init_point: "x", payer_email: "payer@x.com" },
    "GET /preapproval/pre_1": () => ({ id: "pre_1", status: preStatus, external_reference: subId, payer_email: "payer@x.com" }),
  });
  const sub = await setupSub(repo, app);
  const subId = sub.id;
  await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} });

  const payload = { type: "subscription_preapproval", data: { id: "pre_1" } };
  // Sem assinatura válida → 400 (secret configurado).
  assert.equal((await app.inject({ method: "POST", url: "/public/mp/webhook", payload })).statusCode, 400);

  // authorized → assinatura ativa; ARR conta.
  const ok = await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("pre_1") });
  assert.equal(ok.statusCode, 200);
  let cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.status, "active");
  assert.equal(cur.mpStatus, "authorized");
  assert.equal((await repo.get("customers", "c1")).arr, 5388);

  // cancelled → cancela e zera ARR.
  preStatus = "cancelled";
  await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("pre_1") });
  cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.status, "canceled");
  assert.equal((await repo.get("customers", "c1")).arr, 0);

  await app.close();
});

test("webhook authorized_payment processed: baixa a fatura aberta; duplicado não baixa 2x", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, {
    "POST /preapproval": { id: "pre_1", status: "pending", init_point: "x", payer_email: "payer@x.com" },
    "GET /authorized_payments/ap_1": { id: "ap_1", status: "processed", preapproval_id: "pre_1", transaction_amount: 449, payment: { id: "pay_77" } },
  });
  const sub = await setupSub(repo, app);
  await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} });

  const payload = { type: "subscription_authorized_payment", data: { id: "ap_1" } };
  const first = await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("ap_1") });
  assert.equal(first.json().ok, true);

  let invoices = (await repo.list("invoices")).filter((i) => i.subscription === sub.id);
  assert.equal(invoices.filter((i) => i.status === "paid").length, 1); // fatura inicial baixada
  assert.equal(invoices[0].mpPaymentId, "pay_77");

  // Redelivery do mesmo pagamento → idempotente.
  const dup = await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("ap_1") });
  assert.equal(dup.json().duplicate, true);
  invoices = (await repo.list("invoices")).filter((i) => i.subscription === sub.id);
  assert.equal(invoices.length, 1);

  await app.close();
});

test("payer mismatch no webhook → evento DROPADO sem tocar a assinatura", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, {
    "POST /preapproval": { id: "pre_1", status: "pending", init_point: "x", payer_email: "payer@x.com" },
    "GET /preapproval/pre_1": () => ({ id: "pre_1", status: "authorized", external_reference: theSubId, payer_email: "OUTRO@golpe.com" }),
  });
  const sub = await setupSub(repo, app);
  const theSubId = sub.id;
  await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} });

  const res = await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_preapproval", data: { id: "pre_1" } }, headers: sign("pre_1") });
  assert.equal(res.json().ignored, "payer mismatch");
  const cur = await repo.get("subscriptions", sub.id);
  assert.equal(cur.mpStatus, "pending"); // intocada

  await app.close();
});

test("mp/link sem MP configurado → 503; cliente sem e-mail → 400", async () => {
  const repo = makeMemRepo();
  // mp sem accessToken = não configurado
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({}) });
  await repo.create("products", { id: "p1", name: "P1" });
  await repo.create("customers", { id: "c1", name: "Sem Email", saas: "p1" });
  const sub = (await app.inject({ method: "POST", url: "/api/subscriptions", payload: { customer: "c1", saas: "p1", price: 100, cycle: "monthly" } })).json();
  assert.equal((await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} })).statusCode, 503);
  await app.close();

  const { app: app2 } = buildApp(repo, {});
  assert.equal((await app2.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} })).statusCode, 400);
  await app2.close();
});
