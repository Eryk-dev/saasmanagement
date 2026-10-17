// Plano de contas ÚNICO do Financeiro (espelha CAT_SECTOR de
// packages/api/src/payments/routes.fin.js — os dois andam juntos).
// Custos (expenses), A pagar (payables) e Folha lançam na MESMA lista: a
// categoria decide o setor no DRE (deduções → COGS → S&M → R&D → G&A). Os ids
// legados (fixo/ferramenta/pessoal/estrutura/marketing) seguem rotulados pra
// lançamento antigo, mas não entram em select novo.

export const SECTOR_CATS = [
  ["deducoes", "Deduções da receita", [["imposto", "Impostos sobre receita (DAS)"]]],
  ["cogs", "Custo do serviço (COGS)", [
    ["infra", "Infra e hosting"], ["apis", "APIs e IA do produto"],
    ["suporte", "Suporte e CS"], ["taxas", "Taxas de pagamento"],
  ]],
  ["sm", "Vendas & Marketing", [
    ["pessoal_com", "Pessoal · comercial"], ["comissao", "Comissões"],
    ["midia", "Mídia paga (manual)"], ["mkt", "Ferramentas de marketing"],
  ]],
  ["rd", "Produto & Desenvolvimento", [
    ["pessoal_dev", "Pessoal · produto e dev"], ["dev", "Ferramentas de dev"],
  ]],
  ["ga", "Administrativo (G&A)", [
    ["prolabore", "Pró-labore"], ["pessoal_adm", "Pessoal · administrativo"],
    ["contab", "Contabilidade e jurídico"], ["escritorio", "Escritório e estrutura"],
    ["bancos", "Tarifas bancárias"], ["outros", "Outros"],
  ]],
];
export const SECTOR_LABEL = { deducoes: "Deduções da receita", cogs: "Custo do serviço", sm: "Vendas & Marketing", rd: "Produto & Desenvolvimento", ga: "Administrativo" };
export const PAY_CAT_LABEL = {
  ...Object.fromEntries(SECTOR_CATS.flatMap(([, , cats]) => cats)),
  ads: "Mídia paga (Meta, automático)", ia: "IA (APIs, automático)", wa: "WhatsApp (conversas, automático)",
  pessoal: "Pessoal (legado)", ferramenta: "Ferramentas (legado)", fixo: "Custos fixos (legado)",
  estrutura: "Estrutura (legado)", marketing: "Marketing (legado)",
};
export const catLabel = (id) => PAY_CAT_LABEL[id] || id || "—";

// Formatação de dinheiro do Financeiro: UMA (a aba Custos tinha a própria,
// com centavos e sem milhar; o resto usava o compacto "R$56,3k").
export const money = (v) => window.fmt.money(v || 0);
export const moneyFull = (v) => window.fmt.moneyFull(v || 0);

export const mesCurto = (mk) => new Date(`${mk}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
export const mesLongo = (mk) => {
  const [y, m] = String(mk).split("-");
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${names[Number(m) - 1] || m} de ${y}`;
};
export const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const shiftMonth = (mk, delta) => {
  const [y, m] = String(mk).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 15);
  return monthKeyOf(d);
};

// Contas da casa (Caixa por conta · payments/fin-accounts.js) e rótulo curto
// de "por onde saiu" numa conta a pagar (paidVia/paidAccount).
export const FIN_ACCOUNT_LABEL = { mp: "Mercado Pago", mp_reserva: "MP reserva", asaas: "Asaas", sicredi: "Sicredi", btg_cc: "BTG cc", btg_inv: "BTG inv" };
export const paidViaLabel = (p) => {
  if (!p?.paidVia) return "";
  if (p.paidVia === "mp") return p.autoMatched ? "baixada sozinha pela saída do MP" : "baixada pela saída do MP";
  if (p.paidVia === "bank") return `paga pelo ${FIN_ACCOUNT_LABEL[p.paidAccount] || "banco"}`;
  return `paga via ${FIN_ACCOUNT_LABEL[p.paidVia] || p.paidVia}`;
};
