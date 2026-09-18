// A conta principal continua sendo o destino de criação e das automações.
// Contas adicionais ampliam somente a leitura de dados do mesmo produto.
export function metaAdAccounts(product = {}) {
  const extra = Array.isArray(product.metaAdAccounts) ? product.metaAdAccounts : [];
  return [...new Set([product.metaAdAccount, ...extra]
    .filter((id) => typeof id === "string" || typeof id === "number")
    .map((id) => String(id).trim().replace(/^act_/, ""))
    .filter((id) => /^\d+$/.test(id))
    .map((id) => `act_${id}`))];
}
