// Quem do cliente já tem LeverId (a badge da tela Clientes). A org do cliente
// no LeverId tem o mesmo id da org no LeverAds (docs/PLANO-AUTH.md: a carga
// preserva os ids), então vale `customer.orgId` e, enquanto ele não existe,
// `customer.leveradsOrgId`.
//
// Cache por org de 60 s: a lista de clientes pede todas as orgs de uma vez e a
// ficha pede a mesma org de novo logo depois; a identidade só é chamada para as
// orgs que faltam, numa chamada só.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEVERID_TTL_MS = 60_000;
export const LEVERID_MAX_ORGS = 500;

export const customerOrgId = (customer) => String(customer?.orgId || customer?.leveradsOrgId || "").trim().toLowerCase();

// Ids válidos, sem repetição, em minúsculas (o cadastro tem lixo no campo).
export function parseOrgIds(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => UUID.test(x)))];
}

// Linhas do LeverId → { [orgId]: { name, status, accounts: [...] } }.
export function groupOrgAccounts(rows) {
  const out = {};
  for (const r of rows) {
    const id = String(r.org_id).toLowerCase();
    out[id] ||= { name: r.org_name || "", status: r.org_status || "", accounts: [] };
    if (!r.user_id) continue;
    out[id].accounts.push({
      id: r.user_id,
      email: r.email || "",
      role: r.role || "",
      createdAt: r.created_at || null,
      lastSignInAt: r.last_sign_in_at || null,
      emailConfirmed: !!r.email_confirmed,
      mfa: !!r.mfa,
      source: r.source || "",
    });
  }
  return out;
}

export function makeLeverIdAccounts({ identity, ttl = LEVERID_TTL_MS, now = Date.now }) {
  const cache = new Map(); // orgId -> { at, value } (value null = org não existe no LeverId)
  return {
    configured: !!identity,
    async forOrgs(orgIds) {
      const ids = parseOrgIds(orgIds).slice(0, LEVERID_MAX_ORGS);
      const missing = ids.filter((id) => { const hit = cache.get(id); return !hit || now() - hit.at >= ttl; });
      if (missing.length && identity) {
        const grouped = groupOrgAccounts(await identity.orgAccounts(missing));
        const at = now();
        for (const id of missing) cache.set(id, { at, value: grouped[id] || null });
      }
      const orgs = {};
      for (const id of ids) {
        const value = cache.get(id)?.value;
        if (value) orgs[id] = value;
      }
      return orgs;
    },
  };
}
