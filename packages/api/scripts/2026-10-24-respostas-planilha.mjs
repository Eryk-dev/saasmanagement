// Respostas do Leo (24/10/2026) à planilha "presumidas e não pagas" aplicadas no
// cockpit pela API de produção (x-api-key do .env). Dry-run por padrão; `--apply` grava.
// Regra do cashIn: fatura com mpPaymentId presente no espelho NÃO soma de novo —
// por isso a prova de quem pagou no MP/Asaas é `kind mp|asaas` (nunca manual com
// payments[], que dobraria). Inclui os impostos de 20/10 pagos com saldo do MP.
//   node packages/api/scripts/2026-10-24-respostas-planilha.mjs [--apply]
import fs from "node:fs";
const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY;
const BY = "leo-planilha-2026-10-24", NOW = new Date().toISOString();
async function api(method, p, body) {
  const headers = body !== undefined ? { "x-api-key": KEY, "content-type": "application/json" } : { "x-api-key": KEY };
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const ops = []; const skipped = [];
const op = (label, method, path, body, after) => ops.push({ label, method, path, body, after });
// Depois de um confirm/pay (prova manual), carimba a prova do espelho sem perder o restante parcelado.
const stampMirrorProof = (invoiceId, ps) => async () => {
  const cur = await inv(invoiceId); const p0 = ps[0];
  await api("PATCH", `/api/invoices/${invoiceId}`, { mpPaymentId: p0.mpId, paidGateway: p0.gateway || "mp", paidMethod: p0.method || "", paidMethodType: p0.methodType || "", paidInstallments: p0.installments || 1,
    paidProof: { ...(cur.paidProof || {}), kind: p0.gateway || "mp", mpPaymentId: p0.mpId, ...(ps.length > 1 ? { mpPaymentIds: ps.map((p) => p.mpId) } : {}), confirmedFrom: "closing" } });
};
const inv = (id) => api("GET", `/api/invoices/${id}`);
const pmt = (id) => api("GET", `/api/mp_payments/${id}`);
const cust = (id) => api("GET", `/api/customers/${id}`);
const brt = (d) => `${d}T12:00:00.000Z`;

// Fatura (presumida, aberta ou vencida) vira FATO com 1+ pagamentos do espelho.
async function settleWithMirror(label, invoiceId, paymentIds, { amount, note = "", movingFrom = "" } = {}) {
  const i = await inv(invoiceId); const ps = [];
  for (const id of paymentIds) ps.push(await pmt(id));
  if (i.mpPaymentId && ps.some((p) => p.mpId === i.mpPaymentId)) { skipped.push(`${label}: já baixada por esse pagamento`); return; }
  for (const p of ps) {
    if (p.status !== "approved") throw new Error(`${label}: ${p.id} não está aprovado`);
    if (p.invoice && p.invoice !== invoiceId && p.invoice !== movingFrom) throw new Error(`${label}: ${p.id} já baixou ${p.invoice}`);
    if (p.customer && p.customer !== i.customer) throw new Error(`${label}: ${p.id} é de outro cliente (${p.customer})`);
  }
  const sum = Math.round(ps.reduce((a, p) => a + Number(p.amount), 0) * 100) / 100;
  const target = amount ?? Number(i.amount);
  if (Math.abs(sum - target) > 0.01) throw new Error(`${label}: pagamentos somam ${sum}, fatura ${target}`);
  const p0 = ps[0]; const gw = p0.gateway || "mp";
  const c = await cust(i.customer);
  const patch = {
    status: "paid", paidAt: p0.dateApproved, mpPaymentId: p0.mpId, paidGateway: gw, paidMethod: p0.method || "", paidMethodType: p0.methodType || "", paidInstallments: p0.installments || 1,
    paidProof: { kind: gw, at: p0.dateApproved, mpPaymentId: p0.mpId, ...(ps.length > 1 ? { mpPaymentIds: ps.map((p) => p.mpId) } : {}), ...(i.paidProof?.kind === "closing" ? { confirmedFrom: "closing" } : {}), note: `${note} · ${BY}`.replace(/^ · /, "") },
    ...(amount != null && Math.abs(amount - Number(i.amount)) >= 0.01 ? { amount, originalAmount: i.originalAmount ?? i.amount } : {}),
  };
  op(`${label}: fatura ${invoiceId} paga por ${ps.map((p) => p.mpId).join("+")}${amount != null ? ` (valor ${amount}, combinado ${i.originalAmount ?? i.amount})` : ""}`, "PATCH", `/api/invoices/${invoiceId}`, patch);
  for (const p of ps) op(`${label}: pagamento ${p.id} → cliente/fatura`, "PATCH", `/api/mp_payments/${p.id}`, { invoice: invoiceId, customer: i.customer, saas: c.saas || "leverads", ...(c.leadId ? { lead: c.leadId } : {}), matchedBy: "manual" });
}
async function linkToCustomer(label, paymentId, customerId) {
  const p = await pmt(paymentId); if (p.customer === customerId) { skipped.push(`${label}: já vinculado`); return; }
  const c = await cust(customerId);
  op(`${label}: pagamento ${paymentId} (${p.amount}) → cliente ${c.name}`, "PATCH", `/api/mp_payments/${paymentId}`, { customer: customerId, saas: c.saas || "leverads", ...(c.leadId ? { lead: c.leadId } : {}), matchedBy: "manual" });
}
async function confirmManual(label, invoiceId, body) {
  const i = await inv(invoiceId);
  const route = i.status === "paid" ? (i.paidProof?.kind === "closing" ? "confirm" : null) : "pay";
  if (!route) { skipped.push(`${label}: fatura já está paga com prova ${i.paidProof?.kind}`); return; }
  op(`${label}: ${route === "confirm" ? "confirmar presumida" : "dar baixa"} ${invoiceId} (${body.amount ?? i.amount})${body.remainder ? ` + restante em ${body.remainder.installments}x` : ""}`, "POST", `/api/invoices/${invoiceId}/${route}`, { ...body, note: `${body.note} · ${BY}` });
}
async function unpay(label, invoiceId) {
  const i = await inv(invoiceId);
  if (i.status !== "paid") { skipped.push(`${label}: já reaberta (${i.status})`); return; }
  if (i.mpPaymentId) throw new Error(`${label}: tem pagamento do MP, não reabre`);
  op(`${label}: reabrir ${invoiceId} (${i.amount}) → não pago`, "POST", `/api/invoices/${invoiceId}/unpay`, {});
}
async function reopenPaidByMirror(label, invoiceId) {
  const i = await inv(invoiceId);
  if (i.status !== "paid") { skipped.push(`${label}: já reaberta`); return; }
  op(`${label}: reabrir ${invoiceId} (${i.amount}) — o pagamento era do mês anterior`, "PATCH", `/api/invoices/${invoiceId}`, { status: "overdue", overdueAt: NOW, paidAt: "", mpPaymentId: "", paidGateway: "", paidMethod: "", paidMethodType: "", paidInstallments: null, paidProof: null, note: `reaberta em 24/10: o pagamento do espelho baixou esta em vez da 1ª mensalidade · ${BY}` });
}
async function del(label, invoiceId, why) {
  const i = await api("GET", `/api/invoices/${invoiceId}`).catch(() => null);
  if (!i) { skipped.push(`${label}: fatura ${invoiceId} já não existe`); return; }
  op(`${label}: apagar ${invoiceId} (${i.amount}, ${i.status}) — ${why}`, "DELETE", `/api/invoices/${invoiceId}`);
}
async function churn(label, customerId, body) {
  const c = await cust(customerId);
  if (c.lifecycle === "churn" || c.endedAt) { skipped.push(`${label}: cliente já está em churn`); return; }
  op(`${label}: churn de ${c.name} (${body.endedAt})`, "POST", `/api/customers/${customerId}/churn`, { ...body, note: `${body.note || ""} · ${BY}` });
}

// ── Presumidas ──────────────────────────────────────────────────────────────
await unpay("Vernici tintas", "in_msoj3qgd02");
await confirmManual("King auto peças", "in_msrtg5pg0e", { at: brt("2026-08-13"), method: "cartao", note: "Leo 24/10: recebido, conta não informada" });
await confirmManual("mx cabo", "in_mst8x95p03", { at: brt("2026-08-14"), method: "cartao", note: "Leo 24/10: pagou e deu churn, conta não informada" });
await settleWithMirror("Marcos ago", "in_msxfji3b09", ["mpp_173859398850"], { amount: 599, note: "assinatura MP 599/mês (valeriano.marcosj@gmail.com); cadastro dizia 99,83" });
await settleWithMirror("Marcos out", "in_mvcndraz01", ["mpp_183160544897"], { note: "3ª mensalidade da assinatura MP" });
op("Marcos: assinatura volta a ativa", "PATCH", "/api/subscriptions/su_msxfji2o08", { status: "active" });
await unpay("Hemerson", "in_msz6jqex1z");
await unpay("Marvin parts", "in_mt0h25jb0d");
await settleWithMirror("WD Auto Peças", "in_mt1kzbt90a", ["mpp_173918477131", "mpp_173918055787"], { amount: 6000, note: "Leo: pagou 6.000 (2 cartões de 3.000)" });
await settleWithMirror("V6 / Gabriel", "in_mt1vazqz1q", ["mpp_175687292968"], { amount: 8000, note: "Leo: sinal 500 + 7.500 = 8.000; o cartão de 8.000 está no MP (26/08)" });
await settleWithMirror("Minas Imports ago", "in_mt94ljqv18", ["mpp_174640716303"], { note: "1ª mensalidade (PIX 25/08); Leo: pagou só 1 mês", movingFrom: "in_muhg3ect0n" });
await reopenPaidByMirror("Minas Imports set", "in_muhg3ect0n");
op("Minas Imports: assinatura em atraso", "PATCH", "/api/subscriptions/su_mt94ljqd17", { status: "past_due" });
await settleWithMirror("radiadores sao joao ago", "in_mtbioodl05", ["mpp_175853743022"], { note: "1ª mensalidade (cartão 27/08); Leo: pagou só 1 mês", movingFrom: "in_mujtttlk1y" });
await reopenPaidByMirror("radiadores sao joao set", "in_mujtttlk1y");
op("radiadores: assinatura em atraso", "PATCH", "/api/subscriptions/su_mtbioodb04", { status: "past_due" });
await settleWithMirror("Cleiton", "in_mthpy5jx0f", ["mpp_175730967173"], { amount: 1914, note: "Leo: pago no MP; o espelho tem 1.914 (combinado 3.894)" });
await settleWithMirror("Fernando", "in_mtiwba4z02", ["mpp_176682203474"], { amount: 1647, note: "Leo: pagou 1.647 semestral" });
await settleWithMirror("Pansanato set", "in_mtk76o614i", ["mpp_176862489536"], { note: "1ª mensalidade (cartão 02/09)", movingFrom: "in_mur2qr632m" });
op("Pansanato out: 2ª mensalidade confirmada pelo Leo (assinatura MP comercial2sjsa@gmail.com, ainda sem o pagamento no espelho)", "PATCH", "/api/invoices/in_mur2qr632m", { mpPaymentId: "", paidGateway: "", paidMethod: "cartao", paidProof: { kind: "manual", at: brt("2026-10-02"), method: "cartao", note: `Leo 24/10: 2ª mensalidade paga na assinatura do MP, pagamento ainda não apareceu no espelho · ${BY}`, by: "api", markedAt: NOW } });
await settleWithMirror("Jéssica", "in_mtlmkcaw90", ["mpp_177000703949"], { amount: 1500, note: "Leo: sim; o espelho tem 1.500 (combinado 3.000)" });
await unpay("Everton", "in_mtucdbw40n");
await settleWithMirror("Evolution", "in_mtwwog5d0e", ["mpp_181035273875"], { amount: 1914, note: "Leo: pagou 1.914 semestral" });
await unpay("Danilo", "in_mtx7yd7p06");
await confirmManual("Ricardo", "in_mu4cxk1s06", { at: brt("2026-09-16"), method: "cartao", note: "Leo 24/10: recebido; 4 tentativas recusadas no MP, conta não informada" });
await settleWithMirror("Sara", "in_mu5mlwbz1j", ["mpp_178498665585"], { amount: 3582, note: "Leo: pagou apenas 3.582" });
await unpay("Willian (teste)", "in_mucxifp403");
// GBM Monkey: 8.000 na maquininha (Point 23/09) + 13.528 a parcelar no PIX (nº de parcelas a definir → 1 fatura em aberto)
{
  const i = await inv("in_muekbpbv08"); const p = await pmt("mpp_179560009037");
  if (i.paidProof?.kind === "closing") {
    op("GBM Monkey: entrada 8.000 (maquininha) + restante 13.528 em aberto", "POST", "/api/invoices/in_muekbpbv08/confirm", { at: p.dateApproved, method: "cartao", amount: 8000, note: `Leo 24/10: 8.000 no Mercado Pago (Point) e o restante parcelado no PIX · ${BY}`, remainder: { installments: 1, firstDue: "2026-10-23", method: "pix" } });
    op("GBM Monkey: prova = Point 179560009037 (não dobrar com a baixa manual)", "PATCH", "/api/invoices/in_muekbpbv08", { paidGateway: "mp" }, stampMirrorProof("in_muekbpbv08", [p]));
    op("GBM Monkey: Point → cliente/fatura", "PATCH", `/api/mp_payments/${p.id}`, { customer: i.customer, saas: "leverads", invoice: i.id, matchedBy: "manual", kind: "venda", kindSource: "manual" });
  } else skipped.push("GBM Monkey: já confirmada");
}
// Igor: 4.600 à vista (conta não informada) + 7.080 em 11 parcelas (~643,64; Leo falou "640")
await confirmManual("Igor", "in_muwy64sm32", { at: brt("2026-10-06"), method: "outro", amount: 4600, note: "Leo 24/10: 4.600 à vista (conta não informada) e o resto parcelado em ~640", remainder: { installments: 11, firstDue: "2026-11-06", method: "cartao" } });
await settleWithMirror("Tiago", "in_muydsc7n08", ["mpp_182942721422"], { amount: 9564, note: "Leo: pagou integral no MP (9.564)" });
await settleWithMirror("jg center", "in_muzvqhvw03", ["mpp_182100977357", "mpp_183116864360"], { note: "2 cartões da Vanessa A Silva (2.965 + 2.999) em 08/10" });
await confirmManual("Sidney", "in_mvb2dipk06", { at: brt("2026-10-16"), method: "cartao", amount: 6000, note: "Leo 24/10: pagou 6.000 no MP; não achei no espelho" });
await settleWithMirror("EuNaPeças", "in_mvfbk0vj4t", ["mpp_185032111272"], { note: "cartão da Andreia Contadini (lead le_mvdvkmu910)" });
await settleWithMirror("Betavita", "in_mvi5mguq3u", ["mpp_185334171834", "mpp_185334381476"], { note: "2 cartões: 5.000 Betavita Hospitalar + 4.000 Rublion Nutrition" });
await linkToCustomer("Casa das Louças 539", "mpp_183195421753", "cu_mvff2p4l01");
await linkToCustomer("Storm 3.000", "mpp_174598832697", "cu_mt8q5hq504");
await linkToCustomer("3S 299", "mpp_175064065969", "cu_mtd2l0i80d");

// ── Não pagas ───────────────────────────────────────────────────────────────
await del("Arte Feita", "in_mt1ko5a506", "duplicata: os 2 PIX de 1.600 já baixaram in_mrt9xzow04 e in_msnasedf03");
{ // Arte Feita upsell 4.200 em 7x: entrada 600 (Asaas 15/10) + 6 × 600
  const i = await inv("in_mv86e43l1v"); const p = await pmt("asa_inv_936817137");
  if (i.status !== "paid") {
    op("Arte Feita upsell: entrada 600 + 6 parcelas de 600", "POST", "/api/invoices/in_mv86e43l1v/pay", { at: p.dateApproved, method: "pix", amount: 600, note: `Leo 24/10: parcelou em 7x, entrada de 600 (Asaas) · ${BY}`, remainder: { installments: 6, firstDue: "2026-11-15", method: "pix" } });
    op("Arte Feita upsell: prova = Asaas 936817137", "PATCH", "/api/invoices/in_mv86e43l1v", { mpPaymentId: p.mpId, paidGateway: "asaas", paidMethod: p.method || "pix", paidMethodType: p.methodType || "" });
    op("Arte Feita upsell: Asaas → fatura", "PATCH", "/api/mp_payments/asa_inv_936817137", { invoice: "in_mv86e43l1v", matchedBy: "manual" });
  } else skipped.push("Arte Feita upsell: já paga");
}
await del("Andrea", "in_muh139y80a", "Leo: pagou 1 mês e cancelou o recorrente");
await churn("Andrea", "cu_mt8q2bqa01", { endedAt: "2026-09-25T12:00:00.000Z", reason: "cancelou o recorrente após 1 mês", note: "Leo 24/10" });
await confirmManual("Bueno Prime", "in_muk8ty283i", { at: brt("2026-09-27"), method: "cartao", note: "Leo 24/10: 2ª parcela paga no recorrente, sem rastro no espelho" });
for (const id of ["in_mt3qdvyt26", "in_mt3qdvz327", "in_mt3qdvza28", "in_mt3qdvzh29", "in_mt3qdvzu2a", "in_mt3qdw042b", "in_mt3qdw0d2c", "in_mt3qdw0m2d", "in_mt3qdw0v2e", "in_mt3qdw152f"]) await del("FGL", id, "Leo: pagou 548 (parcelas 1 e 2) e cancelou");
await del("FGL", "in_mtyn4k4001", "fatura de 3.288 duplicava o carnê de 12 × 274 (só 548 recebidos)");
await churn("FGL", "cu_msqbvjt002", { endedAt: "2026-10-12T12:00:00.000Z", reason: "cancelou após pagar 548", note: "Leo 24/10" });
{ // Sergio: 3.900 em 3x; entrada 1.400 (PIX 16/09) + 2 × 1.250
  const i = await inv("in_mu2sj8tu0v"); const p = await pmt("mpp_179342233844");
  if (!i.mpPaymentId) {
    op("Sergio: 333,33 vira entrada 1.400 (PIX 16/09) do plano de 3.900", "PATCH", "/api/invoices/in_mu2sj8tu0v", { amount: 1400, originalAmount: 3900, title: "Entrada · Lever OEM Essencial anual 3.900 em 3x", status: "paid", paidAt: p.dateApproved, mpPaymentId: p.mpId, paidGateway: "mp", paidMethod: p.method, paidMethodType: p.methodType, paidInstallments: 1, paidProof: { kind: "mp", at: p.dateApproved, mpPaymentId: p.mpId, note: `Leo 24/10: parcelou 3.900 em 3x, entrada paga (PIX de 1.400 no MP) · ${BY}` } });
    op("Sergio: PIX → fatura", "PATCH", `/api/mp_payments/${p.id}`, { invoice: "in_mu2sj8tu0v", matchedBy: "manual" });
    await del("Sergio", "in_mv9o3xx601", "mensalidade de 333,33 não existe mais: virou 3x de 1.300");
    for (const [n, due] of [[2, "2026-10-16"], [3, "2026-11-16"]]) op(`Sergio: parcela ${n}/3 de 1.250`, "POST", "/api/invoices", { id: `in_sergio_p0${n}`, customer: i.customer, saas: "leverads", subscription: i.subscription || "", amount: 1250, kind: "installment", status: "open", installmentN: n, installmentOf: 3, title: `Parcela ${n}/3 · PIX parcelado · restante de 3.900`, dueDate: brt(due), entradaOf: "in_mu2sj8tu0v", createdAt: NOW });
  } else skipped.push("Sergio: já ajustado");
}
{ // artmidia: pago integral pela Appmax (12.422); o PIX de 10.400 (18/10) é o repasse líquido da Appmax
  const r = await inv("in_mv9o7lp106"); const pix = await pmt("mpp_183792347453");
  if (!r.mpPaymentId) {
    const apxId = "apx_manual_artmidia_12422", apxMp = "apx-manual-artmidia-12422";
    op("artmidia: venda de 12.422 na Appmax entra no espelho (líquido 10.400)", "POST", "/api/mp_payments", { id: apxId, gateway: "appmax", mpId: apxMp, saas: "leverads", kind: "venda", kindSource: "manual", classV: 1, status: "approved", statusDetail: "accredited", direction: "in", amount: 12422, netAmount: 10400, feeAmount: 2022, method: "credit_card", methodType: "credit_card", installments: 1, customer: r.customer, lead: "le_mv8csor832", invoice: r.id, payerName: "Josiney Navarro · artmidia", payerEmail: "josiney.navarro@icloud.com", dateCreated: r.paidAt, dateApproved: r.paidAt, description: `LeverAds (15 contas) + LeverPrice (6 contas) · Appmax · lançado à mão (Leo 24/10) · ${BY}`, matchedBy: "manual", syncedAt: NOW });
    op("artmidia: fatura do plano paga pela Appmax", "PATCH", "/api/invoices/in_mv9o7lp106", { mpPaymentId: apxMp, paidGateway: "appmax", paidMethod: "credit_card", paidMethodType: "credit_card", paidProof: { kind: "appmax", at: r.paidAt, mpPaymentId: apxMp, note: `Leo 24/10: pagou integral pela Appmax · ${BY}` } });
    op("artmidia: PIX 10.400 de 18/10 = repasse da Appmax (não é venda nova)", "PATCH", "/api/mp_payments/mpp_183792347453", { kind: "interna", kindSource: "manual", finIgnored: true, finIgnoredReason: "repasse da Appmax: venda artmidia 12.422 menos taxas (lançada como apx_manual_artmidia_12422)", customer: "", lead: "", invoice: "", matchedBy: "" });
    await del("artmidia", "in_mv9o9bqo07", "fatura do link do MP duplicava a do plano (in_mv9o7lp106), paga pela Appmax");
  } else skipped.push("artmidia: já ajustado");
}
{ // Matheus: Lever Price anual 9.564; pagou 1.036, falta 8.528
  const i = await inv("in_mvjxf2gu0h");
  if (i.status !== "paid") {
    op("Matheus: fatura vale o plano inteiro (9.564)", "PATCH", "/api/invoices/in_mvjxf2gu0h", { amount: 9564, title: "Lever Price · Essencial · Anual" });
    op("Matheus: entrada 1.036 + restante 8.528 em aberto", "POST", "/api/invoices/in_mvjxf2gu0h/pay", { at: brt("2026-10-22"), method: "outro", amount: 1036, note: `Leo 24/10: pagou 1.036 (conta não informada) e vai pagar o restante · ${BY}`, remainder: { installments: 1, firstDue: "2026-11-22", method: "pix" } });
  } else skipped.push("Matheus: já paga");
}

// ── 2ª rodada de respostas (24/10) ──────────────────────────────────────────
// "Os que não pagaram, pode tirar do painel de clientes": venda desfeita — o card
// volta pro funil (follow-up), faturas/assinatura somem. Willian fica (está em teste).
for (const [label, id] of [["Vernici tintas", "cu_msnqg2n30g"], ["Hemerson", "cu_msz6jqao1x"], ["Marvin parts", "cu_mt0h25ez0b"], ["Everton", "cu_mtucdbv30l"], ["Danilo", "cu_mtx7yd6z04"]]) {
  const c = await cust(id).catch(() => null);
  if (!c) { skipped.push(`${label}: cliente já não existe`); continue; }
  if (label === "Danilo") op("Danilo: PIX 500 da Conecta Importações (11/09) = sinal do Danilo, venda não concluída", "PATCH", "/api/mp_payments/mpp_177532505253", { lead: c.leadId || "", saas: "leverads", matchedBy: "manual", note: `sinal de 500 do Danilo (venda não concluída, cliente removido) · ${BY}` });
  op(`${label}: tirar do painel de clientes (venda desfeita, card volta pro funil)`, "POST", `/api/customers/${id}/revert-win`, {});
}
// Galante: só os 10.000 do PIX de 03/09 entraram — as 4 parcelas baixadas à mão voltam a abertas.
for (const id of ["in_ms0l60ji05", "in_ms0l60gh01", "in_ms0l60kh06", "in_ms0l60h702"]) await unpay("Galante", id);
// Amaral: semestral 6 × 599 (Leo: 3.600); 3 PIX de 599 já no MP (31/07, 04/09, 05/10) + 3 parcelas a receber.
{
  const i = await inv("in_mrxpj3qo04");
  if (i.paidProof?.kind === "closing") {
    const ps = []; for (const id of ["mpp_170483584601", "mpp_177330747858", "mpp_181565479389"]) ps.push(await pmt(id));
    for (const p of ps) if (p.customer || p.invoice) throw new Error(`Amaral: ${p.id} já tem dono`);
    op("Amaral: fatura vale o semestral (3.594 = 6 × 599; combinado antes 8.396)", "PATCH", "/api/invoices/in_mrxpj3qo04", { amount: 3594, title: "Semestral · 6 × 599 (fechamento registrava 8.396)" });
    op("Amaral: 3 × 599 recebidos (PIX no MP) + 3 parcelas de 599 em aberto", "POST", "/api/invoices/in_mrxpj3qo04/confirm", { at: ps[2].dateApproved, method: "pix", amount: 1797, note: `Leo 24/10: 3 PIX de 599 (OX Automotive 31/07 e 05/10, Victor Hugo 04/09) · ${BY}`, remainder: { installments: 3, firstDue: "2026-11-05", method: "pix" } }, stampMirrorProof("in_mrxpj3qo04", ps));
    for (const p of ps) op(`Amaral: PIX ${p.id} (${p.amount}) → cliente/fatura`, "PATCH", `/api/mp_payments/${p.id}`, { customer: i.customer, saas: "leverads", invoice: "in_mrxpj3qo04", matchedBy: "manual" });
  } else skipped.push("Amaral: já confirmada");
}
// Jéssica: cobrar os 1.500 que faltam do semestral de 3.000.
if (!(await api("GET", "/api/invoices/in_jessica_restante").catch(() => null))) op("Jéssica: fatura de 1.500 em aberto (restante do semestral de 3.000)", "POST", "/api/invoices", { id: "in_jessica_restante", customer: "cu_mtlmkca48y", saas: "leverads", subscription: "su_mtlmkcap8z", amount: 1500, kind: "installment", status: "open", installmentN: 2, installmentOf: 2, title: "Parcela 2/2 · restante do OEM avulso semestral (3.000)", dueDate: brt("2026-11-08"), entradaOf: "in_mtlmkcaw90", createdAt: NOW });
else skipped.push("Jéssica: restante já criado");

// ── Saídas de 20/10 pagas com saldo do MP (impostos) ────────────────────────
{
  const existing = new Set((await api("GET", "/api/payables")).map((p) => p.id));
  const mk = (id, amount, description, supplierName, ref, mpId) => existing.has(id) ? skipped.push(`${description}: já lançado`) : op(`Conta a pagar paga pelo MP: ${description} ${amount}`, "POST", "/api/payables", {
    id, saas: "leverads", description, category: "imposto", counterpartyType: "fornecedor", userId: "", supplierName,
    amount, month: "2026-10", dueDate: "2026-10-20", status: "paga", paidAt: brt("2026-10-20"), paidVia: "mp", paidAccount: "mp",
    recurring: false, endMonth: "", templateId: "", notes: `pago com saldo do MP em 20/10 · ref ${ref} · mp ${mpId} · lançado por import-2026-10-24`, createdAt: NOW, source: "extrato",
  });
  mk("pay_mp_20261020_443783", 4437.83, "Simples Nacional (DAS)", "Receita Federal · Simples Nacional", "3028642647", "185162817776");
  mk("pay_mp_20261020_45336", 453.36, "DARF (código de barras)", "Receita Federal · DARF", "3028639300", "185162968604");
}


console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} · ${ops.length} operações · ${skipped.length} puladas`);
for (const o of ops) console.log(`  ${o.method.padEnd(6)} ${o.label}`);
for (const s of skipped) console.log(`  (pulado) ${s}`);
if (APPLY) {
  for (const o of ops) {
    await api(o.method, o.path, o.body);
    if (o.after) await o.after();
  }
  console.log("ok");
}
