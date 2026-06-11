// Avisos Discord (webhook único, fail-open) — cobre: lead novo por form e por
// CRUD, proposta vista (só 1ª view, ?k não conta) e aceita (só 1º aceite),
// baixa de fatura via webhook MP, dunning no tick do billing, não-configurado
// vira no-op e fetch quebrado nunca derruba a rota.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeDiscord } = await import("../src/discord.js");
const { makeMp } = await import("../src/mp.js");

const HOOK = "https://discord.test/api/webhooks/1/abc";

function fakeDiscordFetch() {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    return { status: 204, text: async () => "" };
  };
  f.calls = calls;
  return f;
}
const embed = (call) => call.body.embeds[0];
const field = (e, name) => e.fields.find((x) => x.name === name)?.value;

function buildApp(repo, extraOpts = {}) {
  const fetch = fakeDiscordFetch();
  const app = Fastify();
  registerRoutes(app, repo, { discord: makeDiscord({ fetch, webhookUrl: HOOK }), ...extraOpts });
  return { app, fetch };
}

const FORM = {
  id: "fo_t", name: "Diagnóstico", saas: "leverads", status: "published",
  questions: [{ key: "nome", label: "Nome?", type: "text", required: true }],
  mapping: { name: "nome" }, thanks: {},
};

test("submission de form → embed de lead novo com nome, SaaS e origem", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("forms", { ...FORM });
  const { app, fetch } = buildApp(repo);

  const res = await app.inject({ method: "POST", url: "/public/forms/fo_t/submissions", payload: { answers: { nome: "Ana" } } });
  assert.equal(res.statusCode, 201);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, HOOK);
  const e = embed(fetch.calls[0]);
  assert.match(e.title, /Lead novo: Ana/);
  assert.equal(field(e, "SaaS"), "LeverAds");
  assert.match(field(e, "Origem"), /Diagnóstico/);
  await app.close();
});

test("lead manual via POST /api/leads → embed de lead novo", async () => {
  const repo = makeMemRepo();
  const { app, fetch } = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Bia", company: "Acme", saas: "x" } });
  assert.equal(res.statusCode, 201);
  assert.equal(fetch.calls.length, 1);
  const e = embed(fetch.calls[0]);
  assert.match(e.title, /Lead novo: Bia/);
  assert.equal(field(e, "Empresa"), "Acme");
  await app.close();
});

test("proposta: 1ª view avisa, re-view não, ?k não, aceite avisa 1x", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { name: "Ana", company: "Acme", saas: "leverads", proposalUrl: "http://x/p/pp1" });
  await repo.create("proposals", {
    id: "pp1", saas: "leverads", lead: lead.id, name: "Proposta", theme: {}, slides: [],
    calc: {}, data: { lead: { name: "Ana" }, answers: {} }, state: {},
    editKey: "k1", views: 0, accepted: false,
  });
  const { app, fetch } = buildApp(repo);

  assert.equal((await app.inject({ method: "GET", url: "/p/pp1" })).statusCode, 200);
  assert.equal(fetch.calls.length, 1);
  assert.match(embed(fetch.calls[0]).title, /visualizada: Ana/);

  // re-view e link do closer não geram aviso novo
  await app.inject({ method: "GET", url: "/p/pp1" });
  await app.inject({ method: "GET", url: "/p/pp1?k=k1" });
  assert.equal(fetch.calls.length, 1);

  // aceite avisa; segundo aceite é no-op
  assert.equal((await app.inject({ method: "POST", url: "/public/proposals/pp1/accept" })).statusCode, 200);
  assert.equal(fetch.calls.length, 2);
  assert.match(embed(fetch.calls[1]).title, /ACEITA: Ana/);
  await app.inject({ method: "POST", url: "/public/proposals/pp1/accept" });
  assert.equal(fetch.calls.length, 2);
  await app.close();
});

test("webhook MP: preapproval authorized → embed assinatura; pagamento → embed fatura paga", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "p1", name: "P1" });
  await repo.create("customers", { id: "c1", name: "Cliente Real", saas: "p1", email: "payer@x.com", arr: 0 });
  // mp fake SEM webhookSecret → webhook pula verificação de assinatura
  const mpFake = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const key = `${init.method || "GET"} ${path}`;
    const routes = {
      "POST /preapproval": { id: "pre_1", status: "pending", init_point: "x", payer_email: "payer@x.com" },
      "GET /preapproval/pre_1": { id: "pre_1", status: "authorized", external_reference: subId, payer_email: "payer@x.com" },
      "GET /authorized_payments/ap_1": { id: "ap_1", status: "processed", preapproval_id: "pre_1", transaction_amount: 449, payment: { id: "pay_77" } },
    };
    return { status: 200, text: async () => JSON.stringify(routes[key] || {}) };
  };
  const { app, fetch } = buildApp(repo, { mp: makeMp({ fetch: mpFake, accessToken: "t" }) });

  const sub = (await app.inject({ method: "POST", url: "/api/subscriptions", payload: { customer: "c1", saas: "p1", price: 449, cycle: "monthly" } })).json();
  const subId = sub.id;
  await app.inject({ method: "POST", url: `/api/subscriptions/${sub.id}/mp/link`, payload: {} });
  assert.equal(fetch.calls.length, 0); // nada disso é evento de aviso

  await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_preapproval", data: { id: "pre_1" } } });
  assert.equal(fetch.calls.length, 1);
  assert.match(embed(fetch.calls[0]).title, /Assinatura ativada: Cliente Real/);

  await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_authorized_payment", data: { id: "ap_1" } } });
  assert.equal(fetch.calls.length, 2);
  assert.match(embed(fetch.calls[1]).title, /Fatura paga: Cliente Real/);
  assert.equal(field(embed(fetch.calls[1]), "Via"), "Mercado Pago");

  // redelivery (duplicado) não re-avisa
  await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_authorized_payment", data: { id: "ap_1" } } });
  assert.equal(fetch.calls.length, 2);
  await app.close();
});

test("billing/run com fatura vencida nova → alerta de dunning; segundo tick não repete", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Devedor", saas: "p1" });
  await repo.create("invoices", {
    id: "inv1", customer: "c1", saas: "p1", amount: 300, kind: "renewal",
    status: "open", dueDate: "2026-01-01T00:00:00.000Z",
  });
  const { app, fetch } = buildApp(repo);

  const r1 = (await app.inject({ method: "POST", url: "/api/billing/run", payload: {} })).json();
  assert.equal(r1.overdue, 1);
  assert.equal(fetch.calls.length, 1);
  const e = embed(fetch.calls[0]);
  assert.match(e.title, /1 fatura\(s\) vencida\(s\)/);
  assert.match(e.description, /Devedor — R\$ 300/);

  // estoque continua vencido mas não há transição nova → sem alerta novo
  await app.inject({ method: "POST", url: "/api/billing/run", payload: {} });
  assert.equal(fetch.calls.length, 1);
  await app.close();
});

test("sem webhook configurado → no-op; fetch quebrado → rota segue 201 (fail-open)", async () => {
  const repo = makeMemRepo();
  const idle = fakeDiscordFetch();
  const app1 = Fastify();
  registerRoutes(app1, repo, { discord: makeDiscord({ fetch: idle, webhookUrl: "" }) });
  assert.equal((await app1.inject({ method: "POST", url: "/api/leads", payload: { name: "X" } })).statusCode, 201);
  assert.equal(idle.calls.length, 0);
  await app1.close();

  const app2 = Fastify();
  registerRoutes(app2, repo, { discord: makeDiscord({ fetch: async () => { throw new Error("down"); }, webhookUrl: HOOK }) });
  assert.equal((await app2.inject({ method: "POST", url: "/api/leads", payload: { name: "Y" } })).statusCode, 201);
  await app2.close();
});
