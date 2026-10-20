// Health score do cliente — Fase 3 do plano do Lever CRM. `customer.health`
// existia (0 a 100, faixas do filtro de Clientes: < 50 vermelho, < 70 amarelo)
// e nunca era calculado. Agora é a soma de quatro partes, cada uma com um
// valor NEUTRO quando falta o dado (cliente novo não nasce em risco por não
// ter NPS ainda):
//
//   pagamento  40  adimplente 40 · sem cobrança 30 · aguardando 25 · inadimplente 0
//   NPS        20  nota 9–10 → 20 · 7–8 → 12 · 0–6 → 0 · sem resposta → 10
//   suporte    20  sem ticket aberto → 20 · aberto normal → 12 · 3+ abertos → 6 · urgente/alto aberto → 0
//   resultado  20  vendeu pelos anúncios em 30 dias → 20 · tem anúncio sem venda → 8 · sem dado → 10
//
// Cada mudança de FAIXA vira item da timeline; a queda de faixa avisa o dono
// da conta. O estágio de vida (lifecycle.js) lê o mesmo número.

import { appendTimeline } from "../events/timeline.js";
import { upsertNotification } from "../tasks/tasks-core.js";
import { STATUS_KIND } from "../support/tickets-core.js";
import { financialStatusOf } from "./lifecycle.js";
import { orgSnapshot } from "./leverads-results.js";

const PAYMENT = { adimplente: 40, "": 30, aguardando_pagamento: 25, inadimplente: 0 };
export const bandOf = (h) => (h < 50 ? "red" : h < 70 ? "yellow" : "green");
const BAND_LABEL = { red: "vermelho", yellow: "amarelo", green: "verde" };
const RANK = { red: 0, yellow: 1, green: 2 };

export function npsPart(nps) {
  const answered = nps.filter((n) => n.status === "answered" && n.score !== null && n.score !== undefined)
    .sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
  if (!answered.length) return 10;
  const s = Number(answered[0].score);
  return s >= 9 ? 20 : s >= 7 ? 12 : 0;
}

export function supportPart(tickets) {
  const open = tickets.filter((t) => STATUS_KIND[t.status] !== "done");
  if (!open.length) return 20;
  if (open.some((t) => t.priority === "urgent" || t.priority === "high")) return 0;
  return open.length >= 3 ? 6 : 12;
}

export function resultPart(snapshot) {
  if (!snapshot) return 10;
  if (snapshot.orders30d > 0) return 20;
  return snapshot.listings > 0 ? 8 : 10;
}

export function computeHealth({ subs = [], invoices = [], nps = [], tickets = [], snapshot = null }) {
  const parts = {
    pagamento: PAYMENT[financialStatusOf(subs, invoices)] ?? 30,
    nps: npsPart(nps),
    suporte: supportPart(tickets),
    resultado: resultPart(snapshot),
  };
  return { health: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

async function inputsOf(repo, c) {
  const [subs, invoices, nps, tickets] = await Promise.all([
    repo.listWhere("subscriptions", { customer: c.id }),
    repo.listWhere("invoices", { customer: c.id }),
    repo.listWhere("nps", { customer: c.id }),
    repo.listWhere("tickets", { customerId: c.id }),
  ]);
  return { subs, invoices, nps, tickets };
}

async function noteBandChange(repo, c, from, to, health, at) {
  await appendTimeline(repo, {
    id: `tl:health:${c.id}:${at}`, kind: "customer.health_changed", source: "cockpit", at,
    customer: c.id, lead: c.leadId || "", data: { from, to, health },
  });
  if (!c.owner || RANK[to] >= RANK[from]) return;
  await upsertNotification(repo, {
    user: c.owner, type: "health_drop", task: "", taskTitle: c.name, saas: c.saas || "", by: "api",
    key: `health:${c.id}:${to}:${at.slice(0, 10)}`,
    text: `${c.name} caiu para a faixa ${BAND_LABEL[to]} do health (${health})`,
    link: { screen: "customers", customer: c.id },
  });
}

export async function refreshHealth(repo, c, { snapshot = null, now = new Date() } = {}) {
  const { health, parts } = computeHealth({ ...(await inputsOf(repo, c)), snapshot });
  if (health === c.health && c.healthParts) return c;
  const at = now.toISOString();
  const from = c.healthAt ? bandOf(Number(c.health) || 0) : "";
  const to = bandOf(health);
  if (from && from !== to) await noteBandChange(repo, c, from, to, health, at);
  return repo.update("customers", c.id, { health, healthParts: parts, healthAt: at }, { silent: true });
}

export async function runHealthSweep(repo, { snapshots = null, now = new Date() } = {}) {
  const customers = (await repo.list("customers")).filter((c) => !c.endedAt);
  const snap = snapshots || await orgSnapshot(customers.map((c) => c.leveradsOrgId)).catch(() => new Map());
  let changed = 0;
  for (const c of customers) {
    const saved = await refreshHealth(repo, c, { snapshot: snap.get(String(c.leveradsOrgId || "").toLowerCase()) || snap.get(String(c.leveradsOrgId || "")) || null, now });
    if (saved !== c) changed++;
  }
  return { customers: customers.length, changed };
}

export function startHealthSweep(repo, { log, intervalMs = 6 * 3_600_000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try { return await runHealthSweep(repo); } catch (err) { log?.warn?.(`health: ${err.message}`); return null; } finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 120_000);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}
