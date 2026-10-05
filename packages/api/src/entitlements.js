// Entitlements: o que cada cliente TEM DIREITO em cada produto, calculado a
// partir do billing e do plano contratado. Funções puras; quem entrega o
// resultado a cada produto são os adaptadores:
//   · LeverAds legado (leverads-access.js): escreve `payment_active` e, por
//     enquanto, só RELATA a diferença de limites (contas, cota de OEM, Price);
//   · LeverId (auth novo): receberá o direito de acesso por org × produto
//     (`identity_api.set_product_grant`, com o código do plano e sem preço).
//     Ainda não existe adaptador; o cálculo daqui já sai no formato que ele usa.
//
// Preço e cobrança ficam no Cockpit; limites e módulos são APLICADOS dentro de
// cada produto. Os limites vêm do retrato do plano na venda (planSnapshot), não
// do plano vivo: mudar a tabela não muda o direito de quem já contratou.

import { leveradsOrgFields } from "./plan-resources.js";

// O que o acesso (paywall) DEVERIA ser, dado o billing do cliente no cockpit.
// null = não mexer (sem assinatura não dá pra inferir nada).
export function desiredAccess(customer, subs) {
  if (!subs.length) return null;
  if (customer.endedAt) return { paymentActive: false, reason: "cliente encerrado (endedAt)" };
  if (subs.some((s) => s.status === "past_due")) return { paymentActive: false, reason: "fatura vencida (past_due)" };
  if (subs.some((s) => s.status === "active")) return { paymentActive: true, reason: "assinatura em dia" };
  return { paymentActive: false, reason: "sem assinatura ativa (cancelada/pausada)" };
}

// Identidade da org do cliente em cada sistema. Hoje o vínculo é o id da org no
// LeverAds (`leveradsOrgId`); com o LeverId passa a ser `orgId`. Enquanto a
// carga do LeverId preservar o id da org do LeverAds, LEVERID_ORG_FROM_LEVERADS=1
// reaproveita o vínculo que já existe.
export function orgRefOf(customer, env = process.env) {
  return {
    leverads: String(customer?.leveradsOrgId || ""),
    leverprice: String(customer?.leverpriceOrgId || ""),
    leverid: String(customer?.orgId || (env.LEVERID_ORG_FROM_LEVERADS === "1" ? customer?.leveradsOrgId || "" : "")),
  };
}

export const planKey = (saas, code) => `${saas}:${code}`;
export const plansByCodeOf = (plans) => new Map((plans || []).filter((p) => p?.code).map((p) => [planKey(p.saas, p.code), p]));

// Direitos do cliente, um por produto de acesso. null = sem assinatura (não
// mexe). `source` diz de onde saíram os limites:
//   plan    → retrato do plano do catálogo;
//   custom  → venda personalizada: acesso sim/não, limites acertados à mão;
//   unknown → cliente sem plano identificado.
// `defaultProduct` = produto de acesso de quem não tem plano (cliente antigo do
// próprio produto segue com o acesso dele).
//
// Um cliente pode ter MAIS DE UM produto ao mesmo tempo, cada um com a sua
// assinatura (LeverAds num plano, LeverPrice em outro). O plano vive na
// assinatura: as assinaturas são agrupadas pelo produto de acesso do plano de
// cada uma, e cada produto tem o seu acesso (pelo status das assinaturas DELE)
// e os seus limites. Assinatura sem plano (venda antiga) usa o plano do
// cadastro do cliente.
const PRODUCT_ORDER = ["leverads", "leverprice"];
export function desiredEntitlements(customer, subs, plansByCode, { defaultProduct = "" } = {}) {
  if (!subs.length) return null;
  const planOf = (code) => (code ? plansByCode?.get(planKey(customer.saas, code)) || null : null);
  const groups = new Map();
  for (const s of subs) {
    const own = !!(s.planSnapshot || s.planCode);
    const snapshot = s.planSnapshot || (own ? null : customer.planSnapshot) || null;
    const planCode = s.planCode || (own ? "" : customer.planCode) || "";
    const plan = planOf(planCode);
    const product = snapshot?.accessProduct || plan?.access?.product || (planCode ? "" : defaultProduct);
    if (!product) continue; // plano sem produto de acesso (compra única, mentoria)
    if (!groups.has(product)) groups.set(product, []);
    groups.get(product).push({ sub: s, snapshot, planCode, plan });
  }
  const order = (p) => (PRODUCT_ORDER.includes(p) ? PRODUCT_ORDER.indexOf(p) : PRODUCT_ORDER.length);
  return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([product, rows]) => {
    const access = desiredAccess(customer, rows.map((r) => r.sub));
    const live = rows.find((r) => r.sub.status === "active" || r.sub.status === "past_due") || rows[0];
    const { snapshot, planCode, plan } = live;
    return {
      product,
      access: { active: access.paymentActive, kind: "paid", reason: access.reason },
      planCode, planName: snapshot?.name || plan?.name || customer.planCustom || "",
      limits: snapshot ? { ...(snapshot.limits || {}) } : null,
      // Recursos (módulos) do retrato da venda; retrato antigo, sem recursos,
      // usa os do plano vivo.
      features: { ...(snapshot?.features || plan?.features || {}) },
      ref: live.sub.id || "",
      source: snapshot ? "plan" : (customer.planCustom ? "custom" : "unknown"),
    };
  });
}

// De-para do direito pros campos que a API de super-admin do LeverAds aceita
// (PUT /api/super/orgs/:id). A lista de limites e recursos e o campo de cada um
// moram em plan-resources.js.
export const leveradsLimitFields = (entitlement) => leveradsOrgFields(entitlement || {});

// Diferença entre o que o plano pede e o que a org tem. Campo que a listagem do
// produto não devolve não dá pra comparar: sai em `unsupported`.
export function limitsDiff(org, want) {
  const changes = {};
  const unsupported = [];
  for (const [field, to] of Object.entries(want)) {
    if (!(field in (org || {}))) { unsupported.push(field); continue; }
    const from = org[field];
    const same = typeof to === "boolean" ? Boolean(from) === to : (from ?? null) === (to ?? null);
    if (!same) changes[field] = { from: from ?? null, to };
  }
  return { changes, unsupported };
}
