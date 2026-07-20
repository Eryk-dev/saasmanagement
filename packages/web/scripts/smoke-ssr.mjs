// Smoke de render (SSR): renderiza as telas principais com SEED falso pra pegar
// erro de runtime (import quebrado, undefined em render) sem browser nem DB.
// Efeitos (useEffect) não rodam aqui — o que se valida é o caminho de render.
// Uso: node scripts/smoke-ssr.mjs  (na raiz de packages/web)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Stubs mínimos de browser pro código que toca window/localStorage no render.
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// useIsMobile (lib/responsive.js) lê matchMedia no initializer do useState.
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  body: { dataset: {} },
  documentElement: { style: { setProperty() {} } },
  getElementById: () => null,
};

const nowIso = new Date().toISOString();
window.SEED = {
  SAAS: [{
    id: "leverads", name: "LeverAds", mrr: 1533, arr: 18400, customers: 2,
    funnel: ["Inbox", "Qualificação", "Call closer", "Negociação", "Integração", "Ganho"].map((stage) => ({ stage, conv: 1 })),
    leadQuestions: [],
  }],
  PORTFOLIO: {}, ATTENTION: [], PEOPLE: {},
  CUSTOMERS: [
    { id: "c1", saas: "leverads", name: "Cliente Teste", arr: 15480, plan: "Pro mensal", flags: [], startedAt: new Date(Date.now() - 25 * 86400000).toISOString(), milestonesDone: { onboarding: nowIso } },
    { id: "c2", saas: "leverads", name: "Outra Loja", arr: 2920, flags: ["expansion"] },
  ],
  LEADS: [
    { id: "l1", saas: "leverads", name: "Lead Novo", stage: "Inbox", amount: 1290, createdAt: nowIso, stageSince: nowIso },
    { id: "l2", saas: "leverads", name: "Lead Call", stage: "Call closer", amount: 2190, createdAt: nowIso, stageSince: nowIso, callAt: nowIso },
    { id: "l3", saas: "leverads", name: "Lead Ganho", stage: "Ganho", amount: 1490, createdAt: nowIso, stageSince: nowIso },
  ],
  NPS: [], LEADERBOARD_MONTH: [], LEADERBOARD_ALL: [], GOALS: [],
  CONFIG: { meta: { configured: false }, mp: { configured: false }, discord: { configured: false }, proposals: { nativeSaas: [] } },
};

const server = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
let failed = 0;
try {
  const { fmt } = await server.ssrLoadModule("/src/lib/format.js");
  window.fmt = fmt;
  const { DataContext } = await server.ssrLoadModule("/src/data.jsx");
  const ctx = { version: 0, refresh() {}, openForm() {}, openDelete() {} };
  const wrap = (el) => React.createElement(DataContext.Provider, { value: ctx }, el);

  // Estados COM DADOS da Visão geral (os fetches não rodam no SSR): a faixa de
  // meta e a régua de conversões renderizam com payloads no formato da API.
  const fakePace = {
    cash: {
      target: 60000, collected: 34000, collectedToday: 1000, gap: 26000,
      expectedToDate: 30000, progress: 0.5667, expectedProgress: 0.5, status: "ahead",
      projected: 51000, actualDailyPace: 2833, requiredDailyPace: 2600,
      remainingBusinessDays: 10, receivableCount: 2, forecastWithReceivables: 40000,
    },
    plan: {
      blockedBy: null,
      wins: { remaining: 4, perDay: 0.4, today: 0 }, calls: { remaining: 16, perDay: 1.6, today: 1 },
      callsBooked: { remaining: 21, perDay: 2.1, today: 2 }, contacts: { remaining: 70, perDay: 7, today: 12 },
      leads: { remaining: 88, perDay: 8.8, today: 5 },
    },
  };
  const fakeTeam = {
    leadsNew: 6, contacted: 5, callsBooked: 4, bookingRate: 80, shown: 2, noShow: 1,
    showRate: 66.67, wonFromCalls: 1, callWinRate: 25, closeRate: 50, won: 1, revenue: 800,
    leadToWin: 16.67, goals: { bookingRate: { target: 35, period: "month" } },
  };

  const cases = [
    ["overview", "/src/screens/overview.jsx", "OverviewScreen", { onNav() {}, onOpenLead() {} }, "Visão geral"],
    ["overview-pace", "/src/screens/overview.jsx", "PaceStrip", { pace: fakePace, onNav() {} }, "dias úteis restantes"],
    ["overview-conversions", "/src/screens/overview.jsx", "FunnelConversions", { team: fakeTeam, pLabel: "30 dias" }, "comparecimento"],
    ["metrics", "/src/screens/metrics.jsx", "MetricsScreen", {}, "Publicidade"],
    ["expenses", "/src/screens/expenses.jsx", "ExpensesScreen", {}, "Custos operacionais"],
    ["customers", "/src/screens/customers.jsx", "CustomersScreen", {}, "Cliente Teste"],
    ["pipeline", "/src/screens/pipeline.jsx", "PipelineScreen", { onOpenLead() {} }, "Lead Novo"],
    ["chrome", "/src/chrome.jsx", "NavRail", { current: "overview", onNav() {} }, "Visão geral"],
    ["forms", "/src/screens/forms.jsx", "FormsScreen", { saasId: "leverads" }, ""],
    ["proposals", "/src/screens/proposals.jsx", "ProposalsScreen", { saasId: "leverads" }, ""],
    ["subscriptions", "/src/screens/subscriptions.jsx", "SubscriptionsScreen", { saasId: "leverads" }, ""],
    ["settings", "/src/screens/settings.jsx", "SettingsScreen", { saasId: "leverads" }, ""],
    ["social", "/src/screens/social.jsx", "SocialScreen", {}, "Comentários"],
    ["deal", "/src/screens/deal.jsx", "LeadDetail", { lead: window.SEED.LEADS[1], onClose() {} }, "Próximo passo"],
  ];
  for (const [name, path, exportName, props, mustContain] of cases) {
    try {
      const mod = await server.ssrLoadModule(path);
      const html = renderToString(wrap(React.createElement(mod[exportName], props)));
      if (mustContain && !html.includes(mustContain)) {
        console.error(`✗ ${name}: renderizou mas não contém "${mustContain}"`);
        failed++;
      } else {
        console.log(`✓ ${name}`);
      }
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
      failed++;
    }
  }
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} tela(s) falharam`); process.exit(1); }
console.log("smoke ok");
