// O que o agente Cases (OpenBot) lê do cockpit: as reuniões gravadas que têm o
// que ler, a transcrição inteira de cada uma e os cases que os clientes já
// autorizaram. Só leitura; a única escrita é guardar a transcrição que buscou
// no Google (meeting-transcripts.js). As rotas (routes.cases-feed.js) ficam
// atrás da chave mestre ou de um admin, porque entregam fala de cliente.
//
// Reunião, aqui, é sala do Meet cujo horário já passou:
//   call            venda: linha `realizada` de `meetings` (crm/meetings.js)
//   integracao      a integração marcada no card do lead (integrationCallUrl)
//                   e as reuniões do registro de integração (onboardings)
//   acompanhamento  as reuniões do acompanhamento de CS (cs_followups)
//
// Uma reunião por sala de cada lead. Call remarcada leva a sala junto, e cada
// horário vira uma linha `realizada` em `meetings` quando passa, tenha a
// conversa acontecido nele ou não (em nov/2026, 89 das 402 dividiam a sala com
// outra). A lista mostra a mais recente da sala e diz as outras em `sameRoom`;
// o Google devolve a conferência mais recente da sala, que é a dela.

import { MEETINGS, meetingId } from "../crm/meetings.js";
import { FORMS_V2, FORM_IDS } from "../forms/forms-v2.leverads.js";
import { canPublish, normalizeNiche } from "../proposals/cases.js";
import { liveCases } from "../proposals/cases-live.js";
import { meetCode, fetchRoomTranscript, keepTranscript, storedTranscript } from "./meeting-transcripts.js";

export const MEETING_KINDS = ["call", "integracao", "acompanhamento"];
const RECORD_KINDS = [["onboardings", "integracao"], ["cs_followups", "acompanhamento"]];

// Nicho e faixas de tamanho: o valor gravado no lead e o rótulo que o
// formulário mostra, a lista fechada que o time inteiro usa. Valor de
// formulário antigo, fora da lista de hoje, vem sem rótulo.
const SIZE_KEYS = ["niche", "listings", "orders", "accounts"];
const LABELS = Object.fromEntries(SIZE_KEYS.map((key) => {
  const q = FORMS_V2.flatMap((f) => f.questions || []).find((x) => x.key === key);
  return [key, new Map((q?.options || []).map((o) => [o.value, o.label]))];
}));
const NICHE_BY_NAME = new Map([...LABELS.niche].flatMap(([value, label]) => [[normalizeNiche(value), value], [normalizeNiche(label), value]]));

// Produto pela linha do formulário que o lead preencheu (o que ele veio
// conhecer); sem ela, pelo formulário ou pela dor do anúncio de origem.
const LINE_PRODUCT = { ads: "leverads", price: "leverprice", oem: "oem" };
const FORM_LINE = { [FORM_IDS.ads]: "ads", [FORM_IDS.price]: "price", [FORM_IDS.oem]: "oem", fo_diagnostico_leverads: "ads" };
const PAIN_LINE = { PRICE: "price", OEM: "oem", A: "ads", B: "ads", C: "ads", D: "ads", E: "ads" };
function productOf(lead) {
  const line = String(lead?.formProduct || "").toLowerCase() || FORM_LINE[lead?.form] || PAIN_LINE[String(lead?.sourcePain || "").toUpperCase()] || "";
  return LINE_PRODUCT[line] || "";
}

function answer(lead, key) {
  // O formulário do OEM não pergunta o nicho: é autopeças por definição.
  const value = String(lead?.[key] || "") || (key === "niche" && productOf(lead) === "oem" ? "autopecas" : "");
  return value ? { value, label: LABELS[key].get(value) || "" } : null;
}

const iso = (raw) => {
  const t = Date.parse(raw || "");
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
};

// ── As reuniões de cada origem, no mesmo formato ────────────────────────────
// { id, kind, at, happened, code, meetUrl, eventId, saas, lead, closer,
//   integrator, summarized, sameRoom, sameRoomAs?, leadName, organizer? }.
// `organizer` ausente (venda) é resolvido só na leitura da transcrição
// (organizerOf).

function salesMeeting(row, lead, { sameRoom = [], sameRoomAs = "", summarized = false } = {}) {
  return {
    id: row.id, kind: "call", at: iso(row.at), happened: row.status === "realizada",
    code: meetCode(row.meetUrl), meetUrl: row.meetUrl || "", eventId: row.eventId || "",
    saas: row.saas || lead.saas || "", lead, closer: row.closer || lead.closer || "", integrator: "",
    summarized, sameRoom, sameRoomAs, leadName: lead.name || "",
  };
}

// As linhas realizadas de venda, agrupadas por sala de cada lead; a primeira
// de cada grupo é a mais recente.
async function salesRooms(repo, where = {}) {
  const rooms = new Map();
  for (const m of await repo.listWhere(MEETINGS, { status: "realizada", ...where })) {
    const code = meetCode(m.meetUrl);
    if (m.kind !== "call" || !code) continue;
    const key = `${m.lead}|${code}`;
    rooms.set(key, [...(rooms.get(key) || []), m]);
  }
  return [...rooms.values()].map((rows) => rows.sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id))));
}

function leadIntegration(lead) {
  const code = meetCode(lead.integrationCallUrl);
  const at = iso(lead.integrationScheduledAt);
  if (!code || !at) return null;
  return {
    id: meetingId(lead.id, new Date(at)).replace(/^mt_/, "in_"), kind: "integracao", at, happened: true, code,
    meetUrl: lead.integrationCallUrl, eventId: lead.integrationMeetEventId || "", saas: lead.saas || "", lead,
    closer: lead.closer || "", integrator: lead.integrator || "",
    summarized: Boolean(lead.integrationSummaryFor) && lead.integrationSummaryFor === lead.integrationMeetEventId,
    sameRoom: [], leadName: lead.name || "", organizer: lead.integrationMeetOrganizer || "",
  };
}

function recordMeeting(record, m, kind, customer, lead) {
  return {
    id: m.id, kind, at: iso(m.at), happened: m.status !== "canceled",
    code: meetCode(m.meetUrl), meetUrl: m.meetUrl || "", eventId: m.eventId || "",
    saas: customer?.saas || record.saas || lead?.saas || "", lead,
    closer: lead?.closer || "", integrator: m.responsible || "",
    summarized: Boolean(m.summaryAt), sameRoom: [], leadName: customer?.name || "", organizer: m.organizer || "",
  };
}

async function recordMeetings(repo, leadOf, { kind = "", id = "" } = {}) {
  const out = [];
  const customers = new Map();
  for (const [collection, k] of RECORD_KINDS) {
    if (kind && kind !== k) continue;
    for (const r of await repo.list(collection)) {
      for (const m of r.meetings || []) {
        if (id ? m.id !== id : (m.status === "canceled" || !meetCode(m.meetUrl))) continue;
        if (!customers.has(r.customer)) customers.set(r.customer, r.customer ? await repo.get("customers", r.customer).catch(() => null) : null);
        const customer = customers.get(r.customer);
        out.push(recordMeeting(r, m, k, customer, (await leadOf(r.lead || customer?.leadId || "")) || null));
      }
    }
  }
  return out;
}

// Uma reunião pelo id da lista (o da venda é o de `meetings`; o da integração
// do card, in_<lead>_<horário>; o do registro, o da reunião dentro dele).
async function findMeeting(repo, id) {
  const row = await repo.get(MEETINGS, id);
  if (row?.kind === "call") {
    const lead = await repo.get("leads", row.lead);
    if (!lead) return null;
    const code = meetCode(row.meetUrl);
    const room = code ? (await salesRooms(repo, { lead: row.lead })).find((rows) => meetCode(rows[0].meetUrl) === code) || [] : [];
    return salesMeeting(row, lead, {
      sameRoom: room.filter((o) => o.id !== id).map((o) => o.id),
      sameRoomAs: room.length && room[0].id !== id ? room[0].id : "",
      summarized: Boolean(row.summarized) || room.some((o) => o.summarized),
    });
  }
  const integ = /^in_(.+)_\d{12}$/.exec(id);
  if (integ) {
    const lead = await repo.get("leads", integ[1]);
    const m = lead ? leadIntegration(lead) : null;
    return m?.id === id ? m : null;
  }
  const [found] = await recordMeetings(repo, (leadId) => (leadId ? repo.get("leads", leadId) : null), { id });
  return found || null;
}

// O que a lista mostra e a leitura aceita: reunião que aconteceu (horário
// passado; na venda, linha `realizada`; no registro, não cancelada), de lead
// que não é do time, no produto pedido.
function happenedFor(m, { saas, nowMs }) {
  const t = Date.parse(m.at);
  return m.happened && Number.isFinite(t) && t <= nowMs && !m.lead?.internal && (!saas || m.saas === saas);
}

function entryOf(m, users) {
  const person = (id) => (id ? { id, name: users.get(id)?.name || id } : null);
  return {
    id: m.id, kind: m.kind, at: m.at, saas: m.saas,
    product: productOf(m.lead),
    closer: person(m.closer), integrator: person(m.integrator),
    lead: m.lead ? { id: m.lead.id, ...Object.fromEntries(SIZE_KEYS.map((k) => [k, answer(m.lead, k)])) } : null,
    summarized: Boolean(m.summarized),
    ...(m.sameRoom.length ? { sameRoom: m.sameRoom } : {}),
  };
}

// Case autorizado, para o banco do agente nascer com ele. O nome do cliente vai
// junto porque a ficha interna do banco pode guardá-lo (decisão 23 do time de
// robôs); o agente nunca o repassa a lead, post ou outro agente. `canPublish`
// é a marca "pode publicar": publicado na ficha (`public`), autorizado e sem
// nada faltando (cases.js). Ficam de fora o cliente do cockpit, a org, o
// contato e o print da prova.
function caseForAgent(doc) {
  return {
    id: doc.id, saas: doc.saas || "", name: doc.name || "",
    niche: doc.niche || "",
    // O nicho do case na lista do formulário; o que não está nela é "outros".
    formNiche: NICHE_BY_NAME.get(normalizeNiche(doc.niche)) || (doc.niche ? "outros" : ""),
    headline: doc.headline || "", period: doc.period || "",
    metrics: (doc.metrics || []).map((m) => ({ label: m.label || "", value: m.value || "", period: m.period || "", source: m.source || "" })),
    quote: doc.quote || "",
    authorizedAt: doc.authorizedAt || "", authorizedVia: doc.authorizedVia || "",
    public: doc.public === true,
    canPublish: doc.public === true && canPublish(doc),
    order: Number(doc.order) || 0,
    numbersAt: doc.liveAt || doc.apuradoEm || doc.updatedAt || doc.createdAt || "",
  };
}

export function makeCasesFeed({ repo, google, googleUser = null, log = console, live = liveCases, now = () => new Date() }) {
  // Reuniões que aconteceram a partir de `since` (dia de Brasília), até antes
  // de `until`. Sem transcrição na lista.
  async function meetings({ since, until = "", kind = "", saas = "leverads" } = {}) {
    const from = Date.parse(`${since}T00:00:00-03:00`);
    const to = until ? Date.parse(`${until}T00:00:00-03:00`) : Infinity;
    const nowMs = now().getTime();
    const took = (m) => happenedFor(m, { saas, nowMs }) && Date.parse(m.at) >= from && Date.parse(m.at) < to;
    const leads = new Map((await repo.list("leads")).map((l) => [l.id, l]));
    const found = [];
    if (!kind || kind === "call") {
      for (const [row, ...others] of await salesRooms(repo)) {
        const lead = leads.get(row.lead);
        if (!lead) continue;
        found.push(salesMeeting(row, lead, { sameRoom: others.map((o) => o.id), summarized: [row, ...others].some((o) => o.summarized) }));
      }
    }
    if (!kind || kind === "integracao") {
      for (const lead of leads.values()) {
        const m = leadIntegration(lead);
        if (m) found.push(m);
      }
    }
    found.push(...(await recordMeetings(repo, async (id) => leads.get(id), { kind })));
    const users = new Map((await repo.list("users")).map((u) => [u.id, u]));
    return found.filter(took)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
      .map((m) => entryOf(m, users));
  }

  // A conta que lê a sala: a de quem organizou, se está conectada; senão a do
  // time (o mesmo critério do resumo automático).
  async function clientFor(organizer) {
    if (organizer && googleUser && (await googleUser.connectedFor(organizer).catch(() => false))) return google.forUser(googleUser, organizer);
    return google && (await google.connected().catch(() => false)) ? google : null;
  }

  // Quem organizou a sala de uma call de venda (só o organizador enxerga a
  // gravação). A da call atual está no lead; a de uma sala antiga, na
  // atividade de quando ela nasceu; sem atividade, o closer da call.
  async function organizerOf(m) {
    if (m.organizer !== undefined) return m.organizer;
    const lead = m.lead;
    if ((m.eventId && m.eventId === lead.meetEventId) || (m.meetUrl && m.meetUrl === lead.callUrl)) return lead.meetOrganizer || "";
    const created = (await repo.listWhere("activities", { lead: lead.id }))
      .find((a) => a.meta?.event === "meet_created" && a.meta?.kind !== "integracao" && a.meta?.url === m.meetUrl);
    return created ? created.meta.organizer || "" : m.closer;
  }

  // A transcrição inteira de uma reunião que a lista mostraria: a guardada, se
  // foi buscada depois do horário dela; senão a do Google, que fica guardada
  // para a próxima leitura.
  async function transcript(id, { saas = "leverads" } = {}) {
    const m = await findMeeting(repo, String(id || ""));
    if (!m || !happenedFor(m, { saas, nowMs: now().getTime() })) return { ok: false, reason: "not_found" };
    // Linha que divide a sala com uma call mais recente do mesmo lead: o Google
    // devolve a conversa mais recente da sala, que é lida pela reunião da lista.
    if (m.sameRoomAs) return { ok: false, reason: "same_room", meeting: m.sameRoomAs };
    if (!m.code) return { ok: false, reason: "no_meet" };
    let doc = await storedTranscript(repo, m.code, m.at);
    const cached = Boolean(doc);
    if (!doc) {
      const g = await clientFor(await organizerOf(m));
      if (!g) return { ok: false, reason: "not_connected" };
      const got = await fetchRoomTranscript(g, { code: m.code, eventId: m.eventId, leadName: m.leadName, since: m.at }, { log, ctx: { meeting: m.id, kind: m.kind } });
      if (!got.ok) return got;
      doc = await keepTranscript(repo, { code: m.code, kind: m.kind, leadId: m.lead?.id || "", saas: m.saas, eventId: m.eventId, t: got.t, by: "agente", now: now() });
      if (!doc) return { ok: false, reason: "transcript_not_ready", detail: "o Google devolveu a transcrição vazia" };
    }
    const users = new Map((await repo.list("users")).map((u) => [u.id, u]));
    return {
      ok: true,
      meeting: entryOf(m, users),
      transcript: { text: doc.text, chars: doc.chars, source: doc.source, startTime: doc.startTime, endTime: doc.endTime, fetchedAt: doc.fetchedAt, cached },
    };
  }

  // Os cases autorizados pelo cliente, com os números de hoje do painel quando
  // o case está publicado (cases-live.js, os mesmos do deck).
  async function cases() {
    const vivos = new Map((await live(repo).catch(() => [])).map((d) => [d.id, d]));
    return (await repo.list("cases"))
      .filter((c) => c.authorizedAt)
      .map((c) => caseForAgent(vivos.get(c.id) || c))
      .sort((a, b) => a.order - b.order || b.authorizedAt.localeCompare(a.authorizedAt));
  }

  return { meetings, transcript, cases };
}
