// REST routes. One generic CRUD surface over every collection, plus two
// computed/aggregated endpoints the cockpit needs: /bootstrap and /portfolio.

import { randomUUID } from "node:crypto";
import { repo as defaultRepo, COLLECTION_NAMES } from "./db.js";
import { canScreen } from "./screens.js";
import { PORTFOLIO_CONST } from "./seed-data.js";
import { openapi, docsHtml } from "./openapi.js";
import { runProposal, integrationStatus } from "./levercopy.js";
import { registerFormRoutes } from "./routes.forms.js";
import { registerWebhookRoutes } from "./routes.webhooks.js";
import { mergeLeadQuestions } from "./forms.js";
import { registerProposalRoutes } from "./routes.proposals.js";
import { runNativeProposal } from "./proposal.js";
import { registerBillingRoutes } from "./routes.billing.js";
import { initSubscription, syncCustomerArr, createClosedSubscription } from "./billing.js";
import { registerAuthRoutes } from "./auth.js";
import { registerMpRoutes, mirrorSubscriptionToMp } from "./routes.mp.js";
import { mp as defaultMpClient } from "./mp.js";
import { registerMarketingRoutes } from "./routes.marketing.js";
import { registerSocialRoutes } from "./routes.social.js";
import { registerOfferRoutes } from "./routes.offers.js";
import { registerCampaignRoutes } from "./routes.disparos.js";
import { registerSequenceRoutes } from "./routes.sequences.js";
import { registerPitchRoutes } from "./routes.pitch.js";
import { registerRoutineRoutes } from "./routes.routine.js";
import { registerConsultationRoutes } from "./routes.consultations.js";
import { syncConsultationCalendar } from "./consultations.js";
import { newManual, sameFamily } from "./deliverables.js";
import { registerIntegrationRoutes } from "./routes.integrations.js";
import { registerMetasRoutes } from "./routes.metas.js";
import { registerFlashcardRoutes } from "./routes.flashcards.js";
import { registerGoogleRoutes } from "./routes.google.js";
import { syncPersonalCalendar } from "./google-user.js";
import { registerWhatsappRoutes } from "./routes.whatsapp.js";
import { makeMailer } from "./mailer.js";
import { getWaHealth, waHealthSummary } from "./wa-health.js";
import { makeAnthropic } from "./anthropic.js";
import { registerMetricsRoutes } from "./routes.metrics.js";
import { meta as defaultMetaClient } from "./meta.js";
import { metaCapi as defaultMetaCapi } from "./meta-capi.js";
import { discord as defaultDiscord } from "./discord.js";
import { currentRev, subscribe as subscribeChanges } from "./changes.js";
import { isWon, firstStage, kindOf } from "./stages.js";
import { logActivity, applyStageMove, onActivityCreated, initialNextActionAt, autoLeadOwner } from "./lead-flow.js";
import { registerFunnelMetricsRoutes } from "./routes.funnel-metrics.js";
import { registerScoreboardRoutes } from "./routes.scoreboard.js";
import { registerPipelinePaceRoutes } from "./routes.pipeline-pace.js";

// Auth interna fica FORA do CRUD genérico: passwordHash/token de sessão nunca
// saem pela API. Gestão via rotas dedicadas (/api/auth/*).
// wa_threads/wa_messages ficam FORA do CRUD genérico: o inbox usa as rotas
// dedicadas (/api/whatsapp/*, gateadas), então o texto das conversas não vaza
// pra qualquer usuário autenticado via /api/wa_messages.
const PRIVATE = new Set(["users", "sessions", "wa_threads", "wa_messages"]);
const isExposed = (c) => COLLECTION_NAMES.includes(c) && !PRIVATE.has(c);

// Collections external SaaS are allowed to write to via REST/MCP.
const WRITABLE = new Set(COLLECTION_NAMES.filter((c) => !PRIVATE.has(c)));

// Defaults applied on create so a minimally-specified record still renders in the
// UI (which iterates over array fields). User-provided fields always win.
// (Exported: as rotas públicas de form criam leads fora do CRUD genérico.)
export const CREATE_DEFAULTS = {
  products: {
    health: 0, healthDelta: 0, healthTrend: "stable",
    mrr: 0, mrrDelta: 0, arr: 0, nrr: 1, nrrDelta: 0, grr: 1, logoRetention: 1, churnRate: 0,
    nnm: { new: 0, expansion: 0, contraction: 0, churn: 0 },
    tcv: 0, tcvDelta: 0, pipelineCoverage: null, acv: 0, acvDelta: 0,
    winRate: 0, winRateDelta: 0, velocity: 100, velocityDelta: 0,
    funnel: [], activation: 0, activationDelta: 0, nps: 0, npsDelta: 0,
    monthlyCashTarget: 120000,
    mrrSeries: [], healthSeries: [], customers: 0, customersDelta: 0,
    accent: 240, tag: "", plan: "", motion: "", ticketBand: "", cycleDays: 0,
    // Config por SaaS (fase 3): campos custom por entidade, pesos da saúde (em %,
    // somam 100) e definição do Aha — editados em Ajustes.
    customFields: { deals: [], customers: [], leads: [] },
    healthWeights: { funil: 25, vendas: 25, cliente: 25, uso: 25 },
    aha: { conditions: [] },
  },
  // Métricas de cliente não são mais editáveis no form (saúde/uso/NPS/renovação são
  // alimentadas por automação); o create precisa de defaults pra UI não ler `undefined`.
  customers: { flags: [], health: 0, delta: 0, nps: 0, usage: "", lastTouch: "—", renewal: "—" },
  nps: { tags: [] },
  // comments = [{ id, author, text, at }] — anotações do card; o SPA faz PATCH do array inteiro (mesmo padrão de tasks).
  // callAt = dia/horário da call (editável no card em "Call closer"); proposalValue/proposalPeriod = valor e período da
  // proposta (editáveis no card em "Negociação"); integrationAt = dia/horário da integração (editável no card em
  // "Integração", pós-venda). Todos opcionais, preenchidos por PATCH inline.
  // nextActionAt/nextActionNote = próximo toque no lead (ISO UTC; o "GPS" — setado
  // pela cadência do estágio no servidor ou pelo time); lostReason/lostNote = perda
  // estruturada (id de product.lossReasons); owner = user id do SDR dono; closer =
  // user id do closer; lastActivityAt/Type + stageAttempts = denormalizações da
  // timeline (activities) pro board/fila não precisarem carregar o histórico.
  leads: { priority: "P2", score: 0, icp: 0, value: "", amount: 0, owner: "", closer: "", reason: "", source: "Form", age: "agora", stage: "", stageSince: "", comments: [], callAt: "", proposalValue: "", proposalPeriod: "", integrationAt: "", nextActionAt: "", nextActionNote: "", lostReason: "", lostNote: "", lastActivityAt: "", lastActivityType: "", stageAttempts: 0 },
  // `current`/`projected` saem do form (leitura ao vivo da meta) — default 0 até serem alimentados.
  goals: { current: 0, projected: 0 },
  forms: { status: "draft", theme: {}, welcome: null, questions: [], thanks: {}, mapping: {} },
  proposal_templates: { status: "draft", theme: {}, slides: [], calc: {}, acceptStage: "" },
  // Billing (fase 5). Datas de período/fatura inicial são dinâmicas — preenchidas
  // por initSubscription no POST genérico, não aqui.
  plans: { name: "", cycle: "monthly", price: 0 },
  subscriptions: { status: "active", cycle: "monthly", price: 0, plan: "", pendingChange: null },
  invoices: { status: "open", amount: 0, kind: "manual" },
  // Custos operacionais manuais (mensais): month "YYYY-MM", categoria fixa da UI
  // (fixo/ferramenta/pessoal/outros — publicidade e IA entram automáticos).
  // recurring=true vale de `month` em diante, todo mês, até `endMonth` (inclusivo).
  expenses: { month: "", category: "fixo", name: "", amount: 0, recurring: false, endMonth: "" },
  // Kanban de tarefas do time. `column` = KEY estável da coluna do board (renomear
  // coluna não órfã o card); `assignees` = ids de usuários do time (collection users);
  // comments = [{ id, author, text, at }] — o SPA faz PATCH do array inteiro.
  tasks: { title: "", description: "", saas: "", assignees: [], column: "", priority: "", dueDate: "", labels: [], comments: [], order: 0 },
  task_boards: { name: "Tarefas", columns: [] },
  // Timeline do lead (pontos de contato + eventos automáticos). `type` toque =
  // whatsapp/call/email/meeting; `stage` = mudança de estágio (meta {from,to});
  // `system` = evento automático (lead_created, proposal_viewed...). `at` = quando
  // aconteceu (backdate permitido); createdAt = quando entrou no sistema.
  activities: { saas: "", lead: "", type: "note", text: "", meta: {}, author: "", at: "" },
  // Bloqueio de agenda (tela Agenda): trava horário do dono (user) contra marcação
  // de call/integração. recur "once" usa `date` (YYYY-MM-DD); "weekly" usa `weekday`
  // (0=dom…6=sáb). allDay=true trava o dia todo; senão o intervalo [fromHour, toHour).
  agenda_blocks: { saas: "", user: "", recur: "once", date: "", weekday: 0, allDay: false, fromHour: 0, toHour: 0, reason: "", createdAt: "" },
  // Mapa mental / estratégia: nodes = [{ id, x, y, text, color, parent }] (árvore),
  // links = [{ from, to }] (conexões livres). name = título do mapa.
  mindmaps: { name: "Novo mapa", saas: "", nodes: [], links: [], createdAt: "" },
  // Disparos (ferramenta): uma campanha por produto pra mandar e-mail + WhatsApp
  // pros leads qualificados. `stages` = segmento (etapas do funil que entram);
  // `sent` = progresso por lead ({leadId: {whatsapp, email}}, ISO), mesclado no
  // servidor. channels/email/wa = o que foi composto.
  campaigns: { name: "", saas: "", status: "draft", stages: [], channels: { email: false, whatsapp: true }, email: { subject: "", body: "" }, wa: { text: "" }, sent: {}, createdAt: "", createdBy: "" },
  // Sequência de nutrição (drip): `trigger.stages` = etapas que auto-inscrevem;
  // `steps` = [{ channel:"email"|"whatsapp", delayDays, subject, body, text }];
  // `exitOn` = condições de saída. status active/paused/draft (só active roda).
  sequences: { name: "", saas: "", status: "draft", trigger: { stages: [] }, steps: [], exitOn: { won: true, booked: true, optOut: true }, createdAt: "", createdBy: "" },
  // Progresso de UM lead numa sequência. status: active (rodando) / waiting
  // (parado num passo de WhatsApp assistido até o operador mandar) / done / exited.
  sequence_enrollments: { saas: "", sequence: "", lead: "", status: "active", stepIndex: 0, nextRunAt: "", pendingChannel: "", exitReason: "", enrolledAt: "", lastAt: "" },
  // Conteúdo reutilizável dos passos (biblioteca). channel email/whatsapp.
  drip_templates: { name: "", saas: "", channel: "email", subject: "", body: "", text: "" },
  // Consulta 1:1 da mentoria (UniqueKids, 8 encontros). `at` = hora de Brasília
  // sem fuso (datetime-local); `owner` = responsável (Ana), dona do espelho na
  // agenda Google pessoal (calEvent*); Meet do time carrega a transcrição → summary (IA).
  consultations: { saas: "", customerId: "", leadId: "", clientName: "", childName: "", phone: "", n: 1, at: "", durationMin: 60, status: "scheduled", notes: "", owner: "", meetUrl: "", meetEventId: "", meetScheduledAt: "", calEventId: "", calEventUser: "", summary: null, summaryDoneFor: "", summaryAt: "", transcriptUrl: "", createdAt: "" },
  // Manual da Família (entregável final da mentoria): sections = snapshot do
  // template (deliverables.js) modulado pelas consultas; página pública /m/:id.
  deliverables: { saas: "", customerId: "", leadId: "", clientName: "", childName: "", status: "building", deliveredAt: "", sections: [], createdAt: "" },
};

// Receita e nº de clientes são DERIVADOS da coleção `customers`, não dos campos
// crus do produto — assim um SaaS nunca exibe receita sem clientes registrados.
// `customers` = qtd de clientes daquele saas; `arr` = soma do ARR deles; `mrr` = arr/12.
function rollupProduct(p, customers) {
  const mine = customers.filter((c) => c.saas === p.id);
  const arr = mine.reduce((a, c) => a + (Number(c.arr) || 0), 0);
  return { ...p, customers: mine.length, arr, mrr: Math.round(arr / 12) };
}
const rollupProducts = (products, customers) => products.map((p) => rollupProduct(p, customers));

async function computePortfolio(repo) {
  const [products, customers] = await Promise.all([repo.list("products"), repo.list("customers")]);
  const saas = rollupProducts(products, customers);
  const sum = (k) => saas.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  return {
    mrr: sum("mrr"),
    arr: sum("arr"),
    mrrDelta: sum("mrrDelta"),
    tcv: sum("tcv"),
    customers: sum("customers"),
    nrr: PORTFOLIO_CONST.nrr,
    mrrSeries30d: PORTFOLIO_CONST.mrrSeries30d,
  };
}

async function peopleObject(repo) {
  const list = await repo.list("people");
  const obj = {};
  for (const p of list) obj[p.id] = p;
  return obj;
}

// Filters applied to GET list endpoints. Each returns a predicate or null.
function listFilter(collection, q) {
  if (collection === "deals") {
    return (d) =>
      (!q.saas || d.saas === q.saas) &&
      (!q.stage || d.stage === q.stage) &&
      (!q.owner || d.owner === q.owner) &&
      (!q.score || d.score === q.score);
  }
  if (collection === "customers") {
    return (c) => {
      if (q.band === "red") return c.health < 50;
      if (q.band === "yellow") return c.health >= 50 && c.health < 70;
      if (q.band === "green") return c.health >= 70;
      if (q.saas) return c.saas === q.saas;
      return true;
    };
  }
  if (collection === "leads") return (l) => !q.priority || l.priority === q.priority;
  if (collection === "nps") return (n) => !q.saas || n.saas === q.saas;
  if (collection === "goals") return (g) => !q.scope || g.scope === q.scope;
  if (collection === "forms") return (f) => !q.saas || f.saas === q.saas;
  if (collection === "form_submissions") return (s) => (!q.form || s.form === q.form) && (!q.saas || s.saas === q.saas);
  if (collection === "proposal_templates") return (t) => !q.saas || t.saas === q.saas;
  if (collection === "proposals") return (p) => (!q.saas || p.saas === q.saas) && (!q.lead || p.lead === q.lead) && (!q.template || p.template === q.template);
  if (collection === "plans") return (p) => !q.saas || p.saas === q.saas;
  if (collection === "subscriptions") return (s) => (!q.saas || s.saas === q.saas) && (!q.customer || s.customer === q.customer) && (!q.status || s.status === q.status);
  if (collection === "invoices") return (i) => (!q.saas || i.saas === q.saas) && (!q.customer || i.customer === q.customer) && (!q.subscription || i.subscription === q.subscription) && (!q.status || i.status === q.status);
  if (collection === "ad_insights") return (r) => (!q.saas || r.saas === q.saas) && (!q.campaign || r.campaignId === q.campaign);
  if (collection === "tasks") return (t) => (!q.saas || t.saas === q.saas) && (!q.assignee || (t.assignees || (t.assignee ? [t.assignee] : [])).includes(q.assignee)) && (!q.column || t.column === q.column);
  if (collection === "activities") return (a) => (!q.lead || a.lead === q.lead) && (!q.saas || a.saas === q.saas) && (!q.type || a.type === q.type) && (!q.since || String(a.at || "") >= q.since);
  if (collection === "campaigns") return (c) => !q.saas || c.saas === q.saas;
  if (collection === "sequences") return (s) => !q.saas || s.saas === q.saas;
  if (collection === "sequence_enrollments") return (e) => (!q.saas || e.saas === q.saas) && (!q.sequence || e.sequence === q.sequence) && (!q.status || e.status === q.status) && (!q.lead || e.lead === q.lead);
  if (collection === "drip_templates") return (t) => (!q.saas || t.saas === q.saas) && (!q.channel || t.channel === q.channel);
  return null;
}

export function registerRoutes(app, repo = defaultRepo, opts = {}) {
  app.get("/api/health", async () => ({ ok: true, service: "cockpit-api", collections: COLLECTION_NAMES }));

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
  registerFormRoutes(app, repo, { ...(opts.forms || {}), discord: discordClient, metaCapi: metaCapiClient, anthropic: anthropicClient });
  // Webhooks de entrada (Shopify da UniqueKids → lead pra Ana). Rota aberta,
  // autenticada por assinatura HMAC da Shopify (ver routes.webhooks.js).
  registerWebhookRoutes(app, repo, { ...(opts.webhooks || {}) });
  // Superfície pública do proposal builder (/p/:id, aceite, painel do closer).
  registerProposalRoutes(app, repo, { ...(opts.proposals || {}), discord: discordClient, metaCapi: metaCapiClient });
  // Billing (fase 5): mudança de plano c/ pró-rata, baixa de fatura, tick do motor.
  const mpClient = opts.mp || defaultMpClient;
  registerBillingRoutes(app, repo, { mp: mpClient, discord: discordClient });
  // Mercado Pago (fase 4): link de assinatura + webhook de baixa automática.
  registerMpRoutes(app, repo, { mp: mpClient, discord: discordClient });
  // Marketing: sync de insights da Meta + métricas cruzadas com o funil.
  const metaClient = opts.meta || defaultMetaClient;
  registerMarketingRoutes(app, repo, { meta: metaClient });
  // Mídia social: métricas do perfil + publicação orgânica (IG/página FB) +
  // copy do post por IA (mesma chave OpenRouter/Anthropic do resto).
  registerSocialRoutes(app, repo, { social: opts.social, meta: metaClient, anthropic: anthropicClient });
  // Links de pagamento das ofertas (ferramenta).
  registerOfferRoutes(app, repo);
  // Insight de pitch: melhora o roteiro de venda a partir dos resumos das calls.
  registerPitchRoutes(app, repo, { anthropic: anthropicClient });
  // UniqueKids · sugestão de solução da rotina por IA (método R.O.T.I.N.A) no lead.
  registerRoutineRoutes(app, repo, { anthropic: anthropicClient });
  // Análise de integração (CS/onboarding): sentimento + pendências recorrentes.
  registerIntegrationRoutes(app, repo);
  // Metas de desempenho por vaga/pessoa (ferramenta; escreve na collection goals).
  registerMetasRoutes(app, repo);
  // Treinamentos: flashcards por vaga com repetição espaçada (FSRS) por pessoa
  // + prova de checkpoint (a IA corrige as questões digitadas).
  registerFlashcardRoutes(app, repo, { anthropic: anthropicClient });
  registerMetricsRoutes(app, repo);
  // Métricas reais de funil (conversão/tempo por estágio, motivos de perda, SLA)
  // a partir do histórico de transições da timeline.
  registerFunnelMetricsRoutes(app, repo);
  // Pace de caixa do pipeline: recebido no mês → meta diária por papel.
  registerPipelinePaceRoutes(app, repo, opts.pipelinePace);
  // Placar por pessoa/papel (SDR/closer/CS) — o cockpit de gestão da Visão geral.
  registerScoreboardRoutes(app, repo);
  // Usuários do time: login/logout/me + gestão mínima (rotas dedicadas).
  registerAuthRoutes(app, repo);
  // Google Meet: conectar conta (OAuth) + criar call na agenda do closer.
  // Claude resume as calls (transcrição → timeline) quando há ANTHROPIC_API_KEY.
  const { client: googleClient, googleUser, briefer } = registerGoogleRoutes(app, repo, { google: opts.google, googleUser: opts.googleUser, anthropic: anthropicClient });
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
  const whatsappClient = registerWhatsappRoutes(app, repo, { whatsapp: opts.whatsapp });
  // Poller de resumos (index.js) usa os MESMOS clients das rotas.
  if (!app.hasDecorator("integrationClients")) app.decorate("integrationClients", { google: googleClient, anthropic: anthropicClient, mailer: mailerClient });

  // ── Tempo real ─────────────────────────────────────────────────────────
  // Toda escrita no repo (db.js) incrementa um contador global (changes.js).
  // O SPA escuta /api/events (SSE) e recarrega o SEED quando o rev muda — é o
  // que faz a alteração de um usuário aparecer na tela dos outros sem refresh.
  app.get("/api/rev", async () => ({ rev: currentRev() }));
  app.get("/api/events", (req, reply) => {
    // EventSource não manda headers — a key/token vem em ?key= (ver providedKey
    // no index.js). reply.hijack(): a resposta vira um stream cru de vida longa.
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "x-accel-buffering": "no", // proxies (nginx/traefik) não bufferizam o stream
    });
    reply.raw.write(`data: {"rev":${currentRev()}}\n\n`);
    const unsub = subscribeChanges((rev, collection) => {
      reply.raw.write(`data: {"rev":${rev},"collection":${JSON.stringify(collection)}}\n\n`);
    });
    // Heartbeat: proxies matam conexão ociosa; comentário SSE a cada 25s segura.
    const hb = setInterval(() => reply.raw.write(":hb\n\n"), 25000);
    req.raw.on("close", () => { clearInterval(hb); unsub(); });
  });

  // API documentation (OpenAPI spec + Redoc page). The MCP server consumes this.
  app.get("/api/openapi.json", async () => openapi);
  app.get("/api/docs", async (_req, reply) => reply.type("text/html").send(docsHtml));

  // Everything the cockpit web app needs in one shot (mirrors window.SEED).
  // Usuário com telas restritas (user.screens) recebe o payload FILTRADO:
  // esconder o menu no SPA sem cortar os dados aqui não seria restrição —
  // faturamento/clientes não podem chegar no navegador de quem não vê as telas.
  app.get("/api/bootstrap", async (req) => {
    const can = (screen) => canScreen(req.authUser, screen);
    const [products, customers, attention, leads, nps, lbMonth, lbAll, goals, portfolio, people, agendaBlocks] =
      await Promise.all([
        repo.list("products"),
        repo.list("customers"),
        repo.list("attention"),
        repo.list("leads"),
        repo.list("nps"),
        repo.list("leaderboard_month"),
        repo.list("leaderboard_all"),
        repo.list("goals"),
        computePortfolio(repo),
        peopleObject(repo),
        repo.list("agenda_blocks"),
      ]);
    // Sem nenhuma tela financeira, os números de receita saem até do catálogo
    // de produtos (o funil/config continua — o pipeline precisa dele).
    const seesFinance = can("overview") || can("customers") || can("metrics") || can("expenses");
    const FINANCE_KEYS = ["arr", "mrr", "mrrSeries", "mrrDelta", "nnm", "tcv", "tcvDelta", "acv", "acvDelta", "customers", "customersDelta", "churnRate", "nrr", "nrrDelta", "grr", "healthSeries"];
    let saas = rollupProducts(products, customers);
    if (!seesFinance) saas = saas.map((s) => { const c = { ...s }; for (const k of FINANCE_KEYS) delete c[k]; return c; });
    return {
      SAAS: saas,
      PORTFOLIO: can("overview") ? portfolio : null,
      ATTENTION: can("overview") ? attention : [],
      PEOPLE: people,
      CUSTOMERS: can("customers") ? customers : [],
      LEADS: can("pipeline") || can("today") || can("analise") ? leads : [], // Meu dia e Análise do pipeline = views dos mesmos leads
      AGENDA_BLOCKS: agendaBlocks, // bloqueios de horário por pessoa (tela Agenda) — alimentam a "agenda ocupada" ao marcar call/integração

      NPS: can("customers") ? nps : [],
      LEADERBOARD_MONTH: can("overview") ? lbMonth : [],
      LEADERBOARD_ALL: can("overview") ? lbAll : [],
      GOALS: can("overview") ? goals : [],
      // Estado de integrações que a UI precisa pra decidir o que renderizar
      // (ex.: mostrar o botão "Gerar proposta" nos leads de SaaS com provider).
      CONFIG: {
        levercopy: integrationStatus(),
        proposals: { nativeSaas: (await repo.list("proposal_templates")).filter((t) => t.status === "published").map((t) => t.saas) },
        mp: { configured: mpClient.configured() },
        meta: { configured: metaClient.configured() },
        google: { configured: googleClient.configured(), connected: await googleClient.connected(), account: await googleClient.account(), gmail: await googleClient.gmailReady() },
        ai: { configured: anthropicClient.configured() },
        discord: { configured: discordClient.configured() },
        whatsapp: { configured: whatsappClient.configured(), health: waHealthSummary(await getWaHealth(repo)) },
      },
    };
  });

  app.get("/api/portfolio", async () => await computePortfolio(repo));

  // Convenience: leaderboard by scope -> the right collection.
  app.get("/api/leaderboard", async (req) => {
    const scope = req.query.scope === "all" ? "leaderboard_all" : "leaderboard_month";
    return await repo.list(scope);
  });

  // ── Generic CRUD over every collection ───────────────────────────────────
  app.get("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    let items = await repo.list(collection);
    const f = listFilter(collection, req.query);
    if (f) items = items.filter(f);
    if (collection === "products") items = rollupProducts(items, await repo.list("customers"));
    return items;
  });

  app.get("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!isExposed(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const item = await repo.get(collection, id);
    if (!item) return reply.code(404).send({ error: "Not found" });
    return collection === "products" ? rollupProduct(item, await repo.list("customers")) : item;
  });

  app.post("/api/:collection", async (req, reply) => {
    const { collection } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const now = new Date().toISOString();
    const stamp = {};
    if ((collection === "leads" || collection === "tasks" || collection === "consultations" || collection === "deliverables") && !req.body.createdAt) stamp.createdAt = now;
    // Consulta nasce com a responsável = quem marcou (a Ana marca as próprias).
    if (collection === "consultations" && !req.body.owner && req.authUser?.id) stamp.owner = req.authUser.id;
    // Manual criado sem seções ganha o template (as 6 seções da apresentação).
    if (collection === "deliverables" && !(Array.isArray(req.body.sections) && req.body.sections.length)) {
      stamp.sections = newManual({}).sections;
    }
    // stageSince = quando o card entrou no estágio atual (base do contador "dias na
    // coluna"). No create, é agora; depois, recarimbado a cada mudança de estágio.
    if ((collection === "leads" || collection === "deals") && !req.body.stageSince) stamp.stageSince = now;
    // Activity: id randômico (burst de timeline colide com o gerador por timestamp
    // do repo — mesmo motivo do fe_ em form_events), at = quando aconteceu.
    if (collection === "activities") {
      if (!req.body.id) stamp.id = "ac_" + randomUUID();
      if (!req.body.at) stamp.at = now;
      if (!req.body.createdAt) stamp.createdAt = now;
    }
    // GPS: lead nasce com o próximo toque marcado pela cadência do estágio de
    // entrada (SLA de 1º contato) — a fila da Visão geral já o mostra na hora.
    if (collection === "leads" && !req.body.nextActionAt) {
      try {
        const product = req.body.saas ? await repo.get("products", req.body.saas) : null;
        const at = initialNextActionAt(product, req.body.stage);
        if (at) stamp.nextActionAt = at;
      } catch { /* fail-open */ }
    }
    // Responsável: todo lead novo entra com o SDR do produto como dono (quando há
    // só um). Espelho externo/MCP que já manda `owner` é respeitado.
    if (collection === "leads" && !req.body.owner) {
      const owner = await autoLeadOwner(repo, req.body.saas);
      if (owner) stamp.owner = owner;
    }
    let created = await repo.create(collection, { ...(CREATE_DEFAULTS[collection] || {}), ...req.body, ...stamp });
    // Toque registrado → denormalizações do lead (últ. contato, tentativas) +
    // re-agendamento do próximo passo. Best-effort: nunca quebra o POST.
    if (collection === "activities") { try { await onActivityCreated(repo, created); } catch { /* fail-open */ } }
    // Timeline: nascimento do lead (form tem log próprio em routes.forms.js).
    if (collection === "leads") {
      try {
        const product = created.saas ? await repo.get("products", created.saas) : null;
        await logActivity(repo, {
          saas: created.saas || "", lead: created.id, type: "system",
          meta: { event: "lead_created", via: "api", source: created.source || "", stage: created.stage || firstStage(product) },
          author: req.authUser?.id || "api",
        });
      } catch { /* fail-open */ }
    }
    // Assinatura nova: janela do 1º ciclo + fatura inicial + customer.arr
    // (invariante: receita do produto deriva de customers).
    if (collection === "subscriptions") created = await initSubscription(repo, created);
    // Form salvo → sincroniza leadQuestions do produto (painel do lead nunca
    // diverge das chaves capturadas). Best-effort: nunca quebra o save do form.
    if (collection === "forms") { try { await syncLeadQuestions(repo, created); } catch { /* fail-open */ } }
    // Lead criado via API genérica (espelho de SaaS externo como o leverads.com.br,
    // ou MCP) → gera a proposta NATIVA se o SaaS tem template publicado. Espelha o
    // auto-trigger do form nativo (routes.forms.js) p/ leads que entram por aqui,
    // sobrescrevendo qualquer proposalUrl externo. Best-effort + idempotente
    // (runNativeProposal pula com auto quando já há proposta_id). Native-only: não
    // dispara levercopy automaticamente em todo create.
    if (collection === "leads" && created.saas && !created.proposta_id) {
      try {
        const templates = await repo.list("proposal_templates");
        const hasNative = templates.some((t) => t.saas === created.saas && t.status === "published");
        if (hasNative) {
          const r = await dispatchProposal(repo, created, { auto: true, baseUrl: publicBase(req) });
          if (r && r.lead) created = r.lead;
        }
      } catch { /* fail-open — nunca quebra o create */ }
    }
    // Lead criado manual/MCP avisa no Discord (submissão de form tem aviso
    // próprio em routes.forms.js, com o link da proposta gerada).
    if (collection === "leads" && discordClient.configured()) {
      const product = created.saas ? await repo.get("products", created.saas) : null;
      await discordClient.leadNew({ lead: created, productName: product?.name });
    }
    // Consulta marcada → espelha na agenda Google pessoal da responsável e
    // garante o Manual da Família do cliente (1 por cliente; a 1ª consulta cria).
    if (collection === "consultations") {
      try { await syncConsultationCalendar(repo, googleUser, created); } catch { /* fail-open */ }
      try {
        const manuals = await repo.list("deliverables");
        const has = manuals.some((m) => sameFamily(m, created));
        if (!has && created.clientName) {
          await repo.create("deliverables", newManual({
            saas: created.saas || "uniquekids", customerId: created.customerId || "",
            leadId: created.leadId || "", clientName: created.clientName, childName: created.childName || "",
          }));
        }
      } catch { /* fail-open */ }
    }
    return reply.code(201).send(created);
  });

  app.patch("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    if (!req.body || typeof req.body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const before = collection === "subscriptions" ? await repo.get(collection, id) : null;
    // Movimento de estágio de LEAD passa pelo applyStageMove (lead-flow.js):
    // recarimba stageSince (respeitando o explícito do optimistic move), zera o
    // contador de tentativas, preenche/limpa motivo de perda, re-agenda o próximo
    // toque pela cadência e loga a activity `stage` (histórico do funil). Renome
    // de estágio NÃO passa por aqui (vai via PUT /funnel → repo.update direto).
    let patch = req.body;
    if (collection === "leads" && typeof req.body.stage === "string") {
      const cur = await repo.get(collection, id);
      if (cur && cur.stage !== req.body.stage) {
        patch = { ...req.body, ...(await applyStageMove(repo, { lead: cur, toStage: req.body.stage, patch: req.body, author: req.authUser?.id || "api" })) };
      }
    }
    if (collection === "deals" && typeof req.body.stage === "string" && req.body.stageSince == null) {
      const cur = await repo.get(collection, id);
      if (cur && cur.stage !== req.body.stage) patch = { ...req.body, stageSince: new Date().toISOString() };
    }
    const updated = await repo.update(collection, id, patch);
    if (!updated) return reply.code(404).send({ error: "Not found" });
    // Form editado → ressincroniza leadQuestions do produto (best-effort).
    if (collection === "forms") { try { await syncLeadQuestions(repo, updated); } catch { /* fail-open */ } }
    // Lead que virou "Ganho" → cria o cliente (pós-venda) com startedAt e link
    // pro lead de origem. Idempotente e best-effort: nunca quebra o PATCH.
    if (collection === "leads" && typeof req.body.stage === "string") {
      try { await convertWonLead(repo, updated, { metaCapi: metaCapiClient }); } catch { /* fail-open */ }
      // Card entrando em INTEGRAÇÃO → briefing de passagem pro integrador (lê a
      // transcrição da call de venda). Solto em background: a resposta do PATCH
      // não espera a IA, e o poller (index.js) re-tenta enquanto a transcrição
      // do Google não fica pronta, que é o caso mais comum logo após o move.
      const toKind = kindOf(await repo.get("products", updated.saas), updated.stage);
      if (briefer && (toKind === "integracao" || toKind === "ganho") && !updated.integrationBriefAt) {
        briefer.briefLead(updated.id).catch(() => { /* o poller tenta de novo */ });
      }
    }
    // Call/integração agendada, reagendada ou reatribuída → espelha na agenda
    // PESSOAL do responsável (closer na call, integrator na integração) que
    // conectou a própria conta Google. Best-effort: nunca quebra o PATCH.
    if (collection === "leads" && ("callAt" in req.body || "closer" in req.body || "integrationAt" in req.body || "integrator" in req.body)) {
      try { await syncPersonalCalendar(repo, googleUser, updated); } catch { /* fail-open */ }
    }
    // Consulta remarcada, cancelada ou reatribuída → re-espelha na agenda
    // pessoal da responsável (mesmo evento; cancelar apaga). Best-effort.
    if (collection === "consultations" && ("at" in req.body || "status" in req.body || "owner" in req.body || "durationMin" in req.body || "n" in req.body || "clientName" in req.body)) {
      try { await syncConsultationCalendar(repo, googleUser, updated); } catch { /* fail-open */ }
    }
    if (collection === "subscriptions") {
      await syncCustomerArr(repo, updated.customer);
      if (before && before.customer && before.customer !== updated.customer) await syncCustomerArr(repo, before.customer);
      // Cancelar/pausar/reativar aqui não pode deixar o MP cobrando (fail-open).
      await mirrorSubscriptionToMp(mpClient, before, updated, req.log);
    }
    return updated;
  });

  app.delete("/api/:collection/:id", async (req, reply) => {
    const { collection, id } = req.params;
    if (!WRITABLE.has(collection)) return reply.code(404).send({ error: `Unknown collection: ${collection}` });
    const subCustomer = collection === "subscriptions" ? (await repo.get(collection, id))?.customer : null;
    // Consulta apagada → tira o evento da agenda pessoal da responsável.
    const gone = collection === "consultations" ? await repo.get(collection, id) : null;
    const ok = await repo.remove(collection, id);
    if (!ok) return reply.code(404).send({ error: "Not found" });
    if (subCustomer) await syncCustomerArr(repo, subCustomer);
    if (gone?.calEventId && gone?.calEventUser) {
      try { await googleUser.deleteEvent(gone.calEventUser, gone.calEventId); } catch { /* fail-open */ }
    }
    return { ok: true, id };
  });

  // ── Funil do produto com migração de renomes (fase 3) ────────────────────
  // `lead.stage`/`deal.stage` guardam o NOME do estágio sem FK — renomear via
  // PATCH cru órfã os cards. Este endpoint grava o funil e migra os registros:
  // body { funnel: [...], renames: { "Nome antigo": "Nome novo" } }.
  app.put("/api/products/:id/funnel", async (req, reply) => {
    const product = await repo.get("products", req.params.id);
    if (!product) return reply.code(404).send({ error: "Not found" });
    const { funnel, renames } = req.body || {};
    if (!Array.isArray(funnel)) return reply.code(400).send({ error: "funnel array required" });
    const map = renames && typeof renames === "object" ? renames : {};
    const valid = new Set(funnel.map((f) => f.stage));
    let migrated = 0;
    for (const collection of ["leads", "deals"]) {
      for (const item of await repo.list(collection)) {
        if (item.saas !== product.id) continue;
        const to = map[item.stage];
        if (to && to !== item.stage && valid.has(to)) {
          await repo.update(collection, item.id, { stage: to });
          migrated++;
        }
      }
    }
    const updated = await repo.update("products", product.id, { funnel });
    return { ok: true, migrated, product: updated };
  });

  // ── Geração de proposta de um lead — dispatcher native | levercopy ────────
  // `?auto=1`  → gatilho automático (a UI chama após criar um lead): respeita a
  //              idempotência (pula se já tem proposta) e a elegibilidade (saas/config).
  // `?force=1` → re-gerar manual: sobrescreve as URLs salvas.
  // Best-effort: só 404 (lead inexistente) é erro; skip/falha de geração voltam 200
  // com { ok:false, ... } pra UI mostrar o estado sem quebrar nada (fail-open).
  app.post("/api/leads/:id/proposal", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const auto = req.query.auto === "1" || req.query.auto === "true";
    const force = req.query.force === "1" || req.query.force === "true";

    const result = await dispatchProposal(repo, lead, { auto, force, baseUrl: publicBase(req) });
    if (!result.ok && result.error) {
      req.log.warn({ leadId: lead.id, provider: result.provider, status: result.status, err: result.error }, "proposal generation failed");
    }
    return result;
  });
}

// Conversão lead → cliente: quando um lead chega no estágio de ganho (kind
// `ganho` no funil do produto; fallback por nome "Ganho"/"Closed Won" pra SaaS
// sem funil configurado), nasce o customer com `startedAt` (base dos marcos de
// pós-venda e do CAC) e o link bidirecional lead.customerId / customer.leadId.
// Idempotente: se o lead já gerou cliente, não duplica.
// Valor e plano vêm do gate de fechamento (lead.amount + lead.planClosed):
// `arr` guarda o ANUAL (a tabela mostra MRR = arr/12), então o valor do negócio
// é anualizado pelo plano fechado. Assinatura criada depois manda mais — toda
// mutação de assinatura reescreve o arr via syncCustomerArr.
const CLOSED_PLAN_LABEL = { anual: "Anual", semestral: "Semestral", mensal: "Mensal", unico: "Serviço único" };
const CLOSED_PLAN_ANNUAL_FACTOR = { anual: 1, semestral: 2, mensal: 12, unico: 1 };
export async function convertWonLead(repo, lead, { metaCapi = defaultMetaCapi } = {}) {
  if (!lead || !lead.saas) return null;
  const product = await repo.get("products", lead.saas);
  if (!isWon(product, lead.stage)) return null;
  const customers = await repo.list("customers");
  if (customers.some((c) => c.leadId === lead.id)) return null;
  if (lead.customerId && customers.some((c) => c.id === lead.customerId)) return null;
  // CS automático: com UM integrador no escopo do produto, ele nasce como owner
  // do cliente — é por customer.owner que o placar de CS agrupa (sem owner o
  // trabalho de pós-venda não conta pra ninguém). Ambíguo (0 ou 2+) fica vazio.
  const csCandidates = (await repo.list("users").catch(() => []))
    .filter((u) => (u.roles || []).includes("integrator") && (!u.saas || u.saas === lead.saas));
  const csOwner = csCandidates.length === 1 ? csCandidates[0].id : "";
  const customer = await repo.create("customers", {
    ...(CREATE_DEFAULTS.customers || {}),
    name: lead.company || lead.name || "Cliente",
    contact: lead.name || "",
    saas: lead.saas,
    email: lead.email || "",
    phone: lead.phone || "",
    plan: CLOSED_PLAN_LABEL[lead.planClosed] || "",
    arr: Math.round((Number(lead.amount) || 0) * (CLOSED_PLAN_ANNUAL_FACTOR[lead.planClosed] || 1)),
    leadId: lead.id,
    ...(csOwner ? { owner: csOwner } : {}),
    ...(lead.paymentMethod ? { paymentMethod: lead.paymentMethod } : {}), // modo como fechou (PIX/boleto/cartão 12x)
    startedAt: new Date().toISOString(),
  });
  await repo.update("leads", lead.id, { customerId: customer.id });
  // Assinatura ativa nasce junto do cliente (plano fechado + meio de pagamento
  // → ciclo/preço; fatura inicial paga). Best-effort: o cliente já existe.
  try {
    await createClosedSubscription(repo, {
      customerId: customer.id, saas: lead.saas,
      planClosed: lead.planClosed, amount: lead.amount, paymentMethod: lead.paymentMethod,
    });
  } catch { /* assinatura é best-effort */ }
  try {
    await logActivity(repo, {
      saas: lead.saas, lead: lead.id, type: "system",
      meta: { event: "customer_created", customerId: customer.id },
    });
  } catch { /* timeline é best-effort */ }
  // A venda volta pra Meta (CAPI "Purchase" com o valor do negócio) — sem isso a
  // otimização para no "Lead" e o algoritmo persegue lead barato, não lead que
  // fecha. Idempotente: o guard de customer acima garante que só roda no 1º
  // ganho, e o eventId won:{id} deduplica na Meta. Lead interno (teste da
  // equipe) não suja o sinal, igual ao skip do Lead em routes.forms.js.
  if (!lead.internal) {
    try {
      await metaCapi.sendPurchase({
        eventId: `won:${lead.id}`,
        leadId: lead.id,
        email: lead.email,
        phone: lead.phone,
        fbp: lead.fbp || undefined, // cookies do Pixel persistidos no submit do
        fbc: lead.fbc || undefined, // form — melhoram o match do Purchase
        value: Number(lead.amount) || 0,
        pixelId: product?.metaPixelId,
      });
    } catch { /* best-effort — a conversão local nunca depende da Meta */ }
  }
  return customer;
}

// Mantém o leadQuestions do produto em dia com as perguntas do form (upsert por
// chave em mergeLeadQuestions). Chamado quando um form é criado/editado. Só grava
// se algo mudou. O painel do lead (deal.jsx) lê leadQuestions, então isso garante
// que nenhuma resposta capturada fique de fora por divergência de chave.
async function syncLeadQuestions(repo, form) {
  if (!form || !form.saas) return;
  const product = await repo.get("products", form.saas);
  if (!product) return;
  const next = mergeLeadQuestions(product.leadQuestions, form);
  if (JSON.stringify(next) !== JSON.stringify(product.leadQuestions || [])) {
    await repo.update("products", product.id, { leadQuestions: next });
  }
}

// Dispatcher native | levercopy — TODO gatilho de proposta passa por aqui (rota
// manual acima e o auto-trigger do form em routes.forms.js).
// Provider: `product.proposalProvider` explícito vence; sem ele, usa 'native'
// quando o SaaS tem template publicado, senão 'levercopy' (preserva o caminho
// de produção do LeverAds até existir template nativo).
export async function dispatchProposal(repo, lead, { auto = false, force = false, baseUrl = "" } = {}) {
  const product = await repo.get("products", lead.saas);
  let provider = product?.proposalProvider;
  if (provider !== "native" && provider !== "levercopy") {
    const templates = await repo.list("proposal_templates");
    provider = templates.some((t) => t.saas === lead.saas && t.status === "published") ? "native" : "levercopy";
  }
  const result = provider === "native"
    ? await runNativeProposal(repo, lead, { auto, force, baseUrl: baseUrl || publicBase() })
    : await runProposal(repo, lead, { auto, force });
  return { provider, ...result };
}

// Base das URLs públicas gravadas no lead (proposalUrl). Prioridade:
// COCKPIT_PUBLIC_URL > host da request (x-forwarded-* do proxy) > localhost.
// Proto: host público = sempre https (a cadeia de proxies reescreve
// x-forwarded-proto pra http e não dá pra confiar nele); localhost = http.
// Deployment público em http puro não existe — e se existir, é a env que manda.
export function publicBase(req) {
  if (process.env.COCKPIT_PUBLIC_URL) return process.env.COCKPIT_PUBLIC_URL.replace(/\/+$/, "");
  const raw = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (raw) {
    const host = String(raw).split(",")[0].trim();
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
    return `${local ? "http" : "https"}://${host}`;
  }
  return `http://localhost:${process.env.API_PORT || 8787}`;
}
