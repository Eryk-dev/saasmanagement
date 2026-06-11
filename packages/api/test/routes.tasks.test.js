// Kanban de tarefas — collection `tasks` no CRUD genérico. Garante: defaults na
// criação (comments/labels arrays + createdAt), filtros ?saas/?assignee/?column
// e PATCH do array de comentários (o SPA grava o array inteiro).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

test("criar tarefa aplica defaults + createdAt", async () => {
  const repo = makeMemRepo();
  const app = buildApp(repo);

  const res = await app.inject({
    method: "POST", url: "/api/tasks",
    payload: { title: "Subir deploy", saas: "leverads" },
  });
  assert.equal(res.statusCode, 201);
  const task = res.json();
  assert.equal(task.title, "Subir deploy");
  assert.deepEqual(task.comments, []);
  assert.deepEqual(task.labels, []);
  assert.deepEqual(task.assignees, []);
  assert.equal(task.column, "");
  assert.ok(task.createdAt);

  await app.close();
});

test("filtros ?saas / ?assignee / ?column — multi-responsável + legado", async () => {
  const repo = makeMemRepo();
  await repo.create("tasks", { id: "t1", title: "A", saas: "leverads", assignees: ["eryk"], column: "todo" });
  await repo.create("tasks", { id: "t2", title: "B", saas: "leverads", assignees: ["leonardo"], column: "doing" });
  await repo.create("tasks", { id: "t3", title: "C", saas: "outro", assignees: ["eryk", "leonardo"], column: "todo" });
  // Tarefa pré-multi-responsável (campo string legado) ainda entra no filtro.
  await repo.create("tasks", { id: "t4", title: "D", saas: "outro", assignee: "eryk", column: "todo" });
  const app = buildApp(repo);

  const bySaas = await app.inject({ url: "/api/tasks?saas=leverads" });
  assert.deepEqual(bySaas.json().map((t) => t.id).sort(), ["t1", "t2"]);

  const byAssignee = await app.inject({ url: "/api/tasks?assignee=eryk" });
  assert.deepEqual(byAssignee.json().map((t) => t.id).sort(), ["t1", "t3", "t4"]);

  const combined = await app.inject({ url: "/api/tasks?assignee=leonardo&column=todo" });
  assert.deepEqual(combined.json().map((t) => t.id), ["t3"]);

  await app.close();
});

test("PATCH grava comentários e movimento de coluna", async () => {
  const repo = makeMemRepo();
  await repo.create("tasks", { id: "t1", title: "A", column: "todo", comments: [] });
  const app = buildApp(repo);

  const comment = { id: "c1", author: "Eryk", text: "feito?", at: "2026-06-11T12:00:00Z" };
  const res = await app.inject({
    method: "PATCH", url: "/api/tasks/t1",
    payload: { column: "doing", order: 2, comments: [comment] },
  });
  assert.equal(res.statusCode, 200);
  const task = await repo.get("tasks", "t1");
  assert.equal(task.column, "doing");
  assert.equal(task.order, 2);
  assert.deepEqual(task.comments, [comment]);

  await app.close();
});
