// Formatters — ported verbatim from the design prototype's window.fmt.
// Installed on window at boot so the (faithful) components keep using window.fmt.

// Dia do NEGÓCIO (America/Sao_Paulo) — espelho do dayKey do metrics-core da
// API: toda contagem por dia no front usa isto, nunca slice do ISO (que corta
// em UTC e joga lead das 21h+ pro dia seguinte). Data pura ("2026-07-03") já é
// o dia do negócio e passa direto.
const BIZ_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
export function bizDay(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return BIZ_DAY_FMT.format(d); // en-CA = YYYY-MM-DD
}

export const fmt = {
  // Money — compacto em R$(R$1,2M, R$84k)
  money(n, { sign = false } = {}) {
    if (n == null) return "—";
    const abs = Math.abs(n);
    const s = n < 0 ? "-" : sign && n > 0 ? "+" : "";
    if (abs >= 1_000_000) return `${s}R$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(".", ",")}M`;
    // Sempre 1 casa em milhares (56k → 56,3k): esconder a fração fazia "R$56k"
    // parecer redondo quando era 56,3k.
    if (abs >= 1_000) return `${s}R$${(abs / 1_000).toFixed(1).replace(".", ",")}k`;
    return `${s}R$${abs.toFixed(0)}`;
  },
  pct(n, digits = 0) {
    if (n == null) return "—";
    return `${(n * 100).toFixed(digits)}%`;
  },
  pctDelta(n, digits = 0) {
    if (n == null) return "—";
    const s = n > 0 ? "+" : "";
    return `${s}${(n * 100).toFixed(digits)}pp`;
  },
  int(n, { sign = false } = {}) {
    if (n == null) return "—";
    return (sign && n > 0 ? "+" : "") + n.toLocaleString();
  },
  ratio(n, digits = 1) {
    if (n == null) return "—";
    return `${n.toFixed(digits)}x`;
  },
};
