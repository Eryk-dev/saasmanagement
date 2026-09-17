// Dados fictícios para /?shell=1&finance=1#expenses, sem API ou banco.
export function financeMock(saas, month) {
  const empty = saas !== "leverads" || new URLSearchParams(location.search).has("empty");
  const ratio = empty ? 0 : Number(month.slice(5)) === 9 ? 1 : 0.6;
  const amount = (value) => Math.round(value * ratio);
  const count = (n, total) => ({ n: empty ? 0 : n, total: amount(total) });
  const setores = {
    deducoes: { imposto: amount(39200) },
    cogs: { taxas: amount(15100), suporte: amount(5000) },
    sm: { ads: amount(23500), pessoal_com: amount(13000) },
    rd: {}, ga: { ferramenta: amount(6600), fixo: amount(1500) },
  };
  return {
    month,
    tiles: { vencidos: count(0, 0), vencemHoje: count(0, 0), aVencer: count(0, 0) },
    receber: { recebidosMes: amount(195900), emAberto: count(18, 128500), vencidas: count(8, 37000) },
    conciliacao: { pendentes: count(83, 720000), espelhoMes: amount(508900) },
    fluxo: [4, 5, 6, 7, 8, 9].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}`, entrada: amount(m < 7 ? 0 : m * 22000), saida: amount(m < 7 ? 600 : m * 11500) })),
    previsto: { entrada: amount(24500), saida: amount(85900) },
    dre: { receita: { renewal: amount(160900), upsell: amount(25000), installment: amount(10000) }, setores, despesasMes: amount(103900) },
  };
}
