// Times (auth/teams.js): validação dos membros, gestor dentro do time, escrita
// só de admin e o filtro por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

test("CRUD de time: gestor entra nos membros, pessoa inexistente é recusada, arquivado some da lista", async () => {
  const repo = makeMemRepo();
  for (const id of ["ana", "bia", "caio"]) await repo.create("users", { id, name: id, roles: ["sdr"] });
  const app = Fastify();
  registerRoutes(app, repo);

  const r = await app.inject({ method: "POST", url: "/api/teams", payload: { name: "SDR LeverAds", saas: "leverads", kind: "sdr", members: ["bia", "caio"], manager: "ana" } });
  assert.equal(r.statusCode, 201, r.body);
  assert.deepEqual(r.json().members, ["ana", "bia", "caio"]);
  assert.equal(r.json().kind, "sdr");

  const bad = await app.inject({ method: "POST", url: "/api/teams", payload: { name: "X", members: ["zé"] } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /zé/);
  assert.equal((await app.inject({ method: "POST", url: "/api/teams", payload: { name: "" } })).statusCode, 400);

  await app.inject({ method: "POST", url: "/api/teams", payload: { name: "CS geral", kind: "cs", members: ["caio"] } });
  await app.inject({ method: "POST", url: "/api/teams", payload: { name: "Closer Price", saas: "leverprice", kind: "closer" } });
  const ads = (await app.inject({ url: "/api/teams?saas=leverads" })).json().teams.map((t) => t.name);
  assert.deepEqual(ads, ["CS geral", "SDR LeverAds"], "o do produto e os de todos os produtos");

  const p = await app.inject({ method: "PATCH", url: `/api/teams/${r.json().id}`, payload: { status: "archived" } });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json().name, "SDR LeverAds", "o patch parcial mantém o resto");
  assert.equal((await app.inject({ url: "/api/teams?saas=leverads" })).json().teams.length, 1);
  assert.equal((await app.inject({ url: "/api/teams?saas=leverads&all=1" })).json().teams.length, 2);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/teams/nao-existe", payload: { name: "y" } })).statusCode, 404);
});

test("escrita de time exige etiqueta admin", async () => {
  const repo = makeMemRepo();
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.authUser = { id: "sdr1", roles: ["sdr"] }; });
  registerRoutes(app, repo);
  assert.equal((await app.inject({ method: "POST", url: "/api/teams", payload: { name: "T" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/teams" })).statusCode, 200);
});
