// UniqueKids · sugestão de solução da rotina (IA). Rota converte idade/neuro em
// rótulo, chama a IA e grava em lead.sugestaoSolucao. Offline com IA mockada.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutineRoutes } = await import("../src/routes.routine.js");

function fakeAI(opts = {}) {
  const seen = [];
  return {
    seen,
    configured: () => opts.configured !== false,
    async routineSuggestion(input) {
      seen.push(input);
      if (opts.throw) throw new Error("IA caiu");
      return { sugestao: "Isso mora no pilar RO: comece com o quadro do sono." };
    },
  };
}

async function appWith(repo, ai) {
  const app = Fastify();
  registerRoutineRoutes(app, repo, { anthropic: ai });
  await app.ready();
  return app;
}

async function seed(repo) {
  await repo.create("products", {
    id: "uniquekids", name: "UniqueKids",
    leadQuestions: [
      { key: "idade", options: [{ value: "7-9", label: "7 a 9 anos" }] },
      { key: "neuro", options: [{ value: "nao", label: "Não" }] },
    ],
  });
  await repo.create("leads", { id: "ld1", saas: "uniquekids", idade: "7-9", desafio: "Comportamento", desafio_exemplo: "Grita quando desliga a TV", neuro: "nao", tentou: "Quadro por conta própria" });
}

test("gera a sugestão, converte idade/neuro em rótulo e grava no lead", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const ai = fakeAI();
  const app = await appWith(repo, ai);

  const res = await app.inject({ method: "POST", url: "/api/leads/ld1/routine-suggestion" });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().sugestao, /pilar RO/);

  // passou os rótulos (não os valores crus) e o exemplo pra IA
  assert.equal(ai.seen[0].idade, "7 a 9 anos");
  assert.equal(ai.seen[0].neuro, "Não");
  assert.equal(ai.seen[0].desafio, "Comportamento");
  assert.equal(ai.seen[0].exemplo, "Grita quando desliga a TV");

  // gravou no lead
  assert.match((await repo.get("leads", "ld1")).sugestaoSolucao, /pilar RO/);
  await app.close();
});

test("IA não configurada → 503; lead inexistente → 404; IA caiu → 502", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  assert.equal((await (await appWith(repo, fakeAI({ configured: false }))).inject({ method: "POST", url: "/api/leads/ld1/routine-suggestion" })).statusCode, 424);
  assert.equal((await (await appWith(repo, fakeAI())).inject({ method: "POST", url: "/api/leads/nope/routine-suggestion" })).statusCode, 404);
  assert.equal((await (await appWith(repo, fakeAI({ throw: true }))).inject({ method: "POST", url: "/api/leads/ld1/routine-suggestion" })).statusCode, 424);
});
