// CANCELAR A VENDA de um negócio (04/11/2026, caso Marlininilson: o card foi
// pra Acompanhamento por engano, virou cliente, e 7 s depois foi pra
// Desqualificado — mas seguiu contando como venda). Mover pra perda NÃO desfaz
// a venda de propósito (o cliente que comprou e saiu é churn), então cancelar
// precisa ser uma decisão explícita, feita aqui:
//   - negócio novo: o cliente, a assinatura e as faturas automáticas nascidos
//     do fechamento saem (revertWonLead) e o lead perde customerId/wonAt;
//   - negócio extra (upsell etc.): o cliente é de antes, sai só o wonAt.
// Pode vir junto do movimento (gate de perda: `stage` + motivo) ou sozinho, pra
// um card que JÁ está fora da região de venda. Cobrança real do Mercado Pago
// bloqueia com 409 antes de mexer em qualquer coisa.

import { kindOf } from "./stages.js";
import { applyStageMove, revertWonLead, logActivity } from "./lead-flow.js";

const SOLD_KINDS = new Set(["ganho", "integracao", "posvenda"]);

const isExtraDeal = (lead) => !!lead?.dealType && lead.dealType !== "nova_venda";

// O registro de venda que o lead carrega (a régua do isWonLead sem a etapa).
export function hasSaleRecord(lead) {
  return isExtraDeal(lead) ? !!lead?.wonAt : !!(lead?.customerId || lead?.wonAt);
}

function fail(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// Cliente nascido deste fechamento com dinheiro real do MP (preapproval ou
// pagamento): a mesma trava do revertWonLead e do revert-win, só que explícita.
async function realBillingOf(repo, lead) {
  if (isExtraDeal(lead)) return false;
  const customers = await repo.list("customers").catch(() => []);
  const customer = customers.find((c) => c.id === lead.customerId)
    || customers.find((c) => c.leadId === lead.id) || null;
  if (!customer || customer.leadId !== lead.id) return false;
  const subs = (await repo.list("subscriptions")).filter((s) => s.customer === customer.id);
  if (subs.some((s) => s.mpPreapprovalId)) return true;
  const invoices = (await repo.list("invoices")).filter((i) =>
    i.customer === customer.id || subs.some((s) => s.id === i.subscription));
  return invoices.some((i) => i.mpPaymentId);
}

export async function cancelLeadSale(repo, lead, { stage = "", lostReason = "", lostNote = "", note = "", author = "api", now = new Date() } = {}) {
  const product = lead.saas ? await repo.get("products", lead.saas) : null;
  const fromKind = kindOf(product, lead.stage);
  const toStage = String(stage || "").trim();
  if (toStage && toStage !== lead.stage) {
    const toKind = kindOf(product, toStage);
    if (!toKind) throw fail(400, "stage_unknown", `A etapa "${toStage}" não existe no funil deste produto.`);
    if (SOLD_KINDS.has(toKind)) throw fail(400, "stage_sold", "Cancelar a venda tira o card da região de venda: escolha uma etapa fora de Ganho/Integração/pós-venda.");
  } else if (SOLD_KINDS.has(fromKind)) {
    throw fail(400, "stage_required", `O card está em "${lead.stage}": diga pra qual etapa ele vai ao cancelar a venda.`);
  }
  if (!hasSaleRecord(lead) && !SOLD_KINDS.has(fromKind)) {
    throw fail(409, "no_sale", "Este negócio não conta como venda: não há o que cancelar.");
  }
  if (await realBillingOf(repo, lead)) {
    throw fail(409, "sale_has_real_billing", "Este cliente tem cobrança ou pagamento real do Mercado Pago. Nada foi alterado: resolva pelo Financeiro.");
  }

  let patch = {};
  if (toStage && toStage !== lead.stage) {
    patch = { stage: toStage };
    if (lostReason) patch.lostReason = lostReason;
    if (lostNote) patch.lostNote = lostNote;
    Object.assign(patch, await applyStageMove(repo, { lead, toStage, patch: { ...patch }, author, now }));
  }
  // Etapa aberta do funil: o próprio applyStageMove já desfez (limpa wonAt).
  let customerRemoved = false;
  if (!("wonAt" in patch)) {
    if (isExtraDeal(lead)) {
      patch.wonAt = "";
    } else {
      const r = await revertWonLead(repo, lead, { author });
      customerRemoved = r.removed;
      patch.customerId = "";
      patch.wonAt = "";
    }
  }
  const updated = await repo.update("leads", lead.id, patch);
  try {
    await logActivity(repo, {
      saas: lead.saas || "", lead: lead.id, type: "system", author,
      text: String(note || "").trim().slice(0, 500),
      meta: { event: "sale_canceled", ...(lead.wonAt ? { wonAt: lead.wonAt } : {}), ...(lead.amount ? { amount: lead.amount } : {}) },
    });
  } catch { /* timeline é best-effort */ }
  return { lead: updated, customerRemoved };
}
