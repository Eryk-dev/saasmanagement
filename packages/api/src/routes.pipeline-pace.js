// Pace mensal do pipeline ancorado em CAIXA: faturas efetivamente pagas no mês.
// TCV/MRR entram só como contexto. O gap de caixa é desdobrado de trás pra
// frente em metas diárias de ganho, call, agendamento, contato e lead.

import { TOUCH_TYPES } from "./stages.js";
import {
  DAY_MS as DAY, round2, dayKey, isRealLead,
  bookedLeadsIn, callOutcome, winsIn, customerStartMap, tcvOf, contactAttribution,
} from "./metrics-core.js";

// Meta de caixa quando o produto ainda não tem a dele (product.monthlyCashTarget,
// editável na tela Metas → Empresa). Exportada pra tela de Metas mostrar o padrão.
export const DEFAULT_CASH_TARGET = 120_000;

// Super metas: 125%, 150% e 200% da meta base. Batida a meta base, o pace não
// pode dizer "precisa R$0/dia": ele re-ancora na PRÓXIMA super meta, e o
// desdobramento (ganhos → calls → contatos) passa a perseguir esse teto novo.
// A régua bate com a barra da Visão geral (SUPER_METAS no overview.jsx).
export const SUPER_METAS = [1.25, 1.5, 2];

// Alvo que o PACE persegue agora: a base enquanto ela não cai, senão o primeiro
// teto de super meta ainda não batido. null = passou de 200% (não há teto
// acima; nada mais a perseguir). `sold` é o vendido no mês.
export function chaseCeiling(target, sold) {
  for (const v of [target, ...SUPER_METAS.map((m) => target * m)]) {
    if (sold < v) return v;
  }
  return null;
}

// Meta de venda DAQUELE mês. `product.monthlyCashTargets` é um mapa
// "AAAA-MM" → valor: o Leo configura os meses seguintes com antecedência e,
// quando o mês vira, a plataforma inteira (faixa da Visão geral, pace, metas
// derivadas das vagas) passa a perseguir o número novo sem ninguém mexer em
// nada. Mês sem valor próprio segue a REGRA DE CRESCIMENTO (abaixo); sem
// regra, vale o padrão do produto; sem padrão, o do sistema.
//
// Regra de crescimento (product.monthlyCashGrowthPct, %): a agenda finita
// obrigava o Leo a re-agendar todo mês e, acabada a lista, a meta despencava
// pro padrão. Com a regra, mês sem valor cresce X% COMPOSTO por cima do último
// mês agendado antes dele (escada 180k → 270k → 405k com 50% segue 607,5k,
// 911k, … sozinha). Mês digitado continua vencendo; sem nenhum mês agendado
// não há âncora e a regra não se aplica.
const monthIndex = (m) => {
  const [y, mm] = String(m).split("-").map(Number);
  return y * 12 + (mm - 1);
};
export function cashTargetFor(product, month) {
  const byMonth = product?.monthlyCashTargets;
  const doMes = byMonth && typeof byMonth === "object" ? Number(byMonth[month]) : NaN;
  if (Number.isFinite(doMes) && doMes > 0) return { target: doMes, configured: true, source: "month" };
  const growth = Number(product?.monthlyCashGrowthPct);
  if (Number.isFinite(growth) && growth > 0 && byMonth && typeof byMonth === "object") {
    const ancoras = Object.entries(byMonth)
      .filter(([m, v]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m < month && Number(v) > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    const ultima = ancoras[ancoras.length - 1];
    if (ultima) {
      const k = monthIndex(month) - monthIndex(ultima[0]);
      const target = Math.round(Number(ultima[1]) * Math.pow(1 + growth / 100, k));
      return { target, configured: true, source: "growth", growthFrom: ultima[0], growthPct: growth };
    }
  }
  const padrao = Number(product?.monthlyCashTarget);
  if (Number.isFinite(padrao) && padrao > 0) return { target: padrao, configured: true, source: "default" };
  return { target: DEFAULT_CASH_TARGET, configured: false, source: "system" };
}

// Benchmark de cada taxa do funil (SaaS inbound morno), usado quando não há
// histórico nem meta. Mora AQUI porque é a cadeia do pace que aplica, e o
// catálogo da tela Metas importa daqui — um número só por taxa, senão a tela
// mostra um valor e o pace calcula com outro (foi o que aconteceu com o
// fechamento: catálogo em 25% das AGENDADAS e pace em 25% das que
// COMPARECERAM, dois significados no mesmo campo).
// `closeRate` é sempre sobre as calls que ACONTECERAM — o furo já é cobrado no
// showRate, e contar duas vezes esconderia de quem é o problema.
export const RATE_BENCHMARKS = { contactRate: 0.8, bookingRate: 0.3, showRate: 0.75, closeRate: 0.33 };

// Amostra mínima de leads pra confiar numa coorte medida: decide se o mês
// fechado anterior vira a janela das taxas e se a calibração da ponta a ponta
// liga. Abaixo disso, um ganho a mais ou a menos vira ruído gigante.
export const MIN_RATE_SAMPLE = 20;
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
  const [allInvoices, allLeads, allActivities, allCustomers, allProposals, allGoals, allInsights, waMessages, users] = await Promise.all([
    repo.list("invoices"),
    repo.list("leads"),
    repo.list("activities"),
    repo.list("customers"),
    repo.list("proposals"),
    repo.list("goals"),
    repo.list("ad_insights"),
    repo.list("wa_messages").catch(() => []),
    repo.list("users").catch(() => []),
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
  const alvo = cashTargetFor(product, month);
  const targetConfigured = alvo.configured;
  const target = alvo.target;
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
  //
  // CONTA GRANDE (customer.keyAccount, ex.: Galante) fica FORA do ticket médio:
  // um fechamento de R$ 120 mil no meio de vendas de R$ 3-7 mil quebra a cadeia
  // inteira (meta de contratos, calls, leads). O dinheiro dela segue contando em
  // caixa e vendido; só as MÉDIAS e as metas derivadas ignoram.
  const keyCustomerIds = new Set(customers.filter((c) => !!c.keyAccount).map((c) => c.id));
  const isKeyInvoice = (i) => keyCustomerIds.has(i.customer);
  const isKeyLead = (l) => (l.customerId && keyCustomerIds.has(l.customerId));
  const firstPaid = new Map();
  for (const inv of [...paid].sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))) {
    const key = inv.subscription ? `sub:${inv.subscription}` : inv.customer ? `customer:${inv.customer}` : "";
    if (key && !firstPaid.has(key)) firstPaid.set(key, inv);
  }
  const initialRecent = [...firstPaid.values()].filter((i) => inRange(i.paidAt, since90) && !isKeyInvoice(i));
  const paidRecent = paid.filter((i) => inRange(i.paidAt, since90) && !isKeyInvoice(i));
  const wonRecent90 = winLeadsIn((iso) => inRange(iso, since90)).filter((l) => !isKeyLead(l));
  const configuredTicket = goals.find((g) => g.scope === "role" && g.key === "closer" && g.metric === "ticket");
  let averageEntry = averageAmount(initialRecent);
  let averageEntrySource = averageEntry != null ? "initial_payments" : "";
  if (averageEntry == null) { averageEntry = averageAmount(paidRecent); averageEntrySource = averageEntry != null ? "paid_invoices" : ""; }
  if (averageEntry == null) { averageEntry = averageAmount(wonRecent90); averageEntrySource = averageEntry != null ? "won_tcv" : ""; }
  if (averageEntry == null && Number(configuredTicket?.target) > 0) {
    averageEntry = Number(configuredTicket.target);
    averageEntrySource = "configured_ticket";
  }

  // ── Coorte das taxas: MÊS FECHADO anterior, desfechos até hoje ─────────────
  // (decisão do Leo, 08/08/2026). A janela móvel de 30 dias tinha viés de
  // imaturidade duplo: o lead de anteontem ainda não teve tempo de virar call e
  // ganho (entra no denominador sem entrar no numerador, ponta a ponta sai
  // pessimista e infla a meta de leads) e a janela anda todo dia, então a
  // cadeia derivada mudava sozinha. O mês fechado é coorte madura (o lead mais
  // novo já viveu a virada inteira) e estável o mês todo. Sem amostra decente
  // no mês fechado (menos de MIN_RATE_SAMPLE leads ou nenhum ganho), cai na
  // janela móvel de 30 dias como era — produto novo não trava no benchmark.
  //
  // Contato = ação HUMANA (contactAttribution, a MESMA régua do placar): toque
  // na timeline ou mensagem enviada no inbox por gente do time — automação
  // (fluxo de ligação, drip) não conta como contato. Sem janela no toque de
  // propósito: a coorte é dos leads da janela, o contato vale quando aconteceu.
  const humanIds = new Set(users.map((u) => u.id));
  const humanContact = contactAttribution({ leads, actsOf, waMessages, saas: product.id, inWin: () => true, humanIds });
  // Uma safra de calls só (as agendadas pela coorte) e a resolução dela — o
  // funil inteiro corre sobre a MESMA base: contato → agendamento →
  // comparecimento → call→ganho encadeiam. O agendamento conta do início da
  // coorte até HOJE (não até o fim dela): lead do mês fechado que marcou call
  // no mês seguinte é sucesso da coorte dele; cortar no dia 31 só mudaria o
  // viés de imaturidade de lugar em vez de resolver.
  const funnelCohort = (sinceDay, untilDay) => {
    const cohort = leads.filter((l) => inRange(l.createdAt, sinceDay, untilDay));
    const ids = new Set(cohort.map((l) => l.id));
    const contacted = cohort.filter((l) => humanContact.leadIds.has(l.id));
    const booked = bookedLeadsIn(product, leads, actsOf, (iso) => inRange(iso, sinceDay)).filter((l) => ids.has(l.id));
    const out = callOutcome(product, booked, actsOf); // { shown, noShow, won }
    return { cohort, contacted, booked, out };
  };
  const prevMonth = (() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [pmY, pmM] = prevMonth.split("-").map(Number);
  const prevMonthEnd = `${prevMonth}-${String(new Date(pmY, pmM, 0).getDate()).padStart(2, "0")}`;
  const mesFechado = funnelCohort(`${prevMonth}-01`, prevMonthEnd);
  const useMonth = mesFechado.cohort.length >= MIN_RATE_SAMPLE && mesFechado.out.won > 0;
  const cohortBase = useMonth ? mesFechado : funnelCohort(since30, today);
  // A janela vai no payload pros tooltips dizerem período e amostra ("12 de 44
  // em jul/2026") — sem isso a taxa parece chute (pergunta real do Leo).
  const rateWindow = useMonth
    ? { mode: "month", month: prevMonth, since: `${prevMonth}-01`, until: prevMonthEnd }
    : { mode: "rolling30", since: since30, until: today };

  // Ajuste de histórico PRÉ-COCKPIT (product.paceAdjust): dados REAIS de antes do
  // registro no cockpit (call no telefone, contato por outro canal) somados às
  // contagens do funil. Somas positivas em { leads, contacted, booked, shown };
  // zero/ausente = funil só do que o sistema gravou. Só entra na janela MÓVEL:
  // o mês fechado anterior é sempre pós-cockpit, somar história de junho na
  // coorte de julho sujaria a taxa. GANHO nunca usa ajuste (decisão do Leo,
  // 24/07): as vendas pré-cockpit foram registradas com wonAt real (#293),
  // então um "+won" contaria em dobro. O funil ENCADEIA — cada denominador é o
  // passo anterior — então o histórico entra limpo.
  const adj = product.paceAdjust && typeof product.paceAdjust === "object" ? product.paceAdjust : {};
  const adjN = (k) => { if (useMonth) return 0; const n = Math.floor(Number(adj[k])); return Number.isFinite(n) && n > 0 ? n : 0; };
  const paceAdjust = ["leads", "contacted", "booked", "shown"].reduce((o, k) => (adjN(k) ? { ...o, [k]: adjN(k) } : o), null);
  const nLeads = cohortBase.cohort.length + adjN("leads");
  const nContacted = cohortBase.contacted.length + adjN("contacted");
  const nBooked = cohortBase.booked.length + adjN("booked");
  const nShown = cohortBase.out.shown + adjN("shown");
  const nWon = cohortBase.out.won;
  const conversions = {
    contactRate: resolvedRate(nContacted, nLeads, goalRate(goals, "sdr", "contactRate"), RATE_BENCHMARKS.contactRate),
    bookingRate: resolvedRate(nBooked, nContacted, goalRate(goals, "sdr", "bookingRate"), RATE_BENCHMARKS.bookingRate),
    // Comparecimento sobre as AGENDADAS (funil encadeado): dos que marcaram call,
    // quantos apareceram.
    showRate: resolvedRate(nShown, nBooked, goalRate(goals, "sdr", "showRate"), RATE_BENCHMARKS.showRate),
    // Call → ganho: dos que compareceram, quantos fecharam. A meta é a
    // `conversaoCall` do closer — a MESMA que o placar mede (won ÷ compareceram).
    closeRate: resolvedRate(nWon, nShown, goalRate(goals, "closer", "conversaoCall"), RATE_BENCHMARKS.closeRate),
  };

  // CPL real dos últimos 30 dias (mesma régua do /api/marketing): spend do
  // ad_insights ÷ leads criados no período (sem internos). Alimenta o cálculo
  // de investimento necessário pra bater a meta na Análise.
  const spend30 = round2(allInsights
    .filter((r) => r.saas === product.id && r.date >= since30 && r.date <= today)
    .reduce((a, r) => a + (Number(r.spend) || 0), 0));
  // CPL segue os 30d MÓVEIS de propósito: dinheiro de mídia é presente, não
  // coorte — o custo por lead de julho não diz o que o clique custa hoje.
  const leads30 = leads.filter((l) => inRange(l.createdAt, since30)).length; // já sem internos
  const cpl = spend30 > 0 && leads30 > 0 ? round2(spend30 / leads30) : null;

  // Ponta a ponta REAL (ganhos da coorte ÷ leads da coorte): é a régua que bate
  // com o caixa ("vendi X com Y de mídia"). Mesmo na coorte madura as taxas de
  // etapa carregam algum truncamento (call marcada que ainda não aconteceu) e o
  // viés se multiplica na cadeia: o produto das 4 dava ~metade da ponta a ponta
  // real e o plano pedia 2-3x mais lead/investimento do que a história mostra.
  // Com amostra decente, o fechamento é CALIBRADO pra cadeia fechar exatamente
  // na ponta a ponta (a folga vai toda pro fechamento, a taxa mais truncada).
  const chainProb = round4(clampRate(conversions.contactRate.value * conversions.bookingRate.value
    * conversions.showRate.value * conversions.closeRate.value));
  // Lead → ganho = ganhos da coorte ÷ leads dela (na janela móvel, ambos com o
  // histórico pré-cockpit).
  conversions.leadToWin = resolvedRate(nWon, nLeads, null, chainProb);
  const upstream = conversions.contactRate.value * conversions.bookingRate.value * conversions.showRate.value;
  const calibrated = conversions.leadToWin.source === "history"
    && conversions.leadToWin.numerator > 0 && conversions.leadToWin.denominator >= MIN_RATE_SAMPLE && upstream > 0;
  conversions.closeRateEffective = calibrated
    ? { value: round4(clampRate(conversions.leadToWin.value / upstream)), source: "calibrated" }
    : { value: conversions.closeRate.value, source: conversions.closeRate.source };

  // ── Meta ancorada no VENDIDO (contrato cheio) ──────────────────────────────
  // Decisão do Leo (20/07): a meta do mês mede o que foi VENDIDO no mês (TCV
  // pela régua oficial isWonLead + wonAt) — cartão em 12x entra cheio. O caixa
  // (faturas pagas) segue no bloco `cash` como leitura; o fluxo e o dinheiro
  // futuro moram na aba Clientes. O desdobramento (plan) persegue o gap do
  // VENDIDO, não o do caixa.
  const todayWinLeads = winLeadsIn((iso) => dayKey(iso) === today);
  const todayWon = todayWinLeads.length;
  const tcvMonthLeads = winLeadsIn(inMonth);
  const tcvMonth = tcvOf(tcvMonthLeads);
  const sold = tcvMonth;
  const soldToday = tcvOf(todayWinLeads);
  const saleGap = round2(Math.max(0, target - sold));
  const saleDelta = round2(sold - expectedToDate);
  const salePace = calendar.elapsed > 0 ? round2(sold / calendar.elapsed) : 0;

  // Alvo que o PACE persegue: a base, ou (batida a base) a próxima super meta.
  // `chaseGap` alimenta o desdobramento e o "precisa/dia" no lugar de `saleGap`,
  // então bater 120k passa a apontar pra 150k, depois 180k, depois 240k, em vez
  // de zerar o pace. `saleGap` continua sendo a folga da BASE (é o que marca
  // "meta batida" na faixa) — os dois convivem.
  const chaseTarget = chaseCeiling(target, sold);
  const chaseGap = chaseTarget == null ? 0 : round2(Math.max(0, chaseTarget - sold));
  const superMetas = SUPER_METAS.map((m) => ({
    pct: Math.round(m * 100), mult: m, value: round2(target * m), hit: sold >= target * m,
  }));

  // ── Meta de CONTRATOS do mês (a 2ª régua da Meta do mês na Visão geral) ────
  // A meta digitada da empresa (monthlyContractsTarget, tela Metas) vence; sem
  // ela, deriva de venda ÷ ticket — o MESMO averageEntry sem contas grandes da
  // cadeia, então as duas telas nunca divergem. Vendido = nº de fechamentos do
  // mês (contagem; conta grande conta 1 contrato, só sai das médias).
  const contractsTarget = Number(product.monthlyContractsTarget) > 0
    ? Math.round(Number(product.monthlyContractsTarget))
    : (averageEntry > 0 ? Math.ceil(target / averageEntry) : null);

  const throughRate = (amount, rate) => amount === 0 ? 0 : amount != null && rate > 0 ? Math.ceil(amount / rate) : null;
  const winsRemaining = chaseGap === 0 ? 0 : averageEntry > 0 ? Math.ceil(chaseGap / averageEntry) : null;
  const callsRemaining = throughRate(winsRemaining, conversions.closeRateEffective.value);
  const bookingsRemaining = throughRate(callsRemaining, conversions.showRate.value);
  const contactsRemaining = throughRate(bookingsRemaining, conversions.bookingRate.value);
  const leadsRemaining = throughRate(contactsRemaining, conversions.contactRate.value);
  const blockedBy = chaseGap === 0 ? null
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
  const mrr = round2(customers.reduce((a, c) => a + (Number(c.arr) || 0), 0) / 12);

  return {
    saas: product.id,
    month,
    today,
    // A META: vendido no mês (contrato cheio) vs. meta de venda. É o bloco que
    // a faixa da Visão geral e o resumo da Análise mostram.
    sale: {
      target,
      targetConfigured, // false = rodando no padrão; a UI aponta pra Metas → Empresa
      sold,
      soldToday,
      gap: saleGap,
      // Super metas + o teto que o pace persegue agora (base → 125% → 150% →
      // 200%). chaseTarget null = passou de 200%, não há mais o que perseguir.
      superMetas,
      chaseTarget,
      chaseGap,
      chasePct: chaseTarget ? Math.round((chaseTarget / target) * 100) : null,
      expectedToDate,
      deltaToPace: saleDelta,
      actualDailyPace: salePace,
      // Ritmo/dia útil pra alcançar o teto vigente (super meta quando a base já
      // caiu), não a base zerada.
      requiredDailyPace: calendar.remaining > 0 ? round2(chaseGap / calendar.remaining) : null,
      projected: round2(salePace * calendar.total),
      progress: round4(target > 0 ? sold / target : 0),
      expectedProgress,
      status: saleDelta >= 0 ? "ahead" : sold >= expectedToDate * 0.95 ? "attention" : "behind",
      totalBusinessDays: calendar.total,
      elapsedBusinessDays: calendar.elapsed,
      remainingBusinessDays: calendar.remaining,
    },
    // A 2ª régua da Meta do mês: CONTRATOS fechados vs. meta (contagem).
    contracts: (() => {
      const soldN = tcvMonthLeads.length;
      const expected = contractsTarget != null ? round2(contractsTarget * (calendar.elapsed / Math.max(1, calendar.total))) : null;
      return {
        target: contractsTarget,
        targetSource: Number(product.monthlyContractsTarget) > 0 ? "company" : (contractsTarget != null ? "ticket" : ""),
        sold: soldN,
        soldToday: todayWon,
        gap: contractsTarget != null ? Math.max(0, contractsTarget - soldN) : null,
        progress: contractsTarget > 0 ? round4(soldN / contractsTarget) : null,
        expectedToDate: expected,
        expectedProgress,
        status: expected == null ? null : soldN >= expected ? "ahead" : soldN >= expected * 0.95 ? "attention" : "behind",
      };
    })(),
    // Leitura de CAIXA (faturas pagas) — informativa; o fluxo detalhado e o
    // dinheiro futuro moram na aba Clientes.
    cash: {
      target,
      targetConfigured,
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
    paceAdjust, // histórico pré-cockpit somado ao funil (null quando não há)
    conversions,
    rateWindow, // janela das taxas: mês fechado anterior ou 30d móveis (fallback)
    plan: {
      blockedBy,
      sold: planMetric(chaseGap, calendar.remaining, soldToday),
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
