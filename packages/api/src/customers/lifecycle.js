// Ciclo de vida do cliente — Fases 1.3 a 1.5 do plano do Lever CRM, sobre o
// que o cockpit já tem (decisão: sem coleções novas de Pessoa e Empresa).
//
// · Empresa = o próprio cliente. Razão social e CNPJ vêm do cadastro fiscal
//   que ele assinou (`customer.fiscal`, forms/fiscal-form.js); o domínio, do
//   e-mail de contato. Derivado na leitura: uma fonte só.
// · Contatos = quem fala pelo cliente: os de `customer.contacts[]` (com papel)
//   mais o do cadastro e o do lead que virou venda, sem repetir e-mail.
// · Estágio de vida (`lifecycle`): integracao | ativo | risco | churn.
//   Status financeiro (`financialStatus`): aguardando_pagamento | adimplente |
//   inadimplente. Os dois são derivados das assinaturas, faturas e integrações
//   e gravados no cliente; cada mudança vira item datado da timeline. Nenhum
//   dos dois corta acesso em produto nenhum — isso continua só no sync de
//   acesso, que por padrão só libera.
// · Workspace = o tenant de cada produto (`workspaces`, id produto:tenant),
//   espelhado do vínculo do cliente e das orgs do LeverAds.

import { appendTimeline } from "../events/timeline.js";

const norm = (v) => String(v || "").trim().toLowerCase();
const FREE_MAIL = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.br", "icloud.com", "live.com", "bol.com.br", "uol.com.br", "terra.com.br"]);
export const OPEN_ONBOARDING = new Set(["aguardando_kickoff", "kickoff", "configuracao", "treinamento", "go_live"]);
const ENDED_SUBS = new Set(["canceled", "expired", "ended"]);
const RISK_HEALTH = 50; // mesma faixa vermelha do filtro de Clientes (routes.crud.js)

export function contactsOf(customer, lead = null) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    const key = norm(c.email) || c.phone || c.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: c.name || "", email: norm(c.email), phone: c.phone || "", leverId: c.leverId || "", role: c.role || "", primary: Boolean(c.primary) });
  };
  for (const c of Array.isArray(customer?.contacts) ? customer.contacts : []) add(c);
  if (customer?.email || customer?.phone) add({ name: customer.contact || customer.name, email: customer.email, phone: customer.phone, primary: !out.length });
  if (lead) add({ name: lead.name, email: lead.email, phone: lead.phone, leverId: lead.leverId, role: "decisor", primary: !out.length });
  return out;
}

export function companyOf(customer, contacts = contactsOf(customer)) {
  const f = customer?.fiscal || {};
  const domain = contacts.map((c) => c.email.split("@")[1] || "").find((d) => d && !FREE_MAIL.has(d)) || "";
  return {
    legalName: f.tipo === "PJ" ? f.nome || "" : "",
    cnpj: f.tipo === "PJ" ? f.documento || "" : "",
    tradeName: f.nomeFantasia || customer?.name || "",
    domain,
  };
}

export function financialStatusOf(subs, invoices) {
  if (!subs.length && !invoices.length) return "";
  if (subs.some((s) => s.status === "past_due") || invoices.some((i) => i.status === "overdue")) return "inadimplente";
  if (invoices.length && !invoices.some((i) => i.status === "paid")) return "aguardando_pagamento";
  return "adimplente";
}

export function lifecycleOf(customer, { subs, onboardings, financialStatus }) {
  if (customer.endedAt || (subs.length && subs.every((s) => ENDED_SUBS.has(s.status)))) return "churn";
  if (onboardings.some((o) => OPEN_ONBOARDING.has(o.stage))) return "integracao";
  const health = Number(customer.health) || 0;
  if (financialStatus === "inadimplente" || (health > 0 && health < RISK_HEALTH)) return "risco";
  return "ativo";
}

// Coluna da Carteira de CS (Fase 3): saudável, atenção, em risco, renovação
// em negociação ou churn. Cliente ainda em integração fica fora da carteira
// (vazio): ele está no pipeline da integração.
export const CS_STAGES = ["saudavel", "atencao", "em_risco", "renovacao", "churn"];
export function csStageOf(customer, { lifecycle, followups = [] }) {
  if (lifecycle === "churn") return "churn";
  if (followups.some((f) => f.kind === "renovacao" && f.status === "aberto")) return "renovacao";
  if (lifecycle === "integracao") return "";
  const health = Number(customer.health) || 0;
  if (lifecycle === "risco" || (health > 0 && health < RISK_HEALTH)) return "em_risco";
  if (health > 0 && health < 70) return "atencao";
  return "saudavel";
}

async function inputsOf(repo, customerId) {
  const [subs, invoices, onboardings, followups] = await Promise.all([
    repo.listWhere("subscriptions", { customer: customerId }),
    repo.listWhere("invoices", { customer: customerId }),
    repo.listWhere("onboardings", { customer: customerId }),
    repo.listWhere("cs_followups", { customer: customerId }),
  ]);
  return { subs, invoices, onboardings, followups };
}

const TIMELINE_KIND = {
  lifecycle: "customer.lifecycle_changed",
  financialStatus: "customer.financial_status_changed",
  csStage: "customer.cs_stage_changed",
};

// Recalcula e grava o que mudou; devolve o cliente atualizado (ou o mesmo).
export async function refreshLifecycle(repo, customer, { now = new Date() } = {}) {
  const { subs, invoices, onboardings, followups } = await inputsOf(repo, customer.id);
  const financialStatus = financialStatusOf(subs, invoices);
  const lifecycle = lifecycleOf(customer, { subs, onboardings, financialStatus });
  const csStage = csStageOf(customer, { lifecycle, followups });
  const at = now.toISOString();
  const changes = [["lifecycle", lifecycle], ["financialStatus", financialStatus], ["csStage", csStage]].filter(([k, v]) => (customer[k] || "") !== v);
  if (!changes.length) return customer;
  for (const [field, to] of changes) {
    await appendTimeline(repo, {
      id: `tl:${field}:${customer.id}:${at}`, kind: TIMELINE_KIND[field],
      source: "cockpit", at, customer: customer.id, lead: customer.leadId || "", data: { from: customer[field] || "", to },
    });
  }
  return repo.update("customers", customer.id, { ...Object.fromEntries(changes), lifecycleAt: at }, { silent: true });
}

// Workspaces: um por produto × tenant. Vem do vínculo gravado no cliente e das
// orgs do espelho do LeverAds (inclusive as sem cliente, que ficam com
// customer vazio para o relatório de pendências).
export async function syncWorkspaces(repo, { now = new Date() } = {}) {
  const [customers, orgs, current] = await Promise.all([repo.list("customers"), repo.list("leverads_orgs"), repo.list("workspaces")]);
  const byId = new Map(current.map((w) => [w.id, w]));
  const want = new Map();
  const put = (product, tenant, patch) => {
    if (!tenant) return;
    const id = `${product}:${norm(tenant)}`;
    want.set(id, { ...(want.get(id) || { id, product, tenantId: norm(tenant), customer: "" }), ...patch });
  };
  for (const o of orgs) if (!o.gone) put("leverads", o.id, { name: o.name || "", customer: o.customerId || "", createdAt: o.createdAt || "" });
  for (const c of customers) {
    put("leverads", c.leveradsOrgId, { customer: c.id });
    put("leverprice", c.leverpriceOrgId, { customer: c.id });
  }
  let written = 0;
  for (const [id, w] of want) {
    const prev = byId.get(id);
    if (!prev) { await repo.create("workspaces", { ...w, firstSeenAt: now.toISOString() }); written++; continue; }
    const diff = Object.fromEntries(Object.entries(w).filter(([k, v]) => v && prev[k] !== v));
    if (Object.keys(diff).length) { await repo.update("workspaces", id, diff, { silent: true }); written++; }
  }
  return { workspaces: want.size, written };
}

export async function runLifecycleSweep(repo, opts = {}) {
  let changed = 0;
  for (const c of await repo.list("customers")) {
    const saved = await refreshLifecycle(repo, c, opts);
    if (saved !== c) changed++;
  }
  return { changed, ...(await syncWorkspaces(repo, opts)) };
}

export function startLifecycleSweep(repo, { log, intervalMs = 15 * 60_000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try { return await runLifecycleSweep(repo); }
    catch (err) { log?.warn?.(`ciclo de vida: ${err.message}`); return null; }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 90_000);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}
