// Acompanhamento de CS do cliente — Fase 3 do plano do Lever CRM. Check-in,
// QBR, renovação ou conversa de risco, com dono, prazo, sentimento, próximos
// passos e reunião com Meet próprio (calls/record-meetings.js). É também onde
// cai a "reunião com o cliente" marcada pela ficha quando não há integração
// aberta: a reunião deixou de morar no lead da venda.

import { randomUUID } from "node:crypto";
import { appendTimeline } from "../events/timeline.js";
import { refreshLifecycle } from "./lifecycle.js";

// O acompanhamento de renovação aberto põe o cliente na coluna "renovação" da
// carteira de CS: criar ou fechar um recalcula o cliente.
async function refreshCustomer(repo, customerId, now) {
  const c = await repo.get("customers", customerId);
  if (c) await refreshLifecycle(repo, c, { now });
}

export const FOLLOWUPS = "cs_followups";
export const FOLLOWUP_KINDS = ["check_in", "qbr", "renovacao", "risco"];
export const FOLLOWUP_STATUS = ["aberto", "feito", "cancelado"];
const SENTIMENTS = ["", "positivo", "neutro", "negativo"];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw fail(400, `Data inválida: ${v}`);
  return d.toISOString();
};

export async function createFollowup(repo, body, { by = "", now = new Date() } = {}) {
  const customer = await repo.get("customers", s(body?.customer, 120));
  if (!customer) throw fail(404, "Cliente não encontrado.");
  const kind = FOLLOWUP_KINDS.includes(body?.kind) ? body.kind : "check_in";
  const f = await repo.create(FOLLOWUPS, {
    id: "fu_" + randomUUID(), customer: customer.id, saas: customer.saas || "", kind,
    status: "aberto", owner: s(body?.owner, 60) || customer.owner || "", dueAt: iso(body?.dueAt),
    doneAt: "", sentiment: "", notes: s(body?.notes, 2000), nextSteps: s(body?.nextSteps, 2000),
    source: s(body?.source, 40) || "manual", meetings: [], createdAt: now.toISOString(), createdBy: by,
  });
  await appendTimeline(repo, {
    id: `tl:followup:${f.id}`, kind: "followup.created", source: "cockpit", at: now.toISOString(),
    customer: customer.id, lead: "", data: { followup: f.id, kind },
  });
  await refreshCustomer(repo, customer.id, now);
  return f;
}

export async function updateFollowup(repo, id, body, { by = "", now = new Date() } = {}) {
  const cur = await repo.get(FOLLOWUPS, id);
  if (!cur) throw fail(404, "Acompanhamento não encontrado.");
  const patch = {};
  for (const k of ["owner"]) if (typeof body?.[k] === "string") patch[k] = s(body[k], 60);
  for (const k of ["notes", "nextSteps"]) if (typeof body?.[k] === "string") patch[k] = s(body[k], 2000);
  if ("dueAt" in (body || {})) patch.dueAt = iso(body.dueAt);
  if (body?.kind !== undefined) {
    if (!FOLLOWUP_KINDS.includes(body.kind)) throw fail(400, `Tipo inválido: ${body.kind}`);
    patch.kind = body.kind;
  }
  if (body?.sentiment !== undefined) {
    if (!SENTIMENTS.includes(body.sentiment)) throw fail(400, `Sentimento inválido: ${body.sentiment}`);
    patch.sentiment = body.sentiment;
  }
  const status = body?.status;
  if (status !== undefined && !FOLLOWUP_STATUS.includes(status)) throw fail(400, `Status inválido: ${status}`);
  const closing = status && status !== cur.status;
  if (closing) {
    patch.status = status;
    patch.doneAt = status === "feito" ? now.toISOString() : "";
  }
  if (!Object.keys(patch).length) return cur;
  const saved = await repo.update(FOLLOWUPS, id, { ...patch, updatedBy: by });
  if (closing && status === "feito") {
    await appendTimeline(repo, {
      id: `tl:followup-done:${id}:${now.toISOString()}`, kind: "followup.done", source: "cockpit", at: now.toISOString(),
      customer: cur.customer, lead: "", data: { followup: id, kind: saved.kind, sentiment: saved.sentiment, nextSteps: saved.nextSteps },
    });
  }
  if (closing) await refreshCustomer(repo, cur.customer, now);
  return saved;
}

export const followupsOf = (repo, customerId) => repo.listWhere(FOLLOWUPS, { customer: customerId });

// Onde mora a "reunião com o cliente" marcada pela ficha: na integração aberta
// mais recente; sem ela, num check-in novo. Nunca no lead da venda.
export async function meetingHostFor(repo, customer, { by = "" } = {}) {
  const open = (await repo.listWhere("onboardings", { customer: customer.id }))
    .filter((o) => !["concluida", "cancelada"].includes(o.stage))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (open.length) return { collection: "onboardings", id: open[0].id };
  const f = await createFollowup(repo, { customer: customer.id, kind: "check_in", source: "reuniao" }, { by });
  return { collection: FOLLOWUPS, id: f.id };
}
