// Dados fictícios para /?shell=1&finance=1#expenses, sem API ou banco.
// Shape do GET /api/fin de 12/10/2026 (régua única de caixa: recebido ×
// PRESUMIDO, espelho do MP classificado, saídas sem dono, DRE do servidor).
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
    rd: {}, ga: { escritorio: expense(1500), contab: expense(900) },
  };
  const soma = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  const deducoes = soma(setores.deducoes), cogs = soma(setores.cogs), sm = soma(setores.sm), rd = soma(setores.rd), ga = soma(setores.ga);
  const despesasMes = deducoes + cogs + sm + rd + ga;
  const receitaLiquida = received - deducoes, lucroBruto = receitaLiquida - cogs;
  const presumidoItems = empty ? [] : [
    { id: "in_p1", customer: "c1", customerName: "Oficina do Zé", amount: 5964, paidAt: `${month}-03T12:00:00.000Z`, kind: "renewal" },
    { id: "in_p2", customer: "c2", customerName: "JR Imports", amount: 15978, paidAt: `${month}-05T12:00:00.000Z`, kind: "renewal" },
    { id: "in_p3", customer: "c3", customerName: "StoreCase", amount: 1490, paidAt: `${month}-09T12:00:00.000Z`, kind: "manual" },
  ];
  const presumidoTotal = presumidoItems.reduce((a, i) => a + i.amount, 0);
  const saidas = empty ? [] : [
    { id: "mov_1", source: "settlement", type: "WITHDRAWAL", at: `${month}-06`, amount: 3000, fee: 0, description: "" },
    { id: "mpp_darf", source: "mp", type: "account_money", at: `${month}-18T12:00:00.000Z`, amount: 204.13, fee: 0, description: "DARF - CÓDIGO DE BARRA" },
  ];
  return {
    month, today: new Date().toISOString().slice(0, 10),
    payables: empty ? [] : [
      { id: "pay_t1", saas, description: "Salário", category: "pessoal_com", counterpartyType: "colaborador", userId: "sdr", amount: 5000, month, dueDate: `${month}-05`, status: "paga", paidAt: `${month}-05T12:00:00.000Z`, paidVia: "mp", recurring: false, templateId: "t1" },
      { id: "pay_t2", saas, description: "Contabilidade", category: "contab", counterpartyType: "fornecedor", supplierName: "Contador", amount: 900, month, dueDate: `${month}-20`, status: "aberta", recurring: true },
    ],
    payablesMissing: 0,
    tiles: { vencidos: count(0, 0), vencemHoje: count(0, 0), aVencer: count(1, 900), pagos: count(1, 5000) },
    receber: {
      recebidosMes: received,
      presumido: { mes: { n: presumidoItems.length, total: presumidoTotal }, n: presumidoItems.length, total: presumidoTotal, items: presumidoItems },
      emAberto: count(18, 128500), vencidas: count(8, 37000),
    },
    conciliacao: {
      pendentes: count(6, 42350), espelhoMes: amount(208900), taxasMes: amount(15100),
      internas: count(9, 366594), saidasMp: count(1, 204.13), ruido: count(2, 1230),
      heuristicas: empty ? 0 : 4, ignoradas: 1, regras: 2, regrasPendentes: 1,
      sugestoes: { mpp_s1: { customer: "c1", invoiceId: "in_1", motivo: "fatura aberta de Oficina do Zé com o mesmo valor" } },
      saidasPendentes: { n: saidas.length, total: saidas.reduce((a, s) => a + s.amount, 0), items: saidas },
    },
    fluxo: [4, 5, 6, 7, 8, 9].map((m) => ({ month: `2026-${String(m).padStart(2, "0")}`, entrada: amount(m < 7 ? 0 : m * 22000), saida: amount(m < 7 ? 600 : m * 11500), saidasSemDono: amount(m === 9 ? 3204.13 : 0) })),
    previsto: { entrada: amount(24500), saida: amount(85900) },
    dre: {
      receita: { renewal: Math.round(received * 0.7), installment: Math.round(received * 0.2), mp: received - Math.round(received * 0.7) - Math.round(received * 0.2) },
      receitaTotal: received, setores, deducoes, receitaLiquida, cogs, lucroBruto,
      margemBruta: received > 0 ? Math.round((lucroBruto / received) * 1000) / 1000 : null,
      sm, rd, ga, despesasMes, resultado: received - despesasMes,
    },
  };
}

// Espelho do MP classificado (GET /api/mp/payments) pro preview.
export function financeMpPayments(saas, month = new Date().toISOString().slice(0, 7)) {
  const d = (day, h = "12") => `${month}-${String(day).padStart(2, "0")}T${h}:00:00.000Z`;
  const rows = [
    { id: "mpp_s1", mpId: "s1", status: "approved", kind: "venda", kindSource: "api", amount: 5964, netAmount: 5325.26, feeAmount: 638.74, method: "master", methodType: "credit_card", installments: 12, payerName: "Alexandre C Souza", payerEmail: "xpoint@gmail.com", payerDoc: "34231275000158", description: "Ads Essencial + OEM · Plano Anual", dateApproved: d(9), dateCreated: d(9), customer: "", lead: "" },
    { id: "mpp_s2", mpId: "s2", status: "approved", kind: "venda", kindSource: "heuristic", amount: 10000, netAmount: 10000, feeAmount: 0, method: "pix", methodType: "bank_transfer", payerName: "", payerEmail: "", payerDoc: "", payerDocMp: true, description: "", dateApproved: d(3), dateCreated: d(3), customer: "", lead: "" },
    { id: "mpp_v3", mpId: "v3", status: "approved", kind: "venda", kindSource: "api", amount: 15528, netAmount: 13900, feeAmount: 1628, method: "visa", methodType: "credit_card", installments: 12, payerName: "Juan C Ortiz", payerEmail: "juan@gmail.com", description: "LeverAds Essencial + LeverPrice", dateApproved: d(22), dateCreated: d(22), customer: "c2", matchedBy: "reference", invoice: "in_9" },
    { id: "mpp_m1", mpId: "m1", status: "approved", kind: "maquininha", kindSource: "api", amount: 18000, netAmount: 17200, feeAmount: 800, method: "master", methodType: "credit_card", installments: 12, payerName: "cardholder_name", payerEmail: "ventapresencialmlb@gmail.com", description: "Venda presencial", dateApproved: d(10), dateCreated: d(10), customer: "", lead: "" },
    { id: "mpp_i1", mpId: "i1", status: "approved", kind: "interna", kindSource: "api", amount: 119056.53, netAmount: 119056.53, method: "account_money", methodType: "account_money", payerName: "", payerEmail: "lever@netair.com.br", payerDoc: "67931740000112", description: "", externalReference: "POTS_bb54966e_1288061581_1_0", dateApproved: d(10), dateCreated: d(10) },
    { id: "mpp_i2", mpId: "i2", status: "approved", kind: "interna", kindSource: "api", amount: 50000, netAmount: 50000, method: "account_money", methodType: "account_money", payerEmail: "lever@netair.com.br", payerDoc: "67931740000112", externalReference: "POTS_bb54966e_1302081442_1_0", dateApproved: d(14), dateCreated: d(14) },
    { id: "mpp_darf", mpId: "darf", status: "approved", kind: "saida", kindSource: "api", amount: 204.13, method: "account_money", methodType: "account_money", description: "DARF - CÓDIGO DE BARRA", dateApproved: d(18), dateCreated: d(18) },
    { id: "mpp_oai", mpId: "oai", status: "approved", kind: "saida", kindSource: "heuristic", amount: 196.07, method: "account_money", methodType: "account_money", description: "Openai *chatgpt subscr", dateApproved: d(6), dateCreated: d(6), finIgnored: true, finIgnoredReason: "saída da conta" },
    { id: "mpp_r1", mpId: "r1", status: "approved", kind: "ruido", kindSource: "api", amount: 249.9, method: "account_money", methodType: "account_money", payerEmail: "mlb_cashbacks_point_negocio@mercadolibre.com", description: "", dateApproved: d(23), dateCreated: d(23) },
    { id: "mpp_rej", mpId: "rej", status: "rejected", kind: "venda", kindSource: "api", amount: 5400, method: "visa", methodType: "credit_card", payerName: "Igor Garcia", payerEmail: "igor@gmail.com", description: "Lever Price · Essencial", dateApproved: "", dateCreated: d(28), customer: "c3", matchedBy: "email" },
  ];
  return { payments: rows.map((p) => ({ saas, ...p })), sync: { lastAt: new Date(Date.now() - 7 * 60000).toISOString(), lastSeen: 12 }, configured: true };
}

export const financeRules = (saas) => [
  { id: "r1", saas, matchField: "payerEmail", matchValue: "zfemercadolivre@gmail.com", action: "vincular", customer: "c1", autoCount: 3 },
  { id: "r2", saas, matchField: "payerName", matchValue: "venda presencial", action: "desconsiderar", reason: "teste", autoCount: 0 },
];
