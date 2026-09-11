// Assinatura RECORRENTE gerada no card do lead (Leo, 27/08). Até aqui o botão
// "link de pagamento" do closer só sabia fazer checkout avulso: a venda no
// cartão recorrente saía com um link de uma vez na frente e, depois do Ganho,
// outro link de autorização na tela Assinaturas.
//
// Em 10/09/2026 a recorrência saiu de linha: `mode: "recurring"` passou a ser
// recusado. O que fica coberto aqui é o LEGADO que precisa continuar vivo: o
// webhook achando o LEAD pela external_reference (autorização pendente de
// antes), a assinatura do fechamento adotando a recorrência já autorizada, a
// recorrência autorizada DEPOIS do Ganho encontrando a assinatura, e o
// checkout avulso de sempre.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 0.5 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
];

// fetch fake do MP: `pre` é o retrato devolvido pelo GET /preapproval (o webhook
// SEMPRE re-busca o recurso). Guarda as chamadas pra conferir o que foi mandado.
function buildApp(repo, { pre = () => ({ id: "pre_1", status: "authorized", payer_email: "joao@sj.com.br", external_reference: "le_1", init_point: "https://mp.com/pre_1", auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 378, currency_id: "BRL" } }) } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
    if (key === "POST /preapproval") {
      return { status: 200, text: async () => JSON.stringify({ id: "pre_1", status: "pending", init_point: "https://mp.com/pre_1" }) };
    }
    if (key === "GET /preapproval/pre_1") {
      return { status: 200, text: async () => JSON.stringify(pre()) };
    }
    if (key === "POST /checkout/preferences") {
      return { status: 200, text: async () => JSON.stringify({ id: "pref_1", init_point: "https://mp.com/pay/pref_1" }) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: `no fake for ${key}` }) };
  };
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({ fetch, accessToken: "test-token" }) });
  return { app, calls };
}

async function comLead(over = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("leads", {
    id: "le_1", saas: "leverads", stage: "Follow-up", name: "João", company: "São João Baterias",
    phone: "41999999999", email: "joao@sj.com.br", ...over,
  });
  return repo;
}

const recorrente = (over = {}) => ({ amount: 378, mode: "recurring", frequencyMonths: 1, title: "LeverAds · Assinatura mensal", ...over });

// 10/09/2026: a casa parou de vender recorrência. O modo recorrente é recusado
// ANTES de falar com o MP; o que já existe (preapproval de lead antigo, webhook,
// adoção no Ganho) continua funcionando, e é o que os testes abaixo cobrem.
test("mode recurring é recusado com 400 e o MP nem é chamado", async (t) => {
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /não vende mais assinatura recorrente/);
  assert.deepEqual(calls, [], "nenhuma chamada ao MP");
  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.mpPreapprovalId, undefined);
  assert.equal(lead.mpChargeUrl, undefined);
  assert.equal((await repo.list("payment_links")).length, 0, "sem recibo");
});

test("webhook do preapproval acha o LEAD pela external_reference e conta na timeline", async (t) => {
  const repo = await comLead();
  const { app } = buildApp(repo);
  t.after(() => app.close());
  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });

  const payload = { type: "subscription_preapproval", data: { id: "pre_1" } };
  const res = await app.inject({ method: "POST", url: "/public/mp/webhook", payload });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().lead, "le_1");

  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.mpPreapprovalStatus, "authorized");
  const nota = (await repo.list("activities")).find((a) => a.meta?.event === "mp_preapproval");
  assert.match(nota.text, /AUTORIZADA/);

  // Redelivery não repete a nota (só a TRANSIÇÃO vira aviso).
  await app.inject({ method: "POST", url: "/public/mp/webhook", payload });
  assert.equal((await repo.list("activities")).filter((a) => a.meta?.event === "mp_preapproval").length, 1);
});

test("pagador diferente do combinado é DERRUBADO (não carimba o lead)", async (t) => {
  const repo = await comLead();
  const { app } = buildApp(repo, { pre: () => ({ id: "pre_1", status: "authorized", payer_email: "outro@golpe.com", external_reference: "le_1" }) });
  t.after(() => app.close());
  // Autorização pendente de ANTES de 10/09 (o link recorrente não nasce mais).
  await repo.update("leads", "le_1", { mpPreapprovalId: "pre_1", mpPreapprovalStatus: "pending", mpPayerEmail: "joao@sj.com.br", mpChargeKind: "recurring" });

  const res = await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_preapproval", data: { id: "pre_1" } } });
  assert.equal(res.json().ignored, "payer mismatch");
  assert.equal((await repo.get("leads", "le_1")).mpPreapprovalStatus, "pending");
});

test("no Ganho, a assinatura que nasce do fechamento ADOTA a recorrência autorizada", async (t) => {
  const repo = await comLead({ planClosed: "mensal", amount: 378 });
  const { app } = buildApp(repo);
  t.after(() => app.close());

  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_preapproval", data: { id: "pre_1" } } });
  await app.inject({ method: "PATCH", url: "/api/leads/le_1", payload: { stage: "Ganho" } });

  const customer = (await repo.list("customers"))[0];
  assert.ok(customer, "o Ganho cria o cliente");
  const [sub] = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
  assert.equal(sub.mpPreapprovalId, "pre_1", "a cobrança do ciclo passa a dar baixa na fatura");
  assert.equal(sub.mpStatus, "authorized");
  assert.equal(sub.payerEmail, "joao@sj.com.br");
});

test("recorrência autorizada DEPOIS do Ganho encontra a assinatura que nasceu", async (t) => {
  const repo = await comLead({ planClosed: "mensal", amount: 378 });
  let status = "pending";
  const { app } = buildApp(repo, {
    pre: () => ({ id: "pre_1", status, payer_email: "joao@sj.com.br", external_reference: "le_1", init_point: "https://mp.com/pre_1", auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 378, currency_id: "BRL" } }),
  });
  t.after(() => app.close());

  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  await app.inject({ method: "PATCH", url: "/api/leads/le_1", payload: { stage: "Ganho" } });

  const customer = (await repo.list("customers"))[0];
  let [sub] = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
  assert.equal(sub.mpPreapprovalId || "", "", "recorrência pendente não é dinheiro: não carimba");

  // O cliente autoriza no link.
  status = "authorized";
  const res = await app.inject({ method: "POST", url: "/public/mp/webhook", payload: { type: "subscription_preapproval", data: { id: "pre_1" } } });
  assert.equal(res.json().subscription, sub.id);

  sub = await repo.get("subscriptions", sub.id);
  assert.equal(sub.mpPreapprovalId, "pre_1");
  assert.equal(sub.mpStatus, "authorized");
  assert.equal(sub.status, "active");
});

test("cobrança única segue sendo checkout preference (nada mudou pro caminho de sempre)", async (t) => {
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 3288, maxInstallments: 12 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().recurring, false);
  assert.deepEqual(calls.map((c) => c.key), ["POST /checkout/preferences"]);
  assert.equal(calls[0].body.payment_methods.installments, 12);

  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.mpChargeKind, "once");
  assert.equal(lead.mpPreapprovalId, undefined);
  assert.equal((await repo.list("payment_links"))[0].recurring, false);
});
