// Relógio do SDR proativo (sdr-agent-touch.js): QUANDO o agente externo toma a
// iniciativa, e o lembrete fixo que sai de cena sem deixar buraco. Mundo em
// memória, WhatsApp falso, relógio injetado. "Hoje" é quarta 02/12/2026; a
// sexta 25/12/2026 é Natal. Horas dos testes são de Brasília (UTC-3).
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeSdrRunner, handleSdrInbound, sdrBotConfig, touchOn, SDR_AUTHOR } from "../src/sdr/sdr-flow.js";
import { makeSdrAgent, imageOf } from "../src/sdr/sdr-agent.js";
import { touchPlan, blockedReason, claimValue, ABSORBED, isBusinessDay, releaseAgentClaims } from "../src/sdr/sdr-agent-touch.js";
import { wallNow } from "../src/crm/agenda-slots.js";
import { bump, currentRev } from "../src/platform/changes.js";

const FUNNEL = [
  { stage: "Novo lead", kind: "novo" }, { stage: "Qualificando", kind: "qualificacao" }, { stage: "Call agendada", kind: "call" },
  { stage: "Follow-up", kind: "followup" }, { stage: "No show", kind: "contato" }, { stage: "Nutrição", kind: "contato" }, { stage: "Ganho", kind: "ganho" },
];
const T = (brt) => new Date(`${brt.length === 16 ? brt + ":00" : brt}-03:00`);   // "2026-12-02T08:00[:30]" (Brasília) → Date
const ISO = (brt) => T(brt).toISOString();
const LINK = "https://meet.google.com/abc-defg-hij";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
// spread do L1 (hash do id): 8h e 19h + 2 min; reativação 9h + 22 min

function makeWa({ approved = [] } = {}) {
  const sent = [];
  return {
    sent,
    configured: () => true,
    sendText: async (to, text) => { sent.push({ kind: "text", to, text }); return { messageId: "wm_t" + sent.length }; },
    sendTemplate: async (to, name, lang, components) => {
      const body = components.find((c) => c.type === "body");
      sent.push({ kind: "template", to, name, params: (body?.parameters || []).map((p) => p.text) });
      return { messageId: "wm_p" + sent.length };
    },
    uploadMedia: async () => "media_1",
    sendMedia: async (to, { kind, mediaId }) => { sent.push({ kind, to, mediaId }); return { messageId: "wm_m" + sent.length }; },
    listTemplates: async () => approved.map((n) => ({ name: n })),
    tokenWabaIds: async () => ["waba_test"],
  };
}

const IN = (at, text, extra = {}) => ({ direction: "in", text, at: ISO(at), ...extra });
const BOT = (at, text, extra = {}) => ({ direction: "out", author: SDR_AUTHOR, text, at: ISO(at), ...extra });

async function world({ lead = {}, msgs = [IN("2026-12-02T17:00", "Fechado, amanhã às 15h")], sdrBot = {}, approved = [] } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL,
    sdrBot: { enabled: true, enabledAt: "2026-08-01T00:00:00.000Z", agentSince: "2020-01-01T00:00:00.000Z", agentTouch: true, ...sdrBot } });
  for (const u of [{ id: "sdr", name: "Manuela", roles: ["sdr"] }, { id: "pl", name: "Jonathan", roles: ["closer"], compLevel: 2 }]) await repo.create("users", u);
  await repo.create("leads", { id: "L1", saas: "leverads", owner: "sdr", name: "Rafael", phone: "41999990000", createdAt: "2026-11-30T10:00:00.000Z",
    stage: "Call agendada", callAt: "2026-12-03T15:00", callSetAt: ISO("2026-12-02T17:01"), closer: "pl", callUrl: LINK, niche: "autopecas", ...lead });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" });
  for (const [i, m] of msgs.entries()) await repo.create("wa_messages", { id: "m" + (i + 1), thread: "5541999990000", leadId: "L1", saas: "leverads", ...m });
  const wa = makeWa({ approved });
  const clock = { t: T("2026-12-02T18:00") };
  const runner = makeSdrRunner({ repo, whatsapp: wa, log: { warn: () => {} }, now: () => clock.t });
  const agent = makeSdrAgent({ repo, whatsapp: wa, now: () => clock.t, wall: () => wallNow(clock.t), partDelayMs: 0, log: { warn: () => {} } });
  const at = async (brt) => { clock.t = T(brt); return runner.tick(); };
  const touches = async () => (await repo.list("sdr_touches")).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const pending = async () => (await touches()).find((r) => r.estado === "pedido");
  const say = async (brt, text) => repo.create("wa_messages", { id: "x" + Math.random(), thread: "5541999990000", leadId: "L1", saas: "leverads", ...IN(brt, text) });
  return { repo, wa, clock, runner, agent, at, touches, pending, say, lead: () => repo.get("leads", "L1"), texts: () => wa.sent.map((s) => s.text || s.name || s.kind) };
}

// ── o plano (função pura) ─────────────────────────────────────────────────

const product = { id: "leverads", funnel: FUNNEL };
const plan = (lead, nowBrt, recs = []) => touchPlan({ lead: { id: "L1", stage: "Call agendada", callUrl: LINK, callSetAt: ISO("2026-12-01T10:00"), ...lead }, product, recs, nowMs: T(nowBrt).getTime() })
  .map((t) => ({ tipo: t.tipo, at: wallNow(new Date(t.atMs)).toISOString().slice(0, 16), covers: t.covers.join(",") }));

test("plano: reunião às 15h confirma às 8h, segunda mensagem às 10h, link às 14h49; o case só depois de confirmar", () => {
  assert.deepEqual(plan({ callAt: "2026-12-03T15:00" }, "2026-12-02T18:00"), [
    { tipo: "confirmacao_dia", at: "2026-12-03T08:02", covers: "manha" },
    { tipo: "link_sala", at: "2026-12-03T14:49", covers: "10min" },
  ]);
  // a confirmação saiu e ninguém respondeu: entra a segunda, às 10h
  const sent = [{ tipo: "confirmacao_dia", anchor: "2026-12-03T15:00", estado: "enviado", enviadoEm: ISO("2026-12-03T08:02") }];
  assert.deepEqual(plan({ callAt: "2026-12-03T15:00" }, "2026-12-03T08:30", sent).map((t) => [t.tipo, t.at]),
    [["segunda_confirmacao", "2026-12-03T10:00"], ["link_sala", "2026-12-03T14:49"]]);
  // confirmou às 8h10: case às 13h (2h antes), sem segunda
  const conf = { callConfirmed: true, confirmLog: { at: "2026-12-03T15:00", manha: ISO("2026-12-03T08:02"), confirmed: ISO("2026-12-03T08:10") } };
  assert.deepEqual(plan({ callAt: "2026-12-03T15:00", ...conf }, "2026-12-03T08:11", sent).map((t) => [t.tipo, t.at]), [["case", "2026-12-03T13:00"], ["link_sala", "2026-12-03T14:49"]]);
});

test("plano: reunião às 10h em ponto não é cedo; a segunda é 1h antes (9h), nunca na hora da reunião", () => {
  const sent = [{ tipo: "confirmacao_dia", anchor: "2026-12-03T10:00", estado: "enviado", enviadoEm: ISO("2026-12-03T08:02") }];
  assert.deepEqual(plan({ callAt: "2026-12-03T10:00" }, "2026-12-02T18:00").map((t) => t.tipo), ["confirmacao_dia", "link_sala"]);
  assert.deepEqual(plan({ callAt: "2026-12-03T10:00" }, "2026-12-03T08:05", sent).map((t) => [t.tipo, t.at]), [["segunda_confirmacao", "2026-12-03T09:00"], ["link_sala", "2026-12-03T09:49"]]);
  // reunião de manhã, confirmou às 8h30: o case vai logo depois da confirmação
  const conf = { callConfirmed: true, confirmLog: { at: "2026-12-03T10:30", confirmed: ISO("2026-12-03T08:30") } };
  assert.deepEqual(plan({ callAt: "2026-12-03T10:30", ...conf }, "2026-12-03T08:31").find((t) => t.tipo === "case").at, "2026-12-03T08:31");
});

test("plano: reunião cedo (antes das 10h) confirma às 19h da véspera com o case e de novo 1h antes; às 8h a véspera é na noite anterior", () => {
  assert.deepEqual(plan({ callAt: "2026-12-03T09:30" }, "2026-12-02T10:00"), [
    { tipo: "confirmacao_vespera", at: "2026-12-02T19:02", covers: "" },
    { tipo: "confirmacao_dia", at: "2026-12-03T08:30", covers: "manha,2h" },
    { tipo: "link_sala", at: "2026-12-03T09:19", covers: "10min" },
  ]);
  assert.deepEqual(plan({ callAt: "2026-12-03T08:00" }, "2026-12-02T10:00").map((t) => [t.tipo, t.at]),
    [["confirmacao_vespera", "2026-12-02T19:02"], ["confirmacao_dia", "2026-12-03T07:00"], ["link_sala", "2026-12-03T07:49"]]);
  // virada de dia: reunião de segunda às 9h confirma no domingo às 19h (véspera de calendário)
  assert.equal(plan({ callAt: "2026-12-07T09:00" }, "2026-12-04T10:00")[0].at, "2026-12-06T19:02");
  // marcou depois das 18h30 da véspera: a marcação acabou de ser confirmada, sem véspera
  assert.deepEqual(plan({ callAt: "2026-12-03T09:00", callSetAt: ISO("2026-12-02T20:00") }, "2026-12-02T20:01").map((t) => t.tipo), ["confirmacao_dia", "link_sala"]);
});

test("plano: lembrete fixo que já saiu antes do proativo não ganha o toque por cima; reunião passada ou em etapa de closer não tem toque", () => {
  assert.deepEqual(plan({ callAt: "2026-12-03T15:00", confirmLog: { at: "2026-12-03T15:00", manha: ISO("2026-12-03T08:00") } }, "2026-12-03T08:05").map((t) => t.tipo), ["segunda_confirmacao", "link_sala"]);
  assert.deepEqual(plan({ callAt: "2026-12-02T15:00" }, "2026-12-02T16:00"), []);
  assert.deepEqual(plan({ callAt: "2026-12-03T15:00", stage: "Follow-up" }, "2026-12-03T08:05"), []);
});

test("plano: reativação na manhã útil seguinte à oferta (9h22 do L1); fim de semana e feriado pulam; oferta de madrugada é na mesma manhã", () => {
  const offer = (at) => plan({ stage: "Qualificando", callAt: "", callUrl: "", sdrLog: { agentOfferAt: ISO(at) } }, at);
  assert.deepEqual(offer("2026-12-02T21:40"), [{ tipo: "reativacao_1", at: "2026-12-03T09:22", covers: "" }]);
  assert.equal(offer("2026-12-04T21:40")[0].at, "2026-12-07T09:22", "sexta à noite: segunda de manhã");
  assert.equal(offer("2026-12-24T20:00")[0].at, "2026-12-28T09:22", "véspera de Natal: pula o Natal e o fim de semana");
  assert.equal(offer("2026-12-03T01:10")[0].at, "2026-12-03T09:22", "oferta à 1h: a manhã seguinte é a mesma");
  assert.equal(offer("2026-12-03T05:00")[0].at, "2026-12-04T09:22", "a menos de 6h da manhã: fica pra outra");
  assert.equal(isBusinessDay("2026-12-25"), false);
  // a reativação 2 vem dois dias úteis depois da 1, só se a 1 saiu
  const r1 = [{ tipo: "reativacao_1", anchor: ISO("2026-12-02T21:40"), estado: "enviado", enviadoEm: ISO("2026-12-03T09:23") }];
  const both = plan({ stage: "Qualificando", callAt: "", callUrl: "", sdrLog: { agentOfferAt: ISO("2026-12-02T21:40") } }, "2026-12-04T10:00", r1);
  assert.deepEqual(both.map((t) => [t.tipo, t.at]), [["reativacao_2", "2026-12-07T09:22"]], "quinta + 2 = sábado: segunda (a 1 já tem linha e não volta)");
  // falta (no-show), demonstração marcada e lead fora da qualificação não são reativados
  for (const extra of [{ stage: "No show" }, { sdrLog: { agentOfferAt: ISO("2026-12-02T21:40"), noshowFor: "x" } }, { stage: "Follow-up" }]) {
    assert.deepEqual(plan({ stage: "Qualificando", callAt: "", callUrl: "", sdrLog: { agentOfferAt: ISO("2026-12-02T21:40") }, ...extra }, "2026-12-03T09:30"), []);
  }
});

test("cercas do pedido: janela de 24h, gente do time nas últimas 4h, parar robô, remarcada, conversa viva, adiou e desinteresse", () => {
  const cfg = sdrBotConfig({ sdrBot: { enabled: true, agentSince: "2020-01-01T00:00:00.000Z", agentTouch: true } });
  const lead = { id: "L1", stage: "Call agendada", callAt: "2026-12-03T15:00", createdAt: "2026-11-30T10:00:00.000Z" };
  const touch = { tipo: "confirmacao_dia", callAt: "2026-12-03T15:00", anchor: "2026-12-03T15:00" };
  const nowMs = T("2026-12-03T08:02").getTime();
  const why = (over = {}, msgs = [IN("2026-12-02T17:00", "ok")]) => blockedReason(over.touch || touch, { lead: { ...lead, ...over.lead }, product, cfg: over.cfg || cfg, msgs, humanIds: new Set(["sdr"]), nowMs });
  assert.equal(why(), "");
  assert.equal(why({}, [IN("2026-12-02T08:10", "ok")]), "janela_fechada", "a janela fecha antes de o agente escrever");
  const human = [IN("2026-12-02T17:00", "ok"), { direction: "out", author: "sdr", text: "Oi Rafa", at: ISO("2026-12-03T07:30") }];
  assert.equal(why({}, human), "humano_ativo", "gente do time falou há 32 min, em expediente");
  // fora do expediente (19h), com a regra de produção (humanMuteOffHours), a pausa de humano não vale
  const cfgOff = sdrBotConfig({ sdrBot: { enabled: true, agentSince: "2020-01-01T00:00:00.000Z", agentTouch: true, humanMuteOffHours: true } });
  const vesp = { tipo: "confirmacao_vespera", callAt: "2026-12-04T09:00", anchor: "2026-12-04T09:00" };
  const at19 = (c) => blockedReason(vesp, { lead: { ...lead, callAt: "2026-12-04T09:00" }, product, cfg: c, msgs: [IN("2026-12-03T10:00", "ok"), { direction: "out", author: "sdr", text: "Oi", at: ISO("2026-12-03T18:30") }], humanIds: new Set(["sdr"]), nowMs: T("2026-12-03T19:02").getTime() });
  assert.equal(at19(cfgOff), "");
  assert.equal(at19(cfg), "humano_ativo");
  assert.equal(why({ lead: { sdrOff: true } }), "parado");
  assert.equal(why({ lead: { whatsappOptOut: true } }), "fora", "pediu pra sair da base");
  assert.equal(why({ lead: { callAt: "2026-12-03T16:00" } }), "remarcada");
  assert.equal(why({ lead: { stage: "Follow-up" } }), "fora_da_etapa");
  assert.equal(why({ lead: { callConfirmed: true } }), "ja_confirmou");
  assert.equal(why({}, [IN("2026-12-03T07:50", "bom dia, a reunião segue?")]), "conversa_viva");
  assert.equal(why({ cfg: sdrBotConfig({ sdrBot: { enabled: true, agentSince: "2020-01-01T00:00:00.000Z" } }) }), "desligado", "chave desligada");
  const cfgLead = sdrBotConfig({ sdrBot: { enabled: true, agentSince: "2020-01-01T00:00:00.000Z", agentTouchLeads: ["L1"] } });
  assert.equal(why({ cfg: cfgLead }), "", "lista de leads de teste");
  assert.equal(touchOn(cfgLead, { id: "L2", createdAt: "2026-11-30T10:00:00.000Z" }), false);
  // reativação: só quem recebeu a oferta e sumiu
  const offerAt = ISO("2026-12-02T21:40");
  const react = { tipo: "reativacao_1", anchor: offerAt, callAt: "", offerMs: T("2026-12-02T21:40").getTime() };
  const rLead = { lead: { stage: "Qualificando", callAt: "", sdrLog: { agentOfferAt: offerAt } }, touch: react };
  const offerMsgs = (said) => [IN("2026-12-02T21:35", said), BOT("2026-12-02T21:40", "Tenho amanhã (03/12) às 10h ou às 15h, qual fica melhor pra você?")];
  assert.equal(why({ ...rLead }, offerMsgs("quero ver como funciona")), "");
  assert.equal(why({ ...rLead }, offerMsgs("vou ver com meu sócio e te falo")), "adiou");
  assert.equal(why({ ...rLead }, [...offerMsgs("quero ver"), IN("2026-12-03T09:21", "oi")]), "respondeu", "respondeu um minuto antes do toque");
  assert.equal(why({ ...rLead, lead: { ...rLead.lead, sdrLog: { agentOfferAt: offerAt, noInterestAt: ISO("2026-12-02T21:50") } } }, offerMsgs("quero ver")), "sem_interesse");
  assert.equal(why({ ...rLead, lead: { ...rLead.lead, sdrLog: { agentOfferAt: offerAt, callbackAt: ISO("2026-12-08T09:30") } } }, offerMsgs("quero ver")), "retorno_combinado");
});

// ── o motor inteiro, com o relógio andando ────────────────────────────────

test("chave desligada: tudo como antes (lembrete fixo às 8h, nenhum toque pedido, nenhuma reserva)", async () => {
  const w = await world({ sdrBot: { agentTouch: false } });
  await w.at("2026-12-03T07:58");
  await w.at("2026-12-03T08:01");
  assert.equal(w.wa.sent.length, 1);
  assert.match(w.wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 15h/);
  assert.deepEqual(await w.touches(), []);
  assert.match((await w.lead()).confirmLog.manha, /^2026-12-03T11:01/);
});

test("confirmação do dia escrita pelo agente: o fixo das 8h espera, o toque entregue carimba a manhã e o fixo nunca sai", async () => {
  const w = await world();
  await w.at("2026-12-03T07:58");
  assert.match((await w.lead()).confirmLog.manha, /^agente:ate:/, "o passo das 8h fica reservado antes da hora");
  await w.at("2026-12-03T08:00");
  await w.at("2026-12-03T08:01");
  assert.equal(w.wa.sent.length, 0, "às 8h o fixo não sai");
  await w.at("2026-12-03T08:02");
  const req = await w.pending();
  assert.deepEqual([req.tipo, req.callAt, req.thread], ["confirmacao_dia", "2026-12-03T15:00", "5541999990000"]);
  const r = await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, tudo bom?", "Nossa conversa segue de pé hoje às 15h?"] });
  assert.equal(r.status, 200);
  assert.deepEqual(w.texts(), ["Bom dia Rafael, tudo bom?", "Nossa conversa segue de pé hoje às 15h?"]);
  const lead = await w.lead();
  assert.match(lead.confirmLog.manha, /^2026-12-03T11:02/, "manhã carimbada com a hora do toque");
  const out = (await w.repo.list("wa_messages")).filter((m) => m.direction === "out");
  assert.deepEqual(out.map((m) => [m.author, m.via]), [[SDR_AUTHOR, "toque"], [SDR_AUTHOR, "toque"]]);
  for (const t of ["2026-12-03T08:30", "2026-12-03T09:00", "2026-12-03T09:30"]) await w.at(t);
  assert.equal(w.wa.sent.length, 2, "nenhum lembrete fixo depois do toque");
  assert.equal((await w.touches())[0].estado, "enviado");
  // a resposta "sim" à confirmação do agente confirma a reunião no card (a lista do grupo lê) e o link fixo (2c) não sai
  await w.say("2026-12-03T09:40", "Sim, confirmado");
  assert.equal(await handleSdrInbound(w.repo, { message: { from: "5541999990000", text: "Sim, confirmado" }, now: T("2026-12-03T09:40") }), "confirmed");
  await w.at("2026-12-03T09:41");
  assert.equal((await w.lead()).callConfirmed, true);
  assert.equal(w.wa.sent.length, 2, "o 'Perfeito, o link é este' fixo não sai pra lead do proativo");
  assert.equal((await w.agent.send("L1", { parts: ["Perfeito Rafael, combinado então"], replyTo: (await w.repo.list("wa_messages")).filter((m) => m.direction === "in").pop().id })).status, 200, "o agente responde à positiva");
});

test("agente não entregou no prazo (fora do ar): o lembrete fixo sai no lugar, uma vez só", async () => {
  const w = await world();
  for (const t of ["2026-12-03T07:58", "2026-12-03T08:02", "2026-12-03T08:15", "2026-12-03T08:21"]) await w.at(t);
  assert.equal(w.wa.sent.length, 0, "dentro do prazo do agente (20 min) nada sai");
  await w.at("2026-12-03T08:23");
  assert.equal((await w.touches())[0].estado, "expirado");
  assert.equal(w.wa.sent.length, 1);
  assert.match(w.wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 15h/, "o fixo de sempre");
  await w.at("2026-12-03T08:24");
  await w.at("2026-12-03T09:00");
  assert.equal(w.wa.sent.length, 1, "sem repetição");
  const late = await w.agent.touch("L1", { key: "confirmacao_dia:2026-12-03T15:00", parts: ["Bom dia Rafael"] });
  assert.deepEqual([late.status, late.body.error], [409, "touch_closed"], "entrega atrasada do agente não sai por cima do fixo");
});

test("janela de 24h fechada: o toque nem é pedido e o fixo (template) sai às 8h como sempre", async () => {
  const w = await world({ msgs: [IN("2026-12-01T17:00", "Fechado, quinta às 15h")], approved: ["sdr_lembrete_link2"] });
  await w.at("2026-12-03T07:58");
  assert.equal((await w.lead()).confirmLog, undefined, "nada reservado: o agente não poderia escrever");
  await w.at("2026-12-03T08:01");
  assert.deepEqual(w.wa.sent.map((s) => [s.kind, s.name]), [["template", "sdr_lembrete_link2"]]);
  await w.at("2026-12-03T08:03");
  assert.deepEqual(await w.touches(), [], "o fixo já saiu: o toque desse passo nem entra no plano");
  assert.equal(w.wa.sent.length, 1);
});

test("relógio que reinicia não dispara em dobro: motor novo, mesmo minuto, o pedido é um só", async () => {
  const w = await world();
  await w.at("2026-12-03T08:02");
  const again = makeSdrRunner({ repo: w.repo, whatsapp: w.wa, log: { warn: () => {} }, now: () => w.clock.t });
  await again.tick();
  await w.at("2026-12-03T08:03");
  assert.equal((await w.touches()).length, 1);
  const req = await w.pending();
  assert.equal((await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, segue de pé hoje às 15h?"] })).status, 200);
  assert.equal((await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, segue de pé hoje às 15h?"] })).body.error, "touch_closed", "a mesma entrega duas vezes não sai duas vezes");
  await again.tick();
  assert.equal(w.wa.sent.length, 1);
});

test("lead escreveu no meio (depois do pedido, antes da entrega): o toque é absorvido pela conversa e o fixo não sai", async () => {
  const w = await world();
  await w.at("2026-12-03T07:58");
  await w.at("2026-12-03T08:02");
  const req = await w.pending();
  await w.say("2026-12-03T08:02:30", "bom dia! a reunião continua hoje?");
  w.clock.t = T("2026-12-03T08:03");
  const r = await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, segue de pé hoje às 15h?"] });
  assert.deepEqual([r.status, r.body.error], [409, "superseded"]);
  assert.equal((await w.touches())[0].estado, "absorvido");
  assert.equal((await w.lead()).confirmLog.manha, ABSORBED);
  for (const t of ["2026-12-03T08:30", "2026-12-03T09:30"]) await w.at(t);
  assert.equal(w.wa.sent.length, 0, "nem o toque nem o fixo: quem responde é o atendimento do lead");
});

test("conversa viva na hora do toque: espera assentar e sai depois, dentro da janela da confirmação", async () => {
  const w = await world({ msgs: [IN("2026-12-02T17:00", "Fechado"), IN("2026-12-03T07:50", "bom dia, vocês integram com Bling?"), BOT("2026-12-03T07:51", "Ela trabalha ao lado do Bling")] });
  await w.at("2026-12-03T08:02");
  assert.equal(await w.pending(), undefined, "lead falou há 12 min: espera");
  await w.at("2026-12-03T08:15");
  assert.equal(await w.pending(), undefined);
  await w.at("2026-12-03T08:21");
  assert.equal((await w.pending()).tipo, "confirmacao_dia", "30 min sem o lead falar: sai");
});

test("parar robô, gente do time nas últimas 4h e lead que saiu da base: o agente não toca; o fixo segue a regra dele", async () => {
  const parado = await world({ lead: { sdrOff: true } });
  await parado.at("2026-12-03T08:02");
  await parado.at("2026-12-03T08:03");
  assert.equal(parado.wa.sent.length + (await parado.touches()).length, 0, "parado pelo time: ninguém fala");
  const gente = await world({ sdrBot: { humanMuteOffHours: false }, msgs: [IN("2026-12-02T17:00", "Fechado"), { direction: "out", author: "pl", text: "Oi Rafael, aqui é o Jonathan", at: ISO("2026-12-03T06:30") }] });
  await gente.at("2026-12-03T07:58");
  await gente.at("2026-12-03T08:00");
  assert.equal(gente.wa.sent.length, 0, "a reserva segura o fixo até a hora do toque");
  await gente.at("2026-12-03T08:02");
  assert.equal(gente.wa.sent.length, 1, "gente falou nas últimas 4h: o agente não toca e devolve o passo; o fixo sai (a regra dele cala gente só na última hora)");
  await gente.at("2026-12-03T08:03");
  assert.deepEqual(await gente.touches(), []);
  assert.equal(gente.wa.sent.length, 1);
  const base = await world({ lead: { whatsappOptOut: true } });
  for (const t of ["2026-12-03T08:02", "2026-12-03T08:30"]) await base.at(t);
  assert.equal(base.wa.sent.length + (await base.touches()).length, 0);
});

test("remarcada depois da confirmação: o pedido velho fecha, a reserva volta, e o plano segue o horário novo", async () => {
  const w = await world();
  await w.at("2026-12-03T07:58");
  await w.at("2026-12-03T08:02");
  const req = await w.pending();
  await w.repo.update("leads", "L1", { callAt: "2026-12-04T11:00", callSetAt: ISO("2026-12-03T08:02"), confirmLog: { at: "2026-12-04T11:00" } });
  await w.say("2026-12-03T09:00", "pode ser sexta às 11h");
  assert.deepEqual((await w.agent.touch("L1", { key: req.key, parts: ["Bom dia"] })).body.error, "call_changed");
  await w.at("2026-12-03T08:04");
  assert.deepEqual((await w.touches()).map((r) => [r.key, r.estado]), [["confirmacao_dia:2026-12-03T15:00", "pulado"]]);
  await w.at("2026-12-04T07:58");
  await w.at("2026-12-04T08:02");
  assert.equal((await w.pending()).key, "confirmacao_dia:2026-12-04T11:00");
  // desmarcada: nada mais sai pra essa reunião
  await w.repo.update("leads", "L1", { callAt: "", stage: "Qualificando" });
  await w.at("2026-12-04T08:03");
  assert.equal(await w.pending(), undefined);
  assert.equal(w.wa.sent.length, 0);
});

test("reunião às 11h: o fixo de 2h (9h) fica reservado pra segunda mensagem do agente (10h); sem entrega, sai às 10h20", async () => {
  const w = await world({ lead: { callAt: "2026-12-03T11:00" } });
  await w.at("2026-12-03T07:58");
  await w.at("2026-12-03T08:02");
  assert.equal((await w.agent.touch("L1", { key: (await w.pending()).key, parts: ["Bom dia Rafael, segue de pé hoje às 11h?"] })).status, 200);
  await w.at("2026-12-03T08:58");
  assert.match((await w.lead()).confirmLog["2h"], /^agente:ate:/);
  await w.at("2026-12-03T09:00");
  await w.at("2026-12-03T09:30");
  assert.equal(w.wa.sent.length, 1, "o fixo de 2h não sai às 9h");
  await w.at("2026-12-03T10:00");
  assert.equal((await w.pending()).tipo, "segunda_confirmacao");
  await w.at("2026-12-03T10:21");
  assert.equal(w.wa.sent.length, 2, "agente não entregou: o fixo de 2h sai como fallback");
  assert.match(w.wa.sent[1].text, /^Rafael, nossa conversa é hoje às 11h/);
});

test("segunda mensagem só pra quem não respondeu: quem respondeu à confirmação (mesmo sem confirmar) não recebe", async () => {
  const w = await world();
  await w.at("2026-12-03T08:02");
  await w.agent.touch("L1", { key: (await w.pending()).key, parts: ["Bom dia Rafael, segue de pé hoje às 15h?"] });
  await w.say("2026-12-03T08:40", "acho que sim, te confirmo mais tarde");
  await w.at("2026-12-03T10:00");
  await w.at("2026-12-03T10:05");
  assert.deepEqual((await w.touches()).map((r) => [r.tipo, r.estado, r.motivo || ""]), [["confirmacao_dia", "enviado", ""], ["segunda_confirmacao", "pulado", "respondeu"]]);
});

test("case 2h antes só pra quem confirmou, com print; o agente não manda imagem que não seja PNG ou JPEG", async () => {
  const w = await world();
  await w.at("2026-12-03T08:02");
  await w.agent.touch("L1", { key: (await w.pending()).key, parts: ["Bom dia Rafael, segue de pé hoje às 15h?"] });
  await w.say("2026-12-03T08:20", "sim");
  await handleSdrInbound(w.repo, { message: { from: "5541999990000", text: "sim" }, now: T("2026-12-03T08:20") });
  await w.at("2026-12-03T12:59");
  assert.equal(await w.pending(), undefined);
  await w.at("2026-12-03T13:00");
  const req = await w.pending();
  assert.deepEqual([req.tipo, req.comCase], ["case", true]);
  assert.deepEqual((await w.agent.touch("L1", { key: req.key, parts: ["Tava vendo aqui"], image: { b64: Buffer.from("%PDF-1.4").toString("base64") }, case: "K-0012" })).body.error, "image: PNG ou JPEG de até 4 MB, em base64");
  const ok = await w.agent.touch("L1", { key: req.key, parts: ["Rafael, tava vendo aqui um resultado do seu nicho", "Uma loja de autopeças com uns 6 mil anúncios saiu de R$ 12 mil para R$ 31 mil de lucro por mês"], image: { b64: PNG_B64 }, case: "K-0012" });
  assert.equal(ok.status, 200);
  assert.deepEqual(w.wa.sent.slice(-3).map((s) => s.kind), ["text", "image", "text"], "o print vai logo depois do primeiro balão");
  // na reativação o primeiro balão é a pergunta: o print entra depois do balão que o anuncia
  await w.repo.update("sdr_touches", req.id, { estado: "pedido" });
  await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, conseguiu ver minha mensagem?", "Tava vendo aqui um resultado de uma loja do seu nicho", "Uma loja saiu de R$ 12 mil para R$ 31 mil de lucro por mês"], image: { b64: PNG_B64 }, case: "K-0012", imageAfter: 1 });
  assert.deepEqual(w.wa.sent.slice(-4).map((s) => s.kind), ["text", "text", "image", "text"]);
  const rec = (await w.touches()).find((r) => r.tipo === "case");
  assert.deepEqual([rec.estado, rec.case, rec.comPrint], ["enviado", "K-0012", true]);
  assert.equal(imageOf(PNG_B64).mime, "image/png");
  assert.equal(imageOf("bm90IGFuIGltYWdl"), null);
});

test("link da sala 10 min antes pelo agente; lead que escreve na hora do link não fica sem: o fixo manda", async () => {
  const w = await world({ lead: { callConfirmed: true, confirmLog: { at: "2026-12-03T15:00", manha: ISO("2026-12-03T08:02"), confirmed: ISO("2026-12-03T08:20") } },
    msgs: [IN("2026-12-03T08:20", "sim")] });
  w.repo.create("sdr_touches", { id: "L1:case:2026-12-03T15:00", leadId: "L1", saas: "leverads", key: "case:2026-12-03T15:00", tipo: "case", anchor: "2026-12-03T15:00", callAt: "2026-12-03T15:00", estado: "enviado", case: "K-0001", criadoEm: ISO("2026-12-03T13:00"), atualizadoEm: ISO("2026-12-03T13:00") });
  await w.at("2026-12-03T14:47");
  await w.at("2026-12-03T14:49");
  const req = await w.pending();
  assert.equal(req.tipo, "link_sala");
  await w.say("2026-12-03T14:49:30", "vou entrar pelo celular");
  w.clock.t = T("2026-12-03T14:50");
  assert.equal((await w.agent.touch("L1", { key: req.key, parts: ["Rafael, o link pra entrar é este: " + LINK] })).body.error, "superseded");
  await w.at("2026-12-03T14:51");
  assert.equal(w.wa.sent.length, 1, "o fixo de 10 min sai no lugar");
  assert.match(w.wa.sent[0].text, /começa em 10 minutos! Link pra entrar: https:\/\/meet\.google\.com\/abc-defg-hij/);
});

test("silêncio do agente na confirmação devolve o passo ao fixo; no case não sai nada", async () => {
  const w = await world();
  await w.at("2026-12-03T08:02");
  const r = await w.agent.touch("L1", { key: (await w.pending()).key, silencio: "achei que não precisava" });
  assert.deepEqual([r.status, r.body.fallback], [200, true]);
  await w.at("2026-12-03T08:03");
  assert.equal(w.wa.sent.length, 1, "o lead não fica sem a confirmação");
});

test("reunião cedo (9h): véspera às 19h com case, confirmação de novo às 8h; os fixos de 2h (7h) e da manhã ficam com o agente", async () => {
  const w = await world({ lead: { callAt: "2026-12-03T09:00", callSetAt: ISO("2026-12-02T10:00") }, msgs: [IN("2026-12-02T10:00", "pode ser amanhã às 9h")] });
  await w.at("2026-12-02T19:02");
  const v = await w.pending();
  assert.deepEqual([v.tipo, v.comCase], ["confirmacao_vespera", true]);
  assert.equal((await w.agent.touch("L1", { key: v.key, parts: ["Boa noite Rafael, tudo bem?", "Amanhã às 9h segue de pé?"], image: { b64: PNG_B64 }, case: "K-0003" })).status, 200);
  await w.say("2026-12-02T19:30", "sim, amanhã estarei lá");
  assert.equal(await handleSdrInbound(w.repo, { message: { from: "5541999990000", text: "sim, amanhã estarei lá" }, now: T("2026-12-02T19:30") }), null, "véspera não confirma o dia");
  for (const t of ["2026-12-03T06:58", "2026-12-03T07:00", "2026-12-03T07:30", "2026-12-03T07:58"]) await w.at(t);
  assert.equal(w.wa.sent.length, 3, "nada sai às 7h nem às 8h pelo fixo");
  await w.at("2026-12-03T08:00");
  const d = await w.pending();
  assert.equal(d.tipo, "confirmacao_dia");
  await w.agent.touch("L1", { key: d.key, parts: ["Bom dia Rafael, tudo certo pra daqui a pouco às 9h?"] });
  const log = (await w.lead()).confirmLog;
  assert.ok(/^2026-12-03T11:00/.test(log.manha) && /^2026-12-03T11:00/.test(log["2h"]), "manhã e 2h carimbados pelo toque do dia");
  await w.at("2026-12-03T08:30");
  assert.equal(w.wa.sent.length, 4);
  assert.equal((await w.touches()).filter((r) => r.tipo === "case").length, 0, "o case já foi na véspera: não sai de novo");
});

test("reativação: oferta às 21h40 sem resposta → manhã seguinte com case; dois dias úteis depois o template de encerramento; 48h depois Nutrição", async () => {
  const offerAt = ISO("2026-12-02T21:40");
  const w = await world({ approved: ["sdr_encerramento_atendimento", "sdr_retomada_conversa"], sdrBot: { ladder: true, offerNudge: true, conversation: true },
    lead: { stage: "Qualificando", callAt: "", callUrl: "", closer: "", sdrLog: { agentOfferAt: offerAt, firstTouchAt: ISO("2026-12-02T21:36"), firstTouchVia: "agent" } },
    msgs: [IN("2026-12-02T21:35", "Oi, quero saber mais sobre o Lever OEM. Minha operação: autopeças, 1 conta"), BOT("2026-12-02T21:40", "Tenho amanhã (03/12) às 10h ou às 15h, qual fica melhor pra você?")] });
  await w.at("2026-12-03T09:21");
  assert.equal(await w.pending(), undefined);
  await w.at("2026-12-03T09:22");
  const r1 = await w.pending();
  assert.deepEqual([r1.tipo, r1.comCase], ["reativacao_1", true]);
  await w.at("2026-12-03T09:40");
  assert.equal(w.wa.sent.length, 0, "a cobrança fixa da oferta (9h-9h40) não sai por cima");
  assert.equal((await w.agent.touch("L1", { key: r1.key, parts: ["Bom dia Rafael, conseguiu ver minha mensagem?"], image: { b64: PNG_B64 }, case: "K-0012" })).status, 200);
  for (const t of ["2026-12-03T10:00", "2026-12-03T15:00", "2026-12-04T09:30", "2026-12-04T11:00"]) await w.at(t);
  assert.equal(w.wa.sent.length, 2, "2º toque, escada e cobrança calados durante a reativação");
  await w.at("2026-12-07T09:22");
  assert.deepEqual(w.wa.sent.slice(-1).map((s) => [s.kind, s.name, s.params[0]]), [["template", "sdr_encerramento_atendimento", "Rafael"]], "quinta + 2 dias = sábado: segunda de manhã, por template");
  assert.equal((await w.touches()).find((r) => r.tipo === "reativacao_2").estado, "enviado");
  await w.at("2026-12-09T09:21");
  assert.equal((await w.lead()).stage, "Qualificando");
  await w.at("2026-12-09T09:23");
  assert.equal((await w.lead()).stage, "Nutrição", "48h depois do encerramento sem resposta");
  await w.at("2026-12-10T10:00");
  assert.equal(w.wa.sent.length, 3, "nada mais sai");
});

test("reativação: quem responde antes do toque, ou depois do pedido, não recebe; o atendimento dele cuida", async () => {
  const offerAt = ISO("2026-12-02T21:40");
  const base = { lead: { stage: "Qualificando", callAt: "", callUrl: "", sdrLog: { agentOfferAt: offerAt } },
    msgs: [IN("2026-12-02T21:35", "quero conhecer"), BOT("2026-12-02T21:40", "Tenho amanhã (03/12) às 10h ou às 15h, qual fica melhor pra você?")] };
  const antes = await world(base);
  await antes.say("2026-12-03T09:21", "pode ser às 15h");
  await antes.at("2026-12-03T09:22");
  assert.deepEqual((await antes.touches()).map((r) => [r.estado, r.motivo]), [["pulado", "respondeu"]]);
  const depois = await world(base);
  await depois.at("2026-12-03T09:22");
  const req = await depois.pending();
  await depois.say("2026-12-03T09:22:30", "oi, vi sim");
  depois.clock.t = T("2026-12-03T09:23");
  assert.equal((await depois.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael"] })).body.error, "superseded");
  assert.equal((await depois.touches())[0].estado, "absorvido");
  assert.equal(depois.wa.sent.length + antes.wa.sent.length, 0);
});

test("dois toques caindo juntos: um por vez por lead; o segundo espera o primeiro fechar", async () => {
  // confirmou às 7h59 numa reunião às 10h: o case (logo depois da confirmação) e a confirmação do dia não saem juntos
  const w = await world({ lead: { callAt: "2026-12-03T10:00", callConfirmed: true, confirmLog: { at: "2026-12-03T10:00", confirmed: ISO("2026-12-03T07:59") } },
    msgs: [IN("2026-12-03T07:59", "confirmado pra hoje")] });
  await w.at("2026-12-03T08:00");
  assert.deepEqual((await w.touches()).map((r) => [r.tipo, r.estado]), [["case", "pedido"]], "quem confirmou não recebe a confirmação, recebe o case");
  await w.at("2026-12-03T09:49");
  assert.deepEqual((await w.touches()).map((r) => [r.tipo, r.estado]), [["case", "expirado"], ["link_sala", "pedido"]]);
});

test("reserva vencida ou de lead que saiu do proativo volta pro fluxo com o horário empurrado", () => {
  const log0 = { at: "x", manha: claimValue(T("2026-12-03T08:22").getTime()), "2h": ABSORBED };
  assert.equal(releaseAgentClaims(log0, { on: true, nowMs: T("2026-12-03T08:10").getTime() }), false);
  assert.equal(releaseAgentClaims(log0, { on: true, nowMs: T("2026-12-03T08:23").getTime() }), true);
  assert.deepEqual([log0.manha, log0["2h"], log0.agenteLiberou.manha], [undefined, ABSORBED, ISO("2026-12-03T08:22")]);
  assert.equal(releaseAgentClaims(log0, { on: false, nowMs: T("2026-12-03T08:30").getTime() }), true, "chave desligada: o passo absorvido volta pro fixo");
  assert.equal(log0["2h"], undefined);
});

test("a oferta só vira âncora nova de reativação depois de o lead falar: reoferta dentro do toque não encadeia reativações", async () => {
  const w = await world({ lead: { stage: "Qualificando", callAt: "", callUrl: "", closer: "" }, msgs: [IN("2026-12-02T21:35", "quero conhecer")] });
  w.clock.t = T("2026-12-02T21:40");
  const day = "2026-12-03";
  assert.equal((await w.agent.hold("L1", { slots: [`${day}T10:00`, `${day}T15:00`] })).status, 200);
  const first = (await w.lead()).sdrLog.agentOfferAt;
  assert.equal(first, ISO("2026-12-02T21:40"));
  w.clock.t = T("2026-12-03T09:23");
  await w.agent.hold("L1", { slots: [`${day}T15:00`, `${day}T17:00`] });
  assert.equal((await w.lead()).sdrLog.agentOfferAt, first, "o lead não falou: a âncora fica");
  assert.deepEqual((await w.lead()).sdrLog.agentOfferSlots, [`${day}T15:00`, `${day}T17:00`]);
  await w.say("2026-12-03T09:30", "pode ser as 17h? ah não, deixa eu ver");
  w.clock.t = T("2026-12-03T09:31");
  await w.agent.hold("L1", { slots: [`${day}T17:00`] });
  assert.equal((await w.lead()).sdrLog.agentOfferAt, ISO("2026-12-03T09:31"), "falou: oferta nova, âncora nova");
});

// ── laudo do revisor (27/11/2026): o que quebrava para um lead de verdade ──

test("reunião às 10h em ponto: o fixo de 2h (que cairia às 8h) não sai junto com a confirmação do agente; a segunda mensagem segue às 9h", async () => {
  const w = await world({ lead: { callAt: "2026-12-03T10:00" } });
  for (const t of ["2026-12-03T07:58", "2026-12-03T08:00", "2026-12-03T08:01", "2026-12-03T08:02"]) await w.at(t);
  assert.equal(w.wa.sent.length, 0, "às 8h o fixo de 2h não sai: a manhã está com o agente");
  assert.equal((await w.lead()).confirmLog["2h"], "manha", "o de 2h fica junto com a manhã, como no fluxo fixo");
  w.clock.t = T("2026-12-03T08:03");
  assert.equal((await w.agent.touch("L1", { key: (await w.pending()).key, parts: ["Bom dia Rafael, tudo bom?", "Nossa conversa de hoje às 10h segue de pé?"] })).status, 200);
  for (const t of ["2026-12-03T08:04", "2026-12-03T08:31"]) await w.at(t);
  assert.deepEqual(w.texts(), ["Bom dia Rafael, tudo bom?", "Nossa conversa de hoje às 10h segue de pé?"], "uma confirmação só");
  await w.at("2026-12-03T09:00");
  assert.equal((await w.pending()).tipo, "segunda_confirmacao", "sem resposta: a segunda mensagem do agente às 9h");
  // agente fora do ar: o lead recebe o fixo da manhã no fim do prazo, e só ele
  const fora = await world({ lead: { callAt: "2026-12-03T10:00" } });
  for (const t of ["2026-12-03T07:58", "2026-12-03T08:00", "2026-12-03T08:02", "2026-12-03T08:23", "2026-12-03T08:40"]) await fora.at(t);
  assert.equal(fora.wa.sent.length, 1);
  assert.match(fora.wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 10h/);
});

test("lead que já faltou uma vez e recebeu horários do agente não ganha reativação, e por isso o motor não cala a retomada fixa dele", async () => {
  const offerAt = ISO("2026-12-02T21:40");
  const again = (sdrLog) => world({ approved: ["sdr_retomada_conversa", "sdr_encerramento_atendimento"], sdrBot: { ladder: true, conversation: true },
    lead: { stage: "Qualificando", callAt: "", callUrl: "", closer: "", sdrLog: { agentOfferAt: offerAt, firstTouchAt: ISO("2026-11-10T10:00"), firstTouchVia: "template", ...sdrLog } },
    msgs: [IN("2026-12-02T21:35", "oi, quero remarcar aquela demonstração"), BOT("2026-12-02T21:40", "Tenho amanhã (03/12) às 10h ou às 15h, qual fica melhor pra você?")] });
  const faltou = await again({ noshowFor: "2026-11-20T15:00" });
  for (const t of ["2026-12-03T09:25", "2026-12-04T10:00", "2026-12-07T10:00", "2026-12-08T10:00"]) await faltou.at(t);
  assert.deepEqual(await faltou.touches(), [], "não vale depois de falta (decisão 31)");
  assert.deepEqual(faltou.wa.sent.map((s) => s.name), ["sdr_retomada_conversa"], "a escada do motor segue cuidando dele");
  // o mesmo lead sem a falta: a reativação está na vez, e enquanto ela corre a escada espera
  const normal = await again({});
  await normal.at("2026-12-03T09:22");
  assert.equal((await normal.pending()).tipo, "reativacao_1");
  assert.equal((await normal.agent.touch("L1", { key: (await normal.pending()).key, parts: ["Bom dia Rafael, conseguiu ver minha mensagem?"] })).status, 200);
  for (const t of ["2026-12-04T10:00", "2026-12-05T10:00"]) await normal.at(t);
  assert.equal(normal.wa.sent.filter((s) => s.kind === "template").length, 0);
});

test("chave ligada depois de a cobrança fixa da oferta já ter saído: a reativação do agente não sai por cima", async () => {
  const offer = "Tenho amanhã às 10h ou às 15h, qual fica melhor pra você?";
  const w = await world({ sdrBot: { agentTouch: false, offerNudge: true, conversation: true },
    lead: { stage: "Qualificando", callAt: "", callUrl: "", closer: "", sdrLog: { agentOfferAt: ISO("2026-12-02T21:40"), firstTouchAt: ISO("2026-12-02T21:36"), firstTouchVia: "agent" } },
    msgs: [IN("2026-12-02T21:35", "Oi, quero saber mais"), BOT("2026-12-02T21:40", offer)] });
  await w.repo.update("wa_threads", "5541999990000", { lastDir: "out", lastOutAuthor: SDR_AUTHOR, lastText: offer, lastAt: ISO("2026-12-02T21:40") });
  await w.at("2026-12-03T09:45");
  assert.equal(w.wa.sent.length, 1);
  assert.match(w.wa.sent[0].text, /^Bom dia Rafael! Ainda consigo hoje às/, "com a chave desligada, a cobrança de sempre");
  const p = await w.repo.get("products", "leverads");
  await w.repo.update("products", "leverads", { sdrBot: { ...p.sdrBot, agentTouch: true } });
  await w.at("2026-12-03T10:00");
  assert.deepEqual((await w.touches()).map((r) => [r.tipo, r.estado, r.motivo]), [["reativacao_1", "pulado", "ja_cobrado"]]);
  assert.equal(w.wa.sent.length, 1);
});

test("entrega do agente no último minuto do prazo é recusada: o fixo que vai sair no fim do prazo não pode cruzar com ela", async () => {
  const w = await world();
  for (const t of ["2026-12-03T07:58", "2026-12-03T08:02"]) await w.at(t);
  const req = await w.pending();
  assert.equal(req.prazo, ISO("2026-12-03T08:22"));
  w.clock.t = T("2026-12-03T08:21:30");
  const late = await w.agent.touch("L1", { key: req.key, parts: ["Bom dia Rafael, tudo bom?", "Nossa conversa de hoje às 15h segue de pé?"] });
  assert.deepEqual([late.status, late.body.error], [409, "touch_expired"]);
  await w.at("2026-12-03T08:23");
  assert.equal(w.wa.sent.length, 1, "só o fixo");
  assert.match(w.wa.sent[0].text, /^Bom dia Rafael! Nossa conversa é hoje às 15h/);
});

test("a mesma entrega chegando duas vezes ao mesmo tempo sai uma vez só", async () => {
  const w = await world();
  await w.at("2026-12-03T08:02");
  const body = { key: (await w.pending()).key, parts: ["Bom dia Rafael, tudo bom?", "Nossa conversa de hoje às 15h segue de pé?"] };
  const got = await Promise.all([w.agent.touch("L1", body), w.agent.touch("L1", body)]);
  assert.deepEqual(got.map((r) => r.body.error || r.status).sort(), [200, "touch_in_progress"]);
  assert.deepEqual(w.texts(), body.parts);
});

test("passo só reservado pro agente não é pedido de confirmação: o 'ok' do lead antes de alguém perguntar não confirma a presença", async () => {
  const w = await world({ msgs: [IN("2026-12-02T17:00", "Fechado"), IN("2026-12-03T07:50", "bom dia, vocês integram com Bling?"), BOT("2026-12-03T07:51", "Ela trabalha ao lado do Bling")] });
  for (const t of ["2026-12-03T07:58", "2026-12-03T08:02"]) await w.at(t);
  assert.match((await w.lead()).confirmLog.manha, /^agente:ate:/, "conversa viva: o passo está reservado e ninguém perguntou ainda");
  await w.say("2026-12-03T08:05", "ok obrigado");
  assert.notEqual(await handleSdrInbound(w.repo, { message: { from: "5541999990000", text: "ok obrigado" }, now: T("2026-12-03T08:05") }), "confirmed");
  assert.ok(!(await w.lead()).callConfirmed, "a lista de confirmados do grupo não ganha quem não confirmou");
});

test("gravar um toque não recarrega a tela de quem está no cockpit (nenhuma tela lê sdr_touches)", () => {
  const before = currentRev();
  bump("sdr_touches");
  assert.equal(currentRev(), before);
});
