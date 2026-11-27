// Espião por business_discovery, post a post (robô Spy do OpenBot): o cliente
// Graph pede legenda, link, tipo e visualização de Reels, pagina pelo cursor
// `after` e diz quando a curtida está escondida; a rota
// GET /api/social/discovery/posts valida a lista, isola o erro de cada perfil
// e guarda a resposta por pouco tempo.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeSocial } = await import("../src/marketing/social.js");
const { registerSocialRoutes } = await import("../src/marketing/routes.social.js");

function graphFetch(pages) {
  const calls = [];
  const f = async (url) => {
    calls.push(decodeURIComponent(String(url)));
    const body = pages.shift();
    return { status: body?.error ? 400 : 200, text: async () => JSON.stringify(body ?? {}) };
  };
  f.calls = calls;
  return f;
}

const media = (n, extra = {}) => ({
  id: `m${n}`, caption: `legenda ${n}`, like_count: 100 + n, comments_count: n, timestamp: `2026-11-${String(10 + n).padStart(2, "0")}T12:00:00+0000`,
  permalink: `https://www.instagram.com/p/C${n}/`, media_type: "VIDEO", media_product_type: "REELS", view_count: 1000 * n, ...extra,
});

test("igBusinessDiscovery: pede legenda, link, tipo e view_count; mapeia; curtida escondida não vira zero calado", async () => {
  const f = graphFetch([{ business_discovery: {
    username: "gabrielbollico", name: "Gabriel", followers_count: 298079, media_count: 4100,
    media: { data: [media(1), media(2, { like_count: undefined, media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", view_count: undefined })] },
  } }]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const d = await s.igBusinessDiscovery("ig1", "@gabrielbollico", { posts: true });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /business_discovery\.username\(gabrielbollico\)\{username,name,followers_count,media_count,media\.limit\(12\)\{id,caption,like_count,comments_count,timestamp,permalink,media_type,media_product_type,view_count\}\}/);
  assert.equal(d.followers, 298079);
  assert.deepEqual(d.recent[0], {
    likes: 101, comments: 1, at: "2026-11-11T12:00:00+0000", id: "m1", caption: "legenda 1", link: "https://www.instagram.com/p/C1/",
    type: "VIDEO", surface: "REELS", views: 1000, likesHidden: false,
  });
  assert.equal(d.recent[1].likes, 0);          // como sempre foi (a média da tela não muda)
  assert.equal(d.recent[1].likesHidden, true); // mas quem lê sabe que não é zero
  assert.equal(d.recent[1].views, null);       // carrossel não tem visualização
  assert.equal(d.recent[1].type, "CAROUSEL_ALBUM");
});

test("igBusinessDiscovery: sem `posts` (a tela de concorrentes) a chamada e a resposta são as de sempre", async () => {
  const f = graphFetch([{ business_discovery: { username: "a", followers_count: 5, media: { data: [media(1)], paging: { cursors: { after: "AAA" } } } } }]);
  const d = await makeSocial({ fetch: f, accessToken: "tok" }).igBusinessDiscovery("ig1", "a", { limit: 50 });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /fields=business_discovery\.username\(a\)\{username,name,followers_count,media_count,media\.limit\(12\)\{like_count,comments_count,timestamp\}\}&/);
  assert.deepEqual(d.recent, [{ likes: 101, comments: 1, at: "2026-11-11T12:00:00+0000" }]);
});

test("igBusinessDiscovery: limit 30 pagina com media.after(cursor) e para no limite", async () => {
  const first = Array.from({ length: 25 }, (_, i) => media(i + 1));
  const second = Array.from({ length: 25 }, (_, i) => media(i + 26));
  const f = graphFetch([
    { business_discovery: { username: "a", media: { data: first, paging: { cursors: { after: "QVFIUabc-_=" } } } } },
    { business_discovery: { username: "a", media: { data: second.slice(0, 5), paging: { cursors: { after: "QVFIUdef" } } } } },
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const d = await s.igBusinessDiscovery("ig1", "a", { limit: 30, posts: true });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0], /media\.limit\(25\)\{/);
  assert.match(f.calls[1], /media\.after\(QVFIUabc-_=\)\.limit\(5\)\{/);
  assert.equal(d.recent.length, 30);
  assert.equal(d.recent[29].id, "m30");
});

test("igBusinessDiscovery: sem cursor, cursor estranho ou página vazia param a paginação", async () => {
  for (const paging of [undefined, { cursors: {} }, { cursors: { after: "x){id}}&access_token=y" } }]) {
    const f = graphFetch([{ business_discovery: { username: "a", media: { data: [media(1)], paging } } }]);
    const d = await makeSocial({ fetch: f, accessToken: "tok" }).igBusinessDiscovery("ig1", "a", { limit: 50, posts: true });
    assert.equal(f.calls.length, 1);
    assert.equal(d.recent.length, 1);
  }
  const f = graphFetch([
    { business_discovery: { username: "a", media: { data: [media(1)], paging: { cursors: { after: "AAA" } } } } },
    { business_discovery: { username: "a", media: { data: [], paging: { cursors: { after: "BBB" } } } } },
  ]);
  const d = await makeSocial({ fetch: f, accessToken: "tok" }).igBusinessDiscovery("ig1", "a", { limit: 50, posts: true });
  assert.equal(f.calls.length, 2);
  assert.equal(d.recent.length, 1);
});

test("igBusinessDiscovery: 2ª página com erro da Meta fica com a 1ª, em vez de perder o perfil", async () => {
  const f = graphFetch([
    { business_discovery: { username: "a", followers_count: 9, media: { data: [media(1), media(2)], paging: { cursors: { after: "AAA" } } } } },
    { error: { message: "(#4) Application request limit reached" } },
  ]);
  const d = await makeSocial({ fetch: f, accessToken: "tok" }).igBusinessDiscovery("ig1", "a", { limit: 50, posts: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(d.recent.map((m) => m.id), ["m1", "m2"]);
  assert.equal(d.followers, 9);
});

test("igBusinessDiscovery: conta pessoal, inexistente ou nome inválido falham com motivo", async () => {
  const s = makeSocial({ fetch: graphFetch([{}]), accessToken: "tok" });
  await assert.rejects(() => s.igBusinessDiscovery("ig1", "pessoal"), /não é business\/creator/);
  await assert.rejects(() => s.igBusinessDiscovery("ig1", "@@@"), /conta inválida/);
  const g = makeSocial({ fetch: graphFetch([{ error: { message: "Invalid user id" } }]), accessToken: "tok" });
  await assert.rejects(() => g.igBusinessDiscovery("ig1", "sumiu"), /Meta API -> 400: Invalid user id/);
});

function app({ product = { id: "leverads", name: "LeverAds", metaIgUser: "ig1" }, discovery, configured = true } = {}) {
  const repo = makeMemRepo();
  const hits = [];
  const social = {
    configured: () => configured,
    async igBusinessDiscovery(ig, u, opts) {
      hits.push([ig, u, opts]);
      return discovery(u, opts);
    },
  };
  const a = Fastify();
  registerSocialRoutes(a, repo, { social, meta: { discoverCreativeDefaults: async () => null } });
  return { a, repo, hits, ready: product ? repo.create("products", product) : Promise.resolve() };
}

const okDiscovery = (u) => ({ username: u, name: u.toUpperCase(), followers: 10, mediaCount: 3, recent: [{ id: `${u}-1`, likes: 5, likesHidden: false }] });

test("rota discovery/posts: um perfil que falha não derruba os outros; limite e lista normalizados", async () => {
  const { a, hits, ready } = app({ discovery: (u) => { if (u === "sumiu") throw new Error("conta não encontrada ou não é business/creator"); return okDiscovery(u); } });
  await ready;
  const r = await a.inject({ method: "GET", url: "/api/social/discovery/posts?saas=leverads&usernames=@GabrielBollico,%20sumiu,gabrielbollico&limit=999" });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.configured, true);
  assert.match(body.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(body.profiles.map((p) => p.username), ["gabrielbollico", "sumiu"]);
  assert.deepEqual(body.profiles[0].posts, [{ id: "gabrielbollico-1", likes: 5, likesHidden: false }]);
  assert.equal(body.profiles[0].followers, 10);
  assert.equal(body.profiles[1].error, "conta não encontrada ou não é business/creator");
  assert.deepEqual(hits.map((h) => [h[0], h[1], h[2]]), [["ig1", "gabrielbollico", { limit: 50, posts: true }], ["ig1", "sumiu", { limit: 50, posts: true }]]);
});

test("rota discovery/posts: lista vazia, grande demais ou com nome inválido é 400", async () => {
  const { a, hits, ready } = app({ discovery: okDiscovery });
  await ready;
  const many = Array.from({ length: 11 }, (_, i) => `p${i}`).join(",");
  for (const q of ["", "usernames=", `usernames=${many}`, "usernames=a,b)c", "usernames=a%7Bb", `usernames=${"x".repeat(31)}`]) {
    const r = await a.inject({ method: "GET", url: `/api/social/discovery/posts?saas=leverads&${q}` });
    assert.equal(r.statusCode, 400, q);
  }
  assert.equal(hits.length, 0);
});

test("rota discovery/posts: produto, Meta e IG que faltam", async () => {
  const none = app({ product: null, discovery: okDiscovery });
  assert.equal((await none.a.inject({ method: "GET", url: "/api/social/discovery/posts?saas=leverads&usernames=a" })).statusCode, 404);
  const off = app({ discovery: okDiscovery, configured: false });
  await off.ready;
  assert.deepEqual((await off.a.inject({ method: "GET", url: "/api/social/discovery/posts?saas=leverads&usernames=a" })).json(), { configured: false });
  const noIg = app({ product: { id: "leverads", name: "LeverAds" }, discovery: okDiscovery });
  await noIg.ready;
  const r = (await noIg.a.inject({ method: "GET", url: "/api/social/discovery/posts?saas=leverads&usernames=a" })).json();
  assert.equal(r.errors.setup, "sem Instagram configurado");
  assert.equal(noIg.hits.length, 0);
});

test("rota discovery/posts: 2ª chamada sai do cache; refresh=1 e lista nova batem na Graph", async () => {
  const { a, hits, ready } = app({ discovery: okDiscovery });
  await ready;
  const url = "/api/social/discovery/posts?saas=leverads&usernames=a,b";
  assert.equal((await a.inject({ method: "GET", url })).headers["x-cache"], "miss");
  assert.equal((await a.inject({ method: "GET", url })).headers["x-cache"], "hit");
  assert.equal(hits.length, 2);
  await a.inject({ method: "GET", url: url + "&refresh=1" });
  assert.equal(hits.length, 4);
  await a.inject({ method: "GET", url: "/api/social/discovery/posts?saas=leverads&usernames=a,b,c" });
  assert.equal(hits.length, 7);
});
