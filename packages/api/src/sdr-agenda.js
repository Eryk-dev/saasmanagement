// Oferta do robô: somente o próximo dia útil. Outras datas dependem de um
// pedido do LEAD; lotação nunca amplia a janela. Agenda manual fica intacta.
import { slotsForLead, wallNow, wallFromNaive, addBusinessDaysNaive, OFFER_HOURS } from "./agenda-slots.js";

const ymd = (d) => d.toISOString().slice(0, 10);
const normalize = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dayPlus = (d, n) => { const out = new Date(d); out.setUTCDate(out.getUTCDate() + n); return out; };
const weekdays = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function concreteDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

// Não basta citar uma data: "te respondo sexta" e "comecei segunda" não
// pedem reunião. Datas soltas são respostas válidas à escolha de agenda.
function requestedWindow(text, at) {
  const t = normalize(text).trim();
  const clauses = t.split(/[,;]|\bmas\b|\bporem\b/).filter((s) => s.trim());
  if (clauses.length > 1) {
    const requests = clauses.map((s) => requestedWindow(s, at)).filter(Boolean);
    return requests.at(-1) || null;
  }
  if (/te (?:falo|chamo|respondo|retorno)|(?:desde|comprei|comecei|vendi|vendeu)\b|quero saber mais sobre/.test(t)) return null;
  const dayPattern = /depois de amanha|amanha|\bhoje\b|\bhj\b|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|\bdia \d{1,2}\b|\b\d{1,2} de [a-z]+|semana que vem|proxima semana|outro dia|outros dias|proximos dias|daqui a \d+ dias?/;
  const match = t.match(dayPattern);
  if (!match) return null;
  const bare = t.replace(match[0], "").replace(/(?:\bas?\b|\bde\b|\bpela\b|\bna\b|\bno\b|\bpara\b|\bpra\b|\bmanha\b|\btarde\b|\bnoite\b|\d{1,2}(?:h\d{0,2}|:\d{2})?|[\s,.!?])/g, "");
  const asked = /\b(?:pode|posso|poderei|poderia|podemos|consigo|conseguimos|tem|teria|quero|prefiro|preferia|preciso|vamos|disponivel|disponibilidade|agendar|agendamento|marcar|remarcar|reuniao|call|horario|so|apenas)\b/.test(t);
  if (bare && !asked) return null;
  // Uma recusa sem alternativa não libera os próximos dias.
  if (/\bnao\s+(?:posso|consigo|da|pode|quero|tenho disponibilidade)\b|\bnao[.!?\s]*$/.test(t) && !/\bso\b|outro dia|outros dias/.test(t)) return null;
  let date;
  let days = 1;
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  const numbered = t.match(/\bdia (\d{1,2})\b/);
  const namedMonth = t.match(new RegExp(`\\b(\\d{1,2}) de (${months.join("|")})(?: de (\\d{4}))?\\b`));
  const relative = t.match(/\bdaqui a (\d+) dias?\b/);
  const weekday = weekdays.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
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
  } else if (/semana que vem|proxima semana/.test(t)) {
    date = dayPlus(at, (8 - at.getUTCDay()) % 7 || 7);
    if (weekday >= 0) date = dayPlus(date, (weekday + 6) % 7);
    else days = 5;
  } else if (/outro dia|outros dias|proximos dias/.test(t)) {
    date = wallFromNaive(addBusinessDaysNaive(ymd(at), 2));
    days = 5;
  } else if (relative) date = dayPlus(at, +relative[1]);
  else if (/depois de amanha/.test(t)) date = dayPlus(at, 2);
  else if (/amanha/.test(t)) date = dayPlus(at, 1);
  else if (/\b(?:hoje|hj)\b/.test(t)) date = at;
  else if (weekday >= 0) date = dayPlus(at, (weekday - at.getUTCDay() + 7) % 7 || 7);
  if (!date || !Number.isFinite(date.getTime())) return null;
  return { startDate: ymd(date), days, requested: true };
}

export function sdrAgendaWindow(messages = [], now = wallNow()) {
  const defaultWindow = { startDate: addBusinessDaysNaive(ymd(now), 1).slice(0, 10), days: 1, requested: false };
  // Pedido vale enquanto a conversa escolhe o horário, inclusive "14h" na
  // mensagem seguinte. Nunca interpretar fala do robô como pedido do cliente.
  let window = defaultWindow;
  for (const m of messages.slice(-24)) {
    if (m.direction !== "in") continue;
    const parsedAt = m.at ? wallNow(new Date(m.at)) : now;
    const at = Number.isFinite(parsedAt.getTime()) ? parsedAt : now;
    const requested = requestedWindow(m.transcript || m.text, at);
    if (requested) window = requested;
  }
  return window;
}

export async function sdrSlotsForLead(repo, { messages = [], now = wallNow(), ...options } = {}) {
  const window = sdrAgendaWindow(messages, now);
  // Pedido passado ou de fim de semana não vira oferta de outro dia sozinho.
  const day = wallFromNaive(window.startDate).getUTCDay();
  if (window.startDate < ymd(now) || (window.days === 1 && (day === 0 || day === 6))) return { slots: [], ...window };
  const result = await slotsForLead(repo, { ...options, now, ...OFFER_HOURS, ...window, sdr: true });
  return { ...result, ...window };
}
