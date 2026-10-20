// Ciclo de vida, empresa, contatos e workspaces do cliente (lógica em
// lifecycle.js). Tudo sob /api/customers, então segue o guard de Clientes.
//
//   GET  /api/customers/:id/profile    empresa, contatos, estágio de vida,
//                                      status financeiro e workspaces
//   PUT  /api/customers/:id/contacts   { contacts: [{ name, email, phone, role, primary }] }
//   GET  /api/customers/workspaces     todos os workspaces (com os sem cliente)
//   POST /api/customers/lifecycle/run  recalcula agora (o job roda a cada 15 min)

import { companyOf, contactsOf, refreshLifecycle, runLifecycleSweep } from "./lifecycle.js";

const ROLES = new Set(["", "decisor", "financeiro", "usuario", "ponto_focal"]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanContacts(list) {
  if (!Array.isArray(list) || list.length > 20) return { error: "Envie até 20 contatos." };
  const out = [];
  for (const c of list) {
    const contact = { name: s(c?.name, 120), email: s(c?.email, 200).toLowerCase(), phone: s(c?.phone, 40), role: s(c?.role, 20), primary: c?.primary === true };
    if (!contact.name && !contact.email && !contact.phone) continue;
    if (contact.email && !EMAIL.test(contact.email)) return { error: `E-mail inválido: ${contact.email}` };
    if (!ROLES.has(contact.role)) return { error: `Papel inválido: ${contact.role}` };
    out.push(contact);
  }
  if (out.filter((c) => c.primary).length > 1) return { error: "Só um contato pode ser o principal." };
  return { contacts: out };
}

export function registerLifecycleRoutes(app, repo) {
  app.get("/api/customers/workspaces", async () => ({ workspaces: await repo.list("workspaces") }));

  app.post("/api/customers/lifecycle/run", async () => runLifecycleSweep(repo));

  app.get("/api/customers/:id/profile", async (req, reply) => {
    const found = await repo.get("customers", req.params.id);
    if (!found) return reply.code(404).send({ error: "Cliente não encontrado." });
    const customer = await refreshLifecycle(repo, found);
    const lead = customer.leadId ? await repo.get("leads", customer.leadId) : null;
    const contacts = contactsOf(customer, lead);
    return {
      id: customer.id, lifecycle: customer.lifecycle || "", financialStatus: customer.financialStatus || "",
      company: companyOf(customer, contacts), contacts,
      workspaces: await repo.listWhere("workspaces", { customer: customer.id }),
    };
  });

  app.put("/api/customers/:id/contacts", async (req, reply) => {
    const customer = await repo.get("customers", req.params.id);
    if (!customer) return reply.code(404).send({ error: "Cliente não encontrado." });
    const { contacts, error } = cleanContacts(req.body?.contacts);
    if (error) return reply.code(400).send({ error });
    const byEmail = new Map((customer.contacts || []).map((c) => [c.email, c.leverId || ""]));
    const kept = contacts.map((c) => ({ ...c, leverId: byEmail.get(c.email) || "" })); // o LeverId vem do evento, não da tela
    return repo.update("customers", customer.id, { contacts: kept });
  });
}
