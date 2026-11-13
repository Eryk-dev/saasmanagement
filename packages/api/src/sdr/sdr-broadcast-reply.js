// RESPOSTA AO DISPARO (R-122, Leo 13/11/2026): um broadcast de WhatsApp pode
// carregar um RETORNO AUTOMÁTICO (`campaign.reply`). Quem recebeu esse disparo
// e responde dizendo que quer (webinário: "sim, quero participar") recebe o
// texto do retorno (o link do grupo) uma vez, pelo robô; depois disso,
// QUALQUER mensagem do lead para o robô nessa conversa (lead.sdrOff, o mesmo
// botão "parar robô" do Inbox) e avisa o time. Quem responde sem confirmar
// ("Oi", "do que se trata?") ou dizendo não fica com o robô calado e vira
// alerta no Inbox: no disparo de 11/11 o robô respondia a "Sim, gostaria de
// participar" com o pitch da LeverAds e dois horários de call, e o time
// mandava o link do grupo na mão.
//
// Só vale enquanto a última fala nossa na conversa é o próprio disparo (autor
// "disparo"): se o robô ou alguém do time já falou depois, a conversa segue o
// fluxo normal. A mensagem pronta do formulário ("quero saber mais sobre…")
// tem "quero" mas é lead novo, não resposta ao disparo.
import { BROADCAST_AUTHOR, waReceived } from "../marketing/broadcast-wa.js";
import { FORM_MSG_RX } from "./sdr-signals.js";
import { NO_INTEREST_RX, plainReply, burstInboundText } from "./sdr-intents.js";
import { brtToIso } from "../crm/lead-flow.js";

const DAY = 86_400_000;
// Sem `reply.until`, o retorno vale por 14 dias depois do envio.
export const REPLY_WINDOW_DAYS = 14;

// "Sim", "quero", "pode mandar", "manda o link", "ok", "👍" (reação)…
const YES_RX = /\b(sim|quero|queremos|gostaria|gostariamos|tenho interesse|temos interesse|interesse|interessado|interessada|participar|participarei|vou participar|vamos participar|pode (?:mandar|enviar|me (?:mandar|enviar|incluir|adicionar|colocar)|ser|sim)|manda|me manda|me envia|envia|me inclui|me inclua|me adiciona|me coloca|conta comigo|estarei|vou estar|link|claro|com certeza|bora|ok|okay|certo|beleza|blz|top|show|perfeito|maravilha|isso|vamos|confirmo|aceito|topo|fechado|combinado)\b/;
const YES_REACTION_RX = /\[reaction\]\s*(?:👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|❤️|❤|🙏|👏|🔥|✅|😍|🤩)/;
// Negativa: "não", "desconsiderar", "tira meu número", "sem interesse"…
const NO_RX = /\b(nao|nunca|nem|desconsider\w*|remov\w*|retir\w*|exclu\w*|tir[ae]m? (?:meu|o) (?:numero|contato|telefone)|descadastr\w*|bloque\w*|sem interesse|obrigad[oa],? mas)\b/;

// O que o lead disse em resposta ao disparo: "yes" | "no" | "other".
export function broadcastReplyIntent(text) {
  const raw = String(text || "");
  if (FORM_MSG_RX.test(raw)) return "form";
  const t = plainReply(raw);
  if (!t) return "other";
  if (YES_REACTION_RX.test(raw)) return "yes";
  if (NO_INTEREST_RX.test(t) || NO_RX.test(t)) return "no";
  if (YES_RX.test(t)) return "yes";
  return "other";
}

// Fim da janela do retorno automático de um disparo: `reply.until` (hora de
// Brasília, "YYYY-MM-DDTHH:mm") ou 14 dias depois do envio.
export function replyWindowEnd(campaign, sentMs) {
  const until = campaign?.reply?.until ? Date.parse(brtToIso(campaign.reply.until)) : NaN;
  return Number.isFinite(until) ? until : sentMs + REPLY_WINDOW_DAYS * DAY;
}

export const replyEnabled = (campaign) => !!campaign?.reply?.enabled && !!String(campaign.reply.text || "").trim();

// O disparo com retorno automático mais recente que este lead RECEBEU (na
// janela), ou null. Poucas campanhas por produto: lê todas.
export async function replyCampaignFor(repo, lead, { nowMs = Date.now() } = {}) {
  if (!lead?.id) return null;
  const camps = await repo.listWhere("campaigns", lead.saas ? { saas: lead.saas } : {}).catch(() => []);
  let best = null;
  for (const c of camps || []) {
    if (!replyEnabled(c)) continue;
    const st = c.sent?.[lead.id];
    if (!st || st.waStatus === "queued" || !waReceived(st)) continue;
    const sentMs = Date.parse(st.whatsapp || st.queuedAt || "");
    if (!Number.isFinite(sentMs) || nowMs > replyWindowEnd(c, sentMs)) continue;
    if (!best || sentMs > best.sentMs) best = { campaign: c, sentMs };
  }
  return best;
}

// Decisão pura sobre a conversa:
//   { kind: "off" }            lead falou DEPOIS do retorno que o robô mandou → robô para
//   { kind: "link", text }     respondeu ao disparo dizendo sim → manda o retorno
//   { kind: "no" | "other" }   respondeu ao disparo sem confirmar → calado + alerta
//   null                       não é resposta ao disparo (fluxo normal)
export function broadcastReplyDecision({ lead, msgs = [], hit = null, nowMs = Date.now() }) {
  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  if (!lastIn) return null;
  // Já mandamos o retorno? Então qualquer fala do lead DEPOIS dele é "off".
  // A ordem na conversa vale mais que o relógio (o id da mensagem do retorno
  // fica no carimbo); sem o id, compara os horários.
  const prior = lead?.sdrLog?.broadcastReply;
  if (prior?.linkAt) {
    const idx = prior.messageId ? msgs.findIndex((m) => m.id === prior.messageId) : -1;
    const after = idx >= 0 ? msgs.slice(idx + 1).some((m) => m.direction === "in") : Date.parse(lastIn.at || "") > Date.parse(prior.linkAt);
    if (after) return { kind: "off", campaign: prior.campaign || "" };
  }
  if (!hit) return null;
  const { campaign, sentMs } = hit;
  if (nowMs > replyWindowEnd(campaign, sentMs)) return null;
  // A última fala nossa tem que ser o disparo (ou nenhuma depois do envio).
  const lastOut = [...msgs].reverse().find((m) => m.direction === "out");
  const outMs = Date.parse(lastOut?.at || "");
  const replyingToBroadcast = lastOut ? lastOut.author === BROADCAST_AUTHOR || (Number.isFinite(outMs) && outMs < sentMs) : true;
  if (!replyingToBroadcast) return null;
  const text = burstInboundText(msgs);
  const intent = broadcastReplyIntent(text);
  if (intent === "form") return null;
  if (intent === "yes") return { kind: "link", campaign: campaign.id, text: String(campaign.reply.text || "").trim() };
  return { kind: intent, campaign: campaign.id, text };
}
