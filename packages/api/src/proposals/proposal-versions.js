// Versões da proposta de um lead (Lever CRM, Fase 2). Cada proposta gerada
// para o mesmo lead é uma versão (v1, v2…, pela ordem de criação), com estado
// derivado na leitura: aceita, expirada (passou da validade sem aceite),
// aberta pelo lead (tem visualização) ou enviada. As propostas compartilhadas
// a partir de outra (sharedFrom) contam como versão do mesmo lead.

import { validUntilMs } from "../customers/crm-alerts.js";

export function proposalStatus(p, now = Date.now()) {
  if (p.accepted) return "aceita";
  const until = validUntilMs(p.state?.validUntil);
  if (Number.isFinite(until) && until < now) return "expirada";
  return Number(p.views) > 0 ? "aberta" : "enviada";
}

export async function proposalVersions(repo, leadId, { now = Date.now() } = {}) {
  const list = await repo.listWhere("proposals", { lead: leadId }, { fields: ["createdAt", "accepted", "acceptedAt", "views", "lastViewedAt", "state", "template", "origin"] });
  return list
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((p, i) => ({
      id: p.id, version: i + 1, status: proposalStatus(p, now), createdAt: p.createdAt, acceptedAt: p.acceptedAt || "",
      views: Number(p.views) || 0, lastViewedAt: p.lastViewedAt || "", validUntil: p.state?.validUntil || "",
      cycle: p.state?.cycle || "", template: p.template || "",
    }));
}
