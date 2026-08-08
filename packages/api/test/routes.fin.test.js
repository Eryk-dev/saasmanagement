// GET /api/fin/:saas — o Financeiro completo: contas a pagar com recorrência
// materializada por mês, tiles no padrão Conta Azul, fluxo de caixa e DRE.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

async function build() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const app = Fastify();
  registerRoutes(app, repo);
  return { app, repo };
}

const fin = (app, month) => app.inject({ url: `/api/fin/leverads?month=${month}` }).then((r) => r.json());

test("recorrência materializa UMA instância por mês (idempotente) e clampa o dia do vencimento", async () => {
  const { app, repo } = await build();
  // Template = a própria ocorrência de junho; dia 31 pra provar o clamp.
  await app.inject({ method: "POST", url: "/api/payables", payload: {
    saas: "leverads", description: "Salário Jon", category: "pessoal",
    counterpartyType: "colaborador", userId: "jon", amount: 3000,
    month: "2026-06", dueDate: "2026-06-31", status: "aberta", recurring: true,
  } });

  const r1 = await fin(app, "2026-08");
  const ago = r1.payables.filter((p) => p.month === "2026-08");
  assert.equal(ago.length, 1, "uma instância de agosto");
  assert.ok(ago[0].templateId, "instância aponta pro template");
  assert.equal(ago[0].dueDate, "2026-08-31");
  // A janela do fluxo materializa os meses pulados também (julho existe).
  const all = (await repo.list("payables")).filter((p) => p.saas === "leverads");
  assert.equal(all.filter((p) => p.month === "2026-07").length, 1);
  // fevereiro hipotético não existe (template começa em junho)
  assert.equal(all.filter((p) => p.month === "2026-05").length, 0);

  await fin(app, "2026-08"); // 2ª chamada não duplica
  const depois = (await repo.list("payables")).filter((p) => p.saas === "leverads");
  assert.equal(depois.length, all.length, "idempotente");

  // Encerrar a recorrência: setar endMonth no template para de gerar meses novos.
  const template = depois.find((p) => p.recurring && !p.templateId);
  await app.inject({ method: "PATCH", url: `/api/payables/${template.id}`, payload: { endMonth: "2026-08" } });
  const r2 = await fin(app, "2026-09");
  assert.equal(r2.payables.filter((p) => p.month === "2026-09").length, 0, "setembro não nasce");
  await app.close();
});

test("tiles: vencida → informar pagamento vira 'pagos do mês' (pela data da baixa)", async () => {
  const { app, repo } = await build();
  await app.inject({ method: "POST", url: "/api/payables", payload: {
    saas: "leverads", description: "Contabilidade", category: "estrutura",
    counterpartyType: "fornecedor", supplierName: "Contador", amount: 500,
    month: "2026-08", dueDate: "2026-08-05", status: "aberta",
  } });
  const antes = await fin(app, "2026-08");
  assert.equal(antes.tiles.vencidos.n, 1, "2026-08-05 já passou");
  assert.equal(antes.tiles.vencidos.total, 500);

  const doc = (await repo.list("payables"))[0];
  await app.inject({ method: "PATCH", url: `/api/payables/${doc.id}`, payload: { status: "paga", paidAt: "2026-08-06T12:00:00.000Z" } });
  const depois = await fin(app, "2026-08");
  assert.equal(depois.tiles.vencidos.n, 0);
  assert.deepEqual(depois.tiles.pagos, { n: 1, total: 500 });
  await app.close();
});

test("fluxo e DRE: fatura recebida + conta paga + custo manual + mídia fecham a conta", async () => {
  const { app, repo } = await build();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente", arr: 60000 });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 5000, status: "paid", kind: "renewal", paidAt: "2026-08-03T12:00:00.000Z", dueDate: "2026-08-03T12:00:00.000Z" });
  await repo.create("invoices", { id: "i2", saas: "leverads", customer: "c1", amount: 2000, status: "open", dueDate: "2026-08-25T12:00:00.000Z" });
  await repo.create("expenses", { id: "e1", saas: "leverads", month: "2026-08", category: "ferramenta", name: "Softwares", amount: 200 });
  await repo.create("ad_insights", { id: "a1", saas: "leverads", date: "2026-08-02", spend: 100 });
  await app.inject({ method: "POST", url: "/api/payables", payload: {
    saas: "leverads", description: "Pró-labore", category: "pessoal", counterpartyType: "colaborador",
    userId: "leo", amount: 3000, month: "2026-08", dueDate: "2026-08-05",
    status: "paga", paidAt: "2026-08-05T12:00:00.000Z",
  } });

  const r = await fin(app, "2026-08");
  assert.equal(r.receber.recebidosMes, 5000);
  assert.deepEqual(r.receber.emAberto, { n: 1, total: 2000 });
  assert.equal(r.dre.receita.renewal, 5000);
  assert.deepEqual(r.dre.despesas, { pessoal: 3000, ferramenta: 200, ads: 100 });
  assert.equal(r.dre.despesasMes, 3300);
  assert.equal(r.dre.resultado, 1700);
  const ago = r.fluxo.find((f) => f.month === "2026-08");
  assert.deepEqual(ago, { month: "2026-08", entrada: 5000, saida: 3300 });
  // previsto: fatura aberta do mês entra; a conta paga não (só abertas + custos)
  assert.equal(r.previsto.entrada, 2000);
  assert.equal(r.previsto.saida, 300);
  await app.close();
});

test("conciliação: aprovado sem cliente é pendência; desconsiderado sai; espelho soma o mês", async () => {
  const { app, repo } = await build();
  await repo.create("mp_payments", { id: "mpp_1", saas: "leverads", mpId: "1", status: "approved", amount: 900, dateApproved: "2026-08-04T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_2", saas: "leverads", mpId: "2", status: "approved", amount: 400, customer: "c1", dateApproved: "2026-08-04T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_3", saas: "leverads", mpId: "3", status: "approved", amount: 150, finIgnored: true, finIgnoredReason: "estorno", dateApproved: "2026-08-05T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_4", saas: "leverads", mpId: "4", status: "rejected", amount: 999, dateApproved: "2026-08-05T12:00:00.000Z" });

  const r = await fin(app, "2026-08");
  assert.deepEqual(r.conciliacao.pendentes, { n: 1, total: 900 });
  assert.equal(r.conciliacao.ignoradas, 1);
  assert.equal(r.conciliacao.espelhoMes, 1450, "aprovados do mês, inclusive vinculados e ignorados");
  await app.close();
});
