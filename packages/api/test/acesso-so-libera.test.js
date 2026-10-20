// Modo padrão do sync de acesso: só libera. Cliente com acesso legado não perde
// acesso por cobrança desatualizada no cockpit — o corte que a régua pediria vai
// para `report.held`, e só é escrito com LEVERADS_ACCESS_CUT=1.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { runLeveradsAccessSync, registerLeveradsAccessRoutes } from "../src/billing/leverads-access.js";

delete process.env.LEVERADS_ACCESS_CUT;

function fakeClient(orgs) {
  const updates = [];
  return {
    updates,
    configured: () => true,
    listOrgs: async () => orgs.map((o) => ({ ...o })),
    updateOrg: async (id, patch) => { Object.assign(orgs.find((o) => o.id === id), patch); updates.push({ id, ...patch }); },
  };
}

async function seed(repo) {
  const devedora = await repo.create("customers", { name: "Devedora", saas: "leverads", leveradsOrgId: "org-1" });
  await repo.create("subscriptions", { status: "past_due", cycle: "monthly", price: 100, customer: devedora.id, saas: "leverads" });
  const cancelada = await repo.create("customers", { name: "Cancelada", saas: "leverads", leveradsOrgId: "org-2" });
  await repo.create("subscriptions", { status: "canceled", cycle: "monthly", price: 100, customer: cancelada.id, saas: "leverads" });
  const emDia = await repo.create("customers", { name: "Em dia", saas: "leverads", leveradsOrgId: "org-3" });
  await repo.create("subscriptions", { status: "active", cycle: "monthly", price: 100, customer: emDia.id, saas: "leverads" });
}

const orgs = () => [
  { id: "org-1", name: "Devedora", payment_active: true },
  { id: "org-2", name: "Cancelada", payment_active: true },
  { id: "org-3", name: "Em dia", payment_active: false },
];

test("padrão: libera quem está em dia e segura todo corte (vai para held, nada é escrito)", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const client = fakeClient(orgs());
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(report.cuts, "só libera");
  assert.deepEqual(client.updates, [{ id: "org-3", payment_active: true }], "só a liberação é escrita");
  assert.deepEqual(report.held.map((h) => [h.orgName, h.to]).sort(), [["Cancelada", false], ["Devedora", false]]);
  assert.deepEqual(report.planned.map((p) => p.orgName), ["Em dia"]);
});

test("com allowCut o corte volta a ser escrito", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const client = fakeClient(orgs());
  const report = await runLeveradsAccessSync(repo, { client, apply: true, allowCut: true });
  assert.equal(report.cuts, "corta");
  assert.equal(report.held.length, 0);
  assert.equal(client.updates.filter((u) => u.payment_active === false).length, 2);
});

test("rota de run manual não corta sem LEVERADS_ACCESS_CUT, mesmo com apply:true", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const client = fakeClient(orgs());
  const app = Fastify();
  registerLeveradsAccessRoutes(app, repo, { client });
  const res = await app.inject({ method: "POST", url: "/api/leverads-access/run", payload: { apply: true } });
  assert.equal(res.json().held.length, 2);
  assert.ok(client.updates.every((u) => u.payment_active === true), "nenhum corte pelo botão");
});
