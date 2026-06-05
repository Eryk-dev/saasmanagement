// OpenAPI 3 — documentação da API do Cockpit.
// Servida em GET /api/openapi.json e renderizada (Redoc) em GET /api/docs.
// É a fonte da verdade da doc: o servidor MCP também a consome como "manual".
//
// Caso de uso principal: seus FORMULÁRIOS externos enviam um POST /api/leads e os
// campos caem nos lugares certos do lead (veja o schema LeadInput, bem anotado).

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Cockpit · Portfolio OS — API",
    version: "1.0.0",
    description:
      "Plano de dados do Cockpit. Seus SaaS e formulários integram por aqui (REST). " +
      "Leituras são abertas; escritas (POST/PATCH/DELETE) exigem o header `x-api-key` " +
      "**se** `COCKPIT_API_KEY` estiver definido no servidor.\n\n" +
      "**Conectar um formulário:** aponte o submit do form para `POST /api/leads` " +
      "(ou um middleware seu que faça isso) e mapeie os campos conforme o schema " +
      "`LeadInput`. O lead entra no funil do SaaS indicado em `saas`. Depois que sua " +
      "proposta for gerada, grave o link no lead com `PATCH /api/leads/{id}` no campo " +
      "`proposalUrl`.",
  },
  servers: [{ url: "/", description: "Mesmo host (em produção, atrás do nginx/seu proxy)" }],
  tags: [
    { name: "Leads", description: "Entrada de formulários e worklist de SDR" },
    { name: "Produtos", description: "Seus SaaS (métricas, funil, saúde)" },
    { name: "Clientes", description: "Contas, saúde, renovação" },
    { name: "Pipeline", description: "Deals" },
    { name: "NPS", description: "Respostas de NPS" },
    { name: "Metas", description: "Goals / pacing" },
    { name: "Sistema", description: "Saúde, bootstrap, agregados" },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      LeadInput: {
        type: "object",
        required: ["name", "saas"],
        description: "O que um formulário envia. Só `name` e `saas` são obrigatórios; o resto tem default.",
        properties: {
          name: { type: "string", description: "Nome do contato (do form).", example: "Mara Olin" },
          email: { type: "string", format: "email", description: "E-mail do contato.", example: "mara@drift.com" },
          phone: { type: "string", description: "Telefone/WhatsApp.", example: "+55 11 99999-0000" },
          company: { type: "string", description: "Empresa.", example: "Drift Robotics" },
          message: { type: "string", description: "Texto livre do formulário (mensagem/observação).", example: "Quero uma demo para 200 vagas." },
          saas: { type: "string", description: "**id do produto/funil** em que o lead entra (ex.: o id retornado por /api/products).", example: "meusaas" },
          stage: { type: "string", description: "Estágio inicial no funil. Vazio = primeiro estágio do funil daquele SaaS.", example: "Prospect" },
          owner: { type: "string", description: "Código do responsável (round-robin feito do seu lado).", example: "JC" },
          priority: { type: "string", enum: ["P0", "P1", "P2"], description: "Urgência. Default P2.", example: "P0" },
          score: { type: "number", minimum: 0, maximum: 100, description: "Lead score 0–100.", example: 92 },
          icp: { type: "number", minimum: 0, maximum: 1, description: "Aderência ao ICP (0–1).", example: 0.95 },
          source: { type: "string", description: "Origem (ex.: 'Form · /pricing', 'Webinar', 'Inbound').", example: "Form · LP /pricing" },
          value: { type: "string", description: "Faixa de ticket (livre): Ent | Mid | SMB.", example: "Ent" },
          reason: { type: "string", description: "Por que é relevante (aparece no card).", example: "Enterprise · 200+ funcionários · bate com o ICP" },
          utm: {
            type: "object",
            description: "Parâmetros de campanha capturados no form.",
            properties: {
              source: { type: "string", example: "google" },
              medium: { type: "string", example: "cpc" },
              campaign: { type: "string", example: "pricing-q2" },
              term: { type: "string" },
              content: { type: "string" },
            },
          },
          proposalUrl: { type: "string", format: "uri", description: "Link da proposta gerada externamente (grave via PATCH depois de gerar).", example: "https://propostas.seudominio.com/p/abc123" },
          createdAt: { type: "string", description: "Timestamp ISO (opcional).", example: "2026-05-28T17:00:00Z" },
        },
      },
      Lead: {
        allOf: [
          { type: "object", properties: {
            id: { type: "string", description: "Gerado se omitido.", example: "le_k9f2a" },
            proposta_id: { type: "string", description: "id da proposta gerada no Levercopy (preenchido pela integração).", example: "pr_abc123" },
            proposal_edit_url: { type: "string", format: "uri", description: "Link de edição da proposta no Levercopy (com token).", example: "https://leverads.com.br/proposta/pr_abc123/edit?k=tok" },
          } },
          { $ref: "#/components/schemas/LeadInput" },
        ],
      },
      Product: {
        type: "object",
        required: ["name"],
        description: "Um SaaS do portfólio. Campos não enviados ganham defaults seguros.",
        properties: {
          id: { type: "string", example: "meusaas" },
          name: { type: "string", example: "Meu SaaS" },
          tag: { type: "string", example: "descrição curta do produto" },
          plan: { type: "string", example: "Enterprise" },
          motion: { type: "string", example: "Liderado por vendas" },
          mrr: { type: "number", description: "MRR (em R$).", example: 184200 },
          mrrDelta: { type: "number", description: "Variação MoM do MRR (R$).", example: 12400 },
          arr: { type: "number", example: 2210400 },
          nrr: { type: "number", description: "Net Revenue Retention (ex.: 1.18 = 118%).", example: 1.18 },
          grr: { type: "number", example: 0.94 },
          churnRate: { type: "number", description: "Churn mensal de logos (0–1).", example: 0.011 },
          activation: { type: "number", description: "Taxa de ativação (0–1).", example: 0.71 },
          nps: { type: "number", example: 47 },
          health: { type: "number", minimum: 0, maximum: 100, example: 81 },
          healthTrend: { type: "string", enum: ["improving", "stable", "worsening"], example: "improving" },
          customers: { type: "number", example: 412 },
          winRate: { type: "number", description: "Taxa de win (0–1).", example: 0.27 },
          tcv: { type: "number", description: "TCV do pipeline (R$).", example: 1640000 },
          acv: { type: "number", example: 48200 },
          cycleDays: { type: "number", example: 78 },
          funnel: {
            type: "array",
            description: "Estágios do funil (você define por SaaS).",
            items: {
              type: "object",
              properties: {
                stage: { type: "string", example: "Discovery" },
                count: { type: "number", example: 73 },
                conv: { type: "number", description: "Conversão do estágio anterior (0–1).", example: 0.38 },
                flag: { type: "string", enum: ["bottleneck", "regression"], description: "Marca gargalo/regressão (opcional)." },
              },
            },
          },
          nnm: {
            type: "object",
            description: "Net New MRR (R$) — waterfall do mês.",
            properties: {
              new: { type: "number" }, expansion: { type: "number" },
              contraction: { type: "number" }, churn: { type: "number" },
            },
          },
          mrrSeries: { type: "array", items: { type: "number" }, description: "Série diária de MRR (R$k) p/ o gráfico de trajetória." },
        },
      },
      Customer: {
        type: "object",
        required: ["name", "saas"],
        properties: {
          id: { type: "string" },
          name: { type: "string", example: "Northwind Trading" },
          saas: { type: "string", description: "id do produto.", example: "meusaas" },
          plan: { type: "string", example: "Enterprise" },
          arr: { type: "number", example: 84000 },
          health: { type: "number", minimum: 0, maximum: 100, example: 28 },
          delta: { type: "number", description: "Variação da saúde.", example: -22 },
          usage: { type: "string", description: "Texto de uso (ex.: '−42% s/s', 'estável').", example: "−42% s/s" },
          lastTouch: { type: "string", example: "12d" },
          csm: { type: "string", description: "Código do CSM.", example: "AB" },
          nps: { type: "number", example: 2 },
          renewal: { type: "string", example: "21d" },
          flags: { type: "array", items: { type: "string" }, example: ["renewal-90d", "usage-decay"] },
        },
      },
      Deal: {
        type: "object",
        required: ["title", "saas"],
        properties: {
          id: { type: "string" },
          title: { type: "string", example: "Helios Media" },
          company: { type: "string" },
          saas: { type: "string", description: "id do produto.", example: "meusaas" },
          amount: { type: "number", description: "Valor (R$).", example: 84000 },
          stage: { type: "string", description: "Estágio do funil daquele SaaS.", example: "Prospect" },
          owner: { type: "string", example: "JC" },
          score: { type: "string", enum: ["hot", "warm", "cold"], example: "warm" },
          age: { type: "number", description: "Dias no estágio.", example: 3 },
          source: { type: "string", example: "Outbound" },
          flag: { type: "string", enum: ["stuck"], description: "Marca deal travado." },
        },
      },
      NpsResponse: {
        type: "object",
        required: ["saas", "score"],
        properties: {
          id: { type: "string" },
          saas: { type: "string", example: "meusaas" },
          score: { type: "number", minimum: 0, maximum: 10, example: 9 },
          role: { type: "string", example: "Admin" },
          tags: { type: "array", items: { type: "string" }, example: ["onboarding", "ROI"] },
          text: { type: "string", description: "Verbatim.", example: "ROAS subiu 31% em 6 semanas." },
        },
      },
      Goal: {
        type: "object",
        required: ["scope", "name", "target", "current"],
        properties: {
          id: { type: "string" },
          scope: { type: "string", description: "'Portfolio' ou o nome de um SaaS.", example: "Portfolio" },
          name: { type: "string", example: "MRR" },
          target: { type: "number", example: 450000 },
          current: { type: "number", example: 406980 },
          projected: { type: "number", example: 421000 },
          unit: { type: "string", enum: ["$", "pct", "x", ""], description: "Como formatar (R$, %, multiplicador).", example: "$" },
          band: { type: "string", enum: ["green", "yellow", "red"], example: "yellow" },
          invert: { type: "boolean", description: "true quando menor é melhor (ex.: churn)." },
        },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  paths: {
    "/api/health": {
      get: { tags: ["Sistema"], summary: "Liveness + lista de coleções", responses: { 200: { description: "OK" } } },
    },
    "/api/bootstrap": {
      get: { tags: ["Sistema"], summary: "Tudo que a UI precisa num payload só", responses: { 200: { description: "OK" } } },
    },
    "/api/portfolio": {
      get: { tags: ["Sistema"], summary: "Totais agregados do portfólio (computados dos produtos)", responses: { 200: { description: "OK" } } },
    },
    "/api/leads": {
      get: {
        tags: ["Leads"], summary: "Lista leads (worklist)",
        parameters: [{ name: "priority", in: "query", schema: { type: "string", enum: ["P0", "P1", "P2"] } }],
        responses: { 200: { description: "Lista de leads", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Lead" } } } } } },
      },
      post: {
        tags: ["Leads"],
        summary: "Cria um lead (ENDPOINT DO FORMULÁRIO)",
        description: "Aponte o submit do seu form aqui. Mapeie os campos conforme `LeadInput`. Campos faltantes recebem defaults.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LeadInput" } } } },
        responses: { 201: { description: "Lead criado", content: { "application/json": { schema: { $ref: "#/components/schemas/Lead" } } } }, 401: { description: "x-api-key inválida", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      },
    },
    "/api/leads/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Leads"], summary: "Lê um lead", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Lead" } } } }, 404: { description: "Não encontrado" } } },
      patch: {
        tags: ["Leads"], summary: "Atualiza um lead (ex.: grava proposalUrl)",
        description: "Use para anexar o link da proposta gerada: `{ \"proposalUrl\": \"https://…\" }`. Merge — só os campos enviados mudam.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LeadInput" } } } },
        responses: { 200: { description: "Lead atualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/Lead" } } } } },
      },
      delete: { tags: ["Leads"], summary: "Apaga um lead", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "OK" } } },
    },
    "/api/leads/{id}/proposal": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: {
        tags: ["Leads"],
        summary: "Gera/re-gera a proposta do lead no Levercopy",
        description:
          "Cockpit → Levercopy. Chama o Levercopy pra gerar a proposta dinâmica do lead e grava " +
          "`proposta_id`/`proposalUrl`/`proposal_edit_url`. Vale só pro SaaS `LEVERCOPY_SAAS_ID` e " +
          "requer `LEVERCOPY_API_URL`+`LEVERCOPY_INGEST_KEY` no servidor. **Fail-open:** só 404 (lead " +
          "inexistente) é erro; skip de elegibilidade/idempotência e falha de geração voltam **200** com " +
          "`{ ok:false, skipped|error }`, então nunca quebram a criação do lead.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "auto", in: "query", schema: { type: "string", enum: ["1"] }, description: "Gatilho automático: respeita idempotência (pula se o lead já tem `proposta_id`)." },
          { name: "force", in: "query", schema: { type: "string", enum: ["1"] }, description: "Re-gerar manual: sobrescreve as URLs salvas." },
        ],
        responses: {
          200: { description: "Resultado `{ ok, lead?, skipped?, deduped?, error?, status? }`", content: { "application/json": { schema: { $ref: "#/components/schemas/Lead" } } } },
          404: { description: "Lead não encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/products": {
      get: { tags: ["Produtos"], summary: "Lista produtos", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Product" } } } } } } },
      post: { tags: ["Produtos"], summary: "Cria um SaaS", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } }, responses: { 201: { description: "Criado", content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } } } },
    },
    "/api/products/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Produtos"], summary: "Lê um produto", responses: { 200: { description: "OK" }, 404: { description: "Não encontrado" } } },
      patch: { tags: ["Produtos"], summary: "Atualiza métricas (sync do seu billing/produto)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } }, responses: { 200: { description: "OK" } } },
      delete: { tags: ["Produtos"], summary: "Apaga um produto", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "OK" } } },
    },
    "/api/customers": {
      get: { tags: ["Clientes"], summary: "Lista clientes", parameters: [{ name: "band", in: "query", schema: { type: "string", enum: ["red", "yellow", "green"] } }, { name: "saas", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Customer" } } } } } } },
      post: { tags: ["Clientes"], summary: "Cria/sincroniza um cliente", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/customers/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      patch: { tags: ["Clientes"], summary: "Atualiza um cliente (saúde, uso, renovação)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Customer" } } } }, responses: { 200: { description: "OK" } } },
    },
    "/api/deals": {
      get: { tags: ["Pipeline"], summary: "Lista deals", parameters: [{ name: "saas", in: "query", schema: { type: "string" } }, { name: "stage", in: "query", schema: { type: "string" } }, { name: "owner", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Deal" } } } } } } },
      post: { tags: ["Pipeline"], summary: "Cria um deal", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Deal" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/deals/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      patch: { tags: ["Pipeline"], summary: "Move/atualiza um deal (ex.: { stage })", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Deal" } } } }, responses: { 200: { description: "OK" } } },
    },
    "/api/nps": {
      get: { tags: ["NPS"], summary: "Lista respostas de NPS", parameters: [{ name: "saas", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/NpsResponse" } } } } } } },
      post: { tags: ["NPS"], summary: "Registra uma resposta de NPS", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NpsResponse" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/goals": {
      get: { tags: ["Metas"], summary: "Lista metas", parameters: [{ name: "scope", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Goal" } } } } } } },
      post: { tags: ["Metas"], summary: "Cria uma meta", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Goal" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/leaderboard": {
      get: { tags: ["Sistema"], summary: "Ranking (scope=month|all)", parameters: [{ name: "scope", in: "query", schema: { type: "string", enum: ["month", "all"] } }], responses: { 200: { description: "OK" } } },
    },
  },
};

export const docsHtml = `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <title>Cockpit · API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>body{margin:0}</style>
</head>
<body>
  <redoc spec-url="/api/openapi.json"></redoc>
  <script src="https://cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;
