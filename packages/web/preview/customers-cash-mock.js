import { bizDay } from "../src/lib/format.js";

// Fatos fictícios para conferir o card, filtro, erro e estado vazio sem API.
// O valor confirmado supera o ARR novo em 30 dias: não há teto no contratado.
let failedOnce = false;
export const customersCashMock = {
  billingCash: async (saas, { since, until }) => {
    const state = new URLSearchParams(location.search).get("cash");
    if (state === "error") throw new Error("Falha fictícia de recebimentos");
    if (state === "retry" && !failedOnce) { failedOnce = true; throw new Error("Falha temporária fictícia"); }
    const day = (ago) => bizDay(new Date(Date.now() - ago * 86400000));
    const inWin = (ago) => day(ago) >= since && day(ago) <= until;
    const empty = state === "empty" || saas !== "leverads";
    const receipts = empty ? [] : [{ ago: 0, amount: 450 }, { ago: 5, amount: 25000 }, { ago: 35, amount: 1800 }];
    const open = empty ? [] : [{ ago: 0, amount: 900 }, { ago: 12, amount: 3300 }];
    return {
      saas, since, until,
      received: receipts.filter((p) => inWin(p.ago)).reduce((sum, p) => sum + p.amount, 0),
      receivable: open.filter((p) => inWin(p.ago)).reduce((sum, p) => sum + p.amount, 0),
      openCount: open.filter((p) => inWin(p.ago)).length,
    };
  },
};
