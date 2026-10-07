// Horário de atendimento de uma pessoa (users.workHours), configurado em
// Ajustes → Equipe → ⋯ → Horário de atendimento (07/10/2026). É o expediente
// que o link de convite do Google oferece: o Google não expõe as regras do
// link pela API, então quem integra/atende repete aqui as faixas de lá.
//
// Forma: [{ weekday: 0-6 (0 = domingo), from: 9, to: 12 }, …] com horas
// fracionárias em passos de meia hora (9.5 = 09:30). Lista VAZIA = sem
// restrição: a agenda segue aberta das 7h às 21h em dia útil, como sempre.
//
// Quem consulta: a grade de horários do SPA (busyView em today.jsx: call,
// follow-up, integração e remarcar) e a oferta do SDR automático no servidor
// (busyOf em crm/agenda-slots.js). Fora do horário conta como ocupado.

const MAX_RANGES = 28; // 4 faixas por dia da semana

const halfHour = (v) => Math.round(Number(v) * 2) / 2;

// Normaliza o que vem do PATCH: descarta faixa inválida, junta as que se
// encostam ou se sobrepõem no mesmo dia e ordena por dia/hora.
export function sanitizeWorkHours(list) {
  if (!Array.isArray(list)) return [];
  const byDay = new Map();
  for (const r of list) {
    const weekday = Number(r?.weekday);
    const from = halfHour(r?.from), to = halfHour(r?.to);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > 24 || from >= to) continue;
    if (!byDay.has(weekday)) byDay.set(weekday, []);
    byDay.get(weekday).push({ from, to });
  }
  const out = [];
  for (const weekday of [...byDay.keys()].sort((a, b) => a - b)) {
    const ranges = byDay.get(weekday).sort((a, b) => a.from - b.from);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
      else merged.push({ ...r });
    }
    for (const r of merged) out.push({ weekday, from: r.from, to: r.to });
  }
  return out.slice(0, MAX_RANGES);
}

// Dia da semana de "YYYY-MM-DD" sem depender do fuso de quem roda.
const weekdayOf = (dateStr) => {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
};

// A célula de meia hora "YYYY-MM-DD-HH-MM" (a chave das grades do SPA e do
// servidor) cai fora do horário de atendimento? Sem horário configurado,
// nunca. A célula precisa caber INTEIRA numa faixa do dia.
export function offWorkHours(workHours, key) {
  if (!Array.isArray(workHours) || !workHours.length) return false;
  const k = String(key || "");
  const from = Number(k.slice(11, 13)) + Number(k.slice(14, 16)) / 60;
  if (!Number.isFinite(from)) return false;
  const weekday = weekdayOf(k.slice(0, 10));
  return !workHours.some((r) => r.weekday === weekday && r.from <= from && from + 0.5 <= r.to);
}

const pad2 = (n) => String(n).padStart(2, "0");
export const fmtWorkHour = (v) => `${pad2(Math.floor(v))}:${pad2(Math.round((v % 1) * 60))}`;
const WD_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Resumo de uma linha ("seg–sex 09:00–12:00, 14:00–18:00"): dias com as
// mesmas faixas viram um grupo; dias seguidos viram intervalo.
export function workHoursSummary(workHours) {
  const list = sanitizeWorkHours(workHours);
  if (!list.length) return "";
  const sig = new Map();
  for (const r of list) sig.set(r.weekday, [...(sig.get(r.weekday) || []), `${fmtWorkHour(r.from)}–${fmtWorkHour(r.to)}`]);
  const groups = new Map();
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    if (!sig.has(wd)) continue;
    const s = sig.get(wd).join(", ");
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(wd);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const daysLabel = (days) => {
    const idx = days.map((d) => order.indexOf(d));
    const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    return days.length > 2 && contiguous ? `${WD_SHORT[days[0]]}–${WD_SHORT[days[days.length - 1]]}` : days.map((d) => WD_SHORT[d]).join(", ");
  };
  return [...groups.entries()].map(([s, days]) => `${daysLabel(days)} ${s}`).join(" · ");
}
