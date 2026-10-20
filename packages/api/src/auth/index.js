// Domínio de acesso: login e usuários do time. Os hooks de autenticação e de
// telas são ligados pelo index.js antes de qualquer rota.

import { registerAuthRoutes } from "./auth.js";
import { registerTeamRoutes } from "./routes.teams.js";

export function register(app, repo, ctx) {
  // Usuários do time: login/logout/me + gestão mínima (rotas dedicadas).
  registerAuthRoutes(app, repo, ctx.opts.identity !== undefined ? { identity: ctx.opts.identity } : {});
  // Times (grupo de pessoas por função e produto, Lever CRM Fase 2).
  registerTeamRoutes(app, repo);
}
