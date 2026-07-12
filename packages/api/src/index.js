// Cockpit API — single source of truth for the portfolio cockpit.
// Fastify + SQLite. When COCKPIT_API_KEY is set, EVERY route requires the key
// (reads + writes) so nothing leaks; only the liveness check stays open.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { initDb, repo } from "./db.js";
import { registerRoutes } from "./routes.js";
import { startMarketingAutoSync } from "./routes.marketing.js";
import { startCallSummaries } from "./call-summaries.js";
import { ensureDefaultAdmins, makeAuthHook } from "./auth.js";
import { makeScreenGuardHook } from "./screens.js";
import { runStartupMigrations } from "./migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const PORT = Number(process.env.API_PORT || 8787);
const API_KEY = process.env.COCKPIT_API_KEY || "";
// Routes that stay open even with a key (liveness probes from the PaaS + login).
const OPEN_PATHS = new Set(["/api/health", "/embed.js", "/favicon.ico", "/api/auth/login", "/api/google/callback"]);
// Superfície pública do form builder (página + envio anônimo) e do proposal
// builder (página /p/:id, aceite, painel do closer via editKey). Endurecimento
// (rate-limit, honeypot, token) vive em routes.forms.js / routes.proposals.js.
const OPEN_PREFIXES = ["/f/", "/public/forms/", "/p/", "/public/proposals/", "/public/mp/", "/public/social/"];

// Read the key from either header style: `x-api-key: <key>` or `Authorization: Bearer <key>`.
// Exceção: /api/events (SSE) — EventSource não manda headers, então a key/token
// de sessão vem em `?key=` SÓ nessa rota (evita segredo em log de URL no resto).
function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.url.split("?")[0] === "/api/events") return String(req.query?.key || "");
  return "";
}

await initDb();
// Admins padrão do time (só quando `users` está vazia — nunca reseta senha).
await ensureDefaultAdmins(repo);
// Migrações idempotentes de dados (ex.: garante o estágio "Integração" no funil).
await runStartupMigrations(repo);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
// Upload de criativo (vídeo) pra Meta — limite folgado pra vídeo de anúncio.
await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });

// Auth: when COCKPIT_API_KEY is set, every route requires the key OR a valid
// user session token (same header). CORS preflight, liveness and login stay open.
app.addHook("onRequest", makeAuthHook({
  apiKey: API_KEY, repo,
  openPaths: OPEN_PATHS, openPrefixes: OPEN_PREFIXES,
  providedKey,
}));
// Restrição de telas por usuário (user.screens): sessão restrita só alcança as
// rotas das telas permitidas; key mestre (MCP/integrações) passa direto.
app.addHook("onRequest", makeScreenGuardHook());

registerRoutes(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Cockpit API ready on http://localhost:${PORT}  (auth: ${API_KEY ? "ON (all routes)" : "off"})`);
  // Sync automático da Meta no servidor (uma execução pro time inteiro; no-op
  // sem META_ACCESS_TOKEN). O SPA só lê — não faz mais polling por aba.
  startMarketingAutoSync(repo, { log: app.log });
  // Resumo automático de calls: só faz algo com ANTHROPIC_API_KEY + Google conectado.
  startCallSummaries(repo, { ...app.integrationClients, log: app.log });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
