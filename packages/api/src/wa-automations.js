// Automações do Inbox — regras REATIVAS sobre mensagem RECEBIDA no WhatsApp.
//
// Coleção `wa_automations` (CRUD genérico; guard na tela whatsapp):
//   { id, saas, name, trigger: "keyword" | "first_message" | "off_hours",
//     keyword, reply, active, cooldownHours, createdAt }
//
// Regras do jogo:
//   - regra nova nasce DESATIVADA (mensagem automática pro cliente é opt-in);
//   - no máximo UMA regra dispara por mensagem recebida (keyword vence
//     first_message, que vence off_hours) — nada de metralhar o lead;
//   - cooldown POR CONVERSA (carimbo em thread.autoFired[ruleId], padrão 24h);
//   - o envio é o MESMO sendAndRecord do composer (injetado pelo caller): a
//     resposta cai na thread como mensagem out do autor "automacao" e sai pelo
//     número da conversa. Janela de 24h aberta por definição: acabou de chegar
//     mensagem do contato.
//   - fora do horário usa a MESMA régua do fluxo de ligação (waCallFlow
//     hourStart/hourEnd do produto, fim de semana conta como fora).

import { findThreadByPhone, listMessages } from "./wa-store.js";
import { isBusinessHours } from "./wa-call-flow.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// {{nome}} = primeiro nome do contato; sem nome o token sai limpo, sem deixar
// "Oi , tudo bem" pra trás.
export function renderAutoReply(text, { name = "" } = {}) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return String(text || "")
    .replaceAll("{{nome}}", first)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.!?;:])/g, "$1")
    .trim();
}

const TRIGGER_PRIORITY = { keyword: 0, first_message: 1, off_hours: 2 };

export async function runWaAutomations(repo, { message, send, now = new Date() } = {}) {
  const thread = await findThreadByPhone(repo, message?.from || "");
  if (!thread) return null;
  const rules = (await repo.list("wa_automations"))
    .filter((r) => r.active && (!r.saas || !thread.saas || r.saas === thread.saas));
  if (!rules.length) return null;

  const text = norm(message?.text || "");
  // A mensagem que disparou JÁ está gravada (o hook roda depois do
  // recordMessage): primeira mensagem = 1 inbound na conversa.
  const inbound = (await listMessages(repo, thread.id)).filter((m) => m.direction === "in");
  const isFirst = inbound.length <= 1;
  const product = thread.saas ? await repo.get("products", thread.saas) : null;
  const offHours = !isBusinessHours(product, now);

  const rule = rules
    .filter((r) =>
      (r.trigger === "keyword" && r.keyword && text.includes(norm(r.keyword)))
      || (r.trigger === "first_message" && isFirst)
      || (r.trigger === "off_hours" && offHours))
    .sort((a, b) => (TRIGGER_PRIORITY[a.trigger] ?? 9) - (TRIGGER_PRIORITY[b.trigger] ?? 9))[0];
  if (!rule) return null;

  const cooldownMs = (Number(rule.cooldownHours) > 0 ? Number(rule.cooldownHours) : 24) * 3_600_000;
  const lastAt = thread.autoFired?.[rule.id] ? new Date(thread.autoFired[rule.id]).getTime() : 0;
  if (lastAt && now.getTime() - lastAt < cooldownMs) return null;

  const reply = renderAutoReply(rule.reply, { name: thread.name || "" });
  if (!reply) return null;
  await send({ thread, text: reply });
  await repo.update("wa_threads", thread.id, {
    autoFired: { ...(thread.autoFired || {}), [rule.id]: now.toISOString() },
  });
  return rule.id;
}
