import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner } from "../src/sdr-flow.js";

// Segundo toque (23/08): 1º toque há 24h sem NENHUMA resposta → retomada única.
const ISO = (s) => new Date(s).toISOString();
const NOW = new Date("2026-08-20T13:00:00Z");
const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
];

function makeWa({ approved = [] } = {}) {
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

async function world({ lead = {}, threads = [], messages = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") },
  });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Rafael Silva", phone: "41999990000",
    stage: "Qualificando", createdAt: ISO("2026-08-19T12:00:00Z"),
    sdrLog: { firstTouchAt: ISO("2026-08-19T12:30:00Z"), firstTouchVia: "template" },
    ...lead,
  });
  for (const t of threads) await repo.create("wa_threads", t);
  for (const m of messages) await repo.create("wa_messages", m);
  return repo;
}

const tickOf = (repo, wa, at = NOW) => makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => at }).tick();

test("24h calado: manda a retomada UMA vez e carimba secondTouchAt", async () => {
  const repo = await world({
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", hasIn: false, lastOutAuthor: "sdr-bot" }],
    messages: [{ id: "m1", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", text: "Oiii, Rafael...", at: ISO("2026-08-19T12:30:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa);
  const tpl = wa.sent.filter((s) => s.name === "sdr_retomada_conversa");
  assert.equal(tpl.length, 1);
  assert.deepEqual(tpl[0].params, ["Rafael"]);
  assert.ok((await repo.get("leads", "L1")).sdrLog.secondTouchAt);
  // Segundo tick: não repete.
  await tickOf(repo, wa);
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 1);
});

test("lead que respondeu qualquer coisa fica FORA do segundo toque", async () => {
  const repo = await world({
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", hasIn: true, lastOutAuthor: "sdr-bot" }],
    messages: [
      { id: "m1", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", text: "Oiii...", at: ISO("2026-08-19T12:30:00Z") },
      { id: "m2", thread: "5541999990000", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-19T13:00:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa);
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 0);
});

// Horário comercial (24/08): o ponto das 24h herda a hora do 1º toque (que é
// 24/7) — lead das 23h levaria a retomada às 23h. Fora do expediente
// (business-hours: seg a sex, 8h às 18h BRT) a retomada espera.
test("fora do expediente a retomada espera; no expediente seguinte ela sai", async () => {
  // 1º toque terça 20:30 BRT; 24h caem fora do expediente.
  const repo = await world({ lead: { sdrLog: { firstTouchAt: ISO("2026-08-18T23:30:00Z"), firstTouchVia: "template" } } });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa, new Date("2026-08-20T01:30:00Z")); // quarta 22:30 BRT
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.secondTouchAt, undefined);
  await tickOf(repo, wa, new Date("2026-08-20T12:00:00Z")); // quinta 9:00 BRT
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 1);
  assert.ok((await repo.get("leads", "L1")).sdrLog.secondTouchAt);
});

test("24h completadas na quinta à noite atravessam o fim de semana (teto 96h)", async () => {
  // 1º toque quinta 18:30 BRT → primeiro expediente é segunda 8h (~86h depois).
  const repo = await world({ lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T21:30:00Z"), firstTouchVia: "template" } } });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa, new Date("2026-08-15T14:00:00Z")); // sábado 11h BRT: fim de semana não é expediente
  assert.equal(wa.sent.length, 0);
  await tickOf(repo, wa, new Date("2026-08-17T11:30:00Z")); // segunda 8:30 BRT
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 1);
});

test("mais velho que o teto de 96h fica de fora", async () => {
  const repo = await world({ lead: { sdrLog: { firstTouchAt: ISO("2026-08-13T10:00:00Z"), firstTouchVia: "template" } } });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickOf(repo, wa, new Date("2026-08-17T11:30:00Z")); // segunda 8:30 BRT, 97h depois
  assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 0);
});

test("1º toque de HUMANO, call marcada ou menos de 24h: sem retomada", async () => {
  for (const lead of [
    { sdrLog: { firstTouchAt: ISO("2026-08-19T12:30:00Z"), firstTouchVia: "human" } },
    { callAt: "2026-08-21T10:00" },
    { sdrLog: { firstTouchAt: ISO("2026-08-20T10:00:00Z"), firstTouchVia: "template" } },
  ]) {
    const repo = await world({ lead });
    const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
    await tickOf(repo, wa);
    assert.equal(wa.sent.filter((s) => s.name === "sdr_retomada_conversa").length, 0);
  }
});
