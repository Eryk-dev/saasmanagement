// Gateways de recebimento do cockpit (12/10/2026): além do Mercado Pago, a
// casa recolhe pagamento pelo Asaas e pelo Appmax. O ESPELHO é um só
// (collection mp_payments, nome histórico): cada doc carrega `gateway` e o
// `mpId` passa a ser "id do pagamento NO gateway". Toda régua de dinheiro
// (cashIn, conciliação, links, regras) lê o espelho sem saber de onde veio.
//
//   mp      Mercado Pago · link via checkout preference · espelho via poller
//           (/v1/payments/search) + webhook assinado
//   asaas   Asaas · link via POST /v3/paymentLinks · espelho via poller
//           (/v3/payments) + webhook com token (header asaas-access-token)
//   appmax  Appmax · link criado no painel da Appmax e COLADO no cockpit (a
//           API não cria link) · espelho SÓ pelo webhook (a API não lista
//           pedidos); token na URL do webhook, porque a Appmax não assina

export const GATEWAYS = { mp: "Mercado Pago", asaas: "Asaas", appmax: "Appmax" };
export const GATEWAY_IDS = Object.keys(GATEWAYS);
export const isGateway = (g) => Object.prototype.hasOwnProperty.call(GATEWAYS, String(g || ""));
export const gatewayOf = (doc) => (doc?.gateway && isGateway(doc.gateway) ? doc.gateway : "mp");
export const gatewayLabel = (g) => GATEWAYS[g] || GATEWAYS.mp;

// Id do doc no espelho: prefixo por gateway (o do MP é o histórico `mpp_`).
const PREFIX = { mp: "mpp_", asaas: "asa_", appmax: "apx_" };
export const mirrorIdOf = (gateway, id) => `${PREFIX[gateway] || PREFIX.mp}${id}`;

// Datas dos outros gateways chegam SEM fuso ("2026-10-12", "2026-10-12
// 14:30:00"): são horário de Brasília. Converter como UTC jogaria o dia pra
// véspera (meia-noite UTC = 21h em São Paulo) e o caixa cairia no mês errado.
export function brtToIso(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00-03:00`).toISOString();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return new Date(`${m[1]}T${m[2]}-03:00`).toISOString();
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

// Telefone no formato nacional (DDD + número), sem o 55 da frente: é o que
// casa o pagador de um gateway que manda telefone (Appmax, Asaas) com o
// cadastro do cliente/lead.
export function phoneKey(v) {
  let d = String(v || "").replace(/\D+/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d : "";
}
