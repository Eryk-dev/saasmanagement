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

// ── Bônus de time: a parcela COLETIVA do plano ──────────────────────────────
// Até 13/09/2026 tudo no plano era individual (duas pernas por pessoa, NPS e
// churn da carteira de cada CS, indicação de quem colheu). Ninguém tinha
// dinheiro atrelado ao resultado da CASA, então o hunter não tinha motivo pra
// se importar com quem ele traz depois da assinatura.
//
// O bônus de time paga um valor FIXO por cargo e nível quando o mês fecha com
// as DUAS condições juntas: a meta de venda do mês da empresa batida (a mesma
// faixa "Meta do mês" da Visão geral, computeWindowGoal) e o churn do mês
// abaixo do limiar que o plano do CS já usa (churnMax). Faltou uma, ninguém
// leva: meia condição pagando meio bônus faria o time escolher qual perseguir.
//
// Espelho do DEFAULT_PLAN.team de packages/web/src/screens/remuneracao.jsx.
export const DEFAULT_TEAM_BONUS = {
  products: ["leverads"],
  sdr: [300, 400, 500],
  closer: [400, 600, 800],
  cs: [300, 400, 500],
  social: 200,
};

const teamDoc = (compDocs) => (compDocs || []).find((d) => d && d.role === "team")?.plan || null;

export function teamBonusPlan(compDocs) {
  const doc = teamDoc(compDocs);
  return doc ? { ...DEFAULT_TEAM_BONUS, ...doc } : { ...DEFAULT_TEAM_BONUS };
}

// Produtos em que o bônus vale. Só a LeverAds por padrão: a fila da mentoria
// fica fora das pernas de propósito, e os outros produtos não têm time de
// vendas por trás da meta de caixa.
export function teamBonusProducts(compDocs) {
  const arr = teamBonusPlan(compDocs).products;
  return Array.isArray(arr) && arr.length ? arr : DEFAULT_TEAM_BONUS.products;
}

// Valor por papel e nível. `integrator` é o papel no placar, `cs` é o nome da
// trilha no plano; mídia social não tem nível (valor único).
export function teamBonusOf(compDocs, role, level = 1) {
  const plan = teamBonusPlan(compDocs);
  const chave = role === "integrator" ? "cs" : role;
  const v = plan[chave];
  if (v == null) return 0;
  if (!Array.isArray(v)) return Number(v) || 0;
  const i = Math.min(Math.max(Math.floor(Number(level)) || 1, 1), v.length) - 1;
  return Number(v[i]) || 0;
}

// Nível do plano de um usuário (user.compLevel, 1..3; sem campo = 1/júnior).
export function compLevelOf(user) {
  const n = Math.floor(Number(user?.compLevel));
  return n >= 1 && n <= 3 ? n : 1;
}

// ── Critério de promoção (decisão do Leo, 13/09/2026) ───────────────────────
// "3 meses de meta 100% sobe." Até aqui a única coisa escrita sobre subir de
// nível era uma frase de prosa na tela ("promoção sobe fixo, meta e bônus
// juntos") e o nível era um dropdown livre do admin. Ninguém sabia o que fazer
// pra subir, que é o jeito mais barato de perder gente boa.
//
// A régua: 3 meses FECHADOS consecutivos com 100% da meta, contados só a partir
// da última mudança de nível (senão a pessoa sobe hoje e já chega elegível
// amanhã com meses de antes). Por padrão as DUAS pernas precisam bater
// (`legs: "both"`); o toggle "basta uma" existe porque é a única parte da régua
// que o Leo pode querer afrouxar.
//
// A promoção em si continua MANUAL: o cockpit diz quem está elegível, quem
// promove é a gestão.
export const DEFAULT_CAREER_RULE = { months: 3, legs: "both" };
export const LEVELED_ROLES = ["sdr", "closer"];

export function careerRuleOf(compDocs) {
  const doc = (compDocs || []).find((d) => d && d.role === "career")?.plan || null;
  const rule = doc ? { ...DEFAULT_CAREER_RULE, ...doc } : { ...DEFAULT_CAREER_RULE };
  rule.months = Math.max(1, Math.floor(Number(rule.months)) || DEFAULT_CAREER_RULE.months);
  rule.legs = rule.legs === "any" ? "any" : "both";
  return rule;
}

// Papel avaliado: closer manda sobre SDR quando a pessoa acumula os dois (é o
// papel de contrato mais alto, e o `roleOfUser` da tela de Metas usa a mesma
// ordem).
export const leveledRoleOf = (user) => LEVELED_ROLES.slice().reverse().find((r) => (user?.roles || []).includes(r)) || "";

// `stamps`: carimbos mensais da pessoa (comp_months, kind "person"), qualquer
// ordem. `levelSince`: data da última mudança de nível (ISO) ou "".
export function promotionEligibility({ stamps = [], level = 1, levelSince = "", rule = DEFAULT_CAREER_RULE, today = "" } = {}) {
  const lv = Math.min(Math.max(Math.floor(Number(level)) || 1, 1), 3);
  const to = lv + 1;
  const mesDaMudanca = String(levelSince || "").slice(0, 7);
  const mesCorrente = String(today || new Date().toISOString()).slice(0, 7);
  const meses = (stamps || [])
    .filter((s) => s && s.month && s.month < mesCorrente)                       // só mês FECHADO
    .filter((s) => !mesDaMudanca || s.month > mesDaMudanca)                     // só depois da promoção
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));            // do mais novo pro mais velho

  // Sequência a partir do mês fechado mais recente: mês que não bateu (ou que
  // não existe no meio) zera a contagem.
  let streak = 0;
  const batidos = [];
  let esperado = meses[0]?.month || "";
  for (const s of meses) {
    if (esperado && s.month !== esperado) break; // buraco na sequência
    const ok = rule.legs === "any"
      ? (s.contractsAtt >= 1 || s.revenueAtt >= 1)
      : s.hit100 === true;
    if (!ok) break;
    streak++;
    batidos.push(s.month);
    const [y, m] = s.month.split("-").map(Number);
    esperado = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }

  const blockedBy = lv >= 3 ? "ja_e_senior" : streak >= rule.months ? "" : "meses";
  return {
    eligible: lv < 3 && streak >= rule.months,
    to: lv < 3 ? to : null,
    streak,
    months: batidos.slice().reverse(),
    blockedBy,
  };
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
