// Financeiro da LeverAds · lançamentos de 17/10/2026 a partir dos extratos
// (Asaas, Sicredi, BTG) que o Leo mandou. Roda da RAIZ do repo e fala com a
// PRODUÇÃO pela API (x-api-key do .env), nunca com o banco:
//
//   node packages/api/scripts/2026-10-17-financeiro-leverads.mjs            # dry-run: lista o que faria
//   node packages/api/scripts/2026-10-17-financeiro-leverads.mjs --apply    # aplica
//
// Como funciona: baixa as coleções da produção, monta um repositório em
// memória (o mesmo double dos testes), roda as MESMAS funções do servidor
// (importAsaasRows, settleInvoice, writeFinAccount…) em cima dele e grava um
// diário de criações/alterações. No --apply o diário é replicado na API na
// mesma ordem (POST / PATCH / DELETE genéricos). Idempotente: ids
// determinísticos, e rodar de novo só repete PATCHes iguais.

import fs from "node:fs";
import path from "node:path";
import { makeMemRepo } from "../test/helpers/mem-repo.js";
import { importAsaasRows } from "../src/payments/asaas-payments.js";
import { settleInvoice, rawDialectOf } from "../src/payments/mp-payments.js";
import { writeFinAccount } from "../src/payments/fin-accounts.js";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY;
if (!KEY) throw new Error("COCKPIT_API_KEY ausente");
const H = { "x-api-key": KEY, "content-type": "application/json" };
const SAAS = "leverads";
const BY = "import-2026-10-17";
const NOW = new Date().toISOString();

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: H, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const list = (coll) => api("GET", `/api/${coll}`);

// ── Diário de mutações (o que o --apply replica) ─────────────────────────────
const ops = [];
function shadow(repo) {
  return {
    ...repo,
    async create(name, obj) { ops.push({ op: "create", coll: name, id: obj.id, body: obj }); return repo.create(name, obj); },
    async update(name, id, patch) { ops.push({ op: "update", coll: name, id, body: patch }); return repo.update(name, id, patch); },
    async remove(name, id) { ops.push({ op: "remove", coll: name, id }); return repo.remove(name, id); },
  };
}

// ── Dados: Asaas ─────────────────────────────────────────────────────────────
// Linhas do EXTRATO (Extrato Asaas.pdf, 13/07 a 17/10): valor bruto, taxas
// (boleto/pix/cartão/mensageria) e a data em que caiu. E-mail/telefone vêm do
// cadastro do cliente no cockpit, pra o casamento acontecer pelo ingest.
const EXTRATO = [
  // Andrea: o boleto de 17/08 é a mensalidade de AGOSTO (fatura já paga à mão em
  // 25/08) — a referência evita que ele baixe a de setembro, que segue vencida.
  { invoiceNumber: "883998326", name: "Andrea do Val", phone: "16997509500", billingType: "Boleto", value: 175, fees: 0.99, date: "17/08/2026", externalReference: "in_mt8q2brg03" },
  { invoiceNumber: "883112297", name: "Luciana M G Nascimento", billingType: "Cartão de Crédito", value: 175, fees: 5.27, date: "14/09/2026", status: "Estornada", description: "Chargeback 15/09 e estorno 25/09 (Asaas)" },
  { invoiceNumber: "898209136", name: "Philip", email: "gorayebliger@gmail.com", billingType: "Pix", value: 499, fees: 1.98, date: "15/09/2026" },
  { invoiceNumber: "892517001", name: "USACAR AUTO PECAS", email: "ADMINISTRATIVIO@USACARAUTOPECAS.COM.BR", cpfCnpj: "08799951000184", phone: "47999653557", billingType: "Cartão de Crédito", value: 999, fees: 29.91, date: "28/09/2026", confirmedDate: "25/08/2026", installmentGroup: "imp_usacar", installmentNumber: 1, installmentCount: 12, description: "Parcela 1 de 12." },
  { invoiceNumber: "898847813", name: "Silene Nunes Siqueira", phone: "11985324961", billingType: "Cartão de Crédito", value: 299, fees: 6.44, date: "05/10/2026" },
  { invoiceNumber: "899034605", name: "DANIELA MARTINS", phone: "11987019558", billingType: "Cartão de Crédito", value: 215, fees: 4.76, date: "05/10/2026" },
  { invoiceNumber: "900049933", name: "Wagner Ferreira", email: "wagner8498@bol.com.br", billingType: "Cartão de Crédito", value: 599, fees: 13.40, date: "05/10/2026", description: "Recorrente · no export Cobranças aparece como 900432887" },
  { invoiceNumber: "900986686", name: "Luciano Henrique Vilela de Souza", email: "padil@padil.com.br", cpfCnpj: "49299910000106", billingType: "Cartão de Crédito", value: 300, fees: 6.46, date: "05/10/2026", description: "Recorrente · no export Cobranças aparece como 901451857" },
  { invoiceNumber: "901793640", name: "JOSE DIAS", email: "josediasdsn@gmail.com", cpfCnpj: "41550810839", phone: "11949517425", billingType: "Cartão de Crédito", value: 379, fees: 8.03, date: "06/10/2026", description: "Recorrente · no export Cobranças aparece como 902456446" },
  { invoiceNumber: "931062061", name: "BRESSAN DISTRIBUIDORA DE PECAS E MOTORES LTDA", billingType: "Boleto", value: 4640, fees: 1.98, date: "09/10/2026", description: "NF de serviço nr. 7 emitida em 07/10" },
  { invoiceNumber: "935448365", name: "Phillype", email: "lyype.almeida@gmail.com", billingType: "Boleto", value: 699, fees: 1.98, date: "14/10/2026" },
  { invoiceNumber: "936817137", name: "Cristiano Horcel", email: "cristianohorcel@gmail.com", billingType: "Pix", value: 600, fees: 2.98, date: "15/10/2026" },
];
const extratoRows = EXTRATO.map((r) => ({
  invoiceNumber: r.invoiceNumber, name: r.name, email: r.email || "", cpfCnpj: r.cpfCnpj || "", phone: r.phone || "",
  billingType: r.billingType, status: r.status || "Recebida", dueDate: r.date, paymentDate: r.status === "Estornada" ? "" : r.date,
  confirmedDate: r.confirmedDate || r.date, dateCreated: r.confirmedDate || r.date,
  value: r.value, netValue: Math.round((r.value - r.fees) * 100) / 100, description: r.description || "",
  ...(r.externalReference ? { externalReference: r.externalReference } : {}),
  ...(r.installmentGroup ? { installmentGroup: r.installmentGroup, installmentNumber: r.installmentNumber, installmentCount: r.installmentCount } : {}),
}));

// Export "Cobranças" (xlsx → json): parcelas de cartão de Gilberto (12× 274) e
// USACAR (2 a 12 × 999). Os três recorrentes (Wagner, Luciano, Jose Dias) já
// entram pelo extrato com o nº que o extrato mostra — as linhas do export
// seriam o MESMO dinheiro, então ficam de fora (anotado na planilha).
const exportRows = JSON.parse(fs.readFileSync(path.resolve("packages/api/scripts/data-2026-10-17-asaas-cobrancas.json"), "utf8"))
  .filter((r) => /Parcela \d+ de 12/.test(r.description))
  .map((r) => {
    const m = r.description.match(/Parcela (\d+) de (\d+)/);
    const usacar = /usacar/i.test(r.name);
    return {
      ...r,
      phone: String(r.phone || "").replace(/\.0$/, ""),
      installmentGroup: usacar ? "imp_usacar" : "imp_gilberto",
      installmentNumber: Number(m[1]), installmentCount: Number(m[2]),
      // Cartão parcelado: o Asaas confirma TODAS as parcelas na hora da compra
      // (o crédito é que vem mês a mês) — a venda está paga.
      installmentAllPaid: true,
      paymentDate: r.paymentDate || "", confirmedDate: r.confirmedDate || r.dateCreated,
    };
  });
// A parcela 1 da USACAR veio pelo extrato com o mesmo grupo: fecha 12/12.
for (const r of extratoRows) if (r.installmentGroup) r.installmentAllPaid = true;
const asaasRows = [...extratoRows, ...exportRows];

// Doc do espelho sem dono depois do ingest → cliente que EU identifiquei no
// extrato (nome/telefone sem e-mail no cadastro). Só preenche quem o ingest
// não casou sozinho.
const MANUAL_CUSTOMER = {
  "883998326": "cu_mt8q2bqa01", // Andrea
  "898209136": "cu_mtixglmt01", // Philip
  "898847813": "cu_mtk49jwv47", // Silene
  "899034605": "cu_mtk4bec54a", // Daniela
  "900049933": "cu_mtkdolja4y", // Wagner
  "900986686": "cu_mtlj4kbo8p", // Luciano
  "901793640": "cu_mtmxvec404", // JoséDias
  "935448365": "cu_mtbjq1ap07", // Phillype
  "936817137": "cu_mrt9xf8n02", // Cristiano Horcel → Arte Feita
  "892517001": "cu_msi6ui4z07", // USACAR
};
const USACAR_PARCEL_PREFIX = "8925170";

// ── Dados: Sicredi (extratos ago e set/out) → contas a pagar PAGAS ───────────
const SIC = [
  { d: "2026-08-25", amt: 62.90, desc: "Cesta de relacionamento Sicredi", cat: "bancos", who: { type: "fornecedor", name: "Sicredi" } },
  { d: "2026-08-26", amt: 16.00, desc: "Integralização de capital Sicredi (cota)", cat: "bancos", who: { type: "fornecedor", name: "Sicredi" } },
  { d: "2026-08-28", amt: 798.00, desc: "PIX Vitor de Brito Diniz", cat: "pessoal_com", who: { type: "colaborador", userId: "us_mrqkn2tm03" }, note: "identificar: salário, variável ou reembolso?" },
  { d: "2026-09-01", amt: 6600.00, desc: "PIX Manuela Ribeiro de Aguiar", cat: "pessoal_com", who: { type: "colaborador", userId: "sdr" }, note: "provável salário de agosto (confirmar); o salário de set/26 já está lançado como pago em 17/09" },
  { d: "2026-09-04", amt: 2062.41, desc: "PIX Vitor de Brito Diniz", cat: "pessoal_com", who: { type: "colaborador", userId: "us_mrqkn2tm03" }, note: "identificar: salário, variável ou reembolso?" },
  { d: "2026-09-04", amt: 300.00, desc: "PIX João Gabriel Ferreira", cat: "outros", who: { type: "fornecedor", name: "João Gabriel Ferreira (CPF 112.393.249-28)" }, note: "identificar: quem é e o que foi pago" },
  { d: "2026-09-04", amt: 150.00, desc: "PIX João Gabriel Ferreira", cat: "outros", who: { type: "fornecedor", name: "João Gabriel Ferreira (CPF 112.393.249-28)" }, note: "identificar" },
  { d: "2026-09-08", amt: 138.00, desc: "PIX Vitor Yudi Suyhama", cat: "suporte", who: { type: "colaborador", userId: "us_mu1iysva01" }, note: "identificar: reembolso?" },
  { d: "2026-09-08", amt: 150.00, desc: "PIX João Gabriel Ferreira", cat: "outros", who: { type: "fornecedor", name: "João Gabriel Ferreira (CPF 112.393.249-28)" }, note: "identificar" },
  { d: "2026-09-09", amt: 150.00, desc: "PIX João Gabriel Ferreira", cat: "outros", who: { type: "fornecedor", name: "João Gabriel Ferreira (CPF 112.393.249-28)" }, note: "identificar" },
  { d: "2026-09-09", amt: 2500.00, desc: "PIX GDO TECH", cat: "outros", who: { type: "fornecedor", name: "GDO TECH (CNPJ 61.426.836/0001-47)" }, note: "identificar: fornecedor de quê? categoria" },
  { d: "2026-09-10", amt: 16.00, desc: "Integralização de capital Sicredi (cota)", cat: "bancos", who: { type: "fornecedor", name: "Sicredi" } },
  { d: "2026-09-10", amt: 62.90, desc: "Cesta de relacionamento Sicredi", cat: "bancos", who: { type: "fornecedor", name: "Sicredi" } },
  { d: "2026-09-11", amt: 210.00, desc: "PIX Vitor Yudi Suyhama", cat: "suporte", who: { type: "colaborador", userId: "us_mu1iysva01" }, note: "identificar: reembolso?" },
  { d: "2026-09-14", amt: 1225.50, desc: "PIX Marketplace (Mercado Pago, CNPJ 10.573.521/0001-91)", cat: "outros", who: { type: "fornecedor", name: "Mercado Pago / Mercado Livre" }, note: "identificar: compra no Mercado Livre ou pagamento via MP?" },
  { d: "2026-09-15", amt: 5500.00, desc: "PIX Jessica Siqueira de Li…", cat: "outros", who: { type: "fornecedor", name: "Jessica Siqueira de Li… (CPF 378.795.428-76)" }, note: "identificar: quem é e o que foi pago" },
];
const SIC_FUTURE = [
  { d: "2026-10-13", amt: 2211.32, desc: "Fatura do cartão Sicredi (débito automático)", cat: "outros", who: { type: "fornecedor", name: "Sicredi · cartão" }, note: "lançamento futuro do extrato de 13/10: confirmar se debitou" },
  { d: "2026-10-15", amt: 59.05, desc: "Seguro de vida / prestamista Icatu (débito automático)", cat: "bancos", who: { type: "fornecedor", name: "Icatu Seguros" }, note: "lançamento futuro do extrato de 13/10: confirmar se debitou" },
];
const payableId = (acct, d, amt, i = 0) => `pay_${acct}_${d.replace(/-/g, "")}_${String(Math.round(amt * 100))}${i ? `_${i}` : ""}`;
function payableDoc(x, acct, paid, i) {
  return {
    id: payableId(acct, x.d, x.amt, i), saas: SAAS, description: x.desc, category: x.cat,
    counterpartyType: x.who.type, userId: x.who.type === "colaborador" ? x.who.userId : "", supplierName: x.who.type === "fornecedor" ? x.who.name : "",
    amount: x.amt, month: x.d.slice(0, 7), dueDate: x.d,
    status: paid ? "paga" : "aberta", paidAt: paid ? `${x.d}T12:00:00.000Z` : "", paidVia: paid ? "bank" : "", paidAccount: paid ? acct : "",
    recurring: false, endMonth: "", templateId: "", notes: [x.note || "", `extrato ${acct === "sicredi" ? "Sicredi" : acct} · lançado por ${BY}`].filter(Boolean).join(" · "),
    createdAt: NOW, source: "extrato",
  };
}

// ── Dados: faturas confirmadas pelos extratos do BTG ─────────────────────────
const BTG_CONFIRM = [
  { invoice: "in_muo928c344", at: "2026-09-30T15:00:00.000Z", note: "BTG cc · PIX recebido de SP NEW FENIX (CNPJ 29.998.825/0001-29) em 30/09 · R$ 3.000" },
  { invoice: "in_muwtn12021", at: "2026-10-06T15:00:00.000Z", note: "BTG cc · PIX recebido de BRUNO RIBEIRO DE OLIVEIRA (CPF ***.266.871-**) em 06/10 · R$ 3.000 · confirmar que é o Rafael" },
];

// ── Dados: caixa por conta ───────────────────────────────────────────────────
const ACCOUNTS = [
  { id: "asaas", balance: 1350.10, asOf: "2026-10-17", note: "extrato Asaas 17/10" },
  { id: "sicredi", balance: 58.29, asOf: "2026-10-13", note: "extrato 13/10 · entrou aporte de 20.000 de Bianca Pilato em 25/08 (aporte ou empréstimo?)" },
  { id: "btg_cc", balance: 6000.15, asOf: "2026-10-13", note: "extrato 13/10 · saldo aplicado na conta remunerada" },
  { id: "btg_inv", balance: 186919.70, asOf: "2026-10-13", note: "app BTG 13/10: 54.000 na conta investimento + 132.919,70 investido (CDBs)" },
];

// ── Mercado Pago: PIX vindos da conta do Asaas = transferência interna ──────
const MP_INTERNA = ["mpp_177390946897", "mpp_182976194743"];

async function main() {
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} em ${BASE}`);

  // 0. Phillype: boleto em 12 parcelas de 699. O PATCH no lead faz o servidor
  // gerar o cronograma (syncWonLeadDeal) — por isso vai DIRETO na API antes
  // do resto, e as faturas são relidas em seguida.
  const lead = await api("GET", "/api/leads/le_mta4sso440");
  if (lead && (lead.paymentMethod !== "boleto" || Number(lead.paymentInstallments) !== 12)) {
    console.log("· Phillype: lead → boleto 12x (gera as parcelas 2 a 12)");
    if (APPLY) await api("PATCH", "/api/leads/le_mta4sso440", { paymentMethod: "boleto", paymentInstallments: 12 });
  } else console.log("· Phillype: lead já está boleto 12x");

  // 1. Produção → memória.
  const colls = ["products", "customers", "leads", "invoices", "subscriptions", "mp_payments", "payment_links", "fin_rules", "payables", "app_config", "mp_preapprovals"];
  const repo = makeMemRepo();
  for (const c of colls) {
    const rows = await list(c);
    for (const r of rows) await repo.create(c, r);
    console.log(`  ${c}: ${rows.length}`);
  }
  const sh = shadow(repo);

  // 2. Asaas → espelho (as mesmas funções do servidor).
  const imp = await importAsaasRows(sh, asaasRows, { log: { info() {}, warn() {}, error() {} } });
  console.log(`· Asaas: ${imp.created} criados, ${imp.updated} atualizados, ${imp.matched} casados, ${imp.settled} faturas baixadas, ${imp.errors.length} erros`, imp.errors.length ? imp.errors : "");
  // Vínculo manual do que ficou sem dono.
  for (const [nr, cust] of Object.entries(MANUAL_CUSTOMER)) {
    const d = await repo.get("mp_payments", `asa_inv_${nr}`);
    if (d && !d.customer && !d.lead) {
      const c = await repo.get("customers", cust);
      await sh.update("mp_payments", d.id, { customer: cust, saas: c?.saas || SAAS, matchedBy: "manual" });
    }
  }
  for (const d of await repo.list("mp_payments")) {
    if (d.gateway === "asaas" && String(d.invoiceNumber || "").startsWith(USACAR_PARCEL_PREFIX) && !d.customer) {
      await sh.update("mp_payments", d.id, { customer: "cu_msi6ui4z07", saas: SAAS, matchedBy: "manual" });
    }
  }
  // Phillype: parcela mais antiga em aberto de 699 recebe o boleto de 14/10
  // (o ingest não baixa sozinho porque há 11 parcelas iguais em aberto).
  const phi = await repo.get("mp_payments", "asa_inv_935448365");
  if (phi && !phi.invoice) {
    const cand = (await repo.list("invoices")).filter((i) => i.customer === "cu_mtbjq1ap07" && (i.status === "open" || i.status === "overdue") && Math.abs(Number(i.amount) - 699) < 0.01)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    if (cand.length) {
      await settleInvoice(sh, cand[0], rawDialectOf(phi), { gateway: "asaas" });
      await sh.update("mp_payments", phi.id, { invoice: cand[0].id, customer: "cu_mtbjq1ap07", saas: SAAS });
      console.log(`· Phillype: boleto 699 de 14/10 baixa a parcela ${cand[0].id} (venc. ${String(cand[0].dueDate).slice(0, 10)})`);
    } else console.log("· Phillype: nenhuma parcela de 699 em aberto ainda (rode de novo depois do PATCH do lead)");
  }
  // USACAR: a fatura presumida (5.994, semestral) ganha a prova do cartão 12× 999
  // confirmado em 25/08 — valores diferentes, então a prova entra à mão.
  const usacarInv = await repo.get("invoices", "in_msidpvqz02");
  if (usacarInv && usacarInv.paidProof?.kind === "closing") {
    const p1 = await repo.get("mp_payments", "asa_inv_892517001");
    await sh.update("invoices", usacarInv.id, {
      mpPaymentId: p1?.mpId || "inv_892517001", paidGateway: "asaas", paidMethod: "credit_card", paidMethodType: "credit_card", paidInstallments: 12,
      paidProof: { kind: "asaas", at: "2026-08-25T15:00:00.000Z", mpPaymentId: p1?.mpId || "inv_892517001", confirmedFrom: "closing", note: "Asaas · cartão 12× 999 confirmado em 25/08 (total 11.988; fatura do fechamento era 5.994)", by: BY },
    });
    if (p1) await sh.update("mp_payments", p1.id, { invoice: usacarInv.id });
    console.log("· USACAR: fatura presumida 5.994 confirmada pelo cartão 12× 999 do Asaas");
  }

  // 3. Mercado Pago: transferências vindas do Asaas → interna (e desconsiderada,
  // pra valer também antes do deploy que respeita kindSource manual).
  for (const id of MP_INTERNA) {
    const d = await repo.get("mp_payments", id);
    if (d && (d.kind !== "interna" || !d.finIgnored)) {
      await sh.update("mp_payments", id, { kind: "interna", direction: "in", kindSource: "manual", finIgnored: true, finIgnoredReason: "transferência interna (Asaas → MP)" });
    }
  }

  // 4. Faturas presumidas confirmadas pelo extrato do BTG.
  for (const c of BTG_CONFIRM) {
    const inv = await repo.get("invoices", c.invoice);
    if (inv && inv.status === "paid" && (inv.paidProof?.kind === "closing" || !inv.paidProof)) {
      await sh.update("invoices", inv.id, { paidMethod: "pix", paidProof: { kind: "manual", at: c.at, method: "pix", note: c.note, by: BY, markedAt: NOW, confirmedFrom: "closing" } });
    }
  }

  // 5. Saídas do Sicredi → contas a pagar.
  const existing = new Set((await repo.list("payables")).map((p) => p.id));
  const seen = {};
  for (const x of SIC) {
    const k = payableId("sicredi", x.d, x.amt); seen[k] = (seen[k] || 0) + 1;
    const doc = payableDoc(x, "sicredi", true, seen[k] - 1);
    if (!existing.has(doc.id)) await sh.create("payables", doc);
  }
  for (const x of SIC_FUTURE) {
    const doc = payableDoc(x, "sicredi", false, 0);
    if (!existing.has(doc.id)) await sh.create("payables", doc);
  }
  // Tarifas recorrentes do Sicredi daqui pra frente (template a partir de out/26).
  for (const t of [{ id: "pa_sicredi_cesta", desc: "Cesta de relacionamento Sicredi", amt: 62.90, day: "10" }, { id: "pa_sicredi_capital", desc: "Integralização de capital Sicredi (cota)", amt: 16.00, day: "10" }]) {
    if (!existing.has(t.id)) {
      await sh.create("payables", { id: t.id, saas: SAAS, description: t.desc, category: "bancos", counterpartyType: "fornecedor", userId: "", supplierName: "Sicredi", amount: t.amt, month: "2026-10", dueDate: `2026-10-${t.day}`, status: "aberta", paidAt: "", paidVia: "", recurring: true, endMonth: "", templateId: "", notes: `recorrente mensal · lançado por ${BY}`, createdAt: NOW });
    }
  }

  // 6. Caixa por conta.
  for (const a of ACCOUNTS) await writeFinAccount(sh, a.id, { balance: a.balance, asOf: a.asOf, note: a.note, source: "import", updatedBy: BY });

  // 7. Cliente "Whatsapp" é o Gilberto (Auto Elétrica Luminosa).
  const giba = await repo.get("customers", "cu_mu5jekzl0q");
  if (giba && /^whatsapp$/i.test(giba.name || "")) await sh.update("customers", giba.id, { name: "Auto Elétrica Luminosa · Gilberto" });

  // ── Diário ──────────────────────────────────────────────────────────────
  // Consolida vários updates no mesmo doc num PATCH só (ordem preservada).
  const merged = [];
  for (const o of ops) {
    if (o.op !== "update") { merged.push(o); continue; }
    const last = merged[merged.length - 1];
    if (last && last.op === "update" && last.coll === o.coll && last.id === o.id) Object.assign(last.body, o.body);
    else merged.push({ ...o, body: { ...o.body } });
  }
  const byColl = {};
  for (const o of merged) { byColl[o.coll] = byColl[o.coll] || { create: 0, update: 0, remove: 0 }; byColl[o.coll][o.op]++; }
  console.log("\n· Diário:", JSON.stringify(byColl));
  const brief = (o) => {
    const b = o.body || {};
    if (o.coll === "mp_payments") return `${o.op} ${o.id} ${b.status || ""} ${b.amount != null ? `R$ ${b.amount}` : ""} ${b.customer ? `→ ${b.customer}` : ""} ${b.invoice ? `fatura ${b.invoice}` : ""} ${b.kind === "interna" ? "INTERNA" : ""}`.replace(/\s+/g, " ").trim();
    if (o.coll === "invoices") return `${o.op} ${o.id} ${b.status || ""} prova=${b.paidProof?.kind || ""}${b.paidProof?.confirmedFrom ? " (confirma presumida)" : ""} ${b.mpPaymentId ? `pgto ${b.mpPaymentId}` : ""}`.replace(/\s+/g, " ").trim();
    if (o.coll === "payables") return `${o.op} ${o.id} ${b.description || ""} R$ ${b.amount} ${b.status || ""}`;
    return `${o.op} ${o.id} ${Object.keys(b).join(",")}`;
  };
  for (const o of merged) console.log("   ", brief(o));

  if (!APPLY) { console.log("\n(dry-run: nada gravado; rode com --apply)"); return; }

  // ── Replica na produção ─────────────────────────────────────────────────
  let ok = 0, fail = 0;
  for (const o of merged) {
    try {
      if (o.op === "create") await api("POST", `/api/${o.coll}`, o.body);
      else if (o.op === "update") await api("PATCH", `/api/${o.coll}/${encodeURIComponent(o.id)}`, o.body);
      else await api("DELETE", `/api/${o.coll}/${encodeURIComponent(o.id)}`);
      ok++;
    } catch (e) { fail++; console.error("  FALHOU", brief(o), e.message); }
  }
  console.log(`\n· Aplicado: ${ok} ok, ${fail} falhas`);
}

main().catch((e) => { console.error(e); process.exit(1); });
