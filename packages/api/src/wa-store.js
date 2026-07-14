// Modelo de conversa do inbox de WhatsApp. Duas collections:
//  - wa_threads: índice de conversas (1 por número). id = número em dígitos.
//    { id, phone, name, leadId, saas, lastText, lastAt, lastDir, unread, updatedAt }
//  - wa_messages: TODAS as mensagens (entrada e saída). id = waMessageId (wamid…),
//    { id, thread, leadId, saas, direction:"in"|"out", text, at, status, from, author, readByAgent }
// Canônico pro inbox E pro chat do drawer (ambos leem daqui). Não escreve na
// timeline de activities de propósito: chat ≠ toque de cadência (não re-agenda).
import { randomUUID } from "node:crypto";
import { digits } from "./whatsapp.js";

export const threadId = (phone) => digits(phone);

export async function findLeadByPhone(repo, phone) {
  const d = digits(phone);
  if (!d) return null;
  const leads = await repo.list("leads");
  return leads.find((l) => l.phone && digits(l.phone) === d) || null;
}

// Grava uma mensagem e atualiza o thread. Idempotente por id (a Meta re-entrega
// o webhook). Resolve o lead pelo telefone se leadId não veio. Retorna o id da
// mensagem, ou null se foi deduplicada.
export async function recordMessage(repo, { id, phone, direction, text = "", at, status = "", from = "", author = "", leadId, saas, contactName = "" }) {
  const tid = digits(phone || from);
  if (!tid) return null;
  const msgId = id || "wm_" + randomUUID();
  if (await repo.get("wa_messages", msgId)) return null; // dedup

  let lid = leadId ?? null, sa = saas || "";
  if (lid == null) {
    const lead = await findLeadByPhone(repo, tid);
    if (lead) { lid = lead.id; sa = sa || lead.saas || ""; }
  }
  const when = at || new Date().toISOString();

  await repo.create("wa_messages", {
    id: msgId, thread: tid, leadId: lid, saas: sa, direction, text,
    at: when, status, from: from || (direction === "in" ? tid : ""), author, readByAgent: direction === "out",
  });

  const prev = await repo.get("wa_threads", tid);
  const patch = {
    id: tid, phone: tid,
    name: contactName || prev?.name || "",
    leadId: lid ?? prev?.leadId ?? null,
    saas: sa || prev?.saas || "",
    lastText: text, lastAt: when, lastDir: direction,
    unread: direction === "in" ? (prev?.unread || 0) + 1 : (prev?.unread || 0),
    updatedAt: when,
  };
  if (prev) await repo.update("wa_threads", tid, patch);
  else await repo.create("wa_threads", { ...patch, createdAt: when, unread: direction === "in" ? 1 : 0 });
  return msgId;
}

// Atualiza status (sent/delivered/read/failed) de uma mensagem enviada.
export async function updateStatus(repo, waMessageId, status, error = "") {
  if (!waMessageId) return;
  const m = await repo.get("wa_messages", waMessageId);
  if (m) await repo.update("wa_messages", waMessageId, { status, ...(error ? { error } : {}) });
}

// Lista as conversas (mais recente primeiro), enriquecidas com nome do lead.
export async function listThreads(repo) {
  const [threads, leads] = await Promise.all([repo.list("wa_threads"), repo.list("leads")]);
  const byId = new Map(leads.map((l) => [l.id, l]));
  return threads
    .map((t) => {
      const lead = t.leadId ? byId.get(t.leadId) : null;
      return {
        id: t.id, phone: t.phone, saas: t.saas || lead?.saas || "",
        leadId: t.leadId || null,
        name: (lead?.name || lead?.company || t.name || "").trim(),
        company: lead?.company || "",
        stage: lead?.stage || "",
        lastText: t.lastText || "", lastAt: t.lastAt || t.updatedAt || "", lastDir: t.lastDir || "",
        unread: t.unread || 0,
      };
    })
    .sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")));
}

// Mensagens de uma conversa (mais antiga primeiro).
export async function listMessages(repo, tid) {
  const id = digits(tid);
  const all = await repo.list("wa_messages");
  return all.filter((m) => m.thread === id).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

// Zera o não-lido e marca as recebidas como lidas. Retorna o waMessageId da
// última recebida (pra dar o "visto"/blue tick pro cliente via Cloud API).
export async function markThreadRead(repo, tid) {
  const id = digits(tid);
  const t = await repo.get("wa_threads", id);
  if (t && t.unread) await repo.update("wa_threads", id, { unread: 0 });
  const msgs = await listMessages(repo, id);
  let lastIn = "";
  for (const m of msgs) {
    if (m.direction === "in") {
      lastIn = m.id;
      if (!m.readByAgent) await repo.update("wa_messages", m.id, { readByAgent: true });
    }
  }
  return lastIn;
}
