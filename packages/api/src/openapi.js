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
          amount: { type: "number", description: "Valor estimado do negócio (R$) — soma no forecast do pipeline.", example: 84000 },
          reason: { type: "string", description: "Por que é relevante (aparece no card).", example: "Enterprise · 200+ funcionários · bate com o ICP" },
          closer: { type: "string", description: "id do usuário closer responsável (GET /api/auth/users).", example: "leonardo" },
          nextActionAt: { type: "string", description: "Próximo toque no lead (ISO). O servidor preenche/reagenda pela cadência do estágio; envie explícito pra sobrescrever.", example: "2026-07-10T14:00:00Z" },
          nextActionNote: { type: "string", description: "O que fazer no próximo toque.", example: "Cobrar resposta da proposta" },
          lostReason: { type: "string", description: "Motivo de perda (id de product.lossReasons). Mover pra estágio de perda sem enviar → servidor grava 'nao_informado'.", example: "preco" },
          lostNote: { type: "string", description: "Detalhe livre da perda.", example: "Fechou com concorrente X" },
          utm: {
            type: "object",
            description:
              "Parâmetros de campanha capturados no form. Convenção Meta Ads (parâmetros dinâmicos): " +
              "`utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}` " +
              "— a atribuição em /api/marketing casa por id OU nome (campaign ↔ campanha, term ↔ conjunto, content ↔ anúncio).",
            properties: {
              source: { type: "string", example: "meta" },
              medium: { type: "string", example: "paid" },
              campaign: { type: "string", description: "id ou nome da campanha.", example: "120210000000000" },
              term: { type: "string", description: "id ou nome do conjunto (adset).", example: "120210000000001" },
              content: { type: "string", description: "id ou nome do anúncio.", example: "120210000000002" },
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
          mrr: { type: "number", readOnly: true, description: "MRR (em R$). **Calculado** a partir da coleção de clientes (soma do ARR ÷ 12) — ignorado na escrita.", example: 184200 },
          mrrDelta: { type: "number", readOnly: true, description: "Variação MoM do MRR (R$). Calculado/derivado — ignorado na escrita.", example: 12400 },
          arr: { type: "number", readOnly: true, description: "ARR (em R$). **Calculado** a partir da soma do ARR dos clientes — ignorado na escrita.", example: 2210400 },
          nrr: { type: "number", description: "Net Revenue Retention (ex.: 1.18 = 118%).", example: 1.18 },
          grr: { type: "number", example: 0.94 },
          churnRate: { type: "number", description: "Churn mensal de logos (0–1).", example: 0.011 },
          activation: { type: "number", description: "Taxa de ativação (0–1).", example: 0.71 },
          nps: { type: "number", example: 47 },
          health: { type: "number", minimum: 0, maximum: 100, example: 81 },
          healthTrend: { type: "string", enum: ["improving", "stable", "worsening"], example: "improving" },
          customers: { type: "number", readOnly: true, description: "Nº de clientes. **Calculado** contando a coleção de clientes daquele SaaS — ignorado na escrita.", example: 412 },
          winRate: { type: "number", description: "Taxa de win (0–1).", example: 0.27 },
          tcv: { type: "number", description: "TCV do pipeline (R$).", example: 1640000 },
          acv: { type: "number", example: 48200 },
          cycleDays: { type: "number", example: 78 },
          funnel: {
            type: "array",
            description: "Estágios do funil (você define por SaaS). O código decide comportamento pelo `kind`, nunca pelo nome.",
            items: {
              type: "object",
              properties: {
                stage: { type: "string", example: "Call agendada" },
                kind: { type: "string", enum: ["novo", "contato", "qualificacao", "call", "proposta", "followup", "integracao", "ganho", "perdido", "desqualificado", "outro"], description: "Semântica do estágio (fase SDR/Closer, terminais). Ausente = heurística por nome." },
                count: { type: "number", example: 73 },
                conv: { type: "number", description: "Conversão do estágio anterior (0–1).", example: 0.38 },
                cadence: {
                  type: "object",
                  description: "Cadência do GPS: quantos toques, de quanto em quanto tempo, SLA de 1º contato.",
                  properties: {
                    maxAttempts: { type: "number", example: 5 },
                    retryDays: { type: "number", description: "Toque registrado/entrada no estágio → nextActionAt = +N dias.", example: 2 },
                    firstTouchHours: { type: "number", description: "SLA de 1º contato (estágio de entrada).", example: 2 },
                  },
                },
                staleDays: { type: "number", description: "Dias parado no estágio até o card ser marcado.", example: 5 },
                flag: { type: "string", enum: ["bottleneck", "regression"], description: "Marca gargalo/regressão (opcional)." },
              },
            },
          },
          lossReasons: {
            type: "array",
            description: "Motivos de perda do produto (lead.lostReason guarda o id).",
            items: { type: "object", properties: { id: { type: "string", example: "preco" }, label: { type: "string", example: "Preço" } } },
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
      Activity: {
        type: "object",
        required: ["lead"],
        description:
          "Ponto de contato / evento da timeline do lead. Toques (whatsapp/call/email/meeting) atualizam o " +
          "últ. contato do lead, contam tentativa no estágio e re-agendam `nextActionAt` pela cadência " +
          "(envie `meta.reschedule: false` pra registrar sem mexer na agenda). `stage` e `system` são " +
          "gravados automaticamente pelo servidor (movimento de estágio, lead criado, proposta vista/aceita).",
        properties: {
          id: { type: "string", readOnly: true, example: "ac_7f3e…" },
          saas: { type: "string", example: "leverads" },
          lead: { type: "string", description: "id do lead.", example: "le_k9f2a" },
          type: { type: "string", enum: ["note", "whatsapp", "call", "email", "meeting", "stage", "system"], example: "whatsapp" },
          text: { type: "string", description: "Anotação do toque.", example: "Mandei o resumo da proposta" },
          meta: { type: "object", description: "stage: {from, to, lostReason?} · system: {event, …refs}." },
          author: { type: "string", description: "id do usuário (sessão) ou 'api'/'system'/'lead'.", example: "leonardo" },
          at: { type: "string", description: "Quando aconteceu (ISO; backdate permitido).", example: "2026-07-09T15:00:00Z" },
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
      patch: { tags: ["Produtos"], summary: "Atualiza um produto (mrr/arr/customers são calculados dos clientes e ignorados aqui)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } }, responses: { 200: { description: "OK" } } },
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
    "/api/activities": {
      get: {
        tags: ["Leads"], summary: "Timeline (pontos de contato + eventos) — filtre por lead",
        parameters: [
          { name: "lead", in: "query", schema: { type: "string" } },
          { name: "saas", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" } },
          { name: "since", in: "query", schema: { type: "string" }, description: "ISO — só activities com `at` >= since." },
        ],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Activity" } } } } } },
      },
      post: {
        tags: ["Leads"], summary: "Registra um ponto de contato (toque/nota) na timeline do lead",
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Activity" } } } },
        responses: { 201: { description: "Criado", content: { "application/json": { schema: { $ref: "#/components/schemas/Activity" } } } } },
      },
    },
    "/api/funnel/{saas}": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      get: {
        tags: ["Leads"], summary: "Métricas reais do funil (conversão, tempo por etapa, perdas, SLA de 1º toque)",
        description:
          "Derivadas do histórico de transições (activities `stage`) do cohort de leads criados no período. " +
          "Lead sem histórico degrada pra aproximação pelo estágio atual — `coverage` mostra a proporção.",
        parameters: [
          { name: "since", in: "query", schema: { type: "string", example: "2026-06-01" } },
          { name: "until", in: "query", schema: { type: "string", example: "2026-06-30" } },
        ],
        responses: { 200: { description: "{ coverage, stages[], winRate, lossReasons[], firstTouch }" }, 404: { description: "SaaS não encontrado" } },
      },
    },
    "/api/marketing/{saas}/attribution": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      get: {
        tags: ["Sistema"], summary: "Catálogo id → nome (campanha/conjunto/anúncio) pro UTM do lead",
        responses: { 200: { description: "{ campaigns, adsets, ads }" }, 404: { description: "SaaS não encontrado" } },
      },
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
