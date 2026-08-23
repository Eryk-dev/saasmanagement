import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner, handleSdrInbound, classifyReminderReply, leadDigest, SDR_AUTHOR } from "../src/sdr-flow.js";

// Relógio dos testes: quarta 19/08/2026 (ago/2026: 10=seg … 14=sex; 19=qua).
// O motor recebe `now` injetável; o wall clock BRT deriva dele (UTC-3).
const ISO = (s) => new Date(s).toISOString();

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", cadence: { firstTouchHours: 2 } },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
];
const QUESTIONS = [
  { key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }, { value: "2", label: "2 contas" }, { value: "10+", label: "Mais de 10 contas" }] },
  { key: "niche", label: "Nicho", options: [{ value: "autopecas", label: "Autopeças" }] },
  { key: "listings", label: "Anúncios", options: [{ value: "500-2000", label: "500 a 2 mil" }] },
];

function makeWa({ approved = [], failText = null } = {}) {
  const sent = [];
  return {
    sent,
    approved,
    configured: () => true,
    sendText: async (to, text) => {
      if (failText) { const e = new Error("fora da janela"); e.code = failText; throw e; }
      sent.push({ kind: "text", to, text });
      return { messageId: "wm_t" + sent.length };
    },
    sendTemplate: async (to, name, lang, components) => {
      sent.push({ kind: "template", to, name, params: (components[0]?.parameters || []).map((p) => p.text) });
      return { messageId: "wm_p" + sent.length };
    },
    listTemplates: async () => approved.map((n) => ({ name: n })),
    tokenWabaIds: async () => ["waba_test"],
  };
}

async function world({ leads = [], users, product = {}, threads = [], messages = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL, leadQuestions: QUESTIONS,
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") },
    ...product,
  });
  for (const u of users || [
    { id: "sdr", name: "Manuela", roles: ["sdr"] },
    { id: "leonardo", name: "Leonardo", roles: ["admin"] },
    { id: "pl", name: "Plena", roles: ["closer"], compLevel: 2 },
  ]) await repo.create("users", u);
  for (const l of leads) await repo.create("leads", { saas: "leverads", owner: "sdr", ...l });
  for (const t of threads) await repo.create("wa_threads", t);
  for (const m of messages) await repo.create("wa_messages", m);
  return repo;
}

const runner = (repo, wa, nowRef) => makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => nowRef.t });

// ── Primeiro toque ───────────────────────────────────────────────────────────

test("lead novo que nunca escreveu recebe o template com nome, SDR e diagnóstico; e só uma vez", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") }; // 10h BRT
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael Silva", phone: "41999990000", stage: "Novo lead", accounts: "3-5", niche: "autopecas", createdAt: ISO("2026-08-19T12:50:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  const r = runner(repo, wa, nowRef);
  const stats = await r.tick();
  assert.equal(stats.firstTouch, 1);
  assert.equal(wa.sent[0].kind, "template");
  assert.equal(wa.sent[0].name, "sdr_primeiro_toque_v2");
  assert.deepEqual(wa.sent[0].params, ["Rafael", "Manuela", "3 a 5 contas · autopeças"]);
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrLog.firstTouchVia, "template");
  // A mensagem ficou na conversa com autoria interna do robô (fora da régua
  // de contato humano do metrics-core).
  const msgs = await repo.list("wa_messages");
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].author, SDR_AUTHOR);
  assert.match(msgs[0].text, /Oiii, Rafael\./);
  await r.tick();
  assert.equal(wa.sent.length, 1, "segundo ciclo não repete o toque");
});

test("delay mínimo e o carimbo enabledAt seguram o robô (backlog antigo é fila humana)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    leads: [
      { id: "novo", name: "A", phone: "41911111111", stage: "Novo lead", createdAt: ISO("2026-08-19T12:59:30Z") },
      { id: "velho", name: "B", phone: "41922222222", stage: "Novo lead", createdAt: ISO("2026-07-30T12:00:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
});

test("sem template aprovado o toque espera; aprovou, sai no ciclo seguinte", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Novo lead", createdAt: ISO("2026-08-19T12:40:00Z") }],
  });
  const wa = makeWa({ approved: [] });
  const r = runner(repo, wa, nowRef);
  await r.tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog?.firstTouchAt, undefined, "não carimba: vai tentar de novo");
  wa.approved.push("sdr_primeiro_toque_v2");
  nowRef.t = new Date("2026-08-19T13:06:00Z"); // fura o cache de 5 min da listagem
  const r2 = runner(repo, wa, nowRef);
  await r2.tick();
  assert.equal(wa.sent.length, 1);
});

test("lead que escreveu (janela aberta) recebe texto no tom da casa com horários reais", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael Silva", phone: "41999990000", stage: "Novo lead", accounts: "3-5", createdAt: ISO("2026-08-19T12:40:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "Oi, me chamo Rafael", at: ISO("2026-08-19T12:41:00Z") }],
  });
  const wa = makeWa({ approved: [] }); // texto livre não depende de template
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].kind, "text");
  assert.match(wa.sent[0].text, /^Oiii, Rafael\. Manuela falando, da LeverAds\./);
  assert.match(wa.sent[0].text, /3 a 5 contas/);
  assert.match(wa.sent[0].text, /gerenciar múltiplas contas/);
  assert.match(wa.sent[0].text, /Isso ajudaria na sua operação hoje\?/);
  assert.ok(!/Tenho hoje às/.test(wa.sent[0].text), "abertura não oferece horário (decisão do Leo, 23/08)");
});

test("mensagem já enviada por gente (ou pelo fluxo de ligação) cala o primeiro toque", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Novo lead", createdAt: ISO("2026-08-19T12:40:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "out1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "out", author: "leonardo", text: "Oiii", at: ISO("2026-08-19T12:45:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.firstTouchVia, "human");
});

test("opt-out, número inválido, saída lateral, interno e desqualificado ficam de fora", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const base = { stage: "Novo lead", createdAt: ISO("2026-08-19T12:40:00Z"), phone: "41999990000" };
  const repo = await world({
    leads: [
      { id: "a", ...base, whatsappOptOut: true },
      { id: "b", ...base, whatsappInvalid: true },
      { id: "c", ...base, formExit: "mentoria" },
      { id: "d", ...base, internal: true },
      { id: "e", ...base, disqualified: true },
      { id: "f", ...base, phone: "" },
    ],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
});

// ── Lembretes da call ────────────────────────────────────────────────────────

test("véspera, 1h e 10min saem uma vez cada, gravam no confirmLog e o 10min leva o link", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") }; // exatamente T-24h da call
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", closer: "pl", callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  await r.tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /Confirmando nossa conversa amanhã às 10h, tudo certo\?/);
  assert.ok((await repo.get("leads", "L1")).confirmLog["24h"]);
  await r.tick(); // mesmo instante: não repete
  assert.equal(wa.sent.length, 1);

  nowRef.t = new Date("2026-08-20T12:05:00Z"); // 9h05 BRT, janela do 1h
  await r.tick();
  assert.equal(wa.sent.length, 2);
  assert.match(wa.sent[1].text, /Está tudo certo pra nossa conversa hoje às 10h\?/);

  nowRef.t = new Date("2026-08-20T12:52:00Z"); // 9h52, janela do 10min
  await r.tick();
  assert.equal(wa.sent.length, 3);
  assert.match(wa.sent[2].text, /conversa começa em 10 minutos! Link pra entrar: https:\/\/meet\.google\.com\/abc-defg/);
  const log = (await repo.get("leads", "L1")).confirmLog;
  assert.equal(log.at, "2026-08-20T10:00");
  assert.ok(log["1h"] && log["10min"]);
});

test("lembrete atrasado além da tolerância não sai (robô quebrado não manda véspera 3h depois)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:50:00Z") }; // T-24h + 50min (tolerância = 45)
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
});

test("call já confirmada cala a véspera (mas os lembretes do dia seguem)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", callConfirmed: true, createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.ok((await repo.get("leads", "L1")).confirmLog["24h"], "carimba como resolvido sem mandar");
});

test("passo já feito pelo humano no Meu dia (confirmLog) cala o robô naquele passo", async () => {
  const nowRef = { t: new Date("2026-08-20T12:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", confirmLog: { at: "2026-08-20T10:00", "1h": ISO("2026-08-20T11:55:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
});

test("janela de 24h fechada: lembrete cai pro template aprovado", async () => {
  const nowRef = { t: new Date("2026-08-20T12:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_lembrete_call"], failText: 131047 });
  await runner(repo, wa, nowRef).tick();
  const tpl = wa.sent.find((s) => s.kind === "template");
  assert.ok(tpl, "caiu pro template");
  assert.equal(tpl.name, "sdr_lembrete_call");
  assert.deepEqual(tpl.params, ["Rafael", "hoje às 10h"]);
});

test("sem canal nenhum (janela fechada e sem template), o lembrete vira alerta quente", async () => {
  const nowRef = { t: new Date("2026-08-20T12:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa({ approved: [], failText: 131047 });
  const r = runner(repo, wa, nowRef);
  await r.tick();
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /não entregue/);
  await r.tick();
  assert.equal((await repo.list("wa_alerts")).length, 1, "carimbou o passo: não empilha alerta");
});

// ── Resgate de no-show ───────────────────────────────────────────────────────

test("card movido pra No show recebe o resgate uma vez por movimento", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const since = ISO("2026-08-19T12:30:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "No show", stageSince: since, createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_resgate_noshow"] });
  const r = runner(repo, wa, nowRef);
  const stats = await r.tick();
  assert.equal(stats.rescue, 1);
  assert.equal(wa.sent[0].kind, "template");
  assert.equal(wa.sent[0].name, "sdr_resgate_noshow");
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshowFor, since);
  await r.tick();
  assert.equal(wa.sent.length, 1);
});

test("humano já respondeu depois do furo: o robô não entra por cima", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const since = ISO("2026-08-19T12:00:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "No show", stageSince: since, createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "o1", thread: "5541999990000", leadId: "L1", direction: "out", author: "leonardo", text: "vi que não deu, remarcamos?", at: ISO("2026-08-19T12:10:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshowVia, "human");
});

// ── Resposta do lead ao lembrete ─────────────────────────────────────────────

test("classifyReminderReply: confirmação, remarcação (vence o sim) e o resto", () => {
  assert.equal(classifyReminderReply("Sim, confirmado!"), "confirm");
  assert.equal(classifyReminderReply("pode ser"), "confirm");
  assert.equal(classifyReminderReply("👍"), "confirm");
  assert.equal(classifyReminderReply("sim, mas vou precisar remarcar"), "reschedule");
  assert.equal(classifyReminderReply("não vou conseguir hoje"), "reschedule");
  assert.equal(classifyReminderReply("que horas mesmo?"), "other");
});

test("handleSdrInbound: 'confirmado' marca a call; pedido de remarcação vira UM alerta quente", async () => {
  const callAt = "2027-01-05T10:00";
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt, confirmLog: { at: callAt, "24h": ISO("2026-08-19T13:00:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
  });
  const r1 = await handleSdrInbound(repo, { message: { from: "5541999990000", text: "confirmado, estarei lá" } });
  assert.equal(r1, "confirmed");
  assert.equal((await repo.get("leads", "L1")).callConfirmed, true);

  const r2 = await handleSdrInbound(repo, { message: { from: "5541999990000", text: "vou precisar remarcar pra sexta" } });
  assert.equal(r2, "alert");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /remarcar/);
  const r3 = await handleSdrInbound(repo, { message: { from: "5541999990000", text: "qual dia você tem depois?" } });
  assert.equal(r3, null, "um alerta por horário de call");
  assert.equal((await repo.list("wa_alerts")).length, 1);
});

test("conversa comum (sem lembrete pendente) não passa pelo gancho", async () => {
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Qualificando", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  assert.equal(await handleSdrInbound(repo, { message: { from: "5541999990000", text: "sim" } }), null);
});

test("resposta ao 1º toque do robô (até 72h) vira alerta quente; depois disso, conversa normal", async () => {
  const now = new Date("2026-08-19T15:00:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Novo lead", createdAt: ISO("2026-08-19T12:00:00Z"), sdrLog: { firstTouchAt: ISO("2026-08-19T13:00:00Z"), firstTouchVia: "template" } }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
  });
  const r = await handleSdrInbound(repo, { message: { from: "5541999990000", text: "pode ser amanhã de manhã" }, now });
  assert.equal(r, "hot");
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].text, "pode ser amanhã de manhã");
  // 4 dias depois do toque: virou conversa normal, sem pop-up.
  const later = new Date("2026-08-23T15:00:00Z");
  const r2 = await handleSdrInbound(repo, { message: { from: "5541999990000", text: "e aí?" }, now: later });
  assert.equal(r2, null);
});

test("1º toque que foi de GENTE (via human) não vira alerta do robô", async () => {
  const now = new Date("2026-08-19T15:00:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Novo lead", createdAt: ISO("2026-08-19T12:00:00Z"), sdrLog: { firstTouchAt: ISO("2026-08-19T13:00:00Z"), firstTouchVia: "human" } }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  assert.equal(await handleSdrInbound(repo, { message: { from: "5541999990000", text: "oi" }, now }), null);
});

// ── Resumo do diagnóstico ────────────────────────────────────────────────────

test("leadDigest fala com os rótulos do painel de qualificação", async () => {
  const repo = await world({});
  const product = await repo.get("products", "leverads");
  assert.equal(leadDigest(product, { accounts: "3-5", niche: "autopecas", listings: "500-2000" }), "3 a 5 contas · autopeças · 500 a 2 mil anúncios");
  assert.equal(leadDigest(product, {}), "sua operação de marketplace");
  assert.equal(leadDigest(product, { niche: "petshop" }), "petshop", "nicho custom sai como foi digitado");
});

test("modo teste: o 1º toque também sai pra lead INTERNO (e só com a chave ligada)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), conversationTest: true } },
    leads: [{ id: "T1", name: "Leo Teste", phone: "41995063622", stage: "Novo lead", internal: true, createdAt: ISO("2026-08-19T12:50:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  const stats = await runner(repo, wa, nowRef).tick();
  assert.equal(stats.firstTouch, 1);
  assert.equal(wa.sent[0].name, "sdr_primeiro_toque_v2");
});

test("modo teste com a produção DESLIGADA: lead interno recebe o robô completo; lead real, nada", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), firstTouch: false, reminders: false, rescue: false, conversationTest: true } },
    leads: [
      { id: "T1", name: "Leo Teste", phone: "41995063622", stage: "Novo lead", internal: true, createdAt: ISO("2026-08-19T12:50:00Z") },
      { id: "R1", name: "Real", phone: "41988887777", stage: "Novo lead", createdAt: ISO("2026-08-19T12:50:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  const stats = await runner(repo, wa, nowRef).tick();
  assert.equal(stats.firstTouch, 1, "só o lead interno foi tocado");
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].params[0], "Leo");
  assert.equal((await repo.get("leads", "R1")).sdrLog, undefined, "lead real intocado com produção off");
});

test("lead que veio do anúncio de OEM ouve OEM no 1º toque (janela aberta)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "Anunciar pelo código OEM" } },
    leads: [{ id: "L1", name: "Rafael Silva", phone: "41999990000", stage: "Novo lead", sourcePain: "OEM", accounts: "3-5", createdAt: ISO("2026-08-19T12:40:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "Oi", at: ISO("2026-08-19T12:41:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.match(wa.sent[0].text, /OEM \(part number\)/);
  assert.match(wa.sent[0].text, /Isso ajudaria na sua operação\?/);
  assert.ok(!/gerenciar múltiplas contas/.test(wa.sent[0].text));
});

test("template do 1º toque escolhido pela dor: OEM aprovado vai pro lead de OEM, multi pros demais; sem específico, cai no v2", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "OEM", B: "Banida" } },
    leads: [
      { id: "L1", name: "Alfa", phone: "41911111111", stage: "Novo lead", sourcePain: "OEM", createdAt: ISO("2026-08-19T12:50:00Z") },
      { id: "L2", name: "Beta", phone: "41922222222", stage: "Novo lead", sourcePain: "B", createdAt: ISO("2026-08-19T12:50:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_multi", "sdr_primeiro_toque_oem", "sdr_primeiro_toque_v2"] });
  await runner(repo, wa, nowRef).tick();
  const byName = Object.fromEntries(wa.sent.map((s) => [s.params[0], s.name]));
  assert.equal(byName["Alfa"], "sdr_primeiro_toque_oem");
  assert.equal(byName["Beta"], "sdr_primeiro_toque_multi");

  // Específicos ainda em revisão: v2 cobre.
  const repo2 = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "OEM" } },
    leads: [{ id: "L1", name: "Gama", phone: "41933333333", stage: "Novo lead", sourcePain: "OEM", createdAt: ISO("2026-08-19T12:50:00Z") }],
  });
  const wa2 = makeWa({ approved: ["sdr_primeiro_toque_v2"] });
  await runner(repo2, wa2, nowRef).tick();
  assert.equal(wa2.sent[0].name, "sdr_primeiro_toque_v2");
});
