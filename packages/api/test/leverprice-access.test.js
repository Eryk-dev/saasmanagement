// Liberação do LeverPrice pelo status pago (03/11/2026): a régua, o tick (dry-run
// e apply), o carimbo que tira o cliente da lista, a liberação na hora do
// vínculo pelo link de cadastro e a rota de status.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { leverpriceReleaseOf, makeLeverpriceClient, releaseLeverpriceFor, runLeverpriceAccess } from "../src/billing/leverprice-access.js";
import { registerLeverpriceAccessRoutes } from "../src/billing/routes.leverprice-access.js";
import { handleLeverpriceOrgCreated } from "../src/customers/leverprice-orgs.js";

const ORG = "e0000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-11-03T12:00:00Z");
const cliente = (extra = {}) => ({ id: "cu_1", saas: "leverads", name: "Loja", planCode: "price_escala", products: ["leverprice"], leverpriceOrgId: ORG, ...extra });
const ativa = { status: "active" };
const paga = { status: "paid", paidAt: "2026-11-01" };

test("régua: só libera com LeverPrice vendido, assinatura ativa e pagamento em dia", () => {
  const ok = leverpriceReleaseOf(cliente(), { subs: [ativa], invoices: [paga], now: NOW });
  assert.deepEqual([ok.release, ok.reason], [true, "pagamento em dia"]);
  const casos = [
    [cliente({ leverpriceOrgId: "" }), [ativa], [paga], "sem conta do LeverPrice vinculada"],
    [cliente({ endedAt: "2026-10-01" }), [ativa], [paga], "cliente encerrado"],
    [cliente({ products: ["leverads"], planCode: "ads_escala" }), [ativa], [paga], "a venda não inclui o LeverPrice"],
    [cliente(), [], [paga], "sem assinatura ativa"],
    [cliente(), [ativa], [{ status: "open" }], "aguardando o 1º pagamento"],
    [cliente(), [{ status: "past_due" }], [paga, { status: "overdue" }], "fatura vencida (past_due)"],
    [cliente(), [ativa], [paga, { status: "overdue" }], "fatura vencida"],
  ];
  for (const [c, subs, invoices, reason] of casos) {
    const d = leverpriceReleaseOf(c, { subs, invoices, now: NOW });
    assert.deepEqual([d.release, d.reason], [false, reason], reason);
  }
});

function fakeClient() {
  const calls = [];
  return { calls, configured: () => true, release: async (org, body) => { calls.push({ org, body }); return { org_id: org, changed: true }; } };
}

async function cenario({ invoice = paga } = {}) {
  const repo = makeMemRepo();
  await repo.create("customers", cliente());
  await repo.create("subscriptions", { id: "su_1", customer: "cu_1", status: "active", planCode: "price_escala" });
  await repo.create("invoices", { id: "in_1", customer: "cu_1", ...invoice });
  return repo;
}

test("tick: dry-run só relata; apply libera uma vez e carimba o cliente", async () => {
  const repo = await cenario();
  const client = fakeClient();
  const dry = await runLeverpriceAccess(repo, { client, apply: false });
  assert.deepEqual([dry.mode, dry.planned.length, client.calls.length], ["dry-run", 1, 0]);
  const r = await runLeverpriceAccess(repo, { client, apply: true });
  assert.equal(r.released.length, 1);
  assert.equal(client.calls[0].org, ORG);
  assert.equal(client.calls[0].body.cliente, "cu_1");
  assert.ok((await repo.get("customers", "cu_1")).leverpriceAccess.releasedAt);
  const again = await runLeverpriceAccess(repo, { client, apply: true });
  assert.deepEqual([again.checked, client.calls.length], [0, 1], "carimbado não volta para a lista");
});

test("tick: quem ainda não pagou fica esperando, com o motivo", async () => {
  const repo = await cenario({ invoice: { status: "open" } });
  const client = fakeClient();
  const r = await runLeverpriceAccess(repo, { client, apply: true });
  assert.deepEqual(r.waiting.map((w) => w.reason), ["aguardando o 1º pagamento"]);
  assert.equal(client.calls.length, 0);
});

test("erro do produto não carimba (tenta de novo no próximo tick)", async () => {
  const repo = await cenario();
  const client = { configured: () => true, release: async () => { throw new Error("PUT → HTTP 503"); } };
  const r = await runLeverpriceAccess(repo, { client, apply: true });
  assert.equal(r.errors.length, 1);
  assert.equal((await repo.get("customers", "cu_1")).leverpriceAccess, undefined);
});

test("vínculo pelo link de cadastro de venda já paga libera na hora", async () => {
  const repo = makeMemRepo();
  const TOKEN = "cvt_abcdefghijklmnop";
  await repo.create("customers", cliente({ leverpriceOrgId: "", signupInvite: { token: TOKEN }, email: "dono@loja.test" }));
  await repo.create("subscriptions", { id: "su_1", customer: "cu_1", status: "active", planCode: "price_escala" });
  await repo.create("invoices", { id: "in_1", customer: "cu_1", ...paga });
  const client = fakeClient();
  const r = await handleLeverpriceOrgCreated(repo, { orgId: ORG, invite: TOKEN, email: "x@y.test", release: { client, apply: true } });
  assert.deepEqual([r.linked, r.released], [true, true]);
  assert.equal(client.calls[0].org, ORG);
  // Sem chave configurada: vincula e não tenta liberar.
  assert.deepEqual(await releaseLeverpriceFor(repo, "cu_1", { client: { configured: () => false } }), { mode: "not-configured" });
});

test("cliente HTTP: PUT na rota de serviço com a chave; rota de status e o 403 do apply sem admin", async () => {
  const seen = [];
  const client = makeLeverpriceClient({ baseUrl: "https://lp.test/", serviceKey: "k", fetchImpl: async (url, opts) => {
    seen.push({ url, opts });
    return { ok: true, json: async () => ({ changed: true }) };
  } });
  await client.release(ORG, { cliente: "cu_1" });
  assert.equal(seen[0].url, `https://lp.test/api/service/cockpit/orgs/${ORG}/leverprice-access`);
  assert.equal(seen[0].opts.method, "PUT");
  assert.equal(seen[0].opts.headers["X-Cockpit-Service-Key"], "k");
  assert.equal(JSON.parse(seen[0].opts.body).liberar, true);

  const repo = await cenario();
  const app = Fastify();
  app.addHook("preHandler", async (req) => { req.authUser = { id: "leo", roles: ["closer"] }; });
  registerLeverpriceAccessRoutes(app, repo, { client: fakeClient() });
  assert.deepEqual((await app.inject({ url: "/api/leverprice-access/status" })).json(), { mode: "never-ran" });
  assert.equal((await app.inject({ method: "POST", url: "/api/leverprice-access/run", payload: { apply: true } })).statusCode, 403);
  const dry = (await app.inject({ method: "POST", url: "/api/leverprice-access/run", payload: {} })).json();
  assert.equal(dry.planned.length, 1);
  assert.equal((await app.inject({ url: "/api/leverprice-access/status" })).json().planned.length, 1);
});
