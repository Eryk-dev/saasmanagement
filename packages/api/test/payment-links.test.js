// Histórico de links de pagamento: recibo por geração (card do lead, ficha do
// cliente ou tela) + status derivado do espelho do Mercado Pago.
//
// Cobre: gravação do recibo nas 3 portas, casamento por referência e por
// entidade (pagamento que casou pelo e-mail), link substituído ao gerar de novo,
// pagamento anterior ao link não conta, backfill idempotente, baixa manual
// (precedência, rotas pay/unpay) e o histórico agrupado por cliente com saldo
// (filtro de período por dia BRT e por vendedor).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, ensureDefaultAdmins, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { enrichPaymentLinks, backfillPaymentLinks, groupPaymentLinks, filterPaymentLinks, validateManualPaid } = await import("../src/payment-links.js");

// fetch fake do MP: qualquer preference criada devolve o mesmo init_point.
function buildApp(repo) {
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/checkout/preferences" && (init.method || "GET") === "POST") {
      return { status: 200, text: async () => JSON.stringify({ id: "pref_1", init_point: "https://mp.com/pay/pref_1" }) };
    }
    return { status: 404, text: async () => JSON.stringify({ error: `no fake for ${path}` }) };
  };
  const app = Fastify();
  registerRoutes(app, repo, { mp: makeMp({ fetch, accessToken: "test-token" }) });
  return app;
}

const payment = (over = {}) => ({
  id: `mpp_${over.mpId || "1"}`, mpId: String(over.mpId || "1"), status: "approved",
  amount: 1000, externalReference: "", lead: "", customer: "", invoice: "",
  method: "pix", methodType: "bank_transfer", installments: 1, payerName: "Fulano",
  dateCreated: "2026-08-10T12:00:00.000Z", dateApproved: "2026-08-10T12:01:00.000Z", ...over,
});
const link = (over = {}) => ({
  id: "pl_1", saas: "leverads", kind: "lead", origin: "card", lead: "le_1", customer: "", invoice: "",
  targetName: "Padaria do Zé", amount: 1000, reference: "le_1",
  createdAt: "2026-08-10T10:00:00.000Z", ...over,
});

test("link do card do lead vira recibo no histórico (valor, alvo, origem, quem gerou)", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Padaria do Zé", phone: "11999999999", email: "ze@padaria.com" });
  const app = buildApp(repo);

  const res = await app.inject({
    method: "POST", url: "/api/leads/le_1/mp/link",
    payload: { amount: 1900, plan: "semestral", product: "parcialA", title: "LeverAds · Plano Semestral" },
  });
  assert.equal(res.statusCode, 200);

  const [rec] = await repo.list("payment_links");
  assert.equal(rec.kind, "lead");
  assert.equal(rec.origin, "card");           // default do card; a tela manda origin:"tela"
  assert.equal(rec.lead, "le_1");
  assert.equal(rec.targetName, "Padaria do Zé");
  assert.equal(rec.targetPhone, "11999999999");
  assert.equal(rec.amount, 1900);
  assert.equal(rec.reference, "le_1");        // é por ela que o pagamento volta casado
  assert.equal(rec.url, "https://mp.com/pay/pref_1");
  assert.equal(rec.plan, "semestral");
  assert.equal(rec.product, "parcialA");
  assert.equal(rec.payerEmail, "ze@padaria.com");
});

test("gerar de novo pela tela guarda os DOIS links, com a origem de cada um", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Padaria do Zé" });
  const app = buildApp(repo);

  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 500 } });
  await app.inject({ method: "POST", url: "/api/leads/le_1/mp/link", payload: { amount: 900, origin: "tela" } });

  const recs = await repo.list("payment_links");
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.origin).sort(), ["card", "tela"]);
  assert.deepEqual(recs.map((r) => r.amount).sort((a, b) => a - b), [500, 900]);
});

test("cobrança avulsa do cliente e link de fatura também entram no histórico", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Cliente Real", email: "cli@x.com", phone: "1188" });
  const app = buildApp(repo);

  const charge = await app.inject({ method: "POST", url: "/api/customers/cu_1/charge", payload: { amount: 300, title: "Setup" } });
  assert.equal(charge.statusCode, 200);
  const invoiceId = charge.json().invoice.id;

  const inv = await repo.create("invoices", { customer: "cu_1", saas: "leverads", amount: 700, status: "open", kind: "renewal" });
  const fromInvoice = await app.inject({ method: "POST", url: `/api/invoices/${inv.id}/mp/link`, payload: {} });
  assert.equal(fromInvoice.statusCode, 200);

  const recs = await repo.list("payment_links");
  const avulsa = recs.find((r) => r.invoice === invoiceId);
  const fatura = recs.find((r) => r.invoice === inv.id);
  assert.equal(avulsa.kind, "customer");
  assert.equal(avulsa.origin, "cliente");
  assert.equal(avulsa.targetName, "Cliente Real");
  assert.equal(avulsa.reference, invoiceId);  // a fatura é a referência da cobrança
  assert.equal(fatura.kind, "invoice");
  assert.equal(fatura.origin, "fatura");
  assert.equal(fatura.amount, 700);
});

test("GET /api/payment-links: sem pagamento fica aguardando; com aprovado vira pago", async () => {
  const repo = makeMemRepo();
  await repo.create("payment_links", link({ id: "pl_1", lead: "le_1", reference: "le_1", amount: 1000 }));
  await repo.create("payment_links", link({ id: "pl_2", lead: "le_2", reference: "le_2", amount: 2000, targetName: "Outro" }));
  await repo.create("mp_payments", payment({ mpId: "9", amount: 1000, externalReference: "le_1", lead: "le_1" }));
  const app = buildApp(repo);

  const { links } = (await app.inject({ method: "GET", url: "/api/payment-links?saas=leverads" })).json();
  const byId = Object.fromEntries(links.map((l) => [l.id, l]));
  assert.equal(byId.pl_1.status, "paid");
  assert.equal(byId.pl_1.paidAt, "2026-08-10T12:01:00.000Z");
  assert.equal(byId.pl_1.payment.method, "pix");
  assert.equal(byId.pl_2.status, "waiting");
  assert.equal(byId.pl_2.payment, null);
});

test("pagamento que casou pelo E-MAIL (sem referência) também marca o link como pago", () => {
  // Caso real: o lead pagou por outro link; o espelho casou pelo e-mail do
  // pagador e ficou no mesmo lead. Sem referência, exige o MESMO valor.
  const links = [link({ id: "pl_1", amount: 5200, reference: "le_1" })];
  const certo = enrichPaymentLinks(links, [payment({ mpId: "1", amount: 5200, externalReference: "", lead: "le_1" })]);
  assert.equal(certo[0].status, "paid");

  const outroValor = enrichPaymentLinks(links, [payment({ mpId: "2", amount: 99, externalReference: "", lead: "le_1" })]);
  assert.equal(outroValor[0].status, "waiting");
});

test("pagamento ANTERIOR ao link não conta como pagamento dele", () => {
  const links = [link({ createdAt: "2026-08-10T10:00:00.000Z" })];
  const antes = enrichPaymentLinks(links, [payment({ dateCreated: "2026-08-09T10:00:00.000Z", externalReference: "le_1" })]);
  assert.equal(antes[0].status, "waiting");
});

test("gerou de novo: o link novo fica aguardando e o velho aparece como substituído", () => {
  const velho = link({ id: "pl_velho", createdAt: "2026-08-10T10:00:00.000Z" });
  const novo = link({ id: "pl_novo", createdAt: "2026-08-11T10:00:00.000Z" });
  const semPagar = enrichPaymentLinks([velho, novo], []);
  assert.equal(semPagar.find((l) => l.id === "pl_novo").status, "waiting");
  assert.equal(semPagar.find((l) => l.id === "pl_velho").status, "superseded");

  // Um pagamento só não pode aparecer como pago nos dois: fica no mais novo.
  const pago = enrichPaymentLinks([velho, novo], [payment({ externalReference: "le_1", dateCreated: "2026-08-12T10:00:00.000Z" })]);
  assert.equal(pago.find((l) => l.id === "pl_novo").status, "paid");
  assert.equal(pago.find((l) => l.id === "pl_velho").status, "superseded");
});

test("recusado aparece como recusado; fatura baixada na mão conta como paga", () => {
  const rec = enrichPaymentLinks([link()], [payment({ status: "rejected", dateApproved: "", externalReference: "le_1" })]);
  assert.equal(rec[0].status, "rejected");
  assert.equal(rec[0].paidAt, "");

  const semMp = enrichPaymentLinks(
    [link({ kind: "customer", lead: "", customer: "cu_1", invoice: "in_1", reference: "in_1" })],
    [], [{ id: "in_1", status: "paid", paidAt: "2026-08-12T09:00:00.000Z" }]);
  assert.equal(semMp[0].status, "paid");
  assert.equal(semMp[0].paidAt, "2026-08-12T09:00:00.000Z");
});

test("backfill traz o que já existia (lead e fatura) e não duplica ao rodar de novo", async () => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Cliente Real" });
  await repo.create("leads", {
    id: "le_1", saas: "leverads", name: "Padaria do Zé", phone: "1199", planClosed: "semestral",
    mpChargeUrl: "https://mp.com/pay/velho", mpChargeAmount: 1900, mpChargeTitle: "LeverAds · Plano Semestral",
    mpChargeAt: "2026-08-01T10:00:00.000Z",
  });
  await repo.create("leads", { id: "le_2", saas: "leverads", name: "Sem link" });
  await repo.create("invoices", { id: "in_1", customer: "cu_1", saas: "leverads", amount: 300, kind: "manual", status: "open", mpInitPoint: "https://mp.com/pay/fat", createdAt: "2026-08-02T10:00:00.000Z" });

  assert.equal(await backfillPaymentLinks(repo), 2);
  const recs = await repo.list("payment_links");
  const doLead = recs.find((r) => r.id === "pl_lead_le_1");
  assert.equal(doLead.amount, 1900);
  assert.equal(doLead.reference, "le_1");
  assert.equal(doLead.createdAt, "2026-08-01T10:00:00.000Z");
  assert.equal(doLead.plan, "semestral");
  const daFatura = recs.find((r) => r.id === "pl_inv_in_1");
  assert.equal(daFatura.kind, "customer");   // kind manual = cobrança avulsa da ficha
  assert.equal(daFatura.targetName, "Cliente Real");

  assert.equal(await backfillPaymentLinks(repo), 0);
  assert.equal((await repo.list("payment_links")).length, 2);
});

// ── Baixa manual ─────────────────────────────────────────────────────────────
test("validateManualPaid: forma obrigatória, dia BRT vira meio-dia, futuro e lixo recusados", () => {
  const now = new Date("2026-09-10T15:00:00.000Z");
  assert.match(validateManualPaid({}, now).error, /como o dinheiro entrou/);
  assert.match(validateManualPaid({ method: "cheque" }, now).error, /como o dinheiro entrou/);
  assert.deepEqual(validateManualPaid({ method: "PIX", at: "2026-09-08", note: " caiu na conta " }, now).value,
    { at: "2026-09-08T15:00:00.000Z", method: "pix", note: "caiu na conta" });
  assert.equal(validateManualPaid({ method: "pix" }, now).value.at, now.toISOString(), "sem data = agora");
  assert.match(validateManualPaid({ method: "pix", at: "2026-09-20" }, now).error, /futuro/);
  assert.match(validateManualPaid({ method: "pix", at: "ontem" }, now).error, /inválida/);
});

test("baixa manual: vira pago com paidBy manual; MP aprovado ganha; manual ganha de recusado; não vira substituído", () => {
  const manual = { at: "2026-08-12T15:00:00.000Z", method: "pix", note: "", by: "u1", markedAt: "2026-08-12T15:01:00.000Z" };
  const [m] = enrichPaymentLinks([link({ manualPaid: manual })], []);
  assert.equal(m.status, "paid");
  assert.equal(m.paidBy, "manual");
  assert.equal(m.paidAt, manual.at);
  assert.equal(m.paidAmount, 1000);

  const [mp] = enrichPaymentLinks([link({ manualPaid: manual })], [payment({ externalReference: "le_1", amount: 999.5 })]);
  assert.equal(mp.paidBy, "mp", "o fato do MP manda");
  assert.equal(mp.paidAmount, 999.5, "o que entrou é o valor do pagamento");

  const [rej] = enrichPaymentLinks([link({ manualPaid: manual })], [payment({ status: "rejected", dateApproved: "", externalReference: "le_1" })]);
  assert.equal(rej.status, "paid", "cartão recusado e o cliente pagou por fora");
  assert.equal(rej.paidBy, "manual");
  assert.equal(rej.payment.status, "rejected", "a tentativa recusada continua visível");

  const velho = link({ id: "pl_velho", createdAt: "2026-08-10T10:00:00.000Z", manualPaid: manual });
  const novo = link({ id: "pl_novo", createdAt: "2026-08-11T10:00:00.000Z" });
  const out = enrichPaymentLinks([velho, novo], []);
  assert.equal(out.find((l) => l.id === "pl_velho").status, "paid", "pago à mão não é substituído");
  assert.equal(out.find((l) => l.id === "pl_novo").status, "waiting");

  const [inv] = enrichPaymentLinks([link({ kind: "customer", lead: "", customer: "cu_1", invoice: "in_1", reference: "in_1" })], [], [{ id: "in_1", status: "paid", paidAt: "2026-08-12T09:00:00.000Z" }]);
  assert.equal(inv.paidBy, "invoice");
});

test("POST /pay grava a baixa, devolve o link pago e conta na timeline; 400/404/409 nas travas; /unpay desfaz", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Cliente Real", leadId: "le_9" });
  await repo.create("payment_links", link({ id: "pl_1" }));
  await repo.create("payment_links", link({ id: "pl_mp", lead: "le_2", reference: "le_2" }));
  await repo.create("payment_links", link({ id: "pl_fat", kind: "customer", lead: "", customer: "cu_1", invoice: "in_1", reference: "in_1" }));
  await repo.create("payment_links", link({ id: "pl_cli", kind: "customer", lead: "", customer: "cu_1", reference: "" }));
  await repo.create("mp_payments", payment({ mpId: "7", externalReference: "le_2", lead: "le_2" }));
  const app = buildApp(repo);

  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/nada/pay", payload: { method: "pix" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_1/pay", payload: {} })).statusCode, 400);
  const comFatura = await app.inject({ method: "POST", url: "/api/payment-links/pl_fat/pay", payload: { method: "pix" } });
  assert.equal(comFatura.statusCode, 409);
  assert.match(comFatura.json().error, /fatura/);
  const jaPago = await app.inject({ method: "POST", url: "/api/payment-links/pl_mp/pay", payload: { method: "pix" } });
  assert.equal(jaPago.statusCode, 409);
  assert.match(jaPago.json().error, /Mercado Pago/);

  const ok = await app.inject({ method: "POST", url: "/api/payment-links/pl_1/pay", payload: { method: "boleto", at: "2026-08-12", note: "pagou no banco" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().link.status, "paid");
  assert.equal(ok.json().link.paidBy, "manual");
  const saved = await repo.get("payment_links", "pl_1");
  assert.equal(saved.manualPaid.method, "boleto");
  assert.equal(saved.manualPaid.at, "2026-08-12T15:00:00.000Z");
  assert.equal(saved.manualPaid.note, "pagou no banco");
  assert.ok(saved.manualPaid.markedAt);
  const act = (await repo.list("activities")).find((a) => a.lead === "le_1" && a.meta?.event === "link_manual_paid");
  assert.match(act.text, /R\$ 1\.000,00 \(boleto\) · pagou no banco/);

  // Link do cliente sem fatura: a timeline vai pro lead de origem do cliente.
  const cli = await app.inject({ method: "POST", url: "/api/payment-links/pl_cli/pay", payload: { method: "dinheiro" } });
  assert.equal(cli.statusCode, 200);
  assert.ok((await repo.list("activities")).some((a) => a.lead === "le_9" && a.meta?.event === "link_manual_paid"));

  const undo = await app.inject({ method: "POST", url: "/api/payment-links/pl_1/unpay", payload: {} });
  assert.equal(undo.statusCode, 200);
  assert.equal(undo.json().link.status, "waiting");
  assert.equal((await repo.get("payment_links", "pl_1")).manualPaid, null);
  assert.ok((await repo.list("activities")).some((a) => a.meta?.event === "link_manual_unpaid"));
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_1/unpay", payload: {} })).statusCode, 200, "idempotente");
});

// ── Histórico por cliente ────────────────────────────────────────────────────
test("filterPaymentLinks: produto, janela por dia BRT e quem gerou", () => {
  const rows = [
    link({ id: "a", saas: "leverads", createdAt: "2026-08-10T02:30:00.000Z", createdBy: "u1" }), // dia 09 em São Paulo
    link({ id: "b", saas: "leverads", createdAt: "2026-08-10T12:00:00.000Z", createdBy: "u2" }),
    link({ id: "c", saas: "", createdAt: "2026-08-11T12:00:00.000Z", createdBy: "u1" }),          // backfill sem produto
    link({ id: "d", saas: "elo", createdAt: "2026-08-11T12:00:00.000Z" }),
  ];
  const ids = (out) => out.map((l) => l.id);
  assert.deepEqual(ids(filterPaymentLinks(rows, { saas: "leverads" })), ["a", "b", "c"]);
  assert.deepEqual(ids(filterPaymentLinks(rows, { since: "2026-08-10", until: "2026-08-10" })), ["b"], "02:30Z é dia 09 no Brasil");
  assert.deepEqual(ids(filterPaymentLinks(rows, { since: "2026-08-09", until: "2026-08-09" })), ["a"]);
  assert.deepEqual(ids(filterPaymentLinks(rows, { by: "u1" })), ["a", "c"]);
});

test("groupPaymentLinks: lead que virou cliente entra no cliente; saldo sem o substituído; vendedores e contagens", () => {
  const leads = [{ id: "le_1", name: "Zé", customerId: "cu_1", phone: "1199" }, { id: "le_2", name: "Ana", phone: "1188" }];
  const customers = [{ id: "cu_1", name: "Padaria do Zé", leadId: "le_1", phone: "1177" }];
  const users = [{ id: "u1", name: "Jonan" }];
  const enriched = enrichPaymentLinks([
    link({ id: "pl_a", lead: "le_1", reference: "le_1", amount: 1000, createdAt: "2026-08-10T10:00:00.000Z", createdBy: "u1" }),
    link({ id: "pl_b", lead: "le_1", reference: "le_1", amount: 1000, createdAt: "2026-08-11T10:00:00.000Z", createdBy: "u1" }),
    link({ id: "pl_c", kind: "customer", lead: "", customer: "cu_1", reference: "", amount: 300, createdAt: "2026-08-12T10:00:00.000Z", createdBy: "u2" }),
    link({ id: "pl_d", lead: "le_2", reference: "le_2", amount: 2000, createdAt: "2026-08-13T10:00:00.000Z", createdBy: "u1" }),
    link({ id: "pl_e", lead: "le_2", reference: "le_2", amount: 500, createdAt: "2026-08-14T10:00:00.000Z" }),
  ], [
    payment({ mpId: "1", externalReference: "le_1", amount: 1000, dateCreated: "2026-08-11T12:00:00.000Z", dateApproved: "2026-08-11T12:01:00.000Z" }),
    payment({ mpId: "2", externalReference: "le_2", amount: 500, status: "rejected", dateApproved: "", dateCreated: "2026-08-14T12:00:00.000Z" }),
  ]);
  const { groups, totals, counts, sellers } = groupPaymentLinks(enriched, { leads, customers, users });
  assert.deepEqual(groups.map((g) => g.key), ["le:le_2", "cu:cu_1"], "cliente e lead; maior em aberto primeiro");
  const ze = groups[1];
  assert.equal(ze.name, "Padaria do Zé", "nome do cliente, não do lead");
  assert.equal(ze.lead, "le_1", "card do lead de origem continua alcançável");
  assert.equal(ze.kind, "customer");
  assert.deepEqual(ze.links.map((l) => l.id), ["pl_c", "pl_b", "pl_a"], "mais novo primeiro");
  assert.deepEqual(ze.totals, { generated: 1300, paid: 1000, waiting: 300, failed: 0 }, "substituído (pl_a) fora do gerado");
  assert.deepEqual(ze.counts, { links: 3, paid: 1, waiting: 1, failed: 0, superseded: 1 });
  const ana = groups[0];
  assert.equal(ana.kind, "lead");
  assert.deepEqual(ana.totals, { generated: 2500, paid: 0, waiting: 2000, failed: 500 });
  assert.deepEqual(totals, { generated: 3800, paid: 1000, waiting: 2300, failed: 500 });
  assert.deepEqual(counts.groups, { todos: 2, aguardando: 2, pagos: 1, recusados: 1 });
  assert.equal(counts.links, 5);
  assert.deepEqual(sellers, [{ id: "u1", name: "Jonan", count: 3 }, { id: "u2", name: "u2", count: 1 }]);
});

test("GET /api/payment-links agrupado: período, vendedor, aba e o em aberto de antes do período", async () => {
  const repo = makeMemRepo();
  await repo.create("leads", { id: "le_1", saas: "leverads", name: "Zé", customerId: "cu_1" });
  await repo.create("customers", { id: "cu_1", saas: "leverads", name: "Padaria do Zé", leadId: "le_1" });
  await repo.create("users", { id: "u1", name: "Jonan" });
  await repo.create("payment_links", link({ id: "pl_old", lead: "le_1", reference: "le_1", amount: 700, createdAt: "2026-07-20T10:00:00.000Z", createdBy: "u1" }));
  await repo.create("payment_links", link({ id: "pl_a", lead: "le_1", reference: "le_1", amount: 1000, createdAt: "2026-08-10T10:00:00.000Z", createdBy: "u1" }));
  await repo.create("payment_links", link({ id: "pl_b", lead: "le_2", reference: "le_2", amount: 2000, targetName: "Outro", createdAt: "2026-08-12T10:00:00.000Z", createdBy: "u2" }));
  await repo.create("mp_payments", payment({ mpId: "9", amount: 1000, externalReference: "le_1", lead: "le_1" }));
  const app = buildApp(repo);
  const get = async (qs) => (await app.inject({ method: "GET", url: "/api/payment-links?saas=leverads" + qs })).json();

  const all = await get("");
  assert.deepEqual(all.groups.map((g) => g.key), ["le:le_2", "cu:cu_1"]);
  assert.equal(all.groups[1].name, "Padaria do Zé");
  assert.deepEqual(all.totals, { generated: 3700, paid: 1000, waiting: 2700, failed: 0 });
  assert.equal(all.backlog.count, 0, "sem período não existe 'antes do período'");
  assert.deepEqual(all.sellers.map((s) => s.id), ["u1", "u2"]);
  assert.equal(all.links.length, 3, "lista plana continua vindo (compatibilidade)");

  const ago = await get("&since=2026-08-01&until=2026-08-31");
  assert.equal(ago.links.length, 2);
  assert.deepEqual(ago.totals, { generated: 3000, paid: 1000, waiting: 2000, failed: 0 });
  assert.deepEqual(ago.backlog, { count: 1, waiting: 700 }, "o link de julho em aberto avisa");

  const jonan = await get("&since=2026-08-01&until=2026-08-31&by=u1");
  assert.deepEqual(jonan.groups.map((g) => g.key), ["cu:cu_1"]);
  assert.equal(jonan.totals.waiting, 0);

  const pagos = await get("&status=pagos");
  assert.deepEqual(pagos.groups.map((g) => g.key), ["cu:cu_1"]);
  assert.equal(pagos.counts.groups.pagos, 1);
  const aberto = await get("&status=aguardando");
  assert.deepEqual(aberto.groups.map((g) => g.key), ["le:le_2", "cu:cu_1"]);
});

// ── Quem vê o quê: closer só os próprios links; admin tudo e filtra ─────────
function providedKey(req) {
  const h = req.headers["x-api-key"];
  return h ? (Array.isArray(h) ? h[0] : h) : "";
}
function buildAuthApp(repo) {
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, { mp: makeMp({ fetch: async () => ({ status: 404, text: async () => "{}" }), accessToken: "t" }) });
  return app;
}
const loginToken = async (app, username) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password: "1234" } })).json().token;

test("closer vê só os links que ele gerou (o servidor filtra) e só dá baixa neles; admin vê todos e filtra por closer", async (t) => {
  const repo = makeMemRepo();
  await ensureDefaultAdmins(repo);
  await repo.create("users", { id: "jonan", name: "Jonan", roles: ["closer"], screens: [], passwordHash: hashPassword("1234") });
  await repo.create("users", { id: "jessica", name: "Jéssica", roles: ["closer"], screens: [], passwordHash: hashPassword("1234") });
  await repo.create("users", { id: "leo", name: "Leo", roles: ["admin"], screens: [], passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("payment_links", link({ id: "pl_j1", lead: "le_1", reference: "le_1", amount: 1000, createdBy: "jonan" }));
  await repo.create("payment_links", link({ id: "pl_j2", lead: "le_2", reference: "le_2", amount: 700, targetName: "Outro", createdBy: "jonan" }));
  await repo.create("payment_links", link({ id: "pl_je", lead: "le_3", reference: "le_3", amount: 2000, targetName: "Da Jéssica", createdBy: "jessica" }));
  const app = buildAuthApp(repo);
  t.after(() => app.close());
  const H = async (u) => ({ "x-api-key": await loginToken(app, u) });
  const get = async (headers, qs = "") => (await app.inject({ method: "GET", url: "/api/payment-links?saas=leverads" + qs, headers })).json();

  const jonan = await get(await H("jonan"));
  assert.deepEqual(jonan.links.map((l) => l.id).sort(), ["pl_j1", "pl_j2"], "só os dele");
  assert.equal(jonan.totals.waiting, 1700);
  assert.deepEqual(jonan.scope, { mine: true, by: "jonan" });
  assert.deepEqual(jonan.sellers, [], "sem filtro de vendedor pro closer");
  const tentativa = await get(await H("jonan"), "&by=jessica");
  assert.deepEqual(tentativa.links.map((l) => l.id).sort(), ["pl_j1", "pl_j2"], "pedir os de outro não adianta");

  const leo = await get(await H("leo"));
  assert.equal(leo.links.length, 3, "admin vê todos");
  assert.equal(leo.scope.mine, false);
  assert.deepEqual(leo.sellers.map((s) => s.id), ["jonan", "jessica"]);
  const soJessica = await get(await H("leo"), "&by=jessica");
  assert.deepEqual(soJessica.links.map((l) => l.id), ["pl_je"], "admin filtra por closer");

  // Key mestre (sem usuário): tudo, como admin.
  const master = await get({ "x-api-key": "test-key" });
  assert.equal(master.links.length, 3);

  // Baixa manual: só no próprio link; admin em qualquer um.
  const alheio = await app.inject({ method: "POST", url: "/api/payment-links/pl_je/pay", headers: await H("jonan"), payload: { method: "pix" } });
  assert.equal(alheio.statusCode, 403);
  assert.equal((await repo.get("payment_links", "pl_je")).manualPaid, undefined);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_j1/pay", headers: await H("jonan"), payload: { method: "pix" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_je/pay", headers: await H("leo"), payload: { method: "pix" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_je/unpay", headers: await H("jonan"), payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_je/unpay", headers: await H("leo"), payload: {} })).statusCode, 200);
});
