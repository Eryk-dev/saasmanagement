// Upsell de cliente — venda extra pra quem JÁ é cliente (trabalho de CS).
//
// O registro é uma fatura kind:"upsell" carimbada com o que foi vendido
// (title), quem vendeu (soldBy) e o modo. Ela entra nas réguas existentes sem
// regra nova: caixa em 3 baldes (cashBucketsIn → upsell), placar do CS
// (routes.scoreboard: nº e R$ por soldBy) e Financeiro (Upsell).
//
// Dois modos:
//   oneoff     → venda única (serviço, pacote, clonagem avulsa): só a fatura.
//   recurring  → acréscimo na MENSALIDADE (mudou de plano, mais anúncios): a
//                assinatura ativa sobe `monthlyDelta` (MP espelha o valor novo
//                quando há preapproval) e o arr acompanha via syncCustomerArr;
//                cliente sem assinatura tem o arr somado direto (+12×delta).
//                A fatura de agora é o que foi COBRADO na virada (delta cheio,
//                pró-rata, o que o CS combinou) — pode ser zero quando a
//                cobrança só entra na próxima mensalidade (a fatura nasce
//                paga com R$ 0: ela É o registro da venda).
//
// Upsell É VENDA (Leo, 09/09): a fatura carrega soldAt (data do registro) e o
// metrics-core (upsellSalesIn) conta nº e R$ pra quem vendeu nas metas, no
// placar e no vendido do mês. R$ reconhecido = só o que caiu.
//
// Três formas de pagamento da fatura de agora:
//   paid  → já pago (data informada) — entra no caixa na hora.
//   open  → a receber (vencimento informado) — baixa manual em Clientes.
//   link  → gera cobrança no Mercado Pago (routes.mp createCustomerCharge);
//           a baixa é automática pelo webhook/poller.
//
// Receita reconhecida = só o que caiu (fatura paga), mesma régua do resto.

import { logActivity } from "./lead-flow.js";
import { syncCustomerArr } from "./billing.js";
import { isChurnedCustomer } from "./churn.js";

export const UPSELL_MODES = new Set(["oneoff", "recurring"]);
export const UPSELL_PAYMENTS = new Set(["paid", "open", "link"]);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayIso = (day) => (day ? new Date(`${String(day).slice(0, 10)}T12:00:00.000Z`).toISOString() : "");

// Valida e normaliza o corpo do POST. Devolve { error } (mensagem pro 400) ou
// os campos prontos pra gravar.
export function parseUpsellBody(body = {}, { now = new Date() } = {}) {
  const mode = UPSELL_MODES.has(body.mode) ? body.mode : "oneoff";
  const payment = UPSELL_PAYMENTS.has(body.payment) ? body.payment : "paid";
  const amount = round2(body.amount);
  const monthlyDelta = mode === "recurring" ? round2(body.monthlyDelta ?? body.amount) : 0;
  if (mode === "recurring" && !(monthlyDelta > 0)) return { error: "acréscimo na mensalidade deve ser positivo" };
  if (mode === "oneoff" && !(amount > 0)) return { error: "valor do upsell deve ser positivo" };
  if (amount < 0) return { error: "valor do upsell não pode ser negativo" };
  if (payment !== "paid" && !(amount > 0)) return { error: "cobrança a receber ou por link precisa de valor" };
  const day = String(body.date || "").trim().slice(0, 10) || now.toISOString().slice(0, 10);
  if (Number.isNaN(new Date(day).getTime())) return { error: "data inválida" };
  const dueDay = String(body.dueDate || "").trim().slice(0, 10) || day;
  if (Number.isNaN(new Date(dueDay).getTime())) return { error: "vencimento inválido" };
  const item = String(body.item || "").trim();
  if (!item) return { error: "diga o que foi vendido" };
  return {
    mode, payment, amount, monthlyDelta, item,
    at: dayIso(day), dueAt: dayIso(dueDay),
    product: String(body.product || "").trim(),
    note: String(body.note || "").trim(),
    soldBy: String(body.soldBy || "").trim(),
    maxInstallments: Number(body.maxInstallments) || undefined,
  };
}

// Texto da timeline/Discord: o que foi vendido e como.
export function upsellSummary({ item, amount, mode, monthlyDelta, payment }) {
  const brl = (v) => `R$ ${round2(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  const parts = [item];
  if (amount > 0) parts.push(brl(amount));
  if (mode === "recurring") parts.push(`+${brl(monthlyDelta)}/mês na assinatura`);
  parts.push({ paid: "pago", open: "a receber", link: "cobrança por link" }[payment] || payment);
  return parts.join(" · ");
}

// Assinatura que carrega a mensalidade do cliente (a mesma régua da ficha).
export const mainSubscriptionOf = (subs, customerId) =>
  subs.filter((s) => s.customer === customerId && (s.status === "active" || s.status === "past_due"))[0] || null;

// Grava o upsell. `createInvoice` decide como a fatura de agora nasce: o
// padrão grava direto (paid/open); o modo `link` passa a função que cria a
// cobrança no MP (routes.billing.js). Devolve { invoice, customer, subscription }.
export async function recordUpsell(repo, customer, input, { author = "system", createInvoice, mirrorPrice, discord, log } = {}) {
  if (isChurnedCustomer(customer)) throw Object.assign(new Error("cliente em churn — desfaça o churn antes de registrar upsell"), { status: 409 });
  const soldBy = input.soldBy || author || customer.owner || "";
  const nowIso = new Date().toISOString();
  const stamp = {
    title: input.item, soldBy, soldAt: input.at, upsellMode: input.mode, note: input.note,
    product: input.product, createdBy: author,
    ...(input.mode === "recurring" ? { recurringDelta: input.monthlyDelta } : {}),
  };

  // 1. A fatura de agora — sempre existe: é o registro da venda. Recorrente
  // sem cobrança na virada nasce paga com R$ 0 (conta a venda, não o caixa).
  let invoice = null;
  let url = null;
  if (createInvoice && input.amount > 0) {
    const r = await createInvoice(stamp);
    invoice = r.invoice; url = r.url || null;
  } else {
    const paid = input.payment === "paid" || !(input.amount > 0);
    invoice = await repo.create("invoices", {
      customer: customer.id, saas: customer.saas || "", amount: input.amount, kind: "upsell",
      status: paid ? "paid" : "open",
      dueDate: paid ? input.at : input.dueAt,
      ...(paid ? { paidAt: input.at } : {}),
      createdAt: nowIso, ...stamp,
    });
  }

  // 2. Recorrente: a mensalidade sobe na assinatura (e o arr acompanha).
  let subscription = null;
  if (input.mode === "recurring") {
    const subs = await repo.list("subscriptions");
    const sub = mainSubscriptionOf(subs, customer.id);
    if (sub) {
      subscription = await repo.update("subscriptions", sub.id, {
        price: round2((Number(sub.price) || 0) + input.monthlyDelta), pendingChange: null,
      });
      if (mirrorPrice) {
        try { await mirrorPrice(sub, subscription); }
        catch (err) { log?.warn?.({ sub: sub.id, err: err.message }, "upsell: MP não atualizou o valor do preapproval"); }
      }
      await syncCustomerArr(repo, customer.id);
    } else {
      await repo.update("customers", customer.id, { arr: Math.round((Number(customer.arr) || 0) + input.monthlyDelta * 12) });
    }
  }

  // 3. Registro do upsell no cliente (último, pra ficha/lista mostrarem sem
  // varrer faturas) + timeline do lead de origem.
  const saved = await repo.update("customers", customer.id, {
    lastUpsellAt: input.at, lastUpsellItem: input.item,
    upsellCount: (Number(customer.upsellCount) || 0) + 1,
  });
  const summary = upsellSummary(input);
  if (customer.leadId) {
    try {
      await logActivity(repo, {
        saas: customer.saas || "", lead: customer.leadId, type: "system",
        text: `Upsell registrado: ${summary}${input.note ? ` · ${input.note}` : ""}`,
        meta: { event: "customer_upsell", invoice: invoice?.id || "", mode: input.mode, payment: input.payment, amount: input.amount, monthlyDelta: input.monthlyDelta, soldBy },
        author, at: input.at,
      });
    } catch { /* timeline é registro, nunca quebra o upsell */ }
  }
  if (discord?.configured?.()) {
    try {
      const product = customer.saas ? await repo.get("products", customer.saas) : null;
      const seller = soldBy ? await repo.get("users", soldBy).catch(() => null) : null;
      await discord.customerUpsell({
        customer: saved, productName: product?.name || customer.saas, summary,
        soldByName: seller?.name || soldBy, mrr: (Number(saved.arr) || 0) / 12, url,
      });
    } catch (err) { log?.warn?.({ customer: customer.id, err: err.message }, "upsell: aviso Discord falhou"); }
  }
  return { invoice, url, customer: saved, subscription };
}
