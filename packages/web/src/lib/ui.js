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
