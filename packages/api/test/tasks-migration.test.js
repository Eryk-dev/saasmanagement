// Tarefas v2: a migração de boot preenche o que falta (concluída, seguidores,
// anexos, carimbos, autor do comentário por id) sem tocar no que já existe.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { migrateTasksV2 } from "../src/migrations.js";

test("migrateTasksV2 preenche e é idempotente", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", name: "Eryk Silva", passwordHash: "x" });
  await repo.create("task_boards", { id: "b1", columns: [{ key: "todo", name: "A fazer" }, { key: "c_x", name: "Concluído" }] });
  await repo.create("task_assets", { id: "tka_1", mime: "image/jpeg", size: 10, name: "print.jpg" });
  await repo.create("tasks", { id: "t1", title: "Feita", column: "c_x", assignees: ["eryk"], createdAt: "2026-08-01T00:00:00Z", labels: ["bug"], photo: "/public/tasks/tka_1", comments: [{ id: "c1", author: "Eryk Silva", text: "ok", at: "2026-08-02T00:00:00Z" }, { id: "c2", author: "API key", text: "x", at: "2026-08-02T00:00:00Z" }, { id: "c3", author: "Fulano", text: "y", at: "2026-08-02T00:00:00Z" }] });
  await repo.create("tasks", { id: "t2", title: "Aberta", column: "todo", assignee: "eryk", createdAt: "2026-08-01T00:00:00Z", labels: ["melhoria", "Bug"] });
  await repo.create("tasks", { id: "t3", title: "Já nova", column: "todo", completed: false, assignees: [], followers: ["leo"], attachments: [], version: 2, comments: [] , updatedAt: "2026-09-01T00:00:00Z", cover: "", blockedBy: [], likes: [], labels: [], startDate: "", parentId: "", followUpOf: "", duplicatedFrom: "", recurrenceOf: "", recurrence: null, createdBy: "leo", updatedBy: "leo" });

  const n = await migrateTasksV2(repo);
  assert.equal(n, 3, "board + 2 tarefas antigas");
  const board = await repo.get("task_boards", "b1");
  assert.equal(board.doneKey, "c_x");
  assert.equal(board.completeMovesToDone, true);
  assert.deepEqual(board.labels.map((l) => l.name), ["bug", "melhoria"]);
  const t1 = await repo.get("tasks", "t1");
  assert.equal(t1.completed, true);
  assert.equal(t1.completedAt, "2026-08-01T00:00:00Z");
  assert.deepEqual(t1.followers, ["eryk"]);
  assert.equal(t1.updatedAt, "2026-08-01T00:00:00Z");
  assert.equal(t1.version, 0);
  assert.deepEqual(t1.attachments, [{ id: "tka_1", url: "/public/tasks/tka_1", name: "print.jpg", mime: "image/jpeg", size: 10, by: "", at: "2026-08-01T00:00:00Z" }]);
  assert.equal(t1.cover, "/public/tasks/tka_1");
  assert.deepEqual(t1.comments.map((c) => c.author), ["eryk", "api", "Fulano"]);
  assert.deepEqual(t1.comments[0].likes, []);
  const t2 = await repo.get("tasks", "t2");
  assert.equal(t2.completed, false);
  assert.deepEqual(t2.assignees, ["eryk"]);
  assert.deepEqual(t2.attachments, []);
  const t3 = await repo.get("tasks", "t3");
  assert.deepEqual(t3.followers, ["leo"], "doc novo não é tocado");
  assert.equal(t3.version, 2);
  assert.equal(await migrateTasksV2(repo), 0, "segunda rodada não mexe em nada");
});

test("sem board salvo, a coluna `done` conta como concluída", async () => {
  const repo = makeMemRepo();
  await repo.create("tasks", { id: "t1", title: "x", column: "done" });
  await repo.create("tasks", { id: "t2", title: "y", column: "todo" });
  await migrateTasksV2(repo);
  assert.equal((await repo.get("tasks", "t1")).completed, true);
  assert.equal((await repo.get("tasks", "t2")).completed, false);
});
