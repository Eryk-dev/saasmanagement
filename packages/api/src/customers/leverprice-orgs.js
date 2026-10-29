// Vínculo cliente × org do LeverPrice (`customer.leverpriceOrgId`), pelo aviso
// do cadastro do LeverPrice (POST /public/leverprice/org-created, rota em
// routes.leverprice-orgs.js).
//
// O LeverPrice não tem espelho de orgs aqui (o do LeverAds é leverads-orgs.js):
// o aviso traz tudo o que o vínculo precisa — a org LOCAL do LeverPrice, a org
// no LeverId (só informação), o convite usado, o e-mail do dono e o nome.
//
//   · com convite: o convite é o do link de cadastro da ficha
//     (`customer.signupInvite.token`, o mesmo do LeverAds; a URL do LeverPrice
//     é LEVERPRICE_APP_URL/cadastro?convite=...). Casa 1 × 1 e vale mesmo com
//     outro e-mail. Convite que é de um cliente, mas não liga (já vinculado,
//     recusou essa org), não cai no e-mail: o convite disse de quem é a conta;
//   · sem convite (ou convite que ninguém tem): pelo e-mail, só quando ele é
//     exatamente o de UM cliente cujo negócio inclui o LeverPrice, sem org do
//     LeverPrice e não encerrado. Qualquer dúvida não grava.
// Org que já está em outro cliente não é gravada de novo. `leveradsOrgId` e
// `orgId` não são tocados.

import crypto from "node:crypto";
import { isChurnedCustomer } from "../billing/churn.js";
import { customerEmails } from "./leverads-orgs.js";
import { signupProductsOf } from "../shared/signup-products.js";

const norm = (v) => String(v || "").trim().toLowerCase();
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Chave do aviso: LEVERPRICE_SERVICE_KEY (própria, separada da do LeverAds),
// comparada em tempo constante. Sem a env, ninguém passa.
export function leverpriceServiceKeyOk(given, env = process.env) {
  const want = String(env.LEVERPRICE_SERVICE_KEY || "");
  const got = String(given || "");
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const rejected = (c, orgId) => (c.leverpriceOrgLinkRejected || []).map(norm).includes(orgId);

// Decide o vínculo (puro). Devolve { customerId, via } ou { customerId: "", reason }.
export function planLeverpriceLink({ orgId, invite, email, customers, leads = [], plans = [] }) {
  const id = norm(orgId);
  const owner = customers.find((c) => norm(c.leverpriceOrgId) === id);
  if (owner) return { customerId: "", reason: "org_taken", ownerId: owner.id };

  const token = String(invite || "").trim();
  if (token) {
    const byToken = customers.filter((c) => String(c.signupInvite?.token || "") === token);
    if (byToken.length > 1) return { customerId: "", reason: "invite_ambiguous" };
    if (byToken.length === 1) {
      const c = byToken[0];
      if (norm(c.leverpriceOrgId)) return { customerId: "", reason: "customer_linked" };
      if (rejected(c, id)) return { customerId: "", reason: "rejected" };
      return { customerId: c.id, via: "convite" };
    }
  }

  const mail = norm(email);
  if (!mail.includes("@")) return { customerId: "", reason: token ? "invite_unknown" : "no_email" };
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const hits = customers.filter((c) => !norm(c.leverpriceOrgId) && !isChurnedCustomer(c) && !rejected(c, id)
    && customerEmails(c, leadById).includes(mail)
    && signupProductsOf({ customer: c, lead: c.leadId ? leadById.get(c.leadId) : null, plans }).includes("leverprice"));
  if (hits.length !== 1) return { customerId: "", reason: hits.length ? "email_ambiguous" : "email_unknown" };
  return { customerId: hits[0].id, via: "email" };
}

// Aviso do cadastro do LeverPrice: grava o vínculo quando não há dúvida. Loga
// o resultado sem o e-mail.
export async function handleLeverpriceOrgCreated(repo, { orgId, coreOrgId = null, invite = null, email = "", name = "", now = () => new Date(), log } = {}) {
  const id = norm(orgId);
  const customers = await repo.list("customers");
  const leads = await repo.list("leads").catch(() => []);
  const plans = await repo.list("plans").catch(() => []);
  const plan = planLeverpriceLink({ orgId: id, invite, email, customers, leads, plans });
  const core = UUID.test(norm(coreOrgId)) ? norm(coreOrgId) : null;
  if (!plan.customerId) {
    log?.info?.({ org: id, reason: plan.reason, invite: !!invite }, "leverprice-orgs: org criada sem vínculo");
    return { linked: false, reason: plan.reason };
  }
  const link = { via: plan.via, at: now().toISOString(), coreOrgId: core };
  const orgName = String(name || "").trim();
  if (orgName) link.orgName = orgName;
  await repo.update("customers", plan.customerId, { leverpriceOrgId: id, leverpriceOrgLink: link });
  log?.info?.({ org: id, customer: plan.customerId, via: plan.via }, "leverprice-orgs: conta nova vinculada no cadastro");
  return { linked: true, customer: plan.customerId, via: plan.via };
}
