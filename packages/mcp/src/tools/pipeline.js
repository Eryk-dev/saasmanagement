// Pipeline comercial — as telas Pipeline (kanban + lista), Meu dia e o drawer
// do lead. É o bloco onde o cockpit é OPERADO, não só lido.
//
// O detalhe que manda em tudo aqui: a API não tem endpoint de board, de fila
// nem de filtro. `GET /api/leads` devolve a tabela inteira (o único filtro do
// servidor é `priority`) e TODA a leitura — agrupar por etapa, somar valor,
// decidir o que está atrasado, dizer quem é o próximo da fila — é feita no
// navegador (pipeline.jsx, today.jsx). Este módulo refaz essas contas do lado
// do MCP, com a MESMA régua do front e do servidor:
//   - decisão por `kind` do estágio (stages.js), nunca pelo nome;
//   - compromisso marcado da etapa vence a cadência no "próximo toque";
//   - hora sem fuso ("2026-08-28T16:00") é hora de Brasília, igual ao brtToIso;
//   - venda é FATO do lead (customerId/wonAt), não posição do card.
// Se essas cópias divergirem do front, os dois números divergem — por isso cada
// espelho abaixo cita de onde veio.
//
// Escrita: NÃO existe endpoint de mover card. Mudar etapa é `PATCH /api/leads/:id`
// com `stage` diferente, e o servidor dispara applyStageMove — histórico,
// motivo de perda, GPS, criação (ou REMOÇÃO) de cliente. Por isso o movimento
// tem tool própria, com os mesmos gates da tela.

import { z } from "zod";
import { http, ApiError } from "../core/http.js";
import { resolveProduct } from "../core/products.js";
import { resolvePeriod, periodInput, dayKey, today } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, search, round2, num } from "../core/shape.js";

const DAY = 86_400_000;

const UNITS = {
  amount: "BRL", valor: "BRL", valorAberto: "BRL", forecast: "BRL", forecastPonderado: "BRL",
  ganhoMesValor: "BRL", ticketMedio: "BRL", prob: "0..1", conv: "0..1",
  diasNaEtapa: "d", diasMedianosNaEtapa: "d", atrasoDias: "d", staleDays: "d",
  retryDays: "d", firstTouchHours: "h", idadeDias: "d", score: "0..100", icp: "0..1",
};

// ── Espelho de packages/api/src/stages.js + packages/web/src/lib/funnel.js ──
// Toda decisão de comportamento vem do `kind` da linha do funil; funil antigo
// sem `kind` cai na heurística por nome (mesma dos dois lados).

const KIND_PHASE = {
  novo: "sdr", contato: "sdr", qualificacao: "sdr",
  call: "closer", proposta: "closer", followup: "closer",
  integracao: "entrega", posvenda: "entrega",
  ganho: "fim", perdido: "fim", desqualificado: "fim", outro: "",
};
const KINDS = Object.keys(KIND_PHASE);
const LOSS_KINDS = new Set(["perdido", "desqualificado"]);
const TERMINAL_KINDS = new Set(["ganho", "perdido", "desqualificado"]);
// Região de venda: sair dela pra uma etapa aberta DESFAZ o fechamento.
const SOLD_KINDS = new Set(["ganho", "integracao", "posvenda"]);
const TOUCH_TYPES = new Set(["whatsapp", "call", "email", "meeting"]);
const ACTIVITY_TYPES = ["note", "whatsapp", "call", "email", "meeting", "stage", "system"];

const isNoShowStage = (stage) => /no.?show/i.test(String(stage || ""));

function guessKind(name, index = -1, length = 0) {
  const n = String(name || "").toLowerCase();
  if (/ganho|won/.test(n)) return "ganho";
  if (/perdid|lost|sem resposta/.test(n)) return "perdido";
  if (/desqualific|disqualified/.test(n)) return "desqualificado";
  if (/integra/.test(n)) return "integracao";
  if (/acompanhament|p[óo]s.?venda|sucesso|cs\b/.test(n)) return "posvenda";
  if (/follow/.test(n)) return "followup";
  if (/proposta|proposal|negocia/.test(n)) return "proposta";
  if (/call|reuni|demo/.test(n)) return "call";
  if (/qualific/.test(n)) return "qualificacao";
  if (/contato|contact/.test(n)) return "contato";
  if (/novo|inbox|new|entrada/.test(n)) return "novo";
  if (index === 0 && length > 0) return "novo";
  return "outro";
}

const funnelOf = (product) => (Array.isArray(product?.funnel) ? product.funnel : []);
const stageNames = (product) => funnelOf(product).map((f) => f?.stage).filter(Boolean);
const rowOf = (product, stage) => funnelOf(product).find((f) => f && f.stage === stage) || null;

function kindOf(product, stage) {
  const funnel = funnelOf(product);
  const i = funnel.findIndex((f) => f && f.stage === stage);
  if (i >= 0) {
    const k = funnel[i].kind;
    return KINDS.includes(k) ? k : guessKind(stage, i, funnel.length);
  }
  if (stage === "Ganho" || stage === "Closed Won") return "ganho";
  if (stage === "Perdido") return "perdido";
  if (stage === "Desqualificado" || stage === "disqualified") return "desqualificado";
  return guessKind(stage, -1, funnel.length);
}

const phaseOf = (kind) => KIND_PHASE[kind] || "";
const firstStage = (product) => stageNames(product)[0] || "";
const stageByKind = (product, kind) => stageNames(product).find((st) => kindOf(product, st) === kind) || "";
// Kind de um LEAD (não de uma etapa). `stage` vazio quer dizer "na etapa de
// entrada" (convenção do firstStage da API), então resolver o nome ANTES é o
// que evita a linha sair dizendo "Novo / outro" e o filtro por kind perder o
// lead que ainda não andou.
const leadKind = (product, lead) => kindOf(product, lead?.stage || firstStage(product));

// Régua de venda: até o 1º estágio de kind `ganho` (inclusive).
function ladderOf(product) {
  const names = stageNames(product);
  const cut = names.findIndex((st) => kindOf(product, st) === "ganho");
  return cut === -1 ? names : names.slice(0, cut + 1);
}
// Abertos = progresso de venda (sem o Ganho). É a base do forecast e do "leads abertos".
function openStages(product) {
  const lad = ladderOf(product);
  return lad.length && kindOf(product, lad[lad.length - 1]) === "ganho" ? lad.slice(0, -1) : lad;
}
// Trabalháveis = tudo que não é terminal, INCLUSIVE filas fora da régua
// (Nutrição, No show): tem próximo passo, mas não conta como pipeline aberto.
const workableStages = (product) => stageNames(product).filter((st) => !TERMINAL_KINDS.has(kindOf(product, st)));

// Etapa DEPOIS do ganho: estar nela já é ter vendido. Posicional de propósito —
// num funil que ainda põe a entrega antes do fechamento, contar ali infla receita.
function isPostSale(product, stage) {
  const kind = kindOf(product, stage);
  if (kind !== "integracao" && kind !== "posvenda") return false;
  const names = stageNames(product);
  const iGanho = names.findIndex((st) => kindOf(product, st) === "ganho");
  return iGanho !== -1 && names.indexOf(stage) > iGanho;
}
const isWonLead = (product, lead) =>
  !!lead?.customerId || leadKind(product, lead) === "ganho" || isPostSale(product, lead?.stage);
// `stageSince` é recarimbado a cada movimento: sozinho, joga a venda pro mês da
// etapa seguinte. `wonAt` é a data real (carimbada no convertWonLead).
const wonAtOf = (lead) => lead?.wonAt || lead?.stageSince || "";
// Lead que conta em métrica: fora os internos (teste) e as saídas laterais do form.
const isRealLead = (l) => !l?.internal && !l?.formExit;

const cadenceOf = (product, stage) => {
  const c = rowOf(product, stage)?.cadence;
  return c && typeof c === "object" ? c : {};
};

const DEFAULT_LOSS_REASONS = [
  { id: "preco", label: "Preço" }, { id: "sem_resposta", label: "Sem resposta" },
  { id: "sem_fit", label: "Sem fit" }, { id: "timing", label: "Timing" },
  { id: "concorrente", label: "Concorrente" }, { id: "outro", label: "Outro" },
];
const lossReasonsOf = (product) =>
  (Array.isArray(product?.lossReasons) && product.lossReasons.length ? product.lossReasons : DEFAULT_LOSS_REASONS);
const lossLabel = (product, id) =>
  (!id ? "" : id === "nao_informado" ? "não informado" : (lossReasonsOf(product).find((r) => r.id === id)?.label || id));

// Probabilidade de fechar a partir da etapa: produto das taxas `conv` das
// etapas que ainda faltam ATÉ o ganho (espelho do analysisBuckets do pipeline).
function probOf(product, stage) {
  const lad = ladderOf(product);
  const i = lad.indexOf(stage);
  if (i === -1) return 0;
  return lad.slice(i + 1).reduce((acc, name) => {
    const conv = Number(rowOf(product, name)?.conv);
    return acc * (Number.isFinite(conv) && conv > 0 ? conv : 1);
  }, 1);
}

// Qualidade do lead (matriz do Leo, 21/07 — espelho de leadTier em web/lib/ui.js
// e de leadGrade em routes.marketing.js). Contas × anúncios da maior conta.
const TIER_ACCOUNTS = { "1": 0, "2": 1, "3-5": 2, "6-10": 3, "10+": 4 };
const TIER_LISTINGS = { "0-100": 0, "100-500": 1, "500-2000": 2, "2000-10000": 3, "10000+": 4 };
const TIER_VOLUME = { "0-10": 0, "10-50": 1, "50-200": 2, "200+": 3 };
const GRADE_GRID = [
  ["E", "D", "C", "C", "C"], ["D", "C", "C", "B", "B"], ["C", "B", "B", "A", "A"],
  ["B", "B", "A", "S", "S"], ["A", "A", "A", "S", "S"],
];
const TIER_RANK = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
function leadGrade(l) {
  const acc = TIER_ACCOUNTS[l?.accounts];
  const ads = (l?.listings != null && l.listings !== "") ? TIER_LISTINGS[l.listings] : TIER_VOLUME[l?.volume];
  if (acc == null && ads == null) return "";
  return GRADE_GRID[acc ?? 0][ads ?? 0];
}

// ── Tempo ────────────────────────────────────────────────────────────────────
// callAt/followupAt/integrationAt são hora de Brasília SEM fuso (o que o
// <input datetime-local> entrega); nextActionAt/stageSince são ISO em UTC. Ler
// os dois com `new Date` cru dá dois instantes diferentes pro mesmo horário —
// é o bug das "duas pílulas na agenda". Régua única: string sem fuso é BRT.
function atMs(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  const withZone = /[Zz]|[+-]\d{2}:\d{2}$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`;
  const t = new Date(withZone).getTime();
  return Number.isFinite(t) ? t : null;
}
const isoOf = (value) => { const t = atMs(value); return t == null ? "" : new Date(t).toISOString(); };
const bizDayOf = (value) => { const t = atMs(value); return t == null ? "" : dayKey(new Date(t)); };
const startOfToday = () => Date.parse(`${today()}T00:00:00-03:00`);

// GPS do card. Compromisso VIVO da etapa (call na etapa de call, integração na
// entrega) conduz; sem ele vale o nextActionAt; compromisso vencido ainda
// sinaliza. Espelho de nextTouch (web/lib/funnel.js) e do buildQueue do Meu dia.
function nextTouch(product, lead, now = Date.now()) {
  const kind = leadKind(product, lead);
  const delivery = kind === "integracao" || kind === "posvenda";
  const anchored = kind === "call" || delivery;
  const meeting = anchored ? atMs(delivery ? lead?.integrationAt : lead?.callAt) : null;
  const touch = atMs(lead?.nextActionAt);
  const tipo = delivery ? "integracao" : "call";
  if (meeting != null && meeting >= startOfToday()) return { at: meeting, tipo, nota: "" };
  if (touch != null) return { at: touch, tipo: "toque", nota: lead?.nextActionNote || "" };
  if (meeting != null) return { at: meeting, tipo, nota: "" };
  return null;
}

const daysSince = (value, now = Date.now()) => {
  const t = atMs(value);
  return t == null ? null : Math.max(0, Math.floor((now - t) / DAY));
};

// ── Linha padrão de lead ────────────────────────────────────────────────────
const LEAD_COLS = [
  "id", "name", "company", "stage", "kind", "owner", "closer", "amount", "priority",
  "score", "grade", "proximoToque", "toqueTipo", "atrasoDias", "diasNaEtapa", "toquesNaEtapa",
  "ultimoToqueEm", "source", "createdAt",
];

function leadRow(product, l, now = Date.now()) {
  const stage = l.stage || firstStage(product);
  const kind = kindOf(product, stage);
  const nt = nextTouch(product, l, now);
  const diasNaEtapa = daysSince(l.stageSince || l.createdAt, now);
  return {
    id: l.id,
    name: l.name || "",
    company: l.company || "",
    stage,
    kind,
    owner: l.owner || "",
    closer: l.closer || "",
    amount: num(l.amount),
    priority: l.priority || "",
    score: l.score ?? null,
    grade: leadGrade(l),
    proximoToque: nt ? new Date(nt.at).toISOString() : "",
    toqueTipo: nt ? nt.tipo : "",
    atrasoDias: nt && nt.at < now ? Math.floor((now - nt.at) / DAY) : 0,
    diasNaEtapa,
    toquesNaEtapa: num(l.stageAttempts),
    ultimoToqueEm: l.lastActivityAt || "",
    source: l.source || "",
    createdAt: l.createdAt || "",
  };
}

// Ordena a coluna do jeito que a tela ordena: fila de trabalho (atrasado no
// topo, sem próximo passo no fim), a mesma invertida, ou qualidade comercial.
function sortLeads(rows, mode) {
  const key = (r) => (r.proximoToque ? Date.parse(r.proximoToque) : Number.POSITIVE_INFINITY);
  if (mode === "ultimo") return [...rows].sort((a, b) => key(b) - key(a));
  if (mode === "qualidade") {
    return [...rows].sort((a, b) =>
      (TIER_RANK[b.grade] || 0) - (TIER_RANK[a.grade] || 0)
      || num(b.score) - num(a.score)
      || num(b.amount) - num(a.amount));
  }
  return [...rows].sort((a, b) => key(a) - key(b));
}

// ── Acesso ──────────────────────────────────────────────────────────────────
// /api/leads devolve a tabela inteira (o único filtro do servidor é priority);
// o recorte por produto é obrigatório aqui pra não misturar marcas.
async function leadsOf(productId, { priority } = {}) {
  const all = await http.get("/api/leads", { priority });
  return (all || []).filter((l) => l && l.saas === productId);
}

// Nomes do time: `users` não sai pelo CRUD (é PRIVATE), a rota é /api/auth/users.
async function teamOf() {
  try {
    const users = await http.get("/api/auth/users");
    return Array.isArray(users) ? users : [];
  } catch { return []; }
}
const nameOf = (team, id) => (id ? (team.find((u) => u.id === id)?.name || id) : "");

// Vínculo com a pessoa = dono, closer OU integrador (a mesma régua do chip da
// tela; filtrar só por dono/closer some com os cards de quem é integrador).
const personMatch = (l, person) =>
  !person || l.owner === person || l.closer === person || l.integrator === person;

async function getLead(id) {
  const lead = await http.get(`/api/leads/${encodeURIComponent(id)}`);
  if (!lead || !lead.id) throw new ApiError(`lead "${id}" não encontrado`, { status: 404 });
  return lead;
}

export function registerPipelineTools(tool) {
  const GRUPO = "Pipeline comercial";

  // ── Leitura: o board ──────────────────────────────────────────────────────
  tool("pipeline_board", {
    group: GRUPO,
    title: "Kanban do pipeline",
    description: "Kanban em números por estágio: leads, valor, forecast ponderado, atrasados, parados e Ganho do mês.",
    input: {
      saas: z.string().optional(),
      person: z.string().optional().describe("Dono, closer ou integrador do card."),
      phase: z.enum(["all", "sdr", "closer", "entrega"]).optional().describe("Padrão all."),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      include_discarded: z.boolean().optional().describe("Padrão false."),
      cards: z.boolean().optional().describe("Padrão true."),
      sort: z.enum(["toque", "ultimo", "qualidade"]).optional().describe("Padrão toque."),
      limit: z.number().int().optional().describe("Cards por coluna (padrão 10)."),
    },
  }, async ({ saas, person, phase = "all", priority, include_discarded = false, cards = true, sort = "toque", limit = 10 }) => {
    const product = await resolveProduct(saas);
    const [todos, team] = await Promise.all([leadsOf(product.id, { priority }), teamOf()]);
    const now = Date.now();
    const escopo = todos.filter((l) => personMatch(l, person));

    const nomes = stageNames(product);
    const abertos = new Set(openStages(product));
    // Recorte por fase = a "view" de cada papel, igual ao stagesForPhase da tela.
    const naFase = (k) => {
      if (phase === "all") return true;
      const f = phaseOf(k);
      if (phase === "sdr") return f === "sdr" || k === "desqualificado";
      if (phase === "entrega") return f === "entrega" || k === "ganho";
      return (f === "closer" || f === "entrega" || f === "fim") && k !== "desqualificado";
    };
    const visiveis = nomes.filter((st) => {
      const k = kindOf(product, st);
      if (!naFase(k)) return false;
      // Perdido nunca é coluna (é o cemitério); descartado só com o botão ligado.
      if (k === "perdido") return false;
      if (k === "desqualificado") return include_discarded;
      return true;
    });

    // Card fora do funil cai na primeira etapa — mesma regra do byStage da tela.
    const porEtapa = new Map(nomes.map((st) => [st, []]));
    for (const l of escopo) {
      const st = nomes.includes(l.stage) ? l.stage : nomes[0];
      if (porEtapa.has(st)) porEtapa.get(st).push(l);
    }

    const rows = visiveis.map((st) => {
      const arr = (porEtapa.get(st) || []).map((l) => leadRow(product, l, now));
      const valor = round2(arr.reduce((a, r) => a + num(r.amount), 0));
      const prob = round2(probOf(product, st));
      const stale = num(rowOf(product, st)?.staleDays);
      const dias = arr.map((r) => r.diasNaEtapa).filter((d) => d != null).sort((a, b) => a - b);
      return {
        stage: st,
        kind: kindOf(product, st),
        phase: phaseOf(kindOf(product, st)),
        leads: arr.length,
        valor,
        prob,
        forecast: round2(valor * prob),
        atrasados: arr.filter((r) => r.atrasoDias > 0).length,
        semProximoPasso: arr.filter((r) => !r.proximoToque).length,
        diasMedianosNaEtapa: dias.length ? dias[Math.floor(dias.length / 2)] : null,
        parados: stale ? arr.filter((r) => (r.diasNaEtapa ?? 0) > stale).length : 0,
        staleDays: stale || null,
      };
    });

    const abertosLeads = escopo.filter((l) => abertos.has(l.stage));
    const mes = today().slice(0, 7);
    const ganhos = escopo.filter((l) => isWonLead(product, l) && bizDayOf(wonAtOf(l)).slice(0, 7) === mes);
    const novosSemana = escopo.filter((l) => atMs(l.createdAt) != null && now - atMs(l.createdAt) <= 7 * DAY).length;

    const tables = {};
    let cardsOmitidos = 0;
    if (cards) {
      const flat = visiveis.flatMap((st) => {
        const col = sortLeads((porEtapa.get(st) || []).map((l) => leadRow(product, l, now)), sort);
        cardsOmitidos += Math.max(0, col.length - limit);
        return col.slice(0, limit);
      });
      tables.cards = {
        label: `Cards (até ${limit} por coluna, ordem: ${sort})`,
        columns: LEAD_COLS,
        rows: flat,
        page: { total: flat.length + cardsOmitidos, returned: flat.length, limit, truncated: cardsOmitidos > 0 },
      };
    }
    // Chips de pessoa da tela: quantos cards cada um carrega (dono/closer/integrador).
    const donos = new Map();
    for (const l of todos) {
      for (const who of new Set([l.owner, l.closer, l.integrator].filter(Boolean))) {
        donos.set(who, (donos.get(who) || 0) + 1);
      }
    }
    tables.time = {
      label: "Cards por pessoa",
      columns: ["id", "nome", "papeis", "cards"],
      rows: [...donos.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({
        id, nome: nameOf(team, id), papeis: (team.find((u) => u.id === id)?.roles || []).join("/"), cards: n,
      })),
    };

    return result({
      kind: "pipeline.board",
      title: `Pipeline · ${product.name || product.id}`,
      scope: { saas: product.id, person: person || "todos", phase },
      units: UNITS,
      totals: {
        leadsAbertos: abertosLeads.length,
        valorAberto: round2(abertosLeads.reduce((a, l) => a + num(l.amount), 0)),
        // Sobre TODAS as etapas abertas, não só as visíveis: com filtro de fase
        // o forecast tem que falar do mesmo recorte que valorAberto, senão os
        // dois totais contam pipelines diferentes lado a lado.
        forecastPonderado: round2([...abertos].reduce((a, st) =>
          a + (porEtapa.get(st) || []).reduce((x, l) => x + num(l.amount), 0) * probOf(product, st), 0)),
        ganhoMesQtd: ganhos.length,
        ganhoMesValor: round2(ganhos.reduce((a, l) => a + num(l.amount), 0)),
        novosSemana,
        atrasados: rows.reduce((a, r) => a + r.atrasados, 0),
        semProximoPasso: rows.reduce((a, r) => a + r.semProximoPasso, 0),
        descartados: escopo.filter((l) => kindOf(product, l.stage) === "desqualificado").length,
        perdidos: escopo.filter((l) => kindOf(product, l.stage) === "perdido").length,
        leadsNoProduto: todos.length,
      },
      columns: ["stage", "kind", "phase", "leads", "valor", "prob", "forecast", "atrasados", "semProximoPasso", "parados", "diasMedianosNaEtapa", "staleDays"],
      rows,
      rowsLabel: "Colunas do funil",
      tables,
      notes: [
        "forecast = valor da coluna × produto das conversões (`conv`) configuradas das etapas seguintes até o Ganho — é a régua da tela, não conversão medida (para a real, use report_funnel).",
        `Ganho do mês corta pelo dia do negócio (BRT) usando wonAt: ${mes}.`,
        "o board conta TODOS os cards, inclusive leads internos/teste — é o que a tela desenha; leads_search e o funil oficial tiram esses, então os totais dos dois não batem de propósito.",
        "Perdido não vira coluna (é o cemitério) e Desqualificado só com include_discarded — igual à tela; os dois estão nos totais.",
        ...(cardsOmitidos ? [`a tabela de cards mostra até ${limit} por coluna: ${cardsOmitidos} cards ficaram de fora (a contagem por etapa em \`leads\` é a completa; suba \`limit\` ou use leads_search).`] : []),
        ...(nomes.length ? [] : [`o produto ${product.id} não tem funil configurado — use funnel_config para criar as etapas.`]),
      ],
      source: { endpoint: "GET /api/leads (tabela inteira; agrupamento feito no MCP)" },
    });
  });

  // ── Leitura: busca ────────────────────────────────────────────────────────
  tool("leads_search", {
    group: GRUPO,
    title: "Buscar leads",
    description: "Leads filtrados por texto, etapa, kind, responsável, prioridade, valor, atraso e criação, com totais.",
    input: {
      saas: z.string().optional(),
      q: z.string().optional().describe("Nome, empresa, e-mail, telefone, mensagem."),
      stage: z.string().optional().describe("Nome exato do estágio."),
      kind: z.enum([...KINDS]).optional().describe("Tipo da etapa, independe do nome."),
      status: z.enum(["abertos", "trabalhaveis", "ganhos", "perdidos", "todos"]).optional().describe("Padrão trabalhaveis (não terminais)."),
      person: z.string().optional().describe("Dono, closer OU integrador."),
      owner: z.string().optional(),
      closer: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      source: z.string().optional(),
      min_amount: z.number().optional(),
      min_score: z.number().optional(),
      late_only: z.boolean().optional().describe("Só próximo toque vencido."),
      no_next_action: z.boolean().optional(),
      stale_days: z.number().int().optional().describe("Parado na etapa há mais dias que isso."),
      ...periodInput(z),
      created_window: z.boolean().optional().describe("Aplica o período à criação (padrão false)."),
      include_internal: z.boolean().optional().describe("Inclui internos/teste (padrão false)."),
      sort: z.string().optional().describe('"campo" ou "campo:desc" (ex.: amount:desc).'),
      fields: z.array(z.string()).optional().describe("Campos crus do lead (ex.: email, utm.campaign)."),
      limit: z.number().int().optional().describe("Padrão 25."),
      offset: z.number().int().optional(),
    },
  }, async (a) => {
    const product = await resolveProduct(a.saas);
    const p = resolvePeriod({ period: a.period, since: a.since, until: a.until });
    const now = Date.now();
    let leads = await leadsOf(product.id, { priority: a.priority });
    if (!a.include_internal) leads = leads.filter(isRealLead);

    const status = a.status || "trabalhaveis";
    const workable = new Set(workableStages(product));
    const abertos = new Set(openStages(product));
    leads = leads.filter((l) => {
      const k = kindOf(product, l.stage);
      if (status === "abertos") return abertos.has(l.stage);
      if (status === "trabalhaveis") return !l.stage || workable.has(l.stage);
      if (status === "ganhos") return isWonLead(product, l);
      if (status === "perdidos") return LOSS_KINDS.has(k);
      return true;
    });
    if (a.stage) leads = leads.filter((l) => l.stage === a.stage);
    if (a.kind) leads = leads.filter((l) => leadKind(product, l) === a.kind);
    if (a.person) leads = leads.filter((l) => personMatch(l, a.person));
    if (a.owner) leads = leads.filter((l) => l.owner === a.owner);
    if (a.closer) leads = leads.filter((l) => l.closer === a.closer);
    if (a.source) leads = leads.filter((l) => String(l.source || "").toLowerCase().includes(a.source.toLowerCase()));
    if (a.min_amount != null) leads = leads.filter((l) => num(l.amount) >= a.min_amount);
    if (a.min_score != null) leads = leads.filter((l) => num(l.score) >= a.min_score);
    if (a.created_window) leads = leads.filter((l) => { const d = bizDayOf(l.createdAt); return d && d >= p.since && d <= p.until; });
    if (a.stale_days != null) leads = leads.filter((l) => (daysSince(l.stageSince || l.createdAt, now) ?? 0) > a.stale_days);
    if (a.late_only) leads = leads.filter((l) => { const t = nextTouch(product, l, now); return t && t.at < now; });
    if (a.no_next_action) leads = leads.filter((l) => !nextTouch(product, l, now));
    // A busca livre roda no lead CRU e ANTES dos totais: na linha derivada não
    // existem e-mail/telefone/mensagem, e somar antes de buscar faria o cabeçalho
    // falar de um conjunto maior que a tabela.
    if (a.q) leads = search(leads, a.q, ["id", "name", "company", "email", "phone", "message"]);

    // Projeção: linha padrão (derivada) ou os campos crus que o chamador pediu.
    const base = a.fields?.length ? leads : sortLeads(leads.map((l) => leadRow(product, l, now)), "toque");
    const s = select(base, {
      // Sem ordenação pedida, a linha padrão já vem na ordem da fila; a projeção
      // crua cai no mais recente primeiro (senão sai a ordem física da tabela).
      sort: a.sort || (a.fields?.length ? "createdAt:desc" : undefined),
      fields: a.fields,
      limit: a.limit ?? 25,
      offset: a.offset ?? 0,
    });

    const ganhos = leads.filter((l) => isWonLead(product, l));
    return result({
      kind: "pipeline.leads",
      title: `Leads · ${product.name || product.id}`,
      scope: { saas: product.id, status, ...(a.stage ? { stage: a.stage } : {}), ...(a.person ? { person: a.person } : {}) },
      period: a.created_window ? p : undefined,
      units: UNITS,
      totals: {
        leads: leads.length,
        valor: round2(leads.reduce((x, l) => x + num(l.amount), 0)),
        ganhos: ganhos.length,
        ticketMedio: ganhos.length ? round2(ganhos.reduce((x, l) => x + num(l.amount), 0) / ganhos.length) : 0,
        atrasados: leads.filter((l) => { const t = nextTouch(product, l, now); return t && t.at < now; }).length,
        semProximoPasso: leads.filter((l) => !nextTouch(product, l, now)).length,
      },
      columns: a.fields?.length ? undefined : LEAD_COLS,
      rows: s.rows,
      rowsLabel: "Leads",
      page: s.page,
      notes: [
        a.include_internal
          ? "incluindo leads internos/teste e saídas laterais de form — os números divergem do funil oficial."
          : "fora leads internos (teste do time) e saídas laterais de formulário, como no funil oficial.",
        ...(status === "trabalhaveis" ? ["status padrão = trabalháveis: ganhos, perdidos e desqualificados ficam de fora (peça status=todos para ver o histórico)."] : []),
      ],
      source: { endpoint: "GET /api/leads" },
    });
  });

  // ── Leitura: a ficha ──────────────────────────────────────────────────────
  tool("lead_get", {
    group: GRUPO,
    title: "Ficha completa do lead",
    description: "Ficha completa de um lead: campos, qualificação, atribuição UTM resolvida, proposta, agenda e timeline.",
    input: {
      lead_id: z.string(),
      timeline_limit: z.number().int().optional().describe("Padrão 30."),
      timeline_types: z.array(z.enum([...ACTIVITY_TYPES])).optional(),
      raw: z.boolean().optional().describe("Inclui o documento cru do lead."),
    },
  }, async ({ lead_id, timeline_limit = 30, timeline_types, raw = false }) => {
    const lead = await getLead(lead_id);
    const now = Date.now();
    const [product, atividades, team] = await Promise.all([
      lead.saas ? http.get(`/api/products/${encodeURIComponent(lead.saas)}`).catch(() => null) : null,
      http.get("/api/activities", { lead: lead.id }).catch(() => []),
      teamOf(),
    ]);
    // Bônus: sem eles a ficha ainda vale, então falha aqui não derruba a tool.
    const [ofertas, catalogo] = await Promise.all([
      http.get(`/api/leads/${encodeURIComponent(lead.id)}/proposal-offers`).catch(() => null),
      lead.saas ? http.get(`/api/marketing/${encodeURIComponent(lead.saas)}/attribution`).catch(() => null) : null,
    ]);

    const kind = leadKind(product, lead);
    const cad = cadenceOf(product, lead.stage || firstStage(product));
    const nt = nextTouch(product, lead, now);
    const utm = lead.utm || {};
    const nomeDe = (nivel, id) => (id ? (catalogo?.[nivel]?.[id]?.name || id) : "");

    const ficha = {
      id: lead.id, saas: lead.saas, nome: lead.name || "", empresa: lead.company || "",
      email: lead.email || "", telefone: lead.phone || "",
      etapa: lead.stage || firstStage(product), kind, fase: phaseOf(kind),
      diasNaEtapa: daysSince(lead.stageSince || lead.createdAt, now),
      toquesNaEtapa: `${num(lead.stageAttempts)}${cad.maxAttempts ? ` de ${cad.maxAttempts}` : ""}`,
      qualidade: leadGrade(lead) || "sem qualificação",
      score: lead.score ?? null, icp: lead.icp ?? null, prioridade: lead.priority || "",
      faixaFaturamento: lead.value || "", amount: num(lead.amount),
      dono: nameOf(team, lead.owner), closer: nameOf(team, lead.closer), integrador: nameOf(team, lead.integrator),
      origem: lead.source || "", idade: lead.age ?? null,
      proximoToque: nt ? new Date(nt.at).toISOString() : "",
      proximoToqueTipo: nt ? nt.tipo : "",
      proximoToqueNota: lead.nextActionNote || "",
      atrasado: !!(nt && nt.at < now),
      callAt: lead.callAt || "", followupAt: lead.followupAt || "", integrationAt: lead.integrationAt || "",
      callConfirmada: !!lead.callConfirmed, callUrl: lead.callUrl || "", integrationCallUrl: lead.integrationCallUrl || "",
      ultimoToqueEm: lead.lastActivityAt || "", ultimoToqueTipo: lead.lastActivityType || "",
      produtoFechado: lead.dealProduct || "", planoFechado: lead.planClosed || "",
      pagamento: lead.paymentMethod || "", parcelas: lead.paymentInstallments ?? null,
      propostaNaMesa: lead.proposalOffer || "", propostaUrl: lead.proposalUrl || "",
      propostaPersonalizadaUrl: lead.customProposalUrl || "",
      vendido: isWonLead(product, lead), wonAt: lead.wonAt || "", customerId: lead.customerId || "",
      motivoPerda: lead.lostReason ? lossLabel(product, lead.lostReason) : "",
      notaPerda: lead.lostNote || "", desqualificado: !!lead.disqualified,
      combinado: lead.recapNote || "", motivo: lead.reason || "",
      criadoEm: lead.createdAt || "",
    };

    const atribuicao = {
      source: lead.source || "", form: lead.form || "", formHeadline: lead.formHeadline || lead.formVariant || "",
      sourcePain: lead.sourcePain || "", sourceUrl: lead.sourceUrl || "",
      utmSource: utm.source || "", utmMedium: utm.medium || "", utmCampaign: nomeDe("campaigns", utm.campaign),
      utmTerm: nomeDe("adsets", utm.term), utmContent: nomeDe("ads", utm.content), referrer: utm.referrer || "",
      // Os ids crus continuam à mão: é por eles que se cruza com ads_report.
      idsCrus: [utm.campaign, utm.term, utm.content].filter(Boolean).join(" / "),
      fbclid: utm.fbclid || "", fbc: lead.fbc || "",
    };

    // Qualificação: as chaves são dinâmicas (product.leadQuestions, sincronizadas
    // do formulário), então o rótulo tem que vir do produto, não do código.
    const perguntas = (product?.leadQuestions || []).map((q) => ({
      campo: q.key,
      pergunta: q.label || q.key,
      resposta: (q.options || []).find((o) => o.value === lead[q.key])?.label ?? (lead[q.key] ?? ""),
    })).filter((r) => r.resposta !== "" && r.resposta != null);

    let eventos = (atividades || []).filter((x) => !timeline_types?.length || timeline_types.includes(x.type));
    eventos = eventos.sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
    const tl = select(eventos, { limit: timeline_limit });

    return result({
      kind: "pipeline.lead",
      title: `Lead · ${lead.name || lead.id}`,
      scope: { saas: lead.saas, lead: lead.id, etapa: ficha.etapa },
      units: UNITS,
      totals: {
        amount: ficha.amount, diasNaEtapa: ficha.diasNaEtapa, toques: (atividades || []).filter((x) => TOUCH_TYPES.has(x.type)).length,
        eventos: (atividades || []).length, vendido: ficha.vendido,
      },
      detail: raw ? { ficha, cru: lead } : ficha,
      tables: {
        atribuicao: { label: "De onde veio", columns: ["campo", "valor"], rows: Object.entries(atribuicao).filter(([, v]) => v).map(([campo, valor]) => ({ campo, valor })) },
        ...(perguntas.length ? { qualificacao: { label: "Qualificação", columns: ["pergunta", "resposta", "campo"], rows: perguntas } } : {}),
        ...(ofertas?.offers?.length ? { ofertas: { label: "Ofertas da proposta gerada", columns: ["offer", "label", "price", "per", "cycles"], rows: ofertas.offers } } : {}),
        timeline: {
          label: "Timeline (mais recente primeiro)",
          columns: ["at", "type", "author", "text", "meta"],
          rows: tl.rows.map((e) => ({ at: e.at, type: e.type, author: e.author || "", text: String(e.text || "").slice(0, 300), meta: e.meta || null })),
        },
      },
      page: tl.page,
      notes: [
        ...(catalogo ? [] : ["catálogo de anúncios indisponível: os ids de UTM ficaram crus."]),
        ...(product ? [] : [`produto "${lead.saas}" não encontrado — kind, cadência e motivo de perda ficam por heurística de nome.`]),
        ...(ficha.vendido && !lead.wonAt ? ["venda sem carimbo wonAt (lead antigo): a data do ganho cai no stageSince."] : []),
      ],
      source: { endpoint: `GET /api/leads/${lead.id} + GET /api/activities?lead=${lead.id}` },
    });
  });

  // ── Leitura: timeline agregada ────────────────────────────────────────────
  tool("leads_timeline", {
    group: GRUPO,
    title: "Atividades do time",
    description: "Atividades nos leads do período: toques, movimentos de etapa e eventos automáticos, com resumo agregado.",
    input: {
      saas: z.string().optional(),
      lead_id: z.string().optional(),
      type: z.enum([...ACTIVITY_TYPES]).optional(),
      author: z.string().optional().describe("id de quem registrou."),
      ...periodInput(z),
      group_by: z.enum(["none", "type", "author", "lead", "dia"]).optional().describe("Padrão type."),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, lead_id, type, author, period, since, until, group_by = "type", limit = 50, offset = 0 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    // O `since` do servidor é comparação de string em `at` — passar o dia basta.
    const rows = await http.get("/api/activities", { saas: product.id, lead: lead_id, type, since: p.since });
    let eventos = (rows || []).filter((e) => {
      const d = bizDayOf(e.at);
      return d && d >= p.since && d <= p.until;
    });
    if (author) eventos = eventos.filter((e) => e.author === author);
    eventos = eventos.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

    const chave = { type: (e) => e.type, author: (e) => e.author || "—", lead: (e) => e.lead || "—", dia: (e) => bizDayOf(e.at) };
    const resumo = group_by === "none" ? [] : (() => {
      const m = new Map();
      for (const e of eventos) {
        const k = chave[group_by](e);
        const g = m.get(k) || { [group_by]: k, eventos: 0, toques: 0, movimentos: 0 };
        g.eventos += 1;
        if (TOUCH_TYPES.has(e.type)) g.toques += 1;
        if (e.type === "stage") g.movimentos += 1;
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.eventos - a.eventos);
    })();

    const s = select(eventos, { limit, offset });
    return result({
      kind: "pipeline.activities",
      title: `Atividades · ${product.name || product.id}`,
      scope: { saas: product.id, ...(lead_id ? { lead: lead_id } : {}), group_by },
      period: p,
      totals: {
        eventos: eventos.length,
        toques: eventos.filter((e) => TOUCH_TYPES.has(e.type)).length,
        movimentosDeEtapa: eventos.filter((e) => e.type === "stage").length,
        leadsTocados: new Set(eventos.filter((e) => TOUCH_TYPES.has(e.type)).map((e) => e.lead)).size,
      },
      columns: ["at", "lead", "type", "author", "text", "meta"],
      rows: s.rows.map((e) => ({ at: e.at, lead: e.lead, type: e.type, author: e.author || "", text: String(e.text || "").slice(0, 200), meta: e.meta || null })),
      rowsLabel: "Eventos",
      page: s.page,
      tables: resumo.length ? { resumo: { label: `Resumo por ${group_by}`, columns: [group_by, "eventos", "toques", "movimentos"], rows: resumo } } : {},
      notes: ["stage e system são eventos automáticos, não toques do time; só whatsapp/call/email/meeting contam como toque."],
      source: { endpoint: "GET /api/activities" },
    });
  });

  // ── Leitura: a fila ───────────────────────────────────────────────────────
  tool("pipeline_worklist", {
    group: GRUPO,
    title: "O que fazer agora",
    description: "Fila de trabalho por urgência: vencidos, hoje, amanhã, sem próximo passo, novos sem toque e parados.",
    input: {
      saas: z.string().optional(),
      person: z.string().optional().describe("Só a fila dele; omitido = time todo."),
      buckets: z.array(z.enum(["atrasados", "hoje", "amanha", "proximos", "sem_data", "novos", "parados"])).optional().describe("Padrão: atrasados, hoje, sem_data, parados."),
      limit: z.number().int().optional().describe("Itens por bloco (padrão 20)."),
    },
  }, async ({ saas, person, buckets, limit = 20 }) => {
    const product = await resolveProduct(saas);
    const [leads, team] = await Promise.all([leadsOf(product.id), teamOf()]);
    const now = Date.now();
    const inicioHoje = startOfToday();
    const fimHoje = inicioHoje + DAY - 1;
    const fimAmanha = fimHoje + DAY;
    const workable = new Set(workableStages(product));
    const inc = new Set(buckets?.length ? buckets : ["atrasados", "hoje", "sem_data", "parados"]);

    // Responsável da vez: SDR (dono) na pré-venda, closer na fase de call e o
    // integrador na entrega — a mesma régua do buildQueue (today.jsx). Card sem
    // ninguém só entra na fila de quem tem o PAPEL da fase.
    const papeis = new Map(team.map((u) => [u.id, new Set(u.roles || [])]));
    const PHASE_ROLE = { sdr: "sdr", closer: "closer", entrega: "integrator" };

    const itens = [];
    for (const l of leads) {
      if (l.stage && !workable.has(l.stage)) continue;
      const stage = l.stage || firstStage(product);
      const kind = kindOf(product, stage);
      const fase = phaseOf(kind);
      const quem = fase === "sdr" ? (l.owner || "") : fase === "entrega" ? (l.integrator || "") : (l.closer || "");
      if (person) {
        if (quem) { if (quem !== person) continue; }
        else if (!papeis.get(person)?.has(PHASE_ROLE[fase])) continue;
      }
      const nt = nextTouch(product, l, now);
      // Toque já registrado hoje = item cumprido (fica na fila, riscado na tela).
      const feito = TOUCH_TYPES.has(l.lastActivityType) && bizDayOf(l.lastActivityAt) === today();
      const stale = num(rowOf(product, stage)?.staleDays);
      const dias = daysSince(l.stageSince || l.createdAt, now) ?? 0;
      const base = { ...leadRow(product, l, now), responsavel: quem, responsavelNome: nameOf(team, quem), feitoHoje: feito };

      // Bloco pelo QUANDO; "novo sem toque" e "parado" são marcas que cruzam os
      // blocos (o SLA do lead novo corre mesmo com o GPS marcado pra depois).
      let bucket;
      if (!nt) bucket = "sem_data";
      else if (nt.at < inicioHoje) bucket = "atrasados";
      else if (nt.at <= fimHoje) bucket = "hoje";
      else if (nt.at <= fimAmanha) bucket = "amanha";
      else bucket = "proximos";
      itens.push({
        ...base, bucket,
        novoSemToque: kind === "novo" && !num(l.stageAttempts),
        parado: stale > 0 && dias > stale,
        urgencia: urgenciaDe(kind, stage, nt, fase),
      });
    }

    const ordena = (arr) => arr.sort((a, b) =>
      a.urgencia - b.urgencia
      || (a.proximoToque ? Date.parse(a.proximoToque) : Infinity) - (b.proximoToque ? Date.parse(b.proximoToque) : Infinity)
      || (TIER_RANK[b.grade] || 0) - (TIER_RANK[a.grade] || 0));

    const tables = {};
    const LABEL = {
      atrasados: "Atrasados (próximo toque vencido)", hoje: "Hoje", amanha: "Amanhã",
      proximos: "Próximos dias", sem_data: "Sem próximo passo",
      novos: "Novos sem nenhum toque (SLA de 1º contato correndo)",
      parados: "Parados além do staleDays da etapa",
    };
    const cols = ["id", "name", "company", "stage", "kind", "responsavelNome", "proximoToque", "toqueTipo", "atrasoDias", "diasNaEtapa", "grade", "amount", "feitoHoje"];
    const bloco = (nome, arr) => {
      const ord = ordena(arr);
      const s = select(ord, { limit });
      tables[nome] = { label: `${LABEL[nome]} (${ord.length})`, columns: cols, rows: s.rows, page: s.page };
    };
    for (const b of ["atrasados", "hoje", "amanha", "proximos", "sem_data"]) {
      if (inc.has(b)) bloco(b, itens.filter((i) => i.bucket === b));
    }
    if (inc.has("novos")) bloco("novos", itens.filter((i) => i.novoSemToque));
    if (inc.has("parados")) bloco("parados", itens.filter((i) => i.parado));

    const conta = (b) => itens.filter((i) => i.bucket === b).length;
    return result({
      kind: "pipeline.worklist",
      title: `Fila de trabalho · ${product.name || product.id}${person ? ` · ${nameOf(team, person)}` : ""}`,
      scope: { saas: product.id, person: person || "time todo", dia: today() },
      units: UNITS,
      totals: {
        naFila: itens.length,
        atrasados: conta("atrasados"), hoje: conta("hoje"), amanha: conta("amanha"),
        proximos: conta("proximos"), semProximoPasso: conta("sem_data"),
        novosSemToque: itens.filter((i) => i.novoSemToque).length,
        parados: itens.filter((i) => i.parado).length,
        tocadosHoje: itens.filter((i) => i.feitoHoje).length,
      },
      tables,
      notes: [
        "ordem = urgência do processo (compromisso marcado → novo → no-show → qualificação → closer/entrega → resto), igual ao Meu dia.",
        "novos e parados cruzam os blocos de data: o mesmo card pode aparecer em 'hoje' e em 'novos'.",
        "só entram etapas trabalháveis (kind não-terminal); ganho, perdido e desqualificado ficam de fora.",
        ...(person && !papeis.has(person) ? [`"${person}" não está em /api/auth/users: cards sem responsável não entram na fila dele.`] : []),
      ],
      source: { endpoint: "GET /api/leads (fila calculada no MCP, como no navegador)" },
    });
  });

  // Ordem de atendimento do Meu dia (GROUP_ORDER): o que é mais sensível a
  // horário primeiro; lead quente antes de nutrição; sem agenda por último.
  function urgenciaDe(kind, stage, nt, fase) {
    if (nt && nt.tipo !== "toque") return 1;          // compromisso marcado
    if (kind === "novo") return 2;
    if (isNoShowStage(stage)) return 3;
    if (fase === "sdr") return 4;
    if (fase === "closer" || fase === "entrega") return 5;
    return 6;
  }

  // ── Escrita: criar ────────────────────────────────────────────────────────
  tool("lead_create", {
    group: GRUPO,
    title: "Criar lead",
    description: "Cria um lead no funil; telefone/e-mail já existente é MESCLADO no card atual.",
    write: true, external: true,
    danger: "dispara efeitos reais: gera a proposta nativa (página pública, consome IA), avisa no Discord e, no formulário, o evento Lead da Meta.",
    hint: "name é obrigatório (saas só quando há mais de um produto); entrando direto numa etapa de call, mande call_at ('YYYY-MM-DDTHH:MM', hora de Brasília).",
    input: {
      saas: z.string().optional(),
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      company: z.string().optional(),
      message: z.string().optional(),
      stage: z.string().optional().describe("Padrão: primeira etapa do funil."),
      owner: z.string().optional(),
      closer: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      score: z.number().optional(),
      source: z.string().optional().describe("Ex.: indicacao, outbound, form."),
      value: z.string().optional().describe("Faixa de faturamento declarada."),
      amount: z.number().optional().describe("R$."),
      call_at: z.string().optional().describe("'YYYY-MM-DDTHH:MM' (BRT)."),
      next_action_at: z.string().optional().describe("ISO; vazio = cadência da etapa."),
      next_action_note: z.string().optional(),
      internal: z.boolean().optional().describe("Teste do time: pula dedup e Meta."),
      utm: z.record(z.any()).optional().describe("{source, medium, campaign, term, content, referrer}."),
      fields: z.record(z.any()).optional().describe("Chaves de product.leadQuestions."),
    },
  }, async (a) => {
    const product = await resolveProduct(a.saas);
    const body = {
      saas: product.id, name: a.name,
      ...(a.email ? { email: a.email } : {}), ...(a.phone ? { phone: a.phone } : {}),
      ...(a.company ? { company: a.company } : {}), ...(a.message ? { message: a.message } : {}),
      ...(a.stage ? { stage: a.stage } : {}), ...(a.owner ? { owner: a.owner } : {}),
      ...(a.closer ? { closer: a.closer } : {}), ...(a.priority ? { priority: a.priority } : {}),
      ...(a.score != null ? { score: a.score } : {}), ...(a.source ? { source: a.source } : {}),
      ...(a.value ? { value: a.value } : {}), ...(a.amount != null ? { amount: a.amount } : {}),
      ...(a.call_at ? { callAt: a.call_at } : {}),
      ...(a.next_action_at ? { nextActionAt: a.next_action_at } : {}),
      ...(a.next_action_note ? { nextActionNote: a.next_action_note } : {}),
      ...(a.internal ? { internal: true } : {}),
      ...(a.utm ? { utm: a.utm } : {}),
      ...(a.fields || {}),
    };
    const lead = await http.post("/api/leads", body);
    const mesclado = !!lead._dedup;
    return result({
      kind: "pipeline.lead_create",
      title: mesclado ? `Lead JÁ EXISTIA e foi mesclado: ${lead.name || lead.id}` : `Lead criado: ${lead.name || lead.id}`,
      scope: { saas: product.id, lead: lead.id },
      units: UNITS,
      totals: {
        id: lead.id, mesclado, etapa: lead.stage || firstStage(product),
        dono: lead.owner || "", proximoToque: lead.nextActionAt || "", propostaUrl: lead.proposalUrl || "",
      },
      detail: leadRow(product, lead),
      notes: [
        mesclado
          ? "telefone/e-mail já existiam neste produto: nada de novo nasceu — etapa, dono, GPS e proposta do card antigo ficaram INTACTOS, só a atribuição foi refrescada e os campos vazios preenchidos."
          : "o servidor carimbou o GPS pela cadência da etapa e, com um único SDR no produto, o dono automático.",
        ...(lead.proposalUrl && !mesclado ? [`proposta nativa gerada automaticamente: ${lead.proposalUrl} (página pública).`] : []),
      ],
      source: { endpoint: "POST /api/leads" },
    });
  });

  // ── Escrita: editar ───────────────────────────────────────────────────────
  const CAMPOS_GATEADOS = {
    stage: "use lead_move_stage (o movimento tem gates e efeitos colaterais)",
    callAt: "use lead_next_action (com what=call)",
    followupAt: "use lead_next_action (com what=followup)",
    integrationAt: "use lead_next_action (com what=integracao)",
    nextActionAt: "use lead_next_action (com what=toque)",
  };

  tool("lead_update", {
    group: GRUPO,
    title: "Editar campos do lead",
    description: "Edita campos do lead fora de etapa e agenda: responsáveis, prioridade, valor, contato, notas.",
    write: true, external: true,
    danger: "editar amount/planClosed/paymentMethod de um lead já vendido reescreve o cliente, a assinatura e o cronograma de faturas (espelhados no Mercado Pago); trocar o closer com call marcada move o Meet e manda e-mail ao lead.",
    hint: "para mudar de etapa use lead_move_stage; para mexer em horários use lead_next_action.",
    input: {
      lead_id: z.string(),
      owner: z.string().optional(),
      closer: z.string().optional(),
      integrator: z.string().optional(),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      score: z.number().optional(),
      amount: z.number().optional().describe("R$."),
      name: z.string().optional(),
      company: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      recap_note: z.string().optional().describe("O que ficou combinado."),
      next_action_note: z.string().optional().describe("Não mexe na data."),
      fields: z.record(z.any()).optional().describe("Outros campos crus do lead."),
    },
  }, async (a) => {
    const lead = await getLead(a.lead_id);
    const patch = {
      ...(a.owner != null ? { owner: a.owner } : {}), ...(a.closer != null ? { closer: a.closer } : {}),
      ...(a.integrator != null ? { integrator: a.integrator } : {}), ...(a.priority ? { priority: a.priority } : {}),
      ...(a.score != null ? { score: a.score } : {}), ...(a.amount != null ? { amount: a.amount } : {}),
      ...(a.name != null ? { name: a.name } : {}), ...(a.company != null ? { company: a.company } : {}),
      ...(a.email != null ? { email: a.email } : {}), ...(a.phone != null ? { phone: a.phone } : {}),
      ...(a.recap_note != null ? { recapNote: a.recap_note } : {}),
      ...(a.next_action_note != null ? { nextActionNote: a.next_action_note } : {}),
      ...(a.fields || {}),
    };
    const bloqueado = Object.keys(patch).find((k) => CAMPOS_GATEADOS[k]);
    if (bloqueado) throw new ApiError(`"${bloqueado}" não se edita por aqui: ${CAMPOS_GATEADOS[bloqueado]}.`, { status: 400 });
    if (!Object.keys(patch).length) throw new ApiError("nada para alterar: informe ao menos um campo.", { status: 400 });

    const product = lead.saas ? await http.get(`/api/products/${encodeURIComponent(lead.saas)}`).catch(() => null) : null;
    const atualizado = await http.patch(`/api/leads/${encodeURIComponent(lead.id)}`, patch);
    const notes = [];
    if (atualizado.customerId && ["amount", "planClosed", "paymentMethod", "paymentInstallments", "consultPackage"].some((k) => k in patch)) {
      notes.push(`lead já convertido (cliente ${atualizado.customerId}): o fechamento foi re-espelhado no cliente, na assinatura e nas faturas.`);
    }
    if ("closer" in patch && atualizado.callAt) notes.push("closer trocado com call marcada: o Meet e a agenda pessoal foram re-sincronizados (e-mail de atualização vai pro lead).");
    return result({
      kind: "pipeline.lead_update",
      title: `Lead atualizado: ${atualizado.name || atualizado.id}`,
      scope: { saas: atualizado.saas, lead: atualizado.id },
      units: UNITS,
      totals: { camposAlterados: Object.keys(patch).length },
      detail: { alterado: patch, agora: leadRow(product, atualizado) },
      notes,
      source: { endpoint: `PATCH /api/leads/${atualizado.id}` },
    });
  });

  // ── Escrita: mover ────────────────────────────────────────────────────────
  // O movimento é a operação mais perigosa do cockpit: entrar na região de venda
  // CRIA cliente, assinatura, faturas e manda Purchase pra Meta; sair dela
  // APAGA tudo isso. Por isso os gates da tela estão espelhados aqui.
  const moveInput = {
    lead_id: z.string().optional(),
    id: z.string().optional().describe("Apelido de lead_id."),
    stage: z.string().optional().describe("Nome exato."),
    to_kind: z.enum([...KINDS]).optional().describe("Alternativa a `stage` (1ª etapa desse tipo)."),
    lost_reason: z.string().optional().describe("id de product.lossReasons; exigido indo pra perda."),
    lost_note: z.string().optional(),
    closer: z.string().optional().describe("Exigido no handoff SDR→closer."),
    call_at: z.string().optional().describe("'YYYY-MM-DDTHH:MM' (BRT); etapa de call exige."),
    followup_at: z.string().optional().describe("'YYYY-MM-DDTHH:MM' (BRT); limpa a call."),
    integration_at: z.string().optional().describe("'YYYY-MM-DDTHH:MM' (BRT)."),
    amount: z.number().optional().describe("Valor fechado em R$; exigido no Ganho."),
    plan_closed: z.enum(["anual", "semestral", "mensal", "unico"]).optional(),
    payment_method: z.string().optional(),
    payment_installments: z.number().int().optional(),
    deal_product: z.string().optional().describe("Do catálogo da proposta."),
    consult_package: z.number().int().optional().describe("UniqueKids: 4 ou 8 consultas."),
    proposal_offer: z.string().optional().describe("id do plano na mesa ou 'nenhuma'."),
    note: z.string().optional().describe("Vira nota na timeline."),
  };

  async function moverEtapa(a) {
    const leadId = a.lead_id || a.id;
    if (!leadId) throw new ApiError("informe lead_id (o id do lead).", { status: 400 });
    const lead = await getLead(leadId);
    const product = lead.saas ? await http.get(`/api/products/${encodeURIComponent(lead.saas)}`).catch(() => null) : null;

    let destino = a.stage;
    if (!destino && a.to_kind) {
      destino = stageByKind(product, a.to_kind);
      if (!destino) {
        throw new ApiError(`o funil de ${lead.saas} não tem etapa do tipo "${a.to_kind}"`, {
          status: 400, detail: `etapas: ${stageNames(product).join(", ") || "(funil vazio)"}`,
        });
      }
    }
    if (!destino) throw new ApiError("informe `stage` (nome da etapa) ou `to_kind`.", { status: 400 });
    if (stageNames(product).length && !stageNames(product).includes(destino)) {
      throw new ApiError(`"${destino}" não é etapa do funil de ${lead.saas}`, { status: 400, detail: `etapas: ${stageNames(product).join(", ")}` });
    }
    if (lead.stage === destino) throw new ApiError(`o lead já está em "${destino}".`, { status: 400 });

    const deKind = leadKind(product, lead);
    const paraKind = kindOf(product, destino);
    const notes = [];

    // Gate da call: o servidor recusa (422 CALL_SEM_HORARIO) e o card não sai do
    // lugar — melhor falhar aqui, dizendo o formato da hora.
    if (paraKind === "call" && !String(a.call_at || lead.callAt || "").trim()) {
      throw new ApiError(`a etapa "${destino}" exige hora da call`, {
        status: 422, detail: "mande call_at no formato 'YYYY-MM-DDTHH:MM' (hora de Brasília).",
      });
    }
    if (LOSS_KINDS.has(paraKind) && !a.lost_reason && !lead.lostReason) {
      notes.push(`SEM motivo de perda: o servidor vai gravar "nao_informado" e o relatório de perdas expõe o buraco. Motivos disponíveis: ${lossReasonsOf(product).map((r) => r.id).join(", ")}.`);
    }
    if (phaseOf(deKind) === "sdr" && phaseOf(paraKind) === "closer" && !a.closer && !lead.closer) {
      notes.push("handoff SDR→closer sem closer definido: na tela isso é bloqueado. Mande `closer` para o card não ficar órfão na fila do time.");
    }
    if (SOLD_KINDS.has(paraKind) && !(num(a.amount) > 0) && !(num(lead.amount) > 0)) {
      notes.push("fechamento sem valor: o cliente nasce com ARR 0 e o Purchase enviado à Meta vai com valor zero. Mande `amount`.");
    }
    if (SOLD_KINDS.has(deKind) && !SOLD_KINDS.has(paraKind) && (lead.customerId || lead.wonAt)) {
      notes.push(`DESFAZENDO O FECHAMENTO: o cliente ${lead.customerId || "criado por esta venda"}, as assinaturas e as faturas automáticas serão APAGADOS (a menos que exista cobrança real no Mercado Pago).`);
    }

    const patch = {
      stage: destino,
      ...(a.lost_reason ? { lostReason: a.lost_reason } : {}),
      ...(a.lost_note ? { lostNote: a.lost_note } : {}),
      ...(a.closer ? { closer: a.closer } : {}),
      ...(a.call_at ? { callAt: a.call_at } : {}),
      ...(a.followup_at ? { followupAt: a.followup_at } : {}),
      ...(a.integration_at ? { integrationAt: a.integration_at } : {}),
      ...(a.amount != null ? { amount: a.amount } : {}),
      ...(a.plan_closed ? { planClosed: a.plan_closed } : {}),
      ...(a.payment_method ? { paymentMethod: a.payment_method } : {}),
      ...(a.payment_installments != null ? { paymentInstallments: a.payment_installments } : {}),
      ...(a.deal_product ? { dealProduct: a.deal_product } : {}),
      ...(a.consult_package != null ? { consultPackage: a.consult_package } : {}),
      ...(a.proposal_offer ? { proposalOffer: a.proposal_offer } : {}),
    };
    const atualizado = await http.patch(`/api/leads/${encodeURIComponent(lead.id)}`, patch);
    // O contexto do movimento vira nota na timeline (é o que a tela faz no handoff).
    if (a.note) {
      await http.post("/api/activities", { saas: lead.saas || "", lead: lead.id, type: "note", text: a.note, meta: { reschedule: false } })
        .catch(() => notes.push("a nota não foi registrada na timeline (o movimento foi salvo)."));
    }

    if (SOLD_KINDS.has(paraKind) && atualizado.customerId) notes.push(`cliente ${atualizado.customerId} criado/atualizado pela conversão, com assinatura e faturas; Purchase enviado à Meta.`);
    if (paraKind === "call" && atualizado.callUrl) notes.push(`sala do Meet: ${atualizado.callUrl} (convite por e-mail para o lead).`);
    if (LOSS_KINDS.has(paraKind)) notes.push("lead descartado: a conversa de WhatsApp foi encerrada e o card saiu da fila do GPS.");

    return result({
      kind: "pipeline.lead_move",
      title: `${lead.name || lead.id}: ${lead.stage || "(sem etapa)"} → ${destino}`,
      scope: { saas: lead.saas, lead: lead.id },
      units: UNITS,
      totals: {
        de: lead.stage || "", para: destino, deKind, paraKind,
        motivoPerda: atualizado.lostReason ? lossLabel(product, atualizado.lostReason) : "",
        proximoToque: atualizado.nextActionAt || "", amount: num(atualizado.amount),
        vendido: isWonLead(product, atualizado), customerId: atualizado.customerId || "",
      },
      detail: leadRow(product, atualizado),
      notes,
      source: { endpoint: `PATCH /api/leads/${lead.id} (o servidor roda applyStageMove)` },
    });
  }

  tool("lead_move_stage", {
    group: GRUPO,
    title: "Mover card de etapa",
    description: "Move o card de etapa com os gates da tela (motivo de perda, closer, hora da call, valor); Ganho/Integração cria cliente e sair de lá desfaz a venda.",
    write: true, destructive: true, external: true,
    danger: "entrar em Ganho/Integração cria cliente, assinatura e faturas e envia Purchase real à Meta; sair de lá APAGA o cliente e as faturas criadas pela venda.",
    hint: "etapa de call exige call_at ('YYYY-MM-DDTHH:MM' BRT); perda sem lost_reason grava 'nao_informado'. Use funnel_config para ver as etapas e os motivos válidos.",
    input: moveInput,
  }, moverEtapa);

  // Nome antigo, já em uso por integrações: mantido como alias exato.
  tool("move_deal", {
    group: GRUPO,
    title: "Mover card (alias)",
    description: "Alias de lead_move_stage.",
    write: true, destructive: true, external: true,
    danger: "mesmo efeito de lead_move_stage: cria ou apaga cliente, assinatura e faturas.",
    hint: "prefira lead_move_stage.",
    input: moveInput,
  }, moverEtapa);

  // ── Escrita: timeline ─────────────────────────────────────────────────────
  tool("lead_log_activity", {
    group: GRUPO,
    title: "Registrar toque ou nota",
    description: "Registra toque ou nota na timeline; toque conta tentativa e re-agenda o próximo passo pela cadência.",
    write: true,
    hint: "type=note só atualiza o último contato; para mover a fila use um tipo de toque.",
    input: {
      lead_id: z.string(),
      type: z.enum([...ACTIVITY_TYPES]).optional().describe("Padrão note; toque: whatsapp/call/email/meeting."),
      text: z.string().optional(),
      author: z.string().optional().describe("Padrão: a chave da API."),
      at: z.string().optional().describe("ISO; padrão agora."),
      next_action_at: z.string().optional().describe("ISO; vence a cadência da etapa."),
      reschedule: z.boolean().optional().describe("false = não mexe na agenda."),
    },
  }, async ({ lead_id, type = "note", text, author, at, next_action_at, reschedule }) => {
    const lead = await getLead(lead_id);
    const product = lead.saas ? await http.get(`/api/products/${encodeURIComponent(lead.saas)}`).catch(() => null) : null;
    const antes = { stage: lead.stage, nextActionAt: lead.nextActionAt, stageAttempts: num(lead.stageAttempts) };
    const meta = {
      ...(next_action_at ? { nextActionAt: next_action_at } : {}),
      ...(reschedule === false ? { reschedule: false } : {}),
    };
    const activity = await http.post("/api/activities", {
      saas: lead.saas || "", lead: lead.id, type,
      ...(text ? { text } : {}), ...(author ? { author } : {}), ...(at ? { at } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    });
    // O hook do servidor (onActivityCreated) pode ter movido o card: relê pra
    // não devolver um estado que já é mentira.
    const depois = await getLead(lead.id).catch(() => lead);

    const notes = [];
    if (depois.stage !== antes.stage) notes.push(`o toque promoveu o lead de "${antes.stage}" para "${depois.stage}" (primeiro contato num estágio novo segue sozinho pra qualificação).`);
    if (depois.nextActionAt !== antes.nextActionAt) notes.push(`próximo toque re-agendado para ${depois.nextActionAt || "(sem prazo)"}${next_action_at ? " (data manual)" : " pela cadência da etapa"}.`);
    if (!TOUCH_TYPES.has(type)) notes.push("nota não conta tentativa nem re-agenda a fila — só atualiza o último contato.");

    return result({
      kind: "pipeline.activity",
      title: `${type} registrado em ${depois.name || depois.id}`,
      scope: { saas: lead.saas, lead: lead.id },
      totals: {
        activityId: activity.id, tipo: type, quando: activity.at,
        etapa: depois.stage, toquesNaEtapa: num(depois.stageAttempts), proximoToque: depois.nextActionAt || "",
      },
      detail: leadRow(product, depois),
      notes,
      source: { endpoint: "POST /api/activities" },
    });
  });

  // ── Escrita: agenda / GPS ─────────────────────────────────────────────────
  tool("lead_next_action", {
    group: GRUPO,
    title: "Agendar o próximo passo",
    description: "Define ou limpa o próximo toque do lead e os compromissos de call, follow-up e integração.",
    write: true, external: true,
    danger: "marcar ou remarcar a call cria/move o evento no Google Meet e manda e-mail de atualização para o lead.",
    hint: "call/followup/integracao usam hora de Brasília sem fuso ('YYYY-MM-DDTHH:MM'); o toque avulso usa ISO.",
    input: {
      lead_id: z.string(),
      what: z.enum(["toque", "call", "followup", "integracao"]).optional().describe("Padrão toque."),
      at: z.string().optional().describe("toque: ISO; demais: 'YYYY-MM-DDTHH:MM' (BRT)."),
      note: z.string().optional().describe("Só com what=toque."),
      clear: z.boolean().optional().describe("true = apaga o agendamento."),
    },
  }, async ({ lead_id, what = "toque", at, note, clear = false }) => {
    if (!clear && !at) throw new ApiError("informe `at` (ou clear=true para apagar).", { status: 400 });
    const lead = await getLead(lead_id);
    const product = lead.saas ? await http.get(`/api/products/${encodeURIComponent(lead.saas)}`).catch(() => null) : null;
    const CAMPO = { toque: "nextActionAt", call: "callAt", followup: "followupAt", integracao: "integrationAt" };
    const valor = clear ? "" : (what === "toque" ? (isoOf(at) || at) : at);
    const patch = { [CAMPO[what]]: valor, ...(what === "toque" && note != null ? { nextActionNote: note } : {}) };
    const atualizado = await http.patch(`/api/leads/${encodeURIComponent(lead.id)}`, patch);

    const notes = [];
    if (what === "call" && !clear) {
      notes.push("um follow-up futuro que existisse foi limpo (um compromisso marcado por vez) e a call anterior JÁ PASSADA foi arquivada em callHistory.");
      if (atualizado.callUrl) notes.push(`Meet: ${atualizado.callUrl}`);
      if (isNoShowStage(lead.stage)) notes.push("o card estava em No show e voltou sozinho para a etapa de call.");
    }
    if (what === "followup" && !clear) notes.push("uma call futura ainda não realizada foi limpa (um compromisso marcado por vez).");
    if (what !== "toque" && !clear) notes.push(`o GPS (nextActionAt) passou a apontar para o compromisso: ${atualizado.nextActionAt || "(sem prazo)"}.`);
    if (clear) notes.push("agendamento apagado: sem compromisso vivo, o GPS volta a valer pela cadência da etapa.");

    const nt = nextTouch(product, atualizado);
    return result({
      kind: "pipeline.next_action",
      title: `${what} ${clear ? "apagado" : "agendado"} · ${atualizado.name || atualizado.id}`,
      scope: { saas: lead.saas, lead: lead.id },
      totals: {
        campo: CAMPO[what], valor: atualizado[CAMPO[what]] || "",
        proximoToque: nt ? new Date(nt.at).toISOString() : "", proximoToqueTipo: nt ? nt.tipo : "",
        etapa: atualizado.stage,
      },
      detail: leadRow(product, atualizado),
      notes,
      source: { endpoint: `PATCH /api/leads/${lead.id}` },
    });
  });

  // ── Escrita/leitura: proposta ─────────────────────────────────────────────
  tool("lead_proposal", {
    group: GRUPO,
    title: "Proposta do lead",
    description: "Proposta comercial do lead: ver ofertas, gerar/re-gerar ou criar o link de uma oferta.",
    write: true, external: true,
    danger: "generate e share criam páginas PÚBLICAS; o provider levercopy chama um SaaS externo e a geração nativa consome IA.",
    hint: "share exige uma proposta já gerada e o número da oferta (veja com action=offers).",
    input: {
      lead_id: z.string(),
      action: z.enum(["offers", "generate", "share"]).optional().describe("Padrão offers."),
      offer: z.number().int().optional().describe("Número da oferta."),
      force: z.boolean().optional().describe("Re-gera por cima da atual."),
      unpin: z.boolean().optional().describe("Troca o deck FIXADO à mão (apaga a sob medida)."),
      template: z.string().optional().describe("id do template."),
    },
  }, async ({ lead_id, action = "offers", offer, force, unpin, template }) => {
    const lead = await getLead(lead_id);
    const base = `/api/leads/${encodeURIComponent(lead.id)}`;
    if (action === "offers") {
      const r = await http.get(`${base}/proposal-offers`);
      return result({
        kind: "pipeline.proposal_offers",
        title: `Ofertas da proposta · ${lead.name || lead.id}`,
        scope: { saas: lead.saas, lead: lead.id, proposta: r.proposal || null },
        totals: { proposta: r.proposal || "", ofertas: (r.offers || []).length, url: lead.proposalUrl || "" },
        columns: ["offer", "label", "price", "per", "cycles"],
        rows: r.offers || [],
        rowsLabel: "Ofertas",
        notes: r.proposal ? [] : ["o lead ainda não tem proposta gerada — rode action=generate."],
        source: { endpoint: `GET ${base}/proposal-offers` },
      });
    }
    if (action === "share") {
      if (offer == null) throw new ApiError("informe `offer` (número da oferta; veja com action=offers).", { status: 400 });
      const r = await http.post(`${base}/proposal-share`, { offer });
      return result({
        kind: "pipeline.proposal_share",
        title: `Link da oferta ${r.offer} · ${lead.name || lead.id}`,
        scope: { saas: lead.saas, lead: lead.id },
        totals: { url: r.url, oferta: r.offer, label: r.label, propostaCompartilhada: r.id },
        notes: ["página pública, sem edição, com uma oferta só; a abertura pelo cliente entra na timeline."],
        source: { endpoint: `POST ${base}/proposal-share` },
      });
    }
    const flags = [force && "force=1", unpin && "unpin=1", template && `template=${encodeURIComponent(template)}`].filter(Boolean);
    const r = await http.post(`${base}/proposal${flags.length ? `?${flags.join("&")}` : ""}`, {}, { timeoutMs: 300_000 });
    return result({
      kind: "pipeline.proposal",
      title: `Proposta ${r.ok ? "gerada" : "não gerada"} · ${lead.name || lead.id}`,
      scope: { saas: lead.saas, lead: lead.id, provider: r.provider || "" },
      units: UNITS,
      totals: {
        ok: !!r.ok, provider: r.provider || "", motivo: r.skipped || r.error || "",
        url: r.lead?.proposalUrl || "", edicao: r.lead?.proposal_edit_url || "", amount: num(r.lead?.amount),
      },
      notes: [
        ...(r.skipped === "pinned" ? ["o deck está fixado à mão (apresentação sob medida): nada foi gerado. Só unpin=true substitui — e o trabalho feito no card se perde."] : []),
        ...(r.skipped === "already_generated" ? ["já existia proposta: use force=true para re-gerar."] : []),
        ...(r.skipped === "no_template" ? ["o produto não tem template de proposta publicado."] : []),
        ...(r.ok ? ["a página é pública e o valor do lead (amount) foi ajustado pelo preço do catálogo."] : []),
      ],
      source: { endpoint: `POST ${base}/proposal` },
    });
  });

  // ── Escrita: sugestão de rotina (UniqueKids) ──────────────────────────────
  tool("lead_routine_suggestion", {
    group: GRUPO,
    title: "Sugestão de rotina (UniqueKids)",
    description: "Gera por IA a sugestão R.O.T.I.N.A. do desafio da família e grava em lead.sugestaoSolucao.",
    write: true, external: true,
    danger: "consome IA paga (Anthropic/OpenRouter) a cada chamada.",
    hint: "só faz sentido em leads com idade/desafio preenchidos; exige IA configurada no servidor.",
    input: { lead_id: z.string() },
  }, async ({ lead_id }) => {
    const lead = await getLead(lead_id);
    const r = await http.post(`/api/leads/${encodeURIComponent(lead.id)}/routine-suggestion`, {}, { timeoutMs: 300_000 });
    return result({
      kind: "pipeline.routine_suggestion",
      title: `Sugestão de rotina · ${lead.name || lead.id}`,
      scope: { saas: lead.saas, lead: lead.id },
      detail: { sugestao: r.sugestao || "", desafio: lead.desafio || "", exemplo: lead.desafio_exemplo || "" },
      notes: ["gravada em lead.sugestaoSolucao — editável depois por lead_update (fields)."],
      source: { endpoint: `POST /api/leads/${lead.id}/routine-suggestion` },
    });
  });

  // ── Configuração do funil ─────────────────────────────────────────────────
  tool("funnel_config", {
    group: GRUPO,
    title: "Funil do produto",
    description: "Lê ou grava o funil do produto: etapas, motivos de perda, próximos passos e perguntas de qualificação.",
    write: true, destructive: true,
    danger: "set_funnel reescreve o funil INTEIRO e migra os cards das etapas renomeadas.",
    hint: "leia com action=get, edite o array devolvido e mande de volta inteiro; renomes vão em `renames` ({'Nome antigo':'Nome novo'}) senão os cards ficam órfãos.",
    input: {
      saas: z.string().optional(),
      action: z.enum(["get", "set_funnel", "set_config"]).optional().describe("Padrão get."),
      funnel: z.array(z.record(z.any())).optional().describe("[{stage, kind, conv, staleDays, cadence:{maxAttempts,retryDays,firstTouchHours}, script}]."),
      renames: z.record(z.string()).optional().describe("{etapa antiga: etapa nova}, migra os cards."),
      loss_reasons: z.array(z.record(z.any())).optional().describe("[{id,label}]."),
      next_steps: z.record(z.any()).optional().describe("{chaveDoRoteiro: [kinds]}."),
      lead_questions: z.array(z.record(z.any())).optional().describe("[{key,label,type,required,options}]."),
      scripts: z.record(z.any()).optional().describe("{chave: roteiro}."),
    },
  }, async ({ saas, action = "get", funnel, renames, loss_reasons, next_steps, lead_questions, scripts }) => {
    const product = await resolveProduct(saas);

    if (action === "set_funnel") {
      if (!Array.isArray(funnel) || !funnel.length) {
        throw new ApiError("action=set_funnel exige o array `funnel` COMPLETO (leia com action=get primeiro).", { status: 400 });
      }
      const invalidos = funnel.filter((f) => f?.kind && !KINDS.includes(f.kind)).map((f) => f.kind);
      if (invalidos.length) throw new ApiError(`kind inválido: ${[...new Set(invalidos)].join(", ")}`, { status: 400, detail: `válidos: ${KINDS.join(", ")}` });
      const r = await http.put(`/api/products/${encodeURIComponent(product.id)}/funnel`, { funnel, ...(renames ? { renames } : {}) });
      return result({
        kind: "pipeline.funnel_set",
        title: `Funil salvo · ${product.name || product.id}`,
        scope: { saas: product.id },
        totals: { etapas: funnel.length, cardsMigrados: r.migrated || 0, renomes: Object.keys(renames || {}).length },
        columns: ["stage", "kind", "conv", "staleDays"],
        rows: funnel.map((f) => ({ stage: f.stage, kind: f.kind || "", conv: f.conv ?? null, staleDays: f.staleDays ?? null })),
        rowsLabel: "Etapas",
        notes: [
          "o servidor grava o array como veio (sem normalizar): linha sem `kind` volta a decidir por heurística de nome.",
          ...(Object.keys(renames || {}).length ? [] : ["nenhum rename informado — se você renomeou alguma etapa, os cards dela ficaram órfãos e caem na primeira coluna."]),
        ],
        source: { endpoint: `PUT /api/products/${product.id}/funnel` },
      });
    }

    if (action === "set_config") {
      const patch = {
        ...(loss_reasons ? { lossReasons: loss_reasons } : {}),
        ...(next_steps ? { nextSteps: next_steps } : {}),
        ...(lead_questions ? { leadQuestions: lead_questions } : {}),
        ...(scripts ? { scripts } : {}),
      };
      if (!Object.keys(patch).length) throw new ApiError("action=set_config exige loss_reasons, next_steps, lead_questions ou scripts.", { status: 400 });
      const p = await http.patch(`/api/products/${encodeURIComponent(product.id)}`, patch);
      return result({
        kind: "pipeline.funnel_config_set",
        title: `Configuração do funil salva · ${product.name || product.id}`,
        scope: { saas: product.id },
        totals: { camposAlterados: Object.keys(patch).join(", "), motivosDePerda: (p.lossReasons || []).length, perguntas: (p.leadQuestions || []).length },
        notes: ["este caminho NÃO migra cards: nunca use para renomear etapa (use action=set_funnel com `renames`)."],
        source: { endpoint: `PATCH /api/products/${product.id}` },
      });
    }

    const leads = await leadsOf(product.id).catch(() => []);
    const contagem = new Map();
    for (const l of leads) contagem.set(l.stage, (contagem.get(l.stage) || 0) + 1);
    const rows = funnelOf(product).map((f, i) => {
      const cad = f.cadence || {};
      return {
        ordem: i + 1,
        stage: f.stage,
        kind: KINDS.includes(f.kind) ? f.kind : `${guessKind(f.stage, i, funnelOf(product).length)} (por heurística: sem kind)`,
        phase: phaseOf(kindOf(product, f.stage)),
        conv: f.conv ?? null,
        staleDays: f.staleDays ?? null,
        maxAttempts: cad.maxAttempts ?? null,
        retryDays: cad.retryDays ?? null,
        firstTouchHours: cad.firstTouchHours ?? null,
        temScript: !!String(f.script || "").trim(),
        cards: contagem.get(f.stage) || 0,
      };
    });
    const orfaos = [...contagem.entries()].filter(([st]) => st && !stageNames(product).includes(st));

    return result({
      kind: "pipeline.funnel",
      title: `Funil · ${product.name || product.id}`,
      scope: { saas: product.id },
      units: UNITS,
      totals: {
        etapas: rows.length,
        semKind: funnelOf(product).filter((f) => !KINDS.includes(f.kind)).length,
        etapaDeGanho: stageByKind(product, "ganho") || "(nenhuma)",
        etapaInicial: firstStage(product) || "(nenhuma)",
        cardsOrfaos: orfaos.reduce((a, [, n]) => a + n, 0),
      },
      columns: ["ordem", "stage", "kind", "phase", "conv", "staleDays", "maxAttempts", "retryDays", "firstTouchHours", "temScript", "cards"],
      rows,
      rowsLabel: "Etapas",
      tables: {
        motivosDePerda: { label: "Motivos de perda", columns: ["id", "label"], rows: lossReasonsOf(product) },
        proximosPassos: {
          label: "Próximos passos por roteiro (Meu dia)",
          columns: ["chave", "destinos"],
          rows: Object.entries(product.nextSteps || {}).map(([chave, v]) => ({ chave, destinos: (Array.isArray(v) ? v : []).join(", ") })),
        },
        perguntas: {
          label: "Perguntas de qualificação (campos do lead)",
          columns: ["key", "label", "type", "required", "opcoes"],
          rows: (product.leadQuestions || []).map((q) => ({ key: q.key, label: q.label || "", type: q.type || "", required: !!q.required, opcoes: (q.options || []).map((o) => o.value).join(", ") })),
        },
      },
      notes: [
        "o kind decide TODO comportamento (fase, cadência, gate de perda, criação de cliente); o nome da etapa é livre.",
        ...(orfaos.length ? [`cards em etapa fora do funil (caem na primeira coluna): ${orfaos.map(([st, n]) => `${st || "(vazio)"}=${n}`).join(", ")}.`] : []),
        ...(Array.isArray(product.lossReasons) && product.lossReasons.length ? [] : ["o produto não tem lossReasons configurados: a lista acima é o padrão do front."]),
      ],
      source: { endpoint: `GET /api/products/${product.id}` },
    });
  });
}
