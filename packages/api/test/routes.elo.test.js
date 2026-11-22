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

test("beacon grava funil (f) e palavra (utm_content) normalizados", async () => {
  const { app, repo } = await buildApp();
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ page: "/lp/m3/", f: "LP", utm_content: "Ciume" }) });
  await app.inject({ method: "POST", url: "/public/lp/events", payload: view({ session: "x", f: "tiktok", utm: { source: "instagram", content: "com espaço" } }) });
  const [a, b] = await repo.list("lp_events");
  assert.equal(a.funnel, "lp");
  assert.equal(a.utm.content, "ciume");
  assert.equal(b.funnel, undefined, "funil fora do enum é descartado");
  assert.equal(b.utm.content, undefined, "palavra fora do padrão é descartada");
  assert.equal(b.utm.source, "instagram");
});

test("resumo agrega funis (só página de entrada) e palavras", async () => {
  const { app } = await buildApp();
  const dm = (over) => view({ utm: { source: "instagram", medium: "dm" }, utm_content: "teste", ...over });
  const post = (payload) => app.inject({ method: "POST", url: "/public/lp/events", payload });
  // lp: entrou na LP, clicou no CTA e foi pro checkout (checkout não conta como sessão do funil)
  await post(dm({ session: "l1", page: "/lp/m2/", f: "lp" }));
  await post(dm({ session: "l1", page: "/lp/m2/", f: "lp", event: "cta" }));
  await post(dm({ session: "c1", page: "/checkout/", f: "lp" }));
  // form: quiz; app: /app com redirect automático (cta)
  await post(dm({ session: "q1", page: "/quiz/", f: "form" }));
  await post(dm({ session: "a1", page: "/app", f: "app", utm_content: "mapa" }));
  await post(dm({ session: "a1", page: "/app", f: "app", utm_content: "mapa", event: "cta" }));
  // visita sem funil não entra na tabela de funis
  await post(view({ session: "o1" }));

  const body = (await app.inject({ method: "GET", url: "/api/lp/summary?saas=elo&days=7" })).json();
  const f = Object.fromEntries(body.funnels.map((x) => [x.funnel, x]));
  assert.deepEqual(f.lp, { funnel: "lp", sessions: 1, ctaSessions: 1, checkoutSessions: 1 });
  assert.equal(f.form.sessions, 1);
  assert.equal(f.app.ctaSessions, 1);
  const w = Object.fromEntries(body.palavras.map((x) => [x.palavra, x]));
  assert.equal(w.teste.sessions, 2);
  assert.equal(w.teste.byFunnel.lp.ctaSessions, 1);
  assert.equal(w.mapa.byFunnel.app.sessions, 1);
});
