import test from "node:test";
import assert from "node:assert/strict";
import { activeProducts, termOf } from "../src/shared/contract-terms.js";

const NOW = new Date("2026-10-26T12:00:00Z");
const customer = { id: "c1", startedAt: "2026-03-10T00:00:00.000Z", plan: "Ads Escala · Anual", planCycle: "anual" };

test("anual cobrado anualmente: a vigência termina no fim do período corrente", () => {
  const sub = { id: "s1", customer: "c1", status: "active", cycle: "annual", price: 1200, periodStart: "2026-03-10T00:00:00.000Z", periodEnd: "2027-03-10T00:00:00.000Z", planSnapshot: { name: "Escala", cycle: "annual", product: "leverads" } };
  const [p] = activeProducts({ customer, subs: [sub], now: NOW });
  assert.equal(p.name, "Escala");
  assert.equal(p.end, "2027-03-10T00:00:00.000Z");
  assert.equal(p.start, "2026-03-10T00:00:00.000Z");
  assert.equal(p.paid, true);
});

test("plano anual cobrado todo mês: a vigência é a do contrato, não a do mês", () => {
  const sub = { id: "s1", customer: "c1", status: "active", cycle: "monthly", price: 100, periodStart: "2026-10-10T00:00:00.000Z", periodEnd: "2026-11-10T00:00:00.000Z", planSnapshot: { name: "Escala", closedPlan: "anual", cycle: "annual" } };
  const t = termOf(sub, customer, { primary: true, now: NOW });
  assert.equal(t.start, "2026-03-10T00:00:00.000Z", "início = cliente desde");
  assert.equal(t.end, "2027-03-10T00:00:00.000Z");
  assert.equal(t.months, 12);
});

test("contrato vencido e ainda ativo renova por mais um prazo", () => {
  const old = { ...customer, startedAt: "2025-03-10T00:00:00.000Z" };
  const sub = { id: "s1", customer: "c1", status: "active", cycle: "monthly", periodEnd: "2026-11-10T00:00:00.000Z", planSnapshot: { closedPlan: "anual" } };
  assert.equal(termOf(sub, old, { primary: true, now: NOW }).end, "2027-03-10T00:00:00.000Z");
});

test("só ativos e em atraso entram; cancelada não; fatura vencida tira o 'em dia'", () => {
  const subs = [
    { id: "a", customer: "c1", status: "active", cycle: "annual", periodStart: "2026-03-10T00:00:00.000Z", periodEnd: "2027-03-10T00:00:00.000Z", planSnapshot: { name: "Ads", product: "leverads" } },
    { id: "b", customer: "c1", status: "past_due", cycle: "annual", periodStart: "2026-05-01T00:00:00.000Z", periodEnd: "2027-05-01T00:00:00.000Z", planSnapshot: { name: "Price", product: "leverprice" } },
    { id: "c", customer: "c1", status: "canceled", cycle: "annual", periodStart: "2025-01-01T00:00:00.000Z" },
    { id: "d", customer: "outro", status: "active", cycle: "annual" },
  ];
  const invoices = [{ subscription: "b", status: "overdue", dueDate: "2026-10-01" }];
  const rows = activeProducts({ customer, subs, invoices, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"]);
  assert.equal(rows[0].paid, true);
  assert.equal(rows[1].paid, false);
  assert.equal(rows[1].overdue, 1);
});

test("sem datas nem plano: não inventa vigência", () => {
  const [p] = activeProducts({ customer: { id: "c1" }, subs: [{ id: "x", customer: "c1", status: "active" }], now: NOW });
  assert.equal(p.end, "");
  assert.equal(p.daysLeft, null);
});
