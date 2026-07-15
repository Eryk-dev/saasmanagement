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
  "social", "forms", "proposals", "creative", "offers", "disparos", "whatsapp", "calls", "integrations", "analise", "funcionarios", "metas", "training", "tasks", "mindmaps", "settings",
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
  ["/api/social", ["social"]],
  ["/api/marketing", ["metrics"]],
  ["/api/metrics/", ["metrics"]],
  ["/api/ad_insights", ["metrics"]],
  ["/api/ai-costs", ["expenses"]],
  ["/api/expenses", ["expenses"]], // CRUD genérico E /api/expenses/summary/:saas
  ["/api/pipeline-pace/", ["pipeline", "analise"]], // pace de caixa e metas diárias (Pipeline + tela Análise)
  ["/api/funnel/", ["pipeline", "analise"]],  // análise do pipeline (Pipeline + tela Análise)
  ["/api/leads", ["pipeline", "today"]],    // inclui /api/leads/:id/proposal (ação do closer)
  ["/api/activities", ["pipeline", "today"]],
  ["/api/customers", ["customers"]],
  ["/api/subscriptions", ["customers"]], // inclui /change e /mp/link
  ["/api/invoices", ["customers"]],      // inclui /pay
  ["/api/plans", ["customers"]],
  ["/api/nps", ["customers"]],
  ["/api/billing/", ["customers"]],
  ["/api/forms", ["forms"]],             // inclui /:id/funnel e /preview
  ["/api/form_submissions", ["forms"]],
  ["/api/form_events", ["forms"]],
  ["/api/proposal_templates", ["proposals"]],
  ["/api/proposals", ["proposals"]],     // inclui /preview
  ["/api/offers", ["offers"]],           // links de pagamento das ofertas
  ["/api/campaigns", ["disparos"]],      // disparos de e-mail + WhatsApp (mark, ai-copy e CRUD)
  ["/api/sequences", ["disparos"]],      // sequências de nutrição (drip): CRUD + enroll/wa-sent/metrics/run
  ["/api/sequence_enrollments", ["disparos"]], // progresso das sequências
  ["/api/drip_templates", ["disparos"]], // biblioteca de conteúdo dos passos
  ["/api/whatsapp", ["whatsapp"]],       // inbox de conversas (threads/messages/send/read); webhook /api/webhooks/whatsapp fica aberto
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

export function screenForRequest(method, path) {
  if (method !== "GET" && SETTINGS_WRITE_PREFIXES.some((p) => path.startsWith(p))) return ["settings"];
  const hit = ROUTE_SCREENS.find(([prefix]) => path.startsWith(prefix));
  return hit ? hit[1] : null;
}

// Hook Fastify (registrar DEPOIS do makeAuthHook, que popula req.authUser).
export function makeScreenGuardHook() {
  return async (req, reply) => {
    const user = req.authUser;
    if (!user) return; // key mestre ou rota aberta — auth já decidiu
    const screens = screenForRequest(req.method, req.url.split("?")[0]);
    if (screens && !screens.some((s) => canScreen(user, s))) {
      return reply.code(403).send({ error: "Sem acesso a esta área" });
    }
  };
}
