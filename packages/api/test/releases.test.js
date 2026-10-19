// Versões e novidades: versão no ar de cada app (falha de um não derruba os
// outros), as regras de publicação (feature com print e passo a passo, correção
// curta, nunca dado de cliente), os prints e o recorte público que o LeverAds lê.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
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

const IMG = { url: "/public/updates/assets/pua_00000000-0000-4000-8000-000000000001", caption: "A tela nova" };
const FEATURE = {
  saas: "leverads", title: "Cópia para a Amazon", body: "Agora dá pra copiar para a Amazon.", category: "novo",
  steps: ["Abra Copiar", "Escolha a conta da Amazon"], images: [IMG], linkPath: "/copy", linkLabel: "Abrir Copiar",
};

test("normalizeUpdate: valida, limpa e fixa publishedAt na 1ª publicação", () => {
  assert.equal(normalizeUpdate({ saas: "x", title: "a" }).error, "produto inválido");
  assert.equal(normalizeUpdate({ saas: "leverads", title: " " }).error, "informe o título");
  assert.equal(normalizeUpdate({ saas: "leverads", title: "a", category: "boato" }).error, "categoria inválida");

  const t1 = () => new Date("2026-10-19T12:00:00Z");
  const { doc: draft } = normalizeUpdate({
    ...FEATURE, version: "v2.59.0", steps: "1. Abra Copiar\n- Escolha a conta\n\n",
    images: [IMG, { url: "https://fora.test/x.png" }], linkPath: "javascript:alert(1)",
  }, null, { now: t1, author: "u1" });
  assert.deepEqual([draft.version, draft.status, draft.publishedAt, draft.author], ["2.59.0", "draft", "", "u1"]);
  assert.deepEqual(draft.steps, ["Abra Copiar", "Escolha a conta"], "numeração e marcador saem, linha vazia some");
  assert.deepEqual(draft.images, [IMG], "só print subido aqui");
  assert.equal(draft.linkPath, "", "atalho só para caminho do app");

  const { doc: pub } = normalizeUpdate({ ...FEATURE, status: "published" }, draft, { now: t1 });
  assert.equal(pub.publishedAt, "2026-10-19T12:00:00.000Z");
  const later = () => new Date("2026-10-20T12:00:00Z");
  const { doc: edited } = normalizeUpdate({ body: "texto novo" }, { ...draft, ...pub }, { now: later });
  assert.equal(edited.publishedAt, pub.publishedAt, "editar não muda a data da novidade");
  assert.equal(normalizeUpdate({ status: "draft" }, { ...draft, ...pub }).doc.publishedAt, "", "rascunho sai do ar");
});

test("publicar: feature exige resumo, passo a passo e print; rascunho aceita incompleto", () => {
  const pub = (over) => normalizeUpdate({ ...FEATURE, status: "published", ...over });
  assert.match(pub({ images: [] }).error, /ao menos 1 print/);
  assert.match(pub({ steps: [] }).error, /passo a passo/);
  assert.match(pub({ body: "" }).error, /resumo/);
  assert.equal(pub({}).error, undefined);
  assert.equal(normalizeUpdate({ ...FEATURE, images: [], steps: [] }).error, undefined, "rascunho incompleto pode");
});

test("publicar: correção é nota curta, sem print nem passos", () => {
  const fix = { saas: "leverads", title: "Fotos voltaram a carregar", body: "As fotos da aba Editar carregam de novo.",
    category: "correcao", status: "published" };
  assert.equal(normalizeUpdate(fix).error, undefined);
  assert.match(normalizeUpdate({ ...fix, images: [IMG] }).error, /sem print/);
  assert.match(normalizeUpdate({ ...fix, body: "x".repeat(281) }).error, /até 280/);
});

test("publicar: recusa texto com dado de cliente", () => {
  const pub = (body) => normalizeUpdate({ ...FEATURE, body, status: "published" }).error || "";
  assert.match(pub("Pedido da loja contato@cliente.com.br"), /e-mail/);
  assert.match(pub("CNPJ 12.345.678/0001-90 liberado"), /CNPJ/);
  assert.match(pub("Ligue (11) 98765-4321"), /telefone/);
  assert.match(pub("O anúncio MLB1234567890 voltou"), /id de anúncio/);
  assert.equal(pub("Cópias até 8.000 por dia na versão 2.59.0"), "", "número comum não é dado de cliente");
  const nosPassos = normalizeUpdate({ ...FEATURE, status: "published", steps: ["Mande para joao@x.com"] }).error;
  assert.match(nosPassos, /e-mail/, "vale para os passos");
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

async function buildApp(user) {
  const repo = makeMemRepo();
  const app = Fastify();
  await app.register(multipart);
  app.addHook("onRequest", async (req) => { req.authUser = user; });
  registerReleasesRoutes(app, repo, { fetchImpl: async () => ok({ version: "2.59.0" }) });
  return { app, repo };
}

function upload(app, name, mime, bytes) {
  const boundary = "----prova";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return app.inject({ method: "POST", url: "/api/releases/assets", payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
}

test("rotas: admin sobe print, cria, publica e o público lê; não admin recebe 403", async () => {
  const { app } = await buildApp({ id: "u1", roles: ["admin"] });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const up = await upload(app, "tela.png", "image/png", png);
  assert.equal(up.statusCode, 201);
  const { url } = up.json();
  const served = await app.inject({ url });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.deepEqual(served.rawPayload, png);
  assert.equal((await upload(app, "x.txt", "text/plain", Buffer.from("oi"))).statusCode, 400);

  const created = await app.inject({ method: "POST", url: "/api/releases/updates",
    payload: { ...FEATURE, images: [{ url, caption: "A tela" }], version: "2.59.0" } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id;
  assert.deepEqual((await app.inject({ url: "/public/updates/leverads" })).json(), { items: [] }, "rascunho não sai");

  const pub = await app.inject({ method: "PATCH", url: `/api/releases/updates/${id}`, payload: { status: "published" } });
  assert.equal(pub.statusCode, 200);
  const [item] = (await app.inject({ url: "/public/updates/leverads" })).json().items;
  assert.equal(item.title, "Cópia para a Amazon");
  assert.deepEqual(item.steps, FEATURE.steps);
  assert.equal(item.images[0].url, url);
  assert.equal("author" in item, false);
  assert.equal((await app.inject({ url: "/public/updates/nao-existe" })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/releases/updates/${id}` })).statusCode, 200);

  const { app: other } = await buildApp({ id: "u2", roles: [] });
  assert.equal((await other.inject({ url: "/api/releases/apps" })).statusCode, 403);
  assert.equal((await other.inject({ method: "POST", url: "/api/releases/updates", payload: {} })).statusCode, 403);
  assert.equal((await upload(other, "tela.png", "image/png", png)).statusCode, 403);
  assert.equal((await other.inject({ url: "/public/updates/leverads" })).statusCode, 200, "o recorte público é aberto");
});
