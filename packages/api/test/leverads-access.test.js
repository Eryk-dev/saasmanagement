// Sync de acesso do LeverAds — o cockpit decide o payment_active da org do
// produto a partir do billing daqui e escreve via API super-admin do produto:
//   · past_due corta, ativa em dia libera, encerrado/cancelado corta;
//   · sem assinatura ou sem de-para (leveradsOrgId) NÃO mexe;
//   · dry-run planeja sem escrever; apply escreve SÓ o diff (idempotente).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import {
  desiredAccess, runLeveradsAccessSync, registerLeveradsAccessRoutes, makeLeveradsClient,
} from "../src/leverads-access.js";
import { billingTick } from "../src/billing-runner.js";
import { addMonths } from "../src/billing.js";

// Client falso da API do produto: orgs em memória + trilha de writes.
function fakeClient(orgs) {
  const updates = [];
  return {
    updates,
    configured: () => true,
    listOrgs: async () => orgs.map((o) => ({ ...o })),
    updateOrg: async (id, patch) => {
      const org = orgs.find((o) => String(o.id) === String(id));
      if (!org) throw new Error("404");
      Object.assign(org, patch);
      updates.push({ id, ...patch });
      return { ...org };
    },
  };
}

async function seed(repo, { subStatus = "active", leveradsOrgId = "org-1", endedAt } = {}) {
  const customer = await repo.create("customers", {
    name: "Cliente X", saas: "leverads", leveradsOrgId, ...(endedAt ? { endedAt } : {}),
  });
  if (subStatus) {
    await repo.create("subscriptions", {
      status: subStatus, cycle: "monthly", price: 100, customer: customer.id, saas: "leverads",
    });
  }
  return customer;
}

test("desiredAccess: past_due corta mesmo com outra assinatura ativa", () => {
  const subs = [{ status: "active" }, { status: "past_due" }];
  assert.equal(desiredAccess({}, subs).paymentActive, false);
});

test("desiredAccess: ativa em dia libera; só cancelada/pausada corta; sem subs não mexe", () => {
  assert.equal(desiredAccess({}, [{ status: "active" }]).paymentActive, true);
  assert.equal(desiredAccess({}, [{ status: "canceled" }]).paymentActive, false);
  assert.equal(desiredAccess({}, [{ status: "paused" }]).paymentActive, false);
  assert.equal(desiredAccess({}, []), null);
});

test("desiredAccess: cliente encerrado corta mesmo com assinatura ativa", () => {
  assert.equal(desiredAccess({ endedAt: "2026-08-01" }, [{ status: "active" }]).paymentActive, false);
});

test("dry-run: planeja o corte do past_due mas NÃO escreve no produto", async () => {
  const repo = makeMemRepo();
  await seed(repo, { subStatus: "past_due" });
  const client = fakeClient([{ id: "org-1", name: "Org 1", payment_active: true }]);
  const report = await runLeveradsAccessSync(repo, { client, apply: false });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.planned.length, 1);
  assert.equal(report.planned[0].to, false);
  assert.equal(report.applied, 0);
  assert.equal(client.updates.length, 0);
});

test("apply: escreve só o diff e fica idempotente no tick seguinte", async () => {
  const repo = makeMemRepo();
  await seed(repo, { subStatus: "past_due", leveradsOrgId: "org-1" });
  const emDia = await repo.create("customers", { name: "Em dia", saas: "leverads", leveradsOrgId: "org-2" });
  await repo.create("subscriptions", { status: "active", cycle: "monthly", price: 50, customer: emDia.id, saas: "leverads" });
  const client = fakeClient([
    { id: "org-1", name: "Devedora", payment_active: true },
    { id: "org-2", name: "Em dia", payment_active: true }, // já certo → não toca
  ]);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(report.applied, 1);
  assert.equal(report.inSync, 1);
  assert.deepEqual(client.updates, [{ id: "org-1", payment_active: false }]);
  // Segundo tick: nada muda, nada escreve.
  const again = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(again.applied, 0);
  assert.equal(again.inSync, 2);
  assert.equal(client.updates.length, 1);
});

test("escopo: sem leveradsOrgId ou de outro saas fica de fora; sem assinatura é skipped", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { name: "Sem vínculo", saas: "leverads" });
  await repo.create("customers", { name: "Outro produto", saas: "elo", leveradsOrgId: "org-9" });
  await seed(repo, { subStatus: null, leveradsOrgId: "org-1" }); // vínculo sem assinatura
  const client = fakeClient([{ id: "org-1", name: "Org 1", payment_active: false }]);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(report.checked, 1);
  assert.equal(report.skipped.length, 1);
  assert.equal(client.updates.length, 0);
});

test("org do de-para que não existe no produto vira erro, não escrita", async () => {
  const repo = makeMemRepo();
  await seed(repo, { subStatus: "active", leveradsOrgId: "org-fantasma" });
  const client = fakeClient([{ id: "org-1", name: "Org 1", payment_active: false }]);
  const report = await runLeveradsAccessSync(repo, { client, apply: true });
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].error, /não existe/);
  assert.equal(client.updates.length, 0);
});

test("rota POST /api/leverads-access/run: {apply:true} aplica e devolve o report", async () => {
  const repo = makeMemRepo();
  await seed(repo, { subStatus: "past_due" });
  const client = fakeClient([{ id: "org-1", name: "Org 1", payment_active: true }]);
  const app = Fastify();
  registerLeveradsAccessRoutes(app, repo, { client });
  const dry = await app.inject({ method: "POST", url: "/api/leverads-access/run", payload: {} });
  assert.equal(dry.json().mode, "dry-run");
  assert.equal(client.updates.length, 0);
  const run = await app.inject({ method: "POST", url: "/api/leverads-access/run", payload: { apply: true } });
  assert.equal(run.json().applied, 1);
  assert.equal(client.updates.length, 1);
  const status = await app.inject({ method: "GET", url: "/api/leverads-access/status" });
  assert.equal(status.json().mode, "apply");
});

test("makeLeveradsClient: religa a sessão uma vez no 401 e repete a chamada", async () => {
  const calls = [];
  let logins = 0;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url);
    if (url.endsWith("/api/auth/login")) {
      logins++;
      return { ok: true, status: 200, json: async () => ({ token: `t${logins}` }) };
    }
    // 1ª chamada com t1 expira; com t2 passa.
    if (opts.headers["X-Auth-Token"] === "t1") return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [{ id: "org-1" }] };
  };
  const client = makeLeveradsClient({ baseUrl: "https://x", email: "a", password: "b", fetchImpl });
  const orgs = await client.listOrgs();
  assert.equal(orgs.length, 1);
  assert.equal(logins, 2);
});

test("billingTick: rollover gera fatura, dunning derruba e o Discord recebe o estoque vencido", async () => {
  const repo = makeMemRepo();
  const now = new Date();
  const customer = await repo.create("customers", { name: "Devedor", saas: "leverads" });
  const sub = await repo.create("subscriptions", {
    status: "active", cycle: "monthly", price: 100, customer: customer.id, saas: "leverads",
    periodStart: addMonths(now.toISOString(), -2), periodEnd: addMonths(now.toISOString(), -1),
  });
  await repo.create("invoices", {
    subscription: sub.id, customer: customer.id, saas: "leverads", amount: 100,
    kind: "renewal", status: "open", dueDate: addMonths(now.toISOString(), -1),
  });
  const alerts = [];
  const discordClient = { configured: () => true, billingAlert: async (a) => alerts.push(a) };
  const report = await billingTick(repo, { discordClient });
  assert.ok(report.renewed >= 1);
  assert.ok(report.overdue >= 1);
  assert.equal((await repo.get("subscriptions", sub.id)).status, "past_due");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].lines.join("\n"), /Devedor/);
});
