// Disparos — campanhas de e-mail + WhatsApp pros leads qualificados. O CRUD da
// campanha (criar/listar/editar rascunho) usa o REST genérico da collection
// `campaigns`; aqui ficam só as AÇÕES que o genérico não cobre:
//   POST /api/campaigns/:id/mark  — marca um envio (WhatsApp/e-mail) feito pra um
//     lead: mescla o progresso no servidor (race-safe) e loga a activity na
//     timeline do lead (aparece no histórico como "disparo: <campanha>").
//   POST /api/campaigns/ai-copy   — sugere a copy do disparo por IA (mesma chave
//     OpenRouter/Anthropic do resto; degrada se não configurada).
// A rota entra no ROUTE_SCREENS (screens.js) sob a tela "disparos".
import { logActivity } from "./lead-flow.js";

const CHANNELS = new Set(["whatsapp", "email"]);

export function registerCampaignRoutes(app, repo, { anthropic } = {}) {
  // Marca um envio feito (fila assistida): o operador clicou pra abrir o
  // WhatsApp/Gmail do lead. Grava o progresso E loga o toque na timeline.
  app.post("/api/campaigns/:id/mark", async (req, reply) => {
    const camp = await repo.get("campaigns", req.params.id);
    if (!camp) return reply.code(404).send({ error: "campanha não encontrada" });
    const { leadId, channel } = req.body || {};
    if (!leadId || !CHANNELS.has(channel)) {
      return reply.code(400).send({ error: "informe leadId e channel (whatsapp|email)" });
    }
    const lead = await repo.get("leads", leadId);
    if (!lead) return reply.code(404).send({ error: "lead não encontrado" });

    const now = new Date().toISOString();
    // Merge no servidor pra não perder envios concorrentes de outro operador.
    const sent = { ...(camp.sent || {}) };
    sent[leadId] = { ...(sent[leadId] || {}), [channel]: now };
    const patch = { sent };
    if (camp.status === "draft") patch.status = "sending"; // 1º envio tira do rascunho
    const updated = await repo.update("campaigns", camp.id, patch);

    // Timeline-only: registra o toque no lead sem mexer na cadência/estágio (um
    // disparo em massa não deve promover etapa nem gastar tentativa da régua).
    await logActivity(repo, {
      saas: lead.saas || camp.saas || "",
      lead: leadId,
      type: channel,
      text: `disparo: ${camp.name || "campanha"}`,
      meta: { campaign: camp.id },
      author: req.authUser?.id || "",
      at: now,
    });
    return updated;
  });

  // Sugere a copy do disparo (assunto/corpo do e-mail e/ou texto do WhatsApp).
  // Não grava nada — o operador revisa antes de disparar.
  app.post("/api/campaigns/ai-copy", async (req, reply) => {
    if (!anthropic?.configured?.()) {
      return reply.code(400).send({ error: "IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor" });
    }
    const { channel = "whatsapp", objetivo = "", publico = "", productName = "" } = req.body || {};
    try {
      const r = await anthropic.suggestCampaignCopy({ channel, objetivo, publico, productName });
      return { subject: r.subject, body: r.body, whatsapp: r.whatsapp };
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });
}
