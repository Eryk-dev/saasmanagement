// API falsa pros testes do MCP: responde o FORMATO de cada rota real com dados
// vazios ou mínimos. É de propósito: o defeito que mais aparece numa tool é
// estourar quando a coleção volta vazia (`(d.x || []).map`), e isso só aparece
// se o teste exercitar exatamente esse caso.
//
// Rota desconhecida devolve 404 — assim uma tool que inventou endpoint quebra
// no teste, e não em produção.

import http from "node:http";

const COLLECTIONS = new Set([
  "products", "attention", "deals", "people", "customers", "leads", "nps", "goals",
  "leaderboard_month", "leaderboard_all", "forms", "form_submissions", "form_events", "lp_events",
  "proposal_templates", "proposals", "plans", "subscriptions", "invoices", "users", "user_assets",
  "ad_insights", "expenses", "payables", "fin_rules", "mp_movements", "tasks", "task_boards",
  "activities", "activity_assets", "task_assets", "agenda_blocks", "mindmaps", "app_config",
  "social_assets", "social_posts", "social_comments", "social_stories", "wa_threads", "wa_messages",
  "wa_alerts", "wa_calls", "wa_media", "wa_template_media", "wa_automations", "wa_flows", "offers",
  "contracts", "contract_issues", "mp_payments", "payment_links", "mp_preapprovals", "campaigns",
  "outbound_accounts", "comp_plans", "sequences", "sequence_enrollments", "drip_templates",
  "flashcards", "training_attempts", "training_states", "training_reviews", "training_assets",
  "training_exams", "training_fun", "copilot_sessions", "consultations", "deliverables", "integration_forms",
]);

const PRODUTO = {
  id: "leverads", name: "LeverAds", metaAdAccount: "1234567890", metaPageId: "999",
  mrr: 42000, arr: 504000, customers: 12, health: 82, healthTrend: 3, nrr: 1.08, churnRate: 0.02,
  ltvMonths: 12, stages: [{ id: "Prospect", kind: "novo" }, { id: "Ganho", kind: "ganho" }],
  painMap: { A: "Custo alto" }, lossReasons: [{ id: "preco", label: "Preço" }],
};

const OK = { ok: true };

// Cada entrada: [regex do caminho, método, corpo]. A primeira que casar vence.
const ROTAS = [
  [/^\/api\/health$/, "GET", { ok: true, db: "ok" }],
  [/^\/api\/rev$/, "GET", { rev: 1 }],
  [/^\/api\/openapi\.json$/, "GET", {
    openapi: "3.0.3",
    paths: { "/api/leads": { post: { summary: "Cria lead" } } },
    components: {
      schemas: {
        LeadInput: { type: "object", required: ["name", "saas"], properties: { name: { type: "string", description: "Nome" }, saas: { type: "string", description: "Produto" } } },
        Product: { type: "object", properties: { id: { type: "string" } } },
        Customer: { type: "object", properties: { id: { type: "string" } } },
        NpsResponse: { type: "object", properties: { score: { type: "number" } } },
        Goal: { type: "object", properties: { scope: { type: "string" } } },
      },
    },
  }],
  [/^\/api\/portfolio$/, "GET", { mrr: 42000, arr: 504000, mrrDelta: 1200, tcv: 900000, customers: 12, nrr: 1, mrrSeries30d: [] }],
  [/^\/api\/bootstrap$/, "GET", {
    SAAS: [PRODUTO], PORTFOLIO: { mrr: 42000, arr: 504000, customers: 12 },
    ATTENTION: [], PEOPLE: {}, CUSTOMERS: [], LEADS: [], AGENDA_BLOCKS: [], CONSULTATION_SLOTS: [],
    NPS: [], LEADERBOARD_MONTH: [], LEADERBOARD_ALL: [], GOALS: [],
    CONFIG: {
      levercopy: { configured: false }, proposals: { nativeSaas: [], catalog: [] },
      mp: { configured: true, webhook: "ok" }, meta: { configured: true },
      google: { configured: true, connected: true, account: "a@b.com", gmail: true, meetCalendar: "primary" },
      ai: { configured: true }, discord: { configured: false },
      whatsapp: { configured: true, health: "GREEN" },
    },
  }],
  [/^\/api\/leaderboard$/, "GET", []],
  [/^\/api\/marketing\/meta\/adaccounts$/, "GET", { configured: true, accounts: [{ id: "1234567890", name: "Conta LeverAds", business: "LeverAds", active: true }] }],
  [/^\/api\/marketing\/sync$/, "POST", { ok: true, since: "2026-08-01", until: "2026-08-31", report: { leverads: { ok: true, rows: 0 } } }],
  [/^\/api\/marketing\/job\/[^/]+$/, "GET", { id: "job1", status: "done", step: "pronto", result: {} }],
  [/^\/api\/marketing\/[^/]+\/adobjects$/, "GET", { campaigns: [], adsets: [], ads: [] }],
  [/^\/api\/marketing\/[^/]+\/placements$/, "GET", { since: "2026-08-01", until: "2026-08-31", placements: [], configured: true }],
  [/^\/api\/marketing\/[^/]+\/attribution$/, "GET", { campaigns: {}, adsets: {}, ads: {} }],
  [/^\/api\/marketing\/[^/]+\/campaigns$/, "GET", { campaigns: [] }],
  [/^\/api\/marketing\/[^/]+\/creative-defaults$/, "GET", { pageId: "999", instagramUserId: null, link: "", painMap: {} }],
  [/^\/api\/marketing\/[^/]+\/delivery-rules$/, "GET", { enabled: false, weekendDays: [], targetBudget: null }],
  [/^\/api\/marketing\/[^/]+\/ad\/[^/]+\/creative$/, "GET", { adId: "1", title: "", body: "", videoUrl: null }],
  [/^\/api\/marketing\/campaigns\/[^/]+\/adsets$/, "GET", { adsets: [] }],
  [/^\/api\/marketing\/adsets\/[^/]+\/ads$/, "GET", { ads: [] }],
  [/^\/api\/marketing\/[^/]+$/, "GET", {
    saas: "leverads", since: "2026-08-01", until: "2026-08-31",
    totals: {
      spend: 0, impressions: 0, clicks: 0, metaLeads: 0, leads: 0, foraDoPerfil: 0,
      formViews: 0, formStarts: 0, cpl: null, cplMeta: null, won: 0, costPerWin: null,
      revenue: 0, roas: null, cpc: null, cpm: null, ctr: null,
    },
    perStage: [], origins: [], campaigns: [], adsets: [], ads: [], pains: [], series: [],
    synced: false, syncedAt: null,
  }],
  [/^\/api\/scoreboard\/[^/]+$/, "GET", {
    saas: "leverads", since: "2026-08-01", until: "2026-08-31",
    sdr: [], closer: [], cs: [], social: [],
    team: {
      leadsNew: 0, contacted: 0, contactedInPeriod: 0, contactedCohort: 0, callsBooked: 0,
      contactRate: null, bookingRate: null, bookedCohort: 0, shown: 0, noShow: 0, pending: 0,
      showRate: null, wonFromCalls: 0, callWinRate: null, closeRate: null, closeRatePeriod: null,
      won: 0, revenue: 0, contracted: 0, keyAccount: null, leadToWin: null, paceAdjust: null,
      contactedBy: [], automationReached: 0, bookedBy: [], goals: {},
      classes: { semente: { leads: 0, won: 0, revenue: 0 } },
      cash: { novos: 0, upsell: 0, renovacao: 0, total: 0 },
      pipelineCreated: { count: 0, accepted: 0, valueKnown: 0, ticketMedian90: null, estimated: 0 },
      firstTouch: { medianMin: null, within5m: 0, touched: 0, cohort: 0, pct5m: null },
      firstResponse: { medianMin: null, within5m: 0, responded: 0, cohort: 0, pct5m: null, botFirst: 0 },
      stalled: { count: 0, items: [] }, monthTargets: null,
    },
  }],
  [/^\/api\/pipeline-pace\/[^/]+\/window$/, "GET", {
    saas: "leverads", since: "2026-08-01", until: "2026-08-31", today: "2026-09-03",
    businessDays: 21, businessDaysElapsed: 21, ended: true, current: false,
    sale: { target: null, sold: 0, contracted: 0, progress: null, expectedProgress: 0, status: null },
    contracts: { target: null, sold: 0, progress: null, expectedProgress: 0, status: null },
    keyAccount: null,
  }],
  [/^\/api\/pipeline-pace\/[^/]+$/, "GET", {
    saas: "leverads", month: "2026-09", today: "2026-09-03",
    sale: {
      target: 120000, targetConfigured: true, sold: 0, soldToday: 0, contracted: 0, byDay: [],
      gap: 120000, superMetas: [], chaseTarget: null, chaseGap: 0, chasePct: null,
      expectedToDate: 0, deltaToPace: 0, actualDailyPace: 0, requiredDailyPace: null,
      projected: 0, progress: 0, expectedProgress: 0, status: "behind",
      totalBusinessDays: 22, elapsedBusinessDays: 2, remainingBusinessDays: 20,
    },
    contracts: { target: null, targetSource: "", sold: 0, soldToday: 0, gap: null, progress: null, expectedToDate: null, expectedProgress: 0, status: null },
    keyAccount: null,
    cash: { target: 120000, targetConfigured: true, collected: 0, collectedToday: 0, gap: 120000, expectedToDate: 0, deltaToPace: 0, actualDailyPace: 0, requiredDailyPace: null, projected: 0, progress: 0, expectedProgress: 0, status: "behind", receivables: 0, receivableCount: 0, forecastWithReceivables: 0 },
    context: { tcvMonth: 0 },
  }],
  [/^\/api\/funnel\/[^/]+$/, "GET", {
    saas: "leverads", since: "2026-08-01", until: "2026-08-31",
    coverage: { leads: 0, withHistory: 0 }, stages: [], winRate: null, wonCount: 0, lostCount: 0,
    dqCount: 0, lossReasons: [], firstTouch: { medianHours: null, buckets: { h1: 0, h4: 0, h24: 0 }, touched: 0, untouched: 0 },
  }],
  [/^\/api\/metrics\/[^/]+$/, "GET", {
    saas: "leverads", days: 30, months: 12,
    window: { spend: 0, leads: 0, newCustomers: 0, cac: null, convRate: null },
    ltv: { ticket: null, months: 12, value: null, ltvCac: null, payingCustomers: 0 },
    series: [],
  }],
  [/^\/api\/metas\/[^/]+$/, "GET", {
    saas: "leverads", roles: [], users: [], userGoals: [],
    company: { cashTarget: 120000, cashTargetDefault: 120000, contractsTarget: null, growthPct: null, months: [] },
    people: { sdr: 1, closer: 1, integrator: 0, social: 0 },
    derived: { target: 120000, base: 0, superMode: false, chasePct: null, ticket: null, ticketSource: "", contractsTarget: null, wonFromTicket: null, wonSource: "company", won: null, callsShown: null, callsBooked: null, contacts: null, leads: null, rates: {}, rateWindow: null, rateCounts: {}, blockedBy: null, goals: [] },
    compPlan: { sdr: [], closer: [] },
  }],
  [/^\/api\/expenses\/summary\/[^/]+$/, "GET", {
    month: "2026-09", ads: 0, ai: null, aiUSD: null, usdBrl: null, wa: null, waConversations: null,
    manual: [], manualTotal: 0, payablesTotal: 0, payablesCount: 0, total: 0,
  }],
  [/^\/api\/ai-costs$/, "GET", { days: 30, currency: "USD", usdBrl: 5.4, totalPeriod: 0, providers: [] }],
  [/^\/api\/elo\/overview$/, "GET", { configured: false }],
  [/^\/api\/lp\/summary$/, "GET", { configured: false, days: 30, saas: "elo", pages: [], sources: [], daily: [], ctaLabels: [], conversions: null }],
  [/^\/api\/fin\/[^/]+$/, "GET", { saas: "leverads", month: "2026-09", entradas: [], saidas: [], totals: {}, rows: [] }],
  [/^\/api\/billing\/received\/[^/]+$/, "GET", { saas: "leverads", rows: [], total: 0 }],
  [/^\/api\/mp\/payments$/, "GET", { payments: [], total: 0 }],
  [/^\/api\/mp\/preapprovals$/, "GET", { preapprovals: [] }],
  [/^\/api\/payment-links$/, "GET", { links: [] }],
  [/^\/api\/offers\/[^/]+$/, "GET", { saas: "leverads", offers: [] }],
  [/^\/api\/whatsapp\/threads\/[^/]+$/, "GET", { id: "t1", messages: [], lead: null }],
  [/^\/api\/whatsapp\/threads$/, "GET", { threads: [] }],
  [/^\/api\/whatsapp\/templates$/, "GET", { templates: [] }],
  [/^\/api\/whatsapp\/alerts$/, "GET", { alerts: [] }],
  [/^\/api\/whatsapp\/insights$/, "GET", { insights: {}, series: [] }],
  [/^\/api\/whatsapp\/number$/, "GET", { configured: true, health: "GREEN", quality: "HIGH" }],
  [/^\/api\/social\/summary$/, "GET", { summary: {}, series: [] }],
  [/^\/api\/social\/pages$/, "GET", { pages: [] }],
  [/^\/api\/social\/posts$/, "GET", { posts: [] }],
  [/^\/api\/social\/comments$/, "GET", { comments: [] }],
  [/^\/api\/social\/dms$/, "GET", { threads: [] }],
  [/^\/api\/social\/audience$/, "GET", { audience: {} }],
  [/^\/api\/social\/stories$/, "GET", { stories: [] }],
  [/^\/api\/social\/discovery$/, "GET", { accounts: [] }],
  [/^\/api\/social\/new-followers\/[^/]+$/, "GET", { followers: [] }],
  [/^\/api\/campaigns\/metrics\/[^/]+$/, "GET", { sent: 0, opened: 0, clicked: 0, rows: [] }],
  [/^\/api\/sequences\/metrics\/[^/]+$/, "GET", { rows: [], totals: {} }],
  [/^\/api\/sdr\/status$/, "GET", { enabled: false }],
  [/^\/api\/sdr\/replay$/, "GET", { runs: [] }],
  [/^\/api\/pitch\/[^/]+\/calls$/, "GET", { calls: [], rows: [] }],
  [/^\/api\/agenda\/free-slots$/, "GET", { slots: [] }],
  [/^\/api\/google\/status$/, "GET", { configured: true, connected: true, account: "a@b.com" }],
  [/^\/api\/google\/user\/status$/, "GET", { connected: false }],
  [/^\/api\/integrations\/[^/]+\/summary$/, "GET", { saas: "leverads", rows: [], totals: {} }],
  [/^\/api\/integration-forms\/questions$/, "GET", { questions: [] }],
  [/^\/api\/leverads-access\/status$/, "GET", { configured: false }],
  [/^\/api\/leverads-access\/orgs$/, "GET", { orgs: [] }],
  [/^\/api\/forms\/[^/]+\/funnel$/, "GET", { form: "f1", views: 0, starts: 0, submits: 0, questions: [] }],
  [/^\/api\/flashcards\/[^/]+\/queue$/, "GET", { cards: [] }],
  [/^\/api\/flashcards\/[^/]+\/stats$/, "GET", { due: 0, total: 0, rows: [] }],
  [/^\/api\/flashcards\/[^/]+\/team$/, "GET", { rows: [] }],
  [/^\/api\/flashcards\/[^/]+\/fun$/, "GET", { cards: [] }],
  [/^\/api\/flashcards\/[^/]+\/exam\/[^/]+$/, "GET", { id: "e1", questions: [] }],
  [/^\/api\/flashcards\/[^/]+$/, "GET", { saas: "leverads", decks: [], cards: [] }],
  [/^\/api\/auth\/users$/, "GET", [{ id: "leonardo", name: "Leonardo", roles: ["closer"], screens: [] }]],
  [/^\/api\/auth\/me$/, "GET", { id: "mcp", name: "MCP" }],
  [/^\/api\/feedback$/, "GET", []],
  [/^\/api\/events$/, "GET", { ok: true }],
];

export function startFakeApi() {
  const vistos = [];
  // Rota que o MCP pediu e a API real não tem: é o defeito "inventei o endpoint".
  const inexistentes = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const caminho = url.pathname;
    vistos.push(`${req.method} ${caminho}`);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    for (const [re, metodo, corpo] of ROTAS) {
      if (re.test(caminho) && metodo === req.method) return send(200, corpo);
    }
    // CRUD genérico de coleção.
    const m = caminho.match(/^\/api\/([a-z_]+)(?:\/([^/]+))?$/);
    if (m && COLLECTIONS.has(m[1])) {
      if (req.method === "GET") return send(200, m[2] ? { id: m[2], saas: "leverads", name: "Registro" } : (m[1] === "products" ? [PRODUTO] : []));
      if (req.method === "DELETE") return send(200, OK);
      return send(200, { id: m[2] || "novo", saas: "leverads" });
    }
    if (req.method !== "GET") return send(200, OK);
    inexistentes.push(`${req.method} ${caminho}`);
    send(404, { error: `rota não existe na API: ${req.method} ${caminho}` });
  });
  return { server, vistos, inexistentes };
}
