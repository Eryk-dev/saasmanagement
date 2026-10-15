import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrReplay } from "../src/sdr/sdr-replay.js";

const NOW = new Date("2026-08-19T13:00:00Z"); // qua 10h BRT
const ISO = (s) => new Date(s).toISOString();

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
];

async function seed() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL, leadQuestions: [] });
  await repo.create("users", { id: "pl", name: "Jonathan", roles: ["closer"], compLevel: 2 });
  // Conversa 1: lead que virou call na vida real (callAt preenchido).
  await repo.create("leads", { id: "L1", saas: "leverads", name: "Ana", phone: "41911111111", stage: "Call agendada", callAt: "2026-08-25T10:00" });
  await repo.create("wa_threads", { id: "5541911111111", phone: "5541911111111", leadId: "L1", saas: "leverads", lastAt: ISO("2026-08-19T10:00:00Z") });
  await repo.create("wa_messages", { id: "a1", thread: "5541911111111", leadId: "L1", direction: "in", text: "oi, quero saber mais", at: ISO("2026-08-18T10:00:00Z") });
  await repo.create("wa_messages", { id: "a2", thread: "5541911111111", leadId: "L1", direction: "out", author: "sdr", text: "Oiii, posso te mostrar ao vivo", at: ISO("2026-08-18T10:05:00Z") });
  await repo.create("wa_messages", { id: "a3", thread: "5541911111111", leadId: "L1", direction: "in", text: "pode ser amanhã", at: ISO("2026-08-18T10:10:00Z") });
  await repo.create("wa_messages", { id: "a4", thread: "5541911111111", leadId: "L1", direction: "out", author: "sdr", text: "Fechado, amanhã 10h", at: ISO("2026-08-18T10:12:00Z") });
  // Conversa 2: morreu sem call.
  await repo.create("leads", { id: "L2", saas: "leverads", name: "Beto", phone: "41922222222", stage: "Qualificando" });
  await repo.create("wa_threads", { id: "5541922222222", phone: "5541922222222", leadId: "L2", saas: "leverads", lastAt: ISO("2026-08-19T09:00:00Z") });
  await repo.create("wa_messages", { id: "b1", thread: "5541922222222", leadId: "L2", direction: "in", text: "quanto custa?", at: ISO("2026-08-17T10:00:00Z") });
  await repo.create("wa_messages", { id: "b2", thread: "5541922222222", leadId: "L2", direction: "out", author: "sdr", text: "Depende da operação", at: ISO("2026-08-17T10:05:00Z") });
  // Conversa sem lead vinculado: fica fora da amostra.
  await repo.create("wa_threads", { id: "5541933333333", phone: "5541933333333", leadId: null, saas: "leverads", lastAt: ISO("2026-08-19T08:00:00Z") });
  return repo;
}

test("replay: roda as conversas reais, conta as ações e grava o relatório em app_config #R-120", async () => {
  const repo = await seed();
  const decisions = [
    { acao: "responder", mensagem: "Consigo te mostrar ao vivo, qual período?" },
    { acao: "agendar", mensagem: "", horario: "2026-08-19T13:00" }, // 1º slot ofertável (12h-13h é almoço)
    { acao: "responder", mensagem: "custa R$ 300" },                // cairia na trava de preço
  ];
  let i = 0;
  const contexts = [];
  const anthropic = {
    configured: () => true,
    sdrDecide: async (ctx) => { contexts.push(ctx); return { acao: "silencio", mensagem: "", horario: "", email: "", motivoHumano: "", ...decisions[i++] }; },
  };
  const replay = makeSdrReplay({ repo, anthropic, log: { warn: () => {} }, now: () => NOW });
  const report = await replay.run({ saas: "leverads", threads: 10, turns: 3 });

  assert.equal(report.threads, 2);
  assert.equal(report.turns, 3); // L1 tem 2 turnos com resposta real, L2 tem 1
  assert.equal(report.actions.responder, 2);
  assert.equal(report.actions.agendar, 1);
  assert.equal(report.priceGuardHits, 1);
  assert.equal(report.realBookedThreads, 1);
  assert.equal(report.wouldBookThreads, 1);
  assert.equal(report.errors, 0);
  assert.equal(report.samples.length, 3);
  assert.ok(report.samples.every((s) => s.leadMsg && (s.real || s.real === "")));
  // A IA viu a conversa até o turno (a última linha é a mensagem do lead).
  assert.equal(contexts[0].conversation.at(-1).who, "LEAD");
  // Relatório persistido pro GET/status.
  const doc = await repo.get("app_config", "sdr_replay");
  assert.equal(doc.status, "done");
  assert.equal(doc.report.turns, 3);
  assert.deepEqual(doc.progress, { done: 2, total: 2 });
});

test("replay: erro numa decisão não derruba a bateria (conta e segue) #R-120", async () => {
  const repo = await seed();
  let i = 0;
  const anthropic = {
    configured: () => true,
    sdrDecide: async () => { if (i++ === 0) throw new Error("boom"); return { acao: "silencio", mensagem: "", horario: "", email: "", motivoHumano: "" }; },
  };
  const replay = makeSdrReplay({ repo, anthropic, log: { warn: () => {} }, now: () => NOW });
  const report = await replay.run({ saas: "leverads", threads: 10, turns: 3 });
  assert.equal(report.errors, 1);
  assert.equal(report.turns, 3);
});

test("start é single-flight e recusa sem IA configurada #R-120", async () => {
  const repo = await seed();
  const replayOff = makeSdrReplay({ repo, anthropic: { configured: () => false }, now: () => NOW });
  assert.match(replayOff.start().error || "", /IA não configurada/);
});

test("replay: conjunto fixo (threadIds) e contrato v2 chegam na IA; a IA que escreve horário no texto é contada #R-120 #R-021", async () => {
  const repo = await seed();
  const contexts = [];
  const anthropic = {
    configured: () => true,
    sdrDecide: async (ctx) => { contexts.push(ctx); return { acao: "responder", mensagens: ["Consigo amanhã às 9h, pode?"], mensagem: "Consigo amanhã às 9h, pode?", horario: "", oferecer: true, slotIds: [], email: "", motivoHumano: "" }; },
  };
  const replay = makeSdrReplay({ repo, anthropic, log: { warn: () => {} }, now: () => NOW });
  const report = await replay.run({ saas: "leverads", threads: 10, turns: 3, contract: "v2", threadIds: ["5541922222222"] });
  assert.equal(report.threads, 1);
  assert.deepEqual(report.threadIds, ["5541922222222"]);
  assert.equal(report.contract, "v2");
  assert.ok(contexts.every((c) => c.contract === "v2"));
  assert.equal(report.inlineSlotMentions, 1, "a IA escreveu dia/hora apesar do contrato");
  assert.equal(report.offersWithSlots, 1);
  const again = await replay.run({ saas: "leverads", threads: 10, turns: 3, threadIds: report.threadIds });
  assert.deepEqual(again.threadIds, report.threadIds, "a mesma amostra roda de novo");
  assert.equal(again.contract, "v1");
});

test("replay: promptVersion v2 leva estado/roteiro/fatos pra IA e o relatório traz estilo e decisões por estado #R-120", async () => {
  const repo = await seed();
  const contexts = [];
  const anthropic = {
    configured: () => true,
    sdrDecide: async (ctx) => { contexts.push(ctx); return { acao: "responder", mensagens: ["Olá! Que bom", "Na nossa call te mostro"], mensagem: "Olá! Que bom\nNa nossa call te mostro", horario: "", oferecer: true, slotIds: [], email: "", motivoHumano: "", promptVersion: "v2" }; },
  };
  const replay = makeSdrReplay({ repo, anthropic, log: { warn: () => {} }, now: () => NOW });
  const report = await replay.run({ saas: "leverads", threads: 10, turns: 3, promptVersion: "v2" });
  assert.equal(report.promptVersion, "v2");
  assert.equal(report.contract, "v2", "prompt v2 implica contrato v2");
  assert.ok(contexts.every((c) => c.promptVersion === "v2" && typeof c.state === "string" && c.facts));
  assert.ok(Object.values(report.byState).reduce((a, b) => a + b, 0) === report.turns);
  assert.equal(report.style.balloons, report.turns * 2);
  assert.equal(report.style.forbiddenTokens, report.turns * 2, "'Olá!' e 'call' são tokens proibidos");
  assert.equal(report.style.responderWithQuestion, report.turns, "oferecer=true conta como próximo passo");
  assert.equal(report.byRule["R-006"], report.turns, "'call' pro lead é violação da R-006 em todo turno");
  assert.ok(report.violations >= report.turns);
});
