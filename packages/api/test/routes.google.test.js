// Google Meet — client OAuth (troca de code, refresh, criação de evento com
// Meet) e rotas (status, auth-url com state anti-CSRF, callback, POST
// /api/leads/:id/meet gravando callUrl). Tudo offline com fetch mockado.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeGoogle } = await import("../src/google.js");

// id_token fake com e-mail no payload (assinatura não é validada — display only)
const idToken = () => `x.${Buffer.from(JSON.stringify({ email: "time@leverads.com.br" })).toString("base64url")}.y`;

function makeGoogleFetch() {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const ok = (body) => ({ status: 200, json: async () => body });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      if (params.grant_type === "authorization_code") {
        return ok({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, id_token: idToken() });
      }
      return ok({ access_token: "at-2", expires_in: 3600 });
    }
    if (String(url).includes("/calendars/primary/events")) {
      return ok({ id: "ev1", hangoutLink: "https://meet.google.com/abc-defg-hij", htmlLink: "https://calendar.google.com/event?eid=1" });
    }
    return ok({});
  };
  f.calls = calls;
  return f;
}

test("google client: exchangeCode persiste refresh token + conta; accessToken renova; evento sai com Meet", async () => {
  const repo = makeMemRepo();
  const f = makeGoogleFetch();
  const g = makeGoogle({ fetch: f, clientId: "cid", clientSecret: "sec", repo });

  assert.equal(g.configured(), true);
  assert.equal(await g.connected(), false);
  assert.ok(g.authUrl("https://x/cb", "st1").includes("state=st1"));

  const rec = await g.exchangeCode("code-1", "https://x/cb");
  assert.equal(rec.refreshToken, "rt-1");
  assert.equal(rec.account, "time@leverads.com.br");
  assert.equal(await g.connected(), true);

  const ev = await g.createMeetEvent({
    summary: "Call LeverAds · Ana",
    start: { dateTime: "2026-07-14T15:00:00", timeZone: "America/Sao_Paulo" },
    end: { dateTime: "2026-07-14T15:45:00", timeZone: "America/Sao_Paulo" },
    attendeeEmail: "ana@x.com",
  });
  assert.equal(ev.meetUrl, "https://meet.google.com/abc-defg-hij");
  const calReq = f.calls.find((c) => c.url.includes("/calendars/primary/events"));
  assert.ok(calReq.url.includes("conferenceDataVersion=1"));
  const sent = JSON.parse(calReq.init.body);
  assert.equal(sent.attendees[0].email, "ana@x.com");
  assert.equal(sent.start.timeZone, "America/Sao_Paulo");
  assert.equal(sent.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
});

test("rotas: status/auth-url/callback com state + POST /leads/:id/meet grava callUrl", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", { id: "le1", saas: "leverads", name: "Ana", company: "Loja X", callAt: "2026-07-14T15:00", email: "ana@x.com" });
  const g = makeGoogle({ fetch: makeGoogleFetch(), clientId: "cid", clientSecret: "sec", repo });
  const app = Fastify();
  registerRoutes(app, repo, { google: g });

  // ainda não conectado
  let st = (await app.inject({ url: "/api/google/status" })).json();
  assert.deepEqual(st, { configured: true, connected: false, account: "" });
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/le1/meet" })).statusCode, 503);

  // auth-url emite state; callback com state desconhecido é 400
  const { url } = (await app.inject({ url: "/api/google/auth-url" })).json();
  const state = new URL(url).searchParams.get("state");
  assert.ok(state);
  assert.equal((await app.inject({ url: "/api/google/callback?code=c&state=errado" })).statusCode, 400);
  const cb = await app.inject({ url: `/api/google/callback?code=c&state=${state}` });
  assert.equal(cb.statusCode, 200);
  assert.ok(cb.body.includes("Google conectado"));

  st = (await app.inject({ url: "/api/google/status" })).json();
  assert.equal(st.connected, true);
  assert.equal(st.account, "time@leverads.com.br");

  // cria o Meet: grava callUrl/meetEventId no lead e registra na timeline
  const meet = (await app.inject({ method: "POST", url: "/api/leads/le1/meet" })).json();
  assert.equal(meet.callUrl, "https://meet.google.com/abc-defg-hij");
  const lead = await repo.get("leads", "le1");
  assert.equal(lead.callUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(lead.meetEventId, "ev1");
  const acts = (await repo.list("activities")).filter((a) => a.lead === "le1");
  assert.ok(acts.some((a) => a.meta?.event === "meet_created"));

  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nao-existe/meet" })).statusCode, 404);
  await app.close();
});

test("sem GOOGLE_CLIENT_ID/SECRET: auth-url e meet respondem 503 com instrução", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le1", saas: "leverads", name: "Ana" });
  const app = Fastify();
  registerRoutes(app, repo, { google: makeGoogle({ repo }) });
  assert.equal((await app.inject({ url: "/api/google/auth-url" })).statusCode, 503);
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/le1/meet" })).statusCode, 503);
  const st = (await app.inject({ url: "/api/google/status" })).json();
  assert.equal(st.configured, false);
  await app.close();
});
