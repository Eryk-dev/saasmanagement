// Plano de REMUNERAÇÃO como régua de metas do placar (Leo, 06/08: "ajustar os
// cards de desempenho conforme as novas metas que estipulamos em remuneração").
// O plano aprovado em 04/08 define, POR NÍVEL (1 jr · 2 pl · 3 sn), a meta
// mensal de CONTRATOS e de RECEITA de SDR e closer — meta POR PESSOA (a dupla
// persegue o mesmo número de propósito; nada de repartir por headcount).
//
// A fonte viva é a collection `comp_plans` (tela Remuneração, doc por trilha
// com plan.levels editável); sem doc salvo vale o DEFAULT abaixo, que ESPELHA
// o DEFAULT_PLAN de packages/web/src/screens/remuneracao.jsx — mudou lá, mudar
// aqui (mesma dupla deliberada do leadGrade/leadTier).

export const DEFAULT_COMP_PLAN = {
  sdr: {
    levels: [
      { n: 1, metaContracts: 20, metaRevenue: 90000 },
      { n: 2, metaContracts: 25, metaRevenue: 120000 },
      { n: 3, metaContracts: 35, metaRevenue: 180000 },
    ],
  },
  closer: {
    levels: [
      { n: 1, metaContracts: 20, metaRevenue: 90000 },
      { n: 2, metaContracts: 25, metaRevenue: 120000 },
      { n: 3, metaContracts: 35, metaRevenue: 180000 },
    ],
  },
};

// Nível do plano de um usuário (user.compLevel, 1..3; sem campo = 1/júnior).
export function compLevelOf(user) {
  const n = Math.floor(Number(user?.compLevel));
  return n >= 1 && n <= 3 ? n : 1;
}

// Meta do plano pra métrica do card: won = contratos do mês, revenue = R$ do
// mês, sempre POR PESSOA pelo nível. Fora de sdr/closer (ou métrica fora do
// plano) devolve null — o goalFor segue a cadeia normal (vaga → derivado).
export function compGoalFor(compDocs, role, metric, level = 1) {
  if (role !== "sdr" && role !== "closer") return null;
  if (metric !== "won" && metric !== "revenue") return null;
  const doc = (compDocs || []).find((d) => d && d.role === role);
  const levels = (doc?.plan?.levels?.length ? doc.plan.levels : DEFAULT_COMP_PLAN[role].levels);
  const lv = levels.find((l) => Math.floor(Number(l?.n)) === level) || levels[0] || {};
  const target = metric === "won" ? Number(lv.metaContracts) : Number(lv.metaRevenue);
  if (!(target > 0)) return null;
  return { target, period: "month", scope: "remuneracao", level };
}
