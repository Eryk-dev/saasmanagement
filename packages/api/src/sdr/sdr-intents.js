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

import { sdrAgendaWindow, firstDayMentioned } from "./sdr-agenda.js";
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
export const DAY_WORD_RX = /\b(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|essa semana|semana que vem|pr[óo]xima semana|outra semana|semana seguinte)/i;
export const HAS_HOUR_RX = /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b/;
// Lead sinalizou INTERESSE ("sim", "ajudaria", "quero"...).
// "Não quero começar" não é interesse (28/10, Helano: o "quero" dentro da
// negação ligava a trava de beco e a oferta saiu em cima do "não quero").
// Afirmação forte ("sem dúvida", "com certeza", "exatamente") engaja.
export const INTEREST_RX = /(?<!\bn[ãa]o\s)(?<!\bnem\s)(?<!\bnunca\s)\b(sim|ajudaria|com certeza|sem d[úu]vida|exatamente|isso mesmo|faz sentido|seria [óo]timo|claro|tenho interesse|quero|pode ser|bora|show|top|gostei|perfeito)\b/i;
// Lead no celular ("vou entrar pelo celular"): a dica do computador entra.
export const LEAD_MOBILE_RX = /celular|pelo (?:cel|fone|telefone)\b|no telefone|pelo app/i;
// LEAD NEGA A CONVERSA MARCADA ("não tenho call às 13h", "não marquei nada"):
// o card pode estar errado (caso Renan, 16/09) e quem confere é gente.
export const DENY_CALL_RX = /n[ãa]o (?:tenho|marquei|agendei|combinei|sei de|lembro de)\s*(?:nenhuma?|essa|esta|nada|dessa|de|a)?\s*(?:call|conversa|reuni[ãa]o|hor[áa]rio|agendamento|nada)|n[ãa]o sei do que (?:se trata|voc[êe] (?:est[áa]|ta) falando)|n[ãa]o (?:foi|era) (?:eu|comigo)/i;
// DESCOBERTA ANTES DO HORÁRIO: só oferece horário depois que o lead disse que
// a ferramenta ajudaria ou pediu pra agendar. A mensagem automática do form
// não conta (Eduardo, 15/09).
// "Olá boa tarde" não é pedido de horário (28/10, Sousa: a saudação engajava
// e a oferta saiu antes da descoberta): mesmo lookbehind da PERIOD_ASK_RX.
export const SCHEDULE_ASK_RX = /hor[áa]rio|agendar|marcar|agenda\b|dispon[íi]vel|quando|que horas|\bhoje\b|\bamanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|(?<![\p{L}])(?<!\bbo[am]\s)(?:manh[ãa]|tarde|noite)|\bvamos\b/iu;
// DOR DECLARADA pelo lead com as próprias palavras (28/10, Flavio "o
// principal é compatibilidade", Guilherme "cadastrar em massa, título,
// pesquisa de mercado"): engaja a conversa e diz de qual produto é a dor.
// Pedido de preço e pergunta não contam.
const PAIN_OEM_RX = /compatibilidade|c[óo]digo (?:oem|da pe[çc]a|original)|\boem\b|cadastr|subir (?:os )?an[úu]ncio|criar (?:os )?an[úu]ncio|montar (?:os )?an[úu]ncio|t[íi]tulo|descri[çc][ãa]o|ficha t[ée]cnica|an[úu]ncio por an[úu]ncio|engessad|tudo manual|manualmente|\bmanual\b|pesquisa de mercado|categoria/i;
const PAIN_PRICE_RX = /margem|precific|promo[çc][õo]es?|central de promo|custo|imposto|\bdre\b|atualizar (?:os )?pre[çc]o|manter (?:os )?pre[çc]o|pre[çc]o (?:dos|das|de cada|por)/i;
const PAIN_ADS_RX = /v[áa]rias contas|m[úu]ltiplas contas|gerenciar (?:as )?contas|integra[çc][ãa]o (?:entre|de|das|com) (?:as )?contas|integrar (?:as )?contas|contas (?:de|do|no) (?:mercado|ml|shopee)|clonar|clonagem|espelhar|estoque|atendimento|pergunta dos clientes|banid/i;
export function statedPainOf(text) {
  const raw = String(text || "");
  if (!raw || raw.includes("?") || FORM_MSG_RX.test(raw) || PRICE_ASK_RX.test(raw)) return null;
  if (PAIN_OEM_RX.test(raw)) return "oem";
  if (PAIN_PRICE_RX.test(raw)) return "price";
  if (PAIN_ADS_RX.test(raw)) return "ads";
  return null;
}
export const leadEngaged = (msgs) => msgs.some((m) => {
  if (m.direction !== "in") return false;
  const t = String(m.transcript || m.text || "");
  return !FORM_MSG_RX.test(t) && (INTEREST_RX.test(t) || SCHEDULE_ASK_RX.test(t) || HAS_HOUR_RX.test(t) || !!statedPainOf(t));
});
// Resposta que NÃO responde a pergunta pendente (R-047): saudação, "que bom",
// "ok", "e você?", reação, emoji.
export const NON_ANSWER_RX = /^(?:que bom|legal|ok|okay|blz|beleza|entendi|show|top|certo|otimo|bacana|massa|ah ta|a ta|ata|hum+|kk+|haha+|rs+|sim sim)[.!\s]*$|^(?:tudo (?:bem|bom|certo)|bem)(?:[,!.\s]*e (?:vc|voce|ce|tu|contigo)[?!.\s]*)?$|\be (?:vc|voce|ce|tu)\?*$/;
export function isNonAnswer(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (raw.startsWith("[reaction]") || /^[\p{Extended_Pictographic}\s]+$/u.test(raw)) return true;
  if (GREETING_ONLY_RX.test(raw)) return true;
  return NON_ANSWER_RX.test(plainReply(raw)) && raw.length < 40;
}
// Lead não entendeu a pergunta ou o termo (R-012, 28/10: Fábio "Nem sei o que
// é isso" recebeu a mesma pergunta de volta, 3x em 60 s).
export const CONFUSED_RX = /nem sei o que (?:e|eh|seria) isso|nao entendi|nao sei o que (?:e|eh|seria)|o que (?:e|eh|seria) (?:isso|oem|esse|essa|codigo oem)|\?\?\?|como assim|que (?:isso|oem)\?|nao sei do que (?:voce|vc|ta|esta) falando|nao faco ideia/;
// Mensagem que fecha a conversa por ora (despedida, agradecimento, "ok"
// solto): a trava de beco não emenda nada em cima dela (R-031).
export const CLOSING_RX = /^(?:ok|okay|blz|beleza|show|fechado|combinado|perfeito|valeu|obrigad[oa]|brigad[oa]|tchau|ate (?:mais|logo|breve|la)|falou|bom dia|boa tarde|boa noite|certo|entendi|ta bom|tudo bem|de boa|tranquilo)(?:[!.,\s]+(?:ok|okay|blz|beleza|show|fechado|combinado|perfeito|valeu|obrigad[oa]|brigad[oa]|tchau|ate (?:mais|logo|breve|la)|falou|entao|entendi|ta bom|tudo bem|de boa|tranquilo|sim))*[!.\s]*$/;
// Pedido de dia/período do lead: aí a oferta pode pular a vaga de hoje.
// "boa tarde"/"bom dia"/"boa noite" é saudação, não período (R-032, caso Daniel
// 15/10), e "amanhã" é dia, não "manhã": lookbehinds iguais aos do parser da
// agenda (sdr-agenda.js). Sem isso a saudação desligava "mais cedo primeiro".
export const PERIOD_ASK_RX = /(?<![\p{L}])(?<!\bbo[am]\s)(?:manh[ãa]|tarde|noite)|depois d[ao]s|antes d[ao]s|a partir d[ao]s|depois d[eo]ss|antes d[eo]ss|mais cedo|semana que vem|pr[óo]xima semana|outra semana|semana seguinte|outro dia|s[óo] (?:na |no )?(?:segunda|ter[çc]a|quarta|quinta|sexta)/iu;
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
// 28/10: "não quero começar", "não quero fazer call", "agora não", "ainda não é
// o momento" também são desinteresse (Helano, Ronaldo, Marcelo, Luciene).
export const NO_INTEREST_RX = /nao tenho (?:mais )?interesse|sem interesse|perdi o interesse|nao (?:quero|preciso|tenho) mais\b|vamos pausar|pausar por enquanto|deixa pra la|nao (?:vou|vamos) (?:seguir|continuar|prosseguir|fechar|contratar)|pode parar|para de (?:me )?mandar|nao me (?:chame|chama|mande|manda|procure|procura) mais|(?:ainda )?nao (?:e|eh) (?:o )?momento|por enquanto nao|agora nao(?: quero| da| consigo)?\b(?!,? (?:mas|porem|so|apenas))|desisti|nao quero (?:fazer )?(?:agendar|marcar|demonstracao|conversa|call|reuniao|video|comecar|participar|seguir|continuar|contratar|nada)|nao quero\b(?! (?:saber|perder|dizer|falar|que|cancelar|remarcar|mudar|trocar|adiar|desmarcar))/;
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
// Pedido de remarcação/adiamento em texto livre (sem a pergunta do robô
// antes). 28/10 (Roberto, Cecilia, Rodrigo): "podemos deixar pra outra
// semana?", "estou em viagem", "se tiver outro horário seria melhor" não
// casavam, e o lembrete lia "podemos" como confirmação.
export const RESCHEDULE_ASK_RX = /remarc|reagend|mudar (?:o |de |esse |pra |para )?(?:hor|dia|data)|trocar (?:o |de |esse )?(?:hor|dia|data)|outro hor|outra hora|outra data|outro dia|outro momento|adiar|(?:deixar|deixa|passar|passa|jogar|joga|ficar|fica|empurrar|mudar|muda|trocar|troca) pra (?:outr[ao]|a |o |depois|mais pra frente|semana|segunda|terca|quarta|quinta|sexta|amanha|proxima)|outra semana|proxima semana|semana que vem|semana seguinte|mais pra frente|(?:estou|to|estarei|vou estar) (?:em )?viage|viajando|nao (?:vou|vamos) (?:conseguir|poder)(?! (?:acessar|abrir|entrar|usar))|nao conseguirei|(?:se )?tiver outro horario|tem outro horario/;
// "Pede pra remarcar/adiar" de verdade (R-042): a regex acima menos a negação
// dela ("não quero remarcar", "não precisa mudar").
export function asksReschedule(text) {
  const t = plainReply(text);
  if (/\bnao (?:quero|precisa|preciso|vou|vamos) (?:remarcar|reagendar|mudar|trocar|adiar)/.test(t)) return false;
  return RESCHEDULE_ASK_RX.test(t);
}
// RAJADA (R-046): tudo que o lead mandou desde a última fala nossa (balões
// com até 10 min entre si), num texto só, do mais antigo pro mais novo. Os
// gates determinísticos leem isto, não só o último balão (28/10, Janaina:
// "Não consigo participar da reunião" + "me explica por áudio?" em dois
// balões, e o cancelamento nunca foi lido).
export function burstInboundText(msgs = [], gapMs = 10 * 60_000) {
  const out = [];
  let lastMs = NaN;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direction !== "in") break;
    const ms = Date.parse(m.at || "");
    if (out.length && Number.isFinite(ms) && Number.isFinite(lastMs) && lastMs - ms > gapMs) break;
    out.unshift(String(m.transcript || m.text || ""));
    if (Number.isFinite(ms)) lastMs = ms;
  }
  return out.filter(Boolean).join(". ");
}
// RETORNO COMBINADO (R-084, 28/10): "me chama na terça", "contato só a partir
// de segunda", "te chamo amanhã" viram um dia; o motor carimba
// sdrLog.callbackAt e a escada (seção 1f) chama nesse dia, em vez de a
// promessa morrer na conversa (Reginaldo, Robson, Othelo, Maurílio).
const CALLBACK_RX = /\bme (?:chama|chame|liga|ligue|procura|procure|manda (?:uma )?mensagem|retorna|retorne)\b|\bte (?:chamo|ligo|procuro|retorno|falo)\b|\bcontato (?:so |somente |apenas )?a partir d[ea]\b|\b(?:so|somente|apenas) (?:a partir d[ea] )?(?:segunda|terca|quarta|quinta|sexta|amanha|semana que vem|proxima semana)\b|\bpode me chamar\b/;
export function callbackDay(text, wnow) {
  const t = plainReply(text);
  if (!CALLBACK_RX.test(t) || !wnow) return null;
  const day = firstDayMentioned(text, wnow);
  return day && day > wnow.toISOString().slice(0, 10) ? day : null;
}
// "Não" seco (ou quase).
const NO_RX = /^(?:nao|n|nop|nope|negativo)[.!\s]*$|^nao (?:consigo|posso|quero|da|vai dar|obrigad[oa])[.!\s]*$/;
// Lead adiou a decisão (R-031/R-041: "Combinado", sem re-oferta).
export const POSTPONE_RX = /\bte (?:retorno|respondo|aviso|chamo|falo)\b|\bdepois (?:eu )?te\b|\bmais tarde\b|\b(?:vou|preciso|tenho que|deixa eu) (?:ver|falar|conversar|alinhar) com\b|\bme (?:da|de) um tempo\b|\bvou pensar\b|\bt aviso\b|\bte aviso\b|\bqualquer coisa (?:eu )?te chamo\b/;
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

// TERCEIRO INDICADO (R-043, 28/10: Alexandre "11998116287 Chama Larissa
// explica para ela como funciona"; Flavio mandou o cartão da gerente). O lead
// pede pra falar com outra pessoa e dá o número (texto ou cartão 👤): o motor
// cria o card do indicado e chama. Sem número, pede o número.
// Só com VERBO de ação (chama/fala com/explica pra/passa pra/pedir pra
// chamar/te passo o contato): "esse número é do meu sócio" não é pedido.
export const REFERRAL_RX = /\bchama(?:r)?\s+(?!(?:aqui|ai|depois|amanha|mais|hoje|agora|a gente|voce|vcs|voces|no|na|me|comigo|que|quando|sim|nao|um tempinho|antes)\b)[a-z]+|\bexplica(?:r)? (?:pra|para) (?:ela|ele)\b|\bfal(?:a|ar|e)\s+com\s+(?:a |o |minha |meu |nossa |nosso )(?!mim\b)|\bcontato\s+(?:d[ao]|dela|dele)\s+(?:minha |meu |nossa |nosso )?(?:gerente|socio|socia|responsavel|gestor|gestora|esposa|marido)|\b(?:vou te |te )?pass(?:o|ar)\s+(?:o|um)\s+(?:numero|contato)\b|\bpassa pra (?:ela|ele)\b|\bpedir (?:pra|para) (?:chamar|falar|ligar)\b|\bconversa com (?:ela|ele)\b|\bliga pra (?:ela|ele|minha|meu)\b/;
const CARD_RX = /👤\s*([^·\n]+?)\s*(?:·|$)/;
const PHONE_RX = /\+?\d[\d\s().-]{7,}\d/g;
export function referralIn(text, { ownPhone = "" } = {}) {
  const raw = String(text || "");
  const plain = plainReply(raw);
  const card = raw.match(CARD_RX);
  const asked = REFERRAL_RX.test(plain) || !!card;
  if (!asked) return null;
  const own = String(ownPhone || "").replace(/\D/g, "").slice(-8);
  const phones = [...raw.matchAll(PHONE_RX)].map((m) => m[0].replace(/\D/g, "")).filter((d) => d.length >= 10 && d.length <= 13 && !(own && d.endsWith(own)));
  let phone = phones[0] || "";
  if (phone && !phone.startsWith("55") && (phone.length === 10 || phone.length === 11)) phone = `55${phone}`;
  let name = card ? card[1].trim() : "";
  if (!name) {
    const m = raw.match(/(?:[Cc]hama(?:r)?|[Ff]ala(?:r)? com|[Cc]ontato d[ao]|[Pp]assa pra|[Ee]xplica pra)\s+(?:a |o |minha |meu |nossa |nosso )?([A-ZÀ-Ú][\wÀ-ú]+)/) || raw.match(/(?:^|\s)[ée] [ao] ([A-ZÀ-Ú][\wÀ-ú]+)/);
    if (m && !/^(?:Ela|Ele|Ela\b|Bom|Boa|Para|Pra)$/.test(m[1])) name = m[1];
  }
  return { phone, name: name.slice(0, 60), asked: true };
}
