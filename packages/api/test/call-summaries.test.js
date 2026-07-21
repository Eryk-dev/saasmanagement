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

test("openrouter: chave sk-or-* muda endpoint/formato sozinha e parseia (até com cerca de código)", async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return {
      status: 200,
      json: async () => ({
        model: "anthropic/claude-opus-4.8",
        choices: [{ message: { content: "```json\n" + JSON.stringify(SUMMARY) + "\n```" } }],
        usage: { prompt_tokens: 1000, completion_tokens: 300 },
      }),
    };
  };
  const a = makeAnthropic({ fetch: f, apiKey: "sk-or-v1-teste" });
  assert.equal(a.provider, "openrouter");
  assert.equal(a.model, "anthropic/claude-opus-4.8");

  const { summary } = await a.summarizeCall({ transcript: "Leo: oi", lead: { name: "Ana" } });
  assert.equal(summary.temperatura, "quente");

  const req = calls[0];
  assert.ok(req.url.includes("openrouter.ai/api/v1/chat/completions"));
  assert.equal(req.init.headers.authorization, "Bearer sk-or-v1-teste");
  assert.equal(req.body.response_format.type, "json_schema");
  assert.equal(req.body.response_format.json_schema.strict, true);
  assert.equal(req.body.messages[0].role, "system");
  assert.ok(req.body.messages[0].content.includes("SOMENTE com o JSON"));
  assert.equal(req.body.thinking, undefined); // formato OpenAI, sem campos da Anthropic

  // erro do OpenRouter vira mensagem legível
  const fErr = async () => ({ status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) });
  await assert.rejects(
    () => makeAnthropic({ fetch: fErr, apiKey: "sk-or-v1-x" }).summarizeCall({ transcript: "x" }),
    /OpenRouter -> 402: Insufficient credits/,
  );
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

// A Meet API LANÇA em 4xx (API desabilitada no Cloud, sala de outra conta,
// escopo faltando). Antes a exceção subia e matava o fallback do Drive: a call
// ficava pra sempre sem resumo (aconteceu com a integração do Cristiano em
// 20/07). Agora o erro dela vira diagnóstico e o Drive segue sendo tentado.
test("transcrição: Meet API lançando não mata o fallback do Drive", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", {
    id: "le9", saas: "leverads", name: "Cristiano", stage: "Integração",
    integrationCallUrl: "https://meet.google.com/sxj-tzvx-hud",
    integrationMeetEventId: "ev9", integrationScheduledAt: "2026-07-20T14:00:00.000Z",
  });
  const anthropic = makeAnthropic({ fetch: makeAnthropicFetch(), apiKey: "sk-test" });
  const boom = () => { throw new Error("Meet API spaces/sxj-tzvx-hud -> 403: SERVICE_DISABLED"); };

  // Drive salva o dia: mesmo com a Meet API explodindo, o resumo sai.
  const w = makeCallSummarizer({
    repo, anthropic, log: { info() {}, warn() {} },
    google: { connected: async () => true, fetchTranscript: boom, fetchTranscriptFromDrive: async () => TRANSCRIPT },
  });
  const ok = await w.summarizeLead("le9", { kind: "integracao" });
  assert.equal(ok.ok, true, "fallback do Drive rodou mesmo com a Meet API lançando");
  assert.equal((await repo.get("leads", "le9")).integrationSummaryFor, "ev9");

  // Nenhum caminho traz a transcrição: os DOIS motivos aparecem no detail.
  await repo.create("leads", {
    id: "le10", saas: "leverads", name: "Outro", stage: "Integração",
    integrationCallUrl: "https://meet.google.com/aaa-bbbb-ccc",
    integrationMeetEventId: "ev10", integrationScheduledAt: "2026-07-20T14:00:00.000Z",
  });
  const w2 = makeCallSummarizer({
    repo, anthropic, log: { info() {}, warn() {} },
    google: { connected: async () => true, fetchTranscript: boom, fetchTranscriptFromDrive: async () => null },
  });
  const no = await w2.summarizeLead("le10", { kind: "integracao" });
  assert.equal(no.reason, "transcript_not_ready");
  assert.match(no.detail, /meet: .*SERVICE_DISABLED/);
  assert.match(no.detail, /drive: /);
});

// Sala ESQUECIDA ABERTA: o Google só fecha gravação/transcrição quando o último
// participante sai, então enquanto houver conferência ativa não existe
// transcrição pra buscar. Foi o que segurou a integração do Cristiano (20/07):
// a tela dizia "não está pronta" quando o certo era "encerre a sala".
test("sala aberta vira reason próprio (call_in_progress), não transcript_not_ready", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("leads", {
    id: "le11", saas: "leverads", name: "Cristiano", stage: "Integração",
    integrationCallUrl: "https://meet.google.com/sxj-tzvx-hud",
    integrationMeetEventId: "ev11", integrationScheduledAt: "2026-07-20T14:00:00.000Z",
  });
  const anthropic = makeAnthropic({ fetch: makeAnthropicFetch(), apiKey: "sk-test" });
  const w = makeCallSummarizer({
    repo, anthropic, log: { info() {}, warn() {} },
    google: {
      connected: async () => true,
      fetchTranscript: async () => ({ live: true, startTime: "2026-07-20T14:00:00Z" }),
      fetchTranscriptFromDrive: async () => null, // Doc só nasce quando a call fecha
    },
  });
  const r = await w.summarizeLead("le11", { kind: "integracao" });
  assert.equal(r.reason, "call_in_progress");
  assert.match(r.detail, /sala do Meet ainda está aberta/i);
  // Nada é gravado no lead: quando a sala fechar, o poller resume de verdade.
  assert.equal((await repo.get("leads", "le11")).integrationSummaryFor, undefined);
});

// Sala aberta com a conta conectada FORA da call: ela organiza mas não
// participa, e a Meet API só lista conferenceRecords pra quem participou (PR
// #206) — a lista vem vazia mesmo com gente na sala. O sinal confiável é o
// `activeConference` do SPACE, que a conta lê por ser dona.
test("google.fetchTranscript: activeConference no space marca sala aberta mesmo sem conferenceRecords", async () => {
  const { makeGoogle } = await import("../src/google.js");
  const f = async (url) => {
    const u = String(url);
    const ok = (body) => ({ status: 200, json: async () => body });
    if (u.includes("oauth2.googleapis.com/token")) return ok({ access_token: "at", expires_in: 3600 });
    if (u.includes("/v2/spaces/sxj-tzvx-hud")) {
      return ok({ name: "spaces/sp9", activeConference: { conferenceRecord: "conferenceRecords/live1" } });
    }
    if (u.includes("/v2/conferenceRecords?")) return ok({ conferenceRecords: [] }); // vazio: a conta não participou
    return ok({});
  };
  const repo = { get: async () => ({ id: "google_oauth", refreshToken: "rt" }), update: async () => {}, create: async () => {} };
  const g = makeGoogle({ fetch: f, repo, clientId: "cid", clientSecret: "cs", redirectUri: "https://x/cb" });
  const t = await g.fetchTranscript("sxj-tzvx-hud");
  assert.equal(t?.live, true, "sala aberta detectada pelo activeConference");
});

// endActiveConference: sala já fechada devolve 400 FAILED_PRECONDITION (não
// 404). Antes isso virava throw -> a rota respondia 502 e o proxy da
// hospedagem trocava o corpo pela página de erro dele (HTML "Not Found"), como
// o Leo viu no lead do Cristiano. Agora vira diagnóstico "sem conferência ativa".
test("google.endActiveConference: 400 FAILED_PRECONDITION vira no_active_conference, não erro", async () => {
  const { makeGoogle } = await import("../src/google.js");
  const f = async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return { status: 200, json: async () => ({ access_token: "at", expires_in: 3600 }) };
    if (u.includes(":endActiveConference")) return {
      status: 400,
      text: async () => JSON.stringify({ error: { code: 400, status: "FAILED_PRECONDITION", message: "There is no active conference." } }),
    };
    return { status: 200, json: async () => ({}) };
  };
  const repo = { get: async () => ({ id: "google_oauth", refreshToken: "rt" }), update: async () => {}, create: async () => {} };
  const g = makeGoogle({ fetch: f, repo, clientId: "cid", clientSecret: "cs", redirectUri: "https://x/cb" });
  const r = await g.endActiveConference("sxj-tzvx-hud");
  assert.deepEqual(r, { ended: false, reason: "no_active_conference" });
});
