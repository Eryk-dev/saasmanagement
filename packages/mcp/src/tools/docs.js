// Manual do servidor. Serve pra duas perguntas que aparecem sempre: "o que dá
// pra fazer aqui?" e "por que esse número veio vazio?".
//
// `cockpit_help` existe porque o catálogo ficou grande: em vez do modelo
// caçar a tool certa pelo nome, ele lê um índice por assunto. E `cockpit_health`
// existe porque quase todo relatório vazio é integração desligada, não bug.

import { z } from "zod";
import { http, API_BASE } from "../core/http.js";
import { catalog } from "../core/register.js";
import { result, text } from "../core/envelope.js";

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
  products: "Product", product: "Product", saas: "Product",
  customers: "Customer", customer: "Customer", cliente: "Customer",
  leads: "LeadInput", lead: "LeadInput", negocio: "LeadInput",
  nps: "NpsResponse", goals: "Goal", goal: "Goal", meta: "Goal",
};

export function registerDocsTools(tool) {
  tool("cockpit_help", {
    group: "Manual",
    title: "Índice das tools",
    description: "Índice de tudo que este servidor faz, por assunto, e o formato padrão das respostas. Comece por aqui quando não souber qual tool usar.",
    input: { group: z.string().optional().describe("Nome (ou pedaço) de um grupo. Sem isto, vem só o índice dos grupos.") },
  }, async ({ group }) => {
    const todas = [...catalog.values()];
    const porGrupo = {};
    for (const t of todas) (porGrupo[t.group] = porGrupo[t.group] || []).push(t);

    // Sem grupo pedido, devolve só o ÍNDICE. Despejar as ~200 descrições aqui
    // custava 36 mil caracteres numa resposta que serve só pra escolher o
    // caminho — o detalhe vem na segunda chamada, com o grupo escolhido.
    const alvo = group
      ? Object.keys(porGrupo).filter((g) => g.toLowerCase().includes(String(group).toLowerCase()))
      : [];

    return result({
      kind: "cockpit.help",
      title: alvo.length ? `Tools · ${alvo.join(", ")}` : "O que este MCP faz",
      totals: {
        tools: todas.length,
        grupos: Object.keys(porGrupo).length,
        somenteLeitura: todas.filter((t) => !t.write).length,
        escrita: todas.filter((t) => t.write).length,
      },
      ...(alvo.length ? {} : {
        columns: ["grupo", "tools", "escrevem", "exemplos"],
        rowsLabel: "Grupos",
        rows: Object.entries(porGrupo).map(([g, ts]) => ({
          grupo: g,
          tools: ts.length,
          escrevem: ts.filter((t) => t.write).length,
          exemplos: ts.slice(0, 4).map((t) => t.name).join(", "),
        })),
      }),
      tables: Object.fromEntries(alvo.map((g) => [g, {
        label: g,
        columns: ["name", "description", "escreve", "atencao"],
        rows: porGrupo[g].map((t) => ({ name: t.name, description: t.description, escreve: t.write ? "sim" : "", atencao: t.danger || "" })),
      }])),
      notes: [
        "Formato da resposta: todas as tools de leitura devolvem `totals` (números já somados), `units` (unidade de cada métrica), `period` (janela e fuso), `rows`/`tables` (colunas estáveis) e `page` quando houve corte.",
        "Janela de tempo: use `period` com um preset (last_7d, this_month, last_month, 2026-08…) em vez de calcular datas — o dia do negócio é America/Sao_Paulo.",
        "Receita RECONHECIDA (`revenue`) e valor CONTRATADO (`contracted`, TCV) são coisas diferentes em todo o cockpit. Não some as duas.",
      ],
    });
  });

  tool("cockpit_health", {
    group: "Manual",
    title: "Diagnóstico das integrações",
    description: "O que está configurado e conectado (Meta, Google, Mercado Pago, WhatsApp, IA, Discord) e a saúde da API. Use quando um relatório vier vazio.",
  }, async () => {
    const [health, boot] = await Promise.all([
      http.get("/api/health").catch((e) => ({ ok: false, erro: e.message })),
      http.get("/api/bootstrap").catch(() => null),
    ]);
    const cfg = boot?.CONFIG || {};
    const linha = (nome, obj) => ({
      integracao: nome,
      configurada: obj?.configured ?? (obj ? true : false),
      conectada: obj?.connected ?? null,
      detalhe: [obj?.account, obj?.health, obj?.webhook, obj?.meetCalendar].filter(Boolean).join(" · ") || null,
    });
    return result({
      kind: "cockpit.health",
      title: "Saúde e integrações",
      totals: { api: health?.ok ? "ok" : "falha", base: API_BASE, produtos: boot?.SAAS?.length ?? null },
      columns: ["integracao", "configurada", "conectada", "detalhe"],
      rows: [
        linha("Meta (anúncios)", cfg.meta),
        linha("Google (agenda/meet)", cfg.google),
        linha("Mercado Pago", cfg.mp),
        linha("WhatsApp", cfg.whatsapp),
        linha("IA (Anthropic)", cfg.ai),
        linha("Discord", cfg.discord),
        linha("Propostas nativas", cfg.proposals ? { configured: !!cfg.proposals.nativeSaas } : null),
        linha("Levercopy", cfg.levercopy ? { configured: true } : null),
      ],
      rowsLabel: "Integrações",
      notes: ["Integração não configurada devolve número vazio, não erro — por isso um relatório zerado costuma ser isto, não bug."],
      source: { endpoint: "GET /api/bootstrap" },
    });
  });

  tool("api_overview", {
    group: "Manual",
    title: "Visão geral da API",
    description: "Base da API, autenticação e como um formulário externo entra como lead.",
  }, async () => text(
`# Cockpit · Portfolio OS

- **API:** \`${API_BASE}\` · **Doc:** \`${API_BASE}/api/docs\` · **OpenAPI:** \`${API_BASE}/api/openapi.json\`
- **Auth:** com \`COCKPIT_API_KEY\` definido, TODA rota exige \`x-api-key\` (o MCP já manda a chave mestra).

Este servidor MCP cobre o cockpit inteiro: publicidade (Meta), pipeline, clientes, financeiro,
WhatsApp, redes sociais, formulários, propostas, agenda, tarefas e treinamento.
Comece por \`cockpit_help\`.

**Fluxo de formulário externo:** \`POST /api/leads\` (só \`name\` e \`saas\` obrigatórios) → o lead cai
no funil do produto → a proposta é gerada com \`generate_proposal\`.`));

  tool("connect_a_form", {
    group: "Manual",
    title: "Como conectar um formulário",
    description: "Passo a passo para mandar o envio de um formulário externo para o funil como lead.",
  }, async () => {
    let tabela = "(a API não respondeu o OpenAPI agora)";
    try { tabela = schemaTable((await http.get("/api/openapi.json")).components.schemas.LeadInput); } catch { /* segue sem a tabela */ }
    return text(
`# Conectar um formulário

\`\`\`bash
curl -X POST ${API_BASE}/api/leads -H 'content-type: application/json' \\
  -d '{"name":"Mara Olin","email":"mara@drift.com","company":"Drift","saas":"meusaas","source":"Form · /pricing"}'
\`\`\`

Pelo MCP: \`lead_create\`. Para anexar a proposta depois: \`lead_update\` com \`proposalUrl\`.
Para um formulário HOSPEDADO no cockpit (com página pública e funil medido), use \`form_create\`.

## Campos do lead (LeadInput)
${tabela}`);
  });

  tool("lead_fields", {
    group: "Manual",
    title: "Campos do lead",
    description: "Tabela dos campos aceitos ao criar um lead (LeadInput), com tipo e obrigatoriedade.",
  }, async () => text(`# Campos do lead\n\n${schemaTable((await http.get("/api/openapi.json")).components.schemas.LeadInput)}`));

  tool("resource_schema", {
    group: "Manual",
    title: "Campos de um recurso",
    description: "Campos documentados de um recurso (produto, lead, cliente, NPS, meta), úteis antes de criar ou atualizar.",
    input: { resource: z.string().describe("saas/product, lead, customer, nps, goal") },
  }, async ({ resource }) => {
    const key = RESOURCE_TO_SCHEMA[String(resource || "").toLowerCase()];
    if (!key) return text(`Sem schema documentado para "${resource}". Use \`collections_catalog\` para ver os campos reais de qualquer coleção.`);
    const spec = await http.get("/api/openapi.json");
    return text(`# Schema: ${key}\n\n${schemaTable(spec.components.schemas[key])}`);
  });

  tool("list_endpoints", {
    group: "Manual",
    title: "Endpoints da API",
    description: "Todas as rotas REST da API (método, caminho, resumo). Só para integrar por fora do MCP.",
    input: { filter: z.string().optional().describe("Filtra por trecho do caminho (ex.: marketing).") },
  }, async ({ filter }) => {
    const spec = await http.get("/api/openapi.json");
    const rows = [];
    for (const [path, ops] of Object.entries(spec.paths || {})) {
      if (filter && !path.includes(filter)) continue;
      for (const [m, op] of Object.entries(ops)) {
        if (m === "parameters") continue;
        rows.push({ metodo: m.toUpperCase(), rota: path, auth: op.security ? "chave" : "—", resumo: op.summary || "" });
      }
    }
    return result({
      kind: "cockpit.endpoints",
      title: "Endpoints da API",
      totals: { rotas: rows.length },
      columns: ["metodo", "rota", "auth", "resumo"],
      rows,
      source: { endpoint: "GET /api/openapi.json" },
    });
  });

  tool("openapi_spec", {
    group: "Manual",
    title: "OpenAPI (JSON)",
    description: "Documento OpenAPI completo, para gerar client ou importar no Postman.",
  }, async () => text(JSON.stringify(await http.get("/api/openapi.json"), null, 1)));
}
