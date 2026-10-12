// Asaas — cliente REST (sem SDK, fetch injetável pra testar offline). Mesmo
// desenho do mp.js: single tenant, credenciais no env (ASAAS_API_KEY +
// ASAAS_WEBHOOK_TOKEN no Easypanel), valores em REAIS.
//
// O que o cockpit usa do Asaas:
//   · POST /v3/paymentLinks → link de pagamento avulso (o cliente escolhe
//     PIX/boleto/cartão no checkout do Asaas); externalReference carrega o id
//     do lead/fatura, como o external_reference do MP.
//   · GET /v3/payments → espelho (poller) · GET /v3/payments/:id (webhook)
//   · GET /v3/customers/:id → quem pagou (o pagamento só traz o id)
//   · webhook: o Asaas manda o token configurado no painel no header
//     `asaas-access-token`; sem token no env o webhook recusa (como o MP).

import { timingSafeEqual } from "node:crypto";

const PROD_BASE = "https://api.asaas.com/v3";
const SANDBOX_BASE = "https://api-sandbox.asaas.com/v3";

export function makeAsaas({ fetch: f = globalThis.fetch, apiKey, webhookToken, sandbox = false } = {}) {
  const base = sandbox ? SANDBOX_BASE : PROD_BASE;
  const configured = () => !!apiKey;

  async function request(method, path, payload) {
    if (!configured()) throw new Error("Asaas não configurado — defina ASAAS_API_KEY");
    const res = await f(`${base}${path}`, {
      method,
      headers: { access_token: apiKey, "content-type": "application/json", accept: "application/json", "user-agent": "cockpit-leverads" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    if (res.status >= 400) {
      const err = new Error(`Asaas API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    configured,
    hasWebhookToken: () => !!webhookToken,
    sandbox: () => !!sandbox,

    // Token do webhook (painel Asaas → Integrações → Webhooks → "Token de
    // autenticação"): chega no header asaas-access-token em todo evento.
    verifyWebhookToken(header) {
      if (!webhookToken) return false;
      const a = Buffer.from(String(header || ""));
      const b = Buffer.from(String(webhookToken));
      return a.length === b.length && timingSafeEqual(a, b);
    },

    // Link de pagamento avulso. billingType UNDEFINED = o cliente escolhe a
    // forma no checkout; chargeType INSTALLMENT libera parcelar até
    // maxInstallmentCount (DETACHED = à vista). dueDateLimitDays = quantos
    // dias o boleto/PIX gerado pelo link fica válido.
    createPaymentLink({ name, description, amount, externalReference, maxInstallments, successUrl, dueDateLimitDays = 7 }) {
      if (!(Number(amount) > 0)) throw new Error(`amount deve ser positivo, got ${amount}`);
      const n = Math.round(Number(maxInstallments) || 1);
      return request("POST", "/paymentLinks", {
        name: String(name || "Cobrança").slice(0, 120),
        ...(description ? { description: String(description).slice(0, 500) } : {}),
        billingType: "UNDEFINED",
        chargeType: n > 1 ? "INSTALLMENT" : "DETACHED",
        value: Math.round(Number(amount) * 100) / 100,
        dueDateLimitDays,
        ...(n > 1 ? { maxInstallmentCount: Math.min(n, 12) } : {}),
        ...(externalReference ? { externalReference: String(externalReference) } : {}),
        notificationEnabled: false,
        ...(successUrl && /^https:\/\//.test(successUrl) ? { callback: { successUrl, autoRedirect: true } } : {}),
      });
    },

    getPayment: (id) => request("GET", `/payments/${encodeURIComponent(id)}`),
    getCustomer: (id) => request("GET", `/customers/${encodeURIComponent(id)}`),

    // Busca paginada (limit máx 100). `createdSince`/`paidSince` são datas
    // YYYY-MM-DD; `installment` lista as parcelas de um parcelamento.
    listPayments({ createdSince, paidSince, installment, paymentLink, offset = 0, limit = 100 } = {}) {
      const q = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      if (createdSince) q.set("dateCreated[ge]", createdSince);
      if (paidSince) q.set("paymentDate[ge]", paidSince);
      if (installment) q.set("installment", installment);
      if (paymentLink) q.set("paymentLink", paymentLink);
      return request("GET", `/payments?${q.toString()}`);
    },
  };
}

// Singleton de produção (env). Testes usam makeAsaas com fetch mockado.
export const asaas = makeAsaas({
  apiKey: process.env.ASAAS_API_KEY || "",
  webhookToken: process.env.ASAAS_WEBHOOK_TOKEN || "",
  sandbox: /^(1|true|yes)$/i.test(String(process.env.ASAAS_SANDBOX || "")),
});
