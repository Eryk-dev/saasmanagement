// Carimbo mensal da remuneração: o que congela, quando, e por que o passado
// não pode ser recalculado sozinho.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { stampCompMonth, pendingMonths, startCompMonthClose, monthHeaderId, monthPersonId, hit100 } from "../src/comp-months.js";

const produto = { id: "leverads", name: "LeverAds", monthlyCashTarget: 100000, monthlyContractsTarget: 20 };
// 02/10/2026 às 10h de São Paulo (13h UTC): setembro já fechou.
const OUT = new Date(Date.UTC(2026, 9, 2, 13));

async function base() {
  const repo = makeMemRepo();
  await repo.create("products", produto);
  await repo.create("users", { id: "bia", name: "Bia", roles: ["closer"], compLevel: 2 });
  await repo.create("users", { id: "caio", name: "Caio", roles: ["sdr"], compLevel: 1 });
  return repo;
}

// Fechamento em setembro: o closer bate as duas pernas do nível 2
// (25 contratos e R$ 120 mil).
async function vendasDeSetembro(repo, { n = 25, valor = 5000 } = {}) {
  for (let i = 0; i < n; i++) {
    await repo.create("leads", {
      id: `ld_${i}`, saas: "leverads", stage: "Ganho", closer: "bia", owner: "caio",
      amount: valor, paymentMethod: "pix", wonAt: "2026-09-10T12:00:00.000Z",
      customerId: `cu_${i}`, name: `Lead ${i}`,
    });
    await repo.create("customers", { id: `cu_${i}`, saas: "leverads", startedAt: "2026-09-10", arr: valor });
  }
}

test("hit100: bate na régua mesmo com att vindo de divisão", () => {
  assert.equal(hit100(20, 20), true);
  assert.equal(hit100(19.999999999, 20), true); // EPS: 1e-9 não derruba
  assert.equal(hit100(19.9, 20), false);
  assert.equal(hit100(25, null), false); // sem meta não existe 100%
});

test("carimbo: congela contratos, receita e as metas de cada pessoa", async () => {
  const repo = await base();
  await vendasDeSetembro(repo);
  const r = await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  assert.equal(r.month, "2026-09");
  assert.ok(r.pessoas >= 2);
  const header = await repo.get("comp_months", monthHeaderId("leverads", "2026-09"));
  assert.equal(header.kind, "month");
  assert.ok(header.stampedAt);
  const bia = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "bia", "closer"));
  assert.equal(bia.kind, "person");
  assert.equal(bia.level, 2);
  assert.equal(bia.won, 25);
  assert.equal(bia.wonTarget, 25);       // meta do nível 2
  assert.equal(bia.revenueTarget, 120000);
  assert.equal(bia.revenue, 125000);
  assert.equal(bia.hit100, true);        // as duas pernas
});

test("carimbo: uma perna abaixo da meta não é 100% do mês", async () => {
  const repo = await base();
  await vendasDeSetembro(repo, { n: 25, valor: 1000 }); // contratos ok, receita R$ 25 mil
  await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  const bia = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "bia", "closer"));
  assert.equal(bia.won, 25);
  assert.equal(bia.hit100, false);
});

test("carimbo: CS e mídia social não têm 100% do mês (não são vagas com nível)", async () => {
  const repo = await base();
  await repo.create("users", { id: "vitor", name: "Vitor", roles: ["integrator"] });
  await repo.create("customers", { id: "cu_x", saas: "leverads", owner: "vitor", startedAt: "2026-08-01" });
  await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  const vitor = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "vitor", "cs"));
  assert.equal(vitor.hit100, null); // null, não false: "não se aplica" ≠ "não bateu"
});

test("carimbo é idempotente por id: recarimbar sobrescreve, não duplica", async () => {
  const repo = await base();
  await vendasDeSetembro(repo);
  await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  const antes = (await repo.list("comp_months")).length;
  await stampCompMonth(repo, produto, "2026-09", { now: OUT, by: "leonardo" });
  assert.equal((await repo.list("comp_months")).length, antes);
  assert.equal((await repo.get("comp_months", monthHeaderId("leverads", "2026-09"))).by, "leonardo");
});

test("backfill: só meses fechados, do mais antigo pro mais novo, no teto de 3", async () => {
  const repo = await base();
  assert.deepEqual(await pendingMonths(repo, produto, { now: OUT }), ["2026-07", "2026-08", "2026-09"]);
  await repo.create("comp_months", { id: monthHeaderId("leverads", "2026-08"), kind: "month", saas: "leverads", month: "2026-08" });
  assert.deepEqual(await pendingMonths(repo, produto, { now: OUT }), ["2026-07", "2026-09"]);
});

test("backfill nunca inclui o mês corrente", async () => {
  const repo = await base();
  const meses = await pendingMonths(repo, produto, { now: OUT });
  assert.ok(!meses.includes("2026-10"));
});

test("runner: carimba uma vez por dia e respeita o gate de hora", async () => {
  const repo = await base();
  await vendasDeSetembro(repo);
  const r = startCompMonthClose(repo, { intervalMs: 1e9, now: () => OUT });
  assert.equal(await r.tick(new Date(Date.UTC(2026, 9, 2, 7))), null); // 4h de SP
  const um = await r.tick(OUT);
  assert.equal(um.carimbados, 3);
  assert.equal(await r.tick(OUT), null); // trava do dia
  r.stop();
});

test("bônus de time do mês entra no carimbo de cada pessoa", async () => {
  const repo = await base();
  await vendasDeSetembro(repo, { n: 25, valor: 5000 }); // R$ 125 mil > meta de 100 mil
  await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  const header = await repo.get("comp_months", monthHeaderId("leverads", "2026-09"));
  assert.equal(header.teamBonus.applies, true);
  assert.equal(header.teamBonus.cash.ok, true);
  const bia = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "bia", "closer"));
  assert.equal(bia.teamBonusPaid, true);
  assert.equal(bia.teamBonusValue, 600); // closer nível 2
  const caio = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "caio", "sdr"));
  assert.equal(caio.teamBonusValue, 300); // sdr nível 1
});

test("mês sem a meta da empresa batida carimba o bônus como não pago", async () => {
  const repo = await base();
  await vendasDeSetembro(repo, { n: 5, valor: 1000 }); // R$ 5 mil
  await stampCompMonth(repo, produto, "2026-09", { now: OUT });
  const bia = await repo.get("comp_months", monthPersonId("leverads", "2026-09", "bia", "closer"));
  assert.equal(bia.teamBonusPaid, false);
  assert.equal(bia.teamBonusValue, 0);
});

// ── Aviso de elegibilidade ────────────────────────────────────────────────
import { notifyEligible } from "../src/comp-months.js";

async function tresMeses(repo, uid = "bia", role = "closer") {
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    await repo.create("comp_months", {
      id: monthPersonId("leverads", m, uid, role), kind: "person", saas: "leverads", month: m,
      uid, role, level: 1, hit100: true, contractsAtt: 1.1, revenueAtt: 1.05,
    });
  }
}

test("aviso: quem fechou 3 meses a 100% vira notificação pros admins, uma vez só", async () => {
  const repo = await base();
  await repo.create("users", { id: "leo", name: "Leonardo", roles: ["admin"] });
  await repo.update("users", "bia", { compLevel: 1 });
  await tresMeses(repo);
  const r = await notifyEligible(repo, produto, { now: OUT });
  assert.equal(r.avisos, 1);
  const avisos = (await repo.list("notifications")).filter((n) => n.type === "level_eligible");
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].user, "leo");
  assert.match(avisos[0].text, /Bia fechou 3 meses seguidos/);
  assert.match(avisos[0].text, /elegível a Pleno/);
  assert.equal(avisos[0].link.screen, "metas");
  // Segunda execução não repete (a chave é pessoa + nível-alvo).
  assert.equal((await notifyEligible(repo, produto, { now: OUT })).avisos, 0);
});

test("aviso: sem 3 meses, ninguém é avisado; CS nunca entra (não tem nível)", async () => {
  const repo = await base();
  await repo.create("users", { id: "leo", name: "Leonardo", roles: ["admin"] });
  await repo.create("users", { id: "vitor", name: "Vitor", roles: ["integrator"] });
  await tresMeses(repo, "vitor", "cs");
  assert.equal((await notifyEligible(repo, produto, { now: OUT })).avisos, 0);
});

test("aviso: promoção recente zera a contagem e o aviso some", async () => {
  const repo = await base();
  await repo.create("users", { id: "leo", name: "Leonardo", roles: ["admin"] });
  await repo.update("users", "bia", { compLevel: 2, compLevelHistory: [{ level: 2, at: "2026-09-20T10:00:00.000Z", by: "leo" }] });
  await tresMeses(repo);
  assert.equal((await notifyEligible(repo, produto, { now: OUT })).avisos, 0);
});
