// Phillype (boleto 12× 699): o re-espelho do lead gerou 12 parcelas de 640,75
// (redividiu o que faltava sem descontar a mensalidade 1 já paga — corrigido
// em won-lead.js/billing.js). Este script conserta os DADOS na produção pela
// API: apaga as 12 erradas, cria as parcelas 2 a 12 de 699 (venc. dia 27),
// marca a mensalidade 1 paga como parcela 1/12 e dá baixa na parcela 2 com o
// boleto do Asaas de 14/10 (fatura 935448365).
//   node packages/api/scripts/2026-10-17-phillype-parcelas.mjs [--apply]
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const H = { "x-api-key": process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY, "content-type": "application/json" };
async function api(method, p, body) {
  const headers = body !== undefined ? H : { "x-api-key": H["x-api-key"] }; // DELETE sem corpo não leva content-type
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const CUST = "cu_mtbjq1ap07", SUB = "su_mtbjq1b208", SAAS = "leverads", NOW = new Date().toISOString();
const act = async (label, fn) => { console.log((APPLY ? "· " : "· (dry) ") + label); if (APPLY) await fn(); };

const invoices = (await api("GET", "/api/invoices")).filter((i) => i.customer === CUST);
const wrong = invoices.filter((i) => i.kind === "installment" && i.status !== "paid" && Math.abs(Number(i.amount) - 640.75) < 0.01);
const first = invoices.find((i) => i.kind === "renewal" && i.status === "paid" && Number(i.amount) === 699);
const have699 = invoices.filter((i) => i.kind === "installment" && Math.abs(Number(i.amount) - 699) < 0.01);
console.log(`faturas do Phillype: ${invoices.length} · erradas (640,75): ${wrong.length} · parcelas 699 já existentes: ${have699.length}`);

for (const i of wrong) await act(`apagar ${i.id} (${i.title || i.kind} venc. ${String(i.dueDate).slice(0, 10)})`, () => api("DELETE", `/api/invoices/${i.id}`));
if (first && !first.installmentN) {
  await act(`mensalidade 1 (${first.id}) vira Parcela 1/12`, () => api("PATCH", `/api/invoices/${first.id}`, { kind: "installment", installmentN: 1, installmentOf: 12, title: "Parcela 1/12 · boleto faturado" }));
}
const created = [];
if (!have699.length) {
  for (let n = 2; n <= 12; n++) {
    const due = new Date(Date.UTC(2026, 7 + (n - 1), 27, 13, 15, 53)).toISOString(); // 27/09/2026 … 27/07/2027
    const id = `in_phillype_p${String(n).padStart(2, "0")}`;
    created.push({ id, due });
    await act(`criar ${id} Parcela ${n}/12 · 699 · venc. ${due.slice(0, 10)}`, () => api("POST", "/api/invoices", {
      id, subscription: SUB, customer: CUST, saas: SAAS, amount: 699, kind: "installment", status: n === 2 ? "paid" : "open",
      installmentN: n, installmentOf: 12, title: `Parcela ${n}/12 · boleto faturado`, dueDate: due, createdAt: NOW,
      ...(n === 2 ? {
        paidAt: "2026-10-14T15:00:00.000Z", mpPaymentId: "inv_935448365", paidGateway: "asaas", paidMethod: "boleto", paidMethodType: "ticket", paidInstallments: 1,
        paidProof: { kind: "asaas", at: "2026-10-14T15:00:00.000Z", mpPaymentId: "inv_935448365", note: "boleto Asaas fatura nr. 935448365 recebido em 14/10" },
      } : {}),
    }));
  }
  await act("espelho asa_inv_935448365 aponta pra parcela 2", () => api("PATCH", "/api/mp_payments/asa_inv_935448365", { invoice: "in_phillype_p02", customer: CUST, saas: SAAS, matchedBy: "manual" }));
}
console.log(APPLY ? "feito" : "(dry-run)");
