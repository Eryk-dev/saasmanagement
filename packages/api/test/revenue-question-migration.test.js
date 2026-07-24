// Migração que insere a pergunta de faixa de faturamento (revenue) no
// leadQuestions do leverads: entra logo depois de "listings" (ordem da
// conversa), uma vez só (marcador revenueQuestionV1), e nunca sobrescreve uma
// pergunta revenue que o dono já tenha configurado.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { ensureRevenueLeadQuestion } = await import("../src/migrations.js");

const seed = (repo, leadQuestions) =>
  repo.create("products", { id: "leverads", name: "Leverads", ...(leadQuestions !== undefined ? { leadQuestions } : {}) });

test("insere a faixa de faturamento logo depois de listings, uma vez só", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ key: "accounts" }, { key: "listings" }, { key: "niche" }]);

  assert.equal(await ensureRevenueLeadQuestion(repo), true);
  const p = await repo.get("products", "leverads");
  assert.deepEqual(p.leadQuestions.map((q) => q.key), ["accounts", "listings", "revenue", "niche"]);
  assert.equal(p.revenueQuestionV1, true);
  const rev = p.leadQuestions.find((q) => q.key === "revenue");
  assert.equal(rev.type, "select");
  assert.ok(rev.options.some((o) => o.value === "nao-informou"), "tem a saída de quem não quis dizer");

  // idempotente: segunda passada não duplica nem reordena
  assert.equal(await ensureRevenueLeadQuestion(repo), false);
  const again = await repo.get("products", "leverads");
  assert.equal(again.leadQuestions.filter((q) => q.key === "revenue").length, 1);
});

test("pergunta revenue já configurada pelo dono: só carimba, não mexe", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ key: "revenue", label: "curada pelo dono" }, { key: "listings" }]);
  assert.equal(await ensureRevenueLeadQuestion(repo), false);
  const p = await repo.get("products", "leverads");
  assert.equal(p.revenueQuestionV1, true);
  assert.equal(p.leadQuestions.filter((q) => q.key === "revenue").length, 1);
  assert.equal(p.leadQuestions[0].label, "curada pelo dono");
});

test("sem listings entra no fim; sem lista nenhuma, nada é criado", async () => {
  const repo = makeMemRepo();
  await seed(repo, [{ key: "idade" }]);
  await ensureRevenueLeadQuestion(repo);
  assert.deepEqual((await repo.get("products", "leverads")).leadQuestions.map((q) => q.key), ["idade", "revenue"]);

  const repo2 = makeMemRepo();
  await seed(repo2, undefined);
  assert.equal(await ensureRevenueLeadQuestion(repo2), false);
  const p2 = await repo2.get("products", "leverads");
  assert.equal(p2.leadQuestions, undefined);
  assert.equal(p2.revenueQuestionV1, true, "marcador entra mesmo sem lista (não fica tentando a cada boot)");
});
