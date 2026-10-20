// Integração do cliente como REGISTRO PRÓPRIO — Fase 1B do plano do Lever CRM.
//
// Ganho e integração são coisas diferentes. A venda é fato do lead (customerId,
// wonAt); a integração é do CLIENTE: pode nascer do fechamento, mas também
// depois, a qualquer momento (produto novo, reintegração, migração,
// treinamento), sem negócio novo. Um cliente pode ter várias.
//
// Enquanto o funil ainda carrega a integração no card do lead (integrationAt,
// integrator, etapas integracao/posvenda), `syncLeadOnboarding` espelha esses
// campos numa integração `source: "lead"`. Assim que alguém mexe pela própria
// integração (`managed: true`), o espelho para de escrever nela — a integração
// passa a mandar. Desfazer a venda cancela a integração que ainda não começou.

import { randomUUID } from "node:crypto";
import { kindOf } from "../crm/stages.js";
import { requiresIntegration } from "../billing/plan-catalog.js";
import { appendTimeline } from "../events/timeline.js";
import { refreshLifecycle } from "./lifecycle.js";
import { templateFor, templatesOf } from "./onboarding-templates.js";

export const ONBOARDINGS = "onboardings";
export const ONBOARDING_STAGES = ["aguardando_kickoff", "kickoff", "configuracao", "treinamento", "go_live", "concluida", "cancelada"];
export const ONBOARDING_KINDS = ["implantacao", "novo_produto", "reintegracao", "migracao", "treinamento"];
const CLOSED = new Set(["concluida", "cancelada"]);
const SIDES = new Set(["lever", "cliente"]);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isoOrEmpty = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw fail(400, `Data inválida: ${v}`);
  return d.toISOString();
};

export const progressOf = (o) => {
  const items = o?.items || [];
  return items.length ? Math.round((items.filter((i) => i.doneAt).length / items.length) * 100) : 0;
};

export function cleanItems(list) {
  if (!Array.isArray(list) || list.length > 60) throw fail(400, "Envie até 60 itens no checklist.");
  return list.map((i) => {
    const title = s(i?.title, 200);
    if (!title) throw fail(400, "Item do checklist sem título.");
    const side = SIDES.has(i?.side) ? i.side : "lever";
    return { id: s(i?.id, 60) || "it_" + randomUUID().slice(0, 8), title, side, owner: s(i?.owner, 60), dueAt: isoOrEmpty(i?.dueAt), doneAt: isoOrEmpty(i?.doneAt) };
  });
}

async function afterChange(repo, onboarding, kind, data, now) {
  await appendTimeline(repo, {
    id: `tl:${kind}:${onboarding.id}:${now.toISOString()}`, kind, source: "cockpit", at: now.toISOString(),
    customer: onboarding.customer, lead: onboarding.lead || "", data: { onboarding: onboarding.id, ...data },
  });
  const customer = await repo.get("customers", onboarding.customer);
  if (customer) await refreshLifecycle(repo, customer, { now });
}

export async function createOnboarding(repo, body, { by = "", now = new Date(), source = "manual" } = {}) {
  const customer = await repo.get("customers", s(body?.customer, 120));
  if (!customer) throw fail(404, "Cliente não encontrado.");
  const kind = ONBOARDING_KINDS.includes(body?.kind) ? body.kind : "implantacao";
  // Sem checklist no pedido, nasce com o do modelo do tipo (e do plano). O
  // espelho do card do lead (legado) não ganha modelo: ele conclui quando o
  // card vai pro Pós-venda, e o checklist em aberto travaria isso.
  const template = body?.items || source === "lead" ? null : templateFor(await templatesOf(repo, customer.saas), { kind, planCode: customer.planCode || "" });
  const onboarding = await repo.create(ONBOARDINGS, {
    id: "ob_" + randomUUID(),
    customer: customer.id, lead: s(body?.lead, 120), saas: customer.saas || "",
    kind, product: s(body?.product, 40), stage: "aguardando_kickoff", stageAt: now.toISOString(),
    integrator: s(body?.integrator, 60) || customer.owner || "",
    kickoffAt: isoOrEmpty(body?.kickoffAt), plannedGoLiveAt: isoOrEmpty(body?.plannedGoLiveAt), goLiveAt: "",
    items: cleanItems(body?.items || template?.items || []), template: template?.id || "", notes: s(body?.notes, 2000),
    source, managed: source !== "lead", createdAt: now.toISOString(), createdBy: by,
  });
  await afterChange(repo, onboarding, "onboarding.created", { kind, source }, now);
  return onboarding;
}

const EDITABLE = ["integrator", "product", "notes"];
const DATES = ["kickoffAt", "plannedGoLiveAt", "goLiveAt"];

// Edição pela própria integração: valida, aplica o portão do checklist e
// marca `managed` (o espelho do lead para de escrever aqui).
export async function updateOnboarding(repo, id, body, { by = "", now = new Date(), fromLead = false } = {}) {
  const cur = await repo.get(ONBOARDINGS, id);
  if (!cur) throw fail(404, "Integração não encontrada.");
  const patch = {};
  for (const k of EDITABLE) if (typeof body?.[k] === "string") patch[k] = s(body[k], k === "notes" ? 2000 : 60);
  for (const k of DATES) if (k in (body || {})) patch[k] = isoOrEmpty(body[k]);
  if (ONBOARDING_KINDS.includes(body?.kind)) patch.kind = body.kind;
  if (body?.items) patch.items = cleanItems(body.items);
  const stage = body?.stage;
  if (stage !== undefined && !ONBOARDING_STAGES.includes(stage)) throw fail(400, `Etapa inválida: ${stage}`);
  const moving = stage && stage !== cur.stage;
  if (moving && stage === "concluida" && !fromLead) {
    const items = patch.items || cur.items || [];
    if (items.some((i) => !i.doneAt)) throw fail(409, "Conclua todos os itens do checklist antes de concluir a integração.");
  }
  if (moving) {
    patch.stage = stage;
    patch.stageAt = now.toISOString();
    if (["go_live", "concluida"].includes(stage) && !cur.goLiveAt && !patch.goLiveAt) patch.goLiveAt = now.toISOString();
  }
  if (!fromLead) { patch.managed = true; patch.updatedBy = by; }
  if (!Object.keys(patch).length) return cur;
  const saved = await repo.update(ONBOARDINGS, id, patch);
  if (moving) await afterChange(repo, saved, "onboarding.stage_changed", { from: cur.stage, to: stage }, now);
  return saved;
}

export const onboardingsOf = (repo, customerId) => repo.listWhere(ONBOARDINGS, { customer: customerId });

// Etapa do card do lead → etapa da integração espelhada. No funil de hoje o
// Ganho vem ANTES da Integração (stages.js, isPostSaleStage): estar no Ganho
// é ter vendido, não ter integrado.
function stageFromLead(leadKind, lead, now) {
  if (leadKind === "posvenda") return "concluida";
  if (lead.integrationAt && new Date(lead.integrationAt) <= now) return "configuracao";
  return "aguardando_kickoff";
}

// O cliente comprou algum plano que pede integração?
async function planAsksIntegration(repo, customerId) {
  for (const sub of await repo.listWhere("subscriptions", { customer: customerId })) {
    if (sub.plan && requiresIntegration(await repo.get("plans", sub.plan))) return true;
  }
  return false;
}

// Espelho do card do lead (legado) na integração `source: "lead"`. Vender
// (Ganho) não abre integração por si: ela nasce quando o card entra em
// Integração, quando alguém marca o horário dela ou quando o plano vendido
// pede integração.
export async function syncLeadOnboarding(repo, lead, { now = new Date() } = {}) {
  if (!lead?.customerId) return null;
  const product = await repo.get("products", lead.saas);
  const leadKind = kindOf(product, lead.stage);
  const inRegion = ["integracao", "posvenda", "ganho"].includes(leadKind);
  const existing = (await repo.listWhere(ONBOARDINGS, { lead: lead.id })).find((o) => o.source === "lead");
  if (!existing) {
    const wants = leadKind === "integracao" || Boolean(lead.integrationAt)
      || (leadKind === "ganho" && await planAsksIntegration(repo, lead.customerId));
    if (!wants) return null;
    const created = await createOnboarding(repo, {
      customer: lead.customerId, lead: lead.id, kind: "implantacao", integrator: lead.integrator || "", kickoffAt: lead.integrationAt || "",
    }, { now, source: "lead" });
    const stage = stageFromLead(leadKind, lead, now);
    return stage === created.stage ? created : updateOnboarding(repo, created.id, { stage }, { now, fromLead: true });
  }
  if (existing.managed || CLOSED.has(existing.stage) || !inRegion) return existing;
  return updateOnboarding(repo, existing.id, {
    integrator: lead.integrator || existing.integrator, kickoffAt: lead.integrationAt || existing.kickoffAt,
    stage: stageFromLead(leadKind, lead, now),
  }, { now, fromLead: true });
}

// Venda desfeita: a integração que nasceu dela e ainda não começou é cancelada
// (a que já andou fica: é história, e alguém decide).
export async function cancelLeadOnboardings(repo, lead, { now = new Date() } = {}) {
  let n = 0;
  for (const o of await repo.listWhere(ONBOARDINGS, { lead: lead.id })) {
    if (o.source !== "lead" || o.stage !== "aguardando_kickoff") continue;
    await updateOnboarding(repo, o.id, { stage: "cancelada" }, { now, fromLead: true });
    n++;
  }
  return n;
}

// Carga inicial: uma integração para cada lead já vendido que tem integração
// marcada ou está na etapa. Dry-run por padrão, com relatório.
export async function backfillOnboardings(repo, { apply = false, now = new Date() } = {}) {
  const leads = (await repo.list("leads")).filter((l) => l.customerId && !l.internal);
  const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
  const have = new Set((await repo.list(ONBOARDINGS)).filter((o) => o.source === "lead").map((o) => o.lead));
  const report = { candidates: 0, created: 0, skipped: 0, apply };
  for (const lead of leads) {
    const k = kindOf(products.get(lead.saas), lead.stage);
    if (k !== "integracao" && k !== "posvenda" && !lead.integrationAt) continue;
    report.candidates++;
    if (have.has(lead.id) || !(await repo.get("customers", lead.customerId))) { report.skipped++; continue; }
    if (apply) { await syncLeadOnboarding(repo, lead, { now }); report.created++; }
  }
  return report;
}
