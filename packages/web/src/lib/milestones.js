// Marcos de pós-venda por tempo de casa. A régua padrão nasce aqui; um produto
// pode sobrescrever com `product.milestones` = [{ key, label, dueDays }].
// Conclusão fica em `customer.milestonesDone` = { [key]: isoDate } (PATCH cru).

const DAY = 86_400_000;

export const DEFAULT_MILESTONES = [
  { key: "onboarding", label: "Onboarding", dueDays: 7, hint: "semana 1" },
  { key: "checkin_m1", label: "Check-in de mês 1", dueDays: 30, hint: "mês 1" },
  { key: "revisao_m3", label: "Revisão de resultado", dueDays: 90, hint: "mês 3" },
  { key: "upsell_m6", label: "Conversa de upsell", dueDays: 180, hint: "mês 6" },
];

export function milestoneTemplate(product) {
  const custom = product?.milestones;
  return Array.isArray(custom) && custom.length ? custom : DEFAULT_MILESTONES;
}

// Duração do contrato em dias: ciclo da assinatura ativa (`contractCycle`,
// injetado por quem tem as subs na mão) ou o texto livre de customer.plan;
// sem nenhum sinal, assume contrato anual (o padrão da casa).
const CYCLE_DAYS = { monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };
const PLAN_HINTS = [["mensal", 30], ["trimestral", 91], ["semestral", 182], ["anual", 365]];
export const RENEWAL_LEAD_DAYS = 60; // contato de renovação 2 meses antes do fim

function contractDays(customer) {
  const byCycle = CYCLE_DAYS[customer?.contractCycle];
  if (byCycle) return byCycle;
  const plan = String(customer?.plan || "").toLowerCase();
  for (const [hint, days] of PLAN_HINTS) if (plan.includes(hint)) return days;
  return 365;
}

// Marco dinâmico: contato de renovação 2 meses antes do contrato acabar.
// Contrato mais curto que a antecedência (mensal) não tem régua de renovação.
function renewalMilestone(customer) {
  const days = contractDays(customer);
  if (days <= RENEWAL_LEAD_DAYS) return null;
  return { key: "renovacao", label: "Contato de renovação", dueDays: days - RENEWAL_LEAD_DAYS, hint: "2 meses antes do fim do contrato" };
}

// Linha do tempo do cliente: cada marco com dueAt e status
//   done (concluído) · late (venceu sem concluir) · soon (vence em ≤7 dias) · next
export function milestonesFor(customer, product, now = Date.now()) {
  if (!customer?.startedAt) return [];
  const start = new Date(customer.startedAt).getTime();
  if (!Number.isFinite(start)) return [];
  const done = customer.milestonesDone || {};
  const base = milestoneTemplate(product);
  const renewal = renewalMilestone(customer);
  const template = renewal && !base.some((m) => m.key === renewal.key) ? [...base, renewal] : base;
  return template
    .map((m) => {
      const dueAt = start + Number(m.dueDays || 0) * DAY;
      const doneAt = done[m.key] || null;
      const status = doneAt ? "done" : dueAt <= now ? "late" : dueAt - now <= 7 * DAY ? "soon" : "next";
      return { ...m, dueAt: new Date(dueAt).toISOString(), doneAt, status };
    })
    .sort((a, b) => (a.dueDays || 0) - (b.dueDays || 0)); // renovação de semestral cai antes do upsell
}

// Próximo marco em aberto (o que a linha "Próximo marco" e a Visão geral mostram).
export function nextMilestone(customer, product, now = Date.now()) {
  return milestonesFor(customer, product, now).find((m) => m.status !== "done") || null;
}

// Tempo de casa legível: "12 dias", "3 meses", "1 ano e 2 meses".
export function tenureLabel(customer, now = Date.now()) {
  if (!customer?.startedAt) return "";
  const days = Math.max(0, Math.floor((now - new Date(customer.startedAt).getTime()) / DAY));
  if (days < 60) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} meses`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} ${years === 1 ? "ano" : "anos"} e ${rest} ${rest === 1 ? "mês" : "meses"}` : `${years} ${years === 1 ? "ano" : "anos"}`;
}

// "vence em 3 dias" / "venceu há 2 dias" / "hoje"
export function dueLabel(iso, now = Date.now()) {
  const diff = Math.round((new Date(iso).getTime() - now) / DAY);
  if (diff === 0) return "hoje";
  if (diff > 0) return `em ${diff} ${diff === 1 ? "dia" : "dias"}`;
  return `há ${-diff} ${-diff === 1 ? "dia" : "dias"}`;
}
