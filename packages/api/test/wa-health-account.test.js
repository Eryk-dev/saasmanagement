// Alerta de conta (WABA) que ficou pra trás: o webhook só grava o último evento
// de conta, então um ACCOUNT_VIOLATION já resolvido na Meta seguia pausando os
// broadcasts. reconcileAccountAlert confere a saúde atual e limpa o antigo.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { reconcileAccountAlert, waHealthSummary } from "../src/whatsapp/wa-health.js";

const OLD = { event: "ACCOUNT_VIOLATION", detail: "USER_INITIATED_CALLS_LOW_PICKUP_RATE", at: "2026-08-12T14:52:35.172Z" };
const NOW = () => new Date("2026-10-23T15:00:00Z");

async function world(account = OLD) {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", waPhoneId: "PH_LEVER" });
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", waPhoneId: "PH_UK" });
  await repo.create("app_config", { id: "wa_health", number: {}, templates: {}, account, webhook: {}, updatedAt: OLD.at });
  return repo;
}
// Saúde por número no formato da Graph (health_status.entities).
const waWith = (byPhone) => {
  const calls = [];
  return { calls, async healthStatus(id) { calls.push(id); return { entities: byPhone[id] || [] }; } };
};
const ok = (wabaId) => [{ entity_type: "WABA", id: wabaId, can_send_message: "AVAILABLE" }, { entity_type: "BUSINESS", id: "B1", can_send_message: "AVAILABLE" }];

test("conta liberada na Meta: o alerta antigo sai e vira histórico; número pendente não segura", async () => {
  const repo = await world();
  const wa = waWith({ PH_LEVER: ok("W1"), PH_UK: [{ entity_type: "PHONE_NUMBER", id: "PH_UK", can_send_message: "BLOCKED" }, ...ok("W2")] });
  const h = await reconcileAccountAlert(repo, wa, { now: NOW, ttlMs: 0 });
  assert.deepEqual(h.account, {});
  assert.equal(h.accountCleared.event, "ACCOUNT_VIOLATION");
  assert.equal(h.accountCleared.by, "meta-health");
  assert.deepEqual(new Set(wa.calls), new Set(["PH_LEVER", "PH_UK"]));
  assert.equal(waHealthSummary(h).level, "ok");
});

test("conta ainda bloqueada na Meta: o alerta fica e mostra desde quando", async () => {
  const repo = await world();
  const wa = waWith({ PH_LEVER: [{ entity_type: "WABA", id: "W1", can_send_message: "BLOCKED" }], PH_UK: ok("W2") });
  const h = await reconcileAccountAlert(repo, wa, { now: NOW, ttlMs: 0 });
  assert.equal(h.account.event, "ACCOUNT_VIOLATION");
  const s = waHealthSummary(h);
  assert.equal(s.level, "danger");
  assert.match(s.messages.join(" "), /desde 12\/08: ACCOUNT_VIOLATION/);
});

test("sem leitura da Meta (falha ou sem cliente) não mexe; sem alerta não consulta", async () => {
  const repo = await world();
  const failing = { async healthStatus() { throw new Error("WhatsApp API -> 500"); } };
  assert.equal((await reconcileAccountAlert(repo, failing, { now: NOW, ttlMs: 0 })).account.event, "ACCOUNT_VIOLATION");
  assert.equal((await reconcileAccountAlert(repo, null, { now: NOW, ttlMs: 0 })).account.event, "ACCOUNT_VIOLATION");
  const clean = await world({});
  const wa = waWith({});
  await reconcileAccountAlert(clean, wa, { now: NOW, ttlMs: 0 });
  assert.equal(wa.calls.length, 0);
});

test("consulta à Meta no máximo a cada 10 minutos", async () => {
  const repo = await world();
  const wa = waWith({ PH_LEVER: [{ entity_type: "WABA", id: "W1", can_send_message: "BLOCKED" }] });
  const at = new Date("2026-10-24T10:00:00Z").getTime();
  await reconcileAccountAlert(repo, wa, { now: () => new Date(at) });
  const first = wa.calls.length;
  assert.ok(first > 0);
  await reconcileAccountAlert(repo, wa, { now: () => new Date(at + 5 * 60_000) });
  assert.equal(wa.calls.length, first);
  await reconcileAccountAlert(repo, wa, { now: () => new Date(at + 11 * 60_000) });
  assert.ok(wa.calls.length > first);
});
