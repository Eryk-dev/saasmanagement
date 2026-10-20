// Timeline única do cliente e do lead — Fase 1.2 do plano do Lever CRM.
//
// `timeline_events` é só de inserção: guarda o que chega dos produtos
// (events-core.js) com id derivado do evento, então reprocessar não duplica.
// A timeline que a tela lê junta essa coleção às fontes que o cockpit já tem,
// na leitura, sem cópia: toques do lead (`activities`), histórico de plano
// (`plan_changes`) e atividade dos tickets do cliente (`ticket_events`). Cada
// item sai no mesmo formato, com `origin` dizendo de onde veio.

export const TIMELINE = "timeline_events";

export async function appendTimeline(repo, item) {
  const existing = await repo.get(TIMELINE, item.id);
  if (existing) return existing;
  return repo.create(TIMELINE, { ...item, recordedAt: new Date().toISOString() });
}

const fromTimeline = (t) => ({
  id: t.id, origin: "evento", at: t.at, kind: t.kind, source: t.source,
  customer: t.customer || "", lead: t.lead || "", data: t.data || {},
});
const fromActivity = (a) => ({
  id: a.id, origin: "atividade", at: a.at || a.createdAt, kind: a.type || "note", source: "cockpit",
  lead: a.lead || "", author: a.author || "", text: a.text || "", data: a.meta || {},
});
const fromPlanChange = (p) => ({
  id: p.id, origin: "plano", at: p.at, kind: p.type, source: p.source || "cockpit",
  customer: p.customer || "", lead: p.lead || "", author: p.author || "", text: p.note || "",
  data: { from: p.from, to: p.to, amount: p.amount, subscription: p.subscription },
});
const fromTicketEvent = (e) => ({
  id: e.id, origin: "ticket", at: e.at, kind: e.type, source: "suporte",
  ticket: e.ticket, author: e.by || "", data: e.data || {},
});

const uniq = (xs) => [...new Set(xs.filter(Boolean).map(String))];

// Leads e cliente que formam a mesma história: o cliente puxa o lead de origem
// e os negócios ligados a ele; o lead puxa o cliente que gerou.
async function scopeOf(repo, { customer = "", lead = "" }) {
  let customerId = customer;
  if (!customerId && lead) customerId = (await repo.get("leads", lead))?.customerId || "";
  const c = customerId ? await repo.get("customers", customerId) : null;
  const linked = customerId ? await repo.listWhere("leads", { customerId }, { fields: [] }) : [];
  return { customerId: c?.id || "", leadIds: uniq([lead, c?.leadId, ...linked.map((l) => l.id)]) };
}

async function ticketEventsOf(repo, customerId) {
  if (!customerId) return [];
  const tickets = await repo.listWhere("tickets", { customerId }, { fields: [] });
  const lists = await Promise.all(tickets.map((t) => repo.listWhere("ticket_events", { ticket: t.id })));
  return lists.flat();
}

export async function buildTimeline(repo, { customer = "", lead = "", limit = 200 } = {}) {
  const { customerId, leadIds } = await scopeOf(repo, { customer, lead });
  const [byCustomer, byLeads, activities, planChanges, ticketEvents] = await Promise.all([
    customerId ? repo.listWhere(TIMELINE, { customer: customerId }) : [],
    Promise.all(leadIds.map((id) => repo.listWhere(TIMELINE, { lead: id }))).then((l) => l.flat()),
    Promise.all(leadIds.map((id) => repo.listWhere("activities", { lead: id }))).then((l) => l.flat()),
    customerId ? repo.listWhere("plan_changes", { customer: customerId }) : [],
    ticketEventsOf(repo, customerId),
  ]);
  const seen = new Set();
  const items = [
    ...[...byCustomer, ...byLeads].map(fromTimeline),
    ...activities.map(fromActivity),
    ...planChanges.map(fromPlanChange),
    ...ticketEvents.map(fromTicketEvent),
  ].filter((x) => x.at && !seen.has(x.id) && seen.add(x.id));
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { customer: customerId, leads: leadIds, items: items.slice(0, Math.max(1, Math.min(limit, 1000))) };
}
