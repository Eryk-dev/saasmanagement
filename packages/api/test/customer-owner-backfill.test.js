// Dono da conta (CS): backfill de clientes que nasceram sem `owner` e a regra
// do fechamento (integrador do lead → único integrador do produto → vazio).
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { backfillCustomerOwners } from "../src/migrations.js";

async function seed(repo, { users = [], leads = [], customers = [] } = {}) {
  for (const u of users) await repo.create("users", { roles: ["integrator"], ...u });
  for (const l of leads) await repo.create("leads", { saas: "leverads", ...l });
  for (const c of customers) await repo.create("customers", { saas: "leverads", ...c });
}

test("backfill: integrador do lead de origem vence, mesmo com 2 integradores no produto", async () => {
  const repo = makeMemRepo();
  await seed(repo, {
    users: [{ id: "eryk", name: "Eryk" }, { id: "vitor", name: "Vitor" }],
    leads: [{ id: "ld_1", integrator: "vitor" }],
    customers: [{ id: "cu_1", leadId: "ld_1" }],
  });
  assert.equal(await backfillCustomerOwners(repo), 1);
  assert.equal((await repo.get("customers", "cu_1")).owner, "vitor");
});

test("backfill: sem integrador no lead, o único integrador do escopo do produto assume", async () => {
  const repo = makeMemRepo();
  await seed(repo, {
    users: [{ id: "eryk" }, { id: "ana", saas: "uniquekids" }],
    leads: [{ id: "ld_1" }],
    customers: [{ id: "cu_1", leadId: "ld_1" }, { id: "cu_2" }],
  });
  assert.equal(await backfillCustomerOwners(repo), 2);
  assert.equal((await repo.get("customers", "cu_1")).owner, "eryk");
  assert.equal((await repo.get("customers", "cu_2")).owner, "eryk");
});

test("backfill: ambíguo (2 integradores e lead sem integrador) fica vazio", async () => {
  const repo = makeMemRepo();
  await seed(repo, {
    users: [{ id: "eryk" }, { id: "vitor" }],
    customers: [{ id: "cu_1" }],
  });
  assert.equal(await backfillCustomerOwners(repo), 0);
  assert.equal((await repo.get("customers", "cu_1")).owner, undefined);
});

test("backfill: churnado e quem já tem dono não mudam; segunda execução é no-op", async () => {
  const repo = makeMemRepo();
  await seed(repo, {
    users: [{ id: "eryk" }],
    customers: [
      { id: "cu_ativo" },
      { id: "cu_churn", endedAt: "2026-01-10" },
      { id: "cu_dono", owner: "vitor" },
    ],
  });
  assert.equal(await backfillCustomerOwners(repo), 1);
  assert.equal((await repo.get("customers", "cu_ativo")).owner, "eryk");
  assert.equal((await repo.get("customers", "cu_churn")).owner, undefined);
  assert.equal((await repo.get("customers", "cu_dono")).owner, "vitor");
  assert.equal(await backfillCustomerOwners(repo), 0);
});

test("backfill: integrador do lead que não existe mais como usuário cai na regra do produto", async () => {
  const repo = makeMemRepo();
  await seed(repo, {
    users: [{ id: "eryk" }],
    leads: [{ id: "ld_1", integrator: "fantasma" }],
    customers: [{ id: "cu_1", leadId: "ld_1" }],
  });
  assert.equal(await backfillCustomerOwners(repo), 1);
  assert.equal((await repo.get("customers", "cu_1")).owner, "eryk");
});
