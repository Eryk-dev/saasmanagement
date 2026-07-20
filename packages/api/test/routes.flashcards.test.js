// Treinamentos — FSRS por pessoa. Fila do dia (novos limitados por settings,
// aprendendo/revisar por due), review progride o estado individual (Errei
// volta em minutos, Fácil espaça dias), estados independentes entre usuários,
// base editável com settings e dashboard da equipe.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerFlashcardRoutes } = await import("../src/routes.flashcards.js");

const USERS = {
  ana: { id: "ana", name: "Ana", roles: ["sdr"] },
  bob: { id: "bob", name: "Bob", roles: ["closer"] },
  eryk: { id: "eryk", name: "Eryk", roles: [] },                       // sem etiqueta = todos os baralhos
  zoe: { id: "zoe", name: "Zoe", roles: ["sdr"], saas: "outro" },      // escopo de outro produto
  leo: { id: "leo", name: "Leo", roles: ["admin"] },                   // dono: treino opcional
  jon: { id: "jon", name: "Jon", roles: ["closer", "admin"] },         // fecha E é dono
};

async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "outro", name: "Outro" });
  for (const u of Object.values(USERS)) await repo.create("users", u);
  const app = Fastify();
  await app.register(multipart);
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
  assert.equal(lev.cards.filter((c) => c.role === "sdr").length, 30);
  assert.equal(lev.cards.filter((c) => c.role === "closer").length, 30);
  assert.equal(lev.cards.filter((c) => c.role === "geral_negocio").length, 30);
  assert.equal(lev.cards.filter((c) => c.role === "geral_marketplace").length, 30);
  assert.equal(lev.roleLabels.geral_negocio, "Geral · Negócio");
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

test("queue: exige sessão; monta só os baralhos da vaga; newPerDay é GLOBAL, em rodízio entre os baralhos; preview nos 4 botões", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue" })).statusCode, 401);

  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  // ana treina os gerais (todo mundo, primeiro) + a vaga dela (SDR)
  assert.deepEqual(q.decks.map((d) => d.role), ["geral_negocio", "geral_marketplace", "sdr"]);
  // 10 novos NO DIA (não por baralho), repartidos em rodízio: 4/3/3
  assert.deepEqual(q.decks.map((d) => d.counts.new), [4, 3, 3]);
  assert.deepEqual(q.decks.find((d) => d.role === "sdr").counts, { new: 3, learning: 0, review: 0 });
  assert.equal(q.queue.sdr.length, 3);
  assert.equal(q.queue.sdr[0].srs, null);                   // novo = sem estado ainda
  for (const r of [1, 2, 3, 4]) assert.ok(q.queue.sdr[0].preview[r]);

  // admin sem etiqueta vê todos os baralhos
  const qe = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("eryk") })).json();
  assert.deepEqual(qe.decks.map((d) => d.role), ["geral_negocio", "geral_marketplace", "sdr", "closer", "integrator", "social"]);
  assert.equal(qe.decks.reduce((a, d) => a + d.counts.new, 0), 10); // global mesmo com 6 baralhos

  // baixa o limite diário → menos novos na fila (1 por baralho no rodízio)
  await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: {
    cards: (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json().cards,
    settings: { newPerDay: 3 },
  } });
  const q3 = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(q3.decks.map((d) => d.counts.new), [1, 1, 1]);
});

test("review: Bom em card novo vira aprendendo (minutos) e consome o budget de novos; Fácil gradua pra revisão (dias)", async () => {
  const { app } = await buildApp();
  const before = Date.now();

  // Bom (3) num card novo → learning, volta em ~10min, ainda hoje
  const r1 = (await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 3 } })).json();
  assert.equal(r1.srs.state, 1); // learning
  const due1 = new Date(r1.srs.due).getTime() - before;
  assert.ok(due1 > 0 && due1 < 30 * 60e3, `due em ${Math.round(due1 / 60e3)}min`);

  // a fila reflete: 1 novo a menos no budget GLOBAL do dia, sdr_1 em aprendendo
  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.equal(q.decks.find((d) => d.role === "sdr").counts.learning, 1);
  assert.equal(q.decks.reduce((a, d) => a + d.counts.new, 0), 9); // 10 do dia - 1 novo já feito
  assert.equal(q.decks.find((d) => d.role === "sdr").counts.new, 2); // rodízio compensa o feito no sdr
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
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 1, ms: 1234 } });
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
  assert.equal(log.find((r) => r.user === "ana").ms, 1234); // cronômetro anti-burla
});

test("team: contadores por pessoa, respeitando escopo de produto do usuário", async () => {
  const { app } = await buildApp();
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 3 } });
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_3", rating: 1 } });

  const t = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/team" })).json();
  assert.ok(!t.users.some((u) => u.id === "zoe")); // zoe é do produto "outro"
  const ana = t.users.find((u) => u.id === "ana");
  assert.equal(ana.deckSize, 90);      // gerais (60) + o baralho SDR (30)
  assert.equal(ana.seen, 2);
  assert.equal(ana.dueToday, 2);       // os dois voltam ainda hoje (learning)
  assert.equal(ana.doneToday, 2);
  assert.equal(ana.streak, 1);
  assert.equal(ana.again7dPct, 50);    // 1 Errei em 2
  const bob = t.users.find((u) => u.id === "bob");
  assert.equal(bob.doneToday, 0);
  assert.equal(bob.deckSize, 90);      // gerais (60) + baralho closer (30)
});

test("stats: revisões por dia, streak atual e melhor sequência do usuário logado", async () => {
  const { app, repo } = await buildApp();
  assert.equal((await app.inject({ method: "GET", url: "/api/flashcards/leverads/stats" })).statusCode, 401);

  // histórico: hoje (via review real), ontem e anteontem + uma corrida antiga de 4 dias
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 3 } });
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  for (const [n, times] of [[1, 2], [2, 1], [10, 1], [11, 1], [12, 1], [13, 1]]) {
    for (let i = 0; i < times; i++) {
      // id explícito: o gerador do repo colide quando 2 creates caem no mesmo ms
      await repo.create("training_reviews", { id: `rev_${n}_${i}`, saas: "leverads", user: "ana", cardId: "sdr_9", role: "sdr", rating: 3, at: day(n) });
    }
  }
  // ruído: outro produto e outro usuário não contam
  await repo.create("training_reviews", { id: "rev_outro", saas: "outro", user: "ana", cardId: "x", role: "sdr", rating: 1, at: day(0) });
  await repo.create("training_reviews", { id: "rev_bob", saas: "leverads", user: "bob", cardId: "x", role: "sdr", rating: 1, at: day(0) });

  const s = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/stats", headers: as("ana") })).json();
  assert.equal(s.streak, 3);        // hoje + ontem + anteontem
  assert.equal(s.bestStreak, 4);    // a corrida antiga de 4 dias ganha
  assert.equal(s.doneToday, 1);
  assert.equal(Object.values(s.days).reduce((a, b) => a + b, 0), 8); // 7 semeadas + 1 real, só as da ana no leverads
});

test("tipos: cloze expande por índice e occlusion por máscara, cada um com estado FSRS próprio", async () => {
  const { app } = await buildApp();
  await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: [
    { id: "cz", role: "sdr", type: "cloze", front: "A escada é {{c1::anual}} depois {{c2::semestral}}", back: "extra" },
    { id: "oc", role: "sdr", type: "occlusion", image: "ta_x", masks: [{ id: "m1", x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, { id: "m2", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }] },
    { id: "oc_sem_imagem", role: "sdr", type: "occlusion", image: "", masks: [] },  // descartado
    { id: "b", role: "sdr", type: "tipo_zoado", front: "básico", back: "b" },        // type cai pra basic
  ] } });
  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(new Set(q.queue.sdr.map((c) => c.entryId)), new Set(["cz::c1", "cz::c2", "oc::m1", "oc::m2", "b"]));
  assert.equal(q.decks.find((d) => d.role === "sdr").total, 5);

  // revisa só o c1: gradua e some da fila; c2 segue novo e independente
  const r = (await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "cz::c1", rating: 4 } })).json();
  assert.equal(r.cardId, "cz::c1");
  const q2 = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.ok(!q2.queue.sdr.some((c) => c.entryId === "cz::c1"));
  assert.ok(q2.queue.sdr.some((c) => c.entryId === "cz::c2" && !c.srs));

  // sub-card que não existe = 404
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "cz::c9", rating: 3 } })).statusCode, 404);
});

test("asset: upload multipart com sessão, servido público em /public/training/:id", async () => {
  const { app } = await buildApp();
  const boundary = "----cockpittest";
  const bytes = Buffer.from("fake-png-bytes");
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="x.png"\r\ncontent-type: image/png\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await app.inject({ method: "POST", url: "/api/flashcards/leverads/asset", headers: { ...as("ana"), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  assert.equal(up.statusCode, 200, up.body);
  const { url } = up.json();
  assert.match(url, /^\/public\/training\/ta_/);
  const got = await app.inject({ method: "GET", url });
  assert.equal(got.statusCode, 200);
  assert.equal(got.headers["content-type"].split(";")[0], "image/png");
  assert.equal(got.rawPayload.toString(), "fake-png-bytes");
  // sem sessão = 401
  assert.equal((await app.inject({ method: "POST", url: "/api/flashcards/leverads/asset", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload })).statusCode, 401);
});

test("team: true retention só conta cards que JÁ estavam em revisão; maduros e forecast vêm do estado", async () => {
  const { app, repo } = await buildApp();
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  // 10 revisões de cards em revisão: 8 lembradas (rating≥2), 2 Errei → 80%
  for (let i = 0; i < 10; i++) {
    await repo.create("training_reviews", { id: `tr_${i}`, saas: "leverads", user: "ana", cardId: `sdr_${i}`, role: "sdr", rating: i < 2 ? 1 : 3, prevState: 2, at: day(2) });
  }
  // aprendizado (prevState=0) NÃO entra na retention; first-try 1/2 → 50%
  await repo.create("training_reviews", { id: "tn_1", saas: "leverads", user: "ana", cardId: "x1", role: "sdr", rating: 3, prevState: 0, at: day(1) });
  await repo.create("training_reviews", { id: "tn_2", saas: "leverads", user: "ana", cardId: "x2", role: "sdr", rating: 1, prevState: 0, at: day(1) });
  // estado: sdr_1 maduro (ivl 30d) vencendo em ~2,5 dias (forecast); sdr_2 jovem e longe
  await repo.create("training_states", { id: "leverads__ana", saas: "leverads", user: "ana", newDone: {}, cards: {
    sdr_1: { state: 2, due: new Date(Date.now() + 2.5 * 864e5).toISOString(), scheduled_days: 30 },
    sdr_2: { state: 2, due: new Date(Date.now() + 40 * 864e5).toISOString(), scheduled_days: 5 },
  } });

  const t = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/team" })).json();
  const ana = t.users.find((u) => u.id === "ana");
  assert.equal(ana.retention30d.pct, 80);
  assert.equal(ana.retention30d.n, 10);
  assert.equal(ana.firstTryPct, 50);
  assert.equal(ana.mature, 1);
  assert.equal(ana.young, 1);
  assert.equal(ana.forecast.reduce((s, f) => s + f.n, 0), 1); // só o vencimento em ~2,5d
  assert.equal(ana.retentionByRole[0].role, "sdr");
  assert.equal(ana.retentionByRole[0].pct, 80);
  assert.equal(ana.weekly.length, 8);
  assert.equal(ana.weekly.at(-1).pct, 80); // a semana atual carrega as 10 revisões
});

test("prova de checkpoint: dispara ao graduar examEvery cards, corrige no servidor e reprova reseta os errados", async () => {
  const { app, repo } = await buildApp();
  const base = (await app.inject({ method: "GET", url: "/api/flashcards/leverads" })).json().cards;
  // gestor configura: prova a cada 2 graduados, 3 questões, régua 70 (e clamps valem)
  const put = (await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: {
    cards: base, settings: { examEvery: 2, examQuestions: 1, examPass: 30 },
  } })).json();
  assert.equal(put.settings.examEvery, 2);
  assert.equal(put.settings.examQuestions, 3); // clamp mínimo
  assert.equal(put.settings.examPass, 50);     // clamp mínimo

  // Fácil gradua direto (novo → revisão): 1º graduado ainda não dispara
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 4 } });
  let q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.equal(q.exam, null);
  // 2º graduado dispara a prova
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_2", rating: 4 } });
  q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.ok(q.exam?.id);
  assert.equal(q.exam.count, 2);

  // abrir gera questões SEM gabarito no payload (correção é do servidor)
  const st = (await app.inject({ method: "POST", url: `/api/flashcards/leverads/exam/${q.exam.id}/start`, headers: as("ana") })).json();
  assert.ok(st.questions.length >= 2);
  assert.ok(st.questions.every((x) => x.kind === "mc" && x.options.length >= 2 && x.answerIdx === undefined));

  // responde tudo ERRADO → reprova e os cards da prova voltam pra fila como novos
  const doc = await repo.get("training_exams", q.exam.id);
  const wrong = doc.questions.map((x) => ({ choice: (x.answerIdx + 1) % x.options.length }));
  const sub = (await app.inject({ method: "POST", url: `/api/flashcards/leverads/exam/${q.exam.id}/submit`, headers: as("ana"), payload: { answers: wrong } })).json();
  assert.equal(sub.score, 0);
  assert.equal(sub.passed, false);
  assert.ok(sub.resetCount >= 2);
  q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.ok(q.queue.sdr.some((c) => c.entryId === "sdr_1" && !c.srs)); // voltou como novo
  assert.equal(q.exam, null); // prova consumida

  // segunda rodada: gradua de novo, acerta tudo → aprovado
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 4 } });
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_3", rating: 4 } });
  q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  await app.inject({ method: "POST", url: `/api/flashcards/leverads/exam/${q.exam.id}/start`, headers: as("ana") });
  const doc2 = await repo.get("training_exams", q.exam.id);
  const right = doc2.questions.map((x) => ({ choice: x.answerIdx }));
  const sub2 = (await app.inject({ method: "POST", url: `/api/flashcards/leverads/exam/${q.exam.id}/submit`, headers: as("ana"), payload: { answers: right } })).json();
  assert.equal(sub2.score, 100);
  assert.equal(sub2.passed, true);

  // gestor vê o histórico no team
  const t = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/team" })).json();
  const ana = t.users.find((u) => u.id === "ana");
  assert.equal(ana.examsDone, 2);
  assert.equal(ana.examsFailed, 1);
  assert.deepEqual(ana.lastExam, { score: 100, status: "passed" });
});

test("card removido da base some da fila (estado individual fica órfão sem quebrar nada)", async () => {
  const { app } = await buildApp();
  await app.inject({ method: "POST", url: "/api/flashcards/leverads/review", headers: as("ana"), payload: { cardId: "sdr_1", rating: 1 } });
  // base editada: só sobra 1 card, e não é o sdr_1
  await app.inject({ method: "PUT", url: "/api/flashcards/leverads", payload: { cards: [{ id: "novo_1", role: "sdr", front: "P", back: "R" }] } });
  const q = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("ana") })).json();
  assert.deepEqual(q.queue.sdr.map((c) => c.id), ["novo_1"]);
  assert.deepEqual(q.decks.find((d) => d.role === "sdr").counts, { new: 1, learning: 0, review: 0 });
});


// Treinamento é obrigação de VAGA (SDR/closer/…). Quem toca o negócio (admin)
// pode estudar, mas não é cobrado: sem fila própria e fora do quadro da equipe.
test("admin: sem baralho obrigatório e fora da cobrança da equipe", async () => {
  const { app } = await buildApp();

  // admin puro não recebe fila (antes, "sem vaga" caía em TODOS os baralhos)
  const leo = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("leo") })).json();
  assert.deepEqual(leo.decks, []);
  assert.deepEqual(leo.queue, {});

  // admin que também é closer continua com o baralho da VAGA dele (estudo opcional)
  const jon = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("jon") })).json();
  assert.deepEqual(jon.decks.map((d) => d.role), ["geral_negocio", "geral_marketplace", "closer"]);
  assert.equal(jon.queue.closer.length, 3); // 10 do dia em rodízio: 4/3/3

  // quadro da equipe não cobra admin (nem o puro, nem o que tem vaga)
  const team = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/team" })).json();
  const ids = team.users.map((u) => u.id);
  assert.ok(!ids.includes("leo"), "admin puro fora do quadro");
  assert.ok(!ids.includes("jon"), "admin com vaga também não é cobrado");
  assert.ok(ids.includes("ana") && ids.includes("bob"), "quem tem vaga segue no quadro");

  // sem etiqueta NENHUMA (cadastro novo) segue vendo tudo, como antes
  const semTag = (await app.inject({ method: "GET", url: "/api/flashcards/leverads/queue", headers: as("eryk") })).json();
  assert.deepEqual(semTag.decks.map((d) => d.role), ["geral_negocio", "geral_marketplace", "sdr", "closer", "integrator", "social"]);
});
