// Disponibilidade de agenda no SERVIDOR — o porte fiel da grade do front
// (today.jsx: occupySlots/busyView/callBusyKeys) pra quem precisa de horário
// livre sem um navegador aberto: o SDR automatizado (sdr-flow.js) e a rota
// GET /api/agenda/free-slots. Mesmas réguas: slots de 30 min das 7h às 21h,
// call ocupa 1h (2 células), fim de semana fora, bloqueios da tela Agenda +
// calls/integrações marcadas + consultas da mentoria ocupam.
//
// FUSO: todo horário de compromisso no cockpit é "hora de Brasília sem fuso"
// ("YYYY-MM-DDTHH:MM" — callAt, integrationAt, consultations.at, e as horas de
// agenda_blocks). Aqui a conta inteira roda nesse relógio de parede: datas
// naive viram Date com campos UTC = relógio BRT (mesma convenção do
// business-hours.js), e só o "agora" real é convertido (UTC-3 fixo).
//
// ROTEAMENTO POR NÍVEL (Leo, 22/08): a régua de cliente é a matriz S-E que já
// vive nos cards (leadGrade, routes.marketing.js). Cliente B ou melhor (S/A/B)
// é atendido por closer pleno/sênior (user.compLevel 2-3, o nível do plano de
// remuneração); C pra baixo (C/D/E e sem qualificação) vai pro júnior
// (compLevel 1). O foco é SEMPRE o próximo horário livre do pool: quem tiver o
// slot mais cedo leva. C/D pode SUBIR pro pleno/sênior quando o pool júnior só
// tem horário mais de 1 dia útil depois (velocidade ganha do escalão); S/A/B
// nunca desce. Pool vazio cai pra todos os closers — agendamento nunca trava.
import { kindOf } from "./stages.js";
import { leadGrade } from "./routes.marketing.js";

const BRT_MS = 3 * 3_600_000;
export const SLOT_MIN = 30;
export const CALL_MIN = 60;
export const CALL_H0 = 7, CALL_H1 = 21; // slots 07:00…20:30 (espelho do front)

const pad2 = (n) => String(n).padStart(2, "0");

// Data naive "YYYY-MM-DD[THH:MM]" → Date com campos UTC = relógio de parede.
export function wallFromNaive(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)));
}
// O "agora" real no relógio de parede BRT (UTC-3 fixo, sem horário de verão).
export const wallNow = (at = new Date()) => new Date(new Date(at).getTime() - BRT_MS);

const wallYmd = (w) => `${w.getUTCFullYear()}-${pad2(w.getUTCMonth() + 1)}-${pad2(w.getUTCDate())}`;
const cellKeyOf = (w) => `${wallYmd(w)}-${pad2(w.getUTCHours())}-${w.getUTCMinutes() < 30 ? "00" : "30"}`;
const slotValOf = (w) => `${wallYmd(w)}T${pad2(w.getUTCHours())}:${pad2(w.getUTCMinutes())}`;

// Células de meia hora que um compromisso ocupa (âncora na meia hora que o
// contém; 14h10 por 60 min pega três células) — espelho do occupySlots do front.
export function occupyCells(startNaive, minutes = CALL_MIN) {
  const w = startNaive instanceof Date ? new Date(startNaive) : wallFromNaive(startNaive);
  if (!w) return [];
  const end = w.getTime() + minutes * 60_000;
  const c = new Date(w);
  c.setUTCMinutes(c.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  const out = [];
  for (; c.getTime() < end; c.setUTCMinutes(c.getUTCMinutes() + SLOT_MIN)) out.push(cellKeyOf(c));
  return out;
}

// Um bloqueio (agenda_blocks) casa com a célula? Mesma régua do matchBlock do
// front: weekly pelo dia da semana, once pela data; allDay ou sobreposição de
// horas (fromHour/toHour fracionários). Exportada: as regras de veiculação
// (ad-delivery.js) medem a capacidade da agenda com ESTA régua, não uma cópia.
export function blockHits(b, key) {
  const dateStr = key.slice(0, 10);
  const from = Number(key.slice(11, 13)) + Number(key.slice(14, 16)) / 60;
  const to = from + SLOT_MIN / 60;
  const hourHit = b.allDay || (Number(b.fromHour) < to && Number(b.toHour) > from);
  if (!hourHit) return false;
  if (b.recur === "weekly") {
    const [y, m, d] = dateStr.split("-").map(Number);
    return Number(b.weekday) === new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  return b.date === dateStr;
}

// Ocupação de UMA pessoa: células concretas (calls do closer + integrações do
// integrador + consultas) num Set, bloqueios avaliados por célula.
function busyOf(userId, { leads, blocks, consultations, productById, excludeLeadId }) {
  const cells = new Set();
  for (const l of leads) {
    if (l.id === excludeLeadId) continue;
    if (l.closer === userId && l.callAt) {
      // Follow-up não ocupa a agenda (o SDR pode marcar a call de venda por
      // cima) — mesma exceção do callBusyKeys do front.
      const kind = kindOf(productById.get(l.saas), l.stage);
      if (kind !== "followup") for (const k of occupyCells(l.callAt)) cells.add(k);
    }
    if (l.integrator === userId && l.integrationAt) {
      for (const k of occupyCells(l.integrationAt)) cells.add(k);
    }
  }
  for (const c of consultations) {
    if (c.owner !== userId || !c.at || c.status === "canceled") continue;
    for (const k of occupyCells(c.at, Number(c.durationMin) > 0 ? Number(c.durationMin) : 60)) cells.add(k);
  }
  const mine = blocks.filter((b) => b.user === userId || (Array.isArray(b.users) && b.users.includes(userId)));
  return (key) => cells.has(key) || mine.some((b) => blockHits(b, key));
}

// ── Pools de closer por nível ───────────────────────────────────────────────
const levelOf = (u) => { const n = Math.floor(Number(u?.compLevel)); return n >= 1 && n <= 3 ? n : 1; };
export const UPPER_GRADES = new Set(["S", "A", "B"]); // "B+" da régua do Leo

export function closerPools(users, saas) {
  const closers = (users || []).filter((u) =>
    Array.isArray(u.roles) && u.roles.includes("closer") && (!u.saas || u.saas === saas));
  return {
    upper: closers.filter((u) => levelOf(u) >= 2),  // pleno + sênior
    junior: closers.filter((u) => levelOf(u) === 1),
    all: closers,
  };
}

// ── Horários livres de um pool ──────────────────────────────────────────────
// Varre os próximos `days` DIAS ÚTEIS e devolve, por slot livre, o closer com
// MENOS calls no dia (balanceamento; empate = ordem estável). Um item por
// horário: [{ at: "YYYY-MM-DDTHH:MM", closer, level }...], em ordem cronológica.
export function freeSlotsForPool({ pool, now, days = 5, minNoticeMin = 120, limit = 0, busyFns, callCountOf, fromHour = CALL_H0, toHour = CALL_H1, lunchFrom = null, lunchTo = null }) {
  if (!pool.length) return [];
  const out = [];
  const floor = new Date(now.getTime() + minNoticeMin * 60_000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let scanned = 0;
  while (scanned < days) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      for (let total = Math.ceil((fromHour * 60) / SLOT_MIN) * SLOT_MIN; total + CALL_MIN <= toHour * 60; total += SLOT_MIN) {
        // Almoço (Leo, 23/08): call que ENCOSTA na janela de almoço não entra
        // na oferta do robô (12h-13h por padrão via OFFER_HOURS).
        if (lunchFrom != null && lunchTo != null && total / 60 < lunchTo && (total + CALL_MIN) / 60 > lunchFrom) continue;
        const w = new Date(day);
        w.setUTCHours(Math.floor(total / 60), total % 60, 0, 0);
        if (w.getTime() < floor.getTime()) continue;
        const cells = occupyCells(w, CALL_MIN);
        const free = pool.filter((u) => cells.every((k) => !busyFns.get(u.id)(k)));
        if (!free.length) continue;
        const dayStr = wallYmd(w);
        free.sort((a, b) => (callCountOf(a.id, dayStr) - callCountOf(b.id, dayStr)));
        out.push({ at: slotValOf(w), closer: free[0].id, level: levelOf(free[0]) });
        if (limit && out.length >= limit) return out;
      }
      scanned++;
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

// Soma N dias úteis a um "YYYY-MM-DDTHH:MM" (a régua do overflow C/D → pleno).
export function addBusinessDaysNaive(at, n) {
  const w = wallFromNaive(at);
  if (!w) return at;
  let left = n;
  while (left > 0) {
    w.setUTCDate(w.getUTCDate() + 1);
    const dow = w.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return slotValOf(w);
}

// Janela de OFERTA do robô: horário que o SDR automatizado propõe pro lead.
// A grade completa (7h às 21h) continua valendo pra gente marcar na mão; o
// robô oferecendo "segunda às 7h" é honesto mas soa errado (visto no replay
// de 22/08) — oferta automática fica no horário comercial confortável.
// Das 9h às 19h, com a ÚLTIMA call começando 19h (Leo, 23/08): a varredura
// exige a call TERMINANDO dentro da janela, por isso o teto é 20.
export const OFFER_HOURS = { fromHour: 9, toHour: 20, lunchFrom: 12, lunchTo: 13 };

// ── A régua completa: horários pro LEAD ─────────────────────────────────────
// Nota do lead (matriz S-E) → pool elegível → próximos horários. Devolve
// { slots, pool: "upper"|"junior"|"junior+upper"|"all", grade }.
export async function slotsForLead(repo, { lead, saas, grade: gradeIn, now = wallNow(), days = 5, minNoticeMin = 120, limit = 6, fromHour, toHour, lunchFrom, lunchTo } = {}) {
  const sid = saas || lead?.saas || "";
  const [users, leads, blocks, consultations, products] = await Promise.all([
    repo.list("users"),
    repo.list("leads"),
    repo.list("agenda_blocks"),
    repo.list("consultations").catch(() => []),
    repo.list("products"),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const pools = closerPools(users, sid);
  const grade = gradeIn || leadGrade(lead || {}) || null;

  const ctx = { leads, blocks, consultations, productById, excludeLeadId: lead?.id || "" };
  const busyFns = new Map();
  const ensureBusy = (list) => { for (const u of list) if (!busyFns.has(u.id)) busyFns.set(u.id, busyOf(u.id, ctx)); };
  // Calls do dia por closer (balanceamento de carga no empate de slot).
  const countCache = new Map();
  const callCountOf = (uid, dayStr) => {
    const key = `${uid}:${dayStr}`;
    if (!countCache.has(key)) {
      countCache.set(key, leads.filter((l) => l.closer === uid && l.callAt && String(l.callAt).slice(0, 10) === dayStr).length);
    }
    return countCache.get(key);
  };
  const compute = (pool, lim) => {
    ensureBusy(pool);
    return freeSlotsForPool({ pool, now, days, minNoticeMin, limit: lim, busyFns, callCountOf, ...(fromHour != null ? { fromHour } : {}), ...(toHour != null ? { toHour } : {}), ...(lunchFrom != null ? { lunchFrom } : {}), ...(lunchTo != null ? { lunchTo } : {}) });
  };

  // S/A/B: pleno/sênior, nunca desce pro júnior. Sem ninguém no pool de cima,
  // cai pra todos (agendamento nunca trava por cadastro incompleto de nível).
  if (grade && UPPER_GRADES.has(grade)) {
    const pool = pools.upper.length ? pools.upper : pools.all;
    return { slots: compute(pool, limit), pool: pools.upper.length ? "upper" : "all", grade };
  }
  // C pra baixo (e sem qualificação): júnior primeiro. Overflow: se o pleno/
  // sênior tem horário mais de 1 dia útil ANTES do primeiro slot júnior, os
  // horários de cima entram na oferta (velocidade ganha do escalão).
  if (!pools.junior.length) {
    const pool = pools.upper.length ? pools.upper : pools.all;
    return { slots: compute(pool, limit), pool: pools.upper.length ? "upper" : "all", grade };
  }
  const jr = compute(pools.junior, limit);
  if (!jr.length) return { slots: compute(pools.upper.length ? pools.upper : pools.all, limit), pool: "upper", grade };
  if (pools.upper.length) {
    const up = compute(pools.upper, 1);
    if (up.length && addBusinessDaysNaive(up[0].at, 1) < jr[0].at) {
      const merged = [...jr, ...compute(pools.upper, limit)].sort((a, b) => a.at.localeCompare(b.at));
      const seen = new Set();
      return { slots: merged.filter((s) => !seen.has(s.at) && seen.add(s.at)).slice(0, limit || undefined), pool: "junior+upper", grade };
    }
  }
  return { slots: jr, pool: "junior", grade };
}

// ── Reserva curta do horário OFERTADO ───────────────────────────────────────
// O robô ofereceu "amanhã às 10h ou às 14h", o lead respondeu "10" 27 minutos
// depois e ouviu "esse horário eu não consigo confirmar aqui" — outro lead
// tinha levado o slot no meio (visto em prod 24/08, Guilherme). Oferecer e
// depois negar é o tipo de contradição que só robô comete, então a oferta
// RESERVA: o horário some da oferta dos OUTROS leads por HOLD_MIN minutos e
// continua válido pra quem recebeu.
//
// A reserva é só do robô: quem marca na mão pelo cockpit enxerga a agenda
// inteira (decisão humana sempre ganha) — por isso o filtro mora aqui, aplicado
// por quem oferta, e não dentro do slotsForLead.
export const HOLD_MIN = 30;
const holdsId = (saas) => `sdr_slot_holds_${saas || "default"}`;

export async function activeHolds(repo, saas, { now = new Date() } = {}) {
  const rec = await repo.get("app_config", holdsId(saas)).catch(() => null);
  const nowMs = new Date(now).getTime();
  return (Array.isArray(rec?.holds) ? rec.holds : []).filter((h) => h?.at && Date.parse(h.until || "") > nowMs);
}

// Reserva os horários pro lead (as reservas ANTERIORES dele caem: a oferta nova
// substitui a antiga). Expiradas são podadas no mesmo passe, então o registro
// não cresce sem fim.
export async function holdSlots(repo, { saas, leadId, slots = [], now = new Date(), minutes = HOLD_MIN } = {}) {
  const list = (slots || []).filter((s) => s?.at);
  if (!leadId || !list.length) return [];
  const keep = (await activeHolds(repo, saas, { now })).filter((h) => h.leadId !== leadId);
  const until = new Date(new Date(now).getTime() + minutes * 60_000).toISOString();
  const holds = [...keep, ...list.map((s) => ({ at: s.at, leadId, until }))].slice(-400);
  const id = holdsId(saas);
  const rec = await repo.get("app_config", id).catch(() => null);
  if (rec) await repo.update("app_config", id, { holds });
  else await repo.create("app_config", { id, holds });
  return holds;
}

// Lead marcou (ou saiu de cena): o que ele segurava volta pro pool na hora.
export async function releaseHolds(repo, { saas, leadId, now = new Date() } = {}) {
  if (!leadId) return;
  const id = holdsId(saas);
  const rec = await repo.get("app_config", id).catch(() => null);
  if (!rec) return;
  const holds = (await activeHolds(repo, saas, { now })).filter((h) => h.leadId !== leadId);
  await repo.update("app_config", id, { holds });
}

// Tira da lista o que OUTRO lead reservou agora há pouco.
export function withoutHeld(slots, holds, leadId) {
  const taken = new Set((holds || []).filter((h) => h.leadId !== leadId).map((h) => h.at));
  return taken.size ? (slots || []).filter((s) => !taken.has(s.at)) : (slots || []);
}

// Dupla de sugestão com RESPIRO (Leo, 23/08): ao oferecer 2 opções, elas
// devem ter pelo menos 2h de diferença quando a agenda permitir — 9h/9h30 não
// é escolha de verdade. Cai pro adjacente só quando não há espaçado.
// OFERTA só em HORA CHEIA (Leo, 25/08): "amanhã às 16h30" soa sobra de agenda
// e polui a escolha. A grade continua de meia em meia hora — hora quebrada
// segue disponível pra quando o LEAD pedir ("consigo só 14h30") e pra marcação
// na mão. Sem nenhuma hora cheia livre, devolve a lista inteira (melhor uma
// oferta quebrada que nenhuma).
export function wholeHourSlots(slots) {
  const cheias = (slots || []).filter((s) => String(s?.at || "").endsWith(":00"));
  return cheias.length ? cheias : (slots || []);
}

export function spreadPair(slots, minGapMin = 120) {
  if (!slots.length) return [];
  const first = slots[0];
  const t0 = wallFromNaive(first.at)?.getTime() ?? 0;
  const second = slots.find((s) => (wallFromNaive(s.at)?.getTime() ?? 0) - t0 >= minGapMin * 60_000) || slots[1];
  return second ? [first, second] : [first];
}

// Rótulo humano de um slot naive pro texto do WhatsApp: "hoje às 14h" /
// "amanhã às 9h30" / "sexta às 10h" (mais de uma semana: "sexta 04/09 às 10h").
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export function slotLabel(at, now = wallNow()) {
  const w = wallFromNaive(at);
  if (!w) return String(at || "");
  const h = w.getUTCMinutes() ? `${w.getUTCHours()}h${pad2(w.getUTCMinutes())}` : `${w.getUTCHours()}h`;
  const today = wallYmd(now);
  const day = wallYmd(w);
  if (day === today) return `hoje às ${h}`;
  const tomorrow = new Date(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (day === wallYmd(tomorrow)) return `amanhã às ${h}`;
  const diffDays = Math.round((Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  const wd = WEEKDAYS[w.getUTCDay()];
  if (diffDays < 7) return `${wd} às ${h}`;
  return `${wd} ${pad2(w.getUTCDate())}/${pad2(w.getUTCMonth() + 1)} às ${h}`;
}

// Rótulo da CONFIRMAÇÃO (Leo, 24/08): o combinado por escrito leva a data
// cravada — "hoje/amanhã" sozinho vira ambiguidade quando o lead relê a
// conversa dias depois. "hoje (24/08) às 14h" / "sexta (28/08) às 10h".
export function slotLabelFull(at, now = wallNow()) {
  const w = wallFromNaive(at);
  if (!w) return String(at || "");
  const h = w.getUTCMinutes() ? `${w.getUTCHours()}h${pad2(w.getUTCMinutes())}` : `${w.getUTCHours()}h`;
  const tomorrow = new Date(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = wallYmd(w);
  const base = day === wallYmd(now) ? "hoje" : day === wallYmd(tomorrow) ? "amanhã" : WEEKDAYS[w.getUTCDay()];
  return `${base} (${pad2(w.getUTCDate())}/${pad2(w.getUTCMonth() + 1)}) às ${h}`;
}
