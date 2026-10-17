// Extrato da conta do Mercado Pago (4 CSVs account_statement-*.csv, 16/07 a
// 16/10/2026) → cockpit, pela API de produção (x-api-key do .env). Mesmo
// desenho do 2026-10-17-financeiro-leverads.mjs: repositório em memória,
// funções do servidor, diário replicado no --apply.
//
// O que o extrato traz que a API do MP não dava:
//   · NOME de quem pagou nos PIX recebidos (o /v1/payments vem mascarado)
//   · as SAÍDAS da conta: salários/pró-labore por PIX, fornecedores, QR Pix
//     de viagem, saques pro BTG (interna), transferências pra Unique (entre
//     empresas) e a reserva (POTS) — o settlement report não mostra saque
//   · o saldo disponível (18.608,57 em 16/10) e a reserva (119.409,31)
//
//   node packages/api/scripts/2026-10-17-extrato-mercadopago.mjs [--apply]

import fs from "node:fs";
import { makeMemRepo } from "../test/helpers/mem-repo.js";
import { settleInvoice, rawDialectOf } from "../src/payments/mp-payments.js";
import { writeFinAccount } from "../src/payments/fin-accounts.js";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.COCKPIT_URL || "https://levermoney.com.br";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const KEY = process.env.COCKPIT_API_KEY || env.COCKPIT_API_KEY;
const SAAS = "leverads", BY = "import-2026-10-17-mp", NOW = new Date().toISOString();
async function api(method, p, body) {
  const headers = body !== undefined ? { "x-api-key": KEY, "content-type": "application/json" } : { "x-api-key": KEY };
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${p} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const ops = [];
const shadow = (repo) => ({
  ...repo,
  async create(n, o) { ops.push({ op: "create", coll: n, id: o.id, body: o }); return repo.create(n, o); },
  async update(n, id, patch) { ops.push({ op: "update", coll: n, id, body: patch }); return repo.update(n, id, patch); },
  async remove(n, id) { ops.push({ op: "remove", coll: n, id }); return repo.remove(n, id); },
});

// ── Extrato ──────────────────────────────────────────────────────────────────
const num = (s) => Number(String(s).replace(/\./g, "").replace(",", "."));
const rows = [];
for (const f of fs.readdirSync(`${process.env.HOME}/Downloads`).filter((x) => /^account_statement-.*\.csv$/.test(x))) {
  const lines = fs.readFileSync(`${process.env.HOME}/Downloads/${f}`, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  for (const l of lines.slice(4)) {
    const p = l.split(";");
    if (p.length < 5 || !/^\d{2}-\d{2}-\d{4}$/.test(p[0])) continue;
    rows.push({ date: `${p[0].slice(6, 10)}-${p[0].slice(3, 5)}-${p[0].slice(0, 2)}`, type: p[1].trim(), ref: p[2].trim(), amount: num(p[3]) });
  }
}
rows.sort((a, b) => a.date.localeCompare(b.date));
console.log(`extrato MP: ${rows.length} linhas`);

// ── Entradas: quem pagou + o que é interno ───────────────────────────────────
// PIX da própria casa (Unique = empresa irmã do Leo; o próprio Leo): interna.
const INTERNA = {
  "168252430009": "transferência interna (Unique Presentes → MP)",
  "172509451154": "transferência interna (Unique Comercial → MP)",
  "171606316131": "aporte do sócio (Leonardo → MP)",
};
// Pendências que o nome do pagador resolve (cliente; fatura quando é a certa).
const LINK = {
  "170495695047": { customer: "cu_mrxt83pl01" },                       // GROUP VINAR 1.188 → VINAR (o que é? planilha)
  "175938885880": { customer: "cu_mtbwufsm01", invoice: "in_mtbwufuf03" }, // LARISSA 379 (27/08) → mensalidade de agosto
  "177088114268": { customer: "cu_mry3y7ra02", settle: "in_ms0l60hz03" },  // PAULO CESAR GALANTE 10.000 (03/09) → parcela de 23/09
  "179342233844": { customer: "cu_mu2sj8su0t" },                       // SERGIO AUTO PECAS 1.400 → Sergio
  "180664332932": { customer: "cu_mtixglmt01" },                       // 1ST SHOP 3.000 → Philip (mesmo pagador dos 3.500)
};

// ── Saídas: classificação por nome ───────────────────────────────────────────
const USERS = [
  [/vitor de brito/i, { user: "us_mrqkn2tm03", cat: "pessoal_com", desc: "PIX Vitor de Brito Diniz" }],
  [/manuela ribeiro/i, { user: "sdr", cat: "pessoal_com", desc: "PIX Manuela Ribeiro de Aguiar" }],
  [/igor fonseca/i, { user: "igor", cat: "pessoal_com", desc: "PIX Igor Fonseca Santos" }],
  [/vitor yudi/i, { user: "us_mu1iysva01", cat: "suporte", desc: "PIX Vitor Yudi Suyhama" }],
  [/jonan arendt/i, { user: "jonan", cat: "pessoal_adm", desc: "PIX Jonan Arendt Gerowski", note: "identificar (reembolso?)" }],
  [/laura toczek/i, { user: "us_mu716z8r06", cat: "pessoal_adm", desc: "PIX Laura Toczek Teixeira", note: "identificar (reembolso?)" }],
  [/victoria ferreira/i, { user: "us_mub7ngvr1c", cat: "pessoal_adm", desc: "PIX Victoria Ferreira Olsen", note: "identificar (reembolso?)" }],
  [/leonardo de freitas parra/i, { user: "leonardo", cat: "prolabore", desc: "Pró-labore Leonardo" }],
  [/eryk marcelo/i, { user: "eryk", cat: "prolabore", desc: "Pró-labore Eryk" }],
  [/bianca pilato/i, { user: "us_mtu9n76e04", cat: "prolabore", desc: "Pró-labore Bianca" }],
];
const SUPPLIERS = [
  [/joao gabriel ferreira/i, { cat: "outros", name: "João Gabriel Ferreira Dalmolin", note: "identificar: quem é e o que faz (recebe toda semana)" }],
  [/lilliam da rocha/i, { cat: "outros", name: "Lilliam da Rocha", note: "identificar (350/mês)" }],
  [/rodrigo gomes/i, { cat: "outros", name: "Rodrigo Gomes de Almeida", note: "identificar" }],
  [/sizanoski/i, { cat: "outros", name: "Jose Antonio Sizanoski (CNPJ 60.363.610)", note: "identificar" }],
  [/ponto design/i, { cat: "outros", name: "Ponto Design Indústria e Comércio de Confecções", note: "identificar (uniformes?)" }],
  [/cassio luiz kienen/i, { cat: "outros", name: "Cassio Luiz Kienen", note: "identificar: 10.600 em 05/10" }],
  [/stratuz/i, { cat: "outros", name: "Stratuz", note: "identificar: 10.000 em 13/10" }],
  [/sul consultoria/i, { cat: "mkt", name: "Sul Consultoria e Marketing", note: "identificar: marketing?" }],
  [/le angus/i, { cat: "outros", name: "Le Angus", note: "identificar" }],
  [/ep solucoes/i, { cat: "outros", name: "EP Soluções Digitais", note: "identificar" }],
  [/lucas cardoso fumagalli|carlos andre sousa|gabriela maciel|valdir pinto/i, { cat: "outros", name: "PIX avulso (pessoa física)", note: "identificar" }],
  [/victor kainan|jonas niciak/i, { cat: "outros", name: "PIX 1.000 (03/09)", note: "identificar: Victor Kainan / Jonas Niciak" }],
  [/gdo tech/i, { cat: "outros", name: "GDO TECH", note: "identificar · também saiu 2.500 pelo Sicredi em 09/09 (pagou 2x?)" }],
  [/aba consultoria/i, { cat: "pessoal_adm", name: "Aba Consultoria em Saúde e Segurança do Trabalho", note: "medicina do trabalho (40/mês)" }],
  [/anthropic/i, { cat: "apis", name: "Anthropic (Claude)" }],
  [/google cloud/i, { cat: "infra", name: "Google Cloud" }],
  [/nucleo de informacao.*ponto br/i, { cat: "infra", name: "Registro.br (domínio)" }],
  [/sympla/i, { cat: "mkt", name: "Sympla (evento)" }],
  [/demerge/i, { cat: "outros", name: "Demerge Brasil (facilitadora de pagamentos)", note: "identificar" }],
  [/cw technology/i, { cat: "outros", name: "CW Technology", note: "identificar" }],
  [/zig tecnologia/i, { cat: "outros", name: "Zig (consumo em evento)" }],
  [/salvy/i, { cat: "outros", name: "Salvy", note: "identificar" }],
  [/pichau/i, { cat: "escritorio", name: "Pichau Informática (equipamento, 3 parcelas)" }],
  [/mercado libre/i, { cat: "escritorio", name: "Mercado Livre (compra)", note: "identificar o que foi comprado" }],
  [/inpi|propriedade industrial/i, { cat: "contab", name: "INPI (registro de marca)" }],
  [/darf/i, { cat: "imposto", name: "DARF" }],
  [/caixa economica/i, { cat: "imposto", name: "Caixa Econômica (FGTS?)", note: "confirmar: FGTS?" }],
  [/luis marcelo franca/i, { cat: "outros", name: "Luis Marcelo França (conta 40140166)", note: "identificar" }],
  [/^Pagamento MERCADO PAGO INSTITUICAO/i, { cat: "taxas", name: "Mercado Pago (maquininha Point)", note: "bonificação de 249,90 voltou em 23/09" }],
];
const TRAVEL = /restaurante|lanch|posto|estacionamento|park|valet|hotel|hotelaria|panificadora|padaria|emporio|ifood|churrascaria|pizzaria|rodosnack|gastro|alimentos|odair neumann|lumen comercio|distribuicao|celulares|dupra|salvy|aeroporto|paris imoveis|pasticcio/i;
const SKIP = /^(Dinheiro reservado|Dinheiro retirado|Dinheiro retido|Compra de Meli|Liberação de dinheiro|Reembolso)|Pix enviado Lever Ads|Pix enviado Unique Presentes|FACEBOOK SERVICOS|Pagamento com código QR Pix - Cancelado/i;

function classifyOut(r) {
  const t = r.type;
  if (SKIP.test(t)) return null;
  for (const [re, u] of USERS) if (re.test(t)) return { kind: "user", ...u };
  for (const [re, s] of SUPPLIERS) if (re.test(t)) return { kind: "supplier", ...s };
  if (/^Pagamento com (QR )?Pix/i.test(t) && TRAVEL.test(t)) return { kind: "travel" };
  return { kind: "supplier", cat: "outros", name: t.replace(/^Pix enviado |^Pagamento com (QR )?Pix |^Pagamento de conta |^Pagamento /i, "").trim(), note: "identificar" };
}
const payId = (d, amt, i = 0) => `pay_mp_${d.replace(/-/g, "")}_${Math.round(Math.abs(amt) * 100)}${i ? `_${i}` : ""}`;

async function main() {
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} em ${BASE}`);
  const repo = makeMemRepo();
  for (const c of ["products", "customers", "invoices", "subscriptions", "mp_payments", "payables", "app_config", "fin_rules"]) {
    const list = await api("GET", `/api/${c}`);
    for (const r of list) await repo.create(c, r);
  }
  const sh = shadow(repo);
  const mpById = new Map((await repo.list("mp_payments")).filter((p) => p.mpId).map((p) => [String(p.mpId), p]));

  // 1. Entradas: nome do pagador + interna + vínculos.
  let named = 0;
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const m = r.type.match(/^(?:Pix recebido|Pagamento com Código QR Pix)\s+(.+)$/i);
    const p = mpById.get(r.ref);
    if (!m || !p) continue;
    const name = m[1].replace(/^\d{2}\.\d{3}\.\d{3}\s+/, "").trim();
    const patch = {};
    if (!p.payerName) { patch.payerName = name; named++; }
    if (INTERNA[r.ref] && (p.kind !== "interna" || !p.finIgnored)) Object.assign(patch, { kind: "interna", direction: "in", kindSource: "manual", finIgnored: true, finIgnoredReason: INTERNA[r.ref] });
    const l = LINK[r.ref];
    if (l && !p.customer) {
      const c = await repo.get("customers", l.customer);
      Object.assign(patch, { customer: l.customer, saas: c?.saas || SAAS, matchedBy: "manual", lead: "" });
      if (l.invoice) {
        patch.invoice = l.invoice;
        const inv = await repo.get("invoices", l.invoice);
        if (inv && inv.status === "paid" && !inv.mpPaymentId) {
          await sh.update("invoices", inv.id, { mpPaymentId: p.mpId, paidGateway: "mp", paidMethod: p.method || "pix", paidMethodType: p.methodType || "bank_transfer", paidProof: { kind: "mp", at: p.dateApproved || inv.paidAt, mpPaymentId: p.mpId, confirmedFrom: inv.paidProof?.kind || "manual_legacy", by: BY } });
        }
      }
      if (l.settle) {
        const inv = await repo.get("invoices", l.settle);
        if (inv && inv.status !== "paid") { await settleInvoice(sh, inv, rawDialectOf(p), { gateway: "mp" }); patch.invoice = inv.id; }
      }
    }
    if (Object.keys(patch).length) await sh.update("mp_payments", p.id, patch);
  }
  console.log(`· entradas: ${named} pagadores nomeados, ${Object.keys(INTERNA).length} internas, ${Object.keys(LINK).length} vínculos`);

  // 2. Saídas → contas a pagar pagas pelo MP.
  const existing = new Set((await repo.list("payables")).map((p) => p.id));
  const travel = {}; const seen = {}; let created = 0, skipped = 0;
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const c = classifyOut(r);
    if (!c) { skipped++; continue; }
    if (c.kind === "travel") { const k = r.date.slice(0, 7); (travel[k] = travel[k] || []).push(r); continue; }
    const base = payId(r.date, r.amount); seen[base] = (seen[base] || 0) + 1;
    const id = payId(r.date, r.amount, seen[base] - 1);
    if (existing.has(id)) continue;
    await sh.create("payables", {
      id, saas: SAAS, description: c.kind === "user" ? c.desc : (c.name || r.type), category: c.cat,
      counterpartyType: c.kind === "user" ? "colaborador" : "fornecedor", userId: c.kind === "user" ? c.user : "", supplierName: c.kind === "user" ? "" : (c.name || ""),
      amount: Math.abs(r.amount), month: r.date.slice(0, 7), dueDate: r.date, status: "paga", paidAt: `${r.date}T12:00:00.000Z`, paidVia: "mp", paidAccount: "mp",
      recurring: false, endMonth: "", templateId: "", notes: [c.note || "", `extrato MP · ${r.type.slice(0, 80)} · ref ${r.ref} · lançado por ${BY}`].filter(Boolean).join(" · "), createdAt: NOW, source: "extrato",
    });
    created++;
  }
  for (const [month, list] of Object.entries(travel)) {
    const id = `pay_mp_viagens_${month}`;
    if (existing.has(id)) continue;
    const total = Math.round(list.reduce((a, r) => a + Math.abs(r.amount), 0) * 100) / 100;
    const last = list.map((r) => r.date).sort().pop();
    await sh.create("payables", {
      id, saas: SAAS, description: `Viagens, alimentação e deslocamento (QR Pix · ${list.length} lançamentos)`, category: "outros",
      counterpartyType: "fornecedor", userId: "", supplierName: "diversos (restaurantes, hotéis, postos, estacionamentos)",
      amount: total, month, dueDate: last, status: "paga", paidAt: `${last}T12:00:00.000Z`, paidVia: "mp", paidAccount: "mp",
      recurring: false, endMonth: "", templateId: "", notes: list.map((r) => `${r.date.slice(8)}/${r.date.slice(5, 7)} ${Math.abs(r.amount).toFixed(2)} ${r.type.replace(/^Pagamento com (QR )?Pix /i, "").slice(0, 40)}`).join(" | ").slice(0, 1500) + ` · lançado por ${BY}`, createdAt: NOW, source: "extrato",
    });
    created++;
  }
  console.log(`· saídas: ${created} contas a pagar criadas, ${skipped} linhas internas/puladas (reserva, saques pro BTG, Unique, Facebook, estornos)`);

  // 3. Caixa: saldo disponível e reserva no fim do extrato (16/10).
  const reservado = rows.filter((r) => r.type.startsWith("Dinheiro reservado")).reduce((a, r) => a - r.amount, 0);
  const retirado = rows.filter((r) => r.type.startsWith("Dinheiro retirado")).reduce((a, r) => a + r.amount, 0);
  const reserva = Math.round((reservado - retirado) * 100) / 100;
  await writeFinAccount(sh, "mp", { balance: 18608.57, asOf: "2026-10-16", note: "saldo final do extrato de 01 a 16/10", source: "import", updatedBy: BY });
  await writeFinAccount(sh, "mp_reserva", { balance: reserva, asOf: "2026-10-16", note: "reservado − retirado nos extratos de 16/07 a 16/10 (Caixa + Cofrinho ML)", source: "import", updatedBy: BY });
  console.log(`· caixa MP: disponível 18.608,57 · reserva ${reserva.toFixed(2)}`);

  const merged = [];
  for (const o of ops) {
    const last = merged[merged.length - 1];
    if (o.op === "update" && last && last.op === "update" && last.coll === o.coll && last.id === o.id) Object.assign(last.body, o.body);
    else merged.push({ ...o, body: o.body ? { ...o.body } : undefined });
  }
  const byColl = {};
  for (const o of merged) { byColl[o.coll] = byColl[o.coll] || { create: 0, update: 0, remove: 0 }; byColl[o.coll][o.op]++; }
  console.log("· Diário:", JSON.stringify(byColl));
  for (const o of merged.filter((x) => x.coll === "payables")) console.log(`    ${o.body.month} ${String(o.body.amount).padStart(10)} ${o.body.description} [${o.body.category}]`);
  for (const o of merged.filter((x) => x.coll !== "payables" && x.coll !== "mp_payments")) console.log(`    ${o.op} ${o.coll}/${o.id} ${Object.keys(o.body || {}).join(",")}`);
  const sumPay = merged.filter((x) => x.coll === "payables").reduce((a, x) => a + x.body.amount, 0);
  console.log(`· total das contas a pagar criadas: R$ ${sumPay.toFixed(2)}`);
  if (!APPLY) { console.log("(dry-run)"); return; }
  let ok = 0, fail = 0;
  for (const o of merged) {
    try {
      if (o.op === "create") await api("POST", `/api/${o.coll}`, o.body);
      else if (o.op === "update") await api("PATCH", `/api/${o.coll}/${encodeURIComponent(o.id)}`, o.body);
      else await api("DELETE", `/api/${o.coll}/${encodeURIComponent(o.id)}`);
      ok++;
    } catch (e) { fail++; console.error("  FALHOU", o.op, o.coll, o.id, e.message); }
  }
  console.log(`· Aplicado: ${ok} ok, ${fail} falhas`);
}
main().catch((e) => { console.error(e); process.exit(1); });
