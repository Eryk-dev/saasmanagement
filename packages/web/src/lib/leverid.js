// Quem do cliente já tem LeverId (badge da tela Clientes). A org do cliente no
// LeverId tem o mesmo id da org do LeverAds: vale `orgId` e, enquanto ele não
// existe, `leveradsOrgId` (mesma regra do customers/leverid-accounts.js da API).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const customerOrgId = (c) => {
  const id = String(c?.orgId || c?.leveradsOrgId || "").trim().toLowerCase();
  return UUID.test(id) ? id : "";
};

// Em lotes de 100 para a URL não passar do limite do proxy. `fetchPage` é o
// api.leveridOrgs (quem chama passa, para a prévia trocar pelo mock).
export async function fetchLeverIdOrgs(orgIds, fetchPage) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = { configured: true, orgs: {} };
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetchPage(ids.slice(i, i + 100));
    if (!res?.configured) return { configured: false, orgs: {} };
    Object.assign(out.orgs, res.orgs || {});
  }
  return out;
}
