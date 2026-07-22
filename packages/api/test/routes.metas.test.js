// Metas — GET traz o catálogo por vaga com as metas atuais + time; PUT faz
// upsert/delete na collection goals (positivo salva, vazio apaga), por vaga e
// por pessoa, ignorando métrica/role inválida.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerMetasRoutes } = await import("../src/routes.metas.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["closer"] });
  await repo.create("users", { id: "jon", name: "Jon", roles: ["sdr", "closer"] });
  await repo.create("users", { id: "ana", name: "Ana", roles: [] }); // sem papel de meta → fora
  const app = Fastify();
  registerMetasRoutes(app, repo);
  return { app, repo };
}

test("GET: catálogo por vaga + metas atuais + time com papel de meta", async () => {
  const { app, repo } = await buildApp();
  await repo.create("goals", { id: "g_book", saas: "leverads", scope: "role", key: "sdr", metric: "bookingRate", target: 35, period: "month" });
  await repo.create("goals", { id: "g_won", saas: "leverads", scope: "user", key: "leo", metric: "won", target: 8, period: "month" });

  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.deepEqual(r.roles.map((x) => x.role), ["sdr", "closer", "integrator", "social"]);
  const sdr = r.roles.find((x) => x.role === "sdr");
  assert.equal(sdr.metrics.find((m) => m.metric === "bookingRate").target, 35); // configurada
  assert.equal(sdr.metrics.find((m) => m.metric === "contactRate").target, null); // sem meta → null
  assert.equal(sdr.metrics.find((m) => m.metric === "contactRate").default, 80);  // benchmark
  // time só com papel de meta (ana fica de fora)
  assert.deepEqual(r.users.map((u) => u.id).sort(), ["jon", "leo"]);
  // overrides por pessoa
  assert.deepEqual(r.userGoals, [{ key: "leo", metric: "won", target: 8 }]);
});

test("PUT: positivo faz upsert, vazio apaga; ignora métrica/role inválida", async () => {
  const { app, repo } = await buildApp();
  // meta pré-existente que será apagada ao mandar vazio
  const g = await repo.create("goals", { id: "g_closer_won", saas: "leverads", scope: "role", key: "closer", metric: "won", target: 5, period: "month" });

  const put = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [
    { scope: "role", key: "sdr", metric: "bookingRate", target: 40 },   // cria
    { scope: "role", key: "closer", metric: "won", target: "" },        // apaga o existente
    { scope: "user", key: "leo", metric: "revenue", target: 50000 },    // cria user-scope
    { scope: "role", key: "sdr", metric: "inexistente", target: 10 },   // ignora (métrica inválida)
    { scope: "role", key: "vendedor", metric: "won", target: 10 },      // ignora (role inválida)
  ] } });
  assert.equal(put.statusCode, 200);
  const body = put.json();
  assert.equal(body.created, 2);  // bookingRate + revenue
  assert.equal(body.removed, 1);  // won apagado

  const goals = await repo.list("goals");
  assert.ok(goals.find((x) => x.scope === "role" && x.key === "sdr" && x.metric === "bookingRate" && x.target === 40));
  assert.ok(goals.find((x) => x.scope === "user" && x.key === "leo" && x.metric === "revenue" && x.target === 50000));
  assert.equal(await repo.get("goals", g.id), null); // apagado
  // não criou lixo
  assert.ok(!goals.some((x) => x.metric === "inexistente"));
  assert.ok(!goals.some((x) => x.key === "vendedor"));
});

test("PUT: idempotente (mandar de novo atualiza, não duplica)", async () => {
  const { app, repo } = await buildApp();
  const payload = { goals: [{ scope: "role", key: "sdr", metric: "contactRate", target: 85 }] };
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload });
  const put2 = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [{ scope: "role", key: "sdr", metric: "contactRate", target: 90 }] } });
  assert.equal(put2.json().updated, 1);
  assert.equal(put2.json().created, 0);
  const matches = (await repo.list("goals")).filter((x) => x.scope === "role" && x.key === "sdr" && x.metric === "contactRate");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].target, 90);
});

test("meta da empresa: GET expõe cashTarget (null = padrão); PUT grava e limpa no produto", async () => {
  const { app, repo } = await buildApp();
  // Sem meta configurada: null + o padrão do pace pro placeholder da tela.
  let r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.equal(r.company.cashTarget, null);
  assert.equal(r.company.cashTargetDefault, 120000);

  // PUT com company grava no product.monthlyCashTarget (goals pode ir vazio).
  const put = await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { cashTarget: "80000" } } });
  assert.equal(put.json().companySaved, true);
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, 80000);
  r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  assert.equal(r.company.cashTarget, 80000);

  // Vazio limpa (a faixa volta pro padrão); sem `company` no body, não mexe.
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [], company: { cashTarget: "" } } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, null);
  await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: [{ scope: "role", key: "sdr", metric: "bookingRate", target: 30 }] } });
  assert.equal((await repo.get("products", "leverads")).monthlyCashTarget, null);
});

test("PUT inválido = 400; produto inexistente = 404", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/metas/naoexiste" })).statusCode, 404);
});

// A meta de cada vaga tem que descer da meta da EMPRESA, senão o placar cobra
// um número que não fecha com o mês. Mesma cadeia e mesmas taxas do pace.
test("derived: a meta do mês desce pela cadeia do pace e vira alvo de time", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { monthlyCashTarget: 120000 });
  // Sem histórico, as taxas caem no benchmark (80/30/75/25) e o ticket vem da
  // meta configurada — é o cenário de quem está começando.
  await repo.create("goals", { id: "g_ticket", saas: "leverads", scope: "role", key: "closer", metric: "ticket", target: 5000, period: "month" });

  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  const d = r.derived;
  assert.equal(d.blockedBy, null);
  assert.equal(d.target, 120000);
  assert.equal(d.ticket, 5000);
  assert.equal(d.won, 24);          // 120000 ÷ 5000
  assert.equal(d.callsShown, 73);   // 24 ÷ 33% de fechamento (das que ACONTECERAM)
  assert.equal(d.callsBooked, 98);  // 73 ÷ 75% de comparecimento
  assert.equal(d.contacts, 327);    // 98 ÷ 30% de agendamento
  assert.equal(d.leads, 409);       // 327 ÷ 80% de contato

  // O que o botão grava: só VOLUME (taxa continua digitada, senão vira circular).
  const byMetric = Object.fromEntries(d.goals.map((g) => [g.metric, g]));
  assert.deepEqual(Object.keys(byMetric).sort(), ["callsBooked", "contacts", "newAccounts", "revenue", "ticket", "won"]);
  assert.equal(byMetric.won.target, 24);
  assert.equal(byMetric.won.role, "closer");
  assert.equal(byMetric.revenue.target, 120000);
  assert.equal(byMetric.callsBooked.role, "sdr");
  assert.equal(byMetric.newAccounts.target, 24); // conta nova = ganho
  assert.ok(!("contactRate" in byMetric), "taxa não é derivada");

  // Quantas pessoas por vaga (o placar reparte a meta de time entre elas).
  assert.equal(r.people.closer, 2); // leo + jon
  assert.equal(r.people.sdr, 1);    // jon
});

test("derived: sem ticket a cadeia não fecha e a tela avisa em vez de chutar", async () => {
  const { app, repo } = await buildApp();
  await repo.update("products", "leverads", { monthlyCashTarget: 120000 });
  const d = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json().derived;
  assert.equal(d.blockedBy, "ticket");
  assert.equal(d.won, null);
  assert.deepEqual(d.goals, []);
});

test("catálogo marca quais metas são do TIME (repartem) e quais são de cada um", async () => {
  const { app } = await buildApp();
  const r = (await app.inject({ method: "GET", url: "/api/metas/leverads" })).json();
  const m = (role, metric) => r.roles.find((x) => x.role === role).metrics.find((y) => y.metric === metric);
  assert.equal(m("closer", "conversaoCall").hint, "das calls que aconteceram", "denominador escrito por extenso");
  assert.equal(m("closer", "won").team, true);
  assert.equal(m("closer", "revenue").team, true);
  assert.equal(m("closer", "ticket").team, undefined, "média não se reparte");
  assert.equal(m("sdr", "contacts").team, true);
  assert.equal(m("sdr", "bookingRate").team, undefined, "taxa não se reparte");
  assert.equal(m("integrator", "nps").team, undefined, "índice não se reparte");
});
