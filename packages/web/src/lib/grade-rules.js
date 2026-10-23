import { defaultRules, gradeRulesOf } from "../../../api/src/shared/lead-grade.js";
// Régua de nota/ICP de cada produto na SPA (docs/PLANO-ICP-CONFIGURAVEL.md).
// O hydrateSeed (data.jsx) registra a régua dos produtos a cada carga do
// bootstrap; `leadTier` acha a do lead por `saas`, sem cada tela passar o
// produto. Produto sem régua, ou registro vazio (preview, testes), usa o padrão.
const bySaas = new Map();

export function setGradeRules(products) {
  bySaas.clear();
  for (const p of products || []) if (p?.id) bySaas.set(p.id, gradeRulesOf(p));
}

export const gradeRulesFor = (saas) => bySaas.get(saas) || defaultRules(saas);

// "De onde vem a nota" das métricas (gradeBasis da API): "nota de 12 leads: 10
// por pedidos × ticket médio · 1 Legado (contas × anúncios) · 1 sem nota".
export function gradeBasisText(basis, what = "leads") {
  if (!basis || !basis.total) return "";
  const parts = Object.entries(basis.methods || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} por ${k}`);
  if (basis.ungraded) parts.push(`${basis.ungraded} sem nota`);
  return `nota de ${basis.total} ${what}: ${parts.join(" · ")} · régua em Configurações → ICP & nota`;
}
