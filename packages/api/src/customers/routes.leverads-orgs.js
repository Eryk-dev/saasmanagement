// Contas do LeverAds na tela Clientes (espelho `leverads_orgs`, lógica em
// leverads-orgs.js). Tudo sob /api/customers, então segue o guard de Clientes.
//
//   GET    /api/customers/leverads-orgs           espelho (aba Gratuitas e o
//                                                  vínculo da ficha)
//   POST   /api/customers/leverads-orgs/refresh   atualiza agora (o integrador
//                                                  acabou de criar a conta)
//   POST   /api/customers/:id/leverads-org        { orgId } vincula na mão
//   DELETE /api/customers/:id/leverads-org        desfaz (e o automático não
//                                                  religa essa org)

import { ORGS } from "./leverads-orgs.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (v) => String(v || "").trim().toLowerCase();

export function registerLeveradsOrgRoutes(app, repo, { mirror }) {
  const listing = async () => {
    const orgs = (await repo.list(ORGS).catch(() => [])).filter((o) => !o.gone);
    orgs.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return { configured: mirror.configured(), last: mirror.last(), orgs };
  };

  app.get("/api/customers/leverads-orgs", async () => listing());

  app.post("/api/customers/leverads-orgs/refresh", async (req, reply) => {
    if (!mirror.configured()) return reply.code(424).send({ error: "Espelho desligado: defina LEVERADS_SERVICE_KEY (ou LEVERADS_ADMIN_*).", code: "not_configured" });
    try { await mirror.run(); } catch (err) {
      return reply.code(424).send({ error: `LeverAds indisponível: ${err.message}`, code: "leverads_unavailable" });
    }
    return listing();
  });

  app.post("/api/customers/:id/leverads-org", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const orgId = norm(req.body?.orgId);
    if (!UUID.test(orgId)) return reply.code(400).send({ error: "Informe a org do LeverAds." });
    const org = await repo.get(ORGS, orgId);
    if (!org || org.gone) return reply.code(404).send({ error: "Org não encontrada no LeverAds. Atualize a lista e tente de novo." });
    const other = (await repo.list("customers")).find((c) => c.id !== customer.id && norm(c.leveradsOrgId) === orgId);
    if (other) return reply.code(409).send({ error: `Essa org já está vinculada a ${other.name || "outro cliente"}.`, code: "org_taken", customerId: other.id });
    const saved = await repo.update("customers", customer.id, {
      leveradsOrgId: orgId,
      orgLink: { via: "manual", by: req.authUser?.id || "", at: new Date().toISOString() },
      orgLinkRejected: (customer.orgLinkRejected || []).filter((x) => norm(x) !== orgId),
    });
    const prev = norm(customer.leveradsOrgId);
    if (prev && prev !== orgId) await repo.update(ORGS, prev, { customerId: "" }).catch(() => {});
    await repo.update(ORGS, orgId, { customerId: customer.id });
    return saved;
  });

  app.delete("/api/customers/:id/leverads-org", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const prev = norm(customer.leveradsOrgId);
    if (!prev) return customer;
    const saved = await repo.update("customers", customer.id, {
      leveradsOrgId: "",
      orgLink: { via: "unlinked", by: req.authUser?.id || "", at: new Date().toISOString(), orgId: prev },
      orgLinkRejected: [...new Set([...(customer.orgLinkRejected || []).map(norm), prev])],
    });
    await repo.update(ORGS, prev, { customerId: "" }).catch(() => {});
    return saved;
  });
}
