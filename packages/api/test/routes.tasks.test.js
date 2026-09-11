// Quadro de Tarefas (collection `tasks`): o CRUD genérico passa pelo núcleo
// (tasks-core.js) e as rotas dedicadas (routes.tasks.js) cobrem mover,
// concluir, comentar, subtarefas, anexos, bloqueios e ações em massa.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}
const BOARD = { id: "b1", columns: [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Em andamento" }, { key: "done", name: "Concluído" }], doneKey: "done" };
const post = (app, url, payload) => app.inject({ method: "POST", url, payload });
const events = async (repo, id) => (await repo.listWhere("task_events", { task: id })).map((e) => e.type);

test("criar tarefa aplica defaults + carimbos + evento", async (t) => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  t.after(() => app.close());

  const res = await post(app, "/api/tasks", { title: "Subir deploy", saas: "leverads" });
  assert.equal(res.statusCode, 201);
  const task = res.json();
  assert.equal(task.title, "Subir deploy");
  assert.deepEqual(task.comments, []);
  assert.deepEqual(task.labels, []);
  assert.deepEqual(task.assignees, []);
  assert.equal(task.column, "todo", "sem coluna cai na primeira do quadro (antes ficava vazia)");
  assert.equal(task.completed, false);
  assert.equal(task.order, 1);
  assert.equal(task.version, 0);
  assert.ok(task.createdAt);
  assert.equal(task.createdBy, "api");
  assert.deepEqual(await events(repo, task.id), ["created"]);
  assert.equal((await post(app, "/api/tasks", { title: "x", dueDate: "amanhã" })).statusCode, 400);
});

test("filtros ?saas / ?assignee / ?column / ?parent / ?completed — multi-responsável + legado", async (t) => {
  const repo = makeMemRepo();
  await repo.create("tasks", { id: "t1", title: "A", saas: "leverads", assignees: ["eryk"], column: "todo" });
  await repo.create("tasks", { id: "t2", title: "B", saas: "leverads", assignees: ["leonardo"], column: "doing", completed: true });
  await repo.create("tasks", { id: "t3", title: "C", saas: "outro", assignees: ["eryk", "leonardo"], column: "todo" });
  // Tarefa pré-multi-responsável (campo string legado) ainda entra no filtro.
  await repo.create("tasks", { id: "t4", title: "D", saas: "outro", assignee: "eryk", column: "todo" });
  await repo.create("tasks", { id: "t5", title: "sub", parentId: "t1", column: "todo" });
  const app = buildApp(repo);
  t.after(() => app.close());

  const bySaas = await app.inject({ url: "/api/tasks?saas=leverads" });
  assert.deepEqual(bySaas.json().map((x) => x.id).sort(), ["t1", "t2"]);
  const byAssignee = await app.inject({ url: "/api/tasks?assignee=eryk" });
  assert.deepEqual(byAssignee.json().map((x) => x.id).sort(), ["t1", "t3", "t4"]);
  const combined = await app.inject({ url: "/api/tasks?assignee=leonardo&column=todo" });
  assert.deepEqual(combined.json().map((x) => x.id), ["t3"]);
  assert.deepEqual((await app.inject({ url: "/api/tasks?parent=none&saas=leverads" })).json().map((x) => x.id), ["t1", "t2"]);
  assert.deepEqual((await app.inject({ url: "/api/tasks?parent=t1" })).json().map((x) => x.id), ["t5"]);
  assert.deepEqual((await app.inject({ url: "/api/tasks?completed=1" })).json().map((x) => x.id), ["t2"]);
});

test("PATCH cru grava comentários (carimbados) e movimento de coluna", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "t1", title: "A", column: "todo", comments: [] });
  const app = buildApp(repo);
  t.after(() => app.close());

  const comment = { id: "c1", author: "Eryk", text: "feito?", at: "2026-06-11T12:00:00Z" };
  const res = await app.inject({ method: "PATCH", url: "/api/tasks/t1", payload: { column: "doing", order: 2, comments: [comment] } });
  assert.equal(res.statusCode, 200);
  const task = await repo.get("tasks", "t1");
  assert.equal(task.column, "doing");
  assert.equal(task.order, 2);
  assert.equal(task.comments.length, 1);
  assert.equal(task.comments[0].id, "c1");
  assert.equal(task.comments[0].author, "Eryk", "chave mestre respeita o autor que veio no corpo");
  assert.equal(task.comments[0].text, "feito?");
  assert.equal(task.comments[0].at, "2026-06-11T12:00:00Z");
  assert.deepEqual(task.comments[0].likes, []);
  assert.equal(task.version, 1);
  assert.ok(task.updatedAt);
  assert.deepEqual(await events(repo, "t1"), ["moved", "comment"]);
  // segundo PATCH do array inteiro: id conhecido mantém autor/hora; sumiu = apagou
  await app.inject({ method: "PATCH", url: "/api/tasks/t1", payload: { comments: [{ id: "c1", author: "Outro", text: "editado" }] } });
  const again = await repo.get("tasks", "t1");
  assert.equal(again.comments[0].author, "Eryk");
  assert.equal(again.comments[0].text, "editado");
  assert.ok(again.comments[0].editedAt);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/tasks/t1", payload: { column: "nada" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/tasks/t1", payload: { priority: "P7" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/tasks/nao", payload: { title: "x" } })).statusCode, 404);
});

test("mover: antes/depois/fim, regra da coluna de concluído, referência de outra coluna = 400", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "a", title: "a", column: "todo", order: 1 });
  await repo.create("tasks", { id: "b", title: "b", column: "todo", order: 2 });
  await repo.create("tasks", { id: "c", title: "c", column: "doing", order: 1 });
  const app = buildApp(repo);
  t.after(() => app.close());

  let r = await post(app, "/api/tasks/c/move", { column: "todo", beforeId: "b" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().task.column, "todo");
  assert.equal(r.json().task.order, 1.5);
  assert.deepEqual(r.json().applied, []);
  r = await post(app, "/api/tasks/a/move", { afterId: "b" });
  assert.equal(r.json().task.order, 3);
  r = await post(app, "/api/tasks/a/move", { column: "doing" });
  assert.equal(r.json().task.order, 1, "coluna vazia começa em 1");
  assert.equal((await post(app, "/api/tasks/a/move", { column: "todo", beforeId: "nao-existe" })).statusCode, 400);
  assert.equal((await post(app, "/api/tasks/a/move", { column: "zzz" })).statusCode, 400);
  r = await post(app, "/api/tasks/b/move", { column: "done" });
  assert.equal(r.json().task.completed, true);
  assert.deepEqual(r.json().applied, ["complete"]);
  assert.ok(r.json().task.completedAt);
  r = await post(app, "/api/tasks/b/move", { column: "todo" });
  assert.equal(r.json().task.completed, false);
  assert.deepEqual(r.json().applied, ["reopen"]);
  assert.equal((await post(app, "/api/tasks/nao/move", {})).statusCode, 404);
});

test("mover: vão esgotado renumera a coluna inteira (1..n)", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "a", title: "a", column: "todo", order: 1 });
  await repo.create("tasks", { id: "b", title: "b", column: "todo", order: 1 + 1e-9 });
  await repo.create("tasks", { id: "c", title: "c", column: "todo", order: 5 });
  const app = buildApp(repo);
  t.after(() => app.close());
  const r = await post(app, "/api/tasks/c/move", { beforeId: "b" });
  assert.equal(r.json().rebalanced, true);
  const orders = Object.fromEntries((await repo.list("tasks")).map((x) => [x.id, x.order]));
  assert.deepEqual(orders, { a: 1, c: 2, b: 3 });
});

test("concluir leva pra coluna de concluído (fim) e reabrir devolve de onde saiu", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "a", title: "a", column: "doing", order: 1 });
  await repo.create("tasks", { id: "z", title: "z", column: "done", order: 7, completed: true });
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/tasks/a/complete", {});
  assert.equal(r.json().task.completed, true);
  assert.equal(r.json().task.column, "done");
  assert.equal(r.json().task.completedFrom, "doing");
  assert.equal(r.json().task.order, 8);
  assert.equal(r.json().next, null);
  r = await post(app, "/api/tasks/a/complete", { completed: true });
  assert.equal(r.json().unchanged, true);
  r = await post(app, "/api/tasks/a/complete", { completed: false });
  assert.equal(r.json().task.completed, false);
  assert.equal(r.json().task.column, "doing");
  assert.deepEqual(await events(repo, "a"), ["moved", "completed", "moved", "reopened"]);
  // o Meu dia antigo: PATCH { column: doneKey } também conclui
  await app.inject({ method: "PATCH", url: "/api/tasks/a", payload: { column: "done" } });
  assert.equal((await repo.get("tasks", "a")).completed, true);
});

test("recorrente: concluir cria a próxima instância uma vez só", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "r", title: "Relatório", column: "todo", dueDate: "2026-09-10", startDate: "2026-09-08", assignees: ["leo"], recurrence: { every: "week", interval: 1 } });
  const app = buildApp(repo);
  t.after(() => app.close());
  const r = await post(app, "/api/tasks/r/complete", {});
  const next = r.json().next;
  assert.ok(next?.id);
  assert.equal(next.dueDate, "2026-09-17");
  assert.equal(next.startDate, "2026-09-15");
  assert.equal(next.column, "todo");
  assert.equal(next.recurrenceOf, "r");
  assert.deepEqual(next.recurrence, { every: "week", interval: 1, weekdays: [], until: "", monthDay: 0 });
  assert.equal(r.json().task.recurrence, null, "a concluída perde a recorrência");
  await post(app, "/api/tasks/r/complete", { completed: false });
  const again = await post(app, "/api/tasks/r/complete", {});
  assert.equal(again.json().next, null, "reabrir e concluir de novo não gera outra");
  assert.equal((await repo.list("tasks")).length, 2);
});

test("comentários: criar/editar/apagar pela rota; curtir exige sessão", async (t) => {
  const repo = makeMemRepo();
  await repo.create("tasks", { id: "a", title: "a", column: "todo" });
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/tasks/a/comments", { text: "primeiro" });
  assert.equal(r.statusCode, 201);
  const cid = r.json().comment.id;
  assert.equal(r.json().comment.author, "api");
  assert.equal(r.json().task.comments.length, 1);
  assert.equal((await post(app, "/api/tasks/a/comments", { text: "  " })).statusCode, 400);
  r = await app.inject({ method: "PATCH", url: `/api/tasks/a/comments/${cid}`, payload: { text: "editado" } });
  assert.equal(r.json().comment.text, "editado");
  assert.ok(r.json().comment.editedAt);
  assert.equal((await post(app, `/api/tasks/a/comments/${cid}/like`, {})).statusCode, 400, "curtir sem sessão");
  assert.equal((await post(app, "/api/tasks/a/like", {})).statusCode, 400);
  r = await app.inject({ method: "DELETE", url: `/api/tasks/a/comments/${cid}` });
  assert.equal(r.json().ok, true);
  assert.equal((await repo.get("tasks", "a")).comments.length, 0);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/tasks/a/comments/nada" })).statusCode, 404);
  assert.deepEqual(await events(repo, "a"), ["comment", "comment_edited", "comment_deleted"]);
});

test("subtarefas: criar, converter, ciclo 409, apagar em cascata", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "p", title: "Pai", column: "doing", saas: "leverads" });
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/tasks/p/subtasks", { title: "Filha" });
  assert.equal(r.statusCode, 201);
  const child = r.json();
  assert.equal(child.parentId, "p");
  assert.equal(child.column, "doing");
  assert.equal(child.saas, "leverads");
  assert.deepEqual(await events(repo, "p"), ["subtask_added"], "o pai nasceu direto no repo, sem evento de criação");
  const grand = (await post(app, `/api/tasks/${child.id}/subtasks`, { title: "Neta" })).json();
  assert.equal((await post(app, "/api/tasks/p/convert", { to: "subtask", parentId: grand.id })).statusCode, 409, "ciclo");
  assert.equal((await post(app, "/api/tasks/p/convert", { to: "subtask", parentId: "p" })).statusCode, 400);
  r = await post(app, `/api/tasks/${child.id}/convert`, { to: "task" });
  assert.equal(r.json().parentId, "");
  r = await post(app, `/api/tasks/${child.id}/convert`, { to: "subtask", parentId: "p" });
  assert.equal(r.json().parentId, "p");
  assert.equal((await post(app, `/api/tasks/${child.id}/followers`, { user: "vitor" })).json().followers.includes("vitor"), true);
  const del = await app.inject({ method: "DELETE", url: "/api/tasks/p" });
  assert.deepEqual(del.json().removed.sort(), ["p", child.id, grand.id].sort());
  assert.equal((await repo.list("tasks")).length, 0);
  assert.equal((await repo.list("task_events")).length, 0, "atividade some junto");
});

test("duplicar e tarefa de acompanhamento", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "p", title: "Pai", column: "todo", labels: ["bug"], assignees: ["leo"], comments: [{ id: "c1", author: "leo", text: "x" }] });
  await repo.create("tasks", { id: "s", title: "Sub", column: "todo", parentId: "p" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const copy = (await post(app, "/api/tasks/p/duplicate", {})).json();
  assert.equal(copy.title, "Pai (cópia)");
  assert.equal(copy.duplicatedFrom, "p");
  assert.deepEqual(copy.comments, []);
  assert.deepEqual(copy.labels, ["bug"]);
  const subs = (await repo.list("tasks")).filter((x) => x.parentId === copy.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].title, "Sub");
  const fu = (await post(app, "/api/tasks/p/follow-up", { dueDate: "2026-09-20" })).json();
  assert.equal(fu.title, "Follow-up: Pai");
  assert.equal(fu.followUpOf, "p");
  assert.equal(fu.dueDate, "2026-09-20");
  assert.deepEqual(fu.assignees, ["leo"]);
  assert.ok((await events(repo, "p")).includes("followup_created"));
});

test("bloqueios: adicionar, ciclo 409, concluir a bloqueadora desbloqueia", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("users", { id: "vitor", name: "Vitor", passwordHash: "x" });
  await repo.create("tasks", { id: "a", title: "Depende", column: "todo", assignees: ["vitor"] });
  await repo.create("tasks", { id: "b", title: "Bloqueadora", column: "todo" });
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/tasks/a/blockers", { taskId: "b" });
  assert.deepEqual(r.json().blockedBy, ["b"]);
  assert.equal((await post(app, "/api/tasks/b/blockers", { taskId: "a" })).statusCode, 409);
  assert.equal((await post(app, "/api/tasks/a/blockers", { taskId: "a" })).statusCode, 400);
  await post(app, "/api/tasks/b/complete", {});
  assert.ok((await events(repo, "a")).includes("unblocked"));
  const notes = await repo.list("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user, "vitor");
  assert.equal(notes[0].type, "unblocked");
  r = await app.inject({ method: "DELETE", url: "/api/tasks/a/blockers/b" });
  assert.deepEqual(r.json().blockedBy, []);
  // apagar a bloqueadora some dos bloqueios alheios
  await post(app, "/api/tasks/a/blockers", { taskId: "b" });
  await app.inject({ method: "DELETE", url: "/api/tasks/b" });
  assert.deepEqual((await repo.get("tasks", "a")).blockedBy, []);
});

const mpPayload = (boundary, name, mime, bytes) => Buffer.concat([
  Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: ${mime}\r\n\r\n`),
  bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
]);

test("anexos: pdf e imagem, capa, 5MB, órfão só some quando ninguém usa", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "a", title: "a", column: "todo" });
  const app = Fastify();
  await app.register(multipart);
  registerRoutes(app, repo);
  t.after(() => app.close());
  const boundary = "----cockpittest";
  const mp = { "content-type": `multipart/form-data; boundary=${boundary}` };

  let r = await app.inject({ method: "POST", url: "/api/tasks/a/attachments", headers: mp, payload: mpPayload(boundary, "contrato.pdf", "application/pdf", Buffer.from("%PDF-fake")) });
  assert.equal(r.statusCode, 201, r.body);
  const pdf = r.json().attachment;
  assert.match(pdf.url, /^\/public\/tasks\/tka_/);
  assert.equal(pdf.mime, "application/pdf");
  assert.equal(r.json().task.cover, "", "pdf não vira capa");
  r = await app.inject({ method: "POST", url: "/api/tasks/a/attachments", headers: mp, payload: mpPayload(boundary, "print.png", "image/png", Buffer.from("fake-png")) });
  const png = r.json().attachment;
  assert.equal(r.json().task.cover, png.url, "1ª imagem vira capa");
  assert.equal(r.json().task.photo, png.url, "photo segue a capa (compat)");
  const served = await app.inject({ method: "GET", url: pdf.url });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"].split(";")[0], "application/pdf");
  assert.match(served.headers["content-disposition"], /inline/);
  const big = await app.inject({ method: "POST", url: "/api/tasks/a/attachments", headers: mp, payload: mpPayload(boundary, "big.bin", "application/octet-stream", Buffer.alloc(5 * 1024 * 1024 + 1)) });
  assert.equal(big.statusCode, 413);
  // capa manual + remoção
  r = await app.inject({ method: "POST", url: "/api/tasks/a/cover", payload: { attachmentId: pdf.id } });
  assert.equal(r.json().cover, pdf.url);
  const copy = (await app.inject({ method: "POST", url: "/api/tasks/a/duplicate", payload: {} })).json();
  assert.equal(copy.attachments.length, 2);
  r = await app.inject({ method: "DELETE", url: `/api/tasks/a/attachments/${pdf.id}` });
  assert.equal(r.json().attachments.length, 1);
  assert.equal(r.json().cover, "", "capa removida junto");
  assert.ok(await repo.get("task_assets", pdf.id), "a cópia ainda usa o arquivo");
  await app.inject({ method: "DELETE", url: `/api/tasks/${copy.id}/attachments/${pdf.id}` });
  assert.equal(await repo.get("task_assets", pdf.id), null, "sem uso, o arquivo some");
  // as rotas antigas continuam: só imagem no feedback/mapa, qualquer arquivo em /api/tasks/asset
  assert.equal((await app.inject({ method: "POST", url: "/api/feedback/asset", headers: mp, payload: mpPayload(boundary, "a.txt", "text/plain", Buffer.from("x")) })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/tasks/asset", headers: mp, payload: mpPayload(boundary, "a.txt", "text/plain", Buffer.from("x")) })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/task_assets" })).statusCode, 404);
});

test("ações em massa e atividade mesclada", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", BOARD);
  await repo.create("tasks", { id: "a", title: "a", column: "todo", comments: [{ id: "c1", author: "leo", text: "oi", at: "2026-09-10T10:00:00Z" }] });
  await repo.create("tasks", { id: "b", title: "b", column: "todo" });
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/tasks/bulk", { ids: ["a", "b", "nao"], action: "assign", value: ["vitor"] });
  assert.deepEqual(r.json(), { ok: ["a", "b"], missing: ["nao"], failed: [] });
  assert.deepEqual((await repo.get("tasks", "b")).assignees, ["vitor"]);
  r = await post(app, "/api/tasks/bulk", { ids: ["a"], action: "due", value: "errada" });
  assert.equal(r.json().failed[0].code, "date_invalid");
  await post(app, "/api/tasks/bulk", { ids: ["a", "b"], action: "move", value: "doing" });
  await post(app, "/api/tasks/bulk", { ids: ["a"], action: "complete" });
  assert.equal((await repo.get("tasks", "a")).completed, true);
  assert.equal((await post(app, "/api/tasks/bulk", { ids: [], action: "complete" })).statusCode, 400);
  assert.equal((await post(app, "/api/tasks/bulk", { ids: ["a"], action: "explodir" })).statusCode, 400);
  const act = (await app.inject({ url: "/api/tasks/a/activity" })).json();
  assert.equal(act[0].kind, "comment", "comentário antigo vem antes dos eventos de hoje");
  assert.ok(act.some((x) => x.kind === "event" && x.type === "completed"));
  await post(app, "/api/tasks/bulk", { ids: ["a", "b"], action: "delete" });
  assert.equal((await repo.list("tasks")).length, 0);
});

test("task_boards: criar herda a coluna de concluído; tirar a coluna limpa o doneKey", async (t) => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  t.after(() => app.close());
  let r = await post(app, "/api/task_boards", { columns: [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Fazendo" }, { key: "done", name: "Concluído" }] });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().doneKey, "done");
  assert.equal(r.json().completeMovesToDone, true);
  const id = r.json().id;
  r = await app.inject({ method: "PATCH", url: `/api/task_boards/${id}`, payload: { columns: [{ key: "todo", name: "A fazer" }], labels: [{ name: "bug", color: "red" }, { name: "Bug" }] } });
  assert.equal(r.json().doneKey, "");
  assert.deepEqual(r.json().labels, [{ name: "bug", color: "red" }]);
  assert.equal((await app.inject({ method: "PATCH", url: `/api/task_boards/${id}`, payload: { columns: [] } })).statusCode, 400);
});
