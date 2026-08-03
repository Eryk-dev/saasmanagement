// Beacon das landing pages (/public/lp/events) + resumo (/api/lp/summary) +
// visão do app (/api/elo/overview). O banco do Elo (ELO_DB_URL) não existe em
// teste — o resumo responde a parte de visitas e a visão responde
// { configured: false }.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp() {
  delete process.env.ELO_DB_URL;
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const view = (over = {}) => ({
  saas: "elo", page: "lp", event: "view", session: "s1",
  utm: { source: "meta", campaign: "flyer" },
  ...over,
});

test("beacon grava view com utm sanitizada", async () => {
  const { app, repo } = await buildApp();
  const res = await app.inject({ method: "POST", url: "/public/lp/events", payload: view() });
  assert.equal(res.statusCode, 201);
  const events = await repo.list("lp_events");
  assert.equal(events.length, 1);
  assert.equal(events[0].saas, "elo");
  assert.equal(events[0].page, "lp");
  assert.equal(events[0].utm.source, "meta");
  assert.equal(events[0].utm.campaign, "flyer");
});

test("beacon rejeita evento inválido e sessão vazia", async () => {
  const { app } = await buildApp();
  const bad = await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ event: "hack" }) });
  assert.equal(bad.statusCode, 400);
  const noSession = await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "" }) });
  assert.equal(noSession.statusCode, 400);
});

test("visita sem utm ganha origem derivada do referrer", async () => {
  const { app, repo } = await buildApp();
  await app.inject({
    method: "POST", url: "/public/lp/events",
    payload: view({ utm: null, referrer: "https://l.instagram.com/algo" }),
  });
  const [e] = await repo.list("lp_events");
  assert.equal(e.utm.source, "instagram");
});

test("pathname vira página normalizada", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ page: "/checkout/" }) });
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ page: "" }) });
  const events = await repo.list("lp_events");
  assert.deepEqual(events.map((e) => e.page).sort(), ["checkout", "home"]);
});

test("resumo agrega sessões únicas por página, origem e CTA", async () => {
  const { app } = await buildApp();
  // Sessão A: viu a LP duas vezes (1 sessão) e clicou num CTA.
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "a" }) });
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "a" }) });
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "a", event: "cta", label: "checkout hero" }) });
  // Sessão B: chegou direto no checkout.
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "b", page: "checkout", utm: null }) });

  const res = await app.inject({ method: "GET", url: "/api/lp/summary?saas=elo&days=7" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.configured, false);
  assert.equal(body.conversions, null);
  const lp = body.pages.find((p) => p.page === "lp");
  assert.equal(lp.sessions, 1);
  assert.equal(lp.ctaClicks, 1);
  const checkout = body.pages.find((p) => p.page === "checkout");
  assert.equal(checkout.sessions, 1);
  assert.equal(body.sources.find((s) => s.source === "meta").sessions, 1);
  assert.equal(body.sources.find((s) => s.source === "(direto)").sessions, 1);
  assert.deepEqual(body.ctaLabels, [{ label: "checkout hero", clicks: 1 }]);
});

test("visão do app sem ELO_DB_URL responde configured:false", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: "/api/elo/overview?days=30" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { configured: false });
});
