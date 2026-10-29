// Espelho das orgs do LeverAds e o vínculo cliente × org.
//
// Conta nova no LeverAds não vira lead nem cliente (decisão do time: o cadastro
// não é atividade de SDR). Ela entra aqui, no espelho `leverads_orgs`, e a tela
// Clientes mostra na aba Gratuitas quem não tem venda. Não é `customers` de
// propósito: conta gratuita não entra em KPI, churn, MRR, placar nem nas
// réguas de pós-venda.
//
// O vínculo (`customer.leveradsOrgId`) nasce de quatro jeitos:
//   · pelo convite: a ficha gera o link de cadastro da venda
//     (LEVERADS_APP_URL/signup?convite=...), o cadastro do LeverAds guarda o
//     convite na org (`cockpit_invite`) e avisa aqui (POST
//     /public/leverads/org-created). Convite é exato: vale mesmo quando o
//     cliente se cadastra com outro e-mail;
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

import crypto from "node:crypto";
import { envClient, syncLeveradsAccessNow } from "../billing/leverads-access.js";
import { isChurnedCustomer } from "../billing/churn.js";
import { signupProductLabel, signupProductsOf } from "../shared/signup-products.js";

export const ORGS = "leverads_orgs";
export const MIRROR_INTERVAL_MS = 10 * 60 * 1000;
const SAAS_ID = () => process.env.LEVERCOPY_SAAS_ID || "leverads";

const norm = (v) => String(v || "").trim().toLowerCase();

// ── Convite do link de cadastro ─────────────────────────────────────────────
// O mesmo formato que o cadastro do LeverAds aceita ([A-Za-z0-9_-]{16,128}).
export const newInviteToken = () => `cvt_${crypto.randomBytes(18).toString("base64url")}`;
export const signupUrl = (token, env = process.env) =>
  `${String(env.LEVERADS_APP_URL || "https://leverads.com.br").replace(/\/+$/, "")}/signup?convite=${encodeURIComponent(token)}`;

// O LeverPrice aceita o MESMO convite na página de cadastro dele (um convite
// por cliente; a URL muda por produto). O cadastro avisa em
// /public/leverprice/org-created (leverprice-orgs.js).
export const leverpriceSignupUrl = (token, env = process.env) =>
  `${String(env.LEVERPRICE_APP_URL || "https://leverprice.com.br").replace(/\/+$/, "")}/cadastro?convite=${encodeURIComponent(token)}`;

const SIGNUP_URL = { leverads: signupUrl, leverprice: leverpriceSignupUrl };

// Um link por produto com página de cadastro (shared/signup-products.js).
export const signupLinksOf = (token, products, env = process.env) =>
  products.filter((p) => SIGNUP_URL[p]).map((product) => ({ product, label: signupProductLabel(product), url: SIGNUP_URL[product](token, env) }));

// Convite do cliente (cria na primeira vez; `rotate` troca o antigo, que deixa
// de vincular). Devolve o que a ficha mostra: um link por produto do negócio
// (`links`) e, por compatibilidade, o primeiro deles em `url`.
export async function ensureSignupInvite(repo, customer, { rotate = false, now = () => new Date(), env = process.env } = {}) {
  let invite = customer.signupInvite;
  if (!invite?.token || rotate) {
    invite = { token: newInviteToken(), createdAt: now().toISOString() };
    await repo.update("customers", customer.id, { signupInvite: invite });
  }
  const lead = customer.leadId ? await repo.get("leads", customer.leadId).catch(() => null) : null;
  const plans = await repo.list("plans").catch(() => []);
  const links = signupLinksOf(invite.token, signupProductsOf({ customer, lead, plans }), env);
  return { token: invite.token, url: links[0]?.url || signupUrl(invite.token, env), createdAt: invite.createdAt || "", links };
}

// Vínculos pelo convite: a org guardou o convite de UM cliente. Cliente já
// vinculado, que desfez esse vínculo, de outro produto ou org já vinculada
// ficam de fora, como no e-mail.
export function planInviteLinks({ orgs, customers, saasId = SAAS_ID() }) {
  const linked = new Set(customers.map((c) => norm(c.leveradsOrgId)).filter(Boolean));
  const byToken = new Map();
  for (const c of customers) {
    const token = String(c.signupInvite?.token || "");
    if (!token || c.saas !== saasId || norm(c.leveradsOrgId)) continue;
    byToken.set(token, byToken.has(token) ? null : c);
  }
  const links = [];
  const used = new Set();
  for (const o of orgs) {
    const token = String(o.invite || "");
    if (!token || o.gone || linked.has(norm(o.id))) continue;
    const c = byToken.get(token);
    if (!c || used.has(c.id) || (c.orgLinkRejected || []).map(norm).includes(norm(o.id))) continue;
    used.add(c.id);
    links.push({ customerId: c.id, orgId: norm(o.id) });
  }
  return links;
}

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

// Nome da empresa pela conta do LeverAds (22/10/2026): o cliente nasce com o
// nome da pessoa do lead ("Luciana") e se cadastra no LeverAds como empresa
// ("Via Original"); a busca do cockpit só achava "Luciana" e alguém renomeava à
// mão. Vinculado, o cliente guarda o nome da org (`leveradsOrgName`, que a busca
// lê) e, se o nome dele ainda é o da pessoa (vazio, igual ao contato ou ao lead,
// ou o primeiro nome deles), passa a ser o da empresa, com a pessoa no contato.
// Nome de empresa dado à mão não é tocado; nome que já veio da org acompanha a
// org quando ela é renomeada no LeverAds. O lead da venda ganha a empresa
// quando está sem.
export function orgNamePatches(customer, org, lead = null, nowIso = new Date().toISOString()) {
  const orgName = String(org?.name || "").trim();
  if (!orgName) return { customer: null, lead: null };
  const patch = {};
  if (customer.leveradsOrgName !== orgName) patch.leveradsOrgName = orgName;
  const name = norm(customer.name);
  const people = [customer.contact, lead?.name].map(norm).filter(Boolean);
  const personal = !name || people.some((p) => p === name || p.startsWith(`${name} `));
  const followsOrg = customer.nameFrom?.via === "leverads_org" && name === norm(customer.leveradsOrgName);
  if ((personal || followsOrg) && name !== norm(orgName)) {
    patch.name = orgName;
    if (!customer.contact && customer.name) patch.contact = customer.name;
    patch.nameFrom = { via: "leverads_org", previous: customer.name || "", at: nowIso };
  }
  return {
    customer: Object.keys(patch).length ? patch : null,
    lead: lead && !String(lead.company || "").trim() ? { company: orgName } : null,
  };
}

export async function applyOrgName(repo, customer, org, lead, nowIso = new Date().toISOString()) {
  const p = orgNamePatches(customer, org, lead, nowIso);
  if (p.customer) { await repo.update("customers", customer.id, p.customer); Object.assign(customer, p.customer); }
  if (p.lead) { await repo.update("leads", lead.id, p.lead); Object.assign(lead, p.lead); }
  return !!p.customer?.name;
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
    // Convite do link de cadastro que a org usou (rota de serviço, migration
    // 240 do LeverAds); vazio no login de super admin ou sem convite.
    invite: String(org.cockpit_invite || ""),
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
  const inviteLinks = planInviteLinks({ orgs: [...rows.values()], customers });
  for (const l of inviteLinks) {
    await repo.update("customers", l.customerId, { leveradsOrgId: l.orgId, orgLink: { via: "convite", at: nowIso } });
    const c = customers.find((x) => x.id === l.customerId);
    if (c) { c.leveradsOrgId = l.orgId; }
  }
  // O e-mail roda depois e já vê os vínculos do convite.
  const emailLinks = planEmailLinks({ orgs: [...rows.values()], customers, leads });
  for (const l of emailLinks) {
    await repo.update("customers", l.customerId, { leveradsOrgId: l.orgId, orgLink: { via: "email", email: l.email, at: nowIso } });
    const c = customers.find((x) => x.id === l.customerId);
    if (c) { c.leveradsOrgId = l.orgId; }
  }
  const links = [...inviteLinks, ...emailLinks];

  // Nome da empresa em todo cliente vinculado (o vínculo novo, os antigos e a
  // org renomeada no LeverAds); ver orgNamePatches.
  const leadById = new Map(leads.map((l) => [l.id, l]));
  let renamed = 0;
  for (const c of customers) {
    const row = rows.get(norm(c.leveradsOrgId));
    if (!row || row.gone) continue;
    if (await applyOrgName(repo, c, row, c.leadId ? leadById.get(c.leadId) || null : null, nowIso)) renamed++;
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
    inviteLinked: inviteLinks.length,
    renamed,
    created, updated,
  };
  if (links.length || created || renamed) log?.info?.(report, "leverads-orgs: espelho atualizado");
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

// Aviso do cadastro do LeverAds (POST /public/leverads/org-created): relê as
// orgs (vincula pelo convite ou pelo e-mail) e, se a conta nova ganhou cliente,
// roda o sync de acesso na hora — o plano chega sem esperar os 10 min.
export async function handleOrgCreated(repo, mirror, { orgId, log, syncAccess = syncLeveradsAccessNow } = {}) {
  const report = await mirror.run();
  const id = norm(orgId);
  const customer = id ? (await repo.list("customers")).find((c) => norm(c.leveradsOrgId) === id) : null;
  if (!customer) return { linked: false, mirror: report };
  const access = await syncAccess(repo, { log });
  log?.info?.({ org: id, customer: customer.id, via: customer.orgLink?.via }, "leverads-orgs: conta nova vinculada no cadastro");
  return { linked: true, customer: customer.id, access: access ? { mode: access.mode, limits: access.limits?.mode } : null };
}

// Chave do aviso: a mesma LEVERADS_SERVICE_KEY com que o cockpit chama o
// LeverAds (lá, COCKPIT_SERVICE_KEY), comparada em tempo constante.
export function serviceKeyOk(given, env = process.env) {
  const want = String(env.LEVERADS_SERVICE_KEY || "");
  const got = String(given || "");
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
