// Mídia social — cliente Graph (containers do IG, carrossel, story, reel com
// poll de processamento, página do FB com page token) e rotas (upload de asset
// com URL pública, serve sem auth, publish com histórico em social_posts).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeSocial } = await import("../src/social.js");
const { registerSocialRoutes } = await import("../src/routes.social.js");

// fetch fake do Graph: grava a sequência de chamadas e responde por padrão de URL.
function makeGraphFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const call = { method, url: String(url), body };
    calls.push(call);
    for (const [match, responder] of routes) {
      if (call.url.includes(match) && (typeof responder !== "object" || !responder.method || responder.method === method)) {
        const out = typeof responder === "function" ? responder(call) : responder;
        return { status: 200, text: async () => JSON.stringify(out) };
      }
    }
    return { status: 404, text: async () => JSON.stringify({ error: { message: `sem rota fake pra ${method} ${url}` } }) };
  };
  f.calls = calls;
  return f;
}

test("publishInstagram: imagem de feed = container(image_url+caption) → publish → permalink", async () => {
  const f = makeGraphFetch([
    ["/media_publish", { id: "m1" }],
    ["/m1?", { permalink: "https://www.instagram.com/p/x/" }],
    ["/ig1/media", { id: "c1" }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const r = await s.publishInstagram("ig1", { format: "feed", kind: "image", items: [{ url: "https://pub/img.png" }], caption: "legenda" });
  assert.equal(r.id, "m1");
  assert.equal(r.permalink, "https://www.instagram.com/p/x/");
  const create = f.calls.find((c) => c.url.endsWith("/ig1/media"));
  assert.equal(create.body.image_url, "https://pub/img.png");
  assert.equal(create.body.caption, "legenda");
  const publish = f.calls.find((c) => c.url.endsWith("/media_publish"));
  assert.equal(publish.body.creation_id, "c1");
});

test("publishInstagram: carrossel = filhos is_carousel_item → pai CAROUSEL(children) → publish", async () => {
  let n = 0;
  const f = makeGraphFetch([
    ["/media_publish", { id: "m2" }],
    ["/m2?", { permalink: "https://www.instagram.com/p/y/" }],
    ["/ig1/media", () => ({ id: `c${++n}` })],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const r = await s.publishInstagram("ig1", {
    format: "feed", kind: "carousel", caption: "4 slides",
    items: [{ url: "https://pub/1.png" }, { url: "https://pub/2.png" }, { url: "https://pub/3.png" }],
  });
  assert.equal(r.id, "m2");
  const media = f.calls.filter((c) => c.url.endsWith("/ig1/media"));
  assert.equal(media.length, 4); // 3 filhos + 1 pai
  assert.equal(media[0].body.is_carousel_item, "true");
  assert.equal(media[3].body.media_type, "CAROUSEL");
  assert.equal(media[3].body.children, "c1,c2,c3");
  assert.equal(media[3].body.caption, "4 slides");
});

test("publishInstagram: story de imagem usa media_type STORIES; reel faz poll até FINISHED", async () => {
  const f1 = makeGraphFetch([
    ["/media_publish", { id: "m3" }],
    ["/m3?", {}],
    ["/ig1/media", { id: "c9" }],
  ]);
  const s1 = makeSocial({ fetch: f1, accessToken: "tok" });
  await s1.publishInstagram("ig1", { format: "story", kind: "image", items: [{ url: "https://pub/s.png" }] });
  const story = f1.calls.find((c) => c.url.endsWith("/ig1/media"));
  assert.equal(story.body.media_type, "STORIES");
  assert.equal(story.body.image_url, "https://pub/s.png");

  let polls = 0;
  const f2 = makeGraphFetch([
    ["/media_publish", { id: "m4" }],
    ["/m4?", { permalink: "https://www.instagram.com/reel/z/" }],
    ["status_code", () => (++polls < 2 ? { status_code: "IN_PROGRESS" } : { status_code: "FINISHED" })],
    ["/ig1/media", { id: "c10" }],
  ]);
  const s2 = makeSocial({ fetch: f2, accessToken: "tok", sleep: async () => {} });
  const r = await s2.publishInstagram("ig1", { format: "reel", kind: "video", items: [{ url: "https://pub/v.mp4" }], caption: "reel" });
  assert.equal(r.id, "m4");
  assert.equal(polls, 2);
  const reel = f2.calls.find((c) => c.url.endsWith("/ig1/media"));
  assert.equal(reel.body.media_type, "REELS");
  assert.equal(reel.body.video_url, "https://pub/v.mp4");
});

test("publishInstagram: sequência = 4 stories publicados um a um, em ordem", async () => {
  let cn = 0, pn = 0;
  const f = makeGraphFetch([
    ["/media_publish", () => ({ id: `pub${++pn}` })],
    ["/ig1/media", () => ({ id: `c${++cn}` })],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const r = await s.publishInstagram("ig1", {
    format: "story", kind: "sequence",
    items: [{ url: "https://pub/1.png" }, { url: "https://pub/2.png" }, { url: "https://pub/3.png" }, { url: "https://pub/4.png" }],
  });
  assert.equal(r.count, 4);
  assert.deepEqual(r.ids, ["pub1", "pub2", "pub3", "pub4"]);
  // cada item vira um container STORIES + um publish, na ordem dos itens
  const containers = f.calls.filter((c) => c.url.endsWith("/ig1/media"));
  assert.equal(containers.length, 4);
  assert.ok(containers.every((c) => c.body.media_type === "STORIES"));
  assert.equal(containers[0].body.image_url, "https://pub/1.png");
  assert.equal(containers[3].body.image_url, "https://pub/4.png");
  const publishes = f.calls.filter((c) => c.url.endsWith("/media_publish"));
  assert.equal(publishes.length, 4);
  // sequência fora de story é recusada
  await assert.rejects(() => s.publishInstagram("ig1", { format: "feed", kind: "sequence", items: [{ url: "x" }] }), /formato de story/);
});

test("publishFacebook: pega o token da página e posta a foto com message", async () => {
  const f = makeGraphFetch([
    ["fields=access_token", { access_token: "page-tok" }],
    ["/pg1/photos", { post_id: "pg1_777" }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const r = await s.publishFacebook("pg1", { format: "feed", kind: "image", items: [{ url: "https://pub/img.png" }], caption: "oi" });
  assert.equal(r.id, "pg1_777");
  const photo = f.calls.find((c) => c.url.endsWith("/pg1/photos"));
  assert.equal(photo.body.url, "https://pub/img.png");
  assert.equal(photo.body.message, "oi");
  assert.equal(photo.body.access_token, "page-tok");
  // story de página não é suportado
  await assert.rejects(() => s.publishFacebook("pg1", { format: "story", kind: "image", items: [{ url: "x" }] }), /story de página/);
});

// ── Rotas ────────────────────────────────────────────────────────────────────
function buildApp(repo, social, anthropic = null) {
  const app = Fastify();
  registerSocialRoutes(app, repo, {
    social,
    meta: { discoverCreativeDefaults: async () => null },
    anthropic,
  });
  return app;
}

const fakeSocialOk = () => ({
  configured: () => true,
  calls: [],
  async igAccount() { return { username: "lever.ads", followers_count: 230 }; },
  async igInsights() { return { reach: 1000 }; },
  async igMedia() { return [{ id: "m1", likes: 10 }]; },
  async pageInfo() { return { name: "LeverAds", fan_count: 50 }; },
  async publishInstagram(ig, o) { this.calls.push(["ig", ig, o]); return { id: "ig9", permalink: "https://insta/p/9" }; },
  async publishFacebook(pg, o) { this.calls.push(["fb", pg, o]); return { id: "fb9", permalink: "" }; },
});

test("rotas: summary junta perfil+insights+página; publish resolve URL pública e grava histórico", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaIgUserId: "ig1", metaPageId: "pg1" });
  const a1 = await repo.create("social_assets", { saas: "leverads", mime: "image/png", data: Buffer.from("PNG!").toString("base64"), name: "a.png" });
  const social = fakeSocialOk();
  const app = buildApp(repo, social);

  const sum = await app.inject({ method: "GET", url: "/api/social/summary?saas=leverads" });
  assert.equal(sum.statusCode, 200);
  const s = sum.json();
  assert.equal(s.configured, true);
  assert.equal(s.account.username, "lever.ads");
  assert.equal(s.page.name, "LeverAds");
  assert.equal(s.insights.reach, 1000);

  const pub = await app.inject({
    method: "POST", url: "/api/social/publish",
    headers: { host: "cockpit.example.com" },
    payload: { saas: "leverads", format: "feed", kind: "image", assetIds: [a1.id], caption: "olá", networks: ["instagram", "facebook"] },
  });
  assert.equal(pub.statusCode, 200);
  const body = pub.json();
  assert.equal(body.ok, true);
  assert.equal(body.results.instagram.id, "ig9");
  assert.equal(body.results.facebook.id, "fb9");
  const [tag, ig, opts] = social.calls[0];
  assert.equal(tag, "ig");
  assert.equal(ig, "ig1");
  assert.match(opts.items[0].url, new RegExp(`^https://cockpit\\.example\\.com/public/social/${a1.id}$`));

  const hist = await app.inject({ method: "GET", url: "/api/social/posts?saas=leverads" });
  assert.equal(hist.json().length, 1);
  assert.equal(hist.json()[0].caption, "olá");

  // a mídia pública sai com o mime certo (é daqui que a Meta baixa)
  const served = await app.inject({ method: "GET", url: `/public/social/${a1.id}` });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.equal(served.body, "PNG!");
});

test("rotas: summary expõe as dores do produto (painMap) e o estado da IA", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaIgUserId: "ig1", painMap: { A: "Perde tempo subindo à mão", B: "Medo de banimento", C: "" } });
  const app = buildApp(repo, fakeSocialOk(), { configured: () => true });
  const s = (await app.inject({ method: "GET", url: "/api/social/summary?saas=leverads" })).json();
  assert.equal(s.aiConfigured, true);
  assert.deepEqual(s.pains.map((p) => p.label).sort(), ["Medo de banimento", "Perde tempo subindo à mão"]);
});

test("rotas: ai-copy chama a IA com os campos do template e devolve mapa + legenda", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  let seen = null;
  const anthropic = {
    configured: () => true,
    async suggestSocialCopy(args) {
      seen = args;
      return { fields: { title: "Título *forte*", cta: "Chama no direct" }, caption: "legenda pronta #leverads" };
    },
  };
  const app = buildApp(repo, fakeSocialOk(), anthropic);
  const res = await app.inject({
    method: "POST", url: "/api/social/ai-copy",
    payload: { saas: "leverads", dor: "Perde tempo à mão", suggestion: "tom provocativo", formatLabel: "Story", templateName: "Chamada", fields: [{ key: "title", label: "Título", example: "Pare de..." }, { key: "cta", label: "CTA", example: "Fala com a gente" }] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().fields, { title: "Título *forte*", cta: "Chama no direct" });
  assert.match(res.json().caption, /#leverads/);
  assert.equal(seen.dor, "Perde tempo à mão");
  assert.equal(seen.fields.length, 2);

  // sem IA configurada → 400; sem campos → 400
  const app2 = buildApp(repo, fakeSocialOk(), { configured: () => false });
  assert.equal((await app2.inject({ method: "POST", url: "/api/social/ai-copy", payload: { saas: "leverads", fields: [{ key: "x" }] } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/social/ai-copy", payload: { saas: "leverads", fields: [] } })).statusCode, 400);
});

test("rotas: falha por rede não derruba a outra; publish sem asset é 400", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", metaIgUserId: "ig1", metaPageId: "pg1" });
  const a1 = await repo.create("social_assets", { saas: "leverads", mime: "image/png", data: "", name: "a.png" });
  const social = fakeSocialOk();
  social.publishFacebook = async () => { throw new Error("página sem permissão"); };
  const app = buildApp(repo, social);

  const pub = await app.inject({
    method: "POST", url: "/api/social/publish",
    payload: { saas: "leverads", format: "feed", kind: "image", assetIds: [a1.id], networks: ["instagram", "facebook"] },
  });
  const body = pub.json();
  assert.equal(body.ok, true); // IG passou
  assert.equal(body.results.facebook.ok, false);
  assert.match(body.results.facebook.error, /permissão/);

  const bad = await app.inject({ method: "POST", url: "/api/social/publish", payload: { saas: "leverads", assetIds: [] } });
  assert.equal(bad.statusCode, 400);
});
