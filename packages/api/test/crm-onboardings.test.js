// Integração como registro do cliente, separada do ganho (customers/onboardings.js):
// nasce do fechamento ou à mão no cliente (sem negócio novo), só conclui com o
// checklist em 100%, espelha o card do lead até alguém mexer por ela, e a venda
// desfeita cancela a que ainda não começou.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { backfillOnboardings, createOnboarding, syncLeadOnboarding, updateOnboarding, ONBOARDINGS } from "../src/customers/onboardings.js";
import { registerOnboardingRoutes } from "../src/customers/routes.onboardings.js";
import { TIMELINE } from "../src/events/timeline.js";

const { registerRoutes } = await import("../src/routes.js");

// O funil de hoje: o Ganho vem antes da Integração (stages.js).
const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Follow-up", kind: "followup", conv: 0.5 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Pós-venda", kind: "posvenda", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

async function seed() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  return repo;
}

test("integração nasce no cliente sem negócio novo, e o cliente passa a 'integração'", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads", owner: "eryk" });
  const o = await createOnboarding(repo, { customer: c.id, kind: "novo_produto", product: "leverprice" }, { by: "u1" });
  assert.equal(o.lead, "", "sem lead de origem");
  assert.equal(o.stage, "aguardando_kickoff");
  assert.equal(o.integrator, "eryk", "o dono da conta assume quando ninguém foi escolhido");
  assert.equal(o.managed, true);
  assert.equal((await repo.get("customers", c.id)).lifecycle, "integracao");
  assert.ok((await repo.list(TIMELINE)).some((t) => t.kind === "onboarding.created" && t.customer === c.id));
  await assert.rejects(createOnboarding(repo, { customer: "nao-existe" }), /Cliente não encontrado/);
});

test("só conclui com o checklist em 100%; concluir marca o go-live e devolve o cliente a 'ativo'", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads" });
  const o = await createOnboarding(repo, { customer: c.id, items: [{ title: "Acesso ao ML", side: "cliente" }, { title: "Configurar regras", side: "lever" }] });
  await assert.rejects(updateOnboarding(repo, o.id, { stage: "concluida" }), (e) => e.statusCode === 409);
  const items = o.items.map((i) => ({ ...i, doneAt: "2026-10-20T10:00:00Z" }));
  const done = await updateOnboarding(repo, o.id, { items, stage: "concluida" }, { now: new Date("2026-10-21T10:00:00Z") });
  assert.equal(done.stage, "concluida");
  assert.equal(done.goLiveAt, "2026-10-21T10:00:00.000Z");
  assert.equal((await repo.get("customers", c.id)).lifecycle, "ativo");
  await assert.rejects(updateOnboarding(repo, o.id, { stage: "inventada" }), (e) => e.statusCode === 400);
});

test("espelho do card: cria do lead vendido, acompanha a etapa e para quando a integração é editada por ela", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads" });
  const lead = await repo.create("leads", { saas: "leverads", stage: "Integração", customerId: c.id, integrator: "eryk", integrationAt: "2099-01-01T13:00:00Z" });
  const o = await syncLeadOnboarding(repo, lead);
  assert.deepEqual([o.source, o.stage, o.integrator, o.kickoffAt, o.managed], ["lead", "aguardando_kickoff", "eryk", "2099-01-01T13:00:00.000Z", false]);

  const posvenda = await repo.update("leads", lead.id, { stage: "Pós-venda" });
  assert.equal((await syncLeadOnboarding(repo, posvenda)).stage, "concluida");

  const lead2 = await repo.create("leads", { saas: "leverads", stage: "Integração", customerId: c.id, integrationAt: "2099-01-01T13:00:00Z" });
  const o2 = await syncLeadOnboarding(repo, lead2);
  await updateOnboarding(repo, o2.id, { kickoffAt: "2099-02-01T13:00:00Z" });
  const moved = await repo.update("leads", lead2.id, { integrationAt: "2099-03-01T13:00:00Z" });
  assert.equal((await syncLeadOnboarding(repo, moved)).kickoffAt, "2099-02-01T13:00:00.000Z", "a integração manda depois de editada");
  assert.equal((await repo.listWhere(ONBOARDINGS, { lead: lead2.id })).length, 1, "não duplica");
});

test("pelo app: Ganho vende sem abrir integração; plano que exige integração abre", async () => {
  const repo = await seed();
  const app = Fastify();
  registerRoutes(app, repo);
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Follow-up", amount: 1000 });
  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Ganho" } });
  const lead = await repo.get("leads", "l1");
  assert.ok(lead.customerId, "a venda criou o cliente");
  assert.equal((await repo.listWhere(ONBOARDINGS, { lead: "l1" })).length, 0, "vender não é integrar");

  await repo.create("plans", { id: "plan_leverads_oem", requiresIntegration: true });
  await repo.create("customers", { id: "c2", name: "Outra", saas: "leverads" });
  await repo.create("subscriptions", { customer: "c2", status: "active", plan: "plan_leverads_oem" });
  const l2 = await repo.create("leads", { saas: "leverads", stage: "Ganho", customerId: "c2" });
  assert.equal((await syncLeadOnboarding(repo, l2)).stage, "aguardando_kickoff");
});

test("pelo app: mover o card para Integração cria cliente e integração; puxar de volta cancela a que não começou", async () => {
  const repo = await seed();
  const app = Fastify();
  registerRoutes(app, repo);
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Follow-up", amount: 1000 });
  const r = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Integração", integrationAt: "2099-01-01T13:00:00Z" } });
  assert.equal(r.statusCode, 200);
  const lead = await repo.get("leads", "l1");
  assert.ok(lead.customerId, "a venda criou o cliente");
  const [o] = await repo.listWhere(ONBOARDINGS, { lead: "l1" });
  assert.equal(o.customer, lead.customerId);
  assert.equal(o.stage, "aguardando_kickoff");

  await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Follow-up" } });
  assert.equal((await repo.get(ONBOARDINGS, o.id)).stage, "cancelada");
});

test("rotas: cria no cliente, edita, lista abertas e recusa entrada inválida", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads" });
  const app = Fastify();
  registerOnboardingRoutes(app, repo);
  const created = await app.inject({ method: "POST", url: `/api/customers/${c.id}/onboardings`, payload: { kind: "reintegracao", plannedGoLiveAt: "2026-11-01", items: [{ title: "Kickoff" }] } });
  assert.equal(created.statusCode, 201);
  const o = created.json();
  assert.equal(o.progress, 0);
  assert.equal((await app.inject({ method: "POST", url: `/api/customers/${c.id}/onboardings`, payload: { kickoffAt: "amanhã" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/nao/onboardings", payload: {} })).statusCode, 404);
  const patched = await app.inject({ method: "PATCH", url: `/api/customers/onboardings/${o.id}`, payload: { stage: "kickoff", items: [{ ...o.items[0], doneAt: "2026-10-20T00:00:00Z" }] } });
  assert.equal(patched.json().progress, 100);
  assert.equal((await app.inject({ url: "/api/customers/onboardings?open=1" })).json().onboardings.length, 1);
  assert.equal((await app.inject({ url: `/api/customers/${c.id}/onboardings` })).json().onboardings[0].stage, "kickoff");
});

test("carga inicial: dry-run conta, apply cria uma por lead e não repete", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads" });
  await repo.create("leads", { saas: "leverads", stage: "Integração", customerId: c.id });
  await repo.create("leads", { saas: "leverads", stage: "Pós-venda", customerId: c.id, integrationAt: "2026-09-01T13:00:00Z" });
  await repo.create("leads", { saas: "leverads", stage: "Follow-up" });
  assert.deepEqual(await backfillOnboardings(repo), { candidates: 2, created: 0, skipped: 0, apply: false });
  assert.equal((await repo.list(ONBOARDINGS)).length, 0);
  assert.equal((await backfillOnboardings(repo, { apply: true })).created, 2);
  assert.equal((await backfillOnboardings(repo, { apply: true })).skipped, 2);
  assert.deepEqual((await repo.list(ONBOARDINGS)).map((o) => o.stage).sort(), ["aguardando_kickoff", "concluida"]);
});

test("modelo de checklist: integração aberta no cliente nasce com os itens do tipo, e o do plano vence", async () => {
  const repo = await seed();
  const c = await repo.create("customers", { name: "Loja", saas: "leverads", planCode: "oem_escala" });
  const padrao = await createOnboarding(repo, { customer: c.id, kind: "migracao" });
  assert.equal(padrao.template, "migracao");
  assert.ok(padrao.items.length >= 3 && padrao.items.every((i) => i.title && !i.doneAt));

  const app = Fastify();
  registerOnboardingRoutes(app, repo);
  const vazio = await app.inject({ method: "PUT", url: "/api/customers/onboarding-templates/leverads", payload: { templates: [] } });
  assert.equal(vazio.statusCode, 200);
  assert.equal((await app.inject({ url: "/api/customers/onboarding-templates/leverads" })).json().templates[0].id, "implantacao", "salvar vazio volta ao padrão");
  const semItens = await app.inject({ method: "PUT", url: "/api/customers/onboarding-templates/leverads", payload: { templates: [{ kind: "implantacao", items: [] }] } });
  assert.equal(semItens.statusCode, 400);
  const ok = await app.inject({ method: "PUT", url: "/api/customers/onboarding-templates/leverads", payload: { templates: [
    { kind: "implantacao", name: "OEM", planCodes: ["oem_escala"], items: [{ title: "Catálogo OEM importado", side: "lever" }] },
    { kind: "implantacao", name: "Geral", items: [{ title: "Kickoff", side: "lever" }] },
  ] } });
  assert.equal(ok.statusCode, 200, ok.body);
  const doPlano = await createOnboarding(repo, { customer: c.id, kind: "implantacao" });
  assert.deepEqual(doPlano.items.map((i) => i.title), ["Catálogo OEM importado"]);
  const outro = await repo.create("customers", { name: "Outra", saas: "leverads" });
  assert.deepEqual((await createOnboarding(repo, { customer: outro.id })).items.map((i) => i.title), ["Kickoff"]);

  const lead = await repo.create("leads", { saas: "leverads", stage: "Integração", customerId: outro.id });
  assert.deepEqual((await syncLeadOnboarding(repo, lead)).items, [], "o espelho do card não ganha modelo");
});
