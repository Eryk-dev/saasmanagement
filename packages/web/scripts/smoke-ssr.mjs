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
    // A meta é ancorada no VENDIDO (bloco sale); cash é leitura informativa.
    sale: {
      target: 60000, sold: 34000, soldToday: 1000, gap: 26000,
      expectedToDate: 30000, progress: 0.5667, expectedProgress: 0.5, status: "ahead",
      projected: 51000, actualDailyPace: 2833, requiredDailyPace: 2600,
      remainingBusinessDays: 10,
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
    ["funcionarios", "/src/screens/funcionarios.jsx", "FuncionariosScreen", {}, "Análise de Equipe"],
    ["aquisicao", "/src/screens/aquisicao.jsx", "AquisicaoScreen", {}, "Análise de Aquisição"],
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
  // Layout da agenda por CLUSTER de sobreposição: um horário cheio NÃO pode
  // espremer os itens dos outros horários (era o bug — 9 follow-ups às 11h
  // deixavam a call das 14h com 1/9 da largura).
  try {
    const { laneByCluster } = await server.ssrLoadModule("/src/screens/pipeline.jsx");
    const H = (h) => h * 3600000;
    // 9 itens no MESMO horário (11h) + 1 sozinho às 14h + 2 sobrepostos às 16h
    const items = [];
    for (let i = 0; i < 9; i++) items.push({ id: "a" + i, t: H(11) });
    items.push({ id: "solo", t: H(14) });
    items.push({ id: "x", t: H(16) }, { id: "y", t: H(16.5) });
    const placed = laneByCluster(items, (e) => e.t, (e) => e.t + H(1));
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    const eq = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    eq("cluster das 11h tem 9 lanes", by.a0.lanes, 9);
    eq("item das 14h NÃO é espremido (1 lane, largura cheia)", by.solo.lanes, 1);
    eq("14h fica no lane 0", by.solo.lane, 0);
    eq("16h sobreposto divide em 2", by.x.lanes, 2);
    eq("16h30 pega a 2ª lane", by.y.lane, 1);
    console.log("✓ agenda-lanes");
  } catch (err) {
    console.error(`✗ agenda-lanes: ${err.message}`);
    failed++;
  }

  // Item de agenda "Dia inteiro" (allDay): tem que ocupar o DIA TODO na grade de
  // horários, pra não caber call de venda nesse dia. matchBlock já trata allDay;
  // aqui garante que busyView marca qualquer slot do dia.
  try {
    const { busyView } = await server.ssrLoadModule("/src/screens/today.jsx");
    const saved = window.SEED.AGENDA_BLOCKS;
    window.SEED.AGENDA_BLOCKS = [{ id: "b1", user: "ana", kind: "event", recur: "once", date: "2026-07-28", allDay: true, fromHour: 0, toHour: 24, title: "Forum ECOM" }];
    const busy = busyView(new Set(), "ana");
    const check = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    check("08h ocupado", busy.has("2026-07-28-08-00"), true);
    check("14h30 ocupado", busy.has("2026-07-28-14-30"), true);
    check("19h ocupado", busy.has("2026-07-28-19-00"), true);
    check("outro dia livre", busy.has("2026-07-29-14-00"), false);
    check("outra pessoa livre", busyView(new Set(), "leonardo").has("2026-07-28-14-00"), false);
    check("motivo do bloqueio", busy.info("2026-07-28-14-00")?.reason, "Forum ECOM");
    window.SEED.AGENDA_BLOCKS = saved;
    console.log("✓ agenda-dia-inteiro");
  } catch (err) {
    console.error(`✗ agenda-dia-inteiro: ${err.message}`);
    failed++;
  }

  // Filtro de período: as datas são a régua de TODA a Visão geral, então a conta
  // vale um teste de verdade e não só um render. Data fixa (quarta, 22/07/2026).
  try {
    const { periodWindow, PRESETS } = await server.ssrLoadModule("/src/components/period-picker.jsx");
    const now = new Date("2026-07-22T15:00:00");
    const w = (k, c = null) => periodWindow(k, c, now);
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    // Período de CALENDÁRIO corre até hoje; o fechado (passado) vai até o fim.
    eq("este mês", [w("month").since, w("month").until], ["2026-07-01", "2026-07-22"]);
    eq("mês passado", [w("lastMonth").since, w("lastMonth").until], ["2026-06-01", "2026-06-30"]);
    eq("esta semana", [w("week").since, w("week").until], ["2026-07-20", "2026-07-22"]); // segunda
    eq("semana passada", [w("lastWeek").since, w("lastWeek").until], ["2026-07-13", "2026-07-19"]);
    eq("hoje", [w("today").since, w("today").until], ["2026-07-22", "2026-07-22"]);
    eq("ontem", [w("yesterday").since, w("yesterday").until], ["2026-07-21", "2026-07-21"]);
    eq("7 dias", [w("7d").since, w("7d").until], ["2026-07-16", "2026-07-22"]);
    // Só dias ÚTEIS (as metas absolutas se distribuem neles): 01→22/07 = 16.
    eq("úteis do mês", w("month").businessDays, 16);
    // Janela anterior = MESMA duração colada antes (base das comparações).
    eq("anterior do mês", [w("month").days, w("month").prevSince, w("month").prevUntil], [22, "2026-06-09", "2026-06-30"]);
    const c = w("custom", { since: "2026-07-01", until: "2026-07-31" });
    eq("personalizado", [c.days, c.label], [31, "01/07 a 31/07"]);
    // Preferência antiga salva no localStorage não pode quebrar a tela.
    eq("chave desconhecida", w("15d").since, w("30d").since);
    if (!PRESETS.some((p) => p.key === "month")) throw new Error('falta o atalho "Este mês"');
    console.log("✓ periodo");
  } catch (err) {
    console.error(`✗ periodo: ${err.message}`);
    failed++;
  }
  // Agenda ocupada: a consulta da mentoria (UniqueKids) tem que bloquear o slot
  // de call de venda de quem atende. É regra de negócio, não render — vale um
  // teste de verdade, e vale AQUI porque busyView lê window.SEED.
  try {
    const { busyView, callSlotKeys } = await server.ssrLoadModule("/src/screens/today.jsx");
    const saved = window.SEED.CONSULTATION_SLOTS;
    // 23/07/2026 14:00 LOCAL, 90 min → ocupa 14:00, 14:30 e 15:00.
    window.SEED.CONSULTATION_SLOTS = [{ user: "ana", at: "2026-07-23T14:00:00", minutes: 90 }];
    const busy = busyView(new Set(), "ana");
    const livre = busyView(new Set(), "leonardo");
    const conflita = (v, view) => callSlotKeys(v).some((k) => view.has(k));
    const check = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    check("14:00 ocupado", conflita("2026-07-23T14:00", busy), true);
    check("15:00 ocupado (duração de 90 min)", conflita("2026-07-23T15:00", busy), true);
    // call das 13:30 dura 1h e encosta nas 14:00 → conflita
    check("13:30 encosta na consulta", conflita("2026-07-23T13:30", busy), true);
    check("16:00 livre", conflita("2026-07-23T16:00", busy), false);
    check("outro dia livre", conflita("2026-07-24T14:00", busy), false);
    check("agenda de outra pessoa livre", conflita("2026-07-23T14:00", livre), false);
    // o motivo aparece pro SDR não procurar uma call que não existe
    const info = busy.info(callSlotKeys("2026-07-23T14:00")[0]);
    check("motivo", info && info.reason, "consulta da mentoria");
    window.SEED.CONSULTATION_SLOTS = saved;
    console.log("✓ agenda-consulta");
  } catch (err) {
    console.error(`✗ agenda-consulta: ${err.message}`);
    failed++;
  }
  // Item SEMANAL da agenda: o formulário deriva do campo DATA o rótulo e o
  // weekday que SALVA. Se a data cair no dia de hoje, abrir e salvar MOVE o
  // compromisso — foi o bug que jogou "toda quarta" na quinta.
  try {
    const { formDateFor } = await server.ssrLoadModule("/src/screens/agenda.jsx");
    const qua = new Date("2026-07-22T10:00:00"); // quarta
    const wd = (ymd) => new Date(`${ymd}T12:00:00`).getDay();
    const check = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    // Semanal de QUINTA aberto numa QUARTA: a referência é quinta, não hoje.
    check("semanal segue o weekday gravado", wd(formDateFor({ block: { recur: "weekly", weekday: 4 } }, qua)), 4);
    check("domingo não vira segunda", wd(formDateFor({ block: { recur: "weekly", weekday: 0 } }, qua)), 0);
    // Clicar num slot da grade manda a data do slot e ela vence.
    check("slot clicado vence", formDateFor({ date: "2026-07-29", fromHour: 14 }, qua), "2026-07-29");
    // Pontual usa a data dele; item novo cai em hoje.
    check("pontual usa a data do item", formDateFor({ block: { recur: "once", date: "2026-08-03" } }, qua), "2026-08-03");
    check("item novo cai em hoje", formDateFor({}, qua), "2026-07-22");
    console.log("✓ agenda-semanal");
  } catch (err) {
    console.error(`✗ agenda-semanal: ${err.message}`);
    failed++;
  }
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} tela(s) falharam`); process.exit(1); }
console.log("smoke ok");
