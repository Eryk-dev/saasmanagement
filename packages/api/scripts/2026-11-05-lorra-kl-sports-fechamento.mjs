// Lorra · Kl sports (lead le_mvptvu5k06, cliente cu_mvqy530y07): tinha virado
// teste grátis em 29/10, mas fechou de verdade — R$ 4.000 à vista (MP
// 186620144615, 04/11) + o restante em 12x de R$ 556,40 na assinatura
// recorrente do Mercado Pago (preapproval feb2818…, 1ª cobrança 30/10, próxima
// 30/11). Este script conserta os DADOS em produção pela API:
//   1. reativa a assinatura anual su_mvqy531208 (Price Essencial · 9.564);
//   2. reedita o fechamento no lead (Essencial anual 9.564, pagamento
//      personalizado, ganho em 04/11) → re-espelha cliente (sai do teste);
//   3. cliente volta ao status de pagamento automático;
//   4. cria as faturas: entrada 4.000 (paga, MP 186620144615) + parcelas 1/12 a
//      12/12 de 556,40 (1/12 paga, MP 185867999319; 2..12 abertas, venc. dia 30);
//   5. aponta os espelhos dos 2 pagamentos pras faturas;
//   6. vincula a recorrência do MP à assinatura (e guarda o e-mail do pagador
//      pra cada cobrança mensal dar baixa sozinha na próxima parcela aberta);
//   7. recalcula o ciclo de vida do cliente.
//   node packages/api/scripts/2026-11-05-lorra-kl-sports-fechamento.mjs [--apply]
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY;
async function api(method, p, body) {
  const headers = body !== undefined ? { "x-api-key": KEY, "content-type": "application/json" } : { "x-api-key": KEY };
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const act = async (label, fn) => { console.log((APPLY ? "· " : "· (dry) ") + label); if (APPLY) return fn(); };

const LEAD = "le_mvptvu5k06", CUST = "cu_mvqy530y07", SUB = "su_mvqy531208", SAAS = "leverads";
const PRE = "mps_feb2818cf86c4db5ae71f25fdb717370";
const PAY_ENTRADA = "mpp_186620144615", PAY_P1 = "mpp_185867999319";
const EMAIL = "lorra_00@hotmail.com";
const TERMS = "R$ 4.000 à vista + 12x de R$ 556,40 na assinatura recorrente do Mercado Pago";
const WON_AT = "2026-11-04T10:23:33.000Z";      // pagamento da entrada (04/11 07:23 BRT)
const P1_PAID_AT = "2026-10-30T20:15:34.000Z";  // 1ª cobrança da recorrência (30/10 17:15 BRT)
const P_START = "2026-10-30T20:15:32.000Z";     // base do vencimento: dia 30 (próxima do MP = 30/11)
const PARCELA = 556.4, ENTRADA = 4000, N = 12;
const NOW = new Date().toISOString();

// Mesmo addMonths do billing.js (clampa pro último dia do mês: 30/jan + 1 = 28/fev).
function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}
const mpPaid = (p, at) => ({
  status: "paid", paidAt: at, mpPaymentId: p.mpId, paidGateway: "mp",
  paidMethod: p.method || "", paidMethodType: p.methodType || "", paidInstallments: Number(p.installments) || 1,
  paidProof: { kind: "mp", at, mpPaymentId: p.mpId },
});

// ── Estado atual ──────────────────────────────────────────────────────────
const [lead, customer, sub, pre, payEntrada, payP1] = await Promise.all([
  api("GET", `/api/leads/${LEAD}`), api("GET", `/api/customers/${CUST}`), api("GET", `/api/subscriptions/${SUB}`),
  api("GET", `/api/mp_preapprovals/${PRE}`), api("GET", `/api/mp_payments/${PAY_ENTRADA}`), api("GET", `/api/mp_payments/${PAY_P1}`),
]);
const invoices = (await api("GET", "/api/invoices")).filter((i) => i.customer === CUST);
console.log(`lead: ${lead.dealProduct}/${lead.planClosed} ${lead.amount} · pagamento ${lead.paymentMethod} · ganho ${lead.wonAt}`);
console.log(`cliente: ${customer.plan} · arr ${customer.arr} · pgto ${customer.paymentStatus} · ciclo de vida ${customer.lifecycle} · teste até ${customer.trialEndsAt || "—"}`);
console.log(`assinatura: ${sub.status} ${sub.cycle} ${sub.price} · preapproval ${sub.mpPreapprovalId || "—"}`);
console.log(`recorrência MP: ${pre.status} ${pre.amount}/${pre.cycle} · cliente ${pre.customer || "—"} · assinatura ${pre.subscription || "—"} · próxima ${pre.nextPaymentDate}`);
console.log(`pagamentos: entrada ${payEntrada.amount} ${payEntrada.status} fatura ${payEntrada.invoice || "—"} · parcela 1 ${payP1.amount} ${payP1.status} fatura ${payP1.invoice || "—"}`);
console.log(`faturas do cliente: ${invoices.length}`);
if (Number(payEntrada.amount) !== ENTRADA || Math.abs(Number(payP1.amount) - PARCELA) > 0.01) throw new Error("valores dos pagamentos do MP não batem com o esperado");

// 1. Assinatura anual volta a valer (foi cancelada quando virou teste).
if (sub.status !== "active") {
  await act(`reativar assinatura ${SUB} (${sub.cycle} ${sub.price})`, () => api("PATCH", `/api/subscriptions/${SUB}`, { status: "active", canceledAt: "" }));
}

// 2. Fechamento reeditado no lead → syncWonLeadDeal re-espelha o cliente
//    (plano Essencial anual, sai do teste, trialEndsAt limpo).
await act(`lead ${LEAD}: Price Essencial anual 9.564, pagamento personalizado, ganho em 04/11`, () => api("PATCH", `/api/leads/${LEAD}`, {
  dealProduct: "price_essencial", planClosed: "anual", amount: 9564,
  paymentMethod: "custom", paymentTerms: TERMS, paymentInstallments: 0, wonAt: WON_AT,
}));

// 3. Cliente: status de pagamento automático (dinheiro real × valor fechado) e condição escrita.
await act(`cliente ${CUST}: status de pagamento automático + condição`, () => api("PATCH", `/api/customers/${CUST}`, { paymentStatus: "", paymentTerms: TERMS }));

// 4. Faturas.
const have = (id) => invoices.some((i) => i.id === id);
if (!have("in_lorra_entrada")) {
  await act(`fatura in_lorra_entrada · Entrada 4.000 · paga 04/11 (MP ${payEntrada.mpId})`, () => api("POST", "/api/invoices", {
    id: "in_lorra_entrada", subscription: SUB, customer: CUST, saas: SAAS, amount: ENTRADA, kind: "manual",
    title: "Entrada · R$ 4.000 à vista", dueDate: WON_AT, createdAt: NOW, ...mpPaid(payEntrada, WON_AT),
  }));
}
for (let n = 1; n <= N; n++) {
  const id = `in_lorra_p${String(n).padStart(2, "0")}`;
  if (have(id)) continue;
  const due = addMonths(P_START, n - 1);
  await act(`fatura ${id} · Parcela ${n}/${N} · 556,40 · venc. ${due.slice(0, 10)}${n === 1 ? ` · paga 30/10 (MP ${payP1.mpId})` : ""}`, () => api("POST", "/api/invoices", {
    id, subscription: SUB, customer: CUST, saas: SAAS, amount: PARCELA, kind: "installment", status: "open",
    installmentN: n, installmentOf: N, title: `Parcela ${n}/${N} · assinatura recorrente`, dueDate: due, createdAt: NOW,
    ...(n === 1 ? mpPaid(payP1, P1_PAID_AT) : {}),
  }));
}

// 5. Espelhos dos pagamentos apontam pras faturas.
if (payEntrada.invoice !== "in_lorra_entrada") {
  await act(`espelho ${PAY_ENTRADA} → in_lorra_entrada`, () => api("PATCH", `/api/mp_payments/${PAY_ENTRADA}`, { invoice: "in_lorra_entrada", subscription: SUB, customer: CUST, saas: SAAS, matchedBy: "manual" }));
}
if (payP1.invoice !== "in_lorra_p01") {
  await act(`espelho ${PAY_P1} → in_lorra_p01`, () => api("PATCH", `/api/mp_payments/${PAY_P1}`, { invoice: "in_lorra_p01", subscription: SUB, customer: CUST, saas: SAAS, matchedBy: "manual" }));
}

// 6. Recorrência do MP presa à assinatura. O e-mail do pagador é o que faz a
//    cobrança mensal casar com a assinatura (mp-payments.js, matchedBy
//    "preapproval") e dar baixa na próxima parcela aberta.
if (!pre.payerEmail) await act(`recorrência ${PRE}: e-mail do pagador ${EMAIL}`, () => api("PATCH", `/api/mp_preapprovals/${PRE}`, { payerEmail: EMAIL }));
if (pre.subscription !== SUB) await act(`vincular recorrência ${PRE} à assinatura ${SUB}`, () => api("POST", `/api/mp/preapprovals/${PRE}/link`, { subscription: SUB }));

// 7. Ciclo de vida (estava "churn" porque a assinatura estava cancelada).
await act("recalcular ciclo de vida dos clientes", () => api("POST", "/api/customers/lifecycle/run"));

if (APPLY) {
  const [c2, s2, l2, p2] = await Promise.all([api("GET", `/api/customers/${CUST}`), api("GET", `/api/subscriptions/${SUB}`), api("GET", `/api/leads/${LEAD}`), api("GET", `/api/mp_preapprovals/${PRE}`)]);
  const inv2 = (await api("GET", "/api/invoices")).filter((i) => i.customer === CUST).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  console.log("\n== depois ==");
  console.log(`lead: ${l2.dealProduct}/${l2.planClosed} ${l2.amount} · ${l2.paymentMethod} (${l2.paymentTerms}) · ganho ${l2.wonAt} · teste? ${l2.trialEndsAt || "não"}`);
  console.log(`cliente: ${c2.plan} · planCode ${c2.planCode}/${c2.planCycle} · arr ${c2.arr} · pgto "${c2.paymentStatus}" · ciclo de vida ${c2.lifecycle} · fin ${c2.financialStatus} · teste até ${c2.trialEndsAt || "—"}`);
  console.log(`assinatura: ${s2.status} ${s2.cycle} ${s2.price} · ${s2.periodStart?.slice(0, 10)}→${s2.periodEnd?.slice(0, 10)} · preapproval ${s2.mpPreapprovalId || "—"} (${s2.mpStatus || "—"})`);
  console.log(`recorrência MP: cliente ${p2.customer} · assinatura ${p2.subscription} · ${p2.matchedBy} · pagador ${p2.payerEmail}`);
  for (const i of inv2) console.log(`  ${i.id} · ${i.title || i.kind} · ${i.amount} · ${i.status} · venc. ${String(i.dueDate).slice(0, 10)}${i.mpPaymentId ? ` · MP ${i.mpPaymentId}` : ""}`);
  const paid = inv2.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount, 0);
  console.log(`recebido ${paid.toFixed(2)} · a receber ${inv2.filter((i) => i.status !== "paid").reduce((a, i) => a + i.amount, 0).toFixed(2)}`);
}
console.log(APPLY ? "feito" : "(dry-run)");
