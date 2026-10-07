// Marcação pelo link de convite → integração no card (google/booking-sync.js).
// Google Agenda simulado: cada leitura devolve as mudanças da fila `pages` e um
// syncToken novo; 410 simula token vencido.
import test from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeBookingSync, recordBookingClick, phonesIn } from "../src/google/booking-sync.js";

const NOW = new Date("2026-10-07T15:00:00.000Z"); // 12:00 em Brasília
const FUNNEL = [{ stage: "Call agendada", kind: "call" }, { stage: "Integração", kind: "integracao" }, { stage: "Ganho", kind: "ganho" }];

function fakeCalendar() {
  const cal = { queue: [], calls: [], gone: false, token: 0 };
  cal.fetch = async (url) => {
    const u = new URL(String(url));
    cal.calls.push(Object.fromEntries(u.searchParams));
    if (cal.gone && u.searchParams.get("syncToken")) { cal.gone = false; return { status: 410, json: async () => ({}) }; }
    const items = u.searchParams.get("syncToken") || cal.full ? (cal.queue.shift() || []) : (cal.initial || []);
    return { status: 200, json: async () => ({ items, nextSyncToken: `tok${++cal.token}` }) };
  };
  return cal;
}
const gu = { configured: () => true, accessToken: async () => "at", connectedFor: async () => false, upsertEvent: async () => ({}), deleteEvent: async () => {} };
const spaces = [];
const google = { forUser: () => ({ configureSpace: async (code) => { spaces.push(code); return {}; } }) };

async function setup() {
  const repo = makeMemRepo();
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: FUNNEL });
  await repo.create("users", { id: "eryk", name: "Eryk", roles: ["integrator"], bookingUrl: "https://calendar.app.google/x", google: { refreshToken: "rt" } });
  await repo.create("users", { id: "vitor", name: "Vitor", roles: ["integrator"], google: { refreshToken: "rt" } }); // sem link: fora
  await repo.create("leads", { id: "ana", saas: "leverads", name: "Ana Prado", company: "Prado Pet", stage: "Integração", integrator: "eryk", email: "ana@prado.com", phone: "(11) 98888-7777" });
  await repo.create("leads", { id: "bia", saas: "leverads", name: "Bia Lima", stage: "Integração", integrator: "eryk", phone: "21977776666" });
  await repo.create("leads", { id: "caio", saas: "leverads", name: "Caio", stage: "Call agendada", email: "caio@x.com" }); // fora da entrega
  const cal = fakeCalendar();
  const sync = makeBookingSync({ repo, googleUser: gu, google, fetch: cal.fetch, log: { warn() {} } });
  const eryk = await repo.get("users", "eryk");
  await sync.syncUser(eryk, new Date(NOW.getTime() - 60_000)); // 1ª leitura: só o ponto de partida
  return { repo, cal, sync, eryk };
}
const booking = (over = {}) => ({
  id: "bk1", status: "confirmed", created: NOW.toISOString(),
  organizer: { self: true }, start: { dateTime: "2026-10-09T10:00:00-03:00" }, end: { dateTime: "2026-10-09T11:00:00-03:00" },
  attendees: [{ email: "eryk@leverads.com.br", self: true }, { email: "ana@prado.com", displayName: "Ana" }],
  hangoutLink: "https://meet.google.com/abc-defg-hij", description: "Agendado por\nAna", ...over,
});

test("primeira leitura só guarda o ponto de partida: o que já estava na agenda não vira marcação", async () => {
  const repo = makeMemRepo();
  await repo.create("users", { id: "eryk", name: "Eryk", bookingUrl: "https://calendar.app.google/x", google: { refreshToken: "rt" } });
  await repo.create("leads", { id: "ana", saas: "", name: "Ana", stage: "Integração", email: "ana@prado.com" });
  const cal = fakeCalendar();
  cal.initial = [booking()];
  const sync = makeBookingSync({ repo, googleUser: gu, google, fetch: cal.fetch, log: { warn() {} } });
  assert.equal(await sync.syncUser(await repo.get("users", "eryk"), NOW), 0);
  assert.equal((await repo.get("leads", "ana")).integrationAt, undefined);
  assert.equal((await repo.get("app_config", "booking_sync_eryk")).syncToken, "tok1");
});

test("marcação com o e-mail do lead vira a integração no card, com a sala da marcação", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([booking()]);
  assert.equal(await sync.syncUser(eryk, NOW), 1);
  assert.equal(cal.calls.at(-1).syncToken, "tok1", "leitura incremental pelo token salvo");
  const ana = await repo.get("leads", "ana");
  assert.equal(ana.integrationAt, "2026-10-09T10:00");
  assert.equal(ana.integrator, "eryk");
  assert.equal(ana.integrationCallUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(ana.integrationMeetEventId, "bk1");
  assert.equal(ana.integrationMeetOrganizer, "eryk", "o autoIntegrationMeet não cria outra sala e o espelho pessoal não duplica");
  assert.equal(ana.integrationBookedVia, "link");
  assert.equal(ana.nextActionAt, "2026-10-09T13:00:00.000Z");
  assert.ok(spaces.includes("abc-defg-hij"), "sala aberta + gravação pro resumo");
  const acts = (await repo.list("activities")).filter((a) => a.lead === "ana");
  assert.ok(acts.some((a) => a.meta?.event === "integration_booked" && a.meta.match === "email"));
  const nots = await repo.list("notifications");
  assert.equal(nots.length, 1);
  assert.equal(nots[0].user, "eryk");
  assert.match(nots[0].text, /Ana Prado marcou a integração pelo seu link/);
  assert.deepEqual(nots[0].link, { screen: "today", lead: "ana" });
});

test("sem e-mail igual, liga pelo telefone escrito na marcação", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([booking({ attendees: [{ email: "x@y.com", displayName: "Bia" }], description: "Agendado por Bia\nTelefone: +55 21 97777-6666" })]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("leads", "bia")).integrationAt, "2026-10-09T10:00");
  assert.equal((await repo.get("leads", "ana")).integrationAt, undefined);
});

test("sem e-mail nem telefone, liga pelo clique no link curto (robô de preview não conta)", async () => {
  const { repo, cal, sync, eryk } = await setup();
  assert.equal(await recordBookingClick(repo, { userId: "eryk", leadId: "bia", ua: "WhatsApp/2.23.20.0 A", now: NOW }), false);
  assert.equal(await recordBookingClick(repo, { userId: "eryk", leadId: "bia", ua: "Mozilla/5.0 (iPhone)", now: new Date(NOW.getTime() - 5 * 60_000) }), true);
  cal.queue.push([booking({ attendees: [{ email: "outro@mail.com" }], description: "" })]);
  await sync.syncUser(eryk, NOW);
  const bia = await repo.get("leads", "bia");
  assert.equal(bia.integrationAt, "2026-10-09T10:00");
  assert.ok((await repo.list("activities")).some((a) => a.lead === "bia" && a.meta?.match === "clique"));
});

test("eventos do cockpit, antigos, passados ou sem convidado não viram marcação", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await repo.update("leads", "caio", { integrationMeetEventId: "ck1" });
  cal.queue.push([
    booking({ id: "ck1" }),                                                // sala criada pelo cockpit
    booking({ id: "ck2", description: "Lead: Ana Prado\nWhatsApp: 11" }),   // espelho/Meet do cockpit
    booking({ id: "old", created: "2026-10-01T10:00:00.000Z" }),           // evento antigo editado
    booking({ id: "past", start: { dateTime: "2026-10-06T10:00:00-03:00" } }),
    booking({ id: "solo", attendees: [{ email: "eryk@leverads.com.br", self: true }] }),
  ]);
  assert.equal(await sync.syncUser(eryk, NOW), 0);
  assert.equal((await repo.get("leads", "ana")).integrationAt, undefined);
  assert.equal((await repo.list("notifications")).length, 0);
});

test("remarcar e cancelar na página do Google acompanham no card", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  cal.queue.push([booking({ start: { dateTime: "2026-10-10T14:30:00-03:00" } })]);
  await sync.syncUser(eryk, NOW);
  let ana = await repo.get("leads", "ana");
  assert.equal(ana.integrationAt, "2026-10-10T14:30");
  assert.equal(ana.integrationScheduledAt, "2026-10-10T17:30:00.000Z");
  cal.queue.push([{ id: "bk1", status: "cancelled" }]);
  await sync.syncUser(eryk, NOW);
  ana = await repo.get("leads", "ana");
  assert.equal(ana.integrationAt, "");
  assert.equal(ana.integrationMeetEventId, "");
  assert.equal(ana.integrationBookedVia, "");
  const events = (await repo.list("activities")).filter((a) => a.lead === "ana").map((a) => a.meta?.event).sort();
  assert.deepEqual(events, ["integration_booked", "integration_booking_cancelled", "integration_booking_moved"]);
});

test("desmarcada pelo cockpit: o evento apagado não vira 'cliente cancelou'", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  await repo.update("leads", "ana", { integrationAt: "", integrationCallUrl: "", integrationMeetEventId: "" }); // cancelIntegrationMeet
  cal.queue.push([{ id: "bk1", status: "cancelled" }]);
  await sync.syncUser(eryk, NOW);
  const ana = await repo.get("leads", "ana");
  assert.equal(ana.integrationBookedEventId, "");
  assert.ok(!(await repo.list("activities")).some((a) => a.meta?.event === "integration_booking_cancelled"));
});

test("marcação sem card avisa quem integra; reunião comum do integrador não", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([
    booking({ id: "orf", attendees: [{ email: "novo@cliente.com", displayName: "Novo Cliente" }], description: "Agendado por Novo Cliente" }),
    booking({ id: "reuniao", attendees: [{ email: "parceiro@x.com" }], description: "Alinhamento com parceiro", summary: "Parceria" }),
  ]);
  await sync.syncUser(eryk, NOW);
  const nots = await repo.list("notifications");
  assert.equal(nots.length, 1);
  assert.match(nots[0].text, /Novo Cliente marcou .* pelo seu link de convite e não achei o card/);
  // Mesma marcação de novo (outra leitura): não repete o aviso.
  cal.queue.push([booking({ id: "orf", attendees: [{ email: "novo@cliente.com", displayName: "Novo Cliente" }], description: "Agendado por Novo Cliente" })]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.list("notifications")).length, 1);
});

test("card que já tem outra integração marcada não é sobrescrito", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await repo.update("leads", "ana", { integrationAt: "2026-10-08T09:00", integrationMeetEventId: "ck9", integrationScheduledAt: "2026-10-08T12:00:00.000Z" });
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("leads", "ana")).integrationAt, "2026-10-08T09:00");
  assert.match((await repo.list("notifications"))[0].text, /já tem integração marcada/);
});

test("token vencido (410): relê tudo e só trata como novo o criado depois da última leitura", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.gone = true;
  cal.full = true;
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("leads", "ana")).integrationAt, "2026-10-09T10:00");
});

test("ritmo: agenda sem clique é lida a cada 15 min; com clique recente, a cada passe", async () => {
  const { repo, cal, sync } = await setup();
  const reads = () => cal.calls.length;
  const t0 = new Date(NOW.getTime() + 60_000);
  let before = reads();
  await sync.tick(new Date(t0.getTime() + 3 * 60_000));
  assert.equal(reads(), before, "3 min depois, sem clique: não lê");
  await sync.tick(new Date(t0.getTime() + 16 * 60_000));
  assert.equal(reads(), before + 1, "15 min depois: lê (e o Vitor, sem link, nunca)");
  await recordBookingClick(repo, { userId: "eryk", leadId: "ana", ua: "Mozilla/5.0", now: new Date(t0.getTime() + 17 * 60_000) });
  before = reads();
  await sync.tick(new Date(t0.getTime() + 19 * 60_000));
  assert.equal(reads(), before + 1, "com clique recente: lê no passe seguinte");
});

test("telefones escritos na marcação, com ou sem DDI e nono dígito", () => {
  const [comDdi] = phonesIn("Telefone: +55 (11) 98888-7777");
  assert.equal(comDdi, phonesIn("11 98888-7777")[0], "sem DDI ganha o 55");
  assert.equal(comDdi, phonesIn("(11) 8888-7777")[0], "sem o nono dígito casa igual");
  assert.equal(phonesIn("sem número, só 12345").length, 0);
});

test("marcação sem card: o aviso leva o evento e ligar à mão usa a sala da marcação", async () => {
  const { repo, cal, eryk } = await setup();
  const orphan = booking({ id: "orf", attendees: [{ email: "outro@mail.com", displayName: "Ana (outro e-mail)" }], description: "Agendado por Ana" });
  const events = { orf: orphan, gone: { id: "gone", status: "cancelled" } };
  const guLive = { ...gu, getEvent: async (_u, id) => events[id] || null };
  const sync = makeBookingSync({ repo, googleUser: guLive, google, fetch: cal.fetch, log: { warn() {} } });
  cal.queue.push([orphan]);
  await sync.syncUser(eryk, NOW);
  const [aviso] = await repo.list("notifications");
  assert.deepEqual(aviso.link, { screen: "today", booking: "orf", bookingUser: "eryk" });
  assert.match(aviso.text, /toque para ligar a um card/);

  const r = await sync.linkEvent({ userId: "eryk", eventId: "orf", leadId: "ana", by: "leonardo", now: NOW });
  assert.equal(r.lead.integrationAt, "2026-10-09T10:00");
  assert.equal(r.lead.integrationMeetEventId, "orf");
  assert.equal(r.lead.integrationBookedEventId, "orf");
  assert.ok((await repo.list("activities")).some((a) => a.lead === "ana" && a.meta?.match === "manual:leonardo"));
  assert.equal((await repo.get("notifications", aviso.id)).read, true, "o aviso sem card sai da caixa");

  assert.equal((await sync.linkEvent({ userId: "eryk", eventId: "orf", leadId: "bia", now: NOW })).code, 409, "já ligada a outro card");
  assert.equal((await sync.linkEvent({ userId: "eryk", eventId: "gone", leadId: "bia", now: NOW })).code, 410, "cancelada no Google");
  assert.equal((await sync.linkEvent({ userId: "ninguem", eventId: "orf", leadId: "bia", now: NOW })).code, 422, "dono da agenda sem Google conectado");
  assert.equal((await sync.linkEvent({ userId: "eryk", eventId: "orf", leadId: "nao-existe", now: NOW })).code, 404);
});

test("ligar à mão não pisa em card que já tem outra integração por vir", async () => {
  const { repo, cal, eryk } = await setup();
  await repo.update("leads", "bia", { integrationMeetEventId: "ck9", integrationScheduledAt: "2026-10-20T13:00:00.000Z", integrationAt: "2026-10-20T10:00" });
  const guLive = { ...gu, getEvent: async () => booking({ id: "orf2" }) };
  const sync = makeBookingSync({ repo, googleUser: guLive, google, fetch: cal.fetch, log: { warn() {} } });
  const r = await sync.linkEvent({ userId: "eryk", eventId: "orf2", leadId: "bia", now: NOW });
  assert.equal(r.code, 409);
  assert.equal((await repo.get("leads", "bia")).integrationAt, "2026-10-20T10:00");
});
