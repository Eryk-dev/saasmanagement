// Histórico de suporte de um cliente, pela EMPRESA (org): os tickets do
// cadastro e dos outros cadastros da mesma org nos demais produtos. A org é
// qualquer um dos ids que o cliente guarda (`orgId` do LeverId,
// `leveradsOrgId`, `leverpriceOrgId`); ids de sistemas diferentes não colidem.
// Só entram os produtos que o atendente atende (escopo do suporte).

import { inScope } from "../auth/support-scope.js";
import { STATUS_KIND, summarizeTicket } from "./tickets-core.js";

const ORG_FIELDS = ["orgId", "leveradsOrgId", "leverpriceOrgId"];
export const orgKeysOf = (c) => [...new Set(ORG_FIELDS.map((f) => String(c?.[f] || "").trim()).filter(Boolean))];

const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : NaN; };

export function supportSummary(tickets) {
  const done = tickets.filter((t) => STATUS_KIND[t.status] === "done");
  const horas = done
    .map((t) => (ms(t.sla?.resolvedAt || t.closedAt) - ms(t.createdAt)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const conta = (key) => tickets.reduce((acc, t) => { const k = key(t); if (k) acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const byCategory = Object.entries(conta((t) => t.category || ""))
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return {
    total: tickets.length,
    open: tickets.length - done.length,
    resolved: done.length,
    avgResolutionHours: horas.length ? Math.round((horas.reduce((s, h) => s + h, 0) / horas.length) * 10) / 10 : null,
    lastAt: tickets.reduce((max, t) => (String(t.createdAt || "") > max ? String(t.createdAt) : max), ""),
    byProduct: conta((t) => t.saas || ""),
    byChannel: conta((t) => t.channel || "internal"),
    byCategory,
    hermes: tickets.filter((t) => t.hermes && Object.keys(t.hermes).length).length,
    breached: tickets.filter((t) => t.sla?.breached?.resolution || t.sla?.breached?.firstResponse).length,
  };
}

// null = cliente inexistente ou nenhum produto da empresa no escopo (rota → 404).
export async function customerSupportHistory(repo, customerId, scope) {
  const anchor = await repo.get("customers", String(customerId || "")).catch(() => null);
  if (!anchor) return null;
  const keys = new Set(orgKeysOf(anchor));
  const mesmaEmpresa = keys.size
    ? (await repo.list("customers").catch(() => [])).filter((c) => c.id === anchor.id || orgKeysOf(c).some((k) => keys.has(k)))
    : [anchor];
  if (!mesmaEmpresa.some((c) => c.id === anchor.id)) mesmaEmpresa.unshift(anchor);
  const companies = mesmaEmpresa.filter((c) => inScope(scope, c.saas));
  if (!companies.length) return null;
  const ids = new Set(companies.map((c) => c.id));
  const produtos = [...new Set(companies.map((c) => String(c.saas || "")))];
  const tickets = (await Promise.all(produtos.map((saas) => repo.listWhere("tickets", { saas }).catch(() => []))))
    .flat()
    .filter((t) => ids.has(t.customerId))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")) || (Number(b.number) || 0) - (Number(a.number) || 0))
    .map(summarizeTicket);
  return {
    customer: { id: anchor.id, name: anchor.name || "", saas: anchor.saas || "" },
    companies: companies.map((c) => ({ id: c.id, name: c.name || "", saas: c.saas || "" })),
    summary: supportSummary(tickets),
    tickets,
  };
}
