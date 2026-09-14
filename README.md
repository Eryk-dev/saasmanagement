# Cockpit

Painel operacional dos produtos da casa (LeverAds, UniqueKids, Elo). Reúne numa só
ferramenta captação e qualificação de leads, WhatsApp, calls, propostas, fechamento,
integração do cliente, retenção, tarefas, treinamentos, marketing e financeiro.

Um **workspace por produto** (campo `saas` em todos os registros) permite que cada
produto tenha seu próprio funil, perguntas, formulários, propostas e integrações.

> Guia de trabalho mais detalhado (regras de domínio, mapa de arquivos, validação):
> [`docs/CONTEXTO-COCKPIT.md`](docs/CONTEXTO-COCKPIT.md). Acordo de commit/deploy:
> [`AGENTS.md`](AGENTS.md).

---

## Arquitetura

Monorepo com npm workspaces, JavaScript ESM e Node 20 ou superior.

```
                    ┌──────────────────────────────────────────────┐
 navegador ───────▶ │ web · React 18 + Vite 6 (SPA, rotas por hash)│
                    └───────────────┬──────────────────────────────┘
                                    │ /api (REST + SSE /api/events)
 forms públicos /f/ ─┐              ▼
 propostas /p/       ├──▶ ┌──────────────────────────────────────┐ ──▶ Mercado Pago, Meta,
 webhooks, blog      ┘    │ api · Fastify 5                      │     WhatsApp, Google,
                          │ fonte da verdade: auth, regras,      │     Shopify, IA, Discord,
 agentes / IDEs ─▶ mcp ─▶ │ migrações e rotinas em segundo plano │     Levercopy, Elo
   (Streamable HTTP)      └───────────────┬──────────────────────┘
                                          │ pg
                                          ▼
                          ┌──────────────────────────────────────┐
                          │ Postgres (Supabase) · schema cockpit │
                          └──────────────────────────────────────┘
```

| Pacote | Stack | Papel |
|---|---|---|
| `packages/api` | Fastify 5, `pg` | API REST na porta 8787. Autenticação (usuários + chave mestre), permissão por tela, CRUD genérico das coleções e rotas de domínio (`routes.*.js`), páginas públicas (formulários, propostas, NPS, blog), webhooks e ~25 rotinas em segundo plano (cobrança, sync de pagamentos, cadências de WhatsApp, lembretes, relatórios). |
| `packages/web` | React 18, Vite 6 | SPA na porta 5173 (dev). Carrega o `/api/bootstrap` e recebe atualizações em tempo real por SSE. Tema claro por padrão, com modo escuro. |
| `packages/mcp` | SDK MCP, Express | Servidor MCP (Streamable HTTP) na porta 8788. As ferramentas leem **e escrevem** sempre através da API REST. |

**Dados.** Postgres (Supabase), schema `cockpit`, uma tabela por coleção com
`id`, `json` (JSONB) e `updated_at`. O formato documento é intencional: cada
produto define seus próprios campos e funis. As tabelas são criadas no boot da API
a partir de `COLLECTIONS` (`packages/api/src/seed-data.js`), e `migrations.js`
aplica migrações idempotentes de dados logo em seguida. O acesso ao banco fica
concentrado em `packages/api/src/db.js`.

**Autenticação.** Com `COCKPIT_API_KEY` definida, toda rota exige autenticação:
a chave mestre (integrações e MCP) ou o token de sessão de um usuário logado (senha
com scrypt, sessão de 7 dias). `screens.js` restringe, também no servidor, o que
cada usuário alcança. Continuam abertas só as superfícies públicas (`/api/health`,
login, `/f/`, `/p/`, `/public/*`, webhooks).

---

## Estrutura do repositório

```
packages/
  api/
    src/            index.js (boot), routes.js (CRUD + registro dos módulos),
                    routes.*.js (domínios), db.js, migrations.js, auth.js, screens.js,
                    integrações (mp, meta, whatsapp, google, shopify…) e rotinas
    test/           testes node:test com repositório em memória (test/helpers/mem-repo.js)
    scripts/        scripts pontuais de dados, datados
  web/
    src/            main.jsx, app.jsx, chrome.jsx, data.jsx, atoms.jsx, tokens.css
      screens/      uma tela por arquivo (tasks/ tem subpasta própria)
      components/   componentes compartilhados
      lib/          api, workspace, users, funnel, formatação…
    preview/        App real com API fictícia, para revisar telas sem banco
    scripts/        smoke-ssr.mjs (teste de render)
  mcp/src/          index.js, tools.js, apiClient.js
infra/local/        Supabase local para desenvolvimento (só infraestrutura)
deploy/             start.sh + nginx da imagem all-in-one
design/             handoff de design do cockpit
docs/               contexto do projeto, plano histórico, playbook SDR
Dockerfile.allinone imagem de produção (UI + API + MCP numa porta)
Dockerfile, docker-compose.yml, packages/web/{Dockerfile,nginx.conf}   stack de 3 containers (VPS)
```

---

## Ambiente local

A infraestrutura (Supabase) roda no Docker; API, web e MCP rodam direto na máquina.

**Pré-requisitos:** Node 20+, Docker com Compose.

### 1. Subir o Supabase local

```bash
docker compose -f infra/local/docker-compose.yml up -d
```

| Serviço | Endereço | Uso |
|---|---|---|
| Postgres (imagem `supabase/postgres` 17) | `localhost:54322` · usuário `postgres` · senha `postgres` | banco da API |
| Supabase Studio | http://localhost:54323 | editor de tabelas e SQL |

Sobe só o que o app usa: Postgres, `postgres-meta` e Studio. Auth, Storage, REST e
Realtime do Supabase ficam de fora porque o Cockpit não usa nenhum deles. Portas e
senha podem ser trocadas com `LOCAL_DB_PORT`, `LOCAL_STUDIO_PORT` e
`LOCAL_DB_PASSWORD`.

```bash
docker compose -f infra/local/docker-compose.yml ps        # status
docker compose -f infra/local/docker-compose.yml logs -f db
docker compose -f infra/local/docker-compose.yml down      # para, mantém os dados
docker compose -f infra/local/docker-compose.yml down -v   # para e APAGA o banco
```

### 2. Configurar o `.env`

```bash
cp .env.example .env
```

O exemplo já aponta `COCKPIT_DB_URL` para o banco local
(`postgresql://postgres:postgres@localhost:54322/postgres?sslmode=disable`).
Recomendado para testar como em produção: definir `COCKPIT_API_KEY` com qualquer
valor local, o que ativa a tela de login.

Deixe as integrações vazias. No boot, a API executa migrações e rotinas em
segundo plano, e uma credencial real no `.env` local faz o ambiente de testes
agir em serviços de produção (pagamentos, mensagens, anúncios). **Nunca aponte
`COCKPIT_DB_URL` para o banco de produção.**

### 3. Rodar os pacotes

```bash
npm ci
npm run dev        # api (:8787) + web (:5173) + mcp (:8788) juntos
```

Ou separados, cada um num terminal:

```bash
npm run dev:api    # Fastify em :8787
npm run dev:web    # Vite em :5173 (proxy de /api, /f, /p, /public para :8787)
npm run dev:mcp    # MCP em :8788
```

Abra http://localhost:5173.

### 4. Primeiro acesso

- O primeiro boot cria as tabelas e, com a coleção `users` vazia, os administradores
  padrão definidos em `DEFAULT_ADMINS` (`packages/api/src/auth.js`). Troque a senha
  depois de entrar.
- O banco nasce sem produtos. Crie o primeiro em **Configurações** ou pela API:

```bash
curl -X POST http://localhost:8787/api/products \
  -H 'content-type: application/json' -H 'x-api-key: <COCKPIT_API_KEY>' \
  -d '{"id":"leverads","name":"LeverAds"}'
npm run seed:leverads-questions -w packages/api   # perguntas de qualificação da LeverAds
```

- No log da API, `[leverads-results] falhou: function public.dashboard_portfolio…`
  é esperado em ambiente local: essa função vive no banco do Levercopy, e o slide
  da proposta volta para o texto do template.

### Scripts de dados

| Comando | Efeito |
|---|---|
| `npm run seed` | garante as tabelas (não altera dados existentes) |
| `npm run seed:leverads-questions -w packages/api` | grava as perguntas do pipeline LeverAds (idempotente) |
| `npm run seed:clear` | **apaga todos os dados** das coleções |

---

## Testes e verificação

```bash
npm test -w packages/api                               # suíte da API (node:test, repositório em memória)
node --test packages/api/test/routes.rollup.test.js    # um arquivo específico
npm test -w packages/web                               # smoke de render SSR das telas
npm run build                                          # build de produção do web
```

Os testes não precisam de banco nem da API rodando. Smoke e build não substituem
conferir a tela no navegador quando a mudança é visual ou interativa.

**Preview de telas sem banco.** O App real com API fictícia:

```bash
npm run preview:tela -w packages/web    # http://localhost:5199
```

Exemplos: `/?shell=1#overview`, `/?shell=1#training`, `/?shell=1&exam=1#training`,
`/?shell=1&marketing=1#blog` (aceita `&theme=dark` e `&product=elo`). Os mocks
ficam em `packages/web/preview/` e não entram no build de produção.

---

## Deploy

**Produção (EasyPanel).** Build a partir do `Dockerfile.allinone`: um container com
nginx na porta 80 servindo a UI e fazendo proxy de `/api`, `/mcp` e das rotas
públicas (`/f`, `/fi`, `/p`, `/u`, `/m`, `/public`, `/embed.js`) para a API e o MCP.
O container não guarda estado; os dados ficam no Supabase indicado em
`COCKPIT_DB_URL`. As variáveis de produção são configuradas no EasyPanel. Push na
`main` dispara o deploy (ver [`AGENTS.md`](AGENTS.md)).

Verificação: `GET /api/health` devolve `ok`, `service` e `build`, a impressão de
`packages/api/src`. Compare com `node packages/api/src/build-info.js` no commit
enviado.

**VPS com `docker-compose.yml`.** Sobe api, mcp e web em containers separados
(`docker compose up -d --build`, porta `WEB_PORT`, padrão 80), com o mesmo
`COCKPIT_DB_URL` externo. Atenção: o `packages/web/nginx.conf` desse caminho só faz
proxy de `/api` e `/mcp`, então formulários públicos, propostas, blog e webhook do
Mercado Pago não funcionam por ele. O caminho mantido é o all-in-one.

---

## API REST

Base local: `http://localhost:8787`. Documentação interativa em **`/api/docs`**
(Redoc) e spec em `/api/openapi.json`.

Autenticação (quando `COCKPIT_API_KEY` está definida): `x-api-key: <chave>` ou
`Authorization: Bearer <chave>`, com a chave mestre ou com o token de sessão
devolvido por `POST /api/auth/login`.

| Método | Rota | Notas |
|---|---|---|
| `GET` | `/api/health` | liveness + build + coleções (aberta) |
| `GET` | `/api/bootstrap` | dados que a UI carrega no boot |
| `GET` | `/api/events` | SSE de mudanças (chave em `?key=`) |
| `GET` | `/api/:collection` | lista |
| `GET` | `/api/:collection/:id` | um registro |
| `POST` | `/api/:collection` | cria (id gerado se omitido) |
| `PATCH` | `/api/:collection/:id` | atualiza por merge |
| `DELETE` | `/api/:collection/:id` | apaga |

O CRUD genérico cobre as coleções de `COLLECTIONS`, exceto as privadas (`PRIVATE`
em `routes.js`: usuários, sessões, mensagens de WhatsApp, remuneração etc.), que só
são acessíveis pelas rotas próprias. Os domínios têm rotas dedicadas em
`packages/api/src/routes.*.js`: formulários, propostas, billing, Mercado Pago,
financeiro, WhatsApp, tarefas, agenda, marketing, redes sociais, blog, treinamentos,
métricas, entre outros.

Exemplo, um formulário externo criando um lead:

```bash
curl -X POST http://localhost:8787/api/leads \
  -H 'content-type: application/json' -H 'x-api-key: <COCKPIT_API_KEY>' \
  -d '{"name":"Mara Olin","email":"mara@drift.com","company":"Drift","saas":"leverads",
       "source":"Form · /pricing","utm":{"source":"google","campaign":"q2"}}'
```

Os formulários e as propostas nativos (páginas `/f/:id` e `/p/:id`) são criados nas
telas **Formulários** e **Propostas**. Para produtos sem template nativo, a
proposta pode vir do Levercopy (`POST /api/leads/:id/proposal`; ver o bloco
Levercopy no `.env.example`).

---

## Servidor MCP

Streamable HTTP em `http://localhost:8788/mcp` (health em `/health`). Exige a chave
em `MCP_AUTH_KEY` ou, se vazia, em `COCKPIT_API_KEY`. Todas as ferramentas passam
pela API REST, então valem as mesmas regras e permissões.

| Grupo | Ferramentas |
|---|---|
| Consulta | `portfolio_summary`, `list_records`, `get_record`, `leaderboard`, `list_notifications`, `task_activity` |
| Escrita | `create_record`, `update_record`, `delete_record`, `move_deal`, `generate_proposal`, `move_task`, `complete_task`, `comment_task`, `bulk_tasks` |
| Documentação | `api_overview`, `connect_a_form`, `lead_fields`, `resource_schema`, `list_endpoints`, `openapi_spec` |

As ferramentas de escrita alteram dados de verdade. Conecte o MCP ao banco local
para testes.

```bash
claude mcp add --transport http cockpit http://localhost:8788/mcp \
  --header "x-api-key: <COCKPIT_API_KEY>"
```

Outros clientes MCP:

```json
{
  "mcpServers": {
    "cockpit": {
      "url": "http://localhost:8788/mcp",
      "headers": { "x-api-key": "<COCKPIT_API_KEY>" }
    }
  }
}
```

---

## Integrações

Todas são opcionais e ficam desligadas sem credencial. As variáveis estão
documentadas, com o que cada uma liga, no [`.env.example`](.env.example).

| Integração | Uso |
|---|---|
| Mercado Pago | assinaturas, links de cobrança, espelho de pagamentos, dunning |
| WhatsApp Cloud API | Inbox, cadências, fluxo SDR, ligações |
| Meta | insights de anúncios, redes sociais, comentários, Pixel/CAPI |
| Google | agenda, Meet e documentos de transcrição |
| IA (OpenRouter/Anthropic/OpenAI) | resumos de call, SDR, copiloto, blog, transcrição |
| LeverAds / Levercopy | liberação de acesso por pagamento, propostas, resultados de clientes |
| Elo | análises do app (banco próprio, só leitura) |
| Shopify | pedidos pagos da UniqueKids viram leads |
| Discord | avisos do funil |

---

## Documentação relacionada

| Documento | Conteúdo |
|---|---|
| [`docs/CONTEXTO-COCKPIT.md`](docs/CONTEXTO-COCKPIT.md) | mapa do código, regras de domínio, validação e entrega |
| [`AGENTS.md`](AGENTS.md) | acordo de trabalho: commit, push e deploy |
| [`docs/PLANO-REWORK.md`](docs/PLANO-REWORK.md) | histórico de decisões (datado) |
| [`PORTFOLIO.md`](PORTFOLIO.md) | histórico da simplificação para um produto (datado) |
| [`docs/SDR-PLAYBOOK-LEVERADS.md`](docs/SDR-PLAYBOOK-LEVERADS.md) | tom, objeções e fluxo comercial |
| [`design/handoff-cockpit`](design/handoff-cockpit/README.md) | handoff de design |
| [`.claude/skills/cockpit-ui-review`](.claude/skills/cockpit-ui-review/SKILL.md) | design system e checklist de UI |
