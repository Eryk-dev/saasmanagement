// Compromissos do cliente na integração.
//
// O resumo por IA da call de integração já separava o que ficou pendente E de
// quem é a pendência (`pendencias: [{ item, responsavel }]`, anthropic.js), mas
// isso virava só TEXTO: aparecia na Análise de Integração como frequência e
// morria ali. Na prática o integrador ficava cobrando de cabeça, o card não
// sabia que estava parado esperando o cliente, e o atraso do cliente entrava na
// conta do nosso atraso.
//
// Aqui cada compromisso do CLIENTE vira tarefa com prazo, o card ganha o chip
// "aguardando cliente" e a cobrança vira trabalho agendado de alguém.
//
// Duas decisões que valem comentário:
//   · o chip lê um CARIMBO no lead (`lead.clientPending`), não as tarefas: o
//     bootstrap só manda tarefas pra quem tem a tela Tarefas (routes.js), e o
//     card do pipeline é desenhado do SEED.LEADS;
//   · atraso do cliente NÃO é atraso nosso: a régua de próximo toque do board
//     (funnel.js) não muda, e a Análise de Integração separa os dois.

import { createHash } from "node:crypto";
import { createTask, registerTaskHook } from "./tasks-core.js";
import { addBusinessDaysNaive } from "./agenda-slots.js";
import { logActivity } from "./lead-flow.js";
import { digits } from "./whatsapp.js";

export const CLIENT_PENDING_LABEL = "pendencia-cliente";
export const CLIENT_PENDING_DAYS = 2; // prazo em dias ÚTEIS

// Mesma normalização da Análise de Integração (routes.integrations.js), pra o
// mesmo item escrito duas vezes pela IA não virar duas tarefas.
export const normalizeItem = (item) => String(item || "").trim().toLowerCase().slice(0, 80);

// "É do cliente?" — o mesmo teste que a Análise de Integração usa.
export const isClientItem = (p) => {
  const resp = typeof p === "object" && p ? String(p.responsavel || "") : "";
  return /client/i.test(resp);
};

export const pendingKey = (leadId, item) =>
  `pc:${leadId}:${createHash("sha1").update(normalizeItem(item)).digest("hex").slice(0, 12)}`;

// Prazo: 2 dias úteis a partir de hoje (sexta vira terça, não domingo).
export function dueFor(now = new Date()) {
  const d = new Date(now.getTime() - 3 * 3600 * 1000); // relógio de Brasília
  const naive = `${d.toISOString().slice(0, 10)}T18:00`;
  return addBusinessDaysNaive(naive, CLIENT_PENDING_DAYS).slice(0, 10);
}

const fmtDia = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
};

// Recalcula o carimbo do lead a partir das tarefas abertas. É o que o card e o
// bloco Entrega leem: um objeto pequeno, sempre coerente com o quadro.
export async function restampClientPending(repo, leadId, { now = () => new Date() } = {}) {
  const hoje = new Date(now().getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const todas = await repo.listWhere("tasks", { lead: leadId }).catch(() => []);
  const abertas = todas.filter((t) => !t.completed && (t.labels || []).includes(CLIENT_PENDING_LABEL));
  const items = abertas
    .map((t) => ({ task: t.id, item: t.clientPendingItem || t.title || "", dueDate: t.dueDate || "" }))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const overdue = items.filter((i) => i.dueDate && i.dueDate < hoje).length;
  const clientPending = items.length
    ? { open: items.length, overdue, nextDue: items[0].dueDate || "", items: items.slice(0, 8) }
    : null;
  await repo.update("leads", leadId, { clientPending });
  return clientPending;
}

// Compromissos do cliente de um resumo → tarefas. Idempotente por (lead, item).
export async function syncClientPending(repo, lead, summary, {
  source = "call", now = () => new Date(), by = "system", customer = null,
} = {}) {
  const itens = (summary?.pendencias || []).filter(isClientItem)
    .map((p) => (typeof p === "object" ? p.item : p))
    .filter((i) => normalizeItem(i));
  if (!itens.length) return { created: 0 };

  const at = now();
  const dueDate = dueFor(at);
  const dono = lead.integrator || customer?.owner || "";
  const followup = String(summary?.followup?.whatsapp || summary?.followup?.nota || "").trim();
  const quando = source === "form" ? "no Formulário de Integração" : `na call de integração de ${fmtDia(at.toISOString())}`;
  let created = 0;

  for (const item of itens) {
    const key = pendingKey(lead.id, item);
    const existe = await repo.listWhere("tasks", { pendingKey: key }, { fields: [] }).catch(() => []);
    if (existe.length) continue;
    await createTask(repo, {
      saas: lead.saas || "",
      title: `Cliente: ${String(item).slice(0, 120)}`,
      description: [
        `${lead.company || lead.name || "O cliente"} ficou de ${String(item).charAt(0).toLowerCase()}${String(item).slice(1)}.`,
        `Combinado ${quando}.`,
        ...(followup ? ["", "Mensagem pronta:", followup] : []),
        ...(lead.phone ? ["", `WhatsApp: https://wa.me/${digits(lead.phone)}`] : []),
      ].join("\n"),
      labels: [CLIENT_PENDING_LABEL],
      dueDate,
      lead: lead.id,
      pendingKey: key,
      clientPendingItem: String(item).slice(0, 200),
      ...(dono ? { assignees: [dono] } : {}),
    }, { by });
    created++;
  }

  if (created) {
    await restampClientPending(repo, lead.id, { now });
    await logActivity(repo, {
      saas: lead.saas || "", lead: lead.id, type: "system",
      text: `${created} compromisso${created === 1 ? "" : "s"} do cliente ${created === 1 ? "virou tarefa" : "viraram tarefas"} (prazo ${fmtDia(dueDate)})`,
      meta: { event: "client_pending", count: created, source },
      author: "cockpit",
    }).catch(() => { /* fail-open: o carimbo e as tarefas já valem */ });
  }
  return { created };
}

// Concluir (ou reabrir) a tarefa no quadro recarimba o lead, então o chip do
// card some na hora, por qualquer caminho de conclusão. Registrado no import: o
// módulo ESM é singleton (não duplica) e o hook recebe o `repo` como argumento,
// então não precisa de fábrica nem de ciclo de vida.
const onPendingWrite = async (repo, task) => {
  if (!task.lead || !(task.labels || []).includes(CLIENT_PENDING_LABEL)) return;
  await restampClientPending(repo, task.lead);
};
registerTaskHook("completed", onPendingWrite);
registerTaskHook("reopened", onPendingWrite);

// Atraso NOSSO num card de integração: o compromisso da etapa (integrationAt)
// venceu. É a mesma régua do próximo toque do board (funnel.js), replicada aqui
// porque a Análise de Integração precisa contrapor os dois atrasos.
export function lateOurs(lead, now = Date.now()) {
  const at = lead?.integrationAt || lead?.nextActionAt || "";
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && t < now;
}
