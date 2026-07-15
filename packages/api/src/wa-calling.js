// WhatsApp Business Calling (Cloud API) — chamada de voz de SAÍDA pelo MESMO
// número do inbox. Aqui fica só o cliente da API (habilitar/status/permissão/
// iniciar/encerrar); a voz de verdade (WebRTC no navegador + sinalização) é o
// próximo passo. Fica em arquivo separado do inbox (whatsapp.js) de propósito.
//
// Pré-requisitos p/ habilitar: número na Cloud API + limite de mensagens ≥2000 +
// app assinado no field `calls` da WABA. Fora disso, o enable volta erro 138018.
const GRAPH = "https://graph.facebook.com/v23.0";

export function makeWaCalling({ fetch: f = globalThis.fetch, token = "", phoneNumberId = "", wabaId = "" } = {}) {
  const configured = () => !!(token && phoneNumberId);

  async function req(method, path, body) {
    if (!configured()) throw new Error("WhatsApp não configurado (WHATSAPP_TOKEN/PHONE_NUMBER_ID)");
    const res = await f(`${GRAPH}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (res.status >= 400 || data.error) {
      const err = new Error(`WhatsApp Calling -> ${res.status}: ${data.error?.message || text.slice(0, 300)}`);
      err.status = res.status; err.code = data.error?.code;
      throw err;
    }
    return data;
  }

  // Liga a chamada no número (POST settings). Idempotente. `code 138018` = falta
  // pré-requisito (limite <2000 ou app não assinado em `calls` na WABA).
  const enableCalling = () => req("POST", `${phoneNumberId}/settings`, { calling: { status: "ENABLED" } });
  const disableCalling = () => req("POST", `${phoneNumberId}/settings`, { calling: { status: "DISABLED" } });

  // Status atual da chamada no número.
  async function callingStatus() {
    const d = await req("GET", `${phoneNumberId}?fields=calling`);
    return { status: d.calling?.status || "UNKNOWN", raw: d.calling || null };
  }

  // Re-assina a WABA pra ela capturar o field `calls` (o snapshot pode ter sido
  // criado antes de marcar `calls`). Precisa do WABA_ID.
  async function resubscribeWaba() {
    if (!wabaId) throw new Error("WHATSAPP_WABA_ID não configurado");
    return req("POST", `${wabaId}/subscribed_apps`);
  }

  // Pede permissão de ligação ao lead (obrigatório antes de ligar). Interativo
  // (dentro da janela de 24h). Fora da janela usa template aprovado (Fase depois).
  function requestCallPermission(to, bodyText) {
    return req("POST", `${phoneNumberId}/messages`, {
      messaging_product: "whatsapp", recipient_type: "individual", to,
      type: "interactive",
      interactive: { type: "call_permission_request", action: { name: "call_permission_request" }, body: { text: String(bodyText || "Podemos te ligar?").slice(0, 1024) } },
    });
  }

  // Inicia a chamada de saída com a oferta SDP do navegador. Retorna o call id.
  async function initiateCall(to, sdpOffer) {
    const d = await req("POST", `${phoneNumberId}/calls`, {
      messaging_product: "whatsapp", to, action: "connect",
      session: { sdp_type: "offer", sdp: sdpOffer },
    });
    return { callId: d.calls?.[0]?.id || "" };
  }

  const terminateCall = (callId) => req("POST", `${phoneNumberId}/calls`, { messaging_product: "whatsapp", action: "terminate", call_id: callId });

  return { configured, enableCalling, disableCalling, callingStatus, resubscribeWaba, requestCallPermission, initiateCall, terminateCall };
}
