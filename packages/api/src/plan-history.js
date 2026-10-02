// Plano CONTRATADO, de forma estruturada, e o histórico das mudanças.
//
// O rótulo `customer.plan` ("Ads Escala · Anual") continua existindo e
// com o mesmo texto: marcos e análises leem dele. O que entra aqui é o que o
// rótulo não guarda: o CÓDIGO do plano do catálogo (`planCode`), o ciclo do
// fechamento (`planCycle`) e um retrato do plano no momento da venda
// (`planSnapshot`: preço de tabela, versão de preço, limites, produto de
// acesso). Venda fora do catálogo ("Personalizado") fica em `planCustom`.
//
// `plan_changes` é append-only: uma linha por evento (início, reedição do
// fechamento, upgrade, troca agendada/aplicada, upsell, churn, edição manual).
// Nada aqui mexe em arr, preço ou ciclo de assinatura: receita segue a régua
// de billing.js / metrics-core.js.

import { randomUUID } from "node:crypto";
import { CLOSED_PLAN_LABEL, CYCLE_TITLE, closedPlanToCycle, cycleToClosedPlan, closedPlanFromLabel } from "./plan-cycles.js";
import { isPlanV2, planIdOf, plansOf, sameJson } from "./plan-catalog.js";
import { planProductOf } from "./plan-resources.js";

// Plano v2 por id ("plan_leverads_oem_escala") ou por código ("oem_escala").
export async function findPlan(repo, saas, ref) {
  const key = String(ref || "").trim();
  if (!key) return null;
  for (const id of [key, planIdOf(saas, key)]) {
    const p = await repo.get("plans", id);
    if (p && isPlanV2(p) && (!saas || p.saas === saas)) return p;
  }
  return null;
}

// Retrato do plano no momento da contratação. O preço de tabela é o do ciclo
// fechado; compra única usa o preço único (quando o plano tem só um).
export function planSnapshotOf(plan, { closedPlan = "", cycle = "", at = new Date().toISOString() } = {}) {
  const cyc = cycle || closedPlanToCycle(closedPlan);
  const table = plan.prices?.[cyc]?.total ?? (plan.kind === "one_off" ? plan.prices?.once?.total : undefined);
  return {
    code: plan.code, name: plan.name,
    closedPlan: closedPlan || cycleToClosedPlan(cyc), cycle: cyc,
    priceVersion: Number(plan.priceVersion) || 1,
    listPrice: table == null ? null : Number(table) || 0,
    limits: JSON.parse(JSON.stringify(plan.limits || {})),
    features: JSON.parse(JSON.stringify(plan.features || {})),
    product: planProductOf(plan),
    accessProduct: plan.access?.product || "",
    at,
  };
}

// Rótulo do plano do cliente: nome + ciclo, no formato de sempre.
export const planLabel = (name, cycleKey) =>
  [String(name || "").trim(), CLOSED_PLAN_LABEL[cycleKey] || CYCLE_TITLE[cycleKey]].filter(Boolean).join(" · ");

// Campos de plano que um FECHAMENTO implica (lead.dealProduct + planClosed).
// null quando o lead não diz nem produto nem ciclo. `subscription` é o que vai
// na assinatura nascida do fechamento.
export async function planFieldsFromDeal(repo, lead) {
  const ref = String(lead?.dealProduct || "").trim();
  const closedPlan = String(lead?.planClosed || "");
  if (!ref && !closedPlan) return null;
  const plan = ref ? await findPlan(repo, lead.saas, ref) : null;
  const planSnapshot = plan ? planSnapshotOf(plan, { closedPlan }) : null;
  return {
    customer: { planCode: plan?.code || "", planCustom: plan ? "" : ref, planCycle: closedPlan, planSnapshot },
    subscription: plan ? { plan: plan.id, planCode: plan.code, planSnapshot } : {},
  };
}

// Estado do plano de um cliente/assinatura, pro "de → para" do histórico.
export const customerPlanState = (c) => ({
  planCode: c?.planCode || "", planName: c?.plan || "", cycle: c?.planCycle || "", arr: Number(c?.arr) || 0,
});
export const subscriptionPlanState = (s) => ({
  planCode: s?.planCode || "", planName: s?.planSnapshot?.name || "", cycle: s?.cycle || "", price: Number(s?.price) || 0,
});

// Tipos que valem como registro mesmo sem diferença entre "de" e "para".
const ALWAYS = new Set(["start", "upsell", "churn", "reactivation", "canceled", "paused", "backfill", "scheduled"]);

// Grava um evento do histórico. Best-effort: histórico nunca quebra a operação
// que o gerou. Sem mudança real (de == para), não grava.
export async function recordPlanChange(repo, evt) {
  try {
    if (!evt?.customer) return null;
    if (!ALWAYS.has(evt.type) && sameJson(evt.from || null, evt.to || null)) return null;
    const at = evt.at || new Date().toISOString();
    return await repo.create("plan_changes", {
      id: "pc_" + randomUUID(),
      saas: evt.saas || "", customer: evt.customer, subscription: evt.subscription || "", lead: evt.lead || "",
      type: evt.type, at, effectiveAt: evt.effectiveAt || at,
      from: evt.from || null, to: evt.to || null,
      listPrice: evt.listPrice ?? null, priceVersion: evt.priceVersion ?? null,
      amount: evt.amount ?? null,
      source: evt.source || "", author: evt.author || "", note: evt.note || "",
      ref: evt.ref || {},
    });
  } catch { return null; }
}

export async function planHistoryOf(repo, customerId) {
  return (await repo.listWhere("plan_changes", { customer: customerId }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Cliente desfeito (fechamento errado): o histórico dele sai junto, como as
// faturas e a assinatura.
export async function removePlanHistory(repo, customerId) {
  try {
    for (const e of await repo.listWhere("plan_changes", { customer: customerId }, { fields: [] })) {
      await repo.remove("plan_changes", e.id);
    }
  } catch { /* fail-open */ }
}

const liveSubs = (subs, customerId) => subs.filter((s) => s.customer === customerId && s.status !== "canceled");

// Assinaturas vivas do cliente que têm plano do catálogo, a mais antiga primeiro.
export const plannedSubs = (subs, customerId) => liveSubs(subs, customerId)
  .filter((s) => s.planCode && s.planSnapshot)
  .sort((a, b) => String(a.periodStart || "").localeCompare(String(b.periodStart || "")) || String(a.id).localeCompare(String(b.id)));

// O PLANO VIVE NA ASSINATURA: um cliente pode ter mais de um produto, cada um
// com a sua. O cadastro do cliente espelha a assinatura PRINCIPAL (a mais
// antiga viva com plano) em planCode/planSnapshot/rótulo, que é o que as
// listas e os marcos leem, e guarda em `products` todos os produtos
// contratados. Sem assinatura com plano, o cadastro fica como está (cliente
// de compra única ou com o plano informado à mão).
// O ciclo do cliente só muda quando a mudança FOI de ciclo ou a principal
// trocou: assinatura faturada mês a mês de um contrato anual continua "Anual".
export async function syncCustomerPlanFromSub(repo, sub, { cycleChanged = false } = {}) {
  if (!sub?.customer) return null;
  const customer = await repo.get("customers", sub.customer);
  if (!customer) return null;
  const planned = plannedSubs(await repo.list("subscriptions"), customer.id);
  if (!planned.length) return null;
  const primary = planned[0];
  const samePlan = customer.planCode === primary.planCode;
  const keepCycle = samePlan && customer.planCycle && !(cycleChanged && primary.id === sub.id);
  const planCycle = keepCycle ? customer.planCycle : (cycleToClosedPlan(primary.cycle) || primary.cycle);
  const patch = {
    planCode: primary.planCode, planCustom: "", planCycle, planSnapshot: primary.planSnapshot,
    plan: planLabel(primary.planSnapshot.name, planCycle),
    products: [...new Set(planned.map((s) => s.planSnapshot.product || s.planSnapshot.accessProduct).filter(Boolean))],
  };
  const current = { planCode: customer.planCode, planCustom: customer.planCustom, planCycle: customer.planCycle, planSnapshot: customer.planSnapshot, plan: customer.plan, products: customer.products };
  if (sameJson(patch, current)) return customer;
  return repo.update("customers", customer.id, patch);
}

// Edição MANUAL do plano no cadastro do cliente (planCode / planCycle /
// planCustom). Devolve o patch a mesclar; lança { statusCode } quando o código
// não existe no catálogo do produto. O rótulo só é recalculado quando o corpo
// não trouxe um `plan` próprio.
export async function customerPlanPatch(repo, customer, body) {
  const out = {};
  const planCycle = "planCycle" in body ? String(body.planCycle || "") : (customer.planCycle || "");
  const code = "planCode" in body ? String(body.planCode || "").trim() : (customer.planCode || "");
  const custom = "planCustom" in body ? String(body.planCustom || "").trim().slice(0, 80) : (code ? "" : customer.planCustom || "");
  let plan = null;
  if (code) {
    plan = await findPlan(repo, customer.saas, code);
    if (!plan) throw Object.assign(new Error("plano não existe no catálogo deste produto"), { statusCode: 422 });
  }
  out.planCode = plan?.code || "";
  out.planCustom = plan ? "" : custom;
  out.planCycle = planCycle;
  // Mesmo plano e mesmo ciclo: o retrato da venda fica (inclusive limites
  // negociados); trocou, nasce um retrato novo com a tabela de hoje.
  const same = plan && customer.planSnapshot?.code === plan.code && (customer.planCycle || "") === planCycle;
  out.planSnapshot = plan ? (same ? customer.planSnapshot : planSnapshotOf(plan, { closedPlan: planCycle })) : null;
  if (!("plan" in body)) {
    const label = planLabel(plan?.name || out.planCustom, planCycle);
    if (label) out.plan = label;
  }
  return { patch: out, plan };
}

// Carimba o plano na única assinatura viva do cliente (sem tocar preço/ciclo).
export async function stampSubscriptionPlan(repo, customerId, plan, planSnapshot) {
  const subs = liveSubs(await repo.list("subscriptions"), customerId);
  if (subs.length !== 1) return null;
  const next = plan ? { plan: plan.id, planCode: plan.code, planSnapshot } : { plan: "", planCode: "", planSnapshot: null };
  if (sameJson(next, { plan: subs[0].plan || "", planCode: subs[0].planCode || "", planSnapshot: subs[0].planSnapshot ?? null })) return subs[0];
  return repo.update("subscriptions", subs[0].id, next);
}

// ── Backfill dos clientes que já existem ───────────────────────────────────
// Uma vez (marcador em app_config), depois que o catálogo de planos do produto
// existe. Preenche código/ciclo a partir do que o cadastro e o lead de origem
// já dizem. NÃO inventa preço de tabela histórico (listPrice/priceVersion
// nulos, `backfilled: true`) e não toca arr, preço, ciclo, rótulo nem endedAt.
const BACKFILL_FLAG = "customer_plans_v1";
export async function backfillCustomerPlans(repo) {
  if (await repo.get("app_config", BACKFILL_FLAG).catch(() => null)) return null;
  if (!(await plansOf(repo)).length) return null; // catálogo ainda não semeado: tenta no próximo boot
  const subsAll = await repo.list("subscriptions");
  const report = { stamped: 0, custom: 0, unknown: 0 };
  for (const c of await repo.list("customers")) {
    if ("planCode" in c) continue;
    const lead = c.leadId ? await repo.get("leads", c.leadId).catch(() => null) : null;
    const ref = String(c.dealProduct || lead?.dealProduct || "").trim();
    const plan = ref ? await findPlan(repo, c.saas, ref) : null;
    const subs = liveSubs(subsAll, c.id);
    const closedPlan = lead?.planClosed || closedPlanFromLabel(c.plan) || cycleToClosedPlan(subs[0]?.cycle) || "";
    if (!plan && !ref && !closedPlan) { report.unknown++; continue; }
    const planSnapshot = plan
      ? { ...planSnapshotOf(plan, { closedPlan, at: c.startedAt || new Date().toISOString() }), listPrice: null, priceVersion: null, backfilled: true }
      : null;
    await repo.update("customers", c.id, { planCode: plan?.code || "", planCustom: plan ? "" : ref, planCycle: closedPlan, planSnapshot });
    if (plan && subs.length === 1 && !subs[0].plan && !subs[0].planCode) {
      await repo.update("subscriptions", subs[0].id, { plan: plan.id, planCode: plan.code, planSnapshot });
    }
    await recordPlanChange(repo, {
      type: "backfill", saas: c.saas, customer: c.id, subscription: subs.length === 1 ? subs[0].id : "", lead: c.leadId || "",
      at: c.startedAt || undefined, from: null,
      to: { planCode: plan?.code || "", planName: c.plan || "", cycle: closedPlan, arr: Number(c.arr) || 0 },
      source: "migration", author: "migration",
    });
    if (plan) report.stamped++; else report.custom++;
  }
  await repo.create("app_config", { id: BACKFILL_FLAG, at: new Date().toISOString(), ...report });
  return report;
}
