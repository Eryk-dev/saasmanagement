// Fluxo de permissão de ligação no WhatsApp ("posso te ligar?"). O 1º contato
// de um lead conhecido no inbox dispara sozinho o pedido NATIVO de permissão de
// chamada da Cloud API, com a saudação do SDR no corpo (uma mensagem só, com os
// botões permitir/recusar do próprio WhatsApp). Qualquer resposta do lead com o
// fluxo aberto vira um alerta quente (wa_alerts) que salta como pop-up no
// cockpit — o time do lead quente é a taxa de conexão.
//
// A LIGAÇÃO em si (WebRTC no navegador) ainda não existe; a permissão fica
// registrada em thread.callFlow pra valer quando o terminal chegar — e o
// "posso te ligar?" já puxa o agendamento da call de qualquer jeito.
// Pré-requisito na Meta: "Allow voice calls" ligado no número (Call settings).
import { randomUUID } from "node:crypto";
import { recordMessage, threadId } from "./wa-store.js";
import { isWon } from "./stages.js";

// Saudação padrão quando o produto não configurou a dele (Ajustes → Integrações).
// {nome} = primeiro nome do lead; some com elegância quando o lead não tem nome.
export const DEFAULT_CALL_GREETING = "Olá {nome}! Recebi seu formulário aqui. Posso te ligar pra uma breve conversa sobre a plataforma?";

export function greetingFor(product, lead) {
  const raw = String(product?.waCallFlow?.greeting || "").trim() || DEFAULT_CALL_GREETING;
  const first = String(lead?.name || "").trim().split(/\s+/)[0] || "";
  return raw.replace(/\s?\{nome\}/gi, first ? ` ${first}` : "").replace(/\s+([!?,.])/g, "$1").trim();
}

// Resposta nativa do pedido de permissão (chega no webhook como mensagem
// interactive). A doc da Meta descreve interactive.call_permission_reply
// .response = "accept"|"reject" — parse defensivo pra variações de shape.
export function parsePermissionReply(m) {
  if (!m || m.type !== "interactive") return null;
  const i = m.interactive || {};
  const r = i.call_permission_reply?.response
    || (String(i.type || "").includes("call_permission") ? (i.response || i.reply?.response || "") : "");
  const v = String(r).toLowerCase();
  if (!v) return null;
  if (v.includes("accept") || v.includes("approve")) return "accepted";
  if (v.includes("reject") || v.includes("decline")) return "declined";
  return null;
}

// Depois de 72h do pedido, resposta do lead volta a ser conversa normal do
// inbox (sem pop-up) — o "quente" do fluxo é o timing logo após o formulário.
const HOT_WINDOW_MS = 72 * 3_600_000;

export async function openAlerts(repo) {
  return (await repo.list("wa_alerts")).filter((a) => a.status === "open");
}

// Um alerta ABERTO por conversa: mensagem nova do mesmo lead atualiza o alerta
// existente em vez de empilhar pop-ups.
async function raiseAlert(repo, thread, { text = "", permission = "" } = {}) {
  const now = new Date().toISOString();
  const base = {
    thread: thread.id, phone: thread.phone, name: thread.name || "",
    leadId: thread.leadId || null, saas: thread.saas || "",
    text: String(text || "").slice(0, 300),
    permission: permission || thread.callFlow?.permission || "",
    at: now,
  };
  const open = (await openAlerts(repo)).find((a) => a.thread === thread.id);
  if (open) return repo.update("wa_alerts", open.id, base);
  return repo.create("wa_alerts", { id: "wal_" + randomUUID(), ...base, status: "open", createdAt: now });
}

// Resolver os alertas da conversa — chamado quando ALGUÉM responde (qualquer
// envio na thread) ou pelo botão "resolvido" do pop-up. SSE avisa os outros.
export async function closeThreadAlerts(repo, tid, by = "") {
  const now = new Date().toISOString();
  for (const a of await openAlerts(repo)) {
    if (a.thread === tid) await repo.update("wa_alerts", a.id, { status: "done", doneAt: now, doneBy: by });
  }
}

// Manda o pedido de permissão com a saudação e registra o fluxo na thread.
// Número sem a chamada habilitada (ou interactive não suportado): cai pra texto
// simples com a MESMA saudação — o lead nunca fica sem resposta; o pedido
// nativo fica como "not_requested" pra UI saber que não foi feito.
export async function startCallFlow(repo, wa, { thread, product, lead, phoneId, author = "fluxo-ligacao", text = "" } = {}) {
  const body = String(text || "").trim() || greetingFor(product, lead);
  let interactive = true, messageId = "";
  try {
    ({ messageId } = await wa.sendCallPermission(thread.phone, body, { phoneId }));
  } catch {
    interactive = false;
    ({ messageId } = await wa.sendText(thread.phone, body, { phoneId })); // pode lançar (ex.: fora da janela) — o chamador decide
  }
  await recordMessage(repo, {
    id: messageId, phone: thread.phone, direction: "out", text: body, status: "sent",
    author, waPhoneId: phoneId || "", saas: thread.saas || "", leadId: thread.leadId ?? undefined,
  });
  await repo.update("wa_threads", threadId(thread.phone), {
    callFlow: {
      startedAt: new Date().toISOString(),
      permission: interactive ? "pending" : "not_requested",
      auto: author === "fluxo-ligacao",
    },
  });
  return { interactive, messageId };
}

// Gancho do webhook pra CADA mensagem recebida (depois do recordMessage):
//  - registra a resposta de permissão (aceitou/recusou) na thread;
//  - fluxo aberto e quente → levanta o alerta (pop-up pro SDR);
//  - 1º contato de lead conhecido com o fluxo ligado no produto → inicia.
export async function runInboundCallFlow(repo, wa, { message, resolvePhoneId }) {
  const tid = threadId(message?.from || "");
  if (!tid) return;
  const thread = await repo.get("wa_threads", tid);
  if (!thread) return;

  const had = !!thread.callFlow;
  const perm = parsePermissionReply(message);
  if (perm && had) {
    await repo.update("wa_threads", tid, {
      callFlow: { ...thread.callFlow, permission: perm, permissionAt: new Date().toISOString() },
    });
  }

  if (had) {
    const startedAt = new Date(thread.callFlow.startedAt || 0).getTime();
    if (Date.now() - startedAt <= HOT_WINDOW_MS) {
      const fresh = (await repo.get("wa_threads", tid)) || thread;
      await raiseAlert(repo, fresh, {
        text: perm
          ? (perm === "accepted" ? "Topou receber a ligação" : "Prefere não receber ligação")
          : (message.text?.body || fresh.lastText || ""),
        permission: perm || fresh.callFlow?.permission || "",
      });
    }
    return;
  }

  if (perm) return; // resposta de permissão sem fluxo registrado: nada a fazer
  await maybeStart(repo, wa, { thread, resolvePhoneId });
}

async function maybeStart(repo, wa, { thread, resolvePhoneId }) {
  if (!thread.leadId) return; // só lead conhecido — o form cria o lead antes de mandar pro WhatsApp
  const inbound = (await repo.list("wa_messages")).filter((m) => m.thread === thread.id && m.direction === "in");
  if (inbound.length > 1) return; // não é o 1º contato — conversa já existia
  const lead = await repo.get("leads", thread.leadId);
  if (!lead) return;
  const product = (await repo.list("products")).find((p) => p.id === (thread.saas || lead.saas));
  if (!product?.waCallFlow?.enabled) return;
  if (isWon(product, lead.stage)) return; // cliente fechado não recebe "posso te ligar?"
  const phoneId = await resolvePhoneId({ thread });
  if (phoneId === null || !wa.configured(phoneId)) return;
  try {
    await startCallFlow(repo, wa, { thread, product, lead, phoneId });
  } catch { /* saudação não pode derrubar a entrega do webhook */ }
}
