// Consultas 1:1 + Manual da Família (UniqueKids) — template/snapshot, espelho na
// agenda pessoal, Meet da consulta, resumo por IA (manual e poller), compor o
// manual e a página pública /m/:id. Tudo offline com mocks.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { MANUAL_SECTIONS, newManual, publicManual } = await import("../src/deliverables.js");
const { syncConsultationCalendar, makeConsultationSummarizer, startConsultationSummaries, formatConsultationText } = await import("../src/consultations.js");
const { registerConsultationRoutes } = await import("../src/routes.consultations.js");
const { manualPageHtml } = await import("../src/manual-page.js");

// ── mocks ─────────────────────────────────────────────────────────────────────
function fakeGu({ connected = true } = {}) {
  const events = [];
  const deleted = [];
  let nextId = 1;
  return {
    events, deleted,
    configured: () => true,
    connectedFor: async () => connected,
    upsertEvent: async (userId, ev) => { const eventId = ev.eventId || `ev${nextId++}`; events.push({ userId, ...ev, eventId }); return { eventId }; },
    deleteEvent: async (userId, eventId) => { deleted.push({ userId, eventId }); },
  };
}
function fakeGoogle({ transcript = "TRANSCRIÇÃO", connected = true } = {}) {
  return {
    configured: () => true,
    connected: async () => connected,
    createMeetEvent: async ({ summary, attendees }) => ({ meetUrl: "https://meet.google.com/abc-defg-hij", eventId: "gev1", htmlLink: "https://cal/x", _summary: summary, _attendees: attendees }),
    configureSpace: async () => ({ open: true, recording: true, transcription: true }),
    fetchTranscript: async () => (transcript ? { text: transcript, startTime: "2026-07-16T15:00:00Z", endTime: "2026-07-16T16:00:00Z", recordingUrl: "https://drive/rec" } : null),
    fetchTranscriptFromDrive: async () => null,
  };
}
function fakeAI() {
  const calls = [];
  return {
    calls,
    configured: () => true,
    summarizeConsultation: async (input) => { calls.push(["sum", input]); return { summary: { resumo: "Foi ótima.", evolucao: "Dormiu melhor.", temas: ["sono"], combinados: ["quadro à noite"], tarefas: ["check das tarefas"], sinais: "", proxima: "telas" } }; },
    composeDeliverables: async (input) => { calls.push(["compose", input]); return { sections: [{ key: "raio_x", content: "A rotina chegou travada no sono." }] }; },
  };
}
async function appWith(repo, { google = fakeGoogle(), googleUser = fakeGu(), anthropic = fakeAI() } = {}) {
  const app = Fastify();
  registerConsultationRoutes(app, repo, { google, googleUser, anthropic });
  await app.ready();
  return app;
}

// ── template / snapshot ───────────────────────────────────────────────────────
test("newManual: snapshot das 6 seções da apresentação, vazias", () => {
  assert.equal(MANUAL_SECTIONS.length, 6);
  const m = newManual({ clientName: "Mariana", customerId: "cu1" });
  assert.equal(m.sections.length, 6);
  assert.deepEqual(m.sections.map((s) => s.key), ["raio_x", "plano_rotina", "guia_birras", "banco_falas", "cantinho_calma", "jornada"]);
  assert.ok(m.sections.every((s) => s.content === "" && s.hint));
  assert.equal(m.status, "building");
});

test("publicManual: só seções com conteúdo, sem hint", () => {
  const m = newManual({ clientName: "Mariana" });
  m.sections[0].content = "Diagnóstico da casa.";
  const p = publicManual(m);
  assert.equal(p.sections.length, 1);
  assert.equal(p.sections[0].key, "raio_x");
  assert.equal(p.sections[0].hint, undefined);
});

// ── espelho na agenda pessoal ─────────────────────────────────────────────────
test("syncConsultationCalendar: cria, remarca no MESMO evento e cancela apagando", async () => {
  const repo = makeMemRepo();
  const gu = fakeGu();
  let c = await repo.create("consultations", { id: "cs1", clientName: "Mariana", n: 2, at: "2026-07-20T15:00", durationMin: 60, status: "scheduled", owner: "ana" });

  await syncConsultationCalendar(repo, gu, c);
  c = await repo.get("consultations", "cs1");
  assert.equal(c.calEventId, "ev1");
  assert.equal(c.calEventUser, "ana");
  assert.equal(gu.events[0].summary, "Consulta 2/8 · Mariana");
  assert.equal(gu.events[0].start.dateTime, "2026-07-20T15:00:00");
  assert.equal(gu.events[0].start.timeZone, "America/Sao_Paulo");

  // remarcar reaproveita o eventId
  c = await repo.update("consultations", "cs1", { at: "2026-07-21T10:00" });
  await syncConsultationCalendar(repo, gu, c);
  assert.equal(gu.events[1].eventId, "ev1");

  // cancelar apaga e limpa o rastreio
  c = await repo.update("consultations", "cs1", { status: "canceled" });
  await syncConsultationCalendar(repo, gu, c);
  c = await repo.get("consultations", "cs1");
  assert.deepEqual(gu.deleted[0], { userId: "ana", eventId: "ev1" });
  assert.equal(c.calEventId, "");
});

test("syncConsultationCalendar: sem Google conectado não cria nada", async () => {
  const repo = makeMemRepo();
  const gu = fakeGu({ connected: false });
  const c = await repo.create("consultations", { id: "cs1", clientName: "M", n: 1, at: "2026-07-20T15:00", status: "scheduled", owner: "ana" });
  await syncConsultationCalendar(repo, gu, c);
  assert.equal(gu.events.length, 0);
});

// ── Meet da consulta ──────────────────────────────────────────────────────────
test("POST /:id/meet: cria o Meet no horário, convida o cliente e grava referência do poller", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu1", email: "mae@gmail.com" });
  await repo.create("consultations", { id: "cs1", clientName: "Mariana", customerId: "cu1", n: 1, at: "2026-07-20T15:00", durationMin: 60, status: "scheduled", owner: "ana" });
  const app = await appWith(repo);

  const res = await app.inject({ method: "POST", url: "/api/consultations/cs1/meet" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.meetUrl.includes("meet.google.com"));
  assert.deepEqual(body.attendees, ["mae@gmail.com"]);
  const c = await repo.get("consultations", "cs1");
  assert.equal(c.meetEventId, "gev1");
  assert.equal(c.meetScheduledAt, new Date("2026-07-20T15:00:00-03:00").toISOString());
  await app.close();
});

test("POST /:id/meet: e-mail DIGITADO na consulta vence o do cadastro do cliente", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu1", email: "mae@gmail.com" });
  // a Ana preencheu o e-mail do convite direto na consulta (ex.: o pai)
  await repo.create("consultations", { id: "cs1", clientName: "Mariana", customerId: "cu1", clientEmail: "pai@gmail.com", n: 1, at: "2026-07-20T15:00", durationMin: 60, status: "scheduled", owner: "ana" });
  const app = await appWith(repo);

  const body = (await app.inject({ method: "POST", url: "/api/consultations/cs1/meet" })).json();
  assert.deepEqual(body.attendees, ["pai@gmail.com"]); // o da consulta vence
  await app.close();
});

test("POST /:id/meet: sem e-mail em lugar nenhum → Meet criado sem convidado", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu1" }); // cliente sem e-mail
  await repo.create("consultations", { id: "cs1", clientName: "Mariana", customerId: "cu1", n: 1, at: "2026-07-20T15:00", durationMin: 60, status: "scheduled", owner: "ana" });
  const app = await appWith(repo);

  const body = (await app.inject({ method: "POST", url: "/api/consultations/cs1/meet" })).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.attendees, []); // Meet criado, mas ninguém convidado
  await app.close();
});

test("POST /:id/meet: sem horário → 400; consulta inexistente → 404", async () => {
  const repo = makeMemRepo();
  await repo.create("consultations", { id: "cs1", clientName: "M", n: 1, at: "", status: "scheduled" });
  const app = await appWith(repo);
  assert.equal((await app.inject({ method: "POST", url: "/api/consultations/cs1/meet" })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/consultations/nope/meet" })).statusCode, 404);
  await app.close();
});

// ── resumo por IA ─────────────────────────────────────────────────────────────
test("summarizer: busca transcrição, resume, grava summary + dedup e marca feita", async () => {
  const repo = makeMemRepo();
  await repo.create("consultations", { id: "cs1", saas: "uniquekids", clientName: "Mariana", n: 1, status: "scheduled", meetUrl: "https://meet.google.com/abc-defg-hij", meetEventId: "gev1", meetScheduledAt: "2026-07-16T18:00:00Z" });
  const s = makeConsultationSummarizer({ repo, google: fakeGoogle(), anthropic: fakeAI(), log: { warn: () => {} } });

  const r = await s.summarize("cs1");
  assert.equal(r.ok, true);
  const c = await repo.get("consultations", "cs1");
  assert.equal(c.summary.resumo, "Foi ótima.");
  assert.equal(c.summaryDoneFor, "gev1");
  assert.equal(c.status, "done");
  assert.equal(c.transcriptUrl, "https://drive/rec");

  // dedup: segunda chamada sem force não refaz
  assert.equal((await s.summarize("cs1")).reason, "already_done");
  assert.equal((await s.summarize("cs1", { force: true })).ok, true);
});

test("poller: pega consulta encerrada e resume; ignora recente e sem Meet", async () => {
  const repo = makeMemRepo();
  const past = new Date(Date.now() - 2 * 3600_000).toISOString();
  await repo.create("consultations", { id: "a", clientName: "A", meetUrl: "https://meet.google.com/x-y-z", meetEventId: "e1", meetScheduledAt: past, status: "scheduled" });
  await repo.create("consultations", { id: "b", clientName: "B", meetUrl: "https://meet.google.com/x-y-z", meetEventId: "e2", meetScheduledAt: new Date().toISOString(), status: "scheduled" });
  await repo.create("consultations", { id: "c", clientName: "C", meetUrl: "", status: "scheduled" });
  const p = startConsultationSummaries(repo, { google: fakeGoogle(), anthropic: fakeAI(), intervalMs: 999_999, log: { warn: () => {} } });
  await p.run();
  p.stop();
  assert.ok((await repo.get("consultations", "a")).summary);
  assert.equal((await repo.get("consultations", "b")).summary, undefined);
  assert.equal((await repo.get("consultations", "c")).summary, undefined);
});

// ── compor o manual ───────────────────────────────────────────────────────────
test("POST /deliverables/:id/compose: junta material das consultas e mescla as seções", async () => {
  const repo = makeMemRepo();
  const ai = fakeAI();
  const m = newManual({ clientName: "Mariana", customerId: "cu1" });
  await repo.create("deliverables", m);
  await repo.create("consultations", { id: "cs1", customerId: "cu1", clientName: "Mariana", n: 1, status: "done", notes: "nó no sono", summary: { resumo: "Sono travado.", evolucao: "", temas: ["sono"], combinados: [], tarefas: [], sinais: "", proxima: "" } });
  const app = await appWith(repo, { anthropic: ai });

  const res = await app.inject({ method: "POST", url: `/api/deliverables/${m.id}/compose` });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().updatedKeys, ["raio_x"]);
  const saved = await repo.get("deliverables", m.id);
  const raioX = saved.sections.find((s) => s.key === "raio_x");
  assert.equal(raioX.content, "A rotina chegou travada no sono.");
  assert.deepEqual(raioX.sources, [1]);
  // as outras seções seguem intactas
  assert.equal(saved.sections.find((s) => s.key === "jornada").content, "");
  // o material mandado pra IA contém o resumo formatado + notas
  const input = ai.calls.find(([k]) => k === "compose")[1];
  assert.match(input.material, /CONSULTA 1/);
  assert.match(input.material, /nó no sono/);
  await app.close();
});

test("compose inclui consulta criada 'digitando o nome' (sem customerId) no manual do cliente do select", async () => {
  const repo = makeMemRepo();
  const ai = fakeAI();
  const m = newManual({ clientName: "Mariana", customerId: "cu1" }); // manual veio do select
  await repo.create("deliverables", m);
  // consulta 2 criada free-text: mesmo nome, sem ids
  await repo.create("consultations", { id: "cs2", customerId: "", leadId: "", clientName: "mariana ", n: 2, status: "done", notes: "avançou no sono" });
  const app = await appWith(repo, { anthropic: ai });
  const res = await app.inject({ method: "POST", url: `/api/deliverables/${m.id}/compose` });
  assert.equal(res.statusCode, 200);
  const input = ai.calls.find(([k]) => k === "compose")[1];
  assert.match(input.material, /avançou no sono/); // material free-text ENTROU
  await app.close();
});

test("hook do create: consulta via select depois de manual free-text NÃO duplica o manual", async () => {
  const { registerRoutes } = await import("../src/routes.js");
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo, { googleUser: fakeGu() });
  await app.ready();
  // manual nasceu de consulta free-text (sem ids)
  await app.inject({ method: "POST", url: "/api/consultations", payload: { saas: "uniquekids", clientName: "Mariana", n: 1 } });
  assert.equal((await repo.list("deliverables")).length, 1);
  // consulta seguinte veio do select (com customerId) — mesmo nome
  await app.inject({ method: "POST", url: "/api/consultations", payload: { saas: "uniquekids", clientName: "Mariana", customerId: "cu1", n: 2 } });
  assert.equal((await repo.list("deliverables")).length, 1); // não duplicou
  await app.close();
});

test("compose sem consulta com material → 400", async () => {
  const repo = makeMemRepo();
  const m = newManual({ clientName: "Zoe", customerId: "cux" });
  await repo.create("deliverables", m);
  const app = await appWith(repo);
  assert.equal((await app.inject({ method: "POST", url: `/api/deliverables/${m.id}/compose` })).statusCode, 400);
  await app.close();
});

// ── página pública ────────────────────────────────────────────────────────────
test("GET /m/:id: HTML com o nome da família e só as seções escritas; 404 quando não existe", async () => {
  const repo = makeMemRepo();
  const m = newManual({ clientName: "Mariana Souza", childName: "Theo" });
  m.sections[0].content = "A casa chegou com o sono travado.\n\n• primeiro ponto\n• segundo ponto";
  await repo.create("deliverables", m);
  const app = await appWith(repo);

  const res = await app.inject({ method: "GET", url: `/m/${m.id}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  const html = res.body;
  assert.match(html, /família Mariana/);
  assert.match(html, /Theo/);
  assert.match(html, /Raio-x da Rotina/);
  assert.match(html, /<li>primeiro ponto<\/li>/);
  assert.ok(!html.includes("Guia de Respostas")); // seção vazia não renderiza
  assert.ok(!html.includes("hint"));

  assert.equal((await app.inject({ method: "GET", url: "/m/nope" })).statusCode, 404);
  await app.close();
});

test("manualPageHtml escapa conteúdo (sem injeção) e aplica *destaque*", () => {
  const html = manualPageHtml({ clientName: "X", sections: [{ key: "k", title: "T", content: "<script>alert(1)</script> e *forte*" }] });
  assert.ok(!html.includes("<script>alert"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>forte<\/strong>/);
});

test("formatConsultationText monta o texto sem travessão", () => {
  const txt = formatConsultationText({ resumo: "R.", evolucao: "E.", temas: ["t"], combinados: ["c"], tarefas: ["x"], sinais: "s", proxima: "p" });
  assert.match(txt, /Temas trabalhados:/);
  assert.ok(!txt.includes("—"));
});

// ── hooks do CRUD genérico (routes.js) ────────────────────────────────────────
test("CRUD genérico: create espelha agenda + cria o manual; remarcação re-sincroniza; delete apaga o evento", async () => {
  const { registerRoutes } = await import("../src/routes.js");
  const repo = makeMemRepo();
  const gu = fakeGu();
  const app = Fastify();
  registerRoutes(app, repo, { googleUser: gu });
  await app.ready();

  // create → defaults + evento pessoal + Manual da Família nasce junto
  const res = await app.inject({ method: "POST", url: "/api/consultations", payload: { saas: "uniquekids", clientName: "Mariana", customerId: "cu1", n: 1, at: "2026-07-20T15:00", owner: "ana" } });
  assert.equal(res.statusCode, 201);
  const created = res.json();
  assert.equal(created.status, "scheduled"); // CREATE_DEFAULTS aplicado
  assert.ok(created.createdAt);
  assert.equal(gu.events.length, 1);
  const manuals = await repo.list("deliverables");
  assert.equal(manuals.length, 1);
  assert.equal(manuals[0].clientName, "Mariana");
  assert.equal(manuals[0].sections.length, 6);

  // segunda consulta do MESMO cliente não duplica o manual
  await app.inject({ method: "POST", url: "/api/consultations", payload: { saas: "uniquekids", clientName: "Mariana", customerId: "cu1", n: 2, at: "2026-07-27T15:00", owner: "ana" } });
  assert.equal((await repo.list("deliverables")).length, 1);

  // manual criado direto sem seções ganha o template no servidor
  const mr = await app.inject({ method: "POST", url: "/api/deliverables", payload: { saas: "uniquekids", clientName: "Outra Família" } });
  assert.equal(mr.json().sections.length, 6);

  // remarcar re-sincroniza (mesmo evento)
  await app.inject({ method: "PATCH", url: `/api/consultations/${created.id}`, payload: { at: "2026-07-21T10:00" } });
  assert.equal(gu.events.at(-1).eventId, (await repo.get("consultations", created.id)).calEventId);

  // delete apaga o evento pessoal
  const evId = (await repo.get("consultations", created.id)).calEventId;
  await app.inject({ method: "DELETE", url: `/api/consultations/${created.id}` });
  assert.ok(gu.deleted.some((d) => d.eventId === evId));
  await app.close();
});
