// Rotas da chamada de voz do WhatsApp (M1: habilitar + status). A voz em si
// (WebRTC) vem depois; aqui é só ligar a capacidade no número, sem terminal.
import { makeWaCalling } from "./wa-calling.js";

export function registerWaCallingRoutes(app, repo, { waCalling } = {}) {
  const wc = waCalling || makeWaCalling({
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    wabaId: process.env.WHATSAPP_WABA_ID || "",
  });

  // Status da chamada no número.
  app.get("/api/whatsapp/calling/status", async () => {
    if (!wc.configured()) return { configured: false, status: "OFF" };
    try {
      const s = await wc.callingStatus();
      return { configured: true, status: s.status };
    } catch (err) {
      return { configured: true, status: "UNKNOWN", error: String(err.message || err).slice(0, 200) };
    }
  });

  // Habilita a chamada (botão, sem terminal). Se der 138018 (pré-requisito) e
  // houver WABA_ID, re-assina a WABA pra capturar o field `calls` e tenta de novo.
  app.post("/api/whatsapp/calling/enable", async (req, reply) => {
    if (!wc.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    try {
      await wc.enableCalling();
      return { ok: true, status: "ENABLED" };
    } catch (err) {
      if (err.code === 138018) {
        try {
          await wc.resubscribeWaba();
          await wc.enableCalling();
          return { ok: true, status: "ENABLED", note: "re-assinei a WABA no campo calls" };
        } catch (err2) {
          return reply.code(409).send({
            error: err2.code === 138018
              ? "Pré-requisito não atendido: confira limite de mensagens ≥2000 e o app assinado no campo `calls`."
              : String(err2.message || err2).slice(0, 300),
            code: err2.code || 138018,
          });
        }
      }
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300), code: err.code });
    }
  });

  return wc;
}
