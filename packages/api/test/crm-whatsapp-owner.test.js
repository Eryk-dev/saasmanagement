// Dono da conversa do WhatsApp e "virar ticket" (whatsapp/thread-owner.js):
// a conversa segue a fase do lead, a atribuição manual vence, e a mensagem do
// cliente vira ticket ligado ao lead, ao cliente e à conversa.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { ownerOf, ticketFromThread } from "../src/whatsapp/thread-owner.js";

const { registerRoutes } = await import("../src/routes.js");

const PRODUCT = { id: "leverads", name: "LeverAds", funnel: [
  { stage: "Novo", kind: "novo" }, { stage: "Call", kind: "call" }, { stage: "Ganho", kind: "ganho" }, { stage: "Integração", kind: "integracao" },
] };

test("o dono segue a fase: SDR, closer, CS (ou integrador) e fila sem lead", () => {
  const lead = { owner: "sdr1", closer: "leo", integrator: "eryk" };
  assert.deepEqual(ownerOf({ ...lead, stage: "Novo" }, { product: PRODUCT }), { owner: "sdr1", role: "sdr" });
  assert.deepEqual(ownerOf({ ...lead, stage: "Call" }, { product: PRODUCT }), { owner: "leo", role: "closer" });
  assert.deepEqual(ownerOf({ ...lead, stage: "Integração" }, { product: PRODUCT, customer: { owner: "bia" } }), { owner: "bia", role: "cs" });
  assert.deepEqual(ownerOf({ ...lead, stage: "Ganho" }, { product: PRODUCT, customer: {} }), { owner: "eryk", role: "integrador" });
  assert.deepEqual(ownerOf(null), { owner: "", role: "fila" });
});

test("lista de conversas com dono; atribuição manual vence e pode ser desfeita", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("users", { id: "leo" });
  await repo.create("users", { id: "ana" });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Call", closer: "leo", phone: "5511999990000" });
  await repo.create("wa_threads", { id: "5511999990000", phone: "5511999990000", leadId: "l1", saas: "leverads", lastAt: "2026-10-20" });
  const app = Fastify();
  registerRoutes(app, repo);
  let [t] = (await app.inject({ url: "/api/whatsapp/threads" })).json().threads;
  assert.deepEqual([t.owner, t.ownerRole], ["leo", "closer"]);
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/threads/5511999990000/owner", payload: { owner: "ninguem" } })).statusCode, 422);
  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5511999990000/owner", payload: { owner: "ana" } });
  [t] = (await app.inject({ url: "/api/whatsapp/threads" })).json().threads;
  assert.deepEqual([t.owner, t.ownerRole], ["ana", "manual"]);
  await app.inject({ method: "POST", url: "/api/whatsapp/threads/5511999990000/owner", payload: { owner: "" } });
  [t] = (await app.inject({ url: "/api/whatsapp/threads" })).json().threads;
  assert.equal(t.owner, "leo", "sem manual, volta pra regra");
});

test("conversa vira ticket com assunto da última mensagem, ligado ao lead e ao cliente, uma vez só", async () => {
  const repo = makeMemRepo();
  await repo.create("products", PRODUCT);
  await repo.create("customers", { id: "c1", name: "Loja", saas: "leverads" });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Ana", stage: "Integração", customerId: "c1" });
  await repo.create("wa_threads", { id: "t1", phone: "5511999990000", leadId: "l1" });
  await repo.create("wa_messages", { id: "m1", thread: "t1", direction: "in", text: "oi", at: "2026-10-20T10:00:00Z" });
  await repo.create("wa_messages", { id: "m2", thread: "t1", direction: "out", text: "olá", at: "2026-10-20T10:01:00Z" });
  await repo.create("wa_messages", { id: "m3", thread: "t1", direction: "in", text: "a cópia parou de rodar", at: "2026-10-20T10:02:00Z" });
  const ticket = await ticketFromThread(repo, "t1");
  assert.equal(ticket.subject, "a cópia parou de rodar");
  assert.deepEqual([ticket.channel, ticket.leadId, ticket.customerId, ticket.saas], ["whatsapp", "l1", "c1", "leverads"]);
  assert.ok(ticket.description.includes("oi") && !ticket.description.includes("olá"), "só as mensagens do cliente");
  assert.equal((await repo.get("wa_threads", "t1")).ticketId, ticket.id);
  await assert.rejects(ticketFromThread(repo, "t1"), (e) => e.statusCode === 409);
  await repo.create("wa_threads", { id: "t2", phone: "5511888880000" });
  await assert.rejects(ticketFromThread(repo, "t2"), (e) => e.statusCode === 422, "sem produto, pede o vínculo");
});
