// Configuração GLOBAL do follow-up em 4 contatos (mensagem + prazo de cada
// contato), em app_config/followup_contacts. Vale pra todos os produtos.
// Leitura liberada pra qualquer sessão (a fila de Atividades também chega pelo
// bootstrap); escrita só pela tela Configurações (screens.js, prefixo de
// escrita de settings).

import { FOLLOWUP_CONTACTS_KEY, normalizeFollowupContacts } from "./followup-contacts.js";

export async function loadFollowupContacts(repo) {
  const rec = await repo.get("app_config", FOLLOWUP_CONTACTS_KEY).catch(() => null);
  return normalizeFollowupContacts(rec?.contacts);
}

export async function saveFollowupContacts(repo, raw, { by = "" } = {}) {
  const contacts = normalizeFollowupContacts(raw);
  const payload = { contacts, updatedBy: by };
  const cur = await repo.get("app_config", FOLLOWUP_CONTACTS_KEY).catch(() => null);
  if (cur) await repo.update("app_config", FOLLOWUP_CONTACTS_KEY, payload);
  else await repo.create("app_config", { id: FOLLOWUP_CONTACTS_KEY, ...payload });
  return contacts;
}

export function registerFollowupConfigRoutes(app, repo) {
  app.get("/api/followup-contacts", async () => ({ contacts: await loadFollowupContacts(repo) }));
  app.put("/api/followup-contacts", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "JSON body required" });
    const contacts = await saveFollowupContacts(repo, body.contacts ?? body, { by: req.authUser?.id || "api" });
    return { contacts };
  });
}
