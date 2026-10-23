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
// ── Régua configurável (docs/PLANO-ICP-CONFIGURAVEL.md) ─────────────────────
// A régua mora no produto (`product.icp.rules`); sem ela vale o padrão abaixo,
// montado das constantes acima — o comportamento de antes, nota por nota.
// `methods` é tentado em ordem e o PRIMEIRO que o lead consegue responder decide:
//   produto — multiplica o valor de cada eixo (todos obrigatórios) e aplica as faixas
//   soma    — soma os pontos dos eixos respondidos (ao menos um) e aplica as faixas
//   matriz  — cruza dois eixos numa grade de letras; eixo sem resposta lê o índice 0
// Um eixo é { key, values } (produto/soma) ou { key, index } (matriz); `fallback`
// é o eixo lido quando o campo principal está em branco.
export const GRADES = ["S", "A", "B", "C", "D", "E"];
export const DEFAULT_ICP_GRADES = ["S", "A", "B"];
// O que o SDR faz com o lead: nota × intenção medida (alta/média/baixa; sem
// intenção medida lê a média). A cadência sai da ação (classificacao.js).
export const ACTION_IDS = ["ligar-15min", "ligar-hoje", "whats-depois-ligar", "whats", "nutrir"];
export const ACTION_LABELS = { "ligar-15min": "ligar em 15 min", "ligar-hoje": "ligar hoje", "whats-depois-ligar": "WhatsApp, depois ligar", whats: "WhatsApp", nutrir: "nutrir" };
export const INTENT_COLS = ["alta", "media", "baixa"];
const ROW_SA = { alta: "ligar-15min", media: "ligar-hoje", baixa: "whats-depois-ligar" };
const ROW_BC = { alta: "ligar-hoje", media: "whats", baixa: "nutrir" };
const ROW_DE = { alta: "whats", media: "nutrir", baixa: "nutrir" };
export const DEFAULT_ACTIONS = { S: ROW_SA, A: ROW_SA, B: ROW_BC, C: ROW_BC, D: ROW_DE, E: ROW_DE };
// MQL: nota mínima + qualificação (intenção 0–100) mínima.
export const DEFAULT_MQL = { minGrade: "C", minQualificacao: 40 };
const LEGACY_MATRIX = {
  type: "matriz",
  rows: { key: "accounts", index: LEGACY_ACCOUNTS },
  cols: { key: "listings", index: LEGACY_LISTINGS, fallback: { key: "volume", index: LEGACY_VOLUME } },
  grid: LEGACY_GRID,
};
export const LEVERADS_RULES = {
  version: 0,
  value: { label: "Faturamento mensal estimado", prefix: "R$", suffix: "/mês" },
  methods: [
    { id: "faturamento", type: "produto", label: "pedidos × ticket médio",
      axes: [{ key: "orders", values: MID_ORDERS }, { key: "ticket", values: MID_TICKET }],
      bands: REVENUE_BANDS.map(({ grade, min }) => ({ grade, min })) },
    { id: "legado", label: "Legado (contas × anúncios)", legacy: true, ...LEGACY_MATRIX },
  ],
  icpGrades: DEFAULT_ICP_GRADES,
  actions: DEFAULT_ACTIONS,
  mql: DEFAULT_MQL,
};
// Produto sem régua própria: só a matriz, que não é legado ali (era a régua dele).
export const MATRIX_RULES = {
  version: 0,
  methods: [{ id: "matriz", label: "contas × anúncios", ...LEGACY_MATRIX }],
  icpGrades: DEFAULT_ICP_GRADES,
  actions: DEFAULT_ACTIONS,
  mql: DEFAULT_MQL,
};
export const defaultRules = (saas) => (!saas || saas === "leverads" ? LEVERADS_RULES : MATRIX_RULES);
export function gradeRulesOf(product) {
  const rules = product?.icp?.rules;
  return rules && Array.isArray(rules.methods) && rules.methods.length ? rules : defaultRules(product?.id);
}
export const icpGradesOf = (rules) => new Set(Array.isArray(rules?.icpGrades) && rules.icpGrades.length ? rules.icpGrades : DEFAULT_ICP_GRADES);

const blank = (v) => v == null || v === "";
const known = (map, v) => !!map && (typeof v === "string" || typeof v === "number") && Object.hasOwn(map, String(v));
function axisRaw(lead, axis) {
  const v = lead?.[axis?.key];
  return blank(v) && axis?.fallback ? axisRaw(lead, axis.fallback) : { axis, v };
}
function bandFor(bands, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const sorted = [...(bands || [])].filter((b) => GRADES.includes(b?.grade) && Number.isFinite(Number(b.min)))
    .sort((a, b) => Number(b.min) - Number(a.min));
  return sorted.find((b) => value >= Number(b.min))?.grade || null;
}
function methodGrade(lead, m) {
  if (m?.type === "matriz") {
    const idx = (axis) => { const { axis: a, v } = axisRaw(lead, axis); const i = known(a?.index, v) ? a.index[String(v)] : undefined; return Number.isInteger(i) ? i : undefined; };
    const r = idx(m.rows);
    const c = idx(m.cols);
    if (r === undefined && c === undefined) return null;
    const grade = m.grid?.[r ?? 0]?.[c ?? 0];
    return GRADES.includes(grade) ? { grade, value: null } : null;
  }
  if (m?.type !== "produto" && m?.type !== "soma") return null;
  const nums = (m.axes || []).map((axis) => {
    const { axis: a, v } = axisRaw(lead, axis);
    const n = known(a?.values, v) ? Number(a.values[String(v)]) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  if (!nums.length) return null;
  let value;
  if (m.type === "produto") {
    if (nums.some((n) => n == null)) return null;
    value = nums.reduce((acc, n) => acc * n, 1);
  } else {
    if (nums.every((n) => n == null)) return null;
    value = nums.reduce((acc, n) => acc + (n || 0), 0);
  }
  const grade = value >= 0 ? bandFor(m.bands, value) : null;
  return grade ? { grade, value } : null;
}

// { grade, legacy, revenue, value, method, methodLabel } pela régua (padrão: a do produto do lead).
export function leadGradeInfo(lead, rules) {
  const r = rules && typeof rules === "object" ? rules : defaultRules(lead?.saas);
  for (const m of r.methods || []) {
    const hit = methodGrade(lead, m);
    if (hit) return { grade: hit.grade, legacy: !!m.legacy, revenue: hit.value, value: hit.value, method: m.id || m.type, methodLabel: m.label || "" };
  }
  return { grade: null, legacy: false, revenue: null, value: null, method: null, methodLabel: "" };
}
export const isIcpGrade = (grade, rules) => !!grade && icpGradesOf(rules).has(grade);
// Ação da régua para a nota e a coluna de intenção ("alta" | "media" | "baixa");
// régua sem `actions` (gravada antes delas) usa a tabela padrão.
export function actionFor(rules, grade, intent) {
  if (!grade) return "nutrir";
  const col = INTENT_COLS.includes(intent) ? intent : "media";
  const a = rules?.actions?.[grade]?.[col] ?? DEFAULT_ACTIONS[grade]?.[col];
  return ACTION_IDS.includes(a) ? a : "nutrir";
}
// MQL: false sem nota; null sem intenção medida (ninguém perguntou); senão nota ≥ mínima e qualificação ≥ mínima.
export function mqlFor(rules, grade, measured, qualificacao) {
  if (!grade) return false;
  if (!measured) return null;
  const m = { ...DEFAULT_MQL, ...(rules?.mql || {}) };
  const rank = (g) => GRADES.length - 1 - GRADES.indexOf(g); // E=0 … S=5
  return rank(grade) >= rank(m.minGrade) && Number(qualificacao) >= Number(m.minQualificacao);
}
// Quantos leads cada método da régua avaliou (o "de onde vem a nota" das métricas).
export function gradeBasis(leads, rules) {
  const out = { methods: {}, ungraded: 0, total: 0 };
  for (const l of leads || []) {
    const info = leadGradeInfo(l, rules && typeof rules === "object" ? rules : defaultRules(l?.saas));
    out.total++;
    if (!info.grade) { out.ungraded++; continue; }
    const k = info.methodLabel || info.method || "régua";
    out.methods[k] = (out.methods[k] || 0) + 1;
  }
  return out;
}
export const REVENUE_ICP = {
  classificationVersion: REVENUE_GRADE_VERSION,
  pill: "S/A/B · R$ 200 mil+/mês",
  headline: "Operação com faturamento mensal estimado a partir de R$ 200 mil",
  profile: ["ICP: notas S, A e B — a partir de R$ 200 mil/mês", "Faturamento estimado = pedidos por mês × ticket médio", "Mesma régua de porte para OEM, Ads e Price; intenção de compra avaliada separadamente"],
  redFlags: ["Faturamento estimado abaixo de R$ 200 mil/mês: fora do ICP atual", "Sem pedidos ou ticket: manter a nota anterior, marcada com L (Legado)", "Valores declarados por faixa: validar o volume e a necessidade na conversa"],
  updatedAt: "2026-09-21",
};
