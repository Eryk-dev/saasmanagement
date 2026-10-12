// Baixa automática pela saída do MP: valor igual + data até 5 dias do
// vencimento + candidata única. Empate fica na fila. Vale pro settlement
// report (mp_movements) e pro pagamento feito com o saldo (mp_payments saida).

import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { autoMatchOutflows, matchCandidates } = await import("../src/payments/outflow-match.js");
const { syncMpOutflows } = await import("../src/payments/mp-outflow.js");

test("casa a saída com a conta única de mesmo valor perto do vencimento; empate e fora da janela ficam", async () => {
  const repo = makeMemRepo();
  await repo.create("payables", { id: "p_manu", saas: "leverads", description: "Salário", userId: "sdr", amount: 3800, month: "2026-09", dueDate: "2026-10-01", status: "aberta", counterpartyType: "colaborador" });
  await repo.create("payables", { id: "p_igor", saas: "leverads", description: "Salário", userId: "igor", amount: 4700, month: "2026-09", dueDate: "2026-10-01", status: "aberta", counterpartyType: "colaborador" });
  await repo.create("payables", { id: "p_vit", saas: "leverads", description: "Salário", userId: "vit", amount: 4700, month: "2026-09", dueDate: "2026-10-01", status: "aberta", counterpartyType: "colaborador" });
  await repo.create("payables", { id: "p_darf", saas: "leverads", description: "DARF", amount: 204.13, month: "2026-09", dueDate: "2026-09-20", status: "aberta", counterpartyType: "fornecedor" });
  await repo.create("payables", { id: "p_old", saas: "leverads", description: "Conta velha", amount: 3800, month: "2026-07", dueDate: "2026-08-01", status: "aberta", counterpartyType: "fornecedor" });
  await repo.create("mp_movements", { id: "mov_1", type: "WITHDRAWAL", direction: "out", date: "2026-10-02", amount: 3800, fee: 0, payableId: "", finIgnored: false });
  await repo.create("mp_movements", { id: "mov_2", type: "WITHDRAWAL", direction: "out", date: "2026-10-02", amount: 4700, fee: 0, payableId: "", finIgnored: false });
  await repo.create("mp_payments", { id: "mpp_darf", mpId: "darf", status: "approved", kind: "saida", amount: 204.13, dateApproved: "2026-09-18T12:00:00Z" });
  await repo.create("mp_payments", { id: "mpp_ign", mpId: "ign", status: "approved", kind: "saida", amount: 204.13, dateApproved: "2026-09-18T12:00:00Z", finIgnored: true });
  const r = await autoMatchOutflows(repo);
  assert.deepEqual(r, { matched: 2, pending: 1 });
  const manu = await repo.get("payables", "p_manu");
  assert.deepEqual([manu.status, manu.paidVia, manu.paidAt, manu.autoMatched.id], ["paga", "mp", "2026-10-02T12:00:00.000Z", "mov_1"]);
  assert.equal((await repo.get("mp_movements", "mov_1")).payableId, "p_manu");
  assert.equal((await repo.get("payables", "p_old")).status, "aberta", "fora da janela de 5 dias");
  assert.equal((await repo.get("mp_movements", "mov_2")).payableId, "", "dois salários de 4.700: fica na fila");
  assert.equal((await repo.get("payables", "p_darf")).status, "paga", "DARF pago com o saldo casa com a conta");
  assert.equal((await repo.get("mp_payments", "mpp_darf")).payableId, "p_darf");
  assert.equal(matchCandidates({ amount: 4700, at: "2026-10-02" }, await repo.list("payables")).length, 2);
  assert.deepEqual(await autoMatchOutflows(repo), { matched: 0, pending: 1 }, "idempotente");
});

test("o sync do settlement report casa sozinho o que importou", async () => {
  const repo = makeMemRepo();
  await repo.create("payables", { id: "p1", saas: "leverads", description: "Salário", amount: 2200, month: "2026-09", dueDate: "2026-10-01", status: "aberta", counterpartyType: "colaborador" });
  const csv = "TRANSACTION_TYPE;TRANSACTION_DATE;SOURCE_ID;SETTLEMENT_NET_AMOUNT;FEE_AMOUNT\nWITHDRAWAL;2026-10-01T10:00:00Z;901;-2.200,00;0,00";
  const mp = {
    configured: () => true,
    settlementReportList: async () => [{ file_name: "rel.csv", date_created: new Date().toISOString() }],
    settlementReportDownload: async () => csv,
    settlementReportCreate: async () => { throw new Error("tem fresco"); },
  };
  const r = await syncMpOutflows(repo, mp, {});
  assert.deepEqual([r.imported, r.autoMatched], [1, 1]);
  assert.equal((await repo.get("payables", "p1")).status, "paga");
});
