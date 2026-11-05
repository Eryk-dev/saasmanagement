// Resultados do LeverPrice de UM cliente (visão Resultados da Carteira,
// 05/11/2026). O número mora no produto, então quem responde é a rota de
// serviço DELE, nunca SQL no banco dele (mesma regra da liberação de acesso,
// billing/leverprice-access.js):
//
//   GET {LEVERPRICE_API_URL || LEVERPRICE_APP_URL}/api/service/cockpit/orgs/:id/results?months=12
//   header X-Cockpit-Service-Key = LEVERPRICE_SERVICE_KEY
//
// Resposta (o LeverPrice define; as definições são as da Home dele):
//   total / last30 / prev30 / monthly[] com sales (vendido com preço do
//   LeverPrice, venda atribuída ao robô), rebate (rebate confirmado
//   recuperado), orders, units; last30 traz também automatic_promotions e
//   automatic_price_changes; since, retenção, contas sincronizadas e partial.
//
// Cache por org de 1 h, no espírito do leverads-results.js: fresco devolve
// direto; vencido devolve o último bom e recalcula por fora; frio espera uma
// vez (é a tela de um cliente). Falha nunca derruba a tela: sem nada em cache,
// devolve indisponível com o motivo em uma frase.

export const LEVERPRICE_RESULTS_TTL_MS = 3_600_000;
export const LEVERPRICE_RESULTS_TIMEOUT_MS = 5_000;
export const NOT_CONFIGURED_REASON = "integração com o LeverPrice não configurada";
const MAX_ORGS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LeverpriceResultsError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export function makeLeverpriceResultsClient({
  baseUrl = "", serviceKey = "", fetchImpl = (...a) => fetch(...a), timeoutMs = LEVERPRICE_RESULTS_TIMEOUT_MS,
} = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return {
    configured: () => Boolean(base && serviceKey),
    async results(orgId, { months = 12 } = {}) {
      const url = `${base}/api/service/cockpit/orgs/${encodeURIComponent(orgId)}/results?months=${months}`;
      let res;
      try {
        res = await fetchImpl(url, {
          headers: { Accept: "application/json", "X-Cockpit-Service-Key": serviceKey },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
        throw new LeverpriceResultsError(timeout ? "o LeverPrice não respondeu a tempo" : "não consegui falar com o LeverPrice");
      }
      if (!res.ok) throw new LeverpriceResultsError(`HTTP ${res.status}`, res.status);
      try { return await res.json(); }
      catch { throw new LeverpriceResultsError("resposta inválida do LeverPrice"); }
    },
  };
}

// A API mora no mesmo host do app (o link de cadastro usa LEVERPRICE_APP_URL).
export function envLeverpriceResultsClient(env = process.env) {
  return makeLeverpriceResultsClient({
    baseUrl: env.LEVERPRICE_API_URL || env.LEVERPRICE_APP_URL || "https://leverprice.com.br",
    serviceKey: env.LEVERPRICE_SERVICE_KEY || "",
  });
}

// Erro → frase curta pra tela.
export function reasonOf(err) {
  const s = Number(err?.status) || 0;
  if (s === 404) return "org não encontrada no LeverPrice";
  if (s === 401 || s === 403) return "o LeverPrice recusou a chave do Cockpit";
  if (s === 400) return "org do LeverPrice inválida no cadastro";
  if (s) return "LeverPrice indisponível agora";
  return err?.message && err instanceof LeverpriceResultsError ? err.message : "LeverPrice indisponível agora";
}

let cache = new Map();         // org → { data, at }
const inFlight = new Map();

// Devolve { status: "ok", data, at, stale? } ou { status: "indisponivel", reason }.
// `data` é o corpo da rota do LeverPrice, como veio.
export async function leverpriceResults(orgId, {
  client = envLeverpriceResultsClient(), months = 12, now = Date.now, ttlMs = LEVERPRICE_RESULTS_TTL_MS, log = console,
} = {}) {
  const org = String(orgId || "").trim().toLowerCase();
  if (!UUID_RE.test(org)) return { status: "indisponivel", reason: "org do LeverPrice inválida no cadastro" };
  if (!client?.configured?.()) return { status: "indisponivel", reason: NOT_CONFIGURED_REASON };
  const key = `${org}:${months}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at <= ttlMs) return { status: "ok", data: hit.data, at: hit.at };
  const run = () => {
    if (inFlight.has(key)) return inFlight.get(key);
    const p = (async () => {
      try {
        const data = await client.results(org, { months });
        if (!data || typeof data !== "object") throw new LeverpriceResultsError("resposta inválida do LeverPrice");
        const at = now();
        if (!cache.has(key) && cache.size >= MAX_ORGS) cache.delete(cache.keys().next().value);
        cache.set(key, { data, at });
        return { status: "ok", data, at };
      } catch (e) {
        log?.warn?.(`[leverprice-results] ${org}: ${e.message}`);
        const old = cache.get(key);
        return old ? { status: "ok", data: old.data, at: old.at, stale: true } : { status: "indisponivel", reason: reasonOf(e) };
      } finally { inFlight.delete(key); }
    })();
    inFlight.set(key, p);
    return p;
  };
  if (hit) { run(); return { status: "ok", data: hit.data, at: hit.at, stale: true }; }
  return run();
}

// Só pros testes.
export function _resetLeverpriceResultsCache() {
  cache = new Map();
  inFlight.clear();
}
