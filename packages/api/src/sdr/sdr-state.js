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
import { isOfferMsg, DEMO_RX, PITCH_RX } from "./sdr-signals.js";
import { leadPainFocus, SDR_AUTHOR } from "./sdr-flow.js";
import { leadEngaged, lastInboundText, bareHour, PRICE_ASK_RX } from "./sdr-intents.js";

const HOUR = 3_600_000;
const MIN = 60_000;
export const HUMAN_MUTE_MS = 4 * HOUR;   // gente falou há pouco: a conversa é dela
export const GREETING_GAP_MS = 6 * HOUR; // conversa parada há menos disso = SEM saudação nova (Leo, 22/08)
export const DAILY_CAP = 15;             // mensagens do robô por conversa por dia
export const CALL_WINDOW_BEFORE_MS = 30 * MIN;
export const CALL_WINDOW_AFTER_MS = 60 * MIN;

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
  const lastHumanMs = lastHumanOut ? Date.parse(lastHumanOut.at || 0) : 0;
  const humanActive = !!lastHumanOut && nowMs - lastHumanMs < HUMAN_MUTE_MS;
  const handoffMs = Date.parse(log.handoffAt || "") || 0;
  const handoffPending = !!handoffMs && !(lastHumanOut && lastHumanMs > handoffMs);
  const botToday = msgs.filter((m) => m.direction === "out" && m.author === SDR_AUTHOR && nowMs - Date.parse(m.at || 0) < 24 * HOUR).length;
  const prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
  const gapMin = prevMsg ? Math.round((nowMs - Date.parse(prevMsg.at || 0)) / MIN) : null;
  const canGreet = gapMin == null || gapMin >= GREETING_GAP_MS / MIN;
  const demoOffered = msgs.some((m) => m.direction === "out" && (DEMO_RX.test(m.text || "") || PITCH_RX.test(m.text || "")));
  const slotsOffered = agendaMessages.some((m) => m.direction === "out" && isOfferMsg(m.text || ""));
  const lastInText = lastInboundText(msgs);
  const engaged = leadEngaged(msgs) || (slotsOffered && bareHour(lastInText) != null);
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
      presenceAsked, presenceConfirmed, priceStep, priceAsks, lastInText,
    },
  };
}
