// Pace mensal do pipeline ancorado em CAIXA: faturas efetivamente pagas no mês.
// TCV/MRR entram só como contexto. O gap de caixa é desdobrado de trás pra
// frente em metas diárias de ganho, call, agendamento, contato e lead.

import { TOUCH_TYPES } from "./stages.js";
import {
  DAY_MS as DAY, round2, dayKey, isRealLead,
  bookedLeadsIn, callOutcome, winsIn, customerStartMap, tcvOf,
} from "./metrics-core.js";

// Meta de caixa quando o produto ainda não tem a dele (product.monthlyCashTarget,
// editável na tela Metas → Empresa). Exportada pra tela de Metas mostrar o padrão.
export const DEFAULT_CASH_TARGET = 120_000;
const round4 = (n) => Math.round(n * 10_000) / 10_000;
const clampRate = (n) => Math.max(0, Math.min(1, n));

function monthCalendar(today) {
  const [year, month, currentDay] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const businessDays = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) businessDays.push(day);
  }
  return {
    total: businessDays.length,
    elapsed: businessDays.filter((d) => d <= currentDay).length,
    remaining: businessDays.filter((d) => d >= currentDay).length,
    lastDay: String(daysInMonth).padStart(2, "0"),
  };
}

function goalRate(goals, role, metric) {
  const goal = goals.find((g) => g.scope === "role" && g.key === role && g.metric === metric);
  const value = Number(goal?.target);
  return Number.isFinite(value) && value > 0 ? clampRate(value / 100) : null;
}

function resolvedRate(numerator, denominator, configured, benchmark) {
  if (denominator > 0) {
    return {
      value: round4(clampRate(numerator / denominator)),
      source: "history",
      numerator,
      denominator,
    };
  }
  if (configured != null) return { value: configured, source: "goal", numerator: 0, denominator: 0 };
  return { value: benchmark, source: "benchmark", numerator: 0, denominator: 0 };
}

function averageAmount(rows) {
  const amounts = rows.map((r) => Number(r.amount)).filter((n) => Number.isFinite(n) && n > 0);
  return amounts.length ? round2(amounts.reduce((a, n) => a + n, 0) / amounts.length) : null;
}

function planMetric(remaining, days, today) {
  if (remaining == null) return { remaining: null, perDay: null, today };
  return {
    remaining,
    perDay: days > 0 ? round2(remaining / days) : null,
    today,
  };
}

export async function computePipelinePace(repo, product, now = new Date()) {
  const [allInvoices, allLeads, allActivities, allCustomers, allProposals, allGoals, allInsights] = await Promise.all([
    repo.list("invoices"),
    repo.list("leads"),
    repo.list("activities"),
    repo.list("customers"),
    repo.list("proposals"),
    repo.list("goals"),
    repo.list("ad_insights"),
  ]);
  const today = dayKey(now);
  const month = today.slice(0, 7);
  const calendar = monthCalendar(today);
  const monthEnd = `${month}-${calendar.lastDay}`;
  const since30 = dayKey(new Date(now.getTime() - 29 * DAY));
  const since90 = dayKey(new Date(now.getTime() - 89 * DAY));
  const inRange = (iso, since, until = today) => {
    const day = dayKey(iso);
    return day && day >= since && day <= until;
  };
  const inMonth = (iso) => dayKey(iso).startsWith(month);

  const invoices = allInvoices.filter((i) => i.saas === product.id);
  // Lead interno (teste) fora de toda conta — régua oficial do metrics-core.
  const leads = allLeads.filter((l) => l.saas === product.id && isRealLead(l));
  const activities = allActivities.filter((a) => a.saas === product.id && a.lead);
  const customers = allCustomers.filter((c) => c.saas === product.id);
  const proposals = allProposals.filter((p) => p.saas === product.id);
  const goals = allGoals.filter((g) => !g.saas || g.saas === product.id);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const actsByLead = new Map();
  for (const activity of activities) {
    if (!actsByLead.has(activity.lead)) actsByLead.set(activity.lead, []);
    actsByLead.get(activity.lead).push(activity);
  }
  for (const list of actsByLead.values()) list.sort((x, y) => String(x.at || "").localeCompare(String(y.at || "")));
  const actsOf = (id) => actsByLead.get(id) || [];
  const customerStartByLead = customerStartMap(customers);
  // Vendas numa janela pela régua oficial (isWonLead + wonAt, metrics-core).
  const winLeadsIn = (test) => [...winsIn(product, leads, test, customerStartByLead).keys()]
    .map((id) => leadById.get(id)).filter(Boolean);

  const paid = invoices.filter((i) => i.status === "paid" && i.paidAt);
  const paidMonth = paid.filter((i) => inMonth(i.paidAt));
  const collected = round2(paidMonth.reduce((a, i) => a + (Number(i.amount) || 0), 0));
  const collectedToday = round2(paidMonth
    .filter((i) => dayKey(i.paidAt) === today)
    .reduce((a, i) => a + (Number(i.amount) || 0), 0));
  const targetConfigured = Number(product.monthlyCashTarget) > 0;
  const target = targetConfigured ? Number(product.monthlyCashTarget) : DEFAULT_CASH_TARGET;
  const gap = round2(Math.max(0, target - collected));
  const expectedToDate = round2(target * (calendar.elapsed / Math.max(1, calendar.total)));
  const actualDailyPace = calendar.elapsed > 0 ? round2(collected / calendar.elapsed) : 0;
  const requiredDailyPace = calendar.remaining > 0 ? round2(gap / calendar.remaining) : null;
  const projected = round2(actualDailyPace * calendar.total);
  const deltaToPace = round2(collected - expectedToDate);
  const progress = round4(target > 0 ? collected / target : 0);
  const expectedProgress = round4(target > 0 ? expectedToDate / target : 0);
  const status = deltaToPace >= 0 ? "ahead" : collected >= expectedToDate * 0.95 ? "attention" : "behind";

  const receivables = invoices.filter((i) => {
    if (i.status !== "open" && i.status !== "overdue") return false;
    const due = dayKey(i.dueDate);
    return due && due <= monthEnd;
  });
  const receivableAmount = round2(receivables.reduce((a, i) => a + (Number(i.amount) || 0), 0));

  // Entrada média por nova venda: 1ª fatura paga de cada assinatura/cliente.
  // Sem esse vínculo, degrada pra qualquer fatura paga recente; depois TCV ganho
  // e, por último, ticket configurado — a fonte volta explícita pra interface.
  const firstPaid = new Map();
  for (const inv of [...paid].sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))) {
    const key = inv.subscription ? `sub:${inv.subscription}` : inv.customer ? `customer:${inv.customer}` : "";
    if (key && !firstPaid.has(key)) firstPaid.set(key, inv);
  }
  const initialRecent = [...firstPaid.values()].filter((i) => inRange(i.paidAt, since90));
  const paidRecent = paid.filter((i) => inRange(i.paidAt, since90));
  const wonRecent90 = winLeadsIn((iso) => inRange(iso, since90));
  const configuredTicket = goals.find((g) => g.scope === "role" && g.key === "closer" && g.metric === "ticket");
  let averageEntry = averageAmount(initialRecent);
  let averageEntrySource = averageEntry != null ? "initial_payments" : "";
  if (averageEntry == null) { averageEntry = averageAmount(paidRecent); averageEntrySource = averageEntry != null ? "paid_invoices" : ""; }
  if (averageEntry == null) { averageEntry = averageAmount(wonRecent90); averageEntrySource = averageEntry != null ? "won_tcv" : ""; }
  if (averageEntry == null && Number(configuredTicket?.target) > 0) {
    averageEntry = Number(configuredTicket.target);
    averageEntrySource = "configured_ticket";
  }

  // Conversões operacionais dos últimos 30 dias, espelhando o placar atual.
  const recentLeads = leads.filter((l) => inRange(l.createdAt, since30));
  const recentLeadIds = new Set(recentLeads.map((l) => l.id));
  const contacted = recentLeads.filter((l) => (actsByLead.get(l.id) || []).some((a) => TOUCH_TYPES.has(a.type)));
  const booked = bookedLeadsIn(product, leads, actsOf, (iso) => inRange(iso, since30));
  const bookedFromRecentLeads = booked.filter((l) => recentLeadIds.has(l.id));
  const { shown, noShow } = callOutcome(product, booked, actsOf);
  const callsRecent = leads.filter((l) => inRange(l.callAt, since30));
  const wonRecent = winLeadsIn((iso) => inRange(iso, since30));
  const conversions = {
    contactRate: resolvedRate(contacted.length, recentLeads.length, goalRate(goals, "sdr", "contactRate"), 0.8),
    bookingRate: resolvedRate(bookedFromRecentLeads.length, contacted.length, goalRate(goals, "sdr", "bookingRate"), 0.3),
    showRate: resolvedRate(shown, shown + noShow, goalRate(goals, "sdr", "showRate"), 0.75),
    closeRate: resolvedRate(wonRecent.length, callsRecent.length, goalRate(goals, "closer", "winRateCall"), 0.25),
  };

  // CPL real dos últimos 30 dias (mesma régua do /api/marketing): spend do
  // ad_insights ÷ leads criados no período (sem internos). Alimenta o cálculo
  // de investimento necessário pra bater a meta na Análise.
  const spend30 = round2(allInsights
    .filter((r) => r.saas === product.id && r.date >= since30 && r.date <= today)
    .reduce((a, r) => a + (Number(r.spend) || 0), 0));
  const leads30 = recentLeads.length; // já sem internos (filtro oficial lá em cima)
  const cpl = spend30 > 0 && leads30 > 0 ? round2(spend30 / leads30) : null;

  // Ponta a ponta REAL (ganhos 30d ÷ leads criados 30d): é a régua que bate com
  // o caixa ("vendi X com Y de mídia"). As taxas de etapa acima são medidas em
  // janela curta, então cada coorte está TRUNCADA (lead recente ainda não teve
  // tempo de avançar; call recente ainda não teve tempo de fechar) e o viés se
  // multiplica na cadeia: o produto das 4 dava ~metade da ponta a ponta real e
  // o plano pedia 2-3x mais lead/investimento do que a história mostra. Com
  // amostra decente, o fechamento é CALIBRADO pra cadeia fechar exatamente na
  // ponta a ponta (a folga vai toda pro fechamento, a taxa mais poluída, já que
  // o denominador de callsRecent também conta callAt de follow-up).
  const chainProb = round4(clampRate(conversions.contactRate.value * conversions.bookingRate.value
    * conversions.showRate.value * conversions.closeRate.value));
  conversions.leadToWin = resolvedRate(wonRecent.length, leads30, null, chainProb);
  const upstream = conversions.contactRate.value * conversions.bookingRate.value * conversions.showRate.value;
  const calibrated = conversions.leadToWin.source === "history"
    && conversions.leadToWin.numerator > 0 && conversions.leadToWin.denominator >= 20 && upstream > 0;
  conversions.closeRateEffective = calibrated
    ? { value: round4(clampRate(conversions.leadToWin.value / upstream)), source: "calibrated" }
    : { value: conversions.closeRate.value, source: conversions.closeRate.source };

  const throughRate = (amount, rate) => amount === 0 ? 0 : amount != null && rate > 0 ? Math.ceil(amount / rate) : null;
  const winsRemaining = gap === 0 ? 0 : averageEntry > 0 ? Math.ceil(gap / averageEntry) : null;
  const callsRemaining = throughRate(winsRemaining, conversions.closeRateEffective.value);
  const bookingsRemaining = throughRate(callsRemaining, conversions.showRate.value);
  const contactsRemaining = throughRate(bookingsRemaining, conversions.bookingRate.value);
  const leadsRemaining = throughRate(contactsRemaining, conversions.contactRate.value);
  const blockedBy = gap === 0 ? null
    : averageEntry == null ? "averageEntry"
    : conversions.closeRate.value <= 0 ? "closeRate"
    : conversions.showRate.value <= 0 ? "showRate"
    : conversions.bookingRate.value <= 0 ? "bookingRate"
    : conversions.contactRate.value <= 0 ? "contactRate"
    : null;

  const todayBooked = bookedLeadsIn(product, leads, actsOf, (iso) => dayKey(iso) === today).length;
  const todayContacts = new Set(activities
    .filter((a) => dayKey(a.at) === today && TOUCH_TYPES.has(a.type))
    .map((a) => a.lead)).size;
  const todayWon = winLeadsIn((iso) => dayKey(iso) === today).length;

  const tcvMonthLeads = winLeadsIn(inMonth);
  const tcvMonth = tcvOf(tcvMonthLeads);
  const mrr = round2(customers.reduce((a, c) => a + (Number(c.arr) || 0), 0) / 12);

  return {
    saas: product.id,
    month,
    today,
    cash: {
      target,
      targetConfigured, // false = rodando no padrão; a UI aponta pra Metas → Empresa
      collected,
      collectedToday,
      gap,
      expectedToDate,
      deltaToPace,
      actualDailyPace,
      requiredDailyPace,
      projected,
      progress,
      expectedProgress,
      status,
      totalBusinessDays: calendar.total,
      elapsedBusinessDays: calendar.elapsed,
      remainingBusinessDays: calendar.remaining,
      receivables: receivableAmount,
      receivableCount: receivables.length,
      forecastWithReceivables: round2(collected + receivableAmount),
    },
    context: {
      tcvMonth,
      wonMonth: tcvMonthLeads.length,
      mrr,
      averageEntry,
      averageEntrySource,
    },
    marketing: { spend30, leads30, cpl },
    conversions,
    plan: {
      blockedBy,
      cash: planMetric(gap, calendar.remaining, collectedToday),
      leads: planMetric(leadsRemaining, calendar.remaining, leads.filter((l) => dayKey(l.createdAt) === today).length),
      contacts: planMetric(contactsRemaining, calendar.remaining, todayContacts),
      callsBooked: planMetric(bookingsRemaining, calendar.remaining, todayBooked),
      calls: planMetric(callsRemaining, calendar.remaining, leads.filter((l) => dayKey(l.callAt) === today).length),
      proposals: { today: proposals.filter((p) => dayKey(p.createdAt) === today).length },
      wins: planMetric(winsRemaining, calendar.remaining, todayWon),
      onboardings: planMetric(winsRemaining, calendar.remaining, customers.filter((c) => dayKey(c.startedAt) === today).length),
    },
  };
}

export function registerPipelinePaceRoutes(app, repo, { now = () => new Date() } = {}) {
  app.get("/api/pipeline-pace/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    return computePipelinePace(repo, product, now());
  });
}
