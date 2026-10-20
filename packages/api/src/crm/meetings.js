// Call de venda como registro próprio — Fase 2 do plano do Lever CRM.
//
// A call continua sendo MARCADA nos campos do lead (callAt, callUrl,
// meetEventId), porque é deles que a sala do Meet, o resumo da IA, a Agenda e
// o robô de SDR dependem. Este módulo espelha cada call numa linha de
// `meetings`, com id fixo por lead × horário, e dá a ela um estado:
//
//   agendada   horário no futuro
//   realizada  horário passou (e o lead não caiu no no-show depois dela)
//   no_show    o lead entrou numa etapa de no-show depois do horário
//   remarcada  era agendada e o horário saiu do lead antes de acontecer
//
// O espelho roda no PATCH do lead e numa rotina periódica (o robô de SDR grava
// o lead direto, sem passar pela rota). Idempotente: rodar de novo não duplica
// nem regrava o que não mudou.

import { isNoShowStage } from "./stages.js";

export const MEETINGS = "meetings";
export const MEETING_STATUSES = ["agendada", "realizada", "no_show", "remarcada"];

// "YYYY-MM-DDTHH:MM" (hora de Brasília, sem fuso) ou ISO → instante.
export function momentOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(/([Zz]|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}${s.length === 16 ? ":00" : ""}-03:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const meetingId = (leadId, at) => `mt_${leadId}_${at.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

// Estado de uma call que ainda está no lead.
function statusOf(lead, at, now) {
  if (at.getTime() > now) return "agendada";
  const since = Date.parse(lead.stageSince || "");
  if (isNoShowStage(lead.stage) && Number.isFinite(since) && since >= at.getTime()) return "no_show";
  return "realizada";
}

// As calls que o lead carrega hoje: as arquivadas (já passaram) e a atual.
export function callsOfLead(lead, { now = Date.now() } = {}) {
  const out = [];
  for (const h of Array.isArray(lead.callHistory) ? lead.callHistory : []) {
    const at = momentOf(h?.at);
    if (at) out.push({ at, closer: h.closer || lead.closer || "", status: "realizada", current: false });
  }
  const cur = momentOf(lead.callAt);
  if (cur) out.push({ at: cur, closer: lead.closer || "", status: statusOf(lead, cur, now), current: true });
  return out;
}

const same = (a, b) => ["status", "closer", "meetUrl", "eventId", "summarized"].every((k) => (a[k] ?? "") === (b[k] ?? ""));

export async function syncLeadMeetings(repo, lead, { now = Date.now() } = {}) {
  if (!lead?.id) return { written: 0 };
  const nowIso = new Date(now).toISOString();
  const existing = new Map((await repo.listWhere(MEETINGS, { lead: lead.id })).map((m) => [m.id, m]));
  const seen = new Set();
  let written = 0;
  for (const c of callsOfLead(lead, { now })) {
    const id = meetingId(lead.id, c.at);
    seen.add(id);
    const want = {
      lead: lead.id, saas: lead.saas || "", customer: lead.customerId || "", kind: "call",
      at: c.at.toISOString(), closer: c.closer, status: c.status,
      meetUrl: c.current ? lead.callUrl || "" : (existing.get(id)?.meetUrl || ""),
      eventId: c.current ? lead.meetEventId || "" : (existing.get(id)?.eventId || ""),
      summarized: Boolean(c.current && lead.callSummaryFor && lead.callSummaryFor === lead.meetEventId) || Boolean(existing.get(id)?.summarized),
    };
    const prev = existing.get(id);
    if (!prev) { await repo.create(MEETINGS, { id, ...want, createdAt: nowIso, statusAt: nowIso }); written++; continue; }
    if (!same(prev, want)) { await repo.update(MEETINGS, id, { ...want, ...(prev.status !== want.status ? { statusAt: nowIso } : {}) }, { silent: true }); written++; }
  }
  // Agendada que sumiu do lead antes de acontecer = remarcada (ou desmarcada).
  for (const [id, m] of existing) {
    if (seen.has(id) || m.status !== "agendada") continue;
    await repo.update(MEETINGS, id, { status: "remarcada", statusAt: nowIso }, { silent: true });
    written++;
  }
  return { written };
}

export async function runMeetingsSweep(repo, { now = Date.now() } = {}) {
  let written = 0;
  for (const l of await repo.list("leads")) {
    if (!l.callAt && !(l.callHistory || []).length) continue;
    written += (await syncLeadMeetings(repo, l, { now })).written;
  }
  return { written };
}

// Placar das calls por closer num período: marcadas, realizadas, no-show e a
// taxa de comparecimento (realizadas ÷ realizadas + no-show).
export async function meetingsReport(repo, { from = "", to = "", saas = "" } = {}) {
  const rows = (await repo.list(MEETINGS)).filter((m) => (!saas || m.saas === saas) && (!from || m.at >= from) && (!to || m.at < to));
  const by = new Map();
  for (const m of rows) {
    const k = m.closer || "";
    const r = by.get(k) || { closer: k, total: 0, agendada: 0, realizada: 0, no_show: 0, remarcada: 0 };
    r.total++;
    r[m.status] = (r[m.status] || 0) + 1;
    by.set(k, r);
  }
  const closers = [...by.values()].map((r) => ({ ...r, comparecimento: r.realizada + r.no_show ? Math.round((r.realizada / (r.realizada + r.no_show)) * 100) : null }))
    .sort((a, b) => b.total - a.total);
  return { closers, total: rows.length };
}

export function startMeetingsSweep(repo, { log, intervalMs = 15 * 60_000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try { return await runMeetingsSweep(repo); } catch (err) { log?.warn?.(`calls: ${err.message}`); return null; } finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  const first = setTimeout(run, 60_000);
  first.unref?.();
  return () => { clearInterval(timer); clearTimeout(first); };
}
