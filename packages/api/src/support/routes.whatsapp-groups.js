// Grupos de WhatsApp dos clientes (lógica em whatsapp-groups.js).
//
//   POST  /public/hermes/whatsapp-groups       registro do Hermes, de hora em hora
//                                              (X-Cockpit-Service-Key = HERMES_SERVICE_KEY)
//         { groups: [{ jid, name, phones: [...] }] }
//   GET   /api/support/whatsapp-groups         grupos com o cliente ligado (sem telefones)
//   PATCH /api/support/whatsapp-groups/:jid    { customerId } escolhe à mão; "" volta ao automático

import { ticketScope } from "../auth/support-scope.js";
import { GROUP_JID, hermesServiceKeyOk, listGroups, registerGroups, sanitizeGroups, setGroupCustomer } from "./whatsapp-groups.js";

// Quem atende algum produto do suporte (admin incluso).
const canSupport = (req) => {
  if (!req.authUser) return true; // chave mestre (MCP/integrações)
  const scope = ticketScope(req.authUser);
  return scope === null || scope.length > 0;
};

export function registerWhatsappGroupRoutes(app, repo) {
  // Aberta no gate de sessão (OPEN_PREFIXES); a chave de serviço é a credencial.
  app.post("/public/hermes/whatsapp-groups", async (req, reply) => {
    if (!hermesServiceKeyOk(req.headers["x-cockpit-service-key"])) return reply.code(401).send({ error: "Chave inválida" });
    let groups;
    try { groups = sanitizeGroups(req.body); } catch (err) { return reply.code(err.statusCode || 400).send({ error: err.message }); }
    return registerGroups(repo, groups, { log: req.log });
  });

  app.get("/api/support/whatsapp-groups", async (req, reply) => {
    if (!canSupport(req)) return reply.code(403).send({ error: "só quem atende o suporte vê os grupos" });
    return listGroups(repo);
  });

  app.patch("/api/support/whatsapp-groups/:jid", async (req, reply) => {
    if (!canSupport(req)) return reply.code(403).send({ error: "só quem atende o suporte liga grupos" });
    const jid = String(req.params.jid || "");
    if (!GROUP_JID.test(jid)) return reply.code(404).send({ error: "Not found" });
    try {
      const saved = await setGroupCustomer(repo, jid, req.body?.customerId ?? "");
      return saved ? { jid: saved.id, customerId: saved.customerId || "", linkedBy: saved.linkedBy || "" } : reply.code(404).send({ error: "Not found" });
    } catch (err) {
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code || "" });
      throw err;
    }
  });
}
