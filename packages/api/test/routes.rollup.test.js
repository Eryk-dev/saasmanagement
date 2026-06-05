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
