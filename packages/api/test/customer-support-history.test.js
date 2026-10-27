// Histórico de suporte por empresa (customer-history.js + GET
// /api/tickets/by-customer/:id): junta os cadastros da mesma org nos produtos
// que o atendente atende, resume e respeita o escopo de produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { orgKeysOf, supportSummary } from "../src/support/customer-history.js";

const { registerRoutes } = await import("../src/routes.js");

const USERS = [
  { id: "ana", name: "Ana", roles: ["support"], supportSaas: ["leverads", "leverprice"], screens: ["tickets"] },
  { id: "bia", name: "Bia", roles: ["support"], supportSaas: ["leverads"], screens: ["tickets"] },
  { id: "caio", name: "Caio", roles: ["support"], supportSaas: ["leverprice"], screens: ["tickets"] },
  { id: "dani", name: "Dani", roles: ["sales"], supportSaas: ["leverads"], screens: ["customers"] },
];

async function buildApp() {
  const repo = makeMemRepo();
  for (const u of USERS) await repo.create("users", { ...u, passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "leverads", name: "LeverAds" });
  await repo.create("products", { id: "leverprice", name: "LeverPrice" });
  await repo.create("customers", { id: "c_la", saas: "leverads", name: "Safehouse", leveradsOrgId: "org-1", orgId: "org-1" });
  await repo.create("customers", { id: "c_lp", saas: "leverprice", name: "Safehouse Preços", leverpriceOrgId: "lp-9", orgId: "org-1" });
  await repo.create("customers", { id: "c_outro", saas: "leverads", name: "Outra Loja", leveradsOrgId: "org-2" });
  await repo.create("customers", { id: "c_semorg", saas: "leverads", name: "Sem Org" });
  const t = (id, saas, customerId, extra = {}) => repo.create("tickets", {
    id, saas, customerId, number: Number(id.replace(/\D/g, "")), subject: `assunto ${id}`, status: "open", priority: "normal",
    channel: "internal", category: "", tags: [], messages: [{ kind: "reply", text: "oi", at: "2026-10-01T10:00:00Z" }], ...extra,
  });
  await t("t1", "leverads", "c_la", { createdAt: "2026-10-01T10:00:00Z", status: "resolved", category: "Código · Bug", channel: "whatsapp",
    sla: { resolvedAt: "2026-10-01T16:00:00Z", breached: { resolution: true } }, linear: { identifier: "LEV-1" }, hermes: { holding: false, phase: "live" } });
  await t("t2", "leverads", "c_la", { createdAt: "2026-10-05T10:00:00Z", category: "Código · Bug" });
  await t("t3", "leverprice", "c_lp", { createdAt: "2026-10-03T10:00:00Z", status: "closed", category: "Operação",
    sla: { resolvedAt: "2026-10-03T12:00:00Z" } });
  await t("t4", "leverads", "c_outro", { createdAt: "2026-10-04T10:00:00Z" });
  await t("t5", "leverads", "c_semorg", { createdAt: "2026-10-02T10:00:00Z" });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, {});
  const as = {};
  for (const u of USERS) {
    as[u.id] = { "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.id, password: "1234" } })).json().token };
  }
  const get = (who, id) => app.inject({ method: "GET", url: `/api/tickets/by-customer/${id}`, headers: as[who] });
  return { app, repo, get };
}

test("org do cliente: qualquer um dos ids, sem vazios nem repetidos", () => {
  assert.deepEqual(orgKeysOf({ orgId: "a", leveradsOrgId: "a", leverpriceOrgId: " b " }), ["a", "b"]);
  assert.deepEqual(orgKeysOf({}), []);
});

test("resumo: abertos, média de resolução, categorias, canais, Hermes e SLA", () => {
  const s = supportSummary([
    { status: "resolved", createdAt: "2026-10-01T10:00:00Z", sla: { resolvedAt: "2026-10-01T16:00:00Z", breached: { resolution: true } }, category: "Código · Bug", channel: "whatsapp", saas: "leverads", hermes: { phase: "live" } },
    { status: "closed", createdAt: "2026-10-03T10:00:00Z", closedAt: "2026-10-03T12:00:00Z", category: "Operação", saas: "leverprice" },
    { status: "open", createdAt: "2026-10-05T10:00:00Z", category: "Código · Bug", saas: "leverads", hermes: {} },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 2);
  assert.equal(s.avgResolutionHours, 4, "(6 h + 2 h) / 2");
  assert.equal(s.lastAt, "2026-10-05T10:00:00Z");
  assert.deepEqual(s.byProduct, { leverads: 2, leverprice: 1 });
  assert.deepEqual(s.byChannel, { whatsapp: 1, internal: 2 });
  assert.deepEqual(s.byCategory, [{ category: "Código · Bug", count: 2 }, { category: "Operação", count: 1 }]);
  assert.equal(s.hermes, 1, "hermes vazio não conta");
  assert.equal(s.breached, 1);
  assert.equal(supportSummary([]).avgResolutionHours, null);
});

test("histórico junta os cadastros da mesma empresa nos produtos que o atendente atende", async (t) => {
  const { app, get } = await buildApp();
  t.after(() => app.close());

  const r = await get("ana", "c_la");
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.deepEqual(body.customer, { id: "c_la", name: "Safehouse", saas: "leverads" });
  assert.deepEqual(body.companies.map((c) => c.id).sort(), ["c_la", "c_lp"]);
  assert.deepEqual(body.tickets.map((x) => x.id), ["t2", "t3", "t1"], "mais novo primeiro; outra empresa fica fora");
  assert.equal(body.tickets[0].messages, undefined, "sem a conversa");
  assert.equal(body.tickets[2].linear.identifier, "LEV-1");
  assert.equal(body.summary.total, 3);
  assert.equal(body.summary.open, 1);
  assert.equal(body.summary.avgResolutionHours, 4);

  // Pelo cadastro do outro produto, a mesma empresa.
  assert.deepEqual((await get("ana", "c_lp")).json().tickets.map((x) => x.id), ["t2", "t3", "t1"]);

  // Escopo: quem só atende LeverAds não vê o ticket do LeverPrice.
  const bia = (await get("bia", "c_la")).json();
  assert.deepEqual(bia.tickets.map((x) => x.id), ["t2", "t1"]);
  assert.deepEqual(bia.companies.map((c) => c.id), ["c_la"]);
  // Quem só atende LeverPrice abre pelo cadastro do LeverAds e vê só o do LeverPrice.
  assert.deepEqual((await get("caio", "c_la")).json().tickets.map((x) => x.id), ["t3"]);

  // Cliente sem org: só os próprios tickets.
  assert.deepEqual((await get("ana", "c_semorg")).json().tickets.map((x) => x.id), ["t5"]);
});

test("histórico: 404 sem cliente ou fora do escopo, e sem a tela Tickets não entra", async (t) => {
  const { app, get } = await buildApp();
  t.after(() => app.close());
  assert.equal((await get("ana", "nao-existe")).statusCode, 404);
  assert.equal((await get("caio", "c_outro")).statusCode, 404, "empresa só no LeverAds, atendente só do LeverPrice");
  assert.equal((await get("dani", "c_la")).statusCode, 403, "a rota fica sob a tela Tickets");
});
