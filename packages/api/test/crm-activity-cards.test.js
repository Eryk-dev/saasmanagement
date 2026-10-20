// Atividade como card ligado a registro (crm/activity-cards.js): nasce como
// tarefa com o registro resolvido, lista por lead e por cliente, e a concluída
// entra na timeline única.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { resolveRecord } from "../src/crm/activity-cards.js";

const { registerRoutes } = await import("../src/routes.js");

async function setup() {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", name: "Loja X", saas: "leverads", leadId: "l1" });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Ganho", customerId: "c1" });
  await repo.create("onboardings", { id: "ob1", customer: "c1", lead: "l1", status: "open" });
  const app = Fastify();
  registerRoutes(app, repo);
  return { repo, app };
}

test("o registro resolve rótulo, produto e os ponteiros de lead e cliente", async () => {
  const { repo } = await setup();
  assert.deepEqual(await resolveRecord(repo, { kind: "onboarding", id: "ob1" }),
    { kind: "onboarding", id: "ob1", label: "Integração · Loja X", saas: "leverads", crmLead: "l1", crmCustomer: "c1" });
  await assert.rejects(resolveRecord(repo, { kind: "lead", id: "nao-existe" }), /não encontrado/);
  await assert.rejects(resolveRecord(repo, { kind: "ticket", id: "t1" }), /não encontrado/);
});

test("atividade nasce como tarefa, lista no cliente e no lead e a concluída entra na timeline", async () => {
  const { repo, app } = await setup();
  const r = await app.inject({ method: "POST", url: "/api/crm-activities", payload: { type: "ligacao", record: { kind: "customer", id: "c1" }, owner: "u_cs", dueDate: "2026-10-21" } });
  assert.equal(r.statusCode, 201, r.body);
  const task = r.json();
  assert.equal(task.title, "Ligar · Loja X");
  assert.deepEqual(task.assignees, ["u_cs"]);
  assert.deepEqual(task.record, { kind: "customer", id: "c1", label: "Loja X" });
  assert.equal(task.crmLead, "l1");
  assert.deepEqual(task.labels, ["atividade", "ligacao"]);

  await app.inject({ method: "POST", url: "/api/crm-activities", payload: { type: "whatsapp", record: { kind: "lead", id: "l1" }, title: "Mandar proposta" } });
  await repo.create("tasks", { id: "t_solta", title: "solta", crmCustomer: "c1" });
  const doCliente = (await app.inject({ url: "/api/crm-activities?customer=c1" })).json().activities;
  assert.equal(doCliente.length, 2, "só tarefas com tipo de atividade");
  assert.equal(doCliente[0].dueDate, "2026-10-21", "com prazo primeiro");
  assert.equal((await app.inject({ url: "/api/crm-activities?lead=l1" })).json().activities.length, 2);

  const bad = await app.inject({ method: "POST", url: "/api/crm-activities", payload: { type: "ligacao", record: { kind: "lead", id: "x" } } });
  assert.equal(bad.statusCode, 404);

  const antes = (await app.inject({ url: "/api/customers/c1/timeline" })).json().items;
  assert.ok(!antes.some((i) => i.kind === "atividade.ligacao"), "aberta não entra na timeline");
  const solta = await app.inject({ method: "POST", url: "/api/crm-activities/t_solta/complete", payload: {} });
  assert.equal(solta.statusCode, 404, "tarefa comum não se conclui pela rota da atividade");
  await app.inject({ method: "POST", url: `/api/crm-activities/${task.id}/complete`, payload: {} });
  const items = (await app.inject({ url: "/api/customers/c1/timeline" })).json().items;
  const it = items.find((i) => i.kind === "atividade.ligacao");
  assert.ok(it, "a concluída entra na timeline do cliente");
  assert.equal(it.text, "Ligar · Loja X");
  assert.ok((await app.inject({ url: "/api/leads/l1/timeline" })).json().items.some((i) => i.id === task.id), "e na do lead");
});
