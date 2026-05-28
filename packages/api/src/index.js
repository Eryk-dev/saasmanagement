// Cockpit API — single source of truth for the portfolio cockpit.
// Fastify + SQLite. Reads are open; writes optionally require an API key so your
// running SaaS can push data in safely.

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
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

initDb();

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Auth: only enforced when COCKPIT_API_KEY is set, and only on writes.
app.addHook("onRequest", async (req, reply) => {
  if (!API_KEY) return;
  if (!WRITE_METHODS.has(req.method)) return;
  if (req.headers["x-api-key"] !== API_KEY) {
    return reply.code(401).send({ error: "Invalid or missing x-api-key" });
  }
});

registerRoutes(app);

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Cockpit API ready on http://localhost:${PORT}  (auth on writes: ${API_KEY ? "ON" : "off"})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
