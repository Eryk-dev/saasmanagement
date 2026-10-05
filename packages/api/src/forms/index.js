// Domínio de formulários: captação, Formulário de Integração e o beacon do Elo.

import { registerFormRoutes } from "./routes.forms.js";
import { registerIntegrationFormRoutes } from "./routes.integration-forms.js";
import { registerEloRoutes } from "./elo.js";

export function register(app, repo, ctx) {
  const { opts } = ctx;
  // Superfície pública do form builder (/public/forms, /f/:id, /embed.js).
  registerFormRoutes(app, repo, { ...(opts.forms || {}), discord: ctx.discord, metaCapi: ctx.metaCapi, meta: ctx.meta, anthropic: ctx.anthropic, salesWhatsapp: ctx.salesWhatsapp });
  // Formulário de Integração: página pública que o cliente recém-fechado
  // preenche (/fi/:id) + envio das respostas. O CRUD do pedido é o genérico.
  registerIntegrationFormRoutes(app, repo, { ...(opts.integrationForms || {}), discord: ctx.discord });
  // Análises do Elo App (produto B2C): agregados do banco do app + beacon
  // público das landing pages (/public/lp/events) e resumo de conversão.
  registerEloRoutes(app, repo, opts.elo);
}
