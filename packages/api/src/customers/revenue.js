// Receita recorrente da carteira — Fase 3 do plano do Lever CRM: os
// movimentos de MRR (novo, expansão, contração, churn) tirados do histórico
// append-only de plano (`plan_changes`), as renovações que vencem em
// 7/15/30/60 dias e o aging da inadimplência. Só leitura.

import { CYCLE_MONTHS } from "../shared/plan-cycles.js";

const DAY = 86_400_000;
const round = (n) => Math.round(n * 100) / 100;

// MRR de um estado do histórico: do cliente (arr) ou da assinatura (preço por ciclo).
export function mrrOfState(state) {
  if (!state) return 0;
  if (Number(state.arr)) return Number(state.arr) / 12;
  const months = CYCLE_MONTHS[state.cycle] || 0;
  return months ? (Number(state.price) || 0) / months : 0;
}

const NEW_TYPES = new Set(["start", "reactivation"]);
const CHURN_TYPES = new Set(["churn", "canceled"]);

// Um movimento por mudança de plano, com o delta de MRR e a classe.
export function movementOf(pc) {
  const from = mrrOfState(pc.from);
  const to = CHURN_TYPES.has(pc.type) ? 0 : mrrOfState(pc.to);
  const delta = NEW_TYPES.has(pc.type) ? to : to - from;
  if (!delta) return null;
  const kind = NEW_TYPES.has(pc.type) ? "novo" : CHURN_TYPES.has(pc.type) ? "churn" : delta > 0 ? "expansao" : "contracao";
  return { id: pc.id, customer: pc.customer, saas: pc.saas || "", at: pc.effectiveAt || pc.at, type: pc.type, kind, delta: round(delta) };
}

export function mrrMovements(planChanges, { from = "", to = "", saas = "" } = {}) {
  const items = planChanges
    .filter((pc) => (!saas || pc.saas === saas))
    .map(movementOf).filter(Boolean)
    .filter((m) => (!from || m.at >= from) && (!to || m.at < to))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const sum = (k) => round(items.filter((m) => m.kind === k).reduce((n, m) => n + m.delta, 0));
  const totals = { novo: sum("novo"), expansao: sum("expansao"), contracao: sum("contracao"), churn: sum("churn") };
  return { totals: { ...totals, liquido: round(totals.novo + totals.expansao + totals.contracao + totals.churn) }, items };
}

export const RENEWAL_WINDOWS = [7, 15, 30, 60];

// Assinatura ativa cujo ciclo termina dentro de 60 dias, na menor janela que a contém.
export function renewalsDue(subs, customers, { now = Date.now(), saas = "" } = {}) {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const out = Object.fromEntries(RENEWAL_WINDOWS.map((d) => [d, []]));
  for (const s of subs) {
    if (s.status !== "active" || (saas && s.saas !== saas)) continue;
    const end = Date.parse(s.periodEnd || "");
    if (!Number.isFinite(end) || end < now) continue;
    const days = Math.ceil((end - now) / DAY);
    const window = RENEWAL_WINDOWS.find((d) => days <= d);
    if (!window) continue;
    const c = byId.get(s.customer);
    out[window].push({ subscription: s.id, customer: s.customer, name: c?.name || "", owner: c?.owner || "", periodEnd: s.periodEnd, days, mrr: round(mrrOfState(s)) });
  }
  for (const d of RENEWAL_WINDOWS) out[d].sort((a, b) => a.days - b.days);
  return out;
}

export const AGING_BUCKETS = [["1-30", 1, 30], ["31-60", 31, 60], ["61-90", 61, 90], ["90+", 91, Infinity]];

// Faturas vencidas e não pagas por idade do atraso, com valor em aberto.
export function delinquencyAging(invoices, { now = Date.now(), saas = "" } = {}) {
  const buckets = Object.fromEntries(AGING_BUCKETS.map(([k]) => [k, { count: 0, amount: 0, invoices: [] }]));
  for (const i of invoices) {
    if (i.status === "paid" || i.status === "canceled" || (saas && i.saas !== saas)) continue;
    const due = Date.parse(i.dueDate || "");
    if (!Number.isFinite(due) || due >= now) continue;
    const late = Math.floor((now - due) / DAY);
    const b = AGING_BUCKETS.find(([, lo, hi]) => late >= lo && late <= hi);
    if (!b) continue;
    const slot = buckets[b[0]];
    slot.count++;
    slot.amount = round(slot.amount + (Number(i.amount) || 0));
    slot.invoices.push({ id: i.id, customer: i.customer, amount: Number(i.amount) || 0, dueDate: i.dueDate, late });
  }
  const total = round(Object.values(buckets).reduce((n, b) => n + b.amount, 0));
  return { buckets, total };
}

export async function revenueReport(repo, { from = "", to = "", saas = "", now = Date.now() } = {}) {
  const [planChanges, subs, invoices, customers] = await Promise.all([
    repo.list("plan_changes"), repo.list("subscriptions"), repo.list("invoices"), repo.list("customers"),
  ]);
  return {
    movements: mrrMovements(planChanges, { from, to, saas }),
    renewals: renewalsDue(subs, customers, { now, saas }),
    aging: delinquencyAging(invoices, { now, saas }),
  };
}
