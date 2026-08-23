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
import { slotsForLead, slotLabel, wallNow, spreadPair, OFFER_HOURS } from "./agenda-slots.js";
import { sdrBotConfig, leadDigest, conversationActive, leadPainFocus, SDR_AUTHOR } from "./sdr-flow.js";
import { transcriber as defaultTranscriber } from "./transcribe.js";

const HOUR = 3_600_000;
const BRAIN_KINDS = new Set(["novo", "contato", "qualificacao", "call"]);
const HUMAN_MUTE_MS = 4 * HOUR;   // gente falou há pouco: a conversa é dela
const GREETING_GAP_MS = 6 * HOUR; // conversa parada há menos disso = SEM saudação nova (Leo, 22/08)
// O pitch (ou o convite de demonstração) já saiu nesta conversa? Então NADA
// disso se repete (Leo, 22-23/08): capacidade já listada não se re-lista, as
// mensagens seguintes referenciam curto e trazem só o novo. O template do 1º
// toque também conta como pitch feito.
const DEMO_RX = /demonstra|mostrar (a |o )?(leverads|plataforma|ferramenta)|funcionando ao vivo/i;
const PITCH_RX = /t[íi]tulo de 200|part number|compatibilidade inteira|clonagem de an[úu]ncios|estoque, atendimento e edi[çc][ãa]o|gerenciar m[úu]ltiplas contas/i;
// Horário já oferecido não se repete enquanto o lead não escolher (Leo,
// 23/08): a re-oferta a cada resposta soa insistente (e o modelo ainda
// rotulava o dia errado ao re-citar de cabeça).
const SLOTS_RX = /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo) às \d{1,2}h/i;
const DAILY_CAP = 15;             // mensagens do robô por conversa por dia
const PRICE_RX = /r\$\s*\d|\b\d{2,}\s*(reais|por m[eê]s|\/m[eê]s|mensais)\b|\ba partir de\s*\d/i;

const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";

// "sexta, 22/08, 10h32 (hora de Brasília)" — o relógio que a IA enxerga.
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function nowLabelOf(wnow) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${WEEKDAYS[wnow.getUTCDay()]}, ${p2(wnow.getUTCDate())}/${p2(wnow.getUTCMonth() + 1)}, ${wnow.getUTCHours()}h${p2(wnow.getUTCMinutes())} (hora de Brasília)`;
}

// Resposta OFICIAL de preço (copy do Leo, 23/08) — o texto que entra no lugar
// de QUALQUER resposta da IA que tenha citado valor. Sem horário junto: a
// re-oferta de agenda colada no preço soava insistente.
function priceDeferral(nome) {
  const oi = nome ? `${nome}, o` : "O";
  return `${oi} investimento é de acordo com as necessidades da sua operação: primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar. É exatamente isso que o especialista faz na demonstração.`;
}

// Confirmação de agendamento ENXUTA (Leo, 23/08): sem re-descrever a
// demonstração (a conversa já falou dela) e sem pedir e-mail (vem do form).
// Fica o combinado por escrito + o sócio/decisor + o aviso de lembrete.
function bookingConfirmText(nome, quando) {
  return `Fechado${nome ? `, ${nome}` : ""}! Nossa call fica ${quando} então. Se tiver sócio ou alguém que decida junto, traz pra call que a conversa rende mais. Te mando o lembrete por aqui um pouco antes!`;
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

export function makeSdrBrain({ repo, whatsapp: wa, anthropic, autoCallMeet = null, transcriber = defaultTranscriber, log = console, now = () => new Date(), replyDelayMs = 6000, partDelayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // ÁUDIO do lead: 13% das mensagens recebidas (mineração) — sem isso, todo
  // áudio viraria handoff. Transcreve a nota de voz (cache wa_media primeiro,
  // Graph depois) e grava o texto NA mensagem (campo transcript), então a
  // conversa inteira fica legível pra IA nas próximas decisões também.
  // Falhou/não configurado: segue como "🎤 áudio" e o prompt manda pra humano.
  async function transcriptOf(m, lead) {
    if (m.transcript) return m.transcript;
    if (m.media?.kind !== "audio" || !transcriber?.configured?.()) return "";
    try {
      let buf = null, mime = m.media.mime || "audio/ogg";
      const cached = await repo.get("wa_media", m.id).catch(() => null);
      if (cached?.data) { buf = Buffer.from(cached.data, "base64"); mime = cached.mime || mime; }
      else if (wa?.fetchMedia && m.media.id) {
        ({ buf, mime } = await wa.fetchMedia(m.media.id));
        if (buf && buf.length <= 16 * 1024 * 1024) {
          try { await repo.create("wa_media", { id: m.id, mime, size: buf.length, data: buf.toString("base64"), at: new Date().toISOString() }); }
          catch { /* cache é bônus */ }
        }
      }
      if (!buf || buf.length < 1024 || buf.length > 25 * 1024 * 1024) return "";
      const text = await transcriber.transcribe(buf, {
        filename: `wa-${m.id}.ogg`, mime,
        prompt: ["LeverAds", lead?.name, lead?.company].filter(Boolean).join(", "),
      });
      if (text) await repo.update("wa_messages", m.id, { transcript: text }).catch(() => {});
      return text || "";
    } catch (err) {
      log.warn?.({ msg: m.id, err: err.message }, "sdr-brain: transcrição do áudio falhou");
      return "";
    }
  }

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
    // Modo normal: chave conversation + lead real. Modo teste: chave
    // conversationTest + lead INTERNO (a experiência completa no WhatsApp do
    // time, sem tocar lead de verdade).
    if (!conversationActive(cfg, lead)) return null;
    if (!anthropic?.configured?.()) return null;

    // Elegibilidade — as mesmas cercas da Fase 1 + região do funil.
    if (lead.formExit || lead.disqualified) return null;
    if (lead.whatsappOptOut || lead.whatsappInvalid) return null;
    if (isWonLead(product, lead)) return null;
    const kind = kindOf(product, lead.stage || firstStage(product));
    if (!BRAIN_KINDS.has(kind)) return null;

    // DEBOUNCE DE RAJADA (Leo, 23/08): espera o lead terminar de digitar. Ao
    // acordar, se chegou mensagem MAIS NOVA que a que disparou esta decisão,
    // aborta — o disparo da última mensagem é quem responde, lendo a rajada
    // inteira e compilando um retorno só.
    if (cfg.debounceSec > 0) await sleep(cfg.debounceSec * 1000);
    const msgs = await listMessages(repo, thread.id);
    if (message?.id) {
      const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
      if (lastIn && lastIn.id !== message.id) return "superseded";
    }
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
    const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 16, ...OFFER_HOURS });
    const slotList = slots.map((s) => ({ ...s, label: slotLabel(s.at, wnow) }));
    const suggestedPair = spreadPair(slotList);
    // Nota de voz que disparou a decisão vira texto (as antigas já carregam o
    // transcript gravado); sem transcrição possível, fica "🎤 áudio" e o
    // prompt manda pra humano.
    const lastIn = [...msgs].reverse().find((x) => x.direction === "in");
    if (lastIn && lastIn.media?.kind === "audio" && !lastIn.transcript) {
      const t = await transcriptOf(lastIn, lead);
      if (t) lastIn.transcript = t;
    }
    const conversation = msgs.slice(-24).map((m) => ({
      who: m.direction === "in" ? "LEAD" : "VOCÊ",
      text: String(m.transcript ? `[áudio] ${m.transcript}` : (m.text || "")).slice(0, 500) || "[mensagem]",
    }));
    // Saudação só em conversa FRIA: gap desde a mensagem ANTERIOR à que
    // disparou esta decisão. Menos de 6h = em andamento, sem "Oi" de novo.
    const prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    const gapMin = prevMsg ? Math.round((nowMs - Date.parse(prevMsg.at || 0)) / 60_000) : null;
    const canGreet = gapMin == null || gapMin >= GREETING_GAP_MS / 60_000;
    const demoOffered = msgs.some((m) => m.direction === "out" && (DEMO_RX.test(m.text || "") || PITCH_RX.test(m.text || "")));
    const slotsOffered = msgs.some((m) => m.direction === "out" && SLOTS_RX.test(m.text || ""));
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
      pain: leadPainFocus(product, lead),
      canGreet,
      gapMin,
      demoOffered,
      slotsOffered,
      suggestedPair,
    });

    const phoneId = thread.waPhoneId || product.waPhoneId || undefined;
    const to = thread.phone || digits(lead.waPhone || lead.phone);
    // Envio em PARTES, como gente digitando (Leo, 23/08): a 1ª mensagem sai
    // depois do atraso de resposta; as seguintes com 5s entre cada uma.
    const send = async (textOrParts) => {
      const parts = (Array.isArray(textOrParts) ? textOrParts : [textOrParts])
        .map((t) => String(t || "").trim()).filter(Boolean).slice(0, 3);
      for (let i = 0; i < parts.length; i++) {
        await sleep(i === 0 ? replyDelayMs : partDelayMs);
        await sendBot({ phone: to, text: parts[i].slice(0, 900), phoneId, saas: product.id, leadId: lead.id });
      }
    };

    // E-mail capturado na mensagem entra no cadastro (o convite do Meet usa).
    if (decision.email && /.+@.+\..+/.test(decision.email) && !lead.email) {
      try { await repo.update("leads", lead.id, { email: decision.email.trim() }); lead.email = decision.email.trim(); } catch { /* best-effort */ }
    }

    if (decision.acao === "silencio") return "silencio";

    if (decision.acao === "humano") {
      await raiseAlert(repo, thread, { text: `SDR IA pediu humano: ${decision.motivoHumano || "precisa de gente"} · "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString() });
      const transition = ((Array.isArray(decision.mensagens) && decision.mensagens[0]) || String(decision.mensagem || "")).trim();
      if (transition && !PRICE_RX.test(transition) && transition.length <= 240) await send(transition);
      return "humano";
    }

    if (decision.acao === "agendar" || decision.acao === "remarcar") {
      const pick = slotList.find((s) => s.at === decision.horario);
      if (!pick) {
        // Horário fora da agenda real: re-oferta determinística (com o par
        // espaçado), nada de marcar no escuro.
        await send(reofferText(nome, suggestedPair, wnow));
        return "reoferta";
      }
      const fresh = await repo.get("leads", lead.id);
      await bookCall(repo, { lead: fresh || lead, product, at: pick.at, closer: pick.closer, now: at });
      await send(bookingConfirmText(nome, slotLabel(pick.at, wnow)));
      if (autoCallMeet) autoCallMeet(lead.id).catch(() => { /* o lembrete de 10min entrega o link quando existir */ });
      return decision.acao;
    }

    // responder — com a trava de preço na frente de tudo, sobre o conjunto.
    const parts = (Array.isArray(decision.mensagens) && decision.mensagens.length
      ? decision.mensagens : [decision.mensagem]).map((t) => String(t || "").trim()).filter(Boolean);
    if (!parts.length) return "silencio";
    if (PRICE_RX.test(parts.join(" "))) {
      await send(priceDeferral(nome));
      await stamp(lead, { priceGuardAt: new Date(nowMs).toISOString() });
      return "preco-travado";
    }
    await send(parts);
    return "responder";
  }

  return { handleInbound };
}
