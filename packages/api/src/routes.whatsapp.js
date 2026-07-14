// WhatsApp no cockpit (Cloud API): webhook (verificação + recebimento) e envio.
// As mensagens (entrada e saída) viram activities `whatsapp` na timeline do lead
// (meta.direction in|out, waMessageId, status) — o drawer renderiza como chat.
// Mensagem de número sem lead cai em `wa_messages` (fila do inbox global, Fase 2).
import { makeWhatsapp, digits } from "./whatsapp.js";
import { logActivity } from "./lead-flow.js";

// Placeholder de texto pra tipos que a Fase 1 ainda não renderiza (mídia/áudio).
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

async function findLeadByPhone(repo, phone) {
  const d = digits(phone);
  if (!d) return null;
  const leads = await repo.list("leads");
  return leads.find((l) => l.phone && digits(l.phone) === d) || null;
}

// Recebe uma mensagem: casa com o lead (por telefone) e loga na timeline;
// sem lead, guarda em wa_messages. Dedup por waMessageId. Best-effort.
async function handleIncoming(repo, m, value) {
  const from = m.from;
  const waId = m.id;
  const text = bodyOf(m);
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
  const lead = await findLeadByPhone(repo, from);
  if (lead) {
    const acts = await repo.list("activities");
    if (acts.some((a) => a.lead === lead.id && a.meta?.waMessageId === waId)) return; // dedup (Meta re-entrega)
    await logActivity(repo, { saas: lead.saas || "", lead: lead.id, type: "whatsapp", text, at, author: "lead", meta: { direction: "in", waMessageId: waId, from } });
    await repo.update("leads", lead.id, { lastActivityAt: at, lastActivityType: "whatsapp" });
  } else if (!(await repo.get("wa_messages", waId))) {
    await repo.create("wa_messages", { id: waId, from, text, at, direction: "in", name: value.contacts?.[0]?.profile?.name || "" });
  }
}

// Status de mensagem enviada (sent/delivered/read/failed) → atualiza a activity.
async function handleStatus(repo, st) {
  if (!st.id) return;
  const acts = await repo.list("activities");
  const a = acts.find((x) => x.meta?.waMessageId === st.id);
  if (a) await repo.update("activities", a.id, { meta: { ...(a.meta || {}), status: st.status, ...(st.status === "failed" && st.errors?.[0] ? { error: st.errors[0].title || st.errors[0].message } : {}) } });
}

export function registerWhatsappRoutes(app, repo, { whatsapp } = {}) {
  const wa = whatsapp || makeWhatsapp({
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  });

  // Webhook — rota ABERTA (a Meta chama sem key; está sob /api/webhooks/, já em
  // OPEN_PREFIXES). GET = verificação do webhook; POST = eventos.
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
          for (const m of v.messages || []) await handleIncoming(repo, m, v);
          for (const st of v.statuses || []) await handleStatus(repo, st);
        }
      }
    } catch (err) { req.log?.warn?.({ err: err.message }, "whatsapp webhook falhou"); }
    return reply.code(200).send({ ok: true }); // sempre 200: erro não faz a Meta re-tentar em loop
  });

  // Enviar mensagem pro lead (SDR no drawer). Loga como activity `whatsapp` out.
  app.post("/api/leads/:id/whatsapp", async (req, reply) => {
    if (!wa.configured()) return reply.code(503).send({ error: "WhatsApp não configurado no servidor (WHATSAPP_TOKEN/PHONE_NUMBER_ID)" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const to = lead.phone || req.body?.to || "";
    const text = String(req.body?.text || "").trim();
    if (!to) return reply.code(400).send({ error: "lead sem telefone" });
    if (!text) return reply.code(400).send({ error: "mensagem vazia" });
    try {
      const { messageId } = await wa.sendText(to, text);
      const act = await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "whatsapp", text, author: req.authUser?.id || "cockpit",
        meta: { direction: "out", waMessageId: messageId, status: "sent" },
      });
      await repo.update("leads", lead.id, { lastActivityAt: new Date().toISOString(), lastActivityType: "whatsapp" });
      return { ok: true, activity: act, messageId };
    } catch (err) {
      // 131047/470 = fora da janela de 24h (precisa de template aprovado — Fase 2).
      const outside = err.code === 131047 || err.code === 470;
      return reply.code(502).send({ error: outside ? "Fora da janela de 24h: a Meta só deixa reabrir a conversa com um template aprovado (Fase 2)." : String(err.message || err).slice(0, 300) });
    }
  });

  return wa;
}
