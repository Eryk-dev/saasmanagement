// Espelho das assinaturas RECORRENTES do Mercado Pago (mp_preapprovals) e o
// vínculo delas com os clientes do cockpit. Cobre: normalização (ciclo a partir
// do auto_recurring, pagador mascarado), sync paginado, casamento só por FATO
// (external_reference / mpPreapprovalId já carimbado) com SUGESTÃO por e-mail,
// vínculo manual pela rota (e as guardas contra vínculo duplicado), e a cobrança
// recorrente casando com a assinatura certa depois do vínculo.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { normalizePreapproval, runPreapprovalSync, cycleOfAutoRecurring } = await import("../src/mp-subscriptions.js");
const { ingestMpPayment } = await import("../src/mp-payments.js");
const { NOT_CONFIGURED } = await import("../src/http-status.js");

function makeFakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    calls.push({ key, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined });
    const hit = routes[key];
    if (!hit) return { status: 404, text: async () => JSON.stringify({ error: `no fake for ${key}` }) };
    const body = typeof hit === "function" ? hit(calls[calls.length - 1]) : hit;
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
}

const preapproval = (over = {}) => ({
  id: "pre_1",
  status: "authorized",
  reason: "LeverAds: Assinatura recorrente",
  payer_email: "cliente@x.com",
  payer_id: 998,
  external_reference: "",
  init_point: "https://mp.com/pre_1",
  date_created: "2026-06-01T10:00:00.000Z",
  next_payment_date: "2026-09-01T10:00:00.000Z",
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 599, currency_id: "BRL" },
  summarized: { charged_quantity: 3, charged_amount: 1797, last_charged_date: "2026-08-01T10:00:00.000Z", last_charged_amount: 599 },
  ...over,
});

async function seed(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "c1", name: "Dyno Nutri", saas: "leverads", email: "cliente@x.com", arr: 0 });
  await repo.create("subscriptions", {
    id: "s1", customer: "c1", saas: "leverads", status: "active", cycle: "monthly", price: 599,
    periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z",
  });
}

function buildApp(repo, routes = {}) {
  const fetch = makeFakeFetch(routes);
  const mp = makeMp({ fetch, accessToken: "test-token" });
  const app = Fastify();
  registerRoutes(app, repo, { mp });
  return { app, mp, fetch };
}

test("normalizePreapproval: ciclo do auto_recurring, pagador mascarado vira vazio", () => {
  const doc = normalizePreapproval(preapproval());
  assert.equal(doc.mpId, "pre_1");
  assert.equal(doc.cycle, "monthly");
  assert.equal(doc.amount, 599);
  assert.equal(doc.payerEmail, "cliente@x.com");
  assert.equal(doc.chargedQuantity, 3);

  // O search do MP às vezes devolve o pagador mascarado — máscara não é dado.
  assert.equal(normalizePreapproval(preapproval({ payer_email: "xxxxxxxx@xxxx.xxx" })).payerEmail, "");

  assert.equal(cycleOfAutoRecurring({ frequency: 6, frequency_type: "months" }), "semiannual");
  assert.equal(cycleOfAutoRecurring({ frequency: 30, frequency_type: "days" }), "monthly");
  assert.equal(cycleOfAutoRecurring({ frequency: 2, frequency_type: "months" }), ""); // fora dos ciclos do cockpit
});

test("sync: recorrência sem referência entra SEM vínculo, só com sugestão pelo e-mail", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const { mp } = buildApp(repo, { "GET /preapproval/search": { results: [preapproval()], paging: { total: 1 } } });

  const r = await runPreapprovalSync(repo, mp);
  assert.deepEqual({ ok: r.ok, seen: r.seen, linked: r.linked }, { ok: true, seen: 1, linked: 0 });

  const [doc] = await repo.list("mp_preapprovals");
  assert.equal(doc.subscription, "");                 // vínculo é humano
  assert.equal(doc.suggestedCustomer, "c1");
  assert.equal(doc.suggestedSubscription, "s1");
  assert.equal(doc.suggestedBy, "email");
  // Sugerir NÃO carimba nada na assinatura (senão cancelar no cockpit cancelaria
  // uma recorrência que talvez nem seja desse cliente).
  assert.equal((await repo.get("subscriptions", "s1")).mpPreapprovalId, undefined);
});

test("sync: external_reference apontando pra assinatura do cockpit vincula sozinho e espelha o status", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  let status = "authorized";
  const { mp } = buildApp(repo, {
    "GET /preapproval/search": () => ({ results: [preapproval({ external_reference: "s1", status })], paging: { total: 1 } }),
  });

  await runPreapprovalSync(repo, mp);
  let sub = await repo.get("subscriptions", "s1");
  assert.equal(sub.mpPreapprovalId, "pre_1");
  assert.equal(sub.mpStatus, "authorized");
  assert.equal(sub.payerEmail, "cliente@x.com");

  // Recorrência cancelada no painel do MP: o poller espelha o status como o
  // webhook faria (rede de segurança quando o webhook não está configurado) —
  // a assinatura cancela com canceledAt e o CLIENTE churna sozinho (endedAt +
  // motivo mp_cancel), com o arr congelado.
  status = "cancelled";
  await runPreapprovalSync(repo, mp);
  sub = await repo.get("subscriptions", "s1");
  assert.equal(sub.mpStatus, "cancelled");
  assert.equal(sub.status, "canceled");
  assert.ok(sub.canceledAt);
  const churned = await repo.get("customers", "c1");
  assert.ok(churned.endedAt);
  assert.equal(churned.churnReason, "mp_cancel");
  assert.equal(churned.churnSource, "mp");
  const [doc] = await repo.list("mp_preapprovals");
  assert.equal(doc.subscription, "s1");
  assert.equal(doc.customer, "c1");

  // Reativada no painel → volta a active e o churn que o MP marcou desfaz.
  status = "authorized";
  await runPreapprovalSync(repo, mp);
  sub = await repo.get("subscriptions", "s1");
  assert.equal(sub.status, "active");
  assert.equal((await repo.get("customers", "c1")).endedAt, "");
});

test("GET /api/mp/preapprovals + vínculo manual carimba a assinatura; body vazio desvincula", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const { app, mp } = buildApp(repo, { "GET /preapproval/search": { results: [preapproval()], paging: { total: 1 } } });
  await runPreapprovalSync(repo, mp);

  const list = await app.inject({ method: "GET", url: "/api/mp/preapprovals?saas=leverads" });
  assert.equal(list.statusCode, 200);
  const [row] = list.json().preapprovals;
  assert.equal(row.mpId, "pre_1");

  const ok = await app.inject({ method: "POST", url: `/api/mp/preapprovals/${row.id}/link`, payload: { subscription: "s1" } });
  assert.equal(ok.statusCode, 200);
  let sub = await repo.get("subscriptions", "s1");
  assert.equal(sub.mpPreapprovalId, "pre_1");
  assert.equal(sub.mpStatus, "authorized");
  assert.equal((await repo.get("mp_preapprovals", row.id)).matchedBy, "manual");

  const off = await app.inject({ method: "POST", url: `/api/mp/preapprovals/${row.id}/link`, payload: {} });
  assert.equal(off.statusCode, 200);
  sub = await repo.get("subscriptions", "s1");
  assert.equal(sub.mpPreapprovalId, "");
  assert.equal((await repo.get("mp_preapprovals", row.id)).subscription, "");

  await app.close();
});

test("vínculo por cliente resolve a assinatura única; duas assinaturas → 400; assinatura já ocupada → 400", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const { app, mp } = buildApp(repo, {
    "GET /preapproval/search": { results: [preapproval(), preapproval({ id: "pre_2", payer_email: "outro@x.com" })], paging: { total: 2 } },
  });
  await runPreapprovalSync(repo, mp);

  const byCustomer = await app.inject({ method: "POST", url: "/api/mp/preapprovals/mps_pre_1/link", payload: { customer: "c1" } });
  assert.equal(byCustomer.statusCode, 200);
  assert.equal((await repo.get("subscriptions", "s1")).mpPreapprovalId, "pre_1");

  // Outra recorrência não pode ocupar a MESMA assinatura.
  const taken = await app.inject({ method: "POST", url: "/api/mp/preapprovals/mps_pre_2/link", payload: { subscription: "s1" } });
  assert.equal(taken.statusCode, 400);

  // Cliente com duas assinaturas candidatas: a tela precisa escolher qual.
  await repo.create("customers", { id: "c2", name: "Dois Planos", saas: "leverads", email: "dois@x.com", arr: 0 });
  await repo.create("subscriptions", { id: "s2", customer: "c2", saas: "leverads", status: "active", cycle: "monthly", price: 100 });
  await repo.create("subscriptions", { id: "s3", customer: "c2", saas: "leverads", status: "active", cycle: "annual", price: 1000 });
  const ambiguous = await app.inject({ method: "POST", url: "/api/mp/preapprovals/mps_pre_2/link", payload: { customer: "c2" } });
  assert.equal(ambiguous.statusCode, 400);
  assert.match(ambiguous.json().error, /mais de uma assinatura/);

  // Cliente sem assinatura nenhuma: nada pra carimbar.
  await repo.create("customers", { id: "c3", name: "Sem plano", saas: "leverads", email: "sem@x.com", arr: 0 });
  const noSub = await app.inject({ method: "POST", url: "/api/mp/preapprovals/mps_pre_2/link", payload: { customer: "c3" } });
  assert.equal(noSub.statusCode, 400);

  await app.close();
});

test("cobrança recorrente (sem external_reference) casa com a assinatura pela recorrência vinculada", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const { app, mp } = buildApp(repo, { "GET /preapproval/search": { results: [preapproval()], paging: { total: 1 } } });
  await runPreapprovalSync(repo, mp);
  await app.inject({ method: "POST", url: "/api/mp/preapprovals/mps_pre_1/link", payload: { subscription: "s1" } });

  // Fatura do ciclo em aberto — o MP não manda external_reference na cobrança
  // recorrente, então o único caminho é a recorrência vinculada.
  const inv = await repo.create("invoices", {
    subscription: "s1", customer: "c1", saas: "leverads", amount: 599,
    kind: "renewal", status: "open", dueDate: "2026-09-01T00:00:00.000Z",
  });

  const r = await ingestMpPayment(repo, {
    id: 987654, status: "approved", transaction_amount: 599,
    payer: { email: "cliente@x.com", first_name: "Marcos", last_name: "Valeriano" },
    description: "LeverAds: Assinatura recorrente",
    payment_method_id: "visa", payment_type_id: "credit_card", installments: 1,
    date_created: "2026-09-01T10:00:00.000Z", date_approved: "2026-09-01T10:00:01.000Z",
  });

  assert.equal(r.matched, true);
  assert.equal(r.payment.subscription, "s1");
  assert.equal(r.payment.customer, "c1");
  assert.equal(r.payment.matchedBy, "preapproval");
  assert.equal(r.settledNow, inv.id); // a fatura do ciclo recebeu a baixa
  assert.equal((await repo.get("invoices", inv.id)).status, "paid");

  await app.close();
});

test("sync sem MP configurado → not_configured; rota responde NOT_CONFIGURED", async () => {
  const repo = makeMemRepo();
  const mp = makeMp({});
  assert.deepEqual(await runPreapprovalSync(repo, mp), { ok: false, error: "not_configured" });

  const app = Fastify();
  registerRoutes(app, repo, { mp });
  // 424, não 5xx: o proxy do EasyPanel engole 5xx e a tela perderia o motivo.
  const res = await app.inject({ method: "POST", url: "/api/mp/preapprovals/sync", payload: {} });
  assert.equal(res.statusCode, NOT_CONFIGURED);
  await app.close();
});
