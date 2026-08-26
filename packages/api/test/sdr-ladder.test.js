import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner } from "../src/sdr-flow.js";

// Escada de retomada até o corte (Leo, 26/08), desenhada em cima da campanha
// de 25/08: frio leva o encerramento no 5º dia, morno tem relógio próprio
// (última mensagem DELE) com um degrau a mais, e silêncio de 48h depois do
// encerramento manda o card pra Nutrição.
const ISO = (s) => new Date(s).toISOString();
const NOW = new Date("2026-08-20T13:00:00Z"); // quinta, 10h BRT
const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "Nutrição", kind: "contato" },
];
const APPROVED = ["sdr_retomada_conversa", "sdr_retomada_novidades", "sdr_encerramento_atendimento"];

function makeWa({ approved = APPROVED } = {}) {
  const sent = [];
  return {
    sent,
    configured: () => true,
    sendText: async (to, text) => { sent.push({ kind: "text", to, text }); return { messageId: "wm_t" + sent.length }; },
    sendTemplate: async (to, name, lang, components) => {
      sent.push({ kind: "template", to, name, params: (components[0]?.parameters || []).map((p) => p.text) });
      return { messageId: "wm_p" + sent.length };
    },
    listTemplates: async () => approved.map((n) => ({ name: n })),
    tokenWabaIds: async () => ["waba_test"],
  };
}

const THREAD = { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" };

async function world({ lead = {}, sdrBot = {}, messages = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    sdrBot: {
      enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"),
      firstTouch: false, secondTouch: false, reminders: false, rescue: false, rescue2: false,
      ladder: true, ...sdrBot,
    },
  });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Rafael Silva", phone: "41999990000",
    stage: "Qualificando", createdAt: ISO("2026-08-01T12:00:00Z"),
    sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template" },
    ...lead,
  });
  await repo.create("wa_threads", { ...THREAD, hasIn: messages.some((m) => m.direction === "in") });
  for (const m of messages) await repo.create("wa_messages", { thread: THREAD.id, leadId: "L1", ...m });
  return repo;
}

const tickOf = (repo, wa, at = NOW) => makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => at }).tick();
const tplsOf = (wa) => wa.sent.filter((s) => s.kind === "template").map((s) => s.name);

// ── FRIO: nunca respondeu ────────────────────────────────────────────────
test("frio: encerramento no 5º dia do 1º toque, uma vez só", async () => {
  const repo = await world({
    messages: [{ id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") }],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.deepEqual(tplsOf(wa), ["sdr_encerramento_atendimento"]);
  const st = (await repo.get("leads", "L1")).sdrLog.ladder;
  assert.equal(st.step, 1);
  assert.equal(st.done, true);
  assert.equal(st.warm, false);
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 1); // escada terminada não repete
});

test("frio: antes do 5º dia não sai nada", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-18T12:00:00Z"), firstTouchVia: "template" } },
    messages: [{ id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-18T12:00:00Z") }],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 0);
});

// ── MORNO: respondeu e sumiu ─────────────────────────────────────────────
test("morno: relógio conta da última mensagem DELE, e o 1º degrau é a retomada", async () => {
  const repo = await world({
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") },
      { id: "m2", direction: "in", text: "depois eu vejo", at: ISO("2026-08-16T12:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa); // 4 dias depois da fala dele: passou do degrau de 3d
  assert.deepEqual(tplsOf(wa), ["sdr_retomada_conversa"]);
  const st = (await repo.get("leads", "L1")).sdrLog.ladder;
  assert.equal(st.warm, true);
  assert.equal(st.step, 1);
  assert.equal(st.done, false); // ainda faltam 2 degraus
});

test("morno: lead voltou a falar e a escada REINICIA do zero", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-10T12:00:00Z"), step: 2, warm: true, lastAt: ISO("2026-08-18T12:00:00Z") } } },
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") },
      { id: "m2", direction: "in", text: "voltei", at: ISO("2026-08-16T12:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  // Âncora nova (a fala de 16/08) = degrau 0 outra vez: retomada, não encerramento.
  assert.deepEqual(tplsOf(wa), ["sdr_retomada_conversa"]);
  assert.equal((await repo.get("leads", "L1")).sdrLog.ladder.at, ISO("2026-08-16T12:00:00Z"));
});

test("morno: degrau do meio é a de novidades e leva o nome do SDR", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-05T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-08T12:00:00Z"), step: 1, warm: true, lastAt: ISO("2026-08-11T12:00:00Z") } } },
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-05T12:00:00Z") },
      { id: "m2", direction: "in", text: "agora não", at: ISO("2026-08-08T12:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  const t = wa.sent.find((s) => s.kind === "template");
  assert.equal(t.name, "sdr_retomada_novidades");
  assert.deepEqual(t.params, ["Rafael", "Manuela"]);
});

// ── Travas ───────────────────────────────────────────────────────────────
test("humano falou depois da âncora: o robô não entra na conversa", async () => {
  const repo = await world({
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") },
      { id: "m2", direction: "out", author: "sdr", text: "oi, aqui é a Manuela", at: ISO("2026-08-14T12:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 0);
});

test("mensagem do robô recente: o piso de 3 dias segura o degrau", async () => {
  const repo = await world({
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") },
      { id: "m2", direction: "out", author: "sdr-bot", text: "retomada", at: ISO("2026-08-19T12:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 0);
});

test("call marcada, ganho ou fora do expediente: escada parada", async () => {
  const msgs = [{ id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") }];
  for (const lead of [{ callAt: "2026-08-25T10:00" }, { stage: "Nutrição" }]) {
    const repo = await world({ lead, messages: msgs });
    const wa = makeWa();
    await tickOf(repo, wa);
    assert.equal(tplsOf(wa).length, 0);
  }
  const repo = await world({ messages: msgs });
  const wa = makeWa();
  await tickOf(repo, wa, new Date("2026-08-20T23:00:00Z")); // 20h BRT
  assert.equal(tplsOf(wa).length, 0);
});

test("teto diário corta a escada e sobrevive no app_config", async () => {
  const repo = await world({ sdrBot: { ladderPerDay: 1 } });
  await repo.create("leads", {
    id: "L2", saas: "leverads", owner: "sdr", name: "Bruno Costa", phone: "41988880000",
    stage: "Qualificando", createdAt: ISO("2026-08-01T12:00:00Z"),
    sdrLog: { firstTouchAt: ISO("2026-08-13T11:00:00Z"), firstTouchVia: "template" },
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 1);
  assert.equal((await repo.get("app_config", "sdr_ladder_leverads")).sent, 1);
});

test("sem o template de encerramento aprovado, o degrau final espera", async () => {
  const repo = await world({
    messages: [{ id: "m1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-13T12:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.ladder, undefined);
});

// ── Corte pra Nutrição ───────────────────────────────────────────────────
test("48h de silêncio depois do encerramento: card vai pra Nutrição", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-13T12:00:00Z"), step: 1, done: true, warm: false, lastAt: ISO("2026-08-18T12:00:00Z") } } },
    messages: [{ id: "m1", direction: "out", author: "sdr-bot", text: "encerrando", at: ISO("2026-08-18T12:00:00Z") }],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  const l = await repo.get("leads", "L1");
  assert.equal(l.stage, "Nutrição");
  assert.ok(l.sdrLog.nurtureAt);
  assert.ok(l.stageSince);
  // Histórico do movimento fica registrado pelo caminho canônico.
  const acts = (await repo.list("activities")).filter((a) => a.type === "stage");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.to, "Nutrição");
});

test("respondeu depois do encerramento: card FICA e a escada reinicia", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-13T12:00:00Z"), step: 1, done: true, warm: false, lastAt: ISO("2026-08-18T12:00:00Z") } } },
    messages: [
      { id: "m1", direction: "out", author: "sdr-bot", text: "encerrando", at: ISO("2026-08-18T12:00:00Z") },
      { id: "m2", direction: "in", text: "opa, me chama sim", at: ISO("2026-08-18T14:00:00Z") },
    ],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal((await repo.get("leads", "L1")).stage, "Qualificando");
});

test("antes das 48h o card não cai", async () => {
  const repo = await world({
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-13T12:00:00Z"), step: 1, done: true, warm: false, lastAt: ISO("2026-08-19T18:00:00Z") } } },
    messages: [{ id: "m1", direction: "out", author: "sdr-bot", text: "encerrando", at: ISO("2026-08-19T18:00:00Z") }],
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal((await repo.get("leads", "L1")).stage, "Qualificando");
});

test("escada desligada: nada se move nem sai", async () => {
  const repo = await world({
    sdrBot: { ladder: false },
    lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T12:00:00Z"), firstTouchVia: "template", ladder: { at: ISO("2026-08-13T12:00:00Z"), step: 1, done: true, warm: false, lastAt: ISO("2026-08-18T12:00:00Z") } } },
  });
  const wa = makeWa();
  await tickOf(repo, wa);
  assert.equal(tplsOf(wa).length, 0);
  assert.equal((await repo.get("leads", "L1")).stage, "Qualificando");
});
