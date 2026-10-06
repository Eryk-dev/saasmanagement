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
  summarizeIntegration: async () => ({ summary: { sentimento: "satisfeito", resumo: "Reunião anterior.", configurado: [], pendencias: [], proximosPassos: [] } }),
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

test("reunião anterior já resumida: a nova nasce com sala própria e entra no histórico", async () => {
  const { repo, app, google } = await setup({ lead: pastRoom(true) });
  const at = brtIn(3);
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at, responsible: "eryk" } });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.released, true);
  assert.equal(body.callUrl, "https://meet.google.com/new-room-c1");

  const lead = await repo.get("leads", "l1");
  assert.equal(lead.integrationAt, at);
  assert.equal(lead.integrator, "eryk");
  assert.equal(lead.integrationMeetEventId, "ev_new1", "evento novo, que o dedup do resumo ainda não viu");
  assert.notEqual(lead.integrationSummaryFor, lead.integrationMeetEventId);
  assert.equal(google.created.length, 1);
  assert.ok(google.created[0].summary.startsWith("Reunião UniqueKids"));
  assert.equal(google.patched.length, 0, "a sala velha não é movida");
  assert.equal(google.deleted.length, 0, "o evento da reunião que já aconteceu fica na agenda");

  const acts = (await repo.list("activities")).filter((a) => a.lead === "l1" && a.meta?.event === "customer_meeting");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].meta.customerId, "c1");
  await app.close();
});

test("reunião anterior sem transcrição: pede confirmação e só solta a sala com force", async () => {
  const { repo, app, google } = await setup({ lead: pastRoom(false), transcript: null });
  const at = brtIn(3);
  const blocked = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at } });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().reason, "previous_without_summary");
  assert.equal((await repo.get("leads", "l1")).integrationMeetEventId, "ev_old", "nada mudou sem a confirmação");
  assert.equal(google.created.length, 0);

  const forced = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at, force: true } });
  assert.equal(forced.statusCode, 200, forced.body);
  assert.equal((await repo.get("leads", "l1")).integrationMeetEventId, "ev_new1");
  await app.close();
});

test("reunião anterior com transcrição pronta: resume antes de soltar a sala", async () => {
  const transcript = { text: "Cliente: tudo certo.", startTime: new Date(Date.now() - 2 * 86_400_000).toISOString(), endTime: new Date(Date.now() - 2 * 86_400_000 + 3_600_000).toISOString() };
  const { repo, app } = await setup({ lead: pastRoom(false), transcript });
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(3) } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().previous?.ok, true);
  const summaries = (await repo.list("activities")).filter((a) => a.lead === "l1" && a.meta?.event === "call_summary");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].meta.kind, "integracao");
  assert.equal(summaries[0].meta.meetEventId, "ev_old", "o resumo é da reunião anterior");
  assert.equal((await repo.get("leads", "l1")).integrationMeetEventId, "ev_new1");
  await app.close();
});

test("reunião ainda por acontecer: remarca a mesma sala (move o evento)", async () => {
  const future = brtIn(1);
  const { repo, app, google } = await setup({ lead: {
    integrationAt: future, integrationCallUrl: "https://meet.google.com/old-room-aa", integrationMeetEventId: "ev_old",
    integrationScheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
  } });
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(4) } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().released, false);
  assert.equal(google.created.length, 0);
  assert.equal(google.patched.length, 1);
  assert.equal(google.patched[0].id, "ev_old");
  assert.equal((await repo.get("leads", "l1")).integrationMeetEventId, "ev_old");
  await app.close();
});

test("valida cliente sem lead, data no passado e responsável inexistente", async () => {
  const { app, repo } = await setup();
  await repo.create("customers", { id: "c2", saas: "uniquekids", name: "Sem lead" });
  const semLead = await app.inject({ method: "POST", url: "/api/customers/c2/meeting", payload: { at: brtIn(2) } });
  assert.equal(semLead.statusCode, 422);
  const passado = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(-1) } });
  assert.equal(passado.statusCode, 422);
  const vazio = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: {} });
  assert.equal(vazio.statusCode, 422);
  const ninguem = await app.inject({ method: "POST", url: "/api/customers/c1/meeting", payload: { at: brtIn(2), responsible: "fantasma" } });
  assert.equal(ninguem.statusCode, 422);
  const naoExiste = await app.inject({ method: "POST", url: "/api/customers/zz/meeting", payload: { at: brtIn(2) } });
  assert.equal(naoExiste.statusCode, 404);
  await app.close();
});

test("gerar resumo pela ficha do cliente resume a última reunião do lead dele", async () => {
  const transcript = { text: "Cliente: tudo certo.", startTime: new Date(Date.now() - 86_400_000).toISOString(), endTime: new Date(Date.now() - 86_400_000 + 3_600_000).toISOString() };
  const { repo, app } = await setup({ lead: pastRoom(false), transcript });
  const r = await app.inject({ method: "POST", url: "/api/customers/c1/meeting-summary", payload: {} });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().ok, true);
  assert.equal((await repo.get("leads", "l1")).integrationSummaryFor, "ev_old");
  const again = await app.inject({ method: "POST", url: "/api/customers/c1/meeting-summary", payload: {} });
  assert.equal(again.json().reason, "already_done");
  await repo.create("customers", { id: "c2", saas: "uniquekids", name: "Sem lead" });
  assert.equal((await app.inject({ method: "POST", url: "/api/customers/c2/meeting-summary", payload: {} })).statusCode, 422);
  await app.close();
});

// Remarcar da atividade de Integração (Minhas atividades, 06/10/2026): a mesma
// régua, pelo lead. A integração que já aconteceu ganha sala nova e o card não
// sai da etapa.
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
