// Raio-X do robô SDR (17/09/2026): passo zero (modelo e uso registrados, cache
// de prompt, replay por modelo) + os três P0 do relatório (confirmação com
// ação e link, ponte/FAQ/piso de preço, escada de retomada consertada).
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAnthropic } from "../src/anthropic.js";
import { makeSdrBrain, priceFloorOf, onlyFloorNumbers } from "../src/sdr-brain.js";
import { makeSdrRunner, reminderText } from "../src/sdr-flow.js";
import { makeSdrReplay, docIdOf } from "../src/sdr-replay.js";
import { ensureSdrBrainFirstTouch } from "../src/migrations.js";

const ISO = (s) => new Date(s).toISOString();
const NOW = new Date("2026-08-19T13:00:00Z"); // quarta, 10h BRT
const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
];
const THREAD = { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" };
const CATALOG = { products: {
  oem_essencial: { name: "Lever OEM · Essencial", anu: { total: 5964 }, sem: { total: 3582 } },
  oem_escala: { name: "Lever OEM · Escala", anu: { total: 11988 } },
  ads_essencial: { name: "Lever Ads · Essencial", anu: { total: 5964 } },
  price_essencial: { name: "Lever Price · Essencial", anu: { total: 9564 } },
} };

function makeWa({ approved = [] } = {}) {
  const sent = [];
  return {
    sent, configured: () => true,
    sendText: async (to, text) => { sent.push({ kind: "text", to, text }); return { messageId: "wm_t" + sent.length }; },
    sendTemplate: async (to, name, lang, components) => {
      sent.push({ kind: "template", to, name, params: (components[0]?.parameters || []).map((p) => p.text) });
      return { messageId: "wm_p" + sent.length };
    },
    listTemplates: async () => approved.map((n) => ({ name: n })),
    tokenWabaIds: async () => ["waba_test"],
  };
}

async function world({ lead = {}, sdrBot = {}, messages = [], thread = {}, catalog = true } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), conversation: true, debounceSec: 0, firstTouch: false, secondTouch: false, reminders: false, rescue: false, rescue2: false, ...sdrBot },
  });
  if (catalog) await repo.create("proposal_templates", { id: "pt_leverads", saas: "leverads", calc: { catalog: CATALOG } });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("users", { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 });
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Rafael Silva", phone: "41999990000",
    stage: "Qualificando", createdAt: ISO("2026-08-19T12:00:00Z"), ...lead,
  });
  await repo.create("wa_threads", { ...THREAD, ...thread });
  let seq = 0;
  for (const m of messages) await repo.create("wa_messages", { id: "m" + (++seq), thread: THREAD.id, leadId: "L1", saas: "leverads", ...m });
  return repo;
}

function fakeAi(decisions = []) {
  const queue = [...decisions];
  const calls = [];
  return {
    calls, configured: () => true, model: "fake-1",
    sdrDecide: async (ctx) => {
      calls.push(ctx);
      const d = queue.shift() || { acao: "silencio" };
      const mensagens = Array.isArray(d.mensagens) ? d.mensagens : [];
      return { acao: "silencio", mensagem: mensagens.join("\n"), mensagens, horario: "", email: "", motivoHumano: "", model: "fake-1", usage: { in: 120, out: 30, cacheRead: 100, cacheWrite: 0 }, ms: 7, ...d };
    },
    clone: ({ model }) => ({ ...fakeAi(queue), model }),
  };
}
const brainOf = (repo, ai, wa = makeWa()) => makeSdrBrain({ repo, whatsapp: wa, anthropic: ai, log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, partDelayMs: 0, sleep: async () => {} });
const tickOf = (repo, wa, at = NOW) => makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => at }).tick();

// ── Passo zero: cliente de IA ───────────────────────────────────────────────
test("anthropic: system vai como bloco cacheado, uso é normalizado, clone troca só o modelo", async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ acao: "responder", mensagens: ["ok?"], horario: "", email: "", motivoHumano: "" }) }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }, model: "claude-x" }) };
  };
  const ai = makeAnthropic({ fetch, apiKey: "sk-ant-test", model: "claude-a" });
  const d = await ai.sdrDecide({ lead: { name: "Rafael" }, conversation: [{ who: "LEAD", text: "quanto custa?" }], priceFloor: { oem: "a partir de R$ 497 por mês no plano anual", ads: "" } });
  assert.deepEqual(d.usage, { in: 900, out: 40, cacheRead: 800, cacheWrite: 0 });
  assert.equal(d.model, "claude-x");
  assert.ok(d.ms >= 0);
  const sys = bodies[0].body.system;
  assert.ok(Array.isArray(sys) && sys[0].cache_control?.type === "ephemeral");
  assert.match(sys[0].text, /PONTE ANTES DOS HORÁRIOS/);
  assert.match(sys[0].text, /FRASE PROIBIDA: "algum dos horários que te passei encaixa\?"/);
  const user = bodies[0].body.messages.find((m) => m.role === "user").content;
  assert.match(user, /PISO DE PREÇO.*OEM: a partir de R\$ 497 por mês/);

  const b = ai.clone({ model: "claude-b" });
  await b.sdrDecide({ lead: {}, conversation: [] });
  assert.equal(bodies[1].body.model, "claude-b");
  assert.equal(bodies[0].body.model, "claude-a");
});

test("anthropic via OpenRouter: modelo OpenAI mantém system string; uso vem de prompt/completion_tokens", async () => {
  let sent = null;
  const fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return { status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ acao: "silencio", mensagens: [], horario: "", email: "", motivoHumano: "" }) } }], usage: { prompt_tokens: 500, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 400 } }, model: "openai/gpt-x" }) };
  };
  const ai = makeAnthropic({ fetch, apiKey: "sk-or-test" });
  const d = await ai.sdrDecide({ lead: {}, conversation: [] });
  assert.equal(typeof sent.messages[0].content, "string");
  assert.deepEqual(d.usage, { in: 500, out: 12, cacheRead: 400, cacheWrite: 0 });
});

// ── Piso de preço ────────────────────────────────────────────────────────────
test("priceFloorOf lê o menor anual de cada linha do catálogo e a trava aceita só esses números", async () => {
  const repo = await world();
  const floor = await priceFloorOf(repo, "leverads", { now: 0, ttlMs: 0 });
  assert.equal(floor.oem, "a partir de R$ 497 por mês no plano anual");
  assert.equal(floor.ads, "a partir de R$ 497 por mês no plano anual");
  assert.equal(onlyFloorNumbers("Só o OEM sai a partir de R$ 497 por mês no anual. Consigo hoje às 14h ou às 16h?", floor), true);
  assert.equal(onlyFloorNumbers("São R$ 5.964 no ano", floor), true);
  assert.equal(onlyFloorNumbers("a partir de R$ 350 por mês", floor), false);
  assert.equal(onlyFloorNumbers("12x de R$ 497", floor), false);
  assert.equal(onlyFloorNumbers("qualquer coisa", null), false);
});

test("brain: resposta com o piso do catálogo passa e carimba priceFloorAt; outro número cai no desvio", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") }] });
  const ai = fakeAi([{ acao: "responder", mensagens: ["Só o OEM sai a partir de R$ 497 por mês no plano anual", "O pacote certo pro teu volume a gente fecha na demonstração, consigo hoje às 14h ou amanhã às 9h?"] }]);
  const wa = makeWa();
  assert.equal(await brainOf(repo, ai, wa).handleInbound({ message: { from: THREAD.id, text: "quanto custa?", id: "m1" } }), "responder");
  assert.match(wa.sent[0].text, /a partir de R\$ 497/);
  assert.equal(ai.calls[0].priceFloor.oem, "a partir de R$ 497 por mês no plano anual");
  assert.ok((await repo.get("leads", "L1")).sdrLog.priceFloorAt);

  const repo2 = await world({ messages: [{ direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") }] });
  const wa2 = makeWa();
  assert.equal(await brainOf(repo2, fakeAi([{ acao: "responder", mensagens: ["Sai R$ 350 por mês"] }]), wa2).handleInbound({ message: { from: THREAD.id, text: "quanto custa?", id: "m1" } }), "preco-travado");
  assert.doesNotMatch(wa2.sent[0].text, /350/);

  // Chave desligada: sem piso no contexto.
  const repo3 = await world({ sdrBot: { priceFloor: false }, messages: [{ direction: "in", text: "quanto custa?", at: ISO("2026-08-19T12:59:00Z") }] });
  const ai3 = fakeAi([{ acao: "silencio" }]);
  await brainOf(repo3, ai3).handleInbound({ message: { from: THREAD.id, text: "quanto custa?", id: "m1" } });
  assert.equal(ai3.calls[0].priceFloor, null);
});

// ── Passo zero no cérebro: carimbo de modelo/uso + 1º toque pela IA ─────────
test("brain: 1ª resposta da IA carimba firstTouchAt (via brain), thread.brain leva modelo/uso e o dia soma", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "Oi, quero saber mais", at: ISO("2026-08-19T12:59:00Z") }] });
  const ai = fakeAi([{ acao: "responder", mensagens: ["Oiii Rafael, tudo bem?", "Isso ajudaria na sua operação?"] }]);
  await brainOf(repo, ai).handleInbound({ message: { from: THREAD.id, text: "Oi, quero saber mais", id: "m1" } });
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrLog.firstTouchVia, "brain");
  assert.equal(lead.sdrLog.firstTouchAt, NOW.toISOString());
  const th = await repo.get("wa_threads", THREAD.id);
  assert.equal(th.brain.msgId, "m1");
  assert.equal(th.brain.model, "fake-1");
  assert.deepEqual(th.brain.usage, { in: 120, out: 30, cacheRead: 100, cacheWrite: 0 });
  const day = await repo.get("app_config", "sdr_ai_usage_leverads_2026-08-19");
  assert.equal(day.calls, 1);
  assert.equal(day.in, 120);
  assert.equal(day.byModel["fake-1"].out, 30);

  // Segunda mensagem: o carimbo do 1º toque não muda, o dia soma 2.
  await repo.create("wa_messages", { id: "m3", thread: THREAD.id, leadId: "L1", saas: "leverads", direction: "in", text: "sim", at: ISO("2026-08-19T13:00:30Z") });
  await brainOf(repo, fakeAi([{ acao: "responder", mensagens: ["Consigo hoje às 14h ou às 16h, qual fica melhor?"] }])).handleInbound({ message: { from: THREAD.id, text: "sim", id: "m3" } });
  assert.equal((await repo.get("leads", "L1")).sdrLog.firstTouchAt, NOW.toISOString());
  assert.equal((await repo.get("app_config", "sdr_ai_usage_leverads_2026-08-19")).calls, 2);
});

test("brain: handoff e 1ª resposta na mesma decisão preservam os dois carimbos", async () => {
  const repo = await world({ messages: [{ direction: "in", text: "vocês são robô?", at: ISO("2026-08-19T12:59:00Z") }] });
  await brainOf(repo, fakeAi([{ acao: "humano", mensagens: ["Já te passo pra uma pessoa do time"], motivoHumano: "perguntou se é robô" }])).handleInbound({ message: { from: THREAD.id, text: "vocês são robô?", id: "m1" } });
  const log = (await repo.get("leads", "L1")).sdrLog;
  assert.ok(log.handoffAt);
  assert.equal(log.firstTouchVia, "brain");
});

// ── Escada e 2º toque alcançam quem só falou com a IA ───────────────────────
test("2º toque: a mensagem do form ANTES do 1º toque não conta como resposta; depois dele, conta", async () => {
  const mk = (inAt) => world({
    sdrBot: { secondTouch: true, firstTouch: true },
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-18T12:30:00Z"), firstTouchVia: "brain" }, createdAt: ISO("2026-08-18T12:00:00Z") },
    thread: { hasIn: true },
    messages: [
      { direction: "in", text: "Oi, me chamo Rafael e quero saber mais", at: ISO(inAt) },
      { direction: "out", author: "sdr-bot", text: "Oiii Rafael. Isso ajudaria?", at: ISO("2026-08-18T12:30:00Z") },
    ],
  });
  const before = await mk("2026-08-18T12:29:00Z");
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(before, wa, new Date("2026-08-19T14:00:00Z")); // quarta 11h BRT, 25h30 depois
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 1);

  const after = await mk("2026-08-18T12:40:00Z");
  const wa2 = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(after, wa2, new Date("2026-08-19T14:00:00Z"));
  assert.equal(wa2.sent.length, 0);
});

test("migração: lead que só conversou com a IA ganha firstTouchAt da 1ª mensagem do robô, uma vez", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "oi", at: ISO("2026-08-10T12:00:00Z") },
    { direction: "out", author: "sdr-bot", text: "Oiii", at: ISO("2026-08-10T12:05:00Z") },
    { direction: "out", author: "sdr-bot", text: "Consigo hoje às 14h?", at: ISO("2026-08-10T12:06:00Z") },
  ] });
  await repo.create("leads", { id: "L2", saas: "leverads", name: "Já carimbado", sdrLog: { backlogRescueAt: ISO("2026-08-25T12:00:00Z") } });
  assert.equal(await ensureSdrBrainFirstTouch(repo), 1);
  const l1 = await repo.get("leads", "L1");
  assert.equal(l1.sdrLog.firstTouchAt, ISO("2026-08-10T12:05:00Z"));
  assert.equal(l1.sdrLog.firstTouchVia, "brain");
  assert.equal((await repo.get("leads", "L2")).sdrLog.firstTouchAt, undefined);
  assert.equal(await ensureSdrBrainFirstTouch(repo), 0); // marcador: não roda de novo
});

// ── Confirmação com ação e link ─────────────────────────────────────────────
test("reminderText: 2h leva o link e a dica do computador, sem perguntar por onde entra (Leo, 17/09); sem link, pede o ok; 10min sem link pede o ok", () => {
  const t2h = reminderText("2h", { nome: "Rafael", quando: "hoje às 14h", link: "https://meet.google.com/x" });
  assert.match(t2h, /link pra entrar é este: https:\/\/meet\.google\.com\/x\. Se for entrar pelo celular, vale ter um computador por perto/);
  assert.match(t2h, /Me confirma por aqui que está tudo certo\?$/);
  assert.doesNotMatch(t2h, /celular ou pelo computador/);
  assert.match(reminderText("2h", { nome: "Rafael", quando: "hoje às 14h", link: "" }), /Me manda um ok por aqui que eu já te passo o link/);
  assert.match(reminderText("10min", { nome: "", quando: "hoje às 14h", link: "" }), /Me manda um ok que te passo o link de acesso agora/);
  assert.doesNotMatch(reminderText("10min", { nome: "", quando: "", link: "" }), /Te espero lá/);
});

test("lembrete de 2h com janela fechada e sala criada sai pelo template COM link", async () => {
  const repo = await world({
    sdrBot: { reminders: true },
    lead: { stage: "Call agendada", callAt: "2026-08-20T10:00", closer: "pl", callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") },
    messages: [], // lead nunca escreveu: janela fechada
  });
  // v2 (sem a pergunta do celular) na frente; v1 ainda vale enquanto o v2 não é aprovado.
  const wa = makeWa({ approved: ["sdr_lembrete_link2", "sdr_lembrete_link", "sdr_lembrete_conversa"] });
  await tickOf(repo, wa, new Date("2026-08-20T11:05:00Z")); // 8h05 BRT, janela do 2h
  const t = wa.sent.find((s) => s.kind === "template");
  assert.equal(t.name, "sdr_lembrete_link2");
  assert.deepEqual(t.params, ["Rafael", "hoje às 10h", "https://meet.google.com/abc-defg"]);
  const repo1 = await world({
    sdrBot: { reminders: true },
    lead: { stage: "Call agendada", callAt: "2026-08-20T10:00", closer: "pl", callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") },
  });
  const wa1 = makeWa({ approved: ["sdr_lembrete_link", "sdr_lembrete_conversa"] });
  await tickOf(repo1, wa1, new Date("2026-08-20T11:05:00Z"));
  const t1 = wa1.sent.find((s) => s.kind === "template");
  assert.equal(t1.name, "sdr_lembrete_link");
  assert.deepEqual(t1.params, ["Rafael", "hoje às 10h", "https://meet.google.com/abc-defg"]);

  // Sem o template com link aprovado, cai no genérico de sempre.
  const repo2 = await world({
    sdrBot: { reminders: true },
    lead: { stage: "Call agendada", callAt: "2026-08-20T10:00", closer: "pl", callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") },
  });
  const wa2 = makeWa({ approved: ["sdr_lembrete_conversa"] });
  await tickOf(repo2, wa2, new Date("2026-08-20T11:05:00Z"));
  assert.equal(wa2.sent.find((s) => s.kind === "template").name, "sdr_lembrete_conversa");
});

test("positiva ao lembrete recebe o link em seguida, uma vez; humano que já mandou o link cala o robô", async () => {
  const at = "2026-08-20T10:00";
  const mk = (extra = []) => world({
    sdrBot: { reminders: true },
    lead: { stage: "Call agendada", callAt: at, closer: "pl", callUrl: "https://meet.google.com/abc-defg", callConfirmed: true, createdAt: ISO("2026-08-10T10:00:00Z"),
      confirmLog: { at, "2h": ISO("2026-08-20T11:00:00Z"), confirmed: ISO("2026-08-20T11:03:00Z") } },
    messages: [
      { direction: "out", author: "sdr-bot", text: "Nossa conversa é hoje às 10h. Me manda um ok que eu já te passo o link", at: ISO("2026-08-20T11:00:00Z") },
      { direction: "in", text: "ok", at: ISO("2026-08-20T11:03:00Z") },
      ...extra,
    ],
  });
  const repo = await mk();
  const wa = makeWa();
  await tickOf(repo, wa, new Date("2026-08-20T11:05:00Z"));
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /Perfeito Rafael, o link pra entrar é este: https:\/\/meet\.google\.com\/abc-defg\. Te espero hoje às 10h!/);
  assert.ok((await repo.get("leads", "L1")).confirmLog.linkSentAt);
  await tickOf(repo, wa, new Date("2026-08-20T11:06:00Z"));
  assert.equal(wa.sent.length, 1); // não repete

  const repo2 = await mk([{ direction: "out", author: "sdr", text: "Segue o link: https://meet.google.com/abc-defg", at: ISO("2026-08-20T11:04:00Z") }]);
  const wa2 = makeWa();
  await tickOf(repo2, wa2, new Date("2026-08-20T11:05:00Z"));
  assert.equal(wa2.sent.length, 0);
  assert.equal((await repo2.get("leads", "L1")).confirmLog.linkSentAt, "humano");
});

// ── Replay por modelo ───────────────────────────────────────────────────────
test("replay: model/tag rodam com o clone, gravam doc próprio com uso e latência, e runs() lista", async () => {
  const repo = await world({ messages: [
    { direction: "in", text: "quanto custa?", at: ISO("2026-08-18T12:00:00Z") },
    { direction: "out", author: "sdr", text: "a partir de 497", at: ISO("2026-08-18T12:05:00Z") },
  ], thread: { lastAt: ISO("2026-08-18T12:05:00Z") } });
  const ai = fakeAi([{ acao: "responder", mensagens: ["Só o OEM sai a partir de R$ 497 por mês no plano anual", "Consigo hoje às 14h?"] }]);
  const replay = makeSdrReplay({ repo, anthropic: ai, log: { warn: () => {} }, now: () => NOW });
  const report = await replay.run({ saas: "leverads", model: "fake-2", tag: "Modelo B" });
  assert.equal(report.model, "fake-2");
  assert.equal(report.turns, 1);
  assert.equal(report.priceFloorSaid, 1);
  assert.equal(report.priceGuardHits, 0);
  assert.equal(report.usage.in, 120);
  assert.equal(report.msTotal, 7);
  assert.equal(docIdOf("Modelo B"), "sdr_replay_modelo-b");
  const doc = await repo.get("app_config", "sdr_replay_modelo-b");
  assert.equal(doc.status, "done");
  assert.equal((await replay.status("Modelo B")).model, "fake-2");
  const runs = await replay.runs();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].report.samples, undefined);
});
