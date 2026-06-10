// Client do MCP para a API do Cockpit. Faz tanto a leitura da documentação
// (OpenAPI/health) quanto CRUD completo nas coleções — toda escrita passa pela
// API REST (única fonte da verdade), então MCP e UI nunca divergem.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

export const API_BASE = (process.env.COCKPIT_API_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.MCP_API_KEY || process.env.COCKPIT_API_KEY || "";

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (KEY) headers["x-api-key"] = KEY;
  const res = await fetch(`${API_BASE}${path}`, {
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
  base: API_BASE,
  // documentação (manual)
  health: () => req("GET", "/api/health"),
  openapi: () => req("GET", "/api/openapi.json"),
  // agregados
  portfolio: () => req("GET", "/api/portfolio"),
  leaderboard: (scope) => req("GET", `/api/leaderboard${qs({ scope })}`),
  // CRUD genérico
  list: (collection, query) => req("GET", `/api/${collection}${qs(query)}`),
  get: (collection, id) => req("GET", `/api/${collection}/${encodeURIComponent(id)}`),
  create: (collection, obj) => req("POST", `/api/${collection}`, obj),
  update: (collection, id, patch) => req("PATCH", `/api/${collection}/${encodeURIComponent(id)}`, patch),
  remove: (collection, id) => req("DELETE", `/api/${collection}/${encodeURIComponent(id)}`),
  // Dispara a geração de proposta de um lead (dispatcher native|levercopy).
  // Sem force é idempotente (auto=1: pula se o lead já tem proposta).
  generateProposal: (leadId, { force = false } = {}) =>
    req("POST", `/api/leads/${encodeURIComponent(leadId)}/proposal${force ? "?force=1" : "?auto=1"}`),
};
