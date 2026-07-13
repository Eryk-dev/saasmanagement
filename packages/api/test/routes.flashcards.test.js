// Treinamentos (flashcards) — GET cai nos defaults (10 SDR + 10 closer) sem
// doc; PUT sanitiza (role válida, corta vazio) e persiste por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerFlashcardRoutes } = await import("../src/routes.flashcards.js");

async function buildApp(anthropic = null) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "outro", name: "Outro" });
  const app = Fastify();
  registerFlashcardRoutes(app, repo, { anthropic });
  return { app, repo };
}

test("GET sem doc: LeverAds cai em 10 SDR + 10 closer; produto sem default = vazio", async () => {
  const { app } = await buildApp();
  const lev = (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json();
  assert.equal(lev.cards.filter((c) => c.role === "sdr").length, 10);
  assert.equal(lev.cards.filter((c) => c.role === "closer").length, 10);
  assert.ok(lev.cards.every((c) => c.front && c.back));
  assert.equal(lev.roleLabels.sdr, "SDR");

  const outro = (await app.inject({ method: "GET", url: "/api/flashcards/outro" })).json();
  assert.deepEqual(outro.cards, []);

  assert.equal((await app.inject({ method: "GET", url: "/api/flashcards/naoexiste" })).statusCode, 404);
});

test("PUT sanitiza (role válida, corta vazio) e persiste; GET seguinte devolve o salvo", async () => {
  const { app, repo } = await buildApp();
  const payload = { cards: [
    { id: "a", role: "sdr", front: "P1", back: "R1" },
    { role: "papel_invalido", front: "P2", back: "R2" },   // role cai pra sdr
    { role: "closer", front: "", back: "" },                // vazio total → descartado
  ] };
  const put = await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload });
  assert.equal(put.statusCode, 200);
  const saved = put.json().cards;
  assert.equal(saved.length, 2);          // o vazio saiu
  assert.equal(saved[1].role, "sdr");     // role inválida normalizada

  const doc = await repo.get("flashcards", "leverads");
  assert.equal(doc.cards.length, 2);
  const get = (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json();
  assert.equal(get.cards.length, 2);      // devolve o salvo, não os defaults
});

test("PUT inválido = 400; produto inexistente = 404", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PUT", url: "/api/flashcards/naoexiste", payload: { cards: [] } })).statusCode, 404);
});

test("grade: corrige a resposta digitada pela IA e registra a tentativa; sem IA = 400", async () => {
  let seen = null;
  const anthropic = {
    configured: () => true,
    async gradeAnswer(args) { seen = args; return { verdict: "parcial", score: 60, feedback: "boa ideia, faltou citar o teste", missing: "o teste dos 10 anúncios" }; },
  };
  const { app, repo } = await buildApp(anthropic);
  // grade contra um card default (sdr_1)
  const res = await app.inject({ method: "POST", url: "/api/flashcards/leverads/grade", payload: { cardId: "sdr_1", answer: "clona anúncios entre contas" } });
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.equal(b.verdict, "parcial");
  assert.equal(b.score, 60);
  assert.ok(b.ideal); // devolve o gabarito
  // a IA recebeu pergunta + gabarito + resposta
  assert.match(seen.question, /LeverAds faz/);
  assert.ok(seen.ideal && seen.answer === "clona anúncios entre contas");
  // tentativa registrada pra métrica
  const attempts = await repo.list("training_attempts");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].cardId, "sdr_1");
  assert.equal(attempts[0].score, 60);
  assert.equal(attempts[0].verdict, "parcial");

  // resposta vazia = 400; card inexistente = 404
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/grade", payload: { cardId: "sdr_1", answer: "  " } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/grade", payload: { cardId: "zzz", answer: "x" } })).statusCode, 404);

  // sem IA configurada → 400
  const { app: app2 } = await buildApp({ configured: () => false });
  assert.equal((await app2.inject({ method: "POST", url: "/api/flashcards/leverads/grade", payload: { cardId: "sdr_1", answer: "x" } })).statusCode, 400);
});

test("GET expõe aiConfigured", async () => {
  const on = await buildApp({ configured: () => true });
  assert.equal((await on.app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json().aiConfigured, true);
  const off = await buildApp();
  assert.equal((await off.app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json().aiConfigured, false);
});
