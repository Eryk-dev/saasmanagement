// Compatibilidade. Estes nomes existiam no MCP antigo e podem estar em uso em
// integrações e conversas salvas; sumir com eles quebraria quem já chama.
// Cada um continua funcionando e a descrição aponta o substituto melhor — é
// como o catálogo envelhece sem quebrar nada.

import { z } from "zod";
import { http } from "../core/http.js";
import { result } from "../core/envelope.js";
import { select } from "../core/shape.js";

// Mapa antigo nome amigável -> coleção. Mantido igual ao de antes de propósito:
// quem chamava `resource:'saas'` continua chamando.
const ALIASES = {
  saas: "products", product: "products", produto: "products", produtos: "products", products: "products",
  lead: "leads", leads: "leads", deal: "leads", deals: "leads", negocio: "leads",
  customer: "customers", customers: "customers", cliente: "customers", clientes: "customers",
  nps: "nps", goal: "goals", goals: "goals", meta: "goals", metas: "goals",
  attention: "attention", atencao: "attention", person: "people", people: "people", pessoa: "people", pessoas: "people",
  leaderboard: "leaderboard_month", leaderboard_month: "leaderboard_month", leaderboard_all: "leaderboard_all",
  form: "forms", forms: "forms", formulario: "forms", formularios: "forms",
  form_submission: "form_submissions", form_submissions: "form_submissions", submission: "form_submissions", submissions: "form_submissions",
  proposal: "proposals", proposals: "proposals", proposta: "proposals", propostas: "proposals",
  proposal_template: "proposal_templates", proposal_templates: "proposal_templates",
  plan: "plans", plans: "plans", plano: "plans", planos: "plans",
  subscription: "subscriptions", subscriptions: "subscriptions", assinatura: "subscriptions", assinaturas: "subscriptions",
  invoice: "invoices", invoices: "invoices", fatura: "invoices", faturas: "invoices",
  ad_insight: "ad_insights", ad_insights: "ad_insights", insights: "ad_insights",
  task: "tasks", tasks: "tasks", tarefa: "tasks", tarefas: "tasks",
  task_board: "task_boards", task_boards: "task_boards", quadro: "task_boards", quadros: "task_boards",
  activity: "activities", activities: "activities", atividade: "activities", atividades: "activities", timeline: "activities",
};

const resolve = (r) => {
  const c = ALIASES[String(r || "").toLowerCase()] || String(r || "").toLowerCase();
  if (!c) throw new Error(`recurso desconhecido: "${r}". Use \`collections_catalog\` para ver as coleções.`);
  return c;
};

export function registerCompatTools(tool) {
  tool("list_records", {
    group: "Compatibilidade",
    title: "Listar registros (antigo)",
    description: "Compatibilidade. Prefira `records_list`, que filtra, ordena, projeta campos e pagina.",
    input: {
      resource: z.string(),
      saas: z.string().optional(),
      band: z.enum(["red", "yellow", "green"]).optional(),
      priority: z.enum(["P0", "P1", "P2"]).optional(),
      scope: z.string().optional(),
      limit: z.number().int().optional().describe("Padrão 50 — o antigo devolvia tudo e estourava a resposta."),
    },
  }, async ({ resource, limit = 50, ...q }) => {
    const collection = resolve(resource);
    const all = await http.get(`/api/${collection}`, q);
    const s = select(all || [], { limit });
    return result({
      kind: "compat.list",
      title: `${collection} (${s.page.total})`,
      scope: { resource: collection },
      rows: s.rows,
      page: s.page,
      source: { endpoint: `GET /api/${collection}` },
    });
  });

  tool("get_record", {
    group: "Compatibilidade",
    title: "Ler registro (antigo)",
    description: "Compatibilidade. Prefira `records_get`.",
    input: { resource: z.string(), id: z.string() },
  }, async ({ resource, id }) => {
    const collection = resolve(resource);
    const item = await http.get(`/api/${collection}/${encodeURIComponent(id)}`);
    return result({ kind: "compat.get", title: `${collection}/${id}`, detail: item, source: { endpoint: `GET /api/${collection}/${id}` } });
  });

  tool("create_record", {
    group: "Compatibilidade",
    title: "Criar registro (antigo)",
    description: "Compatibilidade. Prefira `records_create` ou a tool específica do assunto (lead_create, form_create…).",
    write: true,
    input: { resource: z.string(), data: z.record(z.any()) },
  }, async ({ resource, data }) => {
    const collection = resolve(resource);
    const item = await http.post(`/api/${collection}`, data || {});
    return result({ kind: "compat.create", title: `criado em ${collection}`, detail: item, source: { endpoint: `POST /api/${collection}` } });
  });

  tool("update_record", {
    group: "Compatibilidade",
    title: "Atualizar registro (antigo)",
    description: "Compatibilidade. Prefira `records_update` ou a tool específica do assunto.",
    write: true,
    input: { resource: z.string(), id: z.string(), data: z.record(z.any()) },
  }, async ({ resource, id, data }) => {
    const collection = resolve(resource);
    const item = await http.patch(`/api/${collection}/${encodeURIComponent(id)}`, data || {});
    return result({ kind: "compat.update", title: `atualizado ${collection}/${id}`, detail: item, source: { endpoint: `PATCH /api/${collection}/${id}` } });
  });

  tool("delete_record", {
    group: "Compatibilidade",
    title: "Apagar registro (antigo)",
    description: "Compatibilidade. Prefira `records_delete`.",
    write: true, destructive: true,
    danger: "apaga o registro de verdade.",
    input: { resource: z.string(), id: z.string() },
  }, async ({ resource, id }) => {
    const collection = resolve(resource);
    const r = await http.del(`/api/${collection}/${encodeURIComponent(id)}`);
    return result({ kind: "compat.delete", title: `apagado ${collection}/${id}`, detail: r || { ok: true }, source: { endpoint: `DELETE /api/${collection}/${id}` } });
  });

  tool("portfolio_summary", {
    group: "Compatibilidade",
    title: "Resumo do portfólio (antigo)",
    description: "Compatibilidade. Prefira `report_portfolio`, que traz também o pace do mês por produto.",
    input: {},
  }, async () => {
    const [portfolio, produtos] = await Promise.all([http.get("/api/portfolio"), http.get("/api/products")]);
    return result({
      kind: "compat.portfolio",
      title: "Portfólio",
      units: { mrr: "BRL", arr: "BRL" },
      totals: portfolio || {},
      columns: ["id", "name", "mrr", "mrrDelta", "health", "healthTrend", "nrr", "churnRate"],
      rows: (produtos || []).map((p) => ({ id: p.id, name: p.name, mrr: p.mrr, mrrDelta: p.mrrDelta, health: p.health, healthTrend: p.healthTrend, nrr: p.nrr, churnRate: p.churnRate })),
      rowsLabel: "Produtos",
      source: { endpoint: "GET /api/portfolio" },
    });
  });

  tool("leaderboard", {
    group: "Compatibilidade",
    title: "Ranking (antigo)",
    description: "Ranking gravado nas coleções leaderboard_month/all. Para o desempenho real do time use `report_scoreboard`.",
    input: { scope: z.enum(["month", "all"]).optional() },
  }, async ({ scope = "month" }) => {
    const rows = await http.get("/api/leaderboard", { scope });
    return result({
      kind: "compat.leaderboard",
      title: `Ranking (${scope})`,
      totals: { linhas: (rows || []).length },
      rows: rows || [],
      notes: (rows || []).length ? [] : ["as coleções de ranking estão vazias neste ambiente — o placar calculado vive em `report_scoreboard`."],
      source: { endpoint: "GET /api/leaderboard" },
    });
  });
}
