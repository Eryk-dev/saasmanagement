// Treinamentos (flashcards) — GET cai nos defaults (10 SDR + 10 closer) sem
// doc; PUT sanitiza (role válida, corta vazio) e persiste por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerFlashcardRoutes } = await import("../src/routes.flashcards.js");

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "outro", name: "Outro" });
  const app = Fastify();
  registerFlashcardRoutes(app, repo);
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
