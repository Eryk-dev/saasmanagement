// Rotas do SDR automatizado: horários livres no servidor (a grade do front,
// agora consultável por API), submissão dos templates da Meta (Fase 0) e o
// status que o card "SDR automático" da aba Automações mostra.
import { slotsForLead } from "./agenda-slots.js";
import { SDR_TEMPLATES } from "./sdr-templates.leverads.js";
import { resolveWabaId, getWaHealth } from "./wa-health.js";
import { sdrBotConfig } from "./sdr-flow.js";
import { makeSdrReplay } from "./sdr-replay.js";
import { NOT_CONFIGURED } from "./http-status.js";

const GRADES = new Set(["S", "A", "B", "C", "D", "E"]);

export function registerSdrRoutes(app, repo, { whatsapp: wa, anthropic = null } = {}) {
  const replay = makeSdrReplay({ repo, anthropic, log: app.log });

  // ── Bateria de replay (o portão da Fase 2) ────────────────────────────────
  // POST dispara em background (as chamadas de IA levam minutos); GET lê o
  // estado/relatório parcial. Ligar a conversa com IA sem rodar isso antes é
  // pular o teste com as conversas reais — não faça.
  // `model` (opcional) roda a MESMA bateria com outro modelo do provedor
  // configurado; `tag` grava num doc próprio (sdr_replay_<tag>) pra comparar
  // rodadas lado a lado sem sobrescrever (17/09).
  app.post("/api/sdr/replay", async (req, reply) => {
    const r = replay.start({
      saas: String(req.body?.saas || "leverads"),
      threads: Math.min(60, Math.max(1, Number(req.body?.threads) || 25)),
      turns: Math.min(5, Math.max(1, Number(req.body?.turns) || 3)),
      model: String(req.body?.model || "").slice(0, 80),
      tag: String(req.body?.tag || "").slice(0, 40),
    });
    if (r.busy) return reply.code(409).send({ error: "já tem uma bateria rodando — acompanhe pelo GET" });
    if (r.error) return reply.code(NOT_CONFIGURED).send({ error: r.error });
    return { ok: true, started: true };
  });

  app.get("/api/sdr/replay", async (req) => replay.status(String(req.query?.tag || "")));
  // Todas as rodadas gravadas (sem as amostras): a comparação entre modelos.
  app.get("/api/sdr/replay/runs", async () => ({ runs: await replay.runs() }));

  // Uso da IA do robô por dia e por modelo (chamadas, tokens, latência), somado
  // pelo sdr-brain em app_config sdr_ai_usage_<saas>_<dia>. Últimos N dias.
  app.get("/api/sdr/ai-usage", async (req) => {
    const saas = String(req.query?.saas || "leverads");
    const days = Math.min(90, Math.max(1, Number(req.query?.days) || 14));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const prefix = `sdr_ai_usage_${saas}_`;
    const docs = (await repo.list("app_config")).filter((d) => String(d.id || "").startsWith(prefix) && String(d.day || "") >= cutoff);
    const total = { calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, ms: 0 };
    const byModel = {};
    for (const d of docs) {
      for (const k of Object.keys(total)) total[k] += Number(d[k]) || 0;
      for (const [m, u] of Object.entries(d.byModel || {})) {
        byModel[m] = byModel[m] || { calls: 0, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, ms: 0 };
        for (const k of Object.keys(total)) byModel[m][k] += Number(u?.[k]) || 0;
      }
    }
    return {
      saas, days, model: anthropic?.model || "", provider: anthropic?.provider || "",
      total, byModel,
      daily: docs.map((d) => ({ day: d.day, calls: d.calls || 0, in: d.in || 0, out: d.out || 0, cacheRead: d.cacheRead || 0, ms: d.ms || 0, byModel: d.byModel || {} })).sort((a, b) => String(a.day).localeCompare(String(b.day))),
    };
  });

  // Próximos horários livres pro lead (ou pra uma nota S-E avulsa), já com a
  // régua de roteamento por nível de closer aplicada (agenda-slots.js).
  app.get("/api/agenda/free-slots", async (req, reply) => {
    const saas = String(req.query?.saas || "");
    if (!saas) return reply.code(400).send({ error: "passe ?saas=" });
    const lead = req.query?.lead ? await repo.get("leads", String(req.query.lead)) : null;
    const g = String(req.query?.grade || "").toUpperCase();
    const days = Math.min(15, Math.max(1, Number(req.query?.days) || 5));
    const limit = Math.min(30, Math.max(1, Number(req.query?.limit) || 8));
    return slotsForLead(repo, { lead, saas, grade: GRADES.has(g) ? g : undefined, days, limit });
  });

  // Submete os templates do SDR pra aprovação da Meta. Idempotente: aprovado
  // não re-submete; "já existe" (submetido antes, ainda em revisão) vira
  // status pending sem erro. A aprovação leva de minutos a dias — por isso
  // este botão é o primeiro passo do projeto, antes de ligar o robô.
  app.post("/api/whatsapp/templates/sdr-setup", async (req, reply) => {
    if (!wa?.configured?.()) return reply.code(NOT_CONFIGURED).send({ error: "WhatsApp não configurado no servidor" });
    const wabaId = await resolveWabaId(repo, wa);
    if (!wabaId) return reply.code(404).send({ error: "não achei o id da conta do WhatsApp (WABA) — mande uma mensagem pro número ou defina WHATSAPP_WABA_ID" });
    let approved = new Set();
    try { approved = new Set((await wa.listTemplates(wabaId)).map((t) => t.name)); } catch { /* segue: submissão não depende da listagem */ }
    const templates = [];
    for (const spec of SDR_TEMPLATES) {
      if (approved.has(spec.name)) { templates.push({ name: spec.name, status: "approved" }); continue; }
      try {
        const r = await wa.createTemplate(wabaId, spec);
        templates.push({ name: spec.name, status: String(r.status || "PENDING").toLowerCase() });
      } catch (err) {
        const msg = String(err.message || err);
        // "Já submetido" tem mais de uma cara na Meta: "already exists" e
        // "There is already Portuguese (BR) content for this template" (vista
        // em prod 22/08). Ambas = está em revisão, não é erro.
        if (/already exists|there is already|j[áa] existe/i.test(msg)) templates.push({ name: spec.name, status: "pending" });
        else templates.push({ name: spec.name, status: "error", error: msg.slice(0, 200) });
      }
    }
    return { ok: true, templates };
  });

  // Estado do robô + dos templates dele (aprovação da Meta e eventos de saúde
  // do webhook: reprovado/pausado chegam por message_template_status_update).
  app.get("/api/sdr/status", async (req, reply) => {
    const saas = String(req.query?.saas || "");
    const product = saas ? await repo.get("products", saas) : null;
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    let approved = new Set();
    let templatesError = "";
    if (wa?.configured?.()) {
      try {
        const wabaId = await resolveWabaId(repo, wa);
        if (wabaId) approved = new Set((await wa.listTemplates(wabaId)).map((t) => t.name));
        else templatesError = "sem id da conta do WhatsApp (WABA) ainda";
      } catch (err) { templatesError = String(err.message || err).slice(0, 200); }
    } else {
      templatesError = "WhatsApp não configurado no servidor";
    }
    const health = (await getWaHealth(repo)).templates || {};
    return {
      enabled: !!sdrBotConfig(product),
      config: product.sdrBot || null,
      templates: SDR_TEMPLATES.map((t) => ({
        name: t.name,
        category: t.category,
        body: t.body,
        approved: approved.has(t.name),
        event: health[t.name]?.status || "",
      })),
      templatesError,
    };
  });
}
