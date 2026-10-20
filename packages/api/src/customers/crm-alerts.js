// Alertas do Lever CRM (Fase 3): o que o time precisa saber antes de virar
// problema, entregue na caixa de notificações de quem é dono do registro. Cada
// aviso tem CHAVE própria (o mesmo fato não avisa duas vezes) e o texto já diz
// o que fazer. A queda de health avisa em health.js; o SLA do ticket em
// support/ticket-sla-runner.js.
//
//   renovação      assinatura ativa que vence em 30, 15 e 7 dias → dono da conta
//                  (aos 30 dias abre também o acompanhamento de renovação)
//   pagamento      pagamento recusado no Mercado Pago nas últimas 24 h → dono da conta
//   1º pagamento   cliente com 7+ dias desde o ganho e nenhuma fatura paga → dono da conta
//   go-live        integração aberta que passou do go-live previsto → integrador
//   oferta         proposta não aceita que vence em até 24 h → closer do lead
//   1º contato     lead novo com o prazo do 1º contato vencido → SDR
//   follow-up      lead em follow-up sem dia do próximo contato → closer

import { upsertNotification } from "../tasks/tasks-core.js";
import { kindOf } from "../crm/stages.js";
import { createFollowup } from "./cs-followups.js";
import { financialStatusOf } from "./lifecycle.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const RENEWAL_ALERT_DAYS = [30, 15, 7];
export const FIRST_PAYMENT_DAYS = 7;

async function notify(repo, out, n) {
  if (!n.user) { out.skipped++; return; }
  const dup = await repo.listWhere("notifications", { key: n.key });
  if (dup.length) return;
  await upsertNotification(repo, { task: "", by: "api", ...n });
  out.sent++;
}

// "dd/mm/aaaa" (validade gravada no estado do deck) → fim do dia em Brasília.
export function validUntilMs(raw) {
  const m = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return NaN;
  return Date.parse(`${m[3]}-${m[2]}-${m[1]}T23:59:59-03:00`);
}

async function renewals(repo, out, { now, customers }) {
  for (const s of await repo.listWhere("subscriptions", { status: "active" })) {
    const end = Date.parse(s.periodEnd || "");
    if (!Number.isFinite(end) || end < now) continue;
    const days = Math.ceil((end - now) / DAY);
    const mark = RENEWAL_ALERT_DAYS.find((d) => days === d);
    if (!mark) continue;
    const c = customers.get(s.customer);
    if (!c || c.endedAt) continue;
    await notify(repo, out, {
      user: c.owner, type: "renewal_due", taskTitle: c.name, saas: c.saas || "",
      key: `renewal:${s.id}:${s.periodEnd.slice(0, 10)}:${mark}`,
      text: `Renovação de ${c.name} vence em ${mark} dias (${new Date(end).toLocaleDateString("pt-BR")}): combine a renovação`,
      link: { screen: "customers", customer: c.id },
    });
    if (mark === 30) {
      const open = (await repo.listWhere("cs_followups", { customer: c.id })).some((f) => f.kind === "renovacao" && f.status === "aberto");
      if (!open) await createFollowup(repo, { customer: c.id, kind: "renovacao", dueAt: new Date(end - 7 * DAY).toISOString(), source: "alerta" });
    }
  }
}

async function failedPayments(repo, out, { now, customers }) {
  for (const p of await repo.listWhere("mp_payments", { status: "rejected" })) {
    const at = Date.parse(p.dateCreated || "");
    if (!p.customer || !Number.isFinite(at) || now - at > DAY) continue;
    const c = customers.get(p.customer);
    if (!c) continue;
    await notify(repo, out, {
      user: c.owner, type: "payment_failed", taskTitle: c.name, saas: c.saas || "", key: `payfail:${p.id}`,
      text: `Pagamento de ${c.name} foi recusado (R$ ${Number(p.amount) || 0}): fale com o cliente e reenvie o link`,
      link: { screen: "customers", customer: c.id },
    });
  }
}

async function firstPayment(repo, out, { now, customers }) {
  for (const c of customers.values()) {
    const started = Date.parse(c.startedAt || "");
    if (c.endedAt || !Number.isFinite(started) || now - started < FIRST_PAYMENT_DAYS * DAY) continue;
    const [subs, invoices] = await Promise.all([repo.listWhere("subscriptions", { customer: c.id }), repo.listWhere("invoices", { customer: c.id })]);
    if (financialStatusOf(subs, invoices) !== "aguardando_pagamento") continue;
    await notify(repo, out, {
      user: c.owner, type: "first_payment_missing", taskTitle: c.name, saas: c.saas || "", key: `firstpay:${c.id}`,
      text: `${c.name} ganhou há mais de ${FIRST_PAYMENT_DAYS} dias e o 1º pagamento não entrou`,
      link: { screen: "customers", customer: c.id },
    });
  }
}

async function lateGoLive(repo, out, { now, customers }) {
  for (const o of await repo.list("onboardings")) {
    const planned = Date.parse(o.plannedGoLiveAt || "");
    if (["concluida", "cancelada", "go_live"].includes(o.stage) || !Number.isFinite(planned) || planned >= now) continue;
    const c = customers.get(o.customer);
    await notify(repo, out, {
      user: o.integrator || c?.owner, type: "golive_late", taskTitle: c?.name || "", saas: c?.saas || "",
      key: `golive:${o.id}:${o.plannedGoLiveAt.slice(0, 10)}`,
      text: `Integração de ${c?.name || "cliente"} passou do go-live previsto (${new Date(planned).toLocaleDateString("pt-BR")})`,
      link: { screen: "customers", customer: o.customer, onboarding: o.id },
    });
  }
}

async function expiringOffers(repo, out, { now, leads }) {
  for (const p of await repo.list("proposals")) {
    if (p.accepted || !p.lead) continue;
    const until = validUntilMs(p.state?.validUntil);
    if (!Number.isFinite(until) || until < now || until - now > DAY) continue;
    const l = leads.get(p.lead);
    if (!l) continue;
    await notify(repo, out, {
      user: l.closer || l.owner, type: "offer_expiring", taskTitle: l.name || "", saas: l.saas || "", key: `offer:${p.id}:${p.state.validUntil}`,
      text: `A proposta de ${l.name || "lead"} vence amanhã: confirme a decisão ou renove a validade`,
      link: { screen: "pipeline", lead: l.id },
    });
  }
}

async function leadSla(repo, out, { now, leads }) {
  const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
  for (const l of leads.values()) {
    if (l.internal) continue;
    const kind = kindOf(products.get(l.saas), l.stage);
    const due = Date.parse(l.nextActionAt || "");
    if (kind === "novo" && Number.isFinite(due) && due < now && now - due < 7 * DAY) {
      await notify(repo, out, {
        user: l.owner, type: "lead_first_touch_late", taskTitle: l.name || "", saas: l.saas || "", key: `firsttouch:${l.id}:${l.nextActionAt}`,
        text: `${l.name || "Lead novo"} está sem 1º contato e o prazo venceu há ${Math.max(1, Math.round((now - due) / HOUR))} h`,
        link: { screen: "pipeline", lead: l.id },
      });
    }
    // Só quem entrou na etapa nos últimos 30 dias: o card parado há meses não
    // vira uma enxurrada de avisos na primeira rodada.
    const recent = now - (Date.parse(l.stageSince || "") || 0) < 30 * DAY;
    if (kind === "followup" && recent && !l.followupAt && !l.nextActionAt) {
      await notify(repo, out, {
        user: l.closer || l.owner, type: "followup_without_next", taskTitle: l.name || "", saas: l.saas || "", key: `fupnext:${l.id}:${l.stageSince || ""}`,
        text: `${l.name || "Lead"} está em follow-up sem dia do próximo contato`,
        link: { screen: "pipeline", lead: l.id },
      });
    }
  }
}

export async function runCrmAlerts(repo, { now = Date.now() } = {}) {
  const out = { sent: 0, skipped: 0 };
  const customers = new Map((await repo.list("customers")).map((c) => [c.id, c]));
  const leads = new Map((await repo.list("leads")).map((l) => [l.id, l]));
  const ctx = { now, customers, leads };
  for (const step of [renewals, failedPayments, firstPayment, lateGoLive, expiringOffers, leadSla]) await step(repo, out, ctx);
  return out;
}

export function startCrmAlerts(repo, { log, intervalMs = HOUR } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try { return await runCrmAlerts(repo); } catch (err) { log?.warn?.(`alertas do CRM: ${err.message}`); return null; } finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 180_000);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}
