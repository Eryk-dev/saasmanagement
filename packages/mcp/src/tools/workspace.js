// Espaço de trabalho do time: Tarefas (kanban), Configurações, Análise de
// Equipe, Remuneração, Mapas mentais e a ESCRITA das metas.
//
// É o bloco que o MCP não enxergava de jeito nenhum: `users` está fora do CRUD
// genérico (hash de senha e token de sessão nunca saem pela API), então sem
// tool dedicada o modelo não sabia sequer QUEM é o time — e não conseguia
// traduzir o id de um dono de lead num nome. Aqui isso existe, sempre pela
// projeção pública da API (auth.js publicUser): nenhuma tool devolve
// passwordHash nem refresh token do Google.
//
// A tool mais útil do arquivo não é a mais bonita: `settings_config`. Relatório
// vazio quase nunca é bug — é integração desligada, produto sem conta de
// anúncio ou sem número de WhatsApp. Perguntar isso primeiro economiza meia
// hora de investigação em cima de um número que nunca existiu.

import { z } from "zod";
import { http, ApiError } from "../core/http.js";
import { resolveProduct, listProducts } from "../core/products.js";
import { resolvePeriod, periodInput, today } from "../core/period.js";
import { result } from "../core/envelope.js";
import { select, round2, num } from "../core/shape.js";

const GRUPO = "Espaço de trabalho (Tarefas · Equipe · Ajustes)";
const BRL = "BRL";

// Colunas padrão do kanban quando ninguém salvou um board ainda (espelho de
// DEFAULT_COLUMNS em web/src/screens/tasks.jsx).
const DEFAULT_COLUMNS = [
  { key: "todo", name: "A fazer", color: "" },
  { key: "doing", name: "Em andamento", color: "" },
  { key: "done", name: "Concluído", color: "" },
];

// Espelho de SCREEN_IDS (api/src/screens.js) + o rótulo do menu (web/chrome.jsx).
// As duas listas são mantidas na mão lá; aqui é uma terceira cópia SÓ pra
// leitura (auditoria de acesso) — se divergir, o servidor é quem manda.
const SCREENS = {
  overview: "Visão geral", today: "Minhas atividades", training: "Treinamentos",
  pipeline: "Pipeline", outbound: "Outbound", customers: "Clientes", consultas: "Consultas",
  proposals: "Propostas", offers: "Links de pagamento", contracts: "Contratos",
  intform: "Formulário de Integração", agenda: "Agenda", whatsapp: "Inbox",
  social: "Redes sociais", metrics: "Publicidade", landingpages: "Landing pages",
  forms: "Formulários", creative: "Canvas", disparos: "Disparos",
  eloapp: "Análise do App", analise: "Análise de Pace", aquisicao: "Análise de Aquisição",
  calls: "Análise de Pitches", integrations: "Análise de Integração", funcionarios: "Análise de Equipe",
  tasks: "Tarefas", mindmaps: "Mapas mentais", metas: "Metas", remuneracao: "Remuneração",
  expenses: "Financeiro", settings: "Configurações",
};
const SCREEN_IDS = Object.keys(SCREENS);
// Piso por papel e telas universais (screens.js): quem tem o papel alcança a
// tela mesmo sem ela marcada, então a lista crua mente sobre o acesso real.
const ROLE_SCREENS = { closer: ["pipeline", "offers"] };
const UNIVERSAL_SCREENS = ["offers"];
// Onde vaza dinheiro e salário — o que uma auditoria de acesso quer ver primeiro.
const SENSIVEIS = ["remuneracao", "expenses", "customers", "settings"];
const ROLE_TAGS = ["sdr", "closer", "integrator", "social", "admin"];
const NIVEIS = { 1: "Júnior", 2: "Pleno", 3: "Sênior" };

// Plano de remuneração aprovado em 04/08 — espelho do DEFAULT_PLAN de
// web/src/screens/remuneracao.jsx, que por sua vez é espelhado no servidor
// (comp-plan.js) como régua de meta do placar. Vale quando não há doc salvo.
const DEFAULT_PLAN = {
  sdr: {
    levels: [
      { n: 1, fixed: 2200, metaContracts: 20, metaRevenue: 90000, b80: 300, b100: 550, b120: 750, b140: 950 },
      { n: 2, fixed: 2600, metaContracts: 25, metaRevenue: 120000, b80: 450, b100: 750, b120: 1000, b140: 1250 },
      { n: 3, fixed: 3000, metaContracts: 35, metaRevenue: 180000, b80: 650, b100: 1000, b120: 1300, b140: 1600 },
    ],
    notes: "",
  },
  closer: {
    levels: [
      { n: 1, fixed: 3000, fixedPj: 4200, metaContracts: 20, metaRevenue: 90000, b80: 600, b100: 1000, b120: 1500, b140: 2000 },
      { n: 2, fixed: 4000, fixedPj: 5500, metaContracts: 25, metaRevenue: 120000, b80: 1000, b100: 1500, b120: 2100, b140: 2700 },
      { n: 3, fixed: 5500, fixedPj: 7500, metaContracts: 35, metaRevenue: 180000, b80: 1500, b100: 2500, b120: 3700, b140: 4900 },
    ],
    notes: "",
  },
  cs: {
    levels: [
      { n: 1, fixed: 2200, npsBonus: 500, churnBonus: 500 },
      { n: 2, fixed: 2600, npsBonus: 700, churnBonus: 700 },
      { n: 3, fixed: 3000, npsBonus: 1000, churnBonus: 1000 },
    ],
    referralMeeting: 100, referralClosed: 250, npsFloor: 80, churnMax: 15, notes: "",
  },
};

// Bônus de UMA perna (contratos ou receita) — porte fiel de legBonus() da tela
// Remuneração, que hoje só existe no navegador: é DEGRAU, não rampa (110% paga
// o bônus de 100% inteiro), zera abaixo de 80% e não tem teto acima de 140%
// (cada +20% COMPLETO paga o degrau anterior + R$100).
const EPS = 1e-9;
function legBonus(att, b80, b100, b120, b140) {
  if (!Number.isFinite(att) || att < 0.8 - EPS) return 0;
  if (att < 1 - EPS) return b80;
  if (att < 1.2 - EPS) return b100;
  if (att < 1.4 - EPS) return b120;
  const top = Number.isFinite(b140) ? b140 : b120 + (b120 - b100);
  const k = Math.floor((att - 1.4) / 0.2 + EPS);
  if (k <= 0) return top;
  return top + k * (top - b120) + 100 * ((k * (k + 1)) / 2);
}
// Banda ALCANÇADA (a que está pagando): 110% mostra 100%, não "entre 100 e 120".
const bandOf = (att) => (!Number.isFinite(att) || att < 0.8 - EPS ? null : Math.floor((att + EPS) / 0.2) * 20);

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const nome = (p) => p.name || p.id;
// `/api/:collection` devolve array, mas um proxy no meio pode devolver outra
// coisa — e um `.map` num objeto derruba a tool inteira em vez de mostrar zero.
const lista = (x) => (Array.isArray(x) ? x : []);

// ── Kanban: as réguas que só existiam em tasks.jsx ───────────────────────────
const assigneesOf = (t) => t.assignees || (t.assignee ? [t.assignee] : []);
const isDoneColumn = (c) => c.key === "done" || /conclu/i.test(c.name || "");

async function loadBoard() {
  const boards = lista(await http.get("/api/task_boards"));
  const board = boards[0] || null;
  const columns = board?.columns?.length ? board.columns : DEFAULT_COLUMNS;
  return { board, columns };
}

// Card cuja coluna sumiu (board editado) cai na primeira — mesma regra do SPA,
// senão a contagem do MCP não bate com a tela.
const colKeyOf = (t, columns) => (columns.some((c) => c.key === t.column) ? t.column : columns[0].key);

// Coluna por KEY ou por NOME: o modelo escreve "Em andamento", o board guarda "doing".
function resolveColumn(columns, wanted) {
  if (!wanted) return columns[0];
  const alvo = String(wanted).toLowerCase().trim();
  const found = columns.find((c) => String(c.key).toLowerCase() === alvo)
    || columns.find((c) => String(c.name || "").toLowerCase() === alvo);
  if (!found) throw new ApiError(`coluna "${wanted}" não existe`, { status: 400, detail: `colunas: ${columns.map((c) => `${c.key} (${c.name})`).join(", ")}` });
  return found;
}

// A ordem é um float: soltar no fim = maior + 1; soltar antes de um card =
// ponto médio entre ele e o anterior. Essa conta morava só no navegador, e sem
// ela qualquer movimento pelo MCP embaralhava a coluna.
function orderFor(tasks, columns, colKey, beforeId) {
  const inCol = tasks.filter((t) => colKeyOf(t, columns) === colKey)
    .sort((a, b) => (num(a.order) - num(b.order)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  if (!beforeId) return inCol.length ? num(inCol[inCol.length - 1].order) + 1 : 1;
  const idx = inCol.findIndex((t) => t.id === beforeId);
  if (idx < 0) throw new ApiError(`before_task_id "${beforeId}" não está na coluna ${colKey}`, { status: 400 });
  const next = num(inCol[idx].order);
  return idx > 0 ? (num(inCol[idx - 1].order) + next) / 2 : next - 1;
}

// Pessoas por id/nome: o modelo escreve "Leonardo", o card guarda "leonardo".
function resolveUsers(users, wanted) {
  return (wanted || []).map((w) => {
    const alvo = String(w).toLowerCase().trim();
    const u = users.find((x) => x.id.toLowerCase() === alvo) || users.find((x) => String(x.name || "").toLowerCase() === alvo);
    if (!u) throw new ApiError(`pessoa "${w}" não está no time`, { status: 400, detail: `use team_list; disponíveis: ${users.map((x) => x.id).join(", ")}` });
    return u.id;
  });
}

// Telas que a pessoa alcança DE VERDADE (lista + piso do papel + universais).
function effectiveScreens(u) {
  const lista = Array.isArray(u.screens) ? u.screens : [];
  if (!lista.length) return SCREEN_IDS;
  const set = new Set([...lista, ...UNIVERSAL_SCREENS]);
  for (const r of u.roles || []) for (const s of ROLE_SCREENS[r] || []) set.add(s);
  return SCREEN_IDS.filter((s) => set.has(s));
}

export function registerWorkspaceTools(tool) {
  // ── Tarefas ───────────────────────────────────────────────────────────────
  tool("tasks_list", {
    group: GRUPO,
    title: "Quadro de tarefas",
    description: "Kanban do time: cards por coluna, carga por pessoa, atrasados e sem dono.",
    input: {
      saas: z.string().optional().describe("Inclui as tarefas gerais (sem produto)."),
      assignee: z.string().optional().describe("id ou nome."),
      column: z.string().optional().describe("key ou nome."),
      label: z.string().optional().describe("ex.: bug, melhoria."),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      q: z.string().optional(),
      overdue_only: z.boolean().optional().describe("Vencidos e não concluídos."),
      include_done: z.boolean().optional().describe("Padrão true."),
      limit: z.number().int().optional().describe("Padrão 50."),
      offset: z.number().int().optional(),
    },
  }, async ({ saas, assignee, column, label, priority, q, overdue_only, include_done = true, limit = 50, offset = 0 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const [tasks, { board, columns }, users] = await Promise.all([
      http.get("/api/tasks").then(lista),
      loadBoard(),
      http.get("/api/auth/users").then(lista).catch(() => []),
    ]);
    const nomeDe = new Map(users.map((u) => [u.id, u.name || u.id]));
    const alvoPessoa = assignee ? resolveUsers(users, [assignee])[0] : null;
    const alvoColuna = column ? resolveColumn(columns, column).key : null;
    const doneKeys = new Set(columns.filter(isDoneColumn).map((c) => c.key));
    const hoje = today();

    const enriquecidos = tasks.map((t) => {
      const key = colKeyOf(t, columns);
      const col = columns.find((c) => c.key === key);
      const concluida = doneKeys.has(key);
      const pessoas = assigneesOf(t);
      return {
        id: t.id,
        titulo: t.title || "",
        coluna: col?.name || key,
        colunaKey: key,
        concluida,
        responsaveis: pessoas.map((p) => nomeDe.get(p) || p).join(", "),
        prioridade: t.priority || "",
        vence: t.dueDate || "",
        diasAtraso: !concluida && t.dueDate && t.dueDate < hoje
          ? Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${t.dueDate}T12:00:00Z`)) / 86_400_000) : null,
        etiquetas: (t.labels || []).join(", "),
        comentarios: (t.comments || []).length,
        saas: t.saas || "",
        criadoEm: t.createdAt || "",
        ordem: num(t.order),
        _pessoas: pessoas,
        _busca: `${t.title || ""} ${t.description || ""}`,
      };
    }).filter((t) => {
      if (product && t.saas && t.saas !== product.id) return false;
      if (alvoPessoa && !t._pessoas.includes(alvoPessoa)) return false;
      if (alvoColuna && t.colunaKey !== alvoColuna) return false;
      if (label && !t.etiquetas.toLowerCase().split(", ").includes(String(label).toLowerCase())) return false;
      if (priority && t.prioridade !== priority) return false;
      if (!include_done && t.concluida) return false;
      if (overdue_only && t.diasAtraso == null) return false;
      if (q && !t._busca.toLowerCase().includes(String(q).toLowerCase())) return false;
      return true;
    });

    const s = select(enriquecidos, { sort: ["colunaKey", "ordem"], limit, offset });
    const rows = s.rows.map(({ _pessoas, _busca, ...r }) => r); // eslint-disable-line no-unused-vars
    const abertas = enriquecidos.filter((t) => !t.concluida);

    return result({
      kind: "workspace.tasks",
      title: `Tarefas${product ? ` · ${nome(product)}` : ""}`,
      scope: { saas: product?.id || null, quadro: board?.name || "(padrão)" },
      units: { diasAtraso: "d" },
      totals: {
        cards: enriquecidos.length,
        abertos: abertas.length,
        concluidos: enriquecidos.length - abertas.length,
        atrasados: enriquecidos.filter((t) => t.diasAtraso != null).length,
        semResponsavel: abertas.filter((t) => !t.responsaveis).length,
        P0: abertas.filter((t) => t.prioridade === "P0").length,
        P1: abertas.filter((t) => t.prioridade === "P1").length,
        P2: abertas.filter((t) => t.prioridade === "P2").length,
      },
      columns: ["id", "titulo", "coluna", "responsaveis", "prioridade", "vence", "diasAtraso", "etiquetas", "comentarios", "saas"],
      rows,
      rowsLabel: "Cards",
      page: s.page,
      tables: {
        colunas: {
          label: "Colunas do quadro",
          columns: ["key", "name", "cards", "concluida"],
          rows: columns.map((c) => ({
            key: c.key, name: c.name,
            cards: enriquecidos.filter((t) => t.colunaKey === c.key).length,
            concluida: isDoneColumn(c),
          })),
        },
        porResponsavel: {
          label: "Carga por pessoa (só cards abertos)",
          columns: ["pessoa", "abertos", "atrasados", "P0"],
          rows: [...new Set(abertas.flatMap((t) => (t._pessoas.length ? t._pessoas : ["(sem dono)"])))].map((id) => {
            const meus = abertas.filter((t) => (t._pessoas.length ? t._pessoas : ["(sem dono)"]).includes(id));
            return {
              pessoa: nomeDe.get(id) || id,
              abertos: meus.length,
              atrasados: meus.filter((t) => t.diasAtraso != null).length,
              P0: meus.filter((t) => t.prioridade === "P0").length,
            };
          }).sort((a, b) => b.abertos - a.abertos),
        },
      },
      notes: [
        "o card não guarda quando mudou de coluna nem quando foi concluído: tempo de ciclo e vazão NÃO são deriváveis daqui.",
        "coluna de conclusão = key `done` ou nome que contenha \"conclu\" (mesma régua da tela).",
      ],
      source: { endpoint: "GET /api/tasks + /api/task_boards" },
    });
  });

  tool("task_get", {
    group: GRUPO,
    title: "Um card do quadro",
    description: "Um card inteiro, com anexo e comentários.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const [t, { columns }, users] = await Promise.all([
      http.get(`/api/tasks/${encodeURIComponent(id)}`),
      loadBoard(),
      http.get("/api/auth/users").then(lista).catch(() => []),
    ]);
    const nomeDe = new Map(users.map((u) => [u.id, u.name || u.id]));
    const key = colKeyOf(t, columns);
    return result({
      kind: "workspace.task",
      title: t.title || id,
      scope: { id, saas: t.saas || "(geral)" },
      totals: {
        coluna: columns.find((c) => c.key === key)?.name || key,
        colunaKey: key,
        prioridade: t.priority || null,
        vence: t.dueDate || null,
        responsaveis: assigneesOf(t).map((p) => nomeDe.get(p) || p).join(", ") || null,
        etiquetas: (t.labels || []).join(", ") || null,
        criadoEm: t.createdAt || null,
        anexo: t.photo || null,
      },
      detail: { descricao: t.description || "" },
      tables: {
        comentarios: {
          label: "Comentários",
          columns: ["at", "author", "text"],
          rows: t.comments || [],
        },
      },
      source: { endpoint: `GET /api/tasks/${id}` },
    });
  });

  tool("task_create", {
    group: GRUPO,
    title: "Criar tarefa",
    description: "Cria um card no quadro do time, no fim da coluna.",
    write: true,
    input: {
      title: z.string(),
      description: z.string().optional(),
      saas: z.string().optional().describe("Vazio = tarefa geral."),
      assignees: z.array(z.string()).optional().describe("ids ou nomes."),
      column: z.string().optional().describe("key ou nome. Padrão: a primeira."),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      due_date: z.string().optional().describe("YYYY-MM-DD."),
      labels: z.array(z.string()).optional(),
      photo_url: z.string().optional().describe("Já subido: /public/tasks/…."),
    },
  }, async ({ title, description, saas, assignees, column, priority, due_date, labels, photo_url }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const [tasks, { columns }, users] = await Promise.all([
      http.get("/api/tasks").then(lista), loadBoard(), http.get("/api/auth/users").then(lista).catch(() => []),
    ]);
    const col = resolveColumn(columns, column);
    const criado = await http.post("/api/tasks", defined({
      title,
      description,
      saas: product?.id ?? "",
      assignees: assignees ? resolveUsers(users, assignees) : undefined,
      column: col.key,
      priority,
      dueDate: due_date,
      labels,
      photo: photo_url,
      order: orderFor(tasks, columns, col.key, null),
      createdAt: new Date().toISOString(),
    }));
    return result({
      kind: "workspace.task_created",
      title: `Tarefa criada: ${criado.title}`,
      scope: { id: criado.id },
      totals: { id: criado.id, coluna: col.name, saas: criado.saas || "(geral)", prioridade: criado.priority || null, vence: criado.dueDate || null },
      source: { endpoint: "POST /api/tasks" },
    });
  });

  tool("task_update", {
    group: GRUPO,
    title: "Editar tarefa",
    description: "Edita campos de um card e/ou acrescenta comentário; trocar de coluna é task_move.",
    write: true,
    hint: "arrays (assignees, labels) SUBSTITUEM o valor atual — leia com task_get antes de mandar a lista.",
    input: {
      id: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      saas: z.string().optional().describe("Produto, ou \"\" para tornar geral."),
      assignees: z.array(z.string()).optional().describe("Lista COMPLETA (substitui)."),
      priority: z.enum(["P0", "P1", "P2", ""]).optional(),
      due_date: z.string().optional().describe("YYYY-MM-DD, ou \"\" para limpar."),
      labels: z.array(z.string()).optional().describe("Lista COMPLETA (substitui)."),
      comment: z.string().optional().describe("Acrescenta na thread."),
      author: z.string().optional().describe("Padrão \"Claude (MCP)\"."),
    },
  }, async ({ id, title, description, saas, assignees, priority, due_date, labels, comment, author }) => {
    const atual = await http.get(`/api/tasks/${encodeURIComponent(id)}`);
    const users = assignees ? await http.get("/api/auth/users").then(lista).catch(() => []) : [];
    const product = saas ? await resolveProduct(saas) : null;
    const patch = defined({
      title,
      description,
      saas: saas === "" ? "" : product?.id,
      assignees: assignees ? resolveUsers(users, assignees) : undefined,
      priority,
      dueDate: due_date,
      labels,
    });
    // Comentário é PATCH do array INTEIRO (o SPA faz igual): sem ler antes, o
    // envio apagaria a thread toda.
    if (comment) {
      patch.comments = [...(atual.comments || []), {
        id: `c_${Date.now().toString(36)}`,
        author: author || "Claude (MCP)",
        text: comment,
        at: new Date().toISOString(),
      }];
    }
    if (!Object.keys(patch).length) throw new ApiError("nada pra alterar: mande ao menos um campo ou `comment`.", { status: 400 });
    const salvo = await http.patch(`/api/tasks/${encodeURIComponent(id)}`, patch);
    return result({
      kind: "workspace.task_updated",
      title: `Tarefa atualizada: ${salvo.title}`,
      scope: { id },
      totals: {
        camposAlterados: Object.keys(patch).join(", "),
        prioridade: salvo.priority || null,
        vence: salvo.dueDate || null,
        comentarios: (salvo.comments || []).length,
      },
      source: { endpoint: `PATCH /api/tasks/${id}` },
    });
  });

  tool("task_move", {
    group: GRUPO,
    title: "Mover card de coluna",
    description: "Move um card de coluna calculando a posição na fila.",
    write: true,
    input: {
      id: z.string(),
      column: z.string().describe("Destino (key ou nome)."),
      before_task_id: z.string().optional().describe("Insere ANTES dele; omitido = fim."),
    },
  }, async ({ id, column, before_task_id }) => {
    const [tasks, { columns }] = await Promise.all([http.get("/api/tasks").then(lista), loadBoard()]);
    const col = resolveColumn(columns, column);
    const outros = tasks.filter((t) => t.id !== id);
    const order = orderFor(outros, columns, col.key, before_task_id);
    const salvo = await http.patch(`/api/tasks/${encodeURIComponent(id)}`, { column: col.key, order });
    return result({
      kind: "workspace.task_moved",
      title: `Card movido para ${col.name}`,
      scope: { id },
      totals: { id, coluna: col.name, colunaKey: col.key, ordem: round2(order), concluida: isDoneColumn(col), titulo: salvo.title || "" },
      source: { endpoint: `PATCH /api/tasks/${id}` },
    });
  });

  tool("task_delete", {
    group: GRUPO,
    title: "Apagar tarefa",
    description: "Apaga um card do quadro, com os comentários dele.",
    write: true, destructive: true,
    danger: "apaga o card definitivamente — não existe desfazer.",
    input: { id: z.string() },
  }, async ({ id }) => {
    const atual = await http.get(`/api/tasks/${encodeURIComponent(id)}`);
    const r = await http.del(`/api/tasks/${encodeURIComponent(id)}`);
    return result({
      kind: "workspace.task_deleted",
      title: `Tarefa apagada: ${atual.title || id}`,
      totals: { id, ok: !!r?.ok, titulo: atual.title || "", comentariosPerdidos: (atual.comments || []).length },
      source: { endpoint: `DELETE /api/tasks/${id}` },
    });
  });

  tool("task_boards", {
    group: GRUPO,
    title: "Colunas do quadro",
    description: "Lê ou reorganiza as colunas do kanban; a key é estável, renomear NÃO órfã cards.",
    write: true,
    danger: "remover uma coluna joga os cards dela na primeira coluna do quadro.",
    hint: "identifique a coluna por `key` (task_boards action=get mostra todas).",
    input: {
      action: z.enum(["get", "add", "rename", "recolor", "reorder", "remove"]).optional().describe("Padrão get."),
      key: z.string().optional().describe("Coluna alvo."),
      name: z.string().optional().describe("add/rename."),
      color: z.string().optional().describe("Cor oklch; \"\" = nenhuma."),
      to_index: z.number().int().optional().describe("0-based."),
    },
  }, async ({ action = "get", key, name, color, to_index }) => {
    const [tasks, { board, columns }] = await Promise.all([http.get("/api/tasks").then(lista), loadBoard()]);
    const contagem = (k) => tasks.filter((t) => colKeyOf(t, columns) === k).length;

    if (action === "get") {
      return result({
        kind: "workspace.board",
        title: `Quadro · ${board?.name || "(padrão, ainda não salvo)"}`,
        scope: { quadro: board?.id || null },
        totals: { colunas: columns.length, cards: tasks.length, salvo: !!board },
        columns: ["ordem", "key", "name", "color", "cards", "concluida"],
        rows: columns.map((c, i) => ({ ordem: i, key: c.key, name: c.name, color: c.color || "", cards: contagem(c.key), concluida: isDoneColumn(c) })),
        rowsLabel: "Colunas",
        notes: board ? [] : ["nenhum board salvo ainda: essas são as colunas padrão. A primeira edição cria o registro."],
        source: { endpoint: "GET /api/task_boards" },
      });
    }

    let next = [...columns];
    let movidos = 0;
    if (action === "add") {
      if (!name) throw new ApiError("action=add exige `name`.", { status: 400 });
      next.push({ key: `c_${Date.now().toString(36)}`, name, color: color || "" });
    } else {
      if (!key) throw new ApiError(`action=${action} exige \`key\` da coluna.`, { status: 400, detail: `colunas: ${columns.map((c) => c.key).join(", ")}` });
      const i = next.findIndex((c) => c.key === key);
      if (i < 0) throw new ApiError(`coluna "${key}" não existe.`, { status: 400, detail: `colunas: ${columns.map((c) => c.key).join(", ")}` });
      if (action === "rename") {
        if (!name) throw new ApiError("action=rename exige `name`.", { status: 400 });
        next[i] = { ...next[i], name };
      } else if (action === "recolor") {
        next[i] = { ...next[i], color: color || "" };
      } else if (action === "reorder") {
        if (!Number.isFinite(to_index)) throw new ApiError("action=reorder exige `to_index`.", { status: 400 });
        const [c] = next.splice(i, 1);
        next.splice(Math.max(0, Math.min(to_index, next.length)), 0, c);
      } else if (action === "remove") {
        if (next.length <= 1) throw new ApiError("o quadro precisa de pelo menos uma coluna.", { status: 400 });
        movidos = contagem(key);
        next = next.filter((c) => c.key !== key);
      }
    }

    const salvo = board
      ? await http.patch(`/api/task_boards/${encodeURIComponent(board.id)}`, { columns: next })
      : await http.post("/api/task_boards", { columns: next });

    return result({
      kind: "workspace.board_saved",
      title: `Colunas salvas (${action})`,
      scope: { quadro: salvo.id },
      totals: { colunas: next.length, cardsRealocados: movidos },
      columns: ["ordem", "key", "name", "color", "cards"],
      rows: next.map((c, i) => ({ ordem: i, key: c.key, name: c.name, color: c.color || "", cards: contagem(c.key) })),
      rowsLabel: "Colunas",
      notes: movidos ? [`${movidos} card(s) da coluna removida passam a aparecer na primeira coluna (${next[0].name}).`] : [],
      source: { endpoint: board ? `PATCH /api/task_boards/${board.id}` : "POST /api/task_boards" },
    });
  });

  // ── Equipe e permissões ───────────────────────────────────────────────────
  tool("team_list", {
    group: GRUPO,
    title: "Time, cargos e permissões",
    description: "Quem é o time: papéis, nível, produto e telas que cada um alcança; traduz id → nome.",
    input: {
      role: z.enum([...ROLE_TAGS, "any"]).optional(),
      saas: z.string().optional().describe("Inclui quem não tem escopo."),
      screen: z.string().optional().describe(`Uma tela (${SCREEN_IDS.slice(0, 6).join(", ")}…).`),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ role, saas, screen, q, limit = 100 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const users = lista(await http.get("/api/auth/users"));
    if (screen && !SCREEN_IDS.includes(screen)) {
      throw new ApiError(`tela "${screen}" não existe`, { status: 400, detail: `telas: ${SCREEN_IDS.join(", ")}` });
    }
    const linhas = users.map((u) => {
      const efetivas = effectiveScreens(u);
      const irrestrito = !(u.screens || []).length;
      return {
        id: u.id,
        nome: u.name || u.id,
        papeis: (u.roles || []).join(", "),
        nivel: u.compLevel || 1,
        nivelLabel: NIVEIS[u.compLevel] || NIVEIS[1],
        produto: u.saas || "(todos)",
        irrestrito,
        telas: efetivas.length,
        sensiveis: SENSIVEIS.filter((s) => efetivas.includes(s)).join(", "),
        googleConectado: !!u.googleConnected,
        googleConta: u.googleAccount || "",
        _efetivas: efetivas,
      };
    }).filter((r) => {
      if (role && role !== "any" && !r.papeis.split(", ").includes(role)) return false;
      if (product && r.produto !== "(todos)" && r.produto !== product.id) return false;
      if (screen && !r._efetivas.includes(screen)) return false;
      return true;
    });

    const s = select(linhas, { q, qFields: ["id", "nome"], sort: "nome", limit });
    const rows = s.rows.map(({ _efetivas, ...r }) => r); // eslint-disable-line no-unused-vars

    return result({
      kind: "workspace.team",
      title: "Time do cockpit",
      scope: { saas: product?.id || null, tela: screen || null },
      totals: {
        pessoas: linhas.length,
        irrestritos: linhas.filter((r) => r.irrestrito).length,
        ...Object.fromEntries(ROLE_TAGS.map((r) => [r, linhas.filter((x) => x.papeis.split(", ").includes(r)).length])),
        googleConectados: linhas.filter((r) => r.googleConectado).length,
      },
      columns: ["id", "nome", "papeis", "nivel", "nivelLabel", "produto", "irrestrito", "telas", "sensiveis", "googleConectado"],
      rows,
      rowsLabel: "Pessoas",
      page: s.page,
      tables: {
        acesso: {
          label: "Quem alcança cada tela",
          columns: ["tela", "nome", "pessoas", "sensivel"],
          rows: SCREEN_IDS.map((id) => ({
            tela: id,
            nome: SCREENS[id],
            pessoas: linhas.filter((r) => r._efetivas.includes(id)).map((r) => r.nome).join(", "),
            sensivel: SENSIVEIS.includes(id),
          })),
        },
      },
      notes: [
        "`irrestrito` = lista de telas VAZIA, que no cockpit significa VÊ TUDO (menos Remuneração, que exige etiqueta admin ou concessão explícita).",
        "as telas efetivas somam o piso do papel (closer sempre alcança pipeline e links de pagamento) e as universais (links de pagamento pra todos).",
        "senha e token de sessão nunca saem da API — nem por esta tool nem pelo CRUD genérico (a coleção `users` é privada).",
      ],
      source: { endpoint: "GET /api/auth/users" },
    });
  });

  tool("team_member_update", {
    group: GRUPO,
    title: "Gerir pessoa do time",
    description: "Cria pessoa, muda papéis/nível/produto, concede ou revoga telas, reseta senha ou remove.",
    write: true, destructive: true,
    danger: "cria e reseta credencial de gente de verdade e concede/revoga acesso a telas de salário e financeiro; remover mata as sessões e pode deixar leads sem dono.",
    hint: "screens: [] devolve acesso a TODAS as telas (não é 'nenhuma'). Leia team_list antes: papéis e telas SUBSTITUEM a lista atual.",
    input: {
      action: z.enum(["create", "update", "reset_password", "remove"]),
      id: z.string().optional().describe("Obrigatório fora do create; no create, o login."),
      name: z.string().optional(),
      password: z.string().optional().describe("4+ caracteres."),
      roles: z.array(z.enum(ROLE_TAGS)).optional().describe("Lista COMPLETA (substitui)."),
      saas: z.string().optional().describe("\"\" = todos."),
      screens: z.array(z.string()).optional().describe("Lista COMPLETA; [] = todas."),
      comp_level: z.number().int().optional().describe("1 júnior · 2 pleno · 3 sênior."),
      force: z.boolean().optional().describe("remove: apaga mesmo com leads sob responsabilidade."),
    },
  }, async ({ action, id, name, password, roles, saas, screens, comp_level, force }) => {
    if (action !== "create" && !id) throw new ApiError(`action=${action} exige \`id\` da pessoa (team_list).`, { status: 400 });
    if (screens?.length) {
      const invalidas = screens.filter((s) => !SCREEN_IDS.includes(s));
      if (invalidas.length) throw new ApiError(`tela inválida: ${invalidas.join(", ")}`, { status: 400, detail: `telas: ${SCREEN_IDS.join(", ")}` });
    }
    const escopo = saas ? (await resolveProduct(saas)).id : saas;

    if (action === "remove") {
      const r = await http.del(`/api/auth/users/${encodeURIComponent(id)}${force ? "?force=1" : ""}`);
      return result({
        kind: "workspace.team_removed",
        title: `Pessoa removida do time: ${id}`,
        totals: { id, ok: !!r?.ok, leadsQueEraDona: r?.owned ?? 0 },
        notes: r?.owned ? [`${r.owned} lead(s) ficaram sem essa pessoa como dono/closer/integrador — reatribua no pipeline.`] : [],
        source: { endpoint: `DELETE /api/auth/users/${id}` },
      });
    }

    if (action === "create") {
      if (!name || !password) throw new ApiError("create exige `name` e `password`.", { status: 400 });
      const criado = await http.post("/api/auth/users", defined({ id, name, password, roles, saas: escopo, screens }));
      return result({
        kind: "workspace.team_created",
        title: `Pessoa criada: ${criado.name}`,
        totals: {
          id: criado.id, nome: criado.name, papeis: (criado.roles || []).join(", ") || "(nenhum)",
          produto: criado.saas || "(todos)", telas: (criado.screens || []).length || "todas", nivel: criado.compLevel,
        },
        notes: ["a senha foi definida agora e NÃO aparece em lugar nenhum depois — passe pra pessoa e peça pra trocar."],
        source: { endpoint: "POST /api/auth/users" },
      });
    }

    // update e reset_password batem no mesmo PATCH; separados só pra a intenção
    // ficar explícita na chamada (e o reset não passar despercebido num update).
    const body = action === "reset_password"
      ? { password }
      : defined({ name, roles, saas: escopo, screens, compLevel: comp_level });
    if (action === "reset_password" && !password) throw new ApiError("reset_password exige `password` (4+ caracteres).", { status: 400 });
    if (!Object.keys(body).length) throw new ApiError("nada pra alterar: mande name, roles, saas, screens ou comp_level.", { status: 400 });
    const u = await http.patch(`/api/auth/users/${encodeURIComponent(id)}`, body);
    const efetivas = effectiveScreens(u);
    return result({
      kind: "workspace.team_updated",
      title: action === "reset_password" ? `Senha redefinida: ${u.name}` : `Pessoa atualizada: ${u.name}`,
      scope: { id: u.id },
      totals: {
        campos: Object.keys(body).join(", "),
        papeis: (u.roles || []).join(", ") || "(nenhum)",
        nivel: `${u.compLevel} · ${NIVEIS[u.compLevel] || NIVEIS[1]}`,
        produto: u.saas || "(todos)",
        telas: (u.screens || []).length ? efetivas.length : "todas",
        sensiveis: SENSIVEIS.filter((s) => efetivas.includes(s)).join(", ") || "(nenhuma)",
      },
      notes: action === "reset_password"
        ? ["reset administrativo: não exige a senha antiga e derruba o acesso anterior da pessoa."]
        : (screens && !screens.length ? ["screens vazio = a pessoa volta a ver TODAS as telas."] : []),
      source: { endpoint: `PATCH /api/auth/users/${id}` },
    });
  });

  tool("team_performance", {
    group: GRUPO,
    title: "Análise de Equipe",
    description: "Desempenho por pessoa em cada papel (SDR · closer · CS), destaque e fila de coaching.",
    input: {
      saas: z.string().optional(),
      ...periodInput(z),
      roles: z.array(z.enum(["sdr", "closer", "cs", "social"])).optional().describe("Padrão todos."),
      limit: z.number().int().optional().describe("Por papel (padrão 50)."),
    },
  }, async ({ saas, period, since, until, roles, limit = 50 }) => {
    const product = await resolveProduct(saas);
    const p = resolvePeriod({ period, since, until });
    const d = await http.get(`/api/scoreboard/${encodeURIComponent(product.id)}`, {
      since: p.since, until: p.until, prevSince: p.previous.since, prevUntil: p.previous.until,
    });
    const inc = new Set(roles?.length ? roles : ["sdr", "closer", "cs", "social"]);

    // Junta os papéis numa pessoa só — a mesma pessoa pode ser SDR e closer
    // (buildPeople da tela). Sem isso o "top" e a fila contariam duas vezes.
    const pessoas = new Map();
    for (const papel of ["sdr", "closer", "cs", "social"]) {
      for (const row of d[papel] || []) {
        if (!pessoas.has(row.user)) pessoas.set(row.user, { user: row.user, name: row.name || row.user });
        pessoas.get(row.user)[papel] = row;
      }
    }
    const lista = [...pessoas.values()];

    // Fila de coaching: MESMAS quatro réguas e os mesmos padrões da tela
    // (funcionarios.jsx) — a meta configurada vence, senão o benchmark.
    const coaching = lista.flatMap((x) => [
      x.closer && { metrica: "Conversão na call", valor: x.closer.conversaoCall, meta: x.closer.goals?.conversaoCall?.target || 33, conselho: "revisar ancoragem de preço nas calls" },
      x.sdr && { metrica: "Calls → ganho", valor: x.sdr.callWinRate, meta: x.sdr.goals?.callWinRate?.target || 25, conselho: "apertar o follow-up pós-call" },
      x.sdr && { metrica: "Taxa de agendamento", valor: x.sdr.bookingRate, meta: x.sdr.goals?.bookingRate?.target || 30, conselho: "revisar a abordagem de qualificação" },
      x.cs && { metrica: "Retenção", valor: x.cs.retentionRate, meta: x.cs.goals?.retentionRate?.target || 95, conselho: "revisar os pontos de risco do onboarding" },
    ].filter(Boolean).filter((c) => c.valor != null && c.valor < c.meta)
      .map((c) => ({ pessoa: x.name, ...c, gap: round2(c.meta - c.valor) })))
      .sort((a, b) => b.gap - a.gap);

    // Destaque: mesmo peso da tela (receita fechada + calls agendadas × 100).
    const top = [...lista].sort((a, b) =>
      ((num(b.closer?.revenue) + num(b.sdr?.callsBooked) * 100) - (num(a.closer?.revenue) + num(a.sdr?.callsBooked) * 100)))[0];

    // Cada papel corta pelo MESMO limite e leva o `page` junto: tabela cortada
    // em silêncio vira relatório que esquece metade do time.
    const tables = {};
    const corta = (rows) => select(rows || [], { limit });
    if (inc.has("sdr")) { const s = corta(d.sdr); tables.sdr = { label: "SDR", columns: ["name", "leadsNew", "contacted", "contactRate", "callsBooked", "bookingRate", "showRate", "callWinRate", "won", "revenue", "firstTouchMedianH", "breached"], rows: s.rows, page: s.page }; }
    if (inc.has("closer")) { const s = corta(d.closer); tables.closer = { label: "Closer", columns: ["name", "calls", "callsShown", "won", "lost", "conversaoCall", "revenue", "contracted", "ticket", "cycleDays", "followupNow", "followupWinRate"], rows: s.rows, page: s.page }; }
    if (inc.has("cs")) { const s = corta(d.cs); tables.cs = { label: "CS · integrador", columns: ["name", "activeAccounts", "newAccounts", "churned", "retentionRate", "nps", "upsells", "upsellRevenue", "referrals"], rows: s.rows, page: s.page }; }
    if (inc.has("social")) { const s = corta(d.social); tables.social = { label: "Mídia social", columns: ["name", "postsPerMonth", "storiesPerMonth", "adsPerMonth"], rows: s.rows, page: s.page }; }
    const sc = corta(coaching);
    tables.coaching = { label: "Fila de coaching (maior distância da meta primeiro)", columns: ["pessoa", "metrica", "valor", "meta", "gap", "conselho"], rows: sc.rows, page: sc.page };
    const cortadas = Object.entries(tables).filter(([, t]) => t.page?.truncated).map(([k, t]) => `${k} (${t.page.returned} de ${t.page.total})`);

    return result({
      kind: "workspace.team_performance",
      title: `Análise de Equipe · ${nome(product)}`,
      scope: { saas: product.id },
      period: p,
      units: {
        revenue: BRL, contracted: BRL, ticket: BRL, upsellRevenue: BRL,
        contactRate: "%", bookingRate: "%", showRate: "%", callWinRate: "%",
        conversaoCall: "%", followupWinRate: "%", retentionRate: "%", valor: "%", meta: "%", gap: "%",
        firstTouchMedianH: "h", cycleDays: "d",
      },
      totals: {
        pessoas: lista.length,
        destaque: top?.name || null,
        receitaDoTime: d.team?.revenue ?? null,
        ganhosDoTime: d.team?.won ?? null,
        callsAgendadas: d.team?.callsBooked ?? null,
        abaixoDaMeta: coaching.length,
      },
      tables,
      notes: [
        "a fila de coaching usa a MESMA régua da tela: meta configurada por pessoa/vaga quando existe, senão o benchmark (call→ganho 33%, calls→ganho 25%, agendamento 30%, retenção 95%).",
        "produção de mídia social ainda não tem fonte de dados: posts/stories/ads aparecem zerados, só a meta é real.",
        ...(cortadas.length ? [`tabela(s) cortadas pelo limit=${limit}: ${cortadas.join(", ")} — aumente \`limit\` para o time inteiro.`] : []),
      ],
      source: { endpoint: `GET /api/scoreboard/${product.id}` },
    });
  });

  // ── Remuneração ───────────────────────────────────────────────────────────
  tool("comp_plans", {
    group: GRUPO,
    title: "Plano de remuneração",
    description: "Plano por trilha e nível (fixo, metas, bandas de bônus) e, com o realizado, o pagamento simulado do mês.",
    hint: "dado sensível: a rota /api/comp_plans exige etiqueta admin no cockpit (a chave mestra do MCP passa).",
    input: {
      role: z.enum(["sdr", "closer", "cs", "all"]).optional().describe("Padrão all."),
      level: z.number().int().optional().describe("1..3 (padrão 1)."),
      contracts: z.number().optional().describe("Realizado do mês."),
      revenue: z.number().optional().describe("Realizado do mês em R$."),
      pj: z.boolean().optional().describe("Closer PJ: muda o fixo."),
      cs_referral_meetings: z.number().optional().describe("CS: indicações que só viraram reunião."),
      cs_referrals_closed: z.number().optional().describe("CS: indicações que fecharam."),
      cs_nps_ok: z.boolean().optional().describe("CS: NPS acima do piso."),
      cs_churn_ok: z.boolean().optional().describe("CS: churn abaixo do teto."),
    },
  }, async ({ role = "all", level = 1, contracts, revenue, pj, cs_referral_meetings, cs_referrals_closed, cs_nps_ok, cs_churn_ok }) => {
    const docs = lista(await http.get("/api/comp_plans"));
    const trilhas = role === "all" ? ["sdr", "closer", "cs"] : [role];
    const planoDe = (r) => {
      const doc = docs.find((d) => d && d.role === r);
      const plan = { ...DEFAULT_PLAN[r], ...(doc?.plan || {}) };
      // Doc salvo antes da coluna de 140% herda a extrapolação antiga (b120 + inclinação).
      plan.levels = (plan.levels || []).map((l) => (r !== "cs" && l.b140 == null ? { ...l, b140: num(l.b120) + (num(l.b120) - num(l.b100)) } : l));
      return { plan, salvo: !!doc, docId: doc?.id || null, updatedAt: doc?.updatedAt || null };
    };

    const tables = {};
    for (const r of trilhas) {
      const { plan, salvo } = planoDe(r);
      tables[r] = {
        label: `${r === "cs" ? "Integrador · CS" : r.toUpperCase()}${salvo ? "" : " (padrão da casa — nada salvo)"}`,
        columns: r === "cs"
          ? ["n", "nivel", "fixed", "npsBonus", "churnBonus"]
          : ["n", "nivel", "fixed", "fixedPj", "metaContracts", "metaRevenue", "b80", "b100", "b120", "b140"],
        rows: (plan.levels || []).map((l) => ({ ...l, nivel: NIVEIS[l.n] || "" })),
      };
    }

    // Simulação: só quando o chamador deu um realizado — senão a tool devolve
    // um payout inventado que alguém copia pro relatório.
    let simulacao = null;
    const alvo = role === "all" ? null : role;
    if (alvo && (contracts != null || revenue != null || cs_referral_meetings != null || cs_referrals_closed != null || cs_nps_ok != null || cs_churn_ok != null)) {
      const { plan } = planoDe(alvo);
      const lv = (plan.levels || []).find((l) => Number(l.n) === Number(level)) || (plan.levels || [])[0] || {};
      if (alvo === "cs") {
        const variavel = num(cs_referral_meetings) * num(plan.referralMeeting)
          + num(cs_referrals_closed) * num(plan.referralClosed)
          + (cs_nps_ok ? num(lv.npsBonus) : 0)
          + (cs_churn_ok ? num(lv.churnBonus) : 0);
        simulacao = {
          trilha: alvo, nivel: level, fixo: num(lv.fixed), variavel: round2(variavel), total: round2(num(lv.fixed) + variavel),
          detalhe: `reuniões ${num(cs_referral_meetings)}×${num(plan.referralMeeting)} · fechadas ${num(cs_referrals_closed)}×${num(plan.referralClosed)} · NPS ${cs_nps_ok ? "pago" : "não"} · churn ${cs_churn_ok ? "pago" : "não"}`,
        };
      } else {
        const attC = num(lv.metaContracts) > 0 ? num(contracts) / num(lv.metaContracts) : 0;
        const attR = num(lv.metaRevenue) > 0 ? num(revenue) / num(lv.metaRevenue) : 0;
        const legC = legBonus(attC, num(lv.b80), num(lv.b100), num(lv.b120), num(lv.b140));
        const legR = legBonus(attR, num(lv.b80), num(lv.b100), num(lv.b120), num(lv.b140));
        const fixo = alvo === "closer" && pj ? num(lv.fixedPj) : num(lv.fixed);
        simulacao = {
          trilha: alvo, nivel: level, regime: alvo === "closer" ? (pj ? "PJ" : "CLT") : "—",
          fixo,
          pernaContratos: round2(legC), atingimentoContratos: round2(attC * 100), bandaContratos: bandOf(attC),
          pernaReceita: round2(legR), atingimentoReceita: round2(attR * 100), bandaReceita: bandOf(attR),
          variavel: round2(legC + legR), total: round2(fixo + legC + legR),
        };
      }
    }

    return result({
      kind: "workspace.comp_plans",
      title: "Plano de remuneração",
      units: { fixed: BRL, fixedPj: BRL, metaRevenue: BRL, b80: BRL, b100: BRL, b120: BRL, b140: BRL, npsBonus: BRL, churnBonus: BRL, fixo: BRL, variavel: BRL, total: BRL, pernaContratos: BRL, pernaReceita: BRL, atingimentoContratos: "%", atingimentoReceita: "%", bandaContratos: "%", bandaReceita: "%", csIndicacaoReuniao: BRL, csIndicacaoFechada: BRL },
      totals: {
        trilhasSalvas: docs.filter((d) => d?.role).map((d) => d.role).join(", ") || "(nenhuma — vale o padrão da casa)",
        csIndicacaoReuniao: DEFAULT_PLAN.cs.referralMeeting,
        csIndicacaoFechada: DEFAULT_PLAN.cs.referralClosed,
        ...(simulacao || {}),
      },
      tables,
      notes: [
        "duas pernas SOMAM: contratos e receita são avaliados separados e cada uma paga a banda dela.",
        "a banda é DEGRAU, não rampa: 110% da meta paga o bônus de 100% inteiro; abaixo de 80% a perna zera; acima de 140% cada +20% completo paga o degrau anterior + R$100, sem teto.",
        "o cockpit NÃO calcula sozinho a variável do mês de ninguém: para o realizado use team_performance e traga contracts/revenue aqui.",
      ],
      source: { endpoint: "GET /api/comp_plans" },
    });
  });

  tool("comp_plan_save", {
    group: GRUPO,
    title: "Salvar plano de remuneração",
    description: "Grava o plano de uma trilha; muda o pagamento real e a régua de meta do placar.",
    write: true, destructive: true,
    danger: "é salário: altera o pagamento real e retroage a régua de meta de contratos/receita de todo o placar.",
    hint: "leia comp_plans primeiro e mande o array `levels` COMPLETO — ele substitui o salvo.",
    input: {
      role: z.enum(["sdr", "closer", "cs"]),
      levels: z.array(z.record(z.any())).describe("Níveis COMPLETOS: [{n, fixed, fixedPj, metaContracts, metaRevenue, b80, b100, b120, b140}] (CS: {n, fixed, npsBonus, churnBonus})."),
      referral_meeting: z.number().optional().describe("CS: R$ por indicação que vira reunião."),
      referral_closed: z.number().optional().describe("CS: R$ por indicação que fecha."),
      nps_floor: z.number().optional().describe("CS: piso de NPS do bônus."),
      churn_max: z.number().optional().describe("CS: teto de churn %."),
      notes: z.string().optional().describe("Acordos e exceções."),
    },
  }, async ({ role, levels, referral_meeting, referral_closed, nps_floor, churn_max, notes }) => {
    if (!Array.isArray(levels) || !levels.length) throw new ApiError("`levels` não pode ser vazio (leia comp_plans e edite o array).", { status: 400 });
    const docs = lista(await http.get("/api/comp_plans"));
    const doc = docs.find((d) => d && d.role === role);
    const plan = defined({
      levels,
      referralMeeting: referral_meeting,
      referralClosed: referral_closed,
      npsFloor: nps_floor,
      churnMax: churn_max,
      notes,
    });
    const payload = { role, plan, updatedAt: new Date().toISOString() };
    const salvo = doc?.id
      ? await http.patch(`/api/comp_plans/${encodeURIComponent(doc.id)}`, payload)
      : await http.post("/api/comp_plans", payload);
    return result({
      kind: "workspace.comp_plan_saved",
      title: `Plano salvo · ${role}`,
      scope: { role, doc: salvo.id },
      units: { fixed: BRL, fixedPj: BRL, metaRevenue: BRL, b80: BRL, b100: BRL, b120: BRL, b140: BRL, npsBonus: BRL, churnBonus: BRL },
      totals: { doc: salvo.id, niveis: levels.length, atualizadoEm: payload.updatedAt },
      columns: ["n", "fixed", "metaContracts", "metaRevenue", "b80", "b100", "b120", "b140"],
      rows: levels,
      rowsLabel: "Níveis",
      notes: ["as metas de contratos e receita deste plano viram a meta POR PESSOA no placar, pelo nível de cada um (comp-plan.js)."],
      source: { endpoint: doc?.id ? `PATCH /api/comp_plans/${doc.id}` : "POST /api/comp_plans" },
    });
  });

  // ── Configurações ─────────────────────────────────────────────────────────
  tool("settings_config", {
    group: GRUPO,
    title: "O que está configurado (diagnóstico)",
    description: "Diagnóstico das integrações (Meta, Google, Mercado Pago, IA, WhatsApp, Discord) por produto.",
    external: true,
    input: { saas: z.string().optional().describe("Padrão: todos.") },
  }, async ({ saas }) => {
    const alvo = saas ? await resolveProduct(saas) : null;
    const [boot, produtos, health] = await Promise.all([
      http.get("/api/bootstrap"),
      listProducts({ fresh: true }),
      http.get("/api/health").catch(() => null),
    ]);
    const cfg = boot?.CONFIG || {};
    // O que cada integração desligada ESVAZIA — é a metade da resposta que
    // "configurada: não" não dá.
    const linhas = [
      { integracao: "Meta (anúncios)", configurada: !!cfg.meta?.configured, conectada: null, detalhe: "META_ACCESS_TOKEN", esvazia: "gasto, CPL e todo o relatório de Publicidade (ads_report)" },
      { integracao: "Google (agenda/Meet/e-mail)", configurada: !!cfg.google?.configured, conectada: !!cfg.google?.connected, detalhe: [cfg.google?.account, `calendário ${cfg.google?.meetCalendar || "primary"}`, cfg.google?.gmail ? "gmail ok" : "gmail não"].filter(Boolean).join(" · "), esvazia: "link do Meet nas calls, espelho da agenda e o e-mail dos disparos" },
      { integracao: "Mercado Pago", configurada: !!cfg.mp?.configured, conectada: null, detalhe: cfg.mp?.webhook ? "webhook assinado" : "sem webhook secret (o poller de 10 min cobre)", esvazia: "pagamentos recebidos, baixa de fatura e link de cobrança (Financeiro)" },
      // waHealthSummary: `level` ok/warn/danger + mensagens curtas (número
      // sinalizado, template reprovado) — o JSON cru cortado não dizia nada.
      { integracao: "WhatsApp", configurada: !!cfg.whatsapp?.configured, conectada: null, detalhe: [`saúde ${cfg.whatsapp?.health?.level || "?"}`, ...(cfg.whatsapp?.health?.messages || [])].join(" · "), esvazia: "inbox, envio e o SDR automatizado" },
      { integracao: "IA (Anthropic/OpenRouter)", configurada: !!cfg.ai?.configured, conectada: null, detalhe: "", esvazia: "resumo de call, proposta gerada e sugestões de copy" },
      { integracao: "Discord", configurada: !!cfg.discord?.configured, conectada: null, detalhe: "webhook de avisos", esvazia: "avisos de lead novo, proposta vista, churn e dunning" },
      { integracao: "Propostas nativas", configurada: !!(cfg.proposals?.nativeSaas || []).length, conectada: null, detalhe: (cfg.proposals?.nativeSaas || []).join(", "), esvazia: "geração automática de proposta no lead" },
      // `levercopy` é sempre um objeto ({saas, enabled}) — a flag é `enabled`.
      { integracao: "Levercopy", configurada: !!cfg.levercopy?.enabled, conectada: null, detalhe: cfg.levercopy?.saas || "", esvazia: "liberação de acesso do LeverAds" },
    ];

    const alcance = alvo ? produtos.filter((p) => p.id === alvo.id) : produtos;
    const porProduto = alcance.map((p) => ({
      saas: p.id,
      nome: p.name || p.id,
      metaAdAccount: p.metaAdAccount || "",
      metaPixelId: p.metaPixelId || "",
      waPhoneId: p.waPhoneId || "",
      etapasDoFunil: (p.funnel || []).length,
      motivosDePerda: (p.lossReasons || []).length,
      camposCustom: ["deals", "customers", "leads"].reduce((a, k) => a + (p.customFields?.[k] || []).length, 0),
      metaDeCaixaMes: p.monthlyCashTarget ?? null,
      metaDeContratosMes: p.monthlyContractsTarget ?? null,
    }));

    const avisos = [];
    for (const p of porProduto) {
      if (cfg.meta?.configured && !p.metaAdAccount) avisos.push(`${p.saas}: sem conta de anúncio (metaAdAccount) — os números de Publicidade saem zerados.`);
      if (cfg.whatsapp?.configured && !p.waPhoneId) avisos.push(`${p.saas}: sem número de WhatsApp (waPhoneId) — o envio bloqueia em vez de sair pelo número de outro produto.`);
      if (!p.etapasDoFunil) avisos.push(`${p.saas}: funil vazio — o pipeline não tem etapas configuradas.`);
    }

    return result({
      kind: "workspace.settings_config",
      title: "Configuração e integrações",
      scope: { saas: alvo?.id || null },
      totals: {
        api: health?.ok ? "ok" : "sem resposta",
        build: health?.build || null,
        produtos: produtos.length,
        integracoesLigadas: linhas.filter((l) => l.configurada).length,
        integracoesDesligadas: linhas.filter((l) => !l.configurada).map((l) => l.integracao).join(", ") || "(nenhuma)",
      },
      columns: ["integracao", "configurada", "conectada", "detalhe", "esvazia"],
      rows: linhas,
      rowsLabel: "Integrações",
      tables: {
        produtos: {
          label: "Configuração por produto (Ajustes → Integrações)",
          columns: ["saas", "nome", "metaAdAccount", "metaPixelId", "waPhoneId", "etapasDoFunil", "motivosDePerda", "camposCustom", "metaDeCaixaMes", "metaDeContratosMes"],
          units: { metaDeCaixaMes: BRL },
          rows: porProduto,
        },
      },
      notes: [
        "os tokens vivem no ENV do servidor; o que é por produto (conta de anúncio, pixel, número de WhatsApp) se grava com settings_integration_set.",
        ...avisos,
      ],
      source: { endpoint: "GET /api/bootstrap + /api/products + /api/health" },
    });
  });

  tool("settings_integration_set", {
    group: GRUPO,
    title: "Ligar integração do produto",
    description: "Grava no produto a conta de anúncio Meta, o pixel e o número do WhatsApp.",
    write: true, external: false,
    hint: "os tokens globais (META_ACCESS_TOKEN, WHATSAPP_TOKEN…) ficam no env do servidor e NÃO se configuram por aqui.",
    input: {
      saas: z.string().optional(),
      meta_ad_account: z.string().optional().describe("act_1234567890."),
      meta_pixel_id: z.string().optional().describe("Só dígitos."),
      wa_phone_id: z.string().optional().describe("Phone number ID, só dígitos."),
    },
  }, async ({ saas, meta_ad_account, meta_pixel_id, wa_phone_id }) => {
    const product = await resolveProduct(saas);
    const patch = defined({
      metaAdAccount: meta_ad_account === undefined ? undefined : String(meta_ad_account).trim(),
      metaPixelId: meta_pixel_id === undefined ? undefined : String(meta_pixel_id).replace(/\D/g, ""),
      waPhoneId: wa_phone_id === undefined ? undefined : String(wa_phone_id).replace(/\D/g, ""),
    });
    if (!Object.keys(patch).length) throw new ApiError("mande ao menos meta_ad_account, meta_pixel_id ou wa_phone_id.", { status: 400 });
    const p = await http.patch(`/api/products/${encodeURIComponent(product.id)}`, patch);
    return result({
      kind: "workspace.integration_set",
      title: `Integrações do produto salvas · ${nome(product)}`,
      scope: { saas: product.id },
      totals: {
        camposAlterados: Object.keys(patch).join(", "),
        metaAdAccount: p.metaAdAccount || "(vazio)",
        metaPixelId: p.metaPixelId || "(vazio)",
        waPhoneId: p.waPhoneId || "(vazio)",
      },
      notes: ["conta de anúncio recém-ligada não traz histórico sozinha: rode ads_sync para o período que interessa."],
      source: { endpoint: `PATCH /api/products/${product.id}` },
    });
  });

  tool("settings_fields", {
    group: GRUPO,
    title: "Campos custom do produto",
    description: "Lê ou grava os campos custom por entidade (negócios, clientes, leads).",
    write: true,
    hint: "action=set substitui o grupo INTEIRO informado: leia com action=get, edite a lista e mande de volta completa.",
    input: {
      saas: z.string().optional(),
      action: z.enum(["get", "set"]).optional().describe("Padrão get."),
      deals: z.array(z.record(z.any())).optional().describe("[{key,label,type,options[]}] — substitui."),
      customers: z.array(z.record(z.any())).optional().describe("Idem para clientes."),
      leads: z.array(z.record(z.any())).optional().describe("Idem para leads."),
    },
  }, async ({ saas, action = "get", deals, customers, leads }) => {
    const product = await resolveProduct(saas);
    const grupos = ["deals", "customers", "leads"];
    let doc = product;

    if (action === "set") {
      const novos = defined({ deals, customers, leads });
      if (!Object.keys(novos).length) throw new ApiError("action=set exige ao menos um grupo (deals, customers ou leads).", { status: 400 });
      const atual = await http.get(`/api/products/${encodeURIComponent(product.id)}`);
      doc = await http.patch(`/api/products/${encodeURIComponent(product.id)}`, {
        customFields: { ...(atual.customFields || {}), ...novos },
      });
    }

    const rows = grupos.flatMap((g) => (doc.customFields?.[g] || []).map((f) => ({
      entidade: g, key: f.key, label: f.label, tipo: f.type || "text",
      opcoes: (f.options || []).map((o) => (typeof o === "string" ? o : o.value)).join(", "),
    })));

    return result({
      kind: "workspace.settings_fields",
      title: `Campos custom · ${nome(product)}`,
      scope: { saas: product.id, action },
      totals: Object.fromEntries(grupos.map((g) => [g, (doc.customFields?.[g] || []).length])),
      columns: ["entidade", "key", "label", "tipo", "opcoes"],
      rows,
      rowsLabel: "Campos",
      notes: ["a `key` é o que fica gravado no registro: mudar a key de um campo já usado deixa o valor antigo órfão."],
      source: { endpoint: action === "set" ? `PATCH /api/products/${product.id}` : `GET /api/products/${product.id}` },
    });
  });

  // ── Metas (a escrita; a leitura é report_goals) ────────────────────────────
  tool("goals_save", {
    group: GRUPO,
    title: "Salvar metas",
    description: "Grava metas por vaga ou por pessoa e a meta da empresa (caixa, contratos, crescimento e agenda mensal).",
    write: true,
    hint: "meta com target vazio ou <= 0 REMOVE a meta (volta pro benchmark). Métrica ou vaga inválida é ignorada em silêncio pela API — confira `ignorados` no resultado.",
    input: {
      saas: z.string().optional(),
      goals: z.array(z.object({
        scope: z.enum(["role", "user"]).describe("role = a vaga inteira; user = uma pessoa."),
        key: z.string().describe("sdr, closer, integrator, social — ou id da pessoa."),
        metric: z.string().describe("Do catálogo (report_goals lista)."),
        target: z.number().describe("Mensal; 0 ou negativo REMOVE a meta."),
      })).optional().describe("Vazio = só a meta da empresa."),
      cash_target: z.number().optional().describe("Venda do mês em R$; 0 limpa."),
      contracts_target: z.number().optional().describe("0 limpa (vira venda ÷ ticket)."),
      growth_pct: z.number().optional().describe("Sobre o último mês agendado; 0 limpa."),
      months: z.record(z.number()).optional().describe("{\"2026-10\": 150000}; 0 apaga o mês."),
    },
  }, async ({ saas, goals, cash_target, contracts_target, growth_pct, months }) => {
    const product = await resolveProduct(saas);
    const company = defined({ cashTarget: cash_target, contractsTarget: contracts_target, growthPct: growth_pct, months });
    const lista = goals || [];
    if (!lista.length && !Object.keys(company).length) {
      throw new ApiError("nada pra salvar: mande `goals` ou uma meta de empresa (cash_target, contracts_target, growth_pct, months).", { status: 400 });
    }
    const r = await http.put(`/api/metas/${encodeURIComponent(product.id)}`, {
      goals: lista,
      ...(Object.keys(company).length ? { company } : {}),
    });
    const aplicadas = num(r.created) + num(r.updated) + num(r.removed);
    return result({
      kind: "workspace.goals_saved",
      title: `Metas salvas · ${nome(product)}`,
      scope: { saas: product.id },
      totals: {
        criadas: r.created ?? 0,
        atualizadas: r.updated ?? 0,
        removidas: r.removed ?? 0,
        ignorados: Math.max(0, lista.length - aplicadas),
        metaDaEmpresaSalva: !!r.companySaved,
      },
      columns: ["scope", "key", "metric", "target"],
      rows: lista,
      rowsLabel: "Metas enviadas",
      notes: [
        aplicadas < lista.length ? "alguma meta não mexeu em nada: a API descarta métrica fora do catálogo e vaga inexistente sem reclamar (confira os nomes em report_goals), e pedir remoção de meta que não existia também não conta." : null,
        "meta de vaga marcada como \"de time\" é repartida entre as pessoas da vaga no placar; taxa e média valem por pessoa.",
      ].filter(Boolean),
      source: { endpoint: `PUT /api/metas/${product.id}` },
    });
  });

  // ── Feedback (o widget que vive em toda tela) ─────────────────────────────
  tool("feedback_list", {
    group: GRUPO,
    title: "Bugs e melhorias reportados",
    description: "Reportes do widget de feedback: tipo, tela de origem, autor e coluna.",
    input: {
      kind: z.enum(["bug", "melhoria", "any"]).optional().describe("Padrão any."),
      since: z.string().optional().describe("YYYY-MM-DD."),
      open_only: z.boolean().optional().describe("Só não concluídos."),
      limit: z.number().int().optional().describe("Padrão 30."),
      offset: z.number().int().optional(),
    },
  }, async ({ kind = "any", since, open_only, limit = 30, offset = 0 }) => {
    const [tasks, { columns }] = await Promise.all([http.get("/api/tasks").then(lista), loadBoard()]);
    const doneKeys = new Set(columns.filter(isDoneColumn).map((c) => c.key));
    // O contexto (tela + quem reportou) é escrito pelo servidor na ÚLTIMA linha
    // da descrição, não em campo próprio — extrair aqui é o que torna a lista
    // respondível ("de que tela vêm os bugs?").
    const ctx = /Reportado pelo widget de feedback · tela (.+?) · por (.+)$/m;
    const linhas = tasks
      .filter((t) => (t.labels || []).some((l) => l === "bug" || l === "melhoria"))
      .map((t) => {
        const m = ctx.exec(t.description || "");
        const key = colKeyOf(t, columns);
        return {
          id: t.id,
          tipo: (t.labels || []).includes("bug") ? "bug" : "melhoria",
          titulo: t.title || "",
          tela: m?.[1] || "",
          reportadoPor: m?.[2] || "",
          coluna: columns.find((c) => c.key === key)?.name || key,
          concluido: doneKeys.has(key),
          prioridade: t.priority || "",
          anexo: t.photo || "",
          criadoEm: t.createdAt || "",
        };
      })
      .filter((r) => (kind === "any" || r.tipo === kind)
        && (!since || String(r.criadoEm).slice(0, 10) >= since)
        && (!open_only || !r.concluido));

    const s = select(linhas, { sort: "criadoEm:desc", limit, offset });
    const porTela = [...new Set(linhas.map((r) => r.tela || "(sem tela)"))]
      .map((tela) => ({ tela, reportes: linhas.filter((r) => (r.tela || "(sem tela)") === tela).length }))
      .sort((a, b) => b.reportes - a.reportes);

    return result({
      kind: "workspace.feedback",
      title: "Reportes do time (bug e melhoria)",
      totals: {
        reportes: linhas.length,
        bugs: linhas.filter((r) => r.tipo === "bug").length,
        melhorias: linhas.filter((r) => r.tipo === "melhoria").length,
        abertos: linhas.filter((r) => !r.concluido).length,
        concluidos: linhas.filter((r) => r.concluido).length,
      },
      columns: ["id", "tipo", "titulo", "tela", "reportadoPor", "coluna", "prioridade", "criadoEm"],
      rows: s.rows,
      rowsLabel: "Reportes",
      page: s.page,
      tables: { porTela: { label: "De onde vêm os reportes", columns: ["tela", "reportes"], rows: porTela } },
      notes: ["reporte não é coleção própria: é um card do quadro de Tarefas com etiqueta bug/melhoria — use task_get para o texto completo e task_move para mudar o status."],
      source: { endpoint: "GET /api/tasks (etiquetas bug/melhoria)" },
    });
  });

  tool("feedback_send", {
    group: GRUPO,
    title: "Reportar bug ou melhoria",
    description: "Abre um reporte como card no quadro do time (bug = P1, melhoria = P2).",
    write: true,
    input: {
      text: z.string().describe("1ª linha = título do card."),
      kind: z.enum(["bug", "melhoria"]).optional().describe("Padrão bug."),
      screen: z.string().optional().describe("Tela de origem."),
      photo: z.string().optional().describe("Já subido: /public/tasks/…."),
    },
  }, async ({ text, kind = "bug", screen, photo }) => {
    const t = await http.post("/api/feedback", defined({ text, kind, screen, photo }));
    return result({
      kind: "workspace.feedback_sent",
      title: `Reporte aberto: ${t.title}`,
      scope: { id: t.id },
      totals: { id: t.id, tipo: kind, prioridade: t.priority, colunaKey: t.column, criadoEm: t.createdAt },
      notes: ["o autor gravado é quem detém a credencial da chamada — pelo MCP isso aparece como \"API key\", não como uma pessoa do time."],
      source: { endpoint: "POST /api/feedback" },
    });
  });

  // ── Mapas mentais ─────────────────────────────────────────────────────────
  tool("mindmaps_list", {
    group: GRUPO,
    title: "Mapas mentais",
    description: "Mapas mentais do time: nome, produto, tamanho e última mudança.",
    input: {
      saas: z.string().optional().describe("Inclui os sem produto."),
      q: z.string().optional(),
      limit: z.number().int().optional(),
    },
  }, async ({ saas, q, limit = 50 }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const maps = lista(await http.get("/api/mindmaps"));
    const linhas = maps
      .filter((m) => !product || !m.saas || m.saas === product.id)
      .map((m) => ({
        id: m.id, nome: m.name || "(sem nome)", saas: m.saas || "(geral)",
        nos: (m.nodes || []).length, ligacoes: (m.links || []).length,
        criadoEm: m.createdAt || "", atualizadoEm: m.updatedAt || "",
      }));
    const s = select(linhas, { q, qFields: ["nome"], sort: "atualizadoEm:desc", limit });
    return result({
      kind: "workspace.mindmaps",
      title: "Mapas mentais",
      scope: { saas: product?.id || null },
      totals: { mapas: linhas.length, nos: linhas.reduce((a, m) => a + m.nos, 0) },
      columns: ["id", "nome", "saas", "nos", "ligacoes", "criadoEm", "atualizadoEm"],
      rows: s.rows,
      rowsLabel: "Mapas",
      page: s.page,
      source: { endpoint: "GET /api/mindmaps" },
    });
  });

  tool("mindmap_get", {
    group: GRUPO,
    title: "Conteúdo de um mapa mental",
    description: "O mapa como árvore legível (nó, profundidade, pai) e as ligações livres.",
    input: {
      id: z.string(),
      limit: z.number().int().optional().describe("Padrão 200."),
      offset: z.number().int().optional(),
    },
  }, async ({ id, limit = 200, offset = 0 }) => {
    const m = await http.get(`/api/mindmaps/${encodeURIComponent(id)}`);
    const nodes = m.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const depth = (n) => {
      let d = 0;
      let cur = n;
      // Mapa salvo com pai apagado ou ciclo não pode pendurar a leitura.
      while (cur?.parent && byId.has(cur.parent) && d < 50) { cur = byId.get(cur.parent); d++; }
      return d;
    };
    const rows = nodes.map((n) => ({
      id: n.id,
      profundidade: depth(n),
      texto: n.text || "",
      pai: n.parent ? (byId.get(n.parent)?.text || n.parent) : "",
      cor: n.color || "",
    })).sort((a, b) => a.profundidade - b.profundidade || String(a.pai).localeCompare(String(b.pai)));
    // Mapa grande (dezenas de nós) não pode sair pela metade sem avisar.
    const s = select(rows, { limit, offset });
    const sl = select((m.links || []).map((l) => ({ de: byId.get(l.from)?.text || l.from, para: byId.get(l.to)?.text || l.to })), { limit, offset });

    return result({
      kind: "workspace.mindmap",
      title: `Mapa · ${m.name || id}`,
      scope: { id, saas: m.saas || "(geral)" },
      totals: {
        nos: nodes.length,
        ligacoesLivres: (m.links || []).length,
        raizes: nodes.filter((n) => !n.parent || !byId.has(n.parent)).length,
        profundidadeMax: rows.reduce((a, r) => Math.max(a, r.profundidade), 0),
        atualizadoEm: m.updatedAt || null,
      },
      columns: ["profundidade", "texto", "pai", "cor", "id"],
      rows: s.rows,
      rowsLabel: "Nós",
      page: s.page,
      tables: {
        ligacoes: {
          label: "Ligações livres (fora da árvore)",
          columns: ["de", "para"],
          rows: sl.rows,
          page: sl.page,
        },
      },
      source: { endpoint: `GET /api/mindmaps/${id}` },
    });
  });

  tool("mindmap_save", {
    group: GRUPO,
    title: "Criar ou reescrever mapa mental",
    description: "Cria um mapa ou grava nós e ligações de um existente.",
    write: true,
    hint: "`nodes` e `links` SUBSTITUEM o conteúdo do mapa — leia com mindmap_get antes de mandar. x/y são a posição no canvas (a tela reorganiza sozinha se faltarem).",
    input: {
      id: z.string().optional().describe("Omitido = cria um novo."),
      name: z.string().optional(),
      saas: z.string().optional().describe("\"\" = geral."),
      nodes: z.array(z.record(z.any())).optional().describe("Nós COMPLETOS: [{id, text, color, parent, x, y}]."),
      links: z.array(z.record(z.any())).optional().describe("COMPLETAS: [{from, to}]."),
    },
  }, async ({ id, name, saas, nodes, links }) => {
    const product = saas ? await resolveProduct(saas) : null;
    const corpo = defined({
      name,
      saas: saas === "" ? "" : product?.id,
      nodes,
      links,
      updatedAt: new Date().toISOString(),
    });
    let salvo;
    if (id) {
      if (Object.keys(corpo).length <= 1) throw new ApiError("nada pra alterar: mande name, saas, nodes ou links.", { status: 400 });
      salvo = await http.patch(`/api/mindmaps/${encodeURIComponent(id)}`, corpo);
    } else {
      salvo = await http.post("/api/mindmaps", {
        name: name || "Novo mapa",
        saas: product?.id || "",
        nodes: nodes || [],
        links: links || [],
        createdAt: new Date().toISOString(),
      });
    }
    return result({
      kind: "workspace.mindmap_saved",
      title: `Mapa ${id ? "atualizado" : "criado"}: ${salvo.name}`,
      scope: { id: salvo.id, saas: salvo.saas || "(geral)" },
      totals: { id: salvo.id, nos: (salvo.nodes || []).length, ligacoes: (salvo.links || []).length },
      notes: ["nó sem x/y aparece empilhado até alguém abrir a tela e usar \"auto-organizar\" (o layout é calculado no navegador)."],
      source: { endpoint: id ? `PATCH /api/mindmaps/${id}` : "POST /api/mindmaps" },
    });
  });
}
