// Cobranças no Mercado Pago a partir do cockpit: link de pagamento avulso do
// cliente (preferência), espelho do status da assinatura no preapproval e o
// e-mail do pagador, que só pré-preenche o checkout.

import { recordPaymentLink } from "./payment-links.js";
import { baseUrl } from "../marketing/disparos-util.js";

// ── E-mail do pagador: conveniência, nunca requisito ────────────────────────
// `payer.email` só PRÉ-PREENCHE o checkout. Mas o campo de e-mail do lead nem
// sempre é um e-mail (form com resposta livre, "não tenho", telefone digitado
// no lugar), e o Mercado Pago recusa a preferência INTEIRA quando ele não
// presta. O closer via "MP recusou a criação do link" no meio da venda, sem
// motivo na tela, e ficava sem cobrar. Duas defesas: só mandar o que parece
// e-mail, e, se o MP recusar mesmo assim, tentar de novo SEM ele.
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());

export const payerEmailOrNone = (v) => (looksLikeEmail(v) ? String(v).trim().toLowerCase() : undefined);

// Espelha mudança de status do Cockpit no preapproval (best-effort, fail-open):
// cancelar/pausar/reativar a assinatura aqui não pode deixar o MP cobrando.
export async function mirrorSubscriptionToMp(mpClient, before, updated, log) {
  if (!mpClient?.configured() || !updated?.mpPreapprovalId) return;
  if (!before || before.status === updated.status) return;
  try {
    if (updated.status === "canceled") await mpClient.cancelPreapproval(updated.mpPreapprovalId);
    else if (updated.status === "paused") await mpClient.pausePreapproval(updated.mpPreapprovalId);
    else if (updated.status === "active" && before.status === "paused") await mpClient.resumePreapproval(updated.mpPreapprovalId);
  } catch (err) {
    log?.warn({ sub: updated.id, err: err.message }, "MP: falha ao espelhar status no preapproval");
  }
}

// Cria a preferência de checkout e, se o MP recusar COM e-mail do pagador,
// tenta de novo sem ele. Link sem pré-preenchimento é melhor que venda
// travada; o cliente digita o e-mail no próprio checkout.
export async function createPreferenceWith(mp, args, log) {
  try {
    return await mp.createCheckoutPreference(args);
  } catch (err) {
    if (!args.payerEmail) throw err;
    log?.warn?.({ err: err.message }, "MP recusou com payer.email — tentando sem o e-mail do pagador");
    return await mp.createCheckoutPreference({ ...args, payerEmail: undefined });
  }
}

// Cobrança avulsa anexada ao cliente: fatura (registro no billing) + link de
// pagamento (checkout preference) com external_reference = id da fatura — o
// webhook/poller dá a baixa sozinho quando o cliente pagar. Serve o botão
// "+ cobrança" da ficha e o registro de upsell com link (routes.billing.js).
// `extra` = campos a mais carimbados na fatura (upsell: quem vendeu, modo…).
// Falha no MP remove a fatura (não fica órfã) e propaga o erro.
export async function createCustomerCharge(repo, mp, req, customer, { amount, title, kind, dueDate, maxInstallments, origin, extra = {} } = {}) {
  const product = customer.saas ? await repo.get("products", customer.saas) : null;
  const finalTitle = String(title || "").trim()
    || [product?.name || customer.saas, kind === "upsell" ? "upsell" : "cobrança"].filter(Boolean).join(" · ");
  const nowIso = new Date().toISOString();
  const invoice = await repo.create("invoices", {
    customer: customer.id, saas: customer.saas || "", amount,
    kind: kind === "upsell" ? "upsell" : "manual", status: "open",
    title: finalTitle, dueDate: dueDate || nowIso, createdAt: nowIso, ...extra,
  });
  try {
    const pref = await createPreferenceWith(mp, {
      title: finalTitle, amount, externalReference: invoice.id,
      payerEmail: payerEmailOrNone(customer.email),
      ...mpUrls(req),
      maxInstallments: Number(maxInstallments) || undefined,
    }, req.log);
    const updated = await repo.update("invoices", invoice.id, { mpPrefId: pref.id, mpInitPoint: pref.init_point || null });
    await recordPaymentLink(repo, {
      saas: customer.saas || "", kind: "customer", origin: origin || "cliente",
      customer: customer.id, invoice: invoice.id,
      targetName: customer.name || "", targetPhone: customer.phone || "",
      amount, title: finalTitle, url: pref.init_point || "", prefId: pref.id || "",
      payerEmail: customer.email || "", reference: invoice.id,
      createdBy: req.authUser?.id || "",
    }, { log: req.log });
    return { invoice: updated, url: pref.init_point || null };
  } catch (err) {
    await repo.remove("invoices", invoice.id); // fatura sem link não fica órfã
    throw err;
  }
}

// URLs públicas dos links do MP, POR REQUEST: COCKPIT_PUBLIC_URL > host da
// request (x-forwarded-*) > localhost — a mesma cadeia do publicBase
// (platform/request.js), via baseUrl, que nasceu fora dele quando o publicBase morava em routes.js.
// Era uma constante só da env: deploy sem COCKPIT_PUBLIC_URL mandava back_url
// "http://localhost:8787" e o /preapproval recusava a assinatura recorrente
// inteira ("Invalid value for back_url" — ali o MP exige URL https válida; o
// checkout avulso engole). Env sem esquema ganha https:// pelo mesmo motivo.
// notification_url só vale com base pública https (MP recusa localhost).
export function mpUrls(req) {
  const base = baseUrl(req).trim();
  const backUrl = /^https?:\/\//.test(base) ? base : `https://${base}`;
  return {
    backUrl,
    notificationUrl: backUrl.startsWith("https://") ? `${backUrl}/public/mp/webhook` : undefined,
  };
}
