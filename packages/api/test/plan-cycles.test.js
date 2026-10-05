// Ciclos e planos de fechamento em uma fonte só (plan-cycles.js). Estes valores
// eram mapas repetidos em billing, routes, routes.mp, migrations e na SPA: a
// paridade aqui trava que juntar as cópias não mudou conta nenhuma.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CYCLES, CYCLE_MONTHS, CYCLE_LABEL, CYCLE_TITLE, CYCLE_SHORT, annualized,
  CLOSED_PLANS, CLOSED_PLAN_LABEL, CLOSED_PLAN_TITLE, CLOSED_PLAN_CYCLE, CLOSED_PLAN_MONTHS,
  CLOSED_PLAN_ANNUAL_FACTOR, closedPlanToCycle, cycleToClosedPlan, closedPlanFromLabel,
} from "../src/plan-cycles.js";
import { CYCLE_MONTHS as BILLING_CYCLE_MONTHS, annualized as billingAnnualized, closedSubscriptionSpec } from "../src/billing.js";

test("ciclos da assinatura: meses e rótulos de sempre", () => {
  assert.deepEqual(CYCLES, ["monthly", "quarterly", "semiannual", "annual"]);
  assert.deepEqual(CYCLE_MONTHS, { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 });
  assert.deepEqual(CYCLE_LABEL, { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" });
  assert.deepEqual(CYCLE_TITLE, { monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual" });
  assert.deepEqual(CYCLE_SHORT, { monthly: "mês", quarterly: "tri", semiannual: "sem", annual: "ano" });
});

test("planos de fechamento: os mapas derivados batem com os que existiam espalhados", () => {
  assert.deepEqual(CLOSED_PLAN_LABEL, { anual: "Anual", semestral: "Semestral", mensal: "Mensal", unico: "Serviço único" });
  // Título do link de pagamento: mensal ficou de fora de propósito (não se vende
  // mais), e é esse mapa que valida o plano aceito em POST /api/leads/:id/mp/link.
  assert.deepEqual(CLOSED_PLAN_TITLE, { anual: "Plano Anual", semestral: "Plano Semestral", unico: "Serviço único" });
  // Serviço único não é recorrência: sem ciclo nem meses.
  assert.deepEqual(CLOSED_PLAN_CYCLE, { anual: "annual", semestral: "semiannual", mensal: "monthly" });
  assert.deepEqual(CLOSED_PLAN_MONTHS, { anual: 12, semestral: 6, mensal: 1 });
  assert.deepEqual(CLOSED_PLAN_ANNUAL_FACTOR, { anual: 1, semestral: 2, mensal: 12, unico: 1 });
  assert.deepEqual(CLOSED_PLANS.filter((p) => p.catalogKey).map((p) => [p.catalogKey, p.id, p.label]),
    [["anu", "anual", "Anual"], ["sem", "semestral", "Semestral"]]);
  assert.deepEqual(CLOSED_PLANS.filter((p) => p.legacy).map((p) => p.id), ["mensal"]);
});

test("ida e volta entre plano de fechamento e ciclo; trimestral não é plano de fechamento", () => {
  assert.equal(closedPlanToCycle("semestral"), "semiannual");
  assert.equal(closedPlanToCycle("unico"), "");
  assert.equal(cycleToClosedPlan("annual"), "anual");
  assert.equal(cycleToClosedPlan("quarterly"), "");
});

test("closedPlanFromLabel lê o ciclo do rótulo do cliente", () => {
  assert.equal(closedPlanFromLabel("Ads Escala · Anual"), "anual");
  assert.equal(closedPlanFromLabel("Ads Essencial + OEM · Semestral"), "semestral");
  assert.equal(closedPlanFromLabel("Assinatura mensal"), "mensal");
  assert.equal(closedPlanFromLabel("Mentoria · 4 consultas"), "");
  assert.equal(closedPlanFromLabel(undefined), "");
});

test("billing reexporta a MESMA régua e o arr do fechamento fecha com o fator anual", () => {
  assert.equal(BILLING_CYCLE_MONTHS, CYCLE_MONTHS);
  assert.equal(billingAnnualized, annualized);
  for (const planClosed of ["anual", "semestral", "mensal"]) {
    const spec = closedSubscriptionSpec({ planClosed, amount: 6000, paymentMethod: "pix" });
    assert.equal(spec.cycle, CLOSED_PLAN_CYCLE[planClosed]);
    assert.equal(annualized(spec.price, spec.cycle), 6000 * CLOSED_PLAN_ANNUAL_FACTOR[planClosed]);
  }
  assert.equal(closedSubscriptionSpec({ planClosed: "unico", amount: 6000, paymentMethod: "pix" }), null);
});
