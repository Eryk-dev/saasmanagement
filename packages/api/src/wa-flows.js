// Fluxos de CONVERSA do Inbox — o desenho de mensagens com espera de resposta
// e ramificação (estilo ManyChat, versão cockpit). O construtor visual mora na
// aba Automações do Inbox; aqui é o motor que roda no webhook.
//
// wa_flows (CRUD genérico; guard tela whatsapp):
//   { id, saas, name, active,
//     trigger: { type: "keyword" | "first_message", keyword },
//     nodes: [{ id, kind: "message" | "question", text,
//               next,                       // message: próximo passo (null = encerra)
//               branches: [{ contains, to }], // question: resposta contém → passo
//               fallbackTo }] }             // question: sem match (null = encerra)
//
// Passo "message" envia e SEGUE pro `next` na mesma rajada; "question" envia e
// ESPERA a resposta (estado em thread.waFlow = { flow, node, at }). A resposta
// procura `contains` nas branches (sem caixa/acento); sem match cai no
// fallbackTo; sem fallback o fluxo encerra em silêncio e o SDR assume.
//
// Proteções: fluxo nasce DESATIVADO; conversa dentro de um fluxo é CAPTURADA
// (as regras simples de wa-automations não rodam por cima); o MESMO fluxo só
// recomeça na mesma conversa depois de 24h (thread.autoFired["flow:"+id]);
// máx. 8 envios por mensagem recebida (corta ciclo message→message mal
// desenhado); fluxo desligado/apagado no meio solta a conversa na hora.

import { findThreadByPhone, listMessages } from "./wa-store.js";
import { renderAutoReply } from "./wa-automations.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const FLOW_RESTART_MS = 24 * 3_600_000;
const MAX_SENDS = 8;

async function clearState(repo, thread) {
  await repo.update("wa_threads", thread.id, { waFlow: null });
}

// Envia a partir de um passo: mensagens em cadeia até esbarrar numa pergunta
// (grava o estado e espera) ou acabar o caminho (limpa o estado).
async function execute(repo, { flow, thread, startId, send, now }) {
  let node = (flow.nodes || []).find((n) => n.id === startId);
  let sends = 0;
  while (node && sends < MAX_SENDS) {
    const text = renderAutoReply(node.text, { name: thread.name || "" });
    if (text) { await send({ thread, text }); sends++; }
    if (node.kind === "question") {
      await repo.update("wa_threads", thread.id, { waFlow: { flow: flow.id, node: node.id, at: now.toISOString() } });
      return { flow: flow.id, waiting: node.id };
    }
    node = node.next ? (flow.nodes || []).find((n) => n.id === node.next) : null;
  }
  await clearState(repo, thread);
  return { flow: flow.id, ended: true };
}

// Chamado no webhook a cada mensagem RECEBIDA, ANTES das regras simples.
// Devolve null quando nenhum fluxo se aplicou (aí as regras podem rodar).
export async function runWaFlows(repo, { message, send, now = new Date() } = {}) {
  const thread = await findThreadByPhone(repo, message?.from || "");
  if (!thread) return null;
  const text = norm(message?.text || "");

  // Conversa JÁ dentro de um fluxo: roteia a resposta pela pergunta pendente.
  if (thread.waFlow?.flow) {
    const flow = await repo.get("wa_flows", thread.waFlow.flow);
    const node = flow?.active ? (flow.nodes || []).find((n) => n.id === thread.waFlow.node) : null;
    if (!flow || !flow.active || !node) { await clearState(repo, thread); return null; }
    const hit = (node.branches || []).find((b) => b.contains && text.includes(norm(b.contains)));
    const to = hit ? hit.to : node.fallbackTo;
    if (!to) {
      await clearState(repo, thread);
      return { flow: flow.id, ended: true };
    }
    return execute(repo, { flow, thread, startId: to, send, now });
  }

  // Gatilho de fluxo novo (primeiro que casar vence; keyword antes de
  // first_message pra pergunta específica ganhar da recepção genérica).
  const flows = (await repo.list("wa_flows"))
    .filter((f) => f.active && (!f.saas || !thread.saas || f.saas === thread.saas))
    .sort((a, b) => (a.trigger?.type === "keyword" ? 0 : 1) - (b.trigger?.type === "keyword" ? 0 : 1));
  if (!flows.length) return null;
  const inbound = (await listMessages(repo, thread.id)).filter((m) => m.direction === "in");
  const isFirst = inbound.length <= 1;
  const flow = flows.find((f) =>
    (f.trigger?.type === "keyword" && f.trigger.keyword && text.includes(norm(f.trigger.keyword)))
    || (f.trigger?.type === "first_message" && isFirst));
  if (!flow || !flow.nodes?.length) return null;

  const key = "flow:" + flow.id;
  const last = thread.autoFired?.[key] ? new Date(thread.autoFired[key]).getTime() : 0;
  if (last && now.getTime() - last < FLOW_RESTART_MS) return null;
  await repo.update("wa_threads", thread.id, { autoFired: { ...(thread.autoFired || {}), [key]: now.toISOString() } });
  return execute(repo, { flow, thread, startId: flow.nodes[0].id, send, now });
}
