// Régua de marcos do cliente, no SERVIDOR. Até 13/09/2026 a régua existia só no
// navegador (packages/web/src/lib/milestones.js): a ficha desenhava a linha do
// tempo e o "concluir" gravava `customer.milestonesDone`. Ninguém era avisado, o
// marco vencia em silêncio e o pós-venda dependia de alguém abrir a ficha certa
// no dia certo. Aqui cada marco que chega a hora vira TAREFA do dono da conta,
// que é a fila de trabalho do farmer.
//
// As duas pontas ficam em sincronia nos dois sentidos:
//   tarefa concluída  → grava customer.milestonesDone[key]  (hook de tasks-core)
//   marco concluído na ficha → conclui a tarefa aberta      (PATCH em routes.js)
//
// O template é uma CÓPIA deliberada do módulo do web (mesmo par de espelhos do
// comp-plan.js): o SPA não importa do servidor e vice-versa. O teste
// customer-milestones.test.js importa os dois e compara, então divergência
// quebra o CI em vez de aparecer como marco fantasma na tela.

import { createTask, completeTask, registerTaskHook } from "./tasks-core.js";
import { isChurnedCustomer } from "./churn.js";

const DAY = 86_400_000;

export const DEFAULT_MILESTONES = [
  { key: "onboarding", label: "Onboarding", dueDays: 7, hint: "semana 1" },
  { key: "checkin_m1", label: "Check-in de mês 1", dueDays: 30, hint: "mês 1" },
  { key: "revisao_m3", label: "Revisão de resultado", dueDays: 90, hint: "mês 3" },
  { key: "upsell_m6", label: "Conversa de upsell", dueDays: 180, hint: "mês 6" },
];

const CYCLE_DAYS = { monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };
const PLAN_HINTS = [["consulta", 0], ["único", 0], ["unico", 0], ["mensal", 30], ["trimestral", 91], ["semestral", 182], ["anual", 365]];
export const RENEWAL_LEAD_DAYS = 60;

export function milestoneTemplate(product) {
  const custom = product?.milestones;
  return Array.isArray(custom) && custom.length ? custom : DEFAULT_MILESTONES;
}

function contractDays(customer) {
  const plan = String(customer?.plan || "").toLowerCase();
  for (const [hint, days] of PLAN_HINTS) if (plan.includes(hint)) return days;
  return CYCLE_DAYS[customer?.contractCycle] || 365;
}

function renewalMilestone(customer) {
  const days = contractDays(customer);
  if (days <= RENEWAL_LEAD_DAYS) return null;
  return { key: "renovacao", label: "Contato de renovação", dueDays: days - RENEWAL_LEAD_DAYS, hint: "2 meses antes do fim do contrato" };
}

export function milestonesFor(customer, product, now = Date.now()) {
  if (!customer?.startedAt) return [];
  const start = new Date(customer.startedAt).getTime();
  if (!Number.isFinite(start)) return [];
  const done = customer.milestonesDone || {};
  const base = milestoneTemplate(product);
  const renewal = renewalMilestone(customer);
  const template = renewal && !base.some((m) => m.key === renewal.key) ? [...base, renewal] : base;
  return template
    .map((m) => {
      const dueAt = start + Number(m.dueDays || 0) * DAY;
      const doneAt = done[m.key] || null;
      const status = doneAt ? "done" : dueAt <= now ? "late" : dueAt - now <= 7 * DAY ? "soon" : "next";
      return { ...m, dueAt: new Date(dueAt).toISOString(), doneAt, status };
    })
    .sort((a, b) => (a.dueDays || 0) - (b.dueDays || 0));
}

// Tempo de casa legível (espelha tenureLabel do web; entra na descrição da tarefa).
export function tenureLabel(customer, now = Date.now()) {
  if (!customer?.startedAt) return "";
  const days = Math.max(0, Math.floor((now - new Date(customer.startedAt).getTime()) / DAY));
  if (days < 60) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} meses`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} ${years === 1 ? "ano" : "anos"} e ${rest} ${rest === 1 ? "mês" : "meses"}` : `${years} ${years === 1 ? "ano" : "anos"}`;
}

const dia = (iso) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
};
const fmtDia = (iso) => {
  const s = dia(iso);
  return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
};

// Título por marco. Cai no rótulo do template quando o produto sobrescreve a
// régua com marcos próprios (aí o título é "<rótulo> · <cliente>").
const TITULO = {
  onboarding: (nome) => `Onboarding de ${nome} (semana 1)`,
  checkin_m1: (nome) => `Check-in de mês 1 com ${nome}`,
  revisao_m3: (nome) => `Revisão de resultado com ${nome} (mês 3)`,
  upsell_m6: (nome) => `Conversa de upsell com ${nome} (mês 6)`,
};

export function taskCopyFor(milestone, customer, { now = Date.now() } = {}) {
  const nome = customer.name || customer.company || "cliente";
  const title = milestone.key === "renovacao"
    ? `Contato de renovação com ${nome} (contrato termina em ${fmtDia(new Date(new Date(customer.startedAt).getTime() + (Number(milestone.dueDays) + RENEWAL_LEAD_DAYS) * DAY).toISOString())})`
    : (TITULO[milestone.key] ? TITULO[milestone.key](nome) : `${milestone.label} · ${nome}`);
  const description = [
    `Marco da régua de pós-venda: ${milestone.label}${milestone.hint ? ` (${milestone.hint})` : ""}.`,
    `Cliente desde ${fmtDia(customer.startedAt)} · ${tenureLabel(customer, now)}.`,
    "",
    "Ao concluir esta tarefa o marco fica marcado na ficha do cliente.",
  ].join("\n");
  return { title, description };
}

// Marcos que merecem tarefa AGORA: não concluídos, já na janela de 7 dias que a
// ficha chama de "soon", e vencidos há no máximo `graceDays`. O teto de atraso é
// o que impede a primeira execução de despejar no quadro todo marco que venceu
// na vida da base: marco muito velho ficou pra trás de propósito.
export function dueMilestones(customer, product, { now = Date.now(), graceDays = 30 } = {}) {
  return milestonesFor(customer, product, now).filter((m) => {
    if (m.status === "done") return false;
    const due = new Date(m.dueAt).getTime();
    if (due - now > 7 * DAY) return false;
    return now - due <= graceDays * DAY;
  });
}

// Cliente que entra na régua: ativo, com data de entrada e fora da mentoria (o
// pós-venda da UniqueKids é a jornada de consultas, não esta régua).
export const inMilestoneRuler = (customer, at = Date.now()) =>
  !!customer?.startedAt && customer.saas !== "uniquekids" && !isChurnedCustomer(customer, at);

export function startCustomerMilestones(repo, {
  log,
  intervalMs = 30 * 60 * 1000,
  graceDays = 30,
  now = () => new Date(),
} = {}) {
  let running = false;

  // Tarefa concluída no quadro → o marco fica marcado na ficha (e vice-versa
  // quando a pessoa conclui pela ficha, no PATCH de customers).
  const offDone = registerTaskHook("completed", async (r, task) => {
    if (!task.customerId || !task.milestoneKey) return;
    const c = await r.get("customers", task.customerId);
    if (!c || (c.milestonesDone || {})[task.milestoneKey]) return;
    await r.update("customers", task.customerId, {
      milestonesDone: { ...(c.milestonesDone || {}), [task.milestoneKey]: task.completedAt || new Date().toISOString() },
    });
  });
  const offReopen = registerTaskHook("reopened", async (r, task) => {
    if (!task.customerId || !task.milestoneKey) return;
    const c = await r.get("customers", task.customerId);
    if (!c || !(c.milestonesDone || {})[task.milestoneKey]) return;
    const done = { ...(c.milestonesDone || {}) };
    delete done[task.milestoneKey];
    await r.update("customers", task.customerId, { milestonesDone: done });
  });

  async function tick(at = now()) {
    const ms = at.getTime();
    const [customers, products, subs] = await Promise.all([
      repo.list("customers").catch(() => []),
      repo.list("products").catch(() => []),
      repo.list("subscriptions").catch(() => []),
    ]);
    const prodById = new Map(products.map((p) => [p.id, p]));
    // Ciclo da assinatura ativa: fallback do contrato quando o plano do cadastro
    // não diz (mesma injeção que a ficha faz antes de desenhar a régua).
    const cycleOf = new Map();
    for (const s of subs) {
      if (s.status !== "active" && s.status !== "past_due") continue;
      if (s.customer && !cycleOf.has(s.customer)) cycleOf.set(s.customer, s.cycle);
    }
    let created = 0;

    for (const c of customers) {
      if (!inMilestoneRuler(c, ms)) continue;
      const customer = { ...c, contractCycle: c.contractCycle || cycleOf.get(c.id) };
      const pending = dueMilestones(customer, prodById.get(c.saas), { now: ms, graceDays });
      if (!pending.length) continue;
      for (const m of pending) {
        const existing = await repo.listWhere("tasks", { customerId: c.id, milestoneKey: m.key }, { fields: [] }).catch(() => []);
        if (existing.length) continue;
        const { title, description } = taskCopyFor(m, customer, { now: ms });
        const task = await createTask(repo, {
          saas: c.saas || "",
          title,
          description,
          labels: ["pos-venda", "marco"],
          dueDate: dia(m.dueAt),
          customerId: c.id,
          milestoneKey: m.key,
          ...(c.owner ? { assignees: [c.owner] } : {}),
        }, { by: "system" });
        await repo.update("customers", c.id, { milestoneTasks: { ...(c.milestoneTasks || {}), [m.key]: task.id } });
        created++;
      }
    }
    return { created };
  }

  const run = async () => {
    if (running) return null;
    running = true;
    try { return await tick(); }
    catch (err) { log?.warn?.(`customer milestones: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 50_000); // depois das migrações e dos outros lembretes
  first.unref?.();
  return { tick, run, stop: () => { clearInterval(timer); clearTimeout(first); offDone(); offReopen(); } };
}

// Marco concluído pela FICHA → conclui a tarefa aberta daquele marco. Chamado
// pelo PATCH de customers; best-effort, nunca quebra o PATCH.
export async function completeMilestoneTasks(repo, customer, keys, { by = "api" } = {}) {
  let n = 0;
  for (const key of keys) {
    const found = await repo.listWhere("tasks", { customerId: customer.id, milestoneKey: key }).catch(() => []);
    for (const t of found) {
      if (t.completed) continue;
      await completeTask(repo, t.id, true, { by });
      n++;
    }
  }
  return n;
}
