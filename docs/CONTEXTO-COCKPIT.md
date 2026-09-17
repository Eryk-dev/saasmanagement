# Cockpit — contexto de trabalho

Conferido em **13/09/2026**, com base nos documentos do repositório e no código
versionado até `4b6d25c`. Este guia orienta a retomada de trabalho; não é um
backlog nem prova de qual versão está em produção. Mudanças locais de outras
tarefas devem ser examinadas separadamente e preservadas.

## Produto e decisões

O Cockpit centraliza a operação comercial e a gestão dos produtos: captação,
qualificação, WhatsApp, calls, propostas, fechamento, integração do cliente,
retenção, tarefas, marketing e financeiro. A API é a fonte da verdade para a
interface, integrações e agentes.

A origem era um painel de portfólio; a operação LeverAds orienta muitas regras,
mas o código já suporta um **workspace global por produto**, incluindo fluxos
específicos de UniqueKids/Elo. Preservar a separação por `saas`; não presumir que
o primeiro item de `SAAS` é sempre o produto em uso.

Decisões registradas no plano: funis e campos configuráveis por produto,
formulários e propostas nativos com identidade da marca, billing controlado pelo
Cockpit, Mercado Pago como integração de pagamento e lead scoring cortado.
Não reintroduzir scoring, Stripe ou uma mudança de arquitetura como parte de
uma tarefa que não pede isso. Valores comerciais e preços antigos dos documentos
não devem virar defaults novos sem conferir o catálogo vigente.

## Leitura por necessidade

| Referência | Uso |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Acordo de trabalho, commit, push e verificação de produção. |
| [Plano do rework](PLANO-REWORK.md) | Histórico detalhado de decisões, contratos e evolução dos módulos. Os estados de entrega e comandos de retomada envelheceram. |
| [README](../README.md) | Arquitetura, ambiente local com Supabase no Docker, deploy, API e MCP (revisado em 14/09/2026). |
| [Portfólio](../PORTFOLIO.md) | Histórico da simplificação para um produto; a proposta de alternador global já foi implementada. |
| [Playbook SDR](SDR-PLAYBOOK-LEVERADS.md) | Tom, objeções e fluxo comercial derivados de conversas de julho/agosto de 2026; estatísticas são desse período. |
| [Revisão de UI](../.claude/skills/cockpit-ui-review/SKILL.md) | Procedimento específico já existente para o cockpit. |
| [Design system](../.claude/skills/cockpit-ui-review/references/design-system.md) | Tokens, componentes e decisões visuais; conferir os componentes atuais ao aplicar. |
| [Checklist visual](../.claude/skills/cockpit-ui-review/references/checklist.md) | Revisão de uma tela ou componente. |

Os planos em `docs/superpowers/` detalham uma implementação de proposta editável
de junho de 2026. Consultá-los quando a tarefa envolver esse comportamento,
sem assumir que representam todo o renderer atual.

## Arquitetura confirmada

Monorepo npm workspaces, JavaScript ESM, Node >=20; a imagem de produção usa
Node 20. Os comandos oficiais estão nos `package.json` da raiz e dos pacotes.

| Camada | Tecnologia e entrada | Contrato principal |
| --- | --- | --- |
| API | Fastify 5; `packages/api/src/index.js`, `routes.js`, `routes.*.js` | REST na porta 8787; registro dos módulos, autenticação, migrações e automações. |
| Dados | `pg`; `packages/api/src/db.js`, `seed-data.js`, `migrations.js` | Postgres/Supabase via `COCKPIT_DB_URL`; schema `cockpit`, tabelas com `id`, `json` JSONB e `updated_at`. |
| Web | React 18 + Vite 6; `packages/web/src/main.jsx`, `app.jsx` | SPA na porta 5173 em desenvolvimento; navegação por hash, como `#pipeline`. |
| Estado web | `data.jsx`, `lib/api.js`, `lib/workspace.js` | Bootstrap em `window.SEED`, `DataContext`, workspace persistido e atualizações via SSE em `/api/events`. |
| MCP do projeto | SDK MCP + Express; `packages/mcp/src/index.js`, `tools.js`, `apiClient.js` | Streamable HTTP na porta 8788; ferramentas de consulta, escrita e documentação, todas pela API REST. |
| Produção | `Dockerfile.allinone`, `deploy/start.sh`, `deploy/nginx.allinone.conf` | API + MCP + nginx no mesmo container, porta pública 80; banco externo. |

`COLLECTIONS` define as coleções conhecidas e a criação de tabelas. O CRUD tem
exceções para coleções privadas (`PRIVATE` em `routes.js`), defaults, hooks e
rotas próprias. **Adicionar uma coleção não garante exposição automática no
bootstrap, no MCP ou na interface**: conferir cada contrato e os aliases do MCP.

O repositório usa cache de listagem com invalidação e `listWhere` para filtros
no Postgres. Em tabelas volumosas, procurar os acessos existentes antes de
adicionar um `list()` completo ou carregar registros no bootstrap.

## Mapa para encontrar a mudança

Os caminhos abaixo são relativos a `packages/`.

| Área | Onde começar |
| --- | --- |
| Navegação, workspace e acesso | `web/src/app.jsx`, `chrome.jsx`, `lib/workspace.js`, `lib/users.js`; `api/src/auth.js`, `screens.js`. |
| Pipeline, cadência e histórico | `api/src/stages.js`, `lead-flow.js`, `routes.activities.js`; `web/src/screens/pipeline.jsx`, `deal.jsx`, `today.jsx`, `lib/funnel.js`. |
| Formulários e propostas | `api/src/routes.forms.js`, `forms.js`, `form-page.js`, `routes.proposals.js`, `proposal.js`, `proposal-page.js`, `proposal-slides-page.js`; telas `forms.jsx` e `proposals.jsx`. |
| Integração e entrega ao cliente | `api/src/routes.integration-forms.js`, `routes.integrations.js`, `integration-brief.js`, `client-pending.js`; telas `integration-forms.jsx` e `integrations.jsx`. |
| Clientes, receita e pagamentos | `api/src/billing.js`, `churn.js`, `metrics-core.js`, `routes.billing.js`, `routes.mp.js`, `routes.fin.js`; telas `customers.jsx`, `subscriptions.jsx`, `offers.jsx`, `expenses.jsx`. |
| WhatsApp e SDR | `api/src/routes.whatsapp.js`, módulos `wa-*`, `sdr-flow.js`, `sdr-templates.leverads.js`; telas `whatsapp.jsx`, `calls.jsx`. |
| Métricas e marketing | `api/src/routes.metrics.js`, `routes.marketing.js`, `routes.funnel-metrics.js`, `routes.scoreboard.js`, `routes.pipeline-pace.js`; telas `metrics.jsx`, `analise.jsx`, `desempenho.jsx`. |
| Agenda, Google e consultas | `api/src/routes.google.js`, `routes.consultations.js`; telas `agenda.jsx`, `agenda-grid.jsx`, `consultas.jsx`. |
| Treinamentos | `api/src/routes.flashcards.js`, `fsrs.js`; telas `training.jsx`, `training.css`, `training-focus.jsx`; testes `api/test/routes.flashcards.test.js`. |
| Tarefas | `api/src/routes.tasks.js`; `web/src/screens/tasks/` (quadro, lista, calendário, drawer, filtros e estado). |
| Suporte (tickets) | `api/src/tickets-core.js`, `tickets-sla.js`, `support-scope.js`, `routes.tickets.js`, `quick-replies.js`, `ticket-sla-runner.js`, `routes.support-portal.js`, `support-page.js`; espelho com o Linear em `linear.js`, `ticket-linear.js`, `ticket-linear-runner.js` e a rota `/api/webhooks/linear` (`routes.webhooks.js`); `web/src/screens/tickets/`, `support-settings.jsx`, `quick-replies.jsx`, `lib/tickets.js`, `components/customer-tickets.jsx`; testes `routes.tickets`, `routes.quick-replies`, `tickets-sla`, `ticket-sla-runner`, `routes.support-portal`, `ticket-linear`. |
| Conteúdo e redes sociais | `api/src/routes.blog.js`, `routes.blog-public.js`, `routes.social.js`; telas `blog.jsx` e `social.jsx`. |
| Componentes e visual | `web/src/tokens.css`, `atoms.jsx`, `components/viz.jsx`, `components/lead-blocks.jsx`, `lib/ui.js`. |
| Kanban compartilhado | `web/src/components/kanban/` (`KanbanBoard`/`KanbanColumn` + `useBoardDnd`): quadro, coluna, soltar, placeholder, corte "+N" e coluna recolhida. Tarefas, Tickets e Pipeline montam só o card e o que é do domínio em cima dela; layout `scroll` (colunas fixas que rolam sozinhas) ou `fill` (grid de colunas iguais, Pipeline). |
| Testes da API | `api/test/*.test.js`; repositório em memória em `api/test/helpers/mem-repo.js`. |

## Regras que precisam sobreviver às mudanças

1. **Receita de produto:** `rollupProduct` deriva clientes, ARR e MRR de
   `customers`, excluindo os churnados segundo `churn.js`. Não usar os números
   crus do produto. `syncCustomerArr` reconcilia assinaturas e preserva o
   histórico do cliente encerrado. Referência: `routes.rollup.test.js`.
2. **Contrato, receita reconhecida e caixa são medidas diferentes.** As regras
   atuais de pagamentos faturados, PIX parcelado e cartão recorrente passam por
   `metrics-core.js`; não somar `lead.amount` indiscriminadamente nas metas.
   Referências: `revenue-on-receipt.test.js` e `metrics-consistency.test.js`.
3. **Estágio é semântico:** usar `funnel[].kind` e os helpers de `stages.js` /
   `web/src/lib/funnel.js`, em vez de comparar nomes visíveis. Reusar
   `applyStageMove` para preservar histórico, `stageSince`, cadência e efeitos
   do fechamento. Conferir o comportamento de `lead-flow.js` e seus testes.
4. **Autorização vive também no servidor:** autenticação própria com scrypt e
   sessões, além da chave de integração. `screens.js` controla permissões por
   tela, exceções e acessos administrativos; `lib/users.js` espelha a UI.
   `roles` já participa de regras de acesso — não assumir que é só etiqueta.
   Credenciais e tokens não entram no CRUD/JSON público nem no guia.
5. **Atualização não pode apagar edição em curso:** o app atual preserva as
   telas durante refresh (sem `key={dataVersion}`) e contém proteções para quem
   está digitando. Estado que deve sobreviver segue os stores e padrões
   existentes. Não adicionar polling por aba quando SSE ou automação no servidor
   já cobrem a atualização.
6. **UI segue o sistema existente:** CSS custom properties + componentes
   próprios; tema claro padrão e suporte a escuro. Preferir `atoms.jsx`,
   `components/viz.jsx` e blocos compartilhados. Consultar as regras recentes
   do design system sobre filtros, métricas, prioridade das ações e mobile.
7. **Integrações têm efeitos reais:** pagamentos, mensagens, convites, anúncios
   e rotinas devem ser testados com clients injetados/mocks quando possível.
   A análise do código não autoriza disparar essas operações em produção.

## Como validar e entregar

Antes de editar: `git status --short --branch`, ler o diff relevante e localizar
o teste do domínio. A árvore pode estar sendo alterada por outra sessão;
conferir novamente antes de stage/commit e incluir somente os caminhos da tarefa.

Comandos disponíveis, executados na raiz:

```sh
npm ci
npm test -w packages/api
node --test packages/api/test/routes.rollup.test.js
npm test -w packages/web
npm run build
```

Instalar com `npm ci` quando for necessário preparar as dependências. A API usa
`node:test` e testes com repositório em memória/Fastify inject; o teste web é
`packages/web/scripts/smoke-ssr.mjs`, sem necessidade de subir a API. Escolher os
testes de domínio conforme a mudança; executar a suíte da API quando o alcance
ou o contrato compartilhado justificar. Smoke SSR e build não comprovam
interações no navegador: alterações visuais/interativas também exigem conferir
a tela. Documentação isolada pede revisão dos links, comandos e diff.

`npm run dev` inicia API, web e MCP. **Antes de usá-lo, confirmar banco de
desenvolvimento isolado**: o plano registra uso do mesmo Supabase de produção,
e `index.js` executa migrações e inicia automações. A presença de um `.env` não
comprova isolamento. Não copiar seus valores para logs, documentação ou commits.
`seed:clear` apaga dados e não é passo de preparação de ambiente.

Banco isolado disponível: `docker compose -f infra/local/docker-compose.yml up -d`
sobe só a infraestrutura (Postgres do Supabase em `localhost:54322`, Studio em
`http://localhost:54323`); os pacotes rodam fora do Docker. O `.env.example` já
aponta `COCKPIT_DB_URL` para esse banco. Integrações ficam vazias no `.env`
local, porque as rotinas do boot usam credenciais reais se existirem. Em
14/09/2026, a API subiu nesse banco (77 tabelas, migrações, login, criação de
produto e `seed:leverads-questions`); o único aviso esperado é
`[leverads-results]`, pois a função do Levercopy não existe localmente.

Após a validação, seguir o acordo em `AGENTS.md`: verificar `origin/main`,
commitar os arquivos da tarefa e fazer push para `origin/main`, sem force-push
e sem incluir mudanças alheias. O push dispara o deploy do EasyPanel.

Endereço registrado e acessível na análise:
`https://extrator-mp-saasmngmnt.gnnc3f.easypanel.host`.

```sh
curl --fail --silent --show-error --max-time 20 https://extrator-mp-saasmngmnt.gnnc3f.easypanel.host/api/health
node packages/api/src/build-info.js
```

O health retorna `ok`, `service` e `build`. `build-info.js` calcula a impressão
do **conteúdo local de `packages/api/src`**; compará-la com produção usando os
arquivos exatos do commit enviado, sem alterações locais de outras tarefas.
HTTP 200 sozinho não comprova atualização, e o hash da API não comprova o build
web. Mudança apenas documental não altera esse hash; mudança de UI também pede
verificação da página/assets correspondentes. Reportar qualquer divergência ou
falha de deploy com a evidência, conforme o acordo de trabalho.

## Correções de contexto e ferramentas

- **Cases da apresentação C (14/09/2026):** os quatro cases do painel usam o
  acumulado de cada cliente em `org_revenue_generated`, com valores brutos e
  data de apuração guardados em `cases.evidence`. São snapshots conferidos,
  sem extrapolar a janela de 30 dias. Pedidos substituem crescimento mensal;
  tempo e custo mantêm 10 minutos por anúncio e R$ 3.000 / 220 horas.
  `ensurePanelCases` atualiza esses registros uma vez por marcador, preservando
  autorização e publicação. Propostas já geradas guardam cópias em `data.cases`:
  atualizar o case central não altera essas cópias; correções nelas passam pela
  API REST e preservam `state`, preços e demais dados da proposta.

- **Handoff de design (14/09/2026):** referência em
  [design/handoff-cockpit](../design/handoff-cockpit/README.md), com índice em
  [MAPA-ESTRUTURAL.md](../design/handoff-cockpit/MAPA-ESTRUTURAL.md). A entrega
  inicial foi a moldura: sidebar, topbar, conta, workspace, busca
  e notificações. A adaptação do conteúdo avançou para Visão Geral, Minhas
  Atividades e Treinamentos; as próximas telas seguem em etapas acompanhadas
  pelo usuário. Treinamentos mantém a fila e os intervalos da API, abre estudo
  e prova em modal e permite estudar um baralho, consultar a equipe e editar
  a base oficial (admin). O preview local `/?shell=1#overview` usa o App
  real com API fictícia; iniciar com `node node_modules/vite/bin/vite.js
  --config packages/web/vite.preview.config.js` (porta padrão 5199).
  Treinamentos usa `/?shell=1#training`; `/?shell=1&exam=1#training` inclui uma
  prova pendente fictícia. Os dados ficam em `preview/training-mock.js` e não
  entram no build de produção.

- **Marketing — handoff (14/09/2026):** as telas Redes sociais, Publicidade,
  Formulários, Landing pages, Canvas, Disparos e Blog usam a estrutura do
  protótipo sobre `screens/marketing.css`. O Canvas mantém o renderer e as
  marcas existentes, com templates por formato, conteúdo e fonte por slide,
  elementos adicionais e exportação PNG. Disparos organiza público, mensagem
  e conferência em três passos e preserva o envio assistido e as sequências.
  A prévia `/?shell=1&marketing=1#blog` carrega `preview/marketing-mock.js`;
  aceita `&theme=dark` e `&product=elo#landingpages`. Os cenários são fictícios
  e não executam anúncios, publicações ou mensagens reais. O preview não entra
  no build de produção. A navegação saindo de Publicidade foi conferida após
  corrigir o cleanup do efeito de `DeliveryRulesCard`.

- **Suporte — tickets (14/09/2026):** grupo novo "Suporte" no menu com Tickets
  (Kanban por status, com Resolvido e Fechado juntos na coluna Concluídos e o
  círculo de concluir no card, e Lista agrupada pelo SLA; detalhe em modal `#tickets/<id>`) e
  Configurações de SLA. Invariantes: (1) o **escopo de produto é ACL no
  servidor** — sessão sem etiqueta `admin` só alcança os produtos de
  `user.supportSaas` (lista vazia = nenhum ticket; ticket fora do escopo
  responde 404, criar responde 403). A etiqueta `support` sozinha não libera
  nada: a lista é editada em Ajustes → Equipe (coluna "Atende (suporte)",
  `PATCH /api/auth/users/:id`) ou, por quem já atende o produto, em
  Configurações de SLA → Atendentes (`PUT /api/support/agents/:id`). As quatro coleções (`tickets`,
  `ticket_events`, `ticket_assets`, `ticket_settings`) são `PRIVATE` no CRUD
  genérico. (2) Status tem semântica fixa (`kind` open/waiting/done). (3) SLA
  por prioridade em minutos úteis (expediente do produto, relógio de
  Brasília): prazos e instantes de aviso ficam gravados no ticket, então fila,
  contador do menu e `ticket-sla-runner.js` concordam; mudar a configuração vale
  para tickets abertos ou alterados depois. (4) **Nota interna nunca sai pelo
  portal** — `/s/:token` e `/public/support/*` só usam `publicTicket`. Portal de
  abertura `/s/new/:saas` nasce desligado; aviso ao cliente por e-mail só com o
  toggle do produto e o Gmail conectado. Prévia: `/?shell=1#tickets`,
  `&ticketsView=list`, `#tickets/tk5`, `#support_settings` (dados em
  `preview/tickets-mock.js`). Fora desta entrega: ticket a partir de
  WhatsApp/e-mail recebido, CSAT e relatórios.
- **Suporte — respostas rápidas (14/09/2026):** página no grupo Suporte e uso no
  chat do ticket (botão ou `/atalho`). Coleção `quick_replies` (PRIVATE):
  `shared` por produto, editada por quem tem `support_settings`; `personal`
  só do dono (`saas` vazio = todos os produtos que ele atende). Variáveis
  automáticas (`{{cliente.primeiro_nome}}`, `{{ticket.link}}`…) e do produto
  em `ticket_settings.variables`; o texto é SEMPRE resolvido no servidor
  (`variableValues` + `renderTemplate`), prévia e chat usam a mesma função.
  Embutida sem ponto precisa constar em `RESERVED_VARIABLE_KEYS`.
- **Suporte — espelho com o Linear (17/09/2026):** ligado por produto em
  Configurações de SLA → Linear (time + projeto do Linear). Com o espelho
  ligado, TODO ticket do produto vira issue no projeto escolhido e cada mensagem
  vira comentário; de volta, a coluna da issue move o status e o comentário do
  dev vira **aviso** (evento `linear_comment` + sino), sem cópia do texto no
  ticket — quem mostra a conversa da issue é a aba Linear, que lê ao vivo.
  Invariantes: (1) **conversa de engenharia nunca chega ao cliente** —
  `publicTicket` segue sendo a única porta do portal, e o texto do comentário
  nem entra no doc; o dedupe do que já foi anunciado mora em
  `ticket.linear.seenComments` (não na mensagem, que pode ser apagada); (2) **anti-ping-pong**: o
  que entra do Linear é gravado com o ator `linear` (`ACTOR_LINEAR`) e o gancho
  de saída (`setTicketSink` em `tickets-core.js`) ignora esse ator; o espelho do
  que já subiu mora em `ticket.linear.mirror`, então só a diferença real é
  enviada; (3) o espelho é **calculado pelo doc do ticket**, não por evento — a
  fila `linear_outbox` (PRIVATE) só marca "sujo", com backoff e desistência após
  10 tentativas (o erro fica em `ticket.linear.error`); (4) a volta chega por
  `POST /api/webhooks/linear` com assinatura HMAC conferida
  (`LINEAR_WEBHOOK_SECRET`; sem segredo a rota recusa) e pela **reconciliação**
  de 10 em 10 minutos, que repõe entrega perdida — comentário repetido não
  duplica (dedupe por id em `message.source.commentId` e `linear.posted`);
  (5) no detalhe do ticket, **Conversa é só o atendimento** (pedido, respostas e
  notas da equipe) e o que é da issue vive na aba **Linear** (descrição e
  comentários lidos na hora por `GET /api/tickets/:id/linear`, com queda para o
  que está gravado quando o Linear não responde) — o filtro é a origem
  `message.source.type === "linear"`;
  (6) ligar o espelho enfileira só os tickets **abertos** do produto, e
  desvincular nunca apaga issue no Linear. `LINEAR_API_KEY` vazia deixa tudo
  dormente. `ticket.linearIssueId` fica no topo do doc (índice
  `tickets_linear_issue_idx`) porque é por ele que o webhook acha o ticket.
  Fora desta entrega: anexo do ticket virar anexo da issue, de-para de pessoas
  (responsável) e ferramenta de MCP própria.
- **README (revisado em 14/09/2026):** as descrições antigas (SQLite, leitura
  aberta, MCP só como manual, seed demo) foram substituídas. Pendência registrada
  lá: o `packages/web/nginx.conf` do `docker-compose.yml` não faz proxy das rotas
  públicas (`/f`, `/p`, `/public`…); o caminho de produção mantido é o
  `Dockerfile.allinone`.
- **Plano do rework:** referências a ausência de Git, entregas apenas locais,
  contagens de testes, senhas em produção e indisponibilidade de deploy são
  registros datados, não diagnóstico atual. Não repetir os passos antigos de
  retomada nem experimentar credenciais registradas ali.
- **PORTFOLIO.md:** o alternador global já existe em `lib/workspace.js` e é usado
  pelo app. Conferir a cobertura da tela afetada antes de propor outro.
- **Ferramentas:** para desenvolvimento local, terminal/Git, testes existentes e
  Browser já cobrem o fluxo. Há orientações de Supabase disponíveis para tarefas
  de banco e uma skill de UI já versionada no projeto. Esta análise não exigiu
  instalar extensão, trocar stack ou criar um segundo design system.
- **MCP do Cockpit:** o servidor existir no código não comprova que esteja
  conectado a esta sessão. Conectá-lo só quando uma tarefa de operação via API
  justificar; o acesso a dados não é necessário para ler e melhorar o código.

Atualizar este guia quando uma decisão nova substituir uma das regras acima;
manter o histórico detalhado nos documentos do domínio e no Git.

## Verificação desta preparação

Em 13/09/2026, passaram 57 testes selecionados (`routes.rollup`, `stages`,
`lead-flow`, `revenue-on-receipt`, `build-info`), o smoke SSR web e o build.
Os links locais deste guia também foram conferidos. Isso não representa uma
execução da suíte completa nem teste de integrações externas; houve trabalho
concorrente em outros arquivos durante a análise.

O build emitiu avisos preexistentes de `className` duplicado em `settings.jsx`
e de chunk acima de 500 kB. São achados para eventual tarefa própria, sem
alteração funcional nesta preparação.
