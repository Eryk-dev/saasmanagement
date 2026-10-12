// Appmax — só WEBHOOK. A API da Appmax não lista pedidos nem cria link de
// pagamento (o link nasce no painel deles e é COLADO no cockpit, gateway-
// links.js). O espelho enche pelos eventos do painel (Configurações → Apphooks
// / Integrações → Webhooks, modelo padrão): OrderApproved, OrderPaid,
// OrderPaidByPix, OrderRefund, PaymentNotAuthorized…
//
// A Appmax NÃO assina o webhook (sem HMAC, sem header): a defesa é um token na
// URL (/public/appmax/webhook?token=…) que só o painel deles conhece. Sem
// APPMAX_WEBHOOK_TOKEN no env, o webhook recusa tudo.
//
// Dois formatos chegam, conforme a geração do painel:
//   legado  {"environment":"production","event":"OrderApproved","data":{"id":…,
//            "status":"aprovado","total":…,"customer":{firstname,lastname,email,
//            CPF,telephone},"payment_type":"CreditCard","installments":…,
//            "created_at":"2026-10-12 14:28:00","paid_at":…,"bundles":[…]}}
//   novo    {"event":"order_approved","event_type":"order","data":{"order_id":…,
//            "status":"aprovado","total":…,"merchant_total":…,"paid_at":…,
//            "products":[…],"payment_info":{"credit_card":{"installments":3}}}}
// O parser aceita os dois e devolve o doc no dialeto do espelho.

import { timingSafeEqual } from "node:crypto";
import { brtToIso, phoneKey } from "./gateways.js";
import { MP_CLASS_V } from "./mp-classify.js";

export function makeAppmax({ webhookToken } = {}) {
  return {
    configured: () => !!webhookToken,
    verifyToken(token) {
      if (!webhookToken) return false;
      const a = Buffer.from(String(token || ""));
      const b = Buffer.from(String(webhookToken));
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}

export const appmax = makeAppmax({ webhookToken: process.env.APPMAX_WEBHOOK_TOKEN || "" });

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, "");

// Evento → status no vocabulário do espelho (o do MP). Evento desconhecido
// cai no status do pedido.
const EVENT_STATUS = {
  orderapproved: "approved", orderpaid: "approved", orderpaidbypix: "approved",
  orderintegrated: "approved", orderpendingintegration: "approved", paymentauthorizedwithdelay: "approved",
  orderauthorized: "pending", orderbilletcreated: "pending", orderpixcreated: "pending",
  orderbilletoverdue: "pending", orderpixexpired: "pending", orderupsoldpending: "pending",
  orderrefund: "refunded", orderrefunded: "refunded",
  orderpartialrefund: "approved", // estorno parcial: o grosso ficou; a nota vai no statusDetail
  paymentnotauthorized: "rejected", orderdeclined: "rejected",
  chargebackdispute: "charged_back", chargebacklost: "charged_back", chargebackwon: "approved",
  ordercanceled: "cancelled", ordercancelled: "cancelled",
};
const STATUS_WORD = [
  [/aprovad|pago|integrad|autorizado com atraso/, "approved"],
  [/chargeback/, "charged_back"],
  [/estorn|reembols/, "refunded"],
  [/cancelad/, "cancelled"],
  [/n[aã]o autorizad|recusad|negad/, "rejected"],
  [/autorizad|pendente|aguardand|an[aá]lise/, "pending"],
];
function statusOf(event, status) {
  const byEvent = EVENT_STATUS[key(event)];
  if (byEvent) return byEvent;
  const s = String(status || "").toLowerCase();
  for (const [re, v] of STATUS_WORD) if (re.test(s)) return v;
  return "pending";
}

// Forma de pagamento no dialeto do MP (method/methodType), pro mpMethodLabel
// da UI e pras bases de custo (cartão) funcionarem iguais.
function methodOf(data) {
  const info = data.payment_info && typeof data.payment_info === "object" ? data.payment_info : {};
  const raw = key(data.payment_type || data.payment_method || Object.keys(info)[0] || "");
  if (/pix/.test(raw)) return { method: "pix", methodType: "bank_transfer" };
  if (/boleto|billet/.test(raw)) return { method: "boleto", methodType: "ticket" };
  if (/debit/.test(raw)) return { method: "debit_card", methodType: "debit_card" };
  if (/credit|card|cartao/.test(raw)) {
    const brand = String(info.credit_card?.card_brand || data.card_brand || "").toLowerCase();
    return { method: brand || "credit_card", methodType: "credit_card" };
  }
  return { method: raw, methodType: "" };
}

const str = (v) => String(v ?? "").trim();

// Body do webhook → doc do espelho (null quando não é evento de pedido).
export function parseAppmaxEvent(body) {
  const b = body && typeof body === "object" ? body : {};
  const data = b.data && typeof b.data === "object" ? b.data : null;
  const event = str(b.event || b.type);
  if (!data) return null;
  const order = data.order && typeof data.order === "object" ? data.order : data;
  const id = order.id ?? order.order_id ?? data.order_id ?? data.id;
  if (id == null || id === "") return null;
  const status = statusOf(event, order.status ?? data.status);
  const total = Number(order.total ?? order.amount ?? data.total ?? 0) || 0;
  const net = Number(order.merchant_total ?? data.merchant_total ?? 0) || 0;
  const c = (order.customer && typeof order.customer === "object" ? order.customer : data.customer && typeof data.customer === "object" ? data.customer : {}) || {};
  const info = order.payment_info && typeof order.payment_info === "object" ? order.payment_info : {};
  const installments = Number(order.installments ?? info.credit_card?.installments ?? data.installments ?? 1) || 1;
  const items = []
    .concat(Array.isArray(order.products) ? order.products : [])
    .concat(Array.isArray(order.bundles) ? order.bundles.flatMap((bd) => (Array.isArray(bd.products) ? bd.products : [{ name: bd.name }])) : [])
    .map((p) => str(p?.name)).filter(Boolean);
  const paidAt = order.paid_at ?? data.paid_at ?? "";
  const createdAt = order.created_at ?? data.created_at ?? "";
  const doc = String(c.CPF ?? c.cpf ?? c.CNPJ ?? c.cnpj ?? c.document_number ?? c.document ?? "").replace(/\D+/g, "");
  return {
    gateway: "appmax",
    mpId: String(id),
    status,
    statusDetail: event || str(order.status ?? data.status),
    amount: Math.round(total * 100) / 100,
    netAmount: net > 0 ? Math.round(net * 100) / 100 : 0,
    ...methodOf(order),
    installments,
    payerEmail: str(c.email).toLowerCase(),
    payerName: [str(c.firstname ?? c.first_name ?? c.name), str(c.lastname ?? c.last_name)].filter(Boolean).join(" "),
    payerDoc: doc,
    payerPhone: phoneKey(c.telephone ?? c.phone ?? c.mobile ?? ""),
    payerBank: "",
    description: items.join(" + ").slice(0, 200) || `Pedido Appmax ${id}`,
    externalReference: str(order.external_reference ?? data.external_reference ?? data.external_key ?? ""),
    dateCreated: brtToIso(createdAt) || new Date().toISOString(),
    dateApproved: status === "approved" ? (brtToIso(paidAt) || brtToIso(createdAt) || new Date().toISOString()) : "",
    operationType: "", collectorId: "", payerId: c.id != null ? String(c.id) : "", posId: "",
    feeAmount: net > 0 && total > net ? Math.round((total - net) * 100) / 100 : 0,
    kind: "venda", direction: "in", kindSource: "api", classV: MP_CLASS_V,
  };
}
