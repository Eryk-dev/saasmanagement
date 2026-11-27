// O que o agente Cases lê do cockpit (calls/cases-feed.js): a lista das
// reuniões gravadas, a transcrição inteira de uma (buscada no Google pelo
// caminho do resumo e guardada em meeting_transcripts) e os cases
// autorizados. Tudo offline: Google falso no molde do call-summaries.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeCasesFeed } from "../src/calls/cases-feed.js";
import { registerCasesFeedRoutes } from "../src/calls/routes.cases-feed.js";
import { TRANSCRIPTS } from "../src/calls/meeting-transcripts.js";
import { makeCallSummarizer } from "../src/calls/call-summaries.js";
import { makeGoogle } from "../src/google/google.js";
import { bump, subscribe } from "../src/platform/changes.js";

const { registerRoutes } = await import("../src/routes.js");

const NOW = new Date("2026-11-27T12:00:00.000Z");
const TRANSCRIPT = {
  text: "Leonardo Parra: Oi Ana, tudo bem?\nAna: Tudo! A gente tem uma loja de casa e decoração com uns 3 mil anúncios.",
  startTime: "2026-11-20T17:02:00Z",
  endTime: "2026-11-20T17:41:00Z",
  recordingUrl: "https://drive.google.com/file/d/f123/view",
  conferenceRecord: "conferenceRecords/cr1",
};
const meetUrl = (code) => `https://meet.google.com/${code}`;

// Google falso: a conta do time e, por forUser, a conta de cada pessoa. Cada
// busca fica anotada com a conta que buscou.
function fakeGoogle({ meet = {}, drive = {}, connected = true } = {}) {
  const calls = [];
  const client = (who) => ({
    connected: async () => connected,
    fetchTranscript: async (code) => {
      calls.push({ who, via: "meet", code });
      const t = meet[code];
      if (t instanceof Error) throw t;
      return t || null;
    },
    fetchTranscriptFromDrive: async (args) => {
      calls.push({ who, via: "drive", ...args });
      const t = drive[args.eventId];
      if (t instanceof Error) throw t;
      return t || null;
    },
  });
  return { ...client("time"), forUser: (_gu, userId) => client(userId), calls };
}
const fakeGoogleUser = (ready = []) => ({ connectedFor: async (id) => ready.includes(id) });
const quiet = { info() {}, warn() {} };

async function world() {
  const repo = makeMemRepo();
  for (const u of [
    { id: "leonardo", name: "Leonardo Parra", roles: ["closer"] },
    { id: "jonan", name: "Jonan", roles: ["closer"] },
    { id: "vitor", name: "Vitor Silva", roles: ["integrator"] },
  ]) await repo.create("users", u);

  // Ana: Price, casa, call atual realizada na sala do Leonardo.
  await repo.create("leads", {
    id: "ana", saas: "leverads", name: "Ana", formProduct: "price", niche: "casa", listings: "1000-5000", orders: "1000-2000", accounts: "1",
    closer: "leonardo", callAt: "2026-11-20T14:00", callUrl: meetUrl("aaa-aaaa-aaa"), meetEventId: "ev-a", meetOrganizer: "leonardo",
    meetScheduledAt: "2026-11-20T17:00:00.000Z",
  });
  await repo.create("meetings", { id: "mt_ana_202611201700", lead: "ana", saas: "leverads", kind: "call", at: "2026-11-20T17:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: meetUrl("aaa-aaaa-aaa"), eventId: "ev-a", summarized: true });

  // Bruno: OEM (o formulário não pergunta nicho). A call foi remarcada e levou
  // a sala: duas linhas realizadas na mesma sala. E a integração no card.
  await repo.create("leads", {
    id: "bruno", saas: "leverads", name: "Bruno", formProduct: "oem", listings: "5000-10000", accounts: "2-3", closer: "jonan",
    callAt: "2026-11-19T15:00", callUrl: meetUrl("bbb-bbbb-bbb"), meetEventId: "ev-b", meetOrganizer: "jonan",
    integrator: "vitor", integrationCallUrl: meetUrl("iii-iiii-iii"), integrationMeetEventId: "ev-int", integrationScheduledAt: "2026-11-24T13:00:00.000Z",
    integrationMeetOrganizer: "vitor", integrationSummaryFor: "ev-int",
  });
  await repo.create("meetings", { id: "mt_bruno_202611181300", lead: "bruno", saas: "leverads", kind: "call", at: "2026-11-18T13:00:00.000Z", closer: "jonan", status: "realizada", meetUrl: meetUrl("bbb-bbbb-bbb"), eventId: "ev-b", summarized: false });
  await repo.create("meetings", { id: "mt_bruno_202611191800", lead: "bruno", saas: "leverads", kind: "call", at: "2026-11-19T18:00:00.000Z", closer: "jonan", status: "realizada", meetUrl: meetUrl("bbb-bbbb-bbb"), eventId: "ev-b", summarized: false });

  // Carla: a 1ª call, do Jonan, numa sala que outra conta criou (está só na
  // atividade de quando a sala nasceu), e a call atual do Leonardo numa sala
  // nova que a conta do Jonan criou.
  await repo.create("leads", {
    id: "carla", saas: "leverads", name: "Carla", formProduct: "ads", niche: "moda", listings: "0-100", closer: "leonardo",
    callAt: "2026-11-21T10:00", callUrl: meetUrl("ddd-dddd-ddd"), meetEventId: "ev-d", meetOrganizer: "jonan",
    callHistory: [{ at: "2026-11-10T10:00", closer: "jonan", meetEventId: "ev-c", callUrl: meetUrl("ccc-cccc-ccc") }],
  });
  await repo.create("meetings", { id: "mt_carla_202611101300", lead: "carla", saas: "leverads", kind: "call", at: "2026-11-10T13:00:00.000Z", closer: "jonan", status: "realizada", meetUrl: meetUrl("ccc-cccc-ccc"), eventId: "ev-c", summarized: true });
  await repo.create("meetings", { id: "mt_carla_202611211300", lead: "carla", saas: "leverads", kind: "call", at: "2026-11-21T13:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: meetUrl("ddd-dddd-ddd"), eventId: "ev-d", summarized: false });
  await repo.create("activities", { id: "ac1", lead: "carla", saas: "leverads", type: "system", meta: { event: "meet_created", kind: "call", url: meetUrl("ccc-cccc-ccc"), organizer: "vitor" } });

  // O que não entra: lead interno, outro produto, call sem sala, falta,
  // agendada, antes do período.
  await repo.create("leads", { id: "time", saas: "leverads", name: "Teste do time", internal: true, closer: "leonardo" });
  await repo.create("leads", { id: "kids", saas: "uniquekids", name: "Família", closer: "leonardo" });
  await repo.create("meetings", { id: "mt_time_202611221300", lead: "time", saas: "leverads", kind: "call", at: "2026-11-22T13:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: meetUrl("ttt-tttt-ttt"), eventId: "ev-t" });
  await repo.create("meetings", { id: "mt_kids_202611221400", lead: "kids", saas: "uniquekids", kind: "call", at: "2026-11-22T14:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: meetUrl("kkk-kkkk-kkk"), eventId: "ev-k" });
  await repo.create("meetings", { id: "mt_ana_202611151300", lead: "ana", saas: "leverads", kind: "call", at: "2026-11-15T13:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: "", eventId: "" });
  await repo.create("meetings", { id: "mt_ana_202611161300", lead: "ana", saas: "leverads", kind: "call", at: "2026-11-16T13:00:00.000Z", closer: "leonardo", status: "no_show", meetUrl: meetUrl("nnn-nnnn-nnn"), eventId: "ev-n" });
  await repo.create("meetings", { id: "mt_ana_202612011300", lead: "ana", saas: "leverads", kind: "call", at: "2026-12-01T13:00:00.000Z", closer: "leonardo", status: "agendada", meetUrl: meetUrl("fff-ffff-fff"), eventId: "ev-f" });
  await repo.create("meetings", { id: "mt_carla_202610301300", lead: "carla", saas: "leverads", kind: "call", at: "2026-10-30T13:00:00.000Z", closer: "leonardo", status: "realizada", meetUrl: meetUrl("ooo-oooo-ooo"), eventId: "ev-o" });

  // Reuniões dos registros: integração (uma cancelada) e acompanhamento de CS.
  await repo.create("customers", { id: "cu1", saas: "leverads", name: "Loja da Dani", leadId: "dani" });
  await repo.create("leads", { id: "dani", saas: "leverads", name: "Dani", formProduct: "ads", niche: "beleza", closer: "jonan" });
  await repo.create("onboardings", { id: "ob1", customer: "cu1", meetings: [
    { id: "mt_rec1", at: "2026-11-25T17:00:00.000Z", status: "scheduled", meetUrl: meetUrl("rrr-rrrr-rrr"), eventId: "ev-r", responsible: "vitor", organizer: "vitor", summaryAt: "2026-11-25T18:30:00.000Z" },
    { id: "mt_rec2", at: "2026-11-25T19:00:00.000Z", status: "canceled", meetUrl: meetUrl("xxx-xxxx-xxx"), eventId: "ev-x", responsible: "vitor", organizer: "vitor" },
  ] });
  await repo.create("cs_followups", { id: "cs1", customer: "cu1", meetings: [
    { id: "mt_cs1", at: "2026-11-26T15:00:00.000Z", status: "scheduled", meetUrl: meetUrl("sss-ssss-sss"), eventId: "ev-s", responsible: "jonan", organizer: "" },
  ] });
  return repo;
}

const feedOf = (repo, { google = fakeGoogle({ meet: { "aaa-aaaa-aaa": TRANSCRIPT } }), ready = ["leonardo", "jonan", "vitor"], live = async () => [] } = {}) =>
  makeCasesFeed({ repo, google, googleUser: fakeGoogleUser(ready), log: quiet, live, now: () => NOW });

test("lista: uma reunião por sala, só as que aconteceram, sem transcrição, com o nicho e as faixas do formulário", async () => {
  const repo = await world();
  const list = await feedOf(repo).meetings({ since: "2026-11-01" });
  assert.deepEqual(list.map((m) => m.id), [
    "mt_carla_202611101300", "mt_bruno_202611191800", "mt_ana_202611201700", "mt_carla_202611211300",
    "in_bruno_202611241300", "mt_rec1", "mt_cs1",
  ]);
  assert.ok(!JSON.stringify(list).includes("Oi Ana"), "a lista não traz transcrição");

  const ana = list.find((m) => m.id === "mt_ana_202611201700");
  assert.deepEqual(ana, {
    id: "mt_ana_202611201700", kind: "call", at: "2026-11-20T17:00:00.000Z", saas: "leverads", product: "leverprice",
    closer: { id: "leonardo", name: "Leonardo Parra" }, integrator: null,
    lead: {
      id: "ana",
      niche: { value: "casa", label: "Casa & Decoração" },
      listings: { value: "1000-5000", label: "1.000 a 5.000" },
      orders: { value: "1000-2000", label: "1.000 a 2.000" },
      accounts: { value: "1", label: "1 conta" },
    },
    summarized: true,
  });

  // Call remarcada com a sala junto: aparece uma vez, no horário mais recente.
  const bruno = list.find((m) => m.id === "mt_bruno_202611191800");
  assert.deepEqual(bruno.sameRoom, ["mt_bruno_202611181300"]);
  assert.equal(bruno.product, "oem");
  assert.deepEqual(bruno.lead.niche, { value: "autopecas", label: "Autopeças" }, "OEM é autopeças por definição");
  assert.equal(bruno.lead.orders, null);

  // Faixa de formulário antigo vem sem rótulo, nunca com um inventado.
  assert.deepEqual(list.find((m) => m.id === "mt_carla_202611101300").lead.listings, { value: "0-100", label: "" });

  const integ = list.find((m) => m.id === "in_bruno_202611241300");
  assert.deepEqual([integ.kind, integ.integrator, integ.closer.id, integ.summarized], ["integracao", { id: "vitor", name: "Vitor Silva" }, "jonan", true]);
  const rec = list.find((m) => m.id === "mt_rec1");
  assert.deepEqual([rec.kind, rec.lead.id, rec.lead.niche.label, rec.integrator.id, rec.summarized], ["integracao", "dani", "Beleza", "vitor", true]);
  assert.equal(list.find((m) => m.id === "mt_cs1").kind, "acompanhamento");

  // Filtros: tipo, fim do período, outro produto.
  const feed = feedOf(repo);
  assert.deepEqual((await feed.meetings({ since: "2026-11-01", kind: "integracao" })).map((m) => m.id), ["in_bruno_202611241300", "mt_rec1"]);
  assert.deepEqual((await feed.meetings({ since: "2026-11-01", kind: "acompanhamento" })).map((m) => m.id), ["mt_cs1"]);
  assert.deepEqual((await feed.meetings({ since: "2026-11-19", until: "2026-11-21", kind: "call" })).map((m) => m.id), ["mt_bruno_202611191800", "mt_ana_202611201700"]);
  assert.ok((await feed.meetings({ since: "2026-11-01", saas: "uniquekids" })).some((m) => m.id === "mt_kids_202611221400"));
});

test("transcrição: Meet primeiro na conta de quem organizou, guardada; a segunda leitura não vai ao Google", async () => {
  const repo = await world();
  const google = fakeGoogle({ meet: { "aaa-aaaa-aaa": TRANSCRIPT } });
  const feed = feedOf(repo, { google });

  const first = await feed.transcript("mt_ana_202611201700");
  assert.equal(first.ok, true);
  assert.equal(first.transcript.text, TRANSCRIPT.text);
  assert.deepEqual([first.transcript.source, first.transcript.cached, first.transcript.chars], ["meet", false, TRANSCRIPT.text.length]);
  assert.deepEqual(google.calls.map((c) => [c.who, c.via]), [["leonardo", "meet"]]);

  const kept = await repo.get(TRANSCRIPTS, "aaa-aaaa-aaa");
  assert.deepEqual([kept.lead, kept.kind, kept.fetchedBy, kept.fetchedAt, kept.conferenceRecord], ["ana", "call", "agente", NOW.toISOString(), "conferenceRecords/cr1"]);

  const again = await feed.transcript("mt_ana_202611201700");
  assert.deepEqual([again.ok, again.transcript.cached, again.transcript.text], [true, true, TRANSCRIPT.text]);
  assert.equal(google.calls.length, 1, "a segunda leitura não chamou o Google");
});

test("a conta que lê: a do organizador de cada sala, e a do time quando a dele não serve", async () => {
  const codes = ["aaa-aaaa-aaa", "bbb-bbbb-bbb", "ccc-cccc-ccc", "ddd-dddd-ddd", "iii-iiii-iii", "rrr-rrrr-rrr", "sss-ssss-sss"];
  // Mundo novo a cada leitura: a sala já guardada não iria ao Google.
  const who = async (id, opts = {}) => {
    const google = fakeGoogle({ meet: Object.fromEntries(codes.map((c) => [c, TRANSCRIPT])), ...opts });
    const r = await feedOf(await world(), { google, ...(opts.ready ? { ready: opts.ready } : {}) }).transcript(id);
    return r.ok ? google.calls[0].who : r.reason;
  };
  assert.equal(await who("mt_carla_202611211300"), "jonan", "call atual: o organizador gravado no lead, mesmo que não seja o closer");
  assert.equal(await who("mt_carla_202611101300"), "vitor", "sala antiga: quem criou a sala, pela atividade de quando ela nasceu");
  assert.equal(await who("mt_bruno_202611191800"), "jonan", "sala da call atual, remarcada: o organizador do lead");
  assert.equal(await who("in_bruno_202611241300"), "vitor", "integração do card: o organizador da integração");
  assert.equal(await who("mt_rec1"), "vitor", "reunião do registro: o organizador dela");
  assert.equal(await who("mt_cs1"), "time", "registro organizado pela conta do time");
  assert.equal(await who("mt_ana_202611201700", { ready: [] }), "time", "organizador sem Google conectado: a conta do time");
  assert.equal(await who("mt_ana_202611201700", { ready: [], connected: false }), "not_connected");
});

test("motivos de falha iguais aos do resumo, e nada é guardado quando falha", async () => {
  const repo = await world();
  const read = (google, id = "mt_ana_202611201700") => feedOf(repo, { google }).transcript(id);
  const boom = new Error("Meet API spaces/aaa-aaaa-aaa -> 403: SERVICE_DISABLED");

  const live = await read(fakeGoogle({ meet: { "aaa-aaaa-aaa": { live: true, startTime: "2026-11-20T17:00:00Z" } } }));
  assert.equal(live.reason, "call_in_progress");
  assert.match(live.detail, /sala do Meet ainda está aberta/);

  const none = await read(fakeGoogle({ meet: { "aaa-aaaa-aaa": boom } }));
  assert.equal(none.reason, "transcript_not_ready");
  assert.match(none.detail, /meet: .*SERVICE_DISABLED/);
  assert.match(none.detail, /drive: /);
  assert.equal(await repo.get(TRANSCRIPTS, "aaa-aaaa-aaa"), null);

  assert.deepEqual(await read(fakeGoogle(), "nao-existe"), { ok: false, reason: "not_found" });
  assert.deepEqual(await read(fakeGoogle(), "mt_ana_202611151300"), { ok: false, reason: "no_meet" });
  assert.deepEqual(await read(fakeGoogle(), "in_ana_202611241300"), { ok: false, reason: "not_found" }, "integração que o card não tem");
  // Pelo id só sai o que a lista mostraria: falta, call futura, lead do time,
  // reunião cancelada e outro produto ficam de fora, sem ir ao Google.
  const quiet404 = fakeGoogle({ meet: { "nnn-nnnn-nnn": TRANSCRIPT, "fff-ffff-fff": TRANSCRIPT, "ttt-tttt-ttt": TRANSCRIPT, "xxx-xxxx-xxx": TRANSCRIPT, "kkk-kkkk-kkk": TRANSCRIPT } });
  for (const id of ["mt_ana_202611161300", "mt_ana_202612011300", "mt_time_202611221300", "mt_rec2", "mt_kids_202611221400"]) {
    assert.deepEqual(await read(quiet404, id), { ok: false, reason: "not_found" }, id);
  }
  assert.equal(quiet404.calls.length, 0);
  assert.equal((await feedOf(repo, { google: quiet404 }).transcript("mt_kids_202611221400", { saas: "uniquekids" })).ok, true, "outro produto, quando pedido");

  // Meet API caída, o Doc do Drive salva: o evento, o nome e o horário certos.
  const google = fakeGoogle({ meet: { "aaa-aaaa-aaa": boom }, drive: { "ev-a": { ...TRANSCRIPT, endTime: "", source: "drive", recordingUrl: "https://docs.google.com/document/d/doc1/view" } } });
  const viaDrive = await read(google);
  assert.deepEqual([viaDrive.ok, viaDrive.transcript.source], [true, "drive"]);
  assert.deepEqual(google.calls[1], { who: "leonardo", via: "drive", eventId: "ev-a", leadName: "Ana", since: "2026-11-20T17:00:00.000Z" });
});

test("sala que serve a duas calls: só a reunião da lista lê a sala, e o que foi guardado antes do horário dela não vale", async () => {
  const repo = await world();
  await repo.create(TRANSCRIPTS, { id: "bbb-bbbb-bbb", text: "conversa da primeira call", chars: 25, source: "meet", fetchedAt: "2026-11-18T15:00:00.000Z", fetchedBy: "agente" });
  const google = fakeGoogle({ meet: { "bbb-bbbb-bbb": TRANSCRIPT } });
  const feed = feedOf(repo, { google });

  // A linha mais antiga da sala não lê nada: o Google devolveria a conversa
  // mais recente da sala com o id errado.
  const same = { ok: false, reason: "same_room", meeting: "mt_bruno_202611191800" };
  assert.deepEqual(await feed.transcript("mt_bruno_202611181300"), same);
  assert.equal(google.calls.length, 0);

  const real = await feed.transcript("mt_bruno_202611191800");
  assert.deepEqual([real.transcript.text, real.transcript.cached, google.calls.length], [TRANSCRIPT.text, false, 1], "guardada antes da call das 18h do dia 19: vai ao Google");
  assert.equal((await repo.get(TRANSCRIPTS, "bbb-bbbb-bbb")).fetchedAt, NOW.toISOString());

  // Nem depois de guardada a conversa do dia 19 sai pelo id do dia 18.
  assert.deepEqual(await feed.transcript("mt_bruno_202611181300"), same);
});

test("o resumo automático guarda a transcrição que buscou; guardar falhando não segura o resumo", async () => {
  const SUMMARY = { resumo: "Ana quer ajustar preço sozinha.", temperatura: "morna", dores: [], objecoes: [], compromissos: [], followup: {} };
  const anthropic = { configured: () => true, summarizeCall: async () => ({ summary: SUMMARY }) };
  const at = new Date(Date.now() - 3 * 3600_000).toISOString();
  const lead = { id: "le1", saas: "leverads", name: "Ana", stage: "Call agendada", callUrl: meetUrl("abc-defg-hij"), meetEventId: "ev1", meetScheduledAt: at };

  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", lead);
  await repo.create("meetings", { id: "mt_le1", lead: "le1", saas: "leverads", kind: "call", at, closer: "", status: "realizada", meetUrl: lead.callUrl, eventId: "ev1" });
  const google = fakeGoogle({ meet: { "abc-defg-hij": TRANSCRIPT } });
  const w = makeCallSummarizer({ repo, google, anthropic, log: quiet });
  assert.equal((await w.summarizeLead("le1")).ok, true);
  const kept = await repo.get(TRANSCRIPTS, "abc-defg-hij");
  assert.deepEqual([kept.text, kept.fetchedBy, kept.lead, kept.eventId], [TRANSCRIPT.text, "resumo", "le1", "ev1"]);

  // O agente lê a mesma sala sem ir ao Google de novo.
  const r = await makeCasesFeed({ repo, google, log: quiet }).transcript("mt_le1");
  assert.deepEqual([r.ok, r.transcript.cached, google.calls.length], [true, true, 1]);

  // Banco recusando a gravação da transcrição: o resumo sai do mesmo jeito.
  const broken = makeMemRepo();
  await broken.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await broken.create("leads", lead);
  const refuse = (fn) => async (name, ...rest) => { if (name === TRANSCRIPTS) throw new Error("disco cheio"); return fn(name, ...rest); };
  const repo2 = { ...broken, get: refuse(broken.get.bind(broken)), create: refuse(broken.create.bind(broken)) };
  const w2 = makeCallSummarizer({ repo: repo2, google: fakeGoogle({ meet: { "abc-defg-hij": TRANSCRIPT } }), anthropic, log: quiet });
  assert.equal((await w2.summarizeLead("le1")).ok, true);
  assert.ok((await broken.list("activities")).some((a) => a.meta?.event === "call_summary"));
});

test("com o cliente de verdade do Google (fetch falso): a fala inteira chega e a segunda leitura não faz chamada nenhuma", async () => {
  const repo = await world();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "time@leverads.com.br" });
  await repo.update("leads", "ana", { meetOrganizer: "" });
  const urls = [];
  const f = async (url) => {
    const u = String(url);
    urls.push(u);
    const ok = (body) => ({ status: 200, json: async () => body });
    if (u.includes("oauth2.googleapis.com/token")) return ok({ access_token: "at", expires_in: 3600 });
    if (u.includes("/v2/spaces/aaa-aaaa-aaa")) return ok({ name: "spaces/sp1" });
    if (u.includes("/v2/conferenceRecords?")) return ok({ conferenceRecords: [{ name: "conferenceRecords/cr1", startTime: "2026-11-20T17:02:00Z", endTime: "2026-11-20T17:41:00Z" }] });
    if (u.includes("cr1/transcripts/t1/entries")) return ok({ transcriptEntries: [
      { participant: "conferenceRecords/cr1/participants/p1", text: "Oi Ana, tudo bem?" },
      { participant: "conferenceRecords/cr1/participants/p2", text: "Tudo! A gente tem uma loja de casa e decoração." },
    ] });
    if (u.includes("cr1/transcripts")) return ok({ transcripts: [{ name: "conferenceRecords/cr1/transcripts/t1", state: "ENDED" }] });
    if (u.includes("cr1/participants")) return ok({ participants: [
      { name: "conferenceRecords/cr1/participants/p1", signedinUser: { displayName: "Leonardo Parra" } },
      { name: "conferenceRecords/cr1/participants/p2", anonymousUser: { displayName: "Ana" } },
    ] });
    if (u.includes("cr1/recordings")) return ok({ recordings: [] });
    return ok({});
  };
  const google = makeGoogle({ fetch: f, clientId: "cid", clientSecret: "sec", repo });
  const feed = makeCasesFeed({ repo, google, googleUser: fakeGoogleUser([]), log: quiet, now: () => NOW });

  const r = await feed.transcript("mt_ana_202611201700");
  assert.equal(r.transcript.text, "Leonardo Parra: Oi Ana, tudo bem?\nAna: Tudo! A gente tem uma loja de casa e decoração.");
  assert.deepEqual([r.transcript.startTime, r.transcript.endTime], ["2026-11-20T17:02:00Z", "2026-11-20T17:41:00Z"]);
  const before = urls.length;
  assert.equal((await feed.transcript("mt_ana_202611201700")).transcript.cached, true);
  assert.equal(urls.length, before);
});

test("cases: só os autorizados; 'pode publicar' = publicado, autorizado e completo; nada do cliente do cockpit nem do print", async () => {
  const repo = makeMemRepo();
  const metric = { metric: "gmvTotal", label: "gerado por anúncios da Lever", value: "R$ 442 mil", period: "todo o período", source: "painel", proofUrl: "https://drive.google.com/print-da-conta.png" };
  await repo.create("cases", { id: "c1", saas: "leverads", name: "Motvia", niche: "Autopeças", headline: "574.780 anúncios criados", metrics: [metric], public: true, order: 1, authorizedAt: "2026-09-20T12:00:00.000Z", authorizedBy: "leonardo", authorizedVia: "whatsapp", customerId: "cu9", evidence: { orgId: "11111111-1111-1111-1111-111111111111" }, quoteAuthor: "Fulano de Tal", logoUrl: "https://logo/x.png", apuradoEm: "2026-09-14" });
  await repo.create("cases", { id: "c2", saas: "leverads", name: "Dyno Nutri", niche: "Suplementos", headline: "R$ 60 mil em 20 dias", metrics: [{ ...metric, source: "cliente", proofUrl: "" }], public: false, order: 2, authorizedAt: "2026-09-21T12:00:00.000Z" });
  await repo.create("cases", { id: "c3", saas: "leverads", name: "Casa Bela", niche: "Casa & Decoração", headline: "dobrou", metrics: [{ ...metric, source: "" }], public: true, order: 2, authorizedAt: "2026-10-01T12:00:00.000Z" });
  await repo.create("cases", { id: "c4", saas: "leverads", name: "Rascunho", niche: "", metrics: [], public: false, order: 0, authorizedAt: "" });

  const live = async () => [{ ...(await repo.get("cases", "c1")), metrics: [{ ...metric, value: "R$ 1,5 mi" }], liveAt: "2026-11-27T11:00:00.000Z" }];
  const cases = await makeCasesFeed({ repo, google: null, log: quiet, live }).cases();

  assert.deepEqual(cases.map((c) => c.id), ["c1", "c3", "c2"], "ordem do time, depois a autorização mais recente; o rascunho fica de fora");
  assert.deepEqual(cases.map((c) => [c.id, c.public, c.canPublish]), [["c1", true, true], ["c3", true, false], ["c2", false, false]]);
  assert.deepEqual(cases.map((c) => c.formNiche), ["autopecas", "casa", "outros"]);
  assert.deepEqual(cases[0].metrics, [{ label: "gerado por anúncios da Lever", value: "R$ 1,5 mi", period: "todo o período", source: "painel" }], "o número de hoje do painel");
  assert.equal(cases[0].numbersAt, "2026-11-27T11:00:00.000Z");
  assert.equal(cases[2].numbersAt, "", "sem data de apuração, sem invenção");
  const json = JSON.stringify(cases);
  for (const leak of ["cu9", "print-da-conta", "Fulano", "1111", "logo/x"]) assert.ok(!json.includes(leak), `não vaza ${leak}`);
});

test("rotas: só a chave mestre ou um admin; parâmetros conferidos; a coleção das transcrições fica fora do CRUD e do tempo real", async (t) => {
  const repo = await world();
  const app = Fastify();
  app.addHook("preHandler", async (req) => { if (req.headers["x-user"]) req.authUser = { id: "u1", roles: [req.headers["x-user"]] }; });
  registerCasesFeedRoutes(app, feedOf(repo));
  t.after(() => app.close());

  const urls = ["/api/calls/agent/meetings?since=2026-11-01", "/api/calls/agent/meetings/mt_ana_202611201700/transcript", "/api/calls/agent/cases"];
  for (const url of urls) {
    assert.equal((await app.inject({ url, headers: { "x-user": "closer" } })).statusCode, 403, `closer em ${url}`);
    assert.equal((await app.inject({ url, headers: { "x-user": "admin" } })).statusCode, 200, `admin em ${url}`);
    assert.equal((await app.inject({ url })).statusCode, 200, `chave mestre em ${url}`);
  }
  const list = (await app.inject({ url: urls[0] })).json();
  assert.deepEqual([list.since, list.saas, list.count], ["2026-11-01", "leverads", 7]);
  const tr = (await app.inject({ url: urls[1] })).json();
  assert.deepEqual([tr.ok, tr.transcript.text], [true, TRANSCRIPT.text]);
  assert.equal((await app.inject({ url: "/api/calls/agent/meetings" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/calls/agent/meetings?since=01/11/2026" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/calls/agent/meetings?since=2026-13-01" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/calls/agent/meetings?since=2026-11-01&until=2026-02-30" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/calls/agent/meetings?since=2026-11-01&kind=suporte" })).statusCode, 400);
  const missing = await app.inject({ url: "/api/calls/agent/meetings/nao-existe/transcript" });
  assert.deepEqual([missing.statusCode, missing.json().reason], [404, "not_found"]);

  // Montado pelo domínio de calls, com os clientes do Google do domínio google.
  const full = Fastify();
  t.after(() => full.close());
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await repo.create("meetings", { id: "mt_ana_recente", lead: "ana", saas: "leverads", kind: "call", at: new Date(Date.now() - 3600_000).toISOString(), closer: "leonardo", status: "realizada", meetUrl: meetUrl("rec-ente-aaa"), eventId: "ev-rec" });
  registerRoutes(full, repo, { google: { ...fakeGoogle(), configured: () => true, account: async () => "" }, googleUser: { ...fakeGoogleUser([]), meetReadyFor: async () => false } });
  const wired = await full.inject({ url: `/api/calls/agent/meetings?since=${day}&kind=call` });
  assert.deepEqual([wired.statusCode, wired.json().meetings.map((m) => m.id)], [200, ["mt_ana_recente"]]);
  assert.equal((await full.inject({ url: "/api/meeting_transcripts" })).statusCode, 404);
  await repo.create(TRANSCRIPTS, { id: "zzz-zzzz-zzz", text: "fala de cliente" });
  assert.equal((await full.inject({ url: "/api/meeting_transcripts/zzz-zzzz-zzz" })).statusCode, 404);

  const seen = [];
  const off = subscribe((_rev, collection) => seen.push(collection));
  bump(TRANSCRIPTS);
  bump("leads");
  off();
  assert.deepEqual(seen, ["leads"], "gravar transcrição não acorda as telas (gravar lead acorda)");
});
