// Formatters — ported verbatim from the design prototype's window.fmt.
// Installed on window at boot so the (faithful) components keep using window.fmt.

export const fmt = {
  // Money — compacto em R$(R$1,2M, R$84k)
  money(n, { sign = false } = {}) {
    if (n == null) return "—";
    const abs = Math.abs(n);
    const s = n < 0 ? "-" : sign && n > 0 ? "+" : "";
    if (abs >= 1_000_000) return `${s}R$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 2).replace(".", ",")}M`;
    if (abs >= 1_000) return `${s}R$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(".", ",")}k`;
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
