// Plano de remuneração APROVADO (Leo, 04/08/2026): fonte única compartilhada
// pela API (folha automática, comp/payroll.js) e pela SPA (tela Remuneração).
// Sem dependências de servidor, como plan-cycles.js. Doc salvo em
// `comp_plans` ({ role, plan }) sobrescreve por trilha; sem doc vale isto.
//
// 3 trilhas (SDR, Closer, CS) × 3 níveis (1 júnior · 2 pleno · 3 sênior). SDR e
// Closer têm fixo + DUAS pernas de variável (contratos e receita), cada uma por
// DEGRAU de atingimento (80/100/120/140%). Closer escolhe CLT ou PJ (muda só o
// fixo). CS: fixo + indicação + bônus NPS/churn. Mídia social: sem nível, fixo
// por pessoa (payrollFixed) + bônus de time.

export const DEFAULT_PLAN = {
  sdr: {
    levels: [
      { n: 1, fixed: 2200, metaContracts: 20, metaRevenue: 90000, b80: 300, b100: 550, b120: 750, b140: 950 },
      { n: 2, fixed: 2600, metaContracts: 25, metaRevenue: 120000, b80: 450, b100: 750, b120: 1000, b140: 1250 },
      { n: 3, fixed: 3000, metaContracts: 35, metaRevenue: 180000, b80: 650, b100: 1000, b120: 1300, b140: 1600 },
    ],
    notes: "",
  },
  closer: {
    levels: [
      { n: 1, fixed: 3000, fixedPj: 4200, metaContracts: 20, metaRevenue: 90000, b80: 600, b100: 1000, b120: 1500, b140: 2000 },
      { n: 2, fixed: 4000, fixedPj: 5500, metaContracts: 25, metaRevenue: 120000, b80: 1000, b100: 1500, b120: 2100, b140: 2700 },
      { n: 3, fixed: 5500, fixedPj: 7500, metaContracts: 35, metaRevenue: 180000, b80: 1500, b100: 2500, b120: 3700, b140: 4900 },
    ],
    notes: "",
  },
  cs: {
    levels: [
      { n: 1, fixed: 2200, npsBonus: 500, churnBonus: 500 },
      { n: 2, fixed: 2600, npsBonus: 700, churnBonus: 700 },
      { n: 3, fixed: 3000, npsBonus: 1000, churnBonus: 1000 },
    ],
    referralMeeting: 100,
    // R$ 500 desde 12/09/2026 (era 250): o prêmio de fechamento é o que puxa
    // coleta de nome qualificado, e sobre um ticket de R$ 5 a 7 mil anual isso é
    // ~8%, bem abaixo do CAC de Meta.
    referralClosed: 500,
    npsFloor: 80,
    churnMax: 15,
    notes: "",
  },
  // Parcela COLETIVA (13/09/2026): valor fixo por cargo e nível, pago quando o
  // mês fecha com as duas condições juntas (meta da casa + churn abaixo do
  // limiar). Espelha DEFAULT_TEAM_BONUS de comp/comp-plan.js.
  team: {
    products: ["leverads"],
    sdr: [300, 400, 500],
    closer: [400, 600, 800],
    cs: [300, 400, 500],
    social: 200,
  },
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const EPS = 1e-9;

// Plano vigente de uma trilha: doc salvo (campo plan) por cima do padrão.
// Doc salvo antes da coluna 140% ganha a extrapolação antiga; CS salvo antes
// do bônus de churn herda o padrão do nível.
export function planFor(compDocs, role) {
  const key = role === "integrator" ? "cs" : role;
  const base = DEFAULT_PLAN[key];
  if (!base) return null;
  const doc = (compDocs || []).find((d) => d && d.role === key && d.plan);
  const plan = doc ? { ...base, ...doc.plan } : { ...base };
  if (key !== "cs" && key !== "team") plan.levels = (plan.levels || []).map((l) => (l.b140 == null ? { ...l, b140: num(l.b120) + (num(l.b120) - num(l.b100)) } : l));
  if (key === "cs") plan.levels = (plan.levels || []).map((l) => (l.churnBonus == null ? { ...l, churnBonus: num(base.levels.find((d) => d.n === l.n)?.churnBonus) } : l));
  return plan;
}

export const levelOf = (plan, n) => (plan?.levels || []).find((l) => Number(l.n) === Number(n)) || plan?.levels?.[0] || {};

// Valor do bônus de time por cargo e nível (mídia social não tem nível).
export function teamBonusFor(team, role, level = 1) {
  const chave = role === "integrator" ? "cs" : role;
  const v = (team || {})[chave];
  if (v == null) return 0;
  if (!Array.isArray(v)) return num(v);
  const i = Math.min(Math.max(Math.floor(Number(level)) || 1, 1), v.length) - 1;
  return num(v[i]);
}

// Bônus de UMA perna: att = realizado ÷ meta (1 = 100%). É DEGRAU, não rampa
// (Leo, 19/08): a banda só paga quando é BATIDA, então o valor entre duas
// âncoras é o da âncora de baixo (110% paga b100 inteiro, nada de proporcional
// rumo a b120). Cliff em 80% (abaixo disso a perna zera) e escada ABERTA acima
// de 140%: cada +20% COMPLETO paga o degrau anterior + R$100, sem teto.
export function legBonus(att, b80, b100, b120, b140) {
  if (!Number.isFinite(att) || att < 0.8 - EPS) return 0;
  if (att < 1 - EPS) return b80;
  if (att < 1.2 - EPS) return b100;
  if (att < 1.4 - EPS) return b120;
  const top = Number.isFinite(b140) ? b140 : b120 + (b120 - b100);
  // k degraus de 20% COMPLETOS acima de 140% (degrau pela metade não paga).
  // Degrau i (1-indexado) paga (b140 − b120) + 100·i; a soma fechada evita
  // loop com att digitado gigante no simulador.
  const k = Math.floor((att - 1.4) / 0.2 + EPS);
  if (k <= 0) return top;
  return top + k * (top - b120) + 100 * ((k * (k + 1)) / 2);
}
