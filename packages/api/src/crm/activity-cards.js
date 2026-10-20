// Atividade como card ligado a qualquer registro — Fase 2 do plano do Lever
// CRM. Ligação, WhatsApp, e-mail, reunião, tarefa ou follow-up, com dono, dia
// e o registro a que ela pertence: um lead, um cliente, uma integração ou um
// acompanhamento de CS.
//
// A atividade é uma TAREFA (tasks-core.js) com três campos a mais:
// `activityType`, `record` ({ kind, id, label }) e os ponteiros `crmLead` /
// `crmCustomer`, resolvidos aqui a partir do registro. Por isso ela aparece
// sozinha no "Meu dia" e no quadro de tarefas, segue as mesmas notificações e
// prazos, e a concluída entra na timeline do cliente e do lead.
//
// O "próximo toque" da cadência (lead.nextActionAt) continua sendo o motor do
// funil e do robô de SDR; a atividade cobre o resto do trabalho do time.

import { completeTask, createTask } from "../tasks/tasks-core.js";

export const ACTIVITY_TYPES = ["ligacao", "whatsapp", "email", "reuniao", "tarefa", "followup"];
export const ACTIVITY_LABEL = { ligacao: "Ligar", whatsapp: "WhatsApp", email: "E-mail", reuniao: "Reunião", tarefa: "Tarefa", followup: "Follow-up" };
const KIND_LABEL = { onboardings: "Integração", cs_followups: "Acompanhamento" };
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// O registro → rótulo, produto e os ponteiros de lead e cliente.
export async function resolveRecord(repo, record) {
  const kind = s(record?.kind, 20);
  const id = s(record?.id, 120);
  if (kind === "lead") {
    const l = await repo.get("leads", id);
    if (l) return { kind, id, label: l.name || l.company || "lead", saas: l.saas || "", crmLead: l.id, crmCustomer: l.customerId || "" };
  } else if (kind === "customer") {
    const c = await repo.get("customers", id);
    if (c) return { kind, id, label: c.name || "cliente", saas: c.saas || "", crmLead: c.leadId || "", crmCustomer: c.id };
  } else if (kind === "onboarding" || kind === "followup") {
    const collection = kind === "onboarding" ? "onboardings" : "cs_followups";
    const r = await repo.get(collection, id);
    const c = r ? await repo.get("customers", r.customer) : null;
    if (r) return { kind, id, label: `${KIND_LABEL[collection]} · ${c?.name || "cliente"}`, saas: c?.saas || "", crmLead: r.lead || "", crmCustomer: r.customer };
  }
  throw fail(404, "Registro da atividade não encontrado.");
}

export async function createActivityCard(repo, body, { by = "api" } = {}) {
  const type = ACTIVITY_TYPES.includes(body?.type) ? body.type : "tarefa";
  const rec = await resolveRecord(repo, body?.record);
  const owner = s(body?.owner, 60) || by;
  return createTask(repo, {
    title: s(body?.title, 200) || `${ACTIVITY_LABEL[type]} · ${rec.label}`,
    description: s(body?.note, 4000),
    saas: rec.saas, assignees: owner && owner !== "api" ? [owner] : [],
    dueDate: s(body?.dueDate, 10), labels: ["atividade", type],
    activityType: type, record: { kind: rec.kind, id: rec.id, label: rec.label },
    crmLead: rec.crmLead, crmCustomer: rec.crmCustomer,
  }, { by });
}

// Concluir pela ficha: quem trabalha o registro nem sempre vê o quadro de
// tarefas (/api/tasks é da tela "tasks"), então a rota é própria e só vale
// para tarefa que é atividade.
export async function completeActivityCard(repo, id, completed, { by = "api" } = {}) {
  const t = await repo.get("tasks", id);
  if (!t?.activityType) throw fail(404, "Atividade não encontrada.");
  return completeTask(repo, id, completed !== false, { by });
}

// As atividades de um lead ou de um cliente (abertas primeiro, por prazo).
export async function activitiesOf(repo, { lead = "", customer = "" }) {
  const rows = customer ? await repo.listWhere("tasks", { crmCustomer: customer }) : await repo.listWhere("tasks", { crmLead: lead });
  return rows.filter((t) => t.activityType).sort((a, b) =>
    Number(a.completed) - Number(b.completed) || String(a.dueDate || "9").localeCompare(String(b.dueDate || "9")));
}
