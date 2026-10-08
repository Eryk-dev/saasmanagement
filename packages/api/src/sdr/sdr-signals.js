// Sinais compartilhados entre o motor determinístico (sdr-flow.js) e o cérebro
// (sdr-brain.js) sobre o que o LEAD escreveu. Régua única de propósito: o
// mesmo texto tem que valer "resposta" ou "não resposta" nas duas frentes.
//
// MENSAGEM PRONTA DO FORM NÃO É RESPOSTA. O form joga o lead pro WhatsApp com
// o texto pré-preenchido ("Oi, me chamo X e quero saber mais sobre…") e ele só
// aperta enviar. Contar isso como "o lead respondeu" fazia a escada de
// retomada tratar como MORNO (relógio de 3 dias, e a MESMA retomada do 2º
// toque de novo) quem nunca disse uma palavra própria: 44 das 147 conversas
// mortas de 17 a 30/09 eram exatamente "form → pergunta de descoberta → nada".
export const FORM_MSG_RX = /quero saber mais sobre|resumo da minha opera|minha opera[çc][ãa]o:/i;

export const isFormMessage = (m) => FORM_MSG_RX.test(String(m?.transcript || m?.text || ""));

// Resposta DE VERDADE do lead: mensagem recebida que não é o texto do form.
export const isRealReply = (m) => m?.direction === "in" && !isFormMessage(m);

// Última resposta real do lead na conversa (undefined se ele nunca falou).
export const lastRealReply = (msgs = []) => [...msgs].reverse().find(isRealReply);

// ── Oferta de horário ───────────────────────────────────────────────────────
// OFERTA DE VERDADE ≠ qualquer menção de horário. "Consigo hoje às 14h ou
// amanhã às 9h, qual fica melhor?" é oferta; "agendado então pra amanhã
// (17/09) às 13h", "nossa conversa é hoje às 13h" (lembrete) e "confirmando
// nossa conversa amanhã às 13h" NÃO são. O robô do Renan (16/09) leu o próprio
// lembrete como "horários que te passei" e insistiu numa oferta que nunca fez.
export const SLOTS_RX = /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo) às \d{1,2}h/i;
// "Tenho agenda para … Qual funciona melhor para você?" é a oferta do roteiro
// Lever OEM (Leo, 05/10): entra na régua pra slotsOffered/cobrança/aceite.
export const OFFER_CUE_RX = /consigo|tenho .*(?:livre|dispon)|tenho agenda|qual fica melhor|qual funciona melhor|fica bom pra voc|funciona para voc|pode ser\?|encaix|op[çc][õo]es|ficou /i;
export const NOT_OFFER_RX = /nossa conversa|agendad|remarcad|confirmando|est[áa] tudo certo|te espero|come[çc]a em|separou|marcad[oa] (?:ent[ãa]o )?pra/i;
export const isOfferMsg = (t) => SLOTS_RX.test(t || "") && OFFER_CUE_RX.test(t || "") && !NOT_OFFER_RX.test(t || "");

// MESMO DIA, DIA UMA VEZ (Leo, 08/10): "segunda às 9h ou segunda às 13h"
// repete o dia à toa; a oferta sai "segunda às 9h ou às 13h". Dias diferentes
// seguem com o dia em cada hora ("terça às 17h ou quarta às 17h").
// `expandSameDay` é o inverso, pra quem LÊ a oferta de volta (offeredSlotsIn
// e a validação do motor): "amanhã às 9h ou às 11h" vira "amanhã às 9h ou
// amanhã às 11h" antes de virar slot.
const DAY_LABEL_SRC = "(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)((?: \\d{2}\\/\\d{2})?)";
const SAME_DAY_PAIR_RX = new RegExp(`\\b${DAY_LABEL_SRC} [àa]s (\\d{1,2}h\\d{0,2})(,| ou| e) \\1\\2 [àa]s (\\d{1,2}h\\d{0,2})`, "gi");
const BARE_SECOND_RX = new RegExp(`\\b${DAY_LABEL_SRC} [àa]s (\\d{1,2}h\\d{0,2})(,| ou| e) [àa]s (\\d{1,2}h\\d{0,2})`, "gi");
const rewriteUntilStable = (text, rx, fn) => {
  let t = String(text || "");
  for (let i = 0; i < 3; i++) {
    const next = t.replace(rx, fn);
    if (next === t) break;
    t = next;
  }
  return t;
};
export const collapseSameDay = (text) => rewriteUntilStable(text, SAME_DAY_PAIR_RX, (_, day, dm, h1, sep, h2) => `${day}${dm} às ${h1}${sep} às ${h2}`);
export const expandSameDay = (text) => rewriteUntilStable(text, BARE_SECOND_RX, (_, day, dm, h1, sep, h2) => `${day}${dm} às ${h1}${sep} ${day}${dm} às ${h2}`);

// ACEITE curto do lead ("pode", "certo", "sim", "fechado"), no texto já
// normalizado (sem acento, minúsculo).
export const ACCEPT_RX = /(^|\s)(sim|pode|pode ser|pode sim|certo|ok|okay|beleza|blz|fechado|combinado|perfeito|bora|vamos|isso|confirmo|topo|top|show|claro|serve|otimo|maravilha)(\s|[!.,)]|$)/;

// Horários que o robô OFERTOU na última oferta da conversa, em valor naive BRT
// ("YYYY-MM-DDTHH:MM"), lidos de volta do texto ("hoje às 14h", "amanhã às
// 9h30", "sexta às 10h", "sexta 04/09 às 10h") relativo ao dia em que a
// oferta saiu. É o que a cobrança do dia seguinte confere na agenda e o que
// o aceite ("pode" + "e o valor?") tem que travar.
const OFFER_LABEL_RX = /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?: (\d{2})\/(\d{2}))? [àa]s (\d{1,2})h(\d{2})?/gi;
const WEEKDAYS_ASCII = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const pad2 = (n) => String(n).padStart(2, "0");
const BRT_MS = 3 * 3_600_000;
export function offeredSlotsIn(msgs = [], botAuthor = "sdr-bot") {
  const last = [...msgs].reverse().find((m) => m.direction === "out" && m.author === botAuthor && isOfferMsg(m.text || ""));
  if (!last) return [];
  const sentAt = Date.parse(last.at || "");
  if (!Number.isFinite(sentAt)) return [];
  const base = new Date(sentAt - BRT_MS); // relógio de parede BRT na hora da oferta (campos UTC)
  const out = [];
  for (const m of expandSameDay(last.text).matchAll(OFFER_LABEL_RX)) {
    const word = m[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    let d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    if (m[2]) d = new Date(Date.UTC(base.getUTCFullYear(), Number(m[3]) - 1, Number(m[2])));
    else if (word === "amanha") d.setUTCDate(d.getUTCDate() + 1);
    else if (word !== "hoje") {
      const wd = WEEKDAYS_ASCII.indexOf(word);
      if (wd >= 0) d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7 || 7));
    }
    const at = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(m[4])}:${m[5] || "00"}`;
    if (!out.some((s) => s.at === at)) out.push({ at, label: m[0] });
  }
  return out;
}

// Qual dos horários ofertados o lead ACEITOU: hora citada ("14h", "as 9", ou o
// NÚMERO SOLTO "18" em resposta à oferta, Leo 08/10) casa com um deles; sem
// hora, um único ofertado é o aceito; dois sem hora = ambíguo. A mesma hora em
// dois dias oferecidos ("terça às 17h ou quarta às 17h" + "17") só casa se o
// lead disse o dia; senão é ambíguo e fica pra pergunta.
export const BARE_HOUR_RX = /^\s*(?:[àa]s\s*)?(\d{1,2})\s*(?:h|hrs|horas)?\s*[.!?]*$/i;
export function acceptedSlot(text, offered = []) {
  const t = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hm = t.match(/\b(\d{1,2})(?:\s?h\s?(\d{2})?|:(\d{2}))\b|\b(?:as|às)\s+(\d{1,2})\b/) || t.match(BARE_HOUR_RX);
  if (hm) {
    const h = Number(hm[1] || hm[4]), mm = hm[2] || hm[3] || "00";
    const exact = offered.filter((s) => s.at.slice(11, 13) === pad2(h) && s.at.slice(14, 16) === mm);
    const byHour = exact.length ? exact : offered.filter((s) => s.at.slice(11, 13) === pad2(h));
    if (byHour.length === 1) return byHour[0];
    if (byHour.length > 1) {
      const named = byHour.find((s) => {
        const day = String(s.label || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(" ")[0];
        return day && new RegExp(`\\b${day}\\b`).test(t);
      });
      return named || null;
    }
  }
  if (offered.length === 1 && ACCEPT_RX.test(t)) return offered[0];
  if (offered.length >= 2 && /\b(?:o )?primeir[oa]\b/.test(t)) return offered[0];
  if (offered.length >= 2 && /\b(?:o )?segund[oa]\b/.test(t)) return offered[1];
  return null;
}

// ── Janela de 24h da Meta e o que abre ela ──────────────────────────────────
// REAÇÃO (👍 numa mensagem) chega como mensagem recebida, mas NÃO abre a
// janela de atendimento da Meta: texto livre depois de uma reação é aceito e
// reprovado no webhook (131047). Só mensagem de verdade do lead conta.
export const isReaction = (m) => String(m?.text || "").startsWith("[reaction]");
export const lastWindowInbound = (msgs = []) => [...msgs].reverse().find((m) => m.direction === "in" && !isReaction(m));
export const windowOpenAt = (msgs = [], nowMs = Date.now()) => {
  const last = lastWindowInbound(msgs);
  return !!last && nowMs - Date.parse(last.at || 0) < 24 * 3_600_000;
};

// Resposta AUTOMÁTICA do estabelecimento do lead ("agradece seu contato",
// "digite 1", "deixe sua mensagem"): não é a pessoa falando. Só frases que SÓ
// robô de atendimento escreve — o preço do falso positivo é emudecer com
// gente de verdade.
export const AUTO_REPLY_RX = /agradece (o |pelo )?(seu )?contato|como podemos (te )?ajudar|atendimento autom|escolha uma (das )?op[çc][õo]es|digite (o n[úu]mero|uma? op[çc][ãa]o)|menu de atendimento|hor[áa]rio de atendimento|consulte (o )?nosso (site|estoque|cat[áa]logo)|informe os? \d+ [úu]ltimos|voc[êe] (contatou|entrou em contato com (a|o|nossa|nosso))|deixe (a )?sua mensagem|responderemos assim que|retornaremos (o |seu |em )|n[ãa]o estamos dispon[íi]veis no momento/i;

// Saudação PURA ("bom dia", "oi", "boa tarde!"), sem mais nada: em resposta a
// um lembrete não confirma nem precisa de gente, é a conversa começando.
export const GREETING_ONLY_RX = /^(?:(?:oi+|ol[aá]|opa|bom dia|boa tarde|boa noite|e a[ií]|tudo bem|tudo bom|td bem|bem)[!.,?\s]*){1,3}$/i;
