// Churn de cliente — a régua única e os caminhos que marcam a saída.
//
// Régua: churnado = customer.endedAt no PASSADO (a mesma conta da tela de
// Clientes). O arr NÃO é zerado no churn — quem tira o cliente do MRR/rollup/
// contagem de ativos é o endedAt (rollupProduct e as telas), e o valor
// congelado preserva o histórico (Análise de clientes, série mensal, LTV).
// O guard do syncCustomerArr (billing.js) garante o congelamento.
//
// Dois caminhos marcam churn:
//   manual     → POST /api/customers/:id/churn (botão da ficha) — cobre os
//                clientes SEM recorrência rastreada no Mercado Pago.
//   automático → o MP cancelou a preapproval (webhook OU poller chamam
//                applyMpCancellationChurn). Recorrência REATIVADA no MP desfaz
//                um churn que o próprio MP marcou (applyMpReactivationRescue).

import { logActivity } from "./lead-flow.js";

export const isChurnedCustomer = (c, at = Date.now()) =>
  !!(c?.endedAt && new Date(c.endedAt).getTime() <= at);

// Motivos padronizados (o front oferece o mesmo catálogo em lib/churn.js).
// Motivo fora do catálogo vale como texto livre — o label cai no próprio texto.
export const CHURN_REASON_LABEL = {
  sem_resultado: "Não viu resultado",
  preco: "Preço / corte de custos",
  fechou_operacao: "Fechou ou pausou a operação",
  concorrente: "Trocou por concorrente",
  inadimplencia: "Inadimplência",
  fim_contrato: "Fim do contrato (não renovou)",
  mp_cancel: "Assinatura cancelada no Mercado Pago",
  outro: "Outro",
};
export const churnReasonLabel = (r) => CHURN_REASON_LABEL[r] || String(r || "");

// Carimba a saída no cliente + timeline do lead de origem + aviso no Discord.
// Re-marcar um cliente já churnado só atualiza data/motivo (sem re-avisar).
export async function markCustomerChurn(repo, customer, { endedAt, reason = "", note = "", source = "manual", author = "system", discord, log } = {}) {
  const wasChurned = !!customer.endedAt;
  const saved = await repo.update("customers", customer.id, {
    endedAt: endedAt || new Date().toISOString(),
    churnReason: reason, churnNote: note, churnSource: source, churnedBy: author,
  });
  if (customer.leadId) {
    try {
      await logActivity(repo, {
        saas: customer.saas || "", lead: customer.leadId, type: "system",
        text: `Churn registrado: ${churnReasonLabel(reason) || "sem motivo"}${note ? ` · ${note}` : ""}`,
        meta: { event: "customer_churn", reason, source }, author,
      });
    } catch { /* timeline é registro, nunca quebra o churn */ }
  }
  if (!wasChurned && discord?.configured?.()) {
    try {
      const product = customer.saas ? await repo.get("products", customer.saas) : null;
      await discord.customerChurned({
        customer: saved, productName: product?.name || customer.saas,
        reasonLabel: churnReasonLabel(reason), source,
        mrr: (Number(customer.arr) || 0) / 12,
      });
    } catch (err) { log?.warn?.({ customer: customer.id, err: err.message }, "churn: aviso Discord falhou"); }
  }
  return saved;
}

// Desfaz a saída (marcação errada ou cliente que voltou). Não mexe nas
// assinaturas — se a cobrança continua, quem reativa é a aba Assinaturas.
export async function clearCustomerChurn(repo, customer, { author = "system", note = "" } = {}) {
  const saved = await repo.update("customers", customer.id, {
    endedAt: "", churnReason: "", churnNote: "", churnSource: "", churnedBy: "",
  });
  if (customer.leadId) {
    try {
      await logActivity(repo, {
        saas: customer.saas || "", lead: customer.leadId, type: "system",
        text: `Churn desfeito${note ? ` · ${note}` : ""}`,
        meta: { event: "customer_churn_undone" }, author,
      });
    } catch { /* fail-open */ }
  }
  return saved;
}

// Preapproval CANCELADA no MP (webhook/poller, depois de espelhar a assinatura):
// se não sobrou nenhuma outra assinatura viva do cliente, ele churna sozinho.
// Sobrando uma ativa/em atraso, é troca de recorrência — não é churn.
export async function applyMpCancellationChurn(repo, sub, { discord, log } = {}) {
  if (!sub?.customer) return null;
  const customer = await repo.get("customers", sub.customer);
  if (!customer || isChurnedCustomer(customer)) return null;
  const alive = (await repo.list("subscriptions")).some((s) =>
    s.customer === customer.id && s.id !== sub.id && (s.status === "active" || s.status === "past_due"));
  if (alive) {
    log?.info?.({ customer: customer.id, sub: sub.id }, "MP cancelou, mas outra assinatura segue viva — sem churn");
    return null;
  }
  return markCustomerChurn(repo, customer, {
    reason: "mp_cancel", source: "mp", author: "mercadopago", discord, log,
  });
}

// Preapproval AUTORIZADA de novo: churn que o PRÓPRIO MP marcou é desfeito
// sozinho (cliente reativou a cobrança). Churn manual fica — decisão humana.
export async function applyMpReactivationRescue(repo, sub, { log } = {}) {
  if (!sub?.customer) return null;
  const customer = await repo.get("customers", sub.customer);
  if (!customer || !isChurnedCustomer(customer) || customer.churnSource !== "mp") return null;
  log?.info?.({ customer: customer.id, sub: sub.id }, "MP reativou a recorrência — churn automático desfeito");
  return clearCustomerChurn(repo, customer, { author: "mercadopago", note: "recorrência reativada no Mercado Pago" });
}
