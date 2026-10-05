// Recursos de um plano, modelados em cima do que a ORG TEM no LeverAds (campos
// aceitos por PUT /api/super/orgs/:id e a régua de cota de app/services/quota.py
// do produto). Fonte única: o plano guarda os valores, a tela de Planos mostra
// e edita por esta lista, e o relatório de acesso compara por ela.
// Sem dependências de servidor: a SPA importa este arquivo direto (os
// Dockerfiles de build web copiam, como o lead-grade.js e o plan-cycles.js).
//
// LIMITES (`plan.limits`): chave AUSENTE = não se aplica; `null` = ilimitado.
// RECURSOS (`plan.features`): módulo ligado (true) ou fora do plano (false);
// chave ausente = o plano não diz nada sobre o módulo (não é comparado).
//
// `org` = como o valor vira campo(s) da org no produto. Limite ou recurso sem
// `org` é só comercial (aparece no plano, não é conferido no produto).

// PRODUTOS que os planos vendem (`plan.product`): é por eles que a tela de
// Planos se organiza. `access` = em que sistema uma ASSINATURA do produto
// libera acesso (a Mentoria não libera acesso a sistema nenhum).
export const PLAN_PRODUCTS = [
  { id: "leverads", label: "LeverAds", access: "leverads" },
  { id: "leverprice", label: "LeverPrice", access: "leverprice" },
  { id: "mentoria", label: "Mentoria", access: "" },
];
// Produto de um plano; plano anterior ao campo cai pelo que ele já diz.
export function planProductOf(plan) {
  if (PLAN_PRODUCTS.some((p) => p.id === plan?.product)) return plan.product;
  if (plan?.line === "mentoria") return "mentoria";
  if (plan?.line === "price" || plan?.access?.product === "leverprice") return "leverprice";
  return "leverads";
}
// Acesso que um plano dá: só assinatura libera sistema; compra única não.
export const planAccessOf = (product, kind) =>
  (kind === "one_off" ? "" : PLAN_PRODUCTS.find((p) => p.id === product)?.access || "");

export const PLAN_LIMITS = [
  { key: "accounts", label: "Contas", unit: "contas", product: "leverads",
    // Seat de conexão: 1 conta é a origem, as demais são destino.
    org: (v) => (v == null ? {} : { paid_seats: Number(v) }) },
  { key: "copiesPerDay", label: "Cópias por dia", unit: "cópias/dia", product: "leverads",
    hint: "por conta de destino",
    org: (v) => (v == null ? { unlimited_quota: true } : { per_seller_daily_limit: Number(v) }) },
  { key: "oemPerMonth", label: "Criador OEM por mês", unit: "OEMs/mês", product: "leverads",
    org: (v) => ({ creator_quota_limit: v == null ? null : Number(v), creator_quota_period: "month" }) },
  // Cota anual do Criador (a org tem uma cota só, com período). Um plano usa a
  // mensal OU a anual; com as duas, vale a anual.
  { key: "oemPerYear", label: "Criador OEM por ano", unit: "OEMs/ano", product: "leverads",
    org: (v) => ({ creator_quota_limit: v == null ? null : Number(v), creator_quota_period: "year" }) },
  { key: "listings", label: "Anúncios precificados", unit: "anúncios", product: "leverprice" },
];

export const PLAN_FEATURES = [
  { key: "bulkEdit", label: "Edição em massa", product: "leverads", org: ["edit_enabled"] },
  { key: "copyRules", label: "Regras automáticas", product: "leverads", org: ["copy_rules_enabled"] },
  { key: "stockMirror", label: "Estoque Espelho", product: "leverads", org: ["stock_mirror_enabled"] },
  { key: "sac", label: "SAC", product: "leverads", org: ["messages_enabled"] },
  { key: "aiQuestions", label: "Perguntas IA", product: "leverads", org: ["questions_enabled", "auto_answer_enabled"] },
  { key: "compat", label: "Compatibilidades", product: "leverads", org: ["compat_enabled"] },
  { key: "oemCreator", label: "Criador OEM", product: "leverads", org: ["creator_enabled"] },
];

const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// "7 contas · 8.000 cópias/dia · OEMs/mês ilimitados"
export function limitsSummary(limits) {
  return PLAN_LIMITS.filter((l) => l.key in (limits || {}))
    .map((l) => (limits[l.key] == null ? `${l.unit} ilimitados` : `${fmtInt(limits[l.key])} ${l.unit}`))
    .join(" · ");
}

// Módulos ligados no plano, pelo nome.
export const featuresIncluded = (features) =>
  PLAN_FEATURES.filter((f) => features?.[f.key] === true).map((f) => f.label);

// O que o plano pede em campos da org do LeverAds. Só entra o que o plano
// DECLARA: limite presente e recurso marcado (ligado ou fora do plano).
// Plano do Lever Price liga o módulo dele dentro da org.
export function leveradsOrgFields({ product, limits, features } = {}) {
  const out = {};
  if (product === "leverprice") out.leverprice_enabled = true;
  if (product !== "leverads") return out;
  for (const l of PLAN_LIMITS) {
    if (l.product !== "leverads" || !l.org || !(l.key in (limits || {}))) continue;
    if (l.key === "oemPerMonth" && "oemPerYear" in limits) continue; // a cota anual é a que vale no produto
    Object.assign(out, l.org(limits[l.key]));
  }
  for (const f of PLAN_FEATURES) {
    if (f.product !== "leverads" || typeof features?.[f.key] !== "boolean") continue;
    for (const field of f.org) out[field] = features[f.key];
  }
  // Plano com cota de Criador e sem o recurso declarado (retrato de venda
  // anterior ao registro de recursos): a cota implica o módulo ligado.
  if (("oemPerMonth" in (limits || {}) || "oemPerYear" in (limits || {})) && typeof features?.oemCreator !== "boolean") out.creator_enabled = true;
  // Cota do Criador só faz sentido com o módulo no plano.
  if (out.creator_enabled === false) { delete out.creator_quota_limit; delete out.creator_quota_period; }
  return out;
}

// Rótulo de um campo da org, pro relatório ("contas pagas: 3 no produto, plano dá 7").
export const ORG_FIELD_LABEL = {
  paid_seats: "contas", per_seller_daily_limit: "cópias por dia", unlimited_quota: "cópias ilimitadas",
  creator_quota_limit: "cota do Criador OEM", creator_quota_period: "período da cota do Criador OEM",
  leverprice_enabled: "módulo Lever Price",
  ...Object.fromEntries(PLAN_FEATURES.flatMap((f) => f.org.map((field) => [field, f.org.length > 1 ? `${f.label} (${field})` : f.label]))),
};

// Recursos padrão de um plano de assinatura do LeverAds que ainda não os
// declara (tabela "Planos × Recursos", 02/10/2026, com os ajustes do Leo):
//   · todos os módulos do Ads em todos os pacotes; Estoque Espelho é um
//     recurso próprio (não é a equalização da apresentação);
//   · cópias por dia, por conta de destino (planilha "planos lever"): 500 no
//     Essencial e 8.000, que é o teto, no Escala;
//   · Criador OEM só na linha "+ OEM", com a cota que o plano já tem (200 por
//     mês no Essencial, ilimitado no Escala).
export const COPIES_PER_DAY_MAX = 8000;
export const DEFAULT_COPIES_PER_DAY = { essencial: 500 };
export function defaultResources(plan) {
  const limits = { ...(plan.limits || {}) };
  const features = { ...(plan.features || {}) };
  if (!("copiesPerDay" in limits)) limits.copiesPerDay = DEFAULT_COPIES_PER_DAY[plan.tier] ?? COPIES_PER_DAY_MAX;
  for (const f of PLAN_FEATURES) {
    if (f.key in features) continue;
    features[f.key] = f.key === "oemCreator" ? ("oemPerYear" in limits || "oemPerMonth" in limits) : true;
  }
  return { limits, features };
}
