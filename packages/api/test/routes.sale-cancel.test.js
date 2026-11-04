// Cancelar a venda (POST /api/leads/:id/cancel-sale). Perda sozinha mantém a
// venda (churn); cancelar é a decisão explícita que tira o negócio das vendas —
// junto do movimento pra perda (gate) ou num card que já está perdido (caso
// Marlininilson, 04/11/2026: Acompanhamento → Desqualificado em 7 s).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { isWonLead } from "../src/crm/stages.js";

const { registerRoutes } = await import("../src/routes.js");

function buildApp(repo) {
  const app = Fastify();
  registerRoutes(app, repo);
  return app;
}

const FUNNEL = [
  { stage: "Follow-up", kind: "followup" },
  { stage: "Ganho", kind: "ganho" },
  { stage: "Integração", kind: "integracao" },
  { stage: "Acompanhamento", kind: "posvenda" },
  { stage: "Desqualificado", kind: "desqualificado" },
];

async function seedWon(repo, { stage = "Acompanhamento", mpPaymentId = "", lead = {} } = {}) {
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("customers", { id: "cu1", saas: "leverads", name: "3gs", leadId: "l1", arr: 5964, startedAt: "2026-11-04T16:10:37.415Z" });
  await repo.create("subscriptions", { id: "su1", customer: "cu1", saas: "leverads", status: "active", cycle: "annual", price: 5964 });
  await repo.create("invoices", { id: "in1", subscription: "su1", customer: "cu1", saas: "leverads", amount: 5964, status: "open", ...(mpPaymentId ? { mpPaymentId } : {}) });
  await repo.create("leads", {
    id: "l1", saas: "leverads", name: "Marlininilson", stage, amount: 5964, dealType: "nova_venda",
    customerId: "cu1", wonAt: "2026-11-04T16:10:37.415Z", ...lead,
  });
}

const product = { id: "leverads", funnel: FUNNEL };

test("mover pra Desqualificado sozinho mantém a venda (churn)", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "PATCH", url: "/api/leads/l1", payload: { stage: "Desqualificado", lostReason: "outro" } });
  assert.equal(res.statusCode, 200);
  assert.ok(isWonLead(product, res.json()), "segue contando como venda");
  assert.ok(await repo.get("customers", "cu1"));
});

test("gate de perda com cancelar: move, grava o motivo e tira das vendas", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: { stage: "Desqualificado", lostReason: "outro", lostNote: "marcado errado" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.customerRemoved, true);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Desqualificado");
  assert.equal(lead.lostReason, "outro");
  assert.equal(lead.lostNote, "marcado errado");
  assert.equal(lead.customerId, "");
  assert.equal(lead.wonAt, "");
  assert.equal(isWonLead(product, lead), false, "sai das vendas");
  assert.equal(await repo.get("customers", "cu1"), null);
  assert.equal(await repo.get("subscriptions", "su1"), null);
  assert.equal(await repo.get("invoices", "in1"), null);
  const acts = await repo.list("activities");
  assert.ok(acts.some((a) => a.meta?.event === "stage" || a.type === "stage"), "histórico do funil registrado");
  assert.ok(acts.some((a) => a.meta?.event === "sale_canceled"), "timeline registra o cancelamento");
});

test("card que JÁ está desqualificado com a venda presa: cancela sem mudar a etapa", async () => {
  const repo = makeMemRepo();
  await seedWon(repo, { stage: "Desqualificado", lead: { lostReason: "outro" } });
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: {} });
  assert.equal(res.statusCode, 200);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Desqualificado");
  assert.equal(lead.lostReason, "outro");
  assert.equal(isWonLead(product, lead), false);
  assert.equal(await repo.get("customers", "cu1"), null);
});

test("card na região de venda sem etapa de destino: 400 e nada muda", async () => {
  const repo = makeMemRepo();
  await seedWon(repo);
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "stage_required");
  assert.equal((await repo.get("leads", "l1")).customerId, "cu1");
  const bad = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: { stage: "Ganho" } });
  assert.equal(bad.statusCode, 400);
  assert.ok(await repo.get("customers", "cu1"));
});

test("cobrança real do Mercado Pago: 409 antes de mexer em qualquer coisa", async () => {
  const repo = makeMemRepo();
  await seedWon(repo, { mpPaymentId: "pay_1" });
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: { stage: "Desqualificado", lostReason: "outro" } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "sale_has_real_billing");
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Acompanhamento", "nem o movimento acontece");
  assert.equal(lead.customerId, "cu1");
  assert.ok(await repo.get("customers", "cu1"));
});

test("negócio extra (upsell): cancelar limpa só o wonAt; o cliente fica", async () => {
  const repo = makeMemRepo();
  await seedWon(repo, { stage: "Desqualificado", lead: { dealType: "upsell" } });
  // O cliente existia antes do upsell: não nasceu deste lead.
  await repo.update("customers", "cu1", { leadId: "l0" });
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l1/cancel-sale", payload: {} });
  assert.equal(res.statusCode, 200);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.wonAt, "");
  assert.equal(lead.customerId, "cu1", "vínculo com o cliente mantido");
  assert.equal(isWonLead(product, lead), false);
  assert.ok(await repo.get("customers", "cu1"));
});

test("sem venda: 409 no_sale", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("leads", { id: "l2", saas: "leverads", name: "X", stage: "Desqualificado" });
  const app = buildApp(repo);
  const res = await app.inject({ method: "POST", url: "/api/leads/l2/cancel-sale", payload: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, "no_sale");
});
