// Grupos de WhatsApp dos clientes, registrados pelo Hermes (04/11/2026).
//
// O Hermes lê os grupos LeverAds/LeverPrice e manda, de hora em hora, o nome de
// cada grupo e os telefones dos clientes que estão nele (a equipe da Lever fica
// de fora: ela está em muitos grupos). Aqui cada grupo é ligado ao cliente cujo
// telefone (cadastro, contatos ou o lead que virou venda) está no grupo — só
// quando UM cliente casa; dois ou nenhum deixam o grupo sem cliente e o CS
// escolhe à mão. Escolha à mão vale até alguém voltar o grupo para automático.
//
// O card do Hermes traz "**Grupo:** `<jid>`"; o ticket pega o cliente pelo
// grupo (ticketFromIssue). Ligar um grupo também preenche os tickets abertos
// antes sem cliente — pelo jid ou, nos cards antigos, pelo nome do grupo.
//
// Isto só escolhe o cliente do ticket. Não mexe no vínculo de empresa do
// Hermes, que dá acesso aos dados da conta.

import crypto from "node:crypto";
import { patchTicket, ACTOR_LINEAR } from "./tickets-core.js";
import { withTaskLock } from "../tasks/tasks-core.js";

const COLLECTION = "whatsapp_groups";
export const GROUP_JID = /^[\d-]{6,60}@g\.us$/;
const MAX_GROUPS = 1000;
const MAX_PHONES = 300;

// Telefone comparável: só dígitos; no Brasil, 55 + DDD + os 8 últimos (o
// WhatsApp de números antigos vem sem o nono dígito).
export function phoneKey(value) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith("55") && d.length >= 12 && d.length <= 13) return `${d.slice(0, 4)}${d.slice(-8)}`;
  return d.length >= 8 && d.length <= 15 ? d : "";
}

// Linha que o Hermes escreve no card, logo abaixo de "**Cliente:**".
export const groupOfDescription = (description) =>
  (String(description || "").match(/^\*\*Grupo:\*\*[ \t]*`?([\d-]{6,60}@g\.us)`?/im) || [])[1] || "";

// Telefones de cada cliente → clientes daquele telefone.
export function phoneIndex(customers = [], leadsById = new Map()) {
  const index = new Map();
  for (const c of customers) {
    const phones = [c.phone, ...(Array.isArray(c.contacts) ? c.contacts.map((x) => x?.phone) : []), leadsById.get(String(c.leadId || ""))?.phone];
    for (const key of new Set(phones.map(phoneKey).filter(Boolean))) {
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(c.id);
    }
  }
  return index;
}

// Cliente do grupo pelos telefones: só com um único cliente casado.
export function matchGroup(phones = [], index = new Map()) {
  const hits = new Map();
  for (const key of new Set(phones.map(phoneKey).filter(Boolean))) {
    for (const id of index.get(key) || []) hits.set(id, (hits.get(id) || 0) + 1);
  }
  const candidates = [...hits.keys()].sort();
  return { customerId: candidates.length === 1 ? candidates[0] : "", candidates, matched: [...hits.values()].reduce((a, b) => a + b, 0) };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Corpo do Hermes → grupos válidos. Lança 400 em lote fora do formato.
export function sanitizeGroups(body) {
  const list = Array.isArray(body?.groups) ? body.groups : null;
  if (!list || list.length > MAX_GROUPS) throw Object.assign(new Error(`groups precisa ser uma lista de até ${MAX_GROUPS} grupos`), { statusCode: 400 });
  const out = new Map();
  for (const g of list) {
    const jid = str(g?.jid, 80);
    if (!GROUP_JID.test(jid)) continue;
    const phones = (Array.isArray(g.phones) ? g.phones : []).slice(0, MAX_PHONES).map(phoneKey).filter(Boolean);
    out.set(jid, { jid, name: str(g.name, 200) || jid, phones: [...new Set(phones)].sort() });
  }
  return [...out.values()];
}

async function customerData(repo) {
  const customers = await repo.list("customers").catch(() => []);
  const leadIds = [...new Set(customers.map((c) => String(c.leadId || "")).filter(Boolean))];
  const leads = await Promise.all(leadIds.map((id) => repo.get("leads", id).catch(() => null)));
  return { customers, index: phoneIndex(customers, new Map(leads.filter(Boolean).map((l) => [String(l.id), l]))) };
}

// Tickets ainda sem cliente que vieram deste grupo: o jid gravado na abertura
// ou, nos cards anteriores ao jid, o nome do grupo no solicitante.
export async function fillGroupTickets(repo, group, { now } = {}) {
  if (!group?.customerId) return 0;
  const customer = await repo.get("customers", group.customerId).catch(() => null);
  if (!customer) return 0;
  let filled = 0;
  for (const t of await repo.list("tickets").catch(() => [])) {
    if (t.customerId || (customer.saas && t.saas !== customer.saas)) continue;
    const fromGroup = t.whatsappGroup ? t.whatsappGroup === group.id : Boolean(t.linearIssueId) && str(t.requester?.name, 200) === group.name;
    if (!fromGroup) continue;
    const r = await patchTicket(repo, t.id, { customerId: customer.id }, { by: ACTOR_LINEAR, ...(now ? { now } : {}) }).catch(() => null);
    if (r?.ticket?.customerId === customer.id) filled += 1;
  }
  return filled;
}

// Registro vindo do Hermes: grava nome e telefones, liga pelo telefone (sem
// tocar no que foi escolhido à mão) e preenche os tickets de quem foi ligado.
export async function registerGroups(repo, groups, { now = new Date().toISOString(), log } = {}) {
  return withTaskLock("whatsapp_groups", async () => {
    const { index } = await customerData(repo);
    const report = { groups: groups.length, created: 0, linked: 0, ambiguous: 0, unmatched: 0, manual: 0, tickets: 0 };
    for (const g of groups) {
      const cur = await repo.get(COLLECTION, g.jid);
      const match = matchGroup(g.phones, index);
      const manual = cur?.linkedBy === "manual";
      const next = {
        name: g.name, phones: g.phones, candidates: match.candidates, seenAt: now,
        customerId: manual ? cur.customerId || "" : match.customerId,
        linkedBy: manual ? "manual" : match.customerId ? "telefone" : "",
      };
      if (manual) report.manual += 1;
      else if (match.customerId) report.linked += 1;
      else if (match.candidates.length > 1) report.ambiguous += 1;
      else report.unmatched += 1;
      const saved = cur ? await repo.update(COLLECTION, g.jid, next, { silent: true })
        : (report.created += 1, await repo.create(COLLECTION, { id: g.jid, firstSeenAt: now, ...next }));
      if (saved.customerId && saved.customerId !== cur?.customerId) report.tickets += await fillGroupTickets(repo, saved, { now });
    }
    log?.info?.(`whatsapp-groups: ${JSON.stringify(report)}`);
    return report;
  });
}

// Escolha à mão: um cliente ("manual") ou "" para voltar ao automático (o
// próximo registro do Hermes liga de novo pelo telefone).
export async function setGroupCustomer(repo, jid, customerId, { now = new Date().toISOString() } = {}) {
  const cur = await repo.get(COLLECTION, jid);
  if (!cur) return null;
  const id = str(customerId, 120);
  if (id && !(await repo.get("customers", id).catch(() => null))) throw Object.assign(new Error("cliente não encontrado"), { statusCode: 400, code: "customer_not_found" });
  const saved = await repo.update(COLLECTION, jid, id ? { customerId: id, linkedBy: "manual", linkedAt: now }
    : { customerId: "", linkedBy: "", linkedAt: now });
  if (id) await fillGroupTickets(repo, saved, { now });
  return saved;
}

// Lista para a tela: sem os telefones (só quantos casaram).
export function groupView(doc, customersById = new Map()) {
  const name = (id) => customersById.get(id)?.name || "";
  return {
    jid: doc.id, name: doc.name || doc.id, customerId: doc.customerId || "", customerName: name(doc.customerId),
    linkedBy: doc.linkedBy || "", phones: (doc.phones || []).length,
    candidates: (doc.candidates || []).map((id) => ({ id, name: name(id) })), seenAt: doc.seenAt || "", firstSeenAt: doc.firstSeenAt || "",
  };
}

export async function listGroups(repo) {
  const [groups, customers] = await Promise.all([repo.list(COLLECTION).catch(() => []), repo.list("customers").catch(() => [])]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  return groups.map((g) => groupView(g, byId)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Chave do Hermes (X-Cockpit-Service-Key = HERMES_SERVICE_KEY), em tempo constante.
export function hermesServiceKeyOk(given, env = process.env) {
  const want = Buffer.from(String(env.HERMES_SERVICE_KEY || ""));
  const got = Buffer.from(String(given || ""));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}
