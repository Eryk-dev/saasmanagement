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

## Referência visual vigente

O layout aprovado em 20/09/2026 é o **CRM final**, versionado em
[design/crm-final/IMPLEMENTACAO.md](../design/crm-final/IMPLEMENTACAO.md), com o
mapa das 30 telas. `support.js` é apenas referência do editor; a aplicação não
depende dele. `chrome.css` concentra a moldura compartilhada e `capsule.css`
aplica as superfícies comuns. O grupo da rota atual permanece expandido;
as preferências dos demais grupos continuam persistidas. A prévia `responsive.html?width=390&screen=overview` (também 1440/1920)
usa mocks locais, sem API/banco; `&prototype=1` abre a prancha na mesma
largura para comparação visual. A revisão de conteúdo por página está registrada no inventário da skill.
Para reproduzir Visão geral com dados fixos e testes no navegador, usar
`npm run test:review:overview -w packages/web`; para Atividades,
`npm run test:review:today -w packages/web`; para Treinamentos,
`npm run test:review:training -w packages/web`; para Pipeline,
`npm run test:review:pipeline -w packages/web`; para Clientes,
`npm run test:review:customers -w packages/web`; para Propostas,
`npm run test:review:proposals -w packages/web`; para Links de pagamento,
`npm run test:review:offers -w packages/web`; para Contratos,
`npm run test:review:contracts -w packages/web`; para Formulário de Integração,
`npm run test:review:intform -w packages/web`; para Agenda,
`npm run test:review:agenda -w packages/web` e
`npm run test:review:agenda-drag -w packages/web` (arrastar) e
`npm run test:review:agenda-people -w packages/web` (filtro de pessoas),
`npm run test:review:agenda-timezone -w packages/web` (relógio de Brasília em
outros fusos) e `npm run test:review:agenda-lead-phone -w packages/web`
(telefone no card); para Inbox,
`npm run test:review:whatsapp -w packages/web`; para Tickets,
`npm run test:review:tickets -w packages/web`; para Respostas rápidas,
`npm run test:review:quick-replies -w packages/web`; para Configurações de SLA,
`npm run test:review:sla -w packages/web`; para Redes sociais,
`npm run test:review:social -w packages/web`; para Publicidade,
`npm run test:review:metrics -w packages/web`; para Formulários,
`npm run test:review:forms -w packages/web`; para Canvas,
`npm run test:review:creative -w packages/web`; para Disparos,
`npm run test:review:disparos -w packages/web`; para Blog,
`npm run test:review:blog -w packages/web`; para Análise de Pace,
`npm run test:review:analise -w packages/web`; para Análise de Pitches,
`npm run test:review:calls -w packages/web`; para Análise de Integração,
`npm run test:review:integrations -w packages/web`; para Análise de Desempenho,
`npm run test:review:desempenho -w packages/web`; para Tarefas,
`npm run test:review:tasks -w packages/web`; para Mapas mentais,
`npm run test:review:mindmaps -w packages/web`; para Metas,
`npm run test:review:metas -w packages/web`; para Remuneração,
`npm run test:review:remuneracao -w packages/web`; para Financeiro,
`npm run test:review:expenses -w packages/web`; para Configurações,
`npm run test:review:settings -w packages/web` (Chromium do Playwright instalado
com `npx playwright install chromium`, se necessário). O comando sobe só Vite
com mocks, sem API/banco, e grava medidas/capturas em `.review-artifacts` do web.
Na ficha de formulário, respostas enviadas continuam lendo `doc.sections`
(snapshot). A prévia e os pedidos pendentes consultam as perguntas atuais por
`GET /api/integration-forms/questions?kind=`, através de `lib/api.js`.
Atividades abre o roteiro lateral no desktop
e em modal até 1100px, preservando os mesmos handlers e estado.
Treinamentos mantém a sessão comum dentro do card principal; o modo foco
continua usando tela cheia e áudio. Edição básica é inline, com editor avançado
para imagem/cloze/oclusão e salvamento explícito da base.
Pipeline compartilha filtros entre Kanban/Lista/Análise; a esteira usa os
helpers e o endpoint existentes de pace. A ficha compacta é uma variante de
LeadDetail usada nesta rota; os handlers e a ficha das demais rotas permanecem.
Filtro de **Segmento** (06/10/2026, `web/src/lib/segments.js`): lê `lead.niche`
(resposta dos forms, também texto livre do robô/outbound), casa com as opções
da pergunta `niche` do produto e manda texto livre de autopeças e lead OEM
(`formProduct: "oem"`, cujo form não pergunta o nicho) para a opção de
autopeças. Só no navegador, sem campo novo nem migração; some em produto sem
segmento. Fatia colunas e totais como o filtro de pessoa
(`cockpit_pipeline_segment`). Tags em lead ainda não existem.
O modal de pagamento usa o `Modal` compartilhado para controlar foco/teclado.
Clientes usa a ficha lateral de 420px com contrato, marcos e dinheiro. Edição,
upsell, churn e gestão de cobranças abrem os formulários existentes em modal;
a apresentação compacta recebe os mesmos totais/status da tabela. Leituras
financeiras têm estado local de carregamento/erro e nova tentativa.
Seletores que usam `Popover` abrem em portal no `document.body`, mantendo
menus e folhas mobile acima da página e do botão flutuante de feedback.

## Arquitetura confirmada

Monorepo npm workspaces, JavaScript ESM, Node >=20; a imagem de produção usa
Node 20. Os comandos oficiais estão nos `package.json` da raiz e dos pacotes.

| Camada | Tecnologia e entrada | Contrato principal |
| --- | --- | --- |
| API | Fastify 5; `packages/api/src/index.js`, `routes.js`, `domains.js` e as pastas de domínio (`billing/`, `support/`, `whatsapp/`…) | REST na porta 8787; registro dos módulos, autenticação, migrações e automações. |
| Dados | `pg`; `packages/api/src/platform/db.js`, `seed-data.js`, `migrations.js` | Postgres/Supabase via `COCKPIT_DB_URL`; schema `cockpit`, tabelas com `id`, `json` JSONB e `updated_at`. |
| Web | React 18 + Vite 6; `packages/web/src/main.jsx`, `app.jsx` | SPA na porta 5173 em desenvolvimento; navegação por hash, como `#pipeline`. |
| Estado web | `data.jsx`, `lib/api.js`, `lib/workspace.js` | Bootstrap em `window.SEED`, `DataContext`, workspace persistido e atualizações via SSE em `/api/events`. |
| MCP do projeto | SDK MCP + Express; `packages/mcp/src/index.js`, `tools.js`, `apiClient.js` | Streamable HTTP na porta 8788; ferramentas de consulta, escrita e documentação, todas pela API REST. |
| Produção | `Dockerfile.allinone`, `deploy/start.sh`, `deploy/nginx.allinone.conf` | API + MCP + nginx no mesmo container, porta pública 80; banco externo. |

A API é organizada por domínio em `packages/api/src/`: `platform/` (banco, seed,
migrações, cache, status HTTP), `shared/` (módulos puros que a SPA também importa;
sem API do Node), `auth/`, `crm/`, `sdr/`, `whatsapp/`, `calls/`, `google/`,
`forms/`, `proposals/`, `billing/`, `payments/`, `customers/`, `support/`, `tasks/`,
`training/`, `marketing/`, `blog/`, `metrics/`, `comp/` e `integrations/`
(clientes externos transversais). Ficam na raiz `index.js`, `routes.js`,
`domains.js` e `build-info.js`; `assets/` guarda as imagens servidas. Arquivo novo
entra na pasta do domínio dele.

Cada domínio com rota tem um `index.js` com `register(app, repo, ctx)` e, quando
tem rotina em segundo plano, `start(repo, { clients, log, stops })`. O `routes.js`
monta os clientes de base (IA, Meta, Mercado Pago, Discord) num `ctx` e chama o
`register` de cada domínio na ordem de `domains.js`; os domínios acrescentam ao
`ctx` o que criam (Google e mailer, WhatsApp, SDR, motor do blog). A ordem só
importa para esses clientes: google antes de quem usa Meet/mailer, whatsapp
antes de SDR e clientes, CRM por último. Depois do listen, o `index.js` chama
`startDomains`, que sobe o `start` de cada domínio. Rotina nova entra no `start`
do domínio dela, atrás de `jobOn("nome")`, não no `index.js` (o teste de
fronteiras recusa rotina sem `jobOn`).

Um `routes.<x>.js` só registra endpoints: lógica, helper usado por outro módulo
e rotina em segundo plano moram num módulo do domínio (ex.:
`metrics/pipeline-pace.js` ao lado de `metrics/routes.pipeline-pace.js`). Só o
`index.js` do próprio domínio importa um `routes.<x>.js`, só o `domains.js`
importa o `index.js` de um domínio, só o `index.js` da raiz importa o
`routes.js`, e `shared/` só importa da própria pasta.
`api/test/fronteiras-dominio.test.js` garante essas regras.

`COLLECTIONS` define as coleções conhecidas e a criação de tabelas. O CRUD tem
exceções para coleções privadas (`PRIVATE` em `crm/routes.crud.js`), defaults, hooks e
rotas próprias. **Adicionar uma coleção não garante exposição automática no
bootstrap, no MCP ou na interface**: conferir cada contrato e os aliases do MCP.

O repositório usa cache de listagem com invalidação e `listWhere` para filtros
no Postgres. Em tabelas volumosas, procurar os acessos existentes antes de
adicionar um `list()` completo ou carregar registros no bootstrap.

Na Visão Geral, `metrics-reader.js` compartilha leituras apenas dentro de um
cálculo do placar/pace/meta. Atividades são filtradas por produto; mensagens
mantêm os registros legados sem `saas`, mas trafegam sem texto/mídia. Propostas
levam só os campos usados no contador. Não reutilizar esse leitor em CRUD ou
entre requisições. A meta de uma janela compartilha o cálculo do ticket com o
pace, sem recalcular todo o funil. A regressão de custo e equivalência está em
`api/test/overview-loading.test.js`.

A entrada usa `AppStartup`: busca o SEED antes de importar o App e mantém o
splash até a primeira tela concluir suas leituras. `ScreenTransition` cobre só
o conteúdo nas mudanças de rota/produto; menu e topo permanecem disponíveis.
`lib/navigation-loading.js` acompanha os GETs iniciais de `lib/api.js`, incluindo
parse/erro e consultas encadeadas, com uma janela de estabilização de 80ms.
Depois de revelar a tela, polling/SSE não reabre o splash nem remonta formulários.
Uma espera acima de 12s oferece ação de saída; não há percentual fictício ou
liberação automática que esconda uma consulta pendente. A referência original
está em `design/splash-loading-crm/`; seu runtime de editor não é executado no app.
`npm test` no web roda os testes do ciclo de navegação/cliente REST e o smoke SSR.
Prévia isolada: `npm run preview:tela -- --port 5202` em `packages/web`, URL
`/?shell&splash&delay=1500#overview`; `fail=scoreboard` e `hang=scoreboard` simulam
falha e espera longa sem banco/API.

O nginx do container comprime JSON, JavaScript, CSS e outros textos com gzip,
com `Vary: Accept-Encoding`. Streams SSE não entram nos tipos comprimidos e
o MCP mantém compressão desabilitada. A validação de produção dessa melhoria
deve conferir `Content-Encoding: gzip` no bootstrap com `Accept-Encoding: gzip`,
além do hash da API: só o hash não comprova a configuração do nginx.

`proposals` é a maior coleção (snapshots de ~28 kB por proposta, dezenas de MB)
e fica acima do teto do cache de `list()`: rota quente lê propostas **só** por
`listWhere` (índice `proposals_saas_created_idx`). Os cálculos caros (pace em
`routes.pipeline-pace.js`, placar em `routes.scoreboard.js`) passam por
`compute-cache.js`: resultado memoizado por chave, válido até a próxima escrita
no repo (`repo.writeRev()`) ou 60 s; `?fresh=1` pula o cache.

## Mapa para encontrar a mudança

Os caminhos abaixo são relativos a `packages/`.

| Área | Onde começar |
| --- | --- |
| Navegação, workspace e acesso | `web/src/app.jsx`, `chrome.jsx`, `lib/workspace.js`, `lib/users.js`; `api/src/auth/auth.js`, `auth/screens.js`. |
| Pipeline, cadência e histórico | `api/src/crm/stages.js`, `crm/lead-flow.js`, `shared/followup-contacts.js` (CRUD de activities em `crm/routes.crud.js`); `web/src/screens/pipeline.jsx`, `deal.jsx`, `today.jsx`, `lib/funnel.js`. |
| Formulários e propostas | `api/src/forms/` (`routes.forms.js`, `forms.js`, `form-page.js`) e `api/src/proposals/` (`routes.proposals.js`, `proposal.js`, `proposal-page.js`, `proposal-slides-page.js`); telas `forms.jsx` e `proposals.jsx`. |
| Integração e entrega ao cliente | `api/src/forms/routes.integration-forms.js`, `customers/routes.integrations.js`, `calls/integration-brief.js`, `customers/client-pending.js`; telas `integration-forms.jsx` e `integrations.jsx`. |
| Clientes, receita e pagamentos | `api/src/billing/` (`billing.js`, `churn.js`, `routes.billing.js`), `payments/` (`routes.mp.js`, `routes.fin.js`) e `metrics/metrics-core.js`; telas `customers.jsx`, `subscriptions.jsx`, `offers.jsx`, `expenses.jsx`. |
| Planos, plano do cliente e acesso | `api/src/shared/plan-cycles.js`, `shared/plan-resources.js`, `billing/plan-catalog.js`, `billing/plan-history.js`, `billing/entitlements.js`, `billing/leverads-access.js`; `web/src/screens/plans.jsx`, `components/plan-editor.jsx`, `customer-plan.jsx`; testes `plan-cycles`, `plan-catalog`, `plan-history`, `entitlements`, `leverads-access`. |
| WhatsApp e SDR | `api/src/whatsapp/` (`routes.whatsapp.js`, módulos `wa-*`) e `api/src/sdr/` (`sdr-flow.js`, `sdr-templates.leverads.js`); telas `whatsapp.jsx`, `calls.jsx`. |
| Métricas e marketing | `api/src/metrics/` (`routes.metrics.js`, `routes.funnel-metrics.js`, `routes.scoreboard.js`, `routes.pipeline-pace.js`) e `marketing/routes.marketing.js`; telas `metrics.jsx`, `analise.jsx`, `desempenho.jsx`. |
| Agenda, Google e consultas | `api/src/google/routes.google.js`, `calls/routes.consultations.js`; telas `agenda.jsx`, `agenda-grid.jsx`, `consultas.jsx`. |
| Treinamentos | `api/src/training/` (`routes.flashcards.js`, `fsrs.js`); telas `training.jsx`, `training.css`, `training-focus.jsx`; testes `api/test/routes.flashcards.test.js`. |
| Tarefas | `api/src/tasks/routes.tasks.js`; `web/src/screens/tasks/` (quadro, lista, calendário, drawer, filtros e estado). |
| Suporte (tickets) | `api/src/support/` (`tickets-core.js`, `tickets-sla.js`, `routes.tickets.js`, `quick-replies.js`, `ticket-sla-runner.js`, `routes.support-portal.js`, `support-page.js`) e `auth/support-scope.js`; espelho com o Linear em `support/linear.js`, `ticket-linear.js`, `ticket-linear-runner.js` e a rota `/api/webhooks/linear` (`marketing/routes.webhooks.js`); Hermes (agente de correção no Linear) em `support/ticket-hermes.js`, `hermes-actions.js`, `routes.hermes.js` e `shared/hermes-phase.js`; `web/src/screens/tickets/`, `support-settings.jsx`, `quick-replies.jsx`, `lib/tickets.js`, `components/customer-tickets.jsx`; testes `routes.tickets`, `routes.quick-replies`, `tickets-sla`, `ticket-sla-runner`, `routes.support-portal`, `ticket-linear`, `ticket-hermes`. |
| Conteúdo e redes sociais | `api/src/blog/` (`routes.blog.js`, `routes.blog-public.js`) e `marketing/routes.social.js`; telas `blog.jsx` e `social.jsx`. |
| Componentes e visual | `web/src/tokens.css`, `atoms.jsx`, `components/viz.jsx`, `components/lead-blocks.jsx`, `lib/ui.js`. |
| Kanban compartilhado | `web/src/components/kanban/` (`KanbanBoard`/`KanbanColumn` + `useBoardDnd`): quadro, coluna, soltar, placeholder, corte "+N" e coluna recolhida. Tarefas, Tickets e Pipeline montam só o card e o que é do domínio em cima dela; layout `scroll` (colunas fixas que rolam sozinhas) ou `fill` (grid de colunas iguais, Pipeline). |
| Testes da API | `api/test/*.test.js`; repositório em memória em `api/test/helpers/mem-repo.js`. |

## Regras que precisam sobreviver às mudanças

**Agenda do SDR (20/09/2026):** a oferta automática usa `sdr-agenda.js`, com
S/A/B para Leonardo/Jonan/Jonathan e C/D/E (ou sem nota) primeiro para Vitor.
A seleção é nominal no workspace LeverAds, independente de `compLevel`;
Vitor também é elegível quando cadastrado como integrador. Se Vitor não tiver
horário no dia consultado, C/D/E usa a equipe de S/A/B nesse mesmo dia; S/A/B
nunca desce para Vitor. A oferta espontânea fica somente no próximo dia útil
(sexta/sábado/domingo → segunda), sem ampliar a janela quando lota. Outro dia
depende de pedido do cliente por texto ou áudio transcrito; o pedido persiste
na escolha da hora, mas não libera datas fora do período solicitado. Conversa,
resgate de no-show e replay usam a mesma política. Horário comercial, almoço,
ocupação e reservas continuam valendo. A rota manual `/api/agenda/free-slots`
mantém sua régua existente. Testes: `sdr-agenda.test.js`, `sdr-brain.test.js`,
`sdr-flow.test.js` e `sdr-humanizacao.test.js`.

**Cancelamento do SDR (21/09/2026):** quando o lead cancela ou avisa que não
poderá comparecer, `sdr-brain.js` cancela a call pelo fluxo canônico, libera
reservas e pergunta se ele gostaria de remarcar, sem oferecer horários nesse
turno. O estado `sdrLog.reschedule` persiste a espera pelo consentimento. Um
"sim" oferece horários atuais; somente a escolha posterior permite agendar.
Recusa ou resposta ambígua não libera agenda. Datas e ofertas anteriores ao
cancelamento não valem como pedido para a nova call. Áudio transcrito segue
a mesma regra; os testes ficam em `sdr-brain.test.js`.

1. **Receita de produto:** `rollupProduct` deriva clientes, ARR e MRR de
   `customers`, excluindo os churnados segundo `churn.js`. Não usar os números
   crus do produto. `syncCustomerArr` reconcilia assinaturas e preserva o
   histórico do cliente encerrado. Referência: `routes.rollup.test.js`.
2. **Contrato, receita reconhecida e caixa são medidas diferentes.** As regras
   atuais de pagamentos faturados, PIX parcelado e cartão recorrente passam por
   `metrics-core.js`; não somar `lead.amount` indiscriminadamente nas metas.
   Referências: `revenue-on-receipt.test.js` e `metrics-consistency.test.js`.
   Em Clientes, `GET /api/billing/cash/:saas?since=&until=` soma recebimentos
   confirmados de toda a base por `dateApproved` do MP ou `paidAt` da baixa,
   no dia de São Paulo. Reutiliza `cashReceivedByCustomer`, sem presumir a
   data pela criação do pagamento. Deduplica MP/fatura e exclui faturas
   nascidas pagas e pagamentos estornados. O a receber considera cobranças
   abertas/vencidas com vencimento na janela. Esses totais não compõem o
   contratado anualizado; o card não usa ARR para estimar caixa ou renovações.
   Referência: `customer-cash.test.js`. O endpoint `billing/received` continua
   sendo o acumulado por cliente usado na ficha e no status de pagamento.
3. **Estágio é semântico:** usar `funnel[].kind` e os helpers de `stages.js` /
   `web/src/lib/funnel.js`, em vez de comparar nomes visíveis. Reusar
   `applyStageMove` para preservar histórico, `stageSince`, cadência e efeitos
   do fechamento. Conferir o comportamento de `lead-flow.js` e seus testes.
4. **Autorização vive também no servidor:** autenticação própria com scrypt e
   sessões, além da chave de integração. Sem `COCKPIT_API_KEY` a API **não**
   abre: só vale a sessão. Não há admin com senha fixa; banco vazio ganha o
   admin de `BOOTSTRAP_ADMIN_USER`/`PASSWORD`, e senha nova exige 8+
   caracteres. Criar, editar, resetar senha e remover usuário
   (`/api/auth/users`, fora o GET) exige a etiqueta `admin` ou a key mestre
   (`screens.js`); sem ela, Ajustes → Equipe fica só leitura. CORS das rotas privadas só para as origens do cockpit
   (`cors-policy.js`); rotas abertas aceitam qualquer origem. A migração para a
   identidade central está em `docs/PLANO-AUTH.md`; `AUTH_MODE=dual|gotrue`
   (`auth-jwt.js`) aceita o JWT ES256 do GoTrue, validado pelo JWKS, só de
   staff do time (`is_staff` com o papel `team`) ligado a um usuário por
   `users.authUserId`; o `org_id` do token não conta, porque o super admin do
   LeverAds usa a mesma conta com a org de origem ativa. Telas, papel
   e `supportSaas` continuam vindo de `cockpit.users`. No SPA, `VITE_AUTH_URL` liga o
   login pelo LeverId (`lib/identity.js`, `@supabase/auth-js`): o JWT vai em
   `Authorization: Bearer`, é renovado sozinho, e um 401 "Unauthorized" no meio
   do uso renova uma vez e, se persistir, apaga a credencial e volta ao login.
   Vínculo do LeverId (`identity-admin.js`, `IDENTITY_*`): Ajustes → Equipe
   liga pelo e-mail (reusa conta existente, senão cria com `password_pending`),
   a senha do login antigo migra no primeiro login depois do vínculo (nunca
   sobrescreve senha já definida) e as etiquetas viram papéis de staff
   (`team`, `admin`, `support`) na identidade. O e-mail de definir/redefinir senha
   (admin na Equipe ou "esqueci minha senha" no login) volta ao cockpit com
   `#…type=recovery`, tratado no `main.jsx` antes do boot. Na tela Clientes, a
   badge de LeverId (`components/leverid-badge.jsx`) marca o cliente cuja org já
   tem conta na identidade: `GET /api/customers/leverid?orgs=` (domínio
   `customers/`, `leverid-accounts.js`, cache de 60 s por org) chama a RPC
   `identity_api.org_accounts` com a chave `svc_cockpit` e devolve, por org,
   papel, último acesso, e-mail confirmado e 2FA, nunca hash ou segredo. A org é
   `customer.orgId` ou, enquanto ele não existe, `customer.leveradsOrgId` (a
   carga preserva os ids). Sem `IDENTITY_*` a rota responde `configured: false`
   e a badge some; identidade fora do ar vira 424. Contas do LeverAds: o
   cadastro no produto não vira lead nem cliente (decisão do time); a cada 10
   min o job `leveradsOrgMirror` (`customers/leverads-orgs.js`) espelha as orgs
   em `leverads_orgs` (PRIVATE e SILENT, com os e-mails das contas vindos do
   LeverId quando configurado). A aba Gratuitas da tela Clientes lista as orgs
   sem cliente (gratuitas e pagantes sem cliente); elas **não** são
   `customers`, então não entram em KPI, churn, MRR, placar nem réguas. O
   vínculo `customer.leveradsOrgId` vem da ficha ("Vincular conta", as mais
   novas primeiro, para o integrador que cria a conta com o cliente na call),
   do cadastro, ou sozinho pelo e-mail quando o e-mail do cliente ou do lead é
   exatamente o da org ou de uma conta dela e o par é único
   (`orgLink.via = "email"`); desfazer guarda a org em `orgLinkRejected` para o
   automático não religar. Rotas em `/api/customers/leverads-orgs` e
   `/api/customers/:id/leverads-org`. `screens.js` controla permissões por
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
comprova isolamento. Desde 25/09/2026 a API lê `APP_ENV` (`local`, `dev`,
`production`; vazio = `production` na imagem Docker e `local` fora dela) e,
fora de produção, **recusa subir** com banco (`COCKPIT_DB_URL`,
`LEVERCOPY_DB_URL`, `ELO_DB_URL`) ou API do LeverAds de produção
(`app-env.js`). Fora de produção os jobs de fundo nascem desligados:
`JOBS_ENABLED=1` liga todos e `JOBS=nome,nome` só os da lista (nomes nos
`jobOn("…")` do `start` de cada domínio, `<domínio>/index.js`, e da migração
pós-listen no `index.js`); `JOBS_ENABLED=0` desliga todos até em produção.
O `.env` local aponta para o `levercopy-dev` (host `levercopy-dev.invalid`,
ainda não provisionado); a API só sobe localmente quando esse banco existir ou
com o Postgres do `infra/local`. Não copiar seus valores para logs, documentação ou commits.
`seed:clear` apaga dados e não é passo de preparação de ambiente.

Banco isolado disponível: `docker compose -f infra/local/docker-compose.yml up -d`
sobe só a infraestrutura (Postgres do Supabase em `localhost:54322`, Studio em
`http://localhost:54323`); os pacotes rodam fora do Docker. O `.env.example` já
aponta `COCKPIT_DB_URL` para esse banco. Integrações ficam vazias no `.env`
local, porque as rotinas do boot usam credenciais reais se existirem. Em
14/09/2026, a API subiu nesse banco (77 tabelas, migrações, login, criação de
produto e `seed:leverads-questions`); o único aviso esperado é
`[leverads-results]`, pois a função do Levercopy não existe localmente.

Após a validação, seguir a autorização do Leonardo: verificar `origin/main`,
commitar os arquivos da tarefa na branch de trabalho, fazer push, abrir e
mesclar o PR para `main`, sem force-push nem mudanças alheias. O redeploy no
EasyPanel é manual pelo Leonardo (o serviço `extrator_mp_saasmngmnt` está com
`autoDeploy` desligado, conferido em 23/09/2026: merge na `main` não sobe
sozinho); lembrar após o merge e verificar a produção
quando a nova versão estiver disponível.

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

- **Pizza do Financeiro (16/09/2026):** `GastosCard` usa
  `fin.receber.recebidosMes` como 100%; as categorias da DRE (incluindo IA e
  WhatsApp) mostram custo ÷ recebido e o restante aparece como saldo. A base
  acompanha produto/mês e é a mesma do indicador "recebido no mês". Sem receita,
  não há percentual; com déficit, a legenda preserva os percentuais reais e
  mostra o excedente sem desenhar uma pizza ou normalizar pelo total de custos.

- **Múltiplas contas Meta por produto (16/09/2026):** `metaAdAccount` continua
  sendo a conta principal para criação de criativos e automações de veiculação.
  `metaAdAccounts` é uma lista adicional de IDs para leitura, configurável pelo
  PATCH do produto; `meta-accounts.js` normaliza `act_` e deduplica a união.
  Sync manual/automático, catálogo de atribuição, objetos de anúncio e
  posicionamentos leem todas as contas do produto. Insights guardam `accountId`
  e preservam o upsert por produto+anúncio+dia. Falha parcial retorna `ok:false`
  e relatório por conta; mantém dados da conta indisponível e não atualiza o
  horário de sincronização completa. Posicionamentos só mostram o total quando
  todas responderam. Cache inclui a lista de contas. Não altera permissões Meta,
  orçamentos nem as contas de outros produtos. Testes em
  `api/test/routes.marketing-accounts.test.js`.

- **Formulários por linha (16/09/2026):** a decisão é usar 100% dos novos
  formulários: `[OEM]` → `fo_oem_v2`, `[ADS]` e dores legadas A–E → `fo_ads_v2`,
  `[PRICE]` → `fo_price_v2`. A entrada antiga sem origem usa Ads; links diretos
  dos novos sem origem preservam a linha. `form_ab` continua sendo a configuração
  operacional, com `pct: 100` independente de cookie/fbclid. A migração
  `ensureFormsV2FullRouting` ativa uma vez, quando os três destinos já estiverem
  publicados, e preserva ajustes posteriores pelo marcador `fullRoutingV1`.
  O roteamento em `/f/:id` mantém a URL/UTMs e serve a definição do destino;
  eventos e envios ficam no formulário servido. `formProduct` vem dessa
  definição e acompanha o lead/classificação. Anúncio ausente dos insights
  resolve o nome na Meta (anúncio → conjunto → campanha), com cache limitado,
  prazo de 2,5 s e sem retentativas demoradas. Falha usa o destino padrão.
  Não criar insights fictícios para resolver atribuição. Testes específicos:
  `form-ab.test.js` e `routes.form-routing.test.js`.

- **Calls realizadas nos formulários (15/09/2026):** `/api/forms/:id/funnel`
  retorna `callsShown`: leads únicos dos envios externos do período que
  compareceram à call, pela regra de `callOutcome`/`callWitness`. A janela
  seleciona os envios; o desfecho acompanha o lead, como nos ganhos do form.
  A lista mostra envios → calls realizadas → clientes; `variants[].calls`
  continua medindo agendamentos do teste A/B.

- **Cases da apresentação C (14/09/2026):** os quatro cases do painel usam o
  acumulado de cada cliente em `org_revenue_generated`, com valores brutos e
  data de apuração guardados em `cases.evidence`. São snapshots conferidos,
  sem extrapolar a janela de 30 dias. Pedidos substituem crescimento mensal;
  tempo e custo mantêm 10 minutos por anúncio e R$ 3.000 / 220 horas.
  `ensurePanelCases` atualiza esses registros uma vez por marcador, preservando
  autorização e publicação. Propostas já geradas guardam cópias em `data.cases`:
  atualizar o case central não altera essas cópias; correções nelas passam pela
  API REST e preservam `state`, preços e demais dados da proposta.
  A sincronização dos dados do lead ao abrir o modo closer preserva os demais
  campos de `data`, incluindo `cases`; o compartilhamento copia esse snapshot
  para o mesmo link do cliente. Cobertura: `proposal-slides.test.js`.

- **Resumo vivo da apresentação C (15/09/2026):** o texto abaixo dos cases
  recebe `leveradsPresentationResults()` ao servir o HTML, inclusive em
  propostas antigas e no preview. Faturamento, receita da Lever e percentual
  usam juntos `since_gmv` / `since_leverads` do `dashboard_portfolio`, com a
  mesma cobertura por cliente e a operação interna excluída. O all-time de
  `org_revenue_generated` não é o numerador dessa comparação. A página mostra
  a data inicial da base e a data da consulta; não afirma receita incremental
  causal. O servidor aquece e renova o cache a cada seis horas. Falhas mantêm
  o último resumo bom com sua data; cache frio mostra indisponibilidade, sem
  os antigos valores fixos. Estado comercial e preços congelados continuam
  iguais. Testes: `api/test/leverads-results.test.js`.
  Novas apresentações C e o preview de LeverAds escolhem apenas cases
  publicados e autorizados de autopeças. Os outros decks mantêm sua seleção
  por nicho; cópias de cases em apresentações antigas ainda exigem atualização
  explícita via REST.

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
  O desempenho do time usa `/?shell=1&team=1#overview`, com oito pessoas
  fictícias em `preview/team-mock.js`: SDR, closer, CS, mídia, metas zeradas,
  ausentes e acima de 100%. Aceita `&theme=dark` para conferir os cards;
  a fixture também fica restrita ao preview.

- **Cards de leads (14/09/2026):** a ficha global `LeadDetail` usa `Drawer` de
  520px seguindo o protótipo: próximo passo, ação e histórico antes dos dados
  complementares. `components/lead-card.jsx`/`lead-card.css` fornecem superfícies,
  expansão e marcador de qualificação. `lead-blocks.jsx` mantém a compilação dos
  dados e os blocos de resumo/roteiro compartilhados por ficha, Minhas Atividades
  e inbox. A abertura pelas outras telas continua no `openLead` global; movimentos
  e agendamentos usam os mesmos handlers e gates existentes.

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
  (Kanban por status, com Resolvido e Fechado juntos na coluna Concluídos,
  Aguardando cliente e Em espera juntos em Aguardando, o círculo de concluir e
  menu do clique direito no card, e o nome do cliente cadastrado — vinculado ou
  reconhecido por e-mail/telefone/nome — abrindo o cartão do cliente; e Lista
  agrupada pelo SLA; detalhe em modal `#tickets/<id>`) e
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
  para tickets abertos ou alterados depois. Ticket que segue concluído não é
  reavaliado: editar assunto, prioridade ou passar de Resolvido a Fechado mantém
  prazos e estouros da conclusão (`nextSla`; reparo único dos já afetados em
  `repairDoneTicketSla`, 29/09/2026). (4) **Nota interna nunca sai pelo
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
  desvincular nunca apaga issue no Linear;
  (7) **card aberto direto no Linear vira ticket (22/09/2026):** issue sem
  ticket no projeto configurado de um produto com o espelho ligado entra pelo
  webhook e pela reconciliação (`importLinearIssue`): ticket já vinculado e
  `adopted`, ator `linear`, cliente pelo `[Cliente]` do título (nome único) e
  comentários existentes em `seenComments`. A issue que o próprio espelho criou
  é reconhecida pelo cabeçalho da descrição (`isCockpitIssue`) e nunca vira
  segundo ticket. O que é anterior ao cursor da reconciliação entra pelo script
  `packages/api/scripts/2026-09-21-importar-cs-suporte-linear.mjs` (dry-run
  por padrão, mesma função; rodado em produção em 23/09/2026, 38 tickets).
  Desde 23/09 o ticket importado nasce **sem descrição** (o relato fica na aba
  Linear; descrição do ticket aparece na Conversa como pedido do cliente) e com
  **categoria pela combinação de etiquetas** do CS (`categoryFromLabels`:
  `Código · Bug/Feature/Improvement`, `Operação · Produção`, `Operação`; o
  resto, como a data `DD.MM`, vira tag; a combinação entra na lista de
  categorias do produto). Na volta (`applyLinearIssue`), ticket **sem**
  categoria ganha a das etiquetas postas depois, e issue `started` (In
  Progress/In Review) tira o ticket do **Novo** para Em atendimento — o
  `stateBack` não cobre isso porque os dois são o mesmo kind. Os scripts
  `2026-09-23-*-importados-linear.mjs` acertaram os tickets de antes disso.
  (8) **responsável espelhado nos dois sentidos (24/09/2026, `syncAssignee`,
  ligado por padrão):** de-para de pessoas em `linearIdForUser` /
  `userIdForLinear` — ajuste manual em `linear.people` (`{ usuário: idLinear |
  "none" }`, tela "Quem é quem no Linear"), depois e-mail (`u.email` ou a conta
  Google conectada `u.google.account` × `users` do Linear), depois nome único.
  Sem par, o espelho **não mexe** no outro lado (e a atividade registra quem
  pegou a issue). O retrato guarda `mirror.assignee` (responsável do ticket no
  último sync: só troca **daqui** sobe) e `mirror.assigneeId` (assignee da issue
  visto por último: só troca **de lá** desce); retrato antigo sem os campos só
  vira linha de base. O webhook de issue traz `assigneeId`; o e-mail vem da
  lista de pessoas do Linear (cache de 10 min). O número da issue (`LEV-873`)
  aparece ao lado do `#número` na lista, no quadro e no detalhe, e a busca da
  fila acha por ele — o Linear numera por time e não deixa escolher o número,
  então os dois convivem.
  `LINEAR_API_KEY` vazia deixa tudo
  dormente. `ticket.linearIssueId` fica no topo do doc (índice
  `tickets_linear_issue_idx`) porque é por ele que o webhook acha o ticket.
  Fora desta entrega: anexo do ticket virar anexo da issue e ferramenta de MCP
  própria.
- **Suporte — Hermes (08/10/2026):** o Hermes (repo Hermes-VPS) corrige bug de
  cliente no Linear, seguindo o "Tutorial-Hermes" (23/09/2026): etiqueta
  `Hermes`, colunas Validar / Aguardando resposta / Aprovado e comandos em
  comentário. **O Linear segue como fonte da verdade e não existe "ticket do
  Hermes":** o ticket é o mesmo, e `ticket.hermes` (MANAGED, ator `linear`) é o
  retrato do card. Ele guarda `labeled`, `active` (etiqueta e ninguém do time
  atribuído), `holding`, `phase`, `needsHuman` (validar/pergunta), `history`,
  `version`, `handoff`, `requested` e `lastAction`. Ligado por produto em
  `ticket_settings.linear.hermes` (Configurações de SLA → Linear → Hermes).
  Invariantes: (1) a fase vem do **nome** da coluna (`shared/hermes-phase.js`,
  a mesma régua na SPA) ou do de-para manual por id, porque o tipo do Linear
  não distingue Validar de Aprovado; (2) o texto do Hermes **nunca** entra no
  doc: o card de validação, a pergunta e o rascunho são lidos ao vivo em
  `GET /api/tickets/:id/linear` (`hermesView`), e `publicTicket` não conhece
  o campo; (3) o espelho de saída **não mudou**: atribuir o ticket a alguém
  com par no Linear tira o caso do Hermes ("Melhor uma pessoa fazer") e
  concluir leva o card a Done. A tela só confirma antes (`confirmHermes`);
  (4) as ações (`POST /api/tickets/:id/hermes`: aprovar, ajuste, recusar,
  responder, revisao, perguntar, desistir, reverter, passar_time, entregar) saem pela
  **chave única** do Linear, com o comando na 1ª linha e o rodapé
  "— nome, via Cockpit". O id do comentário entra em `linear.posted`. Quem
  decide são os `approvers` do produto, **só admin edita** essa lista
  (403 `hermes_approvers_admin`), e entregar vale para quem atende o produto.
  Aprovar relê o card e recusa versão diferente da lida (409
  `version_changed`). Tudo depende de `hermes.actions` ligado; (5) "Entregar ao
  Hermes" tira o assignee da issue e comenta `hermes: assumir`. Esse comando
  ainda precisa ser implementado no Hermes-VPS, assim como aceitar o dono da
  chave e o rodapé. Até lá, deixar `actions` desligado. O aceite chega pela
  etiqueta posta no card. Aviso no sino só aos aprovadores do escopo, ao entrar
  em Validar/Aguardando resposta, e `COUNTERS.ticketsHermes` acende o badge de
  Tickets. Ligar o Hermes (ou trocar etiqueta, usuário ou de-para) relê em
  segundo plano os cards dos tickets abertos (`backfillHermes`): o retrato só
  nasceria quando o card mudasse. Da releitura, só o último card de validação
  e o último "no ar" viram evento, e repetir não duplica. A mesma releitura
  roda sob demanda (`POST /api/support/settings/:saas/hermes/reread`, link
  "reler os cards do Hermes agora"). (6) **Parado ≠ pergunta (08/10):** o
  Hermes também deixa o card em "Aguardando resposta" quando para por falha
  da bancada ("Parei…", "bancada instável", "falha de infraestrutura"). Esse
  comentário é `kind: "stalled"` e grava `hermes.stalled` (motivo e data). O
  chip vira "Hermes · Parado" e a aba Linear mostra o motivo e quem destrava.
  A parada some quando o card sai de "Aguardando resposta" ou quando chega
  outro comentário do Hermes. (7) **Enviar para revisão** (`revisao`, só na
  fase pergunta) move o card para a coluna de revisão e comenta
  `revisão: seguir sem a resposta da pergunta`. Se o Hermes achar dúvida nova,
  ele devolve o card para "Aguardando resposta" e a fase acompanha a coluna.
  O Hermes-VPS precisa reconhecer esse comando, como o `hermes: assumir`.
  A pergunta na aba Linear mostra só os pedidos de "Precisa de:" (a API manda
  o comentário inteiro, que segue em Comentários). As amostras de comentário dos testes seguem o PDF e devem ser
  trocadas pelas reais. Testes em `ticket-hermes.test.js` (Linear falso
  compartilhado em `test/helpers/fake-linear.js`). Prévia com
  `/?shell=1&hermes#tickets` e `&hermes&linear#support_settings`.
- **Inbox (14/09/2026):** `whatsapp.jsx` + `whatsapp.css` seguem a prancha do
  handoff, com lista/chat/card responsivos. O filtro “Sem resposta” usa
  `lastDir === "in"`, como `awaiting` da API; “Aguardando cliente” guarda a
  fila de saída. Cadastro e vínculo usam o CRUD de leads e `waLinkThread`
  existentes. Preview fictício: `/?shell=1&inbox=1#whatsapp`; acrescente
  `&empty=1` para vazio ou `&dark=1` para tema escuro. O smoke inclui Inbox
  e mensagens do robô; envio e navegação também pedem conferência no browser.

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

## Classificação por faturamento (21/09/2026)

- `api/src/shared/lead-grade.js` é a régua pura compartilhada com a SPA. LeverAds com
  faixas válidas de `orders` e `ticket` usa a estimativa mensal (100/350/750/1500/3000
  pedidos × R$ 50/110/225/450/800): S ≥1 milhão; A ≥500 mil; B ≥200 mil;
  C ≥100 mil; D ≥50 mil; E abaixo de 50 mil. ICP mantém S/A/B (≥200 mil).
- Sem as duas respostas válidas, a nota anterior de contas × anúncios/volume
  permanece e o badge mostra `L` (Legado). Sem nenhum dado, não inventa nota.
  Intenção e MQL continuam separados do porte. Outros produtos não migram.
- `ensureRevenueClassification` atualiza snapshots elegíveis e o texto do ICP
  no boot, com versão por lead/produto, sem mover etapas, agenda ou responsáveis.
  Formulários, CRUD e reenvios recalculam ao receber respostas novas.
- Os Dockerfiles de build web copiam a pasta `api/src/shared/` (módulos puros que a SPA importa).
  Validar limites, preservação do legado, migração idempotente e paridade API/SPA
  em `revenue-grade.test.js`, além da suíte API, smoke web e build.
- Preview isolado dos badges e ICP: `/?shell=1&review=pipeline&revenueGrades=1#pipeline`
  no Vite preview; inclui S–E, dois legados e um lead sem qualificação.

- **Card de Minhas atividades (21/09/2026):** segue o desenho “Atalhos.pdf”: atalhos
  em largura inteira, apresentação/respostas lado a lado, histórico e próximo
  passo. O roteiro saiu do card; sua prévia em Ajustes → Scripts permanece.
  Desde 06/10/2026 a configuração do deck de SLIDES é desenhada pelo próprio
  cockpit (`components/presentation-config.jsx`: `.inp`, `SelectPopover`,
  `Checkbox`, `Choice`), lida e gravada por `GET`/`PUT
  /api/leads/:id/proposal-config` (mesmo `state.deckC` e mesma regra do PATCH
  público, `deckConfigState`/`saveDeckConfig` em `proposals/proposal.js`). A
  conta e os planos escolhíveis vêm de `api/src/shared/deck-offer.js`
  (`calcOferta`, `deckChoices`), a mesma fonte injetada na página do deck:
  todo produto `<linha>_<pacote>` do catálogo vira opção com o nome do plano,
  sem lista fixa de Essencial/Escala. Deck OEM e proposta de fora seguem no
  iframe `GET /p/:id?embed=config&k=…`. **Catálogo vivo:** a proposta de
  trabalho do closer (slides, com `editKey`) recebe a tabela atual do template
  (`syncProposalCatalog`) ao abrir a tela zero, no PATCH, nas ofertas e no
  envio; o link do cliente continua com a oferta congelada no envio e sem
  tabela. Validação: `test/proposal-deck-config.test.js` e
  `cd packages/web && node scripts/review/today-card.mjs` (API fictícia).

- **Atalhos do lead (21/09/2026):** `components/lead-send-actions.jsx` reúne os
  botões e as operações de gerar apresentação/enviar oferta principal usados
  no pipeline e nas atividades. O envio continua preparando a oferta de cliente
  via `shareProposal`, sem compartilhar a chave de edição do closer. Atividades
  usa pagamento e proposta no WhatsApp em linha, com o mesmo modal de pagamento;
  geração explícita e menu ⋯ ficam apenas no pipeline.
  Revisão isolada: `cd packages/web && node scripts/review/today-shortcuts.mjs`.

### Resumo rápido no follow-up — 21/09/2026

Nas atividades, cartões de kind `followup` mostram a última activity
`call_summary` de venda (`meta.kind = call`, ou ausente no legado), entre os
blocos de apresentação/perguntas e o histórico. Resumos de integração não
substituem esse contexto. Novos resumos gerados por `anthropic.js` incluem
`summary.retomada` com `combinado`, `objecoes` e `beneficios`: uma frase curta
por campo, apenas informações explícitas da transcrição. Resumos antigos usam
`compromissos` e `objecoes`; benefícios ausentes são sinalizados como não
registrados. Abrir o cartão só consulta a REST, sem gerar resumo nem enviar
mensagem. Validação de navegador: `node scripts/review/followup-summary.mjs`
em `packages/web`.

### Agenda no relógio de Brasília — 09/10/2026

A Agenda desenha, compara e grava em hora de Brasília qualquer que seja o fuso
do navegador. `lib/format.js` tem `brtMs` (valor sem fuso = Brasília, offset
fixo -03:00 como o `brtToIso` do servidor) e `bizWall`/`bizNow`, que devolvem
uma Date cujos campos locais são os de Brasília. A grade converte cada
compromisso, o "hoje", a linha do agora e o padrão do "Criar compromisso" por
eles; a tela usa o mesmo relógio nos avisos, na conferência de conflito e no
"já passou" do arrasto, e o `slotVal` grava a hora de Brasília. A régua de
ocupado de `today.jsx` (`callBusyKeys`, `integBusyKeys`, consultas do
`busyView`, `useGoogleBusy`) passou a ler os horários por `bizWall`; no
navegador em Brasília o resultado é o mesmo de antes. Comparar "já aconteceu"
continua por instante real (`Date.now()`). Outras telas (Minhas atividades,
SlotGrid, campos de data do card) ainda usam o relógio do navegador.

### Telefone no topo do card — 09/10/2026

O card do lead no layout padrão (o que a Agenda e as demais telas abrem; o
painel compacto do Pipeline não mudou) mostra o telefone ao lado do nome, sem
borda, centrado opticamente no nome (meio dos dígitos na altura do meio das
letras, com ou sem selo de nota; desce pra linha de baixo só quando não cabe), com cursor de link, formatado por `phoneLabel` (`lib/ui.js`, mesmo desenho da Inbox). Um clique
copia o número formatado (`LeadPhoneCopy` em `deal.jsx`), com "copiado" no
botão e aviso; se o navegador bloquear, o aviso diz isso sem diálogo nativo.
Lead sem telefone não mostra o botão.

### Filtro de pessoas na Agenda — 09/10/2026

"Agenda de" escolhe VÁRIAS pessoas da equipe (closers e integradores do
produto ativo); lista vazia = todos. É sempre um seletor (botão no formato
pílula que abre o `UserPicker` de seleção múltipla, com "todos" na primeira
linha via `allLabel`), pra caber na barra com qualquer tamanho de equipe; o
tipo de evento ao lado usa o `SelectPopover`, sem `<select>` nativo. A grade
(`personIds`) mostra só
as faixas, eventos e bloqueios dessas pessoas; compromisso de várias pessoas
aparece se alguma participante estiver no filtro, mas só abre faixa das
filtradas. Com uma pessoa só, o fato do período continua falando dos buracos
da agenda dela. A escolha fica no navegador, por pessoa e produto, em
`cockpit_agenda_people:<usuário>:<produto>` (JSON, mesma régua de
`tasks/prefs.js`); não vai para o servidor, então não acompanha a pessoa em
outro computador. O valor antigo de uma pessoa (`cockpit_agenda_person`) vira
a lista na primeira abertura, e id fora da equipe do produto é ignorado.

### Arrastar na Agenda — 09/10/2026

Na grade da Agenda (Dia, Semana e Equipe; o Mês não tem horas) dá pra
arrastar call e integração futuras e compromisso/bloqueio com horário. O
destino anda em passos de 30 min; no Dia e na Equipe a coluna em que o item
cai troca a pessoa (call → `closer`, exige papel closer; integração →
`integrator`, exige papel integrador; compromisso troca só a participante
daquela faixa). Na Semana a pessoa fica. `agenda-grid.jsx` só informa o
destino (`move.check`/`move.apply`); `agenda.jsx` confere com a régua da
SlotGrid (`callBusyKeys`/`integBusyKeys`: agenda ocupada, bloqueios, consultas
e horário de atendimento), recusa horário passado e mostra o motivo em
vermelho durante o arrasto. Call/integração pedem confirmação num balão
ancorado no destino (`Popover`, nunca o `window.confirm`; o Meet move e o
convidado recebe o e-mail do Google) e gravam pelo PATCH de leads
(`callAt`/`integrationAt`, confirmação zerada, `closer`/`integrator` quando
troca); bloqueio pontual vai direto para `agenda_blocks`, o recorrente pede
confirmação no mesmo balão e muda todas as semanas. O que arrasta mostra o
cursor de mão (`grab`/`grabbing`). Call passada, consulta 1:1, follow-up e toque não
arrastam. O hook `useBoardDnd` do Kanban mede índice em lista e não serve à
grade de horas; o arrasto segue só as convenções dele (HTML5 nativo, `setData`,
`.is-dragging`).

### Horário de atendimento — 07/10/2026

`users.workHours` (`[{ weekday 0-6, from, to }]`, horas em passos de meia
hora; `[]` = agenda aberta 7h–21h) é o expediente de cada pessoa, editado em
Ajustes → Equipe → ⋯ → Horário de atendimento (`PATCH /api/auth/users/:id`).
Ele espelha o link de convite do Google, cujas regras a API do Google não
expõe. A régua mora em `api/src/shared/work-hours.js` (`offWorkHours`): a meia
hora fora de uma faixa conta como ocupada no `busyView` do SPA (grades de
call, follow-up, integração e remarcar) e no `busyOf` do servidor (oferta do
SDR automático). A conferência de conflito ao salvar (`integration-slot.js`)
não olha o expediente, e a tela Agenda não sombreia o fora do horário. A grade
semanal da integração (`WeekSlotGrid`, só hora cheia) esconde o horário
ocupado ou passado e tira a hora sem vaga em nenhum dia.

### Follow-up em 4 contatos, por dia — 05/10/2026

Follow-up marca só o **dia** e nunca ocupa a agenda: `lead.followupAt` é
`"YYYY-MM-DD"` (valor com hora, legado ou ISO, é truncado para o dia de
Brasília em `canonWhen`), e o GPS (`nextActionAt`) fica em 00:00 de Brasília
desse dia. `busyOf`, `callBusyKeys` e a Agenda não tratam follow-up como
horário; na Agenda ele aparece na faixa "dia" do topo da coluna.

A sequência tem 4 contatos explícitos. `lead.followupStep` (0–4) conta os
contatos registrados na passagem atual pela etapa; entrar no follow-up zera o
passo e marca o Contato 1 no dia escolhido (ou hoje + prazo do Contato 1). Só a
activity de toque com `meta.followupContact: N` avança: o próximo contato cai
`prazoDias` úteis depois do dia do registro. Depois do 4º, `followupAt` fica
vazio e o card espera na fila de hoje o destino que o operador escolher; nada
se move sozinho. Outros toques na etapa (Inbox, robô, ligação avulsa) não
mexem no dia nem no passo. O chip "retomar" saiu do follow-up.

Mensagens e prazos são **uma configuração global** em
`app_config/followup_contacts`, editada em Geral → Configurações → Follow-up
(`GET`/`PUT /api/followup-contacts`; escrita exige a tela `settings`, inclusive
pelo CRUD de `app_config`) e enviada em `CONFIG.followupContacts` no bootstrap.
A régua pura é `api/src/shared/followup-contacts.js`, importada pela SPA (copiada nos
dois Dockerfiles de build web). Os roteiros `followup1/2/3` viraram o roteiro
único `followup` (postura); `nextSteps.followup1..3` salvos não valem mais.
Cada contato pode ter uma **imagem** opcional (`imagem`, só o caminho
`/public/followup/fua_…`; outro valor vira vazio na normalização). O upload é
`POST /api/followup-contacts/image` (PNG/JPG/GIF/WebP até 3MB, mesma permissão
de escrita da tela `settings`), guardado em `followup_assets` (privada no CRUD)
e servido pela rota aberta `/public/followup/:id`. A imagem só vale ao salvar a
configuração; ao trocar ou remover, o arquivo antigo é apagado. No painel do
contato aparece a miniatura e "Copiar imagem", que põe um PNG na área de
transferência (outros formatos passam por canvas).
`migrateFollowupDays` (marcador `app_config/followup_days_v1`) truncou os
`followupAt` com hora e estimou o passo de quem já estava na etapa pelo
contador de toques (máximo 3). No placar, "follow-up em dia" compara o dia.
Testes: `api/test/followup-contacts.test.js`, `lead-flow.test.js`,
`routes.when-canon.test.js`, `routes.scoreboard.test.js`; no navegador,
`node scripts/review/followup-contacts.mjs` e
`node scripts/review/agenda-followup.mjs` em `packages/web`.

### Reuniões com o cliente — 05/10/2026

A reunião com cliente mora no lead dele (`customer.leadId`), nos campos da
integração (`integrationAt`, `integrationCallUrl`, `integrationMeetEventId`),
e é resumida pelo mesmo poller de `call-summaries.js` (`kind: "integracao"`).
`POST /api/customers/:id/meeting` marca a próxima: se a anterior já aconteceu,
tenta resumi-la, solta a sala e cria Meet novo (título "Reunião"); se ainda vai
acontecer, só remarca. Sala reaproveitada não ganha resumo novo, porque o dedup
compara `integrationSummaryFor` com o id do evento. Transcrição antiga ainda
pendente devolve 409 `previous_without_summary` e só segue com `force`.
`POST /api/customers/:id/meeting-summary` gera o resumo pela permissão de
Clientes. Na ficha lateral, a seção Reuniões mostra próxima reunião, último
resumo e o motivo quando ele não sai; ⋯ → "Histórico e resumos" abre a vista
própria (`components/customer-history.jsx`): reuniões, resumo escolhido e timeline. Testes: `packages/api/test/customer-meeting.test.js`.
Correção junto: `repo.listWhere` (db.js) mandava a chave de uma faixa sem
limite como parâmetro sem placeholder, e o Postgres recusava a consulta; desde
`6aa068f5` (17/09) `GET /api/activities?lead=` sem `since` voltava 500 e toda
timeline de lead (Pipeline, Atividades, Clientes) aparecia vazia, com os
resumos de call. O SQL agora sai de `listWhereSql`, testado em
`db-listwhere.test.js`.

### Alvos progressivos da Visão Geral — 21/09/2026

O card da meta avança o alvo visual para 120%, 140%, 160% etc. assim que o
resultado atinge o alvo anterior, apenas em períodos não encerrados. A meta
cadastrada e o percentual realizado sobre ela são preservados. `goal-milestone.js`
centraliza o alvo, o valor faltante, a diferença para o pace e o ritmo diário
necessário. Termômetro e comparação da projeção usam o mesmo alvo. Períodos
encerrados conservam a meta original; sem dias restantes não há divisão.
Testes: `test/goal-milestone.test.js` e `scripts/review/goal-milestones.mjs`
em `packages/web`.

## Planos, plano do cliente e acesso (02/10/2026)

**Catálogo único.** A coleção `plans` (docs com `v: 2` e `code`) é a fonte do
que se vende: linha, pacote, preço por ciclo, limites, entregáveis e o produto
em que o plano libera acesso (`access.product`: `leverads` | `leverprice` |
vazio). O id é determinístico (`plan_<saas>_<code>`) e o código é o mesmo de
`lead.dealProduct`. O `calc.catalog` de `pt_leverads` / `pt_leverads_slides` e o
`calc.mentoria.products` de `pt_mentoria` são PROJEÇÃO dos planos
(`syncPlanCatalogProjection`, a cada escrita de plano e a cada boot); o renderer
das propostas não mudou e a projeção não regrava proposta gerada. A exceção é a
proposta de trabalho do deck de slides, que copia a tabela do template quando o
closer a abre (`syncProposalCatalog`, ver o card de Minhas atividades). Linhas, régua
contas → pacote e adicionais moram em `app_config/plan_catalog_<saas>`. A
semente (`ensurePlansCatalog`, marcador `app_config/plans_catalog_v1`) nasce do
catálogo que está no BANCO. `migrateCatalogPricing` / `pricingV` ficaram
congelados: reprecificar é editar o plano, que sobe `priceVersion` e guarda o
`priceLog`. Doc de `plans` sem `code` é o cadastro antigo e segue o CRUD
genérico sem regra. Sem planos semeados, o bootstrap e a edição de template
seguem pelo caminho antigo.

Invariantes: (1) **só admin escreve plano v2, a configuração do catálogo e a
tabela de preço pelo template** (403 no servidor; a key mestre passa);
(2) plano em uso não se apaga (409), arquiva; (3) ciclos e planos de fechamento
têm uma fonte só, `plan-cycles.js`, importada também pela SPA (os dois
Dockerfiles de build web copiam o arquivo, como o `lead-grade.js`); (4) a régua
contas → pacote (`pkgOf`) aplica o mapa do banco POR CIMA do padrão do código,
então faixa nova do form não cai em Essencial calada.

**Plano do cliente.** `customers` e `subscriptions` guardam `planCode`,
`planCustom` (venda fora do catálogo), `planCycle` (cliente) e `planSnapshot`
(retrato do plano na venda: preço de tabela, versão, limites, produto de
acesso). `customer.plan` continua sendo o mesmo rótulo de texto, derivado.
Nenhuma régua de receita lê esses campos. `plan_changes` (PRIVATE, append-only)
registra início, reedição do fechamento, upgrade, troca agendada/aplicada,
upsell, churn e edição manual; leitura por `GET /api/customers/:id/plan-history`
e `GET /api/plan-changes`. O backfill (`backfillCustomerPlans`, marcador
`app_config/customer_plans_v1`) não inventa preço de tabela histórico e não toca
arr, preço, ciclo nem rótulo.

**Mais de um produto por cliente (02/10/2026).** O plano vive na ASSINATURA:
um cliente pode ter o LeverAds num plano e o LeverPrice em outro, cada um com a
sua assinatura (no máximo uma viva por produto; do mesmo produto é troca de
plano). `POST /api/customers/:id/subscriptions` abre a assinatura de um produto
novo (1ª fatura em aberto, ARR somado por `syncCustomerArr`). O cadastro do
cliente espelha a assinatura PRINCIPAL (a mais antiga viva com plano) em
`planCode`/`planSnapshot`/rótulo e lista todos em `customer.products`
(`syncCustomerPlanFromSub`). Os direitos saem por produto (um por grupo de
assinaturas), e os números da tela Planos contam o cliente em cada plano com o
valor da assinatura dele; o caixa, que é por cliente, é repartido na proporção
do contratado. Na ficha, tudo fica em Gerenciar cobranças: "Produtos
contratados" (Mudar plano, Adicionar produto) e "Contrato" (status do
pagamento, valor anual, cliente desde, churn). Teste: `multi-product.test.js`.

**Acesso e limites.** `entitlements.js` calcula, por cliente × produto, o acesso
(status da assinatura) e os limites (do `planSnapshot`, não do plano vivo). O
adaptador do LeverAds (`leverads-access.js`) continua escrevendo SÓ
`payment_active`; a diferença de limites (contas → `paid_seats`, cota de OEM →
`creator_quota_*`, Price → `leverprice_enabled`) sai em `report.limits` como
relatório, com `apply` ou sem. `/api/entitlements/{status,run,customers/:id}`
são as rotas; `/api/leverads-access/*` segue como alias. As duas famílias pedem
a tela Clientes, e forçar `apply` pede etiqueta admin.

**Recursos do plano = recursos da org no LeverAds.** `plan-resources.js` é o
registro único (compartilhado com a SPA, copiado nos Dockerfiles): limites
(`accounts` → `paid_seats`, `copiesPerDay` → `per_seller_daily_limit`,
`oemPerMonth` / `oemPerYear` → `creator_quota_limit` com período mensal ou
anual, `listings` do Price) e módulos
(`bulkEdit`, `copyRules`, `stockMirror`, `sac`, `aiQuestions`, `compat`,
`oemCreator` → as flags `*_enabled` da org). Recurso novo entra nessa lista e
aparece sozinho no editor de plano, no retrato da venda e no relatório.
Limite ausente = não se aplica; `null` = ilimitado; módulo ausente = o plano
não diz nada (não é comparado). `ensurePlanResources` (marcador
`app_config/plan_resources_v1`) preencheu os planos de assinatura do LeverAds
com todos os módulos, cópias por dia por conta de destino (teto de 8.000: Escala
8.000, Essencial 500) e o Criador OEM só na linha "+ OEM" (200 por mês no
Essencial, ilimitado no Escala), conforme a planilha "planos lever" de
02/10/2026. Estoque Espelho é recurso próprio, não é a equalização da
apresentação. A mesma migração renomeou os planos como a planilha os chama
("Ads Essencial", "Ads Escala", "Ads Enterprise" e as versões "+ OEM"; os
códigos `ads_*` / `oem_*` não mudaram), só onde o nome ainda era o da semente. A
edição da tabela de preço pelo template preserva esses campos.

**Tela Planos (Comercial → Planos, só admin).** `web/src/screens/plans.jsx` é a
gestão do catálogo: agrupa por PRODUTO (`plan.product`: `leverads`, `leverprice`
ou `mentoria`, lista em `PLAN_PRODUCTS`), com filtro por produto na listagem. Mostra preço,
limites e recursos, e quanto cada plano rende: `GET /api/plans/stats/:saas`
(só admin) devolve assinantes ativos e churnados, contratado (`customer.arr`
dos ativos), MRR e recebido (`cashReceivedByCustomer`) por plano, mais os
baldes `custom` e `none` de quem está fora do catálogo. A linha abre a ficha
do plano (assinantes, histórico de preço) e o formulário de criar/editar é
`components/plan-editor.jsx`. O produto do plano define em que sistema a
assinatura libera acesso (`planAccessOf`). A aba Cobranças de Clientes não tem
mais catálogo; o cadastro antigo de `plans` aparece em "Avulsos".

**Próximo passo das Atividades (05/10/2026).** Indo pra Integração ou Ganho
(e no produto ofertado de Call → Follow-up), o produto vendido sai de
`closingPlansOf(saas)` (`web/src/lib/payments.js`): os planos vivos de
`CONFIG.plans` (sem arquivado nem `legacy`), agrupados por produto e na ordem
do catálogo (`slimPlan` leva `order`), com os preços da projeção
`CONFIG.proposals.catalog` e, no fim, o que só a apresentação vende. Plano
"sob consulta" entra sem preço. O "Plano fechado" mostra só os ciclos que o
plano vende (compra única = Serviço único). A seção não usa `<select>`
nativo: `SelectPopover` (com grupos), `PopoverWithCustom`,
`PaymentMethodPicker` e `DealPlanField` (`components/lead-blocks.jsx`) e o
`Choice` segmentado. O gate do board e o modal de link seguem no
`DealProductField`. No navegador: `node scripts/review/today-closing.mjs` em
`packages/web`.

O Próximo passo não oferece Ganho (`withoutWonStep`): a Integração registra o
mesmo fechamento; sem Integração na lista ela entra no lugar, e funil sem etapa
de Integração mantém o Ganho. O destino `contato` (Qualificando) é a Nutrição
pelo nome, nunca o No show ou o Dia 2, que também têm kind `contato`. A aba
Integração tem "A venda" e "A entrega"
(responsável, closer, `lead.integrationNote`, que vai pro Resumo do cliente e
pro briefing, e a agenda). **Venda com mais de um produto:** `lead.dealItems`
= `[{ product, planClosed, amount }]` só com 2+ itens; o 1º espelha
`dealProduct`/`planClosed` e `lead.amount` é a SOMA (meta, receita do closer e
Purchase seguem o total). `dealItemsOf` (`crm/won-lead.js`) normaliza; o
`convertWonLead` abre uma assinatura por item recorrente (uma por produto) e o
ARR inicial anualiza cada item pelo próprio ciclo; reeditar um fechamento
multiproduto só atualiza o cadastro (assinaturas são da ficha). O valor é
texto (`parseMoneyInput` aceita `3.582,50`). Teste: `multi-product.test.js`.

**Próximo passo da Integração (06/10/2026).** Além de Acompanhamento, a
atividade de Integração tem "Reunião feita · seguir depois" (o `retry`: toque
"integração feita" + quando voltar; com o toque e o GPS depois do horário, o
compromisso conta como cumprido e o item sai de pendente) e "Remarcar
integração" (pseudo-kind `remarcar`, só na Integração): novo horário na agenda
do integrador por `POST /api/leads/:id/integration-meeting`, a mesma régua da
reunião da ficha do cliente (`scheduleIntegrationMeeting` em
`google/routes.google.js`: sala usada é solta, 409 `previous_without_summary`
sem `force`). O card fica na etapa. `migrateReuniaoNaIntegracao` (marcador
`reuniaoNaIntegracaoV1` por produto) pôs os dois nos `nextSteps` salvos.

**Etapa na ficha do lead (06/10/2026).** A ficha aberta fora do Pipeline
(Atividades, Inbox, Agenda…) não tem mais "avançar etapa →"/"← voltar" pela
ordem do funil, `<select>` de etapas nem "marcar ganho/perdido". A seção
**Etapa** (`LeadStageSection`/`leadStageMoves` em `screens/deal.jsx`) mostra os
mesmos destinos do Próximo passo (`destinationsFor` + `withoutWonStep`, sem o
retomar) e um `SelectPopover` com as outras etapas agrupadas por fase (sem Ganho
quando há Integração). Tudo passa pelo `moveStage` (gates e confirm de desfazer
venda). O rodapé da ficha do Pipeline usa o mesmo bloco (`LeadStageMoves`
compacto, sem "Avançar →" nem "Descartar lead"); a coluna Ganho segue no quadro
para o arraste. O gate de movimento (`components/stage-move.jsx`) não usa
`<select>` nativo: `SelectPopover`, `Choice`, `PaymentMethodPicker` e
`PopoverWithCustom` (o `DealProductField` também), e o valor aceita
`3.582,50` (`parseMoneyInput`). Um Esc fecha o gate (antes o 1º só tirava o
foco do select). No `SelectPopover`, o Esc chega ao `useEsc` e fecha a lista.

**Link de convite da agenda (07/10/2026).** Cada usuário cadastra o seu em
Configurações → Integrações → Minha conta Google (`users.bookingUrl`, só https,
gravado pelo `PATCH /api/auth/me`, que aceita o campo sem o nome; sai no
`publicUser`). `components/booking-link.jsx` mostra copiar/WhatsApp/abrir ao
escolher o integrador no gate de Integração e no Próximo passo das Atividades.
A mensagem (`bookingInviteText` em `lib/wa-copy.js`) leva o link curto
`/a/:userId?s=<produto>&t=integracao`: rota ABERTA em `auth/auth.js` que monta
`auth/booking-page.js` (og em português + redirecionamento pra agenda). O link
do Google tem preview fixo em inglês para quem não está logado. `/a/` está em
`OPEN_PREFIXES` e no `location` público do `deploy/nginx.allinone.conf`
(`nginx-superficie-publica.test.js` trava os dois juntos). Copiar/mandar link
de call e integração usam `meetingInviteText` (dia e hora de Brasília, 45 min).

**Marcação pelo link → integração no card (07/10/2026).** `google/booking-sync.js`
(rotina do domínio Google, `start` em `google/index.js`) lê as mudanças da agenda
primária de cada usuário com `bookingUrl` e Google conectado (Calendar com
`syncToken`; estado em `app_config/booking_sync_<user>`; a 1ª leitura só guarda o
ponto de partida). Passe a cada 2 min; cada agenda a cada 15 min, ou a cada passe
nas 24h depois de um clique. Evento novo, futuro, organizado pela pessoa, com
convidado e que não é do cockpit (ids conhecidos nos leads/consultas ou descrição
"Lead: …") liga ao lead em Integração/Pós-venda por e-mail, telefone escrito no
evento ou clique no link curto (`/a/:id?l=<lead>` grava `lead.bookingClick`; robô
de preview não conta). Ligado: `integrationAt`, integrador e a sala da marcação
(`integrationCallUrl`/`integrationMeetEventId`/`integrationMeetOrganizer` = a
pessoa, então o `autoIntegrationMeet` não cria outra e o espelho pessoal não
duplica), `integrationBookedVia: "link"` + `integrationBookedEventId`, atividade e
aviso no sino. Remarcar/cancelar na página do Google acompanham; card com outra
integração por vir não é sobrescrito; marcação sem card avisa quem integra (só
com clique recente ou texto de agendamento no evento).

**Conflito operador × cliente no horário da integração (07/10/2026).** A grade
de integração (Próximo passo, Remarcar e o gate do `stage-move`) soma ao que o
cockpit sabe os horários ocupados da agenda do Google de quem integra
(`GET /api/google/busy`, só intervalos, 60s de cache em `googleUser.listBusy`;
`useGoogleBusy`/`withGoogleBusy` em `today.jsx`) e trava o horário cuja meia
hora seguinte está ocupada (`hourLong`: a integração dura 1h). Sem Google
conectado vale só o cockpit, e a grade diz isso. Ao salvar, o PATCH do lead e o
`scheduleIntegrationMeeting` conferem de novo (`crm/integration-slot.js`: outro
card do mesmo integrador sobreposto e, com Google, a agenda lida ao vivo;
Google fora do ar não trava) e devolvem 409 `integration_slot_taken` com o
motivo, que as telas mostram (`moveErrorText`). Copiar/mandar o link de convite
grava `integrationLinkSentAt`/`integrationLinkUser`: o card fica "aguardando o
cliente marcar" por 7 dias (`bookingLinkPending`), o Próximo passo abre em
"Enviar link" e marcar na grade por cima pede confirmação. A rotina das
marcações limpa o pendente e avisa quando a marcação cai em cima de outra
integração do mesmo integrador.

**Marcação sem card, ligada à mão (07/10/2026).** Quando a rotina não acha o
card (link do Google mandado direto, e-mail/telefone diferentes), o aviso no
sino leva `link: { screen, booking: <eventId>, bookingUser }` e abre o
`BookingLinkModal` (`components/booking-link.jsx`): cards em Integração/Pós-venda
de quem recebeu, "aguardando marcar" primeiro, com busca. "Ligar" chama
`POST /api/google/bookings/:eventId/link` (`linkEvent` em `booking-sync.js`, que
lê o evento ao vivo pelo `googleUser.getEvent`) e liga igual à automática: sala
da marcação, atividade, aviso marcado como lido. Recusa marcação cancelada (410),
já ligada a outro card ou card com outra integração por vir (409).
Prévia com o funil atual e um lead por etapa: `?shell&etapas#today` ou
`#pipeline` (`preview/etapas-mock.js`); revisão:
`node scripts/review/lead-stage.mjs` em `packages/web`.

**LeverId (auth novo).** O desenho segue o spike de assinaturas (branch
`feat/auth`): o LeverId guardará só o direito de acesso org × produto, com o
código do plano e sem preço; preço e cobrança ficam aqui e os limites são
aplicados em cada produto. `orgRefOf` já resolve `leveradsOrgId` hoje e `orgId`
depois. Ainda NÃO existe: adaptador do LeverId (depende da migration
`product_grants` + RPC no repo LeverId), escrita de limites no LeverAds e
integração com o LeverPrice.

Validação: `node --test packages/api/test/plan-*.test.js packages/api/test/entitlements.test.js`
e, no navegador com mocks, `npm run test:review:plans -w packages/web`.

**Dor `[PRICE]` (07/10/2026).** O Leo começou a subir criativo de precificação
com `[PRICE]` no nome, rastreado como o `[OEM]`. O que o código já fazia desde
16/09: `painCode` aceita a etiqueta, o `/f/:id` resolve o anúncio ainda sem
insights na Meta e o `form_ab` manda `[PRICE]` pro `fo_price_v2`. O que entrou
agora: `painCodeOf` do web (`lib/pain-code.js`, módulo sem React pra ficar
testável) passou a espelhar a API — antes a dor existia no lead e o cockpit
mostrava o card sem rótulo, o "Por dor" da Publicidade jogava o gasto em "Sem
código" e o fluxo de criar anúncio não achava a campanha; a dor `PRICE` entrou
no catálogo (rótulo + trilha SPIN) e no `painMap` do produto; e a origem Price
passou a TROCAR a linha da apresentação (`lineOf`), única dor que faz isso — o
pacote sai do VOLUME de anúncios (`priceTier`, lido dos `limite` do catálogo:
até 1k Essencial, até 10k Escala, acima Enterprise, que no Price tem preço),
não do nº de contas. Origem Price = dor `[PRICE]` ou `formProduct: "price"`; o
select "Apresentar" continua vencendo tudo. No SDR, `leadPainFocus` devolve
`mode: "price"` (sem a cerca de nicho do OEM e FORA do roteiro fixo do OEM) e o
primeiro toque e o cérebro falam só de precificação, sem somar clonagem nem OEM.
De quebra, `volCol` passou a ler as faixas de anúncios dos formulários v2
(`0-500`, `500-1000`, …), que não existem em `calc.volumeMid`: toda proposta
vinda dos forms novos lia a coluna 0 e a nota S-E do cliente caía no piso.

Dados de produção aplicados por SQL em 07/10 (a migração do catálogo é one-shot
e não roda de novo): `products.leverads.painMap.PRICE`,
`proposal_templates.pt_leverads.calc.catalog.pains.PRICE` e as 3.304 propostas
com catálogo. Backups: `cockpit._bak_{products,proposal_templates,proposals}_20261007_price`.
Escrita direta no banco não acorda o SSE: cockpit aberto só vê a dor nova depois
de recarregar.

Validação: `node --test packages/api/test/proposal-catalog.test.js
packages/api/test/sdr-flow.pain.test.js packages/api/test/routes.form-routing.test.js`
e `node --test packages/web/test/pains.test.js`.
