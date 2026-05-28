# Cockpit · Portfolio OS

Um cockpit operacional para tocar **vários SaaS em paralelo** — implementação fiel do
design *Portfolio Cockpit* (UI dark estilo Linear), com uma API REST de verdade e um
servidor MCP para você plugar nos SaaS que já roda hoje.

> Três perguntas, respondidas em 60 segundos: *Como está meu portfólio hoje? Onde preciso
> agir essa semana? Como cada produto está sendo operado por dentro?*

Já vem com três produtos demo deliberadamente heterogêneos — **LeverAds** (sales-led, vaca
leiteira), **Quill** (PLG, sangrando), **Mesa** (sales-assisted, estável mas em risco) — pra
consolidação e drill-down ficarem visíveis na hora. Troque-os pelos seus dados reais via API
ou MCP.

---

## Arquitetura

```
┌────────────┐        ┌──────────────────────────┐        ┌───────────────┐
│  web (Vite │  HTTP  │   api (Fastify + SQLite)  │  HTTP  │  mcp (MCP /   │
│  + React)  │ ─────▶ │   a única fonte da        │ ◀───── │  Streamable   │
│  a UI      │  /api  │   verdade — CRUD completo │  /api  │  HTTP)        │
└────────────┘        └──────────────────────────┘        └───────────────┘
        ▲                          ▲                               ▲
        │                          │ REST (empurra métricas,       │ tools MCP
   seu navegador           leads, deals, NPS…)              agentes IA / Claude /
                           ◀── seus SaaS rodando ──▶          Cursor / seus bots
```

- **`packages/api`** — Fastify + SQLite. A única fonte da verdade. Armazenamento estilo
  documento (uma linha JSON por registro) porque **cada SaaS define seu próprio funil e
  campos** — heterogeneidade é o princípio central. Leitura é aberta; escrita pode exigir
  uma API key. A camada de repositório é isolada, então trocar SQLite → Postgres/Supabase é
  um arquivo só.
- **`packages/web`** — Vite + React. Os componentes **exatos** do design, buscando tudo de
  `/api/bootstrap` no boot. As 10 telas, 5 personas, kanban com drag-and-drop, drill-downs,
  painel de tweaks.
- **`packages/mcp`** — Servidor MCP sobre **Streamable HTTP** (com sessão). 16 tools que são
  wrappers finos sobre a API, então MCP e UI nunca divergem.

---

## Começar rápido

```bash
npm install        # instala os três workspaces (compila o better-sqlite3)
npm run dev        # sobe api (:8787) + web (:5173) + mcp (:8788) juntos
```

Depois abra **http://localhost:5173**.

O banco SQLite se cria e popula sozinho no primeiro start da API
(`packages/api/data/cockpit.db`).

Rodar cada parte separada, se preferir:

```bash
npm run dev:api    # Fastify na :8787
npm run dev:web    # Vite na :5173 (faz proxy de /api -> :8787)
npm run dev:mcp    # MCP na :8788  (faz proxy pra API)
npm run seed:demo  # carrega os 3 SaaS de demonstração (pra explorar)
npm run seed:clear # ZERA tudo (instância limpa)
npm run build      # build de produção do web -> packages/web/dist
```

Configuração fica no `.env` na raiz — copie o `.env.example` e edite. Portas, a API key
opcional e a URL da API que o MCP consome ficam lá.

---

## Rodar em VPS (Docker)

Sem instalar Node na VPS — só Docker + Compose:

```bash
git clone git@github.com:Eryk-dev/saasmanagement.git && cd saasmanagement
cp .env.example .env        # (opcional) defina COCKPIT_API_KEY p/ proteger as escritas
docker compose up -d --build
```

Sobe **uma porta só** (80): o nginx serve a UI e faz proxy de `/api` (REST) e `/mcp` (MCP).
- UI:  `http://SEU_IP/`
- API: `http://SEU_IP/api/...`
- MCP: `http://SEU_IP/mcp`

O SQLite persiste no volume `cockpit-data` (sobrevive a `down`/redeploys). Coloque um proxy
com TLS (Caddy/Traefik/nginx) na frente para HTTPS + seu domínio.

```bash
docker compose logs -f                                              # logs
docker compose exec api node packages/api/src/seed-cli.js --demo    # carrega demo
docker compose exec api node packages/api/src/seed-cli.js --clear   # zera
docker compose down                                                 # para (mantém os dados)
```

Mudar a porta pública: `WEB_PORT=8080 docker compose up -d`. Para expor a API/MCP direto (sem
passar pelo nginx), descomente os `ports:` no `docker-compose.yml`.

---

## Como os dados são guardados e atualizados

**Onde ficam.** Os dados vivem em **SQLite**, em `packages/api/data/cockpit.db`. É um arquivo
de banco real (modo WAL, durável em disco) — a API (`packages/api/src/db.js`) é a **única**
coisa que fala com ele. Esse arquivo **não vai pro Git** (está no `.gitignore`): o repositório
carrega o **código + a semente** (`packages/api/src/seed-data.js`), não o banco em si.

**Como nasce.** Por padrão o app sobe **vazio** (instância limpa) — a semente padrão
(`seed-data.js`) não tem dados. Você popula tudo conectando seus SaaS via REST/MCP. As telas
mostram um estado vazio com a dica de como começar até chegarem os primeiros dados.
Quer explorar com dados fictícios? `npm run seed:demo` carrega 3 SaaS de exemplo;
`npm run seed:clear` zera de novo. Reinícios **nunca** sobrescrevem o que já existe — o que
seus SaaS empurraram fica preservado.

**Adicionar seu primeiro produto** (mínimo — a API completa o resto com defaults seguros):
```bash
curl -X POST http://localhost:8787/api/products \
  -H 'content-type: application/json' \
  -d '{"id":"meusaas","name":"Meu SaaS","mrr":15000,"arr":180000,"health":72}'
```
Quanto mais campos você enviar (`funnel`, `nnm`, `nrr`, `churnRate`, `activation`, `mrrSeries`…),
mais partes da UI ganham vida. Veja o shape completo em `packages/api/src/seed-data.demo.js`.

**Como é atualizado.** Há três caminhos, todos passando pela mesma API (uma fonte da verdade):

1. **Seus SaaS** chamam a **API REST** (`POST` / `PATCH` / `DELETE`) — ex.: sincronizar MRR à
   noite, criar um lead vindo de um formulário, avançar um deal quando o CRM fecha.
2. **Agentes de IA / bots** chamam as **tools do MCP** (que por baixo chamam a mesma API).
3. **A própria UI** grava algumas mutações (ex.: arrastar um deal de estágio no kanban já
   persiste via `PATCH /api/deals/:id`).

Qualquer coisa escrita por um caminho aparece **na hora** nos outros — UI, MCP e REST leem o
mesmo banco. Cada clone/deploy gera o **seu próprio** `cockpit.db` a partir da semente no
primeiro boot; em produção, é só apontar a camada de repositório pra um Postgres/Supabase
(reescrevendo só o `repo` em `db.js`) se quiser banco gerenciado.

---

## O app (10 telas · 5 personas)

| Tela | O que responde |
|---|---|
| **Portfolio** (home do Founder) | Herói de trajetória de MRR, fita de KPIs, **fila de atenção** priorizada, rails densos por produto, pacing de metas. |
| **SaaS Dashboard** | MRR north-star, decomposição de health, 4 tiles vitais, heatmap de funil + alerta de gargalo. |
| **Pipeline** | Kanban (drag-and-drop, persistido), visão **All pipelines** empilhada, Lista, Forecast. Clicar no card → drawer do deal. |
| **Leads** (home do SDR) | Worklist priorizada round-robin. |
| **Proposals** (home do Closer) | Propostas rastreadas + builder em blocos com dwell por seção. |
| **Customers** (home do CS) | Contas ordenadas por health, filtros por banda, painel de drill-down, CTAs ativas. |
| **NPS** | Gauge, tendência, split promotor/detrator, clusters de tags, verbatims de detratores. |
| **Goals** | Pacing vs projetado com bandas verde/amarelo/vermelho, cascata portfólio → SaaS. |
| **Leaderboard** | Mensal (resetável) / All-time, múltiplas categorias de vitória, fila de coaching. |
| **Settings** | Funil/estágios por SaaS, campos custom, pesos do health, definição de Aha, integrações. |

O seletor de persona (canto superior direito) leva cada papel pra sua home com os filtros
padrão certos. O painel **Tweaks** (canto inferior direito) troca tema/densidade/tipografia/
acento e persona.

---

## API REST

Base: `http://localhost:8787`. Leitura aberta; escrita exige `x-api-key` **apenas se**
`COCKPIT_API_KEY` estiver definido.

| Método | Rota | Notas |
|---|---|---|
| `GET` | `/api/health` | liveness + lista de coleções |
| `GET` | `/api/bootstrap` | tudo que a UI precisa num payload só |
| `GET` | `/api/portfolio` | totais do portfólio (computados) |
| `GET` | `/api/:collection` | lista; filtros abaixo |
| `GET` | `/api/:collection/:id` | um registro |
| `POST` | `/api/:collection` | cria (id gerado se omitido) |
| `PATCH` | `/api/:collection/:id` | atualiza por merge |
| `DELETE` | `/api/:collection/:id` | apaga |
| `GET` | `/api/leaderboard?scope=month\|all` | conveniência |

Coleções: `products`, `attention`, `deals`, `people`, `customers`, `leads`, `nps`,
`goals`, `proposals`, `leaderboard_month`, `leaderboard_all`.

Filtros: `deals?saas=&stage=&owner=&score=` · `customers?band=red|yellow|green&saas=` ·
`leads?priority=P0|P1|P2` · `nps?saas=` · `goals?scope=`.

### Integrar seus SaaS rodando (exemplos)

```bash
# Empurrar um lead do seu funil/form pra worklist do produto certo
curl -X POST http://localhost:8787/api/leads \
  -H 'content-type: application/json' \
  -d '{"name":"Mara Olin","company":"Drift","saas":"leverads","priority":"P0","score":92}'

# Sync de métricas noturno vindo do seu sistema de billing
curl -X PATCH http://localhost:8787/api/products/quill \
  -H 'content-type: application/json' \
  -d '{"mrr":96000,"churnRate":0.058,"activation":0.47}'

# Avançar um deal quando seu CRM fecha
curl -X PATCH http://localhost:8787/api/deals/d12 \
  -H 'content-type: application/json' \
  -d '{"stage":"Closed Won"}'
```

Se `COCKPIT_API_KEY` estiver definido, acrescente `-H "x-api-key: <key>"` nas escritas.

---

## Servidor MCP

Streamable HTTP em `http://localhost:8788/mcp` (health em `/health`). 16 tools:

`portfolio_summary` · `list_products` · `get_product` · `update_product_metrics` ·
`list_attention` · `list_deals` · `move_deal` · `create_deal` · `list_customers` ·
`get_customer` · `list_leads` · `create_lead` · `list_nps` · `create_nps` ·
`list_goals` · `leaderboard`.

As tools `update_product_metrics`, `create_lead`, `create_nps`, `create_deal` e `move_deal`
são o caminho de **ingestão** — aponte um agente pra elas pra alimentar o cockpit a partir dos
seus sistemas. Tudo escrito via MCP aparece na UI na hora (mesmo banco).

### Conectar um cliente

**Claude Code:**
```bash
claude mcp add --transport http cockpit http://localhost:8788/mcp
```

**Cursor / Claude Desktop / qualquer cliente MCP** — adicione na config MCP:
```json
{
  "mcpServers": {
    "cockpit": { "url": "http://localhost:8788/mcp" }
  }
}
```

---

## Estrutura do projeto

```
packages/
  api/   src/{index,routes,db,seed-data,seed-cli}.js   data/cockpit.db   (banco, fora do Git)
  web/   index.html  vite.config.js  src/{main,app,atoms,charts,chrome,tweaks-panel}.jsx
         src/screens/*.jsx   src/lib/{api,format,ui}.js   src/tokens.css
  mcp/   src/{index,tools,apiClient}.js
.env.example
```

## Notas / próximos passos

- **Persistência**: SQLite por trás de um repositório pequeno. Pra ir pra Postgres/Supabase,
  reimplemente o `repo` em `packages/api/src/db.js` — nada mais muda.
- **Auth**: defina `COCKPIT_API_KEY` pra exigir key nas escritas (leitura fica aberta pra UI).
  Antes de expor publicamente, reforce (keys por tenant, OAuth).
- **Forms** foram retirados do design de propósito — leads/pipeline integram com seus
  formulários **externos** via `POST /api/leads` (ou a tool `create_lead`).
- **Propostas auto-geradas** (pela etapa do deal, com template pro closer) estão anotadas no
  design como fluxo futuro e ainda não foram construídas.

---

_Nota: os comentários no código-fonte estão em inglês; a documentação (este README) e a UI de
configuração estão em português. Posso traduzir os comentários do código também, é só pedir._
