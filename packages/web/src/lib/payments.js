// Modo de pagamento com que o closer FECHOU o negócio — assinalado na virada pra
// Ganho/Integração (o momento do fechamento), junto do valor. Guardado em
// lead.paymentMethod e carregado pro customer no convertWonLead.
export const PAYMENT_METHODS = [
  { id: "pix", label: "PIX" },
  { id: "boleto", label: "Boleto faturado" },
  { id: "cartao12x", label: "Cartão de crédito 12x" },
];

export const paymentLabel = (id) => PAYMENT_METHODS.find((p) => p.id === id)?.label || "";
