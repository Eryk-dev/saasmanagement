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
  // meta e o funil do período renderizam com payloads no formato da API.
  const fakePace = {
    // A meta é ancorada no VENDIDO (bloco sale); contracts é a 2ª régua.
    sale: {
      target: 60000, sold: 34000, soldToday: 1000, gap: 26000,
      expectedToDate: 30000, progress: 0.5667, expectedProgress: 0.5, status: "ahead",
      projected: 51000, actualDailyPace: 2833, requiredDailyPace: 2600,
      remainingBusinessDays: 10,
    },
    contracts: {
      target: 10, targetSource: "company", sold: 6, soldToday: 1, gap: 4,
      progress: 0.6, expectedToDate: 5, expectedProgress: 0.5, status: "ahead",
    },
  };
  // Meta da JANELA (a faixa segue o filtro do topo): formato do /window.
  const fakeGoal = {
    since: "2026-08-01", until: "2026-08-31", today: "2026-08-08",
    businessDays: 21, businessDaysElapsed: 5, ended: false, current: true,
    sale: { target: 60000, sold: 34000, progress: 0.5667, expectedProgress: 0.24, status: "ahead" },
    contracts: { target: 10, sold: 6, progress: 0.6, expectedProgress: 0.24, status: "ahead" },
  };
  const fakeTeam = {
    leadsNew: 6, contacted: 5, callsBooked: 4, bookingRate: 80, shown: 2, noShow: 1,
    showRate: 66.67, wonFromCalls: 1, callWinRate: 25, closeRate: 50, closeRatePeriod: 50,
    won: 1, revenue: 800, contactRate: 83.3,
    leadToWin: 16.67, goals: { bookingRate: { target: 35, period: "month" } },
    monthTargets: { leads: 200, contacts: 160, callsBooked: 48, callsShown: 36, won: 12, revenue: 60000, wonSource: "company", blockedBy: null },
  };
  const fakeWin = { since: "2026-08-01", until: "2026-08-08", businessDays: 6, days: 8, label: "este mês", short: "mês" };

  const cases = [
    ["overview", "/src/screens/overview.jsx", "OverviewScreen", { onNav() {}, onOpenLead() {} }, "Visão geral"],
    ["overview-meta", "/src/screens/overview.jsx", "MetaMesCard", { pace: fakePace, goal: fakeGoal, onNav() {} }, "Contratos"],
    ["overview-funil", "/src/screens/overview.jsx", "FunilPeriodo", { team: fakeTeam, win: fakeWin, pLabel: "este mês" }, "Ganhos"],
    ["metrics", "/src/screens/metrics.jsx", "MetricsScreen", {}, "Publicidade"],
    ["expenses", "/src/screens/expenses.jsx", "ExpensesScreen", {}, "Pagamentos"],
    ["customers", "/src/screens/customers.jsx", "CustomersScreen", {}, "Cliente Teste"],
    ["pipeline", "/src/screens/pipeline.jsx", "PipelineScreen", { onOpenLead() {} }, "Lead Novo"],
    ["chrome", "/src/chrome.jsx", "NavRail", { current: "overview", onNav() {} }, "Visão geral"],
    ["forms", "/src/screens/forms.jsx", "FormsScreen", { saasId: "leverads" }, ""],
    ["proposals", "/src/screens/proposals.jsx", "ProposalsScreen", { saasId: "leverads" }, ""],
    ["subscriptions", "/src/screens/subscriptions.jsx", "SubscriptionsScreen", { saasId: "leverads" }, ""],
    ["settings", "/src/screens/settings.jsx", "SettingsScreen", { saasId: "leverads" }, ""],
    ["social", "/src/screens/social.jsx", "SocialScreen", {}, "Comentários"],
    ["contracts", "/src/screens/contracts.jsx", "ContractsScreen", {}, "Contratos gerados"],
    ["intform", "/src/screens/integration-forms.jsx", "IntegrationFormsScreen", {}, "Formulário de Integração"],
    ["blog", "/src/screens/blog.jsx", "BlogScreen", {}, "Blog"],
    ["deal", "/src/screens/deal.jsx", "LeadDetail", { lead: window.SEED.LEADS[1], onClose() {} }, "Próximo passo"],
    ["funcionarios", "/src/screens/funcionarios.jsx", "FuncionariosScreen", {}, "Análise de Equipe"],
    ["desempenho", "/src/screens/desempenho.jsx", "DesempenhoScreen", {}, "Análise de Desempenho"],
    ["aquisicao", "/src/screens/aquisicao.jsx", "AquisicaoScreen", {}, "Análise de Aquisição"],
    ["tasks", "/src/screens/tasks/index.jsx", "TasksScreen", {}, "Tarefas"],
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

  // Checklist do lead (Dados do lead · edite pra completar): a faixa de
  // faturamento entra na ORDEM da conversa, logo depois dos anúncios, como
  // select. Pergunta fora da ordem canônica segue só aparecendo respondida.
  try {
    const { scriptChecklist } = await server.ssrLoadModule("/src/lib/scripts.js");
    const cfg = { leadQuestions: [
      { key: "accounts", label: "Contas?", options: [{ value: "1", label: "1" }] },
      { key: "listings", label: "Anúncios?", options: [{ value: "0-100", label: "Até 100" }] },
      { key: "revenue", label: "Faturamento?", options: [{ value: "0-50k", label: "Até R$ 50 mil/mês" }] },
      { key: "niche", label: "Nicho?", options: [{ value: "moda", label: "Moda" }] },
      { key: "aprender_verba", label: "Verba?", options: [{ value: "ate-1k", label: "Até 1 mil" }] },
    ] };
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    const keys = scriptChecklist(cfg, { id: "l1" }).map((c) => c.key);
    eq("faturamento na ordem, depois dos anúncios", keys, ["niche", "company", "accounts", "listings", "revenue", "email"]);
    const c = scriptChecklist(cfg, { id: "l1", revenue: "0-50k" }).find((x) => x.key === "revenue");
    eq("select com a faixa marcada", [c.type, c.raw, c.value], ["select", "0-50k", "Até R$ 50 mil/mês"]);
    console.log("✓ checklist-faturamento");
  } catch (err) {
    console.error(`✗ checklist-faturamento: ${err.message}`);
    failed++;
  }

  // Entrada do lead (lib/format.js + lib/ui.js): o carimbo de entrada sai no
  // fuso do negócio (a máquina pode estar em UTC e jogaria o lead das 22h pro
  // dia seguinte) e a idade é calculada do createdAt, não do "agora" que a
  // criação congela no campo `age`.
  try {
    const { fmtDateTime } = await server.ssrLoadModule("/src/lib/format.js");
    const { leadAge } = await server.ssrLoadModule("/src/lib/ui.js");
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    eq("entrada no fuso de Brasília", fmtDateTime("2026-09-11T01:52:50.843Z"), "10/09/2026 22:52");
    eq("sem data, vazio", fmtDateTime(""), "");
    const now = Date.parse("2026-09-11T05:00:00Z");
    eq("recém-chegado", leadAge({ createdAt: "2026-09-11T04:30:00Z" }, now), "agora");
    eq("idade em horas", leadAge({ createdAt: "2026-09-11T01:52:50.843Z" }, now), "3h");
    eq("idade em dias", leadAge({ createdAt: "2026-09-08T01:00:00Z" }, now), "3d");
    eq("sem createdAt cai no campo age", leadAge({ age: "12m" }, now), "12m");
    console.log("✓ entrada-do-lead");
  } catch (err) {
    console.error(`✗ entrada-do-lead: ${err.message}`);
    failed++;
  }

  // Destinos do follow-up (Meu dia, "Depois da ação"): a Nutrição entra como
  // botão (Leo, 11/09) resolvida pelo NOME da etapa — `contato` cairia em Dia 2,
  // a 1ª etapa de cadência da LeverAds. Sem etapa Nutrição no funil, o botão some.
  try {
    const { destinationsFor } = await server.ssrLoadModule("/src/screens/today.jsx");
    const funnel = [
      { stage: "Novo lead", kind: "novo" }, { stage: "Dia 2", kind: "contato" }, { stage: "Dia 3", kind: "contato" },
      { stage: "Qualificando", kind: "qualificacao" }, { stage: "Call agendada", kind: "call" }, { stage: "Follow-up", kind: "followup" },
      { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" }, { stage: "Desqualificado", kind: "desqualificado" },
      { stage: "Nutrição", kind: "contato" }, { stage: "No show", kind: "contato" },
    ];
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    const names = (cfg, lead) => destinationsFor(cfg, lead).map((d) => (d.retry ? "retry" : d.stage));
    eq("follow-up ganha Nutrição antes de Desqualificado", names({ funnel }, { id: "l1", stage: "Follow-up" }), ["retry", "Ganho", "Integração", "Nutrição", "Desqualificado"]);
    const semNutri = funnel.filter((f) => f.stage !== "Nutrição");
    eq("sem etapa Nutrição, o botão some", names({ funnel: semNutri }, { id: "l1", stage: "Follow-up" }), ["retry", "Ganho", "Integração", "Desqualificado"]);
    console.log("✓ destino-nutricao");
  } catch (err) {
    console.error(`✗ destino-nutricao: ${err.message}`);
    failed++;
  }

  // Cadência de 7 dias por coluna (Dia 2…Dia 7, #881): cada dia tem roteiro
  // próprio, linha em Scripts/Próximos passos, e o Depois da ação oferece
  // "Qualificando" (ele respondeu). Com as colunas, o Retomar do Novo lead não
  // promete mais Qualificando; sem elas, o comportamento antigo continua.
  try {
    const { scriptKeyFor, SCRIPT_CATALOG, catalogStageRow } = await server.ssrLoadModule("/src/lib/scripts.js");
    const { destinationsFor } = await server.ssrLoadModule("/src/screens/today.jsx");
    const { nextKindsFor } = await server.ssrLoadModule("/src/lib/funnel.js");
    const dias = [2, 3, 4, 5, 6, 7].map((n) => ({ stage: `Dia ${n}`, kind: "contato" }));
    const funnel = [
      { stage: "Novo lead", kind: "novo" }, ...dias,
      { stage: "Qualificando", kind: "qualificacao" }, { stage: "Call agendada", kind: "call" }, { stage: "Follow-up", kind: "followup" },
      { stage: "Ganho", kind: "ganho" }, { stage: "Desqualificado", kind: "desqualificado" }, { stage: "Nutrição", kind: "contato" },
    ];
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    eq("Dia 3 usa o roteiro do dia", scriptKeyFor({ funnel }, { stage: "Dia 3" }), "dia3");
    eq("Dia 7 usa o roteiro do dia", scriptKeyFor({ funnel }, { stage: "Dia 7" }), "dia7");
    eq("Novo lead segue o 1º ato", scriptKeyFor({ funnel }, { stage: "Novo lead" }), "novo");
    eq("Nutrição não é dia", scriptKeyFor({ funnel }, { stage: "Nutrição", stageAttempts: 0 }), "nutricao1");
    const rows = SCRIPT_CATALOG.filter((c) => c.stageMatch === "dia").map((c) => catalogStageRow({ funnel }, c)?.stage);
    eq("catálogo casa cada dia com a coluna", rows, ["Dia 2", "Dia 3", "Dia 4", "Dia 5", "Dia 6", "Dia 7"]);
    eq("sem colunas de dia, as linhas somem", SCRIPT_CATALOG.filter((c) => c.stageMatch === "dia").map((c) => catalogStageRow({ funnel: funnel.filter((f) => !/^Dia/.test(f.stage)) }, c)), [null, null, null, null, null, null]);
    const names = (cfg, lead) => destinationsFor(cfg, lead).map((d) => (d.retry ? (d.promote ? "retry→" + d.stage : "retry") : d.stage));
    eq("Dia 3: Qualificando (respondeu) entra nos destinos", names({ funnel }, { id: "l1", stage: "Dia 3" }), ["retry", "Qualificando", "Call agendada", "Nutrição", "Desqualificado"]);
    eq("Novo lead com colunas: Retomar não promove", names({ funnel }, { id: "l1", stage: "Novo lead" }), ["retry", "Qualificando", "Call agendada", "Nutrição", "Desqualificado"]);
    const semDias = { funnel: funnel.filter((f) => !/^Dia/.test(f.stage)) };
    eq("sem colunas: Retomar do Novo lead promove pra Qualificando", names(semDias, { id: "l1", stage: "Novo lead" }), ["retry→Qualificando", "Call agendada", "Desqualificado"]);
    eq("override por roteiro continua ganhando", nextKindsFor({ funnel, nextSteps: { dia4: ["desqualificado"] } }, "dia4", "contato"), ["desqualificado"]);
    console.log("✓ cadencia-dias");
  } catch (err) {
    console.error(`✗ cadencia-dias: ${err.message}`);
    failed++;
  }

  // Contrato preenchido (lib/contracts.js): é o papel que vai pra assinatura e o
  // MESMO snapshot reimpresso na ficha do cliente, então a montagem do HTML vale
  // teste. Valor digitado entra ESCAPADO (contrato não executa HTML de campo) e
  // campo vazio vira linha em branco, pra continuar imprimível pra preencher à mão.
  try {
    const { fullHtml, fieldsOf } = await server.ssrLoadModule("/src/lib/contracts.js");
    const modelo = { name: "Consultoria", body: "<p>{{razao_social}} · CNPJ {{cnpj_cpf}}</p>" };
    const eq = (name, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    };
    eq("campos saem dos tokens do corpo", fieldsOf(modelo).map((f) => f.key), ["razao_social", "cnpj_cpf"]);
    const html = fullHtml(modelo, { razao_social: "Loja <b>do</b> João" });
    if (!html.includes("Loja &lt;b&gt;do&lt;/b&gt; João")) throw new Error("valor digitado não foi escapado");
    if (!/CNPJ _{6,}/.test(html)) throw new Error("campo vazio devia sair como linha em branco");
    console.log("✓ contratos-preenchimento");
  } catch (err) {
    console.error(`✗ contratos-preenchimento: ${err.message}`);
    failed++;
  }

  // Valor do contrato com unidade (ficha do cliente): o banco guarda o ANUAL,
  // mas quem vende assinatura recorrente digita a MENSALIDADE. A unidade tem que
  // abrir certa por tipo de contrato, e os dois números têm que aparecer na tela
  // — foi digitar 699/mês num campo "Valor/ano" que deixou um cliente com ARR
  // 12x menor que o real (27/08/2026).
  try {
    const { ValorContrato } = await server.ssrLoadModule("/src/screens/customers.jsx");
    const render = (customer) => renderToString(wrap(React.createElement(ValorContrato, { customer, onPatch() {}, inputSt: {} })));

    const recorrente = render({ arr: 8388, paymentMethod: "cartao_recorrente", plan: "Anual" });
    if (!recorrente.includes('value="699"')) throw new Error("recorrente devia abrir com a MENSALIDADE no campo");
    if (!recorrente.includes("699/mês") || !recorrente.includes("8.388/ano")) throw new Error("faltou mostrar os dois valores");

    const anual = render({ arr: 7188, paymentMethod: "pix", plan: "Anual" });
    if (!anual.includes('value="7188"')) throw new Error("contrato à vista devia abrir com o valor do ANO no campo");
    if (!anual.includes("599/mês")) throw new Error("faltou o equivalente mensal");

    const vazio = render({ arr: 0, plan: "" });
    if (!vazio.includes("sem valor registrado")) throw new Error("cliente sem valor devia dizer isso");
    console.log("✓ valor-contrato-mes-ano");
  } catch (err) {
    console.error(`✗ valor-contrato-mes-ano: ${err.message}`);
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
  // Placar do dia (Meu dia): o denominador é a META DIÁRIA da pessoa, não o
  // tamanho da fila. Meta mensal ÷ dias úteis (21,75), e valor e alvo sempre da
  // mesma fonte — cruzar realizado do servidor com alvo de fila é o bug que
  // fazia "1 / 9" parecer meta.
  try {
    const { dayScoreOf } = await server.ssrLoadModule("/src/screens/today.jsx");
    const check = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    const local = { contacted: 1, contactedGoal: 9, calls: 0, callsGoal: 1 };
    // SDR mede o DIA. Terça, dia útil: 218 contatos/mês ÷ 21,75 = 10/dia; 44 calls = 2/dia.
    const row = { user: "sdr", contacted: 3, callsBooked: 1, goals: { contacts: { target: 218, period: "month" }, callsBooked: { target: 44, period: "month" } } };
    const s = dayScoreOf({ role: "sdr", row, today: "2026-08-25", local });
    check("título do SDR", s.title, "Placar do dia");
    check("origem", s.scope, "meta do dia");
    check("meta diária de contatos", s.lines[0].goal, 10);
    check("realizado vem do servidor junto com a meta", s.lines[0].value, 3);
    check("meta diária de calls", s.lines[1].goal, 2);
    check("calls agendadas hoje", s.lines[1].value, 1);
    check("rótulo de calls", s.lines[1].label, "Calls agendadas");
    // CLOSER mede o MÊS: contrato e receita não se repartem por dia útil sem
    // virar mentira (10/mês arredondaria pra "1 por dia").
    const closer = { user: "jonathan", won: 4, revenue: 52000, goals: { won: { target: 35 }, revenue: { target: 180000 } } };
    const c = dayScoreOf({ role: "closer", row: closer, today: "2026-08-25", local });
    check("título do closer", c.title, "Placar do mês");
    check("origem do closer", c.scope, "meta do mês");
    check("contratos no mês", c.lines[0].label, "Contratos");
    check("meta de contratos cheia", c.lines[0].goal, 35);
    check("contratos feitos", c.lines[0].value, 4);
    check("receita é dinheiro", c.lines[1].kind, "money");
    check("meta de receita cheia", c.lines[1].goal, 180000);
    check("receita feita", c.lines[1].value, 52000);
    // Meta por pessoa baixa (Vitor: 10/mês) continua sendo 10 no mês, nunca "1 por dia".
    const baixo = dayScoreOf({ role: "closer", row: { user: "v", won: 3, revenue: 9000, goals: { won: { target: 10 }, revenue: { target: 20000 } } }, today: "2026-08-25", local });
    check("meta baixa fica no mês", baixo.lines[0].goal, 10);
    // Sem meta configurada: tudo local, como era antes (nada regride).
    const semMeta = dayScoreOf({ role: "sdr", row: { user: "sdr", contacted: 3, callsBooked: 1, goals: {} }, today: "2026-08-25", local });
    check("sem meta cai na fila", semMeta.lines[0].goal, 9);
    check("sem meta usa o feito local", semMeta.lines[0].value, 1);
    check("sem meta, calls são as de hoje", semMeta.lines[1].label, "Calls de hoje");
    check("origem fila", semMeta.scope, "fila de hoje");
    check("closer sem meta cai na fila", dayScoreOf({ role: "closer", row: { user: "x", goals: {} }, today: "2026-08-25", local }).scope, "fila de hoje");
    check("sem linha no placar", dayScoreOf({ role: "sdr", row: null, today: "2026-08-25", local }).lines[0].goal, 9);
    // Fim de semana não cobra meta diária: domingo cai na régua local (o closer,
    // medido no mês, segue cobrando normalmente).
    check("domingo sem meta no SDR", dayScoreOf({ role: "sdr", row, today: "2026-08-23", local }).scope, "fila de hoje");
    check("domingo mantém o mês do closer", dayScoreOf({ role: "closer", row: closer, today: "2026-08-23", local }).scope, "meta do mês");
    console.log("✓ placar-do-dia");
  } catch (err) {
    console.error(`✗ placar-do-dia: ${err.message}`);
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
  // Bônus da remuneração: DEGRAU, não rampa (Leo, 19/08). A banda só paga
  // quando é BATIDA — 110% da meta leva o bônus de 100% inteiro, sem nada de
  // proporcional rumo ao de 120%. É a conta que vira salário, então vale teste:
  // valores do closer nível 1 (600/1000/1500/2000).
  try {
    const { legBonus, bandOf } = await server.ssrLoadModule("/src/screens/remuneracao.jsx");
    const B = (att) => legBonus(att, 600, 1000, 1500, 2000);
    const eq = (name, got, want) => { if (got !== want) throw new Error(`${name}: ${got} ≠ ${want}`); };
    eq("abaixo de 80% zera", B(0.79), 0);
    eq("80% cravado paga a 1ª banda", B(0.8), 600);
    eq("99% ainda é a banda de 80", B(0.99), 600);
    eq("100% paga a banda de 100", B(1), 1000);
    eq("110% NÃO é proporcional: paga a banda de 100", B(1.1), 1000);
    eq("119% ainda é a banda de 100", B(1.19), 1000);
    eq("120% paga a banda de 120", B(1.2), 1500);
    eq("140% paga a banda de 140", B(1.4), 2000);
    eq("150% é degrau pela metade: segue em 140", B(1.5), 2000);
    eq("160% abre o 1º degrau da escada", B(1.6), 2600);
    eq("180% soma o degrau seguinte", B(1.8), 3300);
    eq("200% segue sem teto", B(2), 4100);
    // att vem de divisão: bater a meta na régua não pode cair pra banda de baixo.
    eq("22/20 = 110% pela banda de 100", B(22 / 20), 1000);
    eq("meta cravada não escorrega", B(120000 / 120000), 1000);
    eq("24/20 = 120% cravado", B(24 / 20), 1500);
    // Plano salvo antes da coluna 140% (b140 indefinido) herda a extrapolação.
    eq("sem b140 o topo é extrapolado", legBonus(1.4, 600, 1000, 1500, undefined), 2000);
    eq("banda alcançada em 110%", bandOf(1.1), 100);
    eq("banda alcançada em 160%", bandOf(1.6), 160);
    eq("sem banda abaixo de 80%", bandOf(0.79), null);
    console.log("✓ remuneracao-degrau");
  } catch (err) {
    console.error(`✗ remuneracao-degrau: ${err.message}`);
    failed++;
  }

  // Tela Remuneração: as regras da casa e o card de trilha (tabela de níveis +
  // simulador). A tela só sai da "Área da gestão" pra quem tem a etiqueta admin,
  // e os planos chegam por efeito (não roda no SSR) — por isso o card vai
  // renderizado à parte, com um plano na mão.
  try {
    const savedGet = globalThis.localStorage.getItem;
    globalThis.localStorage.getItem = (k) =>
      (k === "cockpit_user" ? JSON.stringify({ id: "leonardo", name: "Leonardo", roles: ["closer", "admin"], screens: [] }) : null);
    const { RemuneracaoScreen, RoleCard } = await server.ssrLoadModule("/src/screens/remuneracao.jsx");
    const tela = renderToString(wrap(React.createElement(RemuneracaoScreen, {})));
    globalThis.localStorage.getItem = savedGet;
    const plano = { levels: [{ n: 1, fixed: 3000, fixedPj: 4200, metaContracts: 20, metaRevenue: 90000, b80: 600, b100: 1000, b120: 1500, b140: 2000 }], notes: "" };
    const card = renderToString(wrap(React.createElement(RoleCard, { role: "closer", saved: plano, onSave() {} })));
    const has = (name, html, must) => { if (!html.includes(must)) throw new Error(`${name} não contém "${must}"`); };
    has("regras", tela, "A banda só paga quando é batida");
    has("card", card, "Closer · Executivo de Contas");
    has("card", card, "Bônus 140%");
    // O simulador diz qual DEGRAU caiu, pra ninguém esperar valor proporcional.
    has("simulador", card, "(banda 100%)");
    console.log("✓ remuneracao");
  } catch (err) {
    console.error(`✗ remuneracao: ${err.message}`);
    failed++;
  }
  // ── Clientes: os estados do redesign de 12/09 ───────────────────────────
  // A ficha virou quatro abas e o billing ganhou faixa de estado; as duas
  // coisas dependem de dado que chega por efeito, então vão renderizadas à
  // parte, com payload na mão.
  try {
    const C = await server.ssrLoadModule("/src/screens/customers.jsx");
    const S = await server.ssrLoadModule("/src/screens/subscriptions.jsx");
    const A = await server.ssrLoadModule("/src/screens/customers-analysis.jsx");
    const has = (name, html, must) => { if (!html.includes(must)) throw new Error(`${name} não contém "${must}"`); };
    const R = (el) => renderToString(wrap(el));
    const cliente = window.SEED.CUSTOMERS[0];
    const nowIso2 = new Date().toISOString();

    // A ficha: as quatro abas existem e o cabeçalho carrega nome + dinheiro.
    const ficha = R(React.createElement(C.CustomerModal, {
      customer: cliente, lead: window.SEED.LEADS[0], product: window.SEED.SAAS[0],
      subs: [], invoices: [], planLabel: () => "Pro", lastContact: () => "hoje",
      leverOrg: null, onComplete() {}, onPatch() {}, onClose() {}, onNewReferral() {},
    }));
    for (const aba of ["Resumo", "Dinheiro", "Indicações", "Histórico"]) has("ficha", ficha, aba);
    has("ficha", ficha, "Cliente Teste");
    has("ficha", ficha, "Dinheiro do contrato");
    has("ficha", ficha, "cliente desde");

    // Cliente sem lead e sem assinatura: a ficha ainda monta.
    const semLead = R(React.createElement(C.CustomerModal, {
      customer: { id: "c9", saas: "leverads", name: "Sem Lead", arr: 0 }, lead: null, product: window.SEED.SAAS[0],
      subs: [], invoices: [], planLabel: () => "", lastContact: () => "—",
      leverOrg: null, onComplete() {}, onPatch() {}, onClose() {}, onNewReferral() {},
    }));
    has("ficha sem lead", semLead, "Sem Lead");

    // A faixa de estado do billing: números do que importa, e inadimplente
    // conta PESSOA (duas faturas vencidas do mesmo cliente = 1).
    const billing = R(React.createElement(S.BillingState, {
      subs: [
        { id: "s1", customer: "c1", status: "active", price: 1000, cycle: "monthly", periodEnd: new Date(Date.now() + 3 * 864e5).toISOString() },
        { id: "s2", customer: "c2", status: "past_due", price: 500, cycle: "monthly", periodEnd: nowIso2 },
      ],
      invoices: [
        { id: "i1", customer: "c2", status: "open", amount: 500, dueDate: new Date(Date.now() - 5 * 864e5).toISOString() },
        { id: "i2", customer: "c2", status: "open", amount: 500, dueDate: new Date(Date.now() - 35 * 864e5).toISOString() },
        { id: "i3", customer: "c1", status: "paid", amount: 1000, dueDate: nowIso2 },
      ],
      preapprovals: [], mpUnlinked: 0, sync: null, mpConfigured: false,
    }));
    has("billing", billing, "MRR das ativas");
    has("billing", billing, "Vencem em 7 dias");
    has("billing", billing, "Faturas vencidas");
    if (!/Inadimplentes[\s\S]{0,240}>1</.test(billing)) throw new Error("inadimplente deveria contar PESSOA (1), não fatura (2)");

    // O dinheiro do período: a barra empilhada e o rodapé.
    const analise = R(React.createElement(A.CustomersAnalysis, {
      customers: window.SEED.CUSTOMERS, subs: [], invoices: [], isKids: false,
      gradeDist: { counts: { A: 2, C: 1 }, sem: 1 }, nivelLegend: null,
    }));
    has("análise", analise, "Dinheiro do período");
    has("análise", analise, "recebido");
    has("análise", analise, "Churn");
    has("análise", analise, "Ticket médio");

    // Base vazia: a tela oferece o cadastro em vez de uma tabela oca.
    const vazia = (() => {
      const antes = window.SEED.CUSTOMERS;
      window.SEED.CUSTOMERS = [];
      try { return R(React.createElement(C.CustomersScreen, {})); }
      finally { window.SEED.CUSTOMERS = antes; }
    })();
    has("base vazia", vazia, "Nenhum cliente ainda");
    console.log("✓ clientes-estados");
  } catch (err) {
    console.error(`✗ clientes-estados: ${err.message}`);
    failed++;
  }

  // ── Clientes: a tabela tem que CABER (redesign de 12/09) ────────────────
  // O redesign trocou 13 colunas com minWidth 1360 (rolagem garantida) por 6
  // que cabem. A conta é frágil por natureza: basta alguém alargar uma coluna
  // pra devolver a rolagem sem perceber. Aqui a soma dos pisos + gaps é
  // comparada com o orçamento de 1024px de janela.
  try {
    const { TABLE_GRID, TABLE_GRID_GAP, TABLE_GRID_BUDGET } = await server.ssrLoadModule("/src/screens/customers.jsx");
    const cols = TABLE_GRID.trim().split(/\s+(?![^(]*\))/);
    if (cols.length !== 6) throw new Error(`esperava 6 colunas, achei ${cols.length}`);
    const floorOf = (col) => {
      const mm = col.match(/^minmax\((\d+)px/);
      if (mm) return Number(mm[1]);
      const px = col.match(/^(\d+)px$/);
      if (px) return Number(px[1]);
      throw new Error(`coluna sem piso em px: ${col}`);
    };
    const soma = cols.reduce((a, c) => a + floorOf(c), 0) + TABLE_GRID_GAP * (cols.length - 1);
    if (soma > TABLE_GRID_BUDGET) {
      throw new Error(`a tabela volta a rolar: pisos + gaps = ${soma}px, orçamento ${TABLE_GRID_BUDGET}px (1024px de janela)`);
    }
    console.log(`✓ clientes-tabela (${soma}px de ${TABLE_GRID_BUDGET})`);
  } catch (err) {
    console.error(`✗ clientes-tabela: ${err.message}`);
    failed++;
  }

  // ── Minhas atividades: a linha da fila tem que CABER (12/09) ────────────
  // Mesma disciplina de Clientes e Pipeline: a grade da linha é uma constante
  // com orçamento, então alargar coluna sem refazer a conta falha o build.
  try {
    const T = await server.ssrLoadModule("/src/screens/today.jsx");
    const cols = T.QUEUE_GRID.trim().split(/\s+(?![^(]*\))/);
    if (cols.length !== 6) throw new Error(`esperava 6 colunas, achei ${cols.length}`);
    const floorOf = (c) => {
      const mm = c.match(/^minmax\((\d+)px/) || c.match(/^(\d+)px$/);
      if (!mm) throw new Error(`coluna sem piso em px: ${c}`);
      return Number(mm[1]);
    };
    const soma = cols.reduce((a, c) => a + floorOf(c), 0) + T.QUEUE_GRID_GAP * (cols.length - 1);
    if (soma > T.QUEUE_GRID_BUDGET) throw new Error(`a fila volta a rolar: ${soma}px de ${T.QUEUE_GRID_BUDGET}`);
    // A tela monta (a fila vem por efeito, então aqui é o caminho de render).
    const tela = renderToString(wrap(React.createElement(T.TodayScreen, { onOpenLead() {}, onOpenWhatsapp() {} })));
    if (!tela.includes("Minhas atividades")) throw new Error("a tela não montou");

    // Os grupos da fila viram cabeçalho: cada chave do GROUP_ORDER precisa de
    // rótulo, senão a faixa sai com o nome interno ("noshow") na cara do time.
    const { GROUP_META, GROUP_ORDER } = T;
    for (const k of GROUP_ORDER) {
      if (!GROUP_META[k] || !GROUP_META[k][0]) throw new Error(`grupo ${k} sem rótulo no GROUP_META`);
    }
    // O painel de roteiro em PRÉ-VISUALIZAÇÃO (Ajustes → Scripts) não pode
    // bater na API nem exigir a fila: é o caminho que o handoff manda preservar.
    const item = {
      l: { ...window.SEED.LEADS[1], stageAttempts: 2, nextActionNote: "cobrar a proposta" },
      kind: "followup", group: "closer", stage: "Negociação",
      due: { t: Date.now() - 3600000, type: "touch" }, who: "leonardo",
    };
    const painel = renderToString(wrap(React.createElement(T.ScriptPanel, {
      item, saasCfg: window.SEED.SAAS[0], leads: window.SEED.LEADS, preview: true,
      onPatch() {}, onMove() {}, onMoveMeet() {}, onAfter() {}, onClose() {}, onTouch() {}, onOpenLead() {},
    })));
    if (!painel.includes("Roteiro")) throw new Error("o painel não montou em preview");
    if (!painel.includes("Depois da ação")) throw new Error("preview deveria mostrar a nota do Depois da ação");
    if (painel.includes("abrir lead")) throw new Error("preview não deveria oferecer abrir lead");
    console.log(`✓ minhas-atividades (${soma}px de ${T.QUEUE_GRID_BUDGET})`);
  } catch (err) {
    console.error(`✗ minhas-atividades: ${err.message}`);
    failed++;
  }

  // ── Pipeline: a Lista tem que CABER e ATRASADOS vem primeiro (12/09) ────
  try {
    const P = await server.ssrLoadModule("/src/screens/pipeline.jsx");
    const cols = P.LIST_GRID.trim().split(/\s+(?![^(]*\))/);
    if (cols.length !== 6) throw new Error(`esperava 6 colunas, achei ${cols.length}`);
    const floorOf = (c) => {
      const mm = c.match(/^minmax\((\d+)px/) || c.match(/^(\d+)px$/);
      if (!mm) throw new Error(`coluna sem piso em px: ${c}`);
      return Number(mm[1]);
    };
    const soma = cols.reduce((a, c) => a + floorOf(c), 0) + P.LIST_GRID_GAP * (cols.length - 1);
    if (soma > P.LIST_GRID_BUDGET) throw new Error(`a lista volta a rolar: ${soma}px de ${P.LIST_GRID_BUDGET}`);

    // A ordem das seções é o coração do bloco 3: o vencido vem ANTES da agenda.
    const ordem = P.LIST_SECTIONS.map(([k]) => k);
    if (ordem[0] !== "late") throw new Error(`Atrasados deveria ser a 1ª seção, é ${ordem.indexOf("late") + 1}ª`);
    if (ordem.indexOf("today") !== 1) throw new Error("Hoje deveria vir logo depois de Atrasados");
    if (ordem[ordem.length - 1] !== "closed") throw new Error("Finalizados deveria ser a última");
    const tela = renderToString(wrap(React.createElement(P.PipelineScreen, { onNav() {}, onOpenLead() {} })));
    if (!tela.includes("Pipeline")) throw new Error("a tela não montou");
    console.log(`✓ pipeline-lista (${soma}px de ${P.LIST_GRID_BUDGET})`);
  } catch (err) {
    console.error(`✗ pipeline-lista: ${err.message}`);
    failed++;
  }

  // ── Contratos: modelos e histórico viraram tabela (redesign de 12/09) ───
  // As duas tabelas nasceram de cards/linhas soltas e têm o mesmo risco das
  // outras: alguém alarga uma coluna e a rolagem horizontal volta calada.
  try {
    const C = await server.ssrLoadModule("/src/screens/contracts.jsx");
    const floorOf = (col) => {
      const mm = col.match(/^minmax\((\d+)px/);
      if (mm) return Number(mm[1]);
      const px = col.match(/^(\d+)px$/);
      if (px) return Number(px[1]);
      throw new Error(`coluna sem piso em px: "${col}"`);
    };
    for (const [nome, grid] of [["modelos", C.MODEL_GRID], ["histórico", C.HIST_GRID]]) {
      const cols = grid.trim().split(/\s+(?![^(]*\))/);
      if (cols.length !== 5) throw new Error(`${nome}: esperava 5 colunas, achei ${cols.length}`);
      const soma = cols.reduce((a, c) => a + floorOf(c), 0) + C.GRID_GAP * (cols.length - 1);
      if (soma > C.GRID_BUDGET) throw new Error(`${nome} volta a rolar: ${soma}px de ${C.GRID_BUDGET}`);
    }
    console.log("✓ contratos-tabelas");
  } catch (err) {
    console.error(`✗ contratos-tabelas: ${err.message}`);
    failed++;
  }

  // ── Propostas: o funil e as duas tabelas (redesign de 12/09) ────────────
  // A tela virou funil (gerada → aberta → fechou) + templates em linhas +
  // UMA tabela de geradas com filtros (antes a aba "Geradas" e a seção
  // "Geradas recentemente" mostravam a mesma lista). Os dados chegam por
  // efeito, que não roda no SSR: aqui valem a moldura e o orçamento de
  // largura das duas tabelas.
  try {
    const P = await server.ssrLoadModule("/src/screens/proposals.jsx");
    const html = renderToString(wrap(React.createElement(P.ProposalsScreen, { saasId: "leverads" })));
    for (const must of ["Geradas · 30d", "Abertas", "Fecharam", "Propostas geradas"]) {
      if (!html.includes(must)) throw new Error(`a tela não contém "${must}"`);
    }
    if (html.includes("Geradas recentemente")) throw new Error("a seção duplicada voltou");
    const floorOf = (col) => {
      const mm = col.match(/^minmax\((\d+)px/);
      if (mm) return Number(mm[1]);
      const px = col.match(/^(\d+)px$/);
      if (px) return Number(px[1]);
      throw new Error(`coluna sem piso em px: "${col}" (fr puro deixa a tabela rolar de novo)`);
    };
    for (const [nome, grid] of [["templates", P.TPL_GRID], ["geradas", P.PROP_GRID]]) {
      const cols = grid.trim().split(/\s+(?![^(]*\))/);
      if (cols.length !== 5) throw new Error(`${nome}: esperava 5 colunas, achei ${cols.length}`);
      const soma = cols.reduce((a, c) => a + floorOf(c), 0) + P.GRID_GAP * (cols.length - 1);
      if (soma > P.GRID_BUDGET) throw new Error(`${nome} volta a rolar: ${soma}px de ${P.GRID_BUDGET}`);
    }
    console.log("✓ propostas");
  } catch (err) {
    console.error(`✗ propostas: ${err.message}`);
    failed++;
  }

  // ── Treinamentos (redesign de 12/09) ────────────────────────────────────
  // A tela tem cinco sub-telas e todos os dados chegam por efeito, que não roda
  // no SSR: por isso os blocos vão renderizados à parte, com payload na mão. O
  // que se exercita aqui são os estados que o checklist do handoff pede e que
  // ninguém lembra de abrir na mão: fila vazia, memória sem base, raio-x e card
  // sem frente.
  try {
    const T = await server.ssrLoadModule("/src/screens/training.jsx");
    const has = (name, html, must) => { if (!html.includes(must)) throw new Error(`${name} não contém "${must}"`); };
    const R = (el) => renderToString(wrap(el));
    const decks = [
      { role: "geral_negocio", label: "Geral · Negócio", total: 150, learned: 120, counts: { new: 2, learning: 1, review: 3 } },
      { role: "closer", label: "Closer", total: 150, learned: 30, counts: { new: 0, learning: 0, review: 0 } },
    ];

    const hero = R(React.createElement(T.StartCard, { decks, exam: null, onExam() {}, onStudy() {}, onFun() {} }));
    has("hero", hero, "Da vez");
    has("hero", hero, "cards no treino de hoje");
    has("hero", hero, "Estudar");
    has("hero", hero, "aprendendo");          // a quebra virou micro-número com rótulo
    has("hero", hero, "4fun");                 // o 4fun mora no rodapé do hero

    // Fila zerada: o número vira 0 e o 4fun sobe pra ação primária.
    const vazio = R(React.createElement(T.StartCard, {
      decks: decks.map((d) => ({ ...d, counts: { new: 0, learning: 0, review: 0 } })),
      exam: null, onExam() {}, onStudy() {}, onFun() {},
    }));
    has("hero vazio", vazio, "fila zerada");
    if (vazio.includes("Estudar →")) throw new Error("hero vazio não deveria oferecer Estudar");

    // Prova pendente vence a fila.
    const comProva = R(React.createElement(T.StartCard, { decks, exam: { id: "e1", count: 30 }, onExam() {}, onStudy() {}, onFun() {} }));
    has("hero prova", comProva, "Prova de checkpoint");

    const baralhos = R(React.createElement(T.DeckList, { decks }));
    has("baralhos", baralhos, "Seus baralhos");
    has("baralhos", baralhos, "todo o time");
    has("baralhos", baralhos, "80%");          // 120 de 150 dominados

    const memoria = R(React.createElement(T.MemoryCard, {
      stats: { memory: { retention30d: 88, reviews30d: 42, mature: 120, young: 30, seen: 150, deckSize: 300, firstTryPct: 71, lastExam: { score: 90, status: "passed" }, examsDone: 3 } },
    }));
    has("memória", memoria, "Retenção 30d");
    has("memória", memoria, "88%");
    has("memória", memoria, "de 300");

    // Sem base ainda: mostra "—", nunca 0% (zero é afirmação, falta de dado não).
    const memoriaVazia = R(React.createElement(T.MemoryCard, {
      stats: { memory: { retention30d: null, reviews30d: 0, mature: 0, young: 0, seen: 0, deckSize: 300, firstTryPct: null, lastExam: null, examsDone: 0 } },
    }));
    has("memória sem base", memoriaVazia, "—");
    if (memoriaVazia.includes("0%")) throw new Error("memória sem base não pode afirmar 0%");

    const prova = R(React.createElement(T.NextExamCard, { stats: { nextExam: { every: 30, pass: 70, pool: 12, remaining: 18 } } }));
    has("próxima prova", prova, "a prova de checkpoint cai a cada 30");
    // Prova desligada nas configurações não renderiza card nenhum.
    if (R(React.createElement(T.NextExamCard, { stats: { nextExam: null } })) !== "") throw new Error("prova desligada deveria sumir");

    // Progresso: card que volta pra fixar entra como acréscimo, não infla o total.
    const prog = R(React.createElement(T.SessionProgress, { done: 24, total: 22 }));
    has("progresso", prog, "22 de 22");
    has("progresso", prog, "+2 que voltaram");

    const raiox = R(React.createElement(T.PersonDetail, {
      today: new Date().toISOString().slice(0, 10),
      user: {
        id: "ana", name: "Ana", roles: ["sdr"], deckSize: 300, seen: 150, mature: 120, young: 30,
        dueToday: 4, overdue: 2, doneToday: 6, streak: 3, retention30d: { pct: 88, n: 42 }, retention7d: { pct: 90, n: 10 },
        firstTryPct: 71, reviewsPerDay30d: 12, activeDays30d: 22, medianMs: 4200, rushPct: 8,
        fun: { last30: 20, total: 60, hitPct: 80 }, examsDone: 3, examsFailed: 1, examAvg: 78,
        lastExam: { score: 90, status: "passed" }, examPending: false, exams: [],
        retentionByRole: [{ role: "closer", label: "Closer", pct: 84, n: 20 }],
        weekly: [{ start: "2026-07-06", pct: 80, n: 10 }, { start: "2026-07-13", pct: null, n: 0 }],
        forecast: [{ day: "2026-09-13", n: 5 }], days: {},
      },
    }));
    for (const bloco of ["Memória", "Ritmo", "Provas", "Constância"]) has("raio-x", raiox, bloco);

    const lista = R(React.createElement(T.CardList, {
      cards: [
        { id: "c1", role: "closer", type: "basic", front: "Objeção: tá caro", back: "a técnica" },
        { id: "c2", role: "closer", type: "basic", front: "", back: "" },
      ],
      total: 2, q: "", setQ() {}, sel: "c1", onSelect() {}, onAdd() {}, roleLabel: "Closer",
    }));
    has("lista", lista, "Objeção: tá caro");
    has("lista", lista, "card novo · sem frente");   // rascunho não se esconde
    has("lista", lista, "rascunho");
    has("lista", lista, "2 cards em Closer");

    // Ordem da Equipe: prova travada na frente, atrasado pesando mais que fila
    // do dia, e quem está em dia no fim. É a régua que decide de quem cuidar.
    const time = [
      { id: "emdia", dueToday: 0, overdue: 0, examsFailed: 0, retention30d: { pct: 92, n: 30 } },
      { id: "fila", dueToday: 8, overdue: 0, examsFailed: 0 },
      { id: "atrasado", dueToday: 3, overdue: 3, examsFailed: 0 },
      { id: "prova", dueToday: 0, overdue: 0, examPending: true },
    ];
    const ordem = [...time].sort((a, b) => T.urgencyOf(b) - T.urgencyOf(a)).map((u) => u.id);
    if (ordem.join(",") !== "prova,atrasado,fila,emdia") throw new Error(`ordem por urgência saiu ${ordem.join(",")}`);
    if (T.needsAttention(time[0])) throw new Error("quem está em dia não pede atenção");
    // Retenção baixa COM base pede atenção; sem base (n=0) não afirma nada.
    if (!T.needsAttention({ retention30d: { pct: 50, n: 20 } })) throw new Error("retenção baixa deveria pedir atenção");
    if (T.needsAttention({ retention30d: { pct: 0, n: 0 } })) throw new Error("sem base não é diagnóstico");

    // A tela inteira: pega import quebrado e undefined no caminho de render.
    has("tela", R(React.createElement(T.TrainingScreen, {})), "Treinamentos");
    console.log("✓ training");
  } catch (err) {
    console.error(`✗ training: ${err.message}`);
    failed++;
  }
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} tela(s) falharam`); process.exit(1); }
console.log("smoke ok");
