// Comentários de IG e página do Facebook: cliente Graph (leitura normalizada,
// resposta, ocultar), o modelo da fila (social-comments.js) e as rotas
// (webhook da Meta, listagem, responder/ocultar/resolver).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { makeSocial } = await import("../src/social.js");
const { registerSocialRoutes } = await import("../src/routes.social.js");
const { upsertComment, listComments, commentInsights, syncComments, invalidateSync, postTitleOf } = await import("../src/social-comments.js");

function makeGraphFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const call = { method, url: String(url), body };
    calls.push(call);
    for (const [match, responder] of routes) {
      if (call.url.includes(match)) return { status: 200, text: async () => JSON.stringify(typeof responder === "function" ? responder(call) : responder) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: { message: `sem rota fake pra ${method} ${url}` } }) };
  };
  f.calls = calls;
  return f;
}

// ── Cliente Graph ────────────────────────────────────────────────────────────

test("igComments: achata respostas aninhadas e normaliza os campos do IG", async () => {
  const f = makeGraphFetch([["/m1/comments", {
    data: [{
      id: "c1", text: "quanto custa?", username: "joao", timestamp: "2026-07-18T10:00:00+0000", like_count: 2, hidden: false,
      replies: { data: [{ id: "r1", text: "te chamei no direct", username: "lever.ads", timestamp: "2026-07-18T11:00:00+0000" }] },
    }],
  }]]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const list = await s.igComments("m1");
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id: "c1", text: "quanto custa?", author: "joao", at: "2026-07-18T10:00:00.000Z", likes: 2, hidden: false, parentId: "" });
  // A resposta vem com o pai apontado — é o que liga a resposta ao comentário.
  assert.equal(list[1].parentId, "c1");
  assert.equal(list[1].author, "lever.ads");
});

test("igReplyComment/igHideComment: POST no edge certo, com o corpo certo", async () => {
  const f = makeGraphFetch([["/c1/replies", { id: "r9" }], ["/c1?", {}], ["/c1", {}]]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  assert.equal(await s.igReplyComment("c1", "opa!"), "r9");
  const rep = f.calls.find((c) => c.url.endsWith("/c1/replies"));
  assert.equal(rep.method, "POST");
  assert.equal(rep.body.message, "opa!");

  await s.igHideComment("c1", true);
  const hide = f.calls.find((c) => c.method === "POST" && c.url.endsWith("/c1"));
  assert.equal(hide.body.hide, "true");
});

test("igDeleteComment: DELETE leva os parâmetros na query (a Graph não lê corpo nele)", async () => {
  const f = makeGraphFetch([["/c1", {}]]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  await s.igDeleteComment("c1");
  const del = f.calls.find((c) => c.method === "DELETE");
  assert.ok(del.url.includes("access_token=tok"), "token tem que ir na query do DELETE");
});

test("fbComments: usa o token DA PÁGINA e normaliza message/from/created_time", async () => {
  const f = makeGraphFetch([
    ["/pg1?", { access_token: "page-tok" }],
    ["/p1/comments", {
      data: [{
        id: "fc1", message: "tenho interesse", created_time: "2026-07-18T10:00:00+0000", like_count: 1, is_hidden: false,
        from: { id: "u9", name: "Maria" },
        comments: { data: [{ id: "fr1", message: "te respondo já", created_time: "2026-07-18T10:30:00+0000", from: { id: "pg1", name: "LeverAds" } }] },
      }],
    }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  const list = await s.fbComments("p1", { pageId: "pg1" });
  assert.equal(list.length, 2);
  assert.equal(list[0].text, "tenho interesse");
  assert.equal(list[0].author, "Maria");
  assert.equal(list[0].authorId, "u9");
  assert.equal(list[1].parentId, "fc1");
  assert.equal(list[1].authorId, "pg1"); // resposta da própria página
  const read = f.calls.find((c) => c.url.includes("/p1/comments"));
  assert.ok(read.url.includes("access_token=page-tok"), "leitura tem que usar o token da página");
});

test("fbReplyComment: responder = comentário FILHO, assinado pela página", async () => {
  const f = makeGraphFetch([["/pg1?", { access_token: "page-tok" }], ["/fc1/comments", { id: "fr9" }]]);
  const s = makeSocial({ fetch: f, accessToken: "tok" });
  assert.equal(await s.fbReplyComment("fc1", "oi Maria", { pageId: "pg1" }), "fr9");
  const rep = f.calls.find((c) => c.url.endsWith("/fc1/comments"));
  assert.equal(rep.body.message, "oi Maria");
  assert.equal(rep.body.access_token, "page-tok");
});

// ── Modelo da fila ───────────────────────────────────────────────────────────

test("upsertComment: campo vazio do webhook NÃO apaga o que a varredura preencheu", async () => {
  const repo = makeMemRepo();
  await upsertComment(repo, { id: "c1", saas: "leverads", network: "instagram", postId: "m1", postTitle: "Post bom", permalink: "https://insta/p/1", text: "oi", author: "joao" });
  // O webhook re-entrega o mesmo comentário sem legenda/permalink do post.
  await upsertComment(repo, { id: "c1", saas: "leverads", network: "instagram", postId: "m1", text: "oi", author: "joao", source: "webhook" });
  const row = await repo.get("social_comments", "c1");
  assert.equal(row.postTitle, "Post bom");
  assert.equal(row.permalink, "https://insta/p/1");
});

test("listComments: pendente = comentário deles sem resposta nossa; responder tira da fila", async () => {
  const repo = makeMemRepo();
  const base = { saas: "leverads", network: "instagram", postId: "m1" };
  await upsertComment(repo, { ...base, id: "c1", text: "quanto custa?", author: "joao", at: "2026-07-18T10:00:00.000Z" });
  await upsertComment(repo, { ...base, id: "c2", text: "top!", author: "ana", at: "2026-07-18T12:00:00.000Z" });

  let pend = await listComments(repo, { saas: "leverads", status: "pending" });
  assert.deepEqual(pend.map((c) => c.id), ["c1", "c2"]); // mais velho primeiro

  // Resposta nossa (pode ter vindo do app do Instagram, via varredura).
  await upsertComment(repo, { ...base, id: "r1", text: "te chamei no direct", author: "lever.ads", at: "2026-07-18T11:00:00.000Z", parentId: "c1", ours: true });

  pend = await listComments(repo, { saas: "leverads", status: "pending" });
  assert.deepEqual(pend.map((c) => c.id), ["c2"]);

  const answered = await listComments(repo, { saas: "leverads", status: "answered" });
  assert.deepEqual(answered.map((c) => c.id), ["c1"]);
  assert.equal(answered[0].reply.text, "te chamei no direct");
  // Nossa resposta não vira item da fila.
  const all = await listComments(repo, { saas: "leverads", status: "all" });
  assert.ok(!all.some((c) => c.id === "r1"));
});

test("listComments: oculto e resolvido saem da fila sem virar respondido", async () => {
  const repo = makeMemRepo();
  const base = { saas: "leverads", network: "instagram", postId: "m1", at: "2026-07-18T10:00:00.000Z" };
  await upsertComment(repo, { ...base, id: "c1", text: "spam", author: "bot", hidden: true });
  await upsertComment(repo, { ...base, id: "c2", text: "🔥", author: "ana", done: true });
  const pend = await listComments(repo, { saas: "leverads", status: "pending" });
  assert.equal(pend.length, 0);
  const all = await listComments(repo, { saas: "leverads", status: "all" });
  assert.equal(all.find((c) => c.id === "c1").answered, false);
  assert.equal(all.find((c) => c.id === "c2").answered, false);
});

test("listComments: escopo por produto — comentário de outro SaaS não vaza", async () => {
  const repo = makeMemRepo();
  await upsertComment(repo, { id: "a", saas: "leverads", network: "instagram", text: "x", at: "2026-07-18T10:00:00.000Z" });
  await upsertComment(repo, { id: "b", saas: "uniquekids", network: "instagram", text: "y", at: "2026-07-18T10:00:00.000Z" });
  const rows = await listComments(repo, { saas: "leverads", status: "all" });
  assert.deepEqual(rows.map((c) => c.id), ["a"]);
});

test("commentInsights: mediana do tempo de resposta e o mais antigo da fila", async () => {
  const repo = makeMemRepo();
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const base = { saas: "leverads", network: "instagram", postId: "m1" };
  // Respondido em 1h.
  await upsertComment(repo, { ...base, id: "c1", text: "a", author: "joao", at: iso(3 * 3600e3) });
  await upsertComment(repo, { ...base, id: "r1", text: "ok", author: "nos", at: iso(2 * 3600e3), parentId: "c1", ours: true });
  // Respondido em 3h.
  await upsertComment(repo, { ...base, id: "c2", text: "b", author: "ana", at: iso(5 * 3600e3) });
  await upsertComment(repo, { ...base, id: "r2", text: "ok", author: "nos", at: iso(2 * 3600e3), parentId: "c2", ours: true });
  // Pendente há 10h.
  await upsertComment(repo, { ...base, id: "c3", text: "c", author: "leo", at: iso(10 * 3600e3) });

  const ins = await commentInsights(repo, { saas: "leverads" });
  assert.equal(ins.pending, 1);
  assert.equal(ins.answered, 2);
  assert.equal(ins.replySample, 2);
  assert.equal(ins.medianReplyMinutes, 120); // mediana de 60 e 180
  assert.ok(ins.oldestPendingHours >= 9.9 && ins.oldestPendingHours <= 10.1);
  assert.equal(ins.answeredRate, 67);
});

test("syncComments: marca como NOSSO o comentário do @ da conta e o da própria página", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  const social = {
    async igComments() {
      return [
        { id: "c1", text: "quanto custa?", author: "joao", at: "2026-07-18T10:00:00.000Z", parentId: "" },
        { id: "r1", text: "chamei no direct", author: "Lever.Ads", at: "2026-07-18T11:00:00.000Z", parentId: "c1" },
      ];
    },
    async pageToken() { return "page-tok"; },
    async fbPosts() { return [{ id: "p1", caption: "Post da página", permalink: "https://fb/p1" }]; },
    async fbComments() {
      return [
        { id: "fc1", text: "interesse", author: "Maria", authorId: "u9", at: "2026-07-18T10:00:00.000Z", parentId: "" },
        { id: "fr1", text: "oi Maria", author: "LeverAds", authorId: "pg1", at: "2026-07-18T10:30:00.000Z", parentId: "fc1" },
        { id: "fc2", text: "e o preço?", author: "Bruno", authorId: "u7", at: "2026-07-18T12:00:00.000Z", parentId: "" },
      ];
    },
  };
  const r = await syncComments(repo, social, {
    saas: "leverads", igUserId: "ig1", pageId: "pg1", igUsername: "lever.ads",
    posts: [{ id: "m1", caption: "Legenda do post\nsegunda linha", permalink: "https://insta/p/1" }],
    force: true,
  });
  assert.equal(r.skipped, false);
  // @ compara sem diferenciar maiúscula (a Graph devolve o username como veio).
  assert.equal((await repo.get("social_comments", "r1")).ours, true);
  assert.equal((await repo.get("social_comments", "c1")).ours, false);
  // Na página, "nosso" é quem assina com o id da página.
  assert.equal((await repo.get("social_comments", "fr1")).ours, true);
  assert.equal((await repo.get("social_comments", "fc1")).ours, false);
  // Só a primeira linha da legenda vira título do post.
  assert.equal((await repo.get("social_comments", "c1")).postTitle, "Legenda do post");

  // Só sobra na fila quem NÃO tem resposta nossa: c1 (IG) e fc1 (FB) já foram
  // respondidos, dos dois lados, por quem respondeu pelo app da rede.
  const pend = await listComments(repo, { saas: "leverads", status: "pending" });
  assert.deepEqual(pend.map((c) => c.id), ["fc2"]);
});

test("syncComments: uma rede falhar não derruba a outra", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  const social = {
    async igComments() { return [{ id: "c1", text: "oi", author: "joao", at: "2026-07-18T10:00:00.000Z", parentId: "" }]; },
    async pageToken() { throw new Error("Meta API -> 200: sem permissão na página"); },
  };
  const r = await syncComments(repo, social, { saas: "leverads", igUserId: "ig1", pageId: "pg1", posts: [{ id: "m1", caption: "x" }], force: true });
  assert.match(r.errors.facebook, /sem permissão/);
  assert.ok(!r.errors.instagram);
  assert.ok(await repo.get("social_comments", "c1"), "o Instagram tem que ter entrado mesmo com o FB falhando");
});

test("syncComments: throttle — sem force, a segunda varredura no mesmo minuto não chama a Meta", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  let hits = 0;
  const social = { async igComments() { hits++; return []; } };
  const opts = { saas: "leverads", igUserId: "ig1", posts: [{ id: "m1", caption: "x" }] };
  await syncComments(repo, social, { ...opts, force: true });
  const second = await syncComments(repo, social, opts);
  assert.equal(second.skipped, true);
  assert.equal(hits, 1);
});

test("syncComments: varre o mural E os posts de anúncio, sem repetir o que vem nos dois", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  const scanned = [];
  const social = {
    async pageToken() { return "tok"; },
    async fbPosts() { return [{ id: "p1", caption: "post do mural" }]; },
    // O anúncio que impulsiona p1 volta nos dois edges; p2 é dark post, só aqui.
    async fbAdsPosts() { return [{ id: "p1", caption: "post do mural" }, { id: "p2", caption: "anúncio" }]; },
    async fbComments(postId) {
      scanned.push(postId);
      return postId === "p2"
        ? [{ id: "fc2", text: "link de afiliado", author: "bot", authorId: "u9", at: "2026-07-19T10:00:00.000Z" }]
        : [];
    },
  };
  const r = await syncComments(repo, social, { saas: "leverads", pageId: "pg1", force: true });
  assert.deepEqual(scanned.sort(), ["p1", "p2"], "cada post é varrido uma vez só");
  const row = await repo.get("social_comments", "fc2");
  assert.equal(row.saas, "leverads");
  assert.equal(row.postTitle, "anúncio");
  assert.ok(!r.errors.facebook);
});

test("syncComments: /ads_posts sem permissão não derruba a leitura do mural", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  const social = {
    async pageToken() { return "tok"; },
    async fbPosts() { return [{ id: "p1", caption: "post do mural" }]; },
    async fbAdsPosts() { throw new Error("(#200) sem permissão pra ads_posts"); },
    async fbComments() { return [{ id: "fc1", text: "oi", author: "ana", authorId: "u1", at: "2026-07-19T10:00:00.000Z" }]; },
  };
  const r = await syncComments(repo, social, { saas: "leverads", pageId: "pg1", force: true });
  assert.match(r.errors.facebookAds, /sem permissão/);
  assert.ok(await repo.get("social_comments", "fc1"), "o mural tem que entrar mesmo sem os anúncios");
});

test("syncComments: as mídias de anúncio do IG não são cortadas pelo teto dos recentes", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  const scanned = [];
  // 8 orgânicas (o `limit` padrão) + 1 de anúncio no fim da lista.
  const posts = [...Array(8)].map((_, i) => ({ id: `m${i}`, caption: `post ${i}` }));
  posts.push({ id: "adm1", caption: "anúncio" });
  const social = { async igComments(id) { scanned.push(id); return []; } };
  await syncComments(repo, social, { saas: "leverads", igUserId: "ig1", posts, force: true });
  assert.ok(scanned.includes("adm1"), "a mídia de anúncio vem depois das orgânicas e não pode ser descartada");
});

test("postTitleOf: primeira linha, cortada, com fallback pra post sem legenda", () => {
  assert.equal(postTitleOf("Título\nresto"), "Título");
  assert.equal(postTitleOf("", "Publicação sem legenda"), "Publicação sem legenda");
  assert.equal(postTitleOf("x".repeat(90)).length, 71); // 70 + reticência
});

// ── Rotas ────────────────────────────────────────────────────────────────────

function buildApp(repo, social) {
  const app = Fastify();
  registerSocialRoutes(app, repo, { social, meta: { discoverCreativeDefaults: async () => null } });
  return app;
}

const fakeSocial = (over = {}) => ({
  configured: () => true,
  replies: [],
  hides: [],
  async igAccount() { return { username: "lever.ads" }; },
  async igMedia() { return [{ id: "m1", caption: "Post do dia", permalink: "https://insta/p/1" }]; },
  async igMediaInfo() { return { id: "m1", caption: "Post do dia", permalink: "https://insta/p/1" }; },
  async igComments() { return []; },
  async igReplyComment(id, msg) { this.replies.push(["ig", id, msg]); return "r9"; },
  async igHideComment(id, hide) { this.hides.push(["ig", id, hide]); return true; },
  async pageToken() { return "page-tok"; },
  async fbPosts() { return []; },
  async fbComments() { return []; },
  async fbReplyComment(id, msg) { this.replies.push(["fb", id, msg]); return "fr9"; },
  async fbHideComment(id, hide) { this.hides.push(["fb", id, hide]); return true; },
  ...over,
});

test("webhook do Instagram: comentário novo entra na fila do produto dono da conta", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1", metaPageId: "pg1" });
  const app = buildApp(repo, fakeSocial());

  const res = await app.inject({
    method: "POST", url: "/api/webhooks/social",
    payload: {
      object: "instagram",
      entry: [{ id: "ig1", changes: [{ field: "comments", value: { id: "c1", text: "quanto custa?", from: { id: "u1", username: "joao" }, media: { id: "m1" } } }] }],
    },
  });
  assert.equal(res.statusCode, 200);
  const row = await repo.get("social_comments", "c1");
  assert.equal(row.saas, "leverads");
  assert.equal(row.network, "instagram");
  assert.equal(row.author, "joao");
  assert.equal(row.ours, false);
  // O webhook só manda o id do post: a legenda vem de uma busca na hora, senão
  // o card ficaria órfão até a próxima varredura.
  assert.equal(row.postTitle, "Post do dia");
  assert.equal(row.permalink, "https://insta/p/1");
});

test("webhook do Instagram: o produto é achado pelo metaIgUser, o nome que a descoberta grava", async () => {
  const repo = makeMemRepo();
  // Sem `metaIgUserId`: é exatamente assim que o produto está em produção.
  await repo.create("products", { id: "leverads", metaIgUser: "ig1", metaPageId: "pg1" });
  const app = buildApp(repo, fakeSocial());

  await app.inject({
    method: "POST", url: "/api/webhooks/social",
    payload: {
      object: "instagram",
      entry: [{ id: "ig1", changes: [{ field: "comments", value: { id: "c9", text: "oi", from: { id: "u1", username: "joao" }, media: { id: "m1" } } }] }],
    },
  });
  const row = await repo.get("social_comments", "c9");
  assert.equal(row.saas, "leverads", "sem produto o comentário entra órfão e some da tela, que filtra por produto");
});

test("GET /api/social/comments: varre também as mídias de anúncio do Instagram", async () => {
  const repo = makeMemRepo();
  invalidateSync("leverads");
  await repo.create("products", { id: "leverads", metaIgUser: "ig1", metaAdAccount: "act_1" });
  const scanned = [];
  const social = fakeSocial({
    async igMediaInfo(id) { return { id, caption: "anúncio", permalink: "" }; },
    async igComments(mediaId) {
      scanned.push(mediaId);
      return mediaId === "adm1"
        ? [{ id: "c5", text: "isso é golpe?", author: "ana", at: "2026-07-19T10:00:00.000Z" }]
        : [];
    },
  });
  const app = Fastify();
  registerSocialRoutes(app, repo, {
    social,
    meta: { discoverCreativeDefaults: async () => null, adInstagramMedia: async () => ["m1", "adm1"] },
  });

  const res = await app.inject({ method: "GET", url: "/api/social/comments?saas=leverads&sync=1" });
  assert.equal(res.statusCode, 200);
  // m1 já veio no orgânico e não pode repetir; adm1 só existe como anúncio.
  assert.deepEqual(scanned.sort(), ["adm1", "m1"]);
  assert.ok(res.json().comments.some((c) => c.id === "c5"), "comentário de anúncio tem que chegar na fila");
});

test("webhook da página: só item=comment entra; resposta da própria página vira 'nossa'", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1", metaPageId: "pg1" });
  const app = buildApp(repo, fakeSocial());
  const send = (value) => app.inject({ method: "POST", url: "/api/webhooks/social", payload: { object: "page", entry: [{ id: "pg1", changes: [{ field: "feed", value }] }] } });

  await send({ item: "like", verb: "add", post_id: "p1" }); // curtida: ignorada
  await send({ item: "comment", verb: "add", comment_id: "fc1", post_id: "p1", parent_id: "p1", message: "interesse", from: { id: "u9", name: "Maria" }, created_time: 1784000000 });
  await send({ item: "comment", verb: "add", comment_id: "fr1", post_id: "p1", parent_id: "fc1", message: "oi Maria", from: { id: "pg1", name: "LeverAds" }, created_time: 1784001000 });

  const rows = await repo.list("social_comments");
  assert.deepEqual(rows.map((r) => r.id).sort(), ["fc1", "fr1"]);
  // parent_id igual ao post = comentário raiz, não resposta.
  assert.equal((await repo.get("social_comments", "fc1")).parentId, "");
  assert.equal((await repo.get("social_comments", "fr1")).parentId, "fc1");
  assert.equal((await repo.get("social_comments", "fr1")).ours, true);
  // Com a resposta da página registrada, o comentário sai da fila.
  const pend = await listComments(repo, { saas: "leverads", status: "pending" });
  assert.equal(pend.length, 0);
});

test("webhook: verb=remove apaga, e payload quebrado ainda responde 200", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaPageId: "pg1" });
  const app = buildApp(repo, fakeSocial());
  await upsertComment(repo, { id: "fc1", saas: "leverads", network: "facebook", text: "some" });

  await app.inject({ method: "POST", url: "/api/webhooks/social", payload: { object: "page", entry: [{ id: "pg1", changes: [{ field: "feed", value: { item: "comment", verb: "remove", comment_id: "fc1", post_id: "p1" } }] }] } });
  assert.equal(await repo.get("social_comments", "fc1"), null);

  // Nunca devolver erro: 4xx/5xx faz a Meta re-entregar em loop.
  const bad = await app.inject({ method: "POST", url: "/api/webhooks/social", payload: { entry: "não é lista" } });
  assert.equal(bad.statusCode, 200);
});

test("webhook: verificação exige o token; sem ele, 403", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo, fakeSocial());
  const prev = process.env.META_WEBHOOK_VERIFY_TOKEN;
  process.env.META_WEBHOOK_VERIFY_TOKEN = "segredo";
  try {
    const ok = await app.inject({ method: "GET", url: "/api/webhooks/social?hub.mode=subscribe&hub.verify_token=segredo&hub.challenge=42" });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, "42");
    const no = await app.inject({ method: "GET", url: "/api/webhooks/social?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42" });
    assert.equal(no.statusCode, 403);
  } finally {
    if (prev === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    else process.env.META_WEBHOOK_VERIFY_TOKEN = prev;
  }
});

test("GET /api/social/comments: lista a fila com os números do topo", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1" });
  invalidateSync("leverads");
  const social = fakeSocial({
    async igComments() { return [{ id: "c1", text: "quanto custa?", author: "joao", at: "2026-07-18T10:00:00.000Z", parentId: "" }]; },
  });
  const app = buildApp(repo, social);
  const res = await app.inject({ method: "GET", url: "/api/social/comments?saas=leverads" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].text, "quanto custa?");
  assert.equal(body.comments[0].pending, true);
  assert.equal(body.insights.pending, 1);
});

test("POST reply: publica na Meta, grava a resposta como nossa e tira o item da fila", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1" });
  await upsertComment(repo, { id: "c1", saas: "leverads", network: "instagram", postId: "m1", text: "quanto custa?", author: "joao", at: "2026-07-18T10:00:00.000Z" });
  const social = fakeSocial();
  const app = buildApp(repo, social);

  const res = await app.inject({ method: "POST", url: "/api/social/comments/c1/reply", payload: { text: "te chamei no direct!" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(social.replies, [["ig", "c1", "te chamei no direct!"]]);
  const saved = await repo.get("social_comments", "r9");
  assert.equal(saved.ours, true);
  assert.equal(saved.parentId, "c1");
  assert.equal(saved.text, "te chamei no direct!");
  assert.ok((await repo.get("social_comments", "c1")).repliedAt);
  assert.equal((await listComments(repo, { saas: "leverads", status: "pending" })).length, 0);
});

test("POST reply: erro da Meta vira 422 com a mensagem dela (5xx perderia o motivo no proxy)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1" });
  await upsertComment(repo, { id: "c1", saas: "leverads", network: "instagram", text: "oi" });
  const social = fakeSocial({ async igReplyComment() { throw new Error("Meta API -> 400: comentário não existe mais"); } });
  const app = buildApp(repo, social);
  const res = await app.inject({ method: "POST", url: "/api/social/comments/c1/reply", payload: { text: "oi" } });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /não existe mais/);

  const vazio = await app.inject({ method: "POST", url: "/api/social/comments/c1/reply", payload: { text: "   " } });
  assert.equal(vazio.statusCode, 400);
  const nao = await app.inject({ method: "POST", url: "/api/social/comments/naoexiste/reply", payload: { text: "oi" } });
  assert.equal(nao.statusCode, 404);
});

test("POST reply no Facebook: usa o edge da página, não o do Instagram", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1", metaPageId: "pg1" });
  await upsertComment(repo, { id: "fc1", saas: "leverads", network: "facebook", text: "interesse", author: "Maria" });
  const social = fakeSocial();
  const app = buildApp(repo, social);
  const res = await app.inject({ method: "POST", url: "/api/social/comments/fc1/reply", payload: { text: "oi Maria" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(social.replies, [["fb", "fc1", "oi Maria"]]);
  assert.equal((await repo.get("social_comments", "fr9")).network, "facebook");
});

test("POST hide/done: ocultar chama a Meta; resolver só muda o estado local", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", metaIgUserId: "ig1" });
  await upsertComment(repo, { id: "c1", saas: "leverads", network: "instagram", text: "spam", at: "2026-07-18T10:00:00.000Z" });
  await upsertComment(repo, { id: "c2", saas: "leverads", network: "instagram", text: "🔥", at: "2026-07-18T10:00:00.000Z" });
  const social = fakeSocial();
  const app = buildApp(repo, social);

  await app.inject({ method: "POST", url: "/api/social/comments/c1/hide", payload: { hide: true } });
  assert.deepEqual(social.hides, [["ig", "c1", true]]);
  assert.equal((await repo.get("social_comments", "c1")).hidden, true);

  await app.inject({ method: "POST", url: "/api/social/comments/c2/done", payload: { done: true } });
  assert.equal((await repo.get("social_comments", "c2")).done, true);
  assert.equal(social.hides.length, 1, "resolver não pode publicar nada na Meta");

  assert.equal((await listComments(repo, { saas: "leverads", status: "pending" })).length, 0);
});
