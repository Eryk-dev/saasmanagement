// Tests for the Cockpit → Levercopy proposal integration.
// node:test (built-in). The HTTP call to Levercopy is injected (opts.fetch), so
// nothing hits the network. The repo is an in-memory double (no Postgres).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { buildBody, runProposal } = await import("../src/levercopy.js");
const { LEVERADS_LEAD_QUESTIONS } = await import("../src/lead-questions.leverads.js");

const repo = makeMemRepo();

// ── helpers ──────────────────────────────────────────────────────────────────
const CFG = { url: "https://levercopy.test", key: "secret", saasId: "leverads" };

// A fetch stub that returns a fixed status/body and records the request.
function stubFetch(status, body, captured = {}) {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    captured.body = init?.body ? JSON.parse(init.body) : null;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
}
function throwingFetch() {
  return async () => { throw new Error("ECONNREFUSED"); };
}
// Explicit, unique ids — the repo's auto id generator can collide within the same
// millisecond, which would mask the behavior under test.
let seq = 0;
const newLead = (over = {}) => repo.create("leads", { id: `le_test_${++seq}`, name: "Mara Olin", saas: "leverads", ...over });
const okBody = (over = {}) => ({
  id: "pr_abc",
  proposalUrl: "https://levercopy.test/proposta/pr_abc",
  edit_url: "https://levercopy.test/proposta/pr_abc/edit?k=tok",
  cockpit_lead_id: null,
  ...over,
});

// ── buildBody ─────────────────────────────────────────────────────────────────
test("buildBody maps contact fields and carries cockpit_lead_id", () => {
  const lead = { id: "le_1", name: "Mara", company: "Drift", email: "m@d.com", phone: "+5511999", saas: "leverads" };
  const body = buildBody(lead);
  assert.equal(body.name, "Mara");
  assert.equal(body.company, "Drift");
  assert.equal(body.email, "m@d.com");
  assert.equal(body.whatsapp, "+5511999"); // Cockpit's `phone` → Levercopy's `whatsapp`
  assert.equal(body.cockpit_lead_id, "le_1");
  assert.equal(body.source, "Manual · Cockpit"); // origem da GERAÇÃO (Cockpit), não a do lead
});

test("buildBody source identifies the Cockpit generation, not the lead's own source", () => {
  // O lead foi adquirido por "Form" (default do Cockpit), mas a proposta está sendo
  // gerada manualmente pelo Cockpit — o source enviado reflete a origem da geração.
  // O vínculo com o lead vai via cockpit_lead_id.
  const body = buildBody({ id: "le_3", name: "X", saas: "leverads", source: "Form" });
  assert.equal(body.source, "Manual · Cockpit");
  assert.equal(body.cockpit_lead_id, "le_3");
});

test("buildBody omits absent optional fields (Levercopy applies defaults)", () => {
  const body = buildBody({ id: "le_2", name: "Solo", saas: "leverads" });
  assert.equal(body.name, "Solo");
  assert.ok(!("company" in body));
  assert.ok(!("email" in body));
  assert.ok(!("whatsapp" in body));
});

// ── buildBody: respostas de qualificação (leadQuestions) ─────────────────────────
test("buildBody forwards declared qualification answers, including arrays", () => {
  const lead = {
    id: "le_q1", name: "Lia", saas: "leverads",
    accounts: "3-5", listings: "500-2000", niche2: "x",
    tags: ["ml", "shopee"], niche: "moda",
  };
  const questions = [...LEVERADS_LEAD_QUESTIONS, { key: "tags", label: "Tags", type: "multiselect" }];
  const body = buildBody(lead, questions);
  assert.equal(body.accounts, "3-5");
  assert.equal(body.listings, "500-2000");
  assert.ok(!("niche2" in body)); // chave não declarada não vai
  assert.equal(body.niche, "moda");
  assert.deepEqual(body.tags, ["ml", "shopee"]); // array passa direto
});

test("buildBody skips unanswered/empty qualification fields", () => {
  const lead = { id: "le_q2", name: "Bo", saas: "leverads", accounts: "1", tags: [], niche: "" };
  const questions = [...LEVERADS_LEAD_QUESTIONS, { key: "tags", label: "Tags", type: "multiselect" }];
  const body = buildBody(lead, questions);
  assert.equal(body.accounts, "1");
  assert.ok(!("tags" in body));    // array vazio não vai
  assert.ok(!("niche" in body));   // string vazia não vai
  assert.ok(!("listings" in body)); // ausente não vai
});

test("buildBody ignores lead keys not declared in leadQuestions", () => {
  const lead = { id: "le_q3", name: "Cy", saas: "leverads", accounts: "2", randomField: "x" };
  const body = buildBody(lead, LEVERADS_LEAD_QUESTIONS);
  assert.equal(body.accounts, "2");
  assert.ok(!("randomField" in body));
});

// ── success path ───────────────────────────────────────────────────────────────
test("runProposal success persists proposta_id, proposalUrl, proposal_edit_url", async () => {
  const lead = await newLead();
  const captured = {};
  const res = await runProposal(repo, lead, { ...CFG, fetch: stubFetch(201, okBody(), captured) });

  assert.equal(res.ok, true);
  assert.equal(res.lead.proposta_id, "pr_abc");
  assert.equal(res.lead.proposalUrl, "https://levercopy.test/proposta/pr_abc");
  assert.equal(res.lead.proposal_edit_url, "https://levercopy.test/proposta/pr_abc/edit?k=tok");

  // persisted, not just returned
  const fresh = await repo.get("leads", lead.id);
  assert.equal(fresh.proposta_id, "pr_abc");

  // sent the shared key header + our lead id
  assert.equal(captured.init.headers["x-cockpit-key"], "secret");
  assert.equal(captured.body.cockpit_lead_id, lead.id);
  assert.match(captured.url, /\/api\/proposta\/generate$/);
});

test("runProposal forwards the pipeline's qualification answers to Levercopy", async () => {
  await repo.create("products", { id: "leverads", name: "LeverAds", leadQuestions: LEVERADS_LEAD_QUESTIONS });
  const lead = await newLead({ accounts: "3-5", listings: "500-2000", niche: "moda" });
  const captured = {};
  const res = await runProposal(repo, lead, { ...CFG, fetch: stubFetch(201, okBody(), captured) });

  assert.equal(res.ok, true);
  assert.equal(captured.body.accounts, "3-5");
  assert.equal(captured.body.niche, "moda");
  assert.equal(captured.body.listings, "500-2000");
});

// ── idempotency / triggers ──────────────────────────────────────────────────────
test("auto trigger skips when lead already has proposta_id (no Levercopy call)", async () => {
  const lead = await newLead({ proposta_id: "pr_existing" });
  let called = false;
  const res = await runProposal(repo, lead, { ...CFG, auto: true, fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "already_generated");
});

test("manual force re-generates and overwrites even when proposta_id exists", async () => {
  const lead = await newLead({ proposta_id: "pr_old", proposalUrl: "old" });
  const res = await runProposal(repo, lead, {
    ...CFG, force: true,
    fetch: stubFetch(201, okBody({ id: "pr_new", proposalUrl: "https://x/new", edit_url: "https://x/new/edit" })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.lead.proposta_id, "pr_new");
  assert.equal(res.lead.proposalUrl, "https://x/new");
});

// ── graceful no-ops ──────────────────────────────────────────────────────────────
test("not configured (no key) is a graceful skip, never an error", async () => {
  const lead = await newLead();
  let called = false;
  const res = await runProposal(repo, lead, { ...CFG, key: "", fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(res.ok, false);
  assert.equal(res.skipped, "not_configured");
});

test("non-leverads lead is skipped as not_levercopy", async () => {
  const lead = await newLead({ saas: "someothersaas" });
  let called = false;
  const res = await runProposal(repo, lead, { ...CFG, fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(res.skipped, "not_levercopy");
});

// ── round-trip dedupe ────────────────────────────────────────────────────────────
test("dedupe removes the mirrored duplicate Levercopy created on the round-trip", async () => {
  const lead = await newLead();
  const mirror = await newLead({ name: "Mara (mirror)" }); // the lead Levercopy echoes back
  const res = await runProposal(repo, lead, {
    ...CFG, fetch: stubFetch(201, okBody({ cockpit_lead_id: mirror.id })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.deduped, mirror.id);
  assert.equal(await repo.get("leads", mirror.id), null);   // duplicate gone
  assert.ok(await repo.get("leads", lead.id));               // original kept
});

test("no dedupe when Levercopy returns our own lead id (preferred path, mirror skipped)", async () => {
  const lead = await newLead();
  const res = await runProposal(repo, lead, {
    ...CFG, fetch: stubFetch(201, okBody({ cockpit_lead_id: lead.id })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.deduped, null);
  assert.ok(await repo.get("leads", lead.id)); // never deletes the original
});

// ── best-effort failure ──────────────────────────────────────────────────────────
test("network error returns ok:false without throwing or mutating the lead", async () => {
  const lead = await newLead();
  const res = await runProposal(repo, lead, { ...CFG, fetch: throwingFetch() });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  assert.equal((await repo.get("leads", lead.id)).proposta_id, undefined); // unchanged
});

test("Levercopy 503 returns ok:false with the status", async () => {
  const lead = await newLead();
  const res = await runProposal(repo, lead, {
    ...CFG, fetch: stubFetch(503, { detail: "Geracao manual nao configurada" }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
});

test("HTTP 200 without id/proposalUrl is treated as failure, not silent success", async () => {
  const lead = await newLead();
  const res = await runProposal(repo, lead, { ...CFG, fetch: stubFetch(200, {}) });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  assert.equal((await repo.get("leads", lead.id)).proposta_id, undefined); // nothing persisted
});
