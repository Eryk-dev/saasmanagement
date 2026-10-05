// Orquestrador das rotas REST: monta os clientes compartilhados (IA, Meta,
// Mercado Pago, Google, WhatsApp, mailer) e registra as rotas de cada domínio
// na ordem em que dependem desses clientes. As rotas moram nas pastas de domínio.

import { repo as defaultRepo } from "./platform/db.js";
import { registerSystemRoutes } from "./platform/routes.system.js";
import { registerBootstrapRoutes } from "./crm/routes.bootstrap.js";
import { registerActivityAssetRoutes } from "./crm/routes.activities.js";
import { registerCrudRoutes } from "./crm/routes.crud.js";
import { registerFunnelRoutes } from "./crm/routes.funnel.js";
import { registerFeedbackRoutes } from "./tasks/routes.feedback.js";
import { registerLeadProposalRoutes } from "./proposals/routes.lead-proposals.js";
import { registerFormRoutes } from "./forms/routes.forms.js";
import { registerWebhookRoutes } from "./marketing/routes.webhooks.js";
import { registerProposalRoutes } from "./proposals/routes.proposals.js";
import { registerBillingRoutes } from "./billing/routes.billing.js";
import { registerAuthRoutes } from "./auth/auth.js";
import { registerMpRoutes } from "./payments/routes.mp.js";
import { registerLeveradsAccessRoutes } from "./billing/leverads-access.js";
import { mp as defaultMpClient } from "./payments/mp.js";
import { registerMarketingRoutes } from "./marketing/routes.marketing.js";
import { registerAdDeliveryRoutes } from "./marketing/ad-delivery.js";
import { registerSocialRoutes } from "./marketing/routes.social.js";
import { registerOfferRoutes } from "./payments/routes.offers.js";
import { registerCampaignRoutes } from "./marketing/routes.disparos.js";
import { registerSequenceRoutes } from "./marketing/routes.sequences.js";
import { registerPitchRoutes } from "./calls/routes.pitch.js";
import { registerBlogPublicRoutes } from "./blog/routes.blog-public.js";
import { registerBlogRoutes } from "./blog/routes.blog.js";
import { makeBlogEngine } from "./blog/blog-engine.js";
import { registerRoutineRoutes } from "./tasks/routes.routine.js";
import { registerConsultationRoutes } from "./calls/routes.consultations.js";
import { registerIntegrationRoutes } from "./customers/routes.integrations.js";
import { registerIntegrationFormRoutes } from "./forms/routes.integration-forms.js";
import { registerMetasRoutes } from "./metrics/routes.metas.js";
import { registerFlashcardRoutes } from "./training/routes.flashcards.js";
import { registerGoogleRoutes } from "./google/routes.google.js";
import { registerCopilotRoutes } from "./calls/copilot.js";
import { registerWhatsappRoutes } from "./whatsapp/routes.whatsapp.js";
import { registerSdrRoutes } from "./sdr/routes.sdr.js";
import { makeSdrBrain } from "./sdr/sdr-brain.js";
import { makeSalesWhatsapp } from "./sdr/sales-whatsapp.js";
import { makeMailer } from "./integrations/mailer.js";
import { makeAnthropic } from "./integrations/anthropic.js";
import { registerMetricsRoutes } from "./metrics/routes.metrics.js";
import { registerFinRoutes } from "./payments/routes.fin.js";
import { meta as defaultMetaClient } from "./marketing/meta.js";
import { metaCapi as defaultMetaCapi } from "./marketing/meta-capi.js";
import { discord as defaultDiscord } from "./integrations/discord.js";
import { registerFollowupConfigRoutes } from "./crm/followup-config.js";
import { registerFunnelMetricsRoutes } from "./metrics/routes.funnel-metrics.js";
import { registerScoreboardRoutes } from "./metrics/routes.scoreboard.js";
import { registerReferralRoutes } from "./customers/routes.referrals.js";
import { registerNpsRoutes } from "./customers/routes.nps.js";
import { registerCustomerResultsRoutes } from "./customers/routes.customer-results.js";
import { registerCaseRoutes } from "./proposals/routes.cases.js";
import { registerCompRoutes } from "./comp/routes.comp.js";
import { registerDesempenhoRoutes } from "./metrics/routes.desempenho.js";
import { registerPipelinePaceRoutes } from "./metrics/routes.pipeline-pace.js";
import { registerEloRoutes } from "./forms/elo.js";
import { registerTaskRoutes } from "./tasks/routes.tasks.js";
import { registerTicketRoutes } from "./support/routes.tickets.js";
import { registerSupportPortalRoutes } from "./support/routes.support-portal.js";
import { publicBase } from "./platform/request.js";

export function registerRoutes(app, repo = defaultRepo, opts = {}) {
  // Health, tempo real (SSE) e documentação OpenAPI.
  registerSystemRoutes(app, repo);

  // Avisos do funil num canal Discord (webhook único, fail-open) — injetado nas
  // superfícies que geram eventos: forms (lead), proposals (vista/aceite),
  // billing (baixa manual/dunning) e MP (pagamento/assinatura).
  const discordClient = opts.discord || defaultDiscord;
  // Meta CAPI: "Lead" server-side, deduplicado com o Pixel client-side da página
  // pública do form (/f/:id) via event_id compartilhado.
  const metaCapiClient = opts.metaCapi || defaultMetaCapi;
  // IA (resumo de call + variante de welcome): OpenRouter ou Anthropic direto,
  // detectado pela chave. Criado ANTES das rotas de form (suggest-welcome usa).
  const anthropicClient = opts.anthropic || makeAnthropic({
    apiKey: process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    model: process.env.AI_MODEL || process.env.ANTHROPIC_MODEL || "",
  });
  // Superfície pública do form builder (/public/forms, /f/:id, /embed.js).
  // `salesWhatsapp` resolve o número CONECTADO na Cloud API pro botão/redirect
  // de WhatsApp do form (getter preguiçoso: o cliente nasce mais abaixo, e a
  // função só é chamada em request; cache de 1h mora no makeSalesWhatsapp).
  let whatsappClient = null;
  const salesWhatsapp = makeSalesWhatsapp(() => whatsappClient);
  const metaClient = opts.meta || defaultMetaClient;
  registerFormRoutes(app, repo, { ...(opts.forms || {}), discord: discordClient, metaCapi: metaCapiClient, meta: metaClient, anthropic: anthropicClient, salesWhatsapp });
  // Webhooks de entrada (Shopify da UniqueKids → lead pra Ana). Rota aberta,
  // autenticada por assinatura HMAC da Shopify (ver routes.webhooks.js).
  registerWebhookRoutes(app, repo, { ...(opts.linear ? { linear: opts.linear } : {}), ...(opts.webhooks || {}) });
  // Superfície pública do proposal builder (/p/:id, aceite, painel do closer).
  registerProposalRoutes(app, repo, { ...(opts.proposals || {}), discord: discordClient, metaCapi: metaCapiClient });
  // Billing (fase 5): mudança de plano c/ pró-rata, baixa de fatura, tick do motor.
  const mpClient = opts.mp || defaultMpClient;
  registerBillingRoutes(app, repo, { mp: mpClient, discord: discordClient });
  // Mercado Pago (fase 4): link de assinatura + webhook de baixa automática.
  registerMpRoutes(app, repo, { mp: mpClient, discord: discordClient });
  // LeverAds: liga/corta o paywall das orgs do produto conforme o billing daqui
  // (tick manual + report do dry-run; o poller vive no index.js).
  registerLeveradsAccessRoutes(app, repo, { ...(opts.leveradsAccess || {}) });
  // Marketing: sync de insights da Meta + métricas cruzadas com o funil.
  registerMarketingRoutes(app, repo, { meta: metaClient });
  // Regras de veiculação (agenda cheia pausa, janela de fim de semana, sexta
  // curta, orçamento alvo) — config/estado/log + tick manual; poller no index.js.
  registerAdDeliveryRoutes(app, repo, { meta: metaClient });
  // Follow-up em 4 contatos: mensagens e prazos globais (Configurações).
  registerFollowupConfigRoutes(app, repo);
  // Mídia social: métricas do perfil + publicação orgânica (IG/página FB) +
  // copy do post por IA (mesma chave OpenRouter/Anthropic do resto).
  registerSocialRoutes(app, repo, { social: opts.social, meta: metaClient, anthropic: anthropicClient });
  // Links de pagamento das ofertas (ferramenta).
  registerOfferRoutes(app, repo);
  // Insight de pitch: melhora o roteiro de venda a partir dos resumos das calls.
  registerPitchRoutes(app, repo, { anthropic: anthropicClient });
  // Blog público (leverads.com.br/blog via proxy do copylever): índice, post,
  // categoria, sitemap, feed e preview assinado. Sem chave (OPEN_PREFIXES).
  registerBlogPublicRoutes(app, repo, opts.blogPublic || {});
  // Redação do blog: motor único (pautas → rascunho por IA → agenda → publica),
  // compartilhado pelas rotas e pelo poller do index.js (integrationClients.blogEngine).
  const blogEngine = opts.blogEngine || makeBlogEngine({ repo, anthropic: anthropicClient, log: app.log });
  registerBlogRoutes(app, repo, { anthropic: anthropicClient, engine: blogEngine, publicBase });
  // UniqueKids · sugestão de solução da rotina por IA (método R.O.T.I.N.A) no lead.
  registerRoutineRoutes(app, repo, { anthropic: anthropicClient });
  // Análise de integração (CS/onboarding): sentimento + pendências recorrentes.
  registerIntegrationRoutes(app, repo);
  // Formulário de Integração: página pública que o cliente recém-fechado
  // preenche (/fi/:id) + envio das respostas. O CRUD do pedido é o genérico.
  registerIntegrationFormRoutes(app, repo, { ...(opts.integrationForms || {}), discord: discordClient });
  // Metas de desempenho por vaga/pessoa (ferramenta; escreve na collection goals).
  registerMetasRoutes(app, repo);
  // Treinamentos: flashcards por vaga com repetição espaçada (FSRS) por pessoa
  // + prova de checkpoint (a IA corrige as questões digitadas).
  registerFlashcardRoutes(app, repo, { anthropic: anthropicClient });
  // getWhatsapp é getter: o client só nasce mais abaixo (registerWhatsappRoutes)
  // e o custo de WhatsApp do resumo de despesas resolve na hora do request.
  registerMetricsRoutes(app, repo, { getWhatsapp: () => whatsappClient });
  registerFinRoutes(app, repo, { mp: mpClient });
  // Métricas reais de funil (conversão/tempo por estágio, motivos de perda, SLA)
  // a partir do histórico de transições da timeline.
  registerFunnelMetricsRoutes(app, repo);
  // Pace de caixa do pipeline: recebido no mês → meta diária por papel.
  registerPipelinePaceRoutes(app, repo, opts.pipelinePace);
  // Placar por pessoa/papel (SDR/closer/CS) — o cockpit de gestão da Visão geral.
  registerScoreboardRoutes(app, repo, opts.scoreboard);
  registerReferralRoutes(app, repo, opts.referrals);
  // Análise de Desempenho: objeções por closer na janela, produção do social e
  // os registros manuais do dia (social selling / criativos).
  registerDesempenhoRoutes(app, repo, { social: opts.social, now: opts.scoreboard?.now, ...(opts.desempenho || {}) });
  // Análises do Elo App (produto B2C): agregados do banco do app + beacon
  // público das landing pages (/public/lp/events) e resumo de conversão.
  registerEloRoutes(app, repo, opts.elo);
  // Usuários do time: login/logout/me + gestão mínima (rotas dedicadas).
  registerAuthRoutes(app, repo);
  // Google Meet: conectar conta (OAuth) + criar call na agenda do closer.
  // Claude resume as calls (transcrição → timeline) quando há ANTHROPIC_API_KEY.
  const { client: googleClient, googleUser, briefer, autoIntegrationMeet, cancelIntegrationMeet, autoCallMeet, moveCallMeet, cancelCallMeet } = registerGoogleRoutes(app, repo, { google: opts.google, googleUser: opts.googleUser, anthropic: anthropicClient });
  // Consultas 1:1 + Manual da Família (UniqueKids): Meet da consulta, resumo IA,
  // compor manual e página pública /m/:id. Depois do Google (usa os 2 clients).
  registerConsultationRoutes(app, repo, { google: googleClient, googleUser, anthropic: anthropicClient });
  // Mailer (e-mail dos disparos/sequências): hoje envia pela conta Google conectada.
  const mailerClient = opts.mailer || makeMailer({ google: googleClient });
  // Disparos: campanhas de e-mail + WhatsApp pros leads qualificados (ferramenta).
  // Registrado DEPOIS do googleClient/mailer porque o envio nativo de e-mail
  // (send-email) e o gate de gmail dependem deles.
  registerCampaignRoutes(app, repo, { anthropic: anthropicClient, google: googleClient, mailer: mailerClient });
  // Sequências de nutrição (drip): rotas de inscrição/avanço/métricas + tick manual.
  registerSequenceRoutes(app, repo, { mailer: mailerClient });
  // WhatsApp (Cloud API): webhook (recebe) + envio pelo drawer do lead. O SDR
  // conversa com o cliente direto no cockpit; as mensagens viram timeline.
  // O cérebro conversacional (Fase 2) nasce DEPOIS do client de WhatsApp; o
  // webhook o alcança por getter preguiçoso (mesmo desenho do salesWhatsapp).
  let sdrBrain = null;
  whatsappClient = registerWhatsappRoutes(app, repo, { whatsapp: opts.whatsapp, anthropic: anthropicClient, transcriber: opts.transcriber, getSdrBrain: () => sdrBrain });
  // Copiloto da call: transcrição ao vivo (áudio da aba do Meet + mic, via
  // browser) + cues da IA sobre o roteiro. Rotas sob /api/leads → guard do
  // pipeline já cobre.
  registerCopilotRoutes(app, repo, { transcriber: opts.transcriber, anthropic: anthropicClient });
  sdrBrain = opts.sdrBrain || makeSdrBrain({ repo, whatsapp: whatsappClient, anthropic: anthropicClient, autoCallMeet, cancelCallMeet, log: app.log });
  // SDR automatizado: horários livres no servidor + templates + status +
  // bateria de replay (o motor determinístico é o poller startSdrFlow do
  // index.js, com o MESMO client).
  registerSdrRoutes(app, repo, { whatsapp: whatsappClient, anthropic: anthropicClient });
  // Poller de resumos (index.js) usa os MESMOS clients das rotas.
  // autoCallMeet vai junto: o poller do SDR cria a sala que falta na hora do
  // lembrete de 2h (sem link, o lembrete de 10min chamava pra lugar nenhum).
  if (!app.hasDecorator("integrationClients")) app.decorate("integrationClients", { google: googleClient, googleUser, anthropic: anthropicClient, mailer: mailerClient, whatsapp: whatsappClient, autoCallMeet, blogEngine, sdrBrain });
  // NPS: página pública da nota (/public/nps/:token) + pedido manual pela ficha.
  // Depois do mailer/whatsapp: o pedido sai por e-mail e, dentro da janela de
  // 24h, por WhatsApp.
  registerNpsRoutes(app, repo, { mailer: mailerClient, whatsapp: whatsappClient });
  // Cases (prova social): rascunho a partir do cliente, gate de publicação e o
  // JSON público que o site consome.
  registerCaseRoutes(app, repo);
  // Extrato mensal da remuneração (o que cada mês fechado registrou).
  registerCompRoutes(app, repo);
  // Resultados do cliente na ficha: número vivo do banco do produto + envio
  // manual do relatório mensal.
  registerCustomerResultsRoutes(app, repo, { mailer: mailerClient, whatsapp: whatsappClient });
  // Carga inicial do SPA (SEED), portfólio e leaderboard. Depois de todos os
  // clientes: o bootstrap informa o estado de cada integração.
  registerBootstrapRoutes(app, repo, { googleClient, mpClient, metaClient, anthropicClient, discordClient, whatsappClient });
  // Foto anexada a um toque da timeline. Antes do CRUD genérico.
  registerActivityAssetRoutes(app, repo);
  // Widget de feedback: o reporte vira card no quadro de Tarefas.
  registerFeedbackRoutes(app, repo);
  // Quadro de Tarefas: mover, concluir, comentários, subtarefas, anexos,
  // ações em massa, atividade + caixa de entrada (routes.tasks.js).
  registerTaskRoutes(app, repo);
  // Suporte: tickets (fila, kanban, conversa, SLA), configurações de SLA por
  // produto e atendentes (routes.tickets.js). Antes do CRUD genérico.
  registerTicketRoutes(app, repo, { mailer: mailerClient, ...(opts.linear ? { linear: opts.linear } : {}) });
  // Portal público do cliente: /s/:token (chamado) e /s/new/:saas (abrir).
  registerSupportPortalRoutes(app, repo, opts.supportPortal);
  // CRUD genérico sobre as coleções, depois das rotas específicas.
  registerCrudRoutes(app, repo, { discordClient, googleUser, metaCapiClient, briefer, autoCallMeet, autoIntegrationMeet, cancelIntegrationMeet, googleClient, mpClient });
  // Funil do produto com migração dos cards renomeados.
  registerFunnelRoutes(app, repo);
  // Proposta a partir do lead: gerar, personalizar, ofertas e compartilhar.
  registerLeadProposalRoutes(app, repo);
}

