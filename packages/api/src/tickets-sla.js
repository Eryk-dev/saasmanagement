// SLA dos tickets de suporte: prazos por prioridade, contados em minutos ÚTEIS
// quando o produto tem expediente ligado (seg a sex, hourStart..hourEnd no
// relógio de Brasília, mesma convenção de business-hours.js).
//
// Dois relógios por ticket:
//   firstResponse  da abertura até a 1ª resposta PÚBLICA de um atendente. Não
//                  pausa: "aguardando cliente" pressupõe que alguém já respondeu.
//   resolution     da abertura até o status virar resolvido/fechado. Pausa nos
//                  status de `settings.pauseOn` (padrão: aguardando cliente) — o
//                  tempo útil pausado empurra o prazo pra frente.
//
// Tudo aqui é puro (sem repo): quem grava é tickets-core.js, quem avisa é o
// ticket-sla-runner.js. O SPA espelha `slaState` em web/src/lib/tickets.js.

import { hourOf } from "./business-hours.js";

const BRT = 3 * 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;
const MAX_DAYS = 3660; // trava de segurança dos laços (10 anos de calendário)

const ms = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const iso = (t) => new Date(t).toISOString();

// Expediente saneado: fim depois do início, senão volta ao padrão 8h–18h.
export function normalizeHours(h) {
  const enabled = h?.enabled !== false;
  let hourStart = hourOf(h?.hourStart, 8);
  let hourEnd = hourOf(h?.hourEnd, 18);
  if (hourEnd <= hourStart) { hourStart = 8; hourEnd = 18; }
  return { enabled, hourStart, hourEnd };
}

// Janela útil do dia (em ms no "relógio de Brasília como UTC") que contém t.
function dayWindow(t, hours) {
  const d = new Date(t);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = d.getUTCDay();
  return { base, weekend: dow === 0 || dow === 6, start: base + hours.hourStart * 3_600_000, end: base + hours.hourEnd * 3_600_000 };
}

// Dentro do expediente agora? (sem expediente ligado = sempre)
export function isWithinHours(at, hoursIn) {
  const hours = normalizeHours(hoursIn);
  if (!hours.enabled) return true;
  const t = ms(at) - BRT;
  const w = dayWindow(t, hours);
  return !w.weekend && t >= w.start && t < w.end;
}

// Soma `minutes` úteis a partir de `start`. Sem expediente = minutos corridos.
export function addBusinessMinutes(start, minutes, hoursIn) {
  const hours = normalizeHours(hoursIn);
  const from = ms(start);
  const amount = Math.max(0, Number(minutes) || 0) * MIN;
  if (!hours.enabled) return iso(from + amount);
  let t = from - BRT;
  let remaining = amount;
  for (let i = 0; i < MAX_DAYS; i++) {
    const w = dayWindow(t, hours);
    if (w.weekend || t >= w.end) { t = w.base + DAY + hours.hourStart * 3_600_000; continue; }
    if (t < w.start) t = w.start;
    const avail = w.end - t;
    if (remaining <= avail) return iso(t + remaining + BRT);
    remaining -= avail;
    t = w.base + DAY + hours.hourStart * 3_600_000;
  }
  return iso(t + remaining + BRT);
}

// Tempo útil (ms) entre a e b. Sem expediente = diferença corrida.
export function businessMsBetween(a, b, hoursIn) {
  const hours = normalizeHours(hoursIn);
  const from = ms(a), to = ms(b);
  if (to <= from) return 0;
  if (!hours.enabled) return to - from;
  let t = from - BRT;
  const end = to - BRT;
  let total = 0;
  for (let i = 0; i < MAX_DAYS && t < end; i++) {
    const w = dayWindow(t, hours);
    if (!w.weekend) {
      const s = Math.max(t, w.start);
      const e = Math.min(end, w.end);
      if (e > s) total += e - s;
    }
    t = w.base + DAY;
  }
  return total;
}

// Prazos do ticket pela política da prioridade. `pausedMs` já acumulado entra
// no prazo de resolução; a pausa em curso é tratada por quem lê (slaState).
export function dueDates(ticket, settings) {
  const policy = settings?.policies?.[ticket.priority] || settings?.policies?.normal || { firstResponseMin: 480, resolutionMin: 2880 };
  const hours = settings?.businessHours;
  const created = ticket.createdAt || new Date().toISOString();
  const pausedMin = Math.max(0, Number(ticket.sla?.pausedMs) || 0) / MIN;
  const warnAt = Number(settings?.warnAt) > 0 && Number(settings?.warnAt) < 1 ? Number(settings.warnAt) : 0.8;
  // O aviso também é em tempo útil: 80% de um prazo que atravessa o fim de
  // semana não pode cair no domingo. Gravado no ticket pra todo leitor concordar.
  return {
    firstResponseDue: addBusinessMinutes(created, policy.firstResponseMin, hours),
    resolutionDue: addBusinessMinutes(created, policy.resolutionMin + pausedMin, hours),
    firstResponseWarnAt: addBusinessMinutes(created, policy.firstResponseMin * warnAt, hours),
    resolutionWarnAt: addBusinessMinutes(created, policy.resolutionMin * warnAt + pausedMin, hours),
  };
}

// Transição de status/prioridade → novo objeto `sla`. `before` null = criação.
export function nextSla(before, after, settings, now = new Date().toISOString()) {
  const kinds = settings?.statusKinds || {};
  const pauseOn = Array.isArray(settings?.pauseOn) ? settings.pauseOn : [];
  const hours = settings?.businessHours;
  const sla = { pausedMs: 0, pausedAt: "", firstResponseAt: "", resolvedAt: "", breached: { firstResponse: false, resolution: false }, warned: { firstResponse: false, resolution: false }, ...(before?.sla || {}), ...(after.sla || {}) };
  sla.breached = { firstResponse: false, resolution: false, ...(sla.breached || {}) };
  sla.warned = { firstResponse: false, resolution: false, ...(sla.warned || {}) };
  const done = kinds[after.status] === "done";
  const wasDone = before ? kinds[before.status] === "done" : false;
  const paused = !done && pauseOn.includes(after.status);

  // Fecha a pausa em curso quando sai do status pausado (ou resolve).
  if (sla.pausedAt && !paused) {
    sla.pausedMs = (Number(sla.pausedMs) || 0) + businessMsBetween(sla.pausedAt, now, hours);
    sla.pausedAt = "";
  }
  if (paused && !sla.pausedAt) sla.pausedAt = now;

  if (done && !wasDone) sla.resolvedAt = now;
  if (!done && wasDone) sla.resolvedAt = "";

  Object.assign(sla, dueDates({ ...after, sla }, settings));
  // Estouro é fato histórico: uma vez estourado, reabrir não "desestoura".
  const frAt = sla.firstResponseAt ? ms(sla.firstResponseAt) : ms(now);
  if (frAt > ms(sla.firstResponseDue)) sla.breached.firstResponse = true;
  const resAt = sla.resolvedAt ? ms(sla.resolvedAt) : (sla.pausedAt ? ms(sla.pausedAt) : ms(now));
  if (resAt > ms(sla.resolutionDue)) sla.breached.resolution = true;
  return sla;
}

// Estado de um relógio: none | ok | warning | breached | met | paused.
function clockState({ start, due, warnFrom, doneAt, paused, breachedFlag, now, warnAt }) {
  if (!due) return "none";
  const t = ms(now), d = ms(due), s = ms(start);
  if (doneAt) return breachedFlag || ms(doneAt) > d ? "breached" : "met";
  if (paused) return breachedFlag ? "breached" : "paused";
  if (breachedFlag || t > d) return "breached";
  if (warnFrom) return t >= ms(warnFrom) ? "warning" : "ok";
  const span = d - s; // ticket antigo sem o instante gravado: proporção corrida
  if (span > 0 && (t - s) / span >= warnAt) return "warning";
  return "ok";
}

const RANK = { breached: 5, warning: 4, ok: 3, paused: 2, met: 1, none: 0 };

// Leitura do SLA "agora" pra listas, contadores e runner. Usa só o que está
// gravado no ticket (sem settings), então vale no bootstrap e no SPA.
export function slaState(ticket, now = new Date().toISOString(), { warnAt = 0.8 } = {}) {
  const sla = ticket?.sla || {};
  const start = ticket?.createdAt;
  // Resolvido sem resposta pública (ex.: duplicado fechado por nota): o relógio
  // da 1ª resposta para de correr junto.
  const firstResponse = sla.resolvedAt && !sla.firstResponseAt
    ? (sla.breached?.firstResponse ? "breached" : "none")
    : clockState({
      start, due: sla.firstResponseDue, warnFrom: sla.firstResponseWarnAt, doneAt: sla.firstResponseAt, paused: false,
      breachedFlag: !!sla.breached?.firstResponse, now, warnAt,
    });
  const resolution = clockState({
    start, due: sla.resolutionDue, warnFrom: sla.resolutionWarnAt, doneAt: sla.resolvedAt, paused: !!sla.pausedAt,
    breachedFlag: !!sla.breached?.resolution, now, warnAt,
  });
  // O relógio que ainda corre manda: 1ª resposta cumprida não esconde a resolução estourando.
  const overall = RANK[firstResponse] >= RANK[resolution] ? firstResponse : resolution;
  return { firstResponse, resolution, overall };
}
