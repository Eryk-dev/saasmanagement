// Transição pros e-mails @leverads (22/08/2026): a conta PESSOAL do responsável
// organiza o Meet da call dele (gravação/resumo pela conta dele); a conta do
// time fica de fallback e continua dona das calls antigas — nenhum resumo
// pendente se perde na troca.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeGoogle } = await import("../src/google.js");
const { makeGoogleUser } = await import("../src/google-user.js");
const { makeCallSummarizer } = await import("../src/call-summaries.js");

const MEET_SCOPES = "calendar.events https://www.googleapis.com/auth/meetings.space.created https://www.googleapis.com/auth/meetings.space.settings https://www.googleapis.com/auth/meetings.space.readonly drive.readonly";

// fetch fake: token por refresh_token (rt-team → at-team, rt-clo → at-clo) e
// captura o bearer usado no POST do Calendar.
function makeFetch() {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const ok = (body) => ({ status: 200, json: async () => body });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const p = Object.fromEntries(new URLSearchParams(String(init.body)));
      return ok({ access_token: p.refresh_token === "rt-clo" ? "at-clo" : "at-team", expires_in: 3600 });
    }
    if (String(url).includes("/calendars/primary/events")) {
      return ok({ id: "ev1", hangoutLink: "https://meet.google.com/abc-defg-hij", htmlLink: "https://cal/x" });
    }
    if (String(url).includes("meet.googleapis.com/v2/spaces/abc-defg-hij")) return ok({ name: "spaces/sp1", meetingCode: "abc-defg-hij" });
    if (String(url).includes("meet.googleapis.com/v2/spaces/sp1")) return ok({});
    return ok({});
  };
  f.calls = calls;
  return f;
}

async function buildApp(f) {
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt-team", account: "contato@uniquebox.com.br" });
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  // closer com conta @leverads pronta (escopos do Meet) e um com conexão ANTIGA (só agenda)
  await repo.create("users", { id: "u_clo", name: "Jon", roles: ["closer"], google: { refreshToken: "rt-clo", account: "jon@leverads.com.br", scopes: MEET_SCOPES } });
  await repo.create("users", { id: "u_old", name: "Bruna", roles: ["closer"], google: { refreshToken: "rt-old", account: "bruna@gmail.com", scopes: "https://www.googleapis.com/auth/calendar.events openid email" } });
  const g = makeGoogle({ fetch: f, clientId: "cid", clientSecret: "sec", repo });
  const gu = makeGoogleUser({ fetch: f, clientId: "cid", clientSecret: "sec", repo });
  const app = Fastify();
  registerRoutes(app, repo, { google: g, googleUser: gu });
  return { app, repo };
}

test("meet: conta @leverads do closer organiza a call dele (token dele, meetOrganizer gravado)", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("leads", { id: "le1", saas: "leverads", name: "Ana", closer: "u_clo", callAt: "2026-08-25T15:00" });

  const r = await app.inject({ method: "POST", url: "/api/leads/le1/meet" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().organizer, "u_clo");
  const calPost = f.calls.find((c) => c.url.includes("/calendars/primary/events") && c.init.method === "POST");
  assert.equal(calPost.init.headers.authorization, "Bearer at-clo", "o evento nasce com o token DO CLOSER");
  const lead = await repo.get("leads", "le1");
  assert.equal(lead.meetOrganizer, "u_clo");
  assert.ok(lead.callUrl.includes("meet.google.com"));
  // organizador é o próprio closer: NÃO espelha na agenda dele (o evento real já é dele)
  assert.ok(!lead.calCallEventId, "sem espelho duplicado pro organizador");
  await app.close();
});

test("meet: conexão antiga (só agenda) cai na conta do time; sem closer idem", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("leads", { id: "le2", saas: "leverads", name: "Beto", closer: "u_old", callAt: "2026-08-25T16:00" });

  const r = await app.inject({ method: "POST", url: "/api/leads/le2/meet" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().organizer, "");
  const calPost = f.calls.find((c) => c.url.includes("/calendars/primary/events") && c.init.method === "POST");
  assert.equal(calPost.init.headers.authorization, "Bearer at-team", "sem escopos do Meet, o time organiza");
  assert.equal((await repo.get("leads", "le2")).meetOrganizer, "");
  await app.close();
});

test("resumo: call organizada pela conta do closer é lida pelo token DELE, mesmo com o time desconectado; call antiga segue no time", async () => {
  const repo = makeMemRepo();
  const used = [];
  const fakeApi = (tag) => ({
    fetchTranscript: async () => { used.push(tag); return { text: "cliente topou", startTime: "", endTime: "", recordingUrl: "" }; },
    fetchTranscriptFromDrive: async () => null,
  });
  const google = {
    connected: async () => false, // time DESCONECTADO (ex.: trocando a conta)
    forUser: (_gu, uid) => fakeApi(`user:${uid}`),
    ...fakeApi("team"),
  };
  const googleUser = { connectedFor: async (uid) => uid === "u_clo" };
  const anthropic = { configured: () => true, summarizeCall: async () => ({ summary: { temperatura: "quente", resumo: "fechou" } }) };
  await repo.create("leads", { id: "le3", saas: "", name: "Ana", stage: "Call agendada", closer: "u_clo", callUrl: "https://meet.google.com/xyz-1234-abc", meetEventId: "ev9", meetScheduledAt: "2026-08-20T15:00:00.000Z", meetOrganizer: "u_clo" });
  await repo.create("leads", { id: "le4", saas: "", name: "Old", stage: "Call agendada", callUrl: "https://meet.google.com/old-1234-abc", meetEventId: "ev8", meetScheduledAt: "2026-08-20T15:00:00.000Z" });

  const worker = makeCallSummarizer({ repo, google, googleUser, anthropic, log: { warn() {}, info() {} } });
  const r = await worker.summarizeLead("le3");
  assert.equal(r.ok, true);
  assert.deepEqual(used, ["user:u_clo"], "a transcrição veio da conta do organizador");

  // call ANTIGA (sem organizador): depende do time; desconectado = not_connected, nada quebra
  const r2 = await worker.summarizeLead("le4");
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "not_connected");
});
