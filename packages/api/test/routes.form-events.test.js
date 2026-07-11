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

// ── Teste A/B da welcome: variante nos eventos, funil por variante, lead carimbado ──

test("eventos com variant → funil ganha o recorte por variante (view/começar/envio)", async () => {
  const { app } = await buildApp();
  // A: 2 visitas, 2 começam, 1 envia · B: 2 visitas, 1 começa, 0 enviam
  for (const [session, variant, start, submit] of [
    ["a1", "A", true, true], ["a2", "A", true, false],
    ["b1", "B", true, false], ["b2", "B", false, false],
  ]) {
    await post(app, { session, event: "view", variant });
    if (start) await post(app, { session, event: "start", variant });
    if (submit) await post(app, { session, event: "submit", variant });
  }
  // sessão SEM variante (form aberto antes do teste começar) não entra no recorte
  await post(app, { session: "s0", event: "view" });

  const f = (await app.inject({ method: "GET", url: "/api/forms/fo_test/funnel" })).json();
  assert.equal(f.views, 5);
  assert.deepEqual(f.variants, [
    { id: "A", sessions: 2, views: 2, starts: 2, submits: 1 },
    { id: "B", sessions: 2, views: 2, starts: 1, submits: 0 },
  ]);
  await app.close();
});

test("submission com variant carimba lead.formVariant e a submission", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({
    method: "POST", url: "/public/forms/fo_test/submissions",
    payload: {
      answers: { niche: "moda", accounts: "2", nome: "Ana", whatsapp: "41999990000" },
      variant: "B",
    },
  });
  assert.equal(res.statusCode, 201);
  const lead = (await repo.list("leads"))[0];
  assert.equal(lead.formVariant, "B");
  const sub = (await repo.list("form_submissions"))[0];
  assert.equal(sub.variant, "B");
  await app.close();
});

// ── Welcome por DOR (anúncio → headline) ─────────────────────────────────────

test("/f/:id resolve a dor do utm_content e injeta a welcome da dor (byPain fora do payload)", async () => {
  const { app, repo } = await buildApp();
  await repo.update("forms", "fo_test", {
    welcome: {
      title: "Base", button: "Começar",
      byPain: { B: { title: "Conta banida? A gente resolve.", button: "Quero operar seguro", variants: [{ id: "B-A", title: "v1 da dor B" }] } },
    },
  });
  // anúncio sincronizado com código de dor no nome
  await repo.create("ad_insights", { id: "x9", saas: "leverads", campaignId: "c1", adId: "ad9", adName: "1303 [B]", date: "2026-07-01", spend: 1 });

  const withPain = await app.inject({ url: "/f/fo_test?utm_content=ad9" });
  assert.equal(withPain.statusCode, 200);
  assert.ok(withPain.body.includes("Conta banida? A gente resolve."), "welcome da dor B injetada");
  assert.ok(withPain.body.includes('window.__PAIN__ = "B"'));
  assert.ok(!withPain.body.includes("byPain"), "as outras copies não vazam pro client");

  const noPain = await app.inject({ url: "/f/fo_test" });
  assert.ok(noPain.body.includes("Base"), "sem utm resolvível cai na welcome base");
  assert.ok(noPain.body.includes('window.__PAIN__ = ""'));
  await app.close();
});

test("funil separa variantes por dor (mesmo id em dores diferentes não colide)", async () => {
  const { app } = await buildApp();
  await post(app, { session: "p1", event: "view", variant: "V1", pain: "B" });
  await post(app, { session: "p1", event: "start", variant: "V1", pain: "B" });
  await post(app, { session: "p2", event: "view", variant: "V1" }); // base, sem dor
  const f = (await app.inject({ method: "GET", url: "/api/forms/fo_test/funnel" })).json();
  assert.deepEqual(f.variants, [
    { id: "V1", pain: "B", sessions: 1, views: 1, starts: 1, submits: 0 },
    { id: "V1", sessions: 1, views: 1, starts: 0, submits: 0 },
  ]);
  await app.close();
});
