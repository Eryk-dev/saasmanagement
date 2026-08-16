// Restrição de TELAS por usuário (user.screens) — a autorização do cockpit.
//
// Modelo: `user.screens` é uma lista de ids de tela (espelho do NAV do SPA,
// chrome.jsx). VAZIA/ausente = acesso total (compatível com o time atual).
// Preenchida = o usuário só vê essas telas no SPA E só alcança na API as rotas
// que servem essas telas — esconder o menu sem fechar a API não é restrição.
//
// A chave mestre (COCKPIT_API_KEY) NUNCA é restringida: MCP e integrações
// (forms externos, Levercopy) continuam com acesso total — `req.authUser` só
// existe em sessão de usuário (auth.js/makeAuthHook).
//
// O guard é um hook único por PREFIXO de URL (makeScreenGuardHook), registrado
// logo após o hook de auth no index.js — rota nova que sirva uma tela restrita
// deve entrar no mapa abaixo.

export const SCREEN_IDS = [
  "overview", "today", "pipeline", "customers", "metrics", "expenses",
  "social", "forms", "proposals", "creative", "offers", "contracts", "disparos", "whatsapp", "agenda", "consultas", "calls", "integrations", "aquisicao", "analise", "funcionarios", "metas", "training", "tasks", "mindmaps", "settings",
  "outbound", "remuneracao",
  "eloapp", "landingpages",
];

export const sanitizeScreens = (x) =>
  Array.isArray(x) ? x.filter((s) => SCREEN_IDS.includes(s)) : [];

// Usuário pode acessar a tela? Sem authUser (key mestre) ou lista vazia = sim.
export function canScreen(user, screen) {
  if (!user) return true;
  const s = Array.isArray(user.screens) ? user.screens : [];
  return s.length === 0 || s.includes(screen);
}

// Prefixo de rota → telas que ela serve (basta o usuário ter UMA delas). Ordem
// importa (primeiro match vence). "Meu dia" (today) é uma view sobre os mesmos
// dados do pipeline: leads e toques servem as duas telas. Rotas fora do mapa
// (bootstrap, rev/events, auth próprio, people, leaderboard) ficam liberadas pra
// qualquer sessão — o bootstrap filtra o payload por conta própria (routes.js).
const ROUTE_SCREENS = [
  // Aviso de social selling do Meu dia (só a CONTAGEM de novos seguidores) — o
  // SDR alcança pela fila (today) sem ter a tela de Mídia social. Precede
  // /api/social (primeiro match vence).
  ["/api/social/new-followers", ["today", "pipeline", "overview", "social"]],
  ["/api/social/dms", ["whatsapp", "social"]], // DMs de IG/Messenger no Inbox (tela whatsapp)
  ["/api/social", ["social"]],
  ["/api/marketing", ["metrics", "aquisicao"]],
  ["/api/metrics/", ["metrics", "aquisicao"]],
  ["/api/elo/", ["eloapp", "landingpages", "overview"]],  // agregados do app Elo (Análise do App + Visão geral do workspace)
  ["/api/lp/", ["landingpages"]],             // resumo do beacon das landing pages
  ["/api/ad_insights", ["metrics"]],
  ["/api/ai-costs", ["expenses"]],
  ["/api/expenses", ["expenses"]], // CRUD genérico E /api/expenses/summary/:saas
  ["/api/pipeline-pace/", ["pipeline", "analise", "overview"]], // pace de caixa e metas diárias (Pipeline, Análise e faixa de meta da Visão geral)
  ["/api/funnel/", ["pipeline", "analise"]],  // análise do pipeline (Pipeline + tela Análise)
  ["/api/leads", ["pipeline", "today"]],    // inclui /api/leads/:id/proposal (ação do closer)
  ["/api/activities", ["pipeline", "today"]],
  ["/api/customers", ["customers"]],
  ["/api/subscriptions", ["customers"]], // inclui /change e /mp/link
  ["/api/invoices", ["customers"]],      // inclui /pay e /mp/link
  // Recorrências do MP ↔ clientes: mora na aba MP da tela Assinaturas (dentro
  // de Clientes). Precede /api/mp/ — primeiro match vence.
  ["/api/mp/preapprovals", ["customers", "expenses"]],
  ["/api/mp/", ["expenses"]],            // financeiro: espelho de pagamentos do MP (payments/sync/link) — aba Pagamentos da tela Financeiro
  ["/api/mp_payments", ["expenses"]],    // CRUD genérico do espelho (mesma tela)
  ["/api/mp_preapprovals", ["customers", "expenses"]], // CRUD genérico do espelho de recorrências
  ["/api/fin/", ["expenses"]],           // financeiro completo: leitura do mês (contas a pagar, fluxo, DRE, conciliação)
  ["/api/payables", ["expenses"]],       // CRUD genérico das contas a pagar
  ["/api/fin_rules", ["expenses"]],      // regras de conciliação aprendidas
  ["/api/mp_movements", ["expenses"]],   // saídas da conta MP (settlement report)
  ["/api/plans", ["customers"]],
  ["/api/nps", ["customers"]],
  ["/api/billing/", ["customers"]],
  ["/api/forms", ["forms", "aquisicao"]], // inclui /:id/funnel e /preview (Aquisição usa o funil do form)
  ["/api/form_submissions", ["forms"]],
  ["/api/form_events", ["forms"]],
  ["/api/proposal_templates", ["proposals"]],
  ["/api/proposals", ["proposals"]],     // inclui /preview
  ["/api/offers", ["offers"]],           // links FIXOS das ofertas (tela Links de pagamento)
  ["/api/payment-links", ["offers"]],    // histórico dos links gerados por lead/cliente (mesma tela)
  ["/api/payment_links", ["offers"]],    // CRUD genérico do mesmo histórico
  ["/api/contracts", ["contracts"]],     // modelos de contrato (biblioteca)
  ["/api/contract_issues", ["contracts"]], // contratos confirmados (histórico da mesma tela)
  ["/api/campaigns", ["disparos"]],      // disparos de e-mail + WhatsApp (mark, ai-copy e CRUD)
  ["/api/wa_automations", ["whatsapp"]], // automações do Inbox (regras reativas: CRUD genérico)
  ["/api/wa_flows", ["whatsapp"]],       // fluxos de conversa do Inbox (construtor: CRUD genérico)
  ["/api/outbound_accounts", ["outbound"]], // radar de contas do outbound (Cold Calling 2.0)
  ["/api/comp_plans", ["remuneracao"]],  // remuneração por cargo (ADMIN_PREFIXES exige etiqueta admin, além da tela)
  ["/api/sequences", ["disparos", "whatsapp"]],      // sequências de nutrição (drip): CRUD + enroll/wa-sent/metrics/run; a aba Automações do Inbox lista/pausa
  ["/api/sequence_enrollments", ["disparos", "whatsapp"]], // progresso das sequências
  ["/api/drip_templates", ["disparos"]], // biblioteca de conteúdo dos passos
  // Números do inbox (esperando resposta/janelas) no "Precisa de atenção" da
  // Visão geral — só a LEITURA agregada; conversas/envio seguem só do inbox.
  // Precede /api/whatsapp (primeiro match vence).
  ["/api/whatsapp/insights", ["whatsapp", "overview"]],
  ["/api/whatsapp", ["whatsapp"]],       // inbox de conversas (threads/messages/send/read); webhook /api/webhooks/whatsapp fica aberto
  // Bloqueios de agenda: a tela Agenda gerencia; quem marca call (pipeline/Meu dia)
  // precisa LER pra grade de horários respeitar os bloqueios.
  ["/api/agenda_blocks", ["agenda", "pipeline", "today", "overview"]],
  ["/api/consultations", ["consultas"]], // consultas 1:1 (mentoria UniqueKids): agenda + ações (meet/summary)
  ["/api/deliverables", ["consultas"]],  // Manual da Família (entregável) + compose por IA
  ["/api/pitch", ["calls", "settings"]], // análise de pitch (calls) + botão "IA das calls" em Ajustes → Scripts
  ["/api/integrations", ["integrations"]], // análise de integração (CS/onboarding)

  ["/api/metas", ["metas"]],             // metas de desempenho por vaga/pessoa
  ["/api/flashcards", ["training"]],     // treinamentos (flashcards)
  ["/api/tasks", ["tasks"]],
  ["/api/task_boards", ["tasks"]],
  ["/api/mindmaps", ["mindmaps"]],       // mapas mentais / estratégia
  ["/api/goals", ["overview"]],
  ["/api/portfolio", ["overview"]],
  ["/api/leaderboard", ["overview"]],
  ["/api/scoreboard", ["overview", "funcionarios"]], // placar por pessoa/papel (Visão geral + tela Funcionários)
];

// Escritas administrativas: leitura fica aberta (o app inteiro precisa do
// catálogo de produtos e da lista de nomes do time pros pickers), mas mexer em
// produto/funil/usuários é coisa da tela Ajustes.
const SETTINGS_WRITE_PREFIXES = ["/api/products", "/api/auth/users"];

// A Visão geral de gestão é a MESMA pra todo o time: quem tem a tela overview
// também LÊ o que os painéis dela buscam — tiles de aquisição (/api/marketing,
// /api/metrics) e Resultado do mês (/api/invoices, /api/expenses/summary). Só
// GET: sync, pay e CRUD continuam exigindo a tela dona da rota.
const OVERVIEW_READ_PREFIXES = ["/api/marketing", "/api/metrics/", "/api/invoices", "/api/expenses/summary/"];

export function screenForRequest(method, path) {
  if (method !== "GET" && SETTINGS_WRITE_PREFIXES.some((p) => path.startsWith(p))) return ["settings"];
  const hit = ROUTE_SCREENS.find(([prefix]) => path.startsWith(prefix));
  if (!hit) return null;
  if (method === "GET" && OVERVIEW_READ_PREFIXES.some((p) => path.startsWith(p))) return [...hit[1], "overview"];
  return hit[1];
}

// Rotas de dado SENSÍVEL (salário/remuneração): a lista de telas em branco
// significa "vê tudo" (ex.: usuário sem restrição), e salário não pode vazar
// por esse caminho. Passa quem tem a etiqueta `admin` — ou quem ganhou a tela
// `remuneracao` EXPLICITAMENTE em Ajustes → Equipe, e aí só LEITURA: editar
// plano de comp segue coisa de admin.
const ADMIN_PREFIXES = ["/api/comp_plans"];

// Hook Fastify (registrar DEPOIS do makeAuthHook, que popula req.authUser).
export function makeScreenGuardHook() {
  return async (req, reply) => {
    const user = req.authUser;
    if (!user) return; // key mestre ou rota aberta — auth já decidiu
    const path = req.url.split("?")[0];
    if (ADMIN_PREFIXES.some((p) => path.startsWith(p))) {
      const admin = (user.roles || []).includes("admin");
      const granted = Array.isArray(user.screens) && user.screens.includes("remuneracao");
      if (!admin && !(req.method === "GET" && granted)) {
        return reply.code(403).send({ error: "Sem acesso a esta área" });
      }
    }
    const screens = screenForRequest(req.method, path);
    if (screens && !screens.some((s) => canScreen(user, s))) {
      return reply.code(403).send({ error: "Sem acesso a esta área" });
    }
  };
}
