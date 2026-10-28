// ESTADO da conversa do robô SDR, calculado UMA vez e só a partir do banco
// (lead.sdrLog + mensagens): sobrevive a deploy e reinício, e é o mesmo em
// produção, no replay e nos testes.
//
// Regra do rulebook: cada regra declara em que estados vale (sdr-rules.js,
// campo `states`); os validadores (sdr-guards.js) declaram `applies(ctx)` em
// cima destes fatos. Precedência: o primeiro que casa ganha (STATES em
// sdr-rules.js). Desinteresse e encerramento são RESULTADOS carimbados
// (handoffKind), não estados.
//
// Os fatos espelham o que o cérebro calcula hoje em decide() (sdr-brain.js);
// enquanto o cérebro ainda faz a conta própria, ele compara com estes e
// carimba `factsDiff` na thread quando divergem (sombra).

import { brtToIso } from "../crm/lead-flow.js";
import { liveOfferedSlots, DEMO_RX, PITCH_RX } from "./sdr-signals.js";
import { wallNow } from "../crm/agenda-slots.js";
import { leadPainFocus, SDR_AUTHOR, sdrBotConfig } from "./sdr-flow.js";
import { isBusinessHours } from "../platform/business-hours.js";
import { leadEngaged, lastInboundText, bareHour, PRICE_ASK_RX, DEMO_COST_RX, statedPainOf, NO_INTEREST_RX, burstInboundText, plainReply } from "./sdr-intents.js";

const HOUR = 3_600_000;
const MIN = 60_000;
export const HUMAN_MUTE_MS = 4 * HOUR;   // padrão da pausa de humano ativo (sdrBot.humanMuteHours)
export const GREETING_GAP_MS = 6 * HOUR; // conversa parada há menos disso = SEM saudação nova (Leo, 22/08)
export const DAILY_CAP = 15;             // mensagens do robô por conversa por dia
export const CALL_WINDOW_BEFORE_MS = 30 * MIN;
export const CALL_WINDOW_AFTER_MS = 60 * MIN;

// Mensagens do robô que contam pro teto (R-082): só a FALA da conversa. Envio
// automático do poller (via "flow": 1º toque, lembrete, escada, resgate e a
// confirmação do lembrete) fica fora; em 21/10 o lembrete da manhã (3 envios)
// estourou o teto de quem agendou na véspera e calou o robô no dia da call
// (Nicolas: pergunta 9 min antes da call ficou 51 min sem resposta).
export function botTalkLast24h(msgs, nowMs) {
  return msgs.filter((m) => m.direction === "out" && m.author === SDR_AUTHOR && m.via !== "flow" && nowMs - Date.parse(m.at || 0) < 24 * HOUR).length;
}

// Handoff que ainda segura o robô: sem fala humana depois dele. O de teto não
// vale na janela da call (R-039): é ali que o lead pergunta pelo link.
export function handoffHolds({ log = {}, lastHumanOut = null, inCallWindow = false } = {}) {
  const handoffMs = Date.parse(log.handoffAt || "") || 0;
  if (!handoffMs) return false;
  if (lastHumanOut && Date.parse(lastHumanOut.at || 0) > handoffMs) return false;
  return !(log.handoffKind === "teto" && inCallWindow);
}

// Pausa de humano ativo (R-080): fala humana há menos de humanMuteHours cala
// o robô. Com humanMuteOffHours, fora do horário configurado (fim de semana
// sempre fora) ela não vale e o robô responde (R-085). `cfg` = sdrBotConfig.
export function humanMuteHolds(cfg, lastHumanOut, nowMs) {
  if (!lastHumanOut) return false;
  const muteMs = (Number(cfg?.humanMuteHours) > 0 ? Number(cfg.humanMuteHours) : 4) * HOUR;
  if (nowMs - Date.parse(lastHumanOut.at || 0) >= muteMs) return false;
  if (cfg?.humanMuteOffHours && !isBusinessHours({ waCallFlow: { hourStart: cfg.humanMuteHourStart, hourEnd: cfg.humanMuteHourEnd } }, new Date(nowMs))) return false;
  return true;
}

// Mensagens que valem pra agenda: depois de um cancelamento, as datas e ofertas
// da call cancelada não autorizam a nova marcação (sdrLog.reschedule).
export function agendaMessagesOf(msgs, reschedule) {
  if (!reschedule) return msgs;
  const cancelIndex = msgs.findIndex((m) => m.id === reschedule.afterMessageId);
  return cancelIndex >= 0 ? msgs.slice(cancelIndex + 1)
    : msgs.filter((m) => Date.parse(m.at || "") > Date.parse(reschedule.at || ""));
}

export function stateOf({ lead = {}, msgs = [], now = new Date(), product = null, humanIds = new Set() } = {}) {
  const nowMs = now.getTime();
  const log = lead.sdrLog || {};
  const callAt = lead.callAt || "";
  const callMs = callAt ? Date.parse(brtToIso(callAt)) : NaN;
  const hasCall = Number.isFinite(callMs);
  const inCallWindow = hasCall && nowMs >= callMs - CALL_WINDOW_BEFORE_MS && nowMs <= callMs + CALL_WINDOW_AFTER_MS;
  const callFuture = hasCall && callMs > nowMs;
  const callPassed = hasCall && nowMs > callMs + CALL_WINDOW_AFTER_MS;
  const reschedule = !callAt ? log.reschedule || null : null;
  const awaitingReschedule = !!(reschedule && reschedule.status !== "offered");
  const agendaMessages = agendaMessagesOf(msgs, reschedule);
  const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
  const muteCfg = sdrBotConfig({ ...(product || {}), sdrBot: { ...(product?.sdrBot || {}), enabled: true } });
  const humanActive = humanMuteHolds(muteCfg, lastHumanOut, nowMs);
  const handoffPending = handoffHolds({ log, lastHumanOut, inCallWindow });
  const botToday = botTalkLast24h(msgs, nowMs);
  const prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
  const gapMin = prevMsg ? Math.round((nowMs - Date.parse(prevMsg.at || 0)) / MIN) : null;
  const canGreet = gapMin == null || gapMin >= GREETING_GAP_MS / MIN;
  const demoOffered = msgs.some((m) => m.direction === "out" && (DEMO_RX.test(m.text || "") || PITCH_RX.test(m.text || "")));
  const slotsOffered = liveOfferedSlots(agendaMessages, SDR_AUTHOR, wallNow(now)).length > 0; // oferta VIVA (R-029)
  const lastInText = lastInboundText(msgs);
  const burst = burstInboundText(msgs) || lastInText;
  const noInterest = NO_INTEREST_RX.test(plainReply(burst)) && !/quero saber mais sobre/i.test(burst);
  // Preço leva a agenda (R-072), menos na primeira fala do lead (antes de
  // qualquer mensagem nossa a resposta é descoberta, R-011).
  const askingPriceNow = PRICE_ASK_RX.test(burst) && !/quero saber mais sobre/i.test(burst) && !DEMO_COST_RX.test(burst) && msgs.some((m) => m.direction === "out");
  const engaged = (leadEngaged(msgs) || (slotsOffered && bareHour(lastInText) != null) || askingPriceNow) && !noInterest;
  const painMsg = [...msgs].reverse().find((m) => m.direction === "in" && statedPainOf(m.transcript || m.text));
  const statedPain = painMsg ? statedPainOf(painMsg.transcript || painMsg.text) : null;
  const firstReply = !msgs.some((m) => m.direction === "out");
  const script = leadPainFocus(product, lead)?.mode || "clone";
  const presenceAsked = !!callAt && log.presenceAskedFor === callAt;
  const presenceConfirmed = !!callAt && log.presenceConfirmedFor === callAt;
  const priceStep = log.priceHandoffAt ? 3 : log.priceExplainedAt ? 2 : log.priceGuardAt ? 1 : 0;
  const priceAsks = msgs.filter((m) => m.direction === "in" && PRICE_ASK_RX.test(m.transcript || m.text || "")).length;

  const state = handoffPending ? "handoff"
    : inCallWindow ? "janela_da_call"
      : callFuture ? "call_marcada"
        : callPassed ? "pos_call"
          : awaitingReschedule ? "remarcacao_pendente"
            : reschedule?.status === "offered" ? "remarcacao_oferecida"
              : slotsOffered ? "oferta_feita"
                : engaged ? "engajado"
                  : firstReply ? "novo" : "descoberta";

  return {
    state, script, scripted: script !== "clone", agendaMessages,
    facts: {
      callAt, inCallWindow, callFuture, callPassed, reschedule, awaitingReschedule,
      humanActive, handoffPending, botToday, capReached: botToday >= DAILY_CAP,
      gapMin, canGreet, demoOffered, slotsOffered, engaged, firstReply,
      presenceAsked, presenceConfirmed, priceStep, priceAsks, lastInText, statedPain, noInterest,
    },
  };
}
