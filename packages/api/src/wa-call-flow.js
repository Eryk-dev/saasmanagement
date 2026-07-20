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
import { isWonLead } from "./stages.js";

// Saudações padrão quando o produto não configurou as dele (Ajustes →
// Integrações). {nome} = primeiro nome do lead (some com elegância quando não
// tem); {volta} = quando o time volta ("hoje às 8h" / "amanhã às 8h" /
// "segunda às 8h"), calculado do horário configurado.
export const DEFAULT_CALL_GREETING = "Olá {nome}! Recebi seu formulário aqui. Posso te ligar pra uma breve conversa sobre a plataforma?";
export const DEFAULT_AFTER_HOURS_GREETING = "Olá {nome}! Recebi seu formulário aqui. Nosso time está fora do horário agora, mas volta {volta}. Posso te ligar quando voltarmos pra falar sobre a plataforma? Já deixa a autorização aqui embaixo.";

// ── Horário do time ─────────────────────────────────────────────────────────
// O fluxo tem DUAS saudações: dentro do horário comercial (seg a sex, 8h às
// 18h por padrão, configurável por produto) pede pra ligar AGORA; fora dele
// avisa quando o time volta e pede a autorização pra ligar QUANDO voltar.
// Relógio do negócio em UTC-3 fixo (mesma convenção do marketing/lead-flow).
const BRT = 3 * 3_600_000;
const hourOf = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : fallback; };
const businessClock = (at) => new Date(new Date(at).getTime() - BRT); // campos UTC = relógio de Brasília

export function isBusinessHours(product, at = new Date()) {
  const cfg = product?.waCallFlow || {};
  const clock = businessClock(at);
  const dow = clock.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const h = clock.getUTCHours() + clock.getUTCMinutes() / 60;
  return h >= hourOf(cfg.hourStart, 8) && h < hourOf(cfg.hourEnd, 18);
}

// O {volta} da saudação fora do horário. Sexta à noite e sábado apontam pra
// segunda; domingo à noite "amanhã" JÁ é segunda; madrugada de dia útil é hoje.
function nextOpening(product, at = new Date()) {
  const start = hourOf(product?.waCallFlow?.hourStart, 8);
  const label = Number.isInteger(start)
    ? `${start}h`
    : `${Math.floor(start)}h${String(Math.round((start % 1) * 60)).padStart(2, "0")}`;
  const clock = businessClock(at);
  const dow = clock.getUTCDay();
  const h = clock.getUTCHours() + clock.getUTCMinutes() / 60;
  if (dow >= 1 && dow <= 5 && h < start) return `hoje às ${label}`;
  if ((dow >= 1 && dow <= 4) || dow === 0) return `amanhã às ${label}`;
  return `segunda às ${label}`;
}

// `business` força o modo (o pedido manual é sempre "agora": tem gente na
// tela clicando); sem ele, decide pelo relógio do negócio.
// Variáveis das saudações (a tela de Ajustes lista): {nome} primeiro nome do
// lead, {empresa} empresa do lead, {produto} nome do SaaS, {volta} quando o
// time volta. Valor vazio some junto com o espaço anterior (sem "Olá !").
export function greetingFor(product, lead, { at = new Date(), business } = {}) {
  const inHours = business ?? isBusinessHours(product, at);
  const cfg = product?.waCallFlow || {};
  const raw = String((inHours ? cfg.greeting : cfg.afterHours) || "").trim()
    || (inHours ? DEFAULT_CALL_GREETING : DEFAULT_AFTER_HOURS_GREETING);
  const first = String(lead?.name || "").trim().split(/\s+/)[0] || "";
  const company = String(lead?.company || "").trim();
  const productName = String(product?.name || "").trim();
  return raw
    .replace(/\{volta\}/gi, nextOpening(product, at))
    .replace(/\s?\{produto\}/gi, productName ? ` ${productName}` : "")
    .replace(/\s?\{empresa\}/gi, company ? ` ${company}` : "")
    .replace(/\s?\{nome\}/gi, first ? ` ${first}` : "")
    .replace(/\s+([!?,.])/g, "$1").trim();
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
export async function runInboundCallFlow(repo, wa, { message, resolvePhoneId, now = new Date() }) {
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
  await maybeStart(repo, wa, { thread, resolvePhoneId, now });
}

async function maybeStart(repo, wa, { thread, resolvePhoneId, now = new Date() }) {
  if (!thread.leadId) return; // só lead conhecido — o form cria o lead antes de mandar pro WhatsApp
  const inbound = (await repo.list("wa_messages")).filter((m) => m.thread === thread.id && m.direction === "in");
  if (inbound.length > 1) return; // não é o 1º contato — conversa já existia
  const lead = await repo.get("leads", thread.leadId);
  if (!lead) return;
  const product = (await repo.list("products")).find((p) => p.id === (thread.saas || lead.saas));
  if (!product?.waCallFlow?.enabled) return;
  if (isWonLead(product, lead)) return; // cliente fechado não recebe "posso te ligar?"
  const phoneId = await resolvePhoneId({ thread });
  if (phoneId === null || !wa.configured(phoneId)) return;
  try {
    // Dentro do horário: "posso te ligar?". Fora dele (noite/fim de semana):
    // avisa quando o time volta e já pede a autorização pra esse retorno.
    await startCallFlow(repo, wa, { thread, product, lead, phoneId, text: greetingFor(product, lead, { at: now }) });
  } catch { /* saudação não pode derrubar a entrega do webhook */ }
}
