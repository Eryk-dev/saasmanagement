// Perguntas de qualificação do pipeline LeverAds.
// As CHAVES (key) e os VALORES (value) das opções precisam casar EXATAMENTE com o
// que o copylever espera em POST /api/proposta/generate (DiagnosticoIn + compute_score):
//   accounts: "1"|"2"|"3-5"|"6-10"|"10+"   staff: "0"|"1"|"2-3"|"4+"
//   volume: "0-10"|"10-50"|"50-200"|"200+" marketplaces: ["ml"|"shopee"|"amazon"|"magalu"|"shopify"]
//   niche: "autopecas"|"eletronicos"|"moda"|"casa"|"beleza"|"outros"
//   plan_expand: "sim-3m"|"sim-6m"|"talvez"|"nao"   thesis: "dinheiro"
// Por isso o editor do cockpit TRAVA o `key` no produto leverads (ver QuestionsEditor).
export const LEVERADS_LEAD_QUESTIONS = [
  {
    key: "accounts", label: "Quantas contas de marketplace você opera?", type: "select", required: true,
    options: [
      { value: "1", label: "1 conta" },
      { value: "2", label: "2 contas" },
      { value: "3-5", label: "3 a 5 contas" },
      { value: "6-10", label: "6 a 10 contas" },
      { value: "10+", label: "Mais de 10 contas" },
    ],
  },
  {
    // Volume total publicado na maior conta — mede o custo da replicação manual.
    key: "listings", label: "Quantos anúncios publicados na maior conta?", type: "select", required: true,
    options: [
      { value: "0-100", label: "Até 100" },
      { value: "100-500", label: "100 a 500" },
      { value: "500-2000", label: "500 a 2 mil" },
      { value: "2000+", label: "Mais de 2 mil" },
    ],
  },
  {
    // Faixa de faturamento mensal — "nao-informar" existe de propósito: responder
    // é obrigatório, mas informar não é (reduz abandono na pergunta sensível).
    key: "revenue", label: "Faixa de faturamento mensal", type: "select", required: true,
    options: [
      { value: "0-50k", label: "Até R$ 50 mil" },
      { value: "50-200k", label: "R$ 50 a 200 mil" },
      { value: "200k-1m", label: "R$ 200 mil a 1 milhão" },
      { value: "1m+", label: "Mais de R$ 1 milhão" },
      { value: "nao-informar", label: "Prefiro não informar" },
    ],
  },
  {
    key: "staff", label: "Quantas pessoas no time de marketplace?", type: "select", required: true,
    options: [
      { value: "0", label: "Nenhuma (só eu)" },
      { value: "1", label: "1 pessoa" },
      { value: "2-3", label: "2 a 3 pessoas" },
      { value: "4+", label: "4 ou mais" },
    ],
  },
  {
    key: "volume", label: "Quantos anúncios novos por semana?", type: "select", required: true,
    options: [
      { value: "0-10", label: "Até 10" },
      { value: "10-50", label: "10 a 50" },
      { value: "50-200", label: "50 a 200" },
      { value: "200+", label: "Mais de 200" },
    ],
  },
  {
    key: "marketplaces", label: "Em quais marketplaces você vende?", type: "multiselect", required: true,
    options: [
      { value: "ml", label: "Mercado Livre" },
      { value: "shopee", label: "Shopee" },
      { value: "amazon", label: "Amazon" },
      { value: "magalu", label: "Magalu" },
      { value: "shopify", label: "Shopify / loja própria" },
    ],
  },
  {
    key: "niche", label: "Qual seu principal nicho?", type: "select", required: true,
    options: [
      { value: "autopecas", label: "Autopeças" },
      { value: "eletronicos", label: "Eletrônicos" },
      { value: "moda", label: "Moda" },
      { value: "casa", label: "Casa & Decoração" },
      { value: "beleza", label: "Beleza" },
      { value: "outros", label: "Outros" },
    ],
  },
  {
    key: "plan_expand", label: "Pretende abrir mais contas?", type: "select", required: false,
    options: [
      { value: "sim-3m", label: "Sim, nos próximos 3 meses" },
      { value: "sim-6m", label: "Sim, nos próximos 6 meses" },
      { value: "talvez", label: "Talvez" },
      { value: "nao", label: "Não" },
    ],
  },
  {
    key: "thesis", label: "Principal objetivo", type: "select", required: false,
    options: [
      { value: "dinheiro", label: "Recuperar o caixa que o operacional queima" },
    ],
  },
];
