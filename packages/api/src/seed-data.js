// Seed PADRÃO = instância limpa (vazia). É isto que sobe num deploy novo.
// Os dados reais entram pelos seus SaaS via API REST / MCP.
//
// Quer explorar com os dados de demonstração (3 SaaS fictícios)?  ->  npm run seed:demo
// Quer zerar tudo de novo?                                        ->  npm run seed:clear
//
// As CHAVES de COLLECTIONS precisam existir (criam as tabelas e habilitam o REST);
// só os arrays vêm vazios.

export const PORTFOLIO_CONST = {
  nrr: 1,
  mrrSeries30d: [],
};

export const COLLECTIONS = {
  products: [],
  attention: [],
  deals: [],
  people: [],
  customers: [],
  leads: [],
  nps: [],
  goals: [],
  leaderboard_month: [],
  leaderboard_all: [],
  forms: [],
  form_submissions: [],
  form_events: [],
  proposal_templates: [],
  proposals: [],
  plans: [],
  subscriptions: [],
  invoices: [],
  users: [],
  sessions: [],
  ad_insights: [],
  expenses: [],
  tasks: [],
  task_boards: [],
  activities: [],
  app_config: [], // chave-valor de integrações (ex.: google_oauth = refresh token da conta conectada)
  social_assets: [], // mídia pra publicação social (bytes base64, servida em /public/social/:id)
  social_posts: [],  // histórico de publicações orgânicas feitas pelo cockpit
  offers: [],        // links de pagamento das ofertas por produto (ferramenta)
  campaigns: [],     // disparos (e-mail + WhatsApp) pros leads qualificados por produto (ferramenta)
  flashcards: [],    // flashcards de treinamento por vaga (ferramenta)
  training_attempts: [], // tentativas do treino digitado (legado) — histórico preservado
  training_states: [],   // estado FSRS por usuário×produto (agendamento individual dos cards)
  training_reviews: [],  // log append-only de cada revisão (rating) — dashboard + otimização FSRS
};
