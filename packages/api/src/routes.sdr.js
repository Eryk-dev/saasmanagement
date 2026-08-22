// Rotas do SDR automatizado: horários livres no servidor (a grade do front,
// agora consultável por API), submissão dos templates da Meta (Fase 0) e o
// status que o card "SDR automático" da aba Automações mostra.
import { slotsForLead } from "./agenda-slots.js";
import { SDR_TEMPLATES } from "./sdr-templates.leverads.js";
import { resolveWabaId, getWaHealth } from "./wa-health.js";
import { sdrBotConfig } from "./sdr-flow.js";
import { NOT_CONFIGURED } from "./http-status.js";

const GRADES = new Set(["S", "A", "B", "C", "D", "E"]);

export function registerSdrRoutes(app, repo, { whatsapp: wa } = {}) {
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
