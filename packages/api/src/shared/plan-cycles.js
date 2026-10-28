// Ciclos e planos de fechamento: fonte única compartilhada pela API e pela SPA.
// Sem dependências de servidor (a SPA importa este arquivo direto, como o
// lead-grade.js; os Dockerfiles de build web copiam os dois).
//
// Dois vocabulários convivem e NÃO são a mesma coisa:
//   · ciclo da ASSINATURA (`subscription.cycle`): monthly/quarterly/semiannual/annual;
//   · plano do FECHAMENTO (`lead.planClosed`): anual/semestral/mensal/unico.
// O trimestral só existe como ciclo de assinatura; nunca foi plano de fechamento.

export const CYCLES = ["monthly", "quarterly", "semiannual", "annual"];
export const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
export const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };
export const CYCLE_TITLE = { monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual" };
export const CYCLE_SHORT = { monthly: "mês", quarterly: "tri", semiannual: "sem", annual: "ano" };

// Valor anualizado de uma assinatura (preço é por ciclo).
export function annualized(price, cycle) {
  const months = CYCLE_MONTHS[cycle] || 1;
  return (Number(price) || 0) * (12 / months);
}

// `title` é o rótulo do link de pagamento (só existe pro que ainda se vende);
// `selectLabel` é o texto do select quando difere do rótulo; `catalogKey` é a
// chave do ciclo no catálogo da proposta (`anu`/`sem`). Serviço único não é
// recorrência: sem `cycle` nem `months`. "mensal" deixou de ser vendido em
// 10/09/2026 (`legacy`), mas cliente antigo continua rotulado.
export const CLOSED_PLANS = [
  { id: "anual", label: "Anual", title: "Plano Anual", cycle: "annual", months: 12, annualFactor: 1, catalogKey: "anu" },
  { id: "semestral", label: "Semestral", title: "Plano Semestral", cycle: "semiannual", months: 6, annualFactor: 2, catalogKey: "sem" },
  { id: "mensal", label: "Mensal", selectLabel: "Assinatura mensal", cycle: "monthly", months: 1, annualFactor: 12, legacy: true },
  // Serviço único NÃO é receita recorrente (12/10/2026): fator 0 — não entra
  // no ARR/MRR; o dinheiro vira fatura avulsa (ensureOneOffInvoice) e conta
  // na meta do mês em que fechou, como sempre.
  { id: "unico", label: "Serviço único", title: "Serviço único", annualFactor: 0 },
  // Teste grátis (Leo, 28/10/2026): o cliente usa a plataforma por `days`
  // dias sem pagar e decide depois. É uma venda (entra no Ganho e nas
  // últimas vendas), mas vale R$ 0: fator 0, sem ciclo nem meses — não nasce
  // assinatura nem fatura, e o pagamento fica "Não pago" até ele converter.
  // Sem `title`: não existe link de pagamento de teste grátis.
  { id: "teste", label: "15 dias", selectLabel: "Teste grátis (15 dias)", days: 15, annualFactor: 0, trial: true },
];

// Plano de fechamento que é TESTE GRÁTIS (sem cobrança) e os dias dele.
export const TRIAL_PLAN = "teste";
export const CLOSED_PLAN_DAYS = Object.fromEntries(CLOSED_PLANS.filter((p) => p.days).map((p) => [p.id, p.days]));
export const isTrialPlan = (planClosed) => !!CLOSED_PLANS.find((p) => p.id === planClosed)?.trial;
// Fim do teste: a partir do dia da venda (wonAt). "" quando não é teste ou
// a data é inválida.
export function trialEndsAt(wonAt, planClosed) {
  const days = CLOSED_PLAN_DAYS[planClosed];
  const t = new Date(wonAt || 0).getTime();
  if (!days || !Number.isFinite(t) || t <= 0) return "";
  return new Date(t + days * 86_400_000).toISOString();
}

const mapOf = (field) => Object.fromEntries(CLOSED_PLANS.filter((p) => p[field] !== undefined).map((p) => [p.id, p[field]]));

export const CLOSED_PLAN_LABEL = mapOf("label");
export const CLOSED_PLAN_TITLE = mapOf("title");
export const CLOSED_PLAN_CYCLE = mapOf("cycle");
export const CLOSED_PLAN_MONTHS = mapOf("months");
export const CLOSED_PLAN_ANNUAL_FACTOR = mapOf("annualFactor");

export const closedPlanToCycle = (planClosed) => CLOSED_PLAN_CYCLE[planClosed] || "";
export const cycleToClosedPlan = (cycle) => (cycle ? CLOSED_PLANS.find((p) => p.cycle === cycle)?.id : "") || "";

// Plano de fechamento lido de um rótulo livre ("Ads Escala · Anual").
// "" quando o texto não diz o ciclo.
export function closedPlanFromLabel(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("semestral")) return "semestral";
  if (t.includes("anual")) return "anual";
  if (t.includes("mensal")) return "mensal";
  if (t.includes("teste grátis") || t.includes("teste gratis")) return "teste";
  return "";
}
