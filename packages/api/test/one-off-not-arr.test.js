// Serviço único (planClosed "unico") NÃO é receita recorrente: arr 0, o valor
// vira fatura avulsa (presumida no à vista, aberta no resto; cronograma quando
// faturado em Nx) e a venda continua contando na meta do mês do fechamento.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { convertWonLead } = await import("../src/crm/won-lead.js");
const { migrateOneOffCustomers } = await import("../src/platform/migrations-fin.js");
const { CLOSED_PLAN_ANNUAL_FACTOR } = await import("../src/shared/plan-cycles.js");

const FUNNEL = [{ stage: "Novo lead", kind: "novo", conv: 1 }, { stage: "Ganho", kind: "ganho", conv: 1 }];

async function won(repo, over = {}) {
  const lead = await repo.create("leads", {
    id: over.id || "l1", saas: "leverads", name: "Oficina", stage: "Ganho", stageSince: "2026-09-10T12:00:00.000Z",
    amount: 1490, planClosed: "unico", paymentMethod: "pix", dealProduct: "oem_pack", ...over,
  });
  await convertWonLead(repo, lead);
  return (await repo.get("leads", lead.id));
}

test("fator anual do serviço único é 0 (anual 1, semestral 2)", () => {
  assert.deepEqual([CLOSED_PLAN_ANNUAL_FACTOR.unico, CLOSED_PLAN_ANNUAL_FACTOR.anual, CLOSED_PLAN_ANNUAL_FACTOR.semestral], [0, 1, 2]);
});

test("ganho de serviço único à vista: cliente com arr 0, sem assinatura, com fatura avulsa presumida; a meta conta a venda", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const lead = await won(repo);
  const c = await repo.get("customers", lead.customerId);
  assert.equal(c.arr, 0);
  assert.equal((await repo.list("subscriptions")).length, 0);
  const inv = (await repo.list("invoices")).find((i) => i.customer === c.id);
  assert.deepEqual([inv.oneOff, inv.kind, inv.amount, inv.status, inv.paidProof.kind], [true, "manual", 1490, "paid", "closing"]);
  const app = Fastify();
  registerRoutes(app, repo);
  // O cliente nasce HOJE (startedAt do convertWonLead): a fatura avulsa também.
  const month = new Date().toISOString().slice(0, 7);
  const fin = (await app.inject({ url: `/api/fin/leverads?month=${month}` })).json();
  assert.deepEqual([fin.receber.recebidosMes, fin.receber.presumido.mes.total], [0, 1490], "presumido até prova");
  assert.equal(fin.receber.presumido.items[0].customer, c.id);
  await app.close();
});

test("serviço único faturado em 3x: cronograma de parcelas abertas, nada de ARR", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const lead = await won(repo, { id: "l2", paymentMethod: "boleto", paymentInstallments: 3, amount: 3000 });
  const c = await repo.get("customers", lead.customerId);
  assert.equal(c.arr, 0);
  const parc = (await repo.list("invoices")).filter((i) => i.customer === c.id);
  assert.equal(parc.length, 3);
  assert.ok(parc.every((i) => i.kind === "installment" && i.status === "open"));
  assert.equal(parc.reduce((a, i) => a + i.amount, 0), 3000);
});

test("ARR do MRR do produto ignora o serviço único; cliente com pacote avulso + anual conta só o anual", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  const lead = await repo.create("leads", {
    id: "l3", saas: "leverads", name: "Dupla", stage: "Ganho", stageSince: "2026-09-10T12:00:00.000Z",
    amount: 5964 + 1490, planClosed: "anual", paymentMethod: "pix",
    dealItems: [{ product: "oem_essencial", planClosed: "anual", amount: 5964 }, { product: "oem_pack", planClosed: "unico", amount: 1490 }],
  });
  await convertWonLead(repo, lead);
  const c = await repo.get("customers", (await repo.get("leads", "l3")).customerId);
  assert.equal(c.arr, 5964, "só o recorrente anualiza");
  const invs = (await repo.list("invoices")).filter((i) => i.customer === c.id);
  assert.equal(invs.filter((i) => i.oneOff).length, 1, "o pacote virou fatura avulsa");
});

test("migração: cliente antigo de serviço único sai do ARR e ganha a fatura (paga pelo MP quando casa; presumida no à vista; aberta no resto)", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "a", saas: "leverads", name: "A", arr: 5400, planCycle: "unico", paymentMethod: "cartao12x", startedAt: "2026-09-15T12:00:00.000Z", leadId: "la" });
  await repo.create("mp_payments", { id: "mpp_1", mpId: "1", status: "approved", kind: "venda", customer: "a", amount: 5400, method: "master", methodType: "credit_card", dateApproved: "2026-09-15T13:00:00.000Z" });
  await repo.create("customers", { id: "b", saas: "leverads", name: "B", arr: 1490, planCycle: "unico", paymentMethod: "pix", startedAt: "2026-10-01T12:00:00.000Z" });
  await repo.create("customers", { id: "c", saas: "leverads", name: "C", arr: 6000, planCycle: "unico", paymentMethod: "boleto", startedAt: "2026-10-05T12:00:00.000Z" });
  await repo.create("customers", { id: "d", saas: "leverads", name: "D", arr: 12000, planCycle: "anual", paymentMethod: "pix" });
  assert.equal(await migrateOneOffCustomers(repo), 3);
  assert.equal(await migrateOneOffCustomers(repo), 0, "idempotente");
  const inv = (id) => (repo.list("invoices")).then((l) => l.find((i) => i.customer === id));
  assert.deepEqual([(await repo.get("customers", "a")).arr, (await repo.get("customers", "a")).oneOffAmount], [0, 5400]);
  assert.deepEqual([(await inv("a")).paidProof.kind, (await inv("a")).mpPaymentId], ["mp", "1"]);
  assert.deepEqual([(await inv("b")).status, (await inv("b")).paidProof.kind], ["paid", "closing"]);
  assert.equal((await inv("c")).status, "open");
  assert.equal((await repo.get("customers", "d")).arr, 12000, "anual intocado");
});
