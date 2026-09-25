// CORS: rota aberta (formulário, proposta, portal, webhook…) aceita qualquer
// origem, porque já é pública; o resto só as origens do próprio cockpit
// (COCKPIT_PUBLIC_URL, PUBLIC_BASE_URL) e as de CORS_ORIGINS (vírgula). O SPA
// é servido no mesmo host (nginx allinone / proxy do Vite), então não depende
// de CORS. Devolve o `delegator` do @fastify/cors.
export function makeCorsDelegator({ env = process.env, isOpenPath }) {
  const allowed = new Set([env.COCKPIT_PUBLIC_URL, env.PUBLIC_BASE_URL, ...String(env.CORS_ORIGINS || "").split(",")]
    .map((u) => { try { return new URL(String(u || "").trim()).origin; } catch { return ""; } })
    .filter(Boolean));
  return (req, cb) => {
    const origin = req.headers.origin;
    const ok = origin && (allowed.has(origin) || isOpenPath(req.url.split("?")[0]));
    cb(null, { origin: ok ? origin : false });
  };
}
