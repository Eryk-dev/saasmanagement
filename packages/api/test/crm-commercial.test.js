// Comercial do Lever CRM (Fase 2): distribuição de leads opcional por produto,
// tags e tipo de negócio no lead, versões da proposta e views salvas.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { autoLeadOwner } from "../src/crm/lead-flow.js";
import { cleanTags } from "../src/crm/lead-tags.js";
import { proposalVersions } from "../src/proposals/proposal-versions.js";

const { registerRoutes } = await import("../src/routes.js");
const DAY = 86_400_000;

async function sdrs(repo, { distribution } = {}) {
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo", kind: "novo" }], ...(distribution ? { leadDistribution: distribution } : {}) });
  for (const id of ["ana", "bia", "caio"]) await repo.create("users", { id, roles: ["sdr"] });
}

test("sem a distribuição ligada, 2+ SDRs = ninguém escolhido (como antes)", async () => {
  const repo = makeMemRepo();
  await sdrs(repo);
  assert.equal(await autoLeadOwner(repo, "leverads"), null);
});

test("round-robin passa a vez pelos SDRs presentes e pula quem está ausente", async () => {
  const repo = makeMemRepo();
  await sdrs(repo, { distribution: "round_robin" });
  const now = Date.parse("2026-10-20T12:00:00Z");
  await repo.update("users", "bia", { awayUntil: new Date(now + 2 * DAY).toISOString() });
  const picks = [];
  for (let i = 0; i < 4; i++) picks.push(await autoLeadOwner(repo, "leverads", { now }));
  assert.deepEqual(picks, ["ana", "caio", "ana", "caio"]);
  const depois = [await autoLeadOwner(repo, "leverads", { now: now + 3 * DAY }), await autoLeadOwner(repo, "leverads", { now: now + 3 * DAY })];
  assert.deepEqual(depois, ["ana", "bia"], "voltou da ausência, volta pra fila na vez dela");
});

test("tags normalizadas e tipo de negócio no POST/PATCH do lead", async () => {
  assert.deepEqual(cleanTags(["Evento X", "evento-x", " ", "Indicação Bia", ...Array(20).fill("z")]), ["evento-x", "indicação-bia", "z"]);
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo", kind: "novo" }] });
  const app = Fastify();
  registerRoutes(app, repo);
  const r = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Ana", saas: "leverads", tags: ["Feira SP"], dealType: "inventado" } });
  assert.equal(r.statusCode, 201, r.body);
  assert.deepEqual([r.json().tags, r.json().dealType], [["feira-sp"], "nova_venda"]);
  const p = await app.inject({ method: "PATCH", url: `/api/leads/${r.json().id}`, payload: { tags: ["VIP", "vip"], dealType: "upsell" } });
  assert.deepEqual([p.json().tags, p.json().dealType], [["vip"], "upsell"]);
  const semTipo = await app.inject({ method: "POST", url: "/api/leads", payload: { name: "Bia", saas: "leverads" } });
  assert.equal(semTipo.json().dealType, "nova_venda", "padrão da criação");
});

test("versões da proposta com estado: aceita, expirada, aberta, enviada", async () => {
  const repo = makeMemRepo();
  const now = Date.parse("2026-10-20T12:00:00Z");
  await repo.create("proposals", { id: "p1", lead: "l1", createdAt: "2026-10-01", state: { validUntil: "08/10/2026" } });
  await repo.create("proposals", { id: "p2", lead: "l1", createdAt: "2026-10-10", views: 3, state: { validUntil: "25/10/2026" } });
  await repo.create("proposals", { id: "p3", lead: "l1", createdAt: "2026-10-15", accepted: true, acceptedAt: "2026-10-16", state: { validUntil: "01/10/2026" } });
  await repo.create("proposals", { id: "p4", lead: "l1", createdAt: "2026-10-19", state: { validUntil: "30/10/2026" } });
  await repo.create("proposals", { id: "px", lead: "outro", createdAt: "2026-10-01" });
  const v = await proposalVersions(repo, "l1", { now });
  assert.deepEqual(v.map((x) => [x.version, x.status]), [[1, "expirada"], [2, "aberta"], [3, "aceita"], [4, "enviada"]]);
});

test("views salvas: cada um vê e apaga só as suas", async () => {
  const repo = makeMemRepo();
  const app = Fastify();
  app.addHook("onRequest", async (req) => { req.authUser = { id: req.headers["x-user"] || "ana" }; });
  registerRoutes(app, repo);
  const criada = await app.inject({ method: "POST", url: "/api/views", payload: { screen: "pipeline", name: "Meus OEM", filters: { phase: "sdr", segment: "autopecas" } } });
  assert.equal(criada.statusCode, 201, criada.body);
  assert.equal((await app.inject({ method: "POST", url: "/api/views", payload: { screen: "pipeline", name: "", filters: {} } })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/views?screen=pipeline" })).json().views.length, 1);
  assert.equal((await app.inject({ url: "/api/views?screen=pipeline", headers: { "x-user": "bia" } })).json().views.length, 0);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/views/${criada.json().id}`, headers: { "x-user": "bia" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/views/${criada.json().id}` })).json().removed, true);
  assert.equal((await app.inject({ url: "/api/saved_views" })).statusCode, 404, "o CRUD genérico não expõe as views");
});

test("upsell do cliente: ganhar carimba wonAt sem cliente novo; voltar não solta o cliente", async () => {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [
    { stage: "Proposta", kind: "proposta" }, { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" },
  ] });
  await repo.create("customers", { id: "c1", name: "Loja", saas: "leverads", leadId: "l0" });
  await repo.create("leads", { id: "u1", saas: "leverads", name: "Upsell", stage: "Proposta", customerId: "c1", dealType: "upsell" });
  const app = Fastify();
  registerRoutes(app, repo);
  await app.inject({ method: "PATCH", url: "/api/leads/u1", payload: { stage: "Ganho" } });
  let lead = await repo.get("leads", "u1");
  assert.ok(lead.wonAt, "ganhou");
  assert.equal(lead.customerId, "c1");
  assert.equal((await repo.list("customers")).length, 1, "não nasce cliente novo");
  await app.inject({ method: "PATCH", url: "/api/leads/u1", payload: { stage: "Proposta" } });
  lead = await repo.get("leads", "u1");
  assert.equal(lead.wonAt, "");
  assert.equal(lead.customerId, "c1", "o negócio continua do cliente");
  assert.ok(await repo.get("customers", "c1"), "o cliente não é apagado");
});
