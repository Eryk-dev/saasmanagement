// Reuniões e calls — telas Agenda, Consultas e Análise de Pitches, mais o
// Google (Calendar/Meet) que faz a call existir.
//
// Três coisas moram aqui e não têm endpoint pronto na API: a GRADE da agenda
// (a tela monta os compromissos no navegador a partir dos leads), a JORNADA da
// mentoria (consultas agrupadas por família) e o DESFECHO de cada call (feita /
// no-show / confirmada). Sem elas o modelo teria que baixar leads inteiros e
// derivar tudo na mão — que é exatamente onde se erra o dia e o fuso.
//
// FUSO: callAt, integrationAt, consultations.at e as horas de agenda_blocks são
// "hora de Brasília sem fuso" ("YYYY-MM-DDTHH:MM"). Lead que entrou por
// integração grava ISO com fuso. `brt()` normaliza os dois no mesmo relógio de
// parede — a mesma régua do callMoment/wallNow da API.

import { z } from "zod";
import { http, API_BASE } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, today, shiftDay } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, num } from "../core/shape.js";

const UNITS = {
  durationMin: "min", minutes: "min", de: "hora (0-24)", ate: "hora (0-24)",
  fromHour: "hora (0-24)", toHour: "hora (0-24)", progresso: "%", chars: "caracteres",
};

const COLS = {
  agenda: ["dia", "hora", "tipo", "pessoa", "nome", "empresa", "situacao", "saas", "link", "leadId"],
  blocos: ["id", "tipo", "titulo", "pessoas", "recorrencia", "dia", "diaSemana", "diaInteiro", "de", "ate", "saas"],
  slots: ["dia", "hora", "closer", "closerNome", "nivel", "at"],
  calls: ["dia", "hora", "lead", "empresa", "responsavel", "grupo", "temperatura", "objecoesAbertas", "dores", "resumo", "gravacao", "leadId"],
  consultas: ["id", "n", "de", "cliente", "crianca", "dia", "hora", "durationMin", "status", "responsavel", "meet", "resumida"],
  jornadas: ["cliente", "feitas", "total", "proxima", "proximaN", "resumidas", "manual"],
  manuais: ["id", "cliente", "crianca", "status", "secoesEscritas", "secoes", "progresso", "entregueEm", "link"],
  objecoes: ["objecao", "total", "abertas"],
  dores: ["dor", "total"],
  pessoas: ["grupo", "id", "count"],
  google: ["id", "nome", "papeis", "googleConectado", "contaGoogle"],
};

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// "hora de Brasília sem fuso" | ISO com fuso -> { dia, hora, ms }. Datas naive
// NÃO passam por new Date() cru: o container roda em UTC e o dia escorregava.
function brt(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const naive = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s) && !/([Zz]|[+-]\d{2}:?\d{2})$/.test(s);
  if (naive) {
    const dia = s.slice(0, 10);
    const hora = s.length >= 16 ? s.slice(11, 16) : "00:00";
    return { dia, hora, ms: Date.parse(`${dia}T${hora}:00-03:00`) };
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  const iso = new Date(d.getTime() - 3 * 3_600_000).toISOString();
  return { dia: iso.slice(0, 10), hora: iso.slice(11, 16), ms: d.getTime() };
}

const fmtHora = (h) => {
  const n = Number(h) || 0;
  return `${String(Math.floor(n)).padStart(2, "0")}:${String(Math.round((n % 1) * 60)).padStart(2, "0")}`;
};

// A agenda é sobre o que AINDA VAI acontecer, e resolvePeriod só olha pra trás
// (é feito pra relatório). Sem período pedido, a janela vai de hoje pra frente;
// "all" inclui o futuro em vez de parar em hoje.
function janela({ period, since, until } = {}, ahead = 13) {
  if (!period && !since && !until) {
    return { ...resolvePeriod({ since: today(), until: shiftDay(today(), ahead) }), label: `hoje → +${ahead}d` };
  }
  if (String(period || "").toLowerCase() === "all") {
    return { ...resolvePeriod({ since: "2024-01-01", until: shiftDay(today(), 365) }), label: "tudo (com o futuro)" };
  }
  return resolvePeriod({ period, since, until });
}

// Equipe: nome legível de userId (a API só devolve o id nos compromissos) e o
// resolvedor de "pessoa" por nome, que é como o humano pergunta.
async function team() {
  const users = await http.get("/api/auth/users").catch(() => []);
  const byId = new Map((users || []).map((u) => [u.id, u]));
  return { users: users || [], byId, nome: (id) => byId.get(id)?.name || id || "—" };
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function resolvePerson(users, who) {
  if (!who) return "";
  const alvo = norm(who);
  const u = users.find((x) => norm(x.id) === alvo)
    || users.find((x) => norm(x.name) === alvo)
    || users.find((x) => norm(x.name).startsWith(alvo));
  if (!u) throw new Error(`não achei a pessoa "${who}". Time: ${users.map((x) => `${x.id} (${x.name})`).join(", ") || "(vazio)"}`);
  return u.id;
}

// Kind do estágio pelo funil do produto (stages.js): é o kind que diz se o
// próximo toque é um COMPROMISSO de follow-up ou só cadência do GPS.
const stageKind = (product, stage) => {
  const row = (product?.funnel || []).find((f) => f && f.stage === stage);
  if (row?.kind) return row.kind;
  return /follow/i.test(String(stage || "")) ? "followup" : "";
};
const isNoShowStage = (s) => /no.?show/i.test(String(s || ""));

// Bloqueio/compromisso casa com o dia? Mesma régua do matchBlock do front e do
// blockHits do agenda-slots.js.
const blockOnDay = (b, dia) => (b.recur === "weekly"
  ? Number(b.weekday) === new Date(`${dia}T12:00:00Z`).getUTCDay()
  : b.date === dia);

const participantsOf = (b) => (Array.isArray(b.users) && b.users.length ? b.users : (b.user ? [b.user] : []));

const daysOf = (p) => {
  const out = [];
  for (let d = p.since; d <= p.until; d = shiftDay(d, 1)) out.push(d);
  return out;
};

const corta = (s, n = 180) => (s && String(s).length > n ? `${String(s).slice(0, n - 1)}…` : (s || ""));

export function registerAgendaTools(tool) {
  // ── Agenda ────────────────────────────────────────────────────────────────

  tool("agenda_free_slots", {
    group: "Agenda e calls",
    title: "Horários livres pra call",
    description: "Próximos horários livres pra marcar call, com roteamento por nível do closer e a agenda ocupada descontada.",
    input: {
      saas: z.string().optional(),
      lead: z.string().optional().describe("id do lead; sai da ocupação e sua nota define o pool."),
      grade: z.enum(["S", "A", "B", "C", "D", "E"]).optional().describe("Nota do lead quando não há `lead`; define o pool."),
      days: z.number().int().optional().describe("Dias úteis (1-15, padrão 5)."),
      limit: z.number().int().optional().describe("1-30, padrão 8."),
    },
    hint: "saas é obrigatório na API: passe o id do produto (report_portfolio lista os disponíveis).",
  }, async ({ saas, lead, grade, days, limit }) => {
    const product = await resolveProduct(saas);
    const [r, t] = await Promise.all([
      http.get("/api/agenda/free-slots", { saas: product.id, lead, grade, days, limit }),
      team(),
    ]);
    const rows = (r.slots || []).map((s) => {
      const b = brt(s.at) || { dia: "", hora: "" };
      return {
        dia: b.dia, hora: b.hora, closer: s.closer, closerNome: t.nome(s.closer),
        nivel: s.level === 3 ? "sênior" : s.level === 2 ? "pleno" : "júnior",
        at: s.at,
      };
    });
    const porDia = {};
    for (const x of rows) porDia[x.dia] = (porDia[x.dia] || 0) + 1;
    return result({
      kind: "agenda.free_slots",
      title: `Horários livres · ${product.name || product.id}`,
      scope: { saas: product.id, lead: lead || null, grade: r.grade || grade || null, pool: r.pool || null },
      totals: { horarios: rows.length, primeiro: rows[0]?.at || null, pool: r.pool || "", nota: r.grade || "" },
      columns: COLS.slots,
      rows,
      rowsLabel: "Horários livres",
      tables: {
        porDia: { label: "Horários por dia", columns: ["dia", "horarios"], rows: Object.entries(porDia).map(([dia, horarios]) => ({ dia, horarios })) },
      },
      notes: [
        "grade de 30 min, call ocupa 1h, fim de semana fora; a oferta respeita 2h de antecedência mínima.",
        r.pool === "all" ? "nenhum closer com nível cadastrado: caiu no pool de todos (agendamento nunca trava por cadastro incompleto)." : "",
        "marcar de fato = gravar closer e callAt no lead (módulo pipeline) e depois lead_schedule_meet pra sala do Meet.",
      ].filter(Boolean),
      source: { endpoint: "GET /api/agenda/free-slots" },
    });
  });

  tool("agenda_view", {
    group: "Agenda e calls",
    title: "Agenda do time",
    description: "Calls, follow-ups, integrações, consultas 1:1 e bloqueios por dia e por pessoa, com o desfecho de cada call (feita, no-show, confirmada).",
    input: {
      saas: z.string().optional(),
      person: z.string().optional().describe("id ou nome."),
      ...periodInput(z),
      kinds: z.array(z.enum(["call", "follow-up", "integração", "consulta", "toque"])).optional().describe("Padrão: todos menos toque."),
      limit: z.number().int().optional().describe("Padrão 100."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, person, period, since, until, kinds, limit = 100, offset = 0 }) => {
    const p = janela({ period, since, until }, 13);
    const [leads, blocks, consultations, products, t] = await Promise.all([
      http.get("/api/leads"),
      http.get("/api/agenda_blocks"),
      http.get("/api/consultations").catch(() => []),
      http.get("/api/products"),
      team(),
    ]);
    const productById = new Map((products || []).map((x) => [x.id, x]));
    const quem = person ? resolvePerson(t.users, person) : "";
    const inc = new Set(kinds?.length ? kinds : ["call", "follow-up", "integração", "consulta"]);
    const agora = Date.now();

    const ev = [];
    const push = (b, o) => { if (b && Number.isFinite(b.ms)) ev.push({ dia: b.dia, hora: b.hora, ms: b.ms, ...o }); };
    for (const l of (leads || [])) {
      if (saas && l.saas !== saas) continue;
      const k = stageKind(productById.get(l.saas), l.stage);
      const base = { nome: l.name || "", empresa: l.company || "", saas: l.saas || "", leadId: l.id };
      const c = brt(l.callAt);
      if (c) {
        const feita = c.ms < agora;
        const noShow = feita && (isNoShowStage(l.stage) || l.lostReason === "nao_compareceu");
        push(c, { ...base, tipo: "call", pessoa: l.closer || "", link: l.callUrl || "", situacao: noShow ? "no-show" : feita ? "feita" : (l.callConfirmed ? "confirmada" : "agendada") });
      }
      const i = brt(l.integrationAt);
      if (i) push(i, { ...base, tipo: "integração", pessoa: l.integrator || l.closer || "", link: l.integrationCallUrl || "", situacao: i.ms < agora ? "feita" : (l.integrationConfirmed ? "confirmada" : "agendada") });
      // Follow-up é COMPROMISSO quando o card está numa etapa de follow-up
      // (nextActionAt) ou quando tem hora própria (followupAt); toque de
      // cadência é GPS, não agenda — só entra se pedido.
      const na = brt(l.nextActionAt);
      if (na) {
        if (k === "followup") push(na, { ...base, tipo: "follow-up", pessoa: l.closer || l.owner || "", link: "", situacao: na.ms < agora ? "vencido" : "marcado" });
        else push(na, { ...base, tipo: "toque", pessoa: l.owner || l.closer || "", link: "", situacao: na.ms < agora ? "vencido" : "marcado" });
      }
      const f = brt(l.followupAt);
      if (f && l.followupAt !== l.nextActionAt) push(f, { ...base, tipo: "follow-up", pessoa: l.closer || l.owner || "", link: "", situacao: f.ms < agora ? "feito" : "marcado" });
      for (const h of (Array.isArray(l.callHistory) ? l.callHistory : [])) {
        push(brt(h?.at), { ...base, tipo: "call", pessoa: h?.closer || l.closer || "", link: "", situacao: "feita (remarcada por cima)" });
      }
    }
    for (const c of (consultations || [])) {
      if (saas && c.saas !== saas) continue;
      if (!c.at || c.status === "canceled") continue;
      push(brt(c.at), {
        tipo: "consulta", pessoa: c.owner || "", nome: c.clientName || "cliente",
        empresa: `consulta ${c.n || "?"} de ${c.packageTotal || 8}`, saas: c.saas || "",
        link: c.meetUrl || "", situacao: c.status || "", leadId: c.leadId || "",
      });
    }

    const janelaOk = (x) => x.dia >= p.since && x.dia <= p.until;
    const todos = ev.filter((x) => janelaOk(x) && inc.has(x.tipo) && (!quem || x.pessoa === quem))
      .sort((a, b) => a.ms - b.ms)
      .map((x) => ({ ...x, pessoa: x.pessoa ? t.nome(x.pessoa) : "sem responsável" }));
    const s = select(todos, { limit, offset });

    // Bloqueios e compromissos da tela Agenda, expandidos dia a dia (o weekly
    // vale em toda semana da janela — listar o registro cru esconderia isso).
    const bloqRows = [];
    for (const dia of daysOf(p)) {
      for (const b of (blocks || [])) {
        if (saas && b.saas && b.saas !== saas) continue;
        if (!blockOnDay(b, dia)) continue;
        const us = participantsOf(b);
        if (quem && !us.includes(quem)) continue;
        bloqRows.push({
          dia, tipo: b.kind === "event" ? "compromisso" : "bloqueio",
          titulo: b.title || b.reason || "", pessoas: us.map(t.nome).join(", ") || "time",
          de: b.allDay ? 0 : num(b.fromHour), ate: b.allDay ? 24 : num(b.toHour),
          diaInteiro: !!b.allDay, id: b.id,
        });
      }
    }

    const contaPor = (campo) => {
      const m = new Map();
      for (const x of todos) m.set(x[campo], (m.get(x[campo]) || 0) + 1);
      return [...m.entries()].map(([k2, v]) => ({ [campo]: k2, compromissos: v })).sort((a, b) => (campo === "dia" ? String(a.dia).localeCompare(String(b.dia)) : b.compromissos - a.compromissos));
    };

    return result({
      kind: "agenda.view",
      title: `Agenda${saas ? ` · ${saas}` : ""}${quem ? ` · ${t.nome(quem)}` : ""}`,
      scope: { saas: saas || null, pessoa: quem ? t.nome(quem) : null },
      period: p,
      units: UNITS,
      totals: {
        compromissos: todos.length,
        calls: todos.filter((x) => x.tipo === "call").length,
        callsFeitas: todos.filter((x) => x.tipo === "call" && String(x.situacao).startsWith("feita")).length,
        noShow: todos.filter((x) => x.situacao === "no-show").length,
        confirmadas: todos.filter((x) => x.situacao === "confirmada").length,
        followUps: todos.filter((x) => x.tipo === "follow-up").length,
        integracoes: todos.filter((x) => x.tipo === "integração").length,
        consultas: todos.filter((x) => x.tipo === "consulta").length,
        bloqueios: bloqRows.length,
      },
      columns: COLS.agenda,
      rows: s.rows,
      rowsLabel: "Compromissos",
      page: s.page,
      tables: {
        porDia: { label: "Por dia", columns: ["dia", "compromissos"], rows: contaPor("dia") },
        porPessoa: { label: "Por pessoa", columns: ["pessoa", "compromissos"], rows: contaPor("pessoa") },
        bloqueios: { label: "Bloqueios e compromissos da tela Agenda", columns: ["dia", "tipo", "titulo", "pessoas", "de", "ate", "diaInteiro", "id"], rows: bloqRows, units: UNITS },
      },
      notes: [
        "montado a partir dos leads (callAt, integrationAt, nextActionAt, followupAt, callHistory) + consultas + agenda_blocks: é a MESMA derivação da tela, não existe endpoint que devolva essa lista.",
        "no-show = call passada com o card em etapa de no show ou motivo de perda 'nao_compareceu'; confirmada = o lead respondeu o lembrete.",
        inc.has("toque") ? "toques de cadência (GPS) incluídos — eles não ocupam a agenda de ninguém." : "toques de cadência do GPS ficaram de fora (peça kinds=[\"toque\"] pra vê-los).",
      ],
      source: { endpoint: "GET /api/leads + /api/agenda_blocks + /api/consultations" },
    });
  });

  tool("agenda_blocks", {
    group: "Agenda e calls",
    title: "Bloqueios e compromissos",
    description: "Lê, cria, edita e apaga os bloqueios de horário e compromissos que travam a marcação de call.",
    write: true, destructive: true,
    danger: "action=delete apaga o item da agenda de todo mundo que participa dele.",
    input: {
      action: z.enum(["list", "create", "update", "delete"]).optional().describe("Padrão list."),
      id: z.string().optional(),
      saas: z.string().optional(),
      person: z.string().optional().describe("id ou nome."),
      users: z.array(z.string()).optional().describe("ids ou nomes; a 1ª é a dona principal."),
      kind: z.enum(["block", "event"]).optional().describe("event = compromisso com título."),
      title: z.string().optional().describe("kind=event."),
      reason: z.string().optional().describe("kind=block."),
      recur: z.enum(["once", "weekly"]).optional().describe("once usa `date`; weekly usa `weekday`."),
      date: z.string().optional().describe("YYYY-MM-DD."),
      weekday: z.number().int().min(0).max(6).optional().describe("0=dom…6=sáb."),
      all_day: z.boolean().optional(),
      from_hour: z.number().optional().describe("Horas decimais (7.5 = 07:30)."),
      to_hour: z.number().optional().describe("Exclusivo."),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
    hint: "create exige pelo menos uma pessoa e (date) ou (recur=weekly + weekday); compromisso (kind=event) exige título.",
  }, async ({ action = "list", id, saas, person, users, kind, title, reason, recur, date, weekday, all_day, from_hour, to_hour, limit = 100, offset = 0 }) => {
    const t = await team();
    const ids = (users || []).map((u) => resolvePerson(t.users, u));
    const quem = person ? resolvePerson(t.users, person) : "";

    if (action === "list") {
      const all = await http.get("/api/agenda_blocks");
      const rows = (all || [])
        .filter((b) => (!saas || !b.saas || b.saas === saas) && (!quem || participantsOf(b).includes(quem)))
        .map((b) => ({
          id: b.id, tipo: b.kind === "event" ? "compromisso" : "bloqueio",
          titulo: b.title || b.reason || "", pessoas: participantsOf(b).map(t.nome).join(", ") || "time",
          recorrencia: b.recur === "weekly" ? "toda semana" : "pontual",
          dia: b.date || "", diaSemana: b.recur === "weekly" ? DIAS[Number(b.weekday) || 0] : "",
          diaInteiro: !!b.allDay, de: b.allDay ? 0 : num(b.fromHour), ate: b.allDay ? 24 : num(b.toHour),
          saas: b.saas || "",
        }));
      const s = select(rows, { sort: ["recorrencia", "dia"], limit, offset });
      return result({
        kind: "agenda.blocks",
        title: "Bloqueios e compromissos da agenda",
        scope: { saas: saas || null, pessoa: quem ? t.nome(quem) : null },
        units: UNITS,
        totals: { itens: rows.length, bloqueios: rows.filter((r) => r.tipo === "bloqueio").length, compromissos: rows.filter((r) => r.tipo === "compromisso").length, semanais: rows.filter((r) => r.recorrencia === "toda semana").length },
        columns: COLS.blocos,
        rows: s.rows,
        rowsLabel: "Itens",
        page: s.page,
        source: { endpoint: "GET /api/agenda_blocks" },
      });
    }

    if (action === "delete") {
      if (!id) throw new Error("action=delete exige o `id` (veja com action=list).");
      await http.del(`/api/agenda_blocks/${encodeURIComponent(id)}`);
      return result({ kind: "agenda.blocks.delete", title: `Item ${id} removido da agenda`, totals: { id, removido: true }, source: { endpoint: `DELETE /api/agenda_blocks/${id}` } });
    }

    const campos = {};
    if (saas !== undefined) campos.saas = saas;
    if (ids.length) { campos.user = ids[0]; campos.users = ids; }
    if (kind) campos.kind = kind;
    if (title !== undefined) campos.title = title;
    if (reason !== undefined) campos.reason = reason;
    if (recur) campos.recur = recur;
    if (date !== undefined) campos.date = date;
    if (weekday !== undefined) campos.weekday = weekday;
    if (all_day !== undefined) { campos.allDay = all_day; if (all_day) { campos.fromHour = 0; campos.toHour = 24; } }
    if (from_hour !== undefined) campos.fromHour = from_hour;
    if (to_hour !== undefined) campos.toHour = to_hour;

    if (action === "update") {
      if (!id) throw new Error("action=update exige o `id` (veja com action=list).");
      const r = await http.patch(`/api/agenda_blocks/${encodeURIComponent(id)}`, campos);
      return result({ kind: "agenda.blocks.update", title: `Item ${id} atualizado`, detail: r, source: { endpoint: `PATCH /api/agenda_blocks/${id}` } });
    }

    if (!ids.length) throw new Error("informe `users` com pelo menos uma pessoa (id ou nome).");
    if (!campos.date && campos.recur !== "weekly") throw new Error("informe `date` (pontual) ou recur=weekly + `weekday`.");
    if ((campos.kind || "block") === "event" && !String(campos.title || "").trim()) throw new Error("compromisso (kind=event) precisa de `title`.");
    if (!campos.allDay && !(num(campos.toHour) > num(campos.fromHour))) throw new Error("`to_hour` precisa ser maior que `from_hour` (ou use all_day=true).");
    const r = await http.post("/api/agenda_blocks", { kind: "block", recur: "once", allDay: false, ...campos });
    return result({
      kind: "agenda.blocks.create",
      title: `${campos.kind === "event" ? "Compromisso" : "Bloqueio"} criado`,
      totals: { id: r?.id || "", pessoas: ids.map(t.nome).join(", "), quando: campos.recur === "weekly" ? `toda ${DIAS[campos.weekday || 0]}` : campos.date, de: campos.allDay ? "dia inteiro" : fmtHora(campos.fromHour), ate: campos.allDay ? "" : fmtHora(campos.toHour) },
      notes: ["recorrência em vários dias da semana = um registro por dia (repita a chamada mudando `weekday`)."],
      source: { endpoint: "POST /api/agenda_blocks" },
    });
  });

  // ── Meet do lead ──────────────────────────────────────────────────────────

  tool("lead_schedule_meet", {
    group: "Agenda e calls",
    title: "Criar Meet do lead",
    description: "Cria a sala do Meet da call de venda (ou da integração) do lead: evento no Calendar, convite por e-mail e gravação automática.",
    write: true, external: true,
    danger: "cria um evento real no Google Calendar e manda convite por e-mail pro lead e pros convidados.",
    input: {
      lead_id: z.string(),
      kind: z.enum(["call", "integracao"]).optional().describe("Padrão call (usa callAt); integracao usa integrationAt."),
      guests: z.array(z.string()).optional().describe("E-mails extras; ficam salvos no lead."),
    },
    hint: "o horário tem que estar no lead (callAt/integrationAt) e o responsável (closer/integrador) precisa ter a conta Google pessoal conectada — confira com google_status.",
  }, async ({ lead_id, kind = "call", guests }) => {
    const r = await http.post(`/api/leads/${encodeURIComponent(lead_id)}/meet`, { kind, guests: guests || [] });
    return result({
      kind: "agenda.meet",
      title: r.existing ? `Sala já existia · lead ${lead_id}` : `Meet criado · lead ${lead_id}`,
      scope: { lead: lead_id, kind },
      totals: {
        callUrl: r.callUrl || "", organizador: r.organizer || "conta do time",
        convidados: (r.attendees || []).length,
        gravacaoAutomatica: r.meetConfig?.recording ?? null,
        transcricaoAutomatica: r.meetConfig?.transcription ?? null,
        salaAberta: r.meetConfig?.open ?? null,
      },
      detail: r,
      notes: [
        "sala de produto @leverads nasce na conta pessoal do responsável: só o Drive do organizador recebe gravação e transcrição.",
        r.meetConfig && r.meetConfig.recording === false ? "gravação automática NÃO ficou ligada (plano da conta): sem ela não sai resumo de IA depois." : "",
        "remarcar a call = alterar callAt no lead; o convite acompanha sozinho.",
      ].filter(Boolean),
      source: { endpoint: `POST /api/leads/${lead_id}/meet` },
    });
  });

  tool("meet_end", {
    group: "Agenda e calls",
    title: "Encerrar sala do Meet",
    description: "Encerra a conferência aberta na sala do lead; sala esquecida aberta trava a gravação e a transcrição do Google.",
    write: true, external: true,
    danger: "derruba a conferência ativa: quem ainda estiver na sala sai da call.",
    input: {
      lead_id: z.string(),
      kind: z.enum(["call", "integracao"]).optional().describe("Padrão call."),
    },
    hint: "só o organizador encerra a sala — se der erro, confira em google_status se a conta que criou o Meet segue conectada.",
  }, async ({ lead_id, kind = "call" }) => {
    const r = await http.post(`/api/leads/${encodeURIComponent(lead_id)}/meet/end`, { kind });
    return result({
      kind: "agenda.meet_end",
      title: `Sala encerrada · lead ${lead_id}`,
      scope: { lead: lead_id, kind },
      detail: r,
      notes: ["o Google só gera a transcrição depois que o último participante sai; o resumo por IA sai no próximo passe do poller (10 min) ou via call_summary_run."],
      source: { endpoint: `POST /api/leads/${lead_id}/meet/end` },
    });
  });

  tool("google_status", {
    group: "Agenda e calls",
    title: "Conexão do Google",
    description: "Estado da conta Google do time e da conta pessoal de cada pessoa — onde se descobre por que uma call nasceu sem sala do Meet.",
  }, async () => {
    const [g, t] = await Promise.all([http.get("/api/google/status"), team()]);
    const rows = t.users.map((u) => ({
      id: u.id, nome: u.name, papeis: (u.roles || []).join(", ") || u.role || "",
      googleConectado: !!u.googleConnected, contaGoogle: u.googleAccount || "",
    }));
    const closers = rows.filter((r) => /closer|integrator/.test(r.papeis));
    return result({
      kind: "agenda.google_status",
      title: "Google · conexão do time e das pessoas",
      totals: {
        configurado: !!g.configured, conectado: !!g.connected, contaDoTime: g.account || "",
        driveReadonly: !!g.driveReadonly, calendarioDoMeet: g.meetCalendar || "primary",
        pessoasConectadas: rows.filter((r) => r.googleConectado).length,
        closersSemGoogle: closers.filter((r) => !r.googleConectado).map((r) => r.nome).join(", ") || "nenhum",
      },
      columns: COLS.google,
      rows,
      rowsLabel: "Pessoas",
      notes: [
        "desde 01/09/2026 a sala de produto @leverads é organizada pela conta PESSOAL do responsável (só o Drive do organizador recebe gravação e transcrição); a conta do time só organiza UniqueKids.",
        "closer sem Google conectado = call criada sem sala, e o motivo fica registrado na timeline do lead (evento meet_skipped).",
        "`googleConectado` não garante os escopos do Meet (meetReady): quem conectou antes da mudança precisa RECONECTAR, e isso só a própria pessoa vê em Ajustes → Integrações.",
      ],
      source: { endpoint: "GET /api/google/status + /api/auth/users" },
    });
  });

  // ── Calls resumidas por IA ────────────────────────────────────────────────

  tool("calls_list", {
    group: "Calls e pitch",
    title: "Calls resumidas por IA",
    description: "Calls já resumidas pela IA: temperatura, dores, objeções em aberto, resumo e gravação, por período, pessoa e grupo.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      group: z.enum(["venda", "sdr", "all"]).optional().describe("venda = lead com closer; sdr = sem closer. Padrão all."),
      person: z.string().optional().describe("id ou nome."),
      temperatura: z.enum(["quente", "morno", "frio"]).optional(),
      kind: z.enum(["call", "integracao", "all"]).optional().describe("Padrão call."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, group = "all", person, temperatura, kind = "call", q, limit = 25, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const [acts, leads, t] = await Promise.all([
      // Um dia de folga de cada lado: `at` é instante UTC e a janela é por dia
      // de Brasília. Sem a folga, a call das 21h do último dia (que em UTC já é
      // o dia seguinte) sumia do relatório, e a das 21h da véspera entrava.
      http.get("/api/activities", { saas: product.id, since: shiftDay(p.since, -1) }),
      http.get("/api/leads"),
      team(),
    ]);
    const quem = person ? resolvePerson(t.users, person) : "";
    const leadById = new Map((leads || []).map((l) => [l.id, l]));

    const resumos = (acts || [])
      .filter((a) => a?.meta?.event === "call_summary" && a.meta.summary)
      .filter((a) => (kind === "all" ? true : (a.meta.kind || "call") === kind))
      .filter((a) => { const d = brt(a.at)?.dia || ""; return d >= p.since && d <= p.until; })
      .sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
    // Uma linha por CALL: re-resumo da mesma call não conta duas vezes (mesma
    // dedup da tela Análise de Pitches).
    const vistos = new Set();
    const rows = [];
    for (const a of resumos) {
      const chave = a.meta.meetEventId || a.lead || a.id;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const l = leadById.get(a.lead) || {};
      const resp = l.closer || l.owner || "";
      const grupo = l.closer ? "venda" : "sdr";
      const b = brt(a.at) || { dia: "", hora: "" };
      const s = a.meta.summary || {};
      rows.push({
        dia: b.dia, hora: b.hora, lead: l.name || "", empresa: l.company || "",
        responsavel: resp ? t.nome(resp) : "sem responsável", responsavelId: resp, grupo,
        temperatura: s.temperatura || s.sentimento || "",
        objecoesAbertas: (s.objecoes || []).filter((o) => !o.resolvida).length,
        dores: (s.dores || []).join("; "),
        resumo: corta(s.resumo, 220),
        gravacao: a.meta.recordingUrl || "",
        leadId: a.lead || "",
      });
    }
    const filtradas = rows
      .filter((r) => (group === "all" ? true : r.grupo === group))
      .filter((r) => (!quem || r.responsavelId === quem))
      .filter((r) => (!temperatura || r.temperatura === temperatura));
    const s = select(filtradas, { q, qFields: ["lead", "empresa", "resumo", "dores"], sort: "dia:desc", limit, offset });

    const temp = { quente: 0, morno: 0, frio: 0 };
    for (const r of filtradas) if (temp[r.temperatura] != null) temp[r.temperatura]++;
    const porPessoa = new Map();
    for (const r of filtradas) porPessoa.set(r.responsavel, (porPessoa.get(r.responsavel) || 0) + 1);

    return result({
      kind: "calls.list",
      title: `Calls resumidas · ${product.name || product.id}`,
      scope: { saas: product.id, grupo: group, pessoa: quem ? t.nome(quem) : null, tipo: kind },
      period: p,
      totals: {
        calls: filtradas.length, ...temp,
        comGravacao: filtradas.filter((r) => r.gravacao).length,
        objecoesAbertas: filtradas.reduce((a, r) => a + num(r.objecoesAbertas), 0),
      },
      columns: COLS.calls,
      rows: s.rows,
      rowsLabel: "Calls",
      page: s.page,
      tables: {
        porPessoa: { label: "Calls por responsável", columns: ["responsavel", "calls"], rows: [...porPessoa.entries()].map(([responsavel, calls]) => ({ responsavel, calls })).sort((a, b) => b.calls - a.calls) },
      },
      notes: [
        "só entram calls com transcrição do Meet resumida pela IA: call sem gravação (ou sala de conta sem os escopos) nunca aparece aqui.",
        "o responsável é o closer do lead; sem closer, o dono (qualificação do SDR) — o resumo não guarda quem conduziu.",
        "use call_summary_get pra ler o resumo inteiro de uma call.",
      ],
      source: { endpoint: "GET /api/activities (event=call_summary)" },
    });
  });

  tool("call_summary_get", {
    group: "Calls e pitch",
    title: "Resumo da call",
    description: "Resumo completo da call do lead: temperatura, dores, objeções tratadas e em aberto, combinados, follow-up sugerido, briefing de integração e gravação.",
    input: {
      lead_id: z.string(),
      kind: z.enum(["call", "integracao", "all"]).optional().describe("Padrão all."),
      history: z.boolean().optional().describe("Lista todos os resumos do lead (padrão true)."),
    },
    hint: "sem resumo ainda? call_summary_run gera na hora (precisa da transcrição do Meet pronta).",
  }, async ({ lead_id, kind = "all", history = true }) => {
    const acts = await http.get("/api/activities", { lead: lead_id });
    const eventos = (acts || [])
      .filter((a) => ["call_summary", "integration_brief", "meet_created", "meet_skipped", "copilot_transcript"].includes(a?.meta?.event))
      .sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
    const resumos = eventos.filter((a) => a.meta.event === "call_summary" && (kind === "all" || (a.meta.kind || "call") === kind));
    const ultimo = resumos[0] || null;
    const brief = eventos.find((a) => a.meta.event === "integration_brief") || null;
    const s = ultimo?.meta?.summary || null;

    return result({
      kind: "calls.summary",
      title: `Resumo da call · lead ${lead_id}`,
      scope: { lead: lead_id, tipo: ultimo?.meta?.kind || kind },
      totals: {
        resumos: resumos.length,
        quando: ultimo?.at || null,
        temperatura: s?.temperatura || s?.sentimento || "",
        objecoesAbertas: (s?.objecoes || []).filter((o) => !o.resolvida).length,
        gravacao: ultimo?.meta?.recordingUrl || "",
        temBriefingDeIntegracao: !!brief,
      },
      tables: {
        objecoes: {
          label: "Objeções",
          columns: ["objecao", "resolvida", "comoFoiTratada"],
          rows: (s?.objecoes || []).map((o) => ({ objecao: o.objecao, resolvida: !!o.resolvida, comoFoiTratada: o.comoFoiTratada || "" })),
        },
        historico: history ? {
          label: "Eventos de call do lead",
          columns: ["at", "evento", "tipo", "temperatura", "gravacao"],
          rows: eventos.map((a) => ({ at: a.at || "", evento: a.meta.event, tipo: a.meta.kind || "", temperatura: a.meta.temperatura || "", gravacao: a.meta.recordingUrl || "" })),
        } : null,
      },
      detail: { resumo: s, briefingDeIntegracao: brief?.meta?.brief || null },
      notes: ultimo ? [] : ["esse lead ainda não tem resumo de call: ou a call não aconteceu, ou a transcrição do Meet não ficou pronta (sala aberta / conta sem gravação)."],
      source: { endpoint: `GET /api/activities?lead=${lead_id}` },
    });
  });

  tool("call_summary_run", {
    group: "Calls e pitch",
    title: "Gerar resumo da call",
    description: "Manda a IA ler a transcrição do Meet e gravar o resumo da call (ou o briefing pro integrador) na timeline do lead.",
    write: true, external: true,
    danger: "gasta crédito de IA (lê a transcrição inteira da call).",
    input: {
      lead_id: z.string(),
      action: z.enum(["call", "integracao", "brief"]).optional().describe("Padrão call; brief = briefing pro integrador."),
      force: z.boolean().optional().describe("Refaz resumo existente."),
    },
    hint: "reason=transcript_not_ready significa que o Google ainda não gerou a transcrição; call_in_progress = a sala continua aberta (use meet_end).",
  }, async ({ lead_id, action = "call", force = false }) => {
    const path = action === "brief"
      ? `/api/leads/${encodeURIComponent(lead_id)}/integration-brief`
      : `/api/leads/${encodeURIComponent(lead_id)}/call-summary`;
    const body = action === "brief" ? { force } : { force, kind: action };
    const r = await http.post(path, body, { timeoutMs: 300_000 });
    const RAZOES = {
      not_configured: "IA não configurada no servidor.",
      not_connected: "nenhuma conta Google apta a ler a transcrição dessa call.",
      no_meet: "esse lead não tem sala do Meet nesse tipo de call.",
      no_source: "sem transcrição da call de venda e sem resumo anterior pra basear o briefing.",
      already_done: "essa call já foi resumida (use force=true pra refazer).",
      transcript_not_ready: "o Google ainda não publicou a transcrição.",
      call_in_progress: "a sala do Meet segue aberta: o Google só gera a transcrição quando o último participante sai.",
    };
    return result({
      kind: "calls.summary_run",
      title: `${action === "brief" ? "Briefing de integração" : "Resumo da call"} · lead ${lead_id}`,
      scope: { lead: lead_id, action },
      totals: { ok: !!r.ok, motivo: r.reason || "", gravacao: r.recordingUrl || "" },
      detail: r.summary || r.brief || r,
      notes: r.ok ? [] : [RAZOES[r.reason] || `não gerou (${r.reason || "motivo desconhecido"}).`],
      source: { endpoint: `POST ${path}` },
    });
  });

  tool("pitch_report", {
    group: "Calls e pitch",
    title: "Análise de pitches",
    description: "Objeções recorrentes (e quantas em aberto), dores mais citadas, temperatura e calls recentes do produto, por closer e por grupo.",
    input: {
      saas: z.string().optional(),
      group: z.enum(["venda", "sdr"]).optional().describe("Omitido = os dois juntos."),
      person: z.string().optional().describe("id ou nome."),
      limit: z.number().int().optional().describe("Por tabela (padrão 20)."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, group, person, limit = 20, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const t = await team();
    const quem = person ? resolvePerson(t.users, person) : undefined;
    const d = await http.get(`/api/pitch/${encodeURIComponent(product.id)}/calls`, { closer: quem, group });
    const temp = d.temperatura || { quente: 0, morno: 0, frio: 0 };
    const objs = select(d.objecoes || [], { sort: "total:desc", limit, offset });
    const dor = select(d.dores || [], { sort: "total:desc", limit, offset });
    return result({
      kind: "calls.pitch_report",
      title: `Análise de pitches · ${product.name || product.id}`,
      scope: { saas: product.id, grupo: group || "todos", pessoa: quem ? t.nome(quem) : "todos" },
      totals: {
        calls: d.count || 0, ...temp,
        objecoesDistintas: (d.objecoes || []).length,
        objecoesEmAberto: (d.objecoes || []).reduce((a, o) => a + num(o.abertas), 0),
        iaConfigurada: !!d.aiConfigured,
      },
      columns: COLS.objecoes,
      rows: objs.rows,
      rowsLabel: "Objeções recorrentes",
      page: objs.page,
      tables: {
        dores: { label: "Dores mais citadas", columns: COLS.dores, rows: dor.rows },
        pessoas: { label: "Calls por pessoa e grupo", columns: COLS.pessoas, rows: (d.closers || []).map((c) => ({ grupo: c.group, id: c.id ? t.nome(c.id) : "sem responsável", count: c.count })) },
        recentes: {
          label: "Calls recentes",
          columns: ["dia", "lead", "responsavel", "grupo", "temperatura", "resumo", "gravacao", "leadId"],
          rows: (d.recent || []).map((r) => ({
            dia: (brt(r.at) || {}).dia || "", lead: r.leadName || "", responsavel: r.closer ? t.nome(r.closer) : "sem responsável",
            grupo: r.group || "", temperatura: r.temperatura || "", resumo: corta(r.resumo, 200),
            gravacao: r.recordingUrl || "", leadId: r.leadId || "",
          })),
        },
      },
      notes: [
        "a base é só o que virou resumo de IA: call sem gravação/transcrição não entra na análise.",
        "venda e qualificação têm teor diferente e nunca são misturadas no mesmo diagnóstico — escolha o grupo.",
        "filtrar por \"sem responsável\" não é possível daqui (a API distingue ausente de vazio pela querystring).",
        dor.page.truncated ? `dores: ${dor.page.returned} de ${dor.page.total} (limit=${limit}) — suba o limit ou use offset.` : "",
      ].filter(Boolean),
      source: { endpoint: `GET /api/pitch/${product.id}/calls` },
    });
  });

  tool("pitch_improve", {
    group: "Calls e pitch",
    title: "Diagnóstico do pitch",
    description: "A IA lê as calls resumidas e devolve o diagnóstico do roteiro, como tratar as objeções recorrentes e um script melhorado. Não grava nada.",
    external: true,
    danger: "gasta crédito de IA (lê até 60 resumos de call).",
    input: {
      saas: z.string().optional(),
      group: z.enum(["venda", "sdr"]).optional().describe("venda = roteiro de fechamento; sdr = 1º contato."),
      person: z.string().optional().describe("id ou nome."),
      script_key: z.string().optional().describe("Padrão call, ou novo se group=sdr."),
    },
    hint: "erro 422 = ainda não há calls resumidas por IA nesse recorte (confira em pitch_report).",
  }, async ({ saas, group, person, script_key }) => {
    const product = await resolveProduct(saas);
    const t = await team();
    const quem = person ? resolvePerson(t.users, person) : null;
    const key = script_key || (group === "sdr" ? "novo" : "call");
    const atual = product.scripts?.[key] || {};
    const r = await http.post(`/api/pitch/${encodeURIComponent(product.id)}/improve`, {
      scriptKey: key,
      scriptLabel: group === "sdr" ? "1º contato (SDR)" : "Call de fechamento",
      currentScript: { resumo: atual.resumo || "", objetivo: atual.objetivo || "", passos: atual.passos || [] },
      closer: quem, group: group || null,
    }, { timeoutMs: 300_000 });
    return result({
      kind: "calls.pitch_improve",
      title: `Diagnóstico do pitch · ${product.name || product.id}`,
      scope: { saas: product.id, roteiro: key, grupo: group || "todos", pessoa: quem ? t.nome(quem) : "todos" },
      totals: { callsAnalisadas: r.base || 0 },
      tables: {
        objecoes: {
          label: "Objeções recorrentes e como tratar",
          columns: ["objecao", "frequencia", "comoTratarNoPitch"],
          rows: (r.objecoesRecorrentes || []).map((o) => ({ objecao: o.objecao || "", frequencia: o.frequencia || "", comoTratarNoPitch: o.comoTratarNoPitch || "" })),
        },
      },
      detail: { diagnostico: r.diagnostico || "", sugestao: r.sugestao || null },
      notes: ["o roteiro ATUAL enviado é só o override salvo no produto: o roteiro padrão vive no front, então o diagnóstico pode ignorar passos que o time vê na tela."],
      source: { endpoint: `POST /api/pitch/${product.id}/improve` },
    });
  });

  tool("copilot_status", {
    group: "Calls e pitch",
    title: "Copiloto da call",
    description: "Estado do copiloto de call: sessões abertas, progresso do checklist, objeção detectada, sugestão da vez e termômetro do cliente.",
    input: {
      lead_id: z.string().optional().describe("Omitido = sessões mais recentes."),
      saas: z.string().optional(),
      only_active: z.boolean().optional().describe("Padrão false."),
      limit: z.number().int().optional().describe("Padrão 20."),
      offset: z.number().int().optional(),
    },
    hint: "enviar áudio/print da call é fluxo de navegador (o closer inicia o copiloto no drawer do lead); pelo MCP só se lê o estado.",
  }, async ({ lead_id, saas, only_active = false, limit = 20, offset = 0 }) => {
    const all = await http.get("/api/copilot_sessions");
    const t = await team();
    const sessoes = (all || [])
      .filter((s) => (!lead_id || s.lead === lead_id) && (!saas || s.saas === saas) && (!only_active || !s.endedAt))
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));

    const rows = sessoes.map((s) => ({
      lead: s.lead, saas: s.saas || "", operador: s.user ? t.nome(s.user) : "",
      ativa: !s.endedAt, inicio: s.startedAt || "", fim: s.endedAt || "",
      pedacos: (s.segments || []).length,
      chars: (s.segments || []).reduce((a, x) => a + String(x.text || "").length, 0),
      etapasCobertas: (s.cues?.steps || []).filter((c) => c.done).length,
      etapas: (s.checklist || []).length,
      temperatura: s.cues?.leitura?.temperatura || "",
      confianca: s.cues?.leitura?.confianca || "",
      objecao: corta(s.cues?.objecao?.resumo || "", 120),
      sugestao: corta(s.cues?.sugestao || "", 120),
    }));
    const s0 = select(rows, { limit, offset });
    const foco = lead_id ? sessoes[0] : null;

    return result({
      kind: "calls.copilot",
      title: lead_id ? `Copiloto · lead ${lead_id}` : "Sessões do copiloto de call",
      scope: { lead: lead_id || null, saas: saas || null },
      units: UNITS,
      totals: { sessoes: rows.length, ativas: rows.filter((r) => r.ativa).length },
      columns: ["lead", "operador", "ativa", "inicio", "fim", "pedacos", "chars", "etapasCobertas", "etapas", "temperatura", "confianca", "objecao", "sugestao"],
      rows: s0.rows,
      rowsLabel: "Sessões",
      page: s0.page,
      detail: foco ? {
        checklist: foco.checklist || [],
        cues: foco.cues || null,
        leituraVisual: foco.visual || null,
        transcricaoFinal: corta((foco.segments || []).map((x) => x.text).filter(Boolean).join("\n"), 1600),
      } : null,
      notes: [
        "o áudio nunca é guardado: só o texto transcrito e os cues.",
        "a transcrição inteira vira um registro na timeline do lead quando a sessão é encerrada (evento copilot_transcript) — leia com call_summary_get.",
      ],
      source: { endpoint: "GET /api/copilot_sessions" },
    });
  });

  // ── Consultas 1:1 (mentoria) ──────────────────────────────────────────────

  tool("consultations_list", {
    group: "Consultas (mentoria 1:1)",
    title: "Consultas da mentoria",
    description: "Consultas 1:1 da mentoria por período, status e responsável, mais a jornada de cada família (quantas feitas, próxima marcada e se há Manual).",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      status: z.enum(["scheduled", "done", "canceled", "all"]).optional().describe("Padrão all."),
      person: z.string().optional().describe("id ou nome."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, status = "all", person, q, limit = 50, offset = 0 }) => {
    const p = janela({ period, since, until }, 30);
    const [todas, manuais, t] = await Promise.all([
      http.get("/api/consultations"),
      http.get("/api/deliverables").catch(() => []),
      team(),
    ]);
    const quem = person ? resolvePerson(t.users, person) : "";
    const doProduto = (todas || []).filter((c) => !saas || c.saas === saas);

    const rows = doProduto
      .map((c) => ({ c, b: brt(c.at) }))
      .filter(({ c, b }) => (status === "all" || c.status === status)
        && (!quem || c.owner === quem)
        && (!b || (b.dia >= p.since && b.dia <= p.until)))
      .map(({ c, b }) => ({
        id: c.id, n: c.n || null, de: c.packageTotal || 8, cliente: c.clientName || "", crianca: c.childName || "",
        dia: b?.dia || "", hora: b?.hora || "", durationMin: num(c.durationMin) || 60,
        status: c.status || "", responsavel: c.owner ? t.nome(c.owner) : "sem responsável",
        meet: c.meetUrl || "", resumida: !!c.summary,
      }))
      .sort((a, b) => `${a.dia}${a.hora}`.localeCompare(`${b.dia}${b.hora}`));
    const s = select(rows, { q, qFields: ["cliente", "crianca"], limit, offset });

    // Jornada = consultas da MESMA família (mesmo matcher do servidor: ids
    // quando ambos têm, senão o nome do cliente). A tela monta isso no
    // navegador; sem isto aqui, "em que pé está a família X" não tem resposta.
    const familia = (a, b) => {
      if (a.customerId && b.customerId) return a.customerId === b.customerId;
      if (a.leadId && b.leadId) return a.leadId === b.leadId;
      const an = norm(a.clientName); const bn = norm(b.clientName);
      return !!an && an === bn;
    };
    const jornadas = [];
    for (const c of doProduto) {
      let j = jornadas.find((x) => familia(x, c));
      if (!j) { j = { clientName: c.clientName || "?", customerId: c.customerId || "", leadId: c.leadId || "", itens: [] }; jornadas.push(j); }
      if (c.customerId && !j.customerId) j.customerId = c.customerId;
      if (c.leadId && !j.leadId) j.leadId = c.leadId;
      j.itens.push(c);
    }
    const jornadaRows = jornadas.map((j) => {
      const prox = j.itens.filter((c) => c.status === "scheduled" && c.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))[0] || null;
      const manual = (manuais || []).find((m) => familia(j, m)) || null;
      return {
        cliente: j.clientName,
        feitas: j.itens.filter((c) => c.status === "done").length,
        total: j.itens.reduce((a, c) => Math.max(a, num(c.packageTotal)), 0) || 8,
        proxima: prox ? `${(brt(prox.at) || {}).dia} ${(brt(prox.at) || {}).hora}` : "",
        proximaN: prox?.n || null,
        resumidas: j.itens.filter((c) => c.summary).length,
        manual: manual ? `${manual.status === "delivered" ? "entregue" : "em construção"} (${manual.id})` : "sem manual",
      };
    }).sort((a, b) => String(a.proxima || "9999").localeCompare(String(b.proxima || "9999")));

    return result({
      kind: "consult.list",
      title: "Consultas 1:1 da mentoria",
      scope: { saas: saas || null, status, pessoa: quem ? t.nome(quem) : null },
      period: p,
      units: UNITS,
      totals: {
        consultasNaJanela: rows.length,
        agendadas: rows.filter((r) => r.status === "scheduled").length,
        feitas: rows.filter((r) => r.status === "done").length,
        canceladas: rows.filter((r) => r.status === "canceled").length,
        semMeet: rows.filter((r) => r.status === "scheduled" && !r.meet).length,
        familias: jornadaRows.length,
      },
      columns: COLS.consultas,
      rows: s.rows,
      rowsLabel: "Consultas",
      page: s.page,
      tables: { jornadas: { label: "Jornadas por família (todas as consultas, fora da janela também)", columns: COLS.jornadas, rows: jornadaRows } },
      notes: ["sem período pedido a janela é hoje → +30 dias; use period=\"all\" pra ver a mentoria inteira, passado e futuro."],
      source: { endpoint: "GET /api/consultations" },
    });
  });

  tool("consultation_get", {
    group: "Consultas (mentoria 1:1)",
    title: "Uma consulta por inteiro",
    description: "Uma consulta com o registro de IA (temas, combinados, tarefas de casa, sinais de atenção) e o recap da consulta anterior da mesma família.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const [c, todas, manuais, t] = await Promise.all([
      http.get(`/api/consultations/${encodeURIComponent(id)}`),
      http.get("/api/consultations"),
      http.get("/api/deliverables").catch(() => []),
      team(),
    ]);
    const familia = (a, b) => {
      if (a.customerId && b.customerId) return a.customerId === b.customerId;
      if (a.leadId && b.leadId) return a.leadId === b.leadId;
      const an = norm(a.clientName); const bn = norm(b.clientName);
      return !!an && an === bn;
    };
    const irmas = (todas || []).filter((x) => familia(x, c)).sort((a, b) => num(a.n) - num(b.n));
    const anterior = irmas.filter((x) => x.id !== c.id && x.summary && num(x.n) < (num(c.n) || 99)).sort((a, b) => num(b.n) - num(a.n))[0] || null;
    const manual = (manuais || []).find((m) => familia(m, c)) || null;
    const b = brt(c.at);

    return result({
      kind: "consult.get",
      title: `Consulta ${c.n || "?"}/${c.packageTotal || 8} · ${c.clientName || "cliente"}`,
      scope: { id: c.id, saas: c.saas || null },
      units: UNITS,
      totals: {
        quando: b ? `${b.dia} ${b.hora}` : "", durationMin: num(c.durationMin) || 60,
        status: c.status || "", responsavel: c.owner ? t.nome(c.owner) : "sem responsável",
        meet: c.meetUrl || "", resumida: !!c.summary,
        naJornada: `${irmas.filter((x) => x.status === "done").length} feitas de ${c.packageTotal || 8}`,
        manual: manual ? manual.id : "sem manual",
      },
      tables: {
        jornada: {
          label: "Consultas dessa família",
          columns: ["n", "dia", "hora", "status", "resumida", "id"],
          rows: irmas.map((x) => { const bb = brt(x.at); return { n: x.n || null, dia: bb?.dia || "", hora: bb?.hora || "", status: x.status || "", resumida: !!x.summary, id: x.id }; }),
        },
      },
      detail: {
        registro: c.summary || null,
        notasDaResponsavel: c.notes || "",
        recapDaAnterior: anterior ? { n: anterior.n, registro: anterior.summary } : null,
        contato: { telefone: c.phone || "", email: c.clientEmail || "", crianca: c.childName || "" },
        gravacao: c.transcriptUrl || "",
      },
      notes: c.summary ? [] : ["consulta ainda sem registro de IA: o poller resume depois que a transcrição do Meet fica pronta, ou use consultation_summary."],
      source: { endpoint: `GET /api/consultations/${id}` },
    });
  });

  tool("consultation_save", {
    group: "Consultas (mentoria 1:1)",
    title: "Marcar ou cancelar consulta",
    description: "Cria, edita ou apaga uma consulta 1:1; criar garante o Manual da Família e espelha o horário na agenda Google da responsável.",
    write: true, destructive: true, external: true,
    danger: "action=delete apaga a consulta e o registro de IA dela de vez (e cancela o convite da família no Google); mudar `at` reenvia o convite remarcado pro e-mail dela. Pra desmarcar, use status=canceled.",
    input: {
      action: z.enum(["create", "update", "delete"]).describe("delete APAGA o registro; pra desmarcar use status=canceled."),
      id: z.string().optional(),
      saas: z.string().optional().describe("Padrão uniquekids."),
      client_name: z.string().optional(),
      child_name: z.string().optional(),
      customer_id: z.string().optional(),
      lead_id: z.string().optional(),
      phone: z.string().optional(),
      client_email: z.string().optional().describe("Recebe o convite do Meet."),
      n: z.number().int().optional().describe("Encontro na jornada (1..8)."),
      package_total: z.number().int().optional().describe("4 ou 8."),
      at: z.string().optional().describe("Dia e hora, hora de Brasília sem fuso: \"YYYY-MM-DDTHH:MM\"."),
      duration_min: z.number().int().optional().describe("Padrão 60."),
      status: z.enum(["scheduled", "done", "canceled"]).optional(),
      owner: z.string().optional().describe("id ou nome."),
      notes: z.string().optional().describe("Entram no material do Manual."),
    },
    hint: "at é hora de Brasília sem fuso (\"2026-09-10T14:00\") — mandar ISO com Z desloca a consulta.",
  }, async ({ action, id, saas, client_name, child_name, customer_id, lead_id, phone, client_email, n, package_total, at, duration_min, status, owner, notes }) => {
    if (action !== "create" && !id) throw new Error(`action=${action} exige o \`id\` da consulta (veja em consultations_list).`);
    if (action === "delete") {
      await http.del(`/api/consultations/${encodeURIComponent(id)}`);
      return result({ kind: "consult.delete", title: `Consulta ${id} apagada`, totals: { id, apagada: true }, notes: ["o espelho na agenda pessoal E o evento do Meet da conta do time são cancelados junto (o convite da família cai)."], source: { endpoint: `DELETE /api/consultations/${id}` } });
    }
    const t = await team();
    const campos = {};
    if (saas !== undefined) campos.saas = saas;
    if (client_name !== undefined) campos.clientName = client_name;
    if (child_name !== undefined) campos.childName = child_name;
    if (customer_id !== undefined) campos.customerId = customer_id;
    if (lead_id !== undefined) campos.leadId = lead_id;
    if (phone !== undefined) campos.phone = phone;
    if (client_email !== undefined) campos.clientEmail = client_email;
    if (n !== undefined) campos.n = n;
    if (package_total !== undefined) campos.packageTotal = package_total;
    if (at !== undefined) campos.at = at;
    if (duration_min !== undefined) campos.durationMin = duration_min;
    if (status !== undefined) campos.status = status;
    if (owner !== undefined) campos.owner = resolvePerson(t.users, owner);
    if (notes !== undefined) campos.notes = notes;

    if (action === "create") {
      if (!campos.clientName) throw new Error("create exige `client_name` (é o que agrupa a jornada da família).");
      const r = await http.post("/api/consultations", { saas: "uniquekids", status: "scheduled", durationMin: 60, n: 1, ...campos });
      return result({
        kind: "consult.create",
        title: `Consulta ${r.n || "?"} de ${r.clientName || "cliente"} marcada`,
        totals: { id: r.id, quando: r.at || "", responsavel: r.owner ? t.nome(r.owner) : "sem responsável" },
        notes: ["a sala do Meet NÃO nasce junto: rode consultation_meet pra criar o convite com gravação e transcrição."],
        source: { endpoint: "POST /api/consultations" },
      });
    }
    const r = await http.patch(`/api/consultations/${encodeURIComponent(id)}`, campos);
    return result({
      kind: "consult.update",
      title: `Consulta ${id} atualizada`,
      totals: { id, quando: r?.at || "", status: r?.status || "" },
      detail: campos,
      notes: at !== undefined && r?.meetEventId ? ["o convite do Meet acompanha o horário novo sozinho (o Google avisa os convidados); status=canceled apaga o evento."] : [],
      source: { endpoint: `PATCH /api/consultations/${id}` },
    });
  });

  tool("consultation_meet", {
    group: "Consultas (mentoria 1:1)",
    title: "Criar Meet da consulta",
    description: "Cria a sala da consulta na conta do time, convida o e-mail do cliente e põe o recap da anterior na descrição do convite.",
    write: true, external: true,
    danger: "cria evento real no Google Calendar e manda convite por e-mail pra família.",
    input: {
      id: z.string(),
      guests: z.array(z.string()).optional().describe("Máx. 10 no total."),
    },
    hint: "a consulta precisa ter dia/hora (`at`) e a conta Google do time conectada — confira com google_status.",
  }, async ({ id, guests }) => {
    const r = await http.post(`/api/consultations/${encodeURIComponent(id)}/meet`, { guests: guests || [] });
    return result({
      kind: "consult.meet",
      title: `Meet da consulta ${id}`,
      scope: { id },
      totals: {
        meet: r.meetUrl || "", convidados: (r.attendees || []).length,
        gravacaoAutomatica: r.meetConfig?.recording ?? null, transcricaoAutomatica: r.meetConfig?.transcription ?? null,
      },
      detail: r,
      notes: ["sem e-mail na consulta o convite cai no e-mail do cliente/lead cadastrado; sem nenhum, a sala é criada mas ninguém é convidado."],
      source: { endpoint: `POST /api/consultations/${id}/meet` },
    });
  });

  tool("consultation_summary", {
    group: "Consultas (mentoria 1:1)",
    title: "Resumir consulta por IA",
    description: "Manda a IA ler a transcrição do Meet da consulta e gravar o registro estruturado (temas, combinados, tarefas de casa, sinais de atenção).",
    write: true, external: true,
    danger: "gasta crédito de IA (lê a transcrição inteira da consulta).",
    input: {
      id: z.string(),
      force: z.boolean().optional().describe("Refaz registro existente."),
    },
    hint: "sem transcrição pronta o Google ainda não fechou a sala: encerre o Meet e tente de novo em alguns minutos.",
  }, async ({ id, force = false }) => {
    const r = await http.post(`/api/consultations/${encodeURIComponent(id)}/summary`, { force }, { timeoutMs: 300_000 });
    return result({
      kind: "consult.summary",
      title: `Registro da consulta ${id}`,
      scope: { id },
      totals: { ok: !!r.ok, motivo: r.reason || "" },
      detail: r.summary || r,
      source: { endpoint: `POST /api/consultations/${id}/summary` },
    });
  });

  // ── Manual da Família (entregável) ────────────────────────────────────────

  tool("deliverables_list", {
    group: "Consultas (mentoria 1:1)",
    title: "Manuais da Família",
    description: "Manuais da Família (entregável final da mentoria) com progresso das seções escritas, status entregue/em construção e link público.",
    input: {
      saas: z.string().optional(),
      status: z.enum(["building", "delivered", "all"]).optional().describe("Padrão all."),
      q: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, status = "all", q, limit = 50, offset = 0 }) => {
    const all = await http.get("/api/deliverables");
    const rows = (all || [])
      .filter((m) => (!saas || m.saas === saas) && (status === "all" || (m.status || "building") === status))
      .map((m) => {
        const secoes = (m.sections || []).length || 6;
        const escritas = (m.sections || []).filter((s) => String(s.content || "").trim()).length;
        return {
          id: m.id, cliente: m.clientName || "", crianca: m.childName || "",
          status: m.status === "delivered" ? "entregue" : "em construção",
          secoesEscritas: escritas, secoes, progresso: Math.round((escritas / secoes) * 100),
          entregueEm: m.deliveredAt || "", link: `${API_BASE}/m/${m.id}`,
        };
      });
    const s = select(rows, { q, qFields: ["cliente", "crianca"], sort: "progresso:desc", limit, offset });
    return result({
      kind: "consult.deliverables",
      title: "Manuais da Família",
      scope: { saas: saas || null, status },
      units: UNITS,
      totals: {
        manuais: rows.length,
        entregues: rows.filter((r) => r.status === "entregue").length,
        emConstrucao: rows.filter((r) => r.status === "em construção").length,
        vazios: rows.filter((r) => r.secoesEscritas === 0).length,
      },
      columns: COLS.manuais,
      rows: s.rows,
      rowsLabel: "Manuais",
      page: s.page,
      notes: ["o link público é o id como token (quem tem o link vê); o domínio aqui é o da API — no cockpit é o mesmo host das propostas."],
      source: { endpoint: "GET /api/deliverables" },
    });
  });

  tool("deliverable_get", {
    group: "Consultas (mentoria 1:1)",
    title: "Um Manual da Família",
    description: "As seções de um Manual da Família com o texto escrito, a orientação de cada seção e de quais consultas foi composto.",
    input: {
      id: z.string(),
      full: z.boolean().optional().describe("Padrão false = trecho."),
    },
  }, async ({ id, full = false }) => {
    const m = await http.get(`/api/deliverables/${encodeURIComponent(id)}`);
    const rows = (m.sections || []).map((s) => ({
      key: s.key, titulo: s.title || "",
      escrita: !!String(s.content || "").trim(),
      conteudo: full ? (s.content || "") : corta(s.content, 300),
      consultas: (s.sources || []).join(", "),
      atualizadaEm: s.updatedAt || "",
    }));
    return result({
      kind: "consult.deliverable",
      title: `Manual da Família · ${m.clientName || "?"}${m.childName ? ` · ${m.childName}` : ""}`,
      scope: { id: m.id, saas: m.saas || null },
      units: UNITS,
      totals: {
        status: m.status === "delivered" ? "entregue" : "em construção",
        secoesEscritas: rows.filter((r) => r.escrita).length, secoes: rows.length,
        progresso: rows.length ? Math.round((rows.filter((r) => r.escrita).length / rows.length) * 100) : 0,
        entregueEm: m.deliveredAt || "", link: `${API_BASE}/m/${m.id}`,
      },
      columns: ["key", "titulo", "escrita", "consultas", "atualizadaEm", "conteudo"],
      rows,
      rowsLabel: "Seções",
      tables: { orientacoes: { label: "O que vai em cada seção", columns: ["key", "hint"], rows: (m.sections || []).map((s) => ({ key: s.key, hint: s.hint || "" })) } },
      source: { endpoint: `GET /api/deliverables/${id}` },
    });
  });

  tool("deliverable_compose", {
    group: "Consultas (mentoria 1:1)",
    title: "Compor Manual por IA",
    description: "A IA lê os registros e as notas das consultas da família e escreve as seções do Manual que já têm material.",
    write: true, destructive: true, external: true,
    danger: "sobrescreve o texto das seções compostas — o que a responsável escreveu à mão nelas é substituído.",
    input: { id: z.string() },
    hint: "erro 400 = a família ainda não tem consulta com resumo ou nota; resuma uma consulta antes (consultation_summary).",
  }, async ({ id }) => {
    const r = await http.post(`/api/deliverables/${encodeURIComponent(id)}/compose`, {}, { timeoutMs: 300_000 });
    const rows = (r.sections || []).map((s) => ({
      key: s.key, titulo: s.title || "", reescrita: (r.updatedKeys || []).includes(s.key),
      caracteres: String(s.content || "").length, consultas: (s.sources || []).join(", "),
    }));
    return result({
      kind: "consult.compose",
      title: `Manual ${id} composto por IA`,
      scope: { id },
      totals: { secoesReescritas: (r.updatedKeys || []).length, secoes: rows.length },
      columns: ["key", "titulo", "reescrita", "caracteres", "consultas"],
      rows,
      rowsLabel: "Seções",
      notes: ["seção sem material nas consultas fica como estava — o texto é proposta pra revisão, não entrega final."],
      source: { endpoint: `POST /api/deliverables/${id}/compose` },
    });
  });

  tool("deliverable_update", {
    group: "Consultas (mentoria 1:1)",
    title: "Editar ou entregar Manual",
    description: "Cria um Manual da Família, escreve o texto de uma seção ou marca como entregue (libera o link público pra família).",
    write: true,
    input: {
      action: z.enum(["create", "set_section", "status"]).describe("set_section escreve uma seção; status marca entregue."),
      id: z.string().optional(),
      section_key: z.string().optional().describe("raio_x, plano_rotina, guia_birras, banco_falas, cantinho_calma, jornada."),
      content: z.string().optional().describe("Substitui o texto da seção."),
      status: z.enum(["building", "delivered"]).optional(),
      saas: z.string().optional().describe("Padrão uniquekids."),
      client_name: z.string().optional(),
      child_name: z.string().optional(),
      customer_id: z.string().optional(),
      lead_id: z.string().optional(),
    },
    hint: "o manual nasce sozinho na 1ª consulta da família: antes de criar um novo, procure em deliverables_list.",
  }, async ({ action, id, section_key, content, status, saas, client_name, child_name, customer_id, lead_id }) => {
    if (action === "create") {
      const r = await http.post("/api/deliverables", {
        saas: saas || "uniquekids", clientName: client_name || "Nova família", childName: child_name || "",
        customerId: customer_id || "", leadId: lead_id || "", status: "building",
      });
      return result({
        kind: "consult.deliverable_create",
        title: `Manual criado · ${r.clientName || "?"}`,
        totals: { id: r.id, secoes: (r.sections || []).length, link: `${API_BASE}/m/${r.id}` },
        notes: ["o servidor aplicou o template das 6 seções (elas nascem vazias)."],
        source: { endpoint: "POST /api/deliverables" },
      });
    }
    if (!id) throw new Error(`action=${action} exige o \`id\` do manual (veja em deliverables_list).`);
    if (action === "status") {
      if (!status) throw new Error("action=status exige `status` (delivered ou building).");
      const r = await http.patch(`/api/deliverables/${encodeURIComponent(id)}`, {
        status, deliveredAt: status === "delivered" ? new Date().toISOString() : "",
      });
      return result({
        kind: "consult.deliverable_status",
        title: `Manual ${id} · ${status === "delivered" ? "entregue" : "em construção"}`,
        totals: { id, status: r?.status || status, entregueEm: r?.deliveredAt || "", link: `${API_BASE}/m/${id}` },
        source: { endpoint: `PATCH /api/deliverables/${id}` },
      });
    }
    if (!section_key || content === undefined) throw new Error("action=set_section exige `section_key` e `content`.");
    // O PATCH substitui o array inteiro: sem ler antes, salvar uma seção
    // apagaria as outras cinco.
    const atual = await http.get(`/api/deliverables/${encodeURIComponent(id)}`);
    const secoes = atual.sections || [];
    if (!secoes.some((s) => s.key === section_key)) {
      throw new Error(`seção "${section_key}" não existe nesse manual. Seções: ${secoes.map((s) => s.key).join(", ") || "(nenhuma)"}`);
    }
    const sections = secoes.map((s) => (s.key === section_key ? { ...s, content, updatedAt: new Date().toISOString() } : s));
    const r = await http.patch(`/api/deliverables/${encodeURIComponent(id)}`, { sections });
    const escritas = (r.sections || sections).filter((s) => String(s.content || "").trim()).length;
    return result({
      kind: "consult.deliverable_section",
      title: `Seção ${section_key} salva no manual ${id}`,
      units: UNITS,
      totals: { id, secao: section_key, caracteres: String(content).length, secoesEscritas: escritas, secoes: sections.length },
      source: { endpoint: `PATCH /api/deliverables/${id}` },
    });
  });
}
