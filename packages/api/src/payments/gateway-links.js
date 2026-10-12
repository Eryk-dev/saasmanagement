// Link de pagamento POR GATEWAY — a porta única que os três lugares que geram
// link (card do lead, ficha do cliente, tela Links) usam:
//   mp      checkout preference do Mercado Pago (external_reference = lead/fatura)
//   asaas   payment link do Asaas (externalReference = lead/fatura)
//   appmax  a API não cria link: o closer COLA o link do painel da Appmax; o
//           pagamento casa depois pelo e-mail/telefone do pagador (webhook).
// Devolve { gateway, id, url } no mesmo formato pra todo mundo.

import { createPreferenceWith, mpUrls } from "./mp-charges.js";
import { GATEWAYS, isGateway, gatewayLabel } from "./gateways.js";

export class GatewayError extends Error {
  constructor(message, { notConfigured = false, invalid = false, detail = "" } = {}) {
    super(message);
    this.notConfigured = notConfigured;
    this.invalid = invalid;
    this.detail = detail;
  }
}

// Gateway pedido no body (default mp). Fora da lista = erro de validação.
export function pickGateway(body) {
  const g = String(body?.gateway || "mp").trim().toLowerCase();
  if (!isGateway(g)) throw new GatewayError(`gateway inválido: use ${Object.keys(GATEWAYS).join(", ")}`, { invalid: true });
  return g;
}

export const gatewayConfigured = ({ mp, asaas, appmax }, gateway) =>
  gateway === "mp" ? !!mp?.configured?.() : gateway === "asaas" ? !!asaas?.configured?.() : gateway === "appmax" ? !!appmax?.configured?.() : false;

const NOT_CONFIGURED_MSG = {
  mp: "Mercado Pago não configurado (MERCADOPAGO_ACCESS_TOKEN)",
  asaas: "Asaas não configurado (ASAAS_API_KEY)",
  appmax: "Appmax não configurado (APPMAX_WEBHOOK_TOKEN)",
};

export async function createGatewayLink({ gateway, mp, asaas, appmax, req, log }, { title, description, amount, externalReference, payerEmail, maxInstallments, url } = {}) {
  if (!gatewayConfigured({ mp, asaas, appmax }, gateway)) {
    throw new GatewayError(NOT_CONFIGURED_MSG[gateway] || "gateway não configurado", { notConfigured: true });
  }
  if (gateway === "mp") {
    const pref = await createPreferenceWith(mp, {
      title, description, amount, externalReference, payerEmail,
      ...mpUrls(req),
      maxInstallments: Number(maxInstallments) || undefined,
    }, log);
    return { gateway, id: String(pref.id || ""), url: pref.init_point || "" };
  }
  if (gateway === "asaas") {
    const link = await asaas.createPaymentLink({
      name: title, description, amount, externalReference,
      maxInstallments: Number(maxInstallments) || 1,
      successUrl: mpUrls(req).backUrl,
    });
    return { gateway, id: String(link.id || ""), url: link.url || "" };
  }
  // appmax: link colado do painel.
  const pasted = String(url || "").trim();
  if (!/^https:\/\/\S+$/i.test(pasted)) {
    throw new GatewayError("cole o link de pagamento criado no painel da Appmax (https://…)", { invalid: true });
  }
  return { gateway, id: "", url: pasted };
}

// Mensagem de erro pro closer quando o gateway recusa.
export const refusedMessage = (gateway) => `${gateway === "mp" ? "MP" : gatewayLabel(gateway)} recusou a criação do link`;
