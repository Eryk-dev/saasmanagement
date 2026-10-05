// Ambiente da API (APP_ENV) e as travas de boot fora de produção.
//
// `local` (máquina do dev), `dev` (ambiente de dev isolado) e `production`.
// Sem APP_ENV, a imagem Docker (NODE_ENV=production) conta como produção e o
// resto como local — assim um checkout sem .env nunca é tratado como prod.
//
// Fora de produção a API se RECUSA a subir quando algum destino aponta para
// produção: banco (COCKPIT_DB_URL, LEVERCOPY_DB_URL, ELO_DB_URL) ou a API do
// LeverAds. É a primeira camada do docs/PLANO-AMBIENTE-DEV.md; o firewall de
// saída da VPS de dev é a segunda.
//
// Jobs de fundo (index.js): em produção todos ligados; fora dela, nenhum, a
// menos que JOBS_ENABLED=1 (todos) ou JOBS=nome,nome (lista). JOBS_ENABLED=0
// desliga todos também em produção.

export const APP_ENVS = ["local", "dev", "production"];

// Pedaços de host que só existem em produção. PROD_HOSTS (vírgula) acrescenta
// outros sem precisar de deploy.
const PROD_HOST_MARKERS = [
  "hsooljludhobvsznvnir", // projeto do Supabase Cloud (levercopy)
  "pooler.supabase.com", // pooler do Supabase Cloud
  "supabase.co",
  "187.127.52.46", // VPS1 (LeverPrice)
  // A VPS2 (82.112.245.65) fica de fora: o dev interino mora nela
  // (docs/PLANO-DEV-INTERINO-VPS2.md) e nenhum banco do Cockpit está lá.
  "lp-tunnel", // túnel da VPS2 para o Postgres da VPS1
];
const DB_VARS = ["COCKPIT_DB_URL", "LEVERCOPY_DB_URL", "ELO_DB_URL"];
// URLs HTTP de outros produtos: produção é o domínio sem o prefixo `dev.`.
const PROD_APP_DOMAINS = ["leverads.com.br", "leverprice.com.br", "levermoney.com.br"];
const APP_URL_VARS = ["LEVERADS_API_URL", "LEVERCOPY_API_URL", "AUTH_JWKS_URL", "IDENTITY_AUTH_URL", "IDENTITY_REST_URL"];

export function resolveAppEnv(env = process.env) {
  const raw = String(env.APP_ENV || "").trim().toLowerCase();
  if (!raw) return env.NODE_ENV === "production" ? "production" : "local";
  if (!APP_ENVS.includes(raw)) throw new Error(`APP_ENV=${env.APP_ENV} inválido (use ${APP_ENVS.join(", ")})`);
  return raw;
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

// Lista dos destinos de produção encontrados no env (só nome da variável e
// host — nunca a URL, que carrega a senha).
export function prodTargets(env = process.env) {
  const markers = [...PROD_HOST_MARKERS, ...String(env.PROD_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)];
  const found = [];
  for (const name of DB_VARS) {
    const value = String(env[name] || "");
    if (!value) continue;
    const host = hostOf(value);
    // Sem host legível (DSN fora do formato URL), procura no texto inteiro.
    const haystack = host || value.toLowerCase();
    const hit = markers.find((m) => haystack.includes(m));
    if (hit) found.push(`${name} (${host || hit})`);
  }
  for (const name of APP_URL_VARS) {
    const host = hostOf(String(env[name] || ""));
    if (!host) continue;
    const prod = PROD_APP_DOMAINS.some((d) => host === d || (host.endsWith(`.${d}`) && !host.startsWith("dev.")))
      || markers.some((m) => host.includes(m));
    if (prod) found.push(`${name} (${host})`);
  }
  return found;
}

// Chamado no boot, antes do initDb(): lança erro fora de produção se o env
// aponta para produção. Devolve o ambiente resolvido.
export function assertSafeBoot(env = process.env) {
  const appEnv = resolveAppEnv(env);
  if (appEnv === "production") return appEnv;
  const found = prodTargets(env);
  if (found.length) {
    throw new Error(`APP_ENV=${appEnv} com destino de produção no env: ${found.join(", ")}. Aponte para o banco/API de dev.`);
  }
  return appEnv;
}

// Decide se um job de fundo sobe (ver cabeçalho).
export function makeJobGate(env = process.env) {
  const appEnv = resolveAppEnv(env);
  const flag = String(env.JOBS_ENABLED ?? "").trim();
  const list = new Set(String(env.JOBS || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (flag === "0") return () => false;
  if (flag === "1") return () => true;
  if (list.size) return (name) => list.has(name);
  return () => appEnv === "production";
}
