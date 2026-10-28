// Janela de OFERTA do robô SDR: que dias e horas entram na lista que a IA
// recebe. Regra do Leo (30/09/2026): a oferta espontânea cobre HOJE (quando
// ainda há vaga com 2h de folga) e o PRÓXIMO DIA ÚTIL; outros dias, períodos e
// horas só entram quando o LEAD pede. Lotação nunca amplia a janela sozinha;
// a agenda manual do cockpit fica intacta.
//
// O parser do pedido é o que mais custava (raio-x 30/09): 8 de 14 frases
// reais de leads NÃO viravam pedido ("Esse horário nao consigo pode ser
// quarta", "Amanhã eu não consigo. Teria que ser quarta", "Consigo no período
// da tarde", "Mais sim na terça feira", "Poderíamos passar amanhã?"), e cada
// uma virava handoff pra gente marcar na mão no dia seguinte.
import { slotsForLead, wallNow, wallFromNaive, addBusinessDaysNaive, OFFER_HOURS } from "../crm/agenda-slots.js";
import { isOfferMsg, expandSameDay, offeredSlotsIn } from "./sdr-signals.js";

const ymd = (d) => d.toISOString().slice(0, 10);
const normalize = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const dayPlus = (d, n) => { const out = new Date(d); out.setUTCDate(out.getUTCDate() + n); return out; };
const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

function concreteDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

// Fala que cita data sem pedir reunião: "te respondo sexta", "comecei segunda".
const NOT_A_REQUEST_RX = /te (?:falo|chamo|respondo|retorno)|(?:desde|comprei|comecei|vendi|vendeu|vende|vendemos|vendendo)\b|mercado livre|quero saber mais sobre/;
// Verbos e palavras que fazem de uma data um PEDIDO ("pode ser quarta?", "só
// sexta", "sim, terça", "poderíamos passar amanhã?").
// "como estaria sua agenda na sexta?" (Daniel, 15/10): perguntar pela nossa
// agenda num dia É pedir esse dia.
// "estarei livre", "estou de folga", "consigo só" (28/10: "Na sexta feira
// estarei livre" não virava pedido e o robô disse que a sexta tinha lotado).
const ASKED_RX = /\b(?:pode|posso|poderei|poderia|poderiamos|podia|podiamos|podemos|consigo|conseguimos|conseguiria|conseguirei|da|dava|daria|tem|teria|quero|prefiro|preferia|preciso|vamos|disponivel|disponibilidade|agenda|agendar|agendamento|estaria|estarei|(?:to|estou|fico|vou estar|estaremos|ficamos) (?:livre|de folga|liberad[ao]s?|disponive(?:l|is))|marcar|remarcar|reuniao|call|horario|so|apenas|sim|ok|okay|beleza|bora|fechado|combinado|perfeito|certo|passar|deixar|deixa|mudar|trocar|ficar|fica|melhor|encaixa|encaixar|talvez|quem sabe|entao)\b/;
// Negação que RECUSA o que vem antes dela ("amanhã não consigo", "não posso
// amanhã"). Dia citado DEPOIS dela com uma pista de alternativa no meio
// ("não consigo, pode ser quarta") é o pedido, não a recusa.
// 28/10 (Alberto): "hoje não conseguirei", "minha agenda hj tá cheia", "sem
// tempo" também são recusa; antes "tá cheia" nem era negação e a palavra
// "agenda" fazia da frase um PEDIDO de hoje.
const NEG_RX = /\bnao\s+(?:posso|consigo|conseguimos|conseguirei|conseguiria|da|pode|quero|vou (?:poder|conseguir)|vai (?:dar|rolar)|tenho (?:disponibilidade|como|tempo)|tem como|rola|da pra mim)\b|\b(?:ta|esta|estou|to|tenho a agenda|agenda)\s+(?:bem |muito |super |toda )?(?:cheia|cheio|lotad[ao]|complicad[ao]|corrid[ao]|ocupad[ao]|apertad[ao]|tomad[ao])\b|\bsem tempo\b|\bimpossivel\b|\bnao[.!?\s]*$/;
const ALT_CUE_RX = /\b(?:pode|poderia|podemos|poderiamos|teria|tem|so|apenas|prefiro|prefiria|melhor|consigo|conseguimos|da|daria|dava|vamos|deixa|passa|passar|fica|ficar|quem sabe|talvez|entao|seria|ser)\b/;
const DAY_RX = /depois de amanha|amanha|\bhoje\b|\bhj\b|segunda(?:[- ]feira)?|terca(?:[- ]feira)?|quarta(?:[- ]feira)?|quinta(?:[- ]feira)?|sexta(?:[- ]feira)?|sabado|domingo|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|\bdia \d{1,2}\b|\b\d{1,2} de [a-z]+|semana que vem|proxima semana|outra semana|semana seguinte|outro dia|outros dias|proximos dias|daqui a \d+ dias?/g;
const NEXT_WEEK_RX = /semana que vem|proxima semana|outra semana|semana seguinte/;
// Período do dia. "depois das 15h"/"a partir das 14h"/"antes das 11h" são
// restrições de hora; "de manhã"/"à tarde"/"de noite" viram faixas.
// Hora escrita "1800", "18:00", "18hs", "18 horas" (28/10: "só consigo depois
// das 1800" não era lido e o robô ofereceu 14h).
const HOUR_BOUND_RX = /\b(depois|apos|a partir|antes)\s+(?:d[aeo]s?|[ao]s?)\s*(\d{1,2})(?::?[0-5]\d)?\s*(?:h\d{0,2}|hs|hrs|horas)?\b/;
// "Fora do horário comercial", "depois do expediente", "sou CLT", "só à noite":
// o lead só pode no fim do dia (28/10, Everton/VitorMatheus: o robô insistia no
// par da manhã e dizia que só atende em horário comercial).
const LATE_RX = /fora do (?:horario )?comercial|(?:depois|apos|fora) do (?:expediente|trabalho|servico|horario de trabalho)|(?:so|apenas|somente) (?:a |de |pela )?noite|(?:final|fim) do dia|\bclt\b|(?:em |no )?horario comercial (?:eu |nos |a gente )?nao/;
// Saudação ("olá, boa tarde", "boa noite") NÃO é pedido de período (15/10: o
// "boa tarde" de ontem virou janela "à tarde" ancorada em ontem, e hoje o
// robô disse que não tinha horário nenhum).
const PERIOD_RX = /\b(?:de|pela|a|na|no|de|do|da|no periodo da|no periodo de|periodo da|periodo de)?\s*\b(?<!\bbo[am]\s)(manha|tarde|noite)\b/;
const PERIODS = { manha: { fromHour: 6, toHour: 12 }, tarde: { fromHour: 12, toHour: 19 }, noite: { fromHour: 18, toHour: 21 } };
const HAS_HOUR_RX = /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b/;
// Restrição RELATIVA ao par que o robô acabou de oferecer (Leo, 13/10: o lead
// respondeu "só depois desse horário" a "9h ou 11h" e o robô repetiu 9h ou
// 11h três vezes). "depois desse/disso", "mais tarde" = acima da maior hora
// oferecida; "antes desse", "mais cedo" = abaixo da menor. Só vale com uma
// oferta na conversa: sem ela não há "esse horário" pra se referir.
const LATER_RX = /\b(?:depois|apos)\s+(?:d[eo]ss[ea]s?|d[eo]st[ea]s?|disso)\b|\bmais tarde\b/;
const EARLIER_RX = /\bantes\s+(?:d[eo]ss[ea]s?|d[eo]st[ea]s?|disso)\b|\bmais cedo\b/;
// Cláusula de MOTIVO ("pq a minha operação é toda na parte da manhã"): a
// pessoa explica por que não pode, não pede. Período citado ali não é pedido;
// dia e hora ainda contam ("porque sexta eu viajo" segue sendo recusa).
const REASON_SPLIT_RX = /\b(?:porque|pq|pois|ja que|visto que)\b/;
const REASON_RX = /^(?:porque|pq|pois|ja que|visto que)\b/;

// Faixa de horas pedida na cláusula (ou null). Depois de uma negação sem
// pista de alternativa, "manhã/tarde/noite" é recusa, não pedido; "depois
// das 15h" é sempre restrição (alternativa por natureza).
function periodOf(t, negIdx, offer = null) {
  const bound = t.match(HOUR_BOUND_RX);
  if (bound) {
    const h = Number(bound[2]);
    if (h >= 0 && h <= 23) return bound[1] === "antes" ? { fromHour: null, toHour: h } : { fromHour: h, toHour: null };
  }
  if (LATE_RX.test(t)) return { fromHour: PERIODS.noite.fromHour, toHour: null };
  if (offer?.hours?.length) {
    if (LATER_RX.test(t)) return { fromHour: Math.max(...offer.hours) + 1, toHour: null, relative: true };
    if (EARLIER_RX.test(t)) return { fromHour: null, toHour: Math.min(...offer.hours), relative: true };
  }
  const m = t.match(PERIOD_RX);
  if (!m) return null;
  const idx = t.indexOf(m[1]);
  if (negIdx >= 0 && idx > negIdx && !ALT_CUE_RX.test(t.slice(negIdx, idx))) return null;
  if (negIdx >= 0 && idx < negIdx) return null;
  return { ...PERIODS[m[1]] };
}

// Uma cláusula → { date, days, period, refused, refusal } (qualquer um pode
// faltar) ou null. `refused`: dias que o lead RECUSOU ("hoje não consigo");
// `refusal`: a cláusula é uma negação sem dia novo ("nesse horário não dá").
function parseClause(t, at, offer = null) {
  t = t.trim();
  if (!t || NOT_A_REQUEST_RX.test(t)) return null;
  const negIdx = t.search(NEG_RX);
  const reason = REASON_RX.test(t);
  const period = reason ? null : periodOf(t, negIdx, offer);
  const mentions = [...t.matchAll(DAY_RX)].map((m) => ({ text: m[0], idx: m.index }));
  // Dia recusado: antes da negação, ou logo depois dela sem pista de alternativa.
  const candidates = mentions.filter((m) => negIdx < 0 || (m.idx > negIdx && ALT_CUE_RX.test(t.slice(negIdx, m.idx))));
  const refused = negIdx < 0 ? [] : mentions.filter((m) => !candidates.includes(m))
    .map((m) => mentionDate(m.text, t, at)).filter(Boolean).flatMap((d) => {
      const out = [];
      for (let i = 0; i < Math.min(d.days, 7); i++) out.push(ymd(dayPlus(d.date, i)));
      return out;
    });
  const pick = candidates[0] || null;
  if (!pick) {
    if (period) return { period, refused };
    return refused.length ? { refused } : negIdx >= 0 ? { refusal: true } : null;
  }
  // Data citada de passagem ("fechei a loja quarta") não é pedido: sobra texto
  // sem nenhum verbo de pedido. Alternativa depois de negação já é pedido.
  // Dias ligados por "ou"/"e" e "que vem" são parte do pedido, não sobra (Leo,
  // 08/10: "terça ou quarta" e "quarta que vem" não viravam pedido e o robô
  // ofereceu segunda).
  let bare = t;
  for (const m of mentions) bare = bare.replace(m.text, "");
  bare = bare.replace(/(?:\bque vem\b|\bproxim[ao]\b|\btambem\b|\bou\b|\be\b|\bas?\b|\bde\b|\bpela\b|\bna\b|\bno\b|\bpara\b|\bpra\b|\bmanha\b|\btarde\b|\bnoite\b|\d{1,2}(?:h\d{0,2}|:\d{2})?|[\s,.!?])/g, "");
  const alternative = negIdx >= 0 && pick.idx > negIdx;
  const noPick = () => (period ? { period, refused } : refused.length ? { refused } : null);
  if (bare && !alternative && !ASKED_RX.test(t)) return noPick();
  const first = mentionDate(pick.text, t, at);
  if (!first) return noPick();
  let { date, days } = first;
  // "terça ou quarta": a janela cobre do primeiro ao último dia citado.
  if (candidates.length >= 2 && days === 1) {
    const last = mentionDate(candidates[candidates.length - 1].text, t, at);
    const span = last ? Math.round((last.date.getTime() - date.getTime()) / 86_400_000) : 0;
    if (span > 0 && span <= 7) days = span + 1;
  }
  return { date, days, period, refused };
}

// Uma menção de dia ("quarta", "amanhã", "dia 30", "15/10") → { date, days }
// ou null. Datas numéricas e por extenso são lidas da cláusula inteira.
function mentionDate(pickText, t, at) {
  let date;
  let days = 1;
  const pick = { text: pickText };
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  const numbered = t.match(/\bdia (\d{1,2})\b/);
  const namedMonth = t.match(new RegExp(`\\b(\\d{1,2}) de (${months.join("|")})(?: de (\\d{4}))?\\b`));
  const relative = t.match(/\bdaqui a (\d+) dias?\b/);
  const weekday = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(pick.text));
  if (iso) date = concreteDate(+iso[1], +iso[2], +iso[3]);
  else if (numeric) {
    date = concreteDate(+(numeric[3] || at.getUTCFullYear()), +numeric[2], +numeric[1]);
    if (date && !numeric[3] && ymd(date) < ymd(at)) date = concreteDate(at.getUTCFullYear() + 1, +numeric[2], +numeric[1]);
  } else if (namedMonth) {
    const month = months.indexOf(namedMonth[2]) + 1;
    date = concreteDate(+(namedMonth[3] || at.getUTCFullYear()), month, +namedMonth[1]);
    if (date && !namedMonth[3] && ymd(date) < ymd(at)) date = concreteDate(at.getUTCFullYear() + 1, month, +namedMonth[1]);
  } else if (numbered) {
    const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + (+numbered[1] < at.getUTCDate() ? 1 : 0), 1));
    date = concreteDate(month.getUTCFullYear(), month.getUTCMonth() + 1, +numbered[1]);
  } else if (NEXT_WEEK_RX.test(pick.text)) {
    date = dayPlus(at, (8 - at.getUTCDay()) % 7 || 7);
    if (weekday >= 0) date = dayPlus(date, (weekday + 6) % 7);
    else days = 5;
  } else if (/outro dia|outros dias|proximos dias/.test(pick.text)) {
    date = wallFromNaive(addBusinessDaysNaive(ymd(at), 2));
    days = 5;
  } else if (relative) date = dayPlus(at, +relative[1]);
  else if (/depois de amanha/.test(pick.text)) date = dayPlus(at, 2);
  else if (/amanha/.test(pick.text)) date = dayPlus(at, 1);
  else if (/\b(?:hoje|hj)\b/.test(pick.text)) date = at;
  else if (weekday >= 0) date = dayPlus(at, (weekday - at.getUTCDay() + 7) % 7 || 7);
  if (!date || !Number.isFinite(date.getTime())) return null;
  return { date, days };
}

// A mensagem inteira → pedido { startDate, days, fromHour?, toHour?,
// requested: true } ou null. Cláusulas por vírgula, ponto, "mas": o DIA vem
// da última cláusula que pede um; o PERÍODO, da última que cita um. Assim
// "Amanhã eu não consigo. Teria que ser quarta" pede quarta, e "quarta, de
// manhã" pede quarta de manhã.
// Sem pedido mas com recusa ("hoje não consigo", "nesse horário não dá"):
// devolve { requested: false, refused: [dias], refusal: true } pra quem monta
// a janela tirar o que foi recusado (28/10, Alberto/Wilian: o robô repetia o
// mesmo par porque a recusa não mudava nada na lista).
function requestedWindow(text, at, offer = null) {
  const t = normalize(text).trim();
  if (!t) return null;
  // O motivo vira cláusula própria, começando pela conjunção, pra parseClause
  // saber que ali ninguém está pedindo período.
  const clauses = t.replace(REASON_SPLIT_RX, (m) => `. ${m}`).split(/[,;.!?]|\bmas\b|\bporem\b/).map((s) => s.trim()).filter(Boolean);
  let day = null, period = null, refusal = false;
  const refused = new Set();
  for (const c of clauses) {
    const r = parseClause(c, at, offer);
    if (!r) continue;
    if (r.date) day = r;
    if (r.period) period = r.period;
    if (r.refusal) refusal = true;
    for (const d of r.refused || []) refused.add(d);
  }
  if (!day && !period) return refused.size || refusal ? { requested: false, refused: [...refused], refusal: true } : null;
  const out = { requested: true, refused: [...refused] };
  if (day) { out.startDate = ymd(day.date); out.days = day.days; }
  else if (period.relative && offer?.startDate && offer.startDate >= ymd(at)) {
    // "Depois desse horário": do dia oferecido em diante, dentro da faixa.
    out.startDate = offer.startDate; out.days = 5; out.periodOnly = true;
  } else {
    // Só período: hoje (dia útil) em diante, 5 dias úteis dentro da faixa.
    const start = isWeekend(at) ? wallFromNaive(addBusinessDaysNaive(ymd(at), 1)) : at;
    out.startDate = ymd(start); out.days = 5; out.periodOnly = true;
  }
  if (period) {
    if (period.fromHour != null) out.fromHour = Math.max(OFFER_HOURS.fromHour, period.fromHour);
    if (period.toHour != null) out.toHour = Math.min(OFFER_HOURS.toHour, period.toHour);
  }
  return out;
}

// O que a nossa oferta disse: as horas citadas e o dia (lido com o mesmo
// parser do pedido, relativo a quando a oferta saiu).
function offeredWindow(text, at) {
  const t = normalize(expandSameDay(text));
  const hours = [...t.matchAll(/\b(\d{1,2})\s?h(?:\d{2})?\b|\b(\d{1,2}):\d{2}\b/g)].map((m) => Number(m[1] ?? m[2])).filter((h) => h >= 0 && h <= 23);
  // "Tenho agenda para amanhã…" não tem verbo de pedido (é a nossa oferta,
  // não um pedido do lead): o dia é lido direto da primeira menção.
  const day = t.match(new RegExp(DAY_RX.source));
  const d = day ? mentionDate(day[0], t, at) : null;
  return { hours, startDate: d ? ymd(d.date) : null };
}

// Janela ESPONTÂNEA: hoje (se for dia útil; a folga de 2h do slotsForLead
// tira o que já está em cima) e o próximo dia útil. Fim de semana: só a
// segunda.
export function defaultWindow(now) {
  if (isWeekend(now)) return { startDate: addBusinessDaysNaive(ymd(now), 1).slice(0, 10), days: 1, requested: false };
  return { startDate: ymd(now), days: 2, requested: false };
}

// Último dia coberto pela janela (aproximado em dias corridos: basta pra
// saber se ela ficou inteira no passado).
const lastDayOf = (w) => ymd(dayPlus(wallFromNaive(w.startDate), Math.max(0, (w.days || 1) - 1) + (w.days > 1 ? 2 : 0)));

// RAJADA LIDA INTEIRA (28/10): mensagens seguidas do lead, sem fala nossa no
// meio e com menos de 10 min entre elas, viram um texto só antes de virar
// pedido. "Hoje não conseguirei!" + "Na sexta feira estarei livre" em dois
// balões é UM pedido de sexta; lidos um a um, o segundo caía e o primeiro
// não dizia nada. Mensagem nossa entre elas fecha o grupo.
const BURST_GAP_MS = 10 * 60_000;
function groupBursts(messages) {
  const out = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    const ms = Date.parse(m.at || "");
    if (m.direction === "in" && prev && prev.direction === "in" && (!Number.isFinite(ms) || !Number.isFinite(prev.lastMs) || ms - prev.lastMs <= BURST_GAP_MS)) {
      prev.texts.push(String(m.transcript || m.text || ""));
      prev.lastMs = Number.isFinite(ms) ? ms : prev.lastMs;
      prev.last = m;
      continue;
    }
    out.push({ direction: m.direction, texts: [String(m.transcript || m.text || "")], first: m, last: m, lastMs: ms });
  }
  return out;
}

// Pedido vale enquanto a conversa escolhe o horário, inclusive "14h" na
// mensagem seguinte. Nunca interpreta fala do robô como pedido do cliente.
// Pedido que ficou inteiro no PASSADO ("amanhã" dito na segunda, lido na
// quinta) é esquecido: antes zerava a oferta e o robô perguntava "qual outra
// data?" pra quem só queria marcar.
// `callAt`: com call marcada e o lead falando só de HORA ("13h estou
// almoçando, pode ser 14h?"), o dia é o da call, não o próximo dia útil.
// Devolve também `refused` (dias recusados, de hoje em diante) e `exclude`
// (horários da nossa última oferta que o lead recusou sem pedir outro):
// sdrSlotsForLead tira os dois da lista, e a janela espontânea anda pro
// próximo dia útil quando o dia recusado era o dela.
export function sdrAgendaWindow(messages = [], now = wallNow(), { callAt = "" } = {}) {
  let window = defaultWindow(now);
  let lastIn = null;
  let offer = null; // a última oferta nossa: { hours, startDate } pra "depois desse horário"
  let offerMsg = null; // a mensagem da última oferta nossa (pra excluir o que foi recusado)
  const refused = new Set();
  let exclude = [];
  for (const g of groupBursts(messages.slice(-24))) {
    const m = g.last;
    const parsedAt = m.at ? wallNow(new Date(m.at)) : now;
    const at = Number.isFinite(parsedAt.getTime()) ? parsedAt : now;
    if (g.direction !== "in") {
      if (isOfferMsg(g.texts[0] || "")) { offer = offeredWindow(g.texts[0], at); offerMsg = m; exclude = []; }
      continue;
    }
    lastIn = m;
    const requested = requestedWindow(g.texts.join(". "), at, offer);
    if (!requested) continue;
    for (const d of requested.refused || []) if (d >= ymd(now)) refused.add(d);
    if (!requested.requested) {
      // Recusa sem dia novo: o que a gente tinha acabado de oferecer sai da
      // próxima lista (R-040). "Hoje não dá" tira o dia inteiro (refused).
      if (offerMsg && !requested.refused?.length) exclude = offeredSlotsIn([offerMsg], offerMsg.author || "sdr-bot").map((s) => s.at);
      continue;
    }
    if (lastDayOf(requested) < ymd(now)) { window = defaultWindow(now); continue; }
    window = requested;
  }
  // Pedido SÓ de período feito num dia anterior ("consigo à tarde", dito
  // ontem): a preferência continua, o dia anda pra hoje. Antes a janela ficava
  // ancorada no passado e sdrSlotsForLead devolvia lista vazia (15/10, Daniel).
  if (window.periodOnly && window.startDate < ymd(now)) {
    const start = isWeekend(now) ? wallFromNaive(addBusinessDaysNaive(ymd(now), 1)) : now;
    window = { ...window, startDate: ymd(start) };
  }
  if (!window.requested && callAt && lastIn && HAS_HOUR_RX.test(normalize(lastIn.transcript || lastIn.text))) {
    const callDay = String(callAt).slice(0, 10);
    if (callDay >= ymd(now)) return { startDate: callDay, days: 1, requested: true, callDay: true };
  }
  // Janela espontânea cujo primeiro dia foi recusado ("hj não consigo"): anda
  // pro próximo dia útil que não foi recusado, mantendo os 2 dias.
  if (!window.requested && refused.size) {
    let start = window.startDate;
    for (let i = 0; i < 10 && refused.has(start); i++) start = addBusinessDaysNaive(start, 1).slice(0, 10);
    window = { ...window, startDate: start };
  }
  const { refused: _r, ...rest } = window;
  return { ...rest, ...(refused.size ? { refused: [...refused].sort() } : {}), ...(exclude.length ? { exclude } : {}) };
}

export async function sdrSlotsForLead(repo, { messages = [], now = wallNow(), ...options } = {}) {
  const window = sdrAgendaWindow(messages, now, { callAt: options.lead?.callAt || "" });
  const { periodOnly, callDay, refused = [], exclude = [], ...winOpts } = window;
  // O que o lead recusou não volta (R-040): horários da última oferta e dias
  // inteiros ("hoje não dá").
  const drop = (slots) => slots.filter((s) => !exclude.includes(s.at) && !refused.includes(String(s.at).slice(0, 10)));
  // Pedido passado ou de fim de semana não vira oferta de outro dia sozinho.
  const day = wallFromNaive(window.startDate).getUTCDay();
  if (window.startDate < ymd(now) || (window.days === 1 && (day === 0 || day === 6))) return { slots: [], ...window };
  const result = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...winOpts, sdr: true });
  result.slots = drop(result.slots);
  if (result.slots.length) return { ...result, ...window };
  if (!window.requested) {
    // A recusa esvaziou a janela espontânea: próximo dia útil depois dela.
    if (!exclude.length && !refused.length) return { ...result, ...window };
    const nextStart = addBusinessDaysNaive(lastDayOf(window), 1).slice(0, 10);
    const more = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, startDate: nextStart, days: 2, sdr: true });
    more.slots = drop(more.slots);
    return { ...more, ...window, startDate: nextStart, days: 2, extended: true };
  }
  // O PEDIDO DO LEAD NÃO TEM VAGA. Em vez de lista vazia (que virava "vou
  // reservar e te confirmo" + handoff), a IA recebe as alternativas mais
  // próximas na janela normal e diz que o pedido lotou.
  const alt = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...defaultWindow(now), sdr: true });
  alt.slots = drop(alt.slots);
  if (!alt.slots.length && (exclude.length || refused.length)) {
    // "Amanhã não consigo, teria que ser sexta" com a sexta cheia: amanhã
    // foi recusado, então as alternativas vêm dos 5 dias úteis seguintes.
    const wider = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...defaultWindow(now), days: 5, sdr: true });
    wider.slots = drop(wider.slots);
    return { ...wider, ...window, requestedEmpty: true };
  }
  return { ...alt, ...window, requestedEmpty: true };
}
