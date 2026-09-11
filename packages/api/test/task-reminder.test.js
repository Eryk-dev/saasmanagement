// Lembrete diário das tarefas: uma notificação por responsável (ou por quem
// criou, sem responsável) pra tarefa vencendo hoje ou atrasada, só depois da
// hora, uma vez por dia (mesmo com restart), com resumo no Discord quando
// há webhook e faxina das lidas antigas.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { startTaskReminder } from "../src/task-reminder.js";
import { makeDiscord } from "../src/discord.js";

const at = (iso) => new Date(iso);
const setup = async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "leonardo", name: "Leonardo", passwordHash: "x" });
  await repo.create("users", { id: "vitor", name: "Vitor", passwordHash: "x" });
  await repo.create("tasks", { id: "t1", title: "Hoje", dueDate: "2026-09-10", assignees: ["leonardo"], completed: false });
  await repo.create("tasks", { id: "t2", title: "Atrasada", dueDate: "2026-09-07", assignees: ["leonardo", "vitor"], completed: false });
  await repo.create("tasks", { id: "t3", title: "Sem dono", dueDate: "2026-09-01", assignees: [], createdBy: "vitor", completed: false });
  await repo.create("tasks", { id: "t4", title: "Feita", dueDate: "2026-09-10", assignees: ["vitor"], completed: true });
  await repo.create("tasks", { id: "t5", title: "Futura", dueDate: "2026-09-20", assignees: ["vitor"], completed: false });
  await repo.create("tasks", { id: "t6", title: "Fantasma", dueDate: "2026-09-10", assignees: ["ninguem"], createdBy: "api", completed: false });
  return repo;
};

test("gate de hora, uma notificação por pessoa e tarefa, resumo no Discord, sem duplicar no dia", async (t) => {
  const repo = await setup();
  const calls = [];
  const discord = makeDiscord({ webhookUrl: "http://x", fetch: async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true }; } });
  const job = startTaskReminder(repo, { discord, intervalMs: 1e9, now: () => at("2026-09-10T10:30:00Z") }); // 07:30 em SP
  t.after(job.stop);

  assert.equal(await job.tick(at("2026-09-10T10:30:00Z")), null, "antes das 8h de SP não roda");
  const r = await job.tick(at("2026-09-10T11:05:00Z")); // 08:05 em SP
  assert.equal(r.day, "2026-09-10");
  assert.equal(r.created, 4, "t1→leonardo, t2→leonardo+vitor, t3→vitor (criador); feita/futura/fantasma fora");
  const leo = await repo.listWhere("notifications", { user: "leonardo" });
  assert.deepEqual(leo.map((n) => n.type).sort(), ["due_today", "overdue"]);
  assert.match(leo.find((n) => n.type === "overdue").text, /atrasada há 3 dias/);
  const vitor = await repo.listWhere("notifications", { user: "vitor" });
  assert.equal(vitor.length, 2);
  assert.ok(vitor.every((n) => n.key.startsWith("due:")));
  assert.equal(calls.length, 1, "um embed no Discord");
  assert.match(calls[0].embeds[0].description, /\*\*Leonardo\*\*: 1 pra hoje · 1 atrasada/);
  assert.equal(await job.tick(at("2026-09-10T15:00:00Z")), null, "mesmo dia: já mandou");
  assert.equal((await repo.list("notifications")).length, 4);
  // dia seguinte: a atrasada avisa de novo (chave por dia), a de hoje virou atrasada
  const r2 = await job.tick(at("2026-09-11T11:05:00Z"));
  assert.equal(r2.created, 4);
  assert.equal((await repo.list("notifications")).length, 8);
});

test("roda sem Discord e faz a faxina das lidas antigas", async (t) => {
  const repo = await setup();
  await repo.create("notifications", { id: "old", user: "leonardo", type: "comment", task: "t1", read: true, readAt: "2026-07-01T00:00:00Z", at: "2026-07-01T00:00:00Z" });
  await repo.create("notifications", { id: "fresh", user: "leonardo", type: "comment", task: "t1", read: true, readAt: "2026-09-09T00:00:00Z", at: "2026-09-09T00:00:00Z" });
  await repo.create("notifications", { id: "unread", user: "leonardo", type: "comment", task: "t1", read: false, readAt: "", at: "2026-07-01T00:00:00Z" });
  const job = startTaskReminder(repo, { discord: makeDiscord({}), intervalMs: 1e9, now: () => at("2026-09-10T12:00:00Z") });
  t.after(job.stop);
  const r = await job.run();
  assert.equal(r.created, 4);
  assert.equal(r.purged, 1);
  assert.equal(await repo.get("notifications", "old"), null);
  assert.ok(await repo.get("notifications", "fresh"));
  assert.ok(await repo.get("notifications", "unread"), "não lida nunca é apagada");
  assert.equal((await repo.get("app_config", "task_reminder")).lastSentDay, "2026-09-10");
});
