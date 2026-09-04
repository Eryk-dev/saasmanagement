// Treinamentos (tela "Treinamentos") — flashcards estilo Anki com FSRS POR
// PESSOA: base oficial do produto, fila do dia, provas de checkpoint e o quadro
// da equipe.
//
// Duas coisas moldam este módulo:
//
//  1. Quase toda rota de /api/flashcards exige SESSÃO de usuário ("treino é por
//     pessoa"): a chave mestre do MCP toma 401 em queue, review, stats, fun,
//     prova e imagem. Só GET/PUT da base e GET /team passam. Então o que aqui é
//     "fila" e "consistência" é RECONSTRUÍDO das coleções (training_states,
//     training_reviews, training_fun, training_exams), que o CRUD genérico
//     entrega — com o id da pessoa sempre EXPLÍCITO no parâmetro `user`.
//  2. Por consequência, responder card em nome de alguém não existe aqui: a
//     rota de review é de sessão e não há caminho de impersonação. O MCP lê e
//     edita a base; quem estuda é a pessoa, no cockpit.
//
// O dia de estudo tem régua PRÓPRIA (vira às 4h de São Paulo, igual ao Anki),
// diferente do dia do negócio de core/period.js — por isso o dayKey local.

import { z } from "zod";
import { http, ApiError } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, delta } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const GRUPO = "Treinamento (flashcards)";

// Espelho de routes.flashcards.js — a API devolve `roleLabels` nas duas rotas
// que o MCP alcança, mas o rótulo local mantém a ordem dos baralhos estável
// mesmo quando a resposta vem sem ele.
const ROLE_LABELS = {
  geral_negocio: "Geral · Negócio",
  geral_marketplace: "Geral · Marketplaces",
  geral_vendas: "Geral · Estratégia de vendas",
  sdr: "SDR", closer: "Closer", integrator: "Integrador · CS", social: "Mídia social",
};
const ROLE_ORDER = Object.keys(ROLE_LABELS);
const ROLES = new Set(ROLE_ORDER);
const GENERAL_ROLES = ["geral_negocio", "geral_marketplace", "geral_vendas"];
// Vagas de funil: quem tem uma delas fica travado no cockpit até zerar a fila.
const GATE_ROLES = ["sdr", "closer", "integrator", "social"];

// enum State da ts-fsrs (fsrs.js).
const STATE = { new: 0, learning: 1, review: 2, relearning: 3 };
// Card "maduro" no Anki: intervalo agendado ≥ 21 dias.
const MATURE_DAYS = 21;

const UNITS = {
  retencao7d: "%", retencao30d: "%", retencaoPct: "%", primeiraTentativaPct: "%",
  coberturaPct: "%", dominioPct: "%", errouPct: "%", acertoPct: "%", erroPct: "%",
  relampagoPct: "%", notaMedia: "%", nota: "%", notaMinima: "%", taxaAprovacaoPct: "%",
  fun30dAcertoPct: "%", retencaoMedia30d: "%", retencaoMedia7d: "%",
  tempoMedianoS: "s", tempoMedioS: "s", revisoesDia30d: "rev/dia",
};

// ── Régua do dia de estudo ───────────────────────────────────────────────────
// São Paulo é UTC-3 fixo e a virada do Anki é às 4h: estudar 1h da manhã ainda
// conta como o dia anterior. core/period.js fala a régua do faturamento (0h),
// então a conversão de data DESTE módulo é a do fsrs.js, não a de lá.
const DAY_SHIFT_MS = (3 + 4) * 3600 * 1000;
const studyDay = (at = new Date()) => new Date(new Date(at).getTime() - DAY_SHIFT_MS).toISOString().slice(0, 10);
const studyDayEnd = (at = new Date()) => new Date(Date.parse(`${studyDay(at)}T07:00:00Z`) + 864e5);

// ── Cards, entries e rótulos ────────────────────────────────────────────────
// Um card vira VÁRIOS itens de estudo: cloze por índice, oclusão por máscara.
// Tudo que é fila, estado FSRS e log de revisão fala em ENTRY (`id`, `id::c1`).
const CLOZE_RE = /\{\{c(\d+)::(.*?)\}\}/gs;
const clozeIndexes = (text) =>
  [...new Set([...String(text || "").matchAll(CLOZE_RE)].map((m) => Number(m[1])))].sort((a, b) => a - b);

function cardEntries(card) {
  if (!card) return [];
  if (card.type === "cloze") {
    const ns = clozeIndexes(card.front);
    if (ns.length) return ns.map((n) => ({ entryId: `${card.id}::c${n}`, sub: `c${n}` }));
  } else if (card.type === "occlusion") {
    return (card.masks || []).map((m) => ({ entryId: `${card.id}::${m.id}`, sub: m.id }));
  }
  return [{ entryId: card.id, sub: null }];
}

// Texto legível de uma pergunta: sem a marcação de cloze e sem quebrar a tabela.
function label(text, max = 90) {
  const s = String(text || "").replace(CLOZE_RE, (m, n, body) => body.split("::")[0]).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const roleLabel = (role, labels) => (labels && labels[role]) || ROLE_LABELS[role] || role;

// Baralhos que a pessoa treina — mesma regra da API: com etiqueta de vaga ela
// pega os gerais + a vaga; admin sem vaga não tem fila; cadastro sem etiqueta
// nenhuma vê tudo.
function rolesForUser(user) {
  const tags = (user?.roles || []).filter((r) => ROLES.has(r));
  if (tags.length) return ROLE_ORDER.filter((r) => GENERAL_ROLES.includes(r) || tags.includes(r));
  return (user?.roles || []).includes("admin") ? [] : [...ROLE_ORDER];
}

const isAdmin = (u) => (u?.roles || []).includes("admin");

// ── Acesso ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// `users` é PRIVATE no CRUD genérico: a lista sai por /api/auth/users (já sem
// hash de senha).
async function teamUsers() {
  const rows = await http.get("/api/auth/users");
  return Array.isArray(rows) ? rows : [];
}

// Id da pessoa SEMPRE explícito: nenhuma tool deste módulo adivinha "o usuário
// logado" — o MCP roda com chave mestre e não tem dono.
function resolveUser(who, users) {
  const alvo = norm(who);
  const found = users.find((u) => norm(u.id) === alvo)
    || users.find((u) => norm(u.name) === alvo)
    || users.find((u) => norm(u.name).startsWith(alvo) || norm(u.id).startsWith(alvo));
  if (!found) {
    throw new ApiError(`pessoa "${who}" não existe no time`, {
      detail: `disponíveis: ${users.map((u) => `${u.id} (${u.name})`).join(", ") || "(nenhuma)"}`,
    });
  }
  return found;
}

const stateDocId = (saas, userId) => `${saas}__${userId}`;

async function getDoc(path) {
  try { return await http.get(path); } catch (e) { if (e.status === 404) return null; throw e; }
}

// ── Estatística ─────────────────────────────────────────────────────────────
const pctOf = (part, total) => (total ? Math.round((part / total) * 100) : null);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

// Média ponderada de percentuais que já vieram prontos da API (cada um com o
// próprio n): somar sem peso daria o mesmo valor a quem fez 3 e a quem fez 300.
function weighted(rows, key) {
  let soma = 0, n = 0;
  for (const r of rows) {
    const v = r?.[key];
    if (v && v.pct != null && v.n > 0) { soma += v.pct * v.n; n += v.n; }
  }
  return n ? { pct: Math.round(soma / n), n } : { pct: null, n: 0 };
}
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// True retention (a métrica do Anki): acerto (rating ≥ 2) SÓ nas revisões de
// cards que já estavam em revisão — mede memória, não o aprendizado do dia.
function metricsOf(revs) {
  const n = revs.length;
  const ret = revs.filter((r) => r.prevState === STATE.review);
  const first = revs.filter((r) => r.prevState === STATE.new);
  const times = revs.map((r) => num(r.ms)).filter((v) => v > 0);
  const med = median(times);
  return {
    revisoes: n,
    pessoas: new Set(revs.map((r) => r.user)).size,
    errouPct: pctOf(revs.filter((r) => r.rating === 1).length, n),
    acertoPct: pctOf(revs.filter((r) => r.rating >= 3).length, n),
    retencaoPct: pctOf(ret.filter((r) => r.rating >= 2).length, ret.length),
    amostraRetencao: ret.length,
    primeiraTentativaPct: pctOf(first.filter((r) => r.rating >= 3).length, first.length),
    tempoMedianoS: med == null ? null : round2(med / 1000),
    relampagoPct: pctOf(times.filter((v) => v < 1500).length, times.length),
    ultimoEm: revs.reduce((m, r) => (String(r.at) > m ? String(r.at) : m), "") || null,
  };
}

// Sequência de dias estudados (a régua da tela: hoje ou ontem ainda conta).
function streaksOf(dayCounts) {
  const hoje = studyDay();
  let streak = 0;
  for (let d = new Date(Date.parse(`${hoje}T12:00:00Z`) - (dayCounts[hoje] ? 0 : 864e5));
    dayCounts[d.toISOString().slice(0, 10)]; d = new Date(d.getTime() - 864e5)) streak++;
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(dayCounts).sort()) {
    run = prev && Date.parse(d) - Date.parse(prev) === 864e5 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { streak, bestStreak: best };
}

// Situação da pessoa em uma palavra — é o que o gestor lê primeiro.
const statusOf = (u) => (!u.lastReviewAt ? "nunca estudou"
  : u.overdue > 0 ? "atrasado"
    : u.dueToday > 0 ? "pendente hoje" : "em dia");

const cardShape = (z2) => z2.object({
  id: z2.string().optional().describe("omitido = card novo."),
  role: z2.enum(ROLE_ORDER),
  type: z2.enum(["basic", "cloze", "occlusion"]).optional().describe("padrão basic."),
  front: z2.string().optional().describe("pergunta; cloze usa {{c1::...}}."),
  back: z2.string().optional(),
  image: z2.string().optional().describe("id do asset (upload só pela tela)."),
  masks: z2.array(z2.object({ id: z2.string().optional(), x: z2.number(), y: z2.number(), w: z2.number(), h: z2.number() })).optional()
    .describe("retângulos de oclusão, fração 0..1 da imagem."),
});

export function registerTrainingTools(tool) {
  // ── O relatório do gestor ─────────────────────────────────────────────────
  tool("training_report", {
    group: GRUPO,
    title: "Relatório de treinamento",
    description: "Situação do treinamento do time: atrasos, retenção por pessoa, notas de prova e a carga de 7 dias.",
    input: {
      saas: z.string().optional(),
      include: z.array(z.enum(["rows", "decks", "forecast", "ranking", "integridade", "all"])).optional()
        .describe("Tabelas extras; padrão rows, decks, forecast."),
      sort: z.enum(["due", "retencao", "sequencia", "feitas", "nota", "cobertura", "nome"]).optional()
        .describe("Padrão due (mais vencidos primeiro)."),
      limit: z.number().int().optional(),
      min_deck_size: z.number().int().optional().describe("Ignora quem tem baralho menor (padrão 1)."),
    },
  }, async ({ saas, include, sort = "due", limit = 50, min_deck_size = 1 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const inc = new Set(include?.includes("all")
      ? ["rows", "decks", "forecast", "ranking", "integridade"]
      : (include?.length ? include : ["rows", "decks", "forecast"]));

    const [team, base, lembrete] = await Promise.all([
      http.get(`/api/flashcards/${encodeURIComponent(pid)}/team`),
      http.get(`/api/flashcards/${encodeURIComponent(pid)}`),
      // O job do Discord grava "já mandei hoje" num doc reservado de training_states.
      getDoc("/api/training_states/reminder").catch(() => null),
    ]);
    const labels = team.roleLabels || base.roleLabels;
    const todos = (team.users || []).filter((u) => u.deckSize >= min_deck_size);

    const rows = todos.map((u) => ({
      pessoa: u.name || u.id,
      userId: u.id,
      vagas: (u.roles || []).join(", ") || "—",
      status: statusOf(u),
      dueHoje: u.dueToday,
      atrasados: u.overdue,
      feitasHoje: u.doneToday,
      retencao30d: u.retention30d?.pct ?? null,
      amostra30d: u.retention30d?.n ?? 0,
      coberturaPct: pctOf(u.seen, u.deckSize),
      maduros: u.mature,
      sequencia: u.streak,
      notaMedia: u.examAvg,
      provaPendente: !!u.examPending,
      relampagoPct: u.rushPct,
      ultimoEstudo: u.lastReviewAt ? String(u.lastReviewAt).slice(0, 10) : null,
    }));

    const ORDEM = {
      due: ["dueHoje:desc", "feitasHoje:desc"], retencao: ["retencao30d:desc"], sequencia: ["sequencia:desc"],
      feitas: ["feitasHoje:desc"], nota: ["notaMedia:desc"], cobertura: ["coberturaPct:desc"], nome: ["pessoa"],
    };
    const s = select(rows, { sort: ORDEM[sort], limit });

    // Carga que vem: o forecast de cada pessoa é o mesmo eixo de 7 dias, então
    // somar por dia dá a fila do TIME (o que a tela mostra pessoa a pessoa).
    const dias = new Map();
    for (const u of todos) for (const f of u.forecast || []) dias.set(f.day, (dias.get(f.day) || 0) + num(f.n));
    const forecast = [...dias.entries()].sort().map(([dia, cards]) => ({ dia, cards }));

    // Baralho mais fraco do time = onde vai a próxima sessão de coaching.
    const porBaralho = ROLE_ORDER.map((role) => {
      const cards = (base.cards || []).filter((c) => c.role === role);
      if (!cards.length) return null;
      const w = weighted(todos.map((u) => ({ v: (u.retentionByRole || []).find((x) => x.role === role) })), "v");
      return {
        baralho: roleLabel(role, labels),
        role,
        cards: cards.length,
        entries: cards.flatMap(cardEntries).length,
        pessoas: todos.filter((u) => rolesForUser(u).includes(role)).length,
        retencao30d: w.pct,
        amostra: w.n,
        geral: GENERAL_ROLES.includes(role),
      };
    }).filter(Boolean);

    const ret30 = weighted(todos, "retention30d");
    const ret7 = weighted(todos, "retention7d");
    const totals = {
      pessoas: todos.length,
      emDia: todos.filter((u) => statusOf(u) === "em dia").length,
      atrasadas: todos.filter((u) => u.overdue > 0).length,
      nuncaEstudaram: todos.filter((u) => !u.lastReviewAt).length,
      dueHoje: todos.reduce((a, u) => a + num(u.dueToday), 0),
      atrasados: todos.reduce((a, u) => a + num(u.overdue), 0),
      feitasHoje: todos.reduce((a, u) => a + num(u.doneToday), 0),
      cardsProximos7d: forecast.reduce((a, f) => a + f.cards, 0),
      entriesNoBaralho: todos.reduce((a, u) => a + num(u.deckSize), 0),
      vistos: todos.reduce((a, u) => a + num(u.seen), 0),
      maduros: todos.reduce((a, u) => a + num(u.mature), 0),
      retencaoMedia30d: ret30.pct,
      amostraRetencao30d: ret30.n,
      retencaoMedia7d: ret7.pct,
      notaMediaProvas: avg(todos.map((u) => u.examAvg).filter((v) => v != null)),
      provasPendentes: todos.filter((u) => u.examPending).length,
      travadosNoCockpit: todos.filter((u) => !isAdmin(u) && (u.roles || []).some((r) => GATE_ROLES.includes(r)) && u.dueToday > 0).length,
    };

    const tables = {};
    if (inc.has("decks")) tables.baralhos = { label: "Retenção 30d por baralho (onde o time está mais fraco)", columns: ["baralho", "role", "cards", "entries", "pessoas", "retencao30d", "amostra", "geral"], rows: porBaralho };
    if (inc.has("forecast")) tables.previsao = { label: "Cards vencendo nos próximos 7 dias (time inteiro)", columns: ["dia", "cards"], rows: forecast };
    if (inc.has("ranking")) {
      const sr = select(todos.map((u) => ({
        pessoa: u.name || u.id, revisoesDia30d: u.reviewsPerDay30d, diasAtivos30d: u.activeDays30d,
        sequencia: u.streak, retencao30d: u.retention30d?.pct ?? null, fun30d: u.fun?.last30 ?? 0,
      })), { sort: ["revisoesDia30d:desc"], limit });
      tables.ranking = {
        label: "Ritmo de estudo (30 dias)",
        columns: ["pessoa", "revisoesDia30d", "diasAtivos30d", "sequencia", "retencao30d", "fun30d"],
        rows: sr.rows, page: sr.page,
      };
    }
    if (inc.has("integridade")) {
      const si = select(todos.map((u) => ({
        pessoa: u.name || u.id,
        tempoMedianoS: u.medianMs == null ? null : round2(u.medianMs / 1000),
        relampagoPct: u.rushPct, errou7dPct: u.again7dPct,
        feitasHoje: u.doneToday, revisoesDia30d: u.reviewsPerDay30d,
      })), { sort: ["relampagoPct:desc"], limit });
      tables.integridade = {
        label: "Ritmo de resposta (anti-burla: ninguém lembra de verdade em menos de 1,5s)",
        columns: ["pessoa", "tempoMedianoS", "relampagoPct", "errou7dPct", "feitasHoje", "revisoesDia30d"],
        rows: si.rows, page: si.page,
      };
    }

    const notes = [
      "retenção é TRUE RETENTION do Anki: acerto (rating ≥ 2) só nas revisões de cards que já estavam em revisão — o aprendizado do dia fica de fora de propósito.",
      "a média de retenção do time pondera cada pessoa pelo tamanho da amostra dela (n), senão quem fez 3 revisões pesaria igual a quem fez 300.",
      "admin fica FORA do quadro: treinamento não é cobrado de quem toca o negócio.",
      "`travadosNoCockpit` conta quem tem vaga de funil e card vencido — os cards NOVOS do dia entram além disso; o número exato da fila de uma pessoa sai em training_queue.",
    ];
    if (!totals.pessoas) notes.push("ninguém com baralho neste produto: confira as etiquetas de vaga (roles) do time em Ajustes → Time.");

    return result({
      kind: "training.report",
      title: `Treinamento · ${product.name || pid}`,
      scope: { saas: pid, diaDeEstudo: team.today },
      units: UNITS,
      totals,
      columns: ["pessoa", "vagas", "status", "dueHoje", "atrasados", "feitasHoje", "retencao30d", "amostra30d", "coberturaPct", "maduros", "sequencia", "notaMedia", "provaPendente", "relampagoPct", "ultimoEstudo"],
      rows: inc.has("rows") ? s.rows : [],
      rowsLabel: "Pessoas",
      page: inc.has("rows") ? s.page : undefined,
      tables,
      detail: {
        settings: base.settings,
        lembreteDiarioDiscord: { ultimoEnvio: lembrete?.lastSentDay || null, hoje: team.today },
      },
      notes,
      source: { endpoint: `GET /api/flashcards/${pid}/team` },
    });
  });

  // ── O quadro pessoa a pessoa ──────────────────────────────────────────────
  tool("training_team", {
    group: GRUPO,
    title: "Quadro da equipe",
    description: "Todas as colunas por pessoa; com `user`, o raio-x dela: retenção semanal, por baralho, previsão e provas.",
    input: {
      saas: z.string().optional(),
      user: z.string().optional().describe("id ou nome; vazio = time inteiro."),
      sort: z.enum(["due", "retencao", "sequencia", "feitas", "nome"]).optional().describe("Padrão due."),
      limit: z.number().int().optional(),
      include_history: z.boolean().optional().describe("Mapa de revisões por dia (~27 semanas)."),
    },
  }, async ({ saas, user, sort = "due", limit = 50, include_history = false }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const team = await http.get(`/api/flashcards/${encodeURIComponent(pid)}/team`);
    const labels = team.roleLabels;

    if (user) {
      const u = (team.users || []).find((x) => norm(x.id) === norm(user) || norm(x.name) === norm(user))
        || (team.users || []).find((x) => norm(x.name).startsWith(norm(user)));
      if (!u) {
        throw new ApiError(`"${user}" não está no quadro de treinamento de ${pid}`, {
          detail: `no quadro: ${(team.users || []).map((x) => `${x.id} (${x.name})`).join(", ") || "(ninguém)"} — admin fica de fora de propósito.`,
        });
      }
      const tables = {
        semanal: {
          label: "Retenção verdadeira por semana (8 semanas, da mais antiga pra atual)",
          columns: ["semana", "retencaoPct", "amostra"],
          rows: (u.weekly || []).map((w) => ({ semana: w.start, retencaoPct: w.pct, amostra: w.n })),
        },
        previsao: {
          label: "Cards vencendo nos próximos 7 dias",
          columns: ["dia", "cards"],
          rows: (u.forecast || []).map((f) => ({ dia: f.day, cards: f.n })),
        },
        porBaralho: {
          label: "Retenção 30d por baralho",
          columns: ["baralho", "role", "retencaoPct", "amostra"],
          rows: (u.retentionByRole || []).map((r) => ({ baralho: roleLabel(r.role, labels), role: r.role, retencaoPct: r.pct, amostra: r.n })),
        },
        provas: {
          label: "Últimas provas de checkpoint",
          columns: ["examId", "terminadaEm", "nota", "status", "questoes"],
          rows: (u.exams || []).map((e) => ({ examId: e.id, terminadaEm: e.finishedAt, nota: e.score, status: e.status, questoes: e.questions })),
        },
      };
      if (include_history) {
        tables.historico = {
          label: "Revisões por dia (~27 semanas)",
          columns: ["dia", "revisoes"],
          rows: Object.entries(u.days || {}).map(([dia, revisoes]) => ({ dia, revisoes })),
        };
      }
      return result({
        kind: "training.person",
        title: `Raio-x de treinamento · ${u.name || u.id}`,
        scope: { saas: pid, user: u.id, vagas: (u.roles || []).join(", ") || "—", diaDeEstudo: team.today },
        units: UNITS,
        totals: {
          status: statusOf(u),
          dueHoje: u.dueToday, atrasados: u.overdue, feitasHoje: u.doneToday,
          baralho: u.deckSize, vistos: u.seen, coberturaPct: pctOf(u.seen, u.deckSize),
          maduros: u.mature, jovens: u.young,
          retencao30d: u.retention30d?.pct ?? null, amostra30d: u.retention30d?.n ?? 0,
          retencao7d: u.retention7d?.pct ?? null, primeiraTentativaPct: u.firstTryPct,
          errou7dPct: u.again7dPct, sequencia: u.streak,
          diasAtivos30d: u.activeDays30d, revisoesDia30d: u.reviewsPerDay30d,
          tempoMedianoS: u.medianMs == null ? null : round2(u.medianMs / 1000), relampagoPct: u.rushPct,
          fun30d: u.fun?.last30 ?? 0, funTotal: u.fun?.total ?? 0, fun30dAcertoPct: u.fun?.hitPct ?? null,
          provasFeitas: u.examsDone, provasReprovadas: u.examsFailed, notaMedia: u.examAvg,
          provaPendente: !!u.examPending, ultimoEstudo: u.lastReviewAt,
        },
        tables,
        notes: [
          "`maduros` = cards com intervalo agendado ≥ 21 dias (régua do Anki); `jovens` = em revisão com intervalo menor.",
          u.rushPct != null && u.rushPct > 20 ? "mais de 20% das respostas saíram em menos de 1,5s: o ritmo indica que a pessoa está passando o card sem ler." : "",
          "4fun (estudo livre) é contado à parte e não entra em retenção, sequência nem 'feitas hoje' — é mérito, não meta.",
        ].filter(Boolean),
        source: { endpoint: `GET /api/flashcards/${pid}/team` },
      });
    }

    const rows = (team.users || []).map((u) => ({
      pessoa: u.name || u.id,
      userId: u.id,
      vagas: (u.roles || []).join(", ") || "—",
      status: statusOf(u),
      dueHoje: u.dueToday, atrasados: u.overdue, feitasHoje: u.doneToday,
      retencao30d: u.retention30d?.pct ?? null, amostra30d: u.retention30d?.n ?? 0,
      retencao7d: u.retention7d?.pct ?? null, primeiraTentativaPct: u.firstTryPct, errou7dPct: u.again7dPct,
      maduros: u.mature, jovens: u.young, vistos: u.seen, baralho: u.deckSize, coberturaPct: pctOf(u.seen, u.deckSize),
      sequencia: u.streak, diasAtivos30d: u.activeDays30d, revisoesDia30d: u.reviewsPerDay30d,
      tempoMedianoS: u.medianMs == null ? null : round2(u.medianMs / 1000), relampagoPct: u.rushPct,
      fun30d: u.fun?.last30 ?? 0, provasFeitas: u.examsDone, provasReprovadas: u.examsFailed,
      notaMedia: u.examAvg, provaPendente: !!u.examPending, ultimoEstudo: u.lastReviewAt,
    }));
    const ORDEM = { due: ["dueHoje:desc", "feitasHoje:desc"], retencao: ["retencao30d:desc"], sequencia: ["sequencia:desc"], feitas: ["feitasHoje:desc"], nome: ["pessoa"] };
    const s = select(rows, { sort: ORDEM[sort], limit });

    return result({
      kind: "training.team",
      title: `Equipe de treinamento · ${product.name || pid}`,
      scope: { saas: pid, diaDeEstudo: team.today },
      units: UNITS,
      totals: { pessoas: rows.length, dueHoje: rows.reduce((a, r) => a + num(r.dueHoje), 0), atrasados: rows.reduce((a, r) => a + num(r.atrasados), 0), feitasHoje: rows.reduce((a, r) => a + num(r.feitasHoje), 0) },
      columns: ["pessoa", "vagas", "status", "dueHoje", "atrasados", "feitasHoje", "retencao30d", "amostra30d", "retencao7d", "primeiraTentativaPct", "errou7dPct", "maduros", "jovens", "vistos", "baralho", "coberturaPct", "sequencia", "diasAtivos30d", "revisoesDia30d", "tempoMedianoS", "relampagoPct", "fun30d", "provasFeitas", "provasReprovadas", "notaMedia", "provaPendente", "ultimoEstudo"],
      rows: s.rows,
      rowsLabel: "Pessoas",
      page: s.page,
      notes: ["admin não aparece: treinamento é opcional pra quem toca o negócio.", "para o resumo do gestor (rollups, ranking, previsão do time) use training_report."],
      source: { endpoint: `GET /api/flashcards/${pid}/team` },
    });
  });

  // ── A fila do dia ─────────────────────────────────────────────────────────
  tool("training_queue", {
    group: GRUPO,
    title: "Fila do dia",
    description: "Fila de estudo de uma pessoa por baralho: novos, aprendendo, a revisar, domínio, prova pendente e trava do cockpit.",
    input: {
      saas: z.string().optional(),
      user: z.string().describe("id ou nome da pessoa."),
      include_cards: z.boolean().optional().describe("Lista os cards."),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, user, include_cards = false, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const users = await teamUsers();
    const person = resolveUser(user, users);

    const [base, statesDoc, exams] = await Promise.all([
      http.get(`/api/flashcards/${encodeURIComponent(pid)}`),
      getDoc(`/api/training_states/${encodeURIComponent(stateDocId(pid, person.id))}`),
      http.get("/api/training_exams"),
    ]);
    const estados = statesDoc?.cards || {};
    const now = new Date();
    const hoje = studyDay(now);
    const fim = studyDayEnd(now);
    const roles = rolesForUser(person);
    const labels = base.roleLabels;

    const decks = roles.map((role) => {
      const cards = (base.cards || []).filter((c) => c.role === role);
      const novos = [], aprendendo = [], revisar = [];
      let dominados = 0, atrasados = 0;
      for (const card of cards) {
        for (const { entryId, sub } of cardEntries(card)) {
          const st = estados[entryId];
          const item = { card, entryId, sub, st };
          if (!st || st.state === STATE.new) { novos.push(item); continue; }
          const due = new Date(st.due);
          if (st.state === STATE.review) {
            dominados++;
            if (due <= fim) { revisar.push(item); if (studyDay(due) < hoje) atrasados++; }
          } else if (due <= fim) { aprendendo.push(item); if (studyDay(due) < hoje) atrasados++; }
        }
      }
      const porDue = (a, b) => new Date(a.st.due) - new Date(b.st.due);
      aprendendo.sort(porDue); revisar.sort(porDue);
      const total = cards.flatMap(cardEntries).length;
      return { role, cards, total, dominados, atrasados, novos, aprendendo, revisar };
    });

    // Rodízio do orçamento de novos: `newPerDay` é o teto do DIA da pessoa (não
    // por baralho) e cada vaga vai pro baralho com menos novos feitos hoje.
    const feitosHoje = statesDoc?.newDone?.[hoje] || {};
    let orcamento = Math.max(0, num(base.settings?.newPerDay) - Object.values(feitosHoje).reduce((a, b) => a + num(b), 0));
    const dados = Object.fromEntries(decks.map((d) => [d.role, num(feitosHoje[d.role])]));
    const alloc = Object.fromEntries(decks.map((d) => [d.role, 0]));
    while (orcamento > 0) {
      const next = decks.filter((d) => alloc[d.role] < d.novos.length).sort((a, b) => dados[a.role] - dados[b.role])[0];
      if (!next) break;
      alloc[next.role]++; dados[next.role]++; orcamento--;
    }

    const deckRows = decks.map((d) => ({
      baralho: roleLabel(d.role, labels),
      role: d.role,
      novosHoje: alloc[d.role],
      aprendendo: d.aprendendo.length,
      revisar: d.revisar.length,
      pendentes: alloc[d.role] + d.aprendendo.length + d.revisar.length,
      atrasados: d.atrasados,
      dominados: d.dominados,
      entries: d.total,
      dominioPct: pctOf(d.dominados, d.total),
      novosNaoVistos: d.novos.length,
      geral: GENERAL_ROLES.includes(d.role),
    }));

    const pendentes = deckRows.reduce((a, d) => a + d.pendentes, 0);
    const prova = (exams || []).find((e) => e.saas === pid && e.user === person.id && e.status === "pending");
    const travaVale = !isAdmin(person) && (person.roles || []).some((r) => GATE_ROLES.includes(r));

    const tables = {
      baralhos: {
        label: "Baralhos da pessoa",
        columns: ["baralho", "role", "novosHoje", "aprendendo", "revisar", "pendentes", "atrasados", "dominados", "entries", "dominioPct", "novosNaoVistos", "geral"],
        rows: deckRows,
      },
    };
    if (include_cards) {
      const fila = decks.flatMap((d) => [
        ...d.aprendendo.map((i) => ({ ...i, fila: "aprendendo" })),
        ...d.revisar.map((i) => ({ ...i, fila: "revisar" })),
        ...d.novos.slice(0, alloc[d.role]).map((i) => ({ ...i, fila: "novo" })),
      ]);
      const s = select(fila.map((i) => ({
        entryId: i.entryId,
        baralho: roleLabel(i.card.role, labels),
        tipo: i.card.type || "basic",
        fila: i.fila,
        pergunta: label(i.card.front),
        vence: i.st?.due ? String(i.st.due).slice(0, 16).replace("T", " ") : null,
        intervaloDias: i.st?.scheduled_days ?? null,
        lapsos: i.st?.lapses ?? null,
      })), { limit });
      tables.cards = { label: "Cards da fila de hoje", columns: ["entryId", "baralho", "tipo", "fila", "pergunta", "vence", "intervaloDias", "lapsos"], rows: s.rows, page: s.page };
    }

    return result({
      kind: "training.queue",
      title: `Fila do dia · ${person.name || person.id} · ${product.name || pid}`,
      scope: { saas: pid, user: person.id, vagas: (person.roles || []).join(", ") || "—", diaDeEstudo: hoje },
      units: UNITS,
      totals: {
        pendentes,
        novosHoje: deckRows.reduce((a, d) => a + d.novosHoje, 0),
        aprendendo: deckRows.reduce((a, d) => a + d.aprendendo, 0),
        revisar: deckRows.reduce((a, d) => a + d.revisar, 0),
        atrasados: deckRows.reduce((a, d) => a + d.atrasados, 0),
        entriesNoBaralho: deckRows.reduce((a, d) => a + d.entries, 0),
        dominados: deckRows.reduce((a, d) => a + d.dominados, 0),
        novosPorDia: base.settings?.newPerDay ?? null,
        novosJaFeitosHoje: Object.values(feitosHoje).reduce((a, b) => a + num(b), 0),
        provaPendente: prova ? prova.id : null,
        cardsDaProva: prova ? (prova.coveredEntries || []).length : 0,
        travadoNoCockpit: travaVale && pendentes > 0,
        viraDoDia: fim.toISOString(),
      },
      tables,
      notes: [
        "o dia de estudo vira às 4h de São Paulo (régua do Anki): estudar 1h da manhã ainda conta no dia anterior.",
        "a fila é reconstruída aqui a partir de training_states + base oficial — a rota /queue da API é de sessão e não aceita a chave do MCP.",
        roles.length ? "" : "esta pessoa não tem fila: admin sem etiqueta de vaga fica isento do treinamento.",
        statesDoc ? "" : "ela nunca respondeu um card neste produto: tudo aparece como novo.",
        travaVale ? "tem vaga de funil: enquanto os pendentes não zeram, o cockpit inteiro fica travado pelo overlay de treinamento." : "",
      ].filter(Boolean),
      source: { endpoint: `GET /api/flashcards/${pid} + GET /api/training_states/${stateDocId(pid, person.id)}` },
    });
  });

  // ── Consistência individual ───────────────────────────────────────────────
  tool("training_stats", {
    group: GRUPO,
    title: "Consistência de uma pessoa",
    description: "Consistência de uma pessoa no período: sequência de dias, melhor sequência, revisões por dia e estudo livre (4fun).",
    input: {
      saas: z.string().optional(),
      user: z.string().describe("id ou nome da pessoa."),
      ...periodInput(z),
      include_days: z.boolean().optional().describe("Tabela dia a dia (padrão true)."),
      limit: z.number().int().optional().describe("Padrão 120, do dia mais recente."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, user, period, since, until, include_days = true, limit = 120, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const users = await teamUsers();
    const person = resolveUser(user, users);
    const p = resolvePeriod({ period: period || "last_90d", since, until });

    const [revsAll, funAll] = await Promise.all([
      http.get("/api/training_reviews"),
      http.get("/api/training_fun"),
    ]);
    const minhas = (revsAll || []).filter((r) => r.saas === pid && r.user === person.id);
    const meuFun = (funAll || []).filter((r) => r.saas === pid && r.user === person.id);

    const naJanela = (rs) => rs.filter((r) => { const d = studyDay(r.at); return d >= p.since && d <= p.until; });
    const janela = naJanela(minhas);
    const funJanela = naJanela(meuFun);

    const porDia = {};
    for (const r of minhas) { const d = studyDay(r.at); porDia[d] = (porDia[d] || 0) + 1; }
    const { streak, bestStreak } = streaksOf(porDia);
    const hoje = studyDay();

    const funPorDia = {};
    for (const r of funJanela) { const d = studyDay(r.at); funPorDia[d] = (funPorDia[d] || 0) + 1; }
    const revPorDia = {};
    for (const r of janela) { const d = studyDay(r.at); (revPorDia[d] ||= []).push(r); }
    const dias = [...new Set([...Object.keys(revPorDia), ...Object.keys(funPorDia)])].sort().map((dia) => {
      const rs = revPorDia[dia] || [];
      const m = metricsOf(rs);
      return { dia, revisoes: rs.length, fun: funPorDia[dia] || 0, acertoPct: m.acertoPct, retencaoPct: m.retencaoPct, tempoMedianoS: m.tempoMedianoS };
    });

    const m = metricsOf(janela);
    const fun30 = meuFun.filter((r) => Date.now() - new Date(r.at).getTime() <= 30 * 864e5);
    // Janela longa ("all") passa de 600 dias: corta pelo mais recente e diz que cortou.
    const s = select(dias, { sort: ["dia:desc"], limit, offset });

    return result({
      kind: "training.stats",
      title: `Consistência · ${person.name || person.id} · ${product.name || pid}`,
      scope: { saas: pid, user: person.id, diaDeEstudo: hoje },
      period: p,
      units: UNITS,
      totals: {
        sequenciaAtual: streak,
        melhorSequencia: bestStreak,
        feitasHoje: porDia[hoje] || 0,
        revisoesNoPeriodo: janela.length,
        diasAtivosNoPeriodo: Object.keys(revPorDia).length,
        revisoesPorDiaAtivo: Object.keys(revPorDia).length ? round2(janela.length / Object.keys(revPorDia).length) : null,
        acertoPct: m.acertoPct,
        retencaoPct: m.retencaoPct,
        amostraRetencao: m.amostraRetencao,
        primeiraTentativaPct: m.primeiraTentativaPct,
        tempoMedianoS: m.tempoMedianoS,
        relampagoPct: m.relampagoPct,
        revisoesTotais: minhas.length,
        fun4NoPeriodo: funJanela.length,
        fun4Hoje: meuFun.filter((r) => studyDay(r.at) === hoje).length,
        fun4Total: meuFun.length,
        fun30dAcertoPct: pctOf(fun30.filter((r) => r.rating >= 3).length, fun30.length),
      },
      columns: ["dia", "revisoes", "fun", "acertoPct", "retencaoPct", "tempoMedianoS"],
      rows: include_days ? s.rows : [],
      rowsLabel: "Dias",
      page: include_days ? s.page : undefined,
      notes: [
        "sequência e melhor sequência olham o histórico INTEIRO, não a janela — é uma corrida de dias consecutivos, cortá-la pelo período mentiria.",
        "4fun não entra em sequência nem em 'feitas hoje': estudar a mais não pode mexer na régua de cobrança.",
        "o dia usado aqui é o dia de estudo (vira às 4h de São Paulo), não o dia do faturamento.",
        "a tabela sai do dia mais recente pro mais antigo: quando a janela é maior que o limite, o que cai é o passado distante (veja `page`).",
      ],
      source: { endpoint: "GET /api/training_reviews + GET /api/training_fun" },
    });
  });

  // ── A base oficial ────────────────────────────────────────────────────────
  tool("training_deck", {
    group: GRUPO,
    title: "Baralho oficial",
    description: "Inventário da base de cards: cards e itens de estudo por baralho e tipo, configuração do treino e os cards.",
    input: {
      saas: z.string().optional(),
      role: z.enum(ROLE_ORDER).optional().describe("Filtra um baralho."),
      type: z.enum(["basic", "cloze", "occlusion"]).optional(),
      q: z.string().optional().describe("Busca na frente/verso."),
      include_cards: z.boolean().optional().describe("Devolve os cards (a base tem ~1050)."),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, role, type, q, include_cards = false, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const base = await http.get(`/api/flashcards/${encodeURIComponent(pid)}`);
    const labels = base.roleLabels;
    const todos = base.cards || [];

    const decks = ROLE_ORDER.map((r) => {
      const cs = todos.filter((c) => c.role === r);
      if (!cs.length) return null;
      return {
        baralho: roleLabel(r, labels), role: r,
        cards: cs.length,
        entries: cs.flatMap(cardEntries).length,
        basico: cs.filter((c) => (c.type || "basic") === "basic").length,
        cloze: cs.filter((c) => c.type === "cloze").length,
        oclusao: cs.filter((c) => c.type === "occlusion").length,
        comImagem: cs.filter((c) => c.image).length,
        geral: GENERAL_ROLES.includes(r),
      };
    }).filter(Boolean);

    const filtrados = todos
      .filter((c) => (!role || c.role === role) && (!type || (c.type || "basic") === type))
      .map((c) => ({
        id: c.id,
        baralho: roleLabel(c.role, labels),
        role: c.role,
        tipo: c.type || "basic",
        frente: label(c.front, 140),
        verso: label(c.back, 140),
        entries: cardEntries(c).length,
        imagem: c.image || null,
      }));
    const s = select(filtrados, { q, qFields: ["frente", "verso", "id"], sort: ["role", "id"], limit, offset });

    return result({
      kind: "training.deck",
      title: `Baralho oficial · ${product.name || pid}`,
      scope: { saas: pid, ...(role ? { role } : {}), ...(type ? { type } : {}) },
      totals: {
        cards: todos.length,
        entries: todos.flatMap(cardEntries).length,
        baralhos: decks.length,
        comImagem: todos.filter((c) => c.image).length,
        novosPorDia: base.settings?.newPerDay ?? null,
        provaACada: base.settings?.examEvery ?? null,
        questoesPorProva: base.settings?.examQuestions ?? null,
        notaMinima: base.settings?.examPass ?? null,
      },
      units: UNITS,
      tables: {
        baralhos: { label: "Baralhos", columns: ["baralho", "role", "cards", "entries", "basico", "cloze", "oclusao", "comImagem", "geral"], rows: decks },
        ...(include_cards ? { cards: { label: "Cards", columns: ["id", "baralho", "role", "tipo", "frente", "verso", "entries", "imagem"], rows: s.rows, page: s.page } } : {}),
      },
      notes: [
        "`entries` são os itens de estudo: um cloze com 3 lacunas e uma oclusão com 4 máscaras viram 3 e 4 cards na fila, cada um com agendamento próprio.",
        "os baralhos `geral` são estudados por todo mundo; os demais são a vaga da pessoa.",
        base.settings?.examEvery === 0 ? "prova de checkpoint DESLIGADA neste produto (examEvery = 0)." : "",
        include_cards ? "" : "resumo apenas — passe include_cards=true (com role/q) para ver os cards.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/flashcards/${pid}` },
    });
  });

  tool("training_deck_save", {
    group: GRUPO,
    title: "Gravar o baralho oficial",
    description: "Edita a base de cards do time: acrescenta, remove, troca a lista inteira ou só a configuração; simula por padrão.",
    write: true, destructive: true,
    danger: "é o material de estudo de TODO o time — card removido some para todo mundo e o agendamento FSRS daquele item é perdido.",
    hint: "leia a base com training_deck antes; a API é substituição total, então esta tool relê a base e reaplica seu patch em cima dela.",
    input: {
      saas: z.string().optional(),
      upsert: z.array(cardShape(z)).optional().describe("Cria ou atualiza (casa por `id`)."),
      delete_ids: z.array(z.string()).optional(),
      cards: z.array(cardShape(z)).optional().describe("SUBSTITUI a base inteira."),
      settings: z.object({
        newPerDay: z.number().int().min(0).max(200).optional().describe("Por pessoa (padrão 10)."),
        examEvery: z.number().int().min(0).max(200).optional().describe("Prova a cada N cards graduados; 0 desliga."),
        examQuestions: z.number().int().min(3).max(12).optional(),
        examPass: z.number().int().min(50).max(100).optional().describe("Nota mínima em %."),
      }).optional().describe("Campos omitidos ficam como estão."),
      dry_run: z.boolean().optional().describe("Padrão TRUE: só mostra o diff; false grava."),
    },
  }, async ({ saas, upsert, delete_ids, cards, settings, dry_run = true }) => {
    if (!upsert?.length && !delete_ids?.length && !cards && !settings) {
      throw new ApiError("nada a fazer: informe `upsert`, `delete_ids`, `cards` ou `settings`.");
    }
    const product = await resolveProduct(saas);
    const pid = product.id;
    const base = await http.get(`/api/flashcards/${encodeURIComponent(pid)}`);
    const antes = base.cards || [];

    let depois;
    const diff = { criados: [], atualizados: [], removidos: [] };
    if (cards) {
      depois = cards;
      const idsNovos = new Set(cards.map((c) => c.id).filter(Boolean));
      diff.removidos = antes.filter((c) => !idsNovos.has(c.id)).map((c) => ({ id: c.id, role: c.role, frente: label(c.front) }));
      const idsAntes = new Set(antes.map((c) => c.id));
      diff.criados = cards.filter((c) => !c.id || !idsAntes.has(c.id)).map((c) => ({ id: c.id || "(novo)", role: c.role, frente: label(c.front) }));
      diff.atualizados = cards.filter((c) => c.id && idsAntes.has(c.id)).map((c) => ({ id: c.id, role: c.role, frente: label(c.front) }));
    } else {
      const mapa = new Map(antes.map((c) => [c.id, c]));
      for (const c of upsert || []) {
        const id = c.id || `card_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const atual = mapa.get(id);
        mapa.set(id, { ...(atual || {}), ...c, id });
        (atual ? diff.atualizados : diff.criados).push({ id, role: c.role, frente: label(c.front) });
      }
      for (const id of delete_ids || []) {
        const atual = mapa.get(id);
        if (atual) { mapa.delete(id); diff.removidos.push({ id, role: atual.role, frente: label(atual.front) }); }
      }
      depois = [...mapa.values()];
    }

    const corta = (list) => { const s = select(list, { limit: 100 }); return { rows: s.rows, page: s.page }; };
    const contaPor = (list) => Object.fromEntries(ROLE_ORDER.map((r) => [r, list.filter((c) => c.role === r).length]));
    const antesPor = contaPor(antes), depoisPor = contaPor(depois);
    const novosSettings = { ...(base.settings || {}), ...(settings || {}) };

    const totals = {
      cardsAntes: antes.length, cardsDepois: depois.length,
      entriesAntes: antes.flatMap(cardEntries).length, entriesDepois: depois.flatMap(cardEntries).length,
      criados: diff.criados.length, atualizados: diff.atualizados.length, removidos: diff.removidos.length,
      simulacao: !!dry_run,
    };

    let gravado = null;
    if (!dry_run) {
      gravado = await http.put(`/api/flashcards/${encodeURIComponent(pid)}`, { cards: depois, settings: novosSettings });
      totals.cardsGravados = (gravado.cards || []).length;
      totals.entriesGravados = (gravado.cards || []).flatMap(cardEntries).length;
    }

    return result({
      kind: "training.deck_save",
      title: `${dry_run ? "Simulação" : "Gravado"} · baralho de ${product.name || pid}`,
      scope: { saas: pid },
      totals,
      tables: {
        // Substituir a base inteira mexe em milhares de cards: o diff é cortado
        // (o número exato está em `totals`) e o corte sai escrito em `page`.
        criados: { label: "Cards criados", columns: ["id", "role", "frente"], ...corta(diff.criados) },
        atualizados: { label: "Cards atualizados", columns: ["id", "role", "frente"], ...corta(diff.atualizados) },
        removidos: { label: "Cards REMOVIDOS", columns: ["id", "role", "frente"], ...corta(diff.removidos) },
        porBaralho: {
          label: "Cards por baralho (antes → depois)",
          columns: ["role", "antes", "depois"],
          rows: ROLE_ORDER.map((r) => ({ role: r, antes: antesPor[r] || 0, depois: depoisPor[r] || 0 })).filter((x) => x.antes || x.depois),
        },
      },
      detail: { settings: gravado?.settings || novosSettings },
      notes: [
        dry_run ? "SIMULAÇÃO: nada foi gravado. Confira o diff e repita com dry_run=false." : "gravado: a base nova já vale para todo o time.",
        diff.removidos.length ? `${diff.removidos.length} card(s) somem para TODAS as pessoas e o agendamento individual daqueles itens deixa de ser usado.` : "",
        "a API sanitiza na gravação: máximo 2000 cards, frente 600 e verso 1200 caracteres, vaga desconhecida vira `sdr`, card sem frente e sem verso é descartado.",
        settings?.examEvery === 0 ? "examEvery=0 DESLIGA a prova de checkpoint de todo mundo daqui pra frente." : "",
        "imagem de card não sobe pelo MCP (a rota de upload é multipart e exige sessão de admin) — anexe pela tela e depois referencie o id em `image`.",
      ].filter(Boolean),
      source: { endpoint: `GET + PUT /api/flashcards/${pid}` },
    });
  });

  // ── Provas de checkpoint ──────────────────────────────────────────────────
  tool("training_exams", {
    group: GRUPO,
    title: "Provas de checkpoint",
    description: "Provas do período: quem fez, nota, aprovação, pendências e as questões mais erradas pelo time.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      user: z.string().optional().describe("id ou nome."),
      status: z.enum(["pending", "passed", "failed", "any"]).optional().describe("Padrão any."),
      include_erros: z.boolean().optional().describe("Tabela das questões mais erradas."),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, user, status = "any", include_erros = false, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const p = resolvePeriod({ period, since, until });
    const [todas, users] = await Promise.all([http.get("/api/training_exams"), teamUsers()]);
    const person = user ? resolveUser(user, users) : null;
    const nomeDe = (id) => users.find((u) => u.id === id)?.name || id;

    const doProduto = (todas || []).filter((e) => e.saas === pid
      && (!person || e.user === person.id)
      && (status === "any" || e.status === status));
    // Prova pendente ainda não tem data de fim: a janela olha o fim quando existe
    // e a criação quando não — senão a pendente sumiria do relatório do mês.
    const naJanela = doProduto.filter((e) => {
      const quando = e.finishedAt || e.createdAt;
      if (!quando) return true;
      const d = studyDay(quando);
      return d >= p.since && d <= p.until;
    });

    const rows = naJanela.map((e) => {
      const qs = e.questions || [];
      return {
        examId: e.id,
        pessoa: nomeDe(e.user),
        userId: e.user,
        status: e.status,
        nota: e.score ?? null,
        notaMinima: e.passScore ?? null,
        questoes: qs.length,
        erradas: e.status === "pending" ? null : qs.filter((q) => q.correct === false).length,
        cards: (e.coveredEntries || []).length,
        criadaEm: e.createdAt ? String(e.createdAt).slice(0, 10) : null,
        terminadaEm: e.finishedAt ? String(e.finishedAt).slice(0, 10) : null,
      };
    });
    const s = select(rows, { sort: ["terminadaEm:desc", "criadaEm:desc"], limit, offset });

    const feitas = rows.filter((r) => r.status !== "pending");
    const porPessoa = [...new Set(rows.map((r) => r.userId))].map((id) => {
      const meus = rows.filter((r) => r.userId === id);
      const fim = meus.filter((r) => r.status !== "pending");
      return {
        pessoa: nomeDe(id), userId: id,
        provas: fim.length,
        aprovadas: fim.filter((r) => r.status === "passed").length,
        reprovadas: fim.filter((r) => r.status === "failed").length,
        notaMedia: avg(fim.map((r) => r.nota).filter((v) => v != null)),
        pendentes: meus.filter((r) => r.status === "pending").length,
      };
    }).sort((a, b) => (b.reprovadas - a.reprovadas) || (a.notaMedia ?? 101) - (b.notaMedia ?? 101));

    const tables = {
      porPessoa: { label: "Por pessoa", columns: ["pessoa", "provas", "aprovadas", "reprovadas", "notaMedia", "pendentes"], rows: porPessoa },
    };
    if (include_erros) {
      const mapa = new Map();
      for (const e of naJanela) {
        for (const q of e.questions || []) {
          if (q.correct !== false) continue;
          const k = q.entryId || q.prompt;
          const g = mapa.get(k) || { entryId: q.entryId || null, questao: label(q.prompt, 120), tipo: q.kind, vezes: 0, pessoas: new Set(), gabarito: label(q.ideal || (q.options || [])[q.answerIdx], 90) };
          g.vezes++; g.pessoas.add(e.user);
          mapa.set(k, g);
        }
      }
      const se = select([...mapa.values()].map((g) => ({ ...g, pessoas: g.pessoas.size })), { sort: ["vezes:desc"], limit });
      tables.erros = {
        label: "Questões mais erradas no período",
        columns: ["questao", "entryId", "tipo", "vezes", "pessoas", "gabarito"],
        rows: se.rows,
        page: se.page,
      };
    }

    return result({
      kind: "training.exams",
      title: `Provas de checkpoint · ${product.name || pid}`,
      scope: { saas: pid, ...(person ? { user: person.id } : {}), status },
      period: p,
      units: UNITS,
      totals: {
        provas: rows.length,
        feitas: feitas.length,
        aprovadas: feitas.filter((r) => r.status === "passed").length,
        reprovadas: feitas.filter((r) => r.status === "failed").length,
        pendentes: rows.filter((r) => r.status === "pending").length,
        taxaAprovacaoPct: pctOf(feitas.filter((r) => r.status === "passed").length, feitas.length),
        notaMedia: avg(feitas.map((r) => r.nota).filter((v) => v != null)),
        pessoas: new Set(rows.map((r) => r.userId)).size,
      },
      columns: ["examId", "pessoa", "status", "nota", "notaMinima", "questoes", "erradas", "cards", "criadaEm", "terminadaEm"],
      rows: s.rows,
      rowsLabel: "Provas",
      page: s.page,
      tables,
      notes: [
        "a prova cai sozinha a cada N cards graduados e cobre exatamente esses cards; reprovar APAGA o agendamento dos cards errados, que voltam para a fila como novos.",
        "questão digitada é corrigida por IA; quando a IA está fora, ela conta como CERTA — nota alta com IA indisponível merece desconfiança.",
        "prova pendente entra pela data de criação (ainda não tem data de fim).",
        "use training_exam_result para ver o que a pessoa marcou/escreveu em uma prova.",
      ],
      source: { endpoint: "GET /api/training_exams" },
    });
  });

  tool("training_exam_result", {
    group: GRUPO,
    title: "Raio-x de uma prova",
    description: "Uma prova questão a questão: o que a pessoa respondeu, o gabarito, o acerto e o feedback da IA.",
    input: {
      saas: z.string().optional(),
      exam_id: z.string().describe("de training_exams."),
    },
  }, async ({ saas, exam_id }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const exam = await getDoc(`/api/training_exams/${encodeURIComponent(exam_id)}`);
    if (!exam) throw new ApiError(`prova "${exam_id}" não existe`, { status: 404, detail: "liste as provas com training_exams." });
    if (exam.saas !== pid) throw new ApiError(`a prova "${exam_id}" é do produto "${exam.saas}", não de "${pid}".`);

    const [users, base] = await Promise.all([teamUsers(), http.get(`/api/flashcards/${encodeURIComponent(pid)}`)]);
    const nome = users.find((u) => u.id === exam.user)?.name || exam.user || "(sem dono)";
    const porId = new Map((base.cards || []).map((c) => [c.id, c]));
    const feita = exam.status !== "pending";

    // Prova pendente NÃO devolve gabarito: bastaria abrir o histórico pra colar.
    const rows = (exam.questions || []).map((q, i) => {
      const card = porId.get(String(q.entryId || "").split("::")[0]);
      return {
        n: i + 1,
        tipo: q.kind,
        questao: label(q.prompt, 160),
        marcou: feita ? (q.kind === "mc" ? (q.options || [])[q.choice] ?? "(em branco)" : (q.text || "(em branco)")) : null,
        gabarito: feita ? label(q.ideal || (q.options || [])[q.answerIdx], 160) : null,
        acertou: feita ? !!q.correct : null,
        feedbackIA: feita ? (q.feedback || "") : null,
        baralho: card ? roleLabel(card.role, base.roleLabels) : "(card saiu da base)",
        entryId: q.entryId || null,
      };
    });

    return result({
      kind: "training.exam_result",
      title: `Prova ${exam.id} · ${nome}`,
      scope: { saas: pid, user: exam.user, examId: exam.id },
      units: UNITS,
      totals: {
        pessoa: nome,
        status: exam.status,
        nota: exam.score ?? null,
        notaMinima: exam.passScore ?? null,
        questoes: rows.length,
        acertos: feita ? rows.filter((r) => r.acertou).length : null,
        erros: feita ? rows.filter((r) => r.acertou === false).length : null,
        cardsCobertos: (exam.coveredEntries || []).length,
        criadaEm: exam.createdAt || null,
        terminadaEm: exam.finishedAt || null,
      },
      columns: ["n", "tipo", "questao", "marcou", "gabarito", "acertou", "feedbackIA", "baralho", "entryId"],
      rows,
      rowsLabel: "Questões",
      notes: [
        feita ? "" : "prova PENDENTE: o gabarito fica escondido de propósito — quem tem a prova pra fazer não pode lê-lo aqui.",
        feita && exam.status === "failed" ? "reprovada: os cards das questões erradas foram apagados do agendamento da pessoa e voltaram para a fila como novos." : "",
        "as questões de múltipla escolha usam respostas de OUTROS cards como distratores; as digitadas são corrigidas semanticamente por IA.",
      ].filter(Boolean),
      source: { endpoint: `GET /api/training_exams/${exam_id}` },
    });
  });

  // ── O log cru, com janela livre ───────────────────────────────────────────
  tool("training_activity", {
    group: GRUPO,
    title: "Atividade de estudo",
    description: "Log de respostas em qualquer janela, agrupado por dia, pessoa, baralho, card ou nota; por card, onde o time erra.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      group_by: z.enum(["day", "user", "role", "card", "rating", "none"]).optional().describe("Padrão user."),
      user: z.string().optional().describe("id ou nome."),
      role: z.enum(ROLE_ORDER).optional().describe("Filtra um baralho."),
      min_reviews: z.number().int().optional().describe("Padrão 1; com group_by=card use 3+."),
      include_fun: z.boolean().optional().describe("Inclui o 4fun à parte."),
      compare: z.boolean().optional().describe("Padrão true."),
      sort: z.string().optional().describe("Coluna:direção (ex.: errouPct:desc)."),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, period, since, until, group_by = "user", user, role, min_reviews = 1, include_fun = false, compare = true, sort, limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const pid = product.id;
    const p = resolvePeriod({ period, since, until });
    const users = await teamUsers();
    const person = user ? resolveUser(user, users) : null;
    const nomeDe = (id) => users.find((u) => u.id === id)?.name || id;

    const [logAll, base] = await Promise.all([
      http.get("/api/training_reviews"),
      http.get(`/api/flashcards/${encodeURIComponent(pid)}`),
    ]);
    const meu = (logAll || []).filter((r) => r.saas === pid
      && (!person || r.user === person.id)
      && (!role || r.role === role));
    const dentro = (rs, a, b) => rs.filter((r) => { const d = studyDay(r.at); return d >= a && d <= b; });
    const janela = dentro(meu, p.since, p.until);
    const anterior = compare ? dentro(meu, p.previous.since, p.previous.until) : [];

    const porId = new Map((base.cards || []).map((c) => [c.id, c]));
    const labels = base.roleLabels;
    const CHAVE = {
      day: (r) => studyDay(r.at),
      user: (r) => r.user,
      role: (r) => r.role,
      card: (r) => r.cardId,
      rating: (r) => String(r.rating),
    };

    let rows, columns;
    if (group_by === "none") {
      rows = janela.map((r) => ({
        dia: studyDay(r.at), pessoa: nomeDe(r.user), entryId: r.cardId,
        baralho: roleLabel(r.role, labels), rating: r.rating,
        estadoAntes: ["novo", "aprendendo", "revisão", "reaprendendo"][r.prevState] ?? r.prevState,
        segundos: num(r.ms) ? round2(num(r.ms) / 1000) : null, em: r.at,
      }));
      columns = ["dia", "pessoa", "entryId", "baralho", "rating", "estadoAntes", "segundos", "em"];
    } else {
      const grupos = new Map();
      for (const r of janela) {
        const k = CHAVE[group_by](r);
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(r);
      }
      rows = [...grupos.entries()].map(([k, rs]) => {
        const m = metricsOf(rs);
        if (group_by === "card") {
          const card = porId.get(String(k).split("::")[0]);
          return {
            // Oclusão não tem texto de frente: dizer "removido" ali seria mentira.
            grupo: card ? (label(card.front, 100) || `(${card.type || "basic"} sem texto)`) : "(card removido da base)",
            entryId: k,
            baralho: card ? roleLabel(card.role, labels) : roleLabel(rs[0]?.role, labels),
            tipo: card?.type || "—",
            naBase: !!card,
            ...m,
          };
        }
        const nomes = { day: "dia", user: "pessoa", role: "baralho", rating: "nota" };
        const valor = group_by === "user" ? nomeDe(k)
          : group_by === "role" ? roleLabel(k, labels)
            : group_by === "rating" ? ({ 1: "1 · errei", 2: "2 · difícil", 3: "3 · bom", 4: "4 · fácil" }[k] || k)
              : k;
        return { grupo: valor, chave: k, campo: nomes[group_by], ...m };
      }).filter((g) => g.revisoes >= min_reviews);
      columns = group_by === "card"
        ? ["grupo", "entryId", "baralho", "tipo", "revisoes", "pessoas", "errouPct", "acertoPct", "retencaoPct", "amostraRetencao", "tempoMedianoS", "ultimoEm", "naBase"]
        : ["grupo", "revisoes", "pessoas", "errouPct", "acertoPct", "retencaoPct", "amostraRetencao", "primeiraTentativaPct", "tempoMedianoS", "relampagoPct", "ultimoEm"];
    }

    const ordem = sort || (group_by === "card" ? ["errouPct:desc", "revisoes:desc"]
      : group_by === "day" ? ["grupo"] : ["revisoes:desc"]);
    const s = select(rows, { sort: ordem, limit, offset });

    const m = metricsOf(janela);
    const tables = {};
    if (compare && anterior.length) {
      const ant = metricsOf(anterior);
      tables.comparativo = {
        label: `Comparativo vs ${p.previous.since} → ${p.previous.until}`,
        columns: ["metrica", "atual", "anterior", "variacao", "variacao_pct"],
        rows: ["revisoes", "pessoas", "errouPct", "acertoPct", "retencaoPct", "tempoMedianoS"].map((k) => {
          const d = delta(m[k], ant[k]);
          return d && { metrica: k, atual: d.current, anterior: d.previous, variacao: d.abs, variacao_pct: d.pct };
        }).filter(Boolean),
      };
    }
    if (include_fun) {
      const funAll = await http.get("/api/training_fun");
      const fun = dentro((funAll || []).filter((r) => r.saas === pid && (!person || r.user === person.id) && (!role || r.role === role)), p.since, p.until);
      const porPessoa = [...new Set(fun.map((r) => r.user))].map((id) => {
        const rs = fun.filter((r) => r.user === id);
        return { pessoa: nomeDe(id), respostas: rs.length, acertoPct: pctOf(rs.filter((r) => r.rating >= 3).length, rs.length) };
      }).sort((a, b) => b.respostas - a.respostas);
      tables.fun = { label: "Estudo livre (4fun) no período — fora do FSRS e de qualquer cobrança", columns: ["pessoa", "respostas", "acertoPct"], rows: porPessoa };
    }

    const orfaos = group_by === "card" ? rows.filter((r) => r.naBase === false).length : 0;
    return result({
      kind: "training.activity",
      title: `Atividade de treino · ${product.name || pid} (por ${group_by})`,
      scope: { saas: pid, group_by, ...(person ? { user: person.id } : {}), ...(role ? { role } : {}) },
      period: p,
      units: UNITS,
      totals: { ...m, gruposListados: rows.length },
      columns,
      rows: s.rows,
      rowsLabel: group_by === "none" ? "Respostas" : "Grupos",
      page: s.page,
      tables,
      notes: [
        "`retencaoPct` é a retenção verdadeira (só revisões de cards que já estavam em revisão); `acertoPct` é o bruto (rating ≥ 3) e sempre parece melhor.",
        "os dias são dias de estudo (viram às 4h de São Paulo), então a janela pode diferir em algumas horas de um relatório financeiro do mesmo período.",
        "o log inteiro é lido da API e recortado aqui: janela grande fica lenta, mas o corte nunca é silencioso (veja `page`).",
        orfaos ? `${orfaos} card(s) do log não existem mais na base: foram removidos depois de estudados.` : "",
        janela.length ? "" : "nenhuma resposta nesta janela.",
      ].filter(Boolean),
      source: { endpoint: "GET /api/training_reviews" },
    });
  });
}
