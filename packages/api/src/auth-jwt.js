// Token da identidade central (lever-identity / GoTrue) — docs/PLANO-AUTH.md.
//
// AUTH_MODE decide o que o hook de auth aceita:
//   legacy  (padrão) só a sessão própria (scrypt + `sessions`) e a key mestre;
//   dual    sessão própria OU `Authorization: Bearer <jwt>` do GoTrue;
//   gotrue  só o JWT (e a key mestre, que é do MCP/integrações, não do login).
//
// O JWT é validado localmente pelo JWKS (AUTH_JWKS_URL), sem chamar a
// identidade por requisição: só ES256, `kid` publicado, assinatura, `exp`/`nbf`
// e `aud`. Entra no cockpit só staff (`is_staff`) da org interna Lever cujo
// `sub` está ligado a um usuário daqui (`users.authUserId`). O papel, as telas
// e o supportSaas continuam vindo de `cockpit.users` — a conferência com o
// banco local é permanente (decisão 7 do plano).

import { createPublicKey, verify as verifySignature } from "node:crypto";

export const AUTH_MODES = ["legacy", "dual", "gotrue"];
// Org interna "Lever" do lever-identity (private.lever_org_id()).
export const LEVER_ORG_ID = "00000000-0000-4000-8000-00000000000a";
const JWKS_TTL_MS = 10 * 60 * 1000;
// Com `kid` desconhecido (chave rotacionada), busca o JWKS de novo no máximo
// uma vez por este intervalo — token forjado não vira enxurrada de fetch.
const JWKS_REFETCH_MIN_MS = 30 * 1000;
const CLOCK_SKEW_S = 30;

export function resolveAuthMode(env = process.env) {
  const mode = String(env.AUTH_MODE || "legacy").trim().toLowerCase();
  if (!AUTH_MODES.includes(mode)) throw new Error(`AUTH_MODE=${env.AUTH_MODE} inválido (use ${AUTH_MODES.join(", ")})`);
  if (mode !== "legacy" && !env.AUTH_JWKS_URL) throw new Error(`AUTH_MODE=${mode} exige AUTH_JWKS_URL`);
  return mode;
}

// Formato de JWT (três partes base64url). A sessão própria é hex de 64.
export const looksLikeJwt = (token) => /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(String(token || ""));

const b64json = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

// Cache do JWKS por URL. `fetchImpl` é injetável nos testes.
export function makeJwksCache({ url, fetchImpl = fetch, now = () => Date.now() }) {
  let keys = new Map();
  let fetchedAt = 0;
  let inflight = null;
  async function load() {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const body = await res.json();
    const next = new Map();
    for (const jwk of body?.keys || []) {
      if (jwk.kty !== "EC" || jwk.alg !== "ES256" || !jwk.kid) continue;
      next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
    }
    keys = next;
    fetchedAt = now();
  }
  const refresh = () => (inflight ||= load().finally(() => { inflight = null; }));
  return {
    async get(kid) {
      if (!fetchedAt || now() - fetchedAt > JWKS_TTL_MS) await refresh();
      if (!keys.has(kid) && now() - fetchedAt > JWKS_REFETCH_MIN_MS) await refresh();
      return keys.get(kid) || null;
    },
  };
}

// Valida assinatura e tempo; devolve os claims ou lança com o motivo.
export async function verifyJwt(token, { jwks, audience = "authenticated", issuer = "", now = () => Date.now() }) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("formato");
  let header, claims;
  try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw new Error("formato"); }
  if (header.alg !== "ES256") throw new Error(`alg ${header.alg}`);
  const key = await jwks.get(header.kid);
  if (!key) throw new Error("kid desconhecido");
  const ok = verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new Error("assinatura");
  const t = Math.floor(now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < t) throw new Error("expirado");
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > t) throw new Error("ainda não vale");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new Error("aud");
  if (issuer && claims.iss !== issuer) throw new Error("iss");
  if (!claims.sub) throw new Error("sem sub");
  return claims;
}

// Resolve o usuário do cockpit a partir do JWT (null = negado; o motivo vai
// pro log). `findUser(sub)` busca em cockpit.users pelo authUserId.
export function makeJwtResolver({ jwks, findUser, staffOrgId = LEVER_ORG_ID, audience, issuer, log }) {
  return async (token) => {
    let claims;
    try {
      claims = await verifyJwt(token, { jwks, audience, issuer });
    } catch (err) {
      log?.warn?.(`auth jwt: recusado (${err.message})`);
      return null;
    }
    if (claims.is_staff !== true || claims.org_id !== staffOrgId) {
      log?.warn?.(`auth jwt: ${claims.sub} não é staff da org Lever`);
      return null;
    }
    const user = await findUser(claims.sub);
    if (!user) {
      log?.warn?.(`auth jwt: ${claims.sub} sem usuário ligado no cockpit (authUserId)`);
      return null;
    }
    return user;
  };
}
