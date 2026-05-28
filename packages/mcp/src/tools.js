// MCP = MANUAL DE CONEXÃO. As tools devolvem DOCUMENTAÇÃO (markdown / schema),
// nunca dados de negócio. Quem cria/lê/atualiza dados é a API REST diretamente.
// As tools que dependem do schema leem o /api/openapi.json (a doc), não os dados.

import { z } from "zod";
import { apiDocs, API_BASE } from "./apiClient.js";

const md = (text) => ({ content: [{ type: "text", text }] });
const fail = (e) =>
  md(`⚠️ Não consegui ler a documentação da API em ${API_BASE}.\n` +
     `Confirme que a API está no ar (GET ${API_BASE}/api/health) e tente de novo.\n\n${e.message || e}`);

function schemaTable(schema = {}) {
  const props = schema.properties || {};
  const required = schema.required || [];
  let out = "| campo | tipo | obrigatório | descrição |\n|---|---|---|---|\n";
  for (const [k, v] of Object.entries(props)) {
    const type = v.enum ? v.enum.join(" \\| ") : (v.format || v.type || "object");
    const req = required.includes(k) ? "**sim**" : "—";
    out += `| \`${k}\` | ${type} | ${req} | ${(v.description || "").replace(/\n/g, " ")} |\n`;
  }
  return out;
}

const RESOURCE_TO_SCHEMA = {
  lead: "LeadInput", leads: "LeadInput",
  product: "Product", products: "Product",
  customer: "Customer", customers: "Customer",
  deal: "Deal", deals: "Deal",
  nps: "NpsResponse",
  goal: "Goal", goals: "Goal",
};

export function registerTools(server) {
  // ── Visão geral ────────────────────────────────────────────────────────────
  server.registerTool("api_overview", {
    title: "Visão geral da API",
    description: "Como o Cockpit funciona e como conectar nele. Base URL, autenticação e onde está a doc completa.",
  }, async () => md(
`# Cockpit · Portfolio OS — manual de conexão

Este servidor MCP é um **manual**: ele te diz *como* integrar. **Os dados trafegam pela API REST**, não por aqui.

- **Base da API:** \`${API_BASE}\`
- **Doc interativa (Redoc):** \`${API_BASE}/api/docs\`
- **OpenAPI (máquina):** \`${API_BASE}/api/openapi.json\`
- **Health:** \`${API_BASE}/api/health\`

**Autenticação:** leituras são abertas. Escritas (POST/PATCH/DELETE) exigem o header \`x-api-key\`
**se** o servidor tiver \`COCKPIT_API_KEY\` definido.

**Fluxo típico**
1. Seu formulário envia \`POST /api/leads\` → o lead entra no funil do SaaS (\`saas\`). Use a tool \`connect_a_form\`.
2. Sua proposta é gerada externamente com os dados do form.
3. Você grava o link no lead: \`PATCH /api/leads/{id}\` com \`{ "proposalUrl": "https://..." }\`.

Tools deste manual: \`connect_a_form\`, \`lead_fields\`, \`resource_schema\`, \`list_endpoints\`, \`openapi_spec\`.`));

  // ── Conectar um formulário (a tool principal) ───────────────────────────────
  server.registerTool("connect_a_form", {
    title: "Como conectar um formulário",
    description: "Passo a passo para os campos do seu formulário caírem nos campos certos do lead, e como anexar o link da proposta.",
  }, async () => {
    let table = "(rode novamente com a API no ar para ver a tabela de campos)";
    try { table = schemaTable((await apiDocs.openapi()).components.schemas.LeadInput); } catch { /* sem doc */ }
    return md(
`# Conectar um formulário externo

O submit do seu form (ou um middleware seu) faz **\`POST ${API_BASE}/api/leads\`** com JSON.
Só \`name\` e \`saas\` são obrigatórios — o resto tem default.

## Exemplo
\`\`\`bash
curl -X POST ${API_BASE}/api/leads \\
  -H 'content-type: application/json' \\
  -H 'x-api-key: SUA_KEY' \\   # só se a API exigir
  -d '{
    "name": "Mara Olin",
    "email": "mara@drift.com",
    "company": "Drift Robotics",
    "saas": "meusaas",
    "source": "Form · LP /pricing",
    "message": "Quero uma demo para 200 vagas",
    "utm": { "source": "google", "campaign": "pricing-q2" }
  }'
\`\`\`
A resposta traz o \`id\` do lead criado.

## Anexar o link da proposta (gerada externamente)
\`\`\`bash
curl -X PATCH ${API_BASE}/api/leads/LEAD_ID \\
  -H 'content-type: application/json' \\
  -d '{ "proposalUrl": "https://propostas.seudominio.com/p/abc123" }'
\`\`\`
O link aparece como botão **"proposta ↗"** no card do lead.

## Campos do lead (\`LeadInput\`)
${table}

> Dica: \`saas\` é o **id do produto** (o mesmo id de \`POST /api/products\`). O lead entra no funil daquele SaaS.`);
  });

  // ── Schema de um recurso ────────────────────────────────────────────────────
  server.registerTool("lead_fields", {
    title: "Campos do lead",
    description: "Tabela dos campos aceitos ao criar/atualizar um lead (schema LeadInput).",
  }, async () => {
    try { return md(`# Campos do lead (LeadInput)\n\n${schemaTable((await apiDocs.openapi()).components.schemas.LeadInput)}`); }
    catch (e) { return fail(e); }
  });

  server.registerTool("resource_schema", {
    title: "Schema de um recurso",
    description: "Campos de um recurso da API. resource: lead | product | customer | deal | nps | goal.",
    inputSchema: { resource: z.string().describe("lead | product | customer | deal | nps | goal") },
  }, async ({ resource }) => {
    try {
      const key = RESOURCE_TO_SCHEMA[String(resource || "").toLowerCase()];
      if (!key) return md(`Recurso desconhecido: "${resource}". Use um de: ${Object.keys(RESOURCE_TO_SCHEMA).join(", ")}.`);
      const spec = await apiDocs.openapi();
      return md(`# Schema: ${key}\n\n${schemaTable(spec.components.schemas[key])}`);
    } catch (e) { return fail(e); }
  });

  // ── Endpoints ───────────────────────────────────────────────────────────────
  server.registerTool("list_endpoints", {
    title: "Lista de endpoints",
    description: "Todos os endpoints da API (método, rota, resumo e se exige x-api-key).",
  }, async () => {
    try {
      const spec = await apiDocs.openapi();
      let out = `# Endpoints — base \`${API_BASE}\`\n\n| método | rota | auth | resumo |\n|---|---|---|---|\n`;
      for (const [path, ops] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(ops)) {
          if (method === "parameters") continue;
          const auth = op.security ? "🔑" : "—";
          out += `| \`${method.toUpperCase()}\` | \`${path}\` | ${auth} | ${op.summary || ""} |\n`;
        }
      }
      out += `\nDoc completa: ${API_BASE}/api/docs`;
      return md(out);
    } catch (e) { return fail(e); }
  });

  // ── Spec bruto (para codegen / ferramentas) ─────────────────────────────────
  server.registerTool("openapi_spec", {
    title: "OpenAPI (JSON)",
    description: "Devolve o documento OpenAPI completo (para gerar client, importar no Postman/Insomnia etc.).",
  }, async () => {
    try {
      const spec = await apiDocs.openapi();
      return md(`OpenAPI de ${API_BASE} (também em ${API_BASE}/api/openapi.json):\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``);
    } catch (e) { return fail(e); }
  });
}
