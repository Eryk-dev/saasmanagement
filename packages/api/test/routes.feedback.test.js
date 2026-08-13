// Widget de feedback (FAB em toda tela) — POST /api/feedback vira card no
// quadro de Tarefas (label bug/melhoria, contexto na descrição, fim da 1ª
// coluna do board); GET devolve o recorte do painel (reportes + colunas).
// As rotas são próprias justamente pra NÃO passar pelo guard da tela "tasks":
// usuário restrito também reporta bug.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, ensureDefaultAdmins, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

test("POST /api/feedback: bug vira card P1 no fim da 1ª coluna do board", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", { id: "b1", columns: [{ key: "entrada", name: "Entrada" }, { key: "done", name: "Feito" }] });
  await repo.create("tasks", { id: "t1", title: "Já existia", column: "entrada", order: 3 });
  const app = buildApp(repo);
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST", url: "/api/feedback",
    payload: { kind: "bug", text: "Tabela some no mobile\nAcontece na tela de Clientes em 390px", screen: "Comercial · Clientes", photo: "/public/tasks/tka_x" },
  });
  assert.equal(res.statusCode, 200);
  const task = res.json();
  assert.equal(task.title, "Tabela some no mobile");
  assert.match(task.description, /Acontece na tela de Clientes/);
  assert.match(task.description, /tela Comercial · Clientes/);
  assert.deepEqual(task.labels, ["bug"]);
  assert.equal(task.priority, "P1");
  assert.equal(task.column, "entrada");
  assert.equal(task.order, 4, "entra DEPOIS do card existente");
  assert.equal(task.photo, "/public/tasks/tka_x");
  assert.equal(task.saas, "", "card geral: aparece em qualquer workspace");
  assert.ok(task.createdAt);
});

test("melhoria vira P2; texto vazio 400; photo de fora é descartada", async (t) => {
  const repo = makeMemRepo();
  const app = buildApp(repo);
  t.after(() => app.close());

  const ok = await app.inject({
    method: "POST", url: "/api/feedback",
    payload: { kind: "melhoria", text: "Atalho pro quadro", photo: "https://evil.example/x.png" },
  });
  assert.deepEqual(ok.json().labels, ["melhoria"]);
  assert.equal(ok.json().priority, "P2");
  assert.equal(ok.json().photo, "", "só asset nosso (/public/tasks/) entra no card");
  assert.equal(ok.json().column, "todo", "sem board salvo, cai na coluna padrão");

  const vazio = await app.inject({ method: "POST", url: "/api/feedback", payload: { kind: "bug", text: "  " } });
  assert.equal(vazio.statusCode, 400);
});

test("GET /api/feedback: só reportes (bug/melhoria), mais novo primeiro, com colunas", async (t) => {
  const repo = makeMemRepo();
  await repo.create("task_boards", { id: "b1", columns: [{ key: "todo", name: "A fazer" }] });
  await repo.create("tasks", { id: "t1", title: "Tarefa comum", labels: [], createdAt: "2026-08-01T00:00:00Z" });
  await repo.create("tasks", { id: "t2", title: "Bug velho", labels: ["bug"], createdAt: "2026-08-02T00:00:00Z" });
  await repo.create("tasks", { id: "t3", title: "Ideia nova", labels: ["melhoria"], createdAt: "2026-08-05T00:00:00Z" });
  const app = buildApp(repo);
  t.after(() => app.close());

  const body = (await app.inject({ url: "/api/feedback" })).json();
  assert.deepEqual(body.reports.map((r) => r.id), ["t3", "t2"], "sem a tarefa comum, ordenado do mais novo");
  assert.deepEqual(body.columns.map((c) => c.key), ["todo"]);
});

test("usuário SEM a tela tasks reporta pelo /api/feedback (o /api/tasks segue 403)", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", {
    id: "ana", name: "Ana", role: "admin", roles: ["cs"],
    screens: ["today"], passwordHash: hashPassword("1234"),
  });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "ana", password: "1234" } });
  const H = { "x-api-key": login.json().token };

  assert.equal((await app.inject({ url: "/api/tasks", headers: H })).statusCode, 403, "o quadro em si continua fechado");
  assert.equal((await app.inject({ url: "/api/feedback", headers: H })).statusCode, 200);
  const sent = await app.inject({ method: "POST", url: "/api/feedback", headers: H, payload: { kind: "bug", text: "Consulta sem link do Meet", screen: "Minhas atividades" } });
  assert.equal(sent.statusCode, 200);
  assert.match(sent.json().description, /por Ana/, "quem reportou vem do authUser, não do body");
});
