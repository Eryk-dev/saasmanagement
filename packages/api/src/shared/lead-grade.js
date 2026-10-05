// Régua pura compartilhada pela API e pela SPA. Sem dependências de servidor.
export const REVENUE_GRADE_VERSION = "revenue-2026-09-21";
export const MID_ORDERS = { "0-200": 100, "200-500": 350, "500-1000": 750, "1000-2000": 1500, "2000+": 3000 };
export const MID_TICKET = { "0-70": 50, "70-150": 110, "150-300": 225, "300-600": 450, "600+": 800 };
export const REVENUE_BANDS = [
  { grade: "S", min: 1000000, label: "R$ 1 milhão ou mais" },
  { grade: "A", min: 500000, label: "R$ 500 mil a menos de R$ 1 milhão" },
  { grade: "B", min: 200000, label: "R$ 200 mil a menos de R$ 500 mil" },
  { grade: "C", min: 100000, label: "R$ 100 mil a menos de R$ 200 mil" },
  { grade: "D", min: 50000, label: "R$ 50 mil a menos de R$ 100 mil" },
  { grade: "E", min: 0, label: "Abaixo de R$ 50 mil" },
];
export function estimatedRevenue(lead) {
  const orders = Object.hasOwn(MID_ORDERS, lead?.orders) ? MID_ORDERS[lead.orders] : null;
  const ticket = Object.hasOwn(MID_TICKET, lead?.ticket) ? MID_TICKET[lead.ticket] : null;
  return orders != null && ticket != null ? orders * ticket : null;
}
export function gradeForRevenue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? REVENUE_BANDS.find((b) => value >= b.min).grade : null;
}
export function revenueGrade(lead) {
  if (lead?.saas && lead.saas !== "leverads") return null;
  return gradeForRevenue(estimatedRevenue(lead));
}
export const LEGACY_ACCOUNTS = { "1": 0, "2-3": 1, "4-6": 2, "7-10": 3, "10+": 4, "2": 1, "3-5": 2, "6-10": 3 };
export const LEGACY_LISTINGS = { "0-500": 0, "500-1000": 1, "1000-5000": 2, "5000-10000": 3, "10000+": 4, "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3 };
export const LEGACY_VOLUME = { "0-10": 0, "10-50": 1, "50-200": 2, "200+": 3 };
export const LEGACY_GRID = [["E","D","C","C","C"],["D","C","C","B","B"],["C","B","B","A","A"],["B","B","A","S","S"],["A","A","A","S","S"]];
export function legacyGrade(lead) {
  const acc = LEGACY_ACCOUNTS[lead?.accounts];
  const ads = lead?.listings != null && lead.listings !== "" ? LEGACY_LISTINGS[lead.listings] : LEGACY_VOLUME[lead?.volume];
  if (!Number.isInteger(acc) && !Number.isInteger(ads)) return null;
  return LEGACY_GRID[acc ?? 0][ads ?? 0];
}
export function leadGradeInfo(lead) {
  const grade = revenueGrade(lead);
  if (grade) return { grade, legacy: false, revenue: estimatedRevenue(lead) };
  const old = legacyGrade(lead);
  return { grade: old, legacy: !!old && (!lead?.saas || lead.saas === "leverads"), revenue: null };
}
export const REVENUE_ICP = {
  classificationVersion: REVENUE_GRADE_VERSION,
  pill: "S/A/B · R$ 200 mil+/mês",
  headline: "Operação com faturamento mensal estimado a partir de R$ 200 mil",
  profile: ["ICP: notas S, A e B — a partir de R$ 200 mil/mês", "Faturamento estimado = pedidos por mês × ticket médio", "Mesma régua de porte para OEM, Ads e Price; intenção de compra avaliada separadamente"],
  redFlags: ["Faturamento estimado abaixo de R$ 200 mil/mês: fora do ICP atual", "Sem pedidos ou ticket: manter a nota anterior, marcada com L (Legado)", "Valores declarados por faixa: validar o volume e a necessidade na conversa"],
  updatedAt: "2026-09-21",
};
