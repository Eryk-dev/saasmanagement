// Régua de marcos no servidor: o espelho com o módulo do web, a janela que
// decide quando o marco vira tarefa e a sincronia nos dois sentidos.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  milestonesFor, dueMilestones, inMilestoneRuler, taskCopyFor, startCustomerMilestones,
  completeMilestoneTasks, DEFAULT_MILESTONES, RENEWAL_LEAD_DAYS,
} from "../src/customer-milestones.js";
import * as web from "../../web/src/lib/milestones.js";
import { completeTask, patchTask } from "../src/tasks-core.js";

const DAY = 86_400_000;
const HOJE = Date.UTC(2026, 8, 13); // 13/09/2026
const desde = (dias) => new Date(HOJE - dias * DAY).toISOString();

// ── Espelho ────────────────────────────────────────────────────────────────
test("espelho: o template do servidor é igual ao do web", () => {
  assert.deepEqual(DEFAULT_MILESTONES, web.DEFAULT_MILESTONES);
  assert.equal(RENEWAL_LEAD_DAYS, web.RENEWAL_LEAD_DAYS);
});

test("espelho: milestonesFor devolve a mesma linha do tempo nos mesmos fixtures", () => {
  const fixtures = [
    { startedAt: desde(3), plan: "Anual" },
    { startedAt: desde(95), plan: "Semestral", milestonesDone: { onboarding: "2026-06-20", checkin_m1: "2026-07-14" } },
    { startedAt: desde(400), plan: "Mensal" },
    { startedAt: desde(10), plan: "Serviço único" },
    { startedAt: desde(10), contractCycle: "quarterly" },
    { startedAt: "", plan: "Anual" },
  ];
  const produtos = [undefined, { milestones: [{ key: "kick", label: "Kickoff", dueDays: 2 }] }];
  for (const c of fixtures) {
    for (const p of produtos) {
      assert.deepEqual(milestonesFor(c, p, HOJE), web.milestonesFor(c, p, HOJE), JSON.stringify({ c, p }));
    }
  }
});

// ── Janela ────────────────────────────────────────────────────────────────
test("dueMilestones: pega o que vence em até 7 dias e o que venceu há até 30", () => {
  const c = { startedAt: desde(30), plan: "Anual" }; // check-in de mês 1 vence hoje
  const keys = dueMilestones(c, null, { now: HOJE }).map((m) => m.key);
  assert.deepEqual(keys, ["onboarding", "checkin_m1"]); // onboarding venceu há 23 dias
  assert.ok(!keys.includes("revisao_m3")); // ainda faltam 60 dias
});

test("dueMilestones: marco vencido há mais de 30 dias fica pra trás", () => {
  const c = { startedAt: desde(200), plan: "Anual" };
  const keys = dueMilestones(c, null, { now: HOJE }).map((m) => m.key);
  assert.deepEqual(keys, ["upsell_m6"]); // venceu há 20 dias; onboarding/check-in/revisão passaram do teto
});

test("dueMilestones: marco já concluído não volta", () => {
  const c = { startedAt: desde(30), plan: "Anual", milestonesDone: { onboarding: "2026-08-25", checkin_m1: "2026-09-13" } };
  assert.deepEqual(dueMilestones(c, null, { now: HOJE }), []);
});

test("inMilestoneRuler: mentoria e churnado ficam fora; sem data de entrada também", () => {
  assert.equal(inMilestoneRuler({ startedAt: desde(10), saas: "leverads" }, HOJE), true);
  assert.equal(inMilestoneRuler({ startedAt: desde(10), saas: "uniquekids" }, HOJE), false);
  assert.equal(inMilestoneRuler({ startedAt: desde(10), endedAt: desde(2) }, HOJE), false);
  assert.equal(inMilestoneRuler({ saas: "leverads" }, HOJE), false);
});

test("taskCopyFor: título por marco e a data do fim do contrato na renovação", () => {
  const c = { name: "Lupa Auto Peças", startedAt: "2026-01-10T00:00:00.000Z", plan: "Anual" };
  assert.equal(taskCopyFor({ key: "checkin_m1", label: "Check-in de mês 1", dueDays: 30 }, c).title, "Check-in de mês 1 com Lupa Auto Peças");
  const ren = taskCopyFor({ key: "renovacao", label: "Contato de renovação", dueDays: 305 }, c);
  assert.equal(ren.title, "Contato de renovação com Lupa Auto Peças (contrato termina em 10/01/2027)");
  assert.match(ren.description, /Ao concluir esta tarefa o marco fica marcado na ficha/);
});

// ── Motor ─────────────────────────────────────────────────────────────────
async function cenario({ customer = {}, tasks = true } = {}) {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", name: "Eryk", roles: ["integrator"] });
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  const c = await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Lupa", owner: "eryk", startedAt: desde(30), plan: "Anual", ...customer });
  const runner = tasks ? startCustomerMilestones(repo, { intervalMs: 1e9, now: () => new Date(HOJE) }) : null;
  return { repo, c, runner };
}

test("tick: cria uma tarefa por marco vencido, atribuída ao dono, e não duplica", async () => {
  const { repo, runner } = await cenario();
  const r1 = await runner.tick(new Date(HOJE));
  assert.equal(r1.created, 2); // onboarding + check-in de mês 1
  const tasks = await repo.list("tasks");
  assert.equal(tasks.length, 2);
  const checkin = tasks.find((t) => t.milestoneKey === "checkin_m1");
  assert.equal(checkin.title, "Check-in de mês 1 com Lupa");
  assert.deepEqual(checkin.assignees, ["eryk"]);
  assert.deepEqual([...checkin.labels].sort(), ["marco", "pos-venda"]);
  assert.equal(checkin.dueDate, new Date(HOJE).toISOString().slice(0, 10));
  assert.equal(checkin.customerId, "cu_1");
  const r2 = await runner.tick(new Date(HOJE));
  assert.equal(r2.created, 0);
  assert.equal((await repo.list("tasks")).length, 2);
  runner.stop();
});

test("tick: cliente sem dono gera a tarefa mesmo assim (sem responsável)", async () => {
  const { repo, runner } = await cenario({ customer: { owner: "" } });
  await runner.tick(new Date(HOJE));
  const t = (await repo.list("tasks"))[0];
  assert.deepEqual(t.assignees, []);
  runner.stop();
});

test("tick: mentoria e churnado não entram na régua", async () => {
  const { repo, runner } = await cenario({ customer: { saas: "uniquekids" } });
  await repo.create("customers", { id: "cu_churn", saas: "leverads", startedAt: desde(30), endedAt: desde(5) });
  assert.equal((await runner.tick(new Date(HOJE))).created, 0);
  assert.equal((await repo.list("tasks")).length, 0);
  runner.stop();
});

test("tick: ciclo da assinatura ativa entra no cálculo da renovação", async () => {
  const { repo, runner } = await cenario({ customer: { plan: "", startedAt: desde(122) } });
  await repo.create("subscriptions", { id: "sub_1", customer: "cu_1", status: "active", cycle: "semiannual" });
  // Semestral (182d): renovação vence no dia 122. Sem a assinatura, o padrão
  // anual colocaria a renovação no dia 305 e nada venceria hoje.
  await runner.tick(new Date(HOJE));
  const keys = (await repo.list("tasks")).map((t) => t.milestoneKey);
  assert.ok(keys.includes("renovacao"), `esperava renovacao, veio ${keys.join(",")}`);
  runner.stop();
});

// ── Sincronia nos dois sentidos ───────────────────────────────────────────
test("tarefa concluída no quadro marca o marco na ficha; reabrir desmarca", async () => {
  const { repo, runner } = await cenario();
  await runner.tick(new Date(HOJE));
  const t = (await repo.list("tasks")).find((x) => x.milestoneKey === "checkin_m1");
  await completeTask(repo, t.id, true, { by: "eryk" });
  assert.ok((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1);
  await completeTask(repo, t.id, false, { by: "eryk" });
  assert.equal((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1, undefined);
  runner.stop();
});

test("conclusão pela coluna do quadro também marca o marco", async () => {
  const { repo, runner } = await cenario();
  await runner.tick(new Date(HOJE));
  const t = (await repo.list("tasks")).find((x) => x.milestoneKey === "onboarding");
  await patchTask(repo, t.id, { completed: true }, { by: "eryk" });
  assert.ok((await repo.get("customers", "cu_1")).milestonesDone.onboarding);
  runner.stop();
});

test("marco concluído na ficha conclui a tarefa aberta", async () => {
  const { repo, runner } = await cenario();
  await runner.tick(new Date(HOJE));
  const c = await repo.get("customers", "cu_1");
  const done = { ...(c.milestonesDone || {}), checkin_m1: new Date(HOJE).toISOString() };
  const updated = await repo.update("customers", "cu_1", { milestonesDone: done });
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 1);
  const t = (await repo.list("tasks")).find((x) => x.milestoneKey === "checkin_m1");
  assert.equal(t.completed, true);
  // Idempotente: rodar de novo não conclui nada (a tarefa já está fechada).
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 0);
  runner.stop();
});

test("hook sai do ar com o runner parado (não vaza entre execuções)", async () => {
  const { repo, runner } = await cenario();
  await runner.tick(new Date(HOJE));
  runner.stop();
  const t = (await repo.list("tasks")).find((x) => x.milestoneKey === "onboarding");
  await completeTask(repo, t.id, true, { by: "eryk" });
  assert.equal((await repo.get("customers", "cu_1")).milestonesDone, undefined);
});

// ── Marco com gate de prova (pedido de depoimento) ────────────────────────
test("gate proof: cliente sem resultado no painel não recebe o pedido de depoimento", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", roles: ["integrator"] });
  await repo.create("products", { id: "leverads" });
  // Dia 100 = o marco do depoimento vence hoje.
  await repo.create("customers", { id: "cu_sem", saas: "leverads", name: "Sem prova", owner: "eryk", startedAt: desde(100), plan: "Anual", leveradsOrgId: "" });
  const runner = startCustomerMilestones(repo, { intervalMs: 1e9, now: () => new Date(HOJE) });
  await runner.tick(new Date(HOJE));
  const keys = (await repo.list("tasks")).map((t) => t.milestoneKey);
  assert.ok(!keys.includes("depoimento"), `não devia pedir depoimento, veio ${keys.join(",")}`);
  runner.stop();
});

test("gate proof: com resultado no painel, o pedido de depoimento vira tarefa com o roteiro", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", roles: ["integrator"] });
  await repo.create("products", { id: "leverads" });
  await repo.create("customers", {
    id: "cu_com", saas: "leverads", name: "Lupa", owner: "eryk", startedAt: desde(100), plan: "Anual",
    leveradsOrgId: "11111111-1111-4111-8111-111111111111",
    milestonesDone: { onboarding: "x", checkin_m1: "x", revisao_m3: "x" },
  });
  const runner = startCustomerMilestones(repo, {
    intervalMs: 1e9, now: () => new Date(HOJE),
    influenced: async () => new Map([["11111111-1111-4111-8111-111111111111", 82000]]),
  });
  await runner.tick(new Date(HOJE));
  const t = (await repo.list("tasks")).find((x) => x.milestoneKey === "depoimento");
  assert.ok(t, "esperava a tarefa de depoimento");
  assert.equal(t.title, "Pedir depoimento a Lupa");
  assert.deepEqual(t.assignees, ["eryk"]);
  assert.match(t.description, /Posso contar essa história como case da LeverAds/);
  assert.match(t.description, /clique em "virar case"/);
  runner.stop();
});
