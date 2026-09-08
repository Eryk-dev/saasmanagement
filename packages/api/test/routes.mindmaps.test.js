// Mapas mentais: trava otimista por versão no PATCH (baseVersion) e upload de
// imagem do nó pela rota própria.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("mindmaps", { id: "mm1", name: "Estratégia", saas: "leverads", layout: "tree", nodes: [], links: [], version: 0 });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

test("PATCH de mapa sobe a versão e carimba updatedAt", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "PATCH", url: "/api/mindmaps/mm1", payload: { baseVersion: 0, nodes: [{ id: "n1", text: "Raiz" }] } });
  assert.equal(res.statusCode, 200);
  const doc = await repo.get("mindmaps", "mm1");
  assert.equal(doc.version, 1);
  assert.ok(doc.updatedAt);
  assert.equal(doc.baseVersion, undefined); // a base não fica gravada no doc
  assert.equal(doc.nodes.length, 1);
  await app.close();
});

test("PATCH com baseVersion antiga devolve 409 com o doc atual e não grava", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "PATCH", url: "/api/mindmaps/mm1", payload: { baseVersion: 0, nodes: [{ id: "n1", text: "A" }] } });
  const res = await app.inject({ method: "PATCH", url: "/api/mindmaps/mm1", payload: { baseVersion: 0, nodes: [{ id: "n1", text: "B" }] } });
  assert.equal(res.statusCode, 409);
  const body = res.json();
  assert.equal(body.code, "version_conflict");
  assert.equal(body.current.version, 1);
  assert.equal(body.current.nodes[0].text, "A");
  const doc = await repo.get("mindmaps", "mm1");
  assert.equal(doc.nodes[0].text, "A");
  await app.close();
});

test("PATCH sem baseVersion (renomear pela lista) continua aceito e também versiona", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "PATCH", url: "/api/mindmaps/mm1", payload: { name: "Plano Q4" } });
  assert.equal(res.statusCode, 200);
  const doc = await repo.get("mindmaps", "mm1");
  assert.equal(doc.name, "Plano Q4");
  assert.equal(doc.version, 1);
  await app.close();
});
