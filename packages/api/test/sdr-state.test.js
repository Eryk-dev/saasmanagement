// Tabela de estados: uma linha por estado da conversa, com os fatos que o
// cérebro usa. stateOf é puro: só lead.sdrLog + mensagens + relógio.

import test from "node:test";
import assert from "node:assert/strict";
import { stateOf, agendaMessagesOf, humanMuteHolds, HUMAN_MUTE_MS } from "../src/sdr/sdr-state.js";
import { sdrBotConfig } from "../src/sdr/sdr-flow.js";

const NOW = new Date("2026-08-19T13:00:00Z"); // quarta, 10h BRT
const ago = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();
const out = (text, min, extra = {}) => ({ id: `o${min}`, direction: "out", author: "sdr-bot", text, at: ago(min), ...extra });
const inn = (text, min, extra = {}) => ({ id: `i${min}`, direction: "in", text, at: ago(min), ...extra });
const FORM = "Oi, me chamo Rafael e quero saber mais sobre a LeverAds. Minha operação: autopeças";
const PITCH = "Oiii Rafael, tudo bem? A LeverAds faz clonagem de anúncios entre contas. Isso ajudaria na sua operação?";
const OFFER = "Consigo amanhã às 9h ou às 11h, qual fica melhor pra você?";
const HUMANS = new Set(["us_leo"]);
const st = (lead, msgs) => stateOf({ lead, msgs, now: NOW, product: null, humanIds: HUMANS });

const CASES = [
  ["novo: o lead escreveu antes de qualquer mensagem nossa", {}, [inn(FORM, 5)], "novo", { firstReply: true, engaged: false, demoOffered: false }],
  ["descoberta: pitch saiu, lead ainda não engajou", {}, [out(PITCH, 60), inn(FORM, 5)], "descoberta", { firstReply: false, demoOffered: true, engaged: false, canGreet: false }],
  ["engajado: lead respondeu positivo à descoberta", {}, [out(PITCH, 60), inn("Sim, ajudaria", 5)], "engajado", { engaged: true, slotsOffered: false }],
  ["oferta_feita: robô ofereceu o par e o lead ainda não escolheu", {}, [out(PITCH, 60), inn("Sim", 50), out(OFFER, 40), inn("quanto custa?", 5)], "oferta_feita", { slotsOffered: true, engaged: true, priceAsks: 1 }],
  ["oferta_feita: número solto depois da oferta engaja", {}, [out(OFFER, 40), inn("11", 5)], "oferta_feita", { engaged: true }],
  ["call_marcada: callAt no futuro", { callAt: "2026-08-20T10:00", sdrLog: { presenceAskedFor: "2026-08-20T10:00" } }, [out(OFFER, 40), inn("pode ser 9h", 30)], "call_marcada", { callFuture: true, inCallWindow: false, presenceAsked: true, presenceConfirmed: false }],
  ["janela_da_call: faltam 10 minutos", { callAt: "2026-08-19T10:10" }, [inn("entrei na sala", 1)], "janela_da_call", { inCallWindow: true }],
  ["janela_da_call: call começou há 20 minutos", { callAt: "2026-08-19T09:40" }, [inn("ninguém entrou", 1)], "janela_da_call", { inCallWindow: true }],
  ["pos_call: callAt passou há 2h e o card não andou", { callAt: "2026-08-19T08:00" }, [inn("oi", 1)], "pos_call", { callPassed: true, inCallWindow: false }],
  ["remarcacao_pendente: call cancelada, esperando o sim", { sdrLog: { reschedule: { status: "pending", at: ago(30), afterMessageId: "i35" } } }, [out(OFFER, 40), inn("não vou conseguir", 35), out("Já desmarquei aqui. Quer remarcar?", 30), inn("talvez", 5)], "remarcacao_pendente", { awaitingReschedule: true, slotsOffered: false }],
  ["remarcacao_oferecida: lead disse sim e recebeu a agenda", { sdrLog: { reschedule: { status: "offered", at: ago(30), afterMessageId: "i35" } } }, [out(OFFER, 40), inn("não vou conseguir", 35), out(OFFER, 20), inn("9h", 5)], "remarcacao_oferecida", { awaitingReschedule: false, slotsOffered: true }],
  ["handoff: robô chamou gente e ninguém falou ainda", { sdrLog: { handoffAt: ago(20) } }, [out(OFFER, 40), inn("quero falar com uma pessoa", 25), out("vou pedir pra alguém do time falar contigo", 20), inn("ok", 5)], "handoff", { handoffPending: true }],
  ["humano falou depois do handoff: sai do handoff e a conversa é dele", { sdrLog: { handoffAt: ago(20) } }, [out(OFFER, 40), inn("quero falar com uma pessoa", 25), out("fala comigo", 10, { author: "us_leo" }), inn("oi", 5)], "oferta_feita", { handoffPending: false, humanActive: true }],
  ["saudação liberada: a mensagem anterior tem 7h", {}, [out(PITCH, 7 * 60), inn("oi", 1)], "descoberta", { canGreet: true, gapMin: 420 }],
  ["teto: 15 mensagens do robô em 24h", {}, [...Array.from({ length: 15 }, (_, i) => out(`msg ${i}`, 600 - i)), inn("oi", 1)], "descoberta", { botToday: 15, capReached: true }],
  ["escada de preço: carimbos viram degrau", { sdrLog: { priceGuardAt: ago(60), priceExplainedAt: ago(30) } }, [inn("e o valor?", 1)], "novo", { priceStep: 2 }],
];

for (const [title, lead, msgs, state, facts] of CASES) {
  test(`estado: ${title} → ${state} #R-004 #R-011 #R-036 #R-039 #R-080 #R-082 #R-090`, () => {
    const r = st({ id: "L1", ...lead }, msgs);
    assert.equal(r.state, state);
    for (const [k, v] of Object.entries(facts)) assert.equal(r.facts[k], v, `fato ${k}`);
  });
}

test("estado: roteiro vem da dor de origem (OEM só em autopeças ou nicho vazio; PRICE em qualquer nicho) #R-013", () => {
  assert.equal(st({ sourcePain: "OEM", niche: "" }, []).script, "oem");
  assert.equal(st({ sourcePain: "OEM", niche: "moda" }, []).script, "clone");
  assert.equal(st({ sourcePain: "PRICE", niche: "moda" }, []).script, "price");
  assert.equal(st({ sourcePain: "A" }, []).script, "clone");
  assert.ok(st({ sourcePain: "OEM" }, []).scripted && !st({}, []).scripted);
});

test("estado: humano calado há mais de 4h deixa de valer como ativo #R-080", () => {
  const msgs = [out("fala comigo", HUMAN_MUTE_MS / 60_000 + 1, { author: "us_leo" }), inn("oi", 1)];
  assert.equal(st({}, msgs).facts.humanActive, false);
});

test("pausa de humano ativo: prazo configurável na aba Robô #R-080", () => {
  const human = { direction: "out", author: "us_leo", at: ago(90) }; // falou há 1h30
  const cfg = (sdrBot) => sdrBotConfig({ sdrBot: { enabled: true, ...sdrBot } });
  assert.equal(humanMuteHolds(cfg({}), human, NOW.getTime()), true); // padrão 4h
  assert.equal(humanMuteHolds(cfg({ humanMuteHours: 1 }), human, NOW.getTime()), false);
  assert.equal(humanMuteHolds(cfg({}), null, NOW.getTime()), false);
  // O fato do estado segue a mesma régua do produto.
  const product = { sdrBot: { humanMuteHours: 1 } };
  assert.equal(stateOf({ lead: {}, msgs: [{ id: "h", ...human, text: "oi" }, inn("oi", 1)], now: NOW, product, humanIds: HUMANS }).facts.humanActive, false);
});

test("pausa de humano ativo: fora do horário do robô a opção ignora a pausa; dentro, segue valendo #R-085", () => {
  const human = { direction: "out", author: "us_leo", at: ago(30) };
  const at = (iso) => new Date(iso).getTime();
  const ligado = sdrBotConfig({ sdrBot: { enabled: true, humanMuteOffHours: true, humanMuteHourStart: 9, humanMuteHourEnd: 18 } });
  // Quarta 10h BRT: dentro do horário, a pausa vale.
  assert.equal(humanMuteHolds(ligado, { ...human, at: "2026-08-19T12:30:00Z" }, at("2026-08-19T13:00:00Z")), true);
  // Quarta 19h BRT (fim às 18h): fora, o robô responde.
  assert.equal(humanMuteHolds(ligado, { ...human, at: "2026-08-19T21:30:00Z" }, at("2026-08-19T22:00:00Z")), false);
  // Sábado 11h BRT: fim de semana é sempre fora.
  assert.equal(humanMuteHolds(ligado, { ...human, at: "2026-08-22T13:30:00Z" }, at("2026-08-22T14:00:00Z")), false);
  // Opção desligada (padrão): a pausa vale a qualquer hora.
  const desligado = sdrBotConfig({ sdrBot: { enabled: true } });
  assert.equal(humanMuteHolds(desligado, { ...human, at: "2026-08-19T21:30:00Z" }, at("2026-08-19T22:00:00Z")), true);
  // Sem horas próprias, vale o expediente do fluxo de ligação (waCallFlow).
  const herdado = sdrBotConfig({ waCallFlow: { hourStart: 7, hourEnd: 20 }, sdrBot: { enabled: true, humanMuteOffHours: true } });
  assert.equal(herdado.humanMuteHourStart, 7);
  assert.equal(humanMuteHolds(herdado, { ...human, at: "2026-08-19T21:30:00Z" }, at("2026-08-19T22:00:00Z")), true); // 19h < 20h
});

test("agendaMessagesOf: depois do cancelamento só valem as mensagens posteriores #R-036", () => {
  const msgs = [out(OFFER, 40), inn("cancela", 35), out("desmarquei", 30), inn("sim", 5)];
  assert.deepEqual(agendaMessagesOf(msgs, { afterMessageId: "i35", at: ago(35) }).map((m) => m.id), ["o30", "i5"]);
  assert.deepEqual(agendaMessagesOf(msgs, { at: ago(33) }).map((m) => m.id), ["o30", "i5"], "sem id, pela hora");
  assert.equal(agendaMessagesOf(msgs, null), msgs);
});
