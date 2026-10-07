// Marcação pelo link de convite → card (07/10/2026). Quando o cliente marca um
// horário na página de agendamento do Google (users.bookingUrl, mandada pelo
// link curto /a/:id), o Google cria o evento na agenda de quem integra, com o
// cliente convidado e a sala do Meet. Esta rotina lê as MUDANÇAS da agenda de
// cada integrador com link cadastrado (leitura incremental por syncToken: sem
// novidade, a resposta vem vazia) e liga o evento ao card:
//   1. e-mail do convidado = e-mail do lead;
//   2. telefone escrito na marcação = telefone do lead;
//   3. o lead que clicou no link curto desse integrador nas últimas 48h
//      (lead.bookingClick, gravado pelo /a/:id?l=…), se for um só.
// Ligado, o card ganha integrationAt e usa a SALA DA MARCAÇÃO (eventId, link e
// organizador = o integrador): o autoIntegrationMeet não cria outra e o espelho
// da agenda pessoal não duplica o bloco. Remarcar ou cancelar na página do
// Google acompanha no card. Marcação sem card vira aviso pra quem integra.
//
// Ritmo: passe a cada 2 min; cada agenda é lida a cada 15 min, ou a cada passe
// nas 24h depois de um clique no link dela (quando a marcação é provável).

import { toNaiveBrt } from "../crm/agenda-slots.js";
import { appointmentAt, logActivity } from "../crm/lead-flow.js";
import { kindOf } from "../crm/stages.js";
import { upsertNotification } from "../tasks/tasks-core.js";
import { waMatchKey } from "../whatsapp/wa-store.js";
import { syncPersonalCalendar } from "./google-user.js";
import { integrationSlotConflict } from "../crm/integration-slot.js";

const CAL_URL = "https://www.googleapis.com/calendar/v3";
const MIN = 60_000;
export const BOOKING_TICK_MS = 2 * MIN;
const IDLE_MS = 15 * MIN;          // agenda sem clique recente
const HOT_MS = 24 * 60 * MIN;      // janela "quente" depois de um clique no link
const CLICK_MATCH_MS = 48 * 60 * MIN;
const stateId = (userId) => `booking_sync_${userId}`;
const TZ = "America/Sao_Paulo";

// Clique no link curto (/a/:id?l=lead): marca o lead e esquenta a agenda de
// quem integra. Robô de preview (WhatsApp, Facebook…) não conta como clique.
const BOT_UA = /whatsapp|facebookexternalhit|facebot|bot\b|crawler|spider|preview|slack|telegram|discord|skype/i;
export async function recordBookingClick(repo, { userId, leadId, ua = "", now = new Date() }) {
  if (!userId || !leadId || BOT_UA.test(String(ua))) return false;
  const lead = await repo.get("leads", String(leadId)).catch(() => null);
  if (!lead) return false;
  const at = now.toISOString();
  const prev = Date.parse(lead.bookingClick?.at || "");
  if (lead.bookingClick?.user === userId && Number.isFinite(prev) && now.getTime() - prev < MIN) return false;
  await repo.update("leads", lead.id, { bookingClick: { user: userId, at } });
  const st = await repo.get("app_config", stateId(userId)).catch(() => null);
  if (st) await repo.update("app_config", st.id, { lastClickAt: at });
  else await repo.create("app_config", { id: stateId(userId), lastClickAt: at });
  return true;
}

// Telefones escritos no evento (o formulário da marcação pode pedir): sequências
// de 10+ dígitos, normalizadas como o WhatsApp do cockpit compara.
export function phonesIn(text) {
  return [...String(text || "").matchAll(/\+?\d[\d\s().-]{8,}\d/g)]
    .map((m) => m[0].replace(/\D/g, ""))
    .filter((d) => d.length >= 10 && d.length <= 13)
    .map((d) => waMatchKey(d.length <= 11 ? `55${d}` : d));
}

const whenLabel = (naive) => {
  const d = new Date(`${naive}:00-03:00`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : naive;
};
const meetOf = (ev) => ev.hangoutLink || (ev.conferenceData?.entryPoints || []).find((e) => e.entryPointType === "video")?.uri || "";

export function makeBookingSync({ repo, googleUser: gu, google = null, fetch: f = globalThis.fetch, log = console } = {}) {
  const active = (u) => !!(u?.bookingUrl && u?.google?.refreshToken);

  async function listChanges(userId, syncToken) {
    const token = await gu.accessToken(userId);
    const items = [];
    let pageToken = "";
    for (let page = 0; page < 40; page++) {
      const q = new URLSearchParams({ maxResults: syncToken ? "250" : "2500" });
      if (syncToken) q.set("syncToken", syncToken);
      if (pageToken) q.set("pageToken", pageToken);
      const res = await f(`${CAL_URL}/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 410) return { gone: true };
      const b = await res.json().catch(() => ({}));
      if (res.status >= 400 || b.error) throw new Error(`Calendar -> ${res.status}: ${b.error?.message || "falha ao ler a agenda"}`);
      items.push(...(b.items || []));
      if (b.nextPageToken) { pageToken = b.nextPageToken; continue; }
      return { items, nextSyncToken: b.nextSyncToken || "" };
    }
    throw new Error("Calendar: paginação longa demais");
  }

  async function notify(user, key, text, link, saas = "") {
    const dup = await repo.listWhere("notifications", { key }, { fields: [] }).catch(() => []);
    if (dup.length) return;
    await upsertNotification(repo, { user, task: "", taskTitle: "", saas, by: "api", key, type: "integration_booking", text, link });
  }

  // O que o cockpit já conhece (eventos que ELE criou): nunca são marcação.
  async function knownEventIds() {
    const ids = new Set();
    for (const l of await repo.list("leads")) for (const k of ["meetEventId", "integrationMeetEventId", "calCallEventId", "calIntegEventId"]) if (l[k]) ids.add(l[k]);
    for (const c of await repo.list("consultations").catch(() => [])) for (const k of ["meetEventId", "calEventId"]) if (c[k]) ids.add(c[k]);
    return ids;
  }

  async function applyBooking(user, lead, ev, why, now) {
    const when = toNaiveBrt(ev.start.dateTime);
    const meetUrl = meetOf(ev);
    const product = lead.saas ? await repo.get("products", lead.saas).catch(() => null) : null;
    const patch = {
      integrationAt: when, integrator: user.id, integrationConfirmed: false,
      integrationBookedVia: "link", integrationBookedAt: now.toISOString(), integrationBookedEventId: ev.id,
      integrationLinkSentAt: "", // o cliente marcou: o card sai do "aguardando o cliente marcar"
      // A sala é a da marcação: sem link do Meet, o cockpit cria a dele depois.
      ...(meetUrl ? { integrationCallUrl: meetUrl, integrationMeetEventId: ev.id, integrationScheduledAt: new Date(ev.start.dateTime).toISOString(), integrationMeetOrganizer: user.id } : {}),
    };
    const next = appointmentAt(product, { ...lead, ...patch });
    if (next) patch.nextActionAt = next;
    const fresh = await repo.update("leads", lead.id, patch);
    // Sala aberta + gravação/transcrição (o resumo da integração depende disso).
    const code = (meetUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
    if (code && google?.forUser) { try { await google.forUser(gu, user.id).configureSpace(code); } catch { /* best-effort */ } }
    try { await syncPersonalCalendar(repo, gu, fresh); } catch { /* o organizador é o integrador: não espelha */ }
    await logActivity(repo, {
      saas: lead.saas || "", lead: lead.id, type: "system", author: "cockpit",
      text: `Cliente marcou a integração pelo link de convite: ${whenLabel(when)} com ${user.name || user.id}`,
      meta: { event: "integration_booked", at: when, eventId: ev.id, match: why },
    });
    await notify(user.id, `booking:${ev.id}:${when}`, `${lead.name || "Cliente"} marcou a integração pelo seu link: ${whenLabel(when)}`, { screen: "today", lead: lead.id }, lead.saas || "");
    // Operador e cliente no mesmo horário ao mesmo tempo (a grade e a conferência
    // ao salvar fecham quase tudo; sobra o empate no mesmo instante): avisa.
    const clash = await integrationSlotConflict(repo, null, { lead: fresh, at: when, integrator: user.id, now });
    if (clash?.lead) {
      await notify(user.id, `booking-clash:${ev.id}:${when}`,
        `Conflito: ${lead.name || "um cliente"} marcou ${whenLabel(when)} pelo seu link e ${clash.lead.name || "outro cliente"} já está nesse horário: remarque um dos dois`,
        { screen: "today", lead: lead.id }, lead.saas || "");
    }
  }

  // Evento que JÁ é de um card marcado pelo link: remarcação ou cancelamento na
  // página do Google acompanham no card.
  async function followBooked(user, lead, ev) {
    if (ev.status === "cancelled") {
      // Desmarcada pelo próprio cockpit (cancelIntegrationMeet apagou o evento):
      // o card já está sem horário, então só solta o vínculo, sem "cliente cancelou".
      if (!lead.integrationAt) { await repo.update("leads", lead.id, { integrationBookedVia: "", integrationBookedEventId: "" }); return; }
      await repo.update("leads", lead.id, {
        integrationAt: "", integrationCallUrl: "", integrationMeetEventId: "", integrationScheduledAt: "",
        integrationMeetOrganizer: "", integrationConfirmed: false, integrationBookedVia: "", integrationBookedEventId: "",
      });
      await logActivity(repo, { saas: lead.saas || "", lead: lead.id, type: "system", author: "cockpit", text: "Cliente cancelou a integração marcada pelo link de convite", meta: { event: "integration_booking_cancelled", eventId: ev.id } });
      await notify(user.id, `booking-cancel:${ev.id}`, `${lead.name || "Cliente"} cancelou a integração marcada pelo seu link`, { screen: "today", lead: lead.id }, lead.saas || "");
      return;
    }
    if (!ev.start?.dateTime) return;
    const when = toNaiveBrt(ev.start.dateTime);
    if (when === lead.integrationAt) return;
    const product = lead.saas ? await repo.get("products", lead.saas).catch(() => null) : null;
    const patch = { integrationAt: when, integrationScheduledAt: new Date(ev.start.dateTime).toISOString(), integrationConfirmed: false };
    const next = appointmentAt(product, { ...lead, ...patch });
    if (next) patch.nextActionAt = next;
    await repo.update("leads", lead.id, patch);
    await logActivity(repo, { saas: lead.saas || "", lead: lead.id, type: "system", author: "cockpit", text: `Cliente remarcou a integração pelo link de convite: ${whenLabel(when)}`, meta: { event: "integration_booking_moved", at: when, eventId: ev.id } });
    await notify(user.id, `booking-move:${ev.id}:${when}`, `${lead.name || "Cliente"} remarcou a integração pelo seu link: ${whenLabel(when)}`, { screen: "today", lead: lead.id }, lead.saas || "");
  }

  // Texto que a página de agendamento do Google põe no evento. Junto com o
  // clique recente, é o que separa a marcação de uma reunião que o próprio
  // integrador criou com convidado de fora (essa não vira aviso).
  const BOOKING_TEXT = /(reservad[oa]|agendad[oa]|marcad[oa]) por|booked by|appointment|agendamento/i;

  async function processEvents(user, items, since, now, clickedRecently = false) {
    if (!items.length) return 0;
    const leads = await repo.list("leads");
    const products = new Map((await repo.list("products")).map((p) => [p.id, p]));
    const inDelivery = (l) => ["integracao", "posvenda"].includes(kindOf(products.get(l.saas), l.stage));
    let known = null;
    let done = 0;
    for (const ev of items) {
      const booked = leads.find((l) => l.integrationBookedVia === "link" && l.integrationBookedEventId === ev.id && l.integrator === user.id);
      if (booked) { await followBooked(user, booked, ev); done++; continue; }
      if (ev.status === "cancelled" || !ev.start?.dateTime) continue;
      const created = Date.parse(ev.created || "");
      if (!Number.isFinite(created) || created <= since) continue;            // evento antigo editado
      if (ev.organizer && ev.organizer.self === false) continue;              // convite de terceiros
      if (Date.parse(ev.start.dateTime) <= now.getTime()) continue;           // já passou
      const guests = (ev.attendees || []).filter((a) => !a.self && !a.resource && a.email);
      if (!guests.length) continue;
      if (/^Lead: /.test(String(ev.description || ""))) continue;              // Meet/espelho do cockpit (id ainda não gravado)
      known ||= await knownEventIds();
      if (known.has(ev.id)) continue;                                         // criado pelo cockpit

      const emails = new Set(guests.map((a) => String(a.email).toLowerCase()));
      const phones = new Set(phonesIn(`${ev.description || ""}\n${ev.location || ""}`));
      const pool = leads.filter(inDelivery);
      const mine = (list) => (list.length > 1 ? list.filter((l) => l.integrator === user.id) : list);
      let why = "email";
      let hit = mine(pool.filter((l) => l.email && emails.has(String(l.email).toLowerCase())));
      if (hit.length !== 1) { why = "telefone"; hit = mine(pool.filter((l) => l.phone && phones.has(waMatchKey(l.phone)))); }
      if (hit.length !== 1) {
        why = "clique";
        hit = pool.filter((l) => {
          const t = Date.parse(l.bookingClick?.at || "");
          return l.bookingClick?.user === user.id && Number.isFinite(t) && t <= created + 10 * MIN && created - t <= CLICK_MATCH_MS;
        });
      }
      const who = guests.map((a) => a.displayName || a.email).join(", ");
      const lead = hit.length === 1 ? hit[0] : null;
      // Card que já tem OUTRA integração por vir: não pisa; avisa quem integra.
      const busy = lead && lead.integrationMeetEventId && lead.integrationMeetEventId !== ev.id && Date.parse(lead.integrationScheduledAt || "") > now.getTime();
      if (lead && !busy) { await applyBooking(user, lead, ev, why, now); done++; continue; }
      if (!busy && !clickedRecently && !BOOKING_TEXT.test(`${ev.summary || ""}
${ev.description || ""}`)) continue;
      const when = whenLabel(toNaiveBrt(ev.start.dateTime));
      const text = busy
        ? `${lead.name || who} marcou pelo seu link (${when}), mas o card já tem integração marcada: confira qual vale`
        : `${who} marcou ${when} pelo seu link de convite e não achei o card: toque para ligar a um card`;
      // Sem card: o aviso leva o evento, e o sino abre a escolha do card (linkEvent).
      await notify(user.id, `booking-orphan:${ev.id}`, text, busy ? { screen: "today", lead: lead.id } : { screen: "today", booking: ev.id, bookingUser: user.id }, lead?.saas || "");
      done++;
    }
    return done;
  }

  async function syncUser(user, now = new Date()) {
    const id = stateId(user.id);
    const st = await repo.get("app_config", id).catch(() => null);
    const save = (patch) => (st ? repo.update("app_config", id, patch) : repo.create("app_config", { id, ...patch }));
    const at = now.toISOString();
    if (!st?.syncToken) {
      // Primeira leitura: só guarda o ponto de partida. O que já estava na
      // agenda não é marcação nova.
      const r = await listChanges(user.id, "");
      if (r.gone) return 0;
      await save({ syncToken: r.nextSyncToken, since: at, at });
      return 0;
    }
    let r = await listChanges(user.id, st.syncToken);
    let since = Date.parse(st.since || st.at || at);
    if (r.gone) {
      // Token vencido: relê tudo e trata como novo só o criado depois da última leitura.
      r = await listChanges(user.id, "");
      since = Date.parse(st.at || at);
    }
    const clicked = now.getTime() - Date.parse(st.lastClickAt || "") < CLICK_MATCH_MS;
    const n = await processEvents(user, r.items || [], since, now, clicked);
    await save({ syncToken: r.nextSyncToken || st.syncToken, at });
    return n;
  }

  async function tick(now = new Date()) {
    if (!gu?.configured?.()) return { users: 0 };
    let users = 0;
    for (const u of await repo.list("users")) {
      if (!active(u)) continue;
      const st = await repo.get("app_config", stateId(u.id)).catch(() => null);
      const last = Date.parse(st?.at || "");
      const hot = now.getTime() - Date.parse(st?.lastClickAt || "") < HOT_MS;
      if (Number.isFinite(last) && now.getTime() - last < (hot ? BOOKING_TICK_MS - 5000 : IDLE_MS)) continue;
      try { await syncUser(u, now); users++; }
      catch (err) { log.warn?.({ err: err.message, user: u.id }, "agenda do link de convite: leitura falhou"); }
    }
    return { users };
  }

  // Ligar À MÃO a marcação sem card (o aviso do sino → escolher o card). Lê o
  // evento ao vivo no Google e liga igual à ligação automática: horário, sala da
  // marcação, atividade. Devolve { lead } ou { code, error }.
  async function linkEvent({ userId, eventId, leadId, by = "", now = new Date() }) {
    const user = await repo.get("users", String(userId || ""));
    if (!user?.google?.refreshToken) return { code: 422, error: "quem recebeu a marcação não está com o Google conectado" };
    const lead = await repo.get("leads", String(leadId || ""));
    if (!lead) return { code: 404, error: "card não encontrado" };
    const ev = await gu.getEvent(user.id, String(eventId || ""));
    if (!ev || ev.status === "cancelled") return { code: 410, error: "essa marcação foi cancelada ou apagada na agenda do Google" };
    if (!ev.start?.dateTime) return { code: 422, error: "a marcação não tem horário" };
    const other = (await repo.listWhere("leads", { integrationBookedEventId: ev.id })).find((l) => l.id !== lead.id);
    if (other) return { code: 409, error: `essa marcação já está ligada ao card de ${other.name || "outro cliente"}` };
    const ahead = lead.integrationMeetEventId && lead.integrationMeetEventId !== ev.id && Date.parse(lead.integrationScheduledAt || "") > now.getTime();
    if (ahead) return { code: 409, error: "esse card já tem outra integração marcada: desmarque antes de ligar esta" };
    await applyBooking(user, lead, ev, by ? `manual:${by}` : "manual", now);
    for (const n of await repo.listWhere("notifications", { key: `booking-orphan:${ev.id}` }).catch(() => [])) {
      if (!n.read) await repo.update("notifications", n.id, { read: true, readAt: now.toISOString() }).catch(() => {});
    }
    return { lead: await repo.get("leads", lead.id) };
  }

  return { tick, syncUser, linkEvent };
}

export function startBookingSync(repo, { googleUser, google, log = console, intervalMs = BOOKING_TICK_MS } = {}) {
  if (!googleUser) return null;
  const worker = makeBookingSync({ repo, googleUser, google, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await worker.tick(); }
    catch (err) { log.warn?.({ err: err.message }, "rotina do link de convite falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 30_000).unref?.();
  return { stop: () => clearInterval(timer), run };
}
