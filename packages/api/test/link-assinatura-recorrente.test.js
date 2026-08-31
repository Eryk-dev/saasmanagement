// Assinatura RECORRENTE gerada no card do lead (Leo, 27/08). Até aqui o botão
// "link de pagamento" do closer só sabia fazer checkout avulso: a venda no
// cartão recorrente saía com um link de uma vez na frente e, depois do Ganho,
// outro link de autorização na tela Assinaturas.
//
// Cobre: `mode: "recurring"` cria preapproval (não preferência), as travas do
// e-mail e da frequência, o webhook achando o LEAD pela external_reference
// (antes do Ganho não existe assinatura pra espelhar), a assinatura do
// fechamento adotando a recorrência já autorizada, e a recorrência que só é
// autorizada DEPOIS do Ganho encontrando a assinatura que nasceu.

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

test("mode recurring cria a ASSINATURA no MP (preapproval), não um checkout de uma vez", async (t) => {
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().recurring, true);
  assert.equal(res.json().url, "https://mp.com/pre_1");

  // O checkout avulso não pode ter sido chamado.
  assert.deepEqual(calls.map((c) => c.key), ["POST /preapproval"]);
  const body = calls[0].body;
  assert.deepEqual(body.auto_recurring, { frequency: 1, frequency_type: "months", transaction_amount: 378, currency_id: "BRL" });
  assert.equal(body.payer_email, "joao@sj.com.br");
  assert.equal(body.external_reference, "le_1", "é por ela que o webhook acha o lead");
  assert.equal(body.status, "pending");
  assert.equal(body.reason, "LeverAds · Assinatura mensal");

  // A recorrência fica carimbada no card (e vira a assinatura no Ganho).
  const lead = await repo.get("leads", "le_1");
  assert.equal(lead.mpPreapprovalId, "pre_1");
  assert.equal(lead.mpPreapprovalStatus, "pending");
  assert.equal(lead.mpPreapprovalMonths, 1);
  assert.equal(lead.mpChargeKind, "recurring");
  assert.equal(lead.mpChargeUrl, "https://mp.com/pre_1");
  // Sem forma combinada escolhida, recorrente É cartão recorrente.
  assert.equal(lead.paymentMethod, "cartao_recorrente");

  // Recibo no histórico da tela de links, marcado como recorrente.
  const [rec] = await repo.list("payment_links");
  assert.equal(rec.recurring, true);
  assert.equal(rec.frequencyMonths, 1);
  assert.equal(rec.url, "https://mp.com/pre_1");

  // E a timeline conta o que foi mandado.
  const nota = (await repo.list("activities")).find((a) => a.type === "note");
  assert.match(nota.text, /assinatura recorrente/i);
});

// O /preapproval do MP exige back_url https VÁLIDA (recusa http://localhost com
// "Invalid value for back_url" e a venda trava na cara do closer). Sem a env,
// a base tem que sair do host da request, igual às outras URLs públicas.
test("back_url sai do host da request quando falta COCKPIT_PUBLIC_URL", async (t) => {
  const env = process.env.COCKPIT_PUBLIC_URL;
  delete process.env.COCKPIT_PUBLIC_URL;
  t.after(() => { if (env !== undefined) process.env.COCKPIT_PUBLIC_URL = env; });
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  await app.inject({
    method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente(),
    headers: { "x-forwarded-host": "cockpit.leverads.com.br" },
  });
  const body = calls.find((c) => c.key === "POST /preapproval").body;
  assert.equal(body.back_url, "https://cockpit.leverads.com.br");
  assert.equal(body.notification_url, "https://cockpit.leverads.com.br/public/mp/webhook");
});

test("COCKPIT_PUBLIC_URL sem esquema ganha https:// no back_url", async (t) => {
  const env = process.env.COCKPIT_PUBLIC_URL;
  process.env.COCKPIT_PUBLIC_URL = "manager.leverads.com.br";
  t.after(() => { if (env !== undefined) process.env.COCKPIT_PUBLIC_URL = env; else delete process.env.COCKPIT_PUBLIC_URL; });
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  const body = calls.find((c) => c.key === "POST /preapproval").body;
  assert.equal(body.back_url, "https://manager.leverads.com.br");
});

test("forma combinada escolhida pelo closer manda mais que o default do recorrente", async (t) => {
  const repo = await comLead();
  const { app } = buildApp(repo);
  t.after(() => app.close());

  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente({ paymentMethod: "boleto" }) });
  assert.equal((await repo.get("leads", "le_1")).paymentMethod, "boleto");
});

test("recorrente sem e-mail que preste é recusado ANTES de chamar o MP", async (t) => {
  const repo = await comLead({ email: "não tenho" });
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /e-mail/i);
  assert.equal(calls.length, 0, "não adianta tentar: o preapproval EXIGE o pagador");

  // A mesma cobrança como avulsa continua saindo (é o fallback do checkout).
  const avulso = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 378 } });
  assert.equal(avulso.statusCode, 200);
  assert.equal(avulso.json().url, "https://mp.com/pay/pref_1");
});

test("frequência que o MP não cobra (2 meses) é recusada com motivo", async (t) => {
  const repo = await comLead();
  const { app, calls } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente({ frequencyMonths: 2 }) });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
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
  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: recorrente() });

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
