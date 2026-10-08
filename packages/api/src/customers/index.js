// Domínio de clientes (pós-venda): marcos, NPS, relatório de resultado,
// indicações, pendências da integração e a análise de integração.

import { registerIntegrationRoutes } from "./routes.integrations.js";
import { registerReferralRoutes } from "./routes.referrals.js";
import { registerNpsRoutes } from "./routes.nps.js";
import { registerCustomerResultsRoutes } from "./routes.customer-results.js";
import { registerLeverIdRoutes } from "./routes.leverid.js";
import { registerLeveradsOrgRoutes } from "./routes.leverads-orgs.js";
import { makeLeveradsOrgMirror, startLeveradsOrgMirror } from "./leverads-orgs.js";
import { makeIdentityAdmin } from "../auth/identity-admin.js";
import { startCustomerMilestones } from "./customer-milestones.js";
import { startNpsAsks } from "./nps.js";
import { startCustomerReports } from "./customer-reports.js";
import { startClientPendingReminder } from "./client-pending.js";
import { refreshResults, RESULTS_TTL_MS } from "./leverads-results.js";

// Espelho das orgs do LeverAds: um por processo, dividido entre as rotas e o
// tick (o "atualizar agora" da ficha e o intervalo não rodam juntos).
let orgMirror = null;

export function register(app, repo, ctx) {
  // Análise de integração (CS/onboarding): sentimento + pendências recorrentes.
  registerIntegrationRoutes(app, repo);
  registerReferralRoutes(app, repo, ctx.opts.referrals);
  // NPS: página pública da nota (/public/nps/:token) + pedido manual pela ficha.
  // Depois do mailer/whatsapp: o pedido sai por e-mail e, dentro da janela de
  // 24h, por WhatsApp.
  registerNpsRoutes(app, repo, { mailer: ctx.mailer, whatsapp: ctx.whatsapp });
  // Resultados do cliente na ficha: número vivo do banco do produto + envio
  // manual do relatório mensal.
  registerCustomerResultsRoutes(app, repo, { mailer: ctx.mailer, whatsapp: ctx.whatsapp });
  // Badge de LeverId: quem do cliente já tem conta na identidade central.
  const identity = ctx.opts.identity !== undefined ? ctx.opts.identity : makeIdentityAdmin();
  registerLeverIdRoutes(app, { identity });
  // Contas do LeverAds: aba Gratuitas, pagantes sem cliente e o vínculo
  // cliente × org (manual na ficha ou automático pelo e-mail).
  orgMirror = makeLeveradsOrgMirror(repo, { identity, ...(ctx.opts.leveradsOrgs || {}) });
  registerLeveradsOrgRoutes(app, repo, { mirror: orgMirror });
}

export function start(repo, { clients, log, stops, jobOn }) {
  // Régua de marcos do cliente (onboarding, check-in de mês 1, revisão de mês 3,
  // upsell de mês 6, renovação): cada marco que chega a hora vira tarefa do dono
  // da conta. Marco vencido há mais de 30 dias fica pra trás de propósito.
  if (jobOn("customerMilestones")) startCustomerMilestones(repo, { log });
  // NPS: pergunta de 0 a 10 no mês 1, no mês 3 e de 90 em 90 dias depois.
  // E-mail sai sozinho; WhatsApp só dentro da janela de 24h, senão vira tarefa
  // com o texto pronto pro dono da conta.
  if (jobOn("npsAsks")) startNpsAsks(repo, { ...clients, log });
  // Relatório mensal de resultado pro cliente (a evidência de serviço): 1 por
  // cliente a cada 30 dias, em horário comercial. Mês sem venda não manda.
  if (jobOn("customerReports")) startCustomerReports(repo, { ...clients, log });
  // Combinado da integração que o cliente não entregou: avisa quem cuida do
  // lead e deixa a cobrança pronta na tarefa. Nunca envia sozinho.
  if (jobOn("clientPendingReminder")) startClientPendingReminder(repo, { log });
  // Espelho das orgs do LeverAds a cada 10 min: conta nova aparece na aba
  // Gratuitas e o vínculo pelo e-mail é gravado quando não há dúvida.
  if (jobOn("leveradsOrgMirror")) stops.push(startLeveradsOrgMirror(orgMirror || makeLeveradsOrgMirror(repo, { log }), { log }));
  // Aquece os resultados das propostas (incluindo o resumo do deck C) e
  // renova a cada seis horas, mesmo sem uma nova abertura para disparar o cache.
  if (jobOn("refreshResults")) {
    refreshResults().catch(() => {});
    const resultsTimer = setInterval(() => refreshResults().catch(() => {}), RESULTS_TTL_MS);
    resultsTimer.unref();
    stops.push(() => clearInterval(resultsTimer));
  }
}
