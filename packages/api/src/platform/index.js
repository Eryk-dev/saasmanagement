// Domínio plataforma: rotas de sistema. Banco, migrações e cache deste domínio
// são carregados direto pelo index.js e pelos outros domínios.

import { registerSystemRoutes } from "./routes.system.js";

export function register(app, repo) {
  // Health, tempo real (SSE) e documentação OpenAPI.
  registerSystemRoutes(app, repo);
}
