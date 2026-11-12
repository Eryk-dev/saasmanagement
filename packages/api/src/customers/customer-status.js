// Status do cliente num lugar só (Carteira, 03/11/2026). O que estava espalhado
// pela ficha, pela aba Cobranças, pelos tickets e pela integração vira UMA
// linha por cliente: ciclo de vida, coluna da carteira, saúde (com as quatro
// partes), pagamento, assinatura, produtos com conta, integração aberta,
// próximo acompanhamento, a régua de marcos, tickets abertos e o último NPS.
//
// Só leitura. Estágio, coluna e saúde são os que os sweeps gravaram
// (lifecycle.js a cada 15 min, health.js a cada 6 h); o status financeiro é
// recalculado aqui com a MESMA função do sweep, porque é o que muda entre um
// sweep e outro (baixa de fatura) e a linha não pode dizer "em dia" ao lado de
// uma fatura vencida. Vencida = `status: "overdue"`, a régua do billing.

import { isChurnedCustomer } from "../billing/churn.js";
import { STATUS_KIND } from "../support/tickets-core.js";
import { dealProductsOf } from "../shared/signup-products.js";
import { financialStatusOf, OPEN_ONBOARDING } from "./lifecycle.js";
import { progressOf } from "./onboardings.js";
import { inMilestoneRuler, milestonesFor } from "./customer-milestones.js";

const DAY = 86_400_000;
const round = (n) => Math.round(n * 100) / 100;
const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : NaN; };

// Assinatura que representa o cliente: a que pede atenção primeiro (atrasada),
// depois a ativa, a pausada e só então as encerradas.
const SUB_RANK = { past_due: 0, active: 1, paused: 2, trial: 3 };
const ENDED_SUBS = new Set(["canceled", "expired", "ended"]);

export function subscriptionSummary(subs, now = Date.now()) {
  if (!subs.length) return null;
  const live = subs.filter((s) => !ENDED_SUBS.has(s.status));
  const pick = [...(live.length ? live : subs)].sort((a, b) =>
    (SUB_RANK[a.status] ?? 9) - (SUB_RANK[b.status] ?? 9)
    || (ms(a.periodEnd) || Infinity) - (ms(b.periodEnd) || Infinity)
    || String(b.periodStart || "").localeCompare(String(a.periodStart || "")))[0];
  const end = ms(pick.periodEnd);
  const renews = (pick.status === "active" || pick.status === "past_due") && Number.isFinite(end) && end >= now;
  return {
    id: pick.id, status: pick.status || "", cycle: pick.cycle || "", periodEnd: pick.periodEnd || "",
    renewInDays: renews ? Math.ceil((end - now) / DAY) : null,
    live: live.length, total: subs.length,
  };
}

export function paymentSummary(invoices, subs, now = Date.now()) {
  const overdue = invoices.filter((i) => i.status === "overdue");
  const oldest = overdue.reduce((min, i) => Math.min(min, ms(i.dueDate) || Infinity), Infinity);
  const upcoming = invoices.filter((i) => i.status === "open" && ms(i.dueDate) >= now)
    .sort((a, b) => ms(a.dueDate) - ms(b.dueDate))[0] || null;
  const lastPaid = invoices.filter((i) => i.status === "paid" && i.paidAt)
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))[0] || null;
  return {
    status: financialStatusOf(subs, invoices),
    overdueCount: overdue.length,
    overdueAmount: round(overdue.reduce((n, i) => n + (Number(i.amount) || 0), 0)),
    overdueDays: Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / DAY)) : 0,
    nextDue: upcoming ? { dueDate: upcoming.dueDate, amount: Number(upcoming.amount) || 0 } : null,
    lastPaidAt: lastPaid?.paidAt || "",
  };
}

// Produtos que a venda inclui e se o cliente já tem conta em cada um. Mentoria
// não tem sistema: `account` fica null (nada a cobrar do integrador). Conta
// vinculada também diz o produto (06/11/2026): o cliente antigo, com o plano só
// em texto ("Anual"), não tem produto na venda, e a Carteira escondia o botão
// "resultados" de quem tem conta do LeverAds com números. Mesma regra da tela
// de Resultados (result-products.js resultProductIds). O nome do plano em
// texto completa a venda quando as assinaturas não dizem os produtos
// (`customer.products`): "LeverAds + LeverPrice · Anual" mostrava só o
// LeverAds da conta vinculada (productsFromPlanText).
export function productsSummary(customer, plans = []) {
  const has = { leverads: Boolean(customer.leveradsOrgId || customer.orgId), leverprice: Boolean(customer.leverpriceOrgId) };
  const ids = dealProductsOf({ customer, plans });
  const listed = Array.isArray(customer.products) && customer.products.length > 0;
  const text = listed ? [] : productsFromPlanText(`${customer.plan || ""} ${customer.planCustom || ""}`);
  for (const id of ["leverads", "leverprice", "mentoria"]) if ((has[id] || text.includes(id)) && !ids.includes(id)) ids.push(id);
  return ids.map((id) => ({ id, account: id in has ? has[id] : null }));
}

// Produtos citados no nome do plano escrito à mão (cliente de antes do
// catálogo): "ADS + PRICE", "LeverOEM Escala + LeverPrice Essencial", "1000
// SKUS + PRICE", "Criação 1000 anúncios", "MENTORIA GABI". "Anual" sozinho não
// diz nada. Só para mostrar: acesso e cobrança não leem isto.
const PRICE_TEXT = /lever\s*price|\bprice\b/i;
const ADS_TEXT = /lever\s*a+ds|lever\s*oem|\bads\b|\boem\b|an[uú]ncios?|\bskus?\b/i;
const MENTORIA_TEXT = /mentoria/i;
export function productsFromPlanText(text) {
  const t = String(text || "");
  return [ADS_TEXT.test(t) && "leverads", PRICE_TEXT.test(t) && "leverprice", MENTORIA_TEXT.test(t) && "mentoria"].filter(Boolean);
}

export function nextFollowup(followups, now = Date.now()) {
  const open = followups.filter((f) => f.status === "aberto")
    .sort((a, b) => (ms(a.dueAt) || Infinity) - (ms(b.dueAt) || Infinity));
  const f = open[0];
  if (!f) return null;
  const due = ms(f.dueAt);
  return { id: f.id, kind: f.kind, title: f.title || "", milestone: f.milestone || "", owner: f.owner || "", dueAt: f.dueAt || "", late: Number.isFinite(due) && due < now, open: open.length };
}

export function openOnboarding(onboardings) {
  const o = onboardings.filter((x) => OPEN_ONBOARDING.has(x.stage))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  return o ? { id: o.id, stage: o.stage, kind: o.kind || "", progress: progressOf(o), plannedGoLiveAt: o.plannedGoLiveAt || "" } : null;
}

// Régua de marcos (customer-milestones.js): a mesma linha do tempo da ficha,
// com o ciclo da assinatura ativa como fallback do contrato. `steps` é um
// status por marco, na ordem, pra desenhar a barra; `next` é o primeiro em
// aberto. Mentoria, churn e cliente sem data de entrada ficam sem régua.
export function milestoneSummary(customer, product, subs, now = Date.now()) {
  if (!inMilestoneRuler(customer, now)) return null;
  const cycle = subs.find((x) => x.status === "active" || x.status === "past_due")?.cycle;
  const list = milestonesFor({ ...customer, contractCycle: customer.contractCycle || cycle }, product, now);
  if (!list.length) return null;
  const next = list.find((m) => m.status !== "done") || null;
  return {
    done: list.filter((m) => m.status === "done").length,
    total: list.length,
    late: list.filter((m) => m.status === "late").length,
    steps: list.map((m) => ({ key: m.key, label: m.label, status: m.status })),
    next: next ? { key: next.key, label: next.label, dueAt: next.dueAt, status: next.status } : null,
  };
}

// Última resposta da pesquisa da integração (integration-survey.js). Fica na
// linha para o CS avaliar; não entra no health score.
export function lastIntegrationSurvey(rows) {
  const r = rows.filter((x) => x.status === "answered" && x.score != null)
    .sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)))[0];
  return r ? { score: Number(r.score), ready: r.ready || "", at: r.answeredAt || "", onboarding: r.onboarding || "" } : null;
}

export function ticketsSummary(tickets) {
  const open = tickets.filter((t) => STATUS_KIND[t.status] !== "done");
  return { open: open.length, urgent: open.filter((t) => t.priority === "urgent" || t.priority === "high").length };
}

export function lastNps(nps) {
  const n = nps.filter((x) => x.status === "answered" && x.score !== null && x.score !== undefined)
    .sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)))[0];
  return n ? { score: Number(n.score), at: n.answeredAt || "" } : null;
}

const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
};

export function statusRow(c, { subs = [], invoices = [], followups = [], onboardings = [], tickets = [], nps = [], surveys = [], plans = [], product = null }, now = Date.now()) {
  const churned = isChurnedCustomer(c, now);
  return {
    id: c.id, name: c.name || "", owner: c.owner || "", saas: c.saas || "",
    startedAt: c.startedAt || "", endedAt: c.endedAt || "", churned,
    plan: c.plan || "",
    mrr: churned ? 0 : round((Number(c.arr) || 0) / 12),
    lifecycle: c.lifecycle || "", csStage: c.csStage || "",
    // Estado da integração gravado pelo sweep (integration-status.js):
    // integrando, aguardando (venda sem a entrega começar) ou integrado.
    integration: { status: c.integrationStatus || "", at: c.milestonesDone?.onboarding || "", leadId: c.leadId || "" },
    health: Number(c.health) || 0, healthParts: c.healthParts || null, healthAt: c.healthAt || "",
    payment: paymentSummary(invoices, subs, now),
    subscription: subscriptionSummary(subs, now),
    products: productsSummary(c, plans),
    onboarding: openOnboarding(onboardings),
    followup: nextFollowup(followups, now),
    milestones: milestoneSummary(c, product, subs, now),
    tickets: ticketsSummary(tickets),
    nps: lastNps(nps),
    integrationSurvey: lastIntegrationSurvey(surveys),
  };
}

// Uma leitura por coleção (filtrada pelo produto), nunca uma por cliente.
export async function customerStatusBoard(repo, { saas = "", now = Date.now() } = {}) {
  const where = saas ? { saas } : {};
  const [customers, subs, invoices, followups, onboardings, tickets, nps, plans, products, surveys] = await Promise.all([
    repo.listWhere("customers", where),
    repo.listWhere("subscriptions", where),
    repo.listWhere("invoices", where),
    repo.listWhere("cs_followups", where),
    repo.listWhere("onboardings", where),
    repo.listWhere("tickets", where, { fields: ["customerId", "status", "priority"] }),
    repo.listWhere("nps", where),
    repo.listWhere("plans", where),
    repo.list("products"),
    repo.listWhere("integration_surveys", where).catch(() => []),
  ]);
  const productOf = new Map(products.map((p) => [p.id, p]));
  const by = {
    subs: groupBy(subs, "customer"), invoices: groupBy(invoices, "customer"),
    followups: groupBy(followups, "customer"), onboardings: groupBy(onboardings, "customer"),
    tickets: groupBy(tickets, "customerId"), nps: groupBy(nps, "customer"),
    surveys: groupBy(surveys, "customer"),
  };
  const rows = customers.map((c) => statusRow(c, {
    subs: by.subs.get(c.id) || [], invoices: by.invoices.get(c.id) || [],
    followups: by.followups.get(c.id) || [], onboardings: by.onboardings.get(c.id) || [],
    tickets: by.tickets.get(c.id) || [], nps: by.nps.get(c.id) || [], surveys: by.surveys.get(c.id) || [], plans, product: productOf.get(c.saas) || null,
  }, now));
  return { generatedAt: new Date(now).toISOString(), rows };
}
