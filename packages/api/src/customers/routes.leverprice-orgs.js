// Contas do LeverPrice (lógica em leverprice-orgs.js).
//
//   POST /public/leverprice/org-created   aviso do cadastro do LeverPrice
//                                         (X-Cockpit-Service-Key =
//                                         LEVERPRICE_SERVICE_KEY)
//     { org_id, core_org_id?, convite?, email?, name? }

import { UUID, handleLeverpriceOrgCreated, leverpriceServiceKeyOk } from "./leverprice-orgs.js";

const norm = (v) => String(v || "").trim().toLowerCase();

export function registerLeverpriceOrgRoutes(app, repo) {
  // Aberta no gate de sessão (OPEN_PREFIXES); a chave de serviço é a credencial.
  // Responde na hora e vincula em seguida: o cadastro não espera.
  app.post("/public/leverprice/org-created", async (req, reply) => {
    if (!leverpriceServiceKeyOk(req.headers["x-cockpit-service-key"])) return reply.code(401).send({ error: "Chave inválida" });
    const body = req.body || {};
    const orgId = norm(body.org_id);
    if (!UUID.test(orgId)) return reply.code(400).send({ error: "org_id inválido" });
    const str = (v) => (typeof v === "string" ? v : "");
    handleLeverpriceOrgCreated(repo, {
      orgId, coreOrgId: str(body.core_org_id) || null, invite: str(body.convite) || null,
      email: str(body.email), name: str(body.name), log: req.log,
    }).catch((err) => req.log.warn({ err: err.message, org: orgId }, "leverprice-orgs: aviso de org criada falhou"));
    return reply.code(202).send({ received: true });
  });
}
