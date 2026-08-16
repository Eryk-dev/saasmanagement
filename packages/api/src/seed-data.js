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
  lp_events: [], // beacon anônimo das landing pages (view/cta por sessão de visita) — elo.js
  proposal_templates: [],
  proposals: [],
  plans: [],
  subscriptions: [],
  invoices: [],
  users: [],
  sessions: [],
  user_assets: [], // foto de perfil (base64, 1 por usuário, servida em /public/users/:id)
  ad_insights: [],
  expenses: [],
  payables: [],
  fin_rules: [],    // conciliação com aprendizado: pagador (doc/e-mail/nome) → ação (vincular cliente / desconsiderar) — aplicadas sozinhas a cada leitura do Financeiro (routes.fin.js)
  mp_movements: [], // SAÍDAS da conta Mercado Pago (saques/transferências) importadas do settlement report CSV — conciliadas com contas a pagar por valor+data (routes.fin.js) // contas a pagar do Financeiro (modelo Conta Azul): competência, vencimento, situação, favorecido colaborador/fornecedor; recorrente materializa instância por mês (routes.fin.js)
  tasks: [],
  task_boards: [],
  activities: [],
  activity_assets: [], // foto anexada a um toque da timeline (base64, servida em /public/activities/:id)
  task_assets: [],   // foto anexada a uma tarefa do kanban (base64, servida em /public/tasks/:id; URL no task.photo)
  agenda_blocks: [], // bloqueios de agenda (tela Agenda): horários que o closer/CS trava p/ compromisso externo — { user, recur, date/weekday, allDay, fromHour, toHour, reason }
  mindmaps: [], // mapas mentais / estratégia (tela Mapas mentais): { name, nodes[], links[] }
  app_config: [], // chave-valor de integrações (ex.: google_oauth = refresh token da conta conectada)
  social_assets: [], // mídia pra publicação social (bytes base64, servida em /public/social/:id)
  social_posts: [],  // histórico de publicações orgânicas feitas pelo cockpit
  social_comments: [], // comentários de IG/página do FB: fila e respostas (social-comments.js)
  social_stories: [],  // stories capturados enquanto vivos (24h) com métricas (social-stories.js)
  wa_threads: [],    // inbox de WhatsApp: índice de conversas, 1 por número (wa-store.js)
  wa_messages: [],   // inbox de WhatsApp: TODAS as mensagens in/out (wa-store.js)
  wa_alerts: [],     // alertas quentes do fluxo de ligação: lead respondeu → pop-up pro SDR (wa-call-flow.js)
  wa_calls: [],      // ligações pelo WhatsApp direto do cockpit (Calling API): estado da chamada + SDP answer do webhook + log (routes.whatsapp.js)
  wa_media: [],      // cache do binário de mídia recebida (áudio/imagem/…) em base64: o id da Meta expira, então baixa 1x e guarda (routes.whatsapp.js)
  wa_template_media: [], // foto PADRÃO por template (header de imagem): id = nome do template, binário em base64 — o composer preenche sozinho e o envio sobe pra Meta a cada disparo (routes.whatsapp.js)
  wa_automations: [], // automações do Inbox: regras reativas gatilho → resposta automática na mensagem recebida (wa-automations.js)
  wa_flows: [],      // fluxos de conversa do Inbox (construtor): gatilho + passos com espera de resposta e ramificação (wa-flows.js)
  offers: [],        // links de pagamento das ofertas por produto (ferramenta)
  contracts: [],     // modelos de contrato por produto (tela Contratos): { name, tag, note, body (HTML do miolo, imprime com o CSS padrão da tela) }
  contract_issues: [], // contratos CONFIRMADOS (histórico da tela Contratos): snapshot do modelo preenchido por cliente — { saas, contract, name, tag, customerId, customerName, values, fields, body, author, createdAt }
  mp_payments: [],   // espelho dos pagamentos do Mercado Pago (financeiro): quem pagou, como, casado com qual cliente/fatura (mp-payments.js)
  mp_preapprovals: [], // espelho das ASSINATURAS RECORRENTES do Mercado Pago (inclusive as criadas fora do cockpit), com o vínculo à assinatura do cliente (mp-subscriptions.js)
  campaigns: [],     // disparos (e-mail + WhatsApp) pros leads qualificados por produto (ferramenta)
  outbound_accounts: [], // radar de contas do outbound (Cold Calling 2.0): conta-alvo com os 8 status do livro; virar lead cria card classe Alvo
  comp_plans: [],    // planos de remuneração por cargo (tela Remuneração, SÓ admin): fixo, variável e regras — 1 doc por role
  sequences: [],     // sequências de nutrição (drip): passos por canal + gatilho por etapa
  sequence_enrollments: [], // progresso de cada lead numa sequência (stepIndex, nextRunAt, status)
  drip_templates: [], // conteúdo reutilizável (e-mail/WhatsApp) pros passos das sequências
  flashcards: [],    // flashcards de treinamento por vaga (ferramenta)
  training_attempts: [], // tentativas do treino digitado (legado) — histórico preservado
  training_states: [],   // estado FSRS por usuário×produto (agendamento individual dos cards)
  training_reviews: [],  // log append-only de cada revisão (rating) — dashboard + otimização FSRS
  training_assets: [],   // imagens dos flashcards (base64, servidas em /public/training/:id)
  training_exams: [],    // provas de checkpoint (a cada N cards graduados) com nota por pessoa
  consultations: [],     // consultas 1:1 da mentoria (UniqueKids, 8 encontros): agenda + Meet + resumo IA (consultations.js)
  deliverables: [],      // Manual da Família (entregável final da mentoria): 1 por cliente, seções moduladas pelas consultas (deliverables.js)
};
