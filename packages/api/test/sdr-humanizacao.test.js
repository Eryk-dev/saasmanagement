import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner, handleSdrInbound, greetName } from "../src/sdr-flow.js";
import { makeSdrBrain, sameSentence } from "../src/sdr-brain.js";
import { flagFailedBotSend } from "../src/wa-call-flow.js";
import { holdSlots, activeHolds, withoutHeld, releaseHolds } from "../src/agenda-slots.js";

// Consertos do pente fino das conversas de 24/08/2026 (o primeiro dia útil
// inteiro com o robô ligado pra todos): cada teste aqui reproduz uma cena real
// da produção daquele dia.
//
// Relógio: quarta 19/08/2026, 10h BRT (13h UTC), o mesmo dos outros testes do
// SDR — com closer livre e aviso mínimo de 2h, o 1º slot ofertável é 13:00.
const NOW = new Date("2026-08-19T13:00:00Z");
const ISO = (s) => new Date(s).toISOString();

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
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

async function world({ leads = [], threads = [], messages = [], sdrBot = {}, users } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    leadQuestions: [{ key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }] }],
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), ...sdrBot },
  });
  for (const u of users || [
    { id: "sdr", name: "Manuela", roles: ["sdr"] },
    { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 },
  ]) await repo.create("users", u);
  for (const l of leads) await repo.create("leads", { saas: "leverads", owner: "sdr", ...l });
  for (const t of threads) await repo.create("wa_threads", t);
  for (const m of messages) await repo.create("wa_messages", m);
  return repo;
}

const runnerOf = (repo, wa, extra = {}) =>
  makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {}, info: () => {} }, now: () => NOW, ...extra });

// ── A5 · nome do form ───────────────────────────────────────────────────────
test("greetName: caixa e sujeira do form saem; o que não é nome de gente vira saudação sem nome", () => {
  assert.equal(greetName("silas"), "Silas");            // minúsculo do WhatsApp
  assert.equal(greetName("PEDRO"), "Pedro");            // caixa alta gritada
  assert.equal(greetName("JOSNIEL"), "Josniel");
  assert.equal(greetName("Rafael Silva"), "Rafael");    // só o primeiro nome
  assert.equal(greetName("PECAS"), "");                 // "Oi PECAS!" saiu em prod
  assert.equal(greetName("GMS"), "");                   // sigla de empresa
  assert.equal(greetName("Gostariademaisi"), "");       // texto do form aglutinado
  assert.equal(greetName("Alcindotzwicins"), "");
  assert.equal(greetName("Loja 12"), "");
  assert.equal(greetName(""), "");
});

test("1º toque com nome impróprio sai sem nome, não com 'Oi PECAS'", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "PECAS", phone: "5566999336126", stage: "Novo lead", accounts: "3-5", createdAt: ISO("2026-08-19T12:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_multi"] });
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].params[0], "tudo bem"); // fallback do template, sem o "PECAS"
});

// ── A3 · robô não fala por cima de gente ────────────────────────────────────
test("lembrete cala quando gente confirmou na mão minutos antes (e o passo fica carimbado)", async () => {
  const callAt = "2026-08-19T11:00"; // 1h depois do agora (BRT)
  const repo = await world({
    leads: [{ id: "L1", name: "Jeverson", phone: "5562992864482", stage: "Call agendada", callAt, callSetAt: ISO("2026-08-17T12:00:00Z") }],
    threads: [{ id: "5562992864482", phone: "5562992864482", leadId: "L1", saas: "leverads" }],
    messages: [
      { id: "m1", thread: "5562992864482", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-19T12:00:00Z") },
      // A Manuela confirmou na mão 11 minutos atrás — foi o que aconteceu em prod.
      { id: "m2", thread: "5562992864482", leadId: "L1", direction: "out", author: "sdr", text: "Jeverson, confirmando a call de hoje às 11h. Tudo certo?", at: ISO("2026-08-19T12:49:00Z") },
    ],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 0, "robô não repete a confirmação que a pessoa acabou de mandar");
  assert.equal((await repo.get("leads", "L1")).confirmLog["1h"], "humano");
});

test("lembrete sai normalmente quando a última fala humana é antiga", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "Jeverson", phone: "5562992864482", stage: "Call agendada", callAt: "2026-08-19T11:00", callSetAt: ISO("2026-08-17T12:00:00Z") }],
    threads: [{ id: "5562992864482", phone: "5562992864482", leadId: "L1", saas: "leverads" }],
    messages: [
      { id: "m1", thread: "5562992864482", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-19T12:00:00Z") },
      { id: "m2", thread: "5562992864482", leadId: "L1", direction: "out", author: "sdr", text: "combinado", at: ISO("2026-08-19T09:00:00Z") },
    ],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /Está tudo certo pra nossa conversa/);
});

// ── A4 · véspera não confirma o que acabou de ser combinado ─────────────────
test("véspera pula quando a call foi marcada dentro da janela de 24h (caso Amilton)", async () => {
  // Call amanhã 10h BRT; a véspera cairia AGORA. Marcada há 5 minutos.
  const repo = await world({
    leads: [{
      id: "L1", name: "Amilton", phone: "5519991948264", stage: "Call agendada",
      callAt: "2026-08-20T10:00", callSetAt: ISO("2026-08-19T12:55:00Z"),
    }],
    threads: [{ id: "5519991948264", phone: "5519991948264", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5519991948264", leadId: "L1", direction: "in", text: "pode ser 10h", at: ISO("2026-08-19T12:54:00Z") }],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 0, "ninguém confirma um combinado de 5 minutos atrás");
  assert.ok((await repo.get("leads", "L1")).confirmLog["24h"], "passo carimbado: não sai atrasado depois");
});

test("véspera sai quando a marcação é de dias atrás", async () => {
  const repo = await world({
    leads: [{
      id: "L1", name: "Amilton", phone: "5519991948264", stage: "Call agendada",
      callAt: "2026-08-20T10:00", callSetAt: ISO("2026-08-17T12:00:00Z"),
    }],
    threads: [{ id: "5519991948264", phone: "5519991948264", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5519991948264", leadId: "L1", direction: "in", text: "beleza", at: ISO("2026-08-19T12:00:00Z") }],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /Confirmando nossa conversa/);
});

test("lead antigo sem callSetAt mantém a véspera (compatibilidade)", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "Amilton", phone: "5519991948264", stage: "Call agendada", callAt: "2026-08-20T10:00" }],
    threads: [{ id: "5519991948264", phone: "5519991948264", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5519991948264", leadId: "L1", direction: "in", text: "beleza", at: ISO("2026-08-19T12:00:00Z") }],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
});

// ── B4 · link do Meet ───────────────────────────────────────────────────────
test("lembrete de 1h cria a sala que falta; 10min sem link levanta alerta pro time", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "Marlos", phone: "5547991788462", stage: "Call agendada", callAt: "2026-08-19T11:00", callSetAt: ISO("2026-08-17T12:00:00Z") }],
    threads: [{ id: "5547991788462", phone: "5547991788462", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5547991788462", leadId: "L1", direction: "in", text: "tudo certo sim", at: ISO("2026-08-19T12:30:00Z") }],
  });
  const wa = makeWa();
  const meets = [];
  const autoCallMeet = async (id) => {
    meets.push(id);
    await repo.update("leads", id, { callUrl: "https://meet.google.com/ijo-usrw-bbd" });
  };
  await runnerOf(repo, wa, { autoCallMeet }).tick();
  assert.deepEqual(meets, ["L1"]);
  assert.match(wa.sent[0].text, /Está tudo certo/);

  // Agora o passo de 10min, com a sala já criada: o link vai no texto.
  const repo2 = await world({
    leads: [{ id: "L1", name: "Marlos", phone: "5547991788462", stage: "Call agendada", callAt: "2026-08-19T10:10", callSetAt: ISO("2026-08-17T12:00:00Z"), confirmLog: { at: "2026-08-19T10:10", "24h": "x", "1h": "x" } }],
    threads: [{ id: "5547991788462", phone: "5547991788462", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5547991788462", leadId: "L1", direction: "in", text: "tudo certo", at: ISO("2026-08-19T12:30:00Z") }],
  });
  const wa2 = makeWa();
  await runnerOf(repo2, wa2, { autoCallMeet: async () => {} }).tick();
  assert.match(wa2.sent[0].text, /começa em 10 minutos/);
  const alerts = await repo2.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /sem link do Meet/);
});

// ── A2 · resgate de no-show só depois do horário ────────────────────────────
test("card em No show ANTES da hora marcada não recebe 'não te encontrei'", async () => {
  const repo = await world({
    leads: [{
      id: "L1", name: "Gostariademaisi", phone: "5519994463145", stage: "No show",
      callAt: "2026-08-19T11:00", stageSince: ISO("2026-08-19T12:50:00Z"),
    }],
    threads: [{ id: "5519994463145", phone: "5519994463145", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5519994463145", leadId: "L1", direction: "in", text: "não vou conseguir hoje", at: ISO("2026-08-19T12:40:00Z") }],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 0, "o horário marcado ainda nem chegou");
});

test("resgate sai quando o horário já passou de verdade", async () => {
  const repo = await world({
    leads: [{
      id: "L1", name: "Michel", phone: "5534998946590", stage: "No show",
      callAt: "2026-08-19T09:00", stageSince: ISO("2026-08-19T12:50:00Z"),
    }],
    threads: [{ id: "5534998946590", phone: "5534998946590", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "m1", thread: "5534998946590", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-19T12:00:00Z") }],
  });
  const wa = makeWa();
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /não te encontrei/);
});

test("2ª tentativa do no-show também passa pela higiene do nome e pela reserva", async () => {
  const repo = await world({
    leads: [{
      id: "L1", name: "PECAS", phone: "5566993361260", stage: "No show",
      stageSince: ISO("2026-08-18T12:00:00Z"),
      sdrLog: { noshowFor: ISO("2026-08-18T12:00:00Z"), noshowVia: "text", noshowAt: ISO("2026-08-18T12:00:00Z") },
    }],
    threads: [{ id: "5566993361260", phone: "5566993361260", leadId: "L1", saas: "leverads" }],
    // Silêncio desde o 1º resgate (quem responde não leva 2ª tentativa) e
    // janela de 24h fechada, que é o normal um dia depois do furo: vai template.
    messages: [{ id: "m1", thread: "5566993361260", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-17T12:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_remarcar_noshow"] });
  await runnerOf(repo, wa).tick();
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].params[0], "tudo bem", "não sai 'Oi PECAS' na 2ª tentativa");
  assert.ok((await activeHolds(repo, "leverads", { now: NOW })).length, "horário oferecido fica reservado");
});

// ── A9 · lead já está na conversa ───────────────────────────────────────────
test("lead avisando que já está na sala carimba os lembretes restantes", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "José", phone: "5532913540250", stage: "Call agendada", callAt: "2026-08-19T11:00", confirmLog: { at: "2026-08-19T11:00", "24h": "x" } }],
    threads: [{ id: "5532913540250", phone: "5532913540250", leadId: "L1", saas: "leverads" }],
  });
  const r = await handleSdrInbound(repo, { message: { from: "5532913540250", text: "Já estou conversando aqui" }, now: NOW });
  assert.equal(r, "in-call");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.confirmLog["1h"], "na-conversa");
  assert.equal(lead.confirmLog["10min"], "na-conversa");
});

test("'não consigo entrar na sala' NÃO vira in-call: precisa de gente", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "José", phone: "5532913540250", stage: "Call agendada", callAt: "2026-08-19T11:00", confirmLog: { at: "2026-08-19T11:00", "1h": ISO("2026-08-19T12:00:00Z") } }],
    threads: [{ id: "5532913540250", phone: "5532913540250", leadId: "L1", saas: "leverads" }],
  });
  const r = await handleSdrInbound(repo, { message: { from: "5532913540250", text: "não consigo entrar na sala" }, now: NOW });
  assert.equal(r, "alert");
  assert.equal((await repo.get("leads", "L1")).confirmLog["10min"], undefined);
});

// ── B1 · falha de envio alerta por contexto ─────────────────────────────────
test("lembrete que falhou no dia da call alerta mesmo com alerta antigo no lead (caso Lucas/Andre)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", {
    id: "L1", saas: "leverads", name: "Lucas", callAt: "2026-08-24T13:30",
    sdrLog: { sendFailedAlertAt: ISO("2026-08-23T16:30:00Z") }, // alerta da véspera, por outra mensagem
  });
  await repo.create("wa_threads", { id: "5511974730041", phone: "5511974730041", leadId: "L1", saas: "leverads" });
  await repo.create("wa_messages", {
    id: "w1", thread: "5511974730041", leadId: "L1", direction: "out", author: "sdr-bot",
    status: "failed", error: "Re-engagement message", at: ISO("2026-08-24T15:30:00Z"),
  });
  assert.equal(await flagFailedBotSend(repo, "w1"), "L1");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /Lembrete da conversa \(13:30\) NÃO entregue/);
  // Segunda falha da MESMA call não vira segundo alerta.
  await repo.create("wa_messages", { id: "w2", thread: "5511974730041", leadId: "L1", direction: "out", author: "sdr-bot", status: "failed", error: "Re-engagement message", at: ISO("2026-08-24T16:20:00Z") });
  assert.equal(await flagFailedBotSend(repo, "w2"), null);
  assert.equal((await repo.list("wa_alerts")).length, 1);
});

test("número em experimento da Meta vira flag de canal bloqueado (é caso de ligação)", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "L1", saas: "leverads", name: "Marcelo" });
  await repo.create("wa_threads", { id: "5531993355001", phone: "5531993355001", leadId: "L1", saas: "leverads" });
  await repo.create("wa_messages", {
    id: "w1", thread: "5531993355001", leadId: "L1", direction: "out", author: "sdr-bot",
    status: "failed", error: "User's number is part of an experiment", errorCode: 131050, at: ISO("2026-08-24T13:00:00Z"),
  });
  assert.equal(await flagFailedBotSend(repo, "w1"), "L1");
  const lead = await repo.get("leads", "L1");
  assert.ok(lead.sdrLog.templateBlockedAt);
  assert.match((await repo.list("wa_alerts"))[0].text, /marketing bloqueado neste número/);
});

// ── B3 · retomada não sai em rajada idêntica ────────────────────────────────
test("segundo toque: jitter por lead + teto por ciclo espalham o lote das 24h", async () => {
  // 12 leads tocados no MESMO segundo, 25h atrás: sem jitter, os 12 sairiam juntos.
  const leads = Array.from({ length: 12 }, (_, i) => ({
    id: `L${i}`, name: `Lead${i}`, phone: `551199999${String(i).padStart(4, "0")}`,
    stage: "Qualificando", createdAt: ISO("2026-08-18T11:00:00Z"),
    sdrLog: { firstTouchAt: ISO("2026-08-18T12:00:00Z"), firstTouchVia: "template" },
  }));
  const repo = await world({ leads, sdrBot: { secondTouch: true } });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await runnerOf(repo, wa).tick();
  assert.ok(wa.sent.length <= 3, `teto por ciclo respeitado (saíram ${wa.sent.length})`);
  assert.ok(wa.sent.length >= 1, "quem já passou do próprio atraso é tocado");
});

test("segundo toque sorteia entre as variações aprovadas do template", async () => {
  const leads = Array.from({ length: 6 }, (_, i) => ({
    id: `L${i}`, name: `Lead${i}`, phone: `551188888${String(i).padStart(4, "0")}`,
    stage: "Qualificando", createdAt: ISO("2026-08-15T11:00:00Z"),
    sdrLog: { firstTouchAt: ISO("2026-08-16T12:00:00Z"), firstTouchVia: "template" },
  }));
  const repo = await world({
    leads,
    sdrBot: { secondTouch: true, templates: { secondTouchVariants: ["sdr_retomada_conversa_b"] } },
  });
  const wa = makeWa({ approved: ["sdr_retomada_conversa", "sdr_retomada_conversa_b"] });
  // Três ciclos pra passar do teto por ciclo.
  const runner = runnerOf(repo, wa);
  await runner.tick(); await runner.tick(); await runner.tick();
  const usados = new Set(wa.sent.map((s) => s.name));
  assert.ok(usados.size >= 2, `o lote usou mais de um template (${[...usados].join(", ")})`);
});

// ── A8 · horário ofertado fica reservado ────────────────────────────────────
test("reserva de horário: some da oferta dos outros leads e volta quando expira ou o lead marca", async () => {
  const repo = makeMemRepo();
  const slots = [{ at: "2026-08-20T10:00" }, { at: "2026-08-20T14:00" }];
  await holdSlots(repo, { saas: "leverads", leadId: "L1", slots, now: NOW });
  const holds = await activeHolds(repo, "leverads", { now: NOW });
  assert.equal(holds.length, 2);
  // Outro lead não enxerga o que L1 está decidindo; L1 continua enxergando.
  assert.deepEqual(withoutHeld(slots, holds, "L2").map((s) => s.at), []);
  assert.deepEqual(withoutHeld(slots, holds, "L1").map((s) => s.at), ["2026-08-20T10:00", "2026-08-20T14:00"]);
  // Meia hora depois a reserva morre sozinha.
  const later = new Date(NOW.getTime() + 31 * 60_000);
  assert.equal((await activeHolds(repo, "leverads", { now: later })).length, 0);
  // E marcar libera na hora.
  await releaseHolds(repo, { saas: "leverads", leadId: "L1", now: NOW });
  assert.equal((await activeHolds(repo, "leverads", { now: NOW })).length, 0);
});

// ── A6/A7 · cérebro: preço, repetição e resposta em voo ─────────────────────
async function brainWorld({ lead = {}, messages = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    leadQuestions: [{ key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }] }],
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), conversation: true },
  });
  await repo.create("users", { id: "sdr", name: "Manuela", roles: ["sdr"] });
  await repo.create("users", { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 });
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Maycon", phone: "41999990000",
    stage: "Qualificando", createdAt: ISO("2026-08-19T12:00:00Z"), ...lead,
  });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" });
  let seq = 0;
  for (const m of messages) {
    await repo.create("wa_messages", { id: "bm" + (++seq), thread: "5541999990000", leadId: "L1", saas: "leverads", ...m });
  }
  return repo;
}

function brainFakes({ decisions = [] } = {}) {
  const sent = [];
  const queue = [...decisions];
  return {
    sent,
    wa: { configured: () => true, sendText: async (to, text) => { sent.push({ to, text }); return { messageId: "wmb_" + sent.length }; } },
    anthropic: {
      configured: () => true,
      sdrDecide: async () => ({ acao: "silencio", mensagem: "", horario: "", email: "", motivoHumano: "", ...(queue.shift() || {}) }),
    },
  };
}

const brainOf = (repo, fakes, extra = {}) => makeSdrBrain({
  repo, whatsapp: fakes.wa, anthropic: fakes.anthropic,
  log: { warn: () => {}, info: () => {} }, now: () => NOW, replyDelayMs: 0, partDelayMs: 0, sleep: async () => {}, ...extra,
});

test("preço pela segunda vez: robô sai da frente e chama gente (caso RT Eleven)", async () => {
  const repo = await brainWorld({
    messages: [
      { direction: "in", text: "Gostaria de saber o valor", at: ISO("2026-08-19T12:44:00Z") },
      { direction: "out", author: "sdr-bot", text: "O investimento é de acordo com as necessidades da operação", at: ISO("2026-08-19T12:45:00Z") },
      { direction: "in", text: "No caso eu quero saber primeiro o preço para ver a viabilidade", at: ISO("2026-08-19T12:46:00Z") },
    ],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "O investimento é de acordo com as necessidades da sua operação, primeiro a gente entende o cenário" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "No caso eu quero saber primeiro o preço para ver a viabilidade", id: "bm3" } });
  assert.equal(r, "preco-humano");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /Insistiu no preço/);
  assert.ok((await repo.get("leads", "L1")).sdrLog.handoffAt, "conversa entregue pro humano");
  assert.equal(fakes.sent.length, 1);
  assert.doesNotMatch(fakes.sent[0].text, /investimento é de acordo/, "não repete a parede");
});

test("resposta que só requenta o que já foi dito não sai: vira handoff", async () => {
  const repeticao = "Nosso especialista mostra esse fluxo funcionando na prática, qual fica melhor pra você?";
  const repo = await brainWorld({
    messages: [
      { direction: "out", author: "sdr-bot", text: repeticao, at: ISO("2026-08-19T12:40:00Z") },
      { direction: "in", text: "mas como assim exatamente", at: ISO("2026-08-19T12:50:00Z") },
    ],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: repeticao }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "mas como assim exatamente", id: "bm2" } });
  assert.equal(r, "repeticao-humano");
  assert.equal(fakes.sent.length, 0);
  assert.match((await repo.list("wa_alerts"))[0].text, /sem resposta nova/);
});

test("confirmação curta pode repetir: 'Perfeito' duas vezes não vira handoff", async () => {
  const repo = await brainWorld({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Perfeito", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "in", text: "fechado então", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "fechado então", id: "bm2" } });
  assert.equal(r, "responder");
  assert.equal(fakes.sent.length, 1);
});

// ── A10 · resposta automática do lead não é ordem pro robô (caso Alexandre) ──
const POS_VENDAS = "Olá! Você contatou o PÓS VENDAS. Deixe sua mensagem para agilizarmos o atendimento. Para *VENDAS* clique no link wa.me/+554135161828 e entre direto.";

test("robô não repassa pro lead o link que veio da resposta automática dele", async () => {
  const repo = await brainWorld({
    lead: { name: "Alexandre" },
    messages: [
      { direction: "out", author: "sdr-bot", text: "Oiii, Alexandre. Manuela falando, da LeverAds...", at: ISO("2026-08-19T12:41:00Z") },
      { direction: "in", text: POS_VENDAS, at: ISO("2026-08-19T12:42:00Z") },
      { direction: "in", text: "Ola", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  // A IA se confunde e tenta redirecionar, como aconteceu em produção.
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagens: ["Esse número é do pós-vendas. Para seguirmos sobre a LeverAds, entre pelo link de vendas: wa.me/+554135161828", "Consegue acessar por lá?"] }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Ola", id: "bm3" } });
  assert.equal(r, "redirect-travado");
  assert.equal(fakes.sent.length, 0, "nem a parte sem link sai: a fala inteira estava confusa");
  assert.match((await repo.list("wa_alerts"))[0].text, /outro número\/link/);
  assert.ok((await repo.get("leads", "L1")).sdrLog.handoffAt);
});

test("o conteúdo da resposta automática não chega na IA, só o rótulo", async () => {
  const repo = await brainWorld({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Oiii, tudo bem?", at: ISO("2026-08-19T12:41:00Z") },
      { direction: "in", text: POS_VENDAS, at: ISO("2026-08-19T12:42:00Z") },
      { direction: "in", text: "Ola", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  let visto = null;
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "Oi! A LeverAds ajuda a escalar sua operação, isso faria sentido pra você?" }] });
  const orig = fakes.anthropic.sdrDecide;
  fakes.anthropic.sdrDecide = async (ctx) => { visto = ctx; return orig(ctx); };
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Ola", id: "bm3" } });
  const linhas = visto.conversation.map((c) => c.text);
  assert.ok(linhas.some((t) => t.includes("resposta automática do estabelecimento")), "entrou rotulada");
  assert.ok(!linhas.some((t) => t.includes("wa.me")), "o link do menu não chega na IA");
  assert.ok(!linhas.some((t) => t.includes("PÓS VENDAS")), "nem o texto da ordem");
});

test("trava de redirecionamento pega também o telefone escrito por extenso", async () => {
  const repo = await brainWorld({
    messages: [{ direction: "in", text: "aqui é o pós-vendas", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "Sem problemas, chama a gente no 41 3516-1828 que seguimos por lá" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "aqui é o pós-vendas", id: "bm1" } });
  assert.equal(r, "redirect-travado");
  assert.equal(fakes.sent.length, 0);
});

test("pessoa dizendo 'esse número é do meu sócio' NÃO é tratada como robô: conversa segue", async () => {
  const repo = await brainWorld({
    messages: [
      { direction: "out", author: "sdr-bot", text: "Oiii, tudo bem?", at: ISO("2026-08-19T12:40:00Z") },
      { direction: "in", text: "esse número é do meu sócio, mas pode falar comigo", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "Perfeito, seguimos por aqui então. A LeverAds ajuda a escalar sua operação nos marketplaces, isso faz sentido pra vocês?" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "esse número é do meu sócio, mas pode falar comigo", id: "bm2" } });
  assert.equal(r, "responder");
  assert.equal(fakes.sent.length, 1);
});

test("resposta automática NO MEIO da conversa também não é respondida", async () => {
  const repo = await brainWorld({
    messages: [
      { direction: "in", text: "oi, quero saber mais", at: ISO("2026-08-19T12:30:00Z") },
      { direction: "out", author: "sdr-bot", text: "Oiii, tudo bem?", at: ISO("2026-08-19T12:31:00Z") },
      { direction: "in", text: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.", at: ISO("2026-08-19T12:59:00Z") },
    ],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagem: "qualquer coisa" }] });
  const r = await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.", id: "bm3" } });
  assert.equal(r, "auto-reply");
  assert.equal(fakes.sent.length, 0);
});

test("sameSentence pega a mesma frase reescrita, mas não confunde frases diferentes", () => {
  assert.ok(sameSentence(
    "O investimento é de acordo com as necessidades da operação, primeiro entendemos o cenário",
    "O investimento é de acordo com as necessidades da operação, primeiro a gente entende o cenário",
  ));
  assert.ok(!sameSentence("Consigo amanhã às 10h, fica bom?", "A LeverAds clona seus anúncios entre contas"));
});

test("mensagem nova do lead no meio do envio aborta o resto da fala", async () => {
  const repo = await brainWorld({
    messages: [{ direction: "in", text: "quero entender melhor", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const fakes = brainFakes({ decisions: [{ acao: "responder", mensagens: ["Claro, te explico", "A LeverAds clona seus anúncios entre contas", "Consigo te mostrar ao vivo, qual fica melhor pra você?"] }] });
  // Assim que a 1ª parte sai, o lead escreve de novo (rajada real).
  let injetou = false;
  const sleep = async () => {
    if (fakes.sent.length === 1 && !injetou) {
      injetou = true;
      await repo.create("wa_messages", { id: "bm99", thread: "5541999990000", leadId: "L1", direction: "in", text: "ah espera, outra coisa", at: ISO("2026-08-19T13:00:10Z") });
    }
  };
  const r = await brainOf(repo, fakes, { sleep }).handleInbound({ message: { from: "5541999990000", text: "quero entender melhor", id: "bm1" } });
  assert.equal(r, "abortado");
  assert.equal(fakes.sent.length, 1, "só a parte que já tinha saído; o resto morre e o próximo disparo responde tudo");
});

test("bookCall carimba callSetAt (é o que segura a véspera precoce)", async () => {
  const repo = await brainWorld({});
  const fakes = brainFakes({ decisions: [{ acao: "agendar", horario: "2026-08-19T13:00" }] });
  await repo.create("wa_messages", { id: "bmx", thread: "5541999990000", leadId: "L1", direction: "in", text: "pode ser 13h", at: ISO("2026-08-19T12:59:00Z") });
  await brainOf(repo, fakes).handleInbound({ message: { from: "5541999990000", text: "pode ser 13h", id: "bmx" } });
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.callAt, "2026-08-19T13:00");
  assert.equal(lead.callSetAt, NOW.toISOString());
});
