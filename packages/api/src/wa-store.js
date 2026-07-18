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
export async function recordMessage(repo, { id, phone, direction, text = "", at, status = "", from = "", author = "", leadId, saas, contactName = "", waPhoneId = "", saasHint = "" }) {
  const tid = digits(phone || from);
  if (!tid) return null;
  const msgId = id || "wm_" + randomUUID();
  if (await repo.get("wa_messages", msgId)) return null; // dedup

  let lid = leadId ?? null, sa = saas || "";
  if (lid == null) {
    const lead = await findLeadByPhone(repo, tid);
    if (lead) { lid = lead.id; sa = sa || lead.saas || ""; }
  }
  // Sem lead pra dizer o produto, vale o dono do NÚMERO por onde entrou
  // (multi-número: conversa nova no WhatsApp da UniqueKids nasce etiquetada).
  if (!sa && saasHint) sa = saasHint;
  const when = at || new Date().toISOString();

  await repo.create("wa_messages", {
    id: msgId, thread: tid, leadId: lid, saas: sa, direction, text,
    at: when, status, from: from || (direction === "in" ? tid : ""), author, readByAgent: direction === "out",
    ...(waPhoneId ? { waPhoneId } : {}),
  });

  const prev = await repo.get("wa_threads", tid);
  const patch = {
    id: tid, phone: tid,
    name: contactName || prev?.name || "",
    leadId: lid ?? prev?.leadId ?? null,
    saas: sa || prev?.saas || "",
    // O número da conversa: fixa por onde ela ENTROU (resposta sai pelo mesmo).
    waPhoneId: waPhoneId || prev?.waPhoneId || "",
    lastText: text, lastAt: when, lastDir: direction,
    unread: direction === "in" ? (prev?.unread || 0) + 1 : (prev?.unread || 0),
    updatedAt: when,
  };
  if (prev) await repo.update("wa_threads", tid, patch);
  else await repo.create("wa_threads", { ...patch, createdAt: when, unread: direction === "in" ? 1 : 0 });
  return msgId;
}

// Códigos de erro da Meta que significam "não dá pra entregar / número não está
// no WhatsApp" — sinal seguro pra marcar o número como inválido e limpar a base.
// 131047/470 são RE-ENGAJAMENTO (fora da janela de 24h): o número é VÁLIDO, só
// precisa de template, então NÃO entram aqui.
const INVALID_FAIL_CODES = new Set([131026, 131021, 131000]);

// Atualiza status (sent/delivered/read/failed) de uma mensagem enviada. `err`
// pode ser string (título) ou o objeto de erro da Meta ({ code, title }). Quando
// falha com código de "não entregável", marca o LEAD como whatsappInvalid (o
// disparo/drip param de tentar esse número e a base fica limpa).
export async function updateStatus(repo, waMessageId, status, err = "") {
  if (!waMessageId) return;
  const m = await repo.get("wa_messages", waMessageId);
  if (!m) return;
  const title = typeof err === "string" ? err : (err?.title || err?.message || "");
  const code = typeof err === "object" && err ? Number(err.code) : NaN;
  await repo.update("wa_messages", waMessageId, { status, ...(title ? { error: title } : {}) });
  if (status === "failed" && Number.isFinite(code) && INVALID_FAIL_CODES.has(code) && m.leadId) {
    const lead = await repo.get("leads", m.leadId);
    if (lead && !lead.whatsappInvalid) {
      await repo.update("leads", m.leadId, {
        whatsappInvalid: true,
        whatsappInvalidReason: title || `código ${code}`,
        whatsappInvalidAt: new Date().toISOString(),
      });
    }
  }
}

// Opt-out / opt-in de MARKETING no WhatsApp (webhook user_preferences, o "parar
// promoções" nativo). Suprime o lead dos disparos/drip, igual descadastro de
// e-mail. Resolve o lead pelo número. Retorna o leadId afetado (ou null).
export async function setLeadWhatsappOptOut(repo, phone, optOut) {
  const lead = await findLeadByPhone(repo, phone);
  if (!lead) return null;
  await repo.update("leads", lead.id, {
    whatsappOptOut: !!optOut,
    ...(optOut ? { whatsappOptOutAt: new Date().toISOString() } : {}),
  });
  return lead.id;
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
        waPhoneId: t.waPhoneId || "", // por qual dos NOSSOS números a conversa corre
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

// Números do inbox pra decisão do dia: quem está esperando resposta, quanto a
// gente demora a responder e quantas janelas de 24h ainda estão abertas (fora
// delas a Meta só aceita template). `days` limita volume/novas/tempo de
// resposta; "esperando" e "janela" são SEMPRE do estado atual — o que está em
// aberto agora é o que muda a ação, não o recorte do período.
const HOUR = 3_600_000;
export async function waInsights(repo, { days = 30, now = Date.now() } = {}) {
  const [threads, messages] = await Promise.all([repo.list("wa_threads"), repo.list("wa_messages")]);
  const since = now - Math.max(1, Number(days) || 30) * 24 * HOUR;
  const at = (m) => new Date(m.at || 0).getTime();
  const inWindowOf = (t) => t >= now - 24 * HOUR;

  const byThread = new Map();
  for (const m of messages) {
    if (!byThread.has(m.thread)) byThread.set(m.thread, []);
    byThread.get(m.thread).push(m);
  }

  let inbound = 0, outbound = 0, awaiting = 0, openWindow = 0, unread = 0;
  let oldestWaitAt = 0, answeredThreads = 0, activeThreads = 0;
  const replyTimes = [];

  for (const t of threads) {
    const msgs = (byThread.get(t.id) || []).slice().sort((a, b) => at(a) - at(b));
    if (!msgs.length) continue;
    unread += Number(t.unread) || 0;
    const last = msgs[msgs.length - 1];
    if (at(last) >= since) activeThreads++;

    // Espera = cliente falou por último. A janela de 24h conta da última
    // mensagem DELE (é ela que reabre o direito de mandar texto livre).
    const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
    if (last.direction === "in") {
      awaiting++;
      if (!oldestWaitAt || at(last) < oldestWaitAt) oldestWaitAt = at(last);
    }
    if (lastIn && inWindowOf(at(lastIn))) openWindow++;

    let waitingSince = 0, replied = false;
    for (const m of msgs) {
      const t0 = at(m);
      if (t0 >= since) (m.direction === "in" ? inbound++ : outbound++);
      if (m.direction === "in") {
        if (!waitingSince) waitingSince = t0; // só a PRIMEIRA da rajada conta
      } else if (waitingSince) {
        if (t0 >= since) replyTimes.push(t0 - waitingSince);
        waitingSince = 0;
        replied = true;
      }
    }
    if (replied) answeredThreads++;
  }

  // Mediana, não média: uma conversa esquecida no fim de semana distorce a
  // média e faz o número mentir sobre o dia a dia.
  replyTimes.sort((a, b) => a - b);
  const medianReplyMs = replyTimes.length
    ? replyTimes.length % 2
      ? replyTimes[(replyTimes.length - 1) / 2]
      : Math.round((replyTimes[replyTimes.length / 2 - 1] + replyTimes[replyTimes.length / 2]) / 2)
    : null;

  const newThreads = threads.filter((t) => new Date(t.createdAt || t.lastAt || 0).getTime() >= since).length;
  const withLead = threads.filter((t) => t.leadId).length;

  return {
    days: Math.max(1, Number(days) || 30),
    threads: threads.length,
    activeThreads,          // com mensagem no período
    newThreads,             // conversas que nasceram no período
    awaiting,               // cliente falou por último e ninguém respondeu
    oldestWaitHours: oldestWaitAt ? Math.round(((now - oldestWaitAt) / HOUR) * 10) / 10 : null,
    openWindow,             // janela de 24h aberta: dá pra mandar texto livre
    unread,
    inbound,
    outbound,
    medianReplyMinutes: medianReplyMs == null ? null : Math.round(medianReplyMs / 60_000),
    replySample: replyTimes.length,
    answeredRate: threads.length ? Math.round((answeredThreads / threads.length) * 100) : null,
    withLead,
    withoutLead: threads.length - withLead,
  };
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
