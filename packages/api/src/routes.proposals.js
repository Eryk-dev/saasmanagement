// Rotas públicas do proposal builder nativo. Tudo aqui fica FORA da exigência de
// API key (ver OPEN em index.js): página /p/:id, aceite e o PATCH do closer
// (autenticado pelo editKey opaco da proposta, via ?k / body.k).
//
// Tracking de visualização: cada GET /p/:id SEM o editKey conta uma view
// (closer abrindo o próprio link de edição não infla o número).

import { publicProposal } from "./proposal.js";
import { proposalPageHtml } from "./proposal-page.js";
import { makeRateLimiter } from "./forms.js";

// Proposta "fake" a partir de um template + dados de exemplo — usada pelo
// preview do builder (iframe) e pela página /p/t/:id (preview em aba).
function previewFromTemplate(t, { data, state, answers } = {}) {
  return {
    id: "preview",
    name: t.name || "Proposta",
    theme: t.theme || {},
    slides: t.slides || [],
    calc: t.calc || {},
    data: data || {
      lead: { name: "Ana Souza", firstName: "Ana", company: "Empresa Exemplo", email: "ana@exemplo.com", phone: "(11) 98765-4321", amount: 0 },
      answers: answers || {},
    },
    state: state || {
      seats: t.calc?.plans?.[t.calc?.defaultCycle]?.included || 2,
      volume: Object.keys(t.calc?.volumeMid || {})[0] || "",
      cycle: t.calc?.defaultCycle || "monthly",
      customPriceCents: 0,
      validUntil: new Date(Date.now() + 7 * 86400_000).toLocaleDateString("pt-BR"),
      frozen: false,
    },
    accepted: false,
  };
}

export function registerProposalRoutes(app, repo, opts = {}) {
  const allow = makeRateLimiter({
    limit: opts.rateLimit ?? Number(process.env.PROPOSAL_RATE_LIMIT || 30),
    windowMs: opts.rateWindowMs ?? 60_000,
  });
  const clientIp = (req) =>
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "?";

  // Preview do TEMPLATE em aba própria (dados de exemplo, nada persiste).
  // Funciona pra rascunho também — é ferramenta do dono, id é opaco.
  app.get("/p/t/:id", async (req, reply) => {
    const t = await repo.get("proposal_templates", req.params.id);
    if (!t) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Template não encontrado.</p>");
    }
    return reply.type("text/html").send(proposalPageHtml(publicProposal(previewFromTemplate(t)), { previewBanner: true }));
  });

  app.get("/p/:id", async (req, reply) => {
    const p = await repo.get("proposals", req.params.id);
    if (!p) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset=utf-8><title>404</title><p style='font-family:system-ui;padding:40px'>Proposta não encontrada.</p>");
    }
    const editable = !!req.query.k && req.query.k === p.editKey;
    if (!editable) {
      // best-effort: contagem de view nunca quebra a página
      try {
        await repo.update("proposals", p.id, {
          views: (Number(p.views) || 0) + 1,
          lastViewedAt: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    }
    return reply.type("text/html").send(proposalPageHtml(publicProposal(p, { editable })));
  });

  // Painel do closer: só os campos de estado, só com o editKey certo.
  app.patch("/public/proposals/:id", async (req, reply) => {
    const p = await repo.get("proposals", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!body.k || body.k !== p.editKey) return reply.code(401).send({ error: "Unauthorized" });
    const state = { ...(p.state || {}) };
    if (Number.isFinite(Number(body.seats)) && Number(body.seats) >= 1) state.seats = Number(body.seats);
    if (typeof body.volume === "string") state.volume = body.volume;
    if (["monthly", "quarterly", "annual"].includes(body.cycle)) state.cycle = body.cycle;
    if (Number.isFinite(Number(body.customPriceCents)) && Number(body.customPriceCents) >= 0) state.customPriceCents = Number(body.customPriceCents);
    if (typeof body.validUntil === "string") state.validUntil = body.validUntil.slice(0, 20);
    if (typeof body.frozen === "boolean") state.frozen = body.frozen;
    const updated = await repo.update("proposals", p.id, { state });
    return { ok: true, state: updated.state };
  });

  // Aceite do lead: marca a proposta + o lead; move o estágio se o template
  // definiu acceptStage e ele existir no funil do produto.
  app.post("/public/proposals/:id/accept", async (req, reply) => {
    if (!allow(clientIp(req))) return reply.code(429).send({ error: "Tente de novo em instantes." });
    const p = await repo.get("proposals", req.params.id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    if (!p.accepted) {
      const acceptedAt = new Date().toISOString();
      await repo.update("proposals", p.id, { accepted: true, acceptedAt });
      const lead = p.lead ? await repo.get("leads", p.lead) : null;
      if (lead) {
        const patch = { proposalAccepted: true, proposalAcceptedAt: acceptedAt };
        if (p.acceptStage) {
          const product = await repo.get("products", lead.saas);
          if ((product?.funnel || []).some((f) => f.stage === p.acceptStage)) patch.stage = p.acceptStage;
        }
        await repo.update("leads", lead.id, patch);
      }
    }
    return { ok: true };
  });

  // Preview autenticado pro builder (rota /api → exige key): recebe o template
  // (rascunho) + dados de exemplo e devolve o MESMO HTML da página pública.
  app.post("/api/proposals/preview", async (req, reply) => {
    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body || typeof body.template !== "object") return reply.code(400).send({ error: "JSON body { template, data? } required" });
    const fake = previewFromTemplate(body.template, { data: body.data, state: body.state, answers: body.answers });
    return { html: proposalPageHtml(publicProposal(fake, { editable: false })) };
  });
}
