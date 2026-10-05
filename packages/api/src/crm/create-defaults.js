import { BOARD_DEFAULTS, TASK_DEFAULTS } from "../tasks/tasks-core.js";

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
  // endedAt/churn* = saída do cliente (churn): gravados pelo POST /customers/:id/churn
  // (ou pelo cancelamento da recorrência no MP); endedAt no passado tira o cliente
  // do MRR/rollup e o arr fica congelado como histórico (churn.js).
  customers: { flags: [], health: 0, delta: 0, nps: 0, usage: "", lastTouch: "—", renewal: "—", endedAt: "", churnReason: "", churnNote: "" },
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
  // callAt = call marcada (a de verdade, que vira histórico ao ser remarcada);
  // followupAt = DIA do próximo contato de follow-up ("YYYY-MM-DD", sem hora e
  // sem ocupar agenda, 05/10/2026); campo PRÓPRIO pra a agenda não desenhar
  // follow-up com a cara de call (Leo, 13/08). followupStep = contatos do
  // follow-up já registrados nesta passagem pela etapa (0..4).
  // referredByCustomer/referralCollectedBy/referralAt = indicação (referrals.js):
  // quem indicou (cliente), quem colheu (o prêmio é do coletor) e o carimbo
  // imutável que define a janela da comissão.
  leads: { priority: "P2", score: 0, icp: 0, value: "", amount: 0, owner: "", closer: "", reason: "", source: "Form", age: "agora", stage: "", stageSince: "", comments: [], callAt: "", callSetAt: "", followupAt: "", followupStep: 0, proposalValue: "", proposalPeriod: "", integrationAt: "", nextActionAt: "", nextActionNote: "", lostReason: "", lostNote: "", lastActivityAt: "", lastActivityType: "", stageAttempts: 0, sdrOff: false, referredByCustomer: "", referralCollectedBy: "", referralAt: "" },
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
  // Contas a pagar (Financeiro): lançamento com competência (month), vencimento
  // e situação; favorecido = colaborador (userId → Folha) ou fornecedor (texto).
  // `recurring: true` = template mensal (o próprio doc é a 1ª ocorrência; os
  // meses seguintes viram instâncias com templateId — routes.fin.js).
  payables: { saas: "", description: "", category: "outros", counterpartyType: "fornecedor", userId: "", supplierName: "", amount: 0, month: "", dueDate: "", status: "aberta", paidAt: "", paidVia: "", recurring: false, endMonth: "", templateId: "", notes: "" },
  // Regra de conciliação aprendida: quando o pagador (doc > e-mail > nome) bate,
  // o Financeiro aplica a ação sozinho e não pergunta mais (routes.fin.js).
  fin_rules: { saas: "", matchField: "payerDoc", matchValue: "", action: "vincular", customer: "", reason: "", autoCount: 0, lastAppliedAt: "", createdAt: "" },
  // Kanban de tarefas do time (nível Asana): modelo e regras em tasks-core.js.
  // `column` = KEY estável da coluna do board; `completed` é a régua única de
  // concluída; `parentId` = subtarefa; comments = [{ id, author (id), text, at,
  // editedAt, likes, mentions }]. O POST/PATCH/DELETE genérico passa por
  // createTask/patchTask/deleteTask (carimbos, regras de coluna, eventos).
  tasks: TASK_DEFAULTS,
  task_boards: BOARD_DEFAULTS,
  // Registro manual do dia por pessoa (Análise de Desempenho): social selling
  // feito pela SDR e criativos feitos pelo social media. Escrito pela rota
  // dedicada POST /api/desempenho/:saas/log (id determinístico por pessoa+dia).
  daily_logs: { saas: "", user: "", day: "", socialSelling: 0, creatives: 0, note: "", updatedAt: "" },
  // Timeline do lead (pontos de contato + eventos automáticos). `type` toque =
  // whatsapp/call/email/meeting; `stage` = mudança de estágio (meta {from,to});
  // `system` = evento automático (lead_created, proposal_viewed...). `at` = quando
  // aconteceu (backdate permitido); createdAt = quando entrou no sistema.
  activities: { saas: "", lead: "", type: "note", text: "", meta: {}, author: "", at: "" },
  // Item de agenda (tela Agenda): kind "block" trava horário do dono (user) contra
  // marcação de call/integração; kind "event" é compromisso (título) e TAMBÉM ocupa
  // a agenda. recur "once" usa `date` (YYYY-MM-DD); "weekly" usa `weekday`
  // (0=dom…6=sáb). allDay=true pega o dia todo; senão [fromHour, toHour) — aceita
  // fração (7.5 = 07:30).
  // `users` = participantes (compromisso com mais de uma pessoa ocupa a agenda
  // de todas; `user` segue como dona principal, compat com registros antigos).
  agenda_blocks: { saas: "", user: "", users: [], kind: "block", title: "", recur: "once", date: "", weekday: 0, allDay: false, fromHour: 0, toHour: 0, reason: "", createdAt: "" },
  // Mapa mental / estratégia (tela Mapas mentais). Desde 09/2026 a posição é
  // DERIVADA da árvore: nodes = [{ id, parent, order, text, color, collapsed,
  // note, emoji, image, link, shape, bold, boundary, auto, x, y }] (x/y só
  // valem quando auto=false ou layout="free"), links = [{ id, from, to, label,
  // color, arrow }] (conexões livres). layout = tree|radial|org|list|free.
  // `version` sobe a cada PATCH e serve de trava otimista (baseVersion no
  // body → 409 quando outra pessoa gravou no meio).
  mindmaps: { name: "Novo mapa", saas: "", layout: "tree", theme: "", nodes: [], links: [], slides: [], version: 0, updatedAt: "", updatedBy: "", createdAt: "" },
  // Disparos (ferramenta): uma campanha por produto pra mandar e-mail + WhatsApp
  // pros leads qualificados. `stages` = segmento (etapas do funil que entram);
  // `sent` = progresso por lead ({leadId: {whatsapp, email}}, ISO), mesclado no
  // servidor. channels/email/wa = o que foi composto.
  campaigns: { name: "", saas: "", status: "draft", stages: [], channels: { email: false, whatsapp: true }, email: { subject: "", body: "" }, wa: { text: "" }, sent: {}, createdAt: "", createdBy: "" },
  // Radar de contas do OUTBOUND (Cold Calling 2.0): conta-alvo prospectada pelo
  // SDR, com os 8 status de conta do livro (fria/prospectando/nutrir/
  // oportunidade/encerrada/cliente/sem-perfil/duplicada). "Virar lead" cria um
  // lead com source "Outbound · radar" + outbound:true (classe ALVO no
  // metrics-core) e linka aqui em `leadId`.
  outbound_accounts: { saas: "", name: "", marketplace: "", niche: "", listings: "", reputation: "", city: "", phone: "", email: "", instagram: "", site: "", cnpj: "", notes: "", status: "fria", owner: "", leadId: "", lastTouchAt: "", createdAt: "" },
  // Remuneração por cargo (tela Remuneração, SÓ admin — guard em screens.js):
  // um doc por role (sdr/sdr_outbound/closer/integrator/social) com fixo,
  // variável e as alavancas do modelo do livro. Dado sensível: rota exige a
  // etiqueta admin, além da tela.
  comp_plans: { role: "", fixed: 0, variableCap: 0, commissionPct: 0, acceleratorPct: 0, upsellPct: 0, referralBonus: 0, notes: "", updatedAt: "" },
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
