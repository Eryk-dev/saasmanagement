// Transição pros e-mails @leverads (22/08/2026, endurecida em 01/09/2026): a
// conta PESSOAL do responsável organiza o Meet da call dele (gravação/resumo
// pela conta dele). A conta do TIME (uniquebox) só organiza produto do
// Workspace dela (UniqueKids) — sala da uniquebox com gente @leverads dentro
// não grava, então nos demais produtos sem conta pessoal pronta o Meet não
// nasce: o botão devolve 422 com instrução e o gatilho automático deixa o
// motivo na timeline. Calls antigas seguem com o time (resumo não se perde).
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

test("meet: produto @leverads sem conta pessoal pronta NÃO cai no time — 422 com instrução; UniqueKids segue no time", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("products", { id: "uniquekids", name: "UniqueKids" });
  await repo.create("leads", { id: "le2", saas: "leverads", name: "Beto", closer: "u_old", callAt: "2026-08-25T16:00" });
  await repo.create("leads", { id: "le6", saas: "leverads", name: "Caio", callAt: "2026-08-25T18:00" });
  await repo.create("leads", { id: "le5", saas: "uniquekids", name: "Bia", callAt: "2026-08-25T17:00" });

  // conexão antiga (só agenda) não organiza e o time não pode: erro diz quem conecta
  const r = await app.inject({ method: "POST", url: "/api/leads/le2/meet" });
  assert.equal(r.statusCode, 422, r.body);
  assert.match(r.json().error, /Bruna/);
  assert.match(r.json().error, /@leverads/);
  assert.ok(!f.calls.some((c) => c.url.includes("/calendars/primary/events") && c.init?.method === "POST"), "nenhum evento criado na conta do time");
  assert.ok(!(await repo.get("leads", "le2")).callUrl, "nada gravado no lead");

  // sem closer definido: mesma trava, pedindo o closer
  const r2 = await app.inject({ method: "POST", url: "/api/leads/le6/meet" });
  assert.equal(r2.statusCode, 422);
  assert.match(r2.json().error, /closer/);

  // UniqueKids é o Workspace da conta do time: continua nascendo nela
  const r3 = await app.inject({ method: "POST", url: "/api/leads/le5/meet" });
  assert.equal(r3.statusCode, 200, r3.body);
  assert.equal(r3.json().organizer, "");
  const calPost = f.calls.find((c) => c.url.includes("/calendars/primary/events") && c.init.method === "POST");
  assert.equal(calPost.init.headers.authorization, "Bearer at-team", "UniqueKids no token do time");
  assert.equal((await repo.get("leads", "le5")).meetOrganizer, "");
  await app.close();
});

test("integração automática @leverads sem conta do integrador: não cria na uniquebox e deixa o motivo na timeline (uma vez)", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.update("products", "leverads", { funnel: [
    { stage: "Novo lead", kind: "novo", conv: 1 },
    { stage: "Call agendada", kind: "call", conv: 1 },
    { stage: "Integração", kind: "integracao", conv: 1 },
    { stage: "Ganho", kind: "ganho", conv: 1 },
  ] });
  await repo.create("leads", { id: "le7", saas: "leverads", name: "Duda", stage: "Call agendada", callAt: "2026-09-02T17:00" });
  const wait = async (cond) => { for (let i = 0; i < 60 && !(await cond()); i++) await new Promise((r) => setImmediate(r)); };

  await app.inject({ method: "PATCH", url: "/api/leads/le7", payload: { stage: "Integração", integrator: "u_old", integrationAt: "2026-09-03T15:00" } });
  await wait(async () => (await repo.get("leads", "le7")).meetSkipNoted);

  const lead = await repo.get("leads", "le7");
  assert.ok(!lead.integrationCallUrl, "sala NÃO nasce na conta do time");
  const skips = (await repo.list("activities")).filter((a) => a.lead === "le7" && a.meta?.event === "meet_skipped");
  assert.equal(skips.length, 1);
  assert.equal(skips[0].meta.responsible, "u_old");
  assert.equal(skips[0].meta.kind, "integracao");
  await app.close();
});

test("agendar a call pelo PATCH já cria o Meet na conta do closer (sem botão); o botão depois não duplica", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("leads", { id: "le8", saas: "leverads", name: "Rui" });

  const r = await app.inject({ method: "PATCH", url: "/api/leads/le8", payload: { callAt: "2030-01-05T15:00", closer: "u_clo" } });
  assert.equal(r.statusCode, 200, r.body);
  const lead = await repo.get("leads", "le8");
  assert.ok(String(lead.callUrl).includes("meet.google.com"), "sala nasceu no agendamento");
  assert.equal(lead.meetOrganizer, "u_clo");
  // POST com conferenceDataVersion = criação do MEET (o espelho de agenda pessoal
  // também POSTa em /events, sem conference — não conta aqui)
  const calPost = f.calls.find((c) => c.url.includes("conferenceDataVersion") && c.init.method === "POST");
  assert.equal(calPost.init.headers.authorization, "Bearer at-clo", "sala do closer, não do time");

  // botão do Meu dia chega DEPOIS da sala pronta: devolve a existente, sem 2º evento
  const posts = () => f.calls.filter((c) => c.url.includes("conferenceDataVersion") && c.init.method === "POST").length;
  const before = posts();
  const again = await app.inject({ method: "POST", url: "/api/leads/le8/meet" });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().existing, true);
  assert.equal(again.json().callUrl, lead.callUrl);
  assert.equal(posts(), before, "não duplica o evento");
  await app.close();
});

test("sala @leverads que nasceu na conta do time (call ainda futura) é recriada na conta do closer", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("leads", {
    id: "le9", saas: "leverads", name: "Téo", closer: "u_clo", callAt: "2030-02-01T14:00",
    callUrl: "https://meet.google.com/old-team-room", meetEventId: "ev_old",
    meetScheduledAt: "2030-02-01T17:00:00.000Z", meetOrganizer: "",
  });

  // qualquer toque no agendamento (aqui: reatribuir o closer) dispara o conserto
  await app.inject({ method: "PATCH", url: "/api/leads/le9", payload: { closer: "u_clo" } });
  const lead = await repo.get("leads", "le9");
  assert.equal(lead.meetOrganizer, "u_clo");
  assert.equal(lead.callUrl, "https://meet.google.com/abc-defg-hij", "sala nova na conta do closer");
  const del = f.calls.find((c) => c.url.includes("/events/ev_old") && c.init.method === "DELETE");
  assert.ok(del, "convite velho cancelado (senão o lead fica com dois)");
  assert.equal(del.init.headers.authorization, "Bearer at-team", "cancelado pela conta que organizou (time)");
  const calPost = f.calls.find((c) => c.url.includes("conferenceDataVersion") && c.init.method === "POST");
  assert.equal(calPost.init.headers.authorization, "Bearer at-clo");
  await app.close();
});

test("call que JÁ aconteceu nunca é recriada (o resumo pendente mora na sala velha)", async () => {
  const f = makeFetch();
  const { app, repo } = await buildApp(f);
  await repo.create("leads", {
    id: "le10", saas: "leverads", name: "Vera", closer: "u_clo", callAt: "2026-08-20T14:00",
    callUrl: "https://meet.google.com/old-team-room", meetEventId: "ev_old",
    meetScheduledAt: "2026-08-20T17:00:00.000Z", meetOrganizer: "",
  });
  await app.inject({ method: "PATCH", url: "/api/leads/le10", payload: { closer: "u_clo" } });
  const lead = await repo.get("leads", "le10");
  assert.equal(lead.callUrl, "https://meet.google.com/old-team-room", "sala antiga intacta");
  assert.ok(!f.calls.some((c) => c.url.includes("conferenceDataVersion") && c.init?.method === "POST"), "nenhum Meet novo");
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
