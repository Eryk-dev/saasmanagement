// Briefing de passagem pro integrador: prompt/schema no cliente de IA, o
// orquestrador (transcrição da venda → activity + dedup), o fallback pelo
// resumo já extraído, o poller e o gatilho no movimento pra Integração.
// Tudo offline (fakes de Google e da IA).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeAnthropic } = await import("../src/anthropic.js");
const { makeIntegrationBriefer, formatBriefText, factsOf } = await import("../src/integration-brief.js");

const BRIEF = {
  resumo: "JCimport vende autopeças no ML e na Shopee, fechou o anual pra clonar anúncios entre 4 contas.",
  operacao: [{ item: "Contas de Mercado Livre", valor: "4 contas, 2 abertas esse mês" }],
  vendido: ["clonagem das 4 contas na primeira semana", "acompanhamento semanal no primeiro mês"],
  expectativa: "ver os anúncios rodando nas contas novas em até 7 dias",
  atencao: [{ ponto: "já teve conta banida", porque: "ficou receoso de vincular tudo, explique a proteção antes de pedir acesso" }],
  confirmar: ["quais das 4 contas entram primeiro", "se o ERP dele exporta os SKUs"],
  checklist: [{ passo: "pedir acesso às 4 contas", porque: "sem acesso nada roda e ele espera começar em 7 dias" }],
  primeiraMensagem: "Oi Hiago! Aqui é o Eryk, vou tocar sua integração. Vi que você fechou pra clonar as 4 contas, posso te chamar amanhã às 10h pra pegar os acessos?",
};

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Call agendada", kind: "call", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

const TRANSCRIPT = {
  text: "Leo: você tem quantas contas?\nHiago: quatro, duas novas.\nLeo: a gente clona na primeira semana.",
  startTime: "2026-07-13T17:00:00Z",
  endTime: "2026-07-13T17:40:00Z",
  recordingUrl: "https://drive.google.com/file/d/f9/view",
};

function aiFake(payload = BRIEF) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      status: 200,
      json: async () => ({ model: "claude-opus-4-8", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }], usage: {} }),
    };
  };
  f.calls = calls;
  return f;
}
const googleFake = (transcript) => ({ connected: async () => true, fetchTranscript: async () => transcript });
const googleOff = { connected: async () => false, fetchTranscript: async () => null };

async function setup({ transcript = TRANSCRIPT, google = null, ai = null } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "leonardo", name: "Leonardo", roles: ["closer"] });
  await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Hiago", company: "JCimport", stage: "Integração",
    callUrl: "https://meet.google.com/abc-defg-hij", meetEventId: "ev1", meetScheduledAt: "2026-07-13T17:00:00Z",
    closer: "leonardo", amount: 7180, planClosed: "anual", paymentMethod: "pix",
    accounts: "3-5", listings: "2000-10000", marketplaces: ["ml", "shopee"], revenue: "200k-1m",
    stageSince: new Date().toISOString(),
  });
  const f = ai || aiFake();
  const anthropic = makeAnthropic({ fetch: f, apiKey: "sk-test" });
  const briefer = makeIntegrationBriefer({ repo, google: google || googleFake(transcript), anthropic, log: { warn() {}, info() {} } });
  return { repo, briefer, f };
}

const briefActs = async (repo, lead = "l1") =>
  (await repo.list("activities")).filter((a) => a.lead === lead && a.meta?.event === "integration_brief");

test("cliente de IA: briefIntegration manda o schema do briefing com os dados do cadastro e a transcrição", async () => {
  const f = aiFake();
  const a = makeAnthropic({ fetch: f, apiKey: "sk-test" });
  const { brief } = await a.briefIntegration({
    transcript: "Leo: oi\nHiago: oi",
    lead: { name: "Hiago", company: "JCimport" },
    facts: ["Contas de marketplace: 3 a 5", "Valor fechado: R$ 7.180,00"],
    today: "17/07/2026 10:00",
  });
  assert.equal(brief.checklist[0].passo, "pedir acesso às 4 contas");

  const req = f.calls[0];
  const props = req.body.output_config.format.schema.properties;
  assert.ok(props.checklist && props.confirmar && props.vendido && props.atencao);
  assert.ok(req.body.system.includes("travessão"));           // regra de copy do Leo
  assert.ok(req.body.system.includes("NÃO participou"));      // o briefing é pra quem não estava na call
  assert.ok(req.body.messages[0].content.includes("Contas de marketplace: 3 a 5"));
  assert.ok(req.body.messages[0].content.includes("Transcrição da call de venda"));
});

test("briefLead: lê a transcrição da VENDA, grava a activity com o texto formatado e carimba o lead", async () => {
  const { repo, briefer, f } = await setup();
  const r = await briefer.briefLead("l1");
  assert.equal(r.ok, true);
  assert.equal(r.source, "transcricao");
  assert.equal(r.recordingUrl, TRANSCRIPT.recordingUrl);

  const acts = await briefActs(repo);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].type, "system");
  assert.equal(acts[0].meta.source, "transcricao");
  assert.equal(acts[0].meta.brief.checklist.length, 1);
  assert.ok(acts[0].text.includes("Passo a passo da integração:"));
  assert.ok(acts[0].text.includes("1. pedir acesso às 4 contas"));
  assert.ok(!acts[0].text.includes("—")); // nunca travessão na copy

  const lead = await repo.get("leads", "l1");
  assert.equal(lead.integrationBriefFor, "ev1");
  assert.ok(lead.integrationBriefAt);

  // os dados do cadastro chegam legíveis na IA (faixa "3-5" vira "3 a 5")
  const sent = f.calls[0].body.messages[0].content;
  assert.ok(sent.includes("Contas de marketplace: 3 a 5"));
  assert.ok(sent.includes("Valor fechado: R$ 7.180,00"));
  assert.ok(sent.includes("Fechado por: Leonardo"));
});

test("briefLead: dedup por lead (força regerar) e nunca sobrescreve sozinho", async () => {
  const { repo, briefer } = await setup();
  assert.equal((await briefer.briefLead("l1")).ok, true);

  const again = await briefer.briefLead("l1");
  assert.equal(again.ok, false);
  assert.equal(again.reason, "already_done");
  assert.equal((await briefActs(repo)).length, 1);

  assert.equal((await briefer.briefLead("l1", { force: true })).ok, true);
  assert.equal((await briefActs(repo)).length, 2);

  assert.equal((await briefer.briefLead("nao-existe")).reason, "not_found");
});

test("briefLead: sem transcrição cai no resumo que a IA já extraiu da call (marcado como fonte fraca)", async () => {
  const { repo, briefer, f } = await setup({ google: googleOff });
  // sem transcrição E sem resumo anterior: não inventa briefing
  const semFonte = await briefer.briefLead("l1");
  assert.equal(semFonte.ok, false);
  assert.equal(semFonte.reason, "no_source");
  assert.equal((await briefActs(repo)).length, 0);

  // resumo da call de VENDA existe (o de integração não serve de fonte aqui)
  await repo.create("activities", {
    id: "a_int", saas: "leverads", lead: "l1", type: "system", at: "2026-07-14T10:00:00.000Z",
    meta: { event: "call_summary", kind: "integracao", summary: { resumo: "onboarding", sentimento: "neutro" } },
  });
  await repo.create("activities", {
    id: "a_call", saas: "leverads", lead: "l1", type: "system", at: "2026-07-13T18:00:00.000Z",
    meta: { event: "call_summary", kind: "call", summary: { resumo: "quer clonar 4 contas", compromissos: ["clonar na 1a semana"] } },
  });

  const r = await briefer.briefLead("l1");
  assert.equal(r.ok, true);
  assert.equal(r.source, "resumo");
  const sent = f.calls.at(-1).body.messages[0].content;
  assert.ok(sent.includes("Não há transcrição"));
  assert.ok(sent.includes("quer clonar 4 contas"));
  assert.ok(!sent.includes("onboarding")); // resumo de integração não vira fonte do briefing
});

test("tick: pega quem entrou em integração sem briefing, pula quem já tem e quem ficou velho", async () => {
  const { repo, briefer } = await setup();
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Ana", stage: "Integração", callUrl: "https://meet.google.com/x-y-z", stageSince: old });
  await repo.create("leads", { id: "l3", saas: "leverads", name: "Bia", stage: "Call agendada", callUrl: "https://meet.google.com/x-y-z", stageSince: new Date().toISOString() });
  await repo.create("leads", { id: "l4", saas: "leverads", name: "Cris", stage: "Ganho", callUrl: "https://meet.google.com/x-y-z", stageSince: new Date().toISOString() });

  const r = await briefer.tick();
  assert.equal(r.scanned, 2);   // l1 (integração) e l4 (ganho); l2 é velho, l3 nem chegou lá
  assert.equal(r.briefed, 2);

  const r2 = await briefer.tick(); // já briefados: passe vazio
  assert.equal(r2.scanned, 0);
});

test("rota + gatilho: mover o card pra Integração dispara o briefing sozinho", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Hiago", stage: "Call agendada" });
  await repo.create("activities", {
    id: "a_call", saas: "leverads", lead: "l1", type: "system", at: "2026-07-13T18:00:00.000Z",
    meta: { event: "call_summary", kind: "call", summary: { resumo: "quer clonar 4 contas" } },
  });
  const app = Fastify();
  registerRoutes(app, repo, { anthropic: makeAnthropic({ fetch: aiFake(), apiKey: "sk-test" }) });

  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração" } });
  // o gatilho roda solto (o PATCH não espera a IA): dá uns ciclos de event loop
  for (let i = 0; i < 40 && (await briefActs(repo)).length === 0; i++) await new Promise((r) => setImmediate(r));
  assert.equal((await briefActs(repo)).length, 1, "briefing nasce no movimento pra Integração");

  // a rota manual respeita o dedup e refaz com force
  const dup = await app.inject({ method: "POST", url: "/api/leads/l1/integration-brief", payload: {} });
  assert.equal(dup.json().reason, "already_done");
  const forced = await app.inject({ method: "POST", url: "/api/leads/l1/integration-brief", payload: { force: true } });
  assert.equal(forced.json().ok, true);
  assert.equal((await briefActs(repo)).length, 2);

  assert.equal((await app.inject({ method: "POST", url: "/api/leads/nada/integration-brief", payload: {} })).statusCode, 404);
  await app.close();
});

test("factsOf/formatBriefText: só o preenchido entra e o texto sai legível", () => {
  const facts = factsOf({ accounts: "10+", listings: "", volume: "50-200", amount: 0 });
  assert.ok(facts.includes("Contas de marketplace: mais de 10"));
  assert.ok(facts.includes("Anúncios novos por semana: 50 a 200"));
  assert.ok(!facts.some((f) => f.startsWith("Valor fechado")));  // amount 0 não entra

  const txt = formatBriefText({ resumo: "r", checklist: [], confirmar: ["quais contas"], primeiraMensagem: "" });
  assert.ok(txt.includes("Confirmar com o cliente:"));
  assert.ok(!txt.includes("Passo a passo")); // lista vazia não vira seção órfã
});
