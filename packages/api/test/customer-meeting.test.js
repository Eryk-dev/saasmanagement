// Nova reunião com o cliente (Clientes → Marcar nova reunião): roda no lead do
// cliente pelos campos da integração. Reunião que já aconteceu solta a sala,
// e a nova nasce com Meet próprio, senão o dedup do resumo pulava a reunião
// nova pra sempre. Tudo offline (fakes do Google e da IA).

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [
  { stage: "Novo lead", kind: "novo", conv: 1 },
  { stage: "Ganho", kind: "ganho", conv: 1 },
  { stage: "Integração", kind: "integracao", conv: 1 },
  { stage: "Perdido", kind: "perdido", conv: 0 },
];

// "YYYY-MM-DDTHH:MM" no relógio de Brasília, a N dias de agora.
function brtIn(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function googleFake({ transcript = null } = {}) {
  const created = [], patched = [], deleted = [];
  return {
    created, patched, deleted,
    configured: () => true,
    connected: async () => true,
    createMeetEvent: async (args) => {
      created.push(args);
      return { meetUrl: `https://meet.google.com/new-room-c${created.length}`, eventId: `ev_new${created.length}`, htmlLink: "https://calendar/x" };
    },
    patchCalendarEvent: async (id, body) => { patched.push({ id, ...body }); },
    deleteCalendarEvent: async (id) => { deleted.push(id); },
    configureSpace: async () => ({ open: true, recording: true, transcription: true }),
    fetchTranscript: async () => transcript,
    fetchTranscriptFromDrive: async () => null,
  };
}

const anthropicFake = () => ({
  configured: () => true,
  summarizeIntegration: async () => ({ summary: { sentimento: "satisfeito", resumo: "Reunião anterior.", configurado: [], pendencias: [{ item: "Enviar acesso ao ML", responsavel: "cliente" }], proximosPassos: [] } }),
});

async function setup({ lead = {}, transcript = null, customer = {} } = {}) {
  const repo = makeMemRepo();
  // UniqueKids: a conta do time organiza o Meet (sem exigir a conta pessoal).
  await repo.create("products", { id: "uniquekids", name: "UniqueKids", funnel: FUNNEL });
  await repo.create("users", { id: "eryk", name: "Eryk" });
  await repo.create("leads", { id: "l1", saas: "uniquekids", name: "Danilo", company: "Bordados", stage: "Ganho", email: "danilo@example.com", customerId: "c1", ...lead });
  await repo.create("customers", { id: "c1", saas: "uniquekids", name: "Bordados", leadId: "l1", ...customer });
  const google = googleFake({ transcript });
  const app = Fastify();
  registerRoutes(app, repo, { google, anthropic: anthropicFake() });
  return { repo, app, google };
}

const pastRoom = (summarized) => ({
  integrationAt: brtIn(-2),
  integrationCallUrl: "https://meet.google.com/old-room-aa",
  integrationMeetEventId: "ev_old",
  integrationScheduledAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  ...(summarized ? { integrationSummaryFor: "ev_old" } : {}),
});

test("reunião da ficha sem integração aberta: vira check-in com Meet próprio e o lead não muda", async () => {
  const { repo, app, google } = await setup({ lead: pastRoom(true) });
  const at = brtIn(3);
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at, responsible: "eryk" } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.host.collection, "cs_followups");
  assert.equal(body.callUrl, "https://meet.google.com/new-room-c1");
  assert.equal(google.created.length, 1);
  assert.deepEqual(google.created[0].attendees, ["danilo@example.com"], "o contato do lead que gerou o cliente vai no convite");
  const f = await repo.get("cs_followups", body.host.id);
  assert.equal(f.kind, "check_in");
  assert.equal(f.meetings.length, 1);
  assert.equal(f.meetings[0].eventId, "ev_new1");
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.integrationMeetEventId, "ev_old", "o lead da venda não é tocado");
  assert.equal(lead.integrationMeetLabel, undefined);
  assert.ok((await repo.list("timeline_events")).some((t) => t.kind === "meeting.scheduled" && t.customer === "c1"));
  await app.close();
});

test("com integração aberta, a reunião da ficha entra nela", async () => {
  const { repo, app } = await setup();
  await repo.create("onboardings", { id: "ob1", customer: "c1", stage: "configuracao", integrator: "eryk", createdAt: "2026-10-01T00:00:00Z", items: [] });
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(2) } });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().host, { collection: "onboardings", id: "ob1" });
  const o = await repo.get("onboardings", "ob1");
  assert.equal(o.meetings[0].responsible, "eryk", "o integrador da integração responde pela reunião");
  await app.close();
});

test("cliente sem lead marca reunião; valida data no passado, responsável e cliente inexistentes", async () => {
  const { repo, app } = await setup({ customer: { leadId: "" } });
  const ok = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(2) } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(-1) } })).statusCode, 422);
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(2), responsible: "ninguem" } })).statusCode, 422);
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/zz/meeting", payload: { at: brtIn(2) } })).statusCode, 404);
  assert.equal((await repo.list("cs_followups")).length, 1, "só a reunião válida criou acompanhamento");
  await app.close();
});

test("reunião do registro: remarcar move o evento, conflito do mesmo responsável recusa, cancelar apaga", async () => {
  const { repo, app, google } = await setup();
  await repo.create("onboardings", { id: "ob1", customer: "c1", stage: "kickoff", integrator: "eryk", createdAt: "2026-10-01T00:00:00Z", items: [] });
  const at = brtIn(2);
  const first = (await app.inject({ method: "POST", url: "/api/customers/onboardings/ob1/meetings", payload: { at } })).json();
  const mid = first.meeting.id;
  const clash = await app.inject({ method: "POST", url: "/api/customers/onboardings/ob1/meetings", payload: { at } });
  assert.equal(clash.statusCode, 409);
  const moved = await app.inject({ method: "PATCH", url: `/api/customers/onboardings/ob1/meetings/${mid}`, payload: { at: brtIn(4) } });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(google.patched[0].id, "ev_new1");
  const gone = await app.inject({ method: "DELETE", url: `/api/customers/onboardings/ob1/meetings/${mid}` });
  assert.equal(gone.json().status, "canceled");
  assert.deepEqual(google.deleted, ["ev_new1"]);
  await app.close();
});

test("resumo da reunião do registro vai pra timeline e a pendência do cliente entra no checklist", async () => {
  const { repo, app } = await setup({ transcript: { text: "conversa", endTime: new Date().toISOString() } });
  await repo.create("onboardings", { id: "ob1", customer: "c1", stage: "kickoff", integrator: "eryk", createdAt: "2026-10-01T00:00:00Z", items: [] });
  await repo.update("onboardings", "ob1", { meetings: [{ id: "mt1", at: new Date(Date.now() - 2 * 3600_000).toISOString(), status: "scheduled", meetUrl: "https://meet.google.com/abc-defg-hij", eventId: "ev1", organizer: "", responsible: "eryk" }] });
  const r = await app.inject({ method: "POST", url: "/api/customers/onboardings/ob1/meetings/mt1/summary", payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().ok, true);
  assert.ok((await repo.list("timeline_events")).some((t) => t.kind === "meeting.summarized" && t.customer === "c1"));
  assert.ok((await repo.get("onboardings", "ob1")).meetings[0].summaryAt);
  await app.close();
});

test("remarcar a integração pelo lead: sala nova, confirmação zerada e o card fica na etapa", async () => {
  const { repo, app, google } = await setup({ lead: { ...pastRoom(true), stage: "Integração", integrator: "eryk", integrationConfirmed: true } });
  const at = brtIn(2);
  const r = await app.inject({ method: "POST", url: "/api/leads/l1/integration-meeting", payload: { at } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().released, true);
  assert.equal(r.json().lead.integrationAt, at);
  const lead = await repo.get("leads", "l1");
  assert.equal(lead.stage, "Integração");
  assert.equal(lead.integrationAt, at);
  assert.equal(lead.integrationConfirmed, false);
  assert.equal(lead.integrationMeetEventId, "ev_new1");
  assert.equal(lead.integrationMeetLabel, undefined, "não vira \"Reunião\": segue sendo a integração");
  assert.equal(google.created.length, 1);
  const acts = (await repo.list("activities")).filter((a) => a.lead === "l1" && a.meta?.event === "integration_rescheduled");
  assert.equal(acts.length, 1);
  await app.close();
});

test("remarcar a integração pelo lead: mesma confirmação quando a anterior não tem resumo", async () => {
  const { repo, app } = await setup({ lead: { ...pastRoom(false), stage: "Integração" } });
  const at = brtIn(2);
  const blocked = await app.inject({ method: "POST", url: "/api/leads/l1/integration-meeting", payload: { at } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().reason, "previous_without_summary");
  assert.equal((await repo.get("leads", "l1")).integrationMeetEventId, "ev_old");
  const forced = await app.inject({ method: "POST", url: "/api/leads/l1/integration-meeting", payload: { at, force: true } });
  assert.equal(forced.statusCode, 200, forced.body);
  const passado = await app.inject({ method: "POST", url: "/api/leads/l1/integration-meeting", payload: { at: brtIn(-1) } });
  assert.equal(passado.statusCode, 422);
  const naoExiste = await app.inject({ method: "POST", url: "/api/leads/zz/integration-meeting", payload: { at } });
  assert.equal(naoExiste.statusCode, 404);
  await app.close();
});
