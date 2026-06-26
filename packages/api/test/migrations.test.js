import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ensureIntegrationStage } from "../src/migrations.js";

const FUNNEL = [
  { stage: "Inbox", conv: 1 },
  { stage: "Qualificação", conv: 0.5 },
  { stage: "Call closer", conv: 0.6 },
  { stage: "Negociação", conv: 0.7 },
  { stage: "Ganho", conv: 0.8 },
  { stage: "Perdido", conv: 0 },
];

test('insere "Integração" entre "Negociação" e "Ganho"', async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });

  const changed = await ensureIntegrationStage(repo);
  assert.equal(changed, true);

  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, [
    "Inbox", "Qualificação", "Call closer", "Negociação", "Integração", "Ganho", "Perdido",
  ]);
});

test("é idempotente — rodar de novo não duplica", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });

  await ensureIntegrationStage(repo);
  const second = await ensureIntegrationStage(repo);
  assert.equal(second, false);

  const count = (await repo.get("products", "leverads")).funnel.filter((f) => f.stage === "Integração").length;
  assert.equal(count, 1);
});

test('fallback: sem "Ganho", insere logo após "Negociação"', async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [{ stage: "Negociação", conv: 0.7 }, { stage: "Perdido", conv: 0 }],
  });

  await ensureIntegrationStage(repo);
  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, ["Negociação", "Integração", "Perdido"]);
});

test('funil inesperado (sem "Negociação" nem "Ganho") — não mexe', async () => {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds",
    funnel: [{ stage: "Lead", conv: 1 }, { stage: "Cliente", conv: 0.5 }],
  });

  const changed = await ensureIntegrationStage(repo);
  assert.equal(changed, false);
  const stages = (await repo.get("products", "leverads")).funnel.map((f) => f.stage);
  assert.deepEqual(stages, ["Lead", "Cliente"]);
});

test("produto sem funil ou inexistente — não quebra", async () => {
  const repo = makeMemRepo();
  assert.equal(await ensureIntegrationStage(repo), false); // produto inexistente
  await repo.create("products", { id: "leverads", name: "LeverAds" }); // sem funnel
  assert.equal(await ensureIntegrationStage(repo), false);
});
