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

### Easypanel / Render / Railway (um container só)

PaaS que mapeia o domínio para **um container + uma porta** não combinam com o compose de 3
serviços. Use o **`Dockerfile.allinone`**: ele empacota UI + API + MCP num único container,
servidos por nginx na **porta 80** (`/` = UI, `/api` = REST, `/mcp` = MCP).

No **Easypanel** (App a partir do repo GitHub):
1. **Build:** Dockerfile → caminho `Dockerfile.allinone`.
2. **Port (proxy):** `80`.
3. **Volume:** monte em `/app/packages/api/data` (persiste o SQLite).
4. **Env (opcional):** `COCKPIT_API_KEY` para exigir key nas escritas.

O domínio do Easypanel já entrega HTTPS e faz proxy pra porta 80 do container.
Se aparecer **"Service is not reachable"**, quase sempre é a **porta** apontando pra lugar
errado (tem que ser 80) ou o container não subiu — veja os logs do serviço no Easypanel.

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

## O app (9 telas · 5 personas)

| Tela | O que responde |
|---|---|
| **Portfolio** (home do Founder) | Herói de trajetória de MRR, fita de KPIs, **fila de atenção** priorizada, rails densos por produto, pacing de metas. |
| **SaaS Dashboard** | MRR north-star, decomposição de health, 4 tiles vitais, heatmap de funil + alerta de gargalo. |
| **Pipeline** (home do Closer) | Kanban (drag-and-drop, persistido), visão **All pipelines** empilhada, Lista, Forecast. Clicar no card → drawer do deal. |
| **Leads** (home do SDR) | Worklist priorizada round-robin. A proposta é gerada **fora** do app (a partir do form) e o link entra no lead via API (`proposalUrl`), virando o botão "proposta ↗". |
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
`COCKPIT_API_KEY` estiver definido. **Doc interativa em `/api/docs`** (Redoc) e spec em
`/api/openapi.json` — é onde você vê todos os campos pra mapear seus forms.

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
| `GET` | `/api/openapi.json` | spec OpenAPI (para máquina/codegen) |
| `GET` | `/api/docs` | **doc interativa** (Redoc) |

Coleções: `products`, `attention`, `deals`, `people`, `customers`, `leads`, `nps`,
`goals`, `leaderboard_month`, `leaderboard_all`.

Filtros: `deals?saas=&stage=&owner=&score=` · `customers?band=red|yellow|green&saas=` ·
`leads?priority=P0|P1|P2` · `nps?saas=` · `goals?scope=`.

### Conectar formulários e SaaS (exemplos)

```bash
# Seu FORMULÁRIO cria um lead (só name + saas são obrigatórios; o resto tem default).
# `saas` é o id do produto; o lead entra no funil dele.
curl -X POST http://localhost:8787/api/leads \
  -H 'content-type: application/json' \
  -d '{"name":"Mara Olin","email":"mara@drift.com","company":"Drift","saas":"meusaas",
       "source":"Form · /pricing","utm":{"source":"google","campaign":"q2"}}'

# Depois de gerar a proposta (fora do app), grave o LINK no lead.
# Vira o botão "proposta ↗" no card do lead.
curl -X PATCH http://localhost:8787/api/leads/LEAD_ID \
  -H 'content-type: application/json' \
  -d '{"proposalUrl":"https://propostas.seudominio.com/p/abc123"}'

# Sync de métricas do seu billing/produto
curl -X PATCH http://localhost:8787/api/products/meusaas \
  -H 'content-type: application/json' \
  -d '{"mrr":96000,"churnRate":0.058,"activation":0.47}'
```

Mapa completo dos campos do lead: abra `/api/docs` ou use a tool `connect_a_form` do MCP.
Se `COCKPIT_API_KEY` estiver definido, acrescente `-H "x-api-key: <key>"` nas escritas.

---

## Servidor MCP — manual de conexão

Streamable HTTP em `http://localhost:8788/mcp` (health em `/health`). **O MCP NÃO transmite
dados de negócio** — ele é um *manual* que te diz como conectar na API. Os dados trafegam só
pela API REST. As tools devolvem documentação (markdown / schema), lendo a própria
`/api/openapi.json`:

| tool | o que devolve |
|---|---|
| `api_overview` | visão geral: base, auth, fluxo, links da doc |
| `connect_a_form` | **passo a passo** de mapear seu form → lead + anexar `proposalUrl` |
| `lead_fields` | tabela dos campos do lead (`LeadInput`) |
| `resource_schema` | schema de um recurso (`lead\|product\|customer\|deal\|nps\|goal`) |
| `list_endpoints` | todos os endpoints (método, rota, se exige key) |
| `openapi_spec` | o OpenAPI completo (pra codegen / Postman) |

Use o MCP como manual num agente/IDE; pra mover dados, fale com a API REST direto.

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
  api/   src/{index,routes,db,seed-data,seed-data.demo,seed-cli,openapi}.js
         data/cockpit.db   (banco, fora do Git)
  web/   index.html  vite.config.js  src/{main,app,atoms,charts,chrome,tweaks-panel}.jsx
         src/screens/*.jsx   src/lib/{api,format,ui}.js   src/tokens.css
  mcp/   src/{index,tools,apiClient}.js   (manual: documenta, não transmite dados)
Dockerfile  packages/web/Dockerfile  packages/web/nginx.conf  docker-compose.yml
.env.example
```

## Notas / próximos passos

- **Persistência**: SQLite por trás de um repositório pequeno. Pra ir pra Postgres/Supabase,
  reimplemente o `repo` em `packages/api/src/db.js` — nada mais muda.
- **Auth**: defina `COCKPIT_API_KEY` pra exigir key nas escritas (leitura fica aberta pra UI).
  Antes de expor publicamente, reforce (keys por tenant, OAuth).
- **Forms** são **externos** (você cria os seus) — eles batem em `POST /api/leads` e caem nos
  campos certos do lead. O mapa dos campos está em `/api/docs` e na tool `connect_a_form`.
- **Proposta**: o módulo dentro do app foi **removido**. A proposta é gerada **fora** (a partir
  do form) e o link entra no lead via `PATCH /api/leads/{id}` no campo `proposalUrl`.
- **MCP = manual**, não transmite dados (a pedido). Quem move dados é a API REST.

---

_Nota: os comentários no código-fonte estão em inglês; a documentação (este README) e a UI de
configuração estão em português. Posso traduzir os comentários do código também, é só pedir._
