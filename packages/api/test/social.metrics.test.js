// Cliente Graph de métricas sociais — parsing dos breakdowns (follow_type,
// demografia), chunking de janelas >30d, insights por post aninhado e melhor
// horário. fetch fake responde por padrão de URL/params.

import test from "node:test";
import assert from "node:assert/strict";

const { makeSocial } = await import("../src/social.js");

function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(String(url));
    const p = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, params: p });
    for (const [match, body] of routes) {
      if (u.pathname.includes(match.path) && (!match.metric || p.metric === match.metric) && (!match.breakdown || p.breakdown === match.breakdown)) {
        return { status: 200, text: async () => JSON.stringify(typeof body === "function" ? body(p) : body) };
      }
    }
    return { status: 200, text: async () => JSON.stringify({ data: [] }) };
  };
  f.calls = calls;
  return f;
}

test("igReachBreakdown: soma FOLLOWER × NON_FOLLOWER do breakdown follow_type", async () => {
  const f = fakeFetch([
    [{ path: "/insights", metric: "reach", breakdown: "follow_type" }, {
      data: [{ name: "reach", total_value: { breakdowns: [{ dimension_keys: ["follow_type"], results: [
        { dimension_values: ["FOLLOWER"], value: 700 },
        { dimension_values: ["NON_FOLLOWER"], value: 300 },
      ] }] } }],
    }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const r = await s.igReachBreakdown("ig1", { since: "2026-07-01", until: "2026-07-07" });
  assert.deepEqual(r, { follower: 700, nonFollower: 300 });
});

test("igInsights: janela de 90d é quebrada em pedaços de ≤30d e somada", async () => {
  const f = fakeFetch([
    [{ path: "/insights", metric: "reach,profile_views,accounts_engaged,total_interactions" },
      { data: [{ name: "reach", total_value: { value: 100 } }, { name: "profile_views", total_value: { value: 10 } }] }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const r = await s.igInsights("ig1", { since: "2026-01-01", until: "2026-03-31" }); // 90 dias inclusive
  // 90 dias inclusive = 3 janelas de 30 → o lote principal é chamado 3×
  const reachCalls = f.calls.filter((c) => c.params.metric?.startsWith("reach"));
  assert.equal(reachCalls.length, 3);
  assert.equal(r.reach, 300);
  assert.equal(r.profile_views, 30);
});

test("igMedia: usa insights aninhado por post (reach/saved/shares)", async () => {
  const f = fakeFetch([
    [{ path: "/media" }, {
      data: [{
        id: "m1", media_type: "IMAGE", like_count: 10, comments_count: 2, permalink: "p1", timestamp: "2026-07-01T00:00:00Z",
        insights: { data: [
          { name: "reach", values: [{ value: 900 }] },
          { name: "saved", values: [{ value: 12 }] },
          { name: "shares", values: [{ value: 3 }] },
          { name: "total_interactions", values: [{ value: 27 }] },
        ] },
      }],
    }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const media = await s.igMedia("ig1", { limit: 5 });
  assert.equal(media[0].reach, 900);
  assert.equal(media[0].saved, 12);
  assert.equal(media[0].shares, 3);
  assert.equal(media[0].totalInteractions, 27);
  // pediu o insights aninhado no fields
  assert.match(f.calls[0].params.fields, /insights\.metric\(/);
});

test("igMedia: cada post ganha métricas estendidas (vídeo com reels; foto com views/perfil)", async () => {
  const VID = "views,ig_reels_avg_watch_time,ig_reels_video_view_total_time,clips_replays_count,reels_skip_rate,profile_visits,follows";
  const f = fakeFetch([
    [{ path: "/media" }, {
      data: [
        { id: "v1", media_type: "VIDEO", media_url: "https://cdn/v1.mp4", thumbnail_url: "https://cdn/v1.jpg", like_count: 3, comments_count: 1 },
        { id: "i1", media_type: "IMAGE", media_url: "https://cdn/i1.jpg", like_count: 8, comments_count: 0 },
      ],
    }],
    [{ path: "/v1/insights", metric: VID }, {
      data: [
        { name: "views", values: [{ value: 640 }] },
        { name: "ig_reels_avg_watch_time", values: [{ value: 8200 }] },
        { name: "ig_reels_video_view_total_time", values: [{ value: 512000 }] },
        { name: "clips_replays_count", values: [{ value: 45 }] },
        { name: "reels_skip_rate", values: [{ value: 28.5 }] },
        { name: "profile_visits", values: [{ value: 12 }] },
        { name: "follows", values: [{ value: 3 }] },
      ],
    }],
    [{ path: "/i1/insights", metric: "views,profile_visits,follows" }, {
      data: [
        { name: "views", values: [{ value: 300 }] },
        { name: "profile_visits", values: [{ value: 5 }] },
        { name: "follows", values: [{ value: 1 }] },
      ],
    }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const media = await s.igMedia("ig1");
  const vid = media.find((m) => m.id === "v1"), img = media.find((m) => m.id === "i1");
  assert.equal(vid.views, 640);
  assert.equal(vid.avgWatchMs, 8200);
  assert.equal(vid.totalWatchMs, 512000);
  assert.equal(vid.replays, 45);
  assert.equal(vid.skipRate, 28.5);
  assert.equal(vid.profileVisits, 12);
  assert.equal(vid.follows, 3);
  assert.equal(vid.videoUrl, "https://cdn/v1.mp4"); // pro front ler a duração
  assert.equal(vid.mediaUrl, "https://cdn/v1.jpg"); // thumb continua sendo a capa
  // foto AGORA ganha views (métrica unificada) + atividade de perfil; sem reels.
  assert.equal(img.views, 300);
  assert.equal(img.profileVisits, 5);
  assert.equal(img.follows, 1);
  assert.equal(img.skipRate, null);
  assert.equal(img.videoUrl, "");
});

test("igMedia: se o skip 3s não existir pra mídia, cai pro conjunto sem ele", async () => {
  const f = async (url) => {
    const u = new URL(String(url));
    const p = Object.fromEntries(u.searchParams);
    if (u.pathname.includes("/media")) {
      return { status: 200, text: async () => JSON.stringify({ data: [{ id: "v1", media_type: "VIDEO", media_url: "u", like_count: 1, comments_count: 0 }] }) };
    }
    if (p.metric?.includes("reels_skip_rate")) {
      return { status: 400, text: async () => JSON.stringify({ error: { message: "metric inválida" } }) };
    }
    return { status: 200, text: async () => JSON.stringify({ data: [
      { name: "views", values: [{ value: 90 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 4000 }] },
    ] }) };
  };
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const media = await s.igMedia("ig1");
  assert.equal(media[0].views, 90);
  assert.equal(media[0].avgWatchMs, 4000);
  assert.equal(media[0].skipRate, null); // sem skip, mas não zerou o resto
});

test("igMedia: se o combo com insights falhar, cai pros campos básicos", async () => {
  let n = 0;
  const f = async (url) => {
    n++;
    const u = new URL(String(url));
    const withIns = /insights\.metric/.test(u.searchParams.get("fields") || "");
    if (withIns) return { status: 400, text: async () => JSON.stringify({ error: { message: "metric inválida" } }) };
    return { status: 200, text: async () => JSON.stringify({ data: [{ id: "m1", media_type: "IMAGE", like_count: 5, comments_count: 0, permalink: "p" }] }) };
  };
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const media = await s.igMedia("ig1");
  assert.equal(media[0].likes, 5);
  assert.equal(media[0].reach, 0); // sem insights, mas não quebrou
  // combo aninhado (400) → base (200) → 1 chamada estendida por post (200 aqui).
  assert.equal(n, 3);
});

test("igOnlineFollowers: média por hora dos dias devolvidos", async () => {
  const f = fakeFetch([
    [{ path: "/insights", metric: "online_followers" }, {
      data: [{ name: "online_followers", values: [
        { value: { "9": 20, "19": 100 } },
        { value: { "9": 40, "19": 80 } },
      ] }],
    }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const hours = await s.igOnlineFollowers("ig1");
  assert.equal(hours.length, 24);
  assert.equal(hours[9], 30);  // (20+40)/2
  assert.equal(hours[19], 90); // (100+80)/2
  assert.equal(hours[3], 0);
});

test("igDemographics: parseia país e gênero, ordenado por valor", async () => {
  const f = fakeFetch([
    [{ path: "/insights", breakdown: "country" }, { data: [{ total_value: { breakdowns: [{ dimension_keys: ["country"], results: [
      { dimension_values: ["US"], value: 50 }, { dimension_values: ["BR"], value: 200 },
    ] }] } }] }],
    [{ path: "/insights", breakdown: "gender" }, { data: [{ total_value: { breakdowns: [{ dimension_keys: ["gender"], results: [
      { dimension_values: ["F"], value: 120 }, { dimension_values: ["M"], value: 80 },
    ] }] } }] }],
  ]);
  const s = makeSocial({ fetch: f, accessToken: "t" });
  const d = await s.igDemographics("ig1");
  assert.equal(d.countries[0].key, "BR"); // ordenado desc
  assert.equal(d.countries[0].value, 200);
  assert.equal(d.genders[0].key, "F");
});
