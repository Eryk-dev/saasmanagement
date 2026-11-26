// Venda de parceiro (26/11/2026). A Segunda Venda também vende o LeverPrice:
// um lead pode ter um VENDEDOR EXTERNO de um parceiro no lugar do closer.
//   lead.partner       = id da opção em product.partners ([{ id, label }],
//                        mesmo formato de product.lossReasons)
//   lead.partnerSeller = nome do vendedor externo (texto livre)
// Vazio = sem parceiro. Ter `partner` é ser venda de parceiro: o ganho entra
// no caixa e vira cliente, assinatura e integração normais, mas sai da meta,
// do placar e da remuneração (isPartnerSaleLead no metrics-core). O CRM novo
// copia o lead por espelho e depende destes nomes: não renomear.
//   lead.paymentPending = venda de parceiro fechada SEM meio de pagamento
//                         (o parceiro ainda vai dizer como o cliente paga).
//                         Só vale com `partner`; tirar o parceiro limpa;
//                         definir `paymentMethod` depois limpa sozinho.

export const PARTNER_SELLER_MAX = 120;

export const partnersOf = (product) =>
  (Array.isArray(product?.partners) ? product.partners : []).filter((p) => p && typeof p.id === "string" && p.id);

const clean = (v) => String(v ?? "").trim();

// O que o POST/PATCH de lead grava de parceiro. Devolve { patch } com só os
// campos que vieram (aparados; null vira ""), ou { error } com a mensagem do
// 400. `current` é o lead antes do PATCH (null no POST); `product` é o do
// produto do lead depois do PATCH.
// - parceiro precisa existir na lista do produto (o que o lead já tinha passa,
//   mesmo que a opção tenha saído da lista depois);
// - vendedor sem parceiro é recusado;
// - tirar o parceiro sem mandar o vendedor limpa o vendedor junto (desligar
//   "Venda de parceiro" na tela não deixa nome solto).
export const touchesPartner = (body) => !!body && typeof body === "object"
  && ["partner", "partnerSeller", "paymentPending", "paymentMethod"].some((k) => k in body);

export function partnerPatch(body, { product = null, current = null } = {}) {
  if (!body || typeof body !== "object") return { patch: {} };
  const hasPartner = "partner" in body;
  const hasSeller = "partnerSeller" in body;
  const hasPending = "paymentPending" in body;
  const methodSet = typeof body.paymentMethod === "string" && !!body.paymentMethod.trim();
  if (!hasPartner && !hasSeller && !hasPending && !methodSet) return { patch: {} };
  if (hasPending && body.paymentPending != null && typeof body.paymentPending !== "boolean") {
    return { error: "Pagamento pendente precisa ser verdadeiro ou falso" };
  }
  for (const k of ["partner", "partnerSeller"]) {
    if (k in body && body[k] != null && typeof body[k] !== "string") {
      return { error: k === "partner" ? "O parceiro precisa ser o id de uma opção da lista de parceiros do produto" : "O nome do vendedor do parceiro precisa ser um texto" };
    }
  }
  const patch = {};
  if (hasPartner) patch.partner = clean(body.partner);
  if (hasSeller) patch.partnerSeller = clean(body.partnerSeller);
  if (hasPartner && !patch.partner && !hasSeller) patch.partnerSeller = "";
  const partner = hasPartner ? patch.partner : clean(current?.partner);
  const seller = "partnerSeller" in patch ? patch.partnerSeller : clean(current?.partnerSeller);
  if (seller.length > PARTNER_SELLER_MAX) return { error: `O nome do vendedor do parceiro passa de ${PARTNER_SELLER_MAX} caracteres` };
  if (seller && !partner) return { error: "O nome do vendedor só vale com o parceiro: escolha o parceiro da venda" };
  if (hasPartner && partner && partner !== clean(current?.partner) && !partnersOf(product).some((p) => p.id === partner)) {
    return { error: `Parceiro "${partner}" não está na lista de parceiros do produto (Ajustes do produto → Parceiros de venda)` };
  }
  // Pagamento pendente: só na venda de parceiro. Meio de pagamento definido
  // (no mesmo PATCH ou depois) encerra a pendência; tirar o parceiro também.
  if (hasPending && body.paymentPending === true && !partner) {
    return { error: "Pagamento pendente só vale para venda de parceiro: escolha o parceiro da venda" };
  }
  if (methodSet || !partner) {
    if (hasPending || current?.paymentPending) patch.paymentPending = false;
  } else if (hasPending) {
    patch.paymentPending = body.paymentPending === true;
  }
  return { patch };
}
