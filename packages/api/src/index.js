// Cockpit API — single source of truth for the portfolio cockpit.
// Fastify + SQLite. When COCKPIT_API_KEY is set, EVERY route requires the key
// (reads + writes) so nothing leaks; only the liveness check stays open.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { initDb } from "./db.js";
import { registerRoutes } from "./routes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const PORT = Number(process.env.API_PORT || 8787);
const API_KEY = process.env.COCKPIT_API_KEY || "";
// Routes that stay open even with a key (liveness probes from the PaaS).
const OPEN_PATHS = new Set(["/api/health"]);

// Read the key from either header style: `x-api-key: <key>` or `Authorization: Bearer <key>`.
function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

initDb();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Auth: when COCKPIT_API_KEY is set, every route requires the key (reads + writes).
// CORS preflight and the liveness check stay open.
app.addHook("onRequest", async (req, reply) => {
  if (!API_KEY) return;
  if (req.method === "OPTIONS") return;
  if (OPEN_PATHS.has(req.url.split("?")[0])) return;
  if (providedKey(req) !== API_KEY) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

registerRoutes(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Cockpit API ready on http://localhost:${PORT}  (auth: ${API_KEY ? "ON (all routes)" : "off"})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
