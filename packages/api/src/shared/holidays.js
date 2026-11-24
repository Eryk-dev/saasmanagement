// FERIADOS NACIONAIS: a agenda não abre nesses dias (decisão do Leo, 24/11/2026:
// "pode mapear todos os feriados nacionais e remover da agenda", primeiro pro
// robô SDR e depois pra agenda manual do cockpit).
//
// Fixos + os móveis contados da Páscoa (segunda e terça de Carnaval,
// Sexta-feira Santa e Corpus Christi). Sem dependência nenhuma: o servidor
// (agenda-slots.js, routes.crud.js, sdr-agenda.js) e o SPA (grades de horário,
// tela Agenda) leem DESTE arquivo, pra travarem os mesmos dias.
//
// Aceita o dia em qualquer texto que comece por "YYYY-MM-DD": a data pura, o
// compromisso ("YYYY-MM-DDTHH:MM") e a chave da grade ("YYYY-MM-DD-HH-MM").
const FIXED_HOLIDAYS = {
  "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho", "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida", "11-02": "Finados", "11-15": "Proclamação da República", "11-20": "Consciência Negra", "12-25": "Natal",
};
const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
// Páscoa (algoritmo de Meeus/Butcher), em UTC.
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
const movableCache = new Map();
function movableHolidays(year) {
  if (!movableCache.has(year)) {
    const e = easter(year);
    movableCache.set(year, { [iso(plusDays(e, -48))]: "Carnaval", [iso(plusDays(e, -47))]: "Carnaval", [iso(plusDays(e, -2))]: "Sexta-feira Santa", [iso(plusDays(e, 60))]: "Corpus Christi" });
  }
  return movableCache.get(year);
}

// Nome do feriado nacional do dia, ou "".
export function nationalHoliday(day) {
  const d = String(day || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return FIXED_HOLIDAYS[d.slice(5)] || movableHolidays(Number(d.slice(0, 4)))[d] || "";
}
export const isNationalHoliday = (day) => !!nationalHoliday(day);
// "25/12 é feriado nacional (Natal)": a frase que a API e as telas mostram.
export function holidayMessage(day) {
  const name = nationalHoliday(day);
  if (!name) return "";
  const d = String(day).slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)} é feriado nacional (${name}): a agenda não abre nesse dia`;
}
