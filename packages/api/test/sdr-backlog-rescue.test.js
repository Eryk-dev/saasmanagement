import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner } from "../src/sdr-flow.js";

// Campanha de resgate do backlog (Leo, 24/08): lotes por meia hora, dias
// úteis, mais novos primeiro, Qualificando antes da Nutrição, card parado.
const ISO = (s) => new Date(s).toISOString();
// Segunda 24/08, 9h10 BRT (12h10 UTC): dentro do lote das 9h00.
const NOW = new Date("2026-08-24T12:10:00Z");
const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "Nutrição", kind: "contato" },
  { stage: "No show", kind: "contato" },
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

async function world({ leads = [], threads = [], sdrBot = {} } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), backlogRescue: true, firstTouch: false, reminders: false, rescue: false, secondTouch: false, ...sdrBot },
  });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  for (const l of leads) await repo.create("leads", { saas: "leverads", owner: "sdr", ...l });
  for (const t of threads) await repo.create("wa_threads", t);
  return repo;
}

const tickAt = (repo, wa, when = NOW) => makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => when }).tick();

test("lote da meia hora: Qualificando mais novo primeiro, Nutrição usa o template de novidades, quota persiste", async () => {
  const repo = await world({
    sdrBot: { backlogRescuePerBatch: 2 },
    leads: [
      { id: "Q_velho", name: "Ana", phone: "41911110001", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z"), stageSince: ISO("2026-08-10T10:00:00Z") },
      { id: "Q_novo", name: "Bia", phone: "41911110002", stage: "Qualificando", createdAt: ISO("2026-08-20T10:00:00Z"), stageSince: ISO("2026-08-20T10:00:00Z") },
      { id: "N1", name: "Caio", phone: "41911110003", stage: "Nutrição", createdAt: ISO("2026-08-01T10:00:00Z"), stageSince: ISO("2026-08-01T10:00:00Z") },
      { id: "Q_call", name: "Dede", phone: "41911110004", stage: "Qualificando", callAt: "2026-08-25T10:00", createdAt: ISO("2026-08-20T10:00:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_retomada_conversa", "sdr_retomada_novidades"] });
  await tickAt(repo, wa);
  // Lote de 2: Qualificando primeiro, mais novo na frente (Bia, depois Ana).
  assert.deepEqual(wa.sent.map((s) => s.name), ["sdr_retomada_conversa", "sdr_retomada_conversa"]);
  assert.equal(wa.sent[0].params[0], "Bia", "mais novo primeiro");
  assert.equal(wa.sent[1].params[0], "Ana");
  assert.ok((await repo.get("leads", "Q_novo")).sdrLog.backlogRescueAt);
  assert.equal((await repo.get("leads", "Q_call")).sdrLog, undefined, "com call marcada fica fora");
  assert.equal((await repo.get("app_config", "sdr_backlog_rescue_leverads")).sent, 2);
  // Mesmo lote de novo: quota esgotada, nada sai.
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 2);
  // Lote seguinte (9h40 BRT): quota renova e a Nutrição entra com o template
  // de novidades, sem mexer no card.
  await tickAt(repo, wa, new Date("2026-08-24T12:40:00Z"));
  assert.equal(wa.sent.length, 3);
  assert.equal(wa.sent[2].name, "sdr_retomada_novidades");
  assert.equal(wa.sent[2].params[1], "Manuela", "novidades leva o nome da SDR");
  assert.equal((await repo.get("leads", "N1")).stage, "Nutrição", "card não se move no envio");
});

test("fora da janela (almoço), fim de semana e atividade recente: nada sai", async () => {
  const lead = { id: "L1", name: "Eva", phone: "41911110005", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z"), stageSince: ISO("2026-08-10T10:00:00Z") };
  // Almoço de segunda (12h10 BRT = 15h10 UTC).
  const repo1 = await world({ leads: [lead] });
  const wa1 = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo1, wa1, new Date("2026-08-24T15:10:00Z"));
  assert.equal(wa1.sent.length, 0);
  // Domingo 9h10 BRT.
  const repo2 = await world({ leads: [lead] });
  const wa2 = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo2, wa2, new Date("2026-08-23T12:10:00Z"));
  assert.equal(wa2.sent.length, 0);
  // Conversa mexeu ontem: fica de fora.
  const repo3 = await world({
    leads: [lead],
    threads: [{ id: "5541911110005", phone: "5541911110005", leadId: "L1", saas: "leverads", lastAt: ISO("2026-08-23T20:00:00Z") }],
  });
  const wa3 = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo3, wa3);
  assert.equal(wa3.sent.length, 0);
});

test("saúde do número em risco pausa a campanha; sem template aprovado, nada sai", async () => {
  const lead = { id: "L1", name: "Gil", phone: "41911110006", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z"), stageSince: ISO("2026-08-10T10:00:00Z") };
  const repo = await world({ leads: [lead] });
  // Número SINALIZADO pela Meta: pausa. (Violação antiga da CONTA não pausa.)
  await repo.create("app_config", { id: "wa_health", number: { event: "FLAGGED", at: ISO("2026-08-23T10:00:00Z") }, account: { event: "ACCOUNT_VIOLATION", detail: "USER_INITIATED_CALLS_LOW_PICKUP_RATE" }, updatedAt: ISO("2026-08-23T10:00:00Z") });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 0, "número sinalizado pausa");
  // Só a violação da conta (sem número sinalizado): campanha SEGUE.
  await repo.update("app_config", "wa_health", { number: {} });
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 1, "violação antiga da conta não trava");
  const repo2 = await world({ leads: [lead] });
  const wa2 = makeWa({ approved: [] });
  await tickAt(repo2, wa2);
  assert.equal(wa2.sent.length, 0, "sem template aprovado");
});

test("DISJUNTOR: taxa de falha alta nas últimas 2h pausa a campanha e levanta alerta", async () => {
  const lead = { id: "L1", name: "Gil", phone: "41911110006", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z"), stageSince: ISO("2026-08-10T10:00:00Z") };
  const repo = await world({ leads: [lead] });
  // 20 mensagens do robô na última hora, 5 falhadas = 25% (limiar 15%).
  for (let i = 0; i < 20; i++) {
    await repo.create("wa_messages", {
      id: "f" + i, thread: "5541900000000", direction: "out", author: "sdr-bot",
      status: i < 5 ? "failed" : "sent", at: ISO("2026-08-24T11:30:00Z"),
    });
  }
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 0, "disjuntor cortou");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /DISJUNTOR/);
  assert.ok(await repo.get("app_config", "sdr_backlog_breaker_leverads"));
});

test("amostra pequena não aciona o disjuntor (um azar isolado não derruba a campanha)", async () => {
  const lead = { id: "L1", name: "Gil", phone: "41911110006", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z"), stageSince: ISO("2026-08-10T10:00:00Z") };
  const repo = await world({ leads: [lead] });
  // 4 mensagens, 2 falhas = 50%, mas amostra < 20: segue enviando.
  for (let i = 0; i < 4; i++) {
    await repo.create("wa_messages", {
      id: "g" + i, thread: "5541900000000", direction: "out", author: "sdr-bot",
      status: i < 2 ? "failed" : "sent", at: ISO("2026-08-24T11:30:00Z"),
    });
  }
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 1);
});

test("ordem por engajamento: quem já respondeu alguma vez sai antes do lead frio", async () => {
  const repo = await world({
    sdrBot: { backlogRescuePerBatch: 1 },
    leads: [
      { id: "FRIO", name: "Frio", phone: "41911110007", stage: "Qualificando", createdAt: ISO("2026-08-22T10:00:00Z"), stageSince: ISO("2026-08-20T10:00:00Z") },
      { id: "QUENTE", name: "Quente", phone: "41911110008", stage: "Qualificando", createdAt: ISO("2026-08-05T10:00:00Z"), stageSince: ISO("2026-08-05T10:00:00Z") },
    ],
  });
  // QUENTE é mais VELHO, mas já respondeu — ganha a vez.
  await repo.create("wa_messages", { id: "in1", thread: "5541911110008", leadId: "QUENTE", direction: "in", text: "oi", at: ISO("2026-08-06T10:00:00Z") });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await tickAt(repo, wa);
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].params[0], "Quente");
});
