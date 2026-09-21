import {mindmapsReview,mindmapsReviewMock} from "./mindmaps-review-mock.js";
import {tasksReview,tasksReviewMock} from "./tasks-review-mock.js";
import {desempenhoReview,desempenhoReviewMock} from "./desempenho-review-mock.js";
import {integrationsReview,integrationsReviewMock} from "./integrations-review-mock.js";
import {callsReview,callsReviewMock} from "./calls-review-mock.js";
import {analiseReview,analiseReviewMock} from "./analise-review-mock.js";
import {blogReview,blogReviewMock} from "./blog-review-mock.js";
import {disparosReview,disparosReviewMock} from "./disparos-review-mock.js";
import {formsReview,formsReviewMock} from "./forms-review-mock.js";
import {metricsReview,metricsReviewMock} from "./metrics-review-mock.js";
import { socialReview, socialReviewMock } from "./social-review-mock.js";
import { agendaReview, agendaReviewMock } from "./agenda-review-mock.js";
import { intformReview, intformReviewMock } from "./intform-review-mock.js";
import { contractsReview, contractsReviewMock } from "./contracts-review-mock.js";
import { offersReview, offersReviewMock } from "./offers-review-mock.js";
import { proposalsReview, proposalsReviewMock } from "./proposals-review-mock.js";
import { customersReview, customersReviewMock } from "./customers-review-mock.js";
import { pipelineReview, pipelineMock } from "./pipeline-mock.js";
import { todayReview, todayMock } from "./today-mock.js";
import { overviewReview, overviewMock } from "./overview-mock.js";
import { beginPageRequest } from "../src/lib/navigation-loading.js";
import { customersCashMock } from "./customers-cash-mock.js";
// Dublê da API pro preview de telas (14/09). NÃO entra no build de produção:
// só o vite.preview.config.js troca lib/api.js por este arquivo, pra conferir
// o desenho de uma tela sem subir a API nem tocar em banco nenhum.
import { integrationFormsMock } from "./integration-forms-mock.js";
import { marketingCollections, marketingCrud, marketingMock } from "./marketing-mock.js";
const marketingPreview = typeof location !== "undefined" && new URLSearchParams(location.search).has("marketing");
import { inboxMock } from "./inbox-mock.js";
const inboxPreview = typeof location !== "undefined" && new URLSearchParams(location.search).has("inbox");
import { trainingMock } from "./training-mock.js";
import { ticketsMock } from "./tickets-mock.js";
import { financeMock } from "./finance-mock.js";
const financePreview = typeof location !== "undefined" && new URLSearchParams(location.search).has("finance");
import { teamPreviewScore } from "./team-mock.js";
const teamPreview = typeof location !== "undefined" && new URLSearchParams(location.search).has("team");
const DIA = 86400000;
const hoje = new Date();
const emHoras = (h, m = 0) => { const d = new Date(hoje); d.setHours(h, m, 0, 0); return d.toISOString(); };
const emDias = (n, h = 9) => { const d = new Date(hoje.getTime() + n * DIA); d.setHours(h, 0, 0, 0); return d.toISOString(); };

export const LEADS_FAKE = [
  { id: "v1", saas: "leverads", name: "Otávio Braga", company: "Braga Ferramentas", stage: "Ganho", owner: "leo", closer: "lucas", amount: 2850, wonAt: emDias(-2), createdAt: emDias(-20) },
  { id: "v2", saas: "leverads", name: "Sandra Melo", company: "Melo Cosméticos", stage: "Ganho", owner: "leo", closer: "tiago", amount: 3300, wonAt: emDias(-5), createdAt: emDias(-25) },
  { id: "v3", saas: "leverads", name: "Ricardo Nunes", company: "RN Distribuidora", stage: "Ganho", owner: "leo", closer: "lucas", amount: 4800, wonAt: emDias(-9), createdAt: emDias(-28) },
  // confirmar call (call hoje, dono != closer)
  { id: "l1", saas: "leverads", name: "Juliana Alves", company: "Sul Importados", stage: "Call marcada", owner: "leo", closer: "lucas", amount: 3100, phone: "5541999990001", callAt: emHoras(15, 50), createdAt: emDias(-3), stageSince: emDias(-1), accounts: "1", listings: "500-2k" },
  // compromisso marcado (call hoje, dono = closer)
  { id: "l2", saas: "leverads", name: "Bruno Teixeira", company: "Auto Peças Já", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2600, phone: "5541999990002", callAt: emHoras(16, 0), createdAt: emDias(-5), stageSince: emDias(-2) , accounts: "2", listings: "2-10k" },
  // leads novos
  { id: "l3", saas: "leverads", name: "Fernanda Dias", company: "Casa & Cia", stage: "Novo lead", owner: "leo", amount: 1900, phone: "5541999990003", createdAt: emDias(0, 8), accounts: "3-5", listings: "10k+" },
  { id: "l4", saas: "leverads", name: "Marcos Lima", company: "MegaPeças RP", stage: "Novo lead", owner: "leo", amount: 4200, phone: "5541999990004", createdAt: emDias(0, 10), accounts: "6-10", listings: "≤100" },
  // retomadas (toque vencido, fase sdr)
  { id: "l5", saas: "leverads", name: "Carla Nunes", company: "Casa Bela Utilidades", stage: "Qualificação", owner: "leo", amount: 2300, phone: "5541999990005", nextActionAt: emHoras(9, 30), createdAt: emDias(-8), stageSince: emDias(-4), stageAttempts: 2 , accounts: "10+", listings: "100-500" },
  { id: "l6", saas: "leverads", name: "Diego Martins", company: "Eletro Sul", stage: "Qualificação", owner: "leo", amount: 1500, phone: "5541999990006", nextActionAt: emHoras(11, 30), createdAt: emDias(-9), stageSince: emDias(-5), stageAttempts: 3 , accounts: "1", listings: "500-2k" },
  // follow-up do closer
  { id: "l7", saas: "leverads", name: "Pedro Rocha", company: "Leões do Bebê", stage: "Proposta", owner: "leo", closer: "lucas", amount: 5400, phone: "5541999990007", nextActionAt: emDias(-1, 18), createdAt: emDias(-14), stageSince: emDias(-6), stageAttempts: 4 , accounts: "2", listings: "2-10k" },
  { id: "l8", saas: "leverads", name: "Rafael Duarte", company: "Ferragens Duarte", stage: "Proposta", owner: "leo", closer: "lucas", amount: 3300, phone: "5541999990008", nextActionAt: emDias(-2, 11), createdAt: emDias(-20), stageSince: emDias(-9), stageAttempts: 5 , accounts: "3-5", listings: "10k+" },
  // feito hoje (fica na fila, riscado)
  { id: "l9", saas: "leverads", name: "Aline Souza", company: "Vitrine Pet", stage: "Qualificação", owner: "leo", amount: 1200, phone: "5541999990009", nextActionAt: emHoras(10, 0), lastActivityAt: emHoras(10, 5), lastActivityType: "whatsapp", createdAt: emDias(-6), stageSince: emDias(-3) , accounts: "6-10", listings: "≤100" },
  // sem data
  { id: "l10", saas: "leverads", name: "Thiago Barros", company: "Barros Ferramentas", stage: "Qualificação", owner: "leo", amount: 2100, phone: "5541999990010", createdAt: emDias(-11), stageSince: emDias(-7) , accounts: "10+", listings: "100-500" },
  { id: "l11", saas: "leverads", name: "Lívia Castro", company: "Castro Bebidas", stage: "Proposta", owner: "leo", closer: "lucas", amount: 4800, phone: "5541999990011", createdAt: emDias(-13), stageSince: emDias(-8) , accounts: "1", listings: "500-2k" },
  // amanhã e próximos dias
  { id: "l12", saas: "leverads", name: "Ricardo Nunes", company: "RN Distribuidora", stage: "Call marcada", owner: "leo", closer: "leo", amount: 4800, phone: "5541999990012", callAt: emDias(1, 17), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "2", listings: "2-10k" },
  { id: "l13", saas: "leverads", name: "Renata Prado", company: "Moda Prado", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2900, phone: "5541999990013", callAt: emDias(3, 15), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "3-5", listings: "10k+" },
  { id: "l14", saas: "leverads", name: "Otávio Braga", company: "Braga Ferramentas", stage: "Call marcada", owner: "leo", closer: "leo", amount: 2850, phone: "5541999990014", callAt: emDias(4, 16), createdAt: emDias(-4), stageSince: emDias(-1) , accounts: "6-10", listings: "≤100" },
];

export const CLIENTES_FAKE = [
  { id: "c1", saas: "leverads", name: "Zpack Embalagens", contact: "Marianna Reis", arr: 28800, plan: "Pro trimestral", startedAt: emDias(-120), milestonesDone: { onboarding: emDias(-118), contas: emDias(-110), carga: emDias(-100), anuncio: emDias(-90), rotina: emDias(-70), resultado: emDias(-40) } },
  { id: "c2", saas: "leverads", name: "Galante Comércio", contact: "Rodrigo Galante", arr: 300000, plan: "Enterprise anual", keyAccount: true, startedAt: emDias(-260), milestonesDone: { onboarding: emDias(-255), contas: emDias(-250), carga: emDias(-240), anuncio: emDias(-230), rotina: emDias(-200), resultado: emDias(-170) } },
  { id: "c3", saas: "leverads", name: "Braga Ferramentas", contact: "Otávio Braga", arr: 34200, plan: "Pro anual", startedAt: emDias(-90), milestonesDone: { onboarding: emDias(-88), contas: emDias(-80), carga: emDias(-70), anuncio: emDias(-60) } },
  { id: "c4", saas: "leverads", name: "RN Distribuidora", contact: "Ricardo Nunes", arr: 57600, plan: "Pro anual", startedAt: emDias(-60), milestonesDone: { onboarding: emDias(-58), contas: emDias(-50), carga: emDias(-40) } },
  { id: "c5", saas: "leverads", name: "Lojão do Bebê", contact: "Pedro Rocha", arr: 40800, plan: "Pro anual", startedAt: emDias(-45), milestonesDone: { onboarding: emDias(-44), contas: emDias(-40), carga: emDias(-30), anuncio: emDias(-20), rotina: emDias(-10) } },
  { id: "c6", saas: "leverads", name: "Melo Cosméticos", contact: "Sandra Melo", arr: 19800, plan: "Pro semestral", startedAt: emDias(-150), milestonesDone: { onboarding: emDias(-148), contas: emDias(-140), carga: emDias(-130), anuncio: emDias(-120), rotina: emDias(-100), resultado: emDias(-70) } },
  { id: "c7", saas: "leverads", name: "Casa Bela Utilidades", contact: "Carla Nunes", arr: 5400, plan: "Essencial mensal", startedAt: emDias(-20), milestonesDone: { onboarding: emDias(-19), contas: emDias(-12) } },
  { id: "c8", saas: "leverads", name: "Vitrine Pet", contact: "Aline Souza", arr: 10800, plan: "Essencial mensal", startedAt: emDias(-200), endedAt: emDias(-12) },
];

const TAREFAS = [
  { id: "t1", saas: "leverads", title: "Refazer o roteiro de objeção de preço", assignees: ["leo"], dueDate: new Date(hoje.getTime() - 2 * DIA).toISOString().slice(0, 10), column: "todo", board: "b1", priority: "P1" },
  { id: "t2", saas: "leverads", title: "Gravar vídeo da dor estoque parado", assignees: ["leo"], dueDate: new Date(hoje.getTime() + 4 * DIA).toISOString().slice(0, 10), column: "todo", board: "b1" },
  { id: "t3", saas: "leverads", title: "Ligar para o financeiro da RN Distribuidora", assignees: ["leo"], dueDate: new Date(hoje).toISOString().slice(0, 10), column: "todo", board: "b1" },
  { id: "t4", saas: "leverads", title: "Página de planos com a tabela nova", assignees: ["leo"], column: "doing", board: "b1" },
  { id: "t5", saas: "leverads", title: "Texto do e-mail de boas-vindas", assignees: ["leo"], column: "todo", board: "b1" },
];

let notificacoes = [
  { id: "n1", saas: "leverads", by: "leo", type: "wa_waiting", text: "Auto Peças Santos está esperando uma resposta há 3 horas.", at: emDias(0), read: false, link: { screen: "whatsapp", thread: "demo" } },
  { id: "n2", saas: "leverads", by: "lucas", type: "mention", text: "Lucas mencionou você no roteiro de objeção de preço.", at: emDias(-1), read: false, task: "t1" },
  { id: "n3", saas: "leverads", by: "tiago", type: "assigned", text: "Ligar para o financeiro da RN Distribuidora.", at: emDias(-1), read: false, task: "t3" },
  { id: "n4", saas: "leverads", by: "api", type: "ticket_sla_breach", text: "SLA estourado: #1042 Painel não carrega os anúncios do Mercado Livre passou do prazo de 1ª resposta", at: emDias(0), read: false, task: "tk1", link: { screen: "tickets", thread: "tk1" } },
];

const RESPOSTAS = {
  ...customersCashMock,
  ...trainingMock,
  ...ticketsMock,
  notifications: () => ({ unread: notificacoes.filter((n) => !n.read).length, items: notificacoes }),
  notificationsRead: ({ all, ids = [] }) => { notificacoes = notificacoes.map((n) => all || ids.includes(n.id) ? { ...n, read: true } : n); return { ok: true }; },
  list: (col) => col === "leads" ? LEADS_FAKE : col === "customers" ? CLIENTES_FAKE : col === "tasks" ? TAREFAS : col === "task_boards" ? [{ id: "b1", saas: "leverads", columns: [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Em andamento" }, { key: "done", name: "Concluído", done: true }] }] : [],
  desempenho: () => ({ logs: { leo: { socialSelling: 6 } } }),
  // Meta da janela e pace: é o que o termômetro da Visão geral desenha.
  paceWindow: () => ({
    since: "2026-09-01", until: "2026-09-30", today: "2026-09-14",
    businessDays: 21, businessDaysElapsed: 8, ended: false, current: true, saas: "leverads",
    sale: { target: 128000, sold: 10950, contracted: 10950, progress: 0.0855, expectedProgress: 0.38, status: "behind" },
    contracts: { target: 35, sold: 3, progress: 0.0857, expectedProgress: 0.38, status: "behind" },
  }),
  pipelinePace: () => ({
    month: "2026-09", today: "2026-09-14",
    context: { averageEntry: 3650, averageEntrySource: "initial_payments", wonMonth: 3 },
    conversions: {
      contactRate: { value: 14 / 18, source: "history" },
      bookingRate: { value: 9 / 14, source: "history" },
      showRate: { value: 7 / 9, source: "history" },
      closeRate: { value: 3 / 7, source: "history" },
    },
    sale: { target: 128000, sold: 10950, soldToday: 0, gap: 117050, expectedToDate: 48640,
      progress: 0.0855, expectedProgress: 0.38, status: "behind", projected: 28744,
      actualDailyPace: 1369, requiredDailyPace: 9004, remainingBusinessDays: 13, elapsedBusinessDays: 8, totalBusinessDays: 21, targetConfigured: true },
    contracts: { target: 35, sold: 3, soldToday: 0, gap: 32, progress: 0.0857, expectedToDate: 13, expectedProgress: 0.38, status: "behind" },
  }),
  scoreboard: () => ({
    sdr: [{ user: "leo", name: "Leonardo", contacted: 6, callsBooked: 3, leadsNew: 4, revenue: 10950, won: 3, goals: { revenue: { target: 90000, period: "month" }, won: { target: 25, period: "month" } } }],
    closer: [
      { user: "lucas", name: "Lucas", revenue: 7650, won: 2, shown: 5, goals: { revenue: { target: 52000, period: "month" }, won: { target: 14, period: "month" } } },
      { user: "tiago", name: "Tiago", revenue: 3300, won: 1, shown: 3, goals: { revenue: { target: 44000, period: "month" }, won: { target: 12, period: "month" } } },
    ],
    team: { leadsNew: 18, contacted: 14, reachedCohort: 14, contactedCohort: 14, callsBooked: 9, bookedCohort: 9, shown: 7, noShow: 2, won: 3, revenue: 10950, contactRate: 77.8, bookingRate: 64.3, showRate: 77.8, closeRatePeriod: 42.9,
      monthTargets: { leads: 200, contacts: 160, callsBooked: 48, callsShown: 36, won: 35 },
      classes: { semente: { leads: 3, won: 1 }, rede: { leads: 9, won: 1 }, alvo: { leads: 6, won: 1 } },
    },
  }),
  marketingMetrics: () => ({ totals: { spend: 1152, cpl: 64, roas: 9.5 } }),
  metrics: () => ({ window: { cac: 384 }, ltv: { value: 5040, months: 12, ltvCac: 13.1 } }),
  listActivities: () => [],
  consultations: () => [],
};

const vazio = () => Promise.resolve(null);

const mockApi = new Proxy({}, {
  get(_, nome) {
    if (mindmapsReview && Object.hasOwn(mindmapsReviewMock,nome)) return mindmapsReviewMock[nome];
    if (tasksReview && Object.hasOwn(tasksReviewMock,nome)) return tasksReviewMock[nome];
    if (desempenhoReview && Object.hasOwn(desempenhoReviewMock,nome)) return desempenhoReviewMock[nome];
    if (integrationsReview && Object.hasOwn(integrationsReviewMock,nome)) return integrationsReviewMock[nome];
    if (callsReview && Object.hasOwn(callsReviewMock,nome)) return callsReviewMock[nome];
    if (analiseReview && Object.hasOwn(analiseReviewMock,nome)) return analiseReviewMock[nome];
    if (blogReview && Object.hasOwn(blogReviewMock,nome)) return blogReviewMock[nome];
    if (disparosReview && Object.hasOwn(disparosReviewMock,nome)) return disparosReviewMock[nome];
    if (formsReview && Object.hasOwn(formsReviewMock,nome)) return formsReviewMock[nome];
    if (metricsReview && Object.hasOwn(metricsReviewMock,nome)) return metricsReviewMock[nome];
    if (socialReview && Object.hasOwn(socialReviewMock,nome)) return socialReviewMock[nome];
    if (agendaReview && Object.hasOwn(agendaReviewMock,nome)) return agendaReviewMock[nome];
    if (intformReview && Object.hasOwn(intformReviewMock,nome)) return intformReviewMock[nome];
    if (nome === "integrationFormQuestions") return kind => Promise.resolve(integrationFormsMock.questions(kind));
    if (contractsReview && Object.hasOwn(contractsReviewMock,nome)) return contractsReviewMock[nome];
    if (offersReview && Object.hasOwn(offersReviewMock,nome)) return offersReviewMock[nome];
    if (proposalsReview && Object.hasOwn(proposalsReviewMock, nome)) return (...args) => Promise.resolve().then(() => proposalsReviewMock[nome](...args));
    if (customersReview && Object.hasOwn(customersReviewMock,nome)) return customersReviewMock[nome];
    if (pipelineReview && Object.hasOwn(pipelineMock, nome)) return pipelineMock[nome];
    if (todayReview && Object.hasOwn(todayMock, nome)) return todayMock[nome];
    if (overviewReview && Object.hasOwn(overviewMock, nome)) return overviewMock[nome];
    if (financePreview && nome === "fin") return (...args) => Promise.resolve(financeMock(...args));
    if (financePreview && nome === "expensesSummary") return () => Promise.resolve({ ai: 0, wa: 0 });
    if (teamPreview && nome === "scoreboard") return () => Promise.resolve({ ...RESPOSTAS.scoreboard(), ...teamPreviewScore });
    if (inboxPreview && Object.hasOwn(inboxMock, nome)) return (...args) => Promise.resolve().then(() => inboxMock[nome](...args));
    if (inboxPreview && nome === "update") return (col, id, patch) => Promise.resolve().then(() => { const row = (window.SEED[col.toUpperCase()] || []).find((r) => r.id === id); if (row) Object.assign(row, patch); return row; });
    if (marketingPreview && Object.hasOwn(marketingMock, nome)) return (...args) => Promise.resolve().then(() => marketingMock[nome](...args));
    if (Object.hasOwn(integrationFormsMock, nome) || (marketingPreview && Object.hasOwn(marketingCrud, nome))) return (col, ...args) => Promise.resolve().then(() => {
      if (col === "integration_forms" && integrationFormsMock[nome]) return integrationFormsMock[nome](...args);
      if (marketingPreview && Object.hasOwn(marketingCollections, col) && marketingCrud[nome]) return marketingCrud[nome](col, ...args);
      return RESPOSTAS[nome]?.(col, ...args) ?? null;
    });
    if (nome === "bootstrap") return () => Promise.resolve(window.SEED);
    if (nome === "listUsers") return () => Promise.resolve(window.SEED.USERS);
    if (RESPOSTAS[nome]) return (...a) => Promise.resolve(RESPOSTAS[nome](...a));
    if (nome === "then") return undefined;
    return (...a) => { console.info("[preview] api." + String(nome), a); return vazio(); };
  },
});

// Simula consultas desencontradas sem subir API/banco. ?splash&delay=1500
// &fail=scoreboard ou &hang=scoreboard exercitam erro e a saída de espera longa.
const failedOnce = new Set();
const loadingParams = new URLSearchParams(location.search);
const delay = loadingParams.has("splash") ? Math.max(0, Number(loadingParams.get("delay")) || 0) : 0;
export const api = new Proxy(mockApi, {
  get(target, name) {
    const fn = target[name];
    if (typeof fn !== "function") return fn;
    return async (...args) => {
      const method = /^(create|update|delete|save|send|set|remove|login|logout)/.test(String(name)) ? "POST" : "GET";
      const finish = beginPageRequest(method);
      try {
        if (loadingParams.has("review") && loadingParams.get("slow") === name) await new Promise(resolve => setTimeout(resolve, 2000));
        if (loadingParams.has("review") && loadingParams.get("failOnce") === name && !failedOnce.has(name)) { failedOnce.add(name); throw new Error("Falha simulada na prévia"); }
        if (loadingParams.has("splash") && loadingParams.get("hang") === name) await new Promise(() => {});
        if (delay) await new Promise((resolve) => setTimeout(resolve, name === "scoreboard" ? delay * 2 : delay));
        if (loadingParams.has("splash") && loadingParams.get("fail") === name) throw new Error("Falha simulada na prévia");
        return await fn(...args);
      } finally { finish(); }
    };
  },
});

export const getKey = () => "preview";
export const setKey = () => {};
export const clearKey = () => {};
export const assetUrl = (p) => p;
export const eventsUrl = () => "";
export const upload = () => Promise.resolve(null);
export default api;
