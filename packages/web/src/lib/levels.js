// Níveis de carreira (Júnior · Pleno · Sênior) — a MESMA escala que o plano de
// Remuneração usa por nível (comp_plans.levels[].n) e que o placar aplica como
// meta da pessoa (user.compLevel → compGoalFor no servidor). Aqui só os NOMES,
// pra tela nenhuma inventar rótulo próprio: "1 · 2 · 3" não diz nada pra quem
// classifica alguém.
//
// Vale pras vagas que fecham contrato (SDR e closer, decisão do Leo em
// 21/08/2026): são as que têm meta de contratos/receita por nível. CS e mídia
// social seguem a meta da vaga, igual pra todo mundo.

export const CAREER_LEVELS = [
  { n: 1, label: "Júnior", short: "jr" },
  { n: 2, label: "Pleno", short: "pl" },
  { n: 3, label: "Sênior", short: "sn" },
];

export const LEVELED_ROLES = ["sdr", "closer"];

export const levelLabel = (n) => (CAREER_LEVELS.find((l) => l.n === Number(n)) || CAREER_LEVELS[0]).label;
export const hasLevel = (roles) => (roles || []).some((r) => LEVELED_ROLES.includes(r));
