// Reuniões com sala de Meet própria num REGISTRO do cliente — a integração
// (Fase 1B-b do plano do Lever CRM) e o acompanhamento de CS (Fase 3). Mesmo
// circuito das consultas 1:1 (consultations.js), sem passar pelo lead:
//   · marcar cria o evento com Meet na conta @leverads do responsável (ou na
//     do time, nos produtos em que ela organiza) e guarda em `meetings[]`;
//   · remarcar move o evento (o convite atualizado vai pro cliente); cancelar
//     apaga o evento;
//   · depois que a reunião acontece, o resumo da IA vira item da timeline do
//     cliente e as pendências do cliente entram no checklist da integração.
// A reunião da implantação inicial que já nasceu no card do lead continua lá
// (integrationAt/integrationCallUrl); esta é a das integrações e acompanhamentos
// que não dependem de lead.

import { randomUUID } from "node:crypto";
import { appendTimeline } from "../events/timeline.js";
import { contactsOf } from "../customers/lifecycle.js";
import { TZ, callMoment, teamMayOrganize, wallClockBrt } from "../google/meet-time.js";
import { integrationSlotConflict } from "../crm/integration-slot.js";
import { formatIntegrationText } from "./call-summaries.js";

export const MEETING_HOSTS = {
  onboardings: { label: "Integração", responsibleField: "integrator" },
  cs_followups: { label: "Acompanhamento", responsibleField: "owner" },
};
const DURATION_MIN = 45;
const MIN = 60_000;
const fail = (statusCode, message, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
const meetCode = (url) => (String(url || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1] || "";

async function loadHost(repo, collection, id) {
  if (!MEETING_HOSTS[collection]) throw fail(400, "Registro sem reunião.");
  const record = await repo.get(collection, id);
  if (!record) throw fail(404, "Registro não encontrado.");
  const customer = await repo.get("customers", record.customer);
  return { record, customer, cfg: MEETING_HOSTS[collection] };
}

// Outra reunião do MESMO responsável sobreposta, nos registros (o conflito com
// o card do lead e a agenda do Google fica com integrationSlotConflict).
async function recordConflict(repo, { responsible, start, skipId }) {
  const end = start + DURATION_MIN * MIN;
  for (const collection of Object.keys(MEETING_HOSTS)) {
    for (const r of await repo.list(collection)) {
      for (const m of r.meetings || []) {
        if (m.id === skipId || m.status !== "scheduled" || m.responsible !== responsible) continue;
        const s = Date.parse(m.at);
        if (Number.isFinite(s) && s < end && s + DURATION_MIN * MIN > start) return r;
      }
    }
  }
  return null;
}

// Data e responsável válidos ANTES de qualquer escrita: a rota da ficha usa
// isto antes de escolher (ou criar) onde a reunião mora.
export async function checkMeetingInput(repo, body = {}, { now = new Date() } = {}) {
  const start = callMoment(body.at);
  if (!start) throw fail(422, "informe data e hora da reunião");
  if (start.getTime() <= now.getTime()) throw fail(422, "a reunião precisa ser no futuro");
  const responsible = String(body.responsible || "").trim();
  if (responsible && !(await repo.get("users", responsible))) throw fail(422, "responsável não encontrado");
  return start;
}

export function makeRecordMeetings({ repo, google, googleUser = null, anthropic = null, log = console }) {
  // Conta que organiza: a do responsável quando pronta pro Meet; senão a do
  // time, só nos produtos em que ela organiza. Sem nenhuma, a reunião fica
  // marcada sem sala e o motivo volta pra tela.
  async function organizerFor(responsible, saas) {
    if (responsible && googleUser && (await googleUser.meetReadyFor(responsible).catch(() => false))) {
      return { client: google.forUser(googleUser, responsible), organizer: responsible };
    }
    if (teamMayOrganize(saas) && google?.configured?.() && (await google.connected().catch(() => false))) return { client: google, organizer: "" };
    return null;
  }

  async function createRoom({ meeting, record, customer, cfg }) {
    const g = await organizerFor(meeting.responsible, customer?.saas);
    if (!g) return { meetError: "o Meet não foi criado: o responsável precisa conectar a conta @leverads em Ajustes → Integrações" };
    const s = new Date(meeting.at);
    const lead = customer?.leadId ? await repo.get("leads", customer.leadId).catch(() => null) : null;
    const attendees = [...new Set([...contactsOf(customer, lead).map((c) => c.email), ...(meeting.guests || [])].filter(emailOk))].slice(0, 15);
    const product = customer?.saas ? await repo.get("products", customer.saas).catch(() => null) : null;
    const { meetUrl, eventId } = await g.client.createMeetEvent({
      summary: `${meeting.label} ${product?.name || "LeverAds"} · ${customer?.name || "cliente"}`,
      description: [`${cfg.label} do cliente ${customer?.name || ""}`, record.notes ? `Notas: ${record.notes}` : ""].filter(Boolean).join("\n"),
      start: { dateTime: wallClockBrt(s), timeZone: TZ },
      end: { dateTime: wallClockBrt(new Date(s.getTime() + DURATION_MIN * MIN)), timeZone: TZ },
      attendees,
      calendarId: "primary",
    });
    const code = meetCode(meetUrl);
    if (code) { try { await g.client.configureSpace(code); } catch { /* sala sem gravação automática, mas existe */ } }
    return { meetUrl, eventId, organizer: g.organizer };
  }

  async function schedule(collection, id, body = {}, { by = "", now = new Date() } = {}) {
    const { record, customer, cfg } = await loadHost(repo, collection, id);
    const start = await checkMeetingInput(repo, body, { now });
    const responsible = String(body.responsible || record[cfg.responsibleField] || "").trim();
    const other = responsible && (await recordConflict(repo, { responsible, start: start.getTime(), skipId: "" }));
    const slot = responsible && !other ? await integrationSlotConflict(repo, googleUser, { lead: null, at: wallClockBrt(start).slice(0, 16), integrator: responsible, now }) : null;
    if (other || slot) throw fail(409, "o responsável já tem compromisso nesse horário: escolha outro", { reason: "slot_taken" });
    const meeting = {
      id: "mt_" + randomUUID(), at: start.toISOString(), label: String(body.label || cfg.label).slice(0, 60),
      responsible, guests: (Array.isArray(body.guests) ? body.guests : []).filter(emailOk).slice(0, 10),
      status: "scheduled", createdAt: now.toISOString(), by, meetUrl: "", eventId: "", organizer: "",
    };
    let meetError = "";
    try { Object.assign(meeting, await createRoom({ meeting, record, customer, cfg })); }
    catch (err) { meetError = String(err.message || err).slice(0, 300); }
    if (meeting.meetError) { meetError = meeting.meetError; delete meeting.meetError; }
    await repo.update(collection, id, { meetings: [...(record.meetings || []), meeting] });
    await appendTimeline(repo, {
      id: `tl:meeting:${meeting.id}`, kind: "meeting.scheduled", source: "cockpit", at: now.toISOString(),
      customer: record.customer, lead: record.lead || "", data: { host: collection, record: id, at: meeting.at, label: meeting.label, meetUrl: meeting.meetUrl },
    });
    return { meeting, meetError };
  }

  async function update(collection, id, meetingId, fn) {
    const { record, customer } = await loadHost(repo, collection, id);
    const meeting = (record.meetings || []).find((m) => m.id === meetingId);
    if (!meeting) throw fail(404, "Reunião não encontrada.");
    const patch = await fn(meeting, customer);
    const meetings = record.meetings.map((m) => (m.id === meetingId ? { ...m, ...patch } : m));
    await repo.update(collection, id, { meetings });
    return { ...meeting, ...patch };
  }

  async function clientOf(meeting) {
    if (meeting.organizer && googleUser) return google.forUser(googleUser, meeting.organizer);
    return (await google.connected().catch(() => false)) ? google : null;
  }

  async function reschedule(collection, id, meetingId, body = {}, { now = new Date() } = {}) {
    return update(collection, id, meetingId, async (meeting) => {
      const start = callMoment(body.at);
      if (!start || start.getTime() <= now.getTime()) throw fail(422, "a reunião precisa ser no futuro");
      if (await recordConflict(repo, { responsible: meeting.responsible, start: start.getTime(), skipId: meeting.id })) throw fail(409, "o responsável já tem compromisso nesse horário: escolha outro", { reason: "slot_taken" });
      const g = meeting.eventId ? await clientOf(meeting) : null;
      if (g) {
        await g.patchCalendarEvent(meeting.eventId, {
          start: { dateTime: wallClockBrt(start), timeZone: TZ },
          end: { dateTime: wallClockBrt(new Date(start.getTime() + DURATION_MIN * MIN)), timeZone: TZ },
        });
      }
      return { at: start.toISOString() };
    });
  }

  async function cancel(collection, id, meetingId) {
    return update(collection, id, meetingId, async (meeting) => {
      const g = meeting.eventId ? await clientOf(meeting) : null;
      if (g) { try { await g.deleteCalendarEvent(meeting.eventId); } catch { /* o cancelamento aqui vale */ } }
      return { status: "canceled", canceledAt: new Date().toISOString() };
    });
  }

  // Pendência que a IA atribuiu ao cliente vira item do checklist (lado
  // cliente), sem repetir título que já está lá.
  async function pendingToChecklist(collection, id, summary) {
    if (collection !== "onboardings" || !Array.isArray(summary?.pendencias)) return;
    const record = await repo.get(collection, id);
    const have = new Set((record.items || []).map((i) => i.title.trim().toLowerCase()));
    const add = summary.pendencias
      .filter((p) => p?.item && !have.has(String(p.item).trim().toLowerCase()))
      .map((p) => ({ id: "it_" + randomUUID().slice(0, 8), title: String(p.item).slice(0, 200), side: /client/i.test(p.responsavel || "") ? "cliente" : "lever", owner: "", dueAt: "", doneAt: "" }));
    if (add.length) await repo.update(collection, id, { items: [...(record.items || []), ...add] });
  }

  async function summarize(collection, id, meetingId, { force = false } = {}) {
    if (!anthropic?.configured?.()) return { ok: false, reason: "not_configured" };
    const { record, customer } = await loadHost(repo, collection, id);
    const meeting = (record.meetings || []).find((m) => m.id === meetingId);
    if (!meeting) return { ok: false, reason: "not_found" };
    if (meeting.summaryAt && !force) return { ok: false, reason: "already_done" };
    const code = meetCode(meeting.meetUrl);
    if (!code) return { ok: false, reason: "no_meet" };
    const g = await clientOf(meeting);
    if (!g) return { ok: false, reason: "not_connected" };
    let t = null;
    try { t = await g.fetchTranscript(code); if (t?.live) return { ok: false, reason: "call_in_progress" }; } catch (err) { log.warn?.(`reunião ${meetingId}: Meet falhou: ${err.message}`); }
    if (!t && typeof g.fetchTranscriptFromDrive === "function") {
      try { t = await g.fetchTranscriptFromDrive({ eventId: meeting.eventId, leadName: customer?.name || "", since: meeting.at }); } catch { /* segue sem */ }
    }
    if (!t) return { ok: false, reason: "transcript_not_ready" };
    const { summary } = await anthropic.summarizeIntegration({
      transcript: t.text, lead: { name: customer?.contact || customer?.name || "", company: customer?.name || "" },
      productName: customer?.saas || "LeverAds", callDate: meeting.at, today: new Date().toISOString(),
    });
    const at = t.endTime || new Date().toISOString();
    await update(collection, id, meetingId, async () => ({ summary, summaryAt: new Date().toISOString(), recordingUrl: t.recordingUrl || "" }));
    await appendTimeline(repo, {
      id: `tl:meeting-summary:${meetingId}`, kind: "meeting.summarized", source: "cockpit", at,
      customer: record.customer, lead: record.lead || "", data: { host: collection, record: id, text: formatIntegrationText(summary), recordingUrl: t.recordingUrl || "" },
    });
    try { await pendingToChecklist(collection, id, summary); } catch { /* o resumo já está gravado */ }
    return { ok: true, summary };
  }

  // Reuniões que terminaram há pelo menos 50 min (até 7 dias) e ainda sem resumo.
  async function tick({ now = Date.now() } = {}) {
    if (!anthropic?.configured?.()) return { scanned: 0, summarized: 0 };
    let scanned = 0, summarized = 0;
    for (const collection of Object.keys(MEETING_HOSTS)) {
      for (const r of await repo.list(collection)) {
        for (const m of r.meetings || []) {
          const s = Date.parse(m.at);
          if (m.status !== "scheduled" || m.summaryAt || !m.meetUrl || !(s + 50 * MIN < now && s > now - 7 * 86_400_000)) continue;
          scanned++;
          try { if ((await summarize(collection, r.id, m.id)).ok) summarized++; }
          catch (err) { log.warn?.(`resumo da reunião ${m.id} falhou: ${err.message}`); }
        }
      }
    }
    return { scanned, summarized };
  }

  return { schedule, reschedule, cancel, summarize, tick };
}

// Todas as reuniões dos registros de um cliente, da mais nova pra mais velha,
// com o registro que as hospeda (a ficha mostra a próxima e o último resumo).
export async function meetingsOfCustomer(repo, customerId) {
  const out = [];
  for (const [collection, cfg] of Object.entries(MEETING_HOSTS)) {
    for (const r of await repo.listWhere(collection, { customer: customerId })) {
      for (const m of r.meetings || []) out.push({ ...m, host: { collection, id: r.id, label: cfg.label } });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function startRecordMeetingSummaries(repo, { google, googleUser, anthropic, log, intervalMs = 600_000 } = {}) {
  const meetings = makeRecordMeetings({ repo, google, googleUser, anthropic, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await meetings.tick(); } catch (err) { log?.warn?.(`resumo de reuniões: ${err.message}`); } finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), run };
}
