// Domínio de acesso: login e usuários do time. Os hooks de autenticação e de
// telas são ligados pelo index.js antes de qualquer rota.

import { registerAuthRoutes } from "./auth.js";

export function register(app, repo) {
  // Usuários do time: login/logout/me + gestão mínima (rotas dedicadas).
  registerAuthRoutes(app, repo);
}
