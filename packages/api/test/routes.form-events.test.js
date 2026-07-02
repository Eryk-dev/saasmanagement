// Telemetria de funil do form: POST /public/forms/:id/events (anônimo) e
// GET /api/forms/:id/funnel (agregado por sessão única, na ordem das telas).
// Repo in-memory (sem Postgres), via Fastify inject.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FORM = {
  id: "fo_test",
  name: "Diagnóstico LeverAds",
  saas: "leverads",
  status: "published",
  welcome: { title: "Bem-vindo", button: "Começar" },
  questions: [
    { key: "niche", label: "Segmento?", type: "select", required: true, options: [{ value: "moda", label: "Moda" }] },
    { key: "accounts", label: "Contas?", type: "select", required: true, options: [{ value: "2", label: "2" }] },
    { key: "nome", label: "Nome?", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp", type: "phone", required: true, stack: true },
  ],
  mapping: { name: "nome", phone: "whatsapp" },
  thanks: { title: "Valeu!" },
};

async function buildApp(opts = {}) {
  const repo = makeMemRepo();
  await repo.create("forms", { ...FORM });
  await repo.create("forms", { ...FORM, id: "fo_draft", status: "draft" });
  const app = Fastify();
  registerRoutes(app, repo, opts);
  return { app, repo };
}

const post = (app, body, id = "fo_test") =>
  app.inject({ method: "POST", url: `/public/forms/${id}/events`, payload: body });

test("POST /events grava view/start/step/submit; step exige key conhecida", async () => {
  const { app, repo } = await buildApp();

  assert.equal((await post(app, { session: "s1", event: "view" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "start" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "step", key: "niche" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "submit" })).statusCode, 201);

  // etapa desconhecida, evento inválido e sessão vazia → 400
  assert.equal((await post(app, { session: "s1", event: "step", key: "nada" })).statusCode, 400);
  assert.equal((await post(app, { session: "s1", event: "hack" })).statusCode, 400);
  assert.equal((await post(app, { event: "view" })).statusCode, 400);
  // rascunho não existe publicamente
  assert.equal((await post(app, { session: "s1", event: "view" }, "fo_draft")).statusCode, 404);

  const events = await repo.list("form_events");
  assert.equal(events.length, 4);
  assert.ok(events.every((e) => e.form === "fo_test" && e.saas === "leverads" && e.session === "s1"));
  // key só persiste em step (view/start/submit gravam vazio)
  assert.deepEqual(events.map((e) => e.key).sort(), ["", "", "", "niche"]);
  await app.close();
});

test("GET /funnel agrega sessões únicas por tela, na ordem do renderer", async () => {
  const { app } = await buildApp();

  // s1 completa; s2 para na 1ª pergunta; s3 abre e não começa.
  for (const [session, keys] of [["s1", ["niche", "accounts", "nome"]], ["s2", ["niche"]], ["s3", []]]) {
    await post(app, { session, event: "view" });
    if (keys.length) await post(app, { session, event: "start" });
    for (const key of keys) await post(app, { session, event: "step", key });
  }
  await post(app, { session: "s1", event: "submit" });
  // duplicata da mesma sessão/tela não infla a contagem
  await post(app, { session: "s2", event: "step", key: "niche" });

  const res = await app.inject({ method: "GET", url: "/api/forms/fo_test/funnel" });
  assert.equal(res.statusCode, 200);
  const f = res.json();
  assert.equal(f.views, 3);
  assert.equal(f.starts, 2);
  assert.equal(f.submits, 1);
  // nome+whatsapp dividem a tela → 3 telas, keyed pela 1ª pergunta de cada uma
  assert.deepEqual(f.steps.map((s) => s.key), ["niche", "accounts", "nome"]);
  assert.deepEqual(f.steps.map((s) => s.sessions), [2, 1, 1]);
  await app.close();
});

test("GET /funnel?since= filtra o período; form inexistente é 404", async () => {
  const { app, repo } = await buildApp();
  await repo.create("form_events", { form: "fo_test", saas: "leverads", session: "velha", event: "view", key: "", createdAt: "2020-01-01T00:00:00.000Z" });
  await post(app, { session: "nova", event: "view" });

  const all = (await app.inject({ method: "GET", url: "/api/forms/fo_test/funnel" })).json();
  assert.equal(all.views, 2);
  const recent = (await app.inject({ method: "GET", url: "/api/forms/fo_test/funnel?since=2025-01-01T00:00:00.000Z" })).json();
  assert.equal(recent.views, 1);

  assert.equal((await app.inject({ method: "GET", url: "/api/forms/fo_nada/funnel" })).statusCode, 404);
  await app.close();
});

test("rate-limit dos eventos é separado do de submissions", async () => {
  const { app } = await buildApp({ forms: { rateLimit: 1, eventRateLimit: 3 } });
  assert.equal((await post(app, { session: "s1", event: "view" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "start" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "step", key: "niche" })).statusCode, 201);
  assert.equal((await post(app, { session: "s1", event: "submit" })).statusCode, 429);
  await app.close();
});
