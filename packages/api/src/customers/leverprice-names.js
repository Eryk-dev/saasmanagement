// Nome da empresa pela conta do LeverPrice (06/11/2026). Fica fora de
// leverprice-orgs.js para o ciclo de vida (lifecycle.js) chamar sem importar o
// billing, que importa o lifecycle.
//
// A mesma regra do LeverAds (leverads-orgs.js orgNamePatches) com o nome que o
// cadastro do LeverPrice informou (`leverpriceOrgLink.orgName`). O cliente
// guarda `leverpriceOrgName` (a busca lê) e, se o nome dele ainda é o da pessoa
// ("Max"), passa a ser o da empresa ("JOIAS"), com a pessoa no contato. Com
// conta do LeverAds, o nome segue a do LeverAds: aqui só o campo da busca.

import { ORG_NAME_SOURCES, orgNamePatches } from "./leverads-orgs.js";

const norm = (v) => String(v || "").trim().toLowerCase();

export function leverpriceNamePatches(customer, lead = null, nowIso = new Date().toISOString()) {
  const orgName = String(customer?.leverpriceOrgLink?.orgName || "").trim();
  if (!norm(customer?.leverpriceOrgId) || !orgName) return { customer: null, lead: null };
  if (norm(customer.leveradsOrgId)) {
    return { customer: customer.leverpriceOrgName === orgName ? null : { leverpriceOrgName: orgName }, lead: null };
  }
  return orgNamePatches(customer, { name: orgName }, lead, nowIso, ORG_NAME_SOURCES.leverprice);
}

export async function applyLeverpriceName(repo, customer, lead = null, nowIso = new Date().toISOString()) {
  const p = leverpriceNamePatches(customer, lead, nowIso);
  if (p.customer) { await repo.update("customers", customer.id, p.customer); Object.assign(customer, p.customer); }
  if (p.lead) { await repo.update("leads", lead.id, p.lead); Object.assign(lead, p.lead); }
  return !!p.customer?.name;
}

// Todo cliente com conta do LeverPrice: o vínculo novo, os antigos e os
// gravados à mão. Roda no ciclo de vida (lifecycle.js). Idempotente.
export async function syncLeverpriceNames(repo, { now = new Date() } = {}) {
  const customers = (await repo.list("customers")).filter((c) => norm(c.leverpriceOrgId) && c.leverpriceOrgLink?.orgName);
  if (!customers.length) return { renamed: 0 };
  const leadById = new Map((await repo.list("leads").catch(() => [])).map((l) => [l.id, l]));
  let renamed = 0;
  for (const c of customers) {
    if (await applyLeverpriceName(repo, c, c.leadId ? leadById.get(c.leadId) || null : null, now.toISOString())) renamed++;
  }
  return { renamed };
}
