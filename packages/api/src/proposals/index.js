// Domínio de propostas: proposal builder, cases e a proposta gerada a partir
// do lead.

import { registerProposalRoutes } from "./routes.proposals.js";
import { registerCaseRoutes } from "./routes.cases.js";
import { registerLeadProposalRoutes } from "./routes.lead-proposals.js";

export function register(app, repo, ctx) {
  // Superfície pública do proposal builder (/p/:id, aceite, painel do closer).
  registerProposalRoutes(app, repo, { ...(ctx.opts.proposals || {}), discord: ctx.discord, metaCapi: ctx.metaCapi });
  // Cases (prova social): rascunho a partir do cliente, gate de publicação e o
  // JSON público que o site consome.
  registerCaseRoutes(app, repo);
  // Proposta a partir do lead: gerar, personalizar, ofertas e compartilhar.
  registerLeadProposalRoutes(app, repo);
}
