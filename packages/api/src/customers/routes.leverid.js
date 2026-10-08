// Badge de LeverId na tela Clientes: GET /api/customers/leverid?orgs=a,b,c
// devolve, por org, as contas que já existem na identidade central. Fica sob
// /api/customers, então só quem tem a tela Clientes alcança.

import { makeLeverIdAccounts } from "./leverid-accounts.js";

export function registerLeverIdRoutes(app, { identity = null, accounts = makeLeverIdAccounts({ identity }) } = {}) {
  app.get("/api/customers/leverid", async (req, reply) => {
    if (!accounts.configured) return { configured: false, orgs: {} };
    try {
      return { configured: true, orgs: await accounts.forOrgs(req.query?.orgs) };
    } catch (err) {
      // 4xx de propósito (o EasyPanel troca 5xx por "Service is not reachable").
      return reply.code(424).send({ error: `LeverId indisponível: ${err.message}`, code: "leverid_unavailable" });
    }
  });
}
