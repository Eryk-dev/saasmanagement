// Chave mestre em nome de alguém (`x-act-as`, auth.js): a pessoa vira o autor
// (activity de etapa, comentário), mas o ACESSO continua o da chave — tela
// restrita, etiqueta admin e escopo do Suporte da pessoa não fecham nada que a
// chave abria. Id desconhecido ou inválido é ignorado; sessão e JWT ignoram o
// cabeçalho (só a chave mestre age em nome de alguém).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeAuthHook, hashPassword } = await import("../src/auth/auth.js");
const { makeScreenGuardHook } = await import("../src/auth/screens.js");

const KEY = "test-key";
const ANA_TOKEN = "a".repeat(64);

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1, cadence: { firstTouchHours: 2 } },
  { stage: "Qualificando", kind: "qualificacao", conv: 1, cadence: { maxAttempts: 2, retryDays: 1 } },
  { stage: "Nutrição", kind: "contato", conv: 1, cadence: { retryDays: 7 } },
];

function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

// Mesmos hooks do index.js: auth e, logo depois, o guard de telas.
async function buildApp() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "leonardo", name: "Leonardo", role: "admin", roles: ["admin", "closer"], passwordHash: hashPassword("12345678") });
  // SDR com tudo restrito: só Meu dia e Tarefas, sem admin, sem produto de suporte.
  await repo.create("users", { id: "ana", name: "Ana", role: "admin", roles: ["sdr"], screens: ["today", "tasks"], supportSaas: [], passwordHash: hashPassword("12345678") });
  await repo.create("sessions", { id: ANA_TOKEN, user: "ana", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Lead", stage: "Novo lead" });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({ apiKey: KEY, repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  return { app, repo };
}

const asKey = (actAs) => ({ "x-api-key": KEY, ...(actAs === undefined ? {} : { "x-act-as": actAs }) });
const asAna = (extra = {}) => ({ authorization: `Bearer ${ANA_TOKEN}`, ...extra });
const stageAuthor = async (repo) => (await repo.list("activities")).filter((a) => a.lead === "l1" && a.type === "stage").at(-1)?.author;

test("x-act-as com a chave mestre: a pessoa é o autor do movimento de etapa", async () => {
  const { app, repo } = await buildApp();
  const me = await app.inject({ url: "/api/auth/me", headers: asKey("ana") });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().id, "ana");
  assert.equal(me.json().passwordHash, undefined); // usuário público, como na sessão

  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", headers: asKey("ana"), payload: { stage: "Qualificando" } });
  assert.equal(res.statusCode, 200);
  assert.equal(await stageAuthor(repo), "ana");
  await app.close();
});

test("x-act-as desconhecido, inválido ou vazio: ignorado, segue como chave pura (autor api)", async () => {
  for (const actAs of ["ninguem", "../users/ana", "", "a b", "x".repeat(81)]) {
    const { app, repo } = await buildApp();
    const me = await app.inject({ url: "/api/auth/me", headers: asKey(actAs) });
    assert.equal(me.statusCode, 401, `me com x-act-as=${JSON.stringify(actAs)}`); // chave pura não tem usuário
    const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", headers: asKey(actAs), payload: { stage: "Qualificando" } });
    assert.equal(res.statusCode, 200);
    assert.equal(await stageAuthor(repo), "api");
    await app.close();
  }
});

test("x-act-as só vale com a chave mestre: sessão ignora, sem credencial é 401", async () => {
  const { app } = await buildApp();
  const me = await app.inject({ url: "/api/auth/me", headers: asAna({ "x-act-as": "leonardo" }) });
  assert.equal(me.json().id, "ana");
  const none = await app.inject({ url: "/api/auth/me", headers: { "x-act-as": "leonardo" } });
  assert.equal(none.statusCode, 401);
  const wrong = await app.inject({ url: "/api/auth/me", headers: { "x-api-key": "outra", "x-act-as": "leonardo" } });
  assert.equal(wrong.statusCode, 401);
  await app.close();
});

test("em nome de alguém restrito, a chave mantém o acesso total (telas, admin, suporte)", async () => {
  const { app, repo } = await buildApp();
  await repo.create("tickets", { id: "t1", saas: "leverads", subject: "Ajuda", status: "novo", createdAt: new Date().toISOString() });

  // tela fora da lista da Ana: a sessão dela toma 403, a chave em nome dela passa
  assert.equal((await app.inject({ url: "/api/customers", headers: asAna() })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/customers", headers: asKey("ana") })).statusCode, 200);

  // números por plano: só admin na sessão; a chave passa
  assert.equal((await app.inject({ url: "/api/plans/stats/leverads", headers: asKey() })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/plans/stats/leverads", headers: asKey("ana") })).statusCode, 200);

  // suporte: escopo vazio da Ana não esconde ticket da chave
  const pure = await app.inject({ url: "/api/tickets", headers: asKey() });
  const asIs = await app.inject({ url: "/api/tickets", headers: asKey("ana") });
  assert.equal(asIs.statusCode, 200);
  assert.deepEqual(asIs.json(), pure.json());
  await app.close();
});

test("em nome de alguém: comentário sai com o autor, e a chave ainda edita o comentário dos outros", async () => {
  const { app } = await buildApp();
  const task = (await app.inject({ method: "POST", url: "/api/tasks", headers: asKey("leonardo"), payload: { title: "Ligar pro lead" } })).json();
  const leo = (await app.inject({ method: "POST", url: `/api/tasks/${task.id}/comments`, headers: asKey("leonardo"), payload: { text: "do Leo" } })).json();
  const cid = leo.comment?.id ?? leo.task?.comments?.at(-1)?.id ?? leo.comments?.at(-1)?.id;
  assert.ok(cid, "comentário criado");

  const mine = (await app.inject({ method: "POST", url: `/api/tasks/${task.id}/comments`, headers: asKey("ana"), payload: { text: "da Ana" } })).json();
  const comments = mine.task?.comments ?? mine.comments;
  assert.equal(comments.at(-1).author, "ana");

  // a sessão da Ana (sem admin) não edita o do Leo; a chave em nome dela edita
  const bySession = await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}/comments/${cid}`, headers: asAna(), payload: { text: "mexido" } });
  assert.equal(bySession.statusCode, 403);
  const byKey = await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}/comments/${cid}`, headers: asKey("ana"), payload: { text: "corrigido" } });
  assert.equal(byKey.statusCode, 200);
  assert.equal(byKey.json().comment.text, "corrigido");
  await app.close();
});

test("em nome de alguém, a chave ainda remove o próprio usuário em nome do qual age", async () => {
  const { app, repo } = await buildApp();
  await repo.update("leads", "l1", { owner: "" });
  const res = await app.inject({ method: "DELETE", url: "/api/auth/users/ana", headers: asKey("ana") });
  assert.equal(res.statusCode, 200);
  assert.equal(await repo.get("users", "ana"), null);
  await app.close();
});
