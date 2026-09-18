// Dados fictícios para /?shell=1&finance=1#expenses, sem API ou banco.
export function financeMock(saas, month) {
  const params = new URLSearchParams(location.search);
  const empty = saas !== "leverads" || params.has("empty");
  // financeCase=deficit|no-income|no-expenses cobre os limites da pizza.
  const scenario = params.get("financeCase");
  const ratio = empty ? 0 : Number(month.slice(5)) === 9 ? 1 : 0.6;
  const amount = (value) => Math.round(value * ratio);
  const expense = (value) => scenario === "no-expenses" ? 0 : amount(value);
  const received = scenario === "no-income" ? 0 : amount(scenario === "deficit" ? 80000 : 195900);
  const count = (n, total) => ({ n: empty ? 0 : n, total: amount(total) });
  const setores = {
    deducoes: { imposto: expense(39200) },
    cogs: { taxas: expense(15100), suporte: expense(5000) },
    sm: { ads: expense(23500), pessoal_com: expense(13000) },
    rd: {}, ga: { ferramenta: expense(6600), fixo: expense(1500) },
  };
  return {
    month,
    tiles: { vencidos: count(0, 0), vencemHoje: count(0, 0), aVencer: count(0, 0) },
    receber: { recebidosMes: received, emAberto: count(18, 128500), vencidas: count(8, 37000) },
    conciliacao: { pendentes: count(83, 720000), espelhoMes: amount(508900) },
    fluxo: [4, 5, 6, 7, 8, 9].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}`, entrada: amount(m < 7 ? 0 : m * 22000), saida: amount(m < 7 ? 600 : m * 11500) })),
    previsto: { entrada: amount(24500), saida: amount(85900) },
    dre: { receita: { renewal: received }, setores, despesasMes: expense(103900) },
  };
}
