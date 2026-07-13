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
  assert.deepEqual(r.roles.map((x) => x.role), ["sdr", "closer", "integrator"]);
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

test("PUT inválido = 400; produto inexistente = 404", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "PUT", url: "/api/metas/leverads", payload: { goals: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url: "/api/metas/naoexiste" })).statusCode, 404);
});
