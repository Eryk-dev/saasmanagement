// Cases (prova social): o gate de publicação, a escolha por nicho, o que sai
// pro público e o JSON aberto que o site consome.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { validateCase, publishBlockers, canPublish, publicCase, pickCases } from "../src/cases.js";
import { registerCaseRoutes } from "../src/routes.cases.js";
import { ensureKnownCases } from "../src/migrations.js";

const completo = (over = {}) => ({
  id: "ca_1", saas: "leverads", customerId: "cu_1", name: "Lupa Auto Peças", niche: "autopecas",
  headline: "Espelhou o catálogo em 3 contas",
  metrics: [{ label: "vendidos pelos anúncios da Lever", value: "R$ 82 mil", period: "últimos 30 dias", source: "painel", proofUrl: "https://x/print.png" }],
  quote: "Em duas semanas o catálogo estava nas três contas.", quoteAuthor: "Ana",
  authorizedAt: "2026-09-01", authorizedBy: "eryk", authorizedVia: "whatsapp",
  public: true, order: 1, ...over,
});

// ── Gate ──────────────────────────────────────────────────────────────────
test("publishBlockers: sem autorização, sem número ou sem fonte não publica", () => {
  assert.deepEqual(publishBlockers(completo()), []);
  assert.deepEqual(publishBlockers(completo({ authorizedAt: "" })), ["a autorização do cliente (data)"]);
  assert.deepEqual(publishBlockers(completo({ metrics: [] })), ["pelo menos um número"]);
  assert.deepEqual(publishBlockers(completo({ metrics: [{ label: "vendas", value: "+105%" }] })),
    ["a fonte de cada número (painel, print ou o próprio cliente)"]);
  assert.deepEqual(publishBlockers(completo({ name: "", niche: "" })), ["o nome do cliente", "o nicho"]);
  assert.equal(canPublish(completo()), true);
});

test("validateCase: corta campo longo, descarta fonte inválida e força tipos", () => {
  const v = validateCase({ name: "x".repeat(200), public: "sim", order: "3", metrics: [{ label: "a", value: "1", source: "inventada" }, { label: "", value: "" }] });
  assert.equal(v.name.length, 80);
  assert.equal(v.public, false); // só `true` literal publica
  assert.equal(v.order, 3);
  assert.equal(v.metrics.length, 1); // métrica vazia sai
  assert.equal(v.metrics[0].source, "");
});

// ── Público ───────────────────────────────────────────────────────────────
test("publicCase: não vaza cliente do cockpit, print da prova nem contato", () => {
  const pub = publicCase(completo());
  assert.deepEqual(Object.keys(pub).sort(), ["headline", "logoUrl", "metrics", "name", "niche", "order", "quote", "quoteAuthor"]);
  assert.equal(pub.customerId, undefined);
  assert.equal(pub.metrics[0].proofUrl, undefined);
  assert.equal(pub.metrics[0].source, "painel");
});

// ── Escolha pro deck ──────────────────────────────────────────────────────
test("pickCases: nicho do lead primeiro, depois a ordem do time", () => {
  const lista = [
    completo({ id: "a", name: "Moda A", niche: "moda", order: 1 }),
    completo({ id: "b", name: "Auto B", niche: "autopecas", order: 5 }),
    completo({ id: "c", name: "Auto C", niche: "AutoPeças ", order: 2 }),
    completo({ id: "d", name: "Casa D", niche: "casa", order: 0 }),
  ];
  const r = pickCases(lista, { niche: "autopecas", limit: 4 });
  assert.deepEqual(r.map((c) => c.name), ["Auto C", "Auto B", "Casa D", "Moda A"]);
  assert.equal(pickCases(lista, { niche: "autopecas", limit: 2 }).length, 2);
});

test("pickCases: rascunho e case sem autorização ficam de fora", () => {
  const lista = [
    completo({ id: "a", name: "Público" }),
    completo({ id: "b", name: "Rascunho", public: false }),
    completo({ id: "c", name: "Sem autorização", authorizedAt: "" }),
    completo({ id: "d", name: "Sem fonte", metrics: [{ label: "x", value: "1" }] }),
  ];
  assert.deepEqual(pickCases(lista).map((c) => c.name), ["Público"]);
  assert.deepEqual(pickCases([]), []);
});

// ── Rotas ─────────────────────────────────────────────────────────────────
async function buildApp(repo, over = {}) {
  const app = Fastify();
  registerCaseRoutes(app, repo, { influenced: async () => new Map([["org-1", 82000]]), ...over });
  await app.ready();
  return app;
}

test("rascunho a partir do cliente já vem com o número do painel", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "ld_1", niche: "autopecas" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa", contact: "Ana", leadId: "ld_1", leveradsOrgId: "org-1" });
  const app = await buildApp(repo);
  const r = await app.inject({ method: "POST", url: "/api/cases/from-customer", payload: { customer: "cu_1" } });
  assert.equal(r.statusCode, 201);
  const doc = r.json();
  assert.equal(doc.name, "Lupa");
  assert.equal(doc.niche, "autopecas");
  assert.equal(doc.quoteAuthor, "Ana");
  assert.equal(doc.public, false);
  assert.equal(doc.metrics[0].source, "painel");
  assert.match(doc.metrics[0].value, /R\$ 82\.000/);
  assert.ok(doc.blockers.includes("a autorização do cliente (data)"));
  await app.close();
});

test("publicar sem autorização dá 422 dizendo o que falta", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1", public: false, authorizedAt: "" }));
  const app = await buildApp(repo);
  const r = await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: true } });
  assert.equal(r.statusCode, 422);
  assert.deepEqual(r.json().blockers, ["a autorização do cliente (data)"]);
  assert.equal((await repo.get("cases", "ca_1")).public, false);
  await app.close();
});

test("com autorização publica, e despublicar volta pra rascunho", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1", public: false }));
  const app = await buildApp(repo);
  assert.equal((await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: true } })).statusCode, 200);
  assert.equal((await repo.get("cases", "ca_1")).public, true);
  await app.inject({ method: "POST", url: "/api/cases/ca_1/publish", payload: { public: false } });
  assert.equal((await repo.get("cases", "ca_1")).public, false);
  await app.close();
});

test("JSON público sai com cache, sem campo interno, e nunca estoura", async () => {
  const repo = makeMemRepo();
  await repo.create("cases", completo({ id: "ca_1" }));
  await repo.create("cases", completo({ id: "ca_2", name: "Rascunho", public: false }));
  const app = await buildApp(repo);
  const r = await app.inject({ url: "/public/cases.json" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["cache-control"], /max-age=300/);
  assert.match(r.headers["cache-control"], /stale-while-revalidate=3600/);
  assert.equal(r.json().count, 1);
  assert.equal(r.json().cases[0].name, "Lupa Auto Peças");
  assert.equal(r.json().cases[0].customerId, undefined);
  await app.close();

  // Banco fora do ar: devolve lista vazia, não 5xx (o EasyPanel engole 5xx e o
  // site perderia a seção inteira).
  const quebrado = { ...makeMemRepo(), list: async () => { throw new Error("db down"); } };
  const app2 = await buildApp(quebrado);
  const r2 = await app2.inject({ url: "/public/cases.json" });
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.json().cases, []);
  await app2.close();
});

// ── Migração ──────────────────────────────────────────────────────────────
test("migração: cases conhecidos entram em rascunho e não duplicam", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureKnownCases(repo), 3);
  const todos = await repo.list("cases");
  assert.deepEqual(todos.map((c) => c.name).sort(), ["Dyno Nutri", "Unicoox", "Unique"]);
  assert.ok(todos.every((c) => c.public === false), "nenhum nasce público");
  assert.ok(todos.every((c) => publishBlockers(c).length > 0), "todos exigem conferência antes de publicar");
  assert.equal(await ensureKnownCases(repo), 0);
});
