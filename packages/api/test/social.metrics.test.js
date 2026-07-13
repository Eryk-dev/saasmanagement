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
  assert.equal(n, 2); // tentou com insights, caiu pro básico
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
