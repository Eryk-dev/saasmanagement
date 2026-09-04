// A janela de tempo, com a MESMA régua da API (metrics-core.js): o dia do
// negócio é America/Sao_Paulo, e `since`/`until` são dias inclusivos no formato
// YYYY-MM-DD. Existe aqui pra que o modelo possa pedir "mês passado" sem
// calcular data na mão — cada vez que ele calculava, errava a virada do mês.
//
// `compare` devolve a janela ANTERIOR de mesmo tamanho: é o que transforma um
// número solto em "subiu/caiu X%", que é o que um relatório precisa.

const TZ = "America/Sao_Paulo";
const DAY_MS = 86_400_000;

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

// Mesmo contrato do dayKey da API: data pura passa reto; instante vira o dia em SP.
export function dayKey(value = new Date()) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const p = Object.fromEntries(
    DATE_FMT.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export const today = () => dayKey(new Date());

// Aritmética de dia em cima da string, via UTC — não usa o fuso local do
// container (que é UTC em produção) pra não deslocar a data.
export function shiftDay(day, n) {
  const t = Date.parse(`${day}T12:00:00Z`);
  return new Date(t + n * DAY_MS).toISOString().slice(0, 10);
}

export const daysBetween = (since, until) =>
  Math.round((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / DAY_MS) + 1;

const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const monthStart = (day) => `${day.slice(0, 7)}-01`;
const monthEnd = (day) => {
  const [y, m] = day.split("-").map(Number);
  return dayKey(new Date(Date.UTC(y, m, 0, 12)));
};

export const PRESETS = [
  "today", "yesterday", "last_7d", "last_14d", "last_28d", "last_30d", "last_60d", "last_90d",
  "this_month", "last_month", "this_quarter", "this_year", "all",
];

// `all` começa em 2024-01-01: antes disso não existe dado no cockpit e uma
// janela aberta faria o Postgres varrer à toa.
const EPOCH = "2024-01-01";

export function resolvePeriod({ period, since, until } = {}, now = new Date()) {
  const hoje = dayKey(now);
  if (isDay(since) || isDay(until)) {
    const a = isDay(since) ? since : EPOCH;
    const b = isDay(until) ? until : hoje;
    return finish(a > b ? b : a, a > b ? a : b, "explícito");
  }
  const p = String(period || "last_30d").toLowerCase().trim();
  switch (p) {
    case "today": return finish(hoje, hoje, p);
    case "yesterday": { const d = shiftDay(hoje, -1); return finish(d, d, p); }
    case "last_7d": return finish(shiftDay(hoje, -6), hoje, p);
    case "last_14d": return finish(shiftDay(hoje, -13), hoje, p);
    case "last_28d": return finish(shiftDay(hoje, -27), hoje, p);
    case "last_30d": return finish(shiftDay(hoje, -29), hoje, p);
    case "last_60d": return finish(shiftDay(hoje, -59), hoje, p);
    case "last_90d": return finish(shiftDay(hoje, -89), hoje, p);
    // Mês contra mês: a comparação útil é o MESMO recorte do mês anterior
    // (mês fechado vs mês fechado; mês corrente vs mesmo dia do mês passado),
    // não "os N dias imediatamente anteriores" — que cairia no meio do mês.
    case "this_month": {
      const ant = shiftDay(monthStart(hoje), -1);
      const dia = Number(hoje.slice(8, 10));
      const fim = monthEnd(ant);
      const ate = dia >= Number(fim.slice(8, 10)) ? fim : `${ant.slice(0, 7)}-${String(dia).padStart(2, "0")}`;
      return finish(monthStart(hoje), hoje, p, { since: monthStart(ant), until: ate, days: daysBetween(monthStart(ant), ate) });
    }
    case "last_month": { const d = shiftDay(monthStart(hoje), -1); return mesCheio(monthStart(d), monthEnd(d), p); }
    case "this_quarter": {
      const m = Number(hoje.slice(5, 7));
      const first = String(m - ((m - 1) % 3)).padStart(2, "0");
      return finish(`${hoje.slice(0, 4)}-${first}-01`, hoje, p);
    }
    case "this_year": return finish(`${hoje.slice(0, 4)}-01-01`, hoje, p);
    case "all": return finish(EPOCH, hoje, p);
    default: {
      // "2026-08" (mês) também é um pedido natural do modelo.
      if (/^\d{4}-\d{2}$/.test(p)) return mesCheio(`${p}-01`, monthEnd(`${p}-01`), "mês");
      return finish(shiftDay(hoje, -29), hoje, "last_30d (padrão)");
    }
  }
}

// Mês fechado: a janela anterior é o mês anterior INTEIRO (28/30/31 dias),
// não os mesmos N dias — comparar agosto com "31 dias antes de agosto" jogaria
// a base pro dia 1º de julho e mentiria no fechamento.
function mesCheio(since, until, label) {
  const anterior = shiftDay(since, -1);
  const pSince = `${anterior.slice(0, 7)}-01`;
  return finish(since, until, label, { since: pSince, until: anterior, days: daysBetween(pSince, anterior) });
}

function finish(since, until, label, previous) {
  const days = daysBetween(since, until);
  return {
    since,
    until,
    days,
    tz: TZ,
    basis: "dia do negócio (America/Sao_Paulo)",
    label,
    // Janela de comparação — base das variações. Padrão: mesmo tamanho,
    // imediatamente antes. Presets de mês trocam por mês calendário.
    previous: previous || { since: shiftDay(since, -days), until: shiftDay(since, -1), days },
  };
}

// Variação percentual segura: sem base não existe "%", e devolver 0 ali mentiria.
// `null` da API significa "não dá pra calcular" (CPL sem lead, ROAS sem gasto) —
// virar 0 aqui inventaria uma queda de 100% que nunca aconteceu.
export function delta(current, before) {
  if (current == null || before == null) return null;
  const a = Number(current);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const abs = Math.round((a - b) * 100) / 100;
  return { current: a, previous: b, abs, pct: b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null };
}

// Cobre period + since/until num lugar só, pra todas as tools falarem igual.
// A descrição é curta de propósito: este bloco entra em dezenas de tools e o
// catálogo inteiro é carregado no contexto de todo cliente, toda sessão —
// repetir a lista completa de presets aqui custava mais que o preset ajuda.
// A lista completa vive em `cockpit_help`.
export const periodInput = (z) => ({
  period: z.string().optional().describe("last_7d | last_30d | this_month | last_month | 2026-08 | all (padrão last_30d)"),
  since: z.string().optional().describe("YYYY-MM-DD (sobrepõe period)"),
  until: z.string().optional().describe("YYYY-MM-DD inclusive"),
});
