// Espelho das orgs do LeverAds e o vínculo cliente × org.
//
// Conta nova no LeverAds não vira lead nem cliente (decisão do time: o cadastro
// não é atividade de SDR). Ela entra aqui, no espelho `leverads_orgs`, e a tela
// Clientes mostra na aba Gratuitas quem não tem venda. Não é `customers` de
// propósito: conta gratuita não entra em KPI, churn, MRR, placar nem nas
// réguas de pós-venda.
//
// O vínculo (`customer.leveradsOrgId`) nasce de três jeitos:
//   · manual, na ficha (o integrador cria a conta com o cliente na call e
//     escolhe a org entre as mais recentes) — rotas em routes.leverads-orgs.js;
//   · pelo e-mail, sozinho: o e-mail do cliente ou do lead dele é exatamente o
//     e-mail da org ou de uma conta dela (LeverId), e só esse cliente e só essa
//     org casam. Qualquer dúvida não grava. Desfazer na ficha guarda a org em
//     `orgLinkRejected` para o automático não religar;
//   · pelo cadastro do cliente (o select "Org na LeverAds" de sempre).
//
// O vínculo importa porque o sync de paywall (billing/leverads-access.js), os
// resultados, o relatório mensal e a badge de LeverId leem `leveradsOrgId`.

import { envClient } from "../billing/leverads-access.js";
import { isChurnedCustomer } from "../billing/churn.js";

export const ORGS = "leverads_orgs";
export const MIRROR_INTERVAL_MS = 10 * 60 * 1000;
const SAAS_ID = () => process.env.LEVERCOPY_SAAS_ID || "leverads";

const norm = (v) => String(v || "").trim().toLowerCase();

// E-mails de contato do cliente: o do cadastro e o do lead que virou venda.
export function customerEmails(customer, leadById) {
  const lead = customer.leadId ? leadById.get(customer.leadId) : null;
  return [...new Set([norm(customer.email), norm(lead?.email)].filter((e) => e.includes("@")))];
}

const orgEmails = (org) => new Set([norm(org.email), ...(org.members || []).map(norm)].filter((e) => e.includes("@")));

// Vínculos automáticos pelo e-mail. Só grava par 1 × 1: o cliente casa com uma
// org só, e essa org casa só com ele. Cliente encerrado, de outro produto, já
// vinculado ou que desfez esse vínculo antes fica de fora; org já vinculada
// também.
export function planEmailLinks({ orgs, customers, leads, saasId = SAAS_ID() }) {
  const leadById = new Map((leads || []).map((l) => [l.id, l]));
  const linked = new Set(customers.map((c) => norm(c.leveradsOrgId)).filter(Boolean));
  const free = orgs.filter((o) => !o.gone && !linked.has(norm(o.id)));
  const byCustomer = new Map();
  const byOrg = new Map();
  for (const c of customers) {
    if (c.saas !== saasId || norm(c.leveradsOrgId) || isChurnedCustomer(c)) continue;
    const emails = customerEmails(c, leadById);
    if (!emails.length) continue;
    const rejected = new Set((c.orgLinkRejected || []).map(norm));
    const hits = free.filter((o) => !rejected.has(norm(o.id)) && emails.some((e) => orgEmails(o).has(e)));
    if (!hits.length) continue;
    byCustomer.set(c.id, hits);
    for (const o of hits) byOrg.set(o.id, [...(byOrg.get(o.id) || []), c.id]);
  }
  const links = [];
  for (const [customerId, hits] of byCustomer) {
    if (hits.length !== 1 || byOrg.get(hits[0].id).length !== 1) continue;
    const c = customers.find((x) => x.id === customerId);
    const email = customerEmails(c, leadById).find((e) => orgEmails(hits[0]).has(e));
    links.push({ customerId, orgId: norm(hits[0].id), email });
  }
  return links;
}

// Linha do espelho a partir da org do LeverAds (+ e-mails das contas no LeverId).
function mirrorRow(org, prev, { members, nowIso }) {
  return {
    id: norm(org.id),
    name: org.name || "",
    email: norm(org.email),
    active: org.active !== false,
    paymentActive: Boolean(org.payment_active ?? org.paymentActive),
    // A rota de serviço do LeverAds manda created_at; sem ele, a primeira vez
    // que o espelho viu a org (o tick é de 10 em 10 min).
    createdAt: org.created_at || prev?.createdAt || prev?.firstSeenAt || nowIso,
    firstSeenAt: prev?.firstSeenAt || nowIso,
    members: members || prev?.members || [],
    customerId: prev?.customerId || "",
    gone: false,
  };
}

const sameRow = (a, b) => JSON.stringify({ ...a, seenAt: 0 }) === JSON.stringify({ ...b, seenAt: 0 });

async function memberEmails(identity, orgIds) {
  const out = new Map();
  if (!identity?.orgAccounts) return out;
  for (let i = 0; i < orgIds.length; i += 500) {
    const rows = await identity.orgAccounts(orgIds.slice(i, i + 500));
    for (const r of rows) {
      if (!r.user_id || !r.email) continue;
      const id = norm(r.org_id);
      out.set(id, [...(out.get(id) || []), norm(r.email)]);
    }
  }
  return out;
}

// Um tick: atualiza o espelho, grava os vínculos automáticos e marca em cada
// org o cliente ligado a ela. Devolve um resumo (sem e-mail de cliente).
export async function runLeveradsOrgMirror(repo, { client, identity = null, now = () => new Date(), log } = {}) {
  const nowIso = now().toISOString();
  const orgs = (await client.listOrgs()).filter((o) => o?.id);
  let members = new Map();
  try { members = await memberEmails(identity, orgs.map((o) => norm(o.id))); }
  catch (err) { log?.warn?.({ err: err.message }, "leverads-orgs: contas do LeverId indisponíveis (segue só com o e-mail da org)"); }

  const prevRows = await repo.list(ORGS).catch(() => []);
  const prevById = new Map(prevRows.map((r) => [r.id, r]));
  const rows = new Map();
  for (const o of orgs) {
    const id = norm(o.id);
    rows.set(id, mirrorRow(o, prevById.get(id), { members: members.get(id), nowIso }));
  }
  for (const prev of prevRows) if (!rows.has(prev.id)) rows.set(prev.id, { ...prev, gone: true });

  const customers = await repo.list("customers");
  const leads = await repo.list("leads").catch(() => []);
  const links = planEmailLinks({ orgs: [...rows.values()], customers, leads });
  for (const l of links) {
    await repo.update("customers", l.customerId, { leveradsOrgId: l.orgId, orgLink: { via: "email", email: l.email, at: nowIso } });
    const c = customers.find((x) => x.id === l.customerId);
    if (c) { c.leveradsOrgId = l.orgId; }
  }

  const customerByOrg = new Map();
  for (const c of customers) if (norm(c.leveradsOrgId)) customerByOrg.set(norm(c.leveradsOrgId), c.id);
  let created = 0;
  let updated = 0;
  for (const row of rows.values()) {
    row.customerId = customerByOrg.get(row.id) || "";
    const prev = prevById.get(row.id);
    if (!prev) { await repo.create(ORGS, { ...row, seenAt: nowIso }); created++; }
    else if (!sameRow(prev, row)) { await repo.update(ORGS, row.id, { ...row, seenAt: nowIso }); updated++; }
  }
  const live = [...rows.values()].filter((r) => !r.gone && r.active);
  const report = {
    at: nowIso,
    orgs: live.length,
    linked: live.filter((r) => r.customerId).length,
    free: live.filter((r) => !r.customerId && !r.paymentActive).length,
    payingWithoutCustomer: live.filter((r) => !r.customerId && r.paymentActive).length,
    autoLinked: links.length,
    created, updated,
  };
  if (links.length || created) log?.info?.(report, "leverads-orgs: espelho atualizado");
  return report;
}

// Executor com uma rodada por vez (o tick do intervalo e o "atualizar" da
// ficha dividem a mesma promessa).
export function makeLeveradsOrgMirror(repo, { client = null, identity = null, log } = {}) {
  const cli = client || envClient();
  let running = null;
  let last = null;
  return {
    configured: () => cli.configured(),
    last: () => last,
    run() {
      running ||= runLeveradsOrgMirror(repo, { client: cli, identity, log })
        .then((r) => { last = r; return r; })
        .finally(() => { running = null; });
      return running;
    },
  };
}

export function startLeveradsOrgMirror(mirror, { log, intervalMs = MIRROR_INTERVAL_MS } = {}) {
  if (!mirror.configured()) {
    log?.info?.("leverads-orgs: desligado (sem LEVERADS_SERVICE_KEY nem LEVERADS_ADMIN_*)");
    return () => {};
  }
  const tick = () => mirror.run().catch((err) => log?.warn?.({ err: err.message }, "leverads-orgs: tick falhou"));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
