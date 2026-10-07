// Conflito de horário da integração (07/10/2026): operador marcando na grade e
// cliente marcando pelo link de convite ao mesmo tempo. A conferência ao salvar
// olha o cockpit e, com o Google conectado, a agenda real de quem integra;
// sem conexão, vale só o cockpit.
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { integrationSlotConflict } from "../src/crm/integration-slot.js";
import { makeBookingSync } from "../src/google/booking-sync.js";

const { registerRoutes } = await import("../src/routes.js");

const FUNNEL = [{ stage: "Integração", kind: "integracao" }, { stage: "Ganho", kind: "ganho" }];
const NOW = new Date("2026-10-07T15:00:00.000Z");

// Google por usuário simulado: só o Eryk conectado; `busy` = o que a agenda dele tem.
function fakeGu({ busy = [], fail = false } = {}) {
  const calls = [];
  return {
    calls,
    configured: () => true,
    connectedFor: async (u) => u === "eryk",
    meetReadyFor: async () => false,
    accountFor: async () => "",
    accessToken: async () => "at",
    upsertEvent: async () => ({ eventId: "mirror" }),
    deleteEvent: async () => {},
    listBusy: async (user, min, max, opts) => { calls.push({ user, min, max, opts }); if (fail) throw new Error("google fora"); return busy; },
  };
}
async function seed(repo) {
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "eryk", name: "Eryk", roles: ["integrator"] });
  await repo.create("users", { id: "vitor", name: "Vitor", roles: ["integrator"] });
  await repo.create("leads", { id: "ana", saas: "leverads", name: "Ana", stage: "Integração", integrator: "eryk" });
  await repo.create("leads", { id: "bia", saas: "leverads", name: "Bia", stage: "Integração", integrator: "eryk", integrationAt: "2099-01-05T10:00" });
}

test("cockpit: outro card do mesmo integrador sobreposto é conflito; outro integrador não", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const lead = await repo.get("leads", "ana");
  assert.equal((await integrationSlotConflict(repo, null, { lead, at: "2099-01-05T10:30", integrator: "eryk" }))?.lead?.id, "bia");
  assert.equal(await integrationSlotConflict(repo, null, { lead, at: "2099-01-05T11:00", integrator: "eryk" }), null, "encosta no fim: livre");
  assert.equal(await integrationSlotConflict(repo, null, { lead, at: "2099-01-05T10:00", integrator: "vitor" }), null);
  assert.equal(await integrationSlotConflict(repo, null, { lead: await repo.get("leads", "bia"), at: "2099-01-05T10:00", integrator: "eryk" }), null, "o próprio card não conflita");
});

test("Google: evento ocupado na agenda conectada é conflito; os eventos do próprio card não contam", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  const lead = { ...(await repo.get("leads", "ana")), integrationBookedEventId: "meu" };
  const gu = fakeGu({ busy: [{ id: "meu", start: "2099-01-06T10:00:00-03:00", end: "2099-01-06T11:00:00-03:00" }, { id: "x", start: "2099-01-06T14:00:00-03:00", end: "2099-01-06T15:00:00-03:00" }] });
  assert.equal(await integrationSlotConflict(repo, gu, { lead, at: "2099-01-06T10:00", integrator: "eryk" }), null);
  assert.deepEqual(await integrationSlotConflict(repo, gu, { lead, at: "2099-01-06T14:30", integrator: "eryk" }), { source: "google" });
  assert.equal(gu.calls.at(-1).opts.fresh, true, "conferência ao salvar lê ao vivo, sem cache");
  // Sem conexão Google (Vitor): só o cockpit, sem chamar o Google.
  const before = gu.calls.length;
  assert.equal(await integrationSlotConflict(repo, gu, { lead, at: "2099-01-06T14:30", integrator: "vitor" }), null);
  assert.equal(gu.calls.length, before);
  // Google fora do ar: não trava quem está marcando.
  assert.equal(await integrationSlotConflict(repo, fakeGu({ fail: true }), { lead, at: "2099-01-06T14:30", integrator: "eryk" }), null);
});

test("PATCH do lead recusa (409) o horário ocupado e aceita o livre", async (t) => {
  const repo = makeMemRepo();
  await seed(repo);
  const gu = fakeGu({ busy: [{ id: "g1", start: "2099-01-06T14:00:00-03:00", end: "2099-01-06T15:00:00-03:00" }] });
  const app = Fastify();
  registerRoutes(app, repo, { googleUser: gu });
  t.after(() => app.close());
  const patch = (body) => app.inject({ method: "PATCH", url: "/api/leads/ana", payload: body });
  let r = await patch({ integrationAt: "2099-01-05T10:00" });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, "integration_slot_taken");
  assert.match(r.json().error, /Eryk já tem integração com Bia nesse horário/);
  r = await patch({ integrationAt: "2099-01-06T14:00" });
  assert.equal(r.statusCode, 409);
  assert.match(r.json().error, /acabou de ser ocupado na agenda do Google de Eryk/);
  r = await patch({ integrationAt: "2099-01-06T16:00" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await repo.get("leads", "ana")).integrationAt, "2099-01-06T16:00");
  // Trocar pra quem não conectou o Google: só o cockpit decide.
  r = await patch({ integrationAt: "2099-01-06T14:00", integrator: "vitor" });
  assert.equal(r.statusCode, 200, r.body);
});

test("GET /api/google/busy: só intervalos, sem os eventos do card; sem conexão = connected false", async (t) => {
  const repo = makeMemRepo();
  await seed(repo);
  await repo.update("leads", "ana", { integrationMeetEventId: "sala-ana" });
  const gu = fakeGu({ busy: [{ id: "sala-ana", start: "2099-01-06T09:00:00-03:00", end: "2099-01-06T10:00:00-03:00" }, { id: "g1", start: "2099-01-06T14:00:00-03:00", end: "2099-01-06T15:00:00-03:00" }] });
  const app = Fastify();
  registerRoutes(app, repo, { googleUser: gu });
  t.after(() => app.close());
  const r = (await app.inject({ url: "/api/google/busy?user=eryk&from=2099-01-06&to=2099-01-06&exclude=ana" })).json();
  assert.deepEqual(r, { connected: true, busy: [{ start: "2099-01-06T14:00:00-03:00", end: "2099-01-06T15:00:00-03:00" }] });
  assert.equal(gu.calls.at(-1).min, "2099-01-06T03:00:00.000Z", "dia inteiro de Brasília");
  assert.deepEqual((await app.inject({ url: "/api/google/busy?user=vitor&from=2099-01-06" })).json(), { connected: false, busy: [] });
  assert.equal((await app.inject({ url: "/api/google/busy?user=eryk&from=06/01" })).statusCode, 400);
});

test("marcação pelo link que cai em cima de outra integração do integrador avisa o conflito", async () => {
  const repo = makeMemRepo();
  await seed(repo);
  await repo.update("users", "eryk", { bookingUrl: "https://calendar.app.google/x", google: { refreshToken: "rt" } });
  await repo.update("leads", "ana", { email: "ana@x.com" });
  const queue = [[], [{
    id: "bk", status: "confirmed", created: NOW.toISOString(), organizer: { self: true },
    start: { dateTime: "2099-01-05T10:30:00-03:00" }, end: { dateTime: "2099-01-05T11:30:00-03:00" },
    attendees: [{ email: "ana@x.com" }], hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
  }]];
  const fetch = async () => ({ status: 200, json: async () => ({ items: queue.shift() || [], nextSyncToken: "t" }) });
  const sync = makeBookingSync({ repo, googleUser: fakeGu(), fetch, log: { warn() {} } });
  const eryk = await repo.get("users", "eryk");
  await sync.syncUser(eryk, new Date(NOW.getTime() - 60_000));
  await sync.syncUser(eryk, NOW);
  const texts = (await repo.list("notifications")).map((n) => n.text);
  assert.ok(texts.some((t) => /^Conflito: Ana marcou .* e Bia já está nesse horário/.test(t)), texts.join(" | "));
  assert.equal((await repo.get("leads", "ana")).integrationLinkSentAt, "", "marcou: sai do aguardando");
});
