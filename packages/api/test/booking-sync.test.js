// Marcação pelo link de convite → integração no card (google/booking-sync.js).
// Google Agenda simulado: cada leitura devolve as mudanças da fila `pages` e um
// syncToken novo; 410 simula token vencido.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeBookingSync, recordBookingClick, phonesIn, emailKey, holdSlot } from "../src/google/booking-sync.js";
import { listNotifications, markNotificationsRead, upsertNotification, clearNotifications } from "../src/tasks/tasks-core.js";
import { blockHits } from "../src/crm/agenda-slots.js";

const NOW = new Date("2026-10-07T15:00:00.000Z"); // 12:00 em Brasília
// Relógio parado em NOW pro arquivo inteiro: a fixture marca a integração em
// 09/10/2026 e ela tem que continuar "por vir" em qualquer dia que a suíte rode.
// O `now` entra no syncUser/linkEvent, mas o appointmentAt que carimba o
// nextActionAt (booking-sync.js → lead-flow.js) usa o relógio real; sem isto,
// depois de 09/10 o compromisso "já passou" e o nextActionAt some.
beforeEach(() => mock.timers.enable({ apis: ["Date"], now: NOW }));
afterEach(() => mock.timers.reset());
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
  assert.deepEqual(aviso.link, { screen: "today", booking: "orf", bookingUser: "eryk", until: "2026-10-09T13:00:00.000Z" });
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

test("ligar à mão substitui a integração por vir do card (o cliente escolheu outro horário)", async () => {
  const { repo, cal, eryk } = await setup();
  await repo.update("leads", "bia", { integrationMeetEventId: "ck9", integrationScheduledAt: "2026-10-20T13:00:00.000Z", integrationAt: "2026-10-20T10:00" });
  const deleted = [];
  const guLive = { ...gu, getEvent: async () => booking({ id: "orf2" }), deleteEvent: async (u, id) => { deleted.push([u, id]); } };
  const sync = makeBookingSync({ repo, googleUser: guLive, google, fetch: cal.fetch, log: { warn() {} } });
  const r = await sync.linkEvent({ userId: "eryk", eventId: "orf2", leadId: "bia", now: NOW });
  assert.equal(r.code, undefined);
  assert.equal(r.lead.integrationBookedEventId, "orf2");
  assert.equal(r.lead.integrationMeetEventId, "orf2");
  assert.equal(r.lead.integrationAt, "2026-10-09T10:00");
  assert.deepEqual(deleted.map((d) => d[1]), ["ck9"], "a sala antiga sai da agenda");
});

test("e-mail do Gmail: ponto e +tag não contam", () => {
  assert.equal(emailKey("Cristiano.Horcel@gmail.com"), "cristianohorcel@gmail.com");
  assert.equal(emailKey("c.horcel+agenda@googlemail.com"), "chorcel@gmail.com");
  assert.equal(emailKey("ana.prado@prado.com"), "ana.prado@prado.com", "fora do Gmail o ponto conta");
});

test("card em Ganho: a marcação liga (e-mail do Gmail com ponto) e o card vai pra Integração", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await repo.create("leads", { id: "cris", saas: "leverads", name: "Cristiano", stage: "Ganho", integrator: "vitor", email: "cristianohorcel@gmail.com", integrationAt: "2026-07-20T11:00" });
  cal.queue.push([booking({ id: "bkc", attendees: [{ email: "eryk@leverads.com.br", self: true }, { email: "cristiano.horcel@gmail.com" }] })]);
  assert.equal(await sync.syncUser(eryk, NOW), 1);
  const cris = await repo.get("leads", "cris");
  assert.equal(cris.stage, "Integração");
  assert.equal(cris.integrator, "eryk", "quem recebeu a marcação integra");
  assert.equal(cris.integrationAt, "2026-10-09T10:00");
  assert.equal(cris.integrationBookedEventId, "bkc");
  const acts = (await repo.list("activities")).filter((a) => a.lead === "cris");
  assert.ok(acts.some((a) => a.type === "stage" && a.meta?.from === "Ganho" && a.meta?.to === "Integração"));
  assert.ok(acts.some((a) => a.meta?.event === "integration_booked" && a.meta.match === "email"));
  assert.ok(!(await repo.list("notifications")).some((n) => /não achei o card/.test(n.text)));
});

test("mesmo e-mail na entrega e no Ganho: vale o card que já está na entrega", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await repo.create("leads", { id: "ana-velha", saas: "leverads", name: "Ana Prado", stage: "Ganho", email: "ana@prado.com" });
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("leads", "ana")).integrationBookedEventId, "bk1");
  assert.equal((await repo.get("leads", "ana-velha")).stage, "Ganho");
});

test("aviso de marcação sem card fica no topo do sino até alguém ligar, mesmo lido e soterrado", async () => {
  const { repo, cal, eryk } = await setup();
  const orphan = booking({ id: "orf", attendees: [{ email: "outro@mail.com" }] });
  const sync = makeBookingSync({ repo, googleUser: { ...gu, getEvent: async () => orphan }, google, fetch: cal.fetch, log: { warn() {} } });
  cal.queue.push([orphan]);
  await sync.syncUser(eryk, NOW);
  const [aviso] = await repo.list("notifications");
  await markNotificationsRead(repo, "eryk", { all: true });
  for (let i = 0; i < 60; i++) await upsertNotification(repo, { user: "eryk", type: "overdue", task: `t${i}`, text: `tarefa ${i}`, key: `k${i}` }, { now: new Date(NOW.getTime() + i * 1000).toISOString() });
  const now = NOW.getTime() + 61_000;
  await repo.update("notifications", aviso.id, { at: NOW.toISOString() }); // o mais velho da caixa
  let list = await listNotifications(repo, "eryk", { now });
  assert.equal(list.items.length, 50);
  assert.equal(list.items[0].id, aviso.id, "no topo, apesar de lido e de 60 avisos mais novos");
  assert.equal(list.items[0].pinned, true);
  assert.ok(!(await listNotifications(repo, "eryk", { unread: true, now })).items.some((n) => n.id === aviso.id), "com o sino fechado (só não lidos) não aparece");
  // 12/11/2026: o horário passar NÃO tira do topo (a marcação de 10/11 sumiu
  // atrás de ~900 avisos antes de alguém ligar ao card).
  mock.timers.setTime(Date.parse(aviso.link.until) + 86_400_000);
  assert.equal((await listNotifications(repo, "eryk")).items[0].id, aviso.id, "horário passou: continua no topo até ligar");
  mock.timers.setTime(NOW.getTime());
  await sync.linkEvent({ userId: "eryk", eventId: "orf", leadId: "bia", now: NOW });
  list = await listNotifications(repo, "eryk", { now });
  assert.ok(!list.items.some((n) => n.id === aviso.id), "ligado a um card, sai do topo");
});

// ── Link mandado pela ficha do cliente (22/10/2026) ─────────────────────────
// O registro (integração ou acompanhamento) espera a marcação; ela entra nas
// reuniões dele, nunca no lead da venda.
async function withCustomer(repo, followup = {}) {
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Prado Pet", email: "ana@prado.com", leadId: "ana" });
  await repo.create("cs_followups", { id: "fu1", customer: "c1", saas: "leverads", kind: "check_in", status: "aberto", meetings: [], ...followup });
}
const waitingLink = { bookingLink: { user: "eryk", label: "Check-in", sentAt: new Date(NOW.getTime() - 3600_000).toISOString() } };

test("link da ficha: a marcação com o e-mail do cliente entra no acompanhamento, com a sala da marcação, e o lead não muda", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await withCustomer(repo, waitingLink);
  cal.queue.push([booking()]);
  assert.equal(await sync.syncUser(eryk, NOW), 1);
  const f = await repo.get("cs_followups", "fu1");
  assert.equal(f.meetings.length, 1);
  assert.equal(f.meetings[0].eventId, "bk1");
  assert.equal(f.meetings[0].meetUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(f.meetings[0].label, "Check-in");
  assert.equal(f.meetings[0].bookedVia, "link");
  assert.equal(f.meetings[0].at, "2026-10-09T13:00:00.000Z");
  assert.equal(f.bookingLink, null, "o registro sai do 'aguardando o cliente marcar'");
  assert.equal((await repo.get("leads", "ana")).integrationAt, undefined, "a ana tem o mesmo e-mail e está em Integração, mas o link foi do registro");
  assert.ok((await repo.list("timeline_events")).some((t) => t.kind === "meeting.scheduled" && t.customer === "c1" && t.data.via === "link"));
  const [n] = await repo.list("notifications");
  assert.match(n.text, /Prado Pet marcou check-in pelo seu link/);
  assert.deepEqual(n.link, { screen: "customers", customer: "c1" });
});

test("link da ficha: sem e-mail igual, liga pelo clique no link curto com ?c=", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await withCustomer(repo, waitingLink);
  assert.equal(await recordBookingClick(repo, { userId: "eryk", customerId: "c1", ua: "Mozilla/5.0", now: new Date(NOW.getTime() - 5 * 60_000) }), true);
  cal.queue.push([booking({ attendees: [{ email: "socio@outra.com" }] })]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("cs_followups", "fu1")).meetings[0]?.eventId, "bk1");
});

test("reunião que o cockpit criou no registro não vira 'integração marcada pelo link' no lead", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await withCustomer(repo, { meetings: [{ id: "mt1", at: "2026-10-09T13:00:00.000Z", status: "scheduled", eventId: "bk1", meetUrl: "https://meet.google.com/abc-defg-hij", responsible: "eryk", organizer: "eryk" }] });
  cal.queue.push([booking({ description: "Check-in do cliente Prado Pet" })]);
  assert.equal(await sync.syncUser(eryk, NOW), 0);
  assert.equal((await repo.get("leads", "ana")).integrationAt, undefined);
  assert.equal((await repo.list("notifications")).length, 0);
});

test("link da ficha: remarcar e cancelar na página do Google acompanham no registro", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await withCustomer(repo, waitingLink);
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  cal.queue.push([booking({ start: { dateTime: "2026-10-10T15:00:00-03:00" } })]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("cs_followups", "fu1")).meetings[0].at, "2026-10-10T18:00:00.000Z");
  cal.queue.push([booking({ status: "cancelled" })]);
  await sync.syncUser(eryk, NOW);
  const m = (await repo.get("cs_followups", "fu1")).meetings[0];
  assert.equal(m.status, "canceled");
  assert.ok((await repo.list("notifications")).some((n) => /cancelou check-in/.test(n.text)));
});

test("link da ficha vencido (mais de 14 dias) não prende a marcação: segue a regra dos cards", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await withCustomer(repo, { bookingLink: { user: "eryk", label: "Check-in", sentAt: new Date(NOW.getTime() - 15 * 86_400_000).toISOString() } });
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await repo.get("cs_followups", "fu1")).meetings.length, 0);
  assert.equal((await repo.get("leads", "ana")).integrationBookedEventId, "bk1");
});

// ── Pré-bloqueio na Agenda e limpar do sino (12/11/2026) ────────────────────
const orphanOf = (over = {}) => booking({ id: "orf", attendees: [{ email: "lukas@mail.com", displayName: "Lukas" }], description: "Agendado por Lukas", ...over });

test("marcação sem card pré-bloqueia o horário na agenda de quem recebeu, até ligar a um card", async () => {
  const { repo, cal, eryk } = await setup();
  const orphan = orphanOf();
  const sync = makeBookingSync({ repo, googleUser: { ...gu, getEvent: async () => orphan }, google, fetch: cal.fetch, log: { warn() {} } });
  cal.queue.push([orphan]);
  await sync.syncUser(eryk, NOW);
  const [hold] = await repo.list("agenda_blocks");
  assert.equal(hold.kind, "event");
  assert.equal(hold.user, "eryk");
  assert.deepEqual(hold.users, ["eryk"]);
  assert.equal(hold.date, "2026-10-09");
  assert.equal(hold.fromHour, 10);
  assert.equal(hold.toHour, 11);
  assert.equal(hold.recur, "once");
  assert.deepEqual(hold.booking, { eventId: "orf", user: "eryk", who: "Lukas", at: "2026-10-09T10:00" });
  assert.match(hold.title, /Lukas marcou pelo link/);

  assert.ok(blockHits(hold, "2026-10-09-10-30"), "a grade do cockpit (SDR, calls) não oferece o horário");
  assert.ok(!blockHits(hold, "2026-10-09-11-00"));

  await sync.linkEvent({ userId: "eryk", eventId: "orf", leadId: "bia", now: NOW });
  assert.equal((await repo.list("agenda_blocks")).length, 0, "ligado ao card: a integração do card ocupa o horário");
  assert.ok(!(await repo.list("notifications")).some((n) => /Conflito/.test(n.text)), "o pré-bloqueio não vira conflito com a própria marcação");
});

test("card com outra integração por vir: a marcação também fica pré-bloqueada", async () => {
  const { repo, cal, sync, eryk } = await setup();
  await repo.update("leads", "ana", { integrationAt: "2026-10-08T09:00", integrationMeetEventId: "ck9", integrationScheduledAt: "2026-10-08T12:00:00.000Z" });
  cal.queue.push([booking()]);
  await sync.syncUser(eryk, NOW);
  const [hold] = await repo.list("agenda_blocks");
  assert.equal(hold.booking.eventId, "bk1");
  assert.equal(hold.saas, "leverads");
  assert.equal(hold.booking.who, "Ana Prado");
});

test("pré-bloqueio acompanha a remarcação e é liberado quando o cliente cancela", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([orphanOf()]);
  await sync.syncUser(eryk, NOW);
  const aviso = (await repo.list("notifications"))[0];

  // Remarcou na página do Google (evento antigo editado): o bloqueio vai junto.
  cal.queue.push([orphanOf({ start: { dateTime: "2026-10-12T14:30:00-03:00" }, end: { dateTime: "2026-10-12T15:30:00-03:00" } })]);
  await sync.syncUser(eryk, new Date(NOW.getTime() + 3600_000));
  const [hold] = await repo.list("agenda_blocks");
  assert.equal(hold.date, "2026-10-12");
  assert.equal(hold.fromHour, 14.5);
  assert.equal(hold.toHour, 15.5);
  assert.equal(hold.weekday, 1);
  assert.equal(hold.booking.at, "2026-10-12T14:30");
  assert.equal((await repo.get("notifications", aviso.id)).link.until, "2026-10-12T17:30:00.000Z");
  const moved = (await repo.list("notifications")).find((n) => /remarcou/.test(n.text));
  assert.match(moved.text, /Lukas remarcou pelo seu link para .*12\/10.*14:30/);
  assert.equal(moved.link.booking, "orf", "o aviso de remarcação também abre a escolha do card");

  // Cancelou (ou apagou o evento): libera a agenda e o aviso sai do topo.
  cal.queue.push([{ id: "orf", status: "cancelled" }]);
  await sync.syncUser(eryk, new Date(NOW.getTime() + 7200_000));
  assert.equal((await repo.list("agenda_blocks")).length, 0);
  assert.equal((await repo.get("notifications", aviso.id)).settled, "cancelled");
  const list = await listNotifications(repo, "eryk");
  assert.ok(!list.items.some((n) => n.pinned), "nada fixo no topo");
  assert.ok(list.items.some((n) => /Lukas cancelou a marcação de .*12\/10.* o horário foi liberado/.test(n.text)));
});

test("removido na Agenda, o pré-bloqueio não volta (nem quando o cliente remarca)", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([orphanOf()]);
  await sync.syncUser(eryk, NOW);
  const [hold] = await repo.list("agenda_blocks");
  await repo.remove("agenda_blocks", hold.id);
  cal.queue.push([orphanOf({ start: { dateTime: "2026-10-12T14:00:00-03:00" }, end: { dateTime: "2026-10-12T15:00:00-03:00" } })]);
  await sync.syncUser(eryk, new Date(NOW.getTime() + 3600_000));
  assert.equal((await repo.list("agenda_blocks")).length, 0);
  // E se o cliente cancela depois, o aviso fixo sai do topo mesmo sem bloqueio.
  cal.queue.push([{ id: "orf", status: "cancelled" }]);
  await sync.syncUser(eryk, new Date(NOW.getTime() + 7200_000));
  assert.ok(!(await listNotifications(repo, "eryk")).items.some((n) => n.pinned));
});

test("limpar do sino: some da lista e do não lido, só os da própria pessoa, e a chave não repete o aviso", async () => {
  const { repo, cal, sync, eryk } = await setup();
  cal.queue.push([orphanOf()]);
  await sync.syncUser(eryk, NOW);
  const aviso = (await repo.list("notifications"))[0];
  await upsertNotification(repo, { user: "eryk", type: "overdue", task: "t1", text: "tarefa 1" });
  await upsertNotification(repo, { user: "vitor", type: "overdue", task: "t2", text: "tarefa 2" });
  assert.equal((await listNotifications(repo, "eryk")).unread, 2);
  const vitorId = (await repo.list("notifications")).find((n) => n.user === "vitor").id;
  assert.equal(await clearNotifications(repo, "eryk", { ids: [aviso.id, vitorId] }), 1, "o da outra pessoa não é limpo");
  const list = await listNotifications(repo, "eryk");
  assert.equal(list.unread, 1);
  assert.deepEqual(list.items.map((n) => n.text), ["tarefa 1"], "o aviso fixo limpo sai do topo");
  assert.equal((await repo.list("agenda_blocks")).length, 1, "a marcação continua pré-bloqueada na Agenda");
  cal.queue.push([orphanOf()]);
  await sync.syncUser(eryk, NOW);
  assert.equal((await listNotifications(repo, "eryk")).items.length, 1, "a mesma marcação não volta pro sino");
  assert.equal(await markNotificationsRead(repo, "eryk", { all: true }), 1);
});

test("horário do pré-bloqueio: sem fim vale 1h; passando da meia-noite fecha o dia", () => {
  assert.deepEqual(holdSlot({ start: { dateTime: "2026-10-09T13:00:00Z" } }), { date: "2026-10-09", fromHour: 10, toHour: 11, weekday: 5 });
  assert.deepEqual(holdSlot({ start: { dateTime: "2026-10-09T23:30:00-03:00" }, end: { dateTime: "2026-10-10T00:30:00-03:00" } }), { date: "2026-10-09", fromHour: 23.5, toHour: 24, weekday: 5 });
});
