import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeGoogleUser, syncPersonalCalendar } from "../src/google-user.js";

const idToken = (email) => `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

// fetch fake: token (exchange devolve refresh_token; refresh não) + endpoints do
// Calendar (POST cria ev1/ev2…, PATCH/DELETE ecoam o id da URL).
function mockFetch() {
  const calls = [];
  let seq = 0;
  const f = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url: u, method });
    const ok = (b) => ({ status: 200, json: async () => b, text: async () => "" });
    if (u.includes("oauth2.googleapis.com/token")) {
      const refresh = body.includes("grant_type=refresh_token");
      return ok({ access_token: refresh ? "at-r" : "at-e", ...(refresh ? {} : { refresh_token: "rt" }), expires_in: 3600, id_token: idToken("user@gmail.com"), scope: "calendar.events" });
    }
    if (u.includes("/calendars/primary/events")) {
      if (method === "POST") return ok({ id: "ev" + (++seq) });
      if (method === "PATCH") return ok({ id: decodeURIComponent(u.split("/events/")[1].split("?")[0]) });
      if (method === "DELETE") return ok({});
    }
    return ok({});
  };
  f.calls = calls;
  return f;
}

test("makeGoogleUser: exchangeCodeForUser grava o token no usuário; upsert cria (POST) e atualiza (PATCH)", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "leonardo", name: "Leo", passwordHash: "x" });
  const f = mockFetch();
  const gu = makeGoogleUser({ fetch: f, clientId: "cid", clientSecret: "sec", repo });

  assert.equal(await gu.connectedFor("leonardo"), false);
  await gu.exchangeCodeForUser("code", "https://x/cb", "leonardo");
  const u = await repo.get("users", "leonardo");
  assert.equal(u.google.refreshToken, "rt");
  assert.equal(u.google.account, "user@gmail.com");
  assert.equal(u.passwordHash, "x"); // merge não apaga o resto do usuário
  assert.equal(await gu.connectedFor("leonardo"), true);

  const r1 = await gu.upsertEvent("leonardo", { summary: "s", start: {}, end: {} });
  assert.equal(r1.eventId, "ev1");
  const r2 = await gu.upsertEvent("leonardo", { eventId: "ev1", summary: "s2", start: {}, end: {} });
  assert.equal(r2.eventId, "ev1");
  assert.ok(f.calls.some((c) => c.method === "PATCH" && c.url.includes("/events/ev1")));

  await gu.disconnect("leonardo");
  assert.equal(await gu.connectedFor("leonardo"), false);
});

test("syncPersonalCalendar: cria na agenda do closer, some ao reatribuir p/ quem não conectou, apaga ao limpar", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "leonardo", name: "Leo" });
  await repo.create("users", { id: "jon", name: "Jon" }); // sem Google conectado
  const f = mockFetch();
  const gu = makeGoogleUser({ fetch: f, clientId: "cid", clientSecret: "sec", repo });
  await gu.exchangeCodeForUser("code", "https://x/cb", "leonardo");
  await repo.create("leads", { id: "le1", saas: "leverads", name: "Ana", company: "Loja X", closer: "leonardo", callAt: "2026-07-14T15:00" });

  // agenda → cria evento e grava o rastreio na lead
  await syncPersonalCalendar(repo, gu, await repo.get("leads", "le1"));
  let lead = await repo.get("leads", "le1");
  assert.equal(lead.calCallUser, "leonardo");
  assert.equal(lead.calCallEventId, "ev1");

  // reatribui pro jon (não conectou) → apaga da agenda do leonardo, limpa rastreio
  await repo.update("leads", "le1", { closer: "jon" });
  await syncPersonalCalendar(repo, gu, await repo.get("leads", "le1"));
  lead = await repo.get("leads", "le1");
  assert.equal(lead.calCallEventId, "");
  assert.equal(lead.calCallUser, "");
  assert.ok(f.calls.some((c) => c.method === "DELETE" && c.url.includes("/events/ev1")));

  // volta pro leonardo com callAt limpo → nada a agendar (e nada a apagar)
  await repo.update("leads", "le1", { closer: "leonardo", callAt: "" });
  await syncPersonalCalendar(repo, gu, await repo.get("leads", "le1"));
  lead = await repo.get("leads", "le1");
  assert.equal(lead.calCallEventId || "", "");
});
