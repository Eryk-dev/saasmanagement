// Domínio CRM: o CRUD genérico das coleções, o bootstrap do SPA, follow-up,
// funil do produto e a cadência. Registrado por último: o bootstrap informa o
// estado de todas as integrações e o CRUD usa os clientes dos outros domínios.

import { registerFollowupConfigRoutes } from "./followup-config.js";
import { registerBootstrapRoutes } from "./routes.bootstrap.js";
import { registerActivityAssetRoutes } from "./routes.activities.js";
import { registerCrudRoutes } from "./routes.crud.js";
import { registerFunnelRoutes } from "./routes.funnel.js";
import { startCadencia } from "./cadencia-runner.js";

export function register(app, repo, ctx) {
  // Follow-up em 4 contatos: mensagens e prazos globais (Configurações).
  registerFollowupConfigRoutes(app, repo);
  // Carga inicial do SPA (SEED), portfólio e leaderboard.
  registerBootstrapRoutes(app, repo, { googleClient: ctx.google, mpClient: ctx.mp, metaClient: ctx.meta, anthropicClient: ctx.anthropic, discordClient: ctx.discord, whatsappClient: ctx.whatsapp });
  // Foto anexada a um toque da timeline.
  registerActivityAssetRoutes(app, repo);
  // CRUD genérico sobre as coleções (/api/:collection).
  registerCrudRoutes(app, repo, {
    discordClient: ctx.discord, googleUser: ctx.googleUser, metaCapiClient: ctx.metaCapi, briefer: ctx.briefer,
    autoCallMeet: ctx.autoCallMeet, autoIntegrationMeet: ctx.autoIntegrationMeet, cancelIntegrationMeet: ctx.cancelIntegrationMeet,
    googleClient: ctx.google, mpClient: ctx.mp,
  });
  // Funil do produto com migração dos cards renomeados.
  registerFunnelRoutes(app, repo);
}

export function start(repo, { log }) {
  startCadencia(repo, { log });
}
