// Régua de marcos no servidor: o espelho com o módulo do web, a janela que
// decide quando o marco vira acompanhamento de CS (antes de 03/11/2026, tarefa)
// e a sincronia nos dois sentidos.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  milestonesFor, dueMilestones, inMilestoneRuler, taskCopyFor, startCustomerMilestones,
  completeMilestoneTasks, DEFAULT_MILESTONES, RENEWAL_LEAD_DAYS, followupKindFor,
} from "../src/customers/customer-milestones.js";
import * as web from "../../web/src/lib/milestones.js";
import { completeTask, createTask, patchTask } from "../src/tasks/tasks-core.js";
import { updateFollowup } from "../src/customers/cs-followups.js";

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
  assert.match(ren.description, /Ao concluir este acompanhamento o marco fica marcado na ficha/);
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

const followups = (repo) => repo.list("cs_followups");
// Tarefa de marco criada antes de 03/11/2026 (quando o marco virava tarefa).
const legacyTask = (repo, key) => createTask(repo, { saas: "leverads", title: "marco " + key, customerId: "cu_1", milestoneKey: key, assignees: ["eryk"] }, { by: "system" });

test("tick: cada marco vencido vira acompanhamento de CS do dono, com o nome do marco, e não duplica", async () => {
  const { repo, runner } = await cenario();
  const r1 = await runner.tick(new Date(HOJE));
  // Só o check-in de mês 1: cliente legado já está integrado, e o marco da
  // integração só vira acompanhamento com a venda esperando a entrega
  // (integration-status.test.js).
  assert.equal(r1.created, 1);
  assert.equal((await repo.list("tasks")).length, 0, "marco não vira mais tarefa do quadro");
  const fs = await followups(repo);
  assert.equal(fs.length, 1);
  const checkin = fs.find((f) => f.milestone === "checkin_m1");
  assert.deepEqual([checkin.kind, checkin.title, checkin.owner, checkin.status, checkin.source], ["check_in", "Check-in de mês 1", "eryk", "aberto", "marco"]);
  assert.equal(checkin.dueAt.slice(0, 10), new Date(HOJE).toISOString().slice(0, 10));
  assert.match(checkin.notes, /Marco da régua de pós-venda: Check-in de mês 1/);
  const r2 = await runner.tick(new Date(HOJE));
  assert.equal(r2.created, 0);
  assert.equal((await followups(repo)).length, 1);
  runner.stop();
});

test("tick: revisão de mês 3 nasce como QBR e renovação como renovação", async () => {
  const { repo, runner } = await cenario({ customer: { plan: "", startedAt: desde(122), milestonesDone: { onboarding: "x", checkin_m1: "x" } } });
  await repo.create("subscriptions", { id: "sub_1", customer: "cu_1", status: "active", cycle: "semiannual" });
  // Semestral (182d): renovação vence no dia 122; a revisão (dia 90) venceu há 32 dias e fica pra trás.
  await runner.tick(new Date(HOJE));
  const fs = await followups(repo);
  assert.deepEqual(fs.map((f) => [f.milestone, f.kind]), [["renovacao", "renovacao"]]);
  assert.equal((await repo.get("customers", "cu_1")).csStage, "renovacao", "renovação aberta põe o cliente na coluna da carteira");
  assert.equal(followupKindFor("revisao_m3"), "qbr");
  runner.stop();
});

test("tick: renovação já aberta pelo alerta é adotada pelo marco, sem duplicar", async () => {
  const { repo, runner } = await cenario({ customer: { plan: "", startedAt: desde(122), milestonesDone: { onboarding: "x", checkin_m1: "x" } } });
  await repo.create("subscriptions", { id: "sub_1", customer: "cu_1", status: "active", cycle: "semiannual" });
  await repo.create("cs_followups", { id: "fu_alerta", customer: "cu_1", saas: "leverads", kind: "renovacao", status: "aberto", source: "alerta" });
  assert.equal((await runner.tick(new Date(HOJE))).created, 0);
  const fs = await followups(repo);
  assert.equal(fs.length, 1);
  assert.deepEqual([fs[0].id, fs[0].milestone, fs[0].title], ["fu_alerta", "renovacao", "Contato de renovação"]);
  runner.stop();
});

test("tick: cliente sem dono gera o acompanhamento mesmo assim (sem responsável)", async () => {
  const { repo, runner } = await cenario({ customer: { owner: "" } });
  await runner.tick(new Date(HOJE));
  assert.equal((await followups(repo))[0].owner, "");
  runner.stop();
});

test("tick: mentoria e churnado não entram na régua", async () => {
  const { repo, runner } = await cenario({ customer: { saas: "uniquekids" } });
  await repo.create("customers", { id: "cu_churn", saas: "leverads", startedAt: desde(30), endedAt: desde(5) });
  assert.equal((await runner.tick(new Date(HOJE))).created, 0);
  assert.equal((await followups(repo)).length, 0);
  runner.stop();
});

test("tick: tarefa de marco antiga continua sendo o trabalho do marco (sem acompanhamento duplicado)", async () => {
  const { repo, runner } = await cenario();
  await legacyTask(repo, "checkin_m1");
  await runner.tick(new Date(HOJE));
  assert.deepEqual((await followups(repo)).map((f) => f.milestone), []);
  runner.stop();
});

// ── Sincronia nos dois sentidos ───────────────────────────────────────────
test("acompanhamento feito marca o marco na ficha; reabrir desmarca", async () => {
  const { repo, runner } = await cenario();
  await runner.tick(new Date(HOJE));
  const f = (await followups(repo)).find((x) => x.milestone === "checkin_m1");
  await updateFollowup(repo, f.id, { status: "feito", sentiment: "positivo" }, { by: "eryk" });
  assert.ok((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1);
  await updateFollowup(repo, f.id, { status: "aberto" }, { by: "eryk" });
  assert.equal((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1, undefined);
  runner.stop();
});

test("marco concluído na ficha conclui o acompanhamento aberto", async () => {
  const { repo, runner } = await cenario();
  await repo.create("cs_followups", { id: "fu_qbr", customer: "cu_1", saas: "leverads", kind: "qbr", status: "aberto", milestone: "revisao_m3" });
  await runner.tick(new Date(HOJE));
  const c = await repo.get("customers", "cu_1");
  const updated = await repo.update("customers", "cu_1", { milestonesDone: { ...(c.milestonesDone || {}), checkin_m1: new Date(HOJE).toISOString() } });
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 1);
  const f = (await followups(repo)).find((x) => x.milestone === "checkin_m1");
  assert.equal(f.status, "feito");
  assert.equal((await followups(repo)).find((x) => x.milestone === "revisao_m3").status, "aberto", "só o marco concluído");
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 0, "idempotente");
  runner.stop();
});

test("tarefa antiga concluída no quadro marca o marco na ficha; reabrir desmarca", async () => {
  const { repo, runner } = await cenario();
  const t = await legacyTask(repo, "checkin_m1");
  await completeTask(repo, t.id, true, { by: "eryk" });
  assert.ok((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1);
  await completeTask(repo, t.id, false, { by: "eryk" });
  assert.equal((await repo.get("customers", "cu_1")).milestonesDone.checkin_m1, undefined);
  runner.stop();
});

test("conclusão de tarefa antiga pela coluna do quadro também marca o marco", async () => {
  const { repo, runner } = await cenario();
  const t = await legacyTask(repo, "onboarding");
  await patchTask(repo, t.id, { completed: true }, { by: "eryk" });
  assert.ok((await repo.get("customers", "cu_1")).milestonesDone.onboarding);
  runner.stop();
});

test("marco concluído na ficha conclui a tarefa antiga aberta", async () => {
  const { repo, runner } = await cenario();
  const t = await legacyTask(repo, "checkin_m1");
  const updated = await repo.update("customers", "cu_1", { milestonesDone: { checkin_m1: new Date(HOJE).toISOString() } });
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 1);
  assert.equal((await repo.get("tasks", t.id)).completed, true);
  assert.equal(await completeMilestoneTasks(repo, updated, ["checkin_m1"], { by: "eryk" }), 0);
  runner.stop();
});

test("hook sai do ar com o runner parado (não vaza entre execuções)", async () => {
  const { repo, runner } = await cenario();
  // checkin_m1: o marco da integração o lifecycle grava sozinho no legado.
  const t = await legacyTask(repo, "checkin_m1");
  runner.stop();
  await completeTask(repo, t.id, true, { by: "eryk" });
  assert.equal((await repo.get("customers", "cu_1")).milestonesDone?.checkin_m1, undefined);
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
  const keys = (await repo.list("cs_followups")).map((f) => f.milestone);
  assert.ok(!keys.includes("depoimento"), `não devia pedir depoimento, veio ${keys.join(",")}`);
  runner.stop();
});

test("gate proof: com resultado no painel, o pedido de depoimento vira acompanhamento com o roteiro", async () => {
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
  const f = (await repo.list("cs_followups")).find((x) => x.milestone === "depoimento");
  assert.ok(f, "esperava o acompanhamento de depoimento");
  assert.equal(f.title, "Pedir depoimento e autorizar case");
  assert.equal(f.owner, "eryk");
  assert.match(f.notes, /Posso contar essa história como case da LeverAds/);
  assert.match(f.notes, /clique em "virar case"/);
  runner.stop();
});
