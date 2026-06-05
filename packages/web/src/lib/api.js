// Thin API client for the cockpit web app. In dev, VITE_API_BASE is empty and
// Vite proxies /api -> the Fastify server. For a remote build, set VITE_API_BASE.
//
// Auth: when the API requires a key, it's entered once in the unlock screen and
// kept in localStorage; every request carries it as `x-api-key`. VITE_API_KEY is
// a build-time fallback (mostly for local dev convenience).

const BASE = import.meta.env.VITE_API_BASE || "";
const STORAGE_KEY = "cockpit_key";

export function getKey() {
  try { return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_API_KEY || ""; }
  catch { return import.meta.env.VITE_API_KEY || ""; }
}
export function setKey(k) { try { localStorage.setItem(STORAGE_KEY, k); } catch { /* ignore */ } }
export function clearKey() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const key = getKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`API ${method} ${path} -> ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  bootstrap: () => req("GET", "/api/bootstrap"),
  list: (collection, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return req("GET", `/api/${collection}${qs ? `?${qs}` : ""}`);
  },
  get: (collection, id) => req("GET", `/api/${collection}/${id}`),
  create: (collection, obj) => req("POST", `/api/${collection}`, obj),
  update: (collection, id, patch) => req("PATCH", `/api/${collection}/${id}`, patch),
  remove: (collection, id) => req("DELETE", `/api/${collection}/${id}`),
  // Convenience used by the pipeline drag-and-drop to persist a stage move.
  moveDeal: (id, stage) => req("PATCH", `/api/deals/${id}`, { stage }),
  // Cockpit → Levercopy: gera/re-gera a proposta de um lead. `auto` = gatilho
  // automático (best-effort, respeita idempotência); `force` = re-gerar manual.
  generateProposal: (id, { auto = false, force = false } = {}) => {
    const q = [auto && "auto=1", force && "force=1"].filter(Boolean).join("&");
    return req("POST", `/api/leads/${id}/proposal${q ? `?${q}` : ""}`);
  },
};
