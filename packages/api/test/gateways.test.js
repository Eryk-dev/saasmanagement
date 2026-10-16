// Gateways alternativos de recebimento (Asaas + Appmax) no MESMO espelho do
// Mercado Pago (mp_payments, campo gateway). Cobre: link do lead/cliente pelo
// Asaas (externalReference) e pela Appmax (link colado), webhook do Asaas
// (token no header, re-busca por id, casamento pelo link e pela fatura,
// baixa com paidGateway), parcelamento do Asaas (um doc por parcela; a
// fatura fecha quando o grupo fecha), webhook da Appmax (token na URL, sem
// regressão de aprovado → pendente, estorno), caixa (cashIn) e sync.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/payments/mp.js");
const { makeAsaas } = await import("../src/payments/asaas.js");
const { makeAppmax, parseAppmaxEvent } = await import("../src/payments/appmax.js");
const { runAsaasSync, normalizeAsaasPayment } = await import("../src/payments/asaas-payments.js");
const { brtToIso, phoneKey } = await import("../src/payments/gateways.js");
const { cashIn, paidProofKindOf } = await import("../src/metrics/metrics-core.js");

const ASAAS_TOKEN = "asaas-webhook-token";
const APPMAX_TOKEN = "appmax-token-longo";

function makeFakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    calls.push({ key, url, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const hit = routes[key];
    if (!hit) return { status: 404, text: async () => JSON.stringify({ errors: [{ description: `no fake for ${key}` }] }) };
    const body = typeof hit === "function" ? hit(calls[calls.length - 1]) : hit;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

function buildApp(repo, { asaasRoutes = {}, mpRoutes = {}, asaasOn = true, appmaxOn = true, mpOn = true } = {}) {
  const asaasFetch = makeFakeFetch(asaasRoutes);
  const asaas = makeAsaas({ fetch: asaasFetch, apiKey: asaasOn ? "asaas-key" : "", webhookToken: asaasOn ? ASAAS_TOKEN : "" });
  const mp = makeMp({ fetch: makeFakeFetch(mpRoutes), accessToken: mpOn ? "mp-token" : "", webhookSecret: "" });
  const appmax = makeAppmax({ webhookToken: appmaxOn ? APPMAX_TOKEN : "" });
  const app = Fastify();
  registerRoutes(app, repo, { mp, asaas, appmax });
  return { app, asaas, asaasFetch, mp, appmax };
}

async function seed(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", name: "Cliente Real", saas: "leverads", email: "payer@x.com", phone: "41999990000", arr: 0 });
  await repo.create("leads", { id: "l1", name: "Lead Novo", saas: "leverads", email: "lead@x.com", phone: "+55 41 98888-0000", stage: "Call", createdAt: "2026-10-01T12:00:00.000Z" });
}

const asaasPmt = (over = {}) => ({
  object: "payment", id: "pay_1", customer: "cus_1", value: 500, netValue: 490.5,
  billingType: "PIX", status: "CONFIRMED", dateCreated: "2026-10-12", confirmedDate: "2026-10-12", paymentDate: null,
  description: "Lever OEM", externalReference: "", paymentLink: "", installment: null, ...over,
});
const asaasCustomer = { object: "customer", id: "cus_1", name: "Cliente Real", email: "payer@x.com", cpfCnpj: "12345678000190", mobilePhone: "41999990000" };

test("brtToIso: data sem fuso é horário de Brasília (não desloca o dia); phoneKey tira o 55", () => {
  assert.equal(brtToIso("2026-10-12"), "2026-10-12T15:00:00.000Z");
  assert.equal(brtToIso("2026-10-12 14:30:00"), "2026-10-12T17:30:00.000Z");
  assert.equal(brtToIso("2026-10-12T17:30:00.000Z"), "2026-10-12T17:30:00.000Z");
  assert.equal(brtToIso(""), "");
  assert.equal(phoneKey("+55 (41) 98888-0000"), "41988880000");
  assert.equal(phoneKey("41 3333-4444"), "4133334444");
  assert.equal(phoneKey("123"), "");
});

test("normalizeAsaasPayment: status/forma no dialeto do espelho, taxa = bruto − líquido, pagador do cliente", () => {
  const d = normalizeAsaasPayment(asaasPmt({ billingType: "CREDIT_CARD", creditCard: { creditCardBrand: "VISA" } }), { customer: asaasCustomer });
  assert.equal(d.gateway, "asaas");
  assert.equal(d.mpId, "pay_1");
  assert.equal(d.status, "approved");
  assert.equal(d.method, "visa");
  assert.equal(d.methodType, "credit_card");
  assert.equal(d.feeAmount, 9.5);
  assert.equal(d.payerName, "Cliente Real");
  assert.equal(d.payerDoc, "12345678000190");
  assert.equal(d.payerPhone, "41999990000");
  assert.equal(d.kind, "venda");
  assert.equal(d.dateApproved, "2026-10-12T15:00:00.000Z");
  assert.equal(normalizeAsaasPayment(asaasPmt({ status: "PENDING" })).status, "pending");
  assert.equal(normalizeAsaasPayment(asaasPmt({ status: "REFUNDED" })).status, "refunded");
  assert.equal(normalizeAsaasPayment(asaasPmt({ status: "CHARGEBACK_REQUESTED" })).status, "charged_back");
  assert.equal(normalizeAsaasPayment(asaasPmt({ status: "PENDING" }), { event: "PAYMENT_DELETED" }).status, "cancelled");
  assert.equal(normalizeAsaasPayment(asaasPmt({ status: "PENDING" })).dateApproved, "");
});

test("GET /api/gateways diz o que está ligado", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, { appmaxOn: false });
  const r = (await app.inject({ method: "GET", url: "/api/gateways" })).json();
  assert.equal(r.mp.configured, true);
  assert.equal(r.asaas.configured, true);
  assert.equal(r.asaas.webhook, true);
  assert.equal(r.appmax.configured, false);
  await app.close();
});

test("link gerado no card de lead JÁ GANHO não reescreve a venda (produto, plano, valor, meio)", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, { asaasRoutes: { "POST /v3/paymentLinks": { id: "pl_9", url: "https://www.asaas.com/c/pl9" } } });
  await seed(repo);
  await repo.update("leads", "l1", {
    stage: "Ganho", wonAt: "2026-08-27T12:18:52.932Z", customerId: "c1",
    dealProduct: "oem", planClosed: "anual", amount: 2760, paymentMethod: "cartao12x",
  });
  const res = await app.inject({
    method: "POST", url: "/api/leads/l1/mp/link",
    payload: { gateway: "asaas", amount: 5990, contractValue: 5990, product: "price_essencial", plan: "anual", paymentMethod: "pix", title: "Lever Price · Essencial · Anual" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.amount, 2760, "o valor da venda original fica");
  assert.equal(lead.dealProduct, "oem");
  assert.equal(lead.planClosed, "anual");
  assert.equal(lead.paymentMethod, "cartao12x");
  assert.equal(lead.mpChargeAmount, 5990, "o link em si é carimbado");
  assert.equal(lead.mpChargeUrl, "https://www.asaas.com/c/pl9");
  const note = (await repo.list("activities")).find((a) => a.lead === "l1" && a.type === "note");
  assert.match(note.text, /cobrança avulsa/);

  // Lead AINDA aberto: o link do fechamento continua gravando a venda, como antes.
  await repo.create("leads", { id: "l2", name: "Aberto", saas: "leverads", stage: "Call", email: "l2@x.com" });
  const r2 = await app.inject({
    method: "POST", url: "/api/leads/l2/mp/link",
    payload: { gateway: "asaas", amount: 2760, contractValue: 2760, product: "oem", plan: "anual", paymentMethod: "cartao12x" },
  });
  assert.equal(r2.statusCode, 200, r2.body);
  const l2 = await repo.get("leads", "l2");
  assert.equal(l2.amount, 2760);
  assert.equal(l2.dealProduct, "oem");
  assert.equal(l2.paymentMethod, "cartao12x");
});

test("link do lead pelo Asaas: paymentLink com externalReference = lead; o pagamento do link entra casado e paga o link", async (t) => {
  // Relógio no dia das fixtures (dateCreated 2026-10-12): o link nasce com
  // createdAt = new Date() (recordPaymentLink) e o enrichPaymentLinks só casa
  // pagamento POSTERIOR ao link (1 dia de folga no Asaas). Com o relógio real,
  // o pagamento de 12/10 fica "antes do link" e o link volta "waiting".
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T15:00:00.000Z") });
  const repo = makeMemRepo();
  const { app, asaasFetch } = buildApp(repo, {
    asaasRoutes: {
      "POST /v3/paymentLinks": { id: "pl_1", url: "https://www.asaas.com/c/pl1" },
      "GET /v3/payments/pay_1": asaasPmt({ paymentLink: "pl_1" }),
      "GET /v3/customers/cus_1": asaasCustomer,
    },
  });
  await seed(repo);

  const res = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "asaas", amount: 500, maxInstallments: 3, title: "Lever OEM · Anual" } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().url, "https://www.asaas.com/c/pl1");
  assert.equal(res.json().gateway, "asaas");
  const create = asaasFetch.calls.find((c) => c.key === "POST /v3/paymentLinks");
  assert.equal(create.headers.access_token, "asaas-key");
  assert.equal(create.body.externalReference, "l1");
  assert.equal(create.body.chargeType, "INSTALLMENT");
  assert.equal(create.body.maxInstallmentCount, 3);
  assert.equal(create.body.billingType, "UNDEFINED");
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.mpChargeUrl, "https://www.asaas.com/c/pl1");
  assert.equal(lead.mpChargeGateway, "asaas");
  const links = await repo.list("payment_links");
  assert.equal(links.length, 1);
  assert.equal(links[0].gateway, "asaas");
  assert.equal(links[0].prefId, "pl_1");
  assert.equal(links[0].reference, "l1");

  // Webhook sem token → 401; com token: re-busca a cobrança, acha o lead
  // pelo link (o Asaas não repassou o externalReference) e o pagador.
  const bad = await app.inject({ method: "POST", url: "/public/asaas/webhook", payload: { event: "PAYMENT_CONFIRMED", payment: { id: "pay_1" } } });
  assert.equal(bad.statusCode, 401);
  const ok = await app.inject({
    method: "POST", url: "/public/asaas/webhook", headers: { "asaas-access-token": ASAAS_TOKEN },
    payload: { id: "evt_1", event: "PAYMENT_CONFIRMED", dateCreated: "2026-10-12 10:00:00", payment: { id: "pay_1", status: "CONFIRMED" } },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().matched, true);
  const mirror = await repo.get("mp_payments", "asa_pay_1");
  assert.equal(mirror.gateway, "asaas");
  assert.equal(mirror.status, "approved");
  assert.equal(mirror.lead, "l1");
  assert.equal(mirror.matchedBy, "reference");
  assert.equal(mirror.externalReference, "l1");
  assert.equal(mirror.gatewayLink, "pl_1");
  assert.equal(mirror.payerName, "Cliente Real");

  const pl = (await app.inject({ method: "GET", url: "/api/payment-links?saas=leverads" })).json();
  assert.equal(pl.links[0].status, "paid");
  assert.equal(pl.links[0].paidBy, "asaas");
  assert.equal(pl.links[0].paidAmount, 500);
  assert.equal(pl.links[0].payment.gateway, "asaas");
  await app.close();
});

test("cobrança do cliente pelo Asaas: fatura aberta + link; o pagamento com externalReference = fatura dá baixa com paidGateway asaas e entra no caixa", async () => {
  const repo = makeMemRepo();
  const { app, asaas } = buildApp(repo, {
    asaasRoutes: {
      "POST /v3/paymentLinks": { id: "pl_2", url: "https://www.asaas.com/c/pl2" },
      "GET /v3/customers/cus_1": asaasCustomer,
    },
  });
  await seed(repo);
  const res = await app.inject({ method: "POST", url: "/api/customers/c1/charge", payload: { gateway: "asaas", amount: 800, title: "Setup" } });
  assert.equal(res.statusCode, 200, res.body);
  const { invoice } = res.json();
  assert.equal(invoice.status, "open");
  assert.equal(invoice.paymentGateway, "asaas");
  assert.equal(invoice.mpInitPoint, "https://www.asaas.com/c/pl2");

  // Poller: lista por criação e por pagamento (dedupe), ingere e baixa.
  let listCalls = 0;
  asaas.listPayments = async ({ createdSince, paidSince }) => {
    listCalls++;
    assert.ok(createdSince || paidSince);
    return { hasMore: false, data: [asaasPmt({ id: "pay_2", value: 800, netValue: 790, externalReference: invoice.id, status: "RECEIVED", paymentDate: "2026-10-12" })] };
  };
  const r = await runAsaasSync(repo, asaas, { now: new Date("2026-10-12T20:00:00Z") });
  assert.equal(r.ok, true);
  assert.equal(r.seen, 1);
  assert.equal(r.settled, 1);
  assert.equal(listCalls, 2);
  const paid = await repo.get("invoices", invoice.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.mpPaymentId, "pay_2");
  assert.equal(paid.paidGateway, "asaas");
  assert.equal(paid.paidProof.kind, "asaas");
  assert.equal(paidProofKindOf(paid), "asaas");
  assert.equal(paid.paidMethod, "pix");
  const stamp = await repo.get("app_config", "asaas_sync");
  assert.equal(stamp.lastSeen, 1);

  const cash = cashIn({ customers: await repo.list("customers"), invoices: await repo.list("invoices"), mpPayments: await repo.list("mp_payments"), saas: "leverads" });
  assert.equal(cash.total, 800); // conta UMA vez (pelo pagamento), não duas
  assert.equal(cash.presumido.n, 0);
  await app.close();
});

test("parcelamento do Asaas: um doc por parcela; a fatura fecha quando o grupo fecha (cartão confirma todas de uma vez)", async () => {
  const repo = makeMemRepo();
  const parcels = [
    asaasPmt({ id: "pay_a", value: 500, netValue: 480, billingType: "CREDIT_CARD", installment: "inst_1", installmentNumber: 1, status: "CONFIRMED", externalReference: "inv_x" }),
    asaasPmt({ id: "pay_b", value: 500, netValue: 480, billingType: "CREDIT_CARD", installment: "inst_1", installmentNumber: 2, status: "CONFIRMED", externalReference: "inv_x" }),
  ];
  const { app } = buildApp(repo, {
    asaasRoutes: {
      "GET /v3/payments/pay_a": parcels[0],
      "GET /v3/payments/pay_b": parcels[1],
      "GET /v3/payments": (call) => (call.query.installment === "inst_1" ? { hasMore: false, data: parcels } : { hasMore: false, data: [] }),
      "GET /v3/customers/cus_1": asaasCustomer,
    },
  });
  await seed(repo);
  await repo.create("invoices", { id: "inv_x", customer: "c1", saas: "leverads", amount: 1000, kind: "manual", status: "open", dueDate: "2026-10-20T12:00:00.000Z", createdAt: "2026-10-10T12:00:00.000Z" });
  for (const id of ["pay_a", "pay_b"]) {
    const r = await app.inject({ method: "POST", url: "/public/asaas/webhook", headers: { "asaas-access-token": ASAAS_TOKEN }, payload: { event: "PAYMENT_CONFIRMED", payment: { id } } });
    assert.equal(r.statusCode, 200, r.body);
  }
  const a = await repo.get("mp_payments", "asa_pay_a"), b = await repo.get("mp_payments", "asa_pay_b");
  assert.equal(a.amount, 500);
  assert.equal(a.installments, 2);
  assert.equal(a.installmentTotal, 1000);
  assert.equal(a.installmentAllPaid, true);
  assert.equal(a.invoice, "inv_x");
  assert.equal(b.invoice, "inv_x");
  const inv = await repo.get("invoices", "inv_x");
  assert.equal(inv.status, "paid");
  assert.equal(inv.mpPaymentId, "pay_a");
  assert.equal(inv.paidInstallments, 2);
  // Caixa: as duas parcelas, 1.000 no total, sem contar a fatura de novo.
  const cash = cashIn({ customers: await repo.list("customers"), invoices: await repo.list("invoices"), mpPayments: await repo.list("mp_payments"), saas: "leverads" });
  assert.equal(cash.total, 1000);
  await app.close();
});

test("parcela solta (carnê ainda em curso) NÃO baixa a fatura inteira; no link aparece como parcelas em curso", async () => {
  const repo = makeMemRepo();
  const parcels = [
    asaasPmt({ id: "pay_c", value: 300, netValue: 295, billingType: "BOLETO", installment: "inst_2", installmentNumber: 1, status: "RECEIVED", paymentDate: "2026-10-12", externalReference: "l1" }),
    asaasPmt({ id: "pay_d", value: 300, netValue: 295, billingType: "BOLETO", installment: "inst_2", installmentNumber: 2, status: "PENDING", externalReference: "l1" }),
  ];
  const { app } = buildApp(repo, {
    asaasRoutes: {
      "GET /v3/payments/pay_c": parcels[0],
      "GET /v3/payments": { hasMore: false, data: parcels },
      "GET /v3/customers/cus_1": asaasCustomer,
    },
  });
  await seed(repo);
  await repo.create("payment_links", { id: "pl_x", saas: "leverads", kind: "lead", origin: "card", lead: "l1", amount: 600, title: "Lever", url: "https://asaas/x", prefId: "pl_9", gateway: "asaas", reference: "l1", createdAt: "2026-10-10T12:00:00.000Z" });
  const r = await app.inject({ method: "POST", url: "/public/asaas/webhook", headers: { "asaas-access-token": ASAAS_TOKEN }, payload: { event: "PAYMENT_RECEIVED", payment: { id: "pay_c" } } });
  assert.equal(r.statusCode, 200, r.body);
  const c = await repo.get("mp_payments", "asa_pay_c");
  assert.equal(c.installmentAllPaid, false);
  assert.equal(c.lead, "l1");
  const pl = (await app.inject({ method: "GET", url: "/api/payment-links?saas=leverads" })).json();
  assert.equal(pl.links[0].status, "in_process");
  assert.equal(pl.links[0].paidAmount, 300);
  await app.close();
});

test("Appmax: link colado no card (sem API); sem url é 400; webhook sem token é 401", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo);
  await seed(repo);
  const semUrl = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "appmax", amount: 500 } });
  assert.equal(semUrl.statusCode, 400);
  assert.match(semUrl.json().error, /painel da Appmax/);
  const ok = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "appmax", amount: 500, url: "https://pay.appmax.com.br/abc123" } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().url, "https://pay.appmax.com.br/abc123");
  const links = await repo.list("payment_links");
  assert.equal(links[0].gateway, "appmax");
  assert.equal(links[0].url, "https://pay.appmax.com.br/abc123");
  const noTok = await app.inject({ method: "POST", url: "/public/appmax/webhook", payload: { event: "OrderApproved", data: { id: 1 } } });
  assert.equal(noTok.statusCode, 401);
  const badTok = await app.inject({ method: "POST", url: "/public/appmax/webhook?token=errado", payload: { event: "OrderApproved", data: { id: 1 } } });
  assert.equal(badTok.statusCode, 401);
  const inval = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "pagseguro", amount: 500 } });
  assert.equal(inval.statusCode, 400);
  await app.close();
});

test("gateway desligado: link recusa com o motivo (4xx), sem chamar nada", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, { asaasOn: false, appmaxOn: false });
  await seed(repo);
  const r = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "asaas", amount: 500 } });
  assert.ok(r.statusCode >= 400 && r.statusCode < 500, String(r.statusCode));
  assert.match(r.json().error, /ASAAS_API_KEY/);
  const a = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { gateway: "appmax", amount: 500, url: "https://x.y/z" } });
  assert.ok(a.statusCode >= 400 && a.statusCode < 500);
  assert.match(a.json().error, /APPMAX_WEBHOOK_TOKEN/);
  await app.close();
});

test("parseAppmaxEvent: formato legado e formato novo viram o mesmo doc", () => {
  const legado = parseAppmaxEvent({
    environment: "production", event: "OrderApproved",
    data: {
      id: 3531, status: "aprovado", total: 259.9, payment_type: "CreditCard", installments: 3,
      created_at: "2026-10-12 14:28:00", paid_at: "2026-10-12 14:30:00",
      customer: { id: 9, firstname: "Cliente", lastname: "Real", email: "PAYER@x.com", CPF: "123.456.789-00", telephone: "5541999990000" },
      bundles: [{ name: "Combo", products: [{ name: "Curso", price: 259.9, quantity: 1 }] }],
    },
  });
  assert.equal(legado.gateway, "appmax");
  assert.equal(legado.mpId, "3531");
  assert.equal(legado.status, "approved");
  assert.equal(legado.amount, 259.9);
  assert.equal(legado.methodType, "credit_card");
  assert.equal(legado.installments, 3);
  assert.equal(legado.payerEmail, "payer@x.com");
  assert.equal(legado.payerName, "Cliente Real");
  assert.equal(legado.payerDoc, "12345678900");
  assert.equal(legado.payerPhone, "41999990000");
  assert.equal(legado.description, "Curso");
  assert.equal(legado.dateApproved, "2026-10-12T17:30:00.000Z");
  const novo = parseAppmaxEvent({
    event: "order_paid_by_pix", event_type: "order",
    data: { order_id: 77, status: "aprovado", total: 100, merchant_total: 96.5, paid_at: "2026-10-12 09:00:00", created_at: "2026-10-12 08:50:00", products: [{ name: "Lever OEM" }], payment_info: { pix: {} }, customer: { name: "Fulano", email: "f@x.com" } },
  });
  assert.equal(novo.mpId, "77");
  assert.equal(novo.status, "approved");
  assert.equal(novo.method, "pix");
  assert.equal(novo.feeAmount, 3.5);
  assert.equal(novo.payerName, "Fulano");
  assert.equal(parseAppmaxEvent({ event: "PaymentNotAuthorized", data: { id: 5, status: "não autorizado", total: 10 } }).status, "rejected");
  assert.equal(parseAppmaxEvent({ event: "OrderRefund", data: { id: 5, status: "estornado", total: 10 } }).status, "refunded");
  assert.equal(parseAppmaxEvent({ event: "OrderBilletCreated", data: { id: 5, status: "pendente", total: 10 } }).status, "pending");
  assert.equal(parseAppmaxEvent({ event: "customer_created", data: { customer_id: 1 } }), null);
  assert.equal(parseAppmaxEvent({}), null);
});

test("webhook da Appmax: casa pelo e-mail, baixa fatura de valor exato, não regride pra pendente e registra estorno", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo);
  await seed(repo);
  await repo.create("invoices", { id: "inv_a", customer: "c1", saas: "leverads", amount: 259.9, kind: "manual", status: "open", dueDate: "2026-10-20T12:00:00.000Z", createdAt: "2026-10-10T12:00:00.000Z" });
  const order = (event, status) => ({
    environment: "production", event,
    data: { id: 3531, status, total: 259.9, payment_type: "Pix", installments: 1, created_at: "2026-10-12 14:28:00", paid_at: status === "aprovado" ? "2026-10-12 14:30:00" : null,
      customer: { firstname: "Cliente", lastname: "Real", email: "payer@x.com", telephone: "41999990000" } },
  });
  const ok = await app.inject({ method: "POST", url: `/public/appmax/webhook?token=${APPMAX_TOKEN}`, payload: order("OrderApproved", "aprovado") });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().matched, true);
  assert.equal(ok.json().invoice, "inv_a");
  const m = await repo.get("mp_payments", "apx_3531");
  assert.equal(m.customer, "c1");
  assert.equal(m.matchedBy, "email");
  assert.equal((await repo.get("invoices", "inv_a")).paidGateway, "appmax");

  // Evento velho redelivered depois do pago: continua aprovado.
  const old = await app.inject({ method: "POST", url: `/public/appmax/webhook?token=${APPMAX_TOKEN}`, payload: order("OrderPixCreated", "pendente") });
  assert.equal(old.json().status, "approved");
  assert.equal((await repo.get("mp_payments", "apx_3531")).status, "approved");

  // Estorno: muda o status (a decisão sobre a fatura é humana).
  const ref = await app.inject({ method: "POST", url: `/public/appmax/webhook?token=${APPMAX_TOKEN}`, payload: order("OrderRefund", "estornado") });
  assert.equal(ref.json().status, "refunded");
  assert.equal((await repo.get("invoices", "inv_a")).status, "paid");
  const cash = cashIn({ customers: await repo.list("customers"), invoices: await repo.list("invoices"), mpPayments: await repo.list("mp_payments"), saas: "leverads" });
  assert.equal(cash.total, 0); // estornado no espelho prevalece sobre a baixa
  await app.close();
});

test("Appmax: sem e-mail no cadastro, o TELEFONE do pagador casa o lead", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo);
  await seed(repo);
  const r = await app.inject({
    method: "POST", url: `/public/appmax/webhook?token=${APPMAX_TOKEN}`,
    payload: { event: "OrderApproved", data: { id: 9, status: "aprovado", total: 50, payment_type: "Pix", paid_at: "2026-10-12 10:00:00", customer: { firstname: "Lead", email: "outro@x.com", telephone: "+55 41 98888-0000" } } },
  });
  assert.equal(r.json().matched, true);
  const m = await repo.get("mp_payments", "apx_9");
  assert.equal(m.lead, "l1");
  assert.equal(m.matchedBy, "phone");
  await app.close();
});

test("sync-all do Financeiro roda o Asaas junto e não exige o MP", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const { app, asaas } = buildApp(repo, { mpOn: false });
  asaas.listPayments = async () => ({ hasMore: false, data: [] });
  const r = (await app.inject({ method: "POST", url: "/api/fin/leverads/sync" })).json();
  assert.equal(r.ok, true);
  assert.equal(r.in, undefined);
  assert.equal(r.asaas.ok, true);
  assert.equal(r.asaas.seen, 0);
  const lista = (await app.inject({ method: "GET", url: "/api/mp/payments" })).json();
  assert.deepEqual(lista.gateways, { mp: false, asaas: true, appmax: true });
  await app.close();
});

test("Mercado Pago continua igual: ingest do MP carimba gateway mp e id mpp_", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, { mpRoutes: { "GET /v1/payments/777": { id: 777, status: "approved", transaction_amount: 500, payment_method_id: "pix", payment_type_id: "bank_transfer", payer: { email: "payer@x.com" }, date_created: "2026-10-12T10:00:00.000Z", date_approved: "2026-10-12T10:01:00.000Z" } } });
  await seed(repo);
  const r = await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "payment", data: { id: "777" } } });
  assert.equal(r.statusCode, 200, r.body);
  const m = await repo.get("mp_payments", "mpp_777");
  assert.equal(m.gateway, "mp");
  assert.equal(m.customer, "c1");
  await app.close();
});
