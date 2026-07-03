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

// Linha do tempo do cliente: cada marco com dueAt e status
//   done (concluído) · late (venceu sem concluir) · soon (vence em ≤7 dias) · next
export function milestonesFor(customer, product, now = Date.now()) {
  if (!customer?.startedAt) return [];
  const start = new Date(customer.startedAt).getTime();
  if (!Number.isFinite(start)) return [];
  const done = customer.milestonesDone || {};
  return milestoneTemplate(product).map((m) => {
    const dueAt = start + Number(m.dueDays || 0) * DAY;
    const doneAt = done[m.key] || null;
    const status = doneAt ? "done" : dueAt <= now ? "late" : dueAt - now <= 7 * DAY ? "soon" : "next";
    return { ...m, dueAt: new Date(dueAt).toISOString(), doneAt, status };
  });
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
