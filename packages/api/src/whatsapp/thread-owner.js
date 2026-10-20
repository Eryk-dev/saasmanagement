// Dono da conversa do WhatsApp e "virar ticket" (Lever CRM, Fase 2).
//
// A conversa roteia para o dono do registro na fase em que ele está: SDR nas
// etapas de pré-venda, closer na venda, e depois do ganho o dono da conta (CS)
// ou o integrador. Sem lead (ou sem dono na fase), a conversa fica na fila do
// time (owner vazio). Atribuição manual na conversa (`thread.owner`) vence a
// regra até ser desfeita.
//
// Mensagem de cliente que vira pedido de suporte abre um ticket com um clique:
// o assunto vem da última mensagem dele, a descrição das últimas recebidas, e
// o ticket fica ligado ao lead, ao cliente e à conversa.

import { kindOf, SDR_KINDS } from "../crm/stages.js";
import { createTicket } from "../support/tickets-core.js";

const SALE_KINDS = new Set(["call", "proposta", "followup"]);
const POST_SALE = new Set(["ganho", "integracao", "posvenda"]);

export function ownerOf(lead, { product = null, customer = null } = {}) {
  if (!lead) return { owner: "", role: "fila" };
  const kind = kindOf(product, lead.stage);
  if (SDR_KINDS.has(kind)) return { owner: lead.owner || "", role: "sdr" };
  if (SALE_KINDS.has(kind)) return { owner: lead.closer || lead.owner || "", role: "closer" };
  if (POST_SALE.has(kind)) {
    if (customer?.owner) return { owner: customer.owner, role: "cs" };
    return { owner: lead.integrator || lead.closer || "", role: "integrador" };
  }
  return { owner: lead.owner || lead.closer || "", role: "sdr" };
}

// Dono efetivo de uma conversa: o manual, senão o da regra.
export function threadOwner(thread, ctx) {
  if (thread?.owner) return { owner: thread.owner, role: "manual" };
  return ownerOf(ctx.lead, ctx);
}

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export async function ticketFromThread(repo, threadId, { by = "api", now = new Date().toISOString() } = {}) {
  const thread = await repo.get("wa_threads", threadId);
  if (!thread) throw fail(404, "Conversa não encontrada.");
  if (thread.ticketId && (await repo.get("tickets", thread.ticketId))) throw fail(409, "Essa conversa já virou ticket.");
  const lead = thread.leadId ? await repo.get("leads", thread.leadId) : null;
  const saas = thread.saas || lead?.saas || "";
  if (!saas) throw fail(422, "Conversa sem produto: vincule a um lead antes de abrir o ticket.");
  const inbound = (await repo.listWhere("wa_messages", { thread: thread.id }))
    .filter((m) => m.direction === "in" && m.text)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(-5);
  const last = inbound[inbound.length - 1];
  // Vínculo quebrado (cliente apagado) não impede o ticket: ele sai sem cliente.
  const customer = lead?.customerId ? await repo.get("customers", lead.customerId) : null;
  const ticket = await createTicket(repo, {
    saas, channel: "whatsapp",
    subject: (last?.text || `Conversa com ${lead?.name || thread.name || thread.phone}`).replace(/\s+/g, " ").slice(0, 120),
    description: inbound.map((m) => `[${new Date(m.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] ${m.text}`).join("\n"),
    customerId: customer?.id || "", leadId: lead?.id || "",
    requester: { name: lead?.name || thread.name || "", phone: thread.phone || "" },
  }, { by, now });
  await repo.update("wa_threads", thread.id, { ticketId: ticket.id }, { silent: true });
  return ticket;
}
