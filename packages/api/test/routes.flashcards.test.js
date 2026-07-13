// Treinamentos — FSRS por pessoa. Fila do dia (novos limitados por settings,
// aprendendo/revisar por due), review progride o estado individual (Errei
// volta em minutos, Fácil espaça dias), estados independentes entre usuários,
// base editável com settings e dashboard da equipe.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerFlashcardRoutes } = await import("../src/routes.flashcards.js");

const USERS = {
  ana: { id: "ana", name: "Ana", roles: ["sdr"] },
  bob: { id: "bob", name: "Bob", roles: ["closer"] },
  eryk: { id: "eryk", name: "Eryk", roles: [] },                       // sem etiqueta = todos os baralhos
  zoe: { id: "zoe", name: "Zoe", roles: ["sdr"], saas: "outro" },      // escopo de outro produto
};

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "outro", name: "Outro" });
  for (const u of Object.values(USERS)) await repo.create("users", u);
  const app = Fastify();
  // sessão fake: o makeAuthHook real põe req.authUser; aqui vem do header x-user.
  app.addHook("onRequest", async (req) => {
    const u = USERS[req.headers["x-user"]];
    if (u) req.authUser = u;
  });
  registerFlashcardRoutes(app, repo);
  return { app, repo };
}
const as = (user) => ({ "x-user": user });

test("GET base: LeverAds cai nos 10 SDR + 10 closer com settings default; produto sem default = vazio", async () => {
  const { app } = await buildApp();
  const lev = (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json();
  assert.equal(lev.cards.filter((c) => c.role === "sdr").length, 10);
  assert.equal(lev.cards.filter((c) => c.role === "closer").length, 10);
  assert.equal(lev.settings.newPerDay, 10);
  assert.equal(lev.roleLabels.sdr, "SDR");

  assert.deepEqual((await app.inject({ method: "GET", url: "/api/flashcards/outro" })).json().cards, []);
  assert.equal((await app.inject({ method: "GET", url: "/api/flashcards/naoexiste" })).statusCode, 404);
});

test("PUT sanitiza cards, clampa settings e persiste; PUT só de cards preserva settings", async () => {
  const { app } = await buildApp();
  const put = await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: [
    { id: "a", role: "sdr", front: "P1", back: "R1" },
    { role: "papel_invalido", front: "P2", back: "R2" },   // role cai pra sdr
    { role: "closer", front: "", back: "" },                // vazio → descartado
  ], settings: { newPerDay: 999 } } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().cards.length, 2);
  assert.equal(put.json().cards[1].role, "sdr");
  assert.equal(put.json().settings.newPerDay, 200); // clamp no teto

  // PUT sem settings mantém o que estava
  const put2 = await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: put.json().cards } });
  assert.equal(put2.json().settings.newPerDay, 200);

  assert.equal((await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: "x" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PUT", url: "/api/flashcards/naoexiste", payload: { cards: [] } })).statusCode, 404);
});

test("queue: exige sessão; monta só os baralhos da vaga; novos respeitam newPerDay; preview nos 4 botões", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue" })).statusCode, 401);

  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(q.decks.map((d) => d.role), ["sdr"]);   // ana só treina SDR
  assert.deepEqual(q.decks[0].counts, { new: 10, learning: 0, review: 0 });
  assert.equal(q.queue.sdr.length, 10);
  assert.equal(q.queue.sdr[0].srs, null);                   // novo = sem estado ainda
  for (const r of [1, 2, 3, 4]) assert.ok(q.queue.sdr[0].preview[r]);

  // admin sem etiqueta vê todos os baralhos
  const qe = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("eryk") })).json();
  assert.deepEqual(qe.decks.map((d) => d.role), ["sdr", "closer", "integrator", "social"]);

  // baixa o limite diário → menos novos na fila
  await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: {
    cards: (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json().cards,
    settings: { newPerDay: 3 },
  } });
  const q3 = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(q3.decks[0].counts, { new: 3, learning: 0, review: 0 });
});

test("review: Bom em card novo vira aprendendo (minutos) e consome o budget de novos; Fácil gradua pra revisão (dias)", async () => {
  const { app } = await buildApp();
  const before = Date.now();

  // Bom (3) num card novo → learning, volta em ~10min, ainda hoje
  const r1 = (await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 3 } })).json();
  assert.equal(r1.srs.state, 1); // learning
  const due1 = new Date(r1.srs.due).getTime() - before;
  assert.ok(due1 > 0 && due1 < 30 * 60e3, `due em ${Math.round(due1 / 60e3)}min`);

  // a fila reflete: 1 novo a menos no budget, sdr_1 agora em aprendendo
  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.equal(q.decks[0].counts.learning, 1);
  assert.equal(q.decks[0].counts.new, 9); // 10 do limite - 1 novo já feito
  assert.ok(q.queue.sdr.some((c) => c.id === "sdr_1" && c.srs?.state === 1));

  // Fácil (4) num card novo → gradua direto pra revisão, dias à frente (some da fila de hoje)
  const r2 = (await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_2", rating: 4 } })).json();
  assert.equal(r2.srs.state, 2); // review
  assert.ok(new Date(r2.srs.due).getTime() - before > 2 * 864e5);
  const q2 = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.ok(!q2.queue.sdr.some((c) => c.id === "sdr_2"));

  // Errei (1) → volta em ~1min e segue na fila de hoje
  const r3 = (await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_3", rating: 1 } })).json();
  assert.equal(r3.srs.state, 1);
  assert.ok(new Date(r3.srs.due).getTime() - before < 10 * 60e3);

  // validações
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 9 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "zzz", rating: 3 } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", payload: { cardId: "sdr_1", rating: 3 } })).statusCode, 401);
});

test("estados são independentes por pessoa e cada revisão vira log em training_reviews", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 1 } });
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("eryk"), payload: { cardId: "sdr_1", rating: 4 } });

  // mesmo card, agendas diferentes: pra ana voltou em minutos; pro eryk, dias
  const ana = (await repo.get("training_states", "leverads__ana")).cards.sdr_1;
  const eryk = (await repo.get("training_states", "leverads__eryk")).cards.sdr_1;
  assert.equal(ana.state, 1);
  assert.equal(eryk.state, 2);
  assert.ok(new Date(eryk.due) - new Date(ana.due) > 864e5);

  const log = await repo.list("training_reviews");
  assert.equal(log.length, 2);
  assert.deepEqual(new Set(log.map((r) => r.user)), new Set(["ana", "eryk"]));
  assert.equal(log[0].role, "sdr");
  assert.equal(log[0].prevState, 0); // era novo
});

test("team: contadores por pessoa, respeitando escopo de produto do usuário", async () => {
  const { app } = await buildApp();
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 3 } });
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_3", rating: 1 } });

  const t = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/team" })).json();
  assert.ok(!t.users.some((u) => u.id === "zoe")); // zoe é do produto "outro"
  const ana = t.users.find((u) => u.id === "ana");
  assert.equal(ana.deckSize, 10);      // só o baralho SDR conta pra ela
  assert.equal(ana.seen, 2);
  assert.equal(ana.dueToday, 2);       // os dois voltam ainda hoje (learning)
  assert.equal(ana.doneToday, 2);
  assert.equal(ana.streak, 1);
  assert.equal(ana.again7dPct, 50);    // 1 Errei em 2
  const bob = t.users.find((u) => u.id === "bob");
  assert.equal(bob.doneToday, 0);
  assert.equal(bob.deckSize, 10);      // baralho closer
});

test("card removido da base some da fila (estado individual fica órfão sem quebrar nada)", async () => {
  const { app } = await buildApp();
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 1 } });
  // base editada: só sobra 1 card, e não é o sdr_1
  await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: [{ id: "novo_1", role: "sdr", front: "P", back: "R" }] } });
  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(q.queue.sdr.map((c) => c.id), ["novo_1"]);
  assert.deepEqual(q.decks[0].counts, { new: 1, learning: 0, review: 0 });
});
