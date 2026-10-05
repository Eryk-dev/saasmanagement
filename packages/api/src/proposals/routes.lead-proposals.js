// Proposta a partir do lead: gerar (native | levercopy), proposta personalizada,
// ofertas disponíveis e compartilhamento.

import { dispatchProposal } from "./dispatch.js";
import { publicBase } from "../platform/request.js";
import { buildCustomProposal, proposalOffersOf, publicProposal, shareProposalOffer, syncProposalLeadSnapshot } from "./proposal.js";
import { proposalPageHtml } from "./proposal-page.js";
import { logActivity } from "../crm/lead-flow.js";

export function registerLeadProposalRoutes(app, repo) {
  // ── Geração de proposta de um lead — dispatcher native | levercopy ────────
  // `?auto=1`  → gatilho automático (a UI chama após criar um lead): respeita a
  //              idempotência (pula se já tem proposta) e a elegibilidade (saas/config).
  // `?force=1` → re-gerar manual: sobrescreve as URLs salvas.
  // Best-effort: só 404 (lead inexistente) é erro; skip/falha de geração voltam 200
  // com { ok:false, ... } pra UI mostrar o estado sem quebrar nada (fail-open).
  app.post("/api/leads/:id/proposal", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const auto = req.query.auto === "1" || req.query.auto === "true";
    const force = req.query.force === "1" || req.query.force === "true";
    const unpin = req.query.unpin === "1" || req.query.unpin === "true";
    const template = String(req.query.template || "").trim();

    const result = await dispatchProposal(repo, lead, { auto, force, template, unpin, baseUrl: publicBase(req) });
    if (!result.ok && result.error) {
      req.log.warn({ leadId: lead.id, provider: result.provider, status: result.status, err: result.error }, "proposal generation failed");
    }
    return result;
  });

  // ── Proposta PERSONALIZADA (objetiva) ─────────────────────────────────────
  // Cliente que fechou solução sob medida: capa + "o combinado" (entregáveis +
  // valor), no layout da apresentação (herda o tema do template publicado do
  // produto). `preview:true` renderiza sem salvar (o modal mostra ao vivo);
  // senão faz UPSERT idempotente por lead (link estável) e grava o vínculo no
  // lead sem tocar na proposta automática (proposta_id fica intacto).
  app.post("/api/leads/:id/proposal/custom", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const spec = req.body && typeof req.body === "object" ? req.body : {};

    // Tema do template publicado do produto (mesma capa/fonte/logo do deck).
    const templates = await repo.list("proposal_templates");
    const template = templates.find((t) => t.saas === lead.saas && t.status === "published");
    const built = buildCustomProposal(lead, spec, { theme: template?.theme || {} });

    if (spec.preview) {
      const fake = { id: "preview", ...built, accepted: false };
      return { html: proposalPageHtml(publicProposal(fake, { editable: false })) };
    }

    // Upsert por (lead, origin custom): re-salvar mantém o MESMO link e o
    // tracking de aberturas (igual ao share por oferta).
    // Só o id — ver proposal.js: varrer todas as propostas pra achar uma linha
    // era leitura de megabytes por clique do closer.
    const [existing] = await repo.listWhere("proposals", { lead: lead.id, origin: "custom" }, { fields: [] });
    const record = { saas: lead.saas, lead: lead.id, origin: "custom", template: "", editKey: "", ...built };
    const saved = existing
      ? await repo.update("proposals", existing.id, record)
      : await repo.create("proposals", { ...record, views: 0, viewLog: [], accepted: false, createdAt: new Date().toISOString() });

    const url = `${publicBase(req)}/p/${saved.id}`;
    await repo.update("leads", lead.id, { customProposalId: saved.id, customProposalUrl: url });
    try {
      await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "system",
        meta: { event: existing ? "custom_proposal_updated" : "custom_proposal_created", proposal: saved.id },
        author: req.authUser?.id || "",
      });
    } catch { /* timeline é best-effort */ }
    return { ok: true, id: saved.id, url };
  });

  // ── Mandar a proposta pro cliente (uma por oferta) ────────────────────────
  // O deck do lead é de apresentação (preço no comando do closer, ofertas 2/3
  // secretas). Aqui o closer escolhe QUAL oferta mandar e recebe um link
  // próprio, já visível e sem edição. Ancorado no LEAD de propósito: é ação de
  // quem trabalha a fila (pipeline/today), não da tela de propostas.
  app.get("/api/leads/:id/proposal-offers", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const proposal = lead.proposta_id ? await repo.get("proposals", lead.proposta_id) : null;
    if (!proposal) return { proposal: null, offers: [] };
    return { proposal: proposal.id, offers: proposalOffersOf(proposal) };
  });

  app.post("/api/leads/:id/proposal-share", async (req, reply) => {
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    let proposal = lead.proposta_id ? await repo.get("proposals", lead.proposta_id) : null;
    if (!proposal) return reply.code(400).send({ error: "lead ainda não tem proposta gerada" });
    proposal = await syncProposalLeadSnapshot(repo, proposal);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await shareProposalOffer(repo, proposal, body.offer, { baseUrl: publicBase(req) });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    // Fica na timeline QUAL oferta foi mandada e quando (o "abriu" já entra
    // sozinho na primeira visualização do cliente).
    try {
      await logActivity(repo, {
        saas: lead.saas || "", lead: lead.id, type: "system",
        meta: { event: "proposal_shared", proposal: result.proposal.id, offer: result.offer, label: result.label },
        author: req.authUser?.id || "",
      });
    } catch { /* timeline é best-effort */ }
    return { ok: true, id: result.proposal.id, url: result.url, offer: result.offer, label: result.label };
  });
}
