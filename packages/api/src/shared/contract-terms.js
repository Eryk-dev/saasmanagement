// Produtos ativos do cliente com a VIGÊNCIA de cada um. Fonte única da API e da
// SPA (importa só plan-cycles.js, como o resto de shared/).
//
// Não existe campo "vigência" gravado. Ela é derivada:
//   · início  = sub.startedAt, senão a criação da assinatura; a assinatura
//     principal (a mais antiga) também considera `customer.startedAt`;
//   · duração = a do contrato vendido (retrato do plano: closedPlan/cycle; ou o
//     `planCycle` do cadastro), senão o ciclo da assinatura;
//   · fim     = o fim do período corrente quando o ciclo de cobrança cobre o
//     contrato (anual cobrado anualmente); quando o ciclo é MENOR que o
//     contrato (boleto/PIX parcelado/cartão recorrente de um plano anual, onde o
//     ciclo é mensal só para cobrar), o fim é início + N× a duração do contrato,
//     o primeiro que ainda não passou (renovação do contrato).
// `periodEnd` sozinho mentiria nesse segundo caso: mostraria o fim do mês.

import { CYCLE_MONTHS, CLOSED_PLAN_MONTHS } from "./plan-cycles.js";

const LIVE = new Set(["active", "past_due"]);
const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : NaN; };

function addMonthsIso(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}

// Meses do contrato vendido nesta assinatura (0 = não dá pra saber).
export function termMonthsOf(sub, customer, { primary = false } = {}) {
  const snap = sub?.planSnapshot || (primary ? customer?.planSnapshot : null) || null;
  return CLOSED_PLAN_MONTHS[snap?.closedPlan]
    || CYCLE_MONTHS[snap?.cycle]
    || (primary ? CLOSED_PLAN_MONTHS[customer?.planCycle] : 0)
    || CYCLE_MONTHS[sub?.cycle]
    || 0;
}

export function termOf(sub, customer, { primary = false, now = new Date() } = {}) {
  const months = termMonthsOf(sub, customer, { primary });
  const own = [sub?.startedAt, sub?.createdAt, sub?.periodStart].find((v) => Number.isFinite(ms(v))) || "";
  const cust = primary && Number.isFinite(ms(customer?.startedAt)) ? customer.startedAt : "";
  const start = [own, cust].filter(Boolean).sort((a, b) => ms(a) - ms(b))[0] || "";
  const billingMonths = CYCLE_MONTHS[sub?.cycle] || 0;
  let end = Number.isFinite(ms(sub?.periodEnd)) ? sub.periodEnd : "";
  if (start && months && billingMonths && billingMonths < months) {
    let guard = 0;
    end = addMonthsIso(start, months);
    while (ms(end) <= now.getTime() && guard++ < 200) end = addMonthsIso(end, months);
  }
  return { start, end, months };
}

// Linhas para o card do cliente: uma por assinatura viva (ativa ou em atraso),
// a mais antiga primeiro. `paid` diz se o produto está em dia: sem fatura
// vencida em aberto da assinatura e sem status past_due.
export function activeProducts({ customer, subs = [], invoices = [], plans = [], now = new Date() } = {}) {
  const mine = (subs || []).filter((s) => s.customer === customer?.id);
  const live = mine.filter((s) => LIVE.has(s.status))
    .sort((a, b) => String(a.periodStart || "").localeCompare(String(b.periodStart || "")) || String(a.id).localeCompare(String(b.id)));
  const oldest = [...mine].filter((s) => s.status !== "canceled")
    .sort((a, b) => String(a.periodStart || "").localeCompare(String(b.periodStart || "")) || String(a.id).localeCompare(String(b.id)))[0];
  return live.map((sub) => {
    const t = termOf(sub, customer, { primary: sub === oldest, now });
    const late = (invoices || []).filter((i) => i.subscription === sub.id && (i.status === "overdue"
      || (i.status === "open" && ms(i.dueDate) < now.getTime() - 86400000)));
    const plan = plans.find((p) => p.id === sub.plan || p.code === sub.planCode);
    const snap = sub.planSnapshot;
    return {
      id: sub.id,
      name: snap?.name || plan?.name || (oldest === sub ? customer?.plan : "") || "Plano sem nome",
      product: snap?.product || snap?.accessProduct || plan?.product || "",
      status: sub.status,
      paid: sub.status === "active" && !late.length,
      overdue: late.length,
      price: Number(sub.price) || 0,
      cycle: sub.cycle || "",
      start: t.start, end: t.end, termMonths: t.months,
      daysLeft: t.end ? Math.ceil((ms(t.end) - now.getTime()) / 86400000) : null,
    };
  });
}
