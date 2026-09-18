// Cliente do Linear (GraphQL). O que está sob teste é o que a API real cobrou
// da gente: o cabeçalho de autenticação certo por tipo de chave, erro que vem
// com status 200 e o teto de COMPLEXIDADE da query (o workspace real recusou o
// catálogo com "Query too complex" e o cliente precisa se virar sozinho).

import test from "node:test";
import assert from "node:assert/strict";
import { makeLinear } from "../src/linear.js";

// fetch de mentira: guarda as chamadas e responde pela fila de respostas.
function fakeFetch(respostas) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = respostas[Math.min(calls.length - 1, respostas.length - 1)];
    return { status: r.status || 200, text: async () => JSON.stringify(r.body) };
  };
  fn.calls = calls;
  return fn;
}

const TEAM = {
  id: "t1", key: "LEV", name: "Leverads",
  states: { nodes: [{ id: "s2", name: "Done", type: "completed", position: 2 }, { id: "s1", name: "Todo", type: "unstarted", position: 1 }] },
  projects: { nodes: [{ id: "p1", name: "CS - Suporte", state: "started" }] },
};

test("chave pessoal vai crua no Authorization; token de OAuth vai como Bearer", async () => {
  const f1 = fakeFetch([{ body: { data: { viewer: { name: "Yudi" } } } }]);
  await makeLinear({ fetch: f1, apiKey: "lin_api_abc" }).viewer();
  assert.equal(f1.calls[0].headers.authorization, "lin_api_abc");

  const f2 = fakeFetch([{ body: { data: { viewer: { name: "Yudi" } } } }]);
  await makeLinear({ fetch: f2, apiKey: "lin_oauth_xyz" }).viewer();
  assert.equal(f2.calls[0].headers.authorization, "Bearer lin_oauth_xyz");
});

test("erro de GraphQL vem com status 200 e mesmo assim vira exceção legível", async () => {
  const f = fakeFetch([{ status: 200, body: { errors: [{ message: "Entity not found" }] } }]);
  await assert.rejects(
    () => makeLinear({ fetch: f, apiKey: "lin_api_x" }).issue("LEV-999"),
    /Linear -> 200: Entity not found/,
  );
});

test("catálogo: 'Query too complex' cai para uma query por time em vez de falhar", async () => {
  const f = fakeFetch([
    { status: 400, body: { errors: [{ message: "Query too complex" }] } }, // tentativa cheia
    { body: { data: { teams: { nodes: [{ id: "t1", key: "LEV", name: "Leverads" }] } } } }, // times, enxuto
    { body: { data: { team: TEAM } } }, // o time, com colunas e projetos
  ]);
  const teams = await makeLinear({ fetch: f, apiKey: "lin_api_x" }).catalog();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(teams, [{
    id: "t1", key: "LEV", name: "Leverads",
    states: [{ id: "s1", name: "Todo", type: "unstarted" }, { id: "s2", name: "Done", type: "completed" }],
    projects: [{ id: "p1", name: "CS - Suporte", state: "started" }],
  }], "as colunas saem na ordem do fluxo (position), não na que o Linear devolveu");
});

test("catálogo: erro que não é de complexidade sobe (não vira consulta em cascata)", async () => {
  const f = fakeFetch([{ status: 401, body: { errors: [{ message: "Authentication required" }] } }]);
  await assert.rejects(() => makeLinear({ fetch: f, apiKey: "lin_api_x" }).catalog(), /401/);
  assert.equal(f.calls.length, 1);
});

test("a chave pode chegar depois do import (o dotenv roda depois dos imports)", async () => {
  // Regressão real: o cliente padrão nascia com a env ainda vazia e a API subia
  // achando que não havia LINEAR_API_KEY mesmo com ela no .env.
  const antes = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  const f = fakeFetch([{ body: { data: { viewer: { name: "Yudi" } } } }]);
  const linear = makeLinear({ fetch: f, apiKey: () => process.env.LINEAR_API_KEY || "" });
  assert.equal(linear.configured(), false);

  process.env.LINEAR_API_KEY = "lin_api_tardia";
  try {
    assert.equal(linear.configured(), true, "a chave passa a valer sem recriar o cliente");
    await linear.viewer();
    assert.equal(f.calls[0].headers.authorization, "lin_api_tardia");
  } finally {
    if (antes === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = antes;
  }
});

test("sem chave, o cliente fica dormente e nem tenta a rede", async () => {
  const f = fakeFetch([{ body: { data: {} } }]);
  const linear = makeLinear({ fetch: f, apiKey: "" });
  assert.equal(linear.configured(), false);
  await assert.rejects(() => linear.viewer(), /LINEAR_API_KEY/);
  assert.equal(f.calls.length, 0);
});
