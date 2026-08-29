// Pace mensal do pipeline ancorado em CAIXA: faturas efetivamente pagas no mês.
// TCV/MRR entram só como contexto. O gap de caixa é desdobrado de trás pra
// frente em metas diárias de ganho, call, agendamento, contato e lead.

import { TOUCH_TYPES } from "./stages.js";
import {
  DAY_MS as DAY, round2, dayKey, isRealLead, isSaleLead, keyAccountIds, isKeyAccountLead,
  bookedLeadsIn, callOutcome, callCohortIn, winsIn, customerStartMap, tcvOf, contactAttribution,
  saleValuer, revenueOf, isRealReceipt, paymentMethodOf,
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

// ── Maturação da coorte: destrunca a ponta a ponta da janela móvel ──────────
// Um lead criado há 2 dias ainda não teve chance de fechar, mas entra inteiro no
// denominador de "ganhos ÷ leads". Numa janela de 30 dias móveis isso esconde
// boa parte dos ganhos que a safra ainda vai gerar (LeverAds em 25/08/2026:
// mediana de 3,1 dias entre lead e ganho, p90 de 20,5, 96% em até 30 dias, o
// que dá ~79% de captura) e o plano acaba pedindo lead e mídia a mais.
// A correção usa a história do PRÓPRIO produto: F(a) = fração dos ganhos que já
// teriam acontecido em `a` dias de vida. A EXPOSIÇÃO da coorte é a soma de F(a)
// de cada lead, no lugar da contagem crua. Produto de ciclo longo ganha uma
// correção maior; de ciclo curto, quase nenhuma. Sozinha ela não vale nada: é a
// dupla com a calibração que faz a cadeia pedir o número certo de lead.
export function maturityCurve(delaysDays) {
  const sorted = delaysDays.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  return (ageDays) => {
    if (!sorted.length) return 1;
    if (!(ageDays > 0)) return 0;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= ageDays) lo = mid + 1; else hi = mid; }
    return lo / sorted.length;
  };
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
  const [allInvoices, allLeads, allActivities, allCustomers, allProposals, allGoals, allInsights, waMessages, users, mpPayments] = await Promise.all([
    repo.list("invoices"),
    repo.list("leads"),
    repo.list("activities"),
    repo.list("customers"),
    repo.list("proposals"),
    repo.list("goals"),
    repo.list("ad_insights"),
    repo.list("wa_messages").catch(() => []),
    repo.list("users").catch(() => []),
    repo.list("mp_payments").catch(() => []), // espelho do MP (metade da régua do recebido)
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
  // Duas bases, de propósito (Leo, 16/08): `winLeadsIn` é a da PLATAFORMA e
  // sustenta as TAXAS da cadeia (conversão, ticket) — a mentoria não nasce de
  // call agendada, então entrar aqui desdobraria a meta pedindo menos call do
  // que a empresa precisa. `winSaleLeadsIn` é a do DINHEIRO (vendido no mês,
  // contratos): aí a mentoria entra normal.
  const winLeadsIn = (test) => [...winsIn(product, leads, test, customerStartByLead).keys()]
    .map((id) => leadById.get(id)).filter(Boolean);
  const saleLeads = allLeads.filter((l) => l.saas === product.id && isSaleLead(l));
  const saleById = new Map(saleLeads.map((l) => [l.id, l]));
  const winSaleLeadsIn = (test) => [...winsIn(product, saleLeads, test, customerStartByLead).keys()]
    .map((id) => saleById.get(id)).filter(Boolean);

  // Caixa: só fatura que representa dinheiro que ENTROU. A que nasce paga no
  // fechamento de faturado/recorrente é carimbo de contrato, não recebimento
  // (isRealReceipt do metrics-core) — mesma régua do Financeiro.
  const methodOf = paymentMethodOf(customers);
  const paid = invoices.filter((i) => isRealReceipt(i, methodOf));
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
  const keyCustomerIds = keyAccountIds(customers);
  const isKeyInvoice = (i) => keyCustomerIds.has(i.customer);
  const isKeyLead = (l) => isKeyAccountLead(keyCustomerIds, l);
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

  // ── Taxas da cadeia: os 30 DIAS MÓVEIS (decisão do Leo, 25/08/2026) ────────
  // Antes a janela era o mês fechado anterior (08/08: "o correto é o funil").
  // Trocou porque a operação muda de patamar rápido demais pro mês passado
  // ainda descrever o presente: junho 58 leads, julho 484, agosto 756 em 25
  // dias (30/dia contra 15,6/dia em julho). Com o mês fechado, o plano era
  // desdobrado por um funil de outra escala de operação.
  // O custo conhecido é o TRUNCAMENTO: uma janela de 30d móveis captura ~79%
  // dos ganhos que a coorte ainda vai gerar (medido na distribuição real de
  // atraso lead→ganho: mediana 3,1 dias, p90 20,5, 96% em até 30 dias). Quem
  // paga essa conta é a CALIBRAÇÃO da ponta a ponta, logo abaixo, que agora
  // fica ligada em QUALQUER janela.
  // O mês fechado segue como FALLBACK (sem amostra em 30d), e nele as contas
  // continuam sendo as MESMAS do funil da Visão geral filtrada no mês passado
  // (bloco `team` do scoreboard) — o teste de consistência amarra:
  //   leads      = criados na janela (+ histórico pré-cockpit se a janela
  //                alcança a época; MESMO gate do placar)
  //   contatados = WORKLOAD: leads trabalhados na janela (lead antigo tocado
  //                agora conta) + histórico
  //   marcadas   = safra de calls da janela (callAt OU testemunha nela) + hist
  //   realizadas = resolução da safra; a base do comparecimento exclui as
  //                calls futuras (realizadas + furos), igual ao placar
  //   ganhos     = vendas com wonAt na janela, de qualquer lead (nunca ajustado)
  // Taxas: contato = COBERTURA da coorte (dos que entraram, alcançados; sem
  // histórico — não há registro do resultado daquele trabalho); agendamento =
  // marcadas DA COORTE ÷ alcançados da coorte (régua #650: cadeia encadeada na
  // mesma base — workload inflado pela nutrição em massa afundava a taxa e
  // inflava o plano); comparecimento = realizadas ÷ devidas; conversão =
  // ganhos ÷ realizadas, SEM calibração: calibrar mostraria um número diferente
  // do que a Visão geral mostra pro mesmo mês.
  // Sem amostra nos 30 dias móveis (menos de MIN_RATE_SAMPLE leads ou nenhum
  // ganho na janela), cai no mês fechado anterior; sem amostra lá também, as
  // taxas caem na meta configurada e depois no benchmark.
  const humanIds = new Set(users.map((u) => u.id));
  const prevMonth = (() => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [pmY, pmM] = prevMonth.split("-").map(Number);
  const prevMonthEnd = `${prevMonth}-${String(new Date(pmY, pmM, 0).getDate()).padStart(2, "0")}`;
  const inPrevMonth = (iso) => inRange(iso, `${prevMonth}-01`, prevMonthEnd);
  const enteredPrev = leads.filter((l) => inPrevMonth(l.createdAt));
  const wonPrev = winLeadsIn(inPrevMonth).length;
  // Janela PRIMÁRIA: 30d móveis. Só cai no mês fechado quando os 30d não têm
  // amostra (produto novo, mês parado), invertendo a prioridade de 08/08.
  const cohort30 = leads.filter((l) => inRange(l.createdAt, since30));
  const won30 = winLeadsIn((iso) => inRange(iso, since30)).length;
  const rolling30HasSample = cohort30.length >= MIN_RATE_SAMPLE && won30 > 0;
  const useMonth = !rolling30HasSample && enteredPrev.length >= MIN_RATE_SAMPLE && wonPrev > 0;

  // Histórico PRÉ-COCKPIT (product.paceAdjust): dados reais de antes do registro
  // no cockpit somados aos VOLUMES. GANHO nunca usa ajuste (decisão do Leo,
  // 24/07): as vendas pré-cockpit têm wonAt real (#293), "+won" contaria em dobro.
  const adj = product.paceAdjust && typeof product.paceAdjust === "object" ? product.paceAdjust : {};
  const adjVal = (k) => { const n = Math.floor(Number(adj[k])); return Number.isFinite(n) && n > 0 ? n : 0; };
  const adjMap = (on) => (on ? ["leads", "contacted", "booked", "shown"].reduce((o, k) => (adjVal(k) ? { ...o, [k]: adjVal(k) } : o), null) : null);

  // nWon alimenta o closeRate (ganhos das calls REALIZADAS); nWonChain alimenta
  // a ponta a ponta (ganhos da COORTE, com ou sem call agendada) — separados
  // porque a venda sem call registrada sumia do ponta a ponta e puxava a
  // calibração pra baixo.
  let conversions, rateWindow, paceAdjust, nLeads, nWon, nWonChain;
  let chainExposure = null; // leads da coorte já MADUROS (só na janela móvel)
  if (useMonth) {
    // Gate do histórico: MESMO do placar — só entra quando a JANELA começa
    // antes da época do 1º registro de atividade (ou de paceAdjust.before).
    let activityEpoch = null;
    for (const a of allActivities) {
      if (a.saas !== product.id) continue;
      const d0 = dayKey(a.at);
      if (d0 && (!activityEpoch || d0 < activityEpoch)) activityEpoch = d0;
    }
    const adjCutoff = adj.before || activityEpoch;
    const adjOn = !!product.paceAdjust && (!adjCutoff || `${prevMonth}-01` < adjCutoff);
    const adjN = (k) => (adjOn ? adjVal(k) : 0);
    const contactPrev = contactAttribution({ leads, actsOf, waMessages, saas: product.id, inWin: inPrevMonth, humanIds });
    const bookedPrev = callCohortIn(leads, actsOf, inPrevMonth);
    const outPrev = callOutcome(product, bookedPrev, actsOf, today, inPrevMonth);
    const reached = enteredPrev.filter((l) => contactPrev.leadIds.has(l.id)).length;
    // Coorte encadeada (régua #650): das calls da janela, só as de lead que
    // ENTROU nela — par do `reached` na taxa de agendamento.
    const enteredIds = new Set(enteredPrev.map((l) => l.id));
    const bookedCohortPrev = bookedPrev.filter((l) => enteredIds.has(l.id));
    nLeads = enteredPrev.length + adjN("leads");
    const shown = outPrev.shown + adjN("shown");
    const due = shown + outPrev.noShow; // o que JÁ devia ter acontecido (sem as futuras)
    nWon = wonPrev;
    nWonChain = wonPrev;
    conversions = {
      contactRate: resolvedRate(reached, enteredPrev.length, goalRate(goals, "sdr", "contactRate"), RATE_BENCHMARKS.contactRate),
      bookingRate: resolvedRate(bookedCohortPrev.length + adjN("booked"), reached + adjN("contacted"), goalRate(goals, "sdr", "bookingRate"), RATE_BENCHMARKS.bookingRate),
      showRate: resolvedRate(shown, due, goalRate(goals, "sdr", "showRate"), RATE_BENCHMARKS.showRate),
      closeRate: resolvedRate(nWon, shown, goalRate(goals, "closer", "conversaoCall"), RATE_BENCHMARKS.closeRate),
    };
    paceAdjust = adjMap(adjOn);
    rateWindow = { mode: "month", month: prevMonth, since: `${prevMonth}-01`, until: prevMonthEnd };
  } else {
    // Janela móvel de 30 dias (a PRIMÁRIA desde 25/08): coorte dos leads criados
    // nela com desfechos até hoje + calibração pela ponta a ponta.
    // Contato sem janela no toque de propósito: a coorte é dos leads recentes,
    // o contato vale quando aconteceu.
    const cohort = cohort30;
    const ids = new Set(cohort.map((l) => l.id));
    const humanContact = contactAttribution({ leads, actsOf, waMessages, saas: product.id, inWin: () => true, humanIds });
    const contacted = cohort.filter((l) => humanContact.leadIds.has(l.id));
    const booked = bookedLeadsIn(product, leads, actsOf, (iso) => inRange(iso, since30)).filter((l) => ids.has(l.id));
    const out = callOutcome(product, booked, actsOf); // { shown, noShow, won }
    nLeads = cohort.length + adjVal("leads");
    const nContacted = contacted.length + adjVal("contacted");
    const nBooked = booked.length + adjVal("booked");
    const nShown = out.shown + adjVal("shown");
    nWon = out.won;
    // Ponta a ponta: TODOS os ganhos da coorte, inclusive quem fechou sem call
    // agendada no cockpit (o `out.won` só enxerga a safra de calls).
    nWonChain = winLeadsIn(() => true).filter((l) => ids.has(l.id)).length;
    // Exposição madura: quanto dessa coorte já teve tempo real de fechar.
    const winAtAll = winsIn(product, leads, () => true, customerStartByLead);
    const delays = [];
    for (const [wid, when] of winAtAll) {
      const born = Date.parse(leadById.get(wid)?.createdAt || "");
      const at = Date.parse(when);
      if (Number.isFinite(born) && Number.isFinite(at) && at >= born) delays.push((at - born) / DAY);
    }
    if (delays.length >= MIN_RATE_SAMPLE) {
      const matured = maturityCurve(delays);
      chainExposure = cohort.reduce((a, l) => {
        const born = Date.parse(l.createdAt || "");
        return a + (Number.isFinite(born) ? matured((now.getTime() - born) / DAY) : 1);
      }, 0) + adjVal("leads");
    }
    conversions = {
      contactRate: resolvedRate(nContacted, nLeads, goalRate(goals, "sdr", "contactRate"), RATE_BENCHMARKS.contactRate),
      bookingRate: resolvedRate(nBooked, nContacted, goalRate(goals, "sdr", "bookingRate"), RATE_BENCHMARKS.bookingRate),
      // Comparecimento sobre as AGENDADAS (funil encadeado da coorte).
      showRate: resolvedRate(nShown, nBooked, goalRate(goals, "sdr", "showRate"), RATE_BENCHMARKS.showRate),
      closeRate: resolvedRate(nWon, nShown, goalRate(goals, "closer", "conversaoCall"), RATE_BENCHMARKS.closeRate),
    };
    paceAdjust = adjMap(true);
    rateWindow = { mode: "rolling30", since: since30, until: today };
  }

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

  // Ponta a ponta REAL (ganhos ÷ leads da janela das taxas): é a régua que bate
  // com o caixa ("vendi X com Y de mídia").
  // A CALIBRAÇÃO vale em QUALQUER janela desde 25/08. Antes ficava desligada no
  // mês fechado pra não divergir da Visão geral, e o preço era uma cadeia que se
  // contradizia na própria tela: multiplicando as 4 taxas de julho dava 2,62%,
  // enquanto o lead→ganho da MESMA janela dava 4,07%. As bases das etapas não
  // são a mesma coorte (contato e agendamento são da safra de LEADS, o
  // comparecimento é da safra de CALLS, o fechamento é ganho por data de venda),
  // então o produto delas nunca devolve o ponta a ponta. Sem calibrar, o plano
  // pedia ~60% mais lead e mídia do que a história do produto justifica.
  // A Visão geral continua batendo com `closeRate` (o valor MEDIDO, que segue
  // exposto); `closeRateEffective` é o que a cadeia usa, e a tela mostra os dois.
  const chainProb = round4(clampRate(conversions.contactRate.value * conversions.bookingRate.value
    * conversions.showRate.value * conversions.closeRate.value));
  conversions.leadToWin = resolvedRate(nWonChain, nLeads, null, chainProb);
  // Ponta a ponta DESTRUNCADA: os mesmos ganhos sobre os leads que já tiveram
  // tempo de fechar. É ela que a cadeia persegue; `leadToWin` (cru) continua
  // exposto porque é o número que qualquer um conta na mão.
  // A chave só existe quando a correção se aplica: toda entrada de `conversions`
  // é um objeto de taxa, e um null aqui quebraria quem varre o mapa.
  if (chainExposure > 0 && nWonChain > 0 && conversions.leadToWin.source === "history") {
    conversions.leadToWinMature = {
      value: round4(clampRate(nWonChain / chainExposure)),
      source: "matured",
      numerator: nWonChain,
      denominator: Math.round(chainExposure),
      capture: round4(clampRate(chainExposure / nLeads)),
    };
  }
  const endToEnd = conversions.leadToWinMature?.value ?? conversions.leadToWin.value;
  const upstream = conversions.contactRate.value * conversions.bookingRate.value * conversions.showRate.value;
  const calibrated = conversions.leadToWin.source === "history"
    && conversions.leadToWin.numerator > 0 && conversions.leadToWin.denominator >= MIN_RATE_SAMPLE && upstream > 0;
  conversions.closeRateEffective = calibrated
    ? { value: round4(clampRate(endToEnd / upstream)), source: "calibrated" }
    : { value: conversions.closeRate.value, source: conversions.closeRate.source };

  // ── Meta ancorada no VENDIDO (contrato cheio) ──────────────────────────────
  // Decisão do Leo (20/07): a meta do mês mede o que foi VENDIDO no mês (TCV
  // pela régua oficial isWonLead + wonAt) — cartão em 12x entra cheio. O caixa
  // (faturas pagas) segue no bloco `cash` como leitura; o fluxo e o dinheiro
  // futuro moram na aba Clientes. O desdobramento (plan) persegue o gap do
  // VENDIDO, não o do caixa.
  // O VENDIDO soma a mentoria (Leo, 16/08: entra normal como contrato e
  // receita). As TAXAS da cadeia acima seguem no ganho da plataforma —
  // desdobrar a meta por uma conversão que inclui venda sem call agendada
  // pediria menos call do que a empresa precisa.
  // Conta grande fora do RESULTADO (Leo, 19/08) — a MESMA régua da janela
  // histórica (computeWindowGoal), pra as duas faixas nunca divergirem. O caixa
  // (`cash`, faturas pagas) segue cheio: o dinheiro entrou de verdade.
  const notKey = (l) => !isKeyLead(l);
  const todayWinLeads = winSaleLeadsIn((iso) => dayKey(iso) === today).filter(notKey);
  const todayWon = todayWinLeads.length;
  const tcvMonthLeadsAll = winSaleLeadsIn(inMonth);
  const tcvMonthLeads = tcvMonthLeadsAll.filter(notKey);
  const keyMonthLeads = tcvMonthLeadsAll.filter(isKeyLead);
  const tcvMonth = tcvOf(tcvMonthLeads);
  // VENDIDO = receita RECONHECIDA (Leo, 29/08/2026): à vista e cartão 12x
  // contam o contrato cheio, faturado/parcelado/recorrente contam só o que
  // ENTROU na janela. `tcvMonth` segue sendo o CONTRATADO (contexto e base do
  // custo % de "ganhos"); a meta persegue o vendido reconhecido, que é o mesmo
  // número do placar do time (metrics-consistency amarra os dois).
  const valueOfMonth = saleValuer({ invoices, mpPayments, customers, inWin: inMonth });
  const valueOfToday = saleValuer({ invoices, mpPayments, customers, inWin: (iso) => dayKey(iso) === today });
  const sold = revenueOf(tcvMonthLeads, valueOfMonth);
  const soldToday = revenueOf(todayWinLeads, valueOfToday);
  // Vendido reconhecido POR DIA do mês (soma = `sold`): o gráfico de pace do
  // pipeline desenha esta série em vez de somar lead.amount por conta própria —
  // senão a curva subiria pelo contrato cheio e passaria a meta que a faixa
  // mostra, com os dois números na mesma tela.
  const winMonthAt = winsIn(product, saleLeads, inMonth, customerStartByLead);
  const soldByDay = Array.from({ length: Number(calendar.lastDay) }, () => 0);
  for (const l of tcvMonthLeads) {
    const day = Number(dayKey(winMonthAt.get(l.id)).slice(8, 10));
    if (day >= 1 && day <= soldByDay.length) soldByDay[day - 1] += valueOfMonth(l);
  }
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
      // Contrato CHEIO fechado no mês (sem conta grande). `contracted - sold` é
      // o faturado/recorrente que ainda não caiu: a faixa mostra a diferença em
      // vez de a venda parecer menor sem explicação.
      contracted: tcvMonth,
      byDay: soldByDay.map(round2), // vendido reconhecido dia a dia (soma = sold)
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
    // O que a conta grande tirou do resultado (e quanto o mês daria com ela).
    keyAccount: keyAccountNote(keyMonthLeads, customers, sold, tcvMonthLeads.length, valueOfMonth),
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

// ── Meta de uma JANELA qualquer (mês passado, semana, dia) ───────────────────
// A faixa "Meta do mês" da Visão geral segue o filtro do topo (Leo, 08/08):
// julho selecionado mostra a meta e o resultado DE JULHO, semana mostra a
// fatia da semana, dia a fatia do dia — cada mês com a meta da sua época
// (product.monthlyCashTargets + regra de crescimento, via cashTargetFor).
//
// A meta se reparte SÓ pelos dias úteis (o time não opera no fim de semana):
// meta do dia útil = meta do mês ÷ dias úteis daquele mês; a meta da janela é
// a soma dos dias úteis que ela cobre (janela cruzando meses soma cada fatia).
// Sábado/domingo carregam meta zero — dia de fim de semana selecionado devolve
// businessDays: 0 e a UI mostra "sem meta cobrada".
const isBizDay = (day) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
};
const nextDay = (day) => dayKey(new Date(new Date(`${day}T12:00:00Z`).getTime() + DAY));
function monthBizDays(month) {
  const total = new Date(Date.UTC(...month.split("-").map(Number), 0)).getUTCDate();
  let n = 0;
  for (let d = 1; d <= total; d++) {
    const w = new Date(Date.UTC(month.split("-")[0], Number(month.split("-")[1]) - 1, d)).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export async function computeWindowGoal(repo, product, since, until, now = new Date()) {
  const today = dayKey(now);
  // Ticket sem contas grandes e a meta de contratos digitada: a MESMA régua do
  // pace do mês corrente, pra as duas faixas nunca divergirem.
  const pace = await computePipelinePace(repo, product, now);
  const avg = Number(pace.context.averageEntry) > 0 ? Number(pace.context.averageEntry) : null;
  const companyContracts = Number(product.monthlyContractsTarget) > 0 ? Math.round(Number(product.monthlyContractsTarget)) : null;

  // Meta da janela: soma da fatia diária (dias úteis) de cada mês coberto.
  const bizPerMonth = new Map();
  let bizDays = 0, bizElapsed = 0, targetRevenue = 0, targetContracts = 0, hasContractsTarget = false;
  for (let d = since; d <= until; d = nextDay(d)) {
    if (!isBizDay(d)) continue;
    bizDays++;
    if (d <= today) bizElapsed++;
    const m = d.slice(0, 7);
    if (!bizPerMonth.has(m)) bizPerMonth.set(m, monthBizDays(m));
    const mBiz = bizPerMonth.get(m) || 1;
    targetRevenue += cashTargetFor(product, m).target / mBiz;
    const mContracts = companyContracts ?? (avg ? Math.ceil(cashTargetFor(product, m).target / avg) : null);
    if (mContracts != null) { targetContracts += mContracts / mBiz; hasContractsTarget = true; }
  }
  targetRevenue = round2(targetRevenue);

  // Vendido na janela: régua oficial da venda (isWonLead + wonAt) sobre a base
  // do DINHEIRO — a mentoria entra normal (Leo, 16/08) e o R$ é o RECONHECIDO
  // (faturado/recorrente só pelo que entrou, Leo 29/08).
  const [allLeads, allCustomers, allInvoices, mpPayments] = await Promise.all([
    repo.list("leads"), repo.list("customers"),
    repo.list("invoices"), repo.list("mp_payments").catch(() => []),
  ]);
  const leads = allLeads.filter((l) => l.saas === product.id && isSaleLead(l));
  const customers = allCustomers.filter((c) => c.saas === product.id);
  const inWin = (iso) => { const d = dayKey(iso); return d && d >= since && d <= until; };
  const winAt = winsIn(product, leads, inWin, customerStartMap(customers));
  // CONTA GRANDE fora do RESULTADO (Leo, 19/08): um bespoke de R$ 120 mil no
  // meio de vendas de R$ 3 a 7 mil faz o mês parecer batido sem que a operação
  // tenha rodado — julho fechou 218k com 17 contratos, mas 120,8k vieram de um
  // negócio só. O dinheiro segue cheio no caixa/Financeiro e volta aqui como
  // rodapé (`keyAccount`), pra ninguém achar que sumiu.
  const keyIds = keyAccountIds(customers);
  const winLeadsAll = leads.filter((l) => winAt.has(l.id));
  const winLeads = winLeadsAll.filter((l) => !isKeyAccountLead(keyIds, l));
  const keyWinLeads = winLeadsAll.filter((l) => isKeyAccountLead(keyIds, l));
  // MESMA régua do mês: faturado/recorrente conta só o que entrou NA JANELA.
  const valueOf = saleValuer({
    invoices: allInvoices.filter((i) => i.saas === product.id), mpPayments, customers, inWin,
  });
  const sold = revenueOf(winLeads, valueOf);
  const contracted = tcvOf(winLeads);
  const soldN = winLeads.length;

  const ended = until < today;
  const expectedFrac = bizDays > 0 ? round4(bizElapsed / bizDays) : 1;
  const statusOf = (val, target) => {
    if (!(target > 0)) return null;
    if (ended) return val >= target ? "ahead" : "behind"; // janela fechada: veredito final
    const expected = target * expectedFrac;
    return val >= expected ? "ahead" : val >= expected * 0.95 ? "attention" : "behind";
  };
  const contractsTarget = hasContractsTarget ? Math.round(targetContracts * 10) / 10 : null;
  return {
    saas: product.id, since, until, today,
    businessDays: bizDays, businessDaysElapsed: bizElapsed,
    ended, current: !ended && since <= today,
    sale: {
      target: targetRevenue > 0 ? targetRevenue : null,
      sold,
      // Contrato cheio da janela: `contracted - sold` é o faturado/recorrente
      // que ainda não caiu (a UI explica a diferença em vez de escondê-la).
      contracted,
      progress: targetRevenue > 0 ? round4(sold / targetRevenue) : null,
      expectedProgress: expectedFrac,
      status: statusOf(sold, targetRevenue),
    },
    contracts: {
      target: contractsTarget,
      sold: soldN,
      progress: contractsTarget > 0 ? round4(soldN / contractsTarget) : null,
      expectedProgress: expectedFrac,
      status: statusOf(soldN, contractsTarget),
    },
    keyAccount: keyAccountNote(keyWinLeads, customers, sold, soldN, valueOf),
  };
}

// Rodapé da conta grande: o que ficou de FORA do resultado e quanto o período
// daria com ela. Sem isso a exclusão vira número sumido sem explicação.
function keyAccountNote(keyLeads, customers, sold, soldN, valueOf) {
  if (!keyLeads.length) return null;
  const nameOfCustomer = (id) => customers.find((c) => c.id === id)?.name || "";
  const revenue = revenueOf(keyLeads, valueOf);
  return {
    count: keyLeads.length,
    revenue,
    names: [...new Set(keyLeads.map((l) => nameOfCustomer(l.customerId)).filter(Boolean))],
    soldWith: round2(sold + revenue),
    countWith: soldN + keyLeads.length,
  };
}

export function registerPipelinePaceRoutes(app, repo, { now = () => new Date() } = {}) {
  app.get("/api/pipeline-pace/:saas", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    return computePipelinePace(repo, product, now());
  });
  // Meta de uma janela qualquer (a faixa da Visão geral seguindo o filtro).
  app.get("/api/pipeline-pace/:saas/window", async (req, reply) => {
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
    const since = String(req.query.since || "");
    const until = String(req.query.until || "");
    if (!ok(since) || !ok(until) || since > until) return reply.code(400).send({ error: "since/until inválidos (YYYY-MM-DD)" });
    return computeWindowGoal(repo, product, since, until, now());
  });
}
