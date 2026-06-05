// Shared chrome button style — lifted out of portfolio.jsx so every screen can
// import it without depending on a screen module. Identical to the original.

export const chromeBtnStyleSmall = {
  display: "inline-flex", alignItems: "center", gap: 6,
  height: 24, padding: "0 8px",
  border: "1px solid var(--line-1)",
  background: "var(--bg-2)",
  borderRadius: "var(--r-2)",
  color: "var(--fg-2)",
};

// Lead score helpers — score é numérico 0–100; cor e rótulo vêm por banda.
// (Quente = forte/urgente em vermelho, mesmo padrão visual do protótipo.)
export function leadScoreTone(score) {
  const n = Number(score) || 0;
  return n >= 75 ? "var(--neg)" : n >= 50 ? "var(--warn)" : "var(--fg-4)";
}
export function leadScoreLabel(score) {
  const n = Number(score) || 0;
  return n >= 75 ? "Quente" : n >= 50 ? "Morno" : "Frio";
}
// Idade do lead — string humana ("12m"/"2h") ou número (dias, vindo de deals
// migrados). Normaliza sem inventar unidade pra strings.
export function leadAge(lead) {
  const a = lead?.age;
  if (a == null || a === "") return "—";
  return typeof a === "number" ? `${a}d` : String(a);
}
