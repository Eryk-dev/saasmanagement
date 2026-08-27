// O botão "link de pagamento" do card do lead não pode travar por causa do
// campo de e-mail do lead. `payer.email` só PRÉ-PREENCHE o checkout do Mercado
// Pago, mas o MP recusa a preferência inteira quando o e-mail não presta — e o
// lead vindo de form traz de tudo naquele campo ("não tenho", telefone, texto
// livre). O closer via "MP recusou a criação do link" no meio da venda.
//
// Régua: manda só o que PARECE e-mail; se o MP recusar mesmo assim, tenta de
// novo SEM o e-mail (link sem pré-preenchimento > venda travada). Falha que não
// é do e-mail continua falhando, com o motivo do MP no `detail`.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { payerEmailOrNone } from "../src/routes.mp.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");

// fetch fake do MP: `recusa` decide quando a preferência é rejeitada.
// Guarda os corpos recebidos pra conferir o que foi mandado.
function buildApp(repo, { recusa = () => null } = {}) {
  const enviados = [];
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/checkout/preferences" && (init.method || "GET") === "POST") {
      const body = JSON.parse(init.body || "{}");
      enviados.push(body);
      const motivo = recusa(body);
      if (motivo) return { status: 400, text: async () => JSON.stringify({ message: motivo }) };
      return { status: 200, text: async () => JSON.stringify({ id: "pref_1", init_point: "https://mp.com/pay/pref_1" }) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: `no fake for ${path}` }) };
  };
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({ fetch, accessToken: "test-token" }) });
  return { app, enviados };
}

async function comLead(email) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Padaria do Zé", phone: "11999999999", email });
  return repo;
}

test("e-mail que não é e-mail simplesmente não vai pro MP (o link sai)", async (t) => {
  const repo = await comLead("não tenho");
  const { app, enviados } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 1900 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().url, "https://mp.com/pay/pref_1");
  assert.equal(enviados.length, 1, "não precisou de segunda tentativa");
  assert.equal(enviados[0].payer, undefined, "e-mail inválido não pode viajar pro MP");
});

test("e-mail bom vai junto e pré-preenche o checkout", async (t) => {
  const repo = await comLead("ze@padaria.com.br");
  const { app, enviados } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 1900 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(enviados[0].payer, { email: "ze@padaria.com.br" });
});

test("MP recusando POR CAUSA do e-mail: tenta de novo sem ele e o link sai", async (t) => {
  const repo = await comLead("ze@padaria.com.br");
  // Recusa toda preferência que trouxer payer (é o comportamento do MP quando o
  // e-mail é o da própria conta vendedora, entre outros casos).
  const { app, enviados } = buildApp(repo, { recusa: (body) => (body.payer ? "invalid payer email" : null) });
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 1900 } });
  assert.equal(res.statusCode, 200, "o closer sai com link na mão, não com erro");
  assert.equal(enviados.length, 2);
  assert.equal(enviados[1].payer, undefined);

  // O recibo do histórico continua sendo gravado.
  const [rec] = await repo.list("payment_links");
  assert.equal(rec.lead, "le_1");
  assert.equal(rec.url, "https://mp.com/pay/pref_1");
});

test("recusa que não é do e-mail continua sendo erro, com o motivo do MP na resposta", async (t) => {
  const repo = await comLead("ze@padaria.com.br");
  const { app } = buildApp(repo, { recusa: () => "invalid transaction amount" });
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 1900 } });
  assert.notEqual(res.statusCode, 200);
  const body = res.json();
  assert.match(body.error, /MP recusou/);
  assert.match(String(body.detail), /invalid transaction amount/, "sem o motivo, ninguém sabe o que consertar");
});

test("cobrança de CLIENTE com e-mail ruim também sai (mesma régua)", async (t) => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Galante", email: "-" });
  const { app, enviados } = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/customers/cu_1/charge", payload: { amount: 500 } });
  assert.equal(res.statusCode, 200);
  assert.equal(enviados[0].payer, undefined);
});

test("payerEmailOrNone: aceita e-mail, recusa o resto", () => {
  assert.equal(payerEmailOrNone(" ZE@Padaria.com.BR "), "ze@padaria.com.br");
  for (const ruim of ["", null, undefined, "não tenho", "11999999999", "ze@padaria", "@padaria.com", "ze padaria@x.com"]) {
    assert.equal(payerEmailOrNone(ruim), undefined, `"${ruim}" não é e-mail`);
  }
});
