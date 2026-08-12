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

// Produto do catálogo da apresentação (tela zero) com que o negócio fechou —
// espelho do PRODUCT_LABEL de packages/api/src/proposal-catalog.js (os dois
// andam juntos). Vai no lead (dealProduct) pelo link de pagamento, aparece no
// card da Integração e na coluna Plano do cliente.
export const DEAL_PRODUCTS = [
  { id: "full", label: "LeverAds FULL" },
  { id: "fulloem", label: "LeverAds + OEM FULL" },
  { id: "oem", label: "OEM avulso" },
  { id: "parcialA", label: "Parcial" },
  { id: "parcialoem", label: "Parcial + OEM 50" },
  // Serviço único (clonagem entre contas cobrada uma vez, por faixa de
  // anúncios): vende, mas não é produto do deck — não vira apresentação.
  { id: "avulso", label: "Clonagem avulsa" },
];

// O QUE DÁ PRA FECHAR neste SaaS, com os preços que estão na apresentação: o
// servidor manda o catálogo do template (banco) no SEED, então preço mexido no
// banco vale na hora, sem deploy do cockpit. Lista vazia = SaaS sem catálogo
// (UniqueKids vende pacote de consultas) — quem consome esconde o campo.
export function dealProductsOf(saas) {
  const rows = (typeof window !== "undefined" && window.SEED?.CONFIG?.proposals?.catalog?.[saas]) || null;
  return Array.isArray(rows) ? rows : [];
}
// Rótulo do produto vendido: o do catálogo do SEED (nome que está na
// apresentação) e, sem ele, o estático acima.
export const dealProductLabel = (id, saas = "") =>
  dealProductsOf(saas).find((p) => p.id === id)?.label
  || DEAL_PRODUCTS.find((p) => p.id === id)?.label || "";

// Como o pagamento SAIU no Mercado Pago (payment_type_id/payment_method_id do
// /v1/payments) — diferente de PAYMENT_METHODS (o combinado do fechamento):
// aqui é o FATO, a forma com que o dinheiro realmente entrou. Vale pro espelho
// (mp_payments: method/methodType/installments) e pra fatura baixada
// (paidMethod/paidMethodType/paidInstallments).
const MP_TYPE_LABEL = {
  bank_transfer: "PIX", ticket: "Boleto", credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito", account_money: "Saldo MP", prepaid_card: "Cartão pré-pago",
};
export function mpMethodLabel(p = {}) {
  const method = p.paidMethod ?? p.method ?? "";
  const type = p.paidMethodType ?? p.methodType ?? "";
  const inst = Number(p.paidInstallments ?? p.installments) || 1;
  const base = method === "pix" ? "PIX" : MP_TYPE_LABEL[type] || method || "";
  return base ? (inst > 1 ? `${base} · ${inst}x` : base) : "";
}
export const MP_PAY_STATUS = {
  approved: { label: "pago", tone: "pos" },
  pending: { label: "pendente", tone: "warn" },
  in_process: { label: "em análise", tone: "warn" },
  authorized: { label: "autorizado", tone: "warn" },
  rejected: { label: "recusado", tone: "neg" },
  cancelled: { label: "cancelado", tone: "mut" },
  refunded: { label: "estornado", tone: "neg" },
  charged_back: { label: "chargeback", tone: "neg" },
};

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
