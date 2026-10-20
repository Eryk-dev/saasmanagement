// Caixa de entrada de eventos dos produtos da Lever (LeverAds, LeverId,
// LeverPrice…) — Fase 1.1 do plano do Lever CRM. Os produtos não escrevem no
// banco do cockpit: publicam eventos assinados, e o cockpit grava cada um UMA
// vez (idempotência por emissor + event_id), casa com cliente/lead e põe na
// timeline imutável (timeline.js).
//
// Contrato do envio (POST /public/events/v1):
//   headers  x-lever-source     emissor (leverads, leverid, leverprice…)
//            x-lever-timestamp  instante do envio em ms (janela de 5 min)
//            x-lever-signature  hex(HMAC-SHA256(segredo, `${timestamp}.${corpo cru}`))
//   corpo    { event_id, type, occurred_at, lever_id?, org_id?, product?,
//              subject?: { email?, phone? }, payload? }
// O segredo de cada emissor vem de LEVER_EVENTS_SECRET_<EMISSOR> (maiúsculas).
// Sem segredo configurado, aquele emissor é recusado.
//
// Estados do registro em `crm_events`: pending → processed | unmatched | failed.
// unmatched (ninguém casou) e failed (erro) voltam a ser tentados pelo runner
// com espera crescente, até MAX_ATTEMPTS — o evento nunca se perde.

import crypto from "node:crypto";
import { findDuplicateLead } from "../crm/lead-dedup.js";
import { appendTimeline } from "./timeline.js";

export const EVENTS = "crm_events";
export const MAX_ATTEMPTS = 8;
const TOLERANCE_MS = 5 * 60_000;
const SOURCE_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const MAX_PAYLOAD_BYTES = 16 * 1024;

export const secretFor = (source, env = process.env) =>
  SOURCE_RE.test(source || "") ? String(env[`LEVER_EVENTS_SECRET_${source.toUpperCase().replace(/-/g, "_")}`] || "") : "";

// Assinatura em tempo constante; timestamp fora da janela = reenvio velho.
export function verifySignature({ rawBody, timestamp, signature, secret, now = Date.now() }) {
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_MS) return false;
  const body = rawBody || Buffer.alloc(0);
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  const a = Buffer.from(String(signature));
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Valida o envelope e devolve o registro a gravar, ou { error }.
export function parseEnvelope(body, source) {
  const b = body && typeof body === "object" ? body : {};
  if (!EVENT_ID_RE.test(b.event_id || "")) return { error: "event_id inválido" };
  if (!TYPE_RE.test(b.type || "")) return { error: "type inválido (ex.: workspace.created)" };
  const occurred = new Date(b.occurred_at || "");
  if (Number.isNaN(occurred.getTime())) return { error: "occurred_at inválido" };
  const payload = b.payload && typeof b.payload === "object" ? b.payload : {};
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) return { error: "payload acima de 16 KB" };
  const subject = b.subject && typeof b.subject === "object" ? b.subject : {};
  return {
    record: {
      id: `${source}:${b.event_id}`,
      source, eventId: b.event_id, type: b.type,
      occurredAt: occurred.toISOString(),
      leverId: str(b.lever_id, 64), orgId: str(b.org_id, 64), product: str(b.product, 40),
      subject: { email: str(subject.email, 200).toLowerCase(), phone: str(subject.phone, 40) },
      payload,
    },
  };
}

// Grava o evento uma vez só. Reenvio do mesmo emissor+event_id não regrava nem
// reprocessa: devolve { duplicate: true } e o estado atual.
export async function ingestEvent(repo, record, { now = new Date() } = {}) {
  const existing = await repo.get(EVENTS, record.id);
  if (existing) return { event: existing, duplicate: true };
  try {
    const event = await repo.create(EVENTS, {
      ...record, status: "pending", attempts: 0, error: "",
      receivedAt: now.toISOString(), nextAttemptAt: now.toISOString(),
    });
    return { event, duplicate: false };
  } catch (err) {
    // Dois envios simultâneos: o segundo bate na PK. É duplicata, não erro.
    const raced = await repo.get(EVENTS, record.id);
    if (raced) return { event: raced, duplicate: true };
    throw err;
  }
}

const norm = (v) => String(v || "").trim().toLowerCase();

// A quem o evento pertence. org_id → cliente pelo vínculo com o produto;
// lever_id → lead que já carrega esse LeverId; e-mail/telefone → lead do
// produto (mesma régua do dedup). O lead do cliente completa o par.
export async function resolveRefs(repo, ev) {
  let customer = null;
  let lead = null;
  if (ev.orgId) {
    const org = norm(ev.orgId);
    customer = (await repo.list("customers")).find((c) => norm(c.leveradsOrgId) === org || norm(c.orgId) === org) || null;
  }
  if (ev.leverId) lead = (await repo.listWhere("leads", { leverId: ev.leverId }))[0] || null;
  if (!lead && (ev.subject?.email || ev.subject?.phone)) {
    lead = await findDuplicateLead(repo, { saas: ev.product, email: ev.subject.email, phone: ev.subject.phone });
  }
  if (!lead && customer?.leadId) lead = await repo.get("leads", customer.leadId);
  if (!customer && lead?.customerId) customer = await repo.get("customers", lead.customerId);
  return { customer: customer?.id || "", lead: lead?.id || "" };
}

const backoffMs = (attempts) => Math.min(2 ** attempts, 24 * 60) * 60_000; // 2 min … 24 h

// Processa um evento: casa, grava na timeline e fecha o estado. Reprocessar o
// mesmo evento não duplica a timeline (o item tem id derivado do evento).
export async function processEvent(repo, ev, { now = new Date() } = {}) {
  const attempts = (ev.attempts || 0) + 1;
  try {
    const refs = await resolveRefs(repo, ev);
    if (!refs.customer && !refs.lead) {
      return await repo.update(EVENTS, ev.id, {
        status: attempts >= MAX_ATTEMPTS ? "dead" : "unmatched", attempts, error: "",
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
      }, { silent: true });
    }
    await appendTimeline(repo, {
      id: `tl:${ev.id}`, kind: ev.type, source: ev.source, at: ev.occurredAt,
      customer: refs.customer, lead: refs.lead, eventId: ev.id,
      leverId: ev.leverId, product: ev.product, data: ev.payload || {},
    });
    return await repo.update(EVENTS, ev.id, {
      status: "processed", attempts, error: "", refs, processedAt: now.toISOString(),
    }, { silent: true });
  } catch (err) {
    return await repo.update(EVENTS, ev.id, {
      status: attempts >= MAX_ATTEMPTS ? "dead" : "failed", attempts, error: String(err.message || err).slice(0, 300),
      nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
    }, { silent: true });
  }
}

// O que o runner pega: pendentes, e os que falharam ou não casaram e já
// passaram da espera.
export async function dueEvents(repo, { now = new Date(), limit = 200 } = {}) {
  const nowIso = now.toISOString();
  const batches = await Promise.all(["pending", "unmatched", "failed"].map((status) =>
    repo.listWhere(EVENTS, { status, nextAttemptAt: { lte: nowIso } })));
  return batches.flat().sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))).slice(0, limit);
}

export async function processDue(repo, opts = {}) {
  const out = { processed: 0, unmatched: 0, failed: 0, dead: 0 };
  for (const ev of await dueEvents(repo, opts)) {
    const saved = await processEvent(repo, ev, opts);
    if (saved?.status && saved.status in out) out[saved.status]++;
  }
  return out;
}

export function startCrmEvents(repo, { log, intervalMs = 60_000, autoStart = true } = {}) {
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try { return await processDue(repo); }
    catch (err) { log?.warn?.(`crm events: ${err.message}`); return null; }
    finally { running = false; }
  };
  let timer = null;
  if (autoStart) { timer = setInterval(run, intervalMs); timer.unref?.(); }
  return { run, stop: () => clearInterval(timer) };
}
