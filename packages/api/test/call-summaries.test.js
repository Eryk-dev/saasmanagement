// Resumo de call — cliente Claude (structured output), leitura de transcrição
// do Meet, orquestrador (activity + GPS + dedup) e rota. Tudo offline.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeGoogle } = await import("../src/google.js");
const { makeAnthropic } = await import("../src/anthropic.js");
const { makeCallSummarizer, formatSummaryText } = await import("../src/call-summaries.js");

const SUMMARY = {
  resumo: "Ana quer operar 3 contas no ML sem risco de banimento e curtiu a demo.",
  temperatura: "quente",
  temperaturaPorque: "pediu proposta na própria call",
  dores: ["medo de banimento por vincular contas"],
  objecoes: [{ objecao: "preço acima do esperado", comoFoiTratada: "mostrou economia vs contratar operador", resolvida: true }],
  compromissos: ["enviar proposta até sexta"],
  followup: { quando: "2099-01-05T10:00", nota: "cobrar leitura da proposta", whatsapp: "Oi Ana! Te mandei a proposta com o plano de 3 contas. Consegue olhar até amanhã?" },
};

function makeAnthropicFetch(summary = SUMMARY) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return {
      status: 200,
      json: async () => ({
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(summary) }],
        usage: { input_tokens: 1000, output_tokens: 300 },
      }),
    };
  };
  f.calls = calls;
  return f;
}

// Google fake pro orquestrador (o client real é testado à parte, abaixo)
const fakeGoogle = (transcript) => ({
  connected: async () => true,
  fetchTranscript: async () => transcript,
});
const TRANSCRIPT = {
  text: "Leo: Oi Ana, tudo bem?\nAna: Tudo! Queria entender o multi-contas.",
  startTime: "2026-07-12T15:00:00Z",
  endTime: "2026-07-12T15:40:00Z",
  recordingUrl: "https://drive.google.com/file/d/f123/view",
};

test("anthropic client: manda opus-4-8 + structured output e devolve o resumo parseado", async () => {
  const f = makeAnthropicFetch();
  const a = makeAnthropic({ fetch: f, apiKey: "sk-test" });
  assert.equal(a.configured(), true);

  const { summary } = await a.summarizeCall({ transcript: "Leo: oi\nAna: oi", lead: { name: "Ana" }, today: "12/07/2026 20:00" });
  assert.equal(summary.temperatura, "quente");

  const req = f.calls[0];
  assert.equal(req.init.headers["x-api-key"], "sk-test");
  assert.equal(req.body.model, "claude-opus-4-8");
  assert.deepEqual(req.body.thinking, { type: "adaptive" });
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.equal(req.body.output_config.format.schema.properties.temperatura.enum.length, 3);
  assert.ok(req.body.system.includes("travessão")); // regra de copy do Leo no prompt
  assert.ok(req.body.messages[0].content.includes("Transcrição da call"));

  assert.equal(makeAnthropic({}).configured(), false);
});

test("google.fetchTranscript: monta o texto com nomes + link da gravação; null enquanto processa", async () => {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const ok = (body) => ({ status: 200, json: async () => body });
    if (u.includes("oauth2.googleapis.com/token")) return ok({ access_token: "at", expires_in: 3600 });
    if (u.includes("/v2/spaces/abc-defg-hij")) return ok({ name: "spaces/sp123" });
    if (u.includes("/v2/conferenceRecords?")) {
      return ok({ conferenceRecords: [
        { name: "conferenceRecords/cr0", startTime: "2026-07-10T10:00:00Z", endTime: "2026-07-10T10:30:00Z" },
        { name: "conferenceRecords/cr1", startTime: "2026-07-12T15:00:00Z", endTime: "2026-07-12T15:40:00Z" },
      ] });
    }
    if (u.includes("conferenceRecords/cr1/transcripts/t1/entries")) {
      return ok({ transcriptEntries: [
        { participant: "conferenceRecords/cr1/participants/p1", text: "Oi Ana, tudo bem?" },
        { participant: "conferenceRecords/cr1/participants/p2", text: "Tudo! Queria entender o multi-contas." },
      ] });
    }
    if (u.includes("conferenceRecords/cr1/transcripts")) return ok({ transcripts: [{ name: "conferenceRecords/cr1/transcripts/t1", state: "ENDED" }] });
    if (u.includes("conferenceRecords/cr1/participants")) {
      return ok({ participants: [
        { name: "conferenceRecords/cr1/participants/p1", signedinUser: { displayName: "Leo" } },
        { name: "conferenceRecords/cr1/participants/p2", anonymousUser: { displayName: "Ana" } },
      ] });
    }
    if (u.includes("conferenceRecords/cr1/recordings")) return ok({ recordings: [{ driveDestination: { file: "f123" } }] });
    return ok({});
  };
  const repo = makeMemRepo();
  await repo.create("app_config", { id: "google_oauth", refreshToken: "rt", account: "x@y.z" });
  const g = makeGoogle({ fetch: f, clientId: "cid", clientSecret: "sec", repo });

  const t = await g.fetchTranscript("abc-defg-hij");
  assert.equal(t.text, "Leo: Oi Ana, tudo bem?\nAna: Tudo! Queria entender o multi-contas.");
  assert.equal(t.recordingUrl, "https://drive.google.com/file/d/f123/view");
  assert.equal(t.endTime, "2026-07-12T15:40:00Z"); // pegou o record MAIS RECENTE encerrado

  // transcrição ainda processando -> null (sem erro)
  const f2 = async (url) => {
    const u = String(url);
    const ok = (body) => ({ status: 200, json: async () => body });
    if (u.includes("token")) return ok({ access_token: "at", expires_in: 3600 });
    if (u.includes("/v2/spaces/")) return ok({ name: "spaces/sp123" });
    if (u.includes("/v2/conferenceRecords?")) return ok({ conferenceRecords: [{ name: "conferenceRecords/cr1", endTime: "2026-07-12T15:40:00Z" }] });
    if (u.includes("/transcripts")) return ok({ transcripts: [{ name: "t1", state: "STARTED" }] });
    return ok({});
  };
  const g2 = makeGoogle({ fetch: f2, clientId: "cid", clientSecret: "sec", repo });
  assert.equal(await g2.fetchTranscript("abc-defg-hij"), null);
});

test("summarizer: activity na timeline, follow-up no GPS, dedup e force", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", {
    id: "le1", saas: "leverads", name: "Ana", stage: "Call agendada",
    callUrl: "https://meet.google.com/abc-defg-hij", meetEventId: "ev1", meetScheduledAt: "2026-07-12T18:00:00.000Z",
  });
  const anthropic = makeAnthropic({ fetch: makeAnthropicFetch(), apiKey: "sk-test" });
  const w = makeCallSummarizer({ repo, google: fakeGoogle(TRANSCRIPT), anthropic, log: { info() {}, warn() {} } });

  const r = await w.summarizeLead("le1");
  assert.equal(r.ok, true);
  assert.equal(r.summary.temperatura, "quente");

  const lead = await repo.get("leads", "le1");
  assert.equal(lead.callSummaryFor, "ev1");
  assert.equal(lead.nextActionAt, new Date("2099-01-05T10:00:00-03:00").toISOString());
  assert.equal(lead.nextActionNote, "cobrar leitura da proposta");

  const act = (await repo.list("activities")).find((a) => a.meta?.event === "call_summary");
  assert.ok(act, "activity do resumo existe");
  assert.ok(act.text.includes("temperatura: quente"));
  assert.ok(act.text.includes("preço acima do esperado"));
  assert.ok(!act.text.includes("—"), "resumo sem travessão");
  assert.equal(act.meta.recordingUrl, TRANSCRIPT.recordingUrl);

  // dedup: mesma call não resume duas vezes; force re-roda
  assert.deepEqual(await w.summarizeLead("le1"), { ok: false, reason: "already_done" });
  assert.equal((await w.summarizeLead("le1", { force: true })).ok, true);

  // transcrição indisponível -> reason estável (poller re-tenta depois)
  const w2 = makeCallSummarizer({ repo: repo, google: fakeGoogle(null), anthropic, log: { warn() {} } });
  await repo.create("leads", { id: "le2", saas: "leverads", name: "Bia", callUrl: "https://meet.google.com/zzz-zzzz-zzz" });
  assert.deepEqual(await w2.summarizeLead("le2"), { ok: false, reason: "transcript_not_ready" });
});

test("tick: pega só call encerrada e ainda sem resumo; rota POST /call-summary responde", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const past = new Date(Date.now() - 2 * 3600_000).toISOString();
  const future = new Date(Date.now() + 2 * 3600_000).toISOString();
  await repo.create("leads", { id: "l-done", saas: "leverads", name: "A", callUrl: "https://meet.google.com/aaa-aaaa-aaa", meetEventId: "e1", meetScheduledAt: past, callSummaryFor: "e1" });
  await repo.create("leads", { id: "l-fresh", saas: "leverads", name: "B", callUrl: "https://meet.google.com/bbb-bbbb-bbb", meetEventId: "e2", meetScheduledAt: past });
  await repo.create("leads", { id: "l-futura", saas: "leverads", name: "C", callUrl: "https://meet.google.com/ccc-cccc-ccc", meetEventId: "e3", meetScheduledAt: future });

  const anthropic = makeAnthropic({ fetch: makeAnthropicFetch(), apiKey: "sk-test" });
  const w = makeCallSummarizer({ repo, google: fakeGoogle(TRANSCRIPT), anthropic, log: { info() {}, warn() {} } });
  const res = await w.tick();
  assert.deepEqual(res, { scanned: 1, summarized: 1 }); // só a l-fresh
  assert.equal((await repo.get("leads", "l-fresh")).callSummaryFor, "e2");
  assert.equal((await repo.get("leads", "l-futura")).callSummaryFor, undefined);

  // rota completa (guards + sucesso)
  const app = Fastify();
  registerRoutes(app, repo, {
    google: { ...fakeGoogle(TRANSCRIPT), configured: () => true, account: async () => "x@y.z" },
    anthropic,
  });
  await repo.create("leads", { id: "l-rota", saas: "leverads", name: "D", callUrl: "https://meet.google.com/ddd-dddd-ddd", meetEventId: "e4" });
  const ok = (await app.inject({ method: "POST", url: "/api/leads/l-rota/call-summary" })).json();
  assert.equal(ok.ok, true);
  const semMeet = await repo.create("leads", { id: "l-sem", saas: "leverads", name: "E" });
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/l-sem/call-summary" })).json().reason, "no_meet");
  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nao-existe/call-summary" })).statusCode, 404);
  await app.close();
  void semMeet;
  void formatSummaryText;
});
