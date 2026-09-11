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
    { name: "Tarefas", description: "Quadro de tarefas do time (nível Asana): colunas, subtarefas, comentários com menção, anexos, regras de coluna, recorrência, atividade e caixa de entrada. Rotas /api/tasks exigem a tela `tasks`; /api/notifications vale pra qualquer sessão." },
    { name: "Blog", description: "Redação do blog SEO (leverads.com.br/blog): pautas mineradas do cockpit, rascunhos por IA, revisão, agenda e publicação. Páginas públicas em /public/blog/* (sem chave)." },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
    },
    schemas: {
      BlogPost: {
        type: "object",
        description: "Um post do blog em qualquer estágio. Só `publicado` aparece no site. `slug` trava no primeiro publish (SEO).",
        properties: {
          id: { type: "string" }, saas: { type: "string" },
          status: { type: "string", enum: ["pauta", "rascunho", "agendado", "publicado", "arquivado"] },
          title: { type: "string" }, slug: { type: "string" }, slugLocked: { type: "boolean" },
          description: { type: "string", description: "Meta description (≤ 155)." },
          keyword: { type: "string" }, intent: { type: "string", enum: ["informacional", "comercial", "comparativo", "guia"] },
          category: { type: "string" }, painCode: { type: "string" }, tags: { type: "array", items: { type: "string" } },
          angle: { type: "string" }, outline: { type: "array", items: { type: "string" } }, evidence: { type: "array", items: { type: "string" } },
          body: { type: "string", description: "Markdown (subconjunto: h2/h3, parágrafo, negrito, itálico, link, lista, citação). Tokens `{{resRitmo||texto}}` resolvem com os resultados reais na hora de renderizar." },
          faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } } } },
          sources: { type: "array", items: { type: "object", properties: { type: { type: "string" }, ref: { type: "string" }, note: { type: "string" } } } },
          lint: { type: "array", items: { type: "object", properties: { code: { type: "string" }, level: { type: "string", enum: ["erro", "aviso"] }, msg: { type: "string" } } } },
          wordCount: { type: "integer" }, readingMin: { type: "integer" }, priority: { type: "integer" },
          scheduledAt: { type: "string" }, publishedAt: { type: "string" }, createdAt: { type: "string" }, updatedAt: { type: "string" },
        },
      },
      BlogRules: {
        type: "object",
        description: "Regras da redação automática (doc app_config `blog_<saas>`).",
        properties: {
          enabled: { type: "boolean" }, autoPauta: { type: "boolean" }, autoRascunho: { type: "boolean" }, autoPublicar: { type: "boolean", description: "Rascunho sem erro de lint vai pra agenda sozinho." },
          cadenciaSemanal: { type: "integer" }, diasPublicacao: { type: "array", items: { type: "string", enum: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] } }, horaPublicacao: { type: "string", description: "HH:MM em Brasília." },
          minPautas: { type: "integer" }, minRascunhos: { type: "integer" }, pautasPorRodada: { type: "integer" }, maxRascunhosDia: { type: "integer" }, maxRodadasPautaDia: { type: "integer" }, bufferAgendados: { type: "integer" },
          categorias: { type: "array", items: { type: "string" } }, ctaUrl: { type: "string" },
        },
      },
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
          recapNote: { type: "string", description: "O que ficou combinado na conversa, em uma linha (escrito no painel do inbox, aparece no card completo do lead). Máx. 280 caracteres.", example: "Quer as 3 contas espelhadas, decide com o sócio, retomar terça" },
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
          endedAt: { type: "string", description: "Data da saída (churn). No passado = cliente fora do MRR/rollup. Prefira o POST /api/customers/{id}/churn, que grava motivo e cancela as assinaturas.", example: "" },
          churnReason: { type: "string", description: "Motivo do churn (catálogo em churn.js ou texto livre).", example: "" },
          churnNote: { type: "string", description: "Observação livre da saída.", example: "" },
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
          "(`meta.nextActionAt` define uma data manual; `meta.reschedule: false` registra sem mexer na agenda). " +
          "`stage` e `system` são " +
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
      TaskComment: {
        type: "object",
        properties: {
          id: { type: "string" }, author: { type: "string", description: "id do usuário (ou 'api')." }, text: { type: "string" },
          at: { type: "string" }, editedAt: { type: "string" }, likes: { type: "array", items: { type: "string" } },
          mentions: { type: "array", items: { type: "string" }, description: "ids mencionados com @ (calculado no servidor)." },
        },
      },
      TaskAttachment: {
        type: "object",
        properties: { id: { type: "string" }, url: { type: "string", example: "/public/tasks/tka_…" }, name: { type: "string" }, mime: { type: "string" }, size: { type: "integer" }, by: { type: "string" }, at: { type: "string" } },
      },
      Recurrence: {
        type: "object", nullable: true,
        description: "Ao concluir, nasce a próxima instância com o prazo seguinte (dia/semana/mês).",
        properties: { every: { type: "string", enum: ["day", "week", "month"] }, interval: { type: "integer", minimum: 1 }, weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 = domingo (só `week`)." }, until: { type: "string", description: "AAAA-MM-DD, opcional." }, monthDay: { type: "integer", description: "dia âncora (só `month`)." } },
      },
      Task: {
        type: "object",
        description: "Card do quadro. `column` = key da coluna; `completed` é a régua única de concluída (entrar na coluna de concluído conclui, e concluir leva pra ela); `parentId` = subtarefa; `order` = posição na coluna (use POST /api/tasks/{id}/move).",
        properties: {
          id: { type: "string", readOnly: true }, title: { type: "string" }, description: { type: "string" }, saas: { type: "string", description: "produto (vazio = geral)." },
          assignees: { type: "array", items: { type: "string" }, description: "ids de usuários." }, column: { type: "string" }, priority: { type: "string", enum: ["", "P0", "P1", "P2"] },
          startDate: { type: "string", description: "AAAA-MM-DD" }, dueDate: { type: "string", description: "AAAA-MM-DD" }, labels: { type: "array", items: { type: "string" } },
          comments: { type: "array", items: { $ref: "#/components/schemas/TaskComment" } }, order: { type: "number" },
          cover: { type: "string", description: "URL /public/tasks/… da capa (photo é o alias legado)." }, attachments: { type: "array", items: { $ref: "#/components/schemas/TaskAttachment" } },
          completed: { type: "boolean" }, completedAt: { type: "string", readOnly: true }, completedBy: { type: "string", readOnly: true },
          parentId: { type: "string" }, followUpOf: { type: "string" }, duplicatedFrom: { type: "string", readOnly: true }, recurrenceOf: { type: "string", readOnly: true },
          recurrence: { $ref: "#/components/schemas/Recurrence" }, blockedBy: { type: "array", items: { type: "string" } },
          followers: { type: "array", items: { type: "string" } }, likes: { type: "array", items: { type: "string" }, readOnly: true },
          createdAt: { type: "string", readOnly: true }, createdBy: { type: "string", readOnly: true }, updatedAt: { type: "string", readOnly: true }, updatedBy: { type: "string", readOnly: true }, version: { type: "integer", readOnly: true },
        },
      },
      TaskBoard: {
        type: "object",
        description: "Um quadro por workspace. `doneKey` = coluna de concluído; `columns[].rules` = automações ao entrar na coluna.",
        properties: {
          id: { type: "string", readOnly: true }, name: { type: "string" },
          columns: { type: "array", items: { type: "object", properties: { key: { type: "string" }, name: { type: "string" }, color: { type: "string" }, rules: { type: "object", properties: { complete: { type: "boolean", nullable: true }, assign: { type: "array", items: { type: "string" } }, priority: { type: "string" } } } } } },
          doneKey: { type: "string" }, completeMovesToDone: { type: "boolean" },
          labels: { type: "array", items: { type: "object", properties: { name: { type: "string" }, color: { type: "string" } } } },
        },
      },
      TaskEvent: {
        type: "object",
        properties: { id: { type: "string" }, task: { type: "string" }, type: { type: "string", example: "assigned" }, by: { type: "string" }, at: { type: "string" }, data: { type: "object" } },
      },
      Notification: {
        type: "object",
        properties: { id: { type: "string" }, user: { type: "string" }, type: { type: "string", example: "mention" }, task: { type: "string" }, taskTitle: { type: "string" }, saas: { type: "string" }, text: { type: "string" }, by: { type: "string" }, at: { type: "string" }, read: { type: "boolean" }, readAt: { type: "string" } },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  paths: {
    "/api/tasks": {
      get: { tags: ["Tarefas"], summary: "Lista tarefas", parameters: [
        { name: "saas", in: "query", schema: { type: "string" } }, { name: "assignee", in: "query", schema: { type: "string" } }, { name: "column", in: "query", schema: { type: "string" } },
        { name: "parent", in: "query", schema: { type: "string" }, description: "`none` = só cards do quadro (sem subtarefas); ou o id da tarefa-mãe." },
        { name: "completed", in: "query", schema: { type: "string", enum: ["0", "1"] } }, { name: "label", in: "query", schema: { type: "string" } }, { name: "follower", in: "query", schema: { type: "string" } },
        { name: "due", in: "query", schema: { type: "string", enum: ["today", "overdue"] } },
      ], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Task" } } } } } } },
      post: { tags: ["Tarefas"], summary: "Cria uma tarefa (fim da coluna; quem cria e os responsáveis viram seguidores; entrar na coluna de concluído conclui)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } }, responses: { 201: { description: "Criada", content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } }, 400: { description: "Data/prioridade/coluna inválida" } } },
    },
    "/api/tasks/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Tarefas"], summary: "Lê uma tarefa", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } }, 404: { description: "Não encontrada" } } },
      patch: { tags: ["Tarefas"], summary: "Edita campos (título, descrição, responsáveis, datas, prioridade, labels, coluna, parentId, blockedBy, followers, completed, recurrence, cover). Carimbos, curtidas e anexos são gerenciados pelo servidor. Mudar `column` aplica as regras da coluna.", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } }, responses: { 200: { description: "OK" }, 400: { description: "Campo inválido" }, 404: { description: "Não encontrada" }, 409: { description: "Ciclo/profundidade de subtarefa" } } },
      delete: { tags: ["Tarefas"], summary: "Apaga a tarefa, as subtarefas, a atividade, as notificações e os anexos órfãos", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "{ ok, id, removed[] }" }, 404: { description: "Não encontrada" } } },
    },
    "/api/tasks/{id}/move": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Move/reordena: coluna + antes/depois de um card (o servidor calcula `order` e aplica as regras da coluna)", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { column: { type: "string" }, beforeId: { type: "string" }, afterId: { type: "string" } } } } } }, responses: { 200: { description: "{ task, rebalanced, applied[], next? }" }, 400: { description: "Coluna desconhecida / referência fora da coluna" } } } },
    "/api/tasks/{id}/complete": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Conclui (default) ou reabre; recorrente gera a próxima instância em `next`", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { completed: { type: "boolean" } } } } } }, responses: { 200: { description: "{ task, next? }" } } } },
    "/api/tasks/{id}/comments": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Comenta (autor = sessão; @menções notificam)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } } } }, responses: { 201: { description: "{ comment, task }" } } } },
    "/api/tasks/{id}/comments/{cid}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "cid", in: "path", required: true, schema: { type: "string" } }], patch: { tags: ["Tarefas"], summary: "Edita o próprio comentário", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } }, responses: { 200: { description: "{ comment, task }" }, 403: { description: "Não é o autor" } } }, delete: { tags: ["Tarefas"], summary: "Apaga o próprio comentário", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "{ ok, task }" }, 403: { description: "Não é o autor" } } } },
    "/api/tasks/{id}/comments/{cid}/like": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "cid", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Curte/descurte o comentário (exige sessão)", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "{ likes, liked, task }" } } } },
    "/api/tasks/{id}/like": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Curte/descurte a tarefa (exige sessão)", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "{ likes, liked, task }" } } } },
    "/api/tasks/{id}/followers": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Segue a tarefa (default: quem chama)", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { user: { type: "string" } } } } } }, responses: { 200: { description: "{ followers, task }" } } } },
    "/api/tasks/{id}/followers/{user}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "user", in: "path", required: true, schema: { type: "string" } }], delete: { tags: ["Tarefas"], summary: "Deixa de seguir", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "{ followers, task }" } } } },
    "/api/tasks/{id}/subtasks": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Cria uma subtarefa (herda coluna e produto)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } }, responses: { 201: { description: "Criada" } } } },
    "/api/tasks/{id}/convert": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Converte em subtarefa de `parentId` (to: subtask) ou em tarefa do quadro (to: task)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["to"], properties: { to: { type: "string", enum: ["subtask", "task"] }, parentId: { type: "string" } } } } } }, responses: { 200: { description: "Tarefa" }, 409: { description: "Ciclo/profundidade" } } } },
    "/api/tasks/{id}/duplicate": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Duplica (com subtarefas e anexos por padrão; sem comentários)", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, includeSubtasks: { type: "boolean" }, includeAttachments: { type: "boolean" } } } } } }, responses: { 201: { description: "A cópia" } } } },
    "/api/tasks/{id}/follow-up": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Cria a tarefa de acompanhamento (followUpOf)", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" }, dueDate: { type: "string" }, assignees: { type: "array", items: { type: "string" } } } } } } }, responses: { 201: { description: "Criada" } } } },
    "/api/tasks/{id}/blockers": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Marca que esta tarefa está bloqueada por `taskId`", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" } } } } } }, responses: { 200: { description: "Tarefa" }, 409: { description: "Bloqueio mútuo" } } } },
    "/api/tasks/{id}/blockers/{blockerId}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "blockerId", in: "path", required: true, schema: { type: "string" } }], delete: { tags: ["Tarefas"], summary: "Tira o bloqueio", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "Tarefa" } } } },
    "/api/tasks/{id}/attachments": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Anexa um arquivo (multipart `file`, qualquer tipo, até 5MB; a 1ª imagem vira capa)", security: [{ ApiKeyAuth: [] }], responses: { 201: { description: "{ attachment, task }" }, 413: { description: "Acima de 5MB" } } } },
    "/api/tasks/{id}/attachments/{aid}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "aid", in: "path", required: true, schema: { type: "string" } }], delete: { tags: ["Tarefas"], summary: "Remove o anexo (o arquivo some quando nenhuma tarefa mais o usa)", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "Tarefa" } } } },
    "/api/tasks/{id}/cover": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], post: { tags: ["Tarefas"], summary: "Define a capa (attachmentId; vazio tira a capa)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { attachmentId: { type: "string" } } } } } }, responses: { 200: { description: "Tarefa" } } } },
    "/api/tasks/{id}/activity": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], get: { tags: ["Tarefas"], summary: "Atividade + comentários em ordem cronológica", responses: { 200: { description: "[{ kind: event|comment, … }]", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/TaskEvent" } } } } } } } },
    "/api/tasks/bulk": { post: { tags: ["Tarefas"], summary: "Ação em massa (até 200 ids): assign, unassign, due, priority, move, complete, reopen, label, unlabel, delete", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["ids", "action"], properties: { ids: { type: "array", items: { type: "string" } }, action: { type: "string" }, value: {} } } } } }, responses: { 200: { description: "{ ok[], missing[], failed[] }" } } } },
    "/api/task_boards": {
      get: { tags: ["Tarefas"], summary: "O quadro (1 registro)", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/TaskBoard" } } } } } } },
      post: { tags: ["Tarefas"], summary: "Cria o quadro", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TaskBoard" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/task_boards/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], patch: { tags: ["Tarefas"], summary: "Edita colunas (com regras), coluna de concluído, labels", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TaskBoard" } } } }, responses: { 200: { description: "OK" } } } },
    "/api/notifications": { get: { tags: ["Tarefas"], summary: "Caixa de entrada de quem chama (chave mestre: ?user=)", parameters: [{ name: "unread", in: "query", schema: { type: "string", enum: ["1"] } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "user", in: "query", schema: { type: "string" } }], responses: { 200: { description: "{ items: Notification[], unread }" } } } },
    "/api/notifications/read": { post: { tags: ["Tarefas"], summary: "Marca como lidas (ids[] ou all: true)", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } } } } } }, responses: { 200: { description: "{ ok, marked }" } } } },
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
    "/api/customers/{id}/churn": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Clientes"], summary: "Registra o churn (saída) do cliente: endedAt + motivo, cancela as assinaturas em aberto (espelha no Mercado Pago quando vinculadas) e tira o cliente do MRR/rollup — o arr fica congelado como histórico", security: [{ ApiKeyAuth: [] }], requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { endedAt: { type: "string", description: "Data da saída (default: hoje)." }, reason: { type: "string", description: "Motivo (catálogo ou texto livre)." }, note: { type: "string" } } } } } }, responses: { 200: { description: "OK" }, 404: { description: "Não encontrado" } } },
    },
    "/api/customers/{id}/upsell": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Clientes"], summary: "Registra um upsell (venda extra pra cliente atual): fatura kind:upsell com o que foi vendido e quem vendeu; recorrente sobe a mensalidade da assinatura (arr/MRR acompanham); pagamento pago, a receber ou link do Mercado Pago", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["item"], properties: { item: { type: "string", description: "O que foi vendido." }, mode: { type: "string", enum: ["oneoff", "recurring"], description: "oneoff = venda única (default); recurring = acréscimo na mensalidade." }, amount: { type: "number", description: "Cobrado agora (obrigatório no oneoff; pode ser 0 no recurring)." }, monthlyDelta: { type: "number", description: "Acréscimo mensal (só recurring; default = amount)." }, payment: { type: "string", enum: ["paid", "open", "link"], description: "paid (default) = já pago em `date`; open = a receber até `dueDate`; link = cobrança no Mercado Pago." }, date: { type: "string", description: "YYYY-MM-DD (default: hoje)." }, dueDate: { type: "string" }, soldBy: { type: "string", description: "Id do usuário que vendeu (default: quem chamou); atribuição do placar do CS." }, product: { type: "string" }, note: { type: "string" }, maxInstallments: { type: "integer" } } } } } }, responses: { 200: { description: "OK — { invoice, url, customer, subscription }" }, 400: { description: "Corpo inválido" }, 404: { description: "Não encontrado" }, 409: { description: "Cliente em churn" }, 424: { description: "Mercado Pago não configurado / recusou o link" } } },
    },
    "/api/customers/{id}/unchurn": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Clientes"], summary: "Desfaz o churn (limpa endedAt/motivo); assinaturas canceladas não voltam sozinhas", security: [{ ApiKeyAuth: [] }], responses: { 200: { description: "OK" }, 404: { description: "Não encontrado" } } },
    },
    "/api/nps": {
      get: { tags: ["NPS"], summary: "Lista respostas de NPS", parameters: [{ name: "saas", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/NpsResponse" } } } } } } },
      post: { tags: ["NPS"], summary: "Registra uma resposta de NPS", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NpsResponse" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/goals": {
      get: { tags: ["Metas"], summary: "Lista metas", parameters: [{ name: "scope", in: "query", schema: { type: "string" } }], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Goal" } } } } } } },
      post: { tags: ["Metas"], summary: "Cria uma meta", security: [{ ApiKeyAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Goal" } } } }, responses: { 201: { description: "Criado" } } },
    },
    "/api/blog/{saas}": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Redação do blog: posts (sem corpo), contagens por status, regras, estado do motor e próximo slot de publicação", parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["pauta", "rascunho", "agendado", "publicado", "arquivado"] } }], responses: { 200: { description: "{ posts, counts, aiConfigured, rules, state, nextSlot }" } } },
    },
    "/api/blog/{saas}/settings": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Regras + estado + log do motor", responses: { 200: { description: "{ rules, state, log }" } } },
      patch: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Edita as regras (admin): cadência, dias, automações, categorias, CTA", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { rules: { $ref: "#/components/schemas/BlogRules" } } } } } }, responses: { 200: { description: "{ rules, state }" }, 403: { description: "Só admin" } } },
    },
    "/api/blog/{saas}/pautas": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Minera pautas agora a partir do digest do cockpit (diagnósticos, calls, WhatsApp anonimizado, dores, resultados)", requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { n: { type: "integer" }, refresh: { type: "boolean", description: "Reconstrói o digest (cache de 6h)." } } } } } }, responses: { 200: { description: "{ created: BlogPost[], dropped, usage }" }, 409: { description: "Motor ocupado" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/tick": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Roda um ciclo do motor agora (publica vencidos, agenda se auto publicar, minera, rascunha)", responses: { 200: { description: "{ saas, published, scheduled, drafted, mined, errors }" }, 409: { description: "Motor ocupado" } } },
    },
    "/api/blog/{saas}/digest": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "O digest anonimizado que alimenta as pautas (só agregados)", responses: { 200: { description: "{ text, builtAt, counts }" } } },
    },
    "/api/blog/{saas}/posts": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Cria uma pauta manual", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title"], properties: { title: { type: "string" }, keyword: { type: "string" }, category: { type: "string" }, angle: { type: "string" }, outline: { type: "array", items: { type: "string" } } } } } } }, responses: { 201: { description: "Criado", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } } } },
    },
    "/api/blog/{saas}/posts/{id}": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Um post completo (com corpo, fontes, lint e histórico)", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 404: { description: "Não encontrado" } } },
      patch: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Edita campos do post; slug só enquanto não publicado; post publicado exige lint sem erro e admin", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 400: { description: "Campo inválido" }, 409: { description: "Slug travado ou duplicado" }, 422: { description: "Lint com erro: { error, lint }" } } },
      delete: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Apaga (só pauta ou arquivado)", responses: { 200: { description: "OK" }, 409: { description: "Status não permite" } } },
    },
    "/api/blog/{saas}/posts/{id}/draft": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Escreve o rascunho da pauta com IA (uma revisão automática se o lint reprovar); ?force=1 reescreve um rascunho não publicado", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/revise": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Reescreve com uma instrução (agendado volta pra rascunho)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["instruction"], properties: { instruction: { type: "string", maxLength: 600 } } } } } }, responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/approve": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Aprova: vai pra agenda no próximo slot da cadência (ou no scheduledAt informado)", requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { scheduledAt: { type: "string" } } } } } }, responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/unschedule": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Tira da agenda (volta pra rascunho)", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/publish": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Publica agora (admin): trava o slug e entra no site", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/unpublish": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Despublica (admin): volta pra rascunho, slug segue travado; some do site em até 5 min pelo cache do proxy", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/archive": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Arquiva", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/restore": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Restaura do arquivo (pauta ou rascunho, conforme tenha corpo)", responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BlogPost" } } } }, 403: { description: "Só admin" }, 409: { description: "Status não permite" }, 422: { description: "Lint com erro: { error, lint }" }, 424: { description: "IA não configurada ou falhou" } } },
    },
    "/api/blog/{saas}/posts/{id}/preview-url": {
      parameters: [{ name: "saas", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { tags: ["Blog"], security: [{ ApiKeyAuth: [] }], summary: "Link assinado (30 min) da prévia pública do post, publicado ou não", responses: { 200: { description: "{ url, expiresAt }" }, 404: { description: "Não encontrado" } } },
    },
    "/public/blog/": {
      get: { tags: ["Blog"], summary: "Índice público do blog (HTML). Sem chave. Indexável só com o header x-blog-proxy do copylever; senão noindex + canonical em leverads.com.br. Também: /public/blog/{slug}, /public/blog/c/{categoria}, /public/blog/sitemap.xml, /public/blog/feed.xml", parameters: [{ name: "page", in: "query", schema: { type: "integer" } }], responses: { 200: { description: "HTML" }, 404: { description: "HTML 404" } } },
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
