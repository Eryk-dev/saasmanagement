// Acesso genérico às COLEÇÕES do Cockpit (/api/:collection).
//
// O banco é um document store: cada coleção é uma tabela (id, json) e a API
// expõe UM CRUD genérico por cima — 61 coleções alcançáveis. O MCP antigo
// conhecia 21 delas, por um mapa de apelidos escrito à mão: coleção nova na API
// nascia invisível aqui. Este módulo troca o mapa por um catálogo declarado +
// descoberta ao vivo (GET /api/health), então o buraco fecha sozinho.
//
// Três cuidados que definem o desenho:
//
//  1. A API NÃO tem paginação, ordenação, projeção nem agregação no CRUD
//     genérico: GET /api/:collection devolve a tabela inteira. Quem recorta é o
//     MCP. Por isso toda listagem projeta campos, corta e devolve `page` — e
//     coleção grande (form_events, lp_events, activities, mp_payments) exige
//     filtro ou janela, senão a chamada arrasta megabytes que ninguém lê.
//  2. Chave mestre passa por cima do guard de telas da API. Então o corte de
//     dado sensível é AQUI: `sessions` nunca sai, `users` só pela rota que
//     devolve o usuário público (sem hash de senha), segredo em app_config vira
//     "«oculto»" e blob base64 vira marcador de tamanho.
//  3. POST/PATCH/DELETE genéricos disparam regra de negócio de verdade
//     (cancelar assinatura cancela a cobrança no Mercado Pago; mexer em
//     consultation move evento no Google Calendar do cliente; criar lead avisa
//     no Discord e gera proposta). O que o servidor faz além de gravar vem
//     escrito na resposta, e `dry_run` deixa ver antes.

import { z } from "zod";
import { http, ApiError } from "../core/http.js";
import { resolvePeriod, periodInput, dayKey, delta } from "../core/period.js";
import { result } from "../core/envelope.js";
import { matches, search, sortRows, pick, at, num, round2 } from "../core/shape.js";

// ─── Catálogo das coleções ──────────────────────────────────────────────────
// `f` = campos que a tela usa (projeção padrão da listagem — o resto do
// documento só sai se for pedido em `fields`). `q` = filtro que a PRÓPRIA API
// aceita na querystring (campo do documento → nome do parâmetro), o único jeito
// de não trazer a tabela inteira. `d` = campo de data padrão da janela.
// `big` = tabela grande: exige filtro. `ro` = leitura apenas. `sens` = por que
// o conteúdo é sensível.
const CATALOG = {
  // ── Núcleo
  products: { g: "Núcleo", label: "Produtos (SaaS)", alias: ["saas", "produto", "produtos", "product"], f: ["id", "name", "tag", "plan", "mrr", "arr", "customers", "health", "nps", "winRate", "cycleDays"], sum: ["mrr", "arr", "customers"], note: "receita e nº de clientes são DERIVADOS de `customers` a cada leitura; editar `funnel` por aqui órfã os cards (use PUT /api/products/:id/funnel)." },
  people: { g: "Núcleo", label: "Pessoas (diretório)", alias: ["pessoa", "pessoas", "person"], f: ["id", "name", "role", "saas"] },
  users: { g: "Núcleo", label: "Time (usuários)", alias: ["usuario", "usuarios", "user", "time", "equipe"], ro: true, endpoint: "/api/auth/users", f: ["id", "name", "role", "roles", "saas", "compLevel", "screens"], note: "sai pela rota de auth, já sem hash de senha; criação/edição de usuário não passa por este módulo." },
  attention: { g: "Núcleo", label: "Pontos de atenção", alias: ["atencao", "atencoes"] },
  goals: { g: "Núcleo", label: "Metas", alias: ["meta", "metas", "goal"], q: { scope: "scope" }, f: ["id", "saas", "scope", "key", "metric", "target", "current", "projected", "period"], note: "`target`/`current` não são somados: a unidade depende de `metric` (leads, receita, calls) e a soma misturaria régua. Agrupe por `metric` em records_aggregate." },
  leaderboard_month: { g: "Núcleo", label: "Ranking do mês", alias: ["leaderboard", "ranking"] },
  leaderboard_all: { g: "Núcleo", label: "Ranking geral", alias: ["ranking_geral"] },
  app_config: { g: "Núcleo", label: "Config de integrações (chave-valor)", alias: ["config", "configuracao"], sens: "guarda refresh token do Google — os valores saem ocultos.", f: ["id"] },

  // ── Funil
  leads: { g: "Funil", label: "Leads / negócios do funil", alias: ["lead", "negocio", "negocios", "card", "cards", "oportunidade", "oportunidades", "pipeline"], q: { priority: "priority" }, d: "createdAt", f: ["id", "saas", "name", "company", "phone", "email", "stage", "stageSince", "owner", "closer", "priority", "score", "amount", "source", "callAt", "followupAt", "nextActionAt", "lostReason", "customerId", "createdAt"], sum: ["amount"], note: "a API só filtra `priority` no servidor; saas/stage/owner são filtrados aqui depois de carregar a coleção." },
  deals: { g: "Funil", label: "Deals (legado)", alias: ["deal"], q: { saas: "saas", stage: "stage", owner: "owner", score: "score" }, f: ["id", "saas", "title", "company", "stage", "owner", "amount", "stageSince"], sum: ["amount"], note: "coleção legada — o funil de verdade é `leads` (é lá que 'negócio' resolve). O nome do card aqui é `title`, não `name`." },
  activities: { g: "Funil", label: "Timeline do lead (toques e eventos)", alias: ["activity", "atividade", "atividades", "toque", "toques", "timeline"], q: { lead: "lead", saas: "saas", type: "type" }, sinceParam: true, d: "at", big: true, f: ["id", "saas", "lead", "type", "text", "author", "at"], note: "o parâmetro `since` da API é empurrado quando você passa janela: é o que evita varrer o histórico inteiro." },
  outbound_accounts: { g: "Funil", label: "Radar de contas (outbound)", alias: ["outbound", "contas", "radar"], q: { saas: "saas", status: "status" }, d: "createdAt", f: ["id", "saas", "name", "marketplace", "niche", "city", "phone", "status", "owner", "leadId", "lastTouchAt"] },
  copilot_sessions: { g: "Funil", label: "Copiloto da call (transcrição)", alias: ["copilot", "copiloto", "transcricao"], sens: "transcrição de call com pessoa real.", f: ["id", "lead", "saas", "startedAt", "endedAt"] },

  // ── Pós-venda
  customers: { g: "Pós-venda", label: "Clientes", alias: ["cliente", "clientes", "customer"], q: { saas: "saas" }, d: "startedAt", f: ["id", "saas", "name", "email", "phone", "arr", "health", "nps", "usage", "renewal", "startedAt", "endedAt", "churnReason", "leadId"], sum: ["arr"], note: "cliente com `endedAt` no passado é churn: sai do MRR do produto mas continua na lista." },
  nps: { g: "Pós-venda", label: "Respostas de NPS", alias: ["pesquisa"], q: { saas: "saas" }, d: "at", f: ["id", "saas", "customer", "score", "comment", "tags", "at"] },
  contracts: { g: "Pós-venda", label: "Modelos de contrato", alias: ["contrato", "contratos", "modelo_contrato"], f: ["id", "saas", "name", "tag", "note"] },
  contract_issues: { g: "Pós-venda", label: "Contratos gerados", alias: ["contrato_gerado", "contratos_gerados", "emissoes"], q: { saas: "saas", customerId: "customer", contract: "contract" }, d: "createdAt", f: ["id", "saas", "contract", "name", "tag", "customerId", "customerName", "author", "createdAt"] },
  integration_forms: { g: "Pós-venda", label: "Formulários de integração", alias: ["integracao", "formulario_integracao", "fi"], q: { saas: "saas", customerId: "customer", status: "status" }, d: "createdAt", f: ["id", "saas", "customerId", "customerName", "status", "author", "createdAt"], note: "o id É o token do link público /fi/:id — o servidor o gera, não adianta mandar." },
  consultations: { g: "Pós-venda", label: "Consultas 1:1 (mentoria)", alias: ["consulta", "consultas", "mentoria", "encontro"], d: "at", f: ["id", "saas", "customerId", "clientName", "childName", "n", "at", "durationMin", "status", "owner", "meetUrl"] },
  deliverables: { g: "Pós-venda", label: "Manual da Família (entregável)", alias: ["entregavel", "entregaveis", "manual"], d: "createdAt", f: ["id", "saas", "customerId", "clientName", "childName", "status", "deliveredAt", "createdAt"] },

  // ── Financeiro
  plans: { g: "Financeiro", label: "Planos", alias: ["plano", "plan"], q: { saas: "saas" }, f: ["id", "saas", "name", "cycle", "price"], sum: ["price"] },
  subscriptions: { g: "Financeiro", label: "Assinaturas", alias: ["assinatura", "assinaturas", "subscription", "recorrencia"], q: { saas: "saas", customer: "customer", status: "status" }, d: "periodStart", f: ["id", "saas", "customer", "plan", "status", "cycle", "price", "periodStart", "periodEnd", "canceledAt", "mpStatus"], sum: ["price"], note: "a assinatura não tem `createdAt`: a janela usa `periodStart` (início do ciclo corrente, recarimbado a cada renovação), então filtrar por período aqui mostra o CICLO, não o nascimento." },
  invoices: { g: "Financeiro", label: "Faturas", alias: ["fatura", "faturas", "invoice", "cobranca", "cobrancas"], q: { saas: "saas", customer: "customer", subscription: "subscription", status: "status" }, d: "dueDate", f: ["id", "saas", "customer", "subscription", "status", "amount", "kind", "dueDate", "paidAt", "paidMethod"], sum: ["amount"] },
  expenses: { g: "Financeiro", label: "Custos operacionais", alias: ["despesa", "despesas", "custo", "custos", "expense"], d: "month", f: ["id", "saas", "month", "category", "name", "amount", "recurring", "endMonth"], sum: ["amount"], note: "`month` é competência YYYY-MM; recurring=true vale de `month` até `endMonth`, e as ocorrências futuras não existem como linha." },
  payables: { g: "Financeiro", label: "Contas a pagar", alias: ["conta_a_pagar", "contas_a_pagar", "pagar", "payable"], d: "dueDate", f: ["id", "saas", "description", "category", "counterpartyType", "userId", "supplierName", "amount", "month", "dueDate", "status", "paidAt", "recurring", "templateId"], sum: ["amount"] },
  fin_rules: { g: "Financeiro", label: "Regras de conciliação", alias: ["regra_financeira", "conciliacao"], d: "createdAt", f: ["id", "saas", "matchField", "matchValue", "action", "customer", "autoCount", "lastAppliedAt"] },
  mp_payments: { g: "Financeiro", label: "Pagamentos do Mercado Pago (espelho)", alias: ["pagamento", "pagamentos", "mp", "mercadopago"], big: true, d: "dateApproved", sens: "traz nome, e-mail e documento do pagador.", f: ["id", "mpId", "status", "amount", "netAmount", "method", "methodType", "installments", "payerName", "payerEmail", "saas", "customer", "invoice", "subscription", "matchedBy", "dateCreated", "dateApproved"], sum: ["amount", "netAmount"] },
  mp_preapprovals: { g: "Financeiro", label: "Recorrências do Mercado Pago", alias: ["preapproval", "recorrencia_mp"], f: ["id", "saas", "status", "payerEmail", "customer", "subscription", "amount"], sum: ["amount"] },
  mp_movements: { g: "Financeiro", label: "Saídas da conta MP", alias: ["saque", "saques", "movimentacao"], d: "date", f: ["id", "date", "type", "amount", "fee", "fileName", "payableId", "finIgnored"], sum: ["amount", "fee"] },
  payment_links: { g: "Financeiro", label: "Links de pagamento gerados", alias: ["link_pagamento", "links_pagamento", "checkout"], d: "createdAt", f: ["id", "saas", "kind", "origin", "lead", "customer", "invoice", "targetName", "amount", "title", "url", "createdAt"], sum: ["amount"] },
  offers: { g: "Financeiro", label: "Ofertas (links por produto)", alias: ["oferta", "ofertas"], f: ["id", "items"], note: "UM doc por produto (o id É o id do produto) e os links moram no array `items` ({key,label,price,link,proposalUrl}) — não há uma linha por oferta. Produto sem doc cai nos padrões, que só saem por GET /api/offers/:saas." },
  comp_plans: { g: "Financeiro", label: "Planos de remuneração", alias: ["remuneracao", "comissao", "comp"], sens: "salário e comissão por cargo — só admin vê na tela.", f: ["id", "role", "fixed", "variableCap", "commissionPct", "acceleratorPct", "upsellPct", "referralBonus", "updatedAt"], sum: ["fixed", "variableCap"] },

  // ── Marketing
  ad_insights: { g: "Marketing", label: "Insights de anúncio (Meta)", alias: ["insight", "insights", "anuncio", "anuncios"], q: { saas: "saas", campaignId: "campaign" }, d: "date", big: true, f: ["id", "saas", "date", "campaignName", "adsetName", "adName", "spend", "impressions", "clicks", "linkClicks", "metaLeads"], sum: ["spend", "impressions", "clicks", "linkClicks", "metaLeads"], note: "relatório pronto (CPL, ROAS, comparação) está em ads_report — aqui é a linha crua." },
  lp_events: { g: "Marketing", label: "Beacon das landing pages", alias: ["lp", "evento_lp", "eventos_lp"], big: true, d: "createdAt", f: ["id", "saas", "page", "event", "session", "utm", "createdAt"] },
  campaigns: { g: "Marketing", label: "Disparos (e-mail + WhatsApp)", alias: ["campanha_disparo", "disparo", "disparos"], q: { saas: "saas" }, d: "createdAt", f: ["id", "saas", "name", "status", "stages", "channels", "createdAt", "createdBy"], note: "`sent` é o progresso por lead e cresce muito — só sai se pedido em `fields`." },
  sequences: { g: "Marketing", label: "Sequências de nutrição (drip)", alias: ["sequencia", "sequencias", "drip"], q: { saas: "saas" }, d: "createdAt", f: ["id", "saas", "name", "status", "trigger", "createdAt"] },
  sequence_enrollments: { g: "Marketing", label: "Inscrições nas sequências", alias: ["inscricao", "inscricoes", "enrollment"], q: { saas: "saas", sequence: "sequence", status: "status", lead: "lead" }, d: "enrolledAt", f: ["id", "saas", "sequence", "lead", "status", "stepIndex", "nextRunAt", "pendingChannel", "exitReason", "enrolledAt"] },
  drip_templates: { g: "Marketing", label: "Conteúdo dos passos (drip)", alias: ["drip_template", "template_drip"], q: { saas: "saas", channel: "channel" }, f: ["id", "saas", "name", "channel", "subject"] },
  social_posts: { g: "Marketing", label: "Publicações orgânicas", alias: ["post", "posts", "social"], d: "at", f: ["id", "saas", "at", "format", "kind", "caption", "networks", "author"], note: "`results` guarda o retorno de cada rede (o permalink sai de lá): peça em `fields`." },
  social_comments: { g: "Marketing", label: "Comentários de IG/Facebook", alias: ["comentario", "comentarios"], d: "at", f: ["id", "saas", "network", "postId", "postTitle", "author", "text", "ours", "hidden", "done", "at"], note: "a fila da tela é o comentário que NÃO é nosso (`ours:false`) e ainda não foi respondido/escondido/marcado — não existe campo `status`." },
  social_stories: { g: "Marketing", label: "Stories capturados", alias: ["story", "stories"], d: "at", f: ["id", "saas", "at", "type", "caption", "reach", "views", "replies", "shares", "totalInteractions"] },
  social_assets: { g: "Marketing", label: "Mídia das publicações", alias: ["midia_social"], sens: "bytes base64 — nunca saem inteiros.", f: ["id", "mime", "saas"] },

  // ── Formulários e propostas
  forms: { g: "Formulários", label: "Formulários", alias: ["form", "formulario", "formularios"], q: { saas: "saas" }, f: ["id", "saas", "name", "status"], note: "`questions`/`theme` são grandes: peça em `fields` quando precisar. A página pública é /f/:id — o id É o endereço, não existe slug." },
  form_submissions: { g: "Formulários", label: "Respostas de formulário", alias: ["submission", "submissions", "resposta", "respostas"], q: { form: "form", saas: "saas" }, d: "createdAt", f: ["id", "saas", "form", "lead", "pain", "createdAt"] },
  form_events: { g: "Formulários", label: "Eventos do formulário (funil de preenchimento)", alias: ["evento_form", "eventos_form"], big: true, d: "createdAt", f: ["id", "saas", "form", "session", "event", "key", "variant", "pain", "createdAt"], note: "a maior tabela do banco (~19k linhas/10MB) e a API não tem filtro pra ela: qualquer leitura carrega tudo antes de recortar aqui." },
  proposal_templates: { g: "Propostas", label: "Modelos de proposta", alias: ["template_proposta", "templates_proposta"], q: { saas: "saas" }, f: ["id", "saas", "name", "status", "acceptStage"] },
  proposals: { g: "Propostas", label: "Propostas geradas", alias: ["proposta", "propostas", "proposal"], q: { saas: "saas", lead: "lead", template: "template" }, d: "createdAt", f: ["id", "saas", "template", "lead", "name", "views", "accepted", "sharedFrom", "sharedOffer", "createdAt"], note: "o documento mais pesado do banco (~8kB por linha, por causa de `slides`): sem projeção, 50 propostas são 400kB." },

  // ── Operação
  tasks: { g: "Operação", label: "Tarefas (kanban)", alias: ["task", "tarefa", "tarefas"], q: { saas: "saas", column: "column" }, d: "dueDate", f: ["id", "saas", "title", "column", "assignees", "priority", "dueDate", "labels", "order"], note: "o filtro `assignee` da API olha dentro do array `assignees`; aqui use where.assignees com `contains`." },
  task_boards: { g: "Operação", label: "Quadros de tarefa", alias: ["quadro", "quadros", "board"], f: ["id", "name", "columns"] },
  agenda_blocks: { g: "Operação", label: "Bloqueios e compromissos de agenda", alias: ["agenda", "bloqueio", "bloqueios"], d: "date", f: ["id", "saas", "user", "users", "kind", "title", "recur", "date", "weekday", "allDay", "fromHour", "toHour", "reason"] },
  mindmaps: { g: "Operação", label: "Mapas mentais", alias: ["mapa", "mapas", "mindmap"], d: "createdAt", f: ["id", "name", "saas", "createdAt"], note: "`nodes`/`links` são o mapa inteiro: peça em `fields` para abrir um." },

  // ── WhatsApp
  wa_alerts: { g: "WhatsApp", label: "Alertas do fluxo de ligação", alias: ["alerta", "alertas"], d: "at", f: ["id", "saas", "leadId", "thread", "phone", "name", "kind", "status", "at"] },
  wa_calls: { g: "WhatsApp", label: "Ligações pelo WhatsApp", alias: ["ligacao", "ligacoes"], d: "startedAt", f: ["id", "saas", "leadId", "thread", "phone", "status", "author", "startedAt"] },
  wa_automations: { g: "WhatsApp", label: "Automações do inbox", alias: ["automacao", "automacoes"], f: ["id", "saas", "name", "trigger", "keyword", "active", "cooldownHours"], note: "ligar/desligar é o booleano `active` (não existe `status`); regra nova nasce desativada de propósito." },
  wa_flows: { g: "WhatsApp", label: "Fluxos de conversa", alias: ["fluxo", "fluxos"], f: ["id", "saas", "name", "active", "trigger"], note: "ligar/desligar é o booleano `active`; `nodes` é o fluxo inteiro — peça em `fields`." },

  // ── Treinamento
  flashcards: { g: "Treinamento", label: "Flashcards", alias: ["flashcard", "card_treino"], f: ["id"], note: "UM doc por produto (o id É o id do produto): os cards moram no array `cards` e as regras em `settings` — peça em `fields`. Não existe uma linha por card." },
  training_states: { g: "Treinamento", label: "Estado FSRS por pessoa", alias: ["treino_estado"], f: ["id", "saas", "user"], note: "UM doc por produto×pessoa (id `saas__user`): o agendamento (due/stability/difficulty) fica no mapa `cards`, indexado pelo card — peça `cards` em `fields`." },
  training_reviews: { g: "Treinamento", label: "Log de revisões", alias: ["revisao", "revisoes"], big: true, d: "at", f: ["id", "user", "saas", "cardId", "role", "rating", "ms", "at"] },
  training_attempts: { g: "Treinamento", label: "Tentativas (legado)", alias: ["tentativa", "tentativas"], note: "coleção legada, sem escrita nova no código atual: use collections_catalog collection=training_attempts para ver o shape do que sobrou." },
  training_exams: { g: "Treinamento", label: "Provas de checkpoint", alias: ["prova", "provas", "exame"], sens: "guarda gabarito de prova pendente.", d: "createdAt", f: ["id", "user", "saas", "status", "score", "createdAt", "finishedAt"] },
  training_fun: { g: "Treinamento", label: "Estudo livre (4fun)", alias: ["4fun"], d: "at", f: ["id", "user", "saas", "cardId", "role", "rating", "at"] },
  training_assets: { g: "Treinamento", label: "Imagens dos flashcards", alias: ["imagem_treino"], sens: "bytes base64 — nunca saem inteiros.", f: ["id", "saas", "mime", "size", "at"] },
};

// Fechadas no servidor (não saem pelo CRUD genérico). `sessions` é a única que
// este módulo se recusa a tocar por conta própria: são tokens de sessão.
const FECHADAS = {
  sessions: "tokens de sessão — nunca são expostos.",
  user_assets: "foto de perfil (base64); veja /public/users/:id.",
  activity_assets: "foto anexada a um toque; veja /public/activities/:id.",
  task_assets: "foto anexada a uma tarefa; veja /public/tasks/:id.",
  wa_threads: "inbox do WhatsApp — só pelas rotas dedicadas /api/whatsapp/*.",
  wa_messages: "texto das conversas de WhatsApp — só pelas rotas dedicadas /api/whatsapp/*.",
  wa_media: "cache binário de mídia recebida.",
  wa_template_media: "imagem padrão de template.",
};

// O que o servidor faz ALÉM de gravar. Fica escrito na resposta da escrita
// porque nada disso é reversível por um segundo PATCH.
const EFEITOS = {
  leads: {
    create: [
      "DEDUP: mesmo telefone/e-mail no mesmo produto NÃO cria card novo — mescla no existente e devolve ele (campo _dedup).",
      "avisa no Discord, carimba createdAt/stageSince/owner/nextActionAt e loga a activity de nascimento.",
      "gera a proposta nativa quando o produto tem template publicado.",
      "criar já numa etapa de call SEM callAt é recusado com 422 (CALL_SEM_HORARIO).",
    ],
    update: [
      "mudar `stage` roda o movimento de funil: recarimba stageSince, re-agenda o próximo toque, loga no histórico e pode exigir horário de call (422).",
      "mover para etapa de ganho CRIA cliente + assinatura + fatura.",
      "mexer em `callAt`/`closer` cria ou MOVE o evento do Google Meet — o lead recebe e-mail.",
      "mexer em `callAt`/`followupAt` limpa o outro compromisso futuro (um por vez) e arquiva a call passada em callHistory.",
      "editar amount/planClosed/paymentMethod num lead já convertido re-espelha em cliente e assinatura.",
    ],
  },
  subscriptions: {
    create: ["abre o primeiro ciclo, emite a fatura inicial e recalcula o ARR do cliente."],
    update: ["status=canceled CANCELA A COBRANÇA REAL no Mercado Pago e recalcula o ARR do cliente."],
    delete: ["recalcula o ARR do cliente (a receita do produto cai junto)."],
  },
  customers: { update: ["editar `arr` volta pro lead de origem (amount) e re-espelha na assinatura."] },
  consultations: {
    create: ["cria evento no Google Calendar da responsável e garante o Manual da Família do cliente."],
    update: ["move/cancela o evento na agenda da responsável E o evento do Meet — o cliente recebe e-mail."],
    delete: ["APAGA o evento do Google Calendar e cancela o convite do cliente."],
  },
  forms: { create: ["sincroniza as perguntas do produto (leadQuestions)."], update: ["sincroniza as perguntas do produto (leadQuestions)."] },
  invoices: { update: ["baixa manual de fatura avisa no Discord e mexe no estado da assinatura."] },
  campaigns: { create: ["prepara disparo de e-mail/WhatsApp para pessoas reais."], update: ["ativar (status) começa a mandar mensagem para pessoas reais."] },
  sequences: { update: ["status=active passa a inscrever leads e a disparar mensagens reais."] },
  wa_automations: { update: ["ativar faz o inbox responder sozinho a pessoas reais."] },
  wa_flows: { update: ["ativar faz o inbox conduzir conversas com pessoas reais."] },
  products: { update: ["editar `funnel` por aqui NÃO migra os cards (lead.stage guarda o nome, sem FK) — renomear etapa órfã o pipeline inteiro; use PUT /api/products/:id/funnel."] },
  contract_issues: { create: ["createdAt e author são carimbados pelo servidor (registro de auditoria)."] },
  integration_forms: { create: ["o servidor gera o id (é o token do link público /fi/:id), força status=pendente e carimba autor/data."] },
  deliverables: { create: ["nasce com as 6 seções do template quando `sections` vem vazio."] },
  activities: { create: ["atualiza as denormalizações do lead (último contato, tentativas) e re-agenda o próximo passo."] },
};

const GRANDES = "form_events, lp_events, activities, mp_payments, ad_insights, training_reviews";

// ─── Resolução de nome ──────────────────────────────────────────────────────

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, "_");

const APELIDOS = (() => {
  const m = {};
  for (const [nome, meta] of Object.entries(CATALOG)) {
    m[nome] = nome;
    m[nome.replace(/_/g, "")] = nome;
    for (const a of meta.alias || []) m[norm(a)] = nome;
  }
  // "negócio" é o card do funil na boca do time, não a coleção legada `deals`.
  m.negocio = "leads"; m.negocios = "leads";
  return m;
})();

function distancia(a, b) {
  const m = a.length; const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Erro de nome tem que ensinar o nome certo, senão a próxima chamada erra igual.
function parecidas(alvo) {
  const chaves = Object.keys(APELIDOS);
  const pontuadas = chaves
    .map((k) => ({ k, colecao: APELIDOS[k], d: alvo.length >= 3 && (k.includes(alvo) || alvo.includes(k)) ? 0 : distancia(k, alvo) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(alvo.length / 3)))
    .sort((a, b) => a.d - b.d);
  return [...new Set(pontuadas.map((x) => x.colecao))].slice(0, 8);
}

function resolveCollection(entrada) {
  const alvo = norm(entrada);
  if (!alvo) throw new ApiError("informe `collection` (use collections_catalog para ver a lista).", { status: 400 });
  if (FECHADAS[alvo]) {
    throw new ApiError(`a coleção "${alvo}" é fechada: ${FECHADAS[alvo]}`, { status: 403, detail: "nenhuma tool deste módulo lê ou escreve nela." });
  }
  const nome = APELIDOS[alvo];
  if (!nome) {
    const sug = parecidas(alvo);
    throw new ApiError(
      `coleção "${entrada}" não existe.${sug.length ? ` Você quis dizer: ${sug.join(", ")}?` : ""}`,
      { status: 404, detail: `rode collections_catalog para ver as ${Object.keys(CATALOG).length} coleções e seus apelidos.` },
    );
  }
  return { nome, meta: CATALOG[nome] };
}

// ─── Recorte e limpeza das linhas ───────────────────────────────────────────

const SEGREDO = /(token|secret|senha|password|passwordhash|refresh|api_?key|client_?secret|hash|credential)/i;
const MAX_TEXTO = 400;
const MAX_OBJ = 700;

// Nunca despejar o documento cru: segredo vira "«oculto»", texto/base64 gigante
// vira marcador de tamanho. O marcador é de propósito — o modelo precisa saber
// que o campo EXISTE e como pedi-lo, senão conclui que está vazio.
function enxuga(row, mantem = new Set()) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SEGREDO.test(k)) { out[k] = "«oculto»"; continue; }
    if (mantem.has(k)) { out[k] = v; continue; }
    if (typeof v === "string" && v.length > MAX_TEXTO) { out[k] = `«${v.length} chars — peça em fields»`; continue; }
    if (v && typeof v === "object") {
      const s = JSON.stringify(v);
      if (s.length > MAX_OBJ) { out[k] = `«${Array.isArray(v) ? `${v.length} itens` : `${s.length} chars`} — peça em fields»`; continue; }
    }
    out[k] = v;
  }
  return out;
}

// Data do documento → dia do negócio. Competência "YYYY-MM" conta como o dia 1º
// pra cair dentro de uma janela de mês.
function diaDe(v) {
  const s = String(v ?? "");
  if (!s) return "";
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return dayKey(s);
}

const temJanela = (period, since, until) => !!(period || since || until);

// Filtro do servidor: o CRUD genérico só aceita alguns parâmetros por coleção,
// e é o que separa "trouxe 300 linhas" de "trouxe a tabela toda".
function queryDoServidor(meta, where, p, dateField) {
  const q = {};
  for (const [campo, param] of Object.entries(meta.q || {})) {
    const v = where?.[campo];
    if (v == null || v === "" || (typeof v === "object")) continue;
    q[param] = String(v);
  }
  // `activities` é a única com filtro de data no servidor (a.at >= since): é o
  // que evita varrer o histórico inteiro pra responder "toques desta semana".
  if (meta.sinceParam && p && dateField === meta.d) q.since = p.since;
  return q;
}

async function carrega(nome, meta, query) {
  const rows = await http.get(meta.endpoint || `/api/${encodeURIComponent(nome)}`, query);
  return Array.isArray(rows) ? rows : (rows ? [rows] : []);
}

function janela(rows, dateField, p) {
  if (!dateField || !p) return rows;
  return rows.filter((r) => {
    const d = diaDe(at(r, dateField));
    return d && d >= p.since && d <= p.until;
  });
}

function somas(rows, campos) {
  if (!campos?.length) return {};
  const t = {};
  for (const c of campos) t[c] = round2(rows.reduce((a, r) => a + num(at(r, c)), 0));
  return t;
}

const BRL = new Set(["amount", "arr", "mrr", "price", "spend", "netAmount", "fee", "fixed", "variableCap", "value", "revenue"]);
// `registros` é a contagem do recorte e sai em TODA leitura: declarar a unidade
// dele aqui evita número sem régua no relatório.
const unidades = (campos) => ({ registros: "contagem", ...Object.fromEntries((campos || []).map((c) => [c, BRL.has(c) ? "BRL" : "contagem"])) });

// Unidade por operação de records_aggregate. `min`/`max` ficam de fora de
// propósito: devolvem o VALOR do campo (data, texto), não um número somado.
const UNIDADE_OP = {
  count: () => "contagem",
  distinct: () => "contagem",
  sum: (campo) => (BRL.has(campo) ? "BRL" : "contagem"),
  avg: (campo) => (BRL.has(campo) ? "BRL" : "contagem"),
};

// ─── Tools ──────────────────────────────────────────────────────────────────

export function registerDataTools(tool) {
  const G = "Dados (coleções)";

  tool("collections_catalog", {
    group: G,
    title: "Catálogo das coleções",
    description: "Quais coleções existem, com apelidos, filtros aceitos e campo de data; com `collection`, os campos reais dos documentos.",
    input: {
      collection: z.string().optional().describe("Detalha UMA coleção: campos reais dos documentos."),
      q: z.string().optional(),
      group: z.string().optional().describe("Grupo (ex. Funil, Financeiro)."),
      counts: z.boolean().optional().describe("Conta documentos: lê TODAS as tabelas."),
      sample: z.number().int().optional().describe("Amostra no modo detalhe (padrão 200)."),
    },
  }, async ({ collection, q, group, counts = false, sample = 200 }) => {
    // A lista viva da API manda: coleção nova aparece aqui sem ninguém editar
    // este arquivo (o buraco que o mapa de apelidos antigo criava).
    const health = await http.get("/api/health").catch(() => null);
    const vivas = Array.isArray(health?.collections) ? health.collections : Object.keys(CATALOG);

    if (collection) {
      const { nome, meta } = resolveCollection(collection);
      const rows = await carrega(nome, meta, {});
      const amostra = rows.slice(0, Math.max(1, Math.min(sample, 1000)));
      const campos = new Map();
      for (const r of amostra) {
        if (!r || typeof r !== "object") continue;
        for (const [k, v] of Object.entries(r)) {
          const c = campos.get(k) || { campo: k, tipo: new Set(), presente: 0, exemplos: new Set() };
          c.presente += 1;
          c.tipo.add(v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
          if (!SEGREDO.test(k) && c.exemplos.size < 4 && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
            const s = String(v);
            if (s && s.length <= 40) c.exemplos.add(s);
          }
          campos.set(k, c);
        }
      }
      const linhas = [...campos.values()]
        .map((c) => ({
          campo: c.campo,
          tipo: [...c.tipo].join("|"),
          presente_pct: amostra.length ? Math.round((c.presente / amostra.length) * 100) : 0,
          exemplos: [...c.exemplos].join(" · "),
          curado: (meta.f || []).includes(c.campo),
        }))
        .sort((a, b) => b.presente_pct - a.presente_pct || a.campo.localeCompare(b.campo));

      const efeitos = EFEITOS[nome] || {};
      return result({
        kind: "collections.detail",
        title: `Coleção ${nome} · ${meta.label}`,
        scope: { collection: nome, grupo: meta.g, escrita: meta.ro ? "leitura apenas" : "sim" },
        units: { documentos: "contagem", amostrados: "contagem", campos: "contagem", presente_pct: "%" },
        totals: {
          documentos: rows.length,
          amostrados: amostra.length,
          campos: linhas.length,
          filtros_no_servidor: Object.values(meta.q || {}).join(", ") || "nenhum",
          campo_de_data: meta.d || "—",
          apelidos: (meta.alias || []).join(", ") || "—",
        },
        columns: ["campo", "tipo", "presente_pct", "exemplos", "curado"],
        rows: linhas,
        rowsLabel: "Campos observados",
        tables: Object.keys(efeitos).length ? {
          efeitos: {
            label: "Efeitos colaterais da escrita",
            columns: ["operacao", "efeito"],
            rows: Object.entries(efeitos).flatMap(([op, lista]) => lista.map((efeito) => ({ operacao: op, efeito }))),
          },
        } : {},
        notes: [
          meta.note,
          meta.sens && `SENSÍVEL: ${meta.sens}`,
          meta.big && "coleção grande: records_list exige filtro ou janela.",
          `projeção padrão de records_list: ${(meta.f || []).join(", ") || "todos os campos (enxutos)"}.`,
        ].filter(Boolean),
        source: { endpoint: `GET ${meta.endpoint || `/api/${nome}`}` },
      });
    }

    let contagens = {};
    if (counts) {
      const nomes = Object.keys(CATALOG).filter((n) => !CATALOG[n].big);
      const res = await Promise.all(nomes.map((n) => carrega(n, CATALOG[n], {}).then((r) => [n, r.length]).catch(() => [n, null])));
      contagens = Object.fromEntries(res);
    }

    const linhas = Object.entries(CATALOG).map(([nome, meta]) => ({
      colecao: nome,
      grupo: meta.g,
      label: meta.label,
      apelidos: (meta.alias || []).join(", "),
      filtros: Object.values(meta.q || {}).join(", ") || "—",
      campos: ((meta.f || []).slice(0, 8).join(", ") + ((meta.f || []).length > 8 ? " …" : "")) || "—",
      data: meta.d || "—",
      escrita: meta.ro ? "não" : "sim",
      obs: [meta.big ? "grande: exige filtro" : "", meta.sens ? "sensível" : "", vivas.includes(nome) ? "" : "ausente na API"].filter(Boolean).join(" · ") || "",
      ...(counts ? { docs: contagens[nome] ?? null } : {}),
    }));

    const filtradas = linhas.filter((l) =>
      (!group || norm(l.grupo) === norm(group))
      && (!q || `${l.colecao} ${l.grupo} ${l.label} ${l.apelidos}`.toLowerCase().includes(String(q).toLowerCase())));

    const desconhecidas = vivas.filter((n) => !CATALOG[n] && !FECHADAS[n]);
    return result({
      kind: "collections.catalog",
      title: "Coleções do Cockpit",
      units: { no_catalogo: "contagem", na_api: "contagem", fechadas: "contagem", listadas: "contagem", docs: "contagem" },
      totals: {
        no_catalogo: Object.keys(CATALOG).length,
        na_api: vivas.length,
        fechadas: Object.keys(FECHADAS).length,
        listadas: filtradas.length,
      },
      columns: ["colecao", "grupo", "label", "apelidos", "filtros", "campos", "data", "escrita", "obs", ...(counts ? ["docs"] : [])],
      rows: filtradas,
      rowsLabel: "Coleções",
      tables: {
        fechadas: {
          label: "Fechadas no servidor (não saem por aqui)",
          columns: ["colecao", "motivo"],
          rows: Object.entries(FECHADAS).map(([colecao, motivo]) => ({ colecao, motivo })),
        },
        ...(desconhecidas.length ? {
          novas: { label: "Na API e ainda sem metadados aqui", columns: ["colecao"], rows: desconhecidas.map((colecao) => ({ colecao })) },
        } : {}),
      },
      notes: [
        `coleções grandes (${GRANDES}) exigem filtro ou janela em records_list.`,
        "o CRUD genérico não pagina no servidor: records_list carrega a coleção e recorta aqui — sempre projete `fields` no que for grande.",
        counts ? "contagem omite as coleções grandes (leitura cara)." : "passe counts=true para contar documentos (lê todas as tabelas).",
      ],
      source: { endpoint: "GET /api/health", build: health?.build || null },
    });
  });

  tool("records_list", {
    group: G,
    title: "Listar registros",
    description: `Linhas de qualquer coleção com filtro, busca, janela de datas, ordenação e paginação, com somas de dinheiro. Grandes (${GRANDES}) exigem recorte.`,
    input: {
      collection: z.string().describe("Nome ou apelido; aceita português: negocio, cliente, fatura."),
      where: z.record(z.any()).optional().describe('{"saas":"leverads","amount":{"gte":1000}}. Operadores: in, not, gte, lte, gt, lt, contains, exists.'),
      q: z.string().optional().describe("Busca livre nos campos principais."),
      ...periodInput(z),
      date_field: z.string().optional().describe("Padrão: o campo de data da coleção."),
      fields: z.array(z.string()).optional().describe("Padrão: os campos que a tela usa; aceita ponto."),
      sort: z.union([z.string(), z.array(z.string())]).optional().describe('"createdAt:desc" ou ["stage","amount:desc"].'),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
      count_only: z.boolean().optional().describe("Só o total do recorte, sem as linhas."),
    },
  }, async ({ collection, where, q, period, since, until, date_field, fields, sort, limit = 50, offset = 0, count_only = false }) => {
    const { nome, meta } = resolveCollection(collection);
    const comJanela = temJanela(period, since, until);
    const p = comJanela ? resolvePeriod({ period, since, until }) : null;
    const dateField = date_field || meta.d || "";

    if (meta.big && !comJanela && !q && !Object.keys(where || {}).length) {
      throw new ApiError(
        `"${nome}" é uma coleção grande: informe um filtro (\`where\`), uma busca (\`q\`) ou uma janela (\`period\`/\`since\`).`,
        { status: 400, detail: `sem recorte, a leitura carrega a tabela inteira. Campo de data desta coleção: ${meta.d || "—"}.` },
      );
    }
    if (comJanela && !dateField) {
      throw new ApiError(`"${nome}" não tem campo de data padrão: informe \`date_field\` para usar a janela.`, { status: 400 });
    }

    const brutas = await carrega(nome, meta, queryDoServidor(meta, where, p, dateField));
    const naJanela = janela(brutas, p ? dateField : "", p);

    let filtradas = where ? naJanela.filter((r) => matches(r, where)) : naJanela;
    if (q) filtradas = search(filtradas, q, meta.f);
    if (sort) filtradas = sortRows(filtradas, sort);

    const lim = Math.max(1, Math.min(Number(limit) || 50, 500));
    const off = Math.max(0, Number(offset) || 0);
    const pagina = count_only ? [] : filtradas.slice(off, off + lim);

    const projecao = fields?.length ? fields : meta.f;
    const mantem = new Set(fields || []);
    const linhas = pagina.map((r) => enxuga(projecao?.length ? pick(r, projecao) : r, mantem));

    const totais = { registros: filtradas.length, ...somas(filtradas, meta.sum) };
    const page = {
      total: filtradas.length,
      totalBeforeFilter: brutas.length,
      returned: linhas.length,
      limit: lim,
      offset: off,
      truncated: !count_only && filtradas.length > off + linhas.length,
    };

    return result({
      kind: "records.list",
      title: `${meta.label} (${nome})`,
      scope: { collection: nome, filtro: where ? JSON.stringify(where) : null, busca: q || null, campo_de_data: p ? dateField : null },
      period: p || undefined,
      units: unidades(meta.sum),
      totals: totais,
      columns: projecao?.length ? projecao : undefined,
      rows: count_only ? [] : linhas,
      rowsLabel: meta.label,
      page,
      notes: [
        meta.note,
        meta.sens && `SENSÍVEL: ${meta.sens}`,
        meta.ro && "coleção de leitura apenas neste módulo.",
        !fields?.length && meta.f?.length && "projeção padrão aplicada: peça `fields` para outros campos do documento.",
        "somas cobrem TODO o recorte filtrado, não só a página.",
      ].filter(Boolean),
      source: { endpoint: `GET ${meta.endpoint || `/api/${nome}`}` },
    });
  });

  tool("records_get", {
    group: G,
    title: "Ler um registro",
    description: "Conteúdo de um documento por id; campo gigante sai como marcador, peça-o em `fields`.",
    input: {
      collection: z.string(),
      id: z.string(),
      fields: z.array(z.string()).optional().describe("Vêm INTEIROS (é como se lê slides, questions, nodes)."),
    },
  }, async ({ collection, id, fields }) => {
    const { nome, meta } = resolveCollection(collection);
    let doc;
    if (meta.endpoint) {
      const todos = await carrega(nome, meta, {});
      doc = todos.find((r) => String(r.id) === String(id)) || null;
      if (!doc) throw new ApiError(`${nome}/${id} não encontrado.`, { status: 404 });
    } else {
      doc = await http.get(`/api/${encodeURIComponent(nome)}/${encodeURIComponent(id)}`);
    }
    const mantem = new Set(fields || []);
    const corpo = enxuga(fields?.length ? pick(doc, fields) : doc, mantem);
    return result({
      kind: "records.get",
      title: `${meta.label} · ${id}`,
      scope: { collection: nome, id },
      detail: corpo,
      notes: [
        meta.note,
        meta.sens && `SENSÍVEL: ${meta.sens}`,
        !fields?.length && "campos muito grandes vieram como marcador de tamanho — peça-os em `fields`.",
      ].filter(Boolean),
      source: { endpoint: `GET ${meta.endpoint || `/api/${nome}/${id}`}` },
    });
  });

  tool("records_aggregate", {
    group: G,
    title: "Agrupar e somar",
    description: "Contagem, soma, média, mínimo, máximo e distintos de uma coleção, por campo(s) e/ou período.",
    input: {
      collection: z.string(),
      metrics: z.array(z.string()).optional().describe('"count", "sum:amount", "avg:score", "min:createdAt", "distinct:lead". Padrão: count + somas de dinheiro.'),
      group_by: z.array(z.string()).optional().describe('Ex.: ["saas","stage"]. Vazio = só os totais.'),
      bucket: z.enum(["day", "week", "month", "quarter", "year"]).optional().describe("Agrupa também por período do `date_field`."),
      date_field: z.string().optional().describe("Padrão: o campo de data da coleção."),
      ...periodInput(z),
      where: z.record(z.any()).optional().describe("Mesmo filtro de records_list."),
      q: z.string().optional().describe("Busca livre antes de agregar."),
      sort: z.string().optional().describe('"count:desc" (padrão), "sum_amount:desc", "grupo".'),
      limit: z.number().int().optional(),
      compare: z.boolean().optional().describe("Compara os totais com o período anterior (exige janela)."),
    },
  }, async ({ collection, metrics, group_by, bucket, date_field, period, since, until, where, q, sort = "count:desc", limit = 50, compare = false }) => {
    const { nome, meta } = resolveCollection(collection);
    const comJanela = temJanela(period, since, until);
    const p = comJanela || bucket || compare ? resolvePeriod({ period, since, until }) : null;
    const dateField = date_field || meta.d || "";

    if ((bucket || p) && !dateField) {
      throw new ApiError(`"${nome}" não tem campo de data padrão: informe \`date_field\` para usar janela ou bucket.`, { status: 400 });
    }
    if (meta.big && !p && !Object.keys(where || {}).length && !q) {
      throw new ApiError(`"${nome}" é uma coleção grande: informe \`where\`, \`q\` ou uma janela.`, { status: 400 });
    }

    const specs = (metrics?.length ? metrics : ["count", ...(meta.sum || []).map((c) => `sum:${c}`)]).map((m) => {
      const [op, campo = ""] = String(m).split(":");
      return { op: op.toLowerCase(), campo, nome: campo ? `${op.toLowerCase()}_${campo.replace(/\./g, "_")}` : "count" };
    });

    const brutas = await carrega(nome, meta, queryDoServidor(meta, where, p, dateField));

    const agregar = (rows) => {
      const mapa = new Map();
      const chaves = [...(group_by || []), ...(bucket ? ["periodo"] : [])];
      for (const r of rows) {
        const valores = (group_by || []).map((g) => {
          const v = at(r, g);
          return v == null || v === "" ? "—" : String(v);
        });
        if (bucket) valores.push(bucketKey(diaDe(at(r, dateField)), bucket) || "—");
        const k = valores.join(" ¦ ") || "todos";
        let g = mapa.get(k);
        if (!g) {
          g = { _chave: k, _linhas: [], ...Object.fromEntries(chaves.map((c, i) => [c === "periodo" ? "periodo" : c, valores[i]])) };
          mapa.set(k, g);
        }
        g._linhas.push(r);
      }
      return [...mapa.values()].map((g) => {
        const out = { ...g };
        delete out._linhas; delete out._chave;
        for (const s of specs) out[s.nome] = calcula(s, g._linhas);
        return out;
      });
    };

    let filtradas = janela(brutas, p ? dateField : "", p);
    if (where) filtradas = filtradas.filter((r) => matches(r, where));
    if (q) filtradas = search(filtradas, q, meta.f);

    const grupos = agregar(filtradas);
    const totais = { registros: filtradas.length, ...Object.fromEntries(specs.map((s) => [s.nome, calcula(s, filtradas)])) };

    // Participação de cada grupo: é o que responde "quanto isso pesa" sem o
    // consumidor dividir errado. Só faz sentido quando `count` foi pedido.
    const temCount = specs.some((s2) => s2.op === "count");
    const base = temCount ? num(totais.count) : 0;
    for (const g of grupos) if (base) g.share_pct = round2((num(g.count) / base) * 100);

    const [campoOrd, dirOrd] = String(sort).split(":");
    const ordenadas = sortRows(grupos, `${campoOrd}:${dirOrd || "desc"}`);
    const lim = Math.max(1, Math.min(Number(limit) || 50, 500));
    const pagina = ordenadas.slice(0, lim);

    let comparativo = null;
    if (compare && p) {
      try {
        const ant = janela(await carrega(nome, meta, queryDoServidor(meta, where, p.previous, dateField)), dateField, p.previous);
        let f2 = where ? ant.filter((r) => matches(r, where)) : ant;
        if (q) f2 = search(f2, q, meta.f);
        comparativo = Object.fromEntries(
          specs.map((s) => [s.nome, delta(calcula(s, filtradas), calcula(s, f2))]).filter(([, v]) => v),
        );
      } catch { /* comparação é bônus: sem ela o relatório ainda vale */ }
    }

    const colunas = [...(group_by || []), ...(bucket ? ["periodo"] : []), ...specs.map((s) => s.nome), ...(base ? ["share_pct"] : [])];
    return result({
      kind: "records.aggregate",
      title: `${meta.label} · ${(group_by || []).join(" × ") || "total"}${bucket ? ` por ${bucket}` : ""}`,
      scope: { collection: nome, group_by: (group_by || []).join(", ") || null, bucket: bucket || null, campo_de_data: p ? dateField : null },
      period: p || undefined,
      // min/max devolvem o VALOR do campo (data, texto), não um número somado:
      // carimbar unidade neles mentiria, então só count/distinct/sum/avg saem aqui.
      units: { registros: "contagem", ...Object.fromEntries(specs.map((s) => [s.nome, UNIDADE_OP[s.op]?.(s.campo)]).filter(([, u]) => u)), share_pct: "%" },
      totals: { ...totais, ...(comparativo || {}) },
      columns: colunas,
      rows: pagina,
      rowsLabel: "Grupos",
      page: { total: grupos.length, returned: pagina.length, limit: lim, offset: 0, truncated: grupos.length > pagina.length },
      notes: [
        meta.note,
        "a agregação roda no MCP sobre o recorte carregado — o CRUD genérico não agrega no banco.",
        compare && !comparativo && "não deu para calcular o período anterior.",
      ].filter(Boolean),
      source: { endpoint: `GET ${meta.endpoint || `/api/${nome}`}` },
    });
  });

  tool("records_create", {
    group: G,
    title: "Criar registro",
    description: "Cria um documento e devolve o que o servidor fez além de gravar (dedup, fatura, evento, aviso).",
    write: true,
    external: true,
    danger: "criar lead avisa no Discord e gera proposta; criar assinatura emite fatura e mexe no ARR; criar consulta cria evento na agenda de uma pessoa real.",
    hint: "confira o nome da coleção com collections_catalog e os campos esperados com collections_catalog collection=<nome>.",
    input: {
      collection: z.string(),
      data: z.record(z.any()).describe("Campos do documento; o servidor completa os defaults."),
      dry_run: z.boolean().optional().describe("Não grava: mostra o envio e os efeitos previstos."),
    },
  }, async ({ collection, data, dry_run = false }) => {
    const { nome, meta } = resolveCollection(collection);
    if (meta.ro) throw new ApiError(`"${nome}" é leitura apenas neste módulo.`, { status: 403, detail: meta.note || "" });
    const efeitos = [...(EFEITOS[nome]?.create || [])];

    if (dry_run) {
      return result({
        kind: "records.create.dry_run",
        title: `Simulação · criar em ${nome}`,
        scope: { collection: nome, gravado: false },
        detail: data,
        tables: efeitos.length ? { efeitos: { label: "O que o servidor faria além de gravar", columns: ["efeito"], rows: efeitos.map((efeito) => ({ efeito })) } } : {},
        notes: ["nada foi gravado (dry_run). Repita sem dry_run para criar."],
        source: { endpoint: `POST /api/${nome} (não executado)` },
      });
    }

    const criado = await http.post(`/api/${encodeURIComponent(nome)}`, data);
    const dedup = !!criado?._dedup;
    return result({
      kind: "records.create",
      title: dedup ? `Lead JÁ existia · mesclado em ${criado.id}` : `Criado em ${nome} · ${criado?.id}`,
      scope: { collection: nome, id: criado?.id, dedup },
      detail: enxuga(criado),
      tables: efeitos.length ? { efeitos: { label: "O que o servidor fez além de gravar", columns: ["efeito"], rows: efeitos.map((efeito) => ({ efeito })) } } : {},
      notes: dedup ? ["NÃO nasceu card novo: a mesma pessoa (telefone/e-mail) já estava no produto e os dados foram mesclados no card existente."] : [],
      source: { endpoint: `POST /api/${nome}` },
    });
  });

  tool("records_update", {
    group: G,
    title: "Atualizar registro",
    description: "Merge parcial num documento (PATCH), com diff e efeitos disparados; merge RASO: array substitui o inteiro.",
    write: true,
    external: true,
    danger: "cancelar assinatura cancela a cobrança real no Mercado Pago; mover lead para ganho cria cliente/assinatura/fatura; mexer em call ou consulta move evento e manda e-mail para pessoa real.",
    hint: "leia o documento com records_get antes: campos de array (comments, funnel, questions, steps, sent) precisam ser reenviados inteiros.",
    input: {
      collection: z.string(),
      id: z.string(),
      data: z.record(z.any()).describe("Campos a atualizar. Merge RASO: array enviado substitui o inteiro."),
      dry_run: z.boolean().optional().describe("Não grava: mostra o diff e os efeitos previstos."),
    },
  }, async ({ collection, id, data, dry_run = false }) => {
    const { nome, meta } = resolveCollection(collection);
    if (meta.ro) throw new ApiError(`"${nome}" é leitura apenas neste módulo.`, { status: 403, detail: meta.note || "" });

    const antes = await http.get(`/api/${encodeURIComponent(nome)}/${encodeURIComponent(id)}`);
    const efeitos = [...(EFEITOS[nome]?.update || [])];
    const arrays = Object.keys(data).filter((k) => Array.isArray(data[k]) || Array.isArray(antes?.[k]));
    if (arrays.length) efeitos.push(`merge RASO: ${arrays.join(", ")} — o array enviado substitui o que estava lá.`);

    const diff = Object.keys(data).map((k) => ({
      campo: k,
      de: resumo(at(antes, k)),
      para: resumo(data[k]),
      muda: JSON.stringify(at(antes, k)) !== JSON.stringify(data[k]),
    }));

    if (dry_run) {
      return result({
        kind: "records.update.dry_run",
        title: `Simulação · atualizar ${nome}/${id}`,
        scope: { collection: nome, id, gravado: false },
        columns: ["campo", "de", "para", "muda"],
        rows: diff,
        rowsLabel: "Diff",
        tables: efeitos.length ? { efeitos: { label: "O que o servidor faria além de gravar", columns: ["efeito"], rows: efeitos.map((efeito) => ({ efeito })) } } : {},
        notes: ["nada foi gravado (dry_run)."],
        source: { endpoint: `PATCH /api/${nome}/${id} (não executado)` },
      });
    }

    const depois = await http.patch(`/api/${encodeURIComponent(nome)}/${encodeURIComponent(id)}`, data);
    // O servidor mexe em mais campos do que o PATCH mandou (stageSince, GPS,
    // callHistory, canceledAt): mostrar isso é o que evita o modelo achar que
    // só mudou o que ele pediu.
    const carimbados = Object.keys(depois || {})
      .filter((k) => !(k in data) && JSON.stringify(at(antes, k)) !== JSON.stringify(depois[k]))
      .map((campo) => ({ campo, de: resumo(at(antes, campo)), para: resumo(depois[campo]) }));

    return result({
      kind: "records.update",
      title: `Atualizado ${nome}/${id}`,
      scope: { collection: nome, id },
      columns: ["campo", "de", "para", "muda"],
      rows: diff,
      rowsLabel: "Campos enviados",
      tables: {
        ...(carimbados.length ? { servidor: { label: "Mudanças que o SERVIDOR aplicou sozinho", columns: ["campo", "de", "para"], rows: carimbados } } : {}),
        ...(efeitos.length ? { efeitos: { label: "Efeitos colaterais desta escrita", columns: ["efeito"], rows: efeitos.map((efeito) => ({ efeito })) } } : {}),
      },
      detail: enxuga(depois),
      source: { endpoint: `PATCH /api/${nome}/${id}` },
    });
  });

  tool("records_delete", {
    group: G,
    title: "Apagar registro",
    description: "Apaga um documento em definitivo (não há lixeira); sem confirm=true, só o preview do que cai junto.",
    write: true,
    destructive: true,
    external: true,
    danger: "irreversível: não há lixeira. Apagar assinatura reescreve o ARR do cliente; apagar consulta APAGA o evento do Google Calendar e cancela o convite do cliente.",
    input: {
      collection: z.string(),
      id: z.string(),
      confirm: z.boolean().optional().describe("true apaga de verdade; sem isso, só o preview."),
    },
  }, async ({ collection, id, confirm = false }) => {
    const { nome, meta } = resolveCollection(collection);
    if (meta.ro) throw new ApiError(`"${nome}" é leitura apenas neste módulo.`, { status: 403, detail: meta.note || "" });

    const doc = await http.get(`/api/${encodeURIComponent(nome)}/${encodeURIComponent(id)}`);
    const cascatas = EFEITOS[nome]?.delete || [];

    if (!confirm) {
      return result({
        kind: "records.delete.preview",
        title: `Confirmação necessária · apagar ${nome}/${id}`,
        scope: { collection: nome, id, apagado: false },
        detail: enxuga(doc),
        tables: cascatas.length ? { cascatas: { label: "O que cai junto", columns: ["efeito"], rows: cascatas.map((efeito) => ({ efeito })) } } : {},
        notes: ["NADA foi apagado. Repita com confirm=true se for isso mesmo — não há como desfazer."],
        source: { endpoint: `DELETE /api/${nome}/${id} (não executado)` },
      });
    }

    const r = await http.del(`/api/${encodeURIComponent(nome)}/${encodeURIComponent(id)}`);
    return result({
      kind: "records.delete",
      title: `Apagado ${nome}/${id}`,
      scope: { collection: nome, id, apagado: r?.ok !== false },
      detail: enxuga(doc),
      tables: cascatas.length ? { cascatas: { label: "O que caiu junto", columns: ["efeito"], rows: cascatas.map((efeito) => ({ efeito })) } } : {},
      notes: ["registro removido em definitivo (sem lixeira). O documento acima é a última cópia."],
      source: { endpoint: `DELETE /api/${nome}/${id}` },
    });
  });
}

// ─── Auxiliares de agregação ────────────────────────────────────────────────

function bucketKey(dia, bucket) {
  if (!dia) return "";
  if (bucket === "month") return dia.slice(0, 7);
  if (bucket === "year") return dia.slice(0, 4);
  if (bucket === "quarter") return `${dia.slice(0, 4)}-Q${Math.ceil(Number(dia.slice(5, 7)) / 3)}`;
  if (bucket === "week") {
    const t = Date.parse(`${dia}T12:00:00Z`);
    if (!Number.isFinite(t)) return dia;
    const dow = (new Date(t).getUTCDay() + 6) % 7; // semana começa na segunda
    return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
  }
  return dia;
}

function calcula({ op, campo }, rows) {
  if (op === "count") return rows.length;
  if (op === "distinct") return new Set(rows.map((r) => String(at(r, campo) ?? ""))).size;
  const vals = rows.map((r) => at(r, campo)).filter((v) => v != null && v !== "");
  if (op === "sum") return round2(vals.reduce((a, v) => a + num(v), 0));
  if (op === "avg") return vals.length ? round2(vals.reduce((a, v) => a + num(v), 0) / vals.length) : null;
  if (!vals.length) return null;
  const numericos = vals.every((v) => Number.isFinite(Number(v)));
  const ord = numericos ? vals.map(Number).sort((a, b) => a - b) : vals.map(String).sort();
  return op === "min" ? ord[0] : op === "max" ? ord[ord.length - 1] : null;
}

// Valor curto pra caber numa célula de diff.
function resumo(v) {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 120 ? `«${Array.isArray(v) ? `${v.length} itens` : `${s.length} chars`}»` : s;
  }
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}
