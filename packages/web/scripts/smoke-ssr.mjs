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
    ["overview-meta", "/src/screens/overview.jsx", "MetaMesCard", { pace: fakePace, goal: fakeGoal, onNav() {} }, "Régua de contratos"],
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
} finally {
  await server.close();
}
if (failed) { console.error(`${failed} tela(s) falharam`); process.exit(1); }
console.log("smoke ok");
