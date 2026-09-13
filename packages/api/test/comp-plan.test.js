// Bônus de time: o valor por cargo e nível, e as duas condições do mês.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { teamBonusOf, teamBonusProducts, teamBonusPlan, DEFAULT_TEAM_BONUS } from "../src/comp-plan.js";
import { teamBonusStatus } from "../src/routes.scoreboard.js";

// ── Valor ─────────────────────────────────────────────────────────────────
test("teamBonusOf: valor por cargo e nível, com integrator caindo na trilha CS", () => {
  assert.equal(teamBonusOf([], "sdr", 1), 300);
  assert.equal(teamBonusOf([], "closer", 3), 800);
  assert.equal(teamBonusOf([], "integrator", 2), 400); // integrator = trilha cs
  assert.equal(teamBonusOf([], "cs", 2), 400);
});

test("teamBonusOf: mídia social tem valor único; nível fora da faixa não estoura", () => {
  assert.equal(teamBonusOf([], "social", 1), 200);
  assert.equal(teamBonusOf([], "social", 3), 200);
  assert.equal(teamBonusOf([], "closer", 0), 400);   // cai no nível 1
  assert.equal(teamBonusOf([], "closer", 99), 800);  // cai no topo
  assert.equal(teamBonusOf([], "inventado", 1), 0);
});

test("doc salvo sobrescreve o padrão, campo a campo", () => {
  const docs = [{ role: "team", plan: { closer: [1000, 1200, 1500], products: ["leverads", "uniquekids"] } }];
  assert.equal(teamBonusOf(docs, "closer", 2), 1200);
  assert.equal(teamBonusOf(docs, "sdr", 1), 300); // o que não foi salvo segue o padrão
  assert.deepEqual(teamBonusProducts(docs), ["leverads", "uniquekids"]);
  assert.deepEqual(teamBonusProducts([]), DEFAULT_TEAM_BONUS.products);
  assert.deepEqual(teamBonusPlan([]).sdr, [300, 400, 500]);
});

// ── Condições ─────────────────────────────────────────────────────────────
const produto = { id: "leverads", name: "LeverAds", monthlyCashTarget: 100000 };

async function cenario(repo, { vendas = [], clientes = [] } = {}) {
  await repo.create("products", produto);
  for (const l of vendas) await repo.create("leads", { saas: "leverads", stage: "Ganho", ...l });
  for (const c of clientes) await repo.create("customers", { saas: "leverads", ...c });
}

test("bônus de time não vale em produto de fora da lista", async () => {
  const repo = makeMemRepo();
  await cenario(repo);
  const r = await teamBonusStatus(repo, { id: "uniquekids" }, "2026-09-30", { now: new Date("2026-10-05T12:00:00Z") });
  assert.deepEqual(r, { applies: false });
});

test("as duas condições entram no estado, e churn alto derruba", async () => {
  const repo = makeMemRepo();
  await cenario(repo, {
    clientes: [
      { id: "c1", startedAt: "2026-01-10" },
      { id: "c2", startedAt: "2026-01-10" },
      { id: "c3", startedAt: "2026-01-10" },
      { id: "c4", startedAt: "2026-01-10", endedAt: "2026-09-15" }, // 1 de 4 = 25%
    ],
  });
  const r = await teamBonusStatus(repo, produto, "2026-09-30", { now: new Date("2026-10-05T12:00:00Z") });
  assert.equal(r.applies, true);
  assert.equal(r.month, "2026-09");
  assert.equal(r.churn.churned, 1);
  assert.equal(r.churn.max, 15);
  assert.equal(r.churn.ok, false); // 25% passa do limite
  assert.equal(r.ok, false);
  assert.equal(r.source, "closed");
});

test("limiar de churn vem do plano do CS (não é número solto)", async () => {
  const repo = makeMemRepo();
  await repo.create("comp_plans", { role: "cs", plan: { churnMax: 30 } });
  await cenario(repo, {
    clientes: [
      { id: "c1", startedAt: "2026-01-10" }, { id: "c2", startedAt: "2026-01-10" },
      { id: "c3", startedAt: "2026-01-10" }, { id: "c4", startedAt: "2026-01-10", endedAt: "2026-09-15" },
    ],
  });
  const r = await teamBonusStatus(repo, produto, "2026-09-30", { now: new Date("2026-10-05T12:00:00Z") });
  assert.equal(r.churn.max, 30);
  assert.equal(r.churn.ok, true); // 25% agora cabe
});

test("mês ainda correndo devolve o mesmo formato, marcado como ao vivo", async () => {
  const repo = makeMemRepo();
  await cenario(repo);
  const r = await teamBonusStatus(repo, produto, "2026-09-13", { now: new Date("2026-09-13T15:00:00Z") });
  assert.equal(r.source, "live");
  assert.equal(r.applies, true);
  assert.equal(typeof r.cash.ok, "boolean");
});

test("sem cliente nenhum o churn não inventa nota ruim", async () => {
  const repo = makeMemRepo();
  await cenario(repo);
  const r = await teamBonusStatus(repo, produto, "2026-09-30", { now: new Date("2026-10-05T12:00:00Z") });
  assert.equal(r.churn.pct, null);
  assert.equal(r.churn.ok, true); // sem base não é churn alto
});
