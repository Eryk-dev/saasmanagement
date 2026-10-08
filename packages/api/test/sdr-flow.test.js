import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner, handleSdrInbound, classifyReminderReply, leadDigest, SDR_AUTHOR } from "../src/sdr/sdr-flow.js";

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
      const body = components.find((c) => c.type === "body");
      const header = components.find((c) => c.type === "header");
      sent.push({ kind: "template", to, name, params: (body?.parameters || []).map((p) => p.text), headerImageId: header?.parameters?.[0]?.image?.id || "" });
      return { messageId: "wm_p" + sent.length };
    },
    uploadMedia: async () => "media_1",
    sendMedia: async (to, { kind, mediaId }) => {
      sent.push({ kind, to, mediaId });
      return { messageId: "wm_m" + sent.length };
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
    { id: "pl", name: "Jonathan", roles: ["closer"], compLevel: 2 },
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

// Régua do Leo (30/09, ajustada no roteiro de 05/10): SEM véspera. Manhã do dia
// (08:00) pra TODO MUNDO com call no dia; 2h antes (pulado quando colaria na
// manhã, call até 10h30); 10min antes com o link.
test("call das 10h: manhã às 8h, o de 2h é pulado (colaria na manhã) e o 10min leva o link, gravando no confirmLog", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") }; // exatamente T-24h da call: nada sai
  // Lead que ESCREVEU há pouco (janela de 24h aberta nos lembretes): é o
  // único cenário em que o lembrete sai como texto livre.
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", closer: "pl", callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "Fechado, amanhã às 10h", at: ISO("2026-08-19T12:59:00Z") }],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  await r.tick();
  assert.equal(wa.sent.length, 0, "véspera não existe mais");
  assert.equal((await repo.get("leads", "L1")).confirmLog, undefined);

  nowRef.t = new Date("2026-08-20T11:05:00Z"); // 8h05 BRT: manhã do dia (o de 2h também cairia aqui)
  await r.tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 10h/);
  assert.match(wa.sent[0].text, /computador por perto/);
  assert.doesNotMatch(wa.sent[0].text, /celular ou pelo computador/);
  assert.match(wa.sent[0].text, /Me confirma por aqui/);
  await r.tick(); // mesmo instante: não repete, e o de 2h fica carimbado como coberto pela manhã
  assert.equal(wa.sent.length, 1);
  assert.equal((await repo.get("leads", "L1")).confirmLog["2h"], "manha");

  nowRef.t = new Date("2026-08-20T12:52:00Z"); // 9h52, janela do 10min
  await r.tick();
  assert.equal(wa.sent.length, 2);
  assert.match(wa.sent[1].text, /conversa começa em 10 minutos! Link pra entrar: https:\/\/meet\.google\.com\/abc-defg/);
  const log = (await repo.get("leads", "L1")).confirmLog;
  assert.equal(log.at, "2026-08-20T10:00");
  assert.ok(log.manha && log["10min"]);
});

test("manhã do dia: call das 14h recebe 'Bom dia' às 8h com o link e a positiva; o 2h vem depois", async () => {
  const nowRef = { t: new Date("2026-08-20T11:35:00Z") }; // quinta 8h35 BRT
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T14:00", closer: "pl", callSetAt: ISO("2026-08-19T18:00:00Z"), callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "Fechado, amanhã às 14h", at: ISO("2026-08-19T18:00:00Z") }],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  await r.tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 14h, nosso especialista já separou o horário\. O link pra entrar é este: https:\/\/meet\.google\.com\/abc-defg/);
  assert.match(wa.sent[0].text, /Me confirma por aqui que está tudo certo\?$/);
  assert.ok((await repo.get("leads", "L1")).confirmLog.manha);
  nowRef.t = new Date("2026-08-20T15:05:00Z"); // 12h05 BRT: 2h antes
  await r.tick();
  assert.equal(wa.sent.length, 2);
  assert.match(wa.sent[1].text, /^Oi Rafael! Nossa conversa é hoje às 14h/);
  // Marcação feita HOJE depois das 8h: a manhã pula (o 2h cobre).
  const repo2 = await world({
    leads: [{ id: "L2", name: "Novo", phone: "41988880000", stage: "Call agendada", callAt: "2026-08-20T16:00", closer: "pl", callSetAt: ISO("2026-08-20T11:20:00Z"), createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa2 = makeWa();
  await runner(repo2, wa2, { t: new Date("2026-08-20T11:40:00Z") }).tick();
  assert.equal(wa2.sent.length, 0);
  assert.equal((await repo2.get("leads", "L2")).confirmLog.manha, "skip");
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

test("call já confirmada cala a manhã (mas os lembretes do dia seguem)", async () => {
  const nowRef = { t: new Date("2026-08-20T11:35:00Z") }; // 8h35 BRT do dia da call
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T14:00", callConfirmed: true, createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).confirmLog.manha, "skip", "carimba como resolvido sem mandar");
});

test("passo já feito pelo humano no Meu dia (confirmLog) cala o robô naquele passo", async () => {
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", confirmLog: { at: "2026-08-20T10:00", "2h": ISO("2026-08-20T10:55:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
});

// REGRESSÃO (Rogerio, 24/08): a Meta ACEITA texto livre com janela fechada
// (devolve id, sem erro síncrono) e só reprova depois, pelo webhook. O motor
// não pode esperar o erro: lead que nunca escreveu vai DIRETO pro template.
test("janela de 24h fechada (lead nunca escreveu): lembrete sai direto pelo template, sem tentar texto", async () => {
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_lembrete_call"] }); // sendText NÃO falharia: é o silêncio da Meta
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 1, "nenhum texto livre saiu antes");
  assert.equal(wa.sent[0].kind, "template");
  assert.equal(wa.sent[0].name, "sdr_lembrete_call");
  assert.deepEqual(wa.sent[0].params, ["Rafael", "hoje às 10h"]);
});

test("registro diz janela aberta mas a Meta recusa na hora: cai pro template", async () => {
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "oi", at: ISO("2026-08-20T10:30:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_lembrete_call"], failText: 131047 });
  await runner(repo, wa, nowRef).tick();
  const tpl = wa.sent.find((s) => s.kind === "template");
  assert.ok(tpl, "caiu pro template");
  assert.equal(tpl.name, "sdr_lembrete_call");
});

test("sem canal nenhum (janela fechada e sem template), o lembrete vira alerta quente", async () => {
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") };
  const repo = await world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const wa = makeWa({ approved: [] });
  const r = runner(repo, wa, nowRef);
  await r.tick();
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /não entregue/);
  await r.tick();
  assert.equal((await repo.list("wa_alerts")).length, 1, "carimbou o passo: não empilha alerta");
});

// Análise dos no-shows (30/08): silêncio na confirmação = 88% de furo. A régua
// nova: confirmação sai 2h antes; sem positiva até 1h antes, o SDR ganha um
// alerta pra LIGAR (uma vez por horário de call).
test("sem positiva até 1h antes da call: alerta de ligação sai uma vez; confirmado ou já alertado, não sai", async () => {
  const nowRef = { t: new Date("2026-08-20T12:10:00Z") }; // 9h10 BRT, call às 10h
  const asked = { at: "2026-08-20T10:00", "2h": ISO("2026-08-20T11:05:00Z") };
  const repo = await world({
    leads: [
      { id: "mudo", name: "Rafael", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", confirmLog: asked, createdAt: ISO("2026-08-10T10:00:00Z") },
      { id: "ok", name: "B", phone: "41922222222", stage: "Call agendada", callAt: "2026-08-20T10:00", callConfirmed: true, confirmLog: asked, createdAt: ISO("2026-08-10T10:00:00Z") },
      { id: "respondeu", name: "C", phone: "41933333333", stage: "Call agendada", callAt: "2026-08-20T10:00", confirmLog: asked, sdrLog: { confirmAlertFor: "2026-08-20T10:00" }, createdAt: ISO("2026-08-10T10:00:00Z") },
    ],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  const stats = await r.tick();
  assert.equal(stats.ringAlerts, 1);
  const alerts = await repo.list("wa_alerts");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /sem positiva na confirmação · liga pro lead agora/);
  assert.equal((await repo.get("leads", "mudo")).sdrLog.ringAlertFor, "2026-08-20T10:00");
  await r.tick(); // mesmo horário de call: não empilha alerta
  assert.equal((await repo.list("wa_alerts")).length, 1);
});

test("antes da última hora (ou sem pedido de confirmação na rua) o alerta de ligação espera", async () => {
  const nowRef = { t: new Date("2026-08-20T11:40:00Z") }; // 8h40 BRT: falta 1h20
  const repo = await world({
    leads: [
      { id: "cedo", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T10:00", confirmLog: { at: "2026-08-20T10:00", "2h": ISO("2026-08-20T11:05:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") },
      { id: "semPedido", name: "S", phone: "41922222222", stage: "Call agendada", callAt: "2026-08-20T13:00", createdAt: ISO("2026-08-10T10:00:00Z") },
    ],
  });
  // A manhã do "semPedido" sai por template (8h40 é a janela dela); o que
  // importa aqui é que o alerta de LIGAÇÃO não dispara pra nenhum dos dois.
  const wa = makeWa({ approved: ["sdr_lembrete_conversa"] });
  const stats = await runner(repo, wa, nowRef).tick();
  assert.equal(stats.ringAlerts, 0);
  assert.equal((await repo.list("wa_alerts")).length, 0);
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
  // Roteiro Lever OEM (Leo, 05/10): abordagem fixa, sem nome do SDR e sem resumo.
  assert.equal(wa.sent[0].text, "Oiii Rafael, tudo bem? Recebemos aqui seu interesse, com o Lever OEM você digita o código e recebe o anúncio completo, com fotos, título de 200 caracteres, descrição e compatibilidade, pronto para revisar e publicar no Mercado Livre e Shopee. Isso ajudaria na sua operação?");
  assert.ok(!/gerenciar múltiplas contas/.test(wa.sent[0].text));
});

// ── Roteiro Lever OEM (doc do Leo, 05/10) ────────────────────────────────────

test("1º toque OEM por template: o v2 do roteiro leva só o nome; sem nome utilizável cai no v1 (3 parâmetros)", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "OEM" } },
    leads: [
      { id: "L1", name: "Alfa", phone: "41911111111", stage: "Novo lead", sourcePain: "OEM", accounts: "3-5", createdAt: ISO("2026-08-19T12:50:00Z") },
      { id: "L2", name: "PECAS", phone: "41922222222", stage: "Novo lead", sourcePain: "OEM", accounts: "3-5", createdAt: ISO("2026-08-19T12:50:00Z") },
    ],
  });
  const wa = makeWa({ approved: ["sdr_primeiro_toque_oem_v2", "sdr_primeiro_toque_oem", "sdr_primeiro_toque_v2"] });
  await runner(repo, wa, nowRef).tick();
  const byPhone = Object.fromEntries(wa.sent.map((s) => [s.to, s]));
  assert.equal(byPhone["41911111111"].name, "sdr_primeiro_toque_oem_v2");
  assert.deepEqual(byPhone["41911111111"].params, ["Alfa"]);
  assert.equal(byPhone["41922222222"].name, "sdr_primeiro_toque_oem");
  assert.equal(byPhone["41922222222"].params.length, 3);
});

test("lembretes do lead de OEM (janela aberta): manhã = texto · FOTO · texto pedindo presença, 2h com o link, 10min com o link", async () => {
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") }; // quinta 8h05 BRT
  const repo = await world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "OEM" } },
    leads: [{ id: "L1", name: "Roberto", phone: "41999990000", stage: "Call agendada", sourcePain: "OEM", callAt: "2026-08-20T14:00", closer: "pl", callSetAt: ISO("2026-08-19T18:00:00Z"), callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Roberto" }],
    messages: [{ id: "in1", thread: "5541999990000", leadId: "L1", saas: "leverads", direction: "in", text: "Sim", at: ISO("2026-08-19T18:00:00Z") }],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  await r.tick();
  assert.equal(wa.sent.length, 3, "texto, foto e texto");
  assert.equal(wa.sent[0].text, "Bom dia Roberto, tudo bom? Temos um horário reservado para hoje às 14h, tudo certo?");
  assert.deepEqual({ kind: wa.sent[1].kind, mediaId: wa.sent[1].mediaId }, { kind: "image", mediaId: "media_1" });
  assert.equal(wa.sent[2].text, "Na reunião vamos te mostrar na prática o passo a passo para criar anúncios completos em escala, explicar as funcionalidades da plataforma e tirar todas suas dúvidas. Posso contar com sua presença? Caso não consiga comparecer, me sinalize para liberar seu horário, por favor.");
  // A foto fica gravada no inbox como mídia e o media id é cacheado por número.
  const img = (await repo.list("wa_messages")).find((m) => m.media?.kind === "image");
  assert.equal(img?.media?.id, "media_1");
  assert.equal((await repo.get("app_config", "sdr_oem_media_leverads_default"))?.mediaId, "media_1");
  await r.tick(); // mesmo instante: nada repete
  assert.equal(wa.sent.length, 3);
  nowRef.t = new Date("2026-08-20T15:05:00Z"); // 12h05: 2h antes
  await r.tick();
  assert.equal(wa.sent.length, 4);
  assert.equal(wa.sent[3].text, "Roberto, nossa conversa é hoje às 14h. O link pra entrar é este: https://meet.google.com/abc-defg. Qualquer imprevisto por favor me avise.");
  nowRef.t = new Date("2026-08-20T16:52:00Z"); // 13h52: 10 min antes
  await r.tick();
  assert.equal(wa.sent.length, 5);
  assert.equal(wa.sent[4].text, "Roberto, nossa conversa começa em 10 minutos! O link pra entrar é este: https://meet.google.com/abc-defg. Te esperamos lá!");
});

test("lembretes do lead de OEM (janela fechada): templates do roteiro na frente, com os parâmetros certos; sem aprovação, cai no genérico", async () => {
  const mk = async () => world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z") }, painMap: { OEM: "OEM" } },
    leads: [{ id: "L1", name: "Roberto", phone: "41999990000", stage: "Call agendada", sourcePain: "OEM", callAt: "2026-08-20T14:00", closer: "pl", callSetAt: ISO("2026-08-18T18:00:00Z"), callUrl: "https://meet.google.com/abc-defg", createdAt: ISO("2026-08-10T10:00:00Z") }],
  });
  const repo = await mk();
  const wa = makeWa({ approved: ["sdr_lembrete_manha_oem_img", "sdr_lembrete_manha_oem", "sdr_lembrete_link_oem", "sdr_lembrete_10min_oem", "sdr_lembrete_link2"] });
  const nowRef = { t: new Date("2026-08-20T11:05:00Z") };
  const r = runner(repo, wa, nowRef);
  await r.tick();
  // Com a foto aprovada: o template de cabeçalho de imagem, com o media id do número.
  assert.equal(wa.sent[0].name, "sdr_lembrete_manha_oem_img");
  assert.deepEqual(wa.sent[0].params, ["Roberto", "hoje às 14h"]);
  assert.equal(wa.sent[0].headerImageId, "media_1");
  nowRef.t = new Date("2026-08-20T15:05:00Z");
  await r.tick();
  assert.equal(wa.sent[1].name, "sdr_lembrete_link_oem");
  assert.deepEqual(wa.sent[1].params, ["Roberto", "hoje às 14h", "https://meet.google.com/abc-defg"]);
  nowRef.t = new Date("2026-08-20T16:52:00Z");
  await r.tick();
  assert.equal(wa.sent[2].name, "sdr_lembrete_10min_oem");
  assert.deepEqual(wa.sent[2].params, ["Roberto", "https://meet.google.com/abc-defg"]);
  // Só a versão em texto aprovada: ela cobre, sem cabeçalho.
  const repoT = await mk();
  const waT = makeWa({ approved: ["sdr_lembrete_manha_oem", "sdr_lembrete_link2"] });
  await runner(repoT, waT, { t: new Date("2026-08-20T11:05:00Z") }).tick();
  assert.equal(waT.sent[0].name, "sdr_lembrete_manha_oem");
  assert.equal(waT.sent[0].headerImageId, "");
  // Sem os do roteiro aprovados: o genérico com link cobre.
  const repo2 = await mk();
  const wa2 = makeWa({ approved: ["sdr_lembrete_link2"] });
  await runner(repo2, wa2, { t: new Date("2026-08-20T11:05:00Z") }).tick();
  assert.equal(wa2.sent[0].name, "sdr_lembrete_link2");
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

// ── 2ª tentativa do no-show (Leo, 24/08) ─────────────────────────────────────

test("no-show sem resposta ganha 2ª tentativa 24h depois, com horários concretos", async () => {
  const nowRef = { t: new Date("2026-08-20T14:30:00Z") }; // quinta 11h30 BRT (24h+ depois do 1º resgate)
  const repo = await world({
    leads: [{
      id: "L1", name: "Rafael Silva", phone: "41999990000", stage: "No show",
      callAt: "2026-08-19T10:00", createdAt: ISO("2026-08-18T12:00:00Z"),
      stageSince: ISO("2026-08-19T13:30:00Z"),
      sdrLog: { noshowFor: ISO("2026-08-19T13:30:00Z"), noshowVia: "text", noshowAt: ISO("2026-08-19T13:31:00Z") },
    }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [
      { id: "m1", thread: "5541999990000", leadId: "L1", direction: "in", text: "oi", at: ISO("2026-08-19T12:00:00Z") },
      { id: "m2", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", text: "passei no nosso horário...", at: ISO("2026-08-19T13:31:00Z") },
    ],
  });
  // 24h depois a janela de 24h da Meta já fechou: sai por TEMPLATE, e o
  // template do re-agendamento leva os dois horários reais no corpo.
  const wa = makeWa({ approved: ["sdr_remarcar_noshow"] });
  await runner(repo, wa, nowRef).tick();
  const out = wa.sent.filter((s) => s.name === "sdr_remarcar_noshow");
  assert.equal(out.length, 1);
  assert.equal(out[0].params[0], "Rafael");
  assert.match(out[0].params[1], /^(hoje|amanhã) às \d/, "1º horário concreto, hoje ou amanhã");
  assert.match(out[0].params[2], /^(hoje|amanhã) às \d/, "2º horário concreto, hoje ou amanhã");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrLog.noshow2Via, "template");
  // Não repete no tick seguinte.
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.filter((s) => s.name === "sdr_remarcar_noshow").length, 1);
});

test("no-show que RESPONDEU ao 1º resgate (ou já remarcou) não leva a 2ª tentativa", async () => {
  const nowRef = { t: new Date("2026-08-20T14:30:00Z") };
  const base = {
    id: "L1", name: "Rafael", phone: "41999990000", stage: "No show",
    createdAt: ISO("2026-08-18T12:00:00Z"), stageSince: ISO("2026-08-19T13:30:00Z"),
    sdrLog: { noshowFor: ISO("2026-08-19T13:30:00Z"), noshowVia: "text", noshowAt: ISO("2026-08-19T13:31:00Z") },
  };
  // (a) respondeu depois do resgate
  const repo = await world({
    leads: [{ ...base, callAt: "2026-08-19T10:00" }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [
      { id: "m1", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", text: "passei...", at: ISO("2026-08-19T13:31:00Z") },
      { id: "m2", thread: "5541999990000", leadId: "L1", direction: "in", text: "opa, me chama amanhã", at: ISO("2026-08-19T14:00:00Z") },
    ],
  });
  const wa = makeWa();
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshow2Via, "skip");

  // (b) já remarcou (call futura)
  const repo2 = await world({
    leads: [{ ...base, callAt: "2026-08-21T10:00" }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  const wa2 = makeWa();
  await runner(repo2, wa2, nowRef).tick();
  assert.equal(wa2.sent.length, 0);
});

// ── Resgate de no-show: call que aconteceu / card movido tarde (raio-x 30/09) ─

test("card em No show com resumo da call NÃO leva o resgate: vira alerta pra conferir a etapa", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const since = ISO("2026-08-19T12:30:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "Douglas", phone: "41999990000", stage: "No show", stageSince: since, callAt: "2026-08-19T09:00", callSummaryFor: "2026-08-19T09:00", callSummaryAt: ISO("2026-08-19T12:20:00Z"), createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  const wa = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshowVia, "skip:resumo");
  assert.match((await repo.list("wa_alerts"))[0].text, /a call tem resumo/);
});

test("lead que avisou que entrou na conversa não leva 'não te encontrei'", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const since = ISO("2026-08-19T12:40:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "Steffany", phone: "41999990000", stage: "No show", stageSince: since, callAt: "2026-08-19T09:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "i1", thread: "5541999990000", leadId: "L1", direction: "in", text: "Entrei mais n tinha ninguém na sala", at: ISO("2026-08-19T12:10:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshowVia, "skip:na-conversa");
});

test("card movido pra No show mais de 24h depois do horário é limpeza de pipeline: sem resgate, sem alerta", async () => {
  const nowRef = { t: new Date("2026-08-19T13:00:00Z") };
  const since = ISO("2026-08-19T12:30:00Z");
  const repo = await world({
    leads: [{ id: "L1", name: "Eduardo", phone: "41999990000", stage: "No show", stageSince: since, callAt: "2026-08-13T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  const wa = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).sdrLog.noshowVia, "skip:tarde");
  assert.equal((await repo.list("wa_alerts")).length, 0);
});

// ── 1e. Cobrança da oferta sem resposta na manhã seguinte (Leo, 30/09) ──────

const OFFER = "Consigo amanhã às 14h ou amanhã às 16h, qual fica melhor pra você?";
async function nudgeWorld({ lastAt = ISO("2026-08-19T20:00:00Z"), inAt = ISO("2026-08-19T19:50:00Z"), extraLeads = [], extraMessages = [], offerText = OFFER } = {}) {
  return world({
    product: { sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), offerNudge: true } },
    leads: [{ id: "L1", name: "Rafael Silva", phone: "41999990000", stage: "Qualificando", createdAt: ISO("2026-08-19T18:00:00Z"), sdrLog: { firstTouchAt: ISO("2026-08-19T18:05:00Z"), firstTouchVia: "brain" } }, ...extraLeads],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", lastDir: "out", lastOutAuthor: "sdr-bot", lastText: offerText, lastAt }],
    messages: [
      { id: "i1", thread: "5541999990000", leadId: "L1", direction: "in", text: "ajudaria sim", at: inAt },
      { id: "o1", thread: "5541999990000", leadId: "L1", direction: "out", author: "sdr-bot", text: offerText, at: lastAt },
      ...extraMessages,
    ],
  });
}
// Quinta 20/08, 09:45 BRT: passou o jitter (0 a 39 min depois das 9h).
const NUDGE_NOW = { t: new Date("2026-08-20T12:45:00Z") };

test("oferta de ontem sem resposta: cobrança de manhã com os MESMOS horários, que ainda estão livres, uma vez só", async () => {
  const repo = await nudgeWorld();
  const wa = makeWa();
  const stats = await runner(repo, wa, NUDGE_NOW).tick();
  assert.equal(stats.offerNudge, 1);
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].kind, "text");
  assert.equal(wa.sent[0].text, "Bom dia Rafael! Ficou hoje às 14h ou às 16h pra nossa conversa com o especialista?");
  const lead = await repo.get("leads", "L1");
  assert.equal(lead.sdrLog.offerNudgeFor, ISO("2026-08-19T20:00:00Z"));
  assert.equal(lead.sdrLog.offerNudgeVia, "text");
  const holds = (await repo.get("app_config", "sdr_slot_holds_leverads")).holds.map((h) => h.at).sort();
  assert.deepEqual(holds, ["2026-08-20T14:00", "2026-08-20T16:00"]);
  await runner(repo, wa, NUDGE_NOW).tick();
  assert.equal(wa.sent.length, 1, "não cobra a mesma oferta duas vezes");
});

test("horário de ontem tomado por outro lead: a cobrança avisa e oferece par novo", async () => {
  const repo = await nudgeWorld({ extraLeads: [{ id: "busy", name: "Outro", phone: "41988880000", stage: "Call agendada", closer: "pl", callAt: "2026-08-20T14:00", createdAt: ISO("2026-08-19T10:00:00Z") }] });
  const wa = makeWa();
  await runner(repo, wa, NUDGE_NOW).tick();
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].text, /^Bom dia Rafael! Ficou hoje às 13h ou às 16h pra nossa conversa/);
});

test("cobrança não sai: lead respondeu depois da oferta, oferta é de hoje, ou ainda não deu a hora", async () => {
  // Respondeu: fica pro cérebro.
  const answered = await nudgeWorld({ extraMessages: [{ id: "i2", thread: "5541999990000", leadId: "L1", direction: "in", text: "vou ver", at: ISO("2026-08-19T20:10:00Z") }] });
  await answered.update("wa_threads", "5541999990000", { lastDir: "in", lastText: "vou ver", lastAt: ISO("2026-08-19T20:10:00Z") });
  const wa1 = makeWa();
  await runner(answered, wa1, NUDGE_NOW).tick();
  assert.equal(wa1.sent.length, 0);
  // Oferta feita hoje de manhã: espera amanhã.
  const today = await nudgeWorld({ lastAt: ISO("2026-08-20T11:30:00Z"), inAt: ISO("2026-08-20T11:20:00Z") });
  const wa2 = makeWa();
  await runner(today, wa2, NUDGE_NOW).tick();
  assert.equal(wa2.sent.length, 0);
  // 8h BRT: antes da janela das 9h.
  const early = await nudgeWorld();
  const wa3 = makeWa();
  await runner(early, wa3, { t: new Date("2026-08-20T11:00:00Z") }).tick();
  assert.equal(wa3.sent.length, 0);
});

test("janela de 24h fechada na hora da cobrança: sai o template de retomada, sem horário", async () => {
  const repo = await nudgeWorld({ inAt: ISO("2026-08-19T11:00:00Z"), lastAt: ISO("2026-08-19T11:05:00Z") });
  const wa = makeWa({ approved: ["sdr_retomada_conversa"] });
  await runner(repo, wa, NUDGE_NOW).tick();
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].kind, "template");
  assert.equal(wa.sent[0].name, "sdr_retomada_conversa");
  assert.equal((await repo.get("leads", "L1")).sdrLog.offerNudgeVia, "template");
});

// ── Raio-x 30/09: respostas ao lembrete, remarcação suspende, resgate, call vencida ─

test("classifyReminderReply: 'pode', 'vou', reação 👍 e 'estarei' confirmam; saudação, reação sem emoji e resposta automática não viram alerta", () => {
  for (const t of ["Pode", "pode sim", "vou", "vou entrar", "tá bom", "Tudo certo!", "estarei lá", "no aguardo", "a caminho", "[reaction] 👍", "[reaction] ❤️"]) {
    assert.equal(classifyReminderReply(t), "confirm", t);
  }
  assert.equal(classifyReminderReply("[reaction]"), "ack");
  assert.equal(classifyReminderReply("Bom dia"), "greeting");
  assert.equal(classifyReminderReply("Olá bom dia!"), "greeting");
  assert.equal(classifyReminderReply("BSB Ronda Oficina Especializada agradece seu contato. Como podemos ajudar?"), "auto");
  assert.equal(classifyReminderReply("não vou conseguir hoje"), "reschedule");
  assert.equal(classifyReminderReply("Bom dia, não vou conseguir"), "reschedule");
  assert.equal(classifyReminderReply("Computador"), "other");
});

test("resposta ao lembrete: saudação/ack/auto não abrem alerta nem calam o aviso de ligação; remarcação suspende os lembretes do horário", async () => {
  const mk = async () => world({
    leads: [{ id: "L1", name: "R", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-20T14:00", confirmLog: { at: "2026-08-20T14:00", manha: ISO("2026-08-20T11:30:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  const now = new Date("2026-08-20T12:00:00Z");
  const a = await mk();
  assert.equal(await handleSdrInbound(a, { message: { from: "5541999990000", text: "Bom dia" }, now }), "greeting");
  assert.equal(await handleSdrInbound(a, { message: { from: "5541999990000", text: "[reaction]" }, now }), "ack");
  assert.equal(await handleSdrInbound(a, { message: { from: "5541999990000", text: "Pontes Car Auto Peças agradece seu contato. Como podemos ajudar?" }, now }), "auto");
  assert.equal((await a.list("wa_alerts")).length, 0);
  assert.equal((await a.get("leads", "L1")).sdrLog?.confirmAlertFor, undefined, "aviso de ligação continua armado");
  assert.equal(await handleSdrInbound(a, { message: { from: "5541999990000", text: "[reaction] 👍" }, now }), "confirmed");
  assert.equal((await a.get("leads", "L1")).callConfirmed, true);

  const b = await mk();
  assert.equal(await handleSdrInbound(b, { message: { from: "5541999990000", text: "Oi pode mudar o horário? Amanhã à tarde consegue" }, now }), "alert");
  const lead = await b.get("leads", "L1");
  assert.ok(lead.confirmLog.rescheduleAskedAt);
  assert.match((await b.list("wa_alerts"))[0].text, /Quer remarcar a call/);
  // Com a remarcação pedida, o lembrete de 2h NÃO sai mais pra este horário.
  const wa = makeWa({ approved: ["sdr_lembrete_link2", "sdr_lembrete_conversa"] });
  await runner(b, wa, { t: new Date("2026-08-20T15:05:00Z") }).tick();
  assert.equal(wa.sent.length, 0);
});

test("resgate de no-show: lead atrasado 15 min não é furo; lead que avisou que não vinha nas 3h antes não leva 'não te encontrei'", async () => {
  const nowRef = { t: new Date("2026-08-19T13:15:00Z") }; // call às 10h BRT (13:00Z), 15 min depois
  const late = await world({
    leads: [{ id: "L1", name: "Patrick", phone: "41999990000", stage: "No show", stageSince: ISO("2026-08-19T13:05:00Z"), callAt: "2026-08-19T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
  });
  const wa1 = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(late, wa1, nowRef).tick();
  assert.equal(wa1.sent.length, 0, "20 min de graça");

  const warned = await world({
    leads: [{ id: "L1", name: "Valdir", phone: "41999990000", stage: "No show", stageSince: ISO("2026-08-19T13:30:00Z"), callAt: "2026-08-19T10:00", createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "i1", thread: "5541999990000", leadId: "L1", direction: "in", text: "Bom dia, podemos marcar outro dia?", at: ISO("2026-08-19T11:42:00Z") }],
  });
  const wa2 = makeWa({ approved: ["sdr_resgate_noshow"] });
  await runner(warned, wa2, { t: new Date("2026-08-19T13:40:00Z") }).tick();
  assert.equal(wa2.sent.length, 0);
  assert.equal((await warned.get("leads", "L1")).sdrLog.noshowVia, "skip:remarcacao");
});

test("call vencida presa em 'Call agendada' vira aviso pro closer, uma vez por dia; com gente na conversa depois, ou com resumo, cala", async () => {
  const nowRef = { t: new Date("2026-08-19T15:00:00Z") }; // 12h BRT; calls às 10h (2h atrás)
  const repo = await world({
    leads: [
      { id: "L1", name: "Domingos", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-19T10:00", closer: "pl", createdAt: ISO("2026-08-10T10:00:00Z") },
      { id: "L2", name: "Diego", phone: "41988880000", stage: "Call agendada", callAt: "2026-08-19T10:00", closer: "pl", callSummaryFor: "2026-08-19T10:00", createdAt: ISO("2026-08-10T10:00:00Z") },
      { id: "L3", name: "Beto", phone: "41977770000", stage: "Call agendada", callAt: "2026-08-19T10:00", closer: "pl", createdAt: ISO("2026-08-10T10:00:00Z") },
    ],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }, { id: "5541977770000", phone: "5541977770000", leadId: "L3", saas: "leverads" }],
    messages: [{ id: "o1", thread: "5541977770000", leadId: "L3", direction: "out", author: "pl", text: "Beto, estamos te aguardando", at: ISO("2026-08-19T13:05:00Z") }],
  });
  const wa = makeWa();
  const r = runner(repo, wa, nowRef);
  const stats = await r.tick();
  assert.equal(stats.overdue, 1);
  const notes = await repo.list("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user, "pl");
  assert.equal(notes[0].type, "call_overdue");
  assert.match(notes[0].text, /Call de Domingos \(hoje \(19\/08\) às 10h\) segue em "Call agendada" sem desfecho/);
  assert.deepEqual(notes[0].link, { screen: "whatsapp", thread: "5541999990000", lead: "L1" });
  assert.equal((await r.tick()).overdue, 0, "uma vez por dia");
  assert.equal((await repo.get("leads", "L1")).stage, "Call agendada", "o robô nunca move o card");
});

test("10min sem link com janela fechada não repete o template sem link que já saiu no 2h: fica o alerta", async () => {
  const nowRef = { t: new Date("2026-08-19T12:52:00Z") }; // 9h52 BRT, call 10h
  const repo = await world({
    leads: [{ id: "L1", name: "Karina", phone: "41999990000", stage: "Call agendada", callAt: "2026-08-19T10:00", callConfirmed: true, callSetAt: ISO("2026-08-17T12:00:00Z"), confirmLog: { at: "2026-08-19T10:00", manha: "skip", "2h": ISO("2026-08-19T11:00:00Z") }, createdAt: ISO("2026-08-10T10:00:00Z") }],
    threads: [{ id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads" }],
    messages: [{ id: "i1", thread: "5541999990000", leadId: "L1", direction: "in", text: "ok", at: ISO("2026-08-17T12:00:00Z") }],
  });
  const wa = makeWa({ approved: ["sdr_lembrete_conversa"] });
  await runner(repo, wa, nowRef).tick();
  assert.equal(wa.sent.length, 0);
  assert.equal((await repo.get("leads", "L1")).confirmLog["10min"], "sem-link");
  assert.match((await repo.list("wa_alerts"))[0].text, /sem link do Meet/);
});
