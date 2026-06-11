# Cockpit · Plano do Rework — Produto de Funil de Vendas

> Documento canônico de contexto. Escrito em 2026-06-10 para que nenhum chat novo
> comece do zero. Atualizar a cada fase entregue.

---

## 1. Visão

O **Cockpit (Portfolio OS)** era um cockpit de gestão de portfólio de SaaS. O dono
decidiu evoluí-lo para ser TAMBÉM um **produto de funil de vendas nativo** (estilo
Inlead/Typeform): captação por forms, propostas comerciais por marca, pipeline
configurável, conexões reais e billing próprio. **Nada do cockpit existente se
deleta** — as duas identidades coexistem.

Referência de qualidade: o funil `/diagnostico` e a proposta comercial do
**Levercopy** (`/Volumes/SSD Eryk/SAAS MANAGER/copylever`) — design system Lever
Talents. O objetivo é que cada SaaS do portfólio tenha funil + proposta com a SUA
identidade visual, tudo nativo no Cockpit.

## 2. Arquitetura atual

Monorepo npm-workspaces em `/Volumes/SSD Eryk/SAAS MANAGER/saas-manager`:

| Serviço | Porta | Stack | Papel |
|---|---|---|---|
| `packages/api` | 8787 | Fastify 5 + pg | Única fonte da verdade (REST) |
| `packages/web` | 5173 | Vite + React 18 SPA | Admin (hidrata de `GET /api/bootstrap`) |
| `packages/mcp` | 8788 | MCP Streamable-HTTP | Cliente fino da API (tools genéricas) |

**Persistência:** Supabase Postgres, schema `cockpit`, **schemaless** — uma tabela
JSONB por collection (`id TEXT PK, json JSONB, updated_at`). Sem validação de
escrita; `CREATE_DEFAULTS` em `routes.js` preenche defaults na criação.

**Mecanismo central (não quebrar):** adicionar uma chave em `COLLECTIONS`
(`src/seed-data.js`) cria a tabela + CRUD REST + exposição MCP automaticamente.
Zero código de rota para coleção nova.

**Invariante financeiro (não quebrar):** MRR/ARR/clientes de produto SEMPRE
derivados da collection `customers` (`rollupProduct`/`computePortfolio` em
`routes.js`) — nunca dos campos crus do produto. Guardado por
`test/routes.rollup.test.js`.

**Auth atual (2026-06-10):** key OU sessão de usuário. Hook (`makeAuthHook` em
`api/src/auth.js`, registrado no `index.js`) aceita `COCKPIT_API_KEY` (MCP/
integrações) ou token de sessão de usuário no MESMO header (`x-api-key`/Bearer)
em TODAS as rotas, exceto `OPEN_PATHS` (`/api/health`, `/embed.js`,
`/favicon.ico`, `/api/auth/login`) e `OPEN_PREFIXES` (`/f/`, `/public/forms/`,
`/p/`, `/public/proposals/`).

**Usuários do time:** collections `users` + `sessions` (FORA do CRUD genérico —
hash/token não vazam; 404 no `/api/users`). Senha scrypt (`node:crypto`, salt
por usuário, timingSafeEqual). Rotas: `POST /api/auth/login` (aberta; nome
case-insensitive) → `{ token, user }` (TTL 7d), `GET /api/auth/me`,
`POST /api/auth/logout`, `GET/POST /api/auth/users` (lista sanitizada / cria
usuário já com hash). **Admins padrão:** `eryk` e `leonardo` (senha `1234` —
⚠️ TROCAR antes do deploy público; criados por `ensureDefaultAdmins` no boot só
quando `users` está vazia — restart nunca reseta senha). SPA: tela de login
(usuário+senha) substituiu o unlock por key; token vai pro mesmo localStorage/
header; footer do rail mostra o usuário + sair. Gotcha: após login o SPA dá
`location.reload()` — re-render in-place via `boot()` deixava a árvore nova sem
responder a cliques. Pendência: trocar senha/deletar usuário só por SQL ou
`POST /api/auth/users` novo (UI de gestão fica pra depois, junto de roles).

**Integração Levercopy:** `api/src/levercopy.js` — `runProposal(repo, lead, opts)`
chama `POST {LEVERCOPY_API_URL}/api/proposta/generate` (header `x-cockpit-key`),
gated em `lead.saas === LEVERCOPY_SAAS_ID` (default `leverads`). Fail-open.
Encaminha as respostas de qualificação do lead conforme
`product.leadQuestions` (chaves do contrato: `accounts`, `plan_expand`, `staff`,
`volume`, `marketplaces`, `niche`, `thesis`).

**Testes:** `cd packages/api && npm test` (node:test + mem-repo + Fastify inject,
sem Postgres). 50/50 em 2026-06-10. Build web: `npm run build` na raiz.

**Deploy:** Easypanel — `https://extrator-mp-saasmngmnt.gnnc3f.easypanel.host`
(API + MCP). ⚠️ **A pasta local NÃO é repo git e o deploy está DESATUALIZADO**
(roda código pré-rework). Todo o form builder existe só local. Descobrir o
processo de deploy com o dono é pré-requisito pra qualquer coisa ir pro ar.

## 3. Decisões de produto (todas resolvidas com o dono, 2026-06-10)

1. **Identidade:** cockpit multi-SaaS E produto de funil. Nada se deleta.
2. **Form builder:** paridade total Typeform/Inlead. ✅ ENTREGUE (fase 1).
3. **Hosting:** páginas hospedadas (`/f/:id`, `/p/:id`) E widget embed. ✅ forms.
4. **Proposta (ATUALIZADA 2026-06-10):** o proposal builder segue o MESMO modelo
   do form builder — **slides estruturados** (`slides[]` com tipos prontos) +
   tema por marca + **scroll-snap magnético** entre slides + preview ao vivo no
   builder. Slide tipo "custom HTML" cobre o fluxo "dono desenha no Claude e
   cola". Substitui a decisão anterior (template HTML inteiro colado).
   Referência: `copylever/app/templates/proposta.html`.
5. **Levercopy:** vira provider selecionável — `runProposal` = dispatcher
   `native | levercopy`, native default. Preserva testes e o caminho de produção.
6. **Lead scoring: NÃO EXISTE.** Cortado explicitamente pelo dono.
7. **Conexões (ordem):** e-mail (envio), webhook genérico, **Mercado Pago**
   (imprescindível — portar fluxos provados do copylever: `app/services/mp_api.py`
   = preapproval CRUD, pagamento avulso/checkout transparente, verificação de
   assinatura de webhook, refund, pró-rata; `app/routers/billing.py` + testes).
   Copylever é Python → portar contrato/fluxos pra Node, não copiar arquivo.
   SEM Stripe.
8. **Assinaturas:** Cockpit = system-of-record de billing (planos, faturas,
   dunning); MP só processa pagamento. Tem que escrever `customer.arr` pra
   preservar o invariante de rollup.
9. **Auth/tenancy:** dono + time, UM tenant. Contas reais (Supabase Auth), todos
   iguais na v1, roles depois. Superfície pública anônima endurecida (feito p/
   forms: rate-limit + honeypot + ids opacos).
10. **Volume:** paginação/soft-delete/auditoria entram quando o tráfego público
    crescer — engenharia decide.

**Ordem de construção:** Fase 1 forms ✅ → Fase 2 proposta ✅ → Fase 3 pipeline
config ✅ → Fase 5 assinaturas ✅ → Fase 4 conexões (ADIADA — dono decidiu em
2026-06-10 que MP/e-mail/webhook ficam "a cargo do app" por enquanto; pagamentos
entram no Cockpit via baixa manual de fatura).

## 4. ✅ Fase 1 — Form builder (ENTREGUE 2026-06-10, só local)

### Arquivos
- `api/src/forms.js` — domínio: `publicForm()` (sanitização), `buildSteps()`,
  `computePath()` (branching por TELAS), `validateAnswers()`,
  `leadFromSubmission()`, `makeRateLimiter()`.
- `api/src/form-page.js` — HTML standalone da página pública (`formPageHtml`) +
  `EMBED_JS`. Design portado do funil Lever (ver §4.3).
- `api/src/routes.forms.js` — rotas públicas + preview autenticado.
- `web/src/screens/forms.jsx` — lista / editor / preview iframe / respostas.
- `api/test/routes.forms.test.js` — 9 testes.
- Tocados: `seed-data.js` (collections `forms`, `form_submissions`),
  `routes.js` (defaults + filtros `?saas=`/`?form=` + registra form routes,
  exporta `CREATE_DEFAULTS`), `index.js` (open paths), `mcp/src/tools.js`
  (aliases forms/form_submissions), `web` (nav, app.jsx, api.js `formPreview`,
  entities.js entrada mínima p/ ConfirmDelete), `vite.config.js` (proxy
  `/f`, `/public`, `/embed.js`).

### Modelo do form
```
{ id, name, saas, status: "draft"|"published",
  theme: { bg, surface, fg, accent, accentFg, font, radius, logoUrl },
  welcome: { title, subtitle, button } | null,
  questions: [{ key, label, type, required, placeholder, help, stack?,
                options: [{ value, label, to? }], to?,
                stat?, statLabel?, durationMs? }],
  thanks: { title, subtitle, redirectUrl },
  mapping: { name, email, phone, company, amount } }   // campo do lead → key
```
- **Tipos:** text, textarea, email, phone, number, select, multiselect,
  **insight** (tela de loading com copy + stat + auto-avanço, sem resposta).
- **Telas (steps):** `stack: true` = renderiza na MESMA tela da anterior
  (1ª pergunta vira headline; demais viram form-groups com label mono).
  Insight é sempre tela própria. Progresso/pill contam só telas reais.
- **Branching:** `to` = key de outra pergunta ou `"_end"` (encerra → submit).
  Por opção (select) ou por pergunta; em tela múltipla vale o 1º destino na
  ordem. Servidor replica EXATAMENTE o caminho na validação (required só vale no
  caminho percorrido).
- **`*palavra*`** em títulos/subs → `<em>` itálico na cor accent.
- **Fonte:** renderer monta o link do Google Fonts da família primária de
  `theme.font`; builder tem FontPicker (Space Grotesk, Inter, Poppins,
  Montserrat, DM Sans, Manrope, Sora, Playfair Display + custom).

### Endpoints
- `GET /public/forms/:id` — definição publicada, sanitizada (sem mapping/saas).
- `POST /public/forms/:id/submissions` — anônimo. Rate-limit por IP
  (`FORM_RATE_LIMIT`, default 10/min), honeypot `_hp` (preenchido → finge ok e
  descarta), validação estrita → cria **lead** (respostas flat + mapping vence +
  `CREATE_DEFAULTS.leads`) + registro em `form_submissions` + `runProposal`
  best-effort (mesmo gatilho do EntityForm).
- `GET /f/:id` — página hospedada (definição inline em `window.__FORM__`).
  `?embed=1` = modo iframe (posta altura via postMessage).
- `GET /embed.js` — monta iframe em `[data-cockpit-form="id"]`, altura automática.
- `POST /api/forms/preview` (autenticado) — body = rascunho inteiro → `{ html }`.
  O builder injeta em iframe.srcdoc → preview com fidelidade total, zero
  duplicação de renderer.

### Design do renderer (linguagem Lever, parametrizada pelo tema)
Logo (ou nome) + pill de etapa / "← voltar" no topo · progresso segmentado
animado · eyebrow mono com ponto pulsante · headline display clamp(26–38px) ·
cards de opção com bullet rádio (quadrado no multiselect), letras A/B/C,
hover lift, glow de seleção · stagger slide-up · CTA full-width na cor da marca
("Enviar →" na última tela) · inputs card com focus glow · atmosfera radial do
accent · tela final com ícone de sucesso + anéis. Tons intermediários derivados
via `color-mix` dos 8 tokens — builder não muda quando o design evolui.

### Form real já criado
`fo_diagnostico_leverads` (published) — réplica fiel do `/diagnostico` do
copylever: copy real, branching (1 conta → pergunta de expansão; "não" → `_end`),
3 insights com stats, contato empilhado (nome+empresa+whatsapp+email), chaves do
contrato Levercopy → a proposta automática recebe a qualificação completa.

### Pendências da fase 1
- Tela de **bloqueio/desqualificação** (copylever tem, com captura de newsletter).
- **Interpolar respostas na tela final** (ex.: `{{nome}}, seu perfil foi aprovado`).
- Tags/sub-textos por opção (copylever tem `tag`/`sub` nos cards).
- `openapi.js` não documenta os endpoints públicos (string hardcoded).
- **DEPLOY** (ver §10).

## 5. ✅ Fase 2 — Proposal builder (ENTREGUE 2026-06-10, só local)

**Modelo:** igual ao form builder. Referência portada:
`copylever/app/templates/proposta.html` + `proposal.py` + `commercial.py`.

### Arquivos
- `api/src/proposal.js` — domínio: `splitLeadData()` (core vs respostas),
  `initialState()` (seats/volume/ciclo a partir das respostas), `publicProposal()`
  (sanitiza; editKey NUNCA vai pro HTML), `runNativeProposal()` (provider nativo:
  snapshot do template publicado → proposal + patch do lead com
  proposta_id/proposalUrl/proposal_edit_url).
- `api/src/proposal-page.js` — renderer standalone /p/:id (tema 8 tokens +
  color-mix + Google Fonts; slides client-side; scroll-snap mandatory >=900px;
  reveal IntersectionObserver; print CSS p/ PDF; calculadora projectMoney
  parametrizada; painel do closer; botão de aceite).
- `api/src/routes.proposals.js` — GET /p/:id (conta view quando SEM ?k),
  PATCH /public/proposals/:id (só state, autenticado por body.k === editKey),
  POST /public/proposals/:id/accept (rate-limit; marca proposta+lead; move
  lead.stage se acceptStage existe no funil), POST /api/proposals/preview.
- `web/src/screens/proposals.jsx` — abas Templates/Geradas; editor de template
  dirigido por SLIDE_SPECS (campos por tipo, listas genéricas), CalcEditor
  (params + seatsMap/volumeMid + planos por ciclo), preview iframe; lista de
  geradas com views/aceite/link/link-closer.
- `web/src/components/theme-inputs.jsx` — átomos compartilhados (ThemeEditor,
  FontPicker, ColorInput, LabeledInput/Textarea) extraídos do forms.jsx.
- `test/routes.proposals.test.js` — 6 testes (37/37 na suite).
- Tocados: seed-data (collections `proposal_templates`, `proposals`), routes.js
  (dispatcher + PUBLIC_BASE via COCKPIT_PUBLIC_URL + CONFIG.proposals.nativeSaas
  no bootstrap + defaults/filtros), index.js (OPEN_PREFIXES `/p/`,
  `/public/proposals/`), ProposalActions.jsx (botão aparece p/ SaaS com template
  nativo), MCP aliases, vite proxy `/p`.

### Dispatcher (POST /api/leads/:id/proposal — contrato preservado)
`product.proposalProvider` explícito ('native'|'levercopy') vence; sem ele:
'native' se o SaaS tem template PUBLICADO, senão 'levercopy' (LeverAds em prod
continua via Levercopy até existir template nativo — auto-migra ao publicar).
Resposta ganhou campo `provider`; resto idêntico (fail-open, auto/force).

### Interpolação e calculadora
`{{lead.name|firstName|company|email|phone}}`, `{{answers.<chave>}}` resolvem na
montagem; `{{calc.*}}`/`{{state.*}}` viram `<span data-fill>` recalculados ao
vivo pelo painel do closer. calc.* expostos: preco, precoCiclos, plano, ciclo,
roi, custoMes, custoAno, vendasEquiv, fatCopia, fatCompat, fatRetrabalho,
fatTotal, horaCusto, horasMes, minPorAnuncio, minCopia, minCompat,
contasDestino, assentos, salario, horasTrab, margem, uplift. Fórmula = port da
projectMoney() do copylever, parâmetros por template (calc).

### Template real criado
`pt_leverads` (published) — 8 slides com a copy integral da proposta do
copylever; calc com seatsMap/volumeMid/planos reais; acceptStage
"Config + Kickoff". Verificado e2e no browser: interpolação, fatura calculada
(R$ 5.300/mês p/ 4 contas × 110 anúncios/sem), pricing (R$ 449 trimestral),
painel do closer (4→8 contas → 449→649 ao vivo, congelar salva via token),
aceite (lead foi pra Config + Kickoff + proposalAccepted).

### Correções pós-render (2026-06-10, mesmo dia)
- ~~Snap **proximity**~~ **SUPERSEDED (mesmo dia, pedido do dono):** slide agora
  tem altura FIXA = viewport − nav (60px) no desktop; conteúdo maior é ESCALADO
  pra caber (`fitSlides()`: transform scale no `.wrap`, re-roda em resize/fonts/
  closer-panel/print). Com tudo cabendo, o snap voltou a **mandatory** +
  snap-stop (motivo do proximity sumiu); footer ancora com `snap-align: end`.
  Verificado em 1920×1080 (investimento escala ×0.80) e 1366×768 (×0.54).
- Slide closer ANEXA à seção anterior (era seção própria de 100vh quase vazia).
- Footer fora do full-height (era "slide vazio" de 900px).
- GOTCHA CSS: conteúdo com `<em>/<span>` dentro de container `display:flex`
  vira flex-items separados que NÃO quebram linha → overflow horizontal no
  mobile. Fix: embrulhar num único filho (`.ret-body`/`.point-body`).

### Atualização 2026-06-11 — preços novos + grade de ciclos + slide de regras
- Ciclo **semiannual** (Semestral) existe em todo o stack: renderer da proposta
  (`CYCLE_NAME/CYCLE_MONTHS/CYCLE_ORDER`), whitelist do PATCH do closer
  (`routes.proposals.js`), `billing.js` (CYCLE_MONTHS), `routes.mp.js` (label),
  UI de assinaturas/entities, CalcEditor.
- Slide **pricing** ganhou grade de ciclos opcional (`optionsFeatured` = ciclo
  destacado c/ selo `optionsBadge`; vazio = sem grade): 1 card por plano de
  `calc.plans` com R$/mês, total cobrado no ciclo e parcelado sem juros; clicar
  troca `state.cycle` ao vivo (congelar segue no painel do closer). Render
  dinâmico via `renderPlanOptions()` no `fillDynamic()`. Calc novo:
  `{{calc.totalCiclo}}`, `{{calc.mesesCiclo}}`, `{{calc.parcelado}}`; `preco`
  agora mostra centavos quando existem (moneyBR).
- **Preços LeverAds atuais** (`pt_leverads`, base p/ 2 contas + R$/conta extra):
  trimestral 350 + 79,90 · semestral 300 + 59,90 (defaultCycle, destacado) ·
  anual 274,90 + 49,90. Sem plano mensal.
- Slide novo `copia_automatica` (steps, "Etapa 04 · piloto automático"): regras
  de cópia automática do copylever (cadastra regra origem→destinos; anúncio novo
  na origem → ML notifica → replica sozinho; só ML, forward-only, anti-dup).
  Eyebrows renumerados (impacto 05, retorno 06, investimento 07).
- **Layout denso** (`section.compact-pricing`, só desktop ≥900px): com a grade
  ativa o slide pricing usa versão compacta (número 76px em vez de 160px,
  features em 2 colunas, garantia/payback menores, wrap centrado via flex) —
  altura natural caiu de ~1430px pra ~640px, então o `fitSlides()` quase não
  escala (1366×768 = escala 1.0; antes era ~0.46, texto ilegível).
- Pedido do dono (2026-06-11): `pt_leverads` SEM closeLine, SEM botão "Aceitar
  proposta" e SEM slide closer (fechamento é via WhatsApp fora da página).
  Renderer mantém os 3 recursos pra quem quiser usar.

### Pendências da fase 2
- Renderer não tem tela "proposta congelada" diferenciada (frozen só trava no
  closer panel conceitualmente — números continuam dinâmicos pro lead com o
  state salvo; comportamento igual ao copylever).
- PDF server-side (v1 = print CSS, como a referência).
- WhatsApp do closer por proposta (hoje ctaUrl fixo no slide closer).

### Referência original (mantida para consulta)

### O que a proposta do copylever faz (portar)
- 6 seções full-height com **trava magnética** (desktop ≥900px):
  `html { scroll-snap-type: y mandatory }` + `scroll-snap-align: start` +
  `scroll-snap-stop: always` + `min-height: 100vh` (respeita
  `prefers-reduced-motion`).
- Slides: **hero** personalizado ("Quanto a *[Empresa]* perde *todo mês*") →
  **diagnóstico** (cards com as respostas do form) → **fatura oculta** (cupom
  fiscal visual com custo calculado) → **solução** (3 step-cards + pills) →
  **antes×depois** (compare com checks/crosses) → **retorno + investimento**
  (número gigante de ROI, price card, garantia 30d, payback, bloco do closer
  com CTA WhatsApp).
- **`data-fill`**: placeholders preenchidos com dados do lead/diagnóstico.
- **Calculadora viva** (`projectMoney()`): custo oculto = volume × contas ×
  min/anúncio × (salário/176h) + retrabalho 10%; equivalente em vendas =
  custo/margem; preço por ciclo (mensal/trimestral/anual) + assentos extras.
- **Painel do closer** (`?k=token`): painel flutuante ajusta contas/volume/
  ciclo/validade/preço negociado ao vivo e "congela" (PATCH).
- Reveal animations (IntersectionObserver) + CSS de print (PDF via imprimir).

### Plano de implementação
1. **Collections:** `proposal_templates` (por SaaS: theme compartilhado da marca,
   slides[], calcParams) e `proposals` (instância por lead: template, lead,
   overrides do closer, frozen, viewedAt[], token de edição).
2. **Tipos de slide v1** (mesma mecânica de `questions[]`): `hero`, `cards`,
   `receipt` (fatura), `steps`, `compare`, `bignum` (ROI), `pricing`,
   `closer`, `custom` (HTML livre — fluxo "desenha no Claude e cola").
   Cada tipo com campos de copy editáveis + suporte a `*itálico*`.
3. **Interpolação server-side:** `{{lead.name}}`, `{{lead.company}}`,
   `{{answers.accounts}}`, `{{calc.hiddenYear}}` etc.
4. **Renderer `/p/:id`** público (prefixo aberto no auth) — mesma base visual do
   form renderer + scroll-snap + reveal + print CSS. Tracking de visualização
   (POST público de view → marca no proposal + sinal no lead).
5. **Calculadora:** v1 = fórmula do copylever parametrizada por template
   (salário, horas, min/anúncio, retrabalho %, margem, preços por ciclo,
   assentos). Fórmulas custom = v2.
6. **Painel do closer** com token opaco (`?k=`) — PATCH autenticado pelo token.
7. **Builder no SPA:** aba Propostas — templates por SaaS (lista de slides,
   editor por tipo, preview ao vivo via endpoint de preview, igual forms) +
   lista de propostas geradas (status, visualizações, link, congelar).
8. **Dispatcher:** `runProposal` vira `native | levercopy` por produto
   (`product.proposalProvider`), native default. Contrato HTTP e testes
   existentes preservados (`routes.proposal.test.js`, `levercopy.test.js`).
9. **PDF export:** v1 = CSS de print (como copylever). Geração server-side = v2.
10. Botão **aceitar proposta** → move lead no pipeline (decisão da rodada de
    produto: aceite sem assinatura jurídica).

## 6. ✅ Fase 3 — Pipeline/funil config (ENTREGUE 2026-06-10, só local)

Tudo que era mockup read-only em `web/src/screens/settings.jsx` virou editor real
por SaaS (grava no produto — schemaless, sem migração):

- **Funil & estágios:** nome, cor (`funnel[].color`, fallback = cor do produto),
  conversão %, auto-regra `funnel[].staleDays` ("parado → Nd"), reorder, add/remove.
  Salva via **`PUT /api/products/:id/funnel`** body `{ funnel, renames }` — o
  servidor MIGRA `lead.stage`/`deal.stage` renomeados (resolve o risco do rename
  órfão; rename pra estágio fora do funil novo é ignorado). O editor rastreia o
  nome original por linha (`_orig`) e monta o mapa `renames` sozinho.
  ⚠️ Editar funil pelo EntityForm do produto (PATCH cru) continua possível e NÃO
  migra — o caminho recomendado é Ajustes. Remover estágio não move os cards
  (caem no 1º estágio na visualização, comportamento pré-existente do kanban).
- **Campos custom** (`product.customFields.{deals|customers|leads}`): cada campo
  `{ key, label, type, options? }` (text/textarea/number/money/select) vira input
  no EntityForm da entidade quando o registro é do SaaS — mesmo padrão dinâmico
  de `leadQuestionFields` (marcados `_dynamic`, semeados ao trocar de SaaS).
- **Pesos da saúde** (`product.healthWeights` em %, somam 100 — save trava se
  não): `hydrateSeed` (data.jsx) usa os pesos no decomp; fallback 25/25/25/25.
- **Aha** (`product.aha.conditions[]`): lista editável de condições.
- **Kanban:** dot colorido no header da coluna + chip "parado→Nd" + badge
  vermelho "· parado" no card quando `lead.age` numérico ≥ staleDays (idade
  string tipo "agora"/"2h" não dispara — limitação conhecida, lead não tem
  createdAt confiável).
- **Integrações:** segue mock (fase 4 a cargo do app).

Arquivos: `routes.js` (rota funnel + CREATE_DEFAULTS.products ganhou
customFields/healthWeights/aha), `settings.jsx` (rework), `entities.js`
(`customEntityFields`), `EntityForm.jsx` (effectiveFields estendido a
deals/customers), `data.jsx`, `pipeline.jsx`, `api.js` (`saveFunnel`),
`atoms.jsx` (PrimaryButton ganhou `disabled`). Testes: `routes.funnel.test.js`
(3). Gotcha de UX: o App remonta a tela a cada refresh (key=dataVersion) — o
settings guarda aba/SaaS em variável de módulo (`lastView`) pra sobreviver.

## 7. ✅ Fase 5 — Assinaturas (ENTREGUE 2026-06-10, só local; SEM MP — fase 4 adiada)

Cockpit = **system-of-record**: collections `plans`, `subscriptions`, `invoices`
(CRUD genérico + filtros `?saas/customer/status/subscription`). O pagamento em si
fica no app/MP por enquanto — fatura recebe baixa via `POST /api/invoices/:id/pay`.

- **`api/src/billing.js`** (domínio): `annualized(price, cycle)`
  (monthly/quarterly/annual), `contractedArr` (active + past_due contam;
  paused/canceled não), **`syncCustomerArr`** — INVARIANTE: toda mutação de
  assinatura reescreve `customer.arr` (rollup do produto deriva daí). Hooks no
  CRUD genérico (routes.js): POST chama `initSubscription` (janela do 1º ciclo +
  fatura inicial + ARR), PATCH/DELETE re-sincronizam (PATCH sincroniza os dois
  clientes se `customer` mudou). Cliente SEM assinatura nunca passa pelo sync —
  arr manual continua valendo.
- **Pró-rata** (`computeChange`, port de `copylever/app/services/prorata.py`,
  sem seats/sem mínimo MP): upgrade mid-cycle aplica preço já + fatura
  `kind:"prorata"` = `(novo−velho)/diasDoCiclo × diasRestantes`; downgrade e
  troca de ciclo gravam `sub.pendingChange` com `applyAt = periodEnd` (MP não
  muda frequency in-place). `POST /api/subscriptions/:id/change`.
- **Motor** (`runBilling`, `POST /api/billing/run` — tick manual/cron/MCP):
  aplica pendingChanges vencidos → rollover de ciclo (avança periodStart/End com
  `addMonths` clampado no fim do mês, guard de 24 iterações; gera fatura
  `kind:"renewal"` open com dueDate=início do ciclo) → dunning (open vencida além
  da carência `graceDays` default 3 → `overdue`; assinatura com overdue →
  `past_due`; sem overdue → volta `active`) → re-sync ARR dos clientes tocados.
  Pagar a última fatura vencida também recupera a assinatura na hora.
- **UI:** nav "Assinaturas" (grupo retenção) → `screens/subscriptions.jsx`: abas
  Assinaturas/Faturas/Planos por SaaS, criar via EntityForm (plano com options
  dinâmicas via `window.PLANS_CACHE`, setado pela tela), modal "mudar plano"
  (mostra pró-rata faturado ou agendamento), pausar/reativar/cancelar, "marcar
  paga", botão "▸ rodar billing" com relatório.
- Testes: `routes.billing.test.js` (5). **Verificado e2e** na API real + browser:
  assinatura 449/mês → ARR 5.388 → MRR 449 no rollup; upgrade 449→649 → pró-rata
  193 faturado; rename de funil migrou lead; telas Assinaturas e Ajustes operando.

### Pendências fase 3+5
- Idade do lead é string sem createdAt — regra "parado" só pega `age` numérico.
- EntityForm de assinatura não auto-preenche preço ao escolher plano (o modal de
  mudança preenche).
- `openapi.js` não documenta os endpoints novos (mesma pendência da fase 1).
- Rodar `POST /api/billing/run` periodicamente (cron) quando estiver no ar.

## 8. Fase 4 — Conexões (MP ✅ ENTREGUE 2026-06-10; e-mail/webhook adiados)

### ✅ Mercado Pago (core da fase 4)
Port de `copylever/app/services/mp_api.py` ligado no motor da fase 5.
**Credenciais via ENV** (resolve o ⚠️ de segredo em JSONB — single tenant):
`MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET` no Easypanel.

- **`api/src/mp.js`** — client REST sem SDK (`makeMp` com fetch injetável pra
  teste): preapproval create/get/cancel/pause/resume, `updatePreapprovalAmount`
  (PUT só do valor — MP mantém cartão/ciclo), payment/authorized_payment get,
  refund, `verifyWebhookSignature` (HMAC manifest `id;request-id;ts`),
  `parseWebhookPayload` (normaliza v2 Webhooks e v1 IPN). Preço em REAIS
  (transaction_amount), sem centavos.
- **`api/src/routes.mp.js`**:
  - `POST /api/subscriptions/:id/mp/link` → cria preapproval `pending`
    (payer = `customer.email` ou `body.payerEmail`; `external_reference` =
    id da assinatura; valor/ciclo da assinatura) e salva
    `mpPreapprovalId`/`mpInitPoint`/`mpStatus`/`payerEmail` no sub. O closer
    manda o `init_point` pro cliente autorizar.
  - `POST /public/mp/webhook` (ABERTA — prefixo `/public/mp/` no index;
    **configurar no painel MP**: `https://<host>/public/mp/webhook`):
    verifica HMAC quando há secret + SEMPRE re-fetch do recurso (body é
    forjável). `subscription_preapproval` → mapeia authorized→active,
    cancelled→canceled, paused→paused + sync ARR. `authorized_payment`
    processed e `payment` approved → **baixa automática** da fatura
    aberta/vencida mais antiga (idempotente por `mpPaymentId`; cria fatura
    paga se não houver aberta; recupera past_due→active).
  - **Payer cross-check** (padrão copylever): payer do evento ≠ payer salvo
    → evento DROPADO + log de erro.
- **Espelho Cockpit → MP** (fail-open): PATCH de status da assinatura
  (cancelar/pausar/reativar) replica no preapproval; upgrade via `/change`
  faz PUT do valor novo (resposta ganha `mpSync: ok|failed`).
- **UI:** Assinaturas ganhou botão "cobrar via MP"/"link MP" (copia o
  init_point) + chip de status MP; aparece só com `CONFIG.mp.configured`
  (bootstrap). Cliente ganhou campo `email` (payer). Integrações mostra o
  status real do MP.
- Testes: `routes.mp.test.js` (6, fetch mockado — assinatura HMAC, link,
  webhook authorized/cancelled, baixa idempotente, mismatch, 503/400).
- Limitações v1 (anotadas): troca de CICLO com MP ativo exige re-gerar o
  link (MP não muda frequency in-place — cancel+recreate fica pra depois);
  downgrade agendado não faz PUT de valor quando o motor aplica (re-gerar
  link ou PUT manual); sem checkout transparente (card token) — fluxo é o
  init_point.

### ✅ Meta Ads (marketing — 2026-06-11)
Insights de campanha cruzados com o funil. Env: `META_ACCESS_TOKEN` (system
user, ads_read); conta de anúncio é POR SAAS (`product.metaAdAccount`,
editada em Ajustes → Integrações).
- **`api/src/meta.js`** — `campaignInsights(adAccount, {since, until})`: Graph
  v23.0 `/act_X/insights` level=campaign, time_increment=1, segue paginação;
  leads = action_type `"lead"` (total canônico da Meta).
- **`api/src/routes.marketing.js`** — `POST /api/marketing/sync` (upsert
  idempotente em `ad_insights`: 1 linha por saas+campanha+dia) e
  `GET /api/marketing/:saas?since&until`: spend/impressões/cliques/CPM/CPC/CTR,
  **CPL real** (spend ÷ leads criados no Cockpit no período), **CPL Meta**,
  **custo por estágio do funil** (lead com estágio atual ≥ i conta pro estágio
  i — custo por call/por ganho saem daí sem config), campanhas, série diária.
- Leads ganharam `createdAt` na criação (CRUD genérico + submissão de form) —
  leads antigos sem createdAt ficam fora das métricas por período.
- **UI:** tela **Marketing** (nav receita): períodos 7/30/90d, sync, KPIs,
  custo por estágio, campanhas, sparkline de spend. Sync é manual (botão) —
  cron de sync diário fica como pendência junto do `/api/billing/run`.

### 🔜 Adiados
E-mail (Resend/SMTP; proposta + notificações) e webhook genérico (POST em
eventos: lead novo, proposta vista/aceita).

## ✅ Tarefas — kanban do time (entregue 2026-06-11, só local)

"Trello interno": nav Tarefas (grupo pessoas) → `web/src/screens/tasks.jsx`.
Collections `tasks` + `task_boards` (CRUD genérico — zero rota nova).

- **Card** (`tasks`): título, descrição, saas, `assignees[]` (ids de usuários
  do time, lista via `GET /api/auth/users` → `api.listUsers()`; multi —
  chips de toggle no modal, avatares sobrepostos no card; filtro `?assignee`
  pega quem participa e ainda aceita o campo string legado), `column` (KEY
  estável da coluna — renomear coluna NÃO órfã o card), prioridade P0–P2,
  dueDate (vencida = vermelho), labels, `order` (float; drop em card = entra
  antes via ponto médio, drop na coluna = vai pro fim), createdAt (stamp no
  POST genérico, igual leads), `comments: [{ id, author, text, at }]` —
  autor = usuário logado (localStorage `cockpit_user`); o SPA faz PATCH do
  array inteiro (time pequeno, sem race real).
- **Board** (`task_boards`, 1 registro criado ao editar): `columns[{ key,
  name, color }]`. Sem board salvo valem DEFAULT_COLUMNS (A fazer / Em
  andamento / Concluído) — zero setup. Menu ⋯ por coluna: rename, cor,
  mover ◀▶, excluir (cards caem na 1ª coluna, igual pipeline); "+ coluna".
- **Filtros**: SaaS (chips), responsável (select), busca (título+descrição).
  Filtros sobrevivem ao remount do refresh via variável de módulo
  (`lastFilters`, padrão do settings.jsx).
- Tocados: seed-data (2 collections), routes.js (defaults + filtros
  `?saas/assignee/column` + stamp), MCP aliases (tarefa/task/quadro),
  api.js (`listUsers`), chrome.jsx (nav), app.jsx (rota), entities.js
  (entrada mínima p/ ConfirmDelete). Testes: `routes.tasks.test.js` (3;
  suite 66/66). Verificado e2e no browser: criar, arrastar (todo→doing
  persistiu), comentar (autor Leonardo), renomear/colorir coluna (key
  estável), reload mantém tudo.

## 9. Transversais
- **Auth do time:** ✅ v1 entregue (login simples com sessão — ver §2). O plano
  original era Supabase Auth/JWT; o dono pediu sistema simples com 2 admins
  padrão. Roles/gestão de usuários na UI e (se necessário) migração pra
  Supabase Auth ficam pra depois. ⚠️ Trocar a senha padrão `1234` no deploy.
- **Volume:** paginação, soft-delete, auditoria, rate-limit geral.
- **Tela de bloqueio + interpolação na tela final** (pendências fase 1).

## 10. ⚠️ Deploy (bloqueador de produção)
- Sessões MCP/produção apontam pro Easypanel com código ANTIGO (pré-rework).
- A pasta É repo git (descoberto 2026-06-10; doc anterior dizia que não):
  `github.com:Eryk-dev/saasmanagement`, branch `main` — rework inteiro commitado
  e pushado (`cd93591`). Tem `Dockerfile`/`Dockerfile.allinone`/`deploy/` no
  repo. **Confirmar com o dono se o Easypanel builda desse repo** (se sim,
  deploy = rebuild no painel) e subir API + MCP + web.
- ⚠️ Antes de expor público: trocar a senha padrão `1234` dos admins (§2).
- ⚠️ O nginx do allinone precisa proxyar a superfície pública (`/f/`, `/p/`,
  `/public/`, `/embed.js`) além de `/api/` — sem isso o try_files do SPA engole
  e "abre o app" (corrigido 2026-06-10 em `deploy/nginx.allinone.conf`).
- ⚠️ Setar `COCKPIT_PUBLIC_URL=https://<host>` no Easypanel — é a base das URLs
  gravadas no lead (`proposalUrl`); sem ela saem como `http://localhost:8787`.
- Após deploy: links públicos viram
  `https://<host>/f/fo_diagnostico_leverads` e o MCP da sessão cria forms.

## 11. Gotchas técnicos (aprendidos na prática)
- `form-page.js` é UM template literal gigante → **nenhuma crase** dentro do
  script/comentários internos (quebrou uma vez); script interno usa concatenação,
  não template literals.
- `CREATE_DEFAULTS.leads.amount = 0` → lead sem valor tem `amount: 0`, não
  `undefined` (pegadinha em asserts).
- Atributo `[hidden]` perde pra `display: flex` autoral — precisa
  `.x[hidden] { display: none }`.
- Embed mantém o **bg do tema** (transparente quebra contraste em site claro).
- Form sem `welcome` inicia direto na 1ª tela (`cur = 0`); sem perguntas, cai na
  tela final (preview de form recém-criado).
- Testes: criar repo novo por teste (`makeMemRepo()`); `registerRoutes(app, repo,
  { forms: { rateLimit } })` injeta limite pro teste de 429.
- MCP local: `COCKPIT_API_URL=http://localhost:8787 node packages/mcp/src/index.js`.
- Logo Lever público: `https://copy.levermoney.com.br/lever/logo-lever-inverse.svg`.
  Paleta Lever: navy `#051C2C`, off-white `#F3FBFF`, turquesa `#23D8D3`.
- Copylever tem regra de estabilidade de produção própria (staging schema +
  canary) — NÃO mexer no copylever neste rework; ele é só referência + contrato.

## 12. Como retomar numa sessão nova
1. Ler este arquivo.
2. `cd saas-manager && npm run dev` (precisa `.env` na raiz — já existe, com
   `COCKPIT_DB_URL`, `COCKPIT_API_KEY` etc).
3. Testes: `cd packages/api && npm test` (devem estar 50/50).
4. Próximo passo: **DEPLOY** (§10) — fases 1, 2, 3 e 5 prontas e testadas, só
   existem local. Depois: Fase 4 (conexões — quando o dono liberar) ou
   pendências menores (§4/§7), ou Auth real (§9).
