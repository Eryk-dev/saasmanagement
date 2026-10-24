// 3ª rodada de respostas do Leo (24/10/2026, planilha v2). Mesmas regras do script
// 2026-10-24-respostas-planilha.mjs. Dry-run por padrão; `--apply` grava.
import fs from "node:fs";
const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY;
const BY = "leo-planilha-v2-2026-10-24", NOW = new Date().toISOString();
async function api(method, p, body) {
  const headers = body !== undefined ? { "x-api-key": KEY, "content-type": "application/json" } : { "x-api-key": KEY };
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const ops = []; const skipped = [];
const op = (label, method, path, body, after) => ops.push({ label, method, path, body, after });
const inv = (id) => api("GET", `/api/invoices/${id}`);
const pmt = (id) => api("GET", `/api/mp_payments/${id}`);
const brt = (d) => `${d}T12:00:00.000Z`;
const stampMirrorProof = (invoiceId, ps) => async () => {
  const cur = await inv(invoiceId); const p0 = ps[0];
  await api("PATCH", `/api/invoices/${invoiceId}`, { mpPaymentId: p0.mpId, paidGateway: p0.gateway || "mp", paidMethod: p0.method || "", paidMethodType: p0.methodType || "", paidInstallments: p0.installments || 1,
    paidProof: { ...(cur.paidProof || {}), kind: p0.gateway || "mp", mpPaymentId: p0.mpId, confirmedFrom: "closing" } });
};
const stampKind = (invoiceId, kind) => async () => {
  const cur = await inv(invoiceId);
  await api("PATCH", `/api/invoices/${invoiceId}`, { paidGateway: kind, paidProof: { ...(cur.paidProof || {}), kind } });
};

// Storm: fechou por 3.000 — cartão de 3.000 no MP (25/08).
{
  const i = await inv("in_mt8q5hwn06"); const p = await pmt("mpp_174598832697");
  if (i.paidProof?.kind === "closing") {
    op("Storm: fatura vale 3.000 (Leo: fez por 3.000), paga pelo cartão 174598832697", "PATCH", "/api/invoices/in_mt8q5hwn06", { amount: 3000, originalAmount: 3288, status: "paid", paidAt: p.dateApproved, mpPaymentId: p.mpId, paidGateway: "mp", paidMethod: p.method, paidMethodType: p.methodType, paidInstallments: p.installments || 1, paidProof: { kind: "mp", at: p.dateApproved, mpPaymentId: p.mpId, confirmedFrom: "closing", note: `Leo 24/10: fez por 3.000 · ${BY}` } });
    op("Storm: cartão → fatura", "PATCH", `/api/mp_payments/${p.id}`, { invoice: "in_mt8q5hwn06", matchedBy: "manual" });
  } else skipped.push("Storm: já confirmada");
}
// 3S: está pagando parcelado — 299 recebidos (PIX 28/08, "1 mês teste"); o resto (2.989) fica em aberto numa fatura até o Leo dizer o nº de parcelas.
{
  const i = await inv("in_mtd2l0j50f"); const p = await pmt("mpp_175064065969");
  if (i.paidProof?.kind === "closing") {
    op("3S: entrada 299 (PIX no MP) + restante 2.989 em aberto (parcelado, nº de parcelas a definir)", "POST", "/api/invoices/in_mtd2l0j50f/confirm", { at: p.dateApproved, method: "pix", amount: 299, note: `Leo 24/10: está pagando parcelado; 299 no MP em 28/08 · ${BY}`, remainder: { installments: 1, firstDue: "2026-09-28", method: "pix" } }, stampMirrorProof("in_mtd2l0j50f", [p]));
    op("3S: PIX → fatura", "PATCH", `/api/mp_payments/${p.id}`, { invoice: "in_mtd2l0j50f", matchedBy: "manual" });
  } else skipped.push("3S: já confirmada");
}
// Renan: não pagou → sai do painel de clientes (venda desfeita).
{
  const c = await api("GET", "/api/customers/cu_mu2zdx0t0n").catch(() => null);
  if (c) {
    op("Renan: reabrir in_mu2zdx1j0p → não pago", "POST", "/api/invoices/in_mu2zdx1j0p/unpay", {});
    op("Renan: tirar do painel de clientes (venda desfeita, card volta pro funil)", "POST", "/api/customers/cu_mu2zdx0t0n/revert-win", {});
  } else skipped.push("Renan: cliente já não existe");
}
// Thiago: pago pela Appmax (sem valor líquido informado).
{
  const i = await inv("in_mub9okd11n");
  if (i.paidProof?.kind === "closing") op("Thiago: confirmar presumida 7.164 paga pela Appmax", "POST", "/api/invoices/in_mub9okd11n/confirm", { at: brt("2026-09-21"), method: "cartao", note: `Leo 24/10: pago pela Appmax · ${BY}` }, stampKind("in_mub9okd11n", "appmax"));
  else skipped.push("Thiago: já confirmada");
}
// Casa das Louças: recorrência de 12 × 539 no cartão (MP). 1ª em 14/10; as outras 11 ficam abertas com valor exato pra casar sozinhas.
{
  const i = await inv("in_mvff2p4s03"); const p = await pmt("mpp_183195421753");
  if (i.paidProof?.kind === "closing") {
    op("Casa das Louças: fatura vale 12 × 539 = 6.468 (fechamento registrava 6.478)", "PATCH", "/api/invoices/in_mvff2p4s03", { amount: 6468, title: "Anual · 12 × 539 no cartão (fechamento registrava 6.478)" });
    op("Casa das Louças: 1ª parcela 539 (MP 14/10) + 11 × 539 em aberto", "POST", "/api/invoices/in_mvff2p4s03/confirm", { at: p.dateApproved, method: "cartao", amount: 539, note: `Leo 24/10: pagando mês a mês no MP · ${BY}`, remainder: { installments: 11, firstDue: "2026-11-14", method: "cartao" } }, stampMirrorProof("in_mvff2p4s03", [p]));
    op("Casa das Louças: cartão → fatura", "PATCH", `/api/mp_payments/${p.id}`, { invoice: "in_mvff2p4s03", matchedBy: "manual" });
  } else skipped.push("Casa das Louças: já confirmada");
}
// Agreste: PIX de 4.500 caiu no BTG.
{
  const i = await inv("in_mvfk93tm09");
  if (i.paidProof?.kind === "closing") op("Agreste: confirmar presumida 4.500 (PIX no BTG)", "POST", "/api/invoices/in_mvfk93tm09/confirm", { at: brt("2026-10-19"), method: "pix", note: `Leo 24/10: caiu no BTG · ${BY}` });
  else skipped.push("Agreste: já confirmada");
}

console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} · ${ops.length} operações · ${skipped.length} puladas`);
for (const o of ops) console.log(`  ${o.method.padEnd(6)} ${o.label}`);
for (const s of skipped) console.log(`  (pulado) ${s}`);
if (APPLY) { for (const o of ops) { await api(o.method, o.path, o.body); if (o.after) await o.after(); } console.log("ok"); }
