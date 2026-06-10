// Mercado Pago (fase 4 · billing) — port de copylever/app/services/mp_api.py.
// REST direto (sem SDK), fetch nativo. Single tenant: credenciais via env
// (MERCADOPAGO_ACCESS_TOKEN + MERCADOPAGO_WEBHOOK_SECRET no Easypanel) — nada
// de segredo em JSONB. Factory com fetch injetável pra testar offline.
//
// Valores: o Cockpit guarda preço em REAIS (transaction_amount do MP também é
// em reais) — sem conversão de centavos aqui.

import { createHmac, timingSafeEqual } from "node:crypto";

const API_BASE = "https://api.mercadopago.com";
const SUB_CURRENCY = "BRL"; // MP brasileiro só opera em BRL

export function makeMp({ fetch: f = globalThis.fetch, accessToken, webhookSecret } = {}) {
  const configured = () => !!accessToken;

  async function request(method, path, payload, { idempotencyKey } = {}) {
    if (!configured()) throw new Error("Mercado Pago não configurado — defina MERCADOPAGO_ACCESS_TOKEN");
    const headers = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    };
    // Deduplica POST /v1/payments em retry (evita double-charge).
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    const res = await f(`${API_BASE}${path}`, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    if (res.status >= 400) {
      const err = new Error(`MP API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    configured,

    // Preapproval = assinatura recorrente. Sem card token (v1): status pending +
    // init_point — o cliente autoriza na página do MP. external_reference carrega
    // o id da assinatura do Cockpit pro webhook mapear de volta.
    createPreapproval({ payerEmail, externalReference, backUrl, amount, frequencyMonths, reason }) {
      if (!(Number(amount) > 0)) throw new Error(`amount deve ser positivo, got ${amount}`);
      if (![1, 3, 6, 12].includes(frequencyMonths)) throw new Error(`frequencyMonths inválido: ${frequencyMonths}`);
      return request("POST", "/preapproval", {
        reason,
        auto_recurring: {
          frequency: frequencyMonths,
          frequency_type: "months",
          transaction_amount: Math.round(Number(amount) * 100) / 100,
          currency_id: SUB_CURRENCY,
        },
        payer_email: payerEmail,
        external_reference: externalReference,
        back_url: backUrl,
        status: "pending",
      });
    },

    getPreapproval: (id) => request("GET", `/preapproval/${id}`),
    cancelPreapproval: (id) => request("PUT", `/preapproval/${id}`, { status: "cancelled" }),
    pausePreapproval: (id) => request("PUT", `/preapproval/${id}`, { status: "paused" }),
    resumePreapproval: (id) => request("PUT", `/preapproval/${id}`, { status: "authorized" }),

    // PUT só do valor — MP mantém cartão e ciclo; próxima cobrança sai no valor
    // novo na data original (substitui cancel+recreate; padrão copylever).
    updatePreapprovalAmount: (id, amount) => request("PUT", `/preapproval/${id}`, {
      auto_recurring: {
        transaction_amount: Math.round(Number(amount) * 100) / 100,
        currency_id: SUB_CURRENCY,
      },
    }),

    getPayment: (id) => request("GET", `/v1/payments/${id}`),
    getAuthorizedPayment: (id) => request("GET", `/authorized_payments/${id}`),
    refundPayment: (id, { amount } = {}) =>
      request("POST", `/v1/payments/${id}/refunds`, amount == null ? {} : { amount: Math.round(Number(amount) * 100) / 100 }),

    // Webhook v2: header `x-signature: ts=...,v1=hex`; manifest assinado é
    // `id:DATA_ID;request-id:REQUEST_ID;ts:TS;` com HMAC-SHA256 do secret.
    verifyWebhookSignature(xSignature, xRequestId, dataId) {
      if (!webhookSecret) return false;
      try {
        const parts = Object.fromEntries(
          String(xSignature || "").split(",").map((p) => p.trim().split(/=(.*)/s).slice(0, 2))
        );
        const ts = parts.ts || "";
        const v1 = parts.v1 || "";
        if (!ts || !v1) return false;
        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
        const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(v1);
        return a.length === b.length && timingSafeEqual(a, b);
      } catch {
        return false;
      }
    },

    hasWebhookSecret: () => !!webhookSecret,
  };
}

// MP envia 2 formatos conforme a configuração do painel:
//   v2 (Webhooks): {"type":"subscription_preapproval","data":{"id":"..."}}
//   v1 (IPN):      {"topic":"preapproval","id":"..."}
// Normaliza pra { topic, dataId }.
export function parseWebhookPayload(body) {
  const b = body && typeof body === "object" ? body : {};
  const topic = b.type || b.topic || "";
  const dataId = (b.data && b.data.id) || b.id || "";
  return { topic: String(topic), dataId: String(dataId) };
}

// Singleton de produção (env). Testes usam makeMp com fetch mockado.
export const mp = makeMp({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
  webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || "",
});
