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
  agenda_blocks: [], // bloqueios de agenda (tela Agenda): horários que o closer/CS trava p/ compromisso externo — { user, recur, date/weekday, allDay, fromHour, toHour, reason }
  mindmaps: [], // mapas mentais / estratégia (tela Mapas mentais): { name, nodes[], links[] }
  app_config: [], // chave-valor de integrações (ex.: google_oauth = refresh token da conta conectada)
  social_assets: [], // mídia pra publicação social (bytes base64, servida em /public/social/:id)
  social_posts: [],  // histórico de publicações orgânicas feitas pelo cockpit
  wa_threads: [],    // inbox de WhatsApp: índice de conversas, 1 por número (wa-store.js)
  wa_messages: [],   // inbox de WhatsApp: TODAS as mensagens in/out (wa-store.js)
  offers: [],        // links de pagamento das ofertas por produto (ferramenta)
  campaigns: [],     // disparos (e-mail + WhatsApp) pros leads qualificados por produto (ferramenta)
  sequences: [],     // sequências de nutrição (drip): passos por canal + gatilho por etapa
  sequence_enrollments: [], // progresso de cada lead numa sequência (stepIndex, nextRunAt, status)
  drip_templates: [], // conteúdo reutilizável (e-mail/WhatsApp) pros passos das sequências
  flashcards: [],    // flashcards de treinamento por vaga (ferramenta)
  training_attempts: [], // tentativas do treino digitado (legado) — histórico preservado
  training_states: [],   // estado FSRS por usuário×produto (agendamento individual dos cards)
  training_reviews: [],  // log append-only de cada revisão (rating) — dashboard + otimização FSRS
  training_assets: [],   // imagens dos flashcards (base64, servidas em /public/training/:id)
  training_exams: [],    // provas de checkpoint (a cada N cards graduados) com nota por pessoa
};
