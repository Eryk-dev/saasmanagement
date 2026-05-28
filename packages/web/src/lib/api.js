// Thin API client for the cockpit web app. In dev, VITE_API_BASE is empty and
// Vite proxies /api -> the Fastify server. For a remote build, set VITE_API_BASE.

const BASE = import.meta.env.VITE_API_BASE || "";
const KEY = import.meta.env.VITE_API_KEY || "";

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (KEY) headers["x-api-key"] = KEY;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${path} -> ${res.status} ${text}`);
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
};
