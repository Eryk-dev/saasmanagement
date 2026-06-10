// Billing nativo (fase 5) — Cockpit é o system-of-record de assinaturas: planos,
// faturas e dunning vivem aqui; o processamento do pagamento (Mercado Pago, fase 4)
// fica a cargo do app por enquanto — pagamentos entram via POST /api/invoices/:id/pay.
//
// Invariante do rollup (não quebrar): TODA mudança de assinatura reescreve
// `customer.arr` — receita/MRR/clientes do produto derivam SEMPRE da coleção
// `customers` (rollupProduct em routes.js).
//
// Pró-rata: port da lógica de copylever/app/services/prorata.py (sem seats e sem
// mínimo do MP — aqui a fatura é registro, não cobrança de gateway):
//   upgrade mid-cycle  → aplica preço novo já + fatura pró-rata do diff restante.
//   downgrade          → agendado pro fim do ciclo (pendingChange).
//   troca de ciclo     → agendada pro fim do ciclo (MP não muda frequency in-place).

export const CYCLE_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

const DAY_MS = 86400000;

// Soma meses a uma data ISO clampando pro último dia do mês (31/jan + 1m = 28/fev).
export function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}

// Valor anualizado de uma assinatura (preço é por ciclo).
export function annualized(price, cycle) {
  const months = CYCLE_MONTHS[cycle] || 1;
  return (Number(price) || 0) * (12 / months);
}

// ARR contratado = assinaturas não-encerradas (past_due ainda é receita contratada;
// paused/canceled saem).
export function contractedArr(subs) {
  return subs
    .filter((s) => s.status === "active" || s.status === "past_due")
    .reduce((a, s) => a + annualized(s.price, s.cycle), 0);
}

// Reescreve customer.arr a partir das assinaturas do cliente. Só é chamada em
// mutação de assinatura/billing — cliente sem assinatura nunca passa por aqui,
// então o arr manual dele continua valendo.
export async function syncCustomerArr(repo, customerId) {
  if (!customerId) return null;
  const customer = await repo.get("customers", customerId);
  if (!customer) return null;
  const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customerId);
  return repo.update("customers", customerId, { arr: Math.round(contractedArr(subs)) });
}

// Completa uma assinatura recém-criada: janela do 1º ciclo + fatura inicial + ARR.
// (Chamada pelo POST genérico — defaults estáticos não sabem datas.)
export async function initSubscription(repo, sub, now = new Date()) {
  const periodStart = sub.periodStart || sub.startedAt || now.toISOString();
  const periodEnd = sub.periodEnd || addMonths(periodStart, CYCLE_MONTHS[sub.cycle] || 1);
  const updated = await repo.update("subscriptions", sub.id, { periodStart, periodEnd });
  await repo.create("invoices", {
    subscription: sub.id, customer: sub.customer, saas: sub.saas,
    amount: Number(sub.price) || 0, kind: "renewal", status: "open",
    dueDate: periodStart, periodStart, periodEnd, createdAt: now.toISOString(),
  });
  await syncCustomerArr(repo, sub.customer);
  return updated;
}

// Decide o tipo de mudança e o valor pró-rata (port de prorata.compute_change).
export function computeChange(sub, { price, cycle, plan } = {}, now = new Date()) {
  const oldPrice = Number(sub.price) || 0;
  const newPrice = price != null && price !== "" ? Number(price) : oldPrice;
  const newCycle = cycle || sub.cycle;
  if (newCycle !== sub.cycle)
    return { changeType: "cycle_change", prorata: 0, applyAt: sub.periodEnd };
  if (newPrice === oldPrice && (plan == null || plan === sub.plan))
    return { changeType: "no_op", prorata: 0, applyAt: null };
  if (newPrice < oldPrice)
    return { changeType: "downgrade_mid_cycle", prorata: 0, applyAt: sub.periodEnd };

  const start = new Date(sub.periodStart).getTime();
  const end = new Date(sub.periodEnd).getTime();
  const daysInCycle = Math.max(1, Math.round((end - start) / DAY_MS));
  const daysRemaining = Math.max(0, Math.floor((end - now.getTime()) / DAY_MS));
  const prorata = Math.round(((newPrice - oldPrice) / daysInCycle) * daysRemaining);
  return { changeType: "upgrade_mid_cycle", prorata, applyAt: null };
}

// Motor de billing — determinístico, roda por tick (POST /api/billing/run, cron ou
// MCP): aplica mudanças agendadas vencidas, gera faturas de renovação no rollover
// do ciclo, marca dunning (open vencida + carência → overdue; assinatura com
// overdue → past_due; sem overdue → volta a active) e re-sincroniza o ARR.
export async function runBilling(repo, { now = new Date(), graceDays = 3 } = {}) {
  const nowIso = now.toISOString();
  const report = { applied: 0, renewed: 0, overdue: 0, pastDue: 0, recovered: 0 };
  const touched = new Set();

  for (let sub of await repo.list("subscriptions")) {
    if (sub.pendingChange?.applyAt && new Date(sub.pendingChange.applyAt) <= now) {
      const pc = sub.pendingChange;
      sub = await repo.update("subscriptions", sub.id, {
        price: pc.price ?? sub.price, cycle: pc.cycle || sub.cycle, plan: pc.plan ?? sub.plan,
        pendingChange: null,
      });
      report.applied++;
      touched.add(sub.customer);
    }
    if (sub.status !== "active" && sub.status !== "past_due") continue;
    let guard = 0; // dados ruins (periodEnd muito no passado) não podem virar loop infinito
    while (sub.periodEnd && new Date(sub.periodEnd) <= now && guard++ < 24) {
      const periodStart = sub.periodEnd;
      const periodEnd = addMonths(periodStart, CYCLE_MONTHS[sub.cycle] || 1);
      sub = await repo.update("subscriptions", sub.id, { periodStart, periodEnd });
      await repo.create("invoices", {
        subscription: sub.id, customer: sub.customer, saas: sub.saas,
        amount: Number(sub.price) || 0, kind: "renewal", status: "open",
        dueDate: periodStart, periodStart, periodEnd, createdAt: nowIso,
      });
      report.renewed++;
      touched.add(sub.customer);
    }
  }

  const graceMs = graceDays * DAY_MS;
  const overdueBySub = new Set();
  for (const inv of await repo.list("invoices")) {
    if (inv.status === "open" && inv.dueDate && new Date(inv.dueDate).getTime() + graceMs <= now.getTime()) {
      await repo.update("invoices", inv.id, { status: "overdue", overdueAt: nowIso });
      report.overdue++;
      if (inv.subscription) overdueBySub.add(inv.subscription);
    } else if (inv.status === "overdue" && inv.subscription) {
      overdueBySub.add(inv.subscription);
    }
  }
  for (const sub of await repo.list("subscriptions")) {
    if (overdueBySub.has(sub.id) && sub.status === "active") {
      await repo.update("subscriptions", sub.id, { status: "past_due" });
      report.pastDue++;
      touched.add(sub.customer);
    } else if (!overdueBySub.has(sub.id) && sub.status === "past_due") {
      await repo.update("subscriptions", sub.id, { status: "active" });
      report.recovered++;
      touched.add(sub.customer);
    }
  }

  for (const customerId of touched) await syncCustomerArr(repo, customerId);
  return report;
}
