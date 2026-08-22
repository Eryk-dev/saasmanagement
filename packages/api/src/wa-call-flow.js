// Saudação automática no 1º contato do WhatsApp. O 1º contato de um lead
// conhecido no inbox recebe sozinho a saudação do SDR, como TEXTO simples, e
// qualquer resposta do lead com o fluxo aberto vira um alerta quente
// (wa_alerts) que salta como pop-up no cockpit — o timing do lead quente é a
// taxa de conexão.
//
// O pedido NATIVO de permissão de ligação (interactive call_permission_request)
// foi REMOVIDO em 22/08/2026 (decisão do Leo): a conta tomou ACCOUNT_VIOLATION
// por USER_INITIATED_CALLS_LOW_PICKUP_RATE — a taxa de atendimento das
// ligações não está no nosso controle depois que o cliente aceita, então
// solicitação de ligação (automática E manual) sai de cena pra proteger o
// número. `parsePermissionReply` e o registro em thread.callFlow.permission
// ficam: respostas atrasadas de pedidos antigos ainda chegam pelo webhook e o
// histórico das conversas continua legível.
import { randomUUID } from "node:crypto";
import { recordMessage, threadId } from "./wa-store.js";
import { isWonLead } from "./stages.js";
import { isAutoSilenced } from "./off-hours-duty.js";
import { isBusinessHours, businessClock, hourOf } from "./business-hours.js";

// Saudações padrão quando o produto não configurou as dele (aba Automações).
// {nome} = primeiro nome do lead (some com elegância quando não tem);
// {volta} = quando o time volta ("hoje às 8h" / "amanhã às 8h" / "segunda às
// 8h"), calculado do horário configurado. Sem convite de ligação: a conversa
// segue por texto (a ligação saiu de cena em 22/08, ver o topo do arquivo).
export const DEFAULT_CALL_GREETING = "Olá {nome}! Recebi seu formulário aqui. Podemos conversar por aqui mesmo sobre a plataforma?";
export const DEFAULT_AFTER_HOURS_GREETING = "Olá {nome}! Recebi seu formulário aqui. Nosso time está fora do horário agora, mas volta {volta}. Pode deixar sua mensagem que respondemos assim que voltarmos.";

// ── Horário do time ─────────────────────────────────────────────────────────
// O fluxo tem DUAS saudações: dentro do horário comercial (seg a sex, 8h às
// 18h por padrão, configurável por produto) pede pra ligar AGORA; fora dele
// avisa quando o time volta e pede a autorização pra ligar QUANDO voltar. O
// expediente em si mora em business-hours.js, compartilhado com o plantão.

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

// O pop-up do cockpit é um só e serve dois avisos: `hot` = o lead RESPONDEU numa
// conversa aberta; `lead` = o lead ACABOU DE ENTRAR e ninguém falou com ele
// ainda. Linha anterior à existência do campo é alerta de conversa.
export const alertKind = (a) => (a?.kind === "lead" ? "lead" : "hot");

// Um alerta ABERTO por conversa: mensagem nova do mesmo lead atualiza o alerta
// existente em vez de empilhar pop-ups. (Exportado: o SDR automatizado usa o
// MESMO pop-up quando uma resposta de lembrete precisa de gente — sdr-flow.js.)
export async function raiseAlert(repo, thread, { text = "", permission = "" } = {}) {
  const now = new Date().toISOString();
  const base = {
    kind: "hot", // alerta de CONVERSA (lead respondeu) — ver raiseNewLeadAlert
    thread: thread.id, phone: thread.phone, name: thread.name || "",
    leadId: thread.leadId || null, saas: thread.saas || "",
    text: String(text || "").slice(0, 300),
    permission: permission || thread.callFlow?.permission || "",
    at: now,
  };
  const open = (await openAlerts(repo)).find((a) => a.thread === thread.id && alertKind(a) === "hot");
  if (open) return repo.update("wa_alerts", open.id, base);
  return repo.create("wa_alerts", { id: "wal_" + randomUUID(), ...base, status: "open", createdAt: now });
}

// ── Pop-up de LEAD NOVO ─────────────────────────────────────────────────────
// O lead acabou de mandar o formulário: é o único momento em que ele está com o
// assunto na cabeça e o celular na mão. O alerta salta pro SDR na hora pra o 1º
// contato sair em minutos, em vez de esperar o próximo bloco da fila do Meu dia.
//
// Um alerta por LEAD: reenvio do form (ou segunda entrada) atualiza o mesmo
// registro, então a tabela cresce no máximo junto com a de leads, nunca uma
// linha por pop-up ignorado. Até quando o aviso ainda vale a pena interromper
// alguém é decisão de quem exibe (wa-hot-alert.jsx): depois da janela o lead não
// some, ele está na fila do Meu dia, que é onde o atraso é cobrado.
export async function raiseNewLeadAlert(repo, lead, { at = new Date(), text = "" } = {}) {
  if (!lead?.id) return null;
  const now = new Date(at).toISOString();
  const base = {
    kind: "lead", thread: "", // lead novo ainda não tem conversa: o pop-up abre o 1º toque
    phone: String(lead.phone || "").replace(/\D/g, ""),
    name: lead.name || "", leadId: lead.id, saas: lead.saas || "",
    text: String(text || "").slice(0, 300), permission: "", at: now,
  };
  const open = (await openAlerts(repo)).find((a) => a.leadId === lead.id && alertKind(a) === "lead");
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

// Manda a saudação (TEXTO simples, nunca o pedido nativo de ligação — ver o
// topo do arquivo) e registra o fluxo na thread. O `callFlow` continua sendo
// gravado porque é ele que marca a conversa como "quente": resposta do lead
// dentro da janela vira pop-up (runInboundCallFlow).
export async function startCallFlow(repo, wa, { thread, product, lead, phoneId, author = "fluxo-ligacao", text = "" } = {}) {
  const body = String(text || "").trim() || greetingFor(product, lead);
  const { messageId } = await wa.sendText(thread.phone, body, { phoneId }); // pode lançar (ex.: fora da janela) — o chamador decide
  await recordMessage(repo, {
    id: messageId, phone: thread.phone, direction: "out", text: body, status: "sent",
    author, waPhoneId: phoneId || "", saas: thread.saas || "", leadId: thread.leadId ?? undefined,
  });
  await repo.update("wa_threads", threadId(thread.phone), {
    callFlow: {
      startedAt: new Date().toISOString(),
      permission: "not_requested",
      auto: author === "fluxo-ligacao",
    },
  });
  return { interactive: false, messageId };
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

  const perm = parsePermissionReply(message);
  if (perm) {
    // Aceite/recusa é FATO do lead (ele tocou permitir/recusar no WhatsApp):
    // grava SEMPRE, mesmo sem fluxo pendente registrado. Antes só gravava se o
    // callFlow já existia (`perm && had`), então aceite que chegava sem o
    // "pending" — pedido manual que não persistiu, corrida do webhook, número
    // reprovisionado — era exibido ("topou receber a ligação") mas o estado
    // ficava null e o "Ligar" nunca virava discagem. Sem fluxo prévio, cria um.
    const prevFlow = thread.callFlow || { startedAt: new Date().toISOString(), auto: false };
    await repo.update("wa_threads", tid, {
      callFlow: { ...prevFlow, permission: perm, permissionAt: new Date().toISOString() },
    });
  }

  // Tem fluxo (já tinha, ou o aceite acabou de criar) → é conversa quente:
  // levanta o pop-up e não reinicia o "posso te ligar?".
  if (thread.callFlow || perm) {
    const startedAt = new Date(thread.callFlow?.startedAt || now).getTime();
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

  await maybeStart(repo, wa, { thread, resolvePhoneId, now });
}

async function maybeStart(repo, wa, { thread, resolvePhoneId, now = new Date() }) {
  if (!thread.leadId) return; // só lead conhecido — o form cria o lead antes de mandar pro WhatsApp
  const inbound = await repo.listWhere("wa_messages", { thread: thread.id, direction: "in" }, { fields: [] });
  if (inbound.length > 1) return; // não é o 1º contato — conversa já existia
  // O TIME já abriu a conversa antes (template dos "modelos", WhatsApp do 1º
  // ato, disparo)? Então o lead está RESPONDENDO a alguém e o fluxo não se
  // re-apresenta por cima — caso Leandro (05/08): template às 09:34 e o fluxo
  // mandou "Oiii, Manuela falando" DE NOVO às 09:39, na 1ª resposta dele. O
  // pedido de permissão de ligação fica no botão "Pedir pra ligar" da conversa.
  const outbound = await repo.listWhere("wa_messages", { thread: thread.id, direction: "out" }, { fields: [] });
  if (outbound.length) return;
  const lead = await repo.get("leads", thread.leadId);
  if (!lead) return;
  const product = (await repo.list("products")).find((p) => p.id === (thread.saas || lead.saas));
  if (!product?.waCallFlow?.enabled) return;
  // Plantão fora do horário: o formulário já mandou esse lead pro número de
  // quem está de plantão, e quem responde é gente. A saudação automática
  // "estamos fora do horário, voltamos amanhã" entraria por cima de um
  // atendimento humano acontecendo AGORA — na janela do plantão ela fica calada.
  if (isAutoSilenced(product, now)) return;
  if (isWonLead(product, lead)) return; // cliente fechado não recebe saudação de lead novo
  const phoneId = await resolvePhoneId({ thread });
  if (phoneId === null || !wa.configured(phoneId)) return;
  try {
    // Dentro do horário: saudação normal. Fora dele (noite/fim de semana):
    // avisa quando o time volta.
    await startCallFlow(repo, wa, { thread, product, lead, phoneId, text: greetingFor(product, lead, { at: now }) });
  } catch { /* saudação não pode derrubar a entrega do webhook */ }
}
