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
  // DRE por setor: pessoal/ferramenta legados caem no G&A, mídia automática no S&M.
  assert.deepEqual(r.dre.setores.ga, { pessoal: 3000, ferramenta: 200 });
  assert.deepEqual(r.dre.setores.sm, { ads: 100 });
  assert.deepEqual(r.dre.setores.deducoes, {});
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

// ── Conciliação com aprendizado + setores + saídas ───────────────────────────

test("regra aprendida vincula sozinha, baixa a fatura de valor exato e some das pendências", async () => {
  const { app, repo } = await build();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Loja do Zé", arr: 12000 });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 990, status: "open", dueDate: "2026-08-10T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_9", saas: "leverads", mpId: "9", status: "approved", amount: 990, payerEmail: "ZE@Loja.com ", payerDoc: "", dateApproved: "2026-08-05T12:00:00.000Z" });
  await app.inject({ method: "POST", url: "/api/fin_rules", payload: {
    saas: "leverads", matchField: "payerEmail", matchValue: "ze@loja.com", action: "vincular", customer: "c1",
  } });

  const r = await fin(app, "2026-08");
  assert.equal(r.conciliacao.pendentes.n, 0, "a regra resolveu a pendência");
  assert.equal(r.conciliacao.autoAplicadas, 1);
  const pmt = await repo.get("mp_payments", "mpp_9");
  assert.equal(pmt.customer, "c1");
  assert.equal(pmt.matchedBy, "rule");
  const inv = await repo.get("invoices", "i1");
  assert.equal(inv.status, "paid", "valor exato + fatura única = baixa automática");
  assert.equal(inv.mpPaymentId, "9");
  const rule = (await repo.list("fin_rules"))[0];
  assert.equal(rule.autoCount, 1);
  await app.close();
});

test("regra de desconsiderar limpa a pendência com motivo; sem regra, sai a sugestão por valor", async () => {
  const { app, repo } = await build();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente Bom", arr: 12000 });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 750, status: "open", dueDate: "2026-08-20T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_a", saas: "leverads", mpId: "a", status: "approved", amount: 100, payerDoc: "111.222.333-44", dateApproved: "2026-08-05T12:00:00.000Z" });
  await repo.create("mp_payments", { id: "mpp_b", saas: "leverads", mpId: "b", status: "approved", amount: 750, payerName: "Fulano", dateApproved: "2026-08-06T12:00:00.000Z" });
  await app.inject({ method: "POST", url: "/api/fin_rules", payload: {
    saas: "leverads", matchField: "payerDoc", matchValue: "11122233344", action: "desconsiderar", reason: "estorno",
  } });

  const r = await fin(app, "2026-08");
  assert.equal(r.conciliacao.pendentes.n, 1, "só o sem regra sobra");
  assert.equal((await repo.get("mp_payments", "mpp_a")).finIgnored, true);
  assert.equal((await repo.get("mp_payments", "mpp_a")).finIgnoredReason, "estorno");
  assert.equal(r.conciliacao.sugestoes.mpp_b.customer, "c1", "sugestão pela fatura aberta de mesmo valor");
  assert.equal(r.conciliacao.sugestoes.mpp_b.invoiceId, "i1");
  await app.close();
});

test("DRE setoriza percentuais pela base: imposto vira dedução, checkout vira taxa de pagamento (COGS)", async () => {
  const { app, repo } = await build();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente", arr: 60000 });
  await repo.create("invoices", { id: "i1", saas: "leverads", customer: "c1", amount: 10000, status: "paid", kind: "renewal", paidAt: "2026-08-03T12:00:00.000Z", dueDate: "2026-08-03T12:00:00.000Z" });
  await repo.create("expenses", { id: "e1", saas: "leverads", month: "2026-08", category: "taxas", name: "Imposto", pct: 10, base: "received", recurring: true });
  const r = await fin(app, "2026-08");
  assert.deepEqual(r.dre.setores.deducoes, { imposto: 1000 }, "10% dos 10.000 recebidos, como dedução");
  assert.equal(r.dre.despesasMes, 1000);
  assert.equal(r.dre.resultado, 9000);
  await app.close();
});

test("parseSettlementCsv: só WITHDRAWAL/PAYOUT viram movimento, com valor pt-BR e tarifa", async () => {
  const { parseSettlementCsv } = await import("../src/routes.fin.js");
  const csv = [
    "TRANSACTION_TYPE;TRANSACTION_DATE;SOURCE_ID;SETTLEMENT_NET_AMOUNT;FEE_AMOUNT",
    "SETTLEMENT;2026-08-01T10:00:00Z;111;1.500,00;-45,00",
    "WITHDRAWAL;2026-08-02T10:00:00Z;222;-3.000,50;0,00",
    "PAYOUT;2026-08-03T10:00:00Z;333;900,00;-3,50",
    "REFUND;2026-08-04T10:00:00Z;444;-100,00;0,00",
  ].join("\n");
  const rows = parseSettlementCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { sourceId: "222", type: "WITHDRAWAL", date: "2026-08-02", amount: 3000.5, fee: 0 });
  assert.deepEqual(rows[1], { sourceId: "333", type: "PAYOUT", date: "2026-08-03", amount: 900, fee: 3.5 });
  await Promise.resolve();
});

test("poller de saídas: importa sozinho quando o relatório fica pronto (sem segundo clique do Leo)", async () => {
  const repo = makeMemRepo();
  const { syncMpOutflows } = await import("../src/routes.fin.js");
  const csv = "TRANSACTION_TYPE;TRANSACTION_DATE;SOURCE_ID;SETTLEMENT_NET_AMOUNT;FEE_AMOUNT\nWITHDRAWAL;2026-08-28T10:00:00Z;901;5.000,00;0,00";
  // Passada 1: sem relatório — pede um (o MP gera nos minutos seguintes).
  let ready = false;
  const mp = {
    configured: () => true,
    settlementReportList: async () => (ready ? [{ file_name: "rel.csv", date_created: new Date().toISOString() }] : []),
    settlementReportDownload: async () => csv,
    settlementReportCreate: async () => { ready = true; return { status: 202 }; },
    settlementReportConfigCreate: async () => ({}),
  };
  const r1 = await syncMpOutflows(repo, mp);
  assert.equal(r1.requested, true);
  assert.equal(r1.imported, 0);
  // Passada 2 (o tick seguinte do poller): o arquivo existe e entra sozinho.
  const r2 = await syncMpOutflows(repo, mp);
  assert.equal(r2.imported, 1);
  assert.equal((await repo.list("mp_movements"))[0].amount, 5000);
});

test("mp-out/sync: create recusado tenta criar a CONFIG e pede de novo; erro persistente sai na resposta", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const { registerFinRoutes } = await import("../src/routes.fin.js");

  // Caso 1: conta sem config — o 1º create falha, a config é criada e o retry
  // passa. A UI recebe requested:true, sem erro.
  let configCreated = false;
  let creates = 0;
  const mpOk = {
    configured: () => true,
    settlementReportList: async () => [], // nenhum relatório na conta, nunca
    settlementReportDownload: async () => "",
    settlementReportCreate: async () => {
      creates++;
      if (!configCreated) throw new Error("you do not have a settlement report configuration");
      return { status: 202 };
    },
    settlementReportConfigCreate: async (body) => {
      // O MP recusa config sem columns/frequency — o corpo enviado TEM que tê-los.
      assert.ok(Array.isArray(body?.columns) && body.columns.length > 0, "config precisa de columns");
      assert.ok(body?.frequency?.type, "config precisa de frequency");
      configCreated = true; return {};
    },
  };
  const app1 = Fastify();
  registerFinRoutes(app1, repo, { mp: mpOk });
  const r1 = (await app1.inject({ method: "POST", url: "/api/fin/leverads/mp-out/sync" })).json();
  assert.equal(r1.requested, true);
  assert.equal(r1.requestError, undefined);
  assert.equal(creates, 2, "create → falha → cria config → retry");
  await app1.close();

  // Caso 2: falha mesmo depois da config — o MOTIVO vai na resposta (era
  // engolido por um .catch vazio e o botão parecia morto pra sempre).
  const mpBad = {
    configured: () => true,
    settlementReportList: async () => [],
    settlementReportDownload: async () => "",
    settlementReportCreate: async () => { throw new Error("collector sem permissão de reports"); },
    settlementReportConfigCreate: async () => { throw new Error("config recusada"); },
  };
  const app2 = Fastify();
  registerFinRoutes(app2, repo, { mp: mpBad });
  const r2 = (await app2.inject({ method: "POST", url: "/api/fin/leverads/mp-out/sync" })).json();
  assert.equal(r2.ok, true); // a importação (vazia) não é erro; o pedido é que falhou
  assert.equal(r2.requested, false);
  assert.match(r2.requestError, /collector sem permissão de reports/);
  assert.match(r2.requestError, /config recusada/);
  await app2.close();
});

test("mp-out/sync importa saídas do relatório pronto e não duplica", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  const csv = "TRANSACTION_TYPE;TRANSACTION_DATE;SOURCE_ID;SETTLEMENT_NET_AMOUNT;FEE_AMOUNT\nWITHDRAWAL;2026-08-02T10:00:00Z;777;2.000,00;0,00";
  const mp = {
    configured: () => true,
    settlementReportList: async () => [{ file_name: "rel.csv", date_created: new Date().toISOString() }],
    settlementReportDownload: async () => csv,
    settlementReportCreate: async () => { throw new Error("não devia pedir novo: tem relatório fresco"); },
  };
  const app = Fastify();
  const { registerFinRoutes } = await import("../src/routes.fin.js");
  registerFinRoutes(app, repo, { mp });
  const r1 = (await app.inject({ method: "POST", url: "/api/fin/leverads/mp-out/sync" })).json();
  assert.equal(r1.imported, 1);
  assert.equal(r1.requested, false);
  const r2 = (await app.inject({ method: "POST", url: "/api/fin/leverads/mp-out/sync" })).json();
  assert.equal(r2.imported, 0, "idempotente");
  const movs = await repo.list("mp_movements");
  assert.equal(movs.length, 1);
  assert.equal(movs[0].id, "mov_777");
  assert.equal(movs[0].amount, 2000);
  await app.close();
});
