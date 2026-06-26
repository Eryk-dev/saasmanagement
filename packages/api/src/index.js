// Cockpit API — single source of truth for the portfolio cockpit.
// Fastify + SQLite. When COCKPIT_API_KEY is set, EVERY route requires the key
// (reads + writes) so nothing leaks; only the liveness check stays open.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { initDb, repo } from "./db.js";
import { registerRoutes } from "./routes.js";
import { ensureDefaultAdmins, makeAuthHook } from "./auth.js";
import { runStartupMigrations } from "./migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const PORT = Number(process.env.API_PORT || 8787);
const API_KEY = process.env.COCKPIT_API_KEY || "";
// Routes that stay open even with a key (liveness probes from the PaaS + login).
const OPEN_PATHS = new Set(["/api/health", "/embed.js", "/favicon.ico", "/api/auth/login"]);
// Superfície pública do form builder (página + envio anônimo) e do proposal
// builder (página /p/:id, aceite, painel do closer via editKey). Endurecimento
// (rate-limit, honeypot, token) vive em routes.forms.js / routes.proposals.js.
const OPEN_PREFIXES = ["/f/", "/public/forms/", "/p/", "/public/proposals/", "/public/mp/"];

// Read the key from either header style: `x-api-key: <key>` or `Authorization: Bearer <key>`.
function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

await initDb();
// Admins padrão do time (só quando `users` está vazia — nunca reseta senha).
await ensureDefaultAdmins(repo);
// Migrações idempotentes de dados (ex.: garante o estágio "Integração" no funil).
await runStartupMigrations(repo);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Auth: when COCKPIT_API_KEY is set, every route requires the key OR a valid
// user session token (same header). CORS preflight, liveness and login stay open.
app.addHook("onRequest", makeAuthHook({
  apiKey: API_KEY, repo,
  openPaths: OPEN_PATHS, openPrefixes: OPEN_PREFIXES,
  providedKey,
}));

registerRoutes(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Cockpit API ready on http://localhost:${PORT}  (auth: ${API_KEY ? "ON (all routes)" : "off"})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
