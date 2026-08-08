# Design system do cockpit

> **Estado: preenchido a partir do código real em 2026-08-08** (tokens.css v7
> "Lever Premium", atoms.jsx, viz.jsx, charts.jsx). Este arquivo é a fonte da
> verdade: registre aqui qualquer padrão novo aprovado, e risque dívidas
> conforme resolver. Não invente valores — confira no código antes de mudar.

## Stack

- Framework / template engine: React 18 + Vite, SPA com rota no hash (`#pipeline`); tela ativa resolvida em `packages/web/src/app.jsx`
- Biblioteca de estilo: **nenhuma** — estilo inline (objetos JS) sobre CSS custom properties de `packages/web/src/tokens.css` + poucas classes utilitárias no mesmo arquivo
- Biblioteca de componentes: **própria** — `atoms.jsx` (primitivos), `components/viz.jsx` (PageHead/Card/StatTile/Segmented/FilterTab/Pill), `charts.jsx` (funil, MRR, tiles de métrica)
- Biblioteca de gráficos: **nenhuma** — SVG desenhado à mão (`LineChart` em viz.jsx, `Sparkline`/`HealthArc` em atoms.jsx, charts.jsx)
- Biblioteca de tabela: **nenhuma** — `<table>` manual por tela (ver Dívidas)

## Tokens

Fonte: `tokens.css`. Tema claro é o padrão; dark via `body[data-theme="dark"]`.
O accent deriva de `--accent-h` (hue 183 = teal LeverAds; workspace UniqueKids
troca o hue em runtime). **Nunca hex solto em tela: sempre var(--token).**

### Cores
| Token | Valor (claro) | Uso |
|---|---|---|
| `--accent` | teal ≈ #0F766E (oklch h183) | seleção, kicker que nomeia bloco, links; **teal é seleção, não ação** |
| `--btn-bg` / `--btn-fg` | navy #0C1D2B / branco | botão primário (no dark inverte: claro sobre escuro) |
| `--bg-0` | #F7F8FA | fundo da página (paper) |
| `--bg-1` | #FFFFFF | cards e painéis (paper-card) |
| `--bg-2` / `--bg-3` / `--bg-inset` | #EEF1F3 / #E7EBEE / #FBFCFD | wells, trilhos, thead, tiles internos |
| `--line-1` / `--line-2` / `--line-strong` | #E4E8EB / #CBD4DA / #AEB9C2 | divisores / borda de controle / ênfase |
| `--fg-1` … `--fg-5` | #0C1D2B → #98A5AF | texto: primário, soft, muted, faint, disabled |
| `--pos` / `--neg` / `--warn` / `--info` | #177A4C / #B42318 / #A16207 / #175CD3 | estados; cada um tem par `-soft` pra fundo |
| `--accent-soft` / `--accent-line` | teal 10% / 38% | fundo e borda de seleção |
| `--chart-1` / `--chart-2` | #0F9D90 / #5B6BD6 | séries de gráfico (validadas p/ daltonismo) |

### Tipografia

Fontes: `--sans` Instrument Sans (TODA a UI, inclusive rótulos), `--mono`
JetBrains Mono (SÓ dados/IDs/código via `.tnum`/`.code`), `--display` = sans.

**Régua única de cabeçalhos (PR #621)** — classes em tokens.css, componentes
`SectionHead`/`CardHead` em atoms.jsx. Subtítulo SEMPRE na linha de baixo, nunca
inline. Máximo ~3 níveis por tela.

| Nível | Tamanho | Peso | Uso |
|---|---|---|---|
| título de página (`.page-title` / `PageHead` viz.jsx) | 26px | 700, -0.02em | 1 por tela; sub `.page-sub` 14.5 fg-3 embaixo |
| título de seção (`.sec-title` / `SectionHead`) | 17px | 700, -0.01em | agrupa cards; sub `.sec-sub` 12.5 fg-4 |
| título de card (`.card-title` / `CardHead`) | 15px | 700, -0.01em | sub `.card-sub` 12.5 fg-3 |
| kicker (`.kicker`) | 10px | 400, 0.08em, UPPERCASE | rótulo: cinza fg-4 = estado/subdivisão; `.kicker.accent` NOMEIA o bloco (máx. 1 por card, no topo); pos/neg só com significado |
| corpo | 12.5–13.5px | 400 | texto corrido 12.5 fg-2; destaque 13.5 |
| número em destaque | 30px (StatTile) / 22–42 | 700 display + `.tnum` | KPI; sessões usam 42 |

### Espaçamento e forma
- Escala de espaçamento: página `28px var(--pad-x)` (pad-x 28→14 no mobile); gap entre cards 14–16; respiro interno de card `20px var(--inset-x)` (24→14)
- Raio de borda: `--r-4` 12 card · `--r-3` 10 interno/modal · `--r-2` 8 controle/botão · `--r-1` 5 badge · 999 pill
- Sombra: `--shadow-card` (quase invisível) card · `--shadow-2` elevado · `--shadow-pop` modal/dropdown · **nunca glow**
- Largura máxima do conteúdo: por bloco, não global — 720/760/920/980 conforme a tela; telas de board/tabela ocupam tudo
- Breakpoints: **768px** estrutural (`useIsMobile` em lib/responsive.js: drawer de nav, layout) · **900px** no CSS (`--pad-x` encolhe, `.resp-cols` empilha, `.hide-mobile`/`.show-mobile`) · `pointer: coarse` (scrollbar fina, inércia)

## Componentes base

- Botão: primário = `PrimaryButton` (atoms.jsx, navy 32px) ou inline `--btn-bg/--btn-fg` 40px em CTAs grandes; secundário = borda `--line-2` fundo `--bg-1` (redeclarado por tela — ver Dívidas); terciário = texto `mono dim`. **1 primário por região.**
- Input / Select / Datepicker: sem átomo único — altura 26–30, `--bg-1`, borda `--line-2`, `--r-2` (ver Dívidas); formulário CRUD = `components/EntityForm.jsx` (dirigido por `lib/entities.js`); data/hora usa `<input type="datetime-local">` com pegadinha de fuso (BRT sem sufixo)
- Tabela: `<table>` manual; `th` = `className="kicker"` + padding `8px 10px`; `td` 12.5px com `borderTop: var(--line-1)`; linha clicável com hover/seleção `--accent-soft`; larga = envolver em `.tbl-x`
- Card / KPI: card genérico = `Card` (viz.jsx); KPI = `StatTile` (viz.jsx, rótulo 12.5 + valor 30/700); `MetricTile`/`BigNumber` (charts.jsx) em análises; tile interno = `--bg-inset` + `--r-2`
- Badge / status: `.chip` (tokens.css: neutro, `.pos/.neg/.warn/.info` com ponto, `.accent`) e `Pill` (viz.jsx)
- Modal: overlay `fixed inset-0` `oklch(0 0 0 / 0.45)` z-80 + painel `--bg-1`/`--r-3`/`--shadow-pop`; confirmar exclusão = `components/ConfirmDelete.jsx` (nomeia o item + consequência); detalhe de lead = drawer `LeadDetail` (screens/deal.jsx); todo modal dentro de `ErrorBoundary variant="modal"`
- Toast: **não existe global** — sucesso/erro é texto inline na tela (ver Dívidas)
- Estado vazio: `EmptyState` (atoms.jsx: título 15/600 + hint + ação central)
- Skeleton de carregamento: **não existe** — padrão vigente é texto `mono dim` 12px ("carregando…", "montando sua fila…") no lugar do bloco

## Padrões de tela

- Layout padrão: `app-shell` flex → `NavRail` (chrome.jsx; drawer no mobile) + `TopBar` (breadcrumb, busca ⌘K `CommandSearch`, sino, period-picker nas telas de análise) + tela dentro de `ErrorBoundary variant="screen"`
- Cabeçalho de tela: `PageHead` (viz.jsx) com título + sub + ações à direita; telas antigas hand-rolam o mesmo visual (migrar quando tocar)
- Barra de filtros: `Segmented` (visões), `FilterTab` (categorias com contagem), busca com `<input>` 30px; período = `components/period-picker.jsx` (atalhos + calendário 2 meses, semana começa segunda) via `usePeriod`/`cockpit_period` — janela GLOBAL, persiste entre telas
- Listagem com paginação: não há paginação — o seed vem inteiro e filtra em memória; lista longa mostra contagem ("N de M") e corta com busca/filtro
- Formulário de cadastro/edição: `EntityForm` genérico (label kicker em cima do campo, grid responsivo, salvar primário à direita); dedup de lead avisa mescla
- Tela de detalhe: drawer sobre a tela (LeadDetail), nunca rota nova; fecha no X/Esc/clique fora

## Formatação de dados

Tudo em `lib/format.js`, exposto como `window.fmt`. **Nunca formatar na mão.**

- Moeda: `fmt.money` compacto — `R$840`, `R$56,3k` (sempre 1 casa em milhar), `R$1,2M`; null → "—"
- Data / data-hora: `dd/mm` pt-BR (+ hora `HH:mm` quando importa); dia de NEGÓCIO = `bizDay` (America/Sao_Paulo, NUNCA slice de ISO)
- Percentual: `fmt.pct` 0 casas; delta em pontos = `fmt.pctDelta` ("+3pp")
- Números grandes: `fmt.int` com separador de milhar; abreviar só dinheiro
- Valores negativos: cor `--neg` + sinal (nunca só cor); deltas via `Delta` (atoms.jsx), invertível p/ métricas onde menor = melhor

## Contexto de uso (pesos da auditoria)

Desktop-first (uso principal: gestor e time no notebook), mas o time acessa do
celular na rua: **toda tela precisa continuar usável a 390px** (PR #361) usando
`.resp-cols`, `.tbl-x`, `min(100%, Npx)` e `--inset-x`. Densidade: painel
gerencial — linhas compactas, muito dado por tela; `body[data-density]` existe
(compact 13.5 / regular 14).

## Dívidas conhecidas

Divergências mapeadas na auditoria de 2026-08-08. Riscar conforme resolve.

| Divergência | Onde aparece | Padrão que deve prevalecer |
|---|---|---|
| ~160 kickers uppercase à mão (6 tamanhos × 6 spacings) | 42 arquivos (piores: today, settings, forms, metrics, pipeline, social, whatsapp) | `.kicker` / `.kicker.accent` (régua #621) — varredura aguardando OK visual do Leo no piloto Treinamentos |
| 11 combos de tamanho×peso como "título de card" | idem | `.card-title` + `.card-sub` |
| `Card` (viz.jsx) com título 15.5/600 e hint INLINE | todas as telas que usam Card | alinhar à régua: 15/700 + sub embaixo (mexe em muitas telas de uma vez — fazer como lote próprio) |
| Cabeçalho de página hand-rolado igual ao PageHead | training.jsx (Head), outras | usar `PageHead` (viz.jsx) |
| Botão secundário redeclarado por tela (`const btn`) | quase toda tela | extrair átomo (SecondaryButton) em atoms.jsx |
| Sem toast global; sucesso = texto inline que some no refresh | finance, forms, subscriptions, training… | definir 1 padrão (toast leve ou linha de status padronizada) |
| Sem skeleton; "carregando…" em texto | todas | oficializar o texto padrão OU criar skeleton — decidir com o Leo |
| Tabela manual com th/td redeclarados | customers, training (Equipe), finance, forms… | componente Table compartilhado (th kicker, td 12.5, hover, vazio) |
| Inputs com alturas 24/26/30 variando | forms diversos | altura única 30 (28 em contexto denso) |
