// Versões e novidades: versão no ar de cada app (falha de um não derruba os
// outros), CRUD só de admin das novidades e o recorte público que o LeverAds lê.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { appVersions } from "../src/releases/app-versions.js";
import { normalizeUpdate, publicUpdates } from "../src/releases/product-updates.js";
import { registerReleasesRoutes } from "../src/releases/routes.releases.js";

const ok = (body) => ({ ok: true, json: async () => body });

test("appVersions: LeverAds com workers, LeverId pelo GoTrue, LeverPrice sem versão; erro isolado", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts?.headers || {} });
    if (url === "https://ads.test/api/version") {
      return ok({ version: "2.59.0", commit: "abcdef1234567890", started_at: "2026-10-19T10:00:00Z",
        workers: [{ service: "worker", version: "2.59.0", commit: "abcdef1234567890" }] });
    }
    if (url === "https://id.test/auth/v1/health") return ok({ version: "v2.186.0", name: "GoTrue" });
    throw new Error("ECONNREFUSED");
  };
  const env = { LEVERADS_API_URL: "https://ads.test/", IDENTITY_AUTH_URL: "https://id.test/auth/v1",
    IDENTITY_SERVICE_KEY: "k", LEVERPRICE_API_URL: "https://price.test" };
  const { apps } = await appVersions({ fetchImpl, env });
  const by = Object.fromEntries(apps.map((a) => [a.id, a]));

  assert.deepEqual(apps.map((a) => a.id), ["cockpit", "leverads", "leverid", "leverprice"]);
  assert.match(by.cockpit.build, /^[0-9a-f]{12}$/);
  assert.equal(by.leverads.version, "2.59.0");
  assert.equal(by.leverads.commit, "abcdef123456");
  assert.equal(by.leverads.workers[0].service, "worker");
  assert.equal(by.leverid.version, "v2.186.0");
  assert.equal(calls.find((c) => c.url.startsWith("https://id.test")).headers.apikey, "k");
  assert.equal(by.leverprice.ok, false);
  assert.match(by.leverprice.error, /ECONNREFUSED/);
});

test("appVersions: app sem URL configurada aparece como não configurado", async () => {
  const fetchImpl = async () => ok({ version: "2.59.0" });
  const { apps } = await appVersions({ fetchImpl, env: { LEVERADS_API_URL: "https://ads.test" } });
  const leverid = apps.find((a) => a.id === "leverid");
  assert.deepEqual([leverid.ok, leverid.configured], [false, false]);
});

test("normalizeUpdate: valida, tira o 'v' da versão e fixa publishedAt na 1ª publicação", () => {
  assert.equal(normalizeUpdate({ saas: "x", title: "a" }).error, "produto inválido");
  assert.equal(normalizeUpdate({ saas: "leverads", title: " " }).error, "informe o título");
  assert.equal(normalizeUpdate({ saas: "leverads", title: "a", category: "boato" }).error, "categoria inválida");

  const t1 = () => new Date("2026-10-19T12:00:00Z");
  const { doc: draft } = normalizeUpdate({ saas: "leverads", title: "Amazon", version: "v2.59.0" }, null, { now: t1, author: "u1" });
  assert.deepEqual([draft.version, draft.status, draft.publishedAt, draft.author], ["2.59.0", "draft", "", "u1"]);

  const { doc: pub } = normalizeUpdate({ status: "published" }, draft, { now: t1 });
  assert.equal(pub.publishedAt, "2026-10-19T12:00:00.000Z");
  const later = () => new Date("2026-10-20T12:00:00Z");
  const { doc: edited } = normalizeUpdate({ body: "texto novo" }, { ...draft, ...pub }, { now: later });
  assert.equal(edited.publishedAt, pub.publishedAt, "editar não muda a data da novidade");
  assert.equal(normalizeUpdate({ status: "draft" }, { ...draft, ...pub }).doc.publishedAt, "", "rascunho sai do ar");
});

test("publicUpdates: só publicadas do produto, da mais nova, sem autor", () => {
  const all = [
    { id: "1", saas: "leverads", status: "published", publishedAt: "2026-10-01", title: "velha", author: "u" },
    { id: "2", saas: "leverads", status: "published", publishedAt: "2026-10-19", title: "nova", author: "u" },
    { id: "3", saas: "leverads", status: "draft", title: "rascunho" },
    { id: "4", saas: "leverprice", status: "published", publishedAt: "2026-10-18", title: "outro produto" },
  ];
  const out = publicUpdates(all, "leverads");
  assert.deepEqual(out.map((u) => u.id), ["2", "1"]);
  assert.equal("author" in out[0], false);
});

function buildApp(user) {
  const repo = makeMemRepo();
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.authUser = user; });
  registerReleasesRoutes(app, repo, { fetchImpl: async () => ok({ version: "2.59.0" }) });
  return { app, repo };
}

test("rotas: admin cria, publica e o público lê; não admin recebe 403", async () => {
  const { app } = buildApp({ id: "u1", roles: ["admin"] });
  const created = await app.inject({ method: "POST", url: "/api/releases/updates",
    payload: { saas: "leverads", title: "Cópia para a Amazon", body: "Agora dá.", version: "2.59.0" } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  assert.deepEqual((await app.inject({ url: "/public/updates/leverads" })).json(), { items: [] }, "rascunho não sai");

  const pub = await app.inject({ method: "PATCH", url: `/api/releases/updates/${id}`, payload: { status: "published" } });
  assert.equal(pub.statusCode, 200);
  const items = (await app.inject({ url: "/public/updates/leverads" })).json().items;
  assert.deepEqual(items.map((i) => i.title), ["Cópia para a Amazon"]);
  assert.equal((await app.inject({ url: "/public/updates/nao-existe" })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/releases/updates/${id}` })).statusCode, 200);

  const { app: other } = buildApp({ id: "u2", roles: [] });
  assert.equal((await other.inject({ url: "/api/releases/apps" })).statusCode, 403);
  assert.equal((await other.inject({ method: "POST", url: "/api/releases/updates", payload: {} })).statusCode, 403);
  assert.equal((await other.inject({ url: "/public/updates/leverads" })).statusCode, 200, "o recorte público é aberto");
});
