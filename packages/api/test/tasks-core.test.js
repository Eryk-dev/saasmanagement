// Núcleo do quadro de Tarefas (tasks-core.js): ordem/renumeração, regras de
// coluna, conclusão, recorrência, menções, diff → eventos, composição.

import test from "node:test";
import assert from "node:assert/strict";
import {
  placement, applyColumnRules, setCompleted, nextDueDate, parseMentions, diffTask, composeTask,
  normalizeBoard, sanitizeBoardPatch, cleanRecurrence, siblingsOf, addDays, withTaskLock,
} from "../src/tasks-core.js";

const BOARD = normalizeBoard({ id: "b1", columns: [{ key: "todo", name: "A fazer" }, { key: "doing", name: "Fazendo" }, { key: "done", name: "Concluído" }], doneKey: "done" });
const sib = (id, order) => ({ id, order, createdAt: "2026-01-01" });

test("placement: fim, antes, depois, topo e ponto médio", () => {
  const sibs = [sib("a", 1), sib("b", 2), sib("c", 3)];
  assert.deepEqual(placement([], {}), { order: 1, index: 0, rebalance: false });
  assert.equal(placement(sibs, {}).order, 4);
  assert.equal(placement(sibs, { beforeId: "a" }).order, 0);
  assert.equal(placement(sibs, { beforeId: "b" }).order, 1.5);
  assert.equal(placement(sibs, { afterId: "b" }).order, 2.5);
  assert.equal(placement(sibs, { afterId: "c" }).order, 4);
  assert.throws(() => placement(sibs, { beforeId: "zz" }), /referência/);
});

test("placement: vão esgotado pede renumeração", () => {
  const sibs = [sib("a", 1), sib("b", 1 + 1e-9)];
  const p = placement(sibs, { beforeId: "b" });
  assert.equal(p.rebalance, true);
  assert.equal(p.index, 1);
});

test("regras de coluna: entrar em Concluído conclui, sair reabre, atribui e prioriza", () => {
  const board = normalizeBoard({ columns: [{ key: "todo", name: "A fazer" }, { key: "rev", name: "Revisão", rules: { assign: ["vitor"], priority: "P0" } }, { key: "done", name: "Feito" }], doneKey: "done" });
  const t = { id: "t1", column: "todo", completed: false, assignees: ["leo"], priority: "" };
  const a = applyColumnRules(board, t, "todo", "done", { by: "leo", now: "2026-09-10T12:00:00Z" });
  assert.equal(a.task.completed, true);
  assert.equal(a.task.completedBy, "leo");
  assert.deepEqual(a.applied, ["complete"]);
  const b = applyColumnRules(board, a.task, "done", "todo", { by: "leo" });
  assert.equal(b.task.completed, false);
  assert.deepEqual(b.applied, ["reopen"]);
  const c = applyColumnRules(board, t, "todo", "rev", { by: "leo" });
  assert.deepEqual(c.task.assignees, ["leo", "vitor"]);
  assert.equal(c.task.priority, "P0");
  assert.deepEqual(c.applied, ["assign", "priority"]);
});

test("setCompleted: concluir leva pra coluna de concluído e reabrir devolve", () => {
  const t = { id: "t1", column: "doing", completed: false };
  const done = setCompleted(t, true, { by: "leo", now: "2026-09-10T12:00:00Z", board: BOARD });
  assert.equal(done.column, "done");
  assert.equal(done.completedFrom, "doing");
  assert.equal(done._reorder, "end");
  const back = setCompleted(done, false, { by: "leo", board: BOARD });
  assert.equal(back.column, "doing");
  assert.equal(back.completedFrom, "");
  assert.equal(back.completedAt, "");
  // coluna fixada pelo pedido: não move
  const fixed = setCompleted(t, true, { by: "leo", board: BOARD, columnExplicit: true });
  assert.equal(fixed.column, "doing");
});

test("nextDueDate: dia, semana com dias marcados, mês com âncora e until", () => {
  assert.equal(nextDueDate({ every: "day", interval: 3 }, "2026-09-09"), "2026-09-12");
  assert.equal(nextDueDate({ every: "week" }, "2026-09-09"), "2026-09-16");
  // quarta 09/09 com seg/qua marcados → próxima segunda 14/09; segunda → quarta da mesma semana
  assert.equal(nextDueDate({ every: "week", weekdays: [1, 3] }, "2026-09-09"), "2026-09-14");
  assert.equal(nextDueDate({ every: "week", weekdays: [1, 3] }, "2026-09-14"), "2026-09-16");
  // a cada 2 semanas na quarta: pula a semana do meio
  assert.equal(nextDueDate({ every: "week", weekdays: [3], interval: 2 }, "2026-09-09"), "2026-09-23");
  assert.equal(nextDueDate({ every: "month" }, "2026-01-31"), "2026-02-28");
  assert.equal(nextDueDate({ every: "month", monthDay: 31 }, "2026-02-28"), "2026-03-31");
  assert.equal(nextDueDate({ every: "month", interval: 2 }, "2026-11-15"), "2027-01-15");
  assert.equal(nextDueDate({ every: "day", until: "2026-09-10" }, "2026-09-10"), "");
  assert.equal(nextDueDate({ every: "day" }, "", "2026-09-10"), "2026-09-11");
  assert.equal(nextDueDate(null, "2026-09-10"), "");
  assert.deepEqual(cleanRecurrence({ every: "week", interval: "2", weekdays: [3, 1, 9], until: "x" }), { every: "week", interval: 2, weekdays: [1, 3], until: "", monthDay: 0 });
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("parseMentions: id, nome completo, primeiro nome único, acento, desconhecido fora", () => {
  const users = [{ id: "leonardo", name: "Leonardo Parra" }, { id: "vitor", name: "Vítor Souza" }, { id: "analima", name: "Ana Lima" }, { id: "anapaula", name: "Ana Paula" }];
  assert.deepEqual(parseMentions("oi @Leonardo Parra e @vitor, tudo bem? @leonardo de novo", users), ["leonardo", "vitor"]);
  assert.deepEqual(parseMentions("fala @Vitor!", users), ["vitor"]);
  assert.deepEqual(parseMentions("@Ana vê isso", users), [], "primeiro nome ambíguo não casa");
  assert.deepEqual(parseMentions("@Ana Lima vê isso", users), ["analima"]);
  assert.deepEqual(parseMentions("@analima e @Ana Paula", users), ["analima", "anapaula"], "id direto e nome completo");
  assert.deepEqual(parseMentions("email leo@x.com não é menção; @ninguem também não", users), []);
});

test("diffTask: gera os eventos certos", () => {
  const before = { assignees: ["leo"], dueDate: "", priority: "", column: "todo", completed: false, comments: [], attachments: [], blockedBy: [], followers: ["leo"], title: "A" };
  const after = { ...before, assignees: ["vitor"], dueDate: "2026-09-12", column: "done", completed: true, comments: [{ id: "c1", author: "leo", text: "ok", mentions: ["vitor"] }], title: "B" };
  const types = diffTask(before, after).map((e) => e.type);
  assert.deepEqual(types, ["assigned", "unassigned", "due_changed", "moved", "completed", "updated", "comment"]);
});

test("composeTask: defaults, responsável legado, seguidores, data inválida", () => {
  const t = composeTask({ title: "  X ", assignee: "vitor", dueDate: "2026-09-12", column: "nada" }, { by: "leo", board: BOARD, now: "2026-09-10T12:00:00Z" });
  assert.equal(t.title, "X");
  assert.deepEqual(t.assignees, ["vitor"]);
  assert.equal(t.assignee, undefined);
  assert.equal(t.column, "todo", "coluna desconhecida cai na primeira");
  assert.deepEqual(t.followers, ["leo", "vitor"]);
  assert.equal(t.createdBy, "leo");
  assert.equal(t.completed, false);
  assert.equal(t.version, 0);
  assert.throws(() => composeTask({ title: "x", dueDate: "12/09/2026" }, { board: BOARD }), /AAAA-MM-DD/);
  const api = composeTask({ title: "x", createdBy: "mcp" }, { board: BOARD });
  assert.equal(api.createdBy, "mcp");
  assert.deepEqual(api.followers, []);
});

test("board: sem doc = defaults com done; sem doneKey = regra antiga; doneKey vazio explícito respeitado", () => {
  assert.equal(normalizeBoard(null).doneKey, "done");
  assert.equal(normalizeBoard({ columns: [{ key: "x", name: "Feito e concluído" }] }).doneKey, "x");
  assert.equal(normalizeBoard({ columns: [{ key: "x", name: "Concluído" }], doneKey: "" }).doneKey, "");
  assert.equal(normalizeBoard({ columns: [{ key: "x", name: "A" }], doneKey: "sumiu" }).doneKey, "");
  const created = sanitizeBoardPatch({ columns: [{ key: "todo", name: "A fazer" }, { key: "done", name: "Concluído" }] }, null);
  assert.equal(created.doneKey, "done");
  assert.equal(created.completeMovesToDone, true);
  // tirar a coluna de concluído limpa o doneKey
  const cur = { columns: [{ key: "todo", name: "A" }, { key: "done", name: "B" }], doneKey: "done" };
  assert.equal(sanitizeBoardPatch({ columns: [{ key: "todo", name: "A" }] }, cur).doneKey, "");
  assert.equal(sanitizeBoardPatch({ columns: [{ key: "todo", name: "A" }, { key: "done", name: "B", rules: { complete: true, assign: ["leo"], priority: "P9" } }] }, cur).columns[1].rules.priority, undefined);
  assert.throws(() => sanitizeBoardPatch({ columns: [] }, cur), /pelo menos uma coluna/);
});

test("siblingsOf: coluna no topo, pai nas subtarefas; coluna desconhecida cai na primeira", () => {
  const all = [
    { id: "a", column: "todo", order: 2 }, { id: "b", column: "todo", order: 1 }, { id: "c", column: "zzz", order: 0 },
    { id: "s1", column: "todo", parentId: "a", order: 1 }, { id: "s2", column: "done", parentId: "a", order: 2 },
  ];
  assert.deepEqual(siblingsOf(all, { id: "x", column: "todo" }, BOARD).map((t) => t.id), ["c", "b", "a"]);
  assert.deepEqual(siblingsOf(all, { id: "x", parentId: "a" }, BOARD).map((t) => t.id), ["s1", "s2"]);
});

test("withTaskLock: serializa por id e segue depois de erro", async () => {
  const log = [];
  const p1 = withTaskLock("t", async () => { await new Promise((r) => setTimeout(r, 15)); log.push("1"); throw new Error("x"); });
  const p2 = withTaskLock("t", async () => { log.push("2"); });
  const p3 = withTaskLock("outra", async () => { log.push("3"); });
  await assert.rejects(p1);
  await Promise.all([p2, p3]);
  assert.deepEqual(log, ["3", "1", "2"]);
});
