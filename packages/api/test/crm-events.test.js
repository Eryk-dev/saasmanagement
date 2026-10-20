// Caixa de entrada de eventos dos produtos e timeline única (events/): a
// assinatura é a credencial, o mesmo evento nunca entra duas vezes, quem não
// casa fica para o runner tentar de novo, e a timeline junta as fontes.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { EVENTS, MAX_ATTEMPTS, processDue, processEvent, verifySignature } from "../src/events/events-core.js";
import { buildTimeline, TIMELINE } from "../src/events/timeline.js";
import { registerEventRoutes } from "../src/events/routes.events.js";

const SECRET = "segredo-de-teste-" + crypto.randomUUID();
process.env.LEVER_EVENTS_SECRET_LEVERADS = SECRET;
delete process.env.LEVER_EVENTS_SECRET_OUTRO;

const sign = (body, { secret = SECRET, ts = Date.now() } = {}) => {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return { raw, headers: { "content-type": "application/json", "x-lever-source": "leverads", "x-lever-timestamp": String(ts), "x-lever-signature": sig } };
};

const evento = (over = {}) => ({
  event_id: "evt-" + crypto.randomUUID(), type: "workspace.created",
  occurred_at: "2026-10-20T12:00:00.000Z", org_id: "org-1", product: "leverads",
  payload: { plan: "pro" }, ...over,
});

async function app(repo) {
  const a = Fastify();
  registerEventRoutes(a, repo);
  await a.ready();
  return a;
}

const post = (a, body, opts) => {
  const { raw, headers } = sign(body, opts);
  return a.inject({ method: "POST", url: "/public/events/v1", payload: raw, headers: { ...headers, ...(opts?.headers || {}) } });
};

async function settled(repo, id) {
  for (let i = 0; i < 50; i++) {
    const ev = await repo.get(EVENTS, id);
    if (ev && ev.status !== "pending") return ev;
    await new Promise((r) => setImmediate(r));
  }
  return repo.get(EVENTS, id);
}

test("assinatura: confere corpo, segredo e janela de 5 min", () => {
  const ts = Date.now();
  const { raw, headers } = sign({ a: 1 }, { ts });
  const base = { rawBody: Buffer.from(raw), timestamp: String(ts), signature: headers["x-lever-signature"], secret: SECRET };
  assert.equal(verifySignature(base), true);
  assert.equal(verifySignature({ ...base, secret: "outro" }), false);
  assert.equal(verifySignature({ ...base, rawBody: Buffer.from(raw + " ") }), false);
  assert.equal(verifySignature({ ...base, now: ts + 6 * 60_000 }), false, "reenvio velho");
  assert.equal(verifySignature({ ...base, secret: "" }), false, "sem segredo, recusa");
});

test("evento assinado de cliente vinculado vai para a timeline dele; reenvio não duplica", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Loja", leveradsOrgId: "ORG-1" });
  const a = await app(repo);
  const body = evento();

  const r1 = await post(a, body);
  assert.equal(r1.statusCode, 202);
  assert.equal(r1.json().duplicate, false);
  const ev = await settled(repo, r1.json().id);
  assert.equal(ev.status, "processed");
  assert.equal(ev.refs.customer, c.id);

  const r2 = await post(a, body);
  assert.equal(r2.statusCode, 202);
  assert.equal(r2.json().duplicate, true);
  assert.equal((await repo.list(EVENTS)).length, 1);
  const tl = (await repo.list(TIMELINE)).filter((t) => t.eventId);
  assert.equal(tl.length, 1, "um item do evento (o resto é a mudança de estágio do cliente)");
  assert.equal(tl[0].customer, c.id);
  assert.equal(tl[0].kind, "workspace.created");
  assert.deepEqual(tl[0].data, { plan: "pro" });
});

test("recusa emissor sem segredo, assinatura errada e envelope inválido, sem gravar nada", async () => {
  const repo = makeMemRepo();
  const a = await app(repo);
  assert.equal((await post(a, evento(), { headers: { "x-lever-source": "outro" } })).statusCode, 401);
  assert.equal((await post(a, evento(), { secret: "errado" })).statusCode, 401);
  assert.equal((await post(a, evento({ event_id: "curto" }))).statusCode, 400);
  assert.equal((await post(a, evento({ type: "semponto" }))).statusCode, 400);
  assert.equal((await post(a, evento({ occurred_at: "ontem" }))).statusCode, 400);
  assert.equal((await post(a, evento({ payload: { x: "y".repeat(17 * 1024) } }))).statusCode, 400);
  assert.equal((await repo.list(EVENTS)).length, 0);
});

test("evento sem dono fica unmatched e casa quando o vínculo aparece", async () => {
  const repo = makeMemRepo();
  const a = await app(repo);
  const r = await post(a, evento({ org_id: "org-nova" }));
  const ev = await settled(repo, r.json().id);
  assert.equal(ev.status, "unmatched");
  assert.equal((await repo.list(TIMELINE)).length, 0);

  const c = await repo.create("customers", { name: "Nova", leveradsOrgId: "org-nova" });
  const cedo = await processDue(repo, { now: new Date() });
  assert.equal(cedo.processed, 0, "antes da espera, o runner não pega");
  const depois = await processDue(repo, { now: new Date(Date.now() + 3 * 60_000) });
  assert.equal(depois.processed, 1);
  assert.equal((await repo.list(TIMELINE)).find((t) => t.eventId).customer, c.id);
});

test("lever_id e e-mail casam com o lead; o lead puxa o cliente", async () => {
  const repo = makeMemRepo();
  const c = await repo.create("customers", { name: "Cliente" });
  const l1 = await repo.create("leads", { name: "Ana", saas: "leverads", leverId: "lid-1", customerId: c.id });
  const l2 = await repo.create("leads", { name: "Bia", saas: "leverads", email: "bia@loja.test" });
  const a = await app(repo);

  const r1 = await post(a, evento({ org_id: "", lever_id: "lid-1", type: "user.signed_up" }));
  assert.deepEqual((await settled(repo, r1.json().id)).refs, { customer: c.id, lead: l1.id });
  const r2 = await post(a, evento({ org_id: "", subject: { email: "BIA@loja.test" }, type: "user.signed_up" }));
  assert.deepEqual((await settled(repo, r2.json().id)).refs, { customer: "", lead: l2.id });
});

test("erro no processamento fica em failed com o motivo e vira dead depois do teto", async () => {
  const base = makeMemRepo();
  await base.create("customers", { name: "Loja", leveradsOrgId: "org-1" });
  const repo = { ...base, async create(name, obj) { if (name === TIMELINE) throw new Error("banco fora"); return base.create(name, obj); } };
  let ev = await base.create(EVENTS, { id: "leverads:evt-falha-1", source: "leverads", type: "x.y", occurredAt: "2026-10-20T00:00:00Z", orgId: "org-1", subject: {}, payload: {}, status: "pending", attempts: 0 });
  ev = await processEvent(repo, ev);
  assert.equal(ev.status, "failed");
  assert.equal(ev.error, "banco fora");
  ev = await processEvent(repo, { ...ev, attempts: MAX_ATTEMPTS - 1 });
  assert.equal(ev.status, "dead");
});

test("timeline do cliente junta eventos, toques do lead, plano e tickets, do mais novo ao mais velho", async () => {
  const repo = makeMemRepo();
  const lead = await repo.create("leads", { name: "Ana", saas: "leverads" });
  const c = await repo.create("customers", { name: "Loja", leadId: lead.id });
  await repo.update("leads", lead.id, { customerId: c.id });
  await repo.create("activities", { id: "ac_1", lead: lead.id, type: "call", text: "call de venda", at: "2026-10-01T10:00:00Z" });
  await repo.create("plan_changes", { id: "pc_1", customer: c.id, type: "start", at: "2026-10-02T10:00:00Z" });
  const t = await repo.create("tickets", { customerId: c.id, saas: "leverads" });
  await repo.create("ticket_events", { id: "te_1", ticket: t.id, type: "created", at: "2026-10-03T10:00:00Z" });
  await repo.create(TIMELINE, { id: "tl:leverads:e1", customer: c.id, kind: "workspace.created", source: "leverads", at: "2026-10-04T10:00:00Z" });
  await repo.create("activities", { id: "ac_outro", lead: "lead-de-outro", type: "call", at: "2026-10-05T10:00:00Z" });

  const doCliente = await buildTimeline(repo, { customer: c.id });
  assert.deepEqual(doCliente.items.map((i) => i.origin), ["evento", "ticket", "plano", "atividade"]);
  const doLead = await buildTimeline(repo, { lead: lead.id });
  assert.deepEqual(doLead.items.map((i) => i.id), doCliente.items.map((i) => i.id), "o lead vê a história do cliente que gerou");

  const a = await app(repo);
  assert.equal((await a.inject({ url: `/api/customers/${c.id}/timeline` })).json().items.length, 4);
  assert.equal((await a.inject({ url: "/api/customers/nao-existe/timeline" })).statusCode, 404);
});

test("caixa de entrada conta por estado", async () => {
  const repo = makeMemRepo();
  await repo.create(EVENTS, { id: "a:1", status: "processed", receivedAt: "1" });
  await repo.create(EVENTS, { id: "a:2", status: "unmatched", receivedAt: "2" });
  const a = await app(repo);
  const r = (await a.inject({ url: "/api/crm-events?status=unmatched" })).json();
  assert.equal(r.counts.processed, 1);
  assert.equal(r.counts.unmatched, 1);
  assert.deepEqual(r.events.map((e) => e.id), ["a:2"]);
});
