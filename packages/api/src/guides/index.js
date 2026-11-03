// Domínio de guias: a base de conhecimento interna (passo a passo com prints)
// que o operador de integração, o CS e o suporte seguem. Sem rotina em segundo
// plano.

import { registerGuideRoutes } from "./routes.guides.js";

export function register(app, repo) {
  registerGuideRoutes(app, repo);
}
