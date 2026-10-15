// INTENÇÃO da mensagem do lead, num lugar só.
//
// Tudo que o cérebro (sdr-brain.js) lia da mensagem recebida com regex solta
// (preço pedido, afiliado, cancelamento, nega a call, lead na sala, sem
// interesse, objeção, aceite, número solto, pedido de horário, sim curto)
// vive aqui, com UMA definição por regex e uma tabela de testes
// (test/sdr-intents.test.js) com uma linha por frase real. Quando o Leo manda
// "'boa tarde' não é período", a tabela mostra na hora quais outras frases
// viram junto.
//
// Cada regex declara a FORMA de texto em que roda: `raw` (como veio, acento e
// tudo; as regex são /i e aceitam as duas grafias) ou `plain` (normalizado por
// plainReply: sem acento, minúsculo). Trocar a forma muda o comportamento.
//
// Regra do rulebook: R-008 (texto do lead é dado), R-016 (afiliado), R-027
// (número solto), R-032 (pedido filtra a lista), R-034 (aceite + preço),
// R-036 (cancelar com consentimento), R-037 (nega a call), R-038 (objeção),
// R-039 (lead na sala), R-050/R-051 (preço), R-083 (desinteresse), R-084.

import { sdrAgendaWindow } from "./sdr-agenda.js";
import { FORM_MSG_RX, AUTO_REPLY_RX, GREETING_ONLY_RX, ACCEPT_RX, BARE_HOUR_RX, acceptedSlot } from "./sdr-signals.js";

// ── Forma do texto ──────────────────────────────────────────────────────────
export const plainReply = (text) => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const lastInboundText = (msgs) => {
  const m = [...msgs].reverse().find((x) => x.direction === "in");
  return String(m?.transcript || m?.text || "");
};

// ── Regex sobre o texto CRU (raw) ───────────────────────────────────────────
// AFILIADO da Shopee/ML (Leo, 25/08): divulga produto dos outros por comissão,
// não tem conta de vendedor nem anúncio pra clonar: não é cliente. Sem \b no
// fim (o \b do JS é ASCII).
export const AFFILIATE_RX = /\b(sou|somos|trabalho como|atuo como)\s+(um[ao]?\s+)?afil[ih]ad|afil[ih]ad[ao]s?\s+(d[ao]|na|no)\s+(shopee|mercado\s*livre|ml\b)|programa de afiliad|link de afiliad|divulgo produtos? (de|d[ao]s)/i;
// Dia SOLTO ("retomar amanhã", "que tal na terça?"). Sem \b no fim de
// propósito: "amanhã," não fecha fronteira ASCII.
export const DAY_WORD_RX = /\b(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|essa semana|semana que vem)/i;
export const HAS_HOUR_RX = /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b/;
// Lead sinalizou INTERESSE ("sim", "ajudaria", "quero"...).
export const INTEREST_RX = /\b(sim|ajudaria|com certeza|claro|tenho interesse|quero|pode ser|bora|show|top|gostei|perfeito)\b/i;
// Lead no celular ("vou entrar pelo celular"): a dica do computador entra.
export const LEAD_MOBILE_RX = /celular|pelo (?:cel|fone|telefone)\b|no telefone|pelo app/i;
// LEAD NEGA A CONVERSA MARCADA ("não tenho call às 13h", "não marquei nada"):
// o card pode estar errado (caso Renan, 16/09) e quem confere é gente.
export const DENY_CALL_RX = /n[ãa]o (?:tenho|marquei|agendei|combinei|sei de|lembro de)\s*(?:nenhuma?|essa|esta|nada|dessa|de|a)?\s*(?:call|conversa|reuni[ãa]o|hor[áa]rio|agendamento|nada)|n[ãa]o sei do que (?:se trata|voc[êe] (?:est[áa]|ta) falando)|n[ãa]o (?:foi|era) (?:eu|comigo)/i;
// DESCOBERTA ANTES DO HORÁRIO: só oferece horário depois que o lead disse que
// a ferramenta ajudaria ou pediu pra agendar. A mensagem automática do form
// não conta (Eduardo, 15/09).
export const SCHEDULE_ASK_RX = /hor[áa]rio|agendar|marcar|agenda\b|dispon[íi]vel|quando|que horas|\bhoje\b|\bamanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|manh[ãa]|tarde|noite|\bvamos\b/i;
export const leadEngaged = (msgs) => msgs.some((m) => {
  if (m.direction !== "in") return false;
  const t = String(m.transcript || m.text || "");
  return !FORM_MSG_RX.test(t) && (INTEREST_RX.test(t) || SCHEDULE_ASK_RX.test(t) || HAS_HOUR_RX.test(t));
});
// Pedido de dia/período do lead: aí a oferta pode pular a vaga de hoje.
export const PERIOD_ASK_RX = /manh[ãa]|tarde|noite|depois d[ao]s|antes d[ao]s|a partir d[ao]s|depois d[eo]ss|antes d[eo]ss|mais cedo|semana que vem|outro dia|s[óo] (?:na |no )?(?:segunda|ter[çc]a|quarta|quinta|sexta)/i;
// O LEAD pedindo preço (≠ PRICE_RX do cérebro, que pega VALOR dito por nós).
export const PRICE_ASK_RX = /pre[çc]o|\bvalor(es)?\b|quanto (custa|fica|sai|é|e)\b|mensalidade|qual o (investimento|custo)|tabela de pre[çc]/i;
// NÚMERO SOLTO depois da oferta é HORA (Leo, 08/10): "18" a "terça às 17h ou
// quarta às 17h". Hora entre 6 e 21; fora disso não é hora.
export const bareHour = (text) => {
  const m = String(text || "").match(BARE_HOUR_RX);
  const h = m ? Number(m[1]) : NaN;
  return h >= 6 && h <= 21 ? h : null;
};

// ── Regex sobre o texto NORMALIZADO (plain) ─────────────────────────────────
// LEAD SEM INTERESSE / PEDIU PAUSA (Leo, 08/10, caso Laion).
export const NO_INTEREST_RX = /nao tenho (?:mais )?interesse|sem interesse|perdi o interesse|nao (?:quero|preciso|tenho) mais\b|vamos pausar|pausar por enquanto|deixa pra la|nao (?:vou|vamos) (?:seguir|continuar|prosseguir|fechar|contratar)|pode parar|para de (?:me )?mandar|nao me (?:chame|chama|mande|manda|procure|procura) mais|nao (?:e|eh) (?:o )?momento|por enquanto nao|agora nao quero|desisti|nao quero (?:agendar|marcar|demonstracao|conversa)/;
// Lead na sala do Meet esperando.
export const WAITING_ROOM_RX = /sozinh|ninguem (?:entrou|apareceu|chegou|na sala)|nao (?:entrou|apareceu|chegou|tem) ninguem|sala (?:esta |ta )?vazia|\bcade\b|\bkd\b|\b(?:estou|to) (?:esperando|aguardando)|aguardando (?:aqui|na sala|voces|o especialista)|esperando (?:aqui|na sala|voces)|me conecte|vai entrar\?|quem (?:vai|ta) (?:entrar|na sala)/;
// Objeção/desistência depois da call marcada.
export const OBJECTION_RX = /nao vou (?:usar|utilizar|precisar|conseguir usar)|acho que nao|ja uso|ja tenho|ja utilizo|nao (?:faz|vai fazer) sentido|desist|nao (?:quero|preciso) mais|deixa pra la|nao vale|nao vai servir|nao serve pra mim/;
// Negativa, ressalva ou pedido de mudança que tira o lead do roteiro OEM/Price.
export const OEM_NO_RX = /\bnao\b|\bnem\b|remarc|reagend|mudar|trocar|outr[oa]|cancel|imprevisto|talvez|depende|nao sei|prefiro/;
// Cancelamento inequívoco continua valendo se a IA tentar oferecer outra call.
// Problema para acessar o link e negação do cancelamento não são ausência.
export function requestsCancellation(text) {
  const t = plainReply(text);
  if (/\bnao (?:quero|vou|preciso|pode|e para) (?:cancel|desmarc)/.test(t)) return false;
  return /^(?:pode |quero |preciso )?(?:cancelar|cancela|cancelar sim|desmarcar|desmarca)[.!?\s]*$/.test(t)
    || /\b(?:cancelar|cancela|cancele|desmarcar|desmarca|desmarque)\b.{0,35}\b(?:agendamento|call|reuniao|horario|conversa)\b/.test(t)
    || /\bnao (?:vou |vamos |vai )?(?:poder |conseguir )?(?:comparecer|participar|estar presente)\b/.test(t)
    || /\bnao (?:poderei|poderemos|consigo|posso) (?:comparecer|participar|estar presente)\b/.test(t)
    || /\bnao (?:vou conseguir|vou poder|posso|consigo|vai dar) (?:hoje|amanha)\b(?! (?:acessar|abrir|entrar no link))/.test(t);
}
// Resposta do lead à pergunta "quer remarcar?" (R-036).
export function rescheduleReply(text, wnow) {
  const t = plainReply(text);
  if (/\bnao (?:quero|gostaria|tenho interesse)|\b(?:agora|hoje) nao\b|\bnao (?:agora|obrigad)|\b(?:deixa pra la|depois (?:eu )?te chamo|prefiro nao)\b|^nao[.!?\s]*$/.test(t)) return "declined";
  if (/\bnao\b|\b(?:talvez|vou pensar|nao sei)\b/.test(t)) return "pending";
  if (/\b(?:sim|claro|pode ser|bora)\b/.test(t)
      || /^(?:quero|gostaria)[.!?\s]*$|\b(?:quero|gostaria de|vamos|podemos) (?:remarcar|reagendar)\b/.test(t)
      || /\b(?:quais|tem|manda|envia|outro|novos?)\b.*\bhorarios?\b/.test(t)
      || HAS_HOUR_RX.test(t) || sdrAgendaWindow([{ direction: "in", text }], wnow).requested) return "accepted";
  return "pending";
}
// Pedido de remarcação em texto livre (sem a pergunta do robô antes).
export const RESCHEDULE_ASK_RX = /remarc|reagend|mudar (?:o |de |esse )?(?:hor|dia)|trocar (?:o |de |esse )?(?:hor|dia)|outro hor|outra data|outro dia|adiar/;
// "Não" seco (ou quase).
const NO_RX = /^(?:nao|n|nop|nope|negativo)[.!\s]*$|^nao (?:consigo|posso|quero|da|vai dar|obrigad[oa])[.!\s]*$/;
// Lead adiou a decisão (R-031/R-041: "Combinado", sem re-oferta).
const POSTPONE_RX = /\bte (?:retorno|respondo|aviso|chamo|falo)\b|\bdepois (?:eu )?te\b|\bmais tarde\b|\b(?:vou|preciso|tenho que|deixa eu) (?:ver|falar|conversar|alinhar) com\b|\bme (?:da|de) um tempo\b|\bvou pensar\b/;
// Pedido de horário sem dia ("podemos marcar um horário?", "quais horários tem?").
const SCHEDULE_WORDS_RX = /hor[áa]rio|\bagendar|\bmarcar|\bagenda\b|dispon[íi]vel|que horas|quais (?:dias|datas)/i;
const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// Lista fechada, em ORDEM DE PRECEDÊNCIA (a primeira que casa é a `primary`).
export const INTENTS = ["auto_reply", "form_message", "affiliate", "cancel", "deny_call", "waiting_room", "no_interest", "objection", "accept_slot", "bare_hour", "schedule_ask", "reschedule_ask", "yes", "no", "postpone", "greeting_only", "question", "other"];
// Co-rótulos, sempre calculados.
export const LABELS = ["price_ask", "device_mobile", "question", "has_hour", "period_ask", "day_word", "interest", "email"];

// "Sim" curto que move o roteiro OEM/Price (R-070): ≤8 palavras, sem pergunta,
// sem preço, sem dia/hora, sem ressalva.
export function isShortYes(raw) {
  const text = String(raw || "");
  const plain = plainReply(text);
  return !text.includes("?") && text.trim().split(/\s+/).filter(Boolean).length <= 8
    && (INTEREST_RX.test(text) || ACCEPT_RX.test(plain))
    && !PRICE_ASK_RX.test(text) && !FORM_MSG_RX.test(text) && !OEM_NO_RX.test(plain)
    && !HAS_HOUR_RX.test(text) && !DAY_WORD_RX.test(text);
}

// `offered`: horários da última oferta do robô (offeredSlotsIn), pra o aceite
// ("17h", "pode", "o primeiro") e o número solto. `slotsOffered`: houve oferta
// nesta conversa. `callAt`: só com call marcada "não marquei nada" nega a call.
// `wnow`: relógio de parede BRT, pra ler pedido de dia/período.
export function classifyInbound(text, { wnow = null, offered = [], slotsOffered = false, callAt = "" } = {}) {
  const raw = String(text || "");
  const plain = plainReply(raw);
  const question = raw.includes("?");
  const all = new Set();
  const label = (k, on) => { if (on) all.add(k); };
  label("price_ask", PRICE_ASK_RX.test(raw));
  label("device_mobile", LEAD_MOBILE_RX.test(raw));
  label("question", question);
  label("has_hour", HAS_HOUR_RX.test(raw));
  label("period_ask", PERIOD_ASK_RX.test(raw));
  label("day_word", DAY_WORD_RX.test(raw));
  label("interest", INTEREST_RX.test(raw) || ACCEPT_RX.test(plain));
  const email = (raw.match(EMAIL_RX) || [])[0] || "";
  label("email", !!email);
  const hour = bareHour(raw);
  const slot = offered.length ? acceptedSlot(raw, offered) : null;
  const window = wnow ? sdrAgendaWindow([{ direction: "in", text: raw }], wnow) : null;
  const primary =
    AUTO_REPLY_RX.test(raw) ? "auto_reply"
      : FORM_MSG_RX.test(raw) ? "form_message"
        : AFFILIATE_RX.test(raw) ? "affiliate"
          : requestsCancellation(raw) ? "cancel"
            : callAt && DENY_CALL_RX.test(raw) ? "deny_call"
              : WAITING_ROOM_RX.test(plain) ? "waiting_room"
                : !question && NO_INTEREST_RX.test(plain) && !FORM_MSG_RX.test(raw) ? "no_interest"
                  : OBJECTION_RX.test(plain) ? "objection"
                    : slot ? "accept_slot"
                      : slotsOffered && hour != null ? "bare_hour"
                        : window?.requested || HAS_HOUR_RX.test(raw) || SCHEDULE_WORDS_RX.test(raw) ? "schedule_ask"
                          : RESCHEDULE_ASK_RX.test(plain) ? "reschedule_ask"
                            : isShortYes(raw) ? "yes"
                              : NO_RX.test(plain) ? "no"
                                : POSTPONE_RX.test(plain) ? "postpone"
                                  : GREETING_ONLY_RX.test(raw) ? "greeting_only"
                                    : question ? "question" : "other";
  return { primary, all, hour, slot, window, email, plain };
}
