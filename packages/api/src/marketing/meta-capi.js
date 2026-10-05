// Meta Conversions API (CAPI) — eventos server-side de conversão. Espelha o
// "Lead" client-side do Pixel (form-page.js) e é deduplicado pela Meta via
// `event_id` compartilhado + `event_name` (janela de 48h). PII (email/phone) vai
// SHA-256; IP/UA/fbp/fbc seguem em claro, como a Meta exige.
//
// Mesmo padrão de factory do meta.js: single tenant, credencial via env, fetch
// injetável pra testar offline. No-op gracioso quando faltam credenciais
// (META_PIXEL_ID / META_CAPI_ACCESS_TOKEN), pra não quebrar o submit em dev.
//
// Token (META_CAPI_ACCESS_TOKEN) é segredo nível-senha: Events Manager → Pixel →
// Settings → Conversions API → Generate access token. NUNCA expor no frontend.
// Ref.: https://developers.facebook.com/docs/marketing-api/conversions-api

import { createHash } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v23.0";

const sha256 = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

// Normalização exigida pela Meta antes do hash. Vazio → undefined (campo some).
export const hashEmail = (email) => {
  const v = String(email || "").trim().toLowerCase();
  return v ? sha256(v) : undefined;
};
export const hashPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? sha256(digits) : undefined;
};
export const hashExternalId = (id) => {
  const v = String(id || "").trim();
  return v ? sha256(v) : undefined;
};

export function makeMetaCapi({
  fetch: f = globalThis.fetch,
  pixelId = "",
  accessToken = "",
  testEventCode = "",
} = {}) {
  // O pixel pode ser POR PRODUTO (product.metaPixelId) — o token de sistema é
  // um só e vale pra qualquer pixel que o system user acessa. `pixelOverride`
  // vazio/ausente cai no pixel do env (single-tenant legado). Sanitiza pra
  // dígitos igual à página pública (form-page.js): valor malformado degrada
  // pro pixel do env em AMBOS os lados, preservando o dedup por eventId.
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const configured = (pixelOverride) => !!(digits(pixelOverride) || pixelId) && !!accessToken;

  function buildUserData({ email, phone, externalId, fbp, fbc, clientIp, userAgent } = {}) {
    const u = {};
    const em = hashEmail(email);
    const ph = hashPhone(phone);
    const ext = hashExternalId(externalId);
    if (em) u.em = [em];
    if (ph) u.ph = [ph];
    if (ext) u.external_id = [ext];
    if (fbp) u.fbp = fbp;
    if (fbc) u.fbc = fbc;
    if (clientIp) u.client_ip_address = clientIp;
    if (userAgent) u.client_user_agent = userAgent;
    return u;
  }

  // Envia um evento ao CAPI. Lança em status >= 400. No-op (retorna {skipped})
  // quando faltam credenciais — o chamador trata como best-effort.
  async function sendEvent({
    eventName,
    eventId,
    eventSourceUrl,
    userData,
    customData,
    eventTime,
    actionSource = "website",
    pixelId: pixelOverride,
  }) {
    const pixel = digits(pixelOverride) || pixelId;
    if (!pixel || !accessToken) return { skipped: true };

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: eventTime || Math.floor(Date.now() / 1000),
          event_id: eventId,
          event_source_url: eventSourceUrl,
          action_source: actionSource,
          user_data: userData || {},
          custom_data: customData || {},
        },
      ],
    };
    if (testEventCode) payload.test_event_code = testEventCode;

    const url = `${GRAPH}/${pixel}/events?access_token=${encodeURIComponent(accessToken)}`;
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const msg = body.error?.message || text.slice(0, 300);
      const err = new Error(`Meta CAPI -> ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // Evento "Lead" do funil de formulário. external_id = lead.id; PII opcional
  // (o lead pode não ter email/phone). eventId deve casar com o Pixel client-side.
  async function sendLead({
    eventId,
    eventSourceUrl,
    leadId,
    email,
    phone,
    fbp,
    fbc,
    clientIp,
    userAgent,
    customData,
    pixelId: pixelOverride,
  }) {
    return sendEvent({
      eventName: "Lead",
      eventId,
      eventSourceUrl,
      userData: buildUserData({ email, phone, externalId: leadId, fbp, fbc, clientIp, userAgent }),
      customData,
      pixelId: pixelOverride,
    });
  }

  // Evento "Purchase" quando o lead FECHA (estágio de kind ganho). Devolve pra
  // Meta o sinal de fundo de funil com o VALOR do negócio — sem ele o algoritmo
  // otimiza pra lead barato, não pra lead que compra. action_source
  // system_generated: a conversão nasce no CRM, não numa página. eventId
  // determinístico (won:{leadId}) deduplica reenvios na janela da Meta.
  async function sendPurchase({
    eventId,
    leadId,
    email,
    phone,
    fbp,
    fbc,
    value = 0,
    currency = "BRL",
    pixelId: pixelOverride,
  }) {
    return sendEvent({
      eventName: "Purchase",
      eventId,
      actionSource: "system_generated",
      userData: buildUserData({ email, phone, externalId: leadId, fbp, fbc }),
      customData: { value: Math.round((Number(value) || 0) * 100) / 100, currency },
      pixelId: pixelOverride,
    });
  }

  return { configured, buildUserData, sendEvent, sendLead, sendPurchase };
}

// Singleton de produção (env). Testes usam makeMetaCapi com fetch mockado.
// META_PIXEL_ID tem o mesmo default usado na página pública (form-page.js).
export const metaCapi = makeMetaCapi({
  pixelId: process.env.META_PIXEL_ID || "971201888623790",
  accessToken: process.env.META_CAPI_ACCESS_TOKEN || "",
  testEventCode: process.env.META_TEST_EVENT_CODE || "",
});
