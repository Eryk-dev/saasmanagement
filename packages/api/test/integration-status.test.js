// A integração do cliente numa definição só (customers/integration-status.js):
// o registro de integração, o card da venda e o marco da régua passam a dizer a
// mesma coisa, e Clientes e Carteira leem o mesmo estado.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { integrationOf, LEGACY_CUTOFF } from "../src/customers/integration-status.js";
import { refreshLifecycle, runLifecycleSweep } from "../src/customers/lifecycle.js";
import { createOnboarding, syncLeadOnboarding, updateOnboarding } from "../src/customers/onboardings.js";
import { startCustomerMilestones } from "../src/customers/customer-milestones.js";

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Pós-venda", kind: "posvenda", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];
const PRODUCT = { id: "leverads", name: "LeverAds", funnel: FUNNEL };
const DEPOIS = "2026-11-20T12:00:00.000Z"; // venda depois da consolidação
const ANTES = "2026-08-01T12:00:00.000Z"; // venda legada

const lead = (stage, wonAt = DEPOIS) => ({ id: "l1", customerId: "cu_1", saas: "leverads", stage, wonAt });
const cust = (extra = {}) => ({ id: "cu_1", saas: "leverads", leadId: "l1", startedAt: DEPOIS, ...extra });

// ── A regra ───────────────────────────────────────────────────────────────
test("integrando: integração aberta manda, mesmo com o marco já feito", () => {
  const r = integrationOf(cust({ milestonesDone: { onboarding: ANTES } }), { onboardings: [{ id: "ob1", stage: "configuracao" }], lead: lead("Pós-venda"), product: PRODUCT });
  assert.deepEqual([r.status, r.onboarding], ["integrando", "ob1"]);
});

test("integrado: go-live da integração concluída (implantação primeiro), senão o marco", () => {
  const obs = [
    { id: "a", kind: "novo_produto", stage: "concluida", goLiveAt: "2026-12-10T00:00:00.000Z" },
    { id: "b", kind: "implantacao", stage: "concluida", goLiveAt: "2026-11-25T00:00:00.000Z" },
  ];
  assert.deepEqual([integrationOf(cust(), { onboardings: obs, lead: lead("Pós-venda"), product: PRODUCT }).status, integrationOf(cust(), { onboardings: obs, product: PRODUCT }).at],
    ["integrado", "2026-11-25T00:00:00.000Z"]);
  assert.equal(integrationOf(cust({ milestonesDone: { onboarding: ANTES } }), { lead: lead("Ganho"), product: PRODUCT }).status, "integrado", "marco feito à mão vale");
});

test("aguardando: venda nova com o card no Ganho ou na Integração sem registro aberto", () => {
  assert.equal(integrationOf(cust(), { lead: lead("Ganho"), product: PRODUCT }).status, "aguardando");
  assert.equal(integrationOf(cust(), { lead: lead("Integração"), product: PRODUCT }).status, "aguardando");
  assert.equal(integrationOf(cust(), { onboardings: [{ stage: "cancelada" }], lead: lead("Ganho"), product: PRODUCT }).status, "aguardando");
});

test("legado = integrado: venda antiga parada no Ganho, Pós-venda, sem lead ou funil sem Integração", () => {
  assert.ok(ANTES < LEGACY_CUTOFF);
  const legado = (c, l, p = PRODUCT) => integrationOf(c, { lead: l, product: p });
  assert.equal(legado(cust({ startedAt: ANTES }), lead("Ganho", ANTES)).status, "integrado");
  assert.equal(legado(cust(), lead("Pós-venda")).status, "integrado");
  assert.equal(legado(cust({ leadId: "" }), null).status, "integrado");
  assert.equal(legado(cust(), lead("Ganho"), { id: "x", funnel: FUNNEL.filter((f) => f.kind !== "integracao") }).status, "integrado");
  const r = legado(cust({ startedAt: ANTES, leadId: "" }), null);
  assert.deepEqual([r.at, r.legacy], [ANTES, true]);
});

// ── O que o lifecycle grava ───────────────────────────────────────────────
async function seed({ customer = {}, leadRow = null } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  if (leadRow) await repo.create("leads", leadRow);
  await repo.create("customers", { ...cust(), name: "Loja", owner: "eryk", ...customer });
  return repo;
}

test("cliente legado: o sweep grava integrado e o marco da integração com a data de entrada", async () => {
  const repo = await seed({ customer: { startedAt: ANTES, leadId: "" } });
  await runLifecycleSweep(repo);
  const c = await repo.get("customers", "cu_1");
  assert.deepEqual([c.integrationStatus, c.lifecycle, c.milestonesDone.onboarding], ["integrado", "ativo", ANTES]);
});

test("venda nova no Ganho: Carteira e Clientes veem 'integração', e o marco fica em aberto", async () => {
  const repo = await seed({ leadRow: lead("Ganho") });
  await runLifecycleSweep(repo);
  const c = await repo.get("customers", "cu_1");
  assert.deepEqual([c.integrationStatus, c.lifecycle, c.csStage || ""], ["aguardando", "integracao", ""]);
  assert.equal(c.milestonesDone?.onboarding, undefined);
});

test("concluir a integração marca o marco com o go-live e conclui o acompanhamento do marco", async () => {
  const repo = await seed({ leadRow: lead("Integração") });
  await repo.create("cs_followups", { id: "fu_1", customer: "cu_1", saas: "leverads", kind: "check_in", status: "aberto", milestone: "onboarding" });
  const o = await createOnboarding(repo, { customer: "cu_1", kind: "implantacao", items: [{ title: "a", doneAt: DEPOIS }] }, { now: new Date(DEPOIS) });
  assert.equal((await repo.get("customers", "cu_1")).integrationStatus, "integrando");
  await updateOnboarding(repo, o.id, { stage: "concluida", goLiveAt: "2026-11-27T15:00:00.000Z" }, { now: new Date("2026-11-27T16:00:00.000Z") });
  const c = await repo.get("customers", "cu_1");
  assert.deepEqual([c.integrationStatus, c.lifecycle, c.milestonesDone.onboarding], ["integrado", "ativo", "2026-11-27T15:00:00.000Z"]);
  assert.equal((await repo.get("cs_followups", "fu_1")).status, "feito");
});

test("card que vai do Ganho direto ao Pós-venda sem integração também fica integrado", async () => {
  const repo = await seed({ leadRow: lead("Ganho") });
  await refreshLifecycle(repo, await repo.get("customers", "cu_1"));
  assert.equal((await repo.get("customers", "cu_1")).integrationStatus, "aguardando");
  await repo.update("leads", "l1", { stage: "Pós-venda" });
  await syncLeadOnboarding(repo, await repo.get("leads", "l1"), { now: new Date(DEPOIS) });
  const c = await repo.get("customers", "cu_1");
  assert.deepEqual([c.integrationStatus, c.lifecycle, Boolean(c.milestonesDone?.onboarding)], ["integrado", "ativo", true]);
});

// ── A régua não duplica a integração ──────────────────────────────────────
test("marco da integração vira acompanhamento só quando a venda espera a entrega", async () => {
  const hoje = new Date("2026-11-30T12:00:00.000Z"); // 10 dias depois da venda: marco do dia 7 vencido
  for (const [nome, setup, esperado] of [
    ["aguardando", async () => {}, ["Integração"]],
    ["integrando", async (r) => { await r.create("onboardings", { id: "ob1", customer: "cu_1", stage: "configuracao", createdAt: DEPOIS }); }, []],
  ]) {
    const repo = await seed({ leadRow: lead("Ganho") });
    await setup(repo);
    const runner = startCustomerMilestones(repo, { intervalMs: 1e9, now: () => hoje });
    await runner.tick(hoje);
    const fs = await repo.list("cs_followups");
    assert.deepEqual(fs.filter((f) => f.milestone === "onboarding").map((f) => f.title), esperado, nome);
    runner.stop();
  }
});

// ── Churn fecha a integração que ficou aberta ─────────────────────────────
test("cliente em churn: a integração aberta é cancelada com o motivo e o marco não é marcado", async () => {
  const repo = await seed({ customer: { endedAt: "2026-11-25T12:00:00.000Z" }, leadRow: lead("Integração") });
  await repo.create("onboardings", { id: "ob_velha", customer: "cu_1", saas: "leverads", kind: "implantacao", stage: "configuracao", notes: "faltou acesso", createdAt: DEPOIS, items: [] });
  await repo.create("onboardings", { id: "ob_feita", customer: "cu_1", saas: "leverads", kind: "treinamento", stage: "concluida", createdAt: DEPOIS, items: [] });
  await refreshLifecycle(repo, await repo.get("customers", "cu_1"), { now: new Date("2026-11-26T15:00:00.000Z") });
  const o = await repo.get("onboardings", "ob_velha");
  assert.equal(o.stage, "cancelada");
  assert.match(o.notes, /^faltou acesso\nCancelada automaticamente em 26\/11\/2026: cliente em churn\.$/);
  assert.equal((await repo.get("onboardings", "ob_feita")).stage, "concluida", "concluída fica como está");
  const c = await repo.get("customers", "cu_1");
  assert.equal(c.lifecycle, "churn");
  assert.notEqual(c.integrationStatus, "integrando");
  assert.equal(c.milestonesDone?.onboarding, undefined, "churn não ganha o marco da integração");
  // Rodar de novo não mexe em nada (nada aberto pra cancelar).
  await refreshLifecycle(repo, await repo.get("customers", "cu_1"), { now: new Date("2026-11-27T15:00:00.000Z") });
  assert.match((await repo.get("onboardings", "ob_velha")).notes, /26\/11\/2026/);
});

test("cliente ativo: integração aberta continua aberta", async () => {
  const repo = await seed({ leadRow: lead("Integração") });
  await repo.create("onboardings", { id: "ob_1", customer: "cu_1", saas: "leverads", kind: "implantacao", stage: "configuracao", createdAt: DEPOIS, items: [] });
  await refreshLifecycle(repo, await repo.get("customers", "cu_1"));
  assert.equal((await repo.get("onboardings", "ob_1")).stage, "configuracao");
  assert.equal((await repo.get("customers", "cu_1")).integrationStatus, "integrando");
});
