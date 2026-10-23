// Rotas do SDR automatizado: horários livres no servidor (a grade do front,
// agora consultável por API), submissão dos templates da Meta (Fase 0) e o
// status que o card "SDR automático" da aba Automações mostra.
import { readFile } from "node:fs/promises";
import { slotsForLead } from "../crm/agenda-slots.js";
import { SDR_TEMPLATES } from "./sdr-templates.leverads.js";
import { resolveWabaId, getWaHealth } from "../whatsapp/wa-health.js";
import { sdrBotConfig } from "./sdr-flow.js";
import { makeSdrReplay } from "./sdr-replay.js";
import { NOT_CONFIGURED } from "../platform/http-status.js";
import { isAdmin } from "../auth/roles.js";
import { SDR_ADMIN_KEYS, sanitizeSdrAdmin } from "./sdr-admin-config.js";
import { AI_PROVIDERS } from "./sdr-ai.js";
import { ruleById } from "./sdr-rules.js";

const GRADES = new Set(["S", "A", "B", "C", "D", "E"]);

export function registerSdrRoutes(app, repo, { whatsapp: wa, anthropic = null, sdrAi = null } = {}) {
  const replay = makeSdrReplay({ repo, anthropic, log: app.log });
  // Aba Robô da Inbox: ver e salvar é de admin (`!authUser` = chave mestre).
  const denyNonAdmin = (req, reply) => {
    if (!req.authUser || isAdmin(req.authUser)) return false;
    reply.code(403).send({ error: "Só admin vê e muda a configuração do robô" });
    return true;
  };

  // ── Bateria de replay (o portão da Fase 2) ────────────────────────────────
  // POST dispara em background (as chamadas de IA levam minutos); GET lê o
  // estado/relatório parcial. Ligar a conversa com IA sem rodar isso antes é
  // pular o teste com as conversas reais — não faça.
  // `model` (opcional) roda a MESMA bateria com outro modelo do provedor
  // configurado; `tag` grava num doc próprio (sdr_replay_<tag>) pra comparar
  // rodadas lado a lado sem sobrescrever (17/09).
  // `provider` (só admin, como o `model`): testa outro provedor antes de trocar.
  app.post("/api/sdr/replay", async (req, reply) => {
    const provider = String(req.body?.provider || "");
    if ((provider || req.body?.model) && denyNonAdmin(req, reply)) return;
    if (provider && !AI_PROVIDERS.includes(provider)) return reply.code(400).send({ error: "provider: use openrouter ou anthropic" });
    let client = null;
    if (provider) {
      const picked = sdrAi?.resolve({ provider });
      if (!picked || picked.fallback) return reply.code(NOT_CONFIGURED).send({ error: picked?.fallback || "provedor indisponível" });
      client = picked.client;
    }
    const r = replay.start({
      client,
      saas: String(req.body?.saas || "leverads"),
      threads: Math.min(60, Math.max(1, Number(req.body?.threads) || 25)),
      turns: Math.min(5, Math.max(1, Number(req.body?.turns) || 3)),
      model: String(req.body?.model || "").slice(0, 80),
      tag: String(req.body?.tag || "").slice(0, 40),
      // A/B do contrato v2 e conjunto fixo de conversas (15/10).
      contract: req.body?.contract === "v2" ? "v2" : "",
      promptVersion: req.body?.promptVersion === "v2" ? "v2" : "",
      threadIds: Array.isArray(req.body?.threadIds) ? req.body.threadIds.map(String).slice(0, 60) : [],
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
  // Auditoria do validador de saída (15/10): violações por regra e por
  // caminho, divergências da sombra e amostras, somadas por dia pelo sdr-brain
  // em app_config sdr_audit_<saas>_<dia>. Últimos N dias.
  app.get("/api/sdr/audit", async (req, reply) => {
    if (denyNonAdmin(req, reply)) return;
    const saas = String(req.query?.saas || "leverads");
    const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const prefix = `sdr_audit_${saas}_`;
    const docs = (await repo.list("app_config")).filter((d) => String(d.id || "").startsWith(prefix) && String(d.day || "") >= cutoff).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const sum = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + (Number(v) || 0); return into; };
    const total = { decisions: 0, shadowDiff: 0, shadowSame: 0, byRule: {}, exemptByRule: {}, byPath: {}, byPathRule: {} };
    const samples = [];
    for (const d of docs) {
      total.decisions += Number(d.decisions) || 0;
      total.shadowDiff += Number(d.shadowDiff) || 0;
      total.shadowSame += Number(d.shadowSame) || 0;
      sum(total.byRule, d.byRule); sum(total.exemptByRule, d.exemptByRule); sum(total.byPath, d.byPath);
      for (const [path, rules] of Object.entries(d.byPathRule || {})) total.byPathRule[path] = sum(total.byPathRule[path] || {}, rules);
      samples.push(...(d.samples || []));
    }
    samples.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    // Título de cada regra citada (a aba Robô mostra "R-012 · título").
    const ruleTitles = Object.fromEntries([...Object.keys(total.byRule), ...samples.flatMap((x) => x.violations || [])].map((id) => [id, ruleById(id)?.title || ""]));
    return { saas, days, ...total, ruleTitles, byDay: docs.map((d) => ({ day: d.day, decisions: d.decisions || 0, shadowDiff: d.shadowDiff || 0, violations: Object.values(d.byRule || {}).reduce((a, b) => a + b, 0) })), samples: samples.slice(0, 50) };
  });

  app.get("/api/sdr/ai-usage", async (req, reply) => {
    if (denyNonAdmin(req, reply)) return;
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

  // ── Configuração da aba Robô (IA + ajustes avançados) ─────────────────────
  // `values` = o que vale hoje para cada chave (o salvo ou o padrão de
  // sdrBotConfig); `effective` = a IA que o robô usa de fato com a escolha.
  async function configView(product) {
    const saved = product.sdrBot || {};
    const cfg = sdrBotConfig({ ...product, sdrBot: { ...saved, enabled: true } });
    const ai = { provider: String(saved.ai?.provider || ""), model: String(saved.ai?.model || "") };
    const picked = sdrAi?.resolve(ai) || { provider: anthropic?.provider || "", model: anthropic?.model || "", fallback: "" };
    return {
      saas: product.id,
      enabled: !!saved.enabled,
      conversation: saved.conversation === true,
      ai,
      effective: { provider: picked.provider, model: picked.model, fallback: picked.fallback },
      default: sdrAi?.defaultInfo() || { provider: anthropic?.provider || "", model: anthropic?.model || "", configured: !!anthropic?.configured?.() },
      providers: sdrAi?.providers() || { openrouter: false, anthropic: false },
      values: Object.fromEntries(Object.keys(SDR_ADMIN_KEYS).map((k) => [k, cfg[k]])),
    };
  }

  app.get("/api/sdr/config", async (req, reply) => {
    if (denyNonAdmin(req, reply)) return;
    const product = await repo.get("products", String(req.query?.saas || ""));
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    return configView(product);
  });

  app.patch("/api/sdr/config/:saas", async (req, reply) => {
    if (denyNonAdmin(req, reply)) return;
    const product = await repo.get("products", req.params.saas);
    if (!product) return reply.code(404).send({ error: "produto não encontrado" });
    const { patch, error } = sanitizeSdrAdmin(req.body || {});
    if (error) return reply.code(400).send({ error });
    const next = await repo.update("products", product.id, { sdrBot: { ...(product.sdrBot || {}), ...patch } });
    return configView(next);
  });

  // Catálogo de modelos do provedor (cache de 1h no sdr-ai.js). Falha do
  // provedor vira 422 com o motivo, nunca 5xx (o proxy troca o corpo).
  app.get("/api/sdr/models", async (req, reply) => {
    if (denyNonAdmin(req, reply)) return;
    if (!sdrAi) return reply.code(NOT_CONFIGURED).send({ error: "IA não configurada no servidor" });
    try {
      return { provider: String(req.query?.provider || ""), models: await sdrAi.listModels(String(req.query?.provider || "")) };
    } catch (err) {
      return reply.code(422).send({ error: String(err.message || err).slice(0, 240) });
    }
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
        // Cabeçalho de imagem: o arquivo vive em src/assets (vai no container).
        const headerImage = spec.headerImage
          ? { buffer: await readFile(new URL(`../assets/${spec.headerImage}`, import.meta.url)), mime: /\.png$/i.test(spec.headerImage) ? "image/png" : "image/jpeg", filename: spec.headerImage.split("/").pop() }
          : null;
        const r = await wa.createTemplate(wabaId, { ...spec, headerImage });
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
