// Caixa de entrada das tarefas: quem é atribuído/mencionado/segue recebe a
// notificação; a rota vale pra QUALQUER sessão (fora do guard de telas), cada
// um só vê as próprias; a chave mestre precisa dizer de quem.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, ensureDefaultAdmins, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook, screenForRequest } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

async function buildApp(repo) {
  await ensureDefaultAdmins(repo);
  await repo.create("users", { id: "ana", name: "Ana Lima", role: "admin", roles: ["cs"], screens: ["today"], passwordHash: hashPassword("1234") });
  await repo.create("users", { id: "vitor", name: "Vitor Souza", role: "admin", roles: ["closer"], screens: [], passwordHash: hashPassword("1234") });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  const login = async (u) => ({ "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u, password: "1234" } })).json().token });
  return { app, ANA: await login("ana"), VITOR: await login("vitor"), KEY: { "x-api-key": "test-key" } };
}

test("atribuição, menção e comentário viram notificação de quem NÃO agiu", async (t) => {
  const repo = makeMemRepo();
  const { app, ANA, VITOR } = await buildApp(repo);
  t.after(() => app.close());

  const task = (await app.inject({ method: "POST", url: "/api/tasks", headers: VITOR, payload: { title: "Ligar pro cliente", assignees: ["ana", "vitor"] } })).json();
  assert.equal(task.createdBy, "vitor");
  assert.deepEqual(task.followers.sort(), ["ana", "vitor"]);
  assert.equal((await app.inject({ url: "/api/tasks", headers: ANA })).statusCode, 403, "o quadro em si continua fechado pra Ana");
  let inbox = (await app.inject({ url: "/api/notifications", headers: ANA })).json();
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.items[0].type, "assigned");
  assert.match(inbox.items[0].text, /Vitor Souza te atribuiu/);
  assert.equal((await app.inject({ url: "/api/notifications", headers: VITOR })).json().unread, 0, "quem atribuiu não é avisado");

  await app.inject({ method: "POST", url: `/api/tasks/${task.id}/comments`, headers: VITOR, payload: { text: "@Ana Lima consegue hoje?" } });
  inbox = (await app.inject({ url: "/api/notifications?unread=1", headers: ANA })).json();
  assert.deepEqual(inbox.items.map((n) => n.type).sort(), ["assigned", "mention"]);
  const saved = await repo.get("tasks", task.id);
  assert.equal(saved.comments[0].author, "vitor", "autor é o ID da sessão");
  assert.deepEqual(saved.comments[0].mentions, ["ana"]);

  // Ana comenta: Vitor (seguidor) é avisado; Ana não.
  await app.inject({ method: "POST", url: `/api/tasks/${task.id}/comments`, headers: ANA, payload: { text: "consigo" } }).then((r) => assert.equal(r.statusCode, 403, "comentar pela rota exige a tela"));
  await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}`, headers: VITOR, payload: { dueDate: "2026-09-15" } });
  inbox = (await app.inject({ url: "/api/notifications?unread=1", headers: ANA })).json();
  assert.ok(inbox.items.some((n) => n.type === "due_changed" && /15\/09/.test(n.text)));

  // marcar lidas: só as próprias
  const vitorSees = (await app.inject({ url: "/api/notifications", headers: VITOR })).json();
  assert.equal(vitorSees.items.length, 0);
  const marked = (await app.inject({ method: "POST", url: "/api/notifications/read", headers: ANA, payload: { all: true } })).json();
  assert.equal(marked.marked, 3);
  assert.equal((await app.inject({ url: "/api/notifications", headers: ANA })).json().unread, 0);

  // curtida com sessão + notificação pro responsável
  const like = (await app.inject({ method: "POST", url: `/api/tasks/${task.id}/like`, headers: VITOR })).json();
  assert.equal(like.liked, true);
  assert.deepEqual(like.likes, ["vitor"]);
  assert.ok((await app.inject({ url: "/api/notifications?unread=1", headers: ANA })).json().items.some((n) => n.type === "like"));
});

test("dedupe de 10 min e chave mestre com ?user=", async (t) => {
  const repo = makeMemRepo();
  const { app, VITOR, KEY } = await buildApp(repo);
  t.after(() => app.close());
  const task = (await app.inject({ method: "POST", url: "/api/tasks", headers: VITOR, payload: { title: "X" } })).json();
  await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}`, headers: VITOR, payload: { assignees: ["ana"] } });
  await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}`, headers: VITOR, payload: { assignees: [] } });
  await app.inject({ method: "PATCH", url: `/api/tasks/${task.id}`, headers: VITOR, payload: { assignees: ["ana"] } });
  const rows = await repo.listWhere("notifications", { user: "ana", type: "assigned" });
  assert.equal(rows.length, 1, "atribuir de novo em 10 min atualiza a mesma");
  assert.equal((await app.inject({ url: "/api/notifications", headers: KEY })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/notifications?user=ana", headers: KEY })).json().unread, 2);
});

test("guard: sub-rotas de tarefa herdam a tela `tasks`; caixa de entrada é de qualquer sessão", () => {
  assert.deepEqual(screenForRequest("POST", "/api/tasks/t1/comments"), ["tasks"]);
  assert.deepEqual(screenForRequest("POST", "/api/tasks/bulk"), ["tasks"]);
  assert.deepEqual(screenForRequest("PATCH", "/api/task_boards/b1"), ["tasks"]);
  assert.equal(screenForRequest("GET", "/api/notifications"), null);
  assert.equal(screenForRequest("POST", "/api/notifications/read"), null);
  assert.equal(screenForRequest("POST", "/api/feedback/asset"), null);
});
