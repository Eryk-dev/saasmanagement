// Tiny client the MCP tools use to talk to the Cockpit API. Keeping the API as
// the single source of truth means MCP and the web app never drift, and anything
// your SaaS pushes via REST is instantly visible to MCP tools (and vice-versa).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const BASE = (process.env.COCKPIT_API_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.MCP_API_KEY || process.env.COCKPIT_API_KEY || "";

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (KEY) headers["x-api-key"] = KEY;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const qs = (obj) => {
  const clean = Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v != null && v !== ""));
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : "";
};

export const apiClient = {
  base: BASE,
  health: () => req("GET", "/api/health"),
  portfolio: () => req("GET", "/api/portfolio"),
  list: (collection, query) => req("GET", `/api/${collection}${qs(query)}`),
  get: (collection, id) => req("GET", `/api/${collection}/${id}`),
  create: (collection, obj) => req("POST", `/api/${collection}`, obj),
  update: (collection, id, patch) => req("PATCH", `/api/${collection}/${id}`, patch),
  remove: (collection, id) => req("DELETE", `/api/${collection}/${id}`),
  leaderboard: (scope) => req("GET", `/api/leaderboard${qs({ scope })}`),
};
