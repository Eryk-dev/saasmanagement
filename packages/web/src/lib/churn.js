// Churn de cliente — régua ÚNICA do front (a mesma conta da API em churn.js):
// churnado = customer.endedAt no PASSADO. Antes cada tela decidia à sua
// maneira (Clientes comparava com agora, Visão geral churnava qualquer
// endedAt, até futuro) e os números divergiam.
export const isChurned = (c, at = Date.now()) =>
  !!(c?.endedAt && new Date(c.endedAt).getTime() <= at);

// Catálogo de motivos do botão "registrar churn" (ids estáveis; o servidor
// grava o id em customer.churnReason). "mp_cancel" não entra no select — é o
// motivo carimbado pelo churn AUTOMÁTICO quando o Mercado Pago cancela a
// recorrência, mas o label existe pra ficha mostrar bonito.
export const CHURN_REASONS = [
  { id: "sem_resultado", label: "Não viu resultado" },
  { id: "preco", label: "Preço / corte de custos" },
  { id: "fechou_operacao", label: "Fechou ou pausou a operação" },
  { id: "concorrente", label: "Trocou por concorrente" },
  { id: "inadimplencia", label: "Inadimplência" },
  { id: "fim_contrato", label: "Fim do contrato (não renovou)" },
  { id: "outro", label: "Outro" },
];

const LABELS = {
  ...Object.fromEntries(CHURN_REASONS.map((r) => [r.id, r.label])),
  mp_cancel: "Assinatura cancelada no Mercado Pago",
};
// Motivo fora do catálogo vale como texto livre — o label cai no próprio texto.
export const churnReasonLabel = (r) => LABELS[r] || String(r || "");
