// Domínio CRM: o CRUD genérico das coleções, o bootstrap do SPA, follow-up,
// funil do produto e a cadência. Registrado por último: o bootstrap informa o
// estado de todas as integrações e o CRUD usa os clientes dos outros domínios.

import { registerFollowupConfigRoutes } from "./followup-config.js";
import { registerBootstrapRoutes } from "./routes.bootstrap.js";
import { registerActivityAssetRoutes } from "./routes.activities.js";
import { registerCrudRoutes } from "./routes.crud.js";
import { registerFunnelRoutes } from "./routes.funnel.js";
import { registerViewRoutes } from "./routes.views.js";
import { registerMeetingRoutes } from "./routes.meetings.js";
import { startMeetingsSweep } from "./meetings.js";
import { registerIcpRoutes } from "./routes.icp.js";
import { startCadencia } from "./cadencia-runner.js";

export function register(app, repo, ctx) {
  // Follow-up em 4 contatos: mensagens e prazos globais (Configurações).
  registerFollowupConfigRoutes(app, repo);
  // Carga inicial do SPA (SEED), portfólio e leaderboard.
  registerBootstrapRoutes(app, repo, { googleClient: ctx.google, mpClient: ctx.mp, asaasClient: ctx.asaas, appmaxClient: ctx.appmax, metaClient: ctx.meta, anthropicClient: ctx.anthropic, discordClient: ctx.discord, whatsappClient: ctx.whatsapp, mailerClient: ctx.mailer, callfaceClient: ctx.callface });
  // Foto anexada a um toque da timeline.
  registerActivityAssetRoutes(app, repo);
  // Views salvas por usuário (filtros com nome), antes do CRUD genérico.
  registerViewRoutes(app, repo);
  // Calls de venda como registro (espelho dos campos de call do lead).
  registerMeetingRoutes(app, repo);
  // CRUD genérico sobre as coleções (/api/:collection).
  registerCrudRoutes(app, repo, {
    discordClient: ctx.discord, googleUser: ctx.googleUser, metaCapiClient: ctx.metaCapi, briefer: ctx.briefer,
    autoCallMeet: ctx.autoCallMeet, autoIntegrationMeet: ctx.autoIntegrationMeet, cancelIntegrationMeet: ctx.cancelIntegrationMeet,
    googleClient: ctx.google, mpClient: ctx.mp,
  });
  // Funil do produto com migração dos cards renomeados.
  registerFunnelRoutes(app, repo);
  // Régua de nota/ICP do produto: prévia, gravação versionada e histórico.
  registerIcpRoutes(app, repo);
}

export function start(repo, { log, jobOn }) {
  if (jobOn("cadencia")) startCadencia(repo, { log });
  // Espelho das calls de venda (pega também o que o robô de SDR grava direto).
  if (jobOn("crmMeetings")) startMeetingsSweep(repo, { log });
}
