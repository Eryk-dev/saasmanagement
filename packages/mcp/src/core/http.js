// Camada HTTP do MCP para a API do Cockpit. A API REST continua sendo a única
// fonte da verdade — o MCP nunca fala com o Postgres direto, então MCP e UI
// nunca divergem.
//
// O que mudou em relação ao client antigo: erro da API vira uma mensagem que
// diz o que fazer (o corpo de erro do Fastify traz `error` e às vezes `detail`,
// e jogar "API GET /x -> 400 {...}" na cara do modelo desperdiçava a dica), e
// toda chamada tem timeout — a Graph da Meta e o Mercado Pago penduram.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", "..", ".env") });

export const API_BASE = (process.env.COCKPIT_API_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.MCP_API_KEY || process.env.COCKPIT_API_KEY || "";
// Sync da Meta e geração de proposta (Anthropic) passam bem de 30s.
const DEFAULT_TIMEOUT_MS = Number(process.env.MCP_HTTP_TIMEOUT_MS || 120_000);

export class ApiError extends Error {
  constructor(message, { status, method, path, detail, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.detail = detail;
    this.body = body;
  }
}

// Dica acionável por status: sem isto o modelo tenta de novo igual, ou inventa
// uma explicação. O 424 é nosso "não configurado" (http-status.js da API).
function hintFor(status, path) {
  if (status === 401 || status === 403) return "a chave do MCP não foi aceita pela API (COCKPIT_API_KEY / MCP_API_KEY).";
  if (status === 404) return "id ou rota inexistente — confira o id com a tool de listagem correspondente.";
  if (status === 424) return "integração não configurada no servidor (token da Meta / Google / Mercado Pago / Anthropic ausente).";
  if (status === 502) return "o serviço externo falhou ou está fora (Meta, Google, Mercado Pago) — não é erro de uso.";
  if (status === 400) return "parâmetro inválido — leia a mensagem acima, ela vem da validação da própria API.";
  if (status === 413) return "arquivo grande demais para o proxy.";
  if (status >= 500) return `infraestrutura: a API não respondeu ${path}.`;
  return "";
}

export const qs = (obj) => {
  const clean = Object.entries(obj || {}).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
  if (!clean.length) return "";
  const p = new URLSearchParams();
  for (const [k, v] of clean) (Array.isArray(v) ? v : [v]).forEach((x) => p.append(k, String(x)));
  return `?${p.toString()}`;
};

export async function request(method, path, { body, query, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `${API_BASE}${path}${qs(query)}`;
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (KEY) headers["x-api-key"] = KEY;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new ApiError(`a API não respondeu em ${Math.round(timeoutMs / 1000)}s`, { method, path, detail: "timeout" });
    }
    throw new ApiError(`não consegui falar com a API em ${API_BASE}: ${err.message}`, { method, path });
  }
  clearTimeout(timer);

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* HTML do proxy */ }

  if (!res.ok) {
    const msg = parsed?.error || (text ? String(text).slice(0, 300) : `HTTP ${res.status}`);
    throw new ApiError(msg, {
      status: res.status,
      method,
      path,
      detail: parsed?.detail ? String(parsed.detail).slice(0, 300) : hintFor(res.status, path),
      body: parsed,
    });
  }
  return parsed;
}

export const http = {
  base: API_BASE,
  hasKey: !!KEY,
  get: (path, query, opts) => request("GET", path, { query, ...opts }),
  post: (path, body, opts) => request("POST", path, { body: body ?? {}, ...opts }),
  put: (path, body, opts) => request("PUT", path, { body: body ?? {}, ...opts }),
  patch: (path, body, opts) => request("PATCH", path, { body: body ?? {}, ...opts }),
  del: (path, opts) => request("DELETE", path, { ...opts }),
};
