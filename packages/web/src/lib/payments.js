// Modo de pagamento com que o closer FECHOU o negócio — assinalado na virada pra
// Ganho/Integração (o momento do fechamento), junto do valor. Guardado em
// lead.paymentMethod e carregado pro customer no convertWonLead.
// `upfront` = a empresa recebe o VALOR TOTAL no fechamento (à vista/cartão 12x,
// que a adquirente antecipa); false = recebe POR MÊS ao longo do contrato
// (faturado/parcelado) — é o que separa caixa de dinheiro futuro na Análise.
// Ids antigos mantidos: "pix" era o PIX genérico (vira à vista), "boleto" era o
// faturado; dados existentes continuam válidos sem migração.
export const PAYMENT_METHODS = [
  { id: "pix", label: "PIX à vista", upfront: true },
  { id: "pix_parcelado", label: "PIX parcelado", upfront: false },
  { id: "boleto_vista", label: "Boleto à vista", upfront: true },
  { id: "boleto", label: "Boleto faturado", upfront: false },
  { id: "cartao12x", label: "Cartão de crédito 12x", upfront: true },
];

export const paymentLabel = (id) => PAYMENT_METHODS.find((p) => p.id === id)?.label || "";
// Sem meio de pagamento registrado, assume à vista (comportamento antigo: tudo caixa).
export const paymentUpfront = (id) => PAYMENT_METHODS.find((p) => p.id === id)?.upfront !== false;

// Plano com que o negócio fechou — também assinalado no gate de fechamento e
// carregado pro customer no convertWonLead (vira a coluna Plano e a base do arr).
// A oferta atual é só Anual/Semestral/Serviço único; "mensal" fica fora do gate
// mas segue reconhecido em dados antigos (closedPlanLabel e o fator anual da API).
export const CLOSED_PLANS = [
  { id: "anual", label: "Anual" },
  { id: "semestral", label: "Semestral" },
  { id: "unico", label: "Serviço único" },
];

export const closedPlanLabel = (id) => CLOSED_PLANS.find((p) => p.id === id)?.label || (id === "mensal" ? "Mensal" : "");

// UniqueKids não vende plano recorrente: vende PACOTE de consultas da mentoria
// (o que o cliente comprou é o tamanho da jornada). Vale como rótulo do
// customer.plan e como opção no gate de fechamento e no cadastro do cliente.
export const CONSULT_PACKAGES = [8, 4];
export const consultPackageLabel = (n) => `Mentoria · ${Number(n) || 8} consultas`;
// Rótulo → nº de consultas ("Mentoria · 4 consultas" → 4); 0 quando não é pacote.
export const consultPackageOf = (plan) => {
  const m = String(plan || "").match(/(\d+)\s*consulta/i);
  return m ? Number(m[1]) : 0;
};
