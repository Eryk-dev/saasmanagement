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

export const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

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

// Assinatura nascida do FECHAMENTO (convertWonLead) ou do backfill: o plano
// fechado + meio de pagamento viram ciclo e preço. Faturado/parcelado (boleto,
// pix_parcelado) = ciclo MENSAL com o valor da parcela; à vista/cartão 12x =
// ciclo do plano com o valor cheio (a adquirente antecipa). Serviço único não é
// recorrência → null. O período corrente é ancorado em startAt e avançado até
// conter `now` (backfill não gera fatura retroativa) e a fatura inicial nasce
// PAGA (o fechamento É o 1º recebimento); as próximas nascem no runBilling.
// A conta fecha com o arr carimbado no convertWonLead: annualized(price, cycle)
// = amount × CLOSED_PLAN_ANNUAL_FACTOR, então o syncCustomerArr não muda nada.
const PLAN_MONTHS = { anual: 12, semestral: 6, mensal: 1 };
const PLAN_CYCLE = { anual: "annual", semestral: "semiannual", mensal: "monthly" };
// cartao_recorrente (assinatura no cartão, cobrança mensal indefinida) recebe
// por mês como o faturado, mas NUNCA tem Nº de parcelas — o gate não pergunta,
// então closedInstallments devolve 0 e o ciclo mensal fica com o runBilling.
const MONTHLY_PAYMENT = new Set(["boleto", "pix_parcelado", "cartao_recorrente"]);
const METHOD_LABEL = { boleto: "boleto faturado", pix_parcelado: "PIX parcelado", cartao_recorrente: "assinatura recorrente" };

// Nº de parcelas escolhido no gate de fechamento (0 = sem cronograma explícito).
// Só vale em pagamento faturado/parcelado: à vista/cartão 12x a adquirente
// antecipa, parcela é problema dela.
export function closedInstallments({ paymentMethod, paymentInstallments } = {}) {
  if (!MONTHLY_PAYMENT.has(String(paymentMethod || ""))) return 0;
  const n = Math.round(Number(paymentInstallments) || 0);
  return n > 0 ? Math.min(n, 36) : 0;
}

// Ciclo e preço da assinatura que um fechamento implica. Serviço único (ou
// valor zerado) não é recorrência → null. Compartilhado entre criar a
// assinatura no ganho e revisá-la quando o gate reedita plano/valor/pagamento.
// Com Nº de parcelas do gate (schedule), a assinatura fica no ciclo do PLANO
// com o valor CHEIO — annualized bate com o arr do convertWonLead igual à
// vista — e o recebimento vira o cronograma de faturas kind:"installment"
// (createInstallmentSchedule); o runBilling só renova no fim do contrato.
// Sem o Nº (fechamento antigo), segue o desenho original: ciclo mensal com o
// valor da parcela plano÷meses.
export function closedSubscriptionSpec({ planClosed, amount, paymentMethod, paymentInstallments } = {}) {
  const months = PLAN_MONTHS[planClosed];
  const value = Number(amount) || 0;
  if (!months || value <= 0) return null;
  const schedule = closedInstallments({ paymentMethod, paymentInstallments });
  if (schedule) return { cycle: PLAN_CYCLE[planClosed], price: value, schedule };
  const monthly = MONTHLY_PAYMENT.has(String(paymentMethod || ""));
  return {
    cycle: monthly ? "monthly" : PLAN_CYCLE[planClosed],
    price: monthly ? Math.round((value / months) * 100) / 100 : value,
  };
}

// Cronograma do faturado: N faturas kind:"installment" com vencimento mensal a
// partir do fechamento, TODAS em aberto — faturado é promessa, o caixa só conta
// quando alguém marca a parcela como paga (ou a baixa do MP casa o pagamento).
// Divisão em centavos: parcelas iguais e a PRIMEIRA absorve a sobra. A Análise
// de clientes já trata essas faturas como a verdade do recebido × a receber.
export async function createInstallmentSchedule(repo, { customerId, saas, subscription = "", total, installments, startAt, method = "", startN = 1, of }, now = new Date()) {
  const n = Math.max(1, Math.round(Number(installments) || 1));
  const cents = Math.round((Number(total) || 0) * 100);
  if (!customerId || cents <= 0) return [];
  const base = Math.floor(cents / n);
  const label = METHOD_LABEL[method] || "faturado";
  const totalN = Number(of) || startN - 1 + n;
  const created = [];
  for (let i = 0; i < n; i++) {
    created.push(await repo.create("invoices", {
      subscription, customer: customerId, saas: saas || "",
      amount: (i === 0 ? cents - base * (n - 1) : base) / 100,
      kind: "installment", status: "open",
      installmentN: startN + i, installmentOf: totalN,
      title: `Parcela ${startN + i}/${totalN} · ${label}`,
      dueDate: addMonths(startAt || now.toISOString(), startN - 1 + i),
      createdAt: now.toISOString(),
    }));
  }
  return created;
}

// Re-sincroniza o cronograma quando o gate reedita valor/plano/parcelas (ou o
// valor do contrato é editado em Clientes). Parcela PAGA é fato — fica como
// está; as abertas/vencidas são refeitas: o que falta receber (total − pagas)
// redividido nas parcelas restantes. installments=0 (virou à vista/cartão) só
// remove as abertas.
export async function syncClosedInstallments(repo, { customerId, saas, subscription = "", total, installments, startAt, method = "" }, now = new Date()) {
  if (!customerId) return;
  const all = (await repo.list("invoices")).filter((i) => i.customer === customerId && i.kind === "installment");
  const paid = all.filter((i) => i.status === "paid");
  const open = all.filter((i) => i.status !== "paid");
  const n = Math.max(0, Math.round(Number(installments) || 0));
  const remainingN = Math.max(0, n - paid.length);
  const paidSum = paid.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const remaining = Math.round(((Number(total) || 0) - paidSum) * 100) / 100;
  // Nada mudou de verdade? Não regrava (regravar acorda o SSE de todo mundo).
  const openSum = open.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  if (open.length === remainingN && Math.abs(openSum - remaining) < 0.005
    && (!all.length || Number(all[0].installmentOf) === n)) return;
  for (const i of open) await repo.remove("invoices", i.id);
  if (remainingN > 0 && remaining > 0) {
    await createInstallmentSchedule(repo, {
      customerId, saas, subscription, total: remaining, installments: remainingN,
      startAt, method, startN: paid.length + 1, of: n,
    }, now);
  }
}

export async function createClosedSubscription(repo, { customerId, saas, planClosed, amount, paymentMethod, paymentInstallments, startAt }, now = new Date()) {
  const spec = closedSubscriptionSpec({ planClosed, amount, paymentMethod, paymentInstallments });
  if (!customerId || !spec) return null;
  const { cycle, price } = spec;
  let periodStart = startAt || now.toISOString();
  let periodEnd = addMonths(periodStart, CYCLE_MONTHS[cycle] || 1);
  let guard = 0; // startAt antigo: pula ciclos até o período conter agora
  while (new Date(periodEnd) <= now && guard++ < 600) {
    periodStart = periodEnd;
    periodEnd = addMonths(periodStart, CYCLE_MONTHS[cycle] || 1);
  }
  const sub = await repo.create("subscriptions", {
    status: "active", cycle, price, plan: "", pendingChange: null,
    customer: customerId, saas: saas || "", periodStart, periodEnd,
  });
  if (spec.schedule) {
    // Faturado com cronograma: o recebimento são as PARCELAS (nascem abertas) —
    // a fatura inicial paga do desenho original não existe aqui, senão o valor
    // cheio contaria como recebido no dia do fechamento.
    await createInstallmentSchedule(repo, {
      customerId, saas, subscription: sub.id, total: price,
      installments: spec.schedule, startAt: startAt || periodStart, method: paymentMethod,
    }, now);
  } else {
    await repo.create("invoices", {
      subscription: sub.id, customer: customerId, saas: saas || "",
      amount: price, kind: "renewal", status: "paid",
      dueDate: periodStart, periodStart, periodEnd,
      paidAt: periodStart, createdAt: now.toISOString(),
    });
  }
  await syncCustomerArr(repo, customerId);
  return sub;
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
