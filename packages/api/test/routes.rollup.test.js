// Verifica a derivação dos números do produto a partir da coleção `customers`:
// `customers` (contagem), `arr` (soma) e `mrr` (arr/12) nunca vêm do campo cru do
// produto — sempre dos clientes registrados. Garante que um SaaS jamais exibe
// receita sem clientes, e que UI/MCP/REST (bootstrap, portfolio, products) ficam
// consistentes. Repo in-memory (sem Postgres), via Fastify inject.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const repo = makeMemRepo();

function buildApp() {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

test("produto com números fantasma e sem clientes registrados → derivado a 0", async () => {
  // Campos crus mentem (receita sem cliente); o read deve sobrescrever para 0.
  await repo.create("products", { id: "leverads", name: "LeverAds", mrr: 350, arr: 4200, customers: 1 });
  const app = buildApp();

  const list = (await app.inject({ method: "GET", url: "/api/products" })).json();
  const lev = list.find((p) => p.id === "leverads");
  assert.equal(lev.customers, 0);
  assert.equal(lev.mrr, 0);
  assert.equal(lev.arr, 0);

  const one = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(one.customers, 0);
  assert.equal(one.mrr, 0);
  assert.equal(one.arr, 0);

  const portfolio = (await app.inject({ method: "GET", url: "/api/portfolio" })).json();
  assert.equal(portfolio.customers, 0);
  assert.equal(portfolio.mrr, 0);
  assert.equal(portfolio.arr, 0);

  const boot = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
  const bootLev = boot.SAAS.find((p) => p.id === "leverads");
  assert.equal(bootLev.customers, 0);
  assert.equal(bootLev.mrr, 0);

  await app.close();
});

test("ao registrar 1 cliente (arr=4200) → customers:1, arr:4200, mrr:350 em todos os módulos", async () => {
  await repo.create("customers", { id: "cust_real", name: "Cliente Real", saas: "leverads", arr: 4200 });
  const app = buildApp();

  const one = (await app.inject({ method: "GET", url: "/api/products/leverads" })).json();
  assert.equal(one.customers, 1);
  assert.equal(one.arr, 4200);
  assert.equal(one.mrr, 350); // round(4200 / 12)

  const portfolio = (await app.inject({ method: "GET", url: "/api/portfolio" })).json();
  assert.equal(portfolio.customers, 1);
  assert.equal(portfolio.arr, 4200);
  assert.equal(portfolio.mrr, 350);

  const boot = (await app.inject({ method: "GET", url: "/api/bootstrap" })).json();
  const bootLev = boot.SAAS.find((p) => p.id === "leverads");
  assert.equal(bootLev.customers, 1);
  assert.equal(bootLev.mrr, 350);

  await app.close();
});

// A consulta da mentoria (UniqueKids) tem que ocupar a agenda de quem atende,
// senão dá pra marcar call de venda por cima do encontro de um cliente. O
// bootstrap manda SÓ a ocupação: nome do cliente, da criança e telefone ficam na
// tela Consultas, que tem guard próprio.
test("bootstrap: consulta vira ocupação de agenda, sem dado da família", async () => {
  const repo2 = makeMemRepo();
  await repo2.create("products", { id: "uniquekids", name: "UniqueKids" });
  await repo2.create("consultations", {
    id: "cs1", saas: "uniquekids", owner: "ana", at: "2026-07-23T14:00:00.000Z", durationMin: 90,
    clientName: "Família Silva", childName: "Joana", phone: "5541999999999", status: "scheduled",
  });
  await repo2.create("consultations", { id: "cs2", saas: "uniquekids", owner: "ana", at: "2026-07-24T14:00:00.000Z", status: "canceled" });
  await repo2.create("consultations", { id: "cs3", saas: "uniquekids", owner: "ana", at: "", status: "scheduled" }); // sem horário
  const app2 = Fastify(); registerRoutes(app2, repo2);

  const slots = (await app2.inject({ url: "/api/bootstrap" })).json().CONSULTATION_SLOTS;
  assert.deepEqual(slots, [{ user: "ana", at: "2026-07-23T14:00:00.000Z", minutes: 90 }]);
  // cancelada e sem horário não ocupam nada
  assert.equal(slots.length, 1);
  // e o PII não pode viajar no bootstrap de todo mundo
  const raw = JSON.stringify(slots);
  for (const leak of ["Silva", "Joana", "5541999999999"]) assert.ok(!raw.includes(leak), `vazou ${leak}`);
  await app2.close();
});

test("bootstrap: consulta sem duração ocupa 1h (mesma régua da call)", async () => {
  const repo3 = makeMemRepo();
  await repo3.create("products", { id: "uniquekids", name: "UniqueKids" });
  await repo3.create("consultations", { id: "cs1", saas: "uniquekids", owner: "ana", at: "2026-07-23T14:00:00.000Z", status: "scheduled" });
  const app3 = Fastify(); registerRoutes(app3, repo3);
  assert.equal((await app3.inject({ url: "/api/bootstrap" })).json().CONSULTATION_SLOTS[0].minutes, 60);
  await app3.close();
});
