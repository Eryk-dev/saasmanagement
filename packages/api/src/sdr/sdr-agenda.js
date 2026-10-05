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
const NOT_A_REQUEST_RX = /te (?:falo|chamo|respondo|retorno)|(?:desde|comprei|comecei|vendi|vendeu)\b|quero saber mais sobre/;
// Verbos e palavras que fazem de uma data um PEDIDO ("pode ser quarta?", "só
// sexta", "sim, terça", "poderíamos passar amanhã?").
const ASKED_RX = /\b(?:pode|posso|poderei|poderia|poderiamos|podia|podiamos|podemos|consigo|conseguimos|conseguiria|da|dava|daria|tem|teria|quero|prefiro|preferia|preciso|vamos|disponivel|disponibilidade|agendar|agendamento|marcar|remarcar|reuniao|call|horario|so|apenas|sim|ok|okay|beleza|bora|fechado|combinado|perfeito|certo|passar|deixar|deixa|mudar|trocar|ficar|fica|melhor|encaixa|encaixar|talvez|quem sabe|entao)\b/;
// Negação que RECUSA o que vem antes dela ("amanhã não consigo", "não posso
// amanhã"). Dia citado DEPOIS dela com uma pista de alternativa no meio
// ("não consigo, pode ser quarta") é o pedido, não a recusa.
const NEG_RX = /\bnao\s+(?:posso|consigo|conseguimos|da|pode|quero|vou (?:poder|conseguir)|tenho disponibilidade|vai dar|tem como|rola)\b|\bnao[.!?\s]*$/;
const ALT_CUE_RX = /\b(?:pode|poderia|podemos|poderiamos|teria|tem|so|apenas|prefiro|prefiria|melhor|consigo|conseguimos|da|daria|dava|vamos|deixa|passa|passar|fica|ficar|quem sabe|talvez|entao|seria|ser)\b/;
const DAY_RX = /depois de amanha|amanha|\bhoje\b|\bhj\b|segunda(?:[- ]feira)?|terca(?:[- ]feira)?|quarta(?:[- ]feira)?|quinta(?:[- ]feira)?|sexta(?:[- ]feira)?|sabado|domingo|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|\bdia \d{1,2}\b|\b\d{1,2} de [a-z]+|semana que vem|proxima semana|outro dia|outros dias|proximos dias|daqui a \d+ dias?/g;
// Período do dia. "depois das 15h"/"a partir das 14h"/"antes das 11h" são
// restrições de hora; "de manhã"/"à tarde"/"de noite" viram faixas.
const HOUR_BOUND_RX = /\b(depois|apos|a partir|antes)\s+(?:d[aeo]s?|[ao]s?)\s*(\d{1,2})\s*(?:h\d{0,2}|hs|hrs|horas|:\d{2})?\b/;
const PERIOD_RX = /\b(?:de|pela|a|na|no|de|do|da|no periodo da|no periodo de|periodo da|periodo de)?\s*\b(manha|tarde|noite)\b/;
const PERIODS = { manha: { fromHour: 6, toHour: 12 }, tarde: { fromHour: 12, toHour: 19 }, noite: { fromHour: 18, toHour: 21 } };
const HAS_HOUR_RX = /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b/;

// Faixa de horas pedida na cláusula (ou null). Depois de uma negação sem
// pista de alternativa, "manhã/tarde/noite" é recusa, não pedido; "depois
// das 15h" é sempre restrição (alternativa por natureza).
function periodOf(t, negIdx) {
  const bound = t.match(HOUR_BOUND_RX);
  if (bound) {
    const h = Number(bound[2]);
    if (h >= 0 && h <= 23) return bound[1] === "antes" ? { fromHour: null, toHour: h } : { fromHour: h, toHour: null };
  }
  const m = t.match(PERIOD_RX);
  if (!m) return null;
  const idx = t.indexOf(m[1]);
  if (negIdx >= 0 && idx > negIdx && !ALT_CUE_RX.test(t.slice(negIdx, idx))) return null;
  if (negIdx >= 0 && idx < negIdx) return null;
  return { ...PERIODS[m[1]] };
}

// Uma cláusula → { date, days, period } (qualquer um pode faltar) ou null.
function parseClause(t, at) {
  t = t.trim();
  if (!t || NOT_A_REQUEST_RX.test(t)) return null;
  const negIdx = t.search(NEG_RX);
  const period = periodOf(t, negIdx);
  const mentions = [...t.matchAll(DAY_RX)].map((m) => ({ text: m[0], idx: m.index }));
  // Dia recusado: antes da negação, ou logo depois dela sem pista de alternativa.
  const candidates = mentions.filter((m) => negIdx < 0 || (m.idx > negIdx && ALT_CUE_RX.test(t.slice(negIdx, m.idx))));
  const pick = candidates[0] || null;
  if (!pick) return period ? { period } : null;
  // Data citada de passagem ("fechei a loja quarta") não é pedido: sobra texto
  // sem nenhum verbo de pedido. Alternativa depois de negação já é pedido.
  const bare = t.replace(pick.text, "").replace(/(?:\bas?\b|\bde\b|\bpela\b|\bna\b|\bno\b|\bpara\b|\bpra\b|\bmanha\b|\btarde\b|\bnoite\b|\d{1,2}(?:h\d{0,2}|:\d{2})?|[\s,.!?])/g, "");
  const alternative = negIdx >= 0 && pick.idx > negIdx;
  if (bare && !alternative && !ASKED_RX.test(t)) return period ? { period } : null;
  let date;
  let days = 1;
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
  } else if (/semana que vem|proxima semana/.test(pick.text)) {
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
  if (!date || !Number.isFinite(date.getTime())) return period ? { period } : null;
  return { date, days, period };
}

// A mensagem inteira → pedido { startDate, days, fromHour?, toHour?,
// requested: true } ou null. Cláusulas por vírgula, ponto, "mas": o DIA vem
// da última cláusula que pede um; o PERÍODO, da última que cita um. Assim
// "Amanhã eu não consigo. Teria que ser quarta" pede quarta, e "quarta, de
// manhã" pede quarta de manhã.
function requestedWindow(text, at) {
  const t = normalize(text).trim();
  if (!t) return null;
  const clauses = t.split(/[,;.!?]|\bmas\b|\bporem\b/).map((s) => s.trim()).filter(Boolean);
  let day = null, period = null;
  for (const c of clauses) {
    const r = parseClause(c, at);
    if (!r) continue;
    if (r.date) day = r;
    if (r.period) period = r.period;
  }
  if (!day && !period) return null;
  const out = { requested: true };
  if (day) { out.startDate = ymd(day.date); out.days = day.days; }
  else {
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

// Pedido vale enquanto a conversa escolhe o horário, inclusive "14h" na
// mensagem seguinte. Nunca interpreta fala do robô como pedido do cliente.
// Pedido que ficou inteiro no PASSADO ("amanhã" dito na segunda, lido na
// quinta) é esquecido: antes zerava a oferta e o robô perguntava "qual outra
// data?" pra quem só queria marcar.
// `callAt`: com call marcada e o lead falando só de HORA ("13h estou
// almoçando, pode ser 14h?"), o dia é o da call, não o próximo dia útil.
export function sdrAgendaWindow(messages = [], now = wallNow(), { callAt = "" } = {}) {
  let window = defaultWindow(now);
  let lastIn = null;
  for (const m of messages.slice(-24)) {
    if (m.direction !== "in") continue;
    lastIn = m;
    const parsedAt = m.at ? wallNow(new Date(m.at)) : now;
    const at = Number.isFinite(parsedAt.getTime()) ? parsedAt : now;
    const requested = requestedWindow(m.transcript || m.text, at);
    if (!requested) continue;
    if (lastDayOf(requested) < ymd(now)) { window = defaultWindow(now); continue; }
    window = requested;
  }
  if (!window.requested && callAt && lastIn && HAS_HOUR_RX.test(normalize(lastIn.transcript || lastIn.text))) {
    const callDay = String(callAt).slice(0, 10);
    if (callDay >= ymd(now)) return { startDate: callDay, days: 1, requested: true, callDay: true };
  }
  return window;
}

export async function sdrSlotsForLead(repo, { messages = [], now = wallNow(), ...options } = {}) {
  const window = sdrAgendaWindow(messages, now, { callAt: options.lead?.callAt || "" });
  const { periodOnly, callDay, ...winOpts } = window;
  // Pedido passado ou de fim de semana não vira oferta de outro dia sozinho.
  const day = wallFromNaive(window.startDate).getUTCDay();
  if (window.startDate < ymd(now) || (window.days === 1 && (day === 0 || day === 6))) return { slots: [], ...window };
  const result = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...winOpts, sdr: true });
  if (result.slots.length || !window.requested) return { ...result, ...window };
  // O PEDIDO DO LEAD NÃO TEM VAGA. Em vez de lista vazia (que virava "vou
  // reservar e te confirmo" + handoff), a IA recebe as alternativas mais
  // próximas na janela normal e diz que o pedido lotou.
  const alt = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...defaultWindow(now), sdr: true });
  return { ...alt, ...window, requestedEmpty: true };
}
