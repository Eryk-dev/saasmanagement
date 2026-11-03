import {settingsReview,settingsReviewMock} from "./settings-review-mock.js";
import {expensesReview,expensesReviewMock} from "./expenses-review-mock.js";
import {remuneracaoReview,remuneracaoReviewMock} from "./remuneracao-review-mock.js";
import {metasReview,metasReviewMock} from "./metas-review-mock.js";
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
import { etapasPreview, etapasMock } from "./etapas-mock.js";
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
import { financeMock, financeMpPayments, financeRules } from "./finance-mock.js";
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

// Exemplos do Lever CRM na prévia: uma integração e um acompanhamento do
// Galante Comércio (c2), com reunião marcada, e o placar de comparecimento.
const integracaoPreview = {
  id: "ob_prev_1", customer: "c2", lead: "", kind: "novo_produto", stage: "configuracao", integrator: "lucas",
  kickoffAt: "2026-09-15T13:00:00.000Z", plannedGoLiveAt: "2026-09-29T13:00:00.000Z", notes: "Conta OEM liberada; falta conectar a segunda conta do ML.",
  items: [
    { id: "i1", title: "Kickoff com o cliente", side: "lever", dueAt: "", doneAt: "2026-09-15T14:00:00.000Z" },
    { id: "i2", title: "Conectar as contas do Mercado Livre", side: "cliente", dueAt: "2026-09-19", doneAt: "", help: "o cliente entra com o login dele; a gente só mostra onde clicar", guide: { id: "gd_prev_impl", step: "conectar-contas" } },
    { id: "i3", title: "Primeira cópia de anúncios", side: "lever", dueAt: "2026-09-22", doneAt: "" },
    { id: "i4", title: "Treinamento da equipe do cliente", side: "lever", dueAt: "2026-09-26", doneAt: "" },
  ],
  progress: 25,
  meetings: [{ id: "mt1", at: "2026-09-19T17:00:00.000Z", status: "scheduled", meetUrl: "https://meet.google.com/abc-defg-hij", title: "Configuração das contas" }],
};
const acompanhamentoPreview = {
  id: "fu_prev_1", customer: "c2", kind: "check_in", status: "aberto", owner: "leo", dueAt: "2026-09-24T15:00:00.000Z",
  sentiment: "", notes: "", nextSteps: "", meetings: [],
};
// Carteira na prévia (03/11/2026): o status consolidado de cada cliente de
// exemplo, cobrindo os estágios, pagamentos e próximos passos da tela.
const STATUS_PREVIEW = {
  c1: { regua: [2, 1, 20], owner: "leo", lifecycle: "ativo", csStage: "atencao", health: 64, healthParts: { pagamento: 40, nps: 12, suporte: 2, resultado: 10 }, pay: "adimplente", next: { amount: 7200, dueDate: emDias(12) }, sub: ["active", "quarterly", 12], products: [["leverads", true]], tickets: { open: 2, urgent: 1 }, nps: 8 },
  c2: { regua: [0, 0, 3], owner: "lucas", lifecycle: "integracao", csStage: "", health: 78, healthParts: { pagamento: 40, nps: 10, suporte: 20, resultado: 8 }, pay: "adimplente", sub: ["active", "annual", 200], products: [["leverads", true], ["leverprice", false]], onboarding: { id: "ob_prev_1", stage: "configuracao", kind: "novo_produto", progress: 25, plannedGoLiveAt: emDias(6) } },
  c3: { regua: [1, 1, 40], owner: "leo", lifecycle: "risco", csStage: "em_risco", health: 30, healthParts: { pagamento: 0, nps: 0, suporte: 20, resultado: 10 }, pay: "inadimplente", overdue: [1, 2850, 18], sub: ["past_due", "annual", 140], products: [["leverads", true]], followup: { id: "fu_prev_1", kind: "risco", owner: "leo", dueAt: emDias(-2), late: true, open: 1 }, nps: 4 },
  c4: { regua: [5, 0, 14], owner: "tiago", lifecycle: "ativo", csStage: "renovacao", health: 72, healthParts: { pagamento: 40, nps: 12, suporte: 12, resultado: 8 }, pay: "adimplente", sub: ["active", "annual", 21], products: [["leverads", true], ["leverprice", true]], followup: { id: "fu_prev_1", kind: "renovacao", title: "Contato de renovação", milestone: "renovacao", owner: "tiago", dueAt: emDias(14), late: false, open: 1 } },
  c5: { regua: [6, 0, 0], owner: "leo", lifecycle: "ativo", csStage: "saudavel", health: 94, healthParts: { pagamento: 40, nps: 20, suporte: 20, resultado: 14 }, pay: "adimplente", next: { amount: 3400, dueDate: emDias(4) }, sub: ["active", "annual", 300], products: [["leverads", true]], nps: 10 },
  c6: { regua: [4, 0, 40], owner: "", lifecycle: "ativo", csStage: "saudavel", health: 86, healthParts: { pagamento: 40, nps: 10, suporte: 20, resultado: 16 }, pay: "adimplente", sub: ["active", "semiannual", 33], products: [["leverads", true]] },
  c7: { regua: [1, 0, 0], owner: "lucas", lifecycle: "ativo", csStage: "atencao", health: 58, healthParts: { pagamento: 25, nps: 10, suporte: 20, resultado: 3 }, pay: "aguardando_pagamento", next: { amount: 450, dueDate: emDias(1) }, sub: ["active", "monthly", 9], products: [["leverads", false]], followup: { id: "fu_prev_1", kind: "check_in", title: "Check-in de mês 1", milestone: "checkin_m1", owner: "lucas", dueAt: emDias(0), late: false, open: 1 } },
  c8: { owner: "leo", lifecycle: "churn", csStage: "churn", health: 0, pay: "", sub: ["canceled", "monthly", null], products: [["leverads", true]] },
};
// Régua de marcos de exemplo: `done` feitos, `late` atrasados e o próximo em `next` dias.
const MARCOS_PREVIEW = [["onboarding", "Onboarding"], ["checkin_m1", "Check-in de mês 1"], ["revisao_m3", "Revisão de resultado"], ["depoimento", "Pedir depoimento e autorizar case"], ["upsell_m6", "Conversa de upsell"], ["renovacao", "Contato de renovação"]];
function reguaPreview([done, late, next]) {
  const steps = MARCOS_PREVIEW.map(([key, label], i) => ({ key, label, status: i < done ? "done" : i < done + late ? "late" : i === done + late && next <= 7 ? "soon" : "next" }));
  const first = steps.find((x) => x.status !== "done");
  return {
    done, total: steps.length, late, steps,
    next: first ? { key: first.key, label: first.label, status: first.status, dueAt: first.status === "late" ? emDias(-6) : emDias(next) } : null,
  };
}
function customerStatusPreview(saas) {
  const rows = CLIENTES_FAKE.filter((c) => !saas || c.saas === saas).map((c) => {
    const x = STATUS_PREVIEW[c.id] || {};
    const [status, cycle, days] = x.sub || [];
    return {
      id: c.id, name: c.name, owner: x.owner || "", saas: c.saas, startedAt: c.startedAt, endedAt: c.endedAt || "", churned: !!c.endedAt,
      plan: c.plan, mrr: c.endedAt ? 0 : Math.round(c.arr / 12), lifecycle: x.lifecycle || "", csStage: x.csStage || "",
      health: x.health || 0, healthParts: x.healthParts || null, healthAt: x.health ? emDias(0, 6) : "",
      payment: { status: x.pay || "", overdueCount: x.overdue?.[0] || 0, overdueAmount: x.overdue?.[1] || 0, overdueDays: x.overdue?.[2] || 0, nextDue: x.next || null, lastPaidAt: emDias(-20) },
      subscription: status ? { id: `s_${c.id}`, status, cycle, periodEnd: days == null ? emDias(-12) : emDias(days), renewInDays: days, live: status === "canceled" ? 0 : 1, total: 1 } : null,
      products: (x.products || []).map(([id, account]) => ({ id, account })),
      onboarding: x.onboarding || null, followup: x.followup || null, milestones: x.regua ? reguaPreview(x.regua) : null,
      tickets: x.tickets || { open: 0, urgent: 0 }, nps: x.nps != null ? { score: x.nps, at: emDias(-30) } : null,
    };
  });
  return { generatedAt: new Date().toISOString(), rows };
}
// Guias na prévia (03/11/2026): um publicado com prints gerados e um rascunho.
const printPreview = (titulo, cor) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#eef1f3"/><rect x="0" y="0" width="1200" height="64" fill="${cor}"/><text x="32" y="42" font-family="sans-serif" font-size="26" fill="#fff">${titulo}</text><rect x="32" y="110" width="520" height="40" rx="10" fill="#fff"/><rect x="32" y="170" width="1136" height="420" rx="16" fill="#fff"/><rect x="900" y="620" width="268" height="48" rx="24" fill="${cor}"/></svg>`);
const PRINTS_PREVIEW = { ga_prev_1: printPreview("Contas conectadas", "#0F766E"), ga_prev_2: printPreview("Escolher a conta-mãe", "#0C1D2B"), ga_prev_3: printPreview("Clonagem em andamento", "#175CD3") };
const GUIAS_PREVIEW = [
  {
    id: "gd_prev_impl", saas: "leverads", starter: "implantacao", title: "Implantação · call de integração", audience: "integrador", product: "leverads", status: "publicado", rev: 3,
    summary: "O passo a passo da integração de um cliente recém-fechado: o que conferir antes, como conduzir a call e como fechar.",
    updatedAt: emDias(-2), updatedBy: "leo",
    steps: [
      { id: "antes-da-call", title: "Antes da call: conferir o que o cliente respondeu", body: "Abra o card da integração e confira:\n- **Formulário de integração**: contas, conta principal, ERP e rotas.\n- **Resumo da venda**: o que foi prometido.", tip: "Se o formulário não foi respondido, mande o link de novo antes de marcar a call.", images: [] },
      { id: "conectar-contas", title: "Conectar as contas e definir a conta-mãe", body: "Conecte cada conta do marketplace e marque a principal como conta-mãe.\n\n> Essa vira a conta-mãe. O que você publicar nela replica pras outras.", tip: "", images: [{ id: "ga_prev_1", caption: "As contas conectadas aparecem com o selo verde" }, { id: "ga_prev_2", caption: "Marque a conta-mãe aqui" }] },
      { id: "primeira-clonagem", title: "Primeira clonagem na tela", body: "Rode a primeira leva com o cliente olhando.", tip: "", images: [{ id: "ga_prev_3", caption: "Acompanhe a clonagem por aqui" }] },
    ],
  },
  // Trilhas (03/11/2026): guias do pacote com a posição de leitura.
  ...[
    ["gd_prev_call", "", 1, "Call de integração: do convite ao encerramento", 3],
    ["gd_prev_link", "", 2, "Link de cadastro e criação da conta", 2],
    ["gd_prev_ads1", "leverads", 1, "LeverAds · Primeiro acesso: do cadastro à primeira cópia", 4],
    ["gd_prev_ads2", "leverads", 2, "LeverAds · Contas: conectar, reconectar e configurar as contas", 3],
    ["gd_prev_ads3", "leverads", 3, "LeverAds · Copiar: replicar anúncios entre contas", 2],
    ["gd_prev_lp1", "leverprice", 1, "LeverPrice · Primeiro acesso: da conta criada à primeira tela", 3],
    ["gd_prev_lp2", "leverprice", 2, "LeverPrice · Produtos: custos, imposto e margens por SKU", 2],
  ].map(([id, product, order, title, n]) => ({
    id, saas: "leverads", pack: id, title, product, order, audience: "integrador", status: "publicado", rev: 1,
    summary: `O passo a passo de ${title.replace(/^Lever\w+ · /, "").toLowerCase()}.`, updatedAt: emDias(-1), updatedBy: "api",
    steps: Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, title: `Passo ${i + 1} de ${title.split(":")[0]}`, body: "Texto do passo.", tip: "", images: [] })),
  })),
  { id: "gd_prev_cob", saas: "leverads", title: "Ticket de cobrança: o que responder", audience: "suporte", product: "", status: "rascunho", rev: 1, summary: "Quando o cliente abre ticket sobre cobrança ou fatura.", updatedAt: emDias(-9), updatedBy: "tiago", steps: [{ id: "st_1", title: "Conferir a fatura na ficha do cliente", body: "Abra o cliente e veja Cobranças.", tip: "", images: [] }] },
];
const TEMPLATES_PREVIEW = [
  { id: "implantacao", kind: "implantacao", name: "Implantação inicial", items: [
    { title: "Formulário de integração respondido", side: "cliente", guide: { id: "gd_prev_impl", step: "antes-da-call" } },
    { title: "Contas conectadas e configuração feita", side: "lever", guide: { id: "gd_prev_impl", step: "conectar-contas" }, help: "conta-mãe definida com o cliente" },
    { title: "Go-live confirmado com o cliente", side: "lever" },
  ] },
  { id: "treinamento", kind: "treinamento", name: "Treinamento", items: [{ title: "Treinamento realizado", side: "lever" }] },
];
// ?guia: a integração de exemplo vira implantação com a call marcada hoje às
// 17h e a sala do Meet (prints dos guias da Lever, 03/11/2026).
const modoGuia = typeof location !== "undefined" && new URLSearchParams(location.search).has("guia");
const leadGuia = (() => { const d = new Date(); d.setHours(17, 0, 0, 0); return {
  id: "ld_guia", saas: "leverads", name: "Rodrigo Galante", company: "Galante Comércio", phone: "5541999990002", stage: "Integração",
  integrator: "lucas", closer: "tiago", integrationAt: d.toISOString(), integrationCallUrl: "https://meet.google.com/abc-defg-hij", customerId: "c2",
}; })();
const integracaoAtual = () => (modoGuia ? { ...integracaoPreview, kind: "implantacao", lead: "ld_guia", stage: "aguardando_kickoff" } : integracaoPreview);
const RESPOSTAS = {
  customerStatus: (saas) => customerStatusPreview(saas),
  guides: (saas) => ({ guides: GUIAS_PREVIEW.filter((g) => !saas || g.saas === saas), canEdit: !new URLSearchParams(location.search).has("leitor") }),
  guide: (id) => GUIAS_PREVIEW.find((g) => g.id === id) || null,
  createGuide: (b) => { const g = { ...b, id: "gd_prev_" + Date.now().toString(36), rev: 1, updatedAt: new Date().toISOString(), updatedBy: "leo" }; GUIAS_PREVIEW.push(g); return g; },
  updateGuide: (id, p) => { const g = GUIAS_PREVIEW.find((x) => x.id === id); Object.assign(g, p, { rev: (g.rev || 1) + 1, updatedAt: new Date().toISOString() }); return g; },
  deleteGuide: (id) => { const i = GUIAS_PREVIEW.findIndex((x) => x.id === id); if (i >= 0) GUIAS_PREVIEW.splice(i, 1); return { ok: true }; },
  guideStarter: () => ({ guide: GUIAS_PREVIEW[0], created: false, linked: 0 }),
  guidePack: () => ({ guides: [{ key: "call-integracao", title: "Call de integração: do convite ao encerramento", version: 1, state: "faltando", guide: "" }, { key: "link-cadastro", title: "Link de cadastro e criação da conta", version: 1, state: "atual", guide: "gd_x" }] }),
  installGuidePack: () => ({ installed: ["call-integracao"], updated: [], current: ["link-cadastro"], edited: [] }),
  guideAsset: () => { const id = "ga_prev_" + Date.now().toString(36); PRINTS_PREVIEW[id] = printPreview("Print novo", "#A16207"); return { id }; },
  guideAssetUrl: (id) => PRINTS_PREVIEW[id] || printPreview("print", "#98A5AF"),
  onboardingTemplates: () => ({ templates: TEMPLATES_PREVIEW }),
  saveOnboardingTemplates: (saas, templates) => ({ templates }),
  get: (col, id) => (modoGuia && id === "ld_guia" ? leadGuia : (window.SEED?.[String(col).toUpperCase()] || []).find((r) => r.id === id) || null),
  customerOnboardings: (id) => ({ onboardings: id === "c2" ? [integracaoPreview] : [] }),
  onboarding: () => integracaoAtual(),
  // Modo integração (03/11/2026): o kit da integração de exemplo e o PATCH dos itens.
  updateOnboarding: (id, patch) => {
    Object.assign(integracaoPreview, patch);
    const items = integracaoPreview.items || [];
    integracaoPreview.progress = items.length ? Math.round((items.filter((i) => i.doneAt).length / items.length) * 100) : 0;
    return { ...integracaoPreview };
  },
  onboardingKit: () => ({
    onboarding: { ...integracaoAtual() },
    customer: {
      id: "c2", name: "Galante Comércio", plan: "Enterprise anual", owner: "lucas",
      products: [{ id: "leverads", account: true }, { id: "leverprice", account: false }],
      contacts: [{ name: "Rodrigo Galante", role: "decisor", phone: "(41) 99999-0002", email: "rodrigo@galante.example.invalid", primary: true }],
    },
    deal: { id: "v2", closer: "tiago", dealProduct: "full", integrationAt: modoGuia ? leadGuia.integrationAt : emDias(0, 15), integrationCallUrl: "https://meet.google.com/abc-defg-hij" },
    form: { id: "tok_prev", status: "respondido", respondedAt: emDias(-3), sections: [
      { title: "Contas", items: [{ label: "Contas no marketplace", rows: ["Marketplace: Mercado Livre · Apelido: GALANTE · Papel: principal", "Marketplace: Mercado Livre · Apelido: GALANTE2 · Papel: espelho"] }, { label: "Conta principal", value: "GALANTE" }] },
      { title: "Estoque", items: [{ label: "ERP", value: "Bling" }, { label: "Sincroniza estoque", value: "✓ Sim" }] },
      { title: "O que não pode sair", items: [{ label: "Bloqueios", value: "Não clonar a linha de pneus" }] },
    ] },
    brief: { resumo: "Distribuidora de autopeças com duas contas no ML; quer replicar o catálogo da principal.", entregas: ["Conta-mãe GALANTE replicando para GALANTE2", "Regra de preço +8% na conta espelho"], atencao: [{ ponto: "Linha de pneus fora", porque: "contrato de exclusividade com outro fornecedor" }] },
    clientPending: { open: 1, overdue: 0, items: [{ item: "Mandar o acesso da conta GALANTE2", dueDate: emDias(1).slice(0, 10) }] },
    guides: { gd_prev_impl: GUIAS_PREVIEW[0] },
    missing: [
      { key: "conta:leverprice", tone: "warn", text: "O cliente ainda não tem conta no LeverPrice: mande o link de cadastro pelo card." },
      { key: "pendencias", tone: "warn", text: "1 pendência do cliente em aberto." },
    ],
  }),
  customerFollowups: (id) => ({ followups: id === "c2" ? [acompanhamentoPreview] : [] }),
  followup: () => acompanhamentoPreview,
  customerRecordMeetings: (id) => ({ meetings: id === "c2" ? integracaoPreview.meetings.map((m) => ({ ...m, host: { collection: "onboardings", id: integracaoPreview.id, label: "Integração · Produto novo" } })) : [] }),
  meetingsReport: () => {
    const users = (window.SEED?.USERS || []).slice(0, 3);
    const rows = [[82, 9, 2, 3], [64, 7, 4, 2], [90, 9, 1, 1]];
    return { total: 38, closers: users.map((u, i) => ({ closer: u.id, comparecimento: rows[i][0], realizada: rows[i][1], no_show: rows[i][2], agendada: rows[i][3] })) };
  },
  teams: () => ({ teams: [
    { id: "tm1", name: "SDR LeverAds", saas: "leverads", kind: "sdr", members: ["leo"], manager: "leo", status: "active" },
    { id: "tm2", name: "Fechamento", saas: "leverads", kind: "closer", members: ["lucas", "tiago"], manager: "lucas", status: "active" },
  ] }),
  createTeam: (b) => ({ id: "tm_new", ...b }),
  updateTeam: (id, b) => ({ id, ...b }),
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
    sale: { target: 128000, sold: 10950, contracted: 10950, progress: 0.0855, expectedProgress: 0.38, status: "behind",
      // Série do gráfico "Vendas por dia" (esparsa; a soma é o sold).
      days: [
        { day: "2026-09-03", revenue: 3650, contracts: 1 },
        { day: "2026-09-09", revenue: 4300, contracts: 1 },
        { day: "2026-09-11", revenue: 3000, contracts: 1 },
      ] },
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
    if (etapasPreview && Object.hasOwn(etapasMock, nome)) return etapasMock[nome];
    if (settingsReview && Object.hasOwn(settingsReviewMock,nome)) return settingsReviewMock[nome];
    if (expensesReview && Object.hasOwn(expensesReviewMock,nome)) return expensesReviewMock[nome];
    if (remuneracaoReview && Object.hasOwn(remuneracaoReviewMock,nome)) return remuneracaoReviewMock[nome];
    if (metasReview && Object.hasOwn(metasReviewMock,nome)) return metasReviewMock[nome];
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
    if (financePreview && nome === "expensesSummary") return (saas, month) => Promise.resolve({ month, ai: 420, aiUSD: 78.5, wa: 96.4, waConversations: 112, ads: 23500, manual: [
      { id: "e1", saas, month: "2026-07", category: "taxas", name: "Checkout", pct: 12, base: "taxa_real", recurring: true, amount: 15100 },
      { id: "e2", saas, month: "2026-07", category: "imposto", name: "Imposto", pct: 20, base: "received", recurring: true, amount: 39200 },
      { id: "e3", saas, month: "2026-09", category: "dev", name: "Claude + Codex", amount: 6600, recurring: true },
    ], manualTotal: 60900, payablesTotal: 5900, payablesCount: 2, total: 90816.4, wonBase: 318989, receivedBase: 195900, feeBase: 15100 });
    if (financePreview && nome === "mpPayments") return ({ saas } = {}) => Promise.resolve(financeMpPayments(saas || "leverads"));
    if (financePreview && nome === "list") return (col) => Promise.resolve(col === "fin_rules" ? financeRules("leverads")
      : col === "payroll_profiles" ? [{ id: "us_mrqkn2tm03", uid: "us_mrqkn2tm03", saas: "leverads", regime: "clt", fixed: null, vr: 400, vt: 160, extras: [{ label: "ajuda de custo", amount: 300, kind: "acordo" }, { label: "adiantamento", amount: 600, kind: "desconto" }], notes: "combinado em 10/10" }]
      : col === "payroll_adjustments" ? [{ id: "adj1", saas: "leverads", month: new Date().toISOString().slice(0, 7), uid: "us_mrqkn2tm03", label: "hora extra", amount: 200, kind: "acordo" }] : []);
    if (financePreview && (nome === "finMaterialize" || nome === "finRulesApply")) return () => Promise.resolve({ ok: true, created: 0, applied: 1, settled: 1 });
    if (financePreview && nome === "payrollPreview") return (saas, month) => Promise.resolve({ saas, month, dueDate: "2026-11-01", stamped: true, total: 3800 + 4700 + 5260, rows: [
      { uid: "sdr", name: "Manuela", role: "sdr", level: 1, regime: "clt", fixed: 2200, fixedFrom: "plano nível 1", variable: 1300, legs: { contracts: 550, revenue: 750 }, teamBonus: 300, vr: 660, vt: 264, vrDay: 30, vtDay: 12, businessDays: 22, benefitsOn: true, benefits: 924, extras: [], extrasTotal: 0, adjustments: [], adjustmentsTotal: 0, total: 4724, stamped: true, month, notes: "fixo R$ 2200 (plano nível 1) · contratos 20/20 (100%) → R$ 550 · receita R$ 108000/R$ 90000 (120%) → R$ 750 · bônus de time R$ 300", payable: { id: "pay_t1", amount: 5000, status: "paga", amountManual: false } },
      { uid: "igor", name: "Igor", role: "social", level: 1, regime: "clt", fixed: 4500, fixedFrom: "pessoa", variable: 0, legs: { contracts: 0, revenue: 0 }, teamBonus: 200, vr: 660, vt: 264, vrDay: 30, vtDay: 12, businessDays: 22, benefitsOn: true, benefits: 924, extras: [], extrasTotal: 0, adjustments: [], adjustmentsTotal: 0, total: 5624, stamped: true, month, notes: "fixo R$ 4500 (fixo da pessoa) · bônus de time R$ 200", payable: null },
      { uid: "us_mrqkn2tm03", name: "Vitor", role: "closer", level: 1, regime: "clt", fixed: 3000, fixedFrom: "plano nível 1 CLT", variable: 1600, legs: { contracts: 600, revenue: 1000 }, teamBonus: 400, vr: 400, vt: 160, vrDay: 30, vtDay: 12, businessDays: 22, benefitsOn: true, benefits: 560, extras: [{ label: "ajuda de custo", amount: 300, kind: "acordo", signed: 300 }, { label: "adiantamento", amount: 600, kind: "desconto", signed: -600 }], extrasTotal: -300, adjustments: [{ id: "adj1", label: "hora extra", amount: 200, kind: "acordo" }], adjustmentsTotal: 200, total: 5460, stamped: true, month, notes: "", payable: null },
    ] });
    if (financePreview && nome === "payrollGenerate") return () => Promise.resolve({ ok: true, created: 2, updated: 0, kept: 1, total: 13960, stamped: true });
    if (financePreview && nome === "finSyncAll") return () => Promise.resolve({ ok: true, in: { seen: 12, settled: 1, reclassified: 4 }, out: { imported: 2, filesRead: 3 }, rules: { applied: 0, settled: 0 } });
    if (financePreview && (nome === "mpLinkPayment" || nome === "confirmInvoice" || nome === "payInvoice" || nome === "update" || nome === "create" || nome === "remove")) return () => Promise.resolve({ ok: true });
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
