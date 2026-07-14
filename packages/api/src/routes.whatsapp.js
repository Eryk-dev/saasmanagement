// WhatsApp no cockpit (Cloud API): webhook (verificação + recebimento), inbox de
// conversas (tela dedicada) e envio. As mensagens vivem em wa_threads/wa_messages
// (ver wa-store.js) — canônico pro inbox e pro chat do drawer.
import { makeWhatsapp } from "./whatsapp.js";
import { recordMessage, updateStatus, listThreads, listMessages, markThreadRead, threadId } from "./wa-store.js";

// Texto legível pra tipos que a Fase 1 ainda não renderiza (mídia/áudio).
function bodyOf(m) {
  if (m.text?.body) return m.text.body;
  if (m.type === "image") return "📷 imagem";
  if (m.type === "audio" || m.type === "voice") return "🎤 áudio";
  if (m.type === "video") return "🎬 vídeo";
  if (m.type === "document") return "📎 documento" + (m.document?.filename ? ` · ${m.document.filename}` : "");
  if (m.type === "sticker") return "🀄 figurinha";
  if (m.type === "location") return "📍 localização";
  if (m.type === "button") return m.button?.text || "botão";
  if (m.type === "interactive") return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "resposta";
  return `[${m.type || "mensagem"}]`;
}

// Envia texto e grava a mensagem out (+ atualiza o thread). Lança em erro da Meta
// (o handler HTTP traduz a janela de 24h). `phone` = destino em qualquer formato.
async function sendAndRecord(repo, wa, { phone, text, author }) {
  const { messageId } = await wa.sendText(phone, text);
  await recordMessage(repo, { id: messageId, phone, direction: "out", text, status: "sent", author });
  return messageId;
}

function outsideWindow(err) { return err.code === 131047 || err.code === 470; }
function sendErrorReply(reply, err) {
  return reply.code(outsideWindow(err) ? 409 : 502).send({
    error: outsideWindow(err)
      ? "Fora da janela de 24h: a Meta só deixa reabrir a conversa com um template aprovado (Fase 2)."
      : String(err.message || err).slice(0, 300),
  });
}

export function registerWhatsappRoutes(app, repo, { whatsapp } = {}) {
  const wa = whatsapp || makeWhatsapp({
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  });

  // ── Webhook (rota ABERTA: a Meta chama sem key; sob /api/webhooks/) ──────────
  app.get("/api/webhooks/whatsapp", async (req, reply) => {
    const q = req.query || {};
    const ch = wa.verifyWebhook(q["hub.mode"], q["hub.verify_token"], q["hub.challenge"]);
    if (ch === null) return reply.code(403).send("forbidden");
    return reply.type("text/plain").send(ch);
  });

  app.post("/api/webhooks/whatsapp", async (req, reply) => {
    try {
      for (const e of req.body?.entry || []) {
        for (const ch of e.changes || []) {
          const v = ch.value || {};
          const contactName = v.contacts?.[0]?.profile?.name || "";
          for (const m of v.messages || []) {
            await recordMessage(repo, {
              id: m.id, phone: m.from, direction: "in", text: bodyOf(m),
              at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : undefined,
              from: m.from, status: "received", contactName,
            });
          }
          for (const st of v.statuses || []) {
            await updateStatus(repo, st.id, st.status, st.errors?.[0]?.title || "");
          }
        }
      }
    } catch (err) { req.log?.warn?.({ err: err.message }, "whatsapp webhook falhou"); }
    return reply.code(200).send({ ok: true }); // sempre 200: erro não faz a Meta re-tentar em loop
  });

  // ── Inbox (tela dedicada) ───────────────────────────────────────────────────
  app.get("/api/whatsapp/threads", async () => ({ threads: await listThreads(repo) }));

  app.get("/api/whatsapp/threads/:id", async (req) => ({
    messages: await listMessages(repo, req.params.id),
  }));

  app.post("/api/whatsapp/threads/:id/read", async (req) => {
    const lastIn = await markThreadRead(repo, req.params.id);
    if (lastIn && wa.configured()) wa.markRead(lastIn).catch(() => {});
    return { ok: true };
  });

  // Enviar pela conversa (inbox) — id é o número em dígitos, funciona com ou sem lead.
  app.post("/api/whatsapp/threads/:id/send", async (req, reply) => {
    if (!wa.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor" });
    const phone = threadId(req.params.id);
    const text = String(req.body?.text || "").trim();
    if (!phone) return reply.code(400).send({ error: "número inválido" });
    if (!text) return reply.code(400).send({ error: "mensagem vazia" });
    try {
      const messageId = await sendAndRecord(repo, wa, { phone, text, author: req.authUser?.id || "cockpit" });
      return { ok: true, messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  // Enviar pelo drawer do lead (resolve o telefone do lead).
  app.post("/api/leads/:id/whatsapp", async (req, reply) => {
    if (!wa.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN/PHONE_NUMBER_ID)" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const phone = lead.phone || req.body?.to || "";
    const text = String(req.body?.text || "").trim();
    if (!phone) return reply.code(400).send({ error: "lead sem telefone" });
    if (!text) return reply.code(400).send({ error: "mensagem vazia" });
    try {
      const messageId = await sendAndRecord(repo, wa, { phone, text, author: req.authUser?.id || "cockpit" });
      return { ok: true, messageId };
    } catch (err) { return sendErrorReply(reply, err); }
  });

  return wa;
}
