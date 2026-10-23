// Disparos — campanhas de e-mail + WhatsApp pros leads qualificados. O CRUD da
// campanha (criar/listar/editar rascunho) usa o REST genérico da collection
// `campaigns`; aqui ficam só as AÇÕES que o genérico não cobre:
//   POST /api/campaigns/:id/mark        — marca um envio ASSISTIDO (WhatsApp /
//     rascunho de e-mail): mescla o progresso (race-safe) e loga o toque.
//   POST /api/campaigns/:id/send-email  — ENVIO NATIVO em massa pela conta Google
//     conectada (mailer): interpola por lead, respeita opt-out, loga o toque.
//   GET  /api/campaigns/metrics/:saas   — métricas de CONVERSÃO no funil por
//     campanha (avançou etapa / marcou call / fechou depois do disparo).
//   POST /api/campaigns/ai-copy         — sugere a copy do disparo por IA.
//   GET  /u/:token                      — descadastro público (opt-out de e-mail).
// As rotas /api/campaigns/* entram no ROUTE_SCREENS (screens.js) sob "disparos".
import { enqueueWaBroadcast, hasWhatsappChannel, reconcileBroadcastDelivery, waBroadcastProgress } from "./broadcast-wa.js";
import { enqueueEmailBroadcast } from "./broadcast-email.js";
import { resolveWabaId } from "../whatsapp/wa-health.js";
import { logActivity } from "../crm/lead-flow.js";
import { ladderOf, isWon, kindOf } from "../crm/stages.js";
import { unsubSig, unsubToken, baseUrl, leadTokens, interpolate, emailBodyWithUnsub } from "./disparos-util.js";
import { UPSTREAM_FAILED, NOT_CONFIGURED } from "../platform/http-status.js";

const CHANNELS = new Set(["whatsapp", "email"]);
const DAY = 86_400_000;
const ATTR_WINDOW = 30 * DAY; // janela de atribuição do disparo → conversão

const unsubPage = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Descadastro</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 24px;text-align:center;color:#111"><h2 style="font-weight:600">${msg}</h2><p style="color:#666">LeverAds</p></body>`;

export function registerCampaignRoutes(app, repo, { anthropic, mailer, whatsapp = () => null } = {}) {
  // ── Broadcast de WhatsApp pela API oficial (broadcast-wa.js) ──────────────
  // `whatsapp` é lido na hora: o domínio whatsapp registra depois deste.
  // Enfileira os leads; o runner do servidor envia em lotes.
  app.post("/api/campaigns/:id/send-whatsapp", async (req, reply) => {
    const camp = await repo.get("campaigns", req.params.id);
    if (!camp) return reply.code(404).send({ error: "broadcast não encontrado" });
    if (!hasWhatsappChannel(camp)) return reply.code(400).send({ error: "este broadcast não é de WhatsApp" });
    const wa = whatsapp();
    if (!wa?.configured?.()) return reply.code(NOT_CONFIGURED).send({ error: "WhatsApp não configurado no servidor" });
    const leadIds = req.body?.leadIds;
    if (!Array.isArray(leadIds) || !leadIds.length) return reply.code(400).send({ error: "informe leadIds (lista)" });
    // O modelo precisa estar aprovado AGORA (pode ter sido pausado/rejeitado depois de escolhido).
    try {
      const wabaId = await resolveWabaId(repo, wa);
      const tpl = camp.wa?.template;
      if (wabaId && tpl?.name) {
        const ok = (await wa.listTemplates(wabaId)).some((t) => t.name === tpl.name && (!tpl.language || t.language === tpl.language));
        if (!ok) return reply.code(400).send({ error: `o modelo "${tpl.name}" não está aprovado na Meta agora` });
      }
    } catch (err) {
      return reply.code(UPSTREAM_FAILED).send({ error: String(err.message || err).slice(0, 300) });
    }
    try {
      const out = await enqueueWaBroadcast(repo, camp, leadIds);
      return { ok: true, queued: out.queued, skipped: out.skipped, status: out.campaign.status };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post("/api/campaigns/:id/pause", async (req, reply) => {
    const camp = await repo.get("campaigns", req.params.id);
    if (!camp) return reply.code(404).send({ error: "broadcast não encontrado" });
    if (camp.status !== "sending") return reply.code(409).send({ error: "só pausa broadcast em envio" });
    return repo.update("campaigns", camp.id, { status: "paused", pauseReason: "pausado pelo time" });
  });

  app.post("/api/campaigns/:id/resume", async (req, reply) => {
    const camp = await repo.get("campaigns", req.params.id);
    if (!camp) return reply.code(404).send({ error: "broadcast não encontrado" });
    if (camp.status !== "paused") return reply.code(409).send({ error: "só retoma broadcast pausado" });
    // E-mail que falhou volta para a fila (a pausa por falha pede para corrigir o
    // provedor e retomar). WhatsApp que falhou não volta: costuma ser número ruim.
    const sent = Object.fromEntries(Object.entries(camp.sent || {}).map(([id, s]) => [id, s?.emailStatus === "failed" ? { ...s, emailStatus: "queued", emailError: "" } : s]));
    return repo.update("campaigns", camp.id, { status: "sending", pauseReason: "", sent });
  });

  app.get("/api/campaigns/:id/progress", async (req, reply) => {
    const found = await repo.get("campaigns", req.params.id);
    if (!found) return reply.code(404).send({ error: "broadcast não encontrado" });
    // Falha de entrega avisada depois do aceite entra no broadcast. O mapa por
    // lead volta em `byLead` (o `sent` da resposta é a contagem), para o editor
    // mostrar quem falhou e deixar reenviar.
    const camp = await reconcileBroadcastDelivery(repo, found);
    return { id: camp.id, status: camp.status || "draft", pauseReason: camp.pauseReason || "", ...(await waBroadcastProgress(repo, camp)), byLead: camp.sent || {} };
  });

  // Marca um envio ASSISTIDO feito (o operador clicou pra abrir o Whats/Gmail).
  // Grava o progresso E loga o toque na timeline.
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
      meta: { campaign: camp.id, stageAtSend: lead.stage || "" },
      author: req.authUser?.id || "",
      at: now,
    });
    return updated;
  });

  // Envio NATIVO de e-mail em massa pela conta Google conectada. Interpola por
  // lead, pula quem não tem e-mail ou descadastrou, adiciona link de descadastro
  // + header List-Unsubscribe, loga o toque e mescla o progresso. Falha parcial
  // é 200 com `results` por lead. 503 se o Google não tem o escopo de e-mail.
  app.post("/api/campaigns/:id/send-email", async (req, reply) => {
    const camp = await repo.get("campaigns", req.params.id);
    if (!camp) return reply.code(404).send({ error: "campanha não encontrada" });
    if (!mailer || !(await mailer.ready())) {
      return reply.code(NOT_CONFIGURED).send({ error: "Configure o e-mail em Configurações → Integrações (Resend, ou a conta Google do sistema com permissão de e-mail)." });
    }
    const { leadIds } = req.body || {};
    if (!Array.isArray(leadIds) || leadIds.length === 0) return reply.code(400).send({ error: "informe leadIds (lista)" });
    // Só enfileira: o runner do servidor (broadcast-email.js) manda em lotes.
    try {
      const out = await enqueueEmailBroadcast(repo, camp, leadIds, { by: req.authUser?.id || "" });
      return { ok: true, queued: out.queued, skipped: out.skipped, total: leadIds.length, status: out.campaign.status, sent: out.campaign.sent };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // Métricas de CONVERSÃO no funil por campanha do produto (o "o que deu certo"):
  // dos leads que receberam o disparo (camp.sent), quantos AVANÇARAM de etapa,
  // marcaram CALL ou FECHARAM numa janela de 30d DEPOIS do envio. Cruza o
  // instante do envio (camp.sent) com as activities type "stage" (meta.from/to).
  app.get("/api/campaigns/metrics/:saas", async (req, reply) => {
    const saas = req.params.saas;
    const product = await repo.get("products", saas);
    // Só as mudanças de etapa DESTE produto, filtradas no Postgres (índice
    // activities(saas,type)): a tabela inteira são 10 mil linhas / 7 MB por
    // abertura da tela, e só `stage` do produto interessa aqui.
    const [camps, acts] = await Promise.all([
      repo.list("campaigns").then((all) => all.filter((c) => c.saas === saas)),
      repo.listWhere("activities", { saas, type: "stage" }, { fields: ["lead", "type", "meta", "at"] }),
    ]);
    const stageByLead = new Map();
    for (const a of acts) {
      if (!a.lead) continue;
      if (!stageByLead.has(a.lead)) stageByLead.set(a.lead, []);
      stageByLead.get(a.lead).push(a);
    }
    const lad = product ? ladderOf(product) : [];
    const idx = (st) => lad.indexOf(st);
    const campaigns = camps.map((c) => {
      const sentMap = c.sent || {};
      let sent = 0, advanced = 0, booked = 0, won = 0;
      for (const id of Object.keys(sentMap)) {
        const s = sentMap[id] || {};
        const ts = [s.whatsapp, s.email].filter(Boolean).map((x) => new Date(x).getTime()).filter(Number.isFinite);
        if (!ts.length) continue;
        const at0 = Math.min(...ts);
        sent++;
        const moves = (stageByLead.get(id) || []).filter((a) => {
          const t = new Date(a.at).getTime();
          return Number.isFinite(t) && t > at0 && t <= at0 + ATTR_WINDOW;
        });
        if (moves.some((a) => idx(a.meta?.to) >= 0 && idx(a.meta?.to) > idx(a.meta?.from))) advanced++;
        if (product && moves.some((a) => kindOf(product, a.meta?.to) === "call")) booked++;
        if (product && moves.some((a) => isWon(product, a.meta?.to))) won++;
      }
      return { id: c.id, name: c.name || "", channels: c.channels || {}, status: c.status || "draft", sent, advanced, booked, won };
    });
    return { campaigns };
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
      return reply.code(UPSTREAM_FAILED).send({ error: e.message });
    }
  });

  // Descadastro público (link do rodapé + header List-Unsubscribe). Idempotente;
  // token inválido não vaza nada. Rota aberta (index.js OPEN_PREFIXES "/u/").
  app.get("/u/:token", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    const [leadId, sig] = String(req.params.token || "").split(".");
    if (!leadId || sig !== unsubSig(leadId)) return reply.code(400).send(unsubPage("Link inválido ou expirado."));
    const lead = await repo.get("leads", leadId);
    if (lead && !lead.emailOptOut) await repo.update("leads", leadId, { emailOptOut: true });
    return reply.send(unsubPage("Pronto, você não vai mais receber nossos e-mails."));
  });
}
