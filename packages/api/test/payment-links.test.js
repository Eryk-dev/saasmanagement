// Histórico de links de pagamento: recibo por geração (card do lead, ficha do
// cliente ou tela) + status derivado do espelho do Mercado Pago.
//
// Cobre: gravação do recibo nas 3 portas, casamento por referência e por
// entidade (pagamento que casou pelo e-mail), link substituído ao gerar de novo,
// pagamento anterior ao link não conta, e backfill idempotente.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");
const { makeMp } = await import("../src/mp.js");
const { enrichPaymentLinks, backfillPaymentLinks } = await import("../src/payment-links.js");

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
