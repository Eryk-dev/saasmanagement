// Financeiro Mercado Pago — espelho de pagamentos (mp_payments), cobrança
// avulsa anexada ao cliente e reconciliação. Cobre: casamento por fatura/
// assinatura/e-mail, baixa idempotente com "como pagou" carimbado, rollback da
// cobrança quando o MP recusa, vínculo manual e o sync paginado.

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { ingestMpPayment, runMpSync } = await import("../src/mp-payments.js");

const SECRET = "test-webhook-secret";

function makeFakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const key = `${init.method || "GET"} ${path}`;
    calls.push({ key, url, body: init.body ? JSON.parse(init.body) : undefined });
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
  return { app, mp, fakeFetch };
}

function sign(dataId, requestId = "req-1", ts = "1700000000") {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

async function seedCustomer(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  return repo.create("customers", { id: "c1", name: "Cliente Real", saas: "leverads", email: "payer@x.com", arr: 0 });
}

// Pagamento cru do MP (shape do /v1/payments) com overrides.
const mpPmt = (over = {}) => ({
  id: 777, status: "approved", status_detail: "accredited",
  transaction_amount: 500, installments: 1,
  payment_method_id: "pix", payment_type_id: "bank_transfer",
  payer: { email: "payer@x.com", first_name: "Cliente", last_name: "Real" },
  description: "Pagamento", external_reference: "",
  date_created: "2026-07-20T10:00:00.000Z", date_approved: "2026-07-20T10:01:00.000Z",
  ...over,
});

test("charge: cria fatura aberta + link do MP com external_reference = fatura", async () => {
  const repo = makeMemRepo();
  const { app, fakeFetch } = buildApp(repo, {
    "POST /checkout/preferences": { id: "pref_1", init_point: "https://mp.com/p/1" },
  });
  await seedCustomer(repo);

  const res = await app.inject({
    method: "POST", url: "/api/customers/c1/charge",
    payload: { amount: 500, title: "Setup do projeto", maxInstallments: 12 },
  });
  assert.equal(res.statusCode, 200);
  const { invoice, url } = res.json();
  assert.equal(url, "https://mp.com/p/1");
  assert.equal(invoice.status, "open");
  assert.equal(invoice.amount, 500);
  assert.equal(invoice.mpPrefId, "pref_1");
  assert.equal(invoice.mpInitPoint, "https://mp.com/p/1");

  const call = fakeFetch.calls.find((c) => c.key === "POST /checkout/preferences");
  assert.equal(call.body.external_reference, invoice.id);
  assert.equal(call.body.items[0].unit_price, 500);
  assert.equal(call.body.items[0].title, "Setup do projeto");
  assert.equal(call.body.payer.email, "payer@x.com");
  assert.equal(call.body.payment_methods.installments, 12);

  await app.close();
});

test("charge: MP recusou → 424 e a fatura NÃO fica órfã", async () => {
  const repo = makeMemRepo();
  const { app } = buildApp(repo, {}); // sem fake → 404 do MP
  await seedCustomer(repo);

  const res = await app.inject({ method: "POST", url: "/api/customers/c1/charge", payload: { amount: 300 } });
  assert.equal(res.statusCode, 424);
  assert.equal((await repo.list("invoices")).length, 0);

  await app.close();
});

test("webhook payment com external_reference = fatura: baixa com forma/parcelas; redelivery não baixa 2x", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  const inv = await repo.create("invoices", {
    customer: "c1", saas: "leverads", amount: 500, kind: "manual", status: "open",
    dueDate: "2026-07-19T00:00:00.000Z", createdAt: "2026-07-19T00:00:00.000Z",
  });
  const { app } = buildApp(repo, {
    "GET /v1/payments/777": mpPmt({ external_reference: inv.id, payment_method_id: "master", payment_type_id: "credit_card", installments: 12 }),
  });

  const payload = { type: "payment", data: { id: "777" } };
  const first = await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("777") });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().invoice, inv.id);

  const paid = await repo.get("invoices", inv.id);
  assert.equal(paid.status, "paid");
  assert.equal(paid.mpPaymentId, "777");
  assert.equal(paid.paidMethod, "master");
  assert.equal(paid.paidMethodType, "credit_card");
  assert.equal(paid.paidInstallments, 12);
  assert.equal(paid.paidAt, "2026-07-20T10:01:00.000Z"); // data REAL da aprovação

  // espelho casado com cliente + fatura
  const mirror = await repo.get("mp_payments", "mpp_777");
  assert.equal(mirror.customer, "c1");
  assert.equal(mirror.invoice, inv.id);
  assert.equal(mirror.matchedBy, "reference");

  // redelivery → idempotente
  const dup = await app.inject({ method: "POST", url: "/public/mp/webhook", payload, headers: sign("777") });
  assert.equal(dup.json().duplicate, true);
  assert.equal((await repo.list("invoices")).filter((i) => i.status === "paid").length, 1);

  await app.close();
});

test("ingest: pendente entra no espelho SEM baixar; aprovado depois baixa a mesma fatura", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  const inv = await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 250, kind: "manual", status: "open" });

  await ingestMpPayment(repo, mpPmt({ id: 888, status: "pending", status_detail: "pending_waiting_transfer", transaction_amount: 250, external_reference: inv.id, date_approved: "" }));
  assert.equal((await repo.get("invoices", inv.id)).status, "open");
  let mirror = await repo.get("mp_payments", "mpp_888");
  assert.equal(mirror.status, "pending");
  assert.equal(mirror.customer, "c1"); // já casa, só não baixa

  const r = await ingestMpPayment(repo, mpPmt({ id: 888, status: "approved", transaction_amount: 250, external_reference: inv.id }));
  assert.equal(r.settledNow, inv.id);
  assert.equal((await repo.get("invoices", inv.id)).status, "paid");
  mirror = await repo.get("mp_payments", "mpp_888");
  assert.equal(mirror.status, "approved");
  assert.equal(mirror.invoice, inv.id);
});

test("ingest por e-mail: baixa SÓ com valor exato numa única fatura aberta; senão casa sem baixar", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  const inv = await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 599, kind: "renewal", status: "open" });

  // valor bate com a única fatura aberta → baixa
  const hit = await ingestMpPayment(repo, mpPmt({ id: 900, transaction_amount: 599 }));
  assert.equal(hit.settledNow, inv.id);
  assert.equal((await repo.get("mp_payments", "mpp_900")).matchedBy, "email");

  // valor não bate com nada aberto → casa com o cliente mas fica sem fatura
  const miss = await ingestMpPayment(repo, mpPmt({ id: 901, transaction_amount: 100 }));
  assert.equal(miss.settledNow, null);
  assert.equal(miss.matched, true);
  const mirror = await repo.get("mp_payments", "mpp_901");
  assert.equal(mirror.customer, "c1");
  assert.equal(mirror.invoice, "");

  // pagador desconhecido → não identificado
  const ghost = await ingestMpPayment(repo, mpPmt({ id: 902, payer: { email: "quem@e.esse" } }));
  assert.equal(ghost.matched, false);
});

test("vínculo manual: casa o pagamento com o cliente e baixa a fatura de valor exato", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  const inv = await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 350, kind: "manual", status: "open" });
  await ingestMpPayment(repo, mpPmt({ id: 950, transaction_amount: 350, payer: { email: "outro@email.com" } }));
  assert.equal((await repo.get("mp_payments", "mpp_950")).customer, "");

  const { app } = buildApp(repo, {});
  const res = await app.inject({ method: "POST", url: "/api/mp/payments/mpp_950/link", payload: { customer: "c1" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().invoice, inv.id);
  const mirror = await repo.get("mp_payments", "mpp_950");
  assert.equal(mirror.matchedBy, "manual");
  assert.equal((await repo.get("invoices", inv.id)).status, "paid");

  // desvincular depois da baixa é recusado (histórico não se desfaz)
  const undo = await app.inject({ method: "POST", url: "/api/mp/payments/mpp_950/link", payload: {} });
  assert.equal(undo.statusCode, 400);

  await app.close();
});

test("runMpSync: pagina a busca, ingere tudo, carimba app_config e é idempotente", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  await repo.create("invoices", { customer: "c1", saas: "leverads", amount: 599, kind: "renewal", status: "open" });

  const { mp, fakeFetch } = buildApp(repo, {
    "GET /v1/payments/search": {
      paging: { total: 2 },
      results: [
        mpPmt({ id: 1001, transaction_amount: 599 }),
        mpPmt({ id: 1002, status: "rejected", status_detail: "cc_rejected", transaction_amount: 120, date_approved: "" }),
      ],
    },
  });

  const r1 = await runMpSync(repo, mp);
  assert.equal(r1.seen, 2);
  assert.equal(r1.settled, 1); // a de 599 bateu com a fatura aberta
  assert.equal((await repo.list("mp_payments")).length, 2);
  assert.ok((await repo.get("app_config", "mp_sync")).lastAt);

  // busca com janela (range por date_created)
  const call = fakeFetch.calls.find((c) => c.key === "GET /v1/payments/search");
  assert.match(call.url, /range=date_created/);

  // segunda passada: nada muda, nada baixa de novo
  const r2 = await runMpSync(repo, mp);
  assert.equal(r2.settled, 0);
  assert.equal((await repo.list("mp_payments")).length, 2);
});

test("pagador mascarado do search: máscara vira vazio, nome cai pros fallbacks e enriquecido não regride", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);

  // Máscara pura ("xxxxxxxx") não é dado: e-mail/CPF viram "" e nada casa por e-mail falso.
  await ingestMpPayment(repo, mpPmt({
    id: 3001,
    payer: { email: "xxxxxxxxxxx", first_name: "", last_name: "", identification: { number: "xxx.xxx.xxx-xx" } },
  }));
  let doc = await repo.get("mp_payments", "mpp_3001");
  assert.equal(doc.payerEmail, "");
  assert.equal(doc.payerName, "");
  assert.equal(doc.payerDoc, "");
  assert.equal(doc.customer, "");

  // Fallbacks de nome: additional_info (checkout) → titular do cartão.
  await ingestMpPayment(repo, mpPmt({ id: 3002, payer: { email: "" }, additional_info: { payer: { first_name: "Ana", last_name: "Silva" } } }));
  assert.equal((await repo.get("mp_payments", "mpp_3002")).payerName, "Ana Silva");
  await ingestMpPayment(repo, mpPmt({ id: 3003, payer: { email: "" }, card: { cardholder: { name: "JOSE DA SILVA" } } }));
  assert.equal((await repo.get("mp_payments", "mpp_3003")).payerName, "JOSE DA SILVA");

  // bank_info do PIX é a INSTITUIÇÃO, não a pessoa: vai pro payerBank.
  await ingestMpPayment(repo, mpPmt({ id: 3004, payer: { email: "" }, point_of_interaction: { transaction_data: { bank_info: { payer: { long_name: "COOPERATIVA SICREDI" } } } } }));
  doc = await repo.get("mp_payments", "mpp_3004");
  assert.equal(doc.payerName, "");
  assert.equal(doc.payerBank, "COOPERATIVA SICREDI");

  // Tick do poller re-ingere o doc MAGRO: pagador e banco enriquecidos ficam de pé.
  await ingestMpPayment(repo, mpPmt({ id: 3003, payer: { email: "xxxxxxxxxxx" } }));
  assert.equal((await repo.get("mp_payments", "mpp_3003")).payerName, "JOSE DA SILVA");
  await ingestMpPayment(repo, mpPmt({ id: 3004, payer: { email: "xxxxxxxxxxx" } }));
  doc = await repo.get("mp_payments", "mpp_3004");
  assert.equal(doc.payerName, "");
  assert.equal(doc.payerBank, "COOPERATIVA SICREDI");
});

test("runMpSync: search sem nome de pagador busca o doc completo UMA vez (payerDetail)", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);

  const { mp, fakeFetch } = buildApp(repo, {
    "GET /v1/payments/search": { paging: { total: 1 }, results: [mpPmt({ id: 4001, payer: { email: "xxxxxxxxxxx" } })] },
    "GET /v1/payments/4001": mpPmt({ id: 4001 }), // doc completo traz o pagador real
  });

  await runMpSync(repo, mp);
  const doc = await repo.get("mp_payments", "mpp_4001");
  assert.equal(doc.payerName, "Cliente Real");
  assert.equal(doc.payerEmail, "payer@x.com");
  assert.equal(doc.payerDetail, 2);
  assert.equal(doc.customer, "c1"); // o doc completo casou pelo e-mail
  assert.equal(fakeFetch.calls.filter((c) => c.key === "GET /v1/payments/4001").length, 1);

  // Segunda passada: nome já no espelho — não re-busca o doc por id.
  await runMpSync(repo, mp);
  assert.equal(fakeFetch.calls.filter((c) => c.key === "GET /v1/payments/4001").length, 1);
});

test("runMpSync: doc antigo do espelho sem nome (fora da janela do search) é retro-enriquecido", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  // Espelho pré-fix: sem nome, com a máscara crua guardada, fora da janela do search.
  await repo.create("mp_payments", { id: "mpp_5001", mpId: "5001", status: "approved", amount: 325, payerName: "", payerEmail: "xxxxxxxxxxx", dateCreated: "2026-06-01T10:00:00.000Z" });

  const { mp, fakeFetch } = buildApp(repo, {
    "GET /v1/payments/search": { paging: { total: 0 }, results: [] },
    "GET /v1/payments/5001": mpPmt({ id: 5001, transaction_amount: 325 }),
  });

  await runMpSync(repo, mp);
  const doc = await repo.get("mp_payments", "mpp_5001");
  assert.equal(doc.payerName, "Cliente Real");
  assert.equal(doc.payerEmail, "payer@x.com"); // máscara antiga substituída pelo dado real
  assert.equal(doc.payerDetail, 2);

  // Próxima passada não re-busca (payerDetail carimbado).
  await runMpSync(repo, mp);
  assert.equal(fakeFetch.calls.filter((c) => c.key === "GET /v1/payments/5001").length, 1);
});

test("runMpSync: doc v1 com a instituição no nome migra pro payerBank e o CNPJ vira razão social", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  // Espelho da v1: enriquecido (payerDetail true) mas com o banco guardado como nome.
  await repo.create("mp_payments", { id: "mpp_6001", mpId: "6001", status: "approved", amount: 10000, payerName: "COOPERATIVA SICREDI", payerEmail: "", payerDetail: true, dateCreated: "2026-08-07T08:39:00.000Z" });

  const { mp } = buildApp(repo, {
    "GET /v1/payments/search": { paging: { total: 0 }, results: [] },
    "GET /v1/payments/6001": mpPmt({
      id: 6001, transaction_amount: 10000,
      payer: { email: "", identification: { number: "10171520000110" } },
      point_of_interaction: { transaction_data: { bank_info: { payer: { long_name: "COOPERATIVA SICREDI" } } } },
    }),
  });
  const cnpjCalls = [];
  const cnpjFetch = async (url) => { cnpjCalls.push(url); return { status: 200, json: async () => ({ razao_social: "AUTO PECAS EXEMPLO LTDA" }) }; };

  await runMpSync(repo, mp, { cnpjFetch });
  const doc = await repo.get("mp_payments", "mpp_6001");
  assert.equal(doc.payerBank, "COOPERATIVA SICREDI");
  assert.equal(doc.payerName, "AUTO PECAS EXEMPLO LTDA"); // razão social pelo CNPJ
  assert.equal(doc.payerDoc, "10171520000110");
  assert.equal(doc.payerDetail, 2);
  assert.equal(doc.cnpjLookup, true);
  assert.match(cnpjCalls[0], /brasilapi\.com\.br\/api\/cnpj\/v1\/10171520000110/);

  // Próxima passada: nem re-fetch do MP nem re-consulta do CNPJ.
  await runMpSync(repo, mp, { cnpjFetch });
  assert.equal(cnpjCalls.length, 1);
});

test("lead: link de pagamento pelo card carrega o id do lead e o pagamento casa com a origem", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "l9", name: "Loja Autopeças", saas: "leverads", email: "dono@loja.com" });
  const { app, fakeFetch } = buildApp(repo, {
    "POST /checkout/preferences": { id: "pref_9", init_point: "https://mp.com/p/9" },
  });

  const res = await app.inject({ method: "POST", url: "/api/leads/l9/mp/link", payload: { amount: 2500, maxInstallments: 12 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().url, "https://mp.com/p/9");

  // external_reference = LEAD; e-mail do lead vai pro checkout
  const call = fakeFetch.calls.find((c) => c.key === "POST /checkout/preferences");
  assert.equal(call.body.external_reference, "l9");
  assert.equal(call.body.payer.email, "dono@loja.com");

  // link salvo no card + atividade na timeline
  const saved = await repo.get("leads", "l9");
  assert.equal(saved.mpChargeUrl, "https://mp.com/p/9");
  assert.equal(saved.mpChargeAmount, 2500);
  assert.ok((await repo.list("activities")).some((a) => a.lead === "l9" && /link de pagamento/i.test(a.text)));

  // pagamento com a referência do lead casa SEM depender do e-mail do pagador
  await ingestMpPayment(repo, mpPmt({ id: 9001, transaction_amount: 2500, external_reference: "l9", payer: { email: "" } }));
  let doc = await repo.get("mp_payments", "mpp_9001");
  assert.equal(doc.lead, "l9");
  assert.equal(doc.saas, "leverads");
  assert.equal(doc.customer, "");
  assert.equal(doc.matchedBy, "reference");

  // lead convertido (Ganho): pagamento novo com a mesma referência acompanha o cliente
  await repo.update("leads", "l9", { customerId: "c9" });
  await ingestMpPayment(repo, mpPmt({ id: 9002, transaction_amount: 1000, external_reference: "l9", payer: { email: "" } }));
  doc = await repo.get("mp_payments", "mpp_9002");
  assert.equal(doc.lead, "l9");
  assert.equal(doc.customer, "c9");

  await app.close();
});

test("lead: MP recusou o link → 424 e o lead fica intacto", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l1", saas: "leverads" });
  const { app } = buildApp(repo, {}); // sem fake → 404 do MP
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/mp/link", payload: { amount: 100 } });
  assert.equal(res.statusCode, 424);
  assert.ok(!(await repo.get("leads", "l1")).mpChargeUrl);
  await app.close();
});

test("runMpSync: CNPJ que a BrasilAPI não acha é carimbado e não re-consultado", async () => {
  const repo = makeMemRepo();
  const { mp } = buildApp(repo, { "GET /v1/payments/search": { paging: { total: 0 }, results: [] } });
  await repo.create("mp_payments", { id: "mpp_7001", mpId: "7001", status: "approved", amount: 50, payerName: "", payerDoc: "00000000000000", payerDetail: 2, dateCreated: "2026-08-06T12:11:00.000Z" });

  const calls = [];
  const cnpjFetch = async (url) => { calls.push(url); return { status: 404, json: async () => ({}) }; };
  await runMpSync(repo, mp, { cnpjFetch });
  const doc = await repo.get("mp_payments", "mpp_7001");
  assert.equal(doc.cnpjLookup, true);
  assert.equal(doc.payerName, "");

  await runMpSync(repo, mp, { cnpjFetch });
  assert.equal(calls.length, 1);
});

test("GET /api/mp/payments: filtro por saas mantém os não identificados visíveis", async () => {
  const repo = makeMemRepo();
  await seedCustomer(repo);
  await ingestMpPayment(repo, mpPmt({ id: 2001 }));                                     // casa (saas leverads)
  await ingestMpPayment(repo, mpPmt({ id: 2002, payer: { email: "quem@e.esse" } }));    // não identificado
  await repo.create("mp_payments", { id: "mpp_2003", mpId: "2003", saas: "uniquekids", status: "approved", amount: 10, dateCreated: "2026-07-01" });

  const { app } = buildApp(repo, {});
  const res = await app.inject({ method: "GET", url: "/api/mp/payments?saas=leverads" });
  const ids = res.json().payments.map((p) => p.id);
  assert.ok(ids.includes("mpp_2001"));
  assert.ok(ids.includes("mpp_2002")); // sem saas = aparece pra vincular
  assert.ok(!ids.includes("mpp_2003")); // de outro produto, não

  await app.close();
});
