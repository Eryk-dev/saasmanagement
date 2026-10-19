// Domínio de versões e novidades: a versão no ar de cada app da Lever e as
// novidades de produto que cada app mostra aos clientes.

import { registerReleasesRoutes } from "./routes.releases.js";

export function register(app, repo, ctx) {
  registerReleasesRoutes(app, repo, { ...(ctx.opts?.releases || {}) });
}
