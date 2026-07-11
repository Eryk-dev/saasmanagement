// Perguntas de qualificação do pipeline LeverAds.
// As CHAVES (key) e os VALORES (value) das opções precisam casar EXATAMENTE com o
// que o copylever espera em POST /api/proposta/generate (DiagnosticoIn + compute_score):
//   accounts: "1"|"2"|"3-5"|"6-10"|"10+"
//   niche: "autopecas"|"eletronicos"|"moda"|"casa"|"beleza"|"outros"
//   plan_expand: "sim-3m"|"sim-6m"|"talvez"|"nao"
// Por isso o editor do cockpit TRAVA o `key` no produto leverads (ver QuestionsEditor).
// staff/volume/marketplaces/thesis/revenue saíram do form fo_diagnostico_leverads (jul/2026)
// e foram removidos daqui; DiagnosticoIn é todo opcional e a calculadora tem fallback.
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
      { value: "2000-10000", label: "2 a 10 mil" },
      { value: "10000+", label: "Mais de 10 mil" },
    ],
  },
  {
    // allowCustom: no formulário de lead do cockpit, "Outro (digitar)…" abre um
    // campo de texto e grava o nicho específico direto em lead.niche.
    key: "niche", label: "Qual seu principal nicho?", type: "select", required: true, allowCustom: true,
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
];
