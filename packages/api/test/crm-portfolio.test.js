// Pós-venda do Lever CRM (Fase 3): health score calculado, receita da carteira
// (movimentos de MRR, renovações e aging) e os alertas com dedupe.

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { computeHealth, refreshHealth, runHealthSweep } from "../src/customers/health.js";
import { delinquencyAging, mrrMovements, renewalsDue } from "../src/customers/revenue.js";
import { runCrmAlerts, validUntilMs } from "../src/customers/crm-alerts.js";

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

test("health: soma das quatro partes, com neutro quando falta dado", () => {
  assert.deepEqual(computeHealth({}).parts, { pagamento: 30, nps: 10, suporte: 20, resultado: 10 });
  const bom = computeHealth({
    subs: [{ status: "active" }], invoices: [{ status: "paid" }],
    nps: [{ status: "answered", score: 10, answeredAt: "2026-10-01" }], tickets: [], snapshot: { orders30d: 4, listings: 30 },
  });
  assert.equal(bom.health, 100);
  const ruim = computeHealth({
    subs: [{ status: "past_due" }], invoices: [], nps: [{ status: "answered", score: 3, answeredAt: "2026-10-01" }],
    tickets: [{ status: "open", priority: "urgent" }], snapshot: { orders30d: 0, listings: 12 },
  });
  assert.deepEqual([ruim.health, ruim.parts.resultado], [8, 8]);
});

test("health: queda de faixa vai pra timeline e avisa o dono; subida só registra", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", owner: "bia", health: 90, healthAt: "2026-10-01T00:00:00Z", healthParts: {} });
  await repo.create("subscriptions", { customer: c.id, status: "past_due" });
  const caiu = await refreshHealth(repo, c, { now: new Date("2026-10-20T00:00:00Z") });
  assert.ok(caiu.health < 50);
  const [n] = await repo.list("notifications");
  assert.equal(n.user, "bia");
  assert.equal(n.type, "health_drop");
  assert.ok((await repo.list("timeline_events")).some((t) => t.kind === "customer.health_changed" && t.data.to === "red"));
  assert.deepEqual(await runHealthSweep(repo, { snapshots: new Map() }), { customers: 1, changed: 0 }, "sem mudança, não regrava");
});

test("MRR: novo, expansão, contração e churn a partir do histórico de plano", () => {
  const pcs = [
    { id: "1", customer: "a", type: "start", at: "2026-10-01", to: { arr: 12000 } },
    { id: "2", customer: "a", type: "upgrade", at: "2026-10-05", from: { arr: 12000 }, to: { arr: 24000 } },
    { id: "3", customer: "b", type: "downgrade", at: "2026-10-06", from: { price: 3000, cycle: "quarterly" }, to: { price: 1500, cycle: "quarterly" } },
    { id: "4", customer: "c", type: "churn", at: "2026-10-07", from: { arr: 6000 }, to: null },
    { id: "5", customer: "d", type: "start", at: "2026-09-01", to: { arr: 1200 } },
  ];
  const r = mrrMovements(pcs, { from: "2026-10-01", to: "2026-11-01" });
  assert.deepEqual(r.totals, { novo: 1000, expansao: 1000, contracao: -500, churn: -500, liquido: 1000 });
  assert.equal(r.items.length, 4, "setembro fica de fora do período");
});

test("renovações caem na menor janela e o aging separa por idade do atraso", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const subs = [
    { id: "s1", customer: "c1", status: "active", periodEnd: iso(now + 5 * DAY), price: 300, cycle: "monthly" },
    { id: "s2", customer: "c1", status: "active", periodEnd: iso(now + 40 * DAY), price: 300, cycle: "monthly" },
    { id: "s3", customer: "c1", status: "canceled", periodEnd: iso(now + 5 * DAY) },
    { id: "s4", customer: "c1", status: "active", periodEnd: iso(now + 90 * DAY) },
  ];
  const r = renewalsDue(subs, [{ id: "c1", name: "Loja" }], { now });
  assert.deepEqual([r[7].length, r[15].length, r[30].length, r[60].length], [1, 0, 0, 1]);
  const a = delinquencyAging([
    { id: "i1", status: "overdue", amount: 100, dueDate: iso(now - 10 * DAY) },
    { id: "i2", status: "open", amount: 50, dueDate: iso(now - 45 * DAY) },
    { id: "i3", status: "paid", amount: 999, dueDate: iso(now - 45 * DAY) },
    { id: "i4", status: "open", amount: 70, dueDate: iso(now + 3 * DAY) },
  ], { now });
  assert.deepEqual([a.buckets["1-30"].amount, a.buckets["31-60"].amount, a.total], [100, 50, 150]);
});

test("alertas: renovação abre acompanhamento, 1º pagamento, go-live, oferta, 1º contato, follow-up e não repetem", async () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", funnel: [{ stage: "Novo", kind: "novo" }, { stage: "Follow-up", kind: "followup" }] });
  await repo.create("customers", { id: "c1", name: "Loja", owner: "bia", startedAt: iso(now - 10 * DAY) });
  await repo.create("subscriptions", { customer: "c1", status: "active", periodEnd: iso(now + 30 * DAY - 3600_000) });
  await repo.create("invoices", { customer: "c1", status: "open", dueDate: iso(now - 9 * DAY) });
  await repo.create("onboardings", { id: "ob1", customer: "c1", stage: "configuracao", integrator: "eryk", plannedGoLiveAt: iso(now - DAY) });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Novo", owner: "sdr1", nextActionAt: iso(now - 3 * 3600_000) });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Bruno", stage: "Follow-up", closer: "leo", stageSince: iso(now - 2 * DAY) });
  await repo.create("leads", { id: "l3", saas: "leverads", name: "Antigo", stage: "Follow-up", closer: "leo", stageSince: iso(now - 90 * DAY) });
  const amanha = new Date(now + 12 * 3600_000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await repo.create("proposals", { lead: "l2", accepted: false, state: { validUntil: amanha } });

  const r = await runCrmAlerts(repo, { now });
  const tipos = (await repo.list("notifications")).map((n) => `${n.type}:${n.user}`).sort();
  assert.deepEqual(tipos, [
    "first_payment_missing:bia", "followup_without_next:leo", "golive_late:eryk",
    "lead_first_touch_late:sdr1", "offer_expiring:leo", "renewal_due:bia",
  ]);
  assert.equal(r.sent, 6);
  assert.equal((await repo.list("cs_followups"))[0].kind, "renovacao");
  assert.equal((await runCrmAlerts(repo, { now })).sent, 0, "a mesma chave não avisa de novo");
  assert.equal((await repo.list("cs_followups")).length, 1);
});

test("alertas: oferta vencendo lê só accepted/lead/state das propostas, nunca a coleção inteira", async () => {
  // proposals inteira são ~82 MB (slides, calc, data): parsear tudo derrubava a API por memória (29/10/2026)
  const now = Date.parse("2026-10-20T12:00:00Z");
  const repo = makeMemRepo();
  await repo.create("leads", { id: "l2", saas: "leverads", name: "Bruno", closer: "leo" });
  const amanha = new Date(now + 12 * 3600_000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await repo.create("proposals", { lead: "l2", accepted: false, state: { validUntil: amanha }, slides: ["pesado"] });
  const listed = [];
  const spy = { ...repo, list: (name) => (listed.push(name), repo.list(name)), listWhere: (...args) => repo.listWhere(...args) };
  await runCrmAlerts(spy, { now });
  assert.ok(!listed.includes("proposals"), "proposals não pode ser lida inteira");
  assert.deepEqual((await repo.list("notifications")).map((n) => `${n.type}:${n.user}`), ["offer_expiring:leo"]);
});

test("validade da proposta em dd/mm/aaaa vira o fim do dia em Brasília", () => {
  assert.equal(new Date(validUntilMs("21/10/2026")).toISOString(), "2026-10-22T02:59:59.000Z");
  assert.ok(Number.isNaN(validUntilMs("amanhã")));
});
