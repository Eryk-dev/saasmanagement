// Folha automática pela Remuneração: fixo do nível/regime (ou fixo da pessoa),
// duas pernas pelo atingimento carimbado, bônus de time; conta a pagar por
// pessoa com vencimento dia 1 do mês seguinte; gerar é idempotente, não toca
// conta paga nem valor revisado à mão. Cadastro seed = o que o Leo confirmou.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { payrollRowOf, computePayroll, generatePayroll, payrollUsers } = await import("../src/comp/payroll.js");
const { seedPayrollSetup } = await import("../src/platform/migrations-fin.js");
const { registerRoutes } = await import("../src/routes.js");
const { legBonus, planFor, DEFAULT_PLAN } = await import("../src/shared/comp-plan-defaults.js");

const stamp = (over = {}) => ({ kind: "person", saas: "leverads", month: "2026-09", uid: "sdr", role: "sdr", level: 1, won: 20, wonTarget: 20, revenue: 108000, revenueTarget: 90000, contractsAtt: 1, revenueAtt: 1.2, teamBonusValue: 300, teamBonusPaid: true, ...over });

test("linha da folha: SDR júnior com 100% em contratos e 120% em receita + bônus de time", () => {
  const r = payrollRowOf({ id: "sdr", name: "Manuela", payrollRole: "sdr", compLevel: 1 }, { compDocs: [], stamp: stamp(), month: "2026-09" });
  assert.equal(r.fixed, 2200);
  assert.deepEqual(r.legs, { contracts: 550, revenue: 750 });
  assert.equal(r.teamBonus, 300);
  assert.equal(r.total, 2200 + 550 + 750 + 300);
  assert.match(r.notes, /plano nível 1/);
});

test("closer PJ usa o fixo PJ; fixo da pessoa (mídia social) sobrepõe o plano; sem carimbo só o fixo entra", () => {
  const closer = payrollRowOf({ id: "v", payrollRole: "closer", compLevel: 2, payrollRegime: "pj" }, { compDocs: [], stamp: null, month: "2026-10" });
  assert.deepEqual([closer.fixed, closer.variable, closer.stamped], [5500, 0, false]);
  assert.match(closer.notes, /não fechado/);
  const igor = payrollRowOf({ id: "igor", payrollRole: "social", payrollFixed: 4500 }, { compDocs: [], stamp: stamp({ role: "social", teamBonusValue: 200 }), month: "2026-09" });
  assert.deepEqual([igor.fixed, igor.fixedFrom, igor.total], [4500, "pessoa", 4700]);
  // Plano salvo sobrescreve o padrão (fixo do SDR nível 1 = 2.500).
  const r = payrollRowOf({ id: "sdr", payrollRole: "sdr", compLevel: 1 }, { compDocs: [{ role: "sdr", plan: { levels: [{ ...DEFAULT_PLAN.sdr.levels[0], fixed: 2500 }] } }], stamp: null, month: "2026-10" });
  assert.equal(r.fixed, 2500);
  assert.equal(planFor([], "integrator").levels[0].fixed, 2200, "integrator lê o plano do CS");
  assert.equal(legBonus(0.79, 300, 550, 750, 950), 0);
  assert.equal(legBonus(1.6, 300, 550, 750, 950), 950 + (950 - 750) + 100);
});

test("quem entra na folha: só sdr/closer/cs/social do produto; manual e none ficam fora", () => {
  const users = [
    { id: "sdr", payrollRole: "sdr", saas: "leverads" },
    { id: "yudi", payrollRole: "cs" }, // sem saas → produto padrão
    { id: "leo", payrollRole: "manual" },
    { id: "bia", payrollRole: "none" },
    { id: "ana", payrollRole: "closer", saas: "uniquekids" },
  ];
  assert.deepEqual(payrollUsers(users, "leverads", { defaultSaas: "leverads" }).map((u) => u.id), ["sdr", "yudi"]);
  assert.deepEqual(payrollUsers(users, "uniquekids", { defaultSaas: "leverads" }).map((u) => u.id), ["ana"]);
});

test("gerar folha: cria a conta por pessoa (dia 1 do mês seguinte), atualiza em aberto, respeita paga e valor revisado", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("users", { id: "sdr", name: "Manuela", payrollRole: "sdr", compLevel: 1, saas: "leverads" });
  await repo.create("users", { id: "igor", name: "Igor", payrollRole: "social", payrollFixed: 4500 });
  await repo.create("users", { id: "leo", name: "Leo", payrollRole: "manual", roles: ["admin"] });
  await repo.create("comp_months", { id: "cm_leverads_2026-09", kind: "month", saas: "leverads", month: "2026-09" });
  await repo.create("comp_months", { id: "cm_leverads_2026-09_sdr_sdr", ...stamp() });
  await repo.create("comp_months", { id: "cm_leverads_2026-09_igor_social", ...stamp({ uid: "igor", role: "social", teamBonusValue: 200, contractsAtt: null, revenueAtt: null }) });
  const product = await repo.get("products", "leverads");
  const r1 = await generatePayroll(repo, product, "2026-09", { by: "leo", now: new Date("2026-10-01T12:00:00Z") });
  assert.deepEqual([r1.created, r1.updated, r1.kept], [2, 0, 0]);
  const pays = (await repo.list("payables")).filter((p) => p.month === "2026-09");
  assert.equal(pays.length, 2);
  const manu = pays.find((p) => p.userId === "sdr");
  assert.deepEqual([manu.amount, manu.dueDate, manu.category, manu.status, manu.source], [3800, "2026-10-01", "pessoal_com", "aberta", "payroll"]);
  assert.equal(manu.id, "pay_folha_leverads_2026-09_sdr");
  assert.equal(pays.find((p) => p.userId === "igor").amount, 4700);
  // Revisão à mão do Igor e pagamento da Manuela.
  await repo.update("payables", "pay_folha_leverads_2026-09_igor", { amount: 4600, amountManual: true });
  await repo.update("payables", manu.id, { status: "paga", paidAt: "2026-10-01T12:00:00Z" });
  // Carimbo muda (receita a 140%): gerar de novo não mexe na paga nem no valor manual.
  await repo.update("comp_months", "cm_leverads_2026-09_sdr_sdr", { revenueAtt: 1.4 });
  const r2 = await generatePayroll(repo, product, "2026-09", { by: "leo" });
  assert.deepEqual([r2.created, r2.updated, r2.kept], [0, 1, 1]);
  assert.equal((await repo.get("payables", manu.id)).amount, 3800, "paga não muda");
  const igor = await repo.get("payables", "pay_folha_leverads_2026-09_igor");
  assert.equal(igor.amount, 4600, "valor revisado à mão fica");
  assert.equal(igor.payroll.total, 4700, "o cálculo segue registrado");
  const preview = await computePayroll(repo, product, "2026-09");
  assert.equal(preview.rows.find((r) => r.uid === "sdr").payable.status, "paga");
  assert.equal(preview.total, (2200 + 550 + 950 + 300) + 4700, "cálculo atualizado: receita a 140% paga 950");
});

test("rotas /api/comp/payroll: preview e generate", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("users", { id: "sdr", name: "Manuela", payrollRole: "sdr", compLevel: 1, saas: "leverads" });
  const app = Fastify();
  registerRoutes(app, repo);
  const prev = (await app.inject({ url: "/api/comp/payroll/leverads/2026-10" })).json();
  assert.equal(prev.rows.length, 1);
  assert.equal(prev.rows[0].fixed, 2200);
  const gen = await app.inject({ method: "POST", url: "/api/comp/payroll/leverads/2026-10/generate" });
  assert.equal(gen.statusCode, 201);
  assert.equal(gen.json().created, 1);
  assert.equal((await app.inject({ url: "/api/comp/payroll/leverads/13-2026" })).statusCode, 400);
  await app.close();
});

test("seedPayrollSetup: o cadastro confirmado pelo Leo, uma vez, sem sobrescrever o que já existe", async () => {
  const repo = makeMemRepo();
  for (const u of [{ id: "sdr", name: "Manuela" }, { id: "us_mrqkn2tm03", name: "Vitor" }, { id: "us_mu1iysva01", name: "Yudi" }, { id: "igor", name: "Igor" }, { id: "jonan", name: "Jonan", compLevel: 3 }, { id: "us_mtu9n76e04", name: "Bianca" }]) await repo.create("users", u);
  assert.equal(await seedPayrollSetup(repo), 6);
  assert.equal(await seedPayrollSetup(repo), 0, "idempotente");
  const g = (id) => repo.get("users", id);
  assert.deepEqual([(await g("sdr")).payrollRole, (await g("sdr")).compLevel], ["sdr", 1]);
  assert.deepEqual([(await g("us_mrqkn2tm03")).payrollRole, (await g("us_mrqkn2tm03")).payrollRegime], ["closer", "clt"]);
  assert.equal((await g("us_mu1iysva01")).payrollRole, "cs");
  assert.deepEqual([(await g("igor")).payrollRole, (await g("igor")).payrollFixed], ["social", 4500]);
  assert.deepEqual([(await g("jonan")).payrollRole, (await g("jonan")).compLevel], ["manual", 3], "nível existente preservado");
  assert.equal((await g("us_mtu9n76e04")).payrollRole, "none");
});
