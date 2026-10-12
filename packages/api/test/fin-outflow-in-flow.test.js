// Saídas da conta MP entram no fluxo de caixa: movimento do settlement report
// e pagamento feito com o saldo (kind saida no espelho) sem dono somam na
// saída do mês; casados com uma conta a pagar, é a conta (paga) que conta.
// O sync lê TODOS os arquivos ainda não lidos e carimba filesDone/typesSeen.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { syncMpOutflows } = await import("../src/payments/mp-outflow.js");

test("fluxo.saida soma saída sem dono (settlement + espelho); vinculada à conta paga não dobra", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [] });
  await repo.create("mp_movements", { id: "mov_1", saas: "", type: "WITHDRAWAL", direction: "out", date: "2026-09-05", amount: 3000, fee: 0, payableId: "", finIgnored: false });
  await repo.create("mp_movements", { id: "mov_2", saas: "", type: "PAYOUT", direction: "out", date: "2026-09-06", amount: 500, fee: 0, payableId: "pay_x", finIgnored: false });
  await repo.create("mp_movements", { id: "mov_3", saas: "", type: "PAYOUT", direction: "out", date: "2026-09-07", amount: 70, fee: 0, payableId: "", finIgnored: true });
  await repo.create("payables", { id: "pay_x", saas: "leverads", description: "Fornecedor", category: "apis", counterpartyType: "fornecedor", amount: 500, month: "2026-09", dueDate: "2026-09-06", status: "paga", paidAt: "2026-09-06T12:00:00Z", paidVia: "mp" });
  await repo.create("mp_payments", { id: "mpp_d", mpId: "d", status: "approved", kind: "saida", amount: 204.13, description: "DARF - CÓDIGO DE BARRA", dateApproved: "2026-09-18T12:00:00Z" });
  await repo.create("mp_payments", { id: "mpp_i", mpId: "i", status: "approved", kind: "interna", amount: 50000, dateApproved: "2026-09-10T12:00:00Z" });
  const app = Fastify();
  registerRoutes(app, repo);
  const fin = (await app.inject({ url: "/api/fin/leverads?month=2026-09" })).json();
  const set = fin.fluxo.find((f) => f.month === "2026-09");
  assert.equal(set.saidasSemDono, 3204.13);
  assert.equal(set.saida, 500 + 3204.13, "conta paga + saídas sem dono; interna e ignorada ficam fora");
  assert.deepEqual([fin.conciliacao.saidasPendentes.n, fin.conciliacao.saidasPendentes.total], [2, 3204.13]);
  assert.deepEqual(fin.conciliacao.saidasPendentes.items.map((i) => i.source), ["mp", "settlement"]);
  assert.deepEqual(fin.conciliacao.saidasMp, { n: 1, total: 204.13 });
  await app.close();
});

test("sync lê todos os arquivos ainda não lidos (não só 3), carimba filesDone e os tipos vistos", async () => {
  const repo = makeMemRepo();
  const files = Array.from({ length: 6 }, (_, i) => ({ file_name: `rel-${i}.csv`, date_created: new Date(Date.now() - i * 3600_000).toISOString() }));
  const csvOf = (i) => `TRANSACTION_TYPE;TRANSACTION_DATE;SOURCE_ID;SETTLEMENT_NET_AMOUNT;FEE_AMOUNT\nSETTLEMENT;2026-09-0${i + 1}T10:00:00Z;s${i};5.964,00;-638,74\nWITHDRAWAL;2026-09-0${i + 1}T11:00:00Z;w${i};-1.000,00;0,00`;
  const downloaded = [];
  const mp = {
    configured: () => true,
    settlementReportList: async () => files,
    settlementReportDownload: async (name) => { downloaded.push(name); return csvOf(Number(name.match(/\d+/)[0])); },
    settlementReportCreate: async () => { throw new Error("tem fresco"); },
  };
  const r1 = await syncMpOutflows(repo, mp, {});
  assert.equal(r1.filesRead, 6);
  assert.equal(r1.imported, 6, "uma saída por arquivo; a liquidação positiva não vira movimento");
  const stamp = await repo.get("app_config", "mp_out_sync");
  assert.equal(stamp.filesDone.length, 6);
  assert.ok(stamp.typesSeen.includes("SETTLEMENT") && stamp.typesSeen.includes("WITHDRAWAL"));
  const r2 = await syncMpOutflows(repo, mp, {});
  assert.deepEqual([r2.filesRead, r2.imported], [0, 0], "arquivo lido não é baixado de novo");
  assert.equal(downloaded.length, 6);
});
