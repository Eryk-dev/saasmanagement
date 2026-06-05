// Smoke test for POST /api/leads/:id/proposal via Fastify inject (no network, no
// listening server). Covers the wiring: 404 for a missing lead, and the graceful
// "not configured" skip returning 200 (never a 500) when LEVERCOPY_INGEST_KEY is
// unset. The full generation/dedupe/error logic is covered in levercopy.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import Fastify from "fastify";

const DB = join(tmpdir(), `cockpit-route-test-${process.pid}.db`);
process.env.COCKPIT_DB_PATH = DB;
delete process.env.LEVERCOPY_INGEST_KEY; // force the "not configured" branch
process.env.LEVERCOPY_API_URL = "";

const { initDb, repo } = await import("../src/db.js");
const { registerRoutes } = await import("../src/routes.js");

initDb();

function buildApp() {
  const app = Fastify();
  registerRoutes(app);
  return app;
}

test.after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(DB + suffix); } catch { /* ignore */ }
  }
});

test("POST /api/leads/:id/proposal → 404 for a missing lead", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/api/leads/nope/proposal" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "Not found");
  await app.close();
});

test("POST /api/leads/:id/proposal is a graceful 200 skip when not configured (no 500)", async () => {
  const app = buildApp();
  const lead = repo.create("leads", { id: "le_route_1", name: "Mara", saas: "leverads" });
  const res = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal?auto=1` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().skipped, "not_configured");
  await app.close();
});
