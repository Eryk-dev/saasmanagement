import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { computeScoreboard } from "../src/routes.scoreboard.js";
import { computePipelinePace, computeWindowGoal } from "../src/routes.pipeline-pace.js";
import { metricsReader } from "../src/metrics-reader.js";

const NOW = new Date("2026-09-14T15:00:00Z");
const query = { since: "2026-09-01", until: "2026-09-30" };
const product = {
  id: "leverads", monthlyCashTarget: 120000,
  funnel: [
    { stage: "Novo", kind: "novo" }, { stage: "Call", kind: "call" },
    { stage: "Follow-up", kind: "followup" }, { stage: "Ganho", kind: "ganho" },
  ],
};

async function fixture() {
  const repo = makeMemRepo();
  const data = {
    users: [{ id: "sdr", roles: ["sdr"] }, { id: "closer", roles: ["closer"] }],
    leads: [
      { id: "l1", stage: "Call", owner: "sdr", closer: "closer", callAt: "2026-09-10T15:00:00Z" },
      { id: "l2", stage: "Follow-up", owner: "sdr", closer: "closer" },
      { id: "l3", stage: "Ganho", customerId: "c1", amount: 6000, wonAt: "2026-09-10T15:00:00Z" },
      { id: "other", saas: "uniquekids", stage: "Ganho", amount: 999999 },
    ].map((l) => ({ saas: product.id, createdAt: "2026-09-01T15:00:00Z", ...l })),
    customers: [{ id: "c1", saas: product.id, leadId: "l3", arr: 12000, startedAt: "2026-09-10" }],
    invoices: [{ id: "i1", saas: product.id, customer: "c1", amount: 6000, status: "paid", paidAt: "2026-09-10T15:00:00Z" }],
    activities: [
      { id: "a1", lead: "l1", type: "stage", author: "sdr", meta: { from: "Novo", to: "Call" } },
      { id: "a2", lead: "l1", type: "system", meta: { event: "call_summary", summary: "Cliente compareceu à call" } },
      { id: "a3", lead: "l2", type: "call", author: "closer", meta: { event: "reschedule" } },
      { id: "other", saas: "uniquekids", lead: "other", type: "call", author: "sdr" },
    ].map((a) => ({ saas: product.id, at: "2026-09-10T15:00:00Z", body: "transcrição longa".repeat(1000), ...a })),
    wa_messages: [
      // O legado sem saas continua atribuindo contato pelo lead.
      { id: "m1", leadId: "l1", direction: "out", author: "sdr", at: "2026-09-01T15:30:00Z" },
      { id: "m2", leadId: "l1", direction: "in", at: "2026-09-01T15:40:00Z" },
      { id: "m3", saas: product.id, leadId: "l2", direction: "out", author: "closer", at: "2026-09-10T15:00:00Z" },
    ].map((m) => ({ ...m, text: "mensagem longa".repeat(1000), raw: { media: "dados".repeat(1000) } })),
    proposals: [{ id: "p1", saas: product.id, createdAt: NOW.toISOString(), data: { slides: "conteúdo".repeat(1000) } }],
  };
  for (const [name, rows] of Object.entries(data)) for (const row of rows) await repo.create(name, row);
  return repo;
}

function measured(repo) {
  const calls = [];
  return {
    calls,
    repo: {
      async list(name) { calls.push({ name, method: "list" }); return repo.list(name); },
      async listWhere(name, where, opts) { calls.push({ name, method: "listWhere", where, opts }); return repo.listWhere(name, where, opts); },
    },
  };
}

test("meta da janela lê só as cinco bases necessárias, sem carregar históricos do funil", async () => {
  const { repo, calls } = measured(await fixture());
  const goal = await computeWindowGoal(repo, product, query.since, query.until, NOW);
  assert.equal(goal.sale.sold, 6000);
  assert.equal(goal.contracts.target, 20);
  assert.deepEqual(calls.map((c) => c.name).sort(), ["customers", "goals", "invoices", "leads", "mp_payments"]);
});

test("placar reutiliza cada coleção no pace e no bônus, sem consultar assinaturas", async () => {
  const { repo, calls } = measured(await fixture());
  const score = await computeScoreboard(repo, product, query, { now: () => NOW });
  assert.equal(score.team.teamBonus.applies, true, "o teste precisa percorrer também o bônus do time");
  assert.equal(calls.filter((c) => c.name === "subscriptions").length, 0);
  for (const name of new Set(calls.map((c) => c.name))) {
    assert.equal(calls.filter((c) => c.name === name).length, 1, `${name} deve ser lida uma única vez`);
  }
  assert.ok(calls.length <= 13, `orçamento de leituras: ${calls.length}`);
  for (const name of ["activities", "wa_messages", "proposals"]) {
    assert.equal(calls.find((c) => c.name === name).method, "listWhere");
  }
});

test("projeções mantêm o placar e pace idênticos aos documentos completos, inclusive WhatsApp legado", async () => {
  const repo = await fixture();
  const full = { list: (name) => repo.list(name), listWhere: (name, where) => repo.listWhere(name, where) };
  assert.deepEqual(
    await computeScoreboard(repo, product, query, { now: () => NOW }),
    await computeScoreboard(full, product, query, { now: () => NOW }),
  );
  assert.deepEqual(await computePipelinePace(repo, product, NOW), await computePipelinePace(full, product, NOW));
  const reader = metricsReader(repo, product.id);
  const messages = await reader.list("wa_messages");
  assert.equal(messages.length, 3);
  assert.ok(messages.every((m) => !("text" in m) && !("raw" in m)));
  const activities = await reader.list("activities");
  assert.equal(activities.length, 3);
  assert.ok(activities.every((a) => !("body" in a)));
});

test("a próxima requisição vê escritas e não reaproveita o resultado anterior", async () => {
  const repo = await fixture();
  const before = await computeWindowGoal(repo, product, query.since, query.until, NOW);
  await repo.update("leads", "l3", { amount: 9000 });
  const after = await computeWindowGoal(repo, product, query.since, query.until, NOW);
  assert.equal(before.sale.sold, 6000);
  assert.equal(after.sale.sold, 9000);
});
