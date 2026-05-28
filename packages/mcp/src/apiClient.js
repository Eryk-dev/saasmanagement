// O MCP do Cockpit é um MANUAL DE CONEXÃO — ele NÃO transmite dados de negócio.
// Só lê a *documentação* da API (OpenAPI + health) para servir de guia.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

export const API_BASE = (process.env.COCKPIT_API_URL || "http://localhost:8787").replace(/\/$/, "");

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

export const apiDocs = {
  base: API_BASE,
  openapi: () => getJson("/api/openapi.json"),
  health: () => getJson("/api/health"),
};
