// Smoke test for POST /api/leads/:id/proposal via Fastify inject (no network, no
// listening server). Covers the wiring: 404 for a missing lead, and the graceful
// "not configured" skip returning 200 (never a 500) when LEVERCOPY_INGEST_KEY is
// unset. The full generation/dedupe/error logic is covered in levercopy.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

delete process.env.LEVERCOPY_INGEST_KEY; // force the "not configured" branch
process.env.LEVERCOPY_API_URL = "";

const { registerRoutes } = await import("../src/routes.js");

const repo = makeMemRepo();

function buildApp() {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

test("POST /api/leads/:id/proposal → 404 for a missing lead", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/api/leads/nope/proposal" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "Not found");
  await app.close();
});

test("POST /api/leads/:id/proposal is a graceful 200 skip when not configured (no 500)", async () => {
  const app = buildApp();
  const lead = await repo.create("leads", { id: "le_route_1", name: "Mara", saas: "leverads" });
  const res = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal?auto=1` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, false);
  assert.equal(res.json().skipped, "not_configured");
  await app.close();
});

// Deck fixado no lead (apresentação sob medida): "re-gerar" não pode apagar do
// card um deck feito à mão sem que alguém confirme (o botão manda unpin=1).
test("lead com deck fixado recusa re-geração, e com unpin=1 troca e desfixa", async () => {
  const app = buildApp();
  await repo.create("proposal_templates", {
    id: "pt_test_pin", saas: "leverads", status: "published", name: "Padrão", theme: {}, calc: {},
    slides: [{ type: "hero", title: "Padrão" }],
  });
  const lead = await repo.create("leads", {
    id: "le_route_pin", name: "Rafa", saas: "leverads",
    proposta_id: "pr_bespoke", proposalUrl: "https://x/p/pr_bespoke", proposalPinned: true,
  });

  const barrado = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal?force=1` });
  assert.equal(barrado.statusCode, 200);
  assert.equal(barrado.json().skipped, "pinned");
  assert.equal((await repo.get("leads", lead.id)).proposta_id, "pr_bespoke");

  const trocado = await app.inject({ method: "POST", url: `/api/leads/${lead.id}/proposal?force=1&unpin=1` });
  assert.equal(trocado.json().ok, true);
  const depois = await repo.get("leads", lead.id);
  assert.notEqual(depois.proposta_id, "pr_bespoke");
  assert.equal(depois.proposalPinned, false);
  await app.close();
});
