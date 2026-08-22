// SDR conversacional (Fase 2 do SDR automatizado): responde a mensagem do lead
// no WhatsApp e marca a call sozinho. A IA (anthropic.sdrDecide) é SÓ a cabeça:
// devolve uma ação de lista fechada; quem valida e executa é este motor, com
// as travas todas do lado determinístico:
//
//   - horário de agendamento TEM que estar na lista de horários livres reais
//     (agenda-slots.js) — horário inventado vira re-oferta dos 2 primeiros;
//   - movimento de card SÓ pelo caminho canônico (applyStageMove), com o
//     arquivo do callAt antigo (callHistory) igual ao PATCH da API;
//   - trava de preço: se a resposta da IA citar valor, ela é trocada pelo
//     desvio com autoridade (a IA nunca fala número com lead);
//   - handoff silencia o robô na conversa até um humano falar; mensagem humana
//     recente também silencia; teto de mensagens por conversa/dia;
//   - roda SÓ com product.sdrBot.conversation ligado (chave separada da Fase 1,
//     nasce desligada: só liga depois da bateria de replay — sdr-replay.js).
//
// Chamado pelo webhook DESTACADO (sem await): a resposta da Meta não espera a
// IA. Um pequeno atraso antes do envio faz o ritmo parecer de gente.
import { findThreadByPhone, listMessages, recordMessage } from "./wa-store.js";
import { digits } from "./whatsapp.js";
import { kindOf, firstStage, stageByKind, isWonLead } from "./stages.js";
import { brtToIso, applyStageMove } from "./lead-flow.js";
import { raiseAlert } from "./wa-call-flow.js";
import { leadGrade } from "./routes.marketing.js";
import { slotsForLead, slotLabel, wallNow } from "./agenda-slots.js";
import { sdrBotConfig, leadDigest, SDR_AUTHOR } from "./sdr-flow.js";

const HOUR = 3_600_000;
const BRAIN_KINDS = new Set(["novo", "contato", "qualificacao", "call"]);
const HUMAN_MUTE_MS = 4 * HOUR;   // gente falou há pouco: a conversa é dela
const DAILY_CAP = 15;             // mensagens do robô por conversa por dia
const PRICE_RX = /r\$\s*\d|\b\d{2,}\s*(reais|por m[eê]s|\/m[eê]s|mensais)\b|\ba partir de\s*\d/i;

const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";

// "sexta, 22/08, 10h32 (hora de Brasília)" — o relógio que a IA enxerga.
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function nowLabelOf(wnow) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${WEEKDAYS[wnow.getUTCDay()]}, ${p2(wnow.getUTCDate())}/${p2(wnow.getUTCMonth() + 1)}, ${wnow.getUTCHours()}h${p2(wnow.getUTCMinutes())} (hora de Brasília)`;
}

// Desvio com autoridade (tática comprovada da mineração) — o texto que entra no
// lugar de QUALQUER resposta da IA que tenha citado preço.
function priceDeferral(nome, slots, wnow) {
  const oi = nome ? `${nome}, o` : "O";
  const base = `${oi} investimento depende do tamanho da tua operação, e é exatamente isso que o especialista fecha contigo na call, já com o plano ideal.`;
  if (slots.length >= 2) return `${base} Tenho ${slotLabel(slots[0].at, wnow)} ou ${slotLabel(slots[1].at, wnow)} livres, qual encaixa melhor?`;
  if (slots.length === 1) return `${base} Consigo te encaixar ${slotLabel(slots[0].at, wnow)}, fica bom?`;
  return `${base} Qual período fica melhor pra você essa semana: manhã ou tarde?`;
}

// Confirmação de agendamento: SEMPRE a copy comprovada (a mensagem da IA é
// ignorada no agendar) — vende a call no formato que fecha e puxa o sócio.
function bookingConfirmText(nome, quando, askEmail) {
  const base = `Fechado${nome ? `, ${nome}` : ""}! Nossa call fica ${quando} então. Nosso especialista vai entrar nas suas contas com você e mostrar tudo funcionando ao vivo. Se tiver sócio ou alguém que decida junto, traz pra call que a conversa rende mais.`;
  return askEmail
    ? `${base} Me passa teu melhor e-mail que eu te mando o convite da call por lá?`
    : `${base} Te mando o lembrete por aqui um pouco antes!`;
}

function reofferText(nome, slots, wnow) {
  const oi = nome ? `${nome}, esse` : "Esse";
  if (slots.length >= 2) return `${oi} horário acabou de sair da minha agenda aqui. Consigo ${slotLabel(slots[0].at, wnow)} ou ${slotLabel(slots[1].at, wnow)}, qual fica melhor pra você?`;
  if (slots.length === 1) return `${oi} horário não está mais livre aqui. Consigo ${slotLabel(slots[0].at, wnow)}, fica bom?`;
  return `${oi} horário não está mais livre aqui. Me fala outro período que encaixe pra você que eu vejo a agenda.`;
}

// Marca (ou remarca) a call pelo MESMO caminho do PATCH da API: applyStageMove
// no movimento de etapa, callHistory quando o horário antigo já passou, GPS no
// compromisso e callConfirmed zerado (a confirmação é do horário novo).
export async function bookCall(repo, { lead, product, at, closer, author = SDR_AUTHOR, now = new Date() }) {
  const target = stageByKind(product, "call");
  if (!target) throw new Error("funil sem etapa de call");
  const patchExtra = { callConfirmed: false };
  const oldAt = String(lead.callAt || "");
  if (oldAt && oldAt !== at) {
    const oldT = Date.parse(brtToIso(oldAt));
    const hist = Array.isArray(lead.callHistory) ? lead.callHistory : [];
    if (Number.isFinite(oldT) && oldT < now.getTime() && !hist.some((h) => String(h?.at || "") === oldAt)) {
      patchExtra.callHistory = [...hist, { at: oldAt, closer: lead.closer || "" }].slice(-60);
    }
  }
  let moved = {};
  if (lead.stage !== target.stage) {
    moved = await applyStageMove(repo, { lead, toStage: target.stage, patch: { callAt: at, closer }, author, now });
    moved.stage = target.stage;
  } else {
    moved.nextActionAt = brtToIso(at); // remarcação na mesma etapa: GPS segue o compromisso
  }
  return repo.update("leads", lead.id, { ...patchExtra, ...moved, callAt: at, closer });
}

export function makeSdrBrain({ repo, whatsapp: wa, anthropic, autoCallMeet = null, log = console, now = () => new Date(), replyDelayMs = 6000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  async function sendBot({ phone, text, phoneId, saas, leadId }) {
    const { messageId } = await wa.sendText(phone, text, { phoneId });
    await recordMessage(repo, { id: messageId, phone, direction: "out", text, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas, leadId });
    return messageId;
  }

  const stamp = (lead, patch) => repo.update("leads", lead.id, { sdrLog: { ...(lead.sdrLog || {}), ...patch } });

  // Uma mensagem recebida → uma decisão aplicada. Devolve a ação executada (ou
  // null quando o gate segurou). NUNCA lança: falha vira log + alerta espaçado.
  async function handleInbound({ message } = {}) {
    try {
      return await decide({ message });
    } catch (err) {
      log.warn?.({ err: err.message }, "sdr-brain falhou");
      try {
        const thread = await findThreadByPhone(repo, message?.from || "");
        const lead = thread?.leadId ? await repo.get("leads", thread.leadId) : null;
        if (thread && lead && !(lead.sdrLog?.brainErrorAlertAt && Date.now() - Date.parse(lead.sdrLog.brainErrorAlertAt) < 6 * HOUR)) {
          await raiseAlert(repo, thread, { text: "IA do SDR falhou nesta conversa · responde na mão" });
          await stamp(lead, { brainErrorAlertAt: new Date().toISOString() });
        }
      } catch { /* alerta é best-effort */ }
      return "error";
    }
  }

  async function decide({ message }) {
    const at = now();
    const thread = await findThreadByPhone(repo, message?.from || "");
    if (!thread?.leadId) return null;
    const lead = await repo.get("leads", thread.leadId);
    if (!lead) return null;
    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const cfg = sdrBotConfig(product);
    if (!cfg?.conversation) return null;
    if (!anthropic?.configured?.()) return null;

    // Elegibilidade — as mesmas cercas da Fase 1 + região do funil.
    if (lead.internal || lead.formExit || lead.disqualified) return null;
    if (lead.whatsappOptOut || lead.whatsappInvalid) return null;
    if (isWonLead(product, lead)) return null;
    const kind = kindOf(product, lead.stage || firstStage(product));
    if (!BRAIN_KINDS.has(kind)) return null;

    const msgs = await listMessages(repo, thread.id);
    const humanIds = new Set((await repo.list("users")).map((u) => u.id));
    const nowMs = at.getTime();
    const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
    // Gente falou há pouco: a conversa é dela. Handoff pendente (sem humano
    // depois dele): o robô segue calado esperando gente assumir.
    if (lastHumanOut && nowMs - Date.parse(lastHumanOut.at || 0) < HUMAN_MUTE_MS) return "human-active";
    const handoffAt = lead.sdrLog?.handoffAt ? Date.parse(lead.sdrLog.handoffAt) : 0;
    if (handoffAt && !(lastHumanOut && Date.parse(lastHumanOut.at || 0) > handoffAt)) return "waiting-human";
    // Teto diário por conversa: rajada nunca vira metralhadora.
    const botToday = msgs.filter((m) => m.direction === "out" && m.author === SDR_AUTHOR && nowMs - Date.parse(m.at || 0) < 24 * HOUR).length;
    if (botToday >= DAILY_CAP) {
      if (lead.sdrLog?.capAlertAt !== lead.callAt || !lead.sdrLog?.capAlertAt) {
        await raiseAlert(repo, thread, { text: "Conversa longa com o robô (teto do dia) · assume aí" });
        await stamp(lead, { capAlertAt: new Date(nowMs).toISOString(), handoffAt: new Date(nowMs).toISOString() });
      }
      return "cap";
    }

    // Contexto pra decisão: agenda real + conversa + relógio BRT.
    const wnow = wallNow(at);
    const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 4 });
    const slotList = slots.map((s) => ({ ...s, label: slotLabel(s.at, wnow) }));
    const conversation = msgs.slice(-24).map((m) => ({
      who: m.direction === "in" ? "LEAD" : "VOCÊ",
      text: String(m.text || "").slice(0, 500) || "[mensagem]",
    }));
    const nome = firstName(lead.name);
    const decision = await anthropic.sdrDecide({
      sdrName: firstName((await repo.get("users", lead.owner).catch(() => null))?.name),
      lead: { name: lead.name, company: lead.company, email: lead.email },
      digest: leadDigest(product, lead),
      grade: leadGrade(lead) || "",
      stage: lead.stage || firstStage(product),
      callAt: lead.callAt || "",
      nowLabel: nowLabelOf(wnow),
      slots: slotList,
      conversation,
    });

    const phoneId = thread.waPhoneId || product.waPhoneId || undefined;
    const to = thread.phone || digits(lead.waPhone || lead.phone);
    const send = async (text) => {
      await sleep(replyDelayMs);
      return sendBot({ phone: to, text: String(text).slice(0, 900), phoneId, saas: product.id, leadId: lead.id });
    };

    // E-mail capturado na mensagem entra no cadastro (o convite do Meet usa).
    if (decision.email && /.+@.+\..+/.test(decision.email) && !lead.email) {
      try { await repo.update("leads", lead.id, { email: decision.email.trim() }); lead.email = decision.email.trim(); } catch { /* best-effort */ }
    }

    if (decision.acao === "silencio") return "silencio";

    if (decision.acao === "humano") {
      await raiseAlert(repo, thread, { text: `SDR IA pediu humano: ${decision.motivoHumano || "precisa de gente"} · "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString() });
      const transition = String(decision.mensagem || "").trim();
      if (transition && !PRICE_RX.test(transition) && transition.length <= 240) await send(transition);
      return "humano";
    }

    if (decision.acao === "agendar" || decision.acao === "remarcar") {
      const pick = slotList.find((s) => s.at === decision.horario);
      if (!pick) {
        // Horário fora da agenda real: re-oferta determinística, nada de
        // marcar no escuro.
        await send(reofferText(nome, slotList, wnow));
        return "reoferta";
      }
      const fresh = await repo.get("leads", lead.id);
      await bookCall(repo, { lead: fresh || lead, product, at: pick.at, closer: pick.closer, now: at });
      await send(bookingConfirmText(nome, slotLabel(pick.at, wnow), !lead.email));
      if (autoCallMeet) autoCallMeet(lead.id).catch(() => { /* o lembrete de 10min entrega o link quando existir */ });
      return decision.acao;
    }

    // responder — com a trava de preço na frente de tudo.
    let text = String(decision.mensagem || "").trim();
    if (!text) return "silencio";
    if (PRICE_RX.test(text)) {
      await send(priceDeferral(nome, slotList, wnow));
      await stamp(lead, { priceGuardAt: new Date(nowMs).toISOString() });
      return "preco-travado";
    }
    await send(text);
    return "responder";
  }

  return { handleInbound };
}
