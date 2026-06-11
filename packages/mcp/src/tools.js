// Tools do MCP do Cockpit. Faz TUDO que a interface faz: criar SaaS, leads,
// deals, clientes, mover deal, editar configuração/funil, ler agregados, etc.
// (CRUD genérico sobre as coleções) — mais as tools de "manual de conexão".
// Toda escrita passa pela API REST (única fonte da verdade).

import { z } from "zod";
import { apiClient, API_BASE } from "./apiClient.js";

const out = (x) => ({ content: [{ type: "text", text: typeof x === "string" ? x : JSON.stringify(x, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Erro: ${e.message || e}` }], isError: true });

// nome amigável -> coleção real
const ALIASES = {
  saas: "products", product: "products", produto: "products", produtos: "products", products: "products",
  lead: "leads", leads: "leads",
  deal: "leads", deals: "leads", negocio: "leads",
  customer: "customers", customers: "customers", cliente: "customers", clientes: "customers",
  nps: "nps",
  goal: "goals", goals: "goals", meta: "goals", metas: "goals",
  attention: "attention", atencao: "attention",
  person: "people", people: "people", pessoa: "people", pessoas: "people",
  leaderboard: "leaderboard_month", leaderboard_month: "leaderboard_month", leaderboard_all: "leaderboard_all",
  form: "forms", forms: "forms", formulario: "forms", formularios: "forms",
  form_submission: "form_submissions", form_submissions: "form_submissions", submission: "form_submissions", submissions: "form_submissions", resposta: "form_submissions", respostas: "form_submissions",
  proposal: "proposals", proposals: "proposals", proposta: "proposals", propostas: "proposals",
  proposal_template: "proposal_templates", proposal_templates: "proposal_templates", template_proposta: "proposal_templates", templates_proposta: "proposal_templates",
  plan: "plans", plans: "plans", plano: "plans", planos: "plans",
  subscription: "subscriptions", subscriptions: "subscriptions", assinatura: "subscriptions", assinaturas: "subscriptions",
  invoice: "invoices", invoices: "invoices", fatura: "invoices", faturas: "invoices",
  ad_insight: "ad_insights", ad_insights: "ad_insights", insights: "ad_insights", campanha: "ad_insights", campanhas: "ad_insights",
  task: "tasks", tasks: "tasks", tarefa: "tasks", tarefas: "tasks",
  task_board: "task_boards", task_boards: "task_boards", quadro: "task_boards", quadros: "task_boards",
};
const COLLECTIONS = "products, customers, leads, nps, goals, attention, people, leaderboard_month, leaderboard_all, forms, form_submissions, proposal_templates, proposals, plans, subscriptions, invoices, tasks, task_boards";
function resolve(r) {
  const c = ALIASES[String(r || "").toLowerCase()];
  if (!c) throw new Error(`Recurso desconhecido: "${r}". Use um de: saas/products, customers, leads, nps, goals, attention, people, leaderboard_month, leaderboard_all, forms, form_submissions.`);
  return c;
}

function schemaTable(schema = {}) {
  const props = schema.properties || {};
  const required = schema.required || [];
  let t = "| campo | tipo | obrigatório | descrição |\n|---|---|---|---|\n";
  for (const [k, v] of Object.entries(props)) {
    const type = v.enum ? v.enum.join(" \\| ") : (v.format || v.type || "object");
    t += `| \`${k}\` | ${type} | ${required.includes(k) ? "**sim**" : "—"} | ${(v.description || "").replace(/\n/g, " ")} |\n`;
  }
  return t;
}
const RESOURCE_TO_SCHEMA = {
  products: "Product", customers: "Customer", leads: "LeadInput",
  nps: "NpsResponse", goals: "Goal",
};

export function registerTools(server) {
  // ════════════════ DADOS (faz tudo que a interface faz) ════════════════

  server.registerTool("portfolio_summary", {
    title: "Resumo do portfólio",
    description: "KPIs do portfólio (MRR, ARR, NRR, clientes) + snapshot por produto. 'Como está meu portfólio?'.",
  }, async () => {
    try {
      const [portfolio, products] = await Promise.all([apiClient.portfolio(), apiClient.list("products")]);
      return out({
        portfolio,
        products: products.map((p) => ({ id: p.id, name: p.name, mrr: p.mrr, mrrDelta: p.mrrDelta, health: p.health, healthTrend: p.healthTrend, nrr: p.nrr, churnRate: p.churnRate })),
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool("list_records", {
    title: "Listar registros",
    description: `Lista registros de uma coleção. resource: saas/products, customers, leads, nps, goals, attention, people, leaderboard_month, leaderboard_all. Filtros opcionais conforme o recurso.`,
    inputSchema: {
      resource: z.string().describe(`Coleção: ${COLLECTIONS} (aceita 'saas' = products)`),
      saas: z.string().optional().describe("filtra customers por produto"),
      stage: z.string().optional().describe("(reservado) filtro por estágio do funil"),
      owner: z.string().optional().describe("(reservado) filtro por responsável"),
      band: z.enum(["red", "yellow", "green"]).optional().describe("filtra customers por banda de saúde"),
      priority: z.enum(["P0", "P1", "P2"]).optional().describe("filtra leads (pipeline) por prioridade"),
      scope: z.string().optional().describe("filtra goals por escopo"),
    },
  }, async ({ resource, ...q }) => {
    try { return out(await apiClient.list(resolve(resource), q)); } catch (e) { return fail(e); }
  });

  server.registerTool("get_record", {
    title: "Ler um registro",
    description: "Lê um registro pelo id.",
    inputSchema: { resource: z.string(), id: z.string() },
  }, async ({ resource, id }) => {
    try { return out(await apiClient.get(resolve(resource), id)); } catch (e) { return fail(e); }
  });

  server.registerTool("create_record", {
    title: "Criar registro (cria SaaS, lead, deal, cliente…)",
    description: `Cria um registro. Para CRIAR UM SAAS use resource='saas' (ou 'products'). Também cria leads (cards do pipeline), customers, nps, goals, attention, people e forms (form builder: { name, saas, status draft|published, theme, welcome, questions[{key,label,type,required,options,to}], thanks, mapping } — página pública em /f/:id). Veja os campos de cada um com a tool resource_schema. Campos faltantes ganham defaults seguros (ex.: produto sem funil/métricas ainda renderiza).`,
    inputSchema: {
      resource: z.string().describe(`Coleção a criar: ${COLLECTIONS} (ou 'saas')`),
      data: z.record(z.any()).describe("Objeto com os campos do registro. Ex. SaaS: { id, name, mrr, arr, health }"),
    },
  }, async ({ resource, data }) => {
    try { return out(await apiClient.create(resolve(resource), data || {})); } catch (e) { return fail(e); }
  });

  server.registerTool("update_record", {
    title: "Atualizar registro (merge)",
    description: "Atualiza campos de um registro (merge — só os campos enviados mudam). Ex.: editar funil/config de um SaaS, anexar proposalUrl num lead, mudar saúde de um cliente, mover um card do pipeline (campo stage).",
    inputSchema: {
      resource: z.string(),
      id: z.string(),
      data: z.record(z.any()).describe("Campos a atualizar"),
    },
  }, async ({ resource, id, data }) => {
    try { return out(await apiClient.update(resolve(resource), id, data || {})); } catch (e) { return fail(e); }
  });

  server.registerTool("delete_record", {
    title: "Apagar registro",
    description: "Apaga um registro pelo id.",
    inputSchema: { resource: z.string(), id: z.string() },
  }, async ({ resource, id }) => {
    try { return out(await apiClient.remove(resolve(resource), id)); } catch (e) { return fail(e); }
  });

  server.registerTool("move_deal", {
    title: "Mover card de estágio",
    description: "Atalho: move um lead/card do pipeline para outro estágio do funil (reflete no kanban na hora).",
    inputSchema: { id: z.string(), stage: z.string().describe("estágio de destino") },
  }, async ({ id, stage }) => {
    try { return out(await apiClient.update("leads", id, { stage })); } catch (e) { return fail(e); }
  });

  server.registerTool("generate_proposal", {
    title: "Gerar proposta de um lead",
    description: "Gera (ou re-gera com force=true) a proposta comercial de um lead. O servidor escolhe o provider: 'native' quando o SaaS do lead tem template de proposta publicado (proposal_templates), senão 'levercopy'. Retorna provider, proposalUrl e proposal_edit_url (link do closer). Idempotente sem force: lead que já tem proposta não re-gera.",
    inputSchema: {
      lead_id: z.string().describe("id do lead (collection leads)"),
      force: z.boolean().optional().describe("true = re-gerar sobrescrevendo a proposta atual"),
    },
  }, async ({ lead_id, force }) => {
    try { return out(await apiClient.generateProposal(lead_id, { force: !!force })); } catch (e) { return fail(e); }
  });

  server.registerTool("leaderboard", {
    title: "Ranking",
    description: "Ranking de vendas/CS. scope 'month' (mensal) ou 'all' (carreira).",
    inputSchema: { scope: z.enum(["month", "all"]).default("month") },
  }, async ({ scope }) => {
    try { return out(await apiClient.leaderboard(scope || "month")); } catch (e) { return fail(e); }
  });

  // ════════════════ MANUAL DE CONEXÃO (documentação) ════════════════

  server.registerTool("api_overview", {
    title: "Visão geral da API",
    description: "Base URL, autenticação, fluxo (form→lead→proposalUrl) e links da doc.",
  }, async () => out(
`# Cockpit · Portfolio OS

- **API:** \`${API_BASE}\`  ·  **Doc:** \`${API_BASE}/api/docs\`  ·  **OpenAPI:** \`${API_BASE}/api/openapi.json\`
- **Auth:** leituras abertas; escritas exigem header \`x-api-key\` se o servidor tiver \`COCKPIT_API_KEY\`.

**Dá pra fazer tudo por aqui:** criar SaaS (create_record resource='saas'), leads (cards do pipeline), clientes,
mover card (move_deal), editar configuração/funil (update_record), ler agregados (portfolio_summary).

**Fluxo de form:** \`create_record(resource:'lead', …)\` → gere a proposta fora → grave o link com
\`update_record(resource:'lead', id, { proposalUrl })\`.`));

  server.registerTool("connect_a_form", {
    title: "Como conectar um formulário",
    description: "Passo a passo de mapear os campos do form para um lead + anexar o link da proposta.",
  }, async () => {
    let table = "(rode com a API no ar para ver a tabela)";
    try { table = schemaTable((await apiClient.openapi()).components.schemas.LeadInput); } catch { /* */ }
    return out(
`# Conectar um formulário

POST \`${API_BASE}/api/leads\` (só \`name\` e \`saas\` obrigatórios) — ou via MCP: \`create_record(resource:'lead', data:{…})\`.

\`\`\`bash
curl -X POST ${API_BASE}/api/leads -H 'content-type: application/json' \\
  -d '{"name":"Mara Olin","email":"mara@drift.com","company":"Drift","saas":"meusaas","source":"Form · /pricing"}'
\`\`\`

Anexar o link da proposta depois: \`update_record(resource:'lead', id:'LEAD_ID', data:{ proposalUrl:'https://…' })\`.

## Campos do lead (LeadInput)
${table}`);
  });

  server.registerTool("lead_fields", {
    title: "Campos do lead",
    description: "Tabela dos campos aceitos no lead (LeadInput).",
  }, async () => {
    try { return out(`# Campos do lead\n\n${schemaTable((await apiClient.openapi()).components.schemas.LeadInput)}`); }
    catch (e) { return fail(e); }
  });

  server.registerTool("resource_schema", {
    title: "Schema de um recurso",
    description: "Campos de um recurso (útil antes de create_record/update_record). resource: saas/product, lead, customer, nps, goal.",
    inputSchema: { resource: z.string() },
  }, async ({ resource }) => {
    try {
      const key = RESOURCE_TO_SCHEMA[resolve(resource)];
      if (!key) return out(`Sem schema documentado para "${resource}".`);
      return out(`# Schema: ${key}\n\n${schemaTable((await apiClient.openapi()).components.schemas[key])}`);
    } catch (e) { return fail(e); }
  });

  server.registerTool("list_endpoints", {
    title: "Lista de endpoints da API",
    description: "Todos os endpoints REST (método, rota, se exige key).",
  }, async () => {
    try {
      const spec = await apiClient.openapi();
      let t = `# Endpoints — \`${API_BASE}\`\n\n| método | rota | auth | resumo |\n|---|---|---|---|\n`;
      for (const [path, ops] of Object.entries(spec.paths))
        for (const [m, op] of Object.entries(ops)) {
          if (m === "parameters") continue;
          t += `| \`${m.toUpperCase()}\` | \`${path}\` | ${op.security ? "🔑" : "—"} | ${op.summary || ""} |\n`;
        }
      return out(t + `\nDoc completa: ${API_BASE}/api/docs`);
    } catch (e) { return fail(e); }
  });

  server.registerTool("openapi_spec", {
    title: "OpenAPI (JSON)",
    description: "Documento OpenAPI completo (para codegen / Postman).",
  }, async () => {
    try { return out(await apiClient.openapi()); } catch (e) { return fail(e); }
  });
}
