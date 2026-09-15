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
| kicker (`.kicker`) | 10px | 400, 0.08em, UPPERCASE | rótulo: cinza fg-4 = estado/subdivisão; `.kicker.accent` NOMEIA o bloco (máx. 1 por card, no topo); pos/neg só com significado. Peso 600 inline SÓ em separador estrutural (cabeçalho de grid-tabela, seção de tabela, categoria do NAV). Exceções que ficam fora: anotação dentro de gráfico < 9.5px e `textTransform` funcional (input que digita maiúsculo, `capitalize` de mês) |
| corpo | 12.5–13.5px | 400 | texto corrido 12.5 fg-2; destaque 13.5 |
| número em destaque | 30px (StatTile) / 22–42 | 700 display + `.tnum` | KPI; sessões usam 42 |

### Espaçamento e forma
- Escala de espaçamento: página `28px var(--pad-x)` (pad-x 28→14 no mobile); gap entre cards 14–16; respiro interno de card `20px var(--inset-x)` (24→14)
- Raio de borda: `--r-4` 12 card · `--r-3` 10 interno/modal · `--r-2` 8 controle/botão · `--r-1` 5 badge · 999 pill
- Sombra: `--shadow-card` (quase invisível) card · `--shadow-2` elevado · `--shadow-pop` modal/dropdown · **nunca glow**
- Largura: TELA ocupa sempre a largura inteira (raiz sem maxWidth — regra do Leo, 08/08, PR #630: Metas/Configurações/Remuneração/Treinos tinham raiz travada e foi removido). Medida (maxWidth) só em: texto corrido (~900px), formulário de FLUXO (wizard/modal, 620-680) e card único isolado — nunca no contêiner da tela
- Breakpoints: **768px** estrutural (`useIsMobile` em lib/responsive.js: drawer de nav, layout) · **900px** no CSS (`--pad-x` encolhe, `.resp-cols` empilha, `.hide-mobile`/`.show-mobile`) · `pointer: coarse` (scrollbar fina, inércia)

## Componentes base

- Botão: primário = `PrimaryButton` (atoms.jsx, navy 32px) ou inline `--btn-bg/--btn-fg` 40px em CTAs grandes; secundário = `SecondaryButton` (atoms.jsx, size sm/md/lg = 28/32/40); terciário = texto `mono dim`. **1 primário por região; CTA async SEMPRE com busy/disabled.**
- Input / Select / Datepicker: classe `.inp` (30px, `--bg-1`, borda `--line-2`, `--r-2`) pra campo novo; legados 24–30 migram quando a tela for tocada; formulário CRUD = `components/EntityForm.jsx` (dirigido por `lib/entities.js`); data/hora usa `<input type="datetime-local">` com pegadinha de fuso (BRT sem sufixo)
- Tabela: `<table>` manual; `th` = `className="kicker"` + padding `8px 10px`; `td` 12.5px com `borderTop: var(--line-1)`; linha clicável com hover/seleção `--accent-soft`; larga = envolver em `.tbl-x`
- Card / KPI: card genérico = `Card` (viz.jsx); KPI = `StatTile` (viz.jsx, rótulo 12.5 + valor 30/700); `MetricTile`/`BigNumber` (charts.jsx) em análises; tile interno = `--bg-inset` + `--r-2`
- Badge / status: `.chip` (tokens.css: neutro, `.pos/.neg/.warn/.info` com ponto, `.accent`) e `Pill` (viz.jsx)
- **Status em linha de tabela e contador (12/09/2026, redesign de Treinamentos): PONTO de 6px + palavra, nunca pílula de fundo colorido.** Pílula colorida em toda linha de uma tabela pinta a tela inteira e mata a hierarquia — o fundo colorido fica reservado pra faixa de veredito (nota de prova, resultado). Ver `CountDot` e a coluna "Hoje" em screens/training.jsx
- **Orçamento de largura em grade-tabela (12/09/2026, redesign de Clientes/Pipeline/Minhas atividades): a grade da linha é uma CONSTANTE exportada com o piso de cada coluna e um `_BUDGET`, e o smoke soma pisos + gaps e falha se passar.** O orçamento padrão é 716px (1024px de janela − 220 do nav − 56 do pad-x − 32 do padding do card). Sem isso, alargar uma coluna devolve a rolagem horizontal em silêncio meses depois. Ver `TABLE_GRID` (customers.jsx), `LIST_GRID` (pipeline.jsx) e `QUEUE_GRID` (today.jsx)
- **Menu de ações da linha (12/09/2026, redesign de Clientes): quando a linha tem mais de DUAS ações, a principal fica visível e o resto vai pro "⋯"**, com o `title` do botão listando o que tem dentro (opção escondida atrás de clique cego é pior que botão pequeno). Ver `MoreMenu` em screens/subscriptions.jsx — fecha no Esc (useEsc) e no clique fora. Linha de fatura mostra "marcar paga"; assinatura ativa não tem ação principal, tudo no menu
- **Trilho lateral (idem): `.side-rail` (tokens.css) desce o trilho pra BAIXO do conteúdo quando a coluna principal não cabe (1500px), diferente de `.resp-cols`, que só empilha no mobile (900px).** Use quando a coluna principal tem largura mínima real (tabela de N colunas): manter as duas colunas em tela média devolve a rolagem horizontal que o layout veio tirar. A soma dos pisos da grade vira orçamento testável — ver `TABLE_GRID_BUDGET` em screens/customers.jsx e o caso `clientes-tabela` no smoke
- **Barra de progresso (idem): `div` de 5–7px, `border-radius: 999`, trilho `--bg-3` (ou `--bg-1` sobre well) e preenchimento na cor da faixa.** 5px pra progresso de sessão, 6–7px pra pontuação/percentual em lista. No escuro (modo foco), trilho `rgba(255,255,255,.12)`. É a única peça nova que o redesign de Treinamentos criou; não virou componente porque são 2 divs
- **Faixa de funil no lugar de números soltos (12/09/2026, redesign de Propostas): três números que são PASSOS do mesmo processo se desenham como funil, com a conversão entre cada par na seta.** `geradas · 30d` / `abertas pelo lead` / `fechou` numa caixa cinza eram três métricas independentes; viraram `geradas → (56%) → abertas → (32%) → fecharam`. À direita fica o acionável ("7 enviadas e nunca abertas" + o link que APLICA o filtro). Ver a faixa em screens/proposals.jsx
- **Número que é soma dos outros não vira tile (12/09/2026, redesign de Links de pagamento e Formulário de integração): "Total de pedidos" = aguardando + respondidos e "Gerado" = pago + em aberto são vitrine, não informação.** No lugar entra o que exige ação: a espera mais longa, o que está em aberto. Ver `esperaMax` em screens/integration-forms.jsx e a faixa de dinheiro em screens/offers.jsx
- **Espera em DIAS, nunca a data crua (idem): "aguardando há 9 dias" (`--warn` até 4, `--neg` de 5 em diante) em vez de "Pedido em 03/09", que faz o leitor subtrair de cabeça.** Vale pra fila de espera e pra estado de proposta ("nunca abriu · 12 dias"). O mesmo `diasDe(iso)` nas duas telas
- **Passos numerados no cabeçalho do painel, não parágrafo de instruções no pé (12/09/2026, redesign de Contratos): fluxo de várias etapas vira `1 cliente · 2 quadro resumo · 3 gerar` no topo do drawer, com o passo atual marcado, e o bloco de ação fecha a coluna que se preenche.** Instrução no rodapé da tela fica longe de onde a ação acontece e ninguém lê. Ver o drawer em screens/contracts.jsx
- **Ação de conferência não pode contar como ação do cliente (12/09/2026, redesign de Propostas): link público aberto de dentro do cockpit leva `cockpitProposalUrl` (`?from=cockpit`).** Sem isso o time conferindo a proposta infla "abertas pelo lead" e o funil da própria tela passa a mentir. Regra geral: toda métrica de comportamento do cliente precisa de uma porta interna que não a suje
- **Uma barra de controles por tela (12/09/2026, redesign da Agenda): filtro que pertence à mesma pergunta mora na MESMA barra, na ordem em que se usa (quando · quem · o quê).** A Agenda tinha o filtro de pessoa na tela e período/tipo/toques dentro da grade: duas barras pra mesma função. Filtro de pessoa com mais de 4 opções é chip com select, nunca um botão por pessoa (oito botões comem a largura inteira). Ver a barra em screens/agenda-grid.jsx
- **Legenda longa vira `title`, não parágrafo (idem): o que fica impresso são as cores que a tela usa pra CODIFICAR (tipo, estado), dentro do bloco que elas pintam; o resto vai pro "legenda ⓘ".** Onze itens de legenda embaixo da grade eram mais altos que duas faixas de hora e ninguém lia duas vezes. O que cada item significa já vive no `title` dele
- **Aviso de conflito é VIVO, não resposta do submit (idem): a mesma função que o salvar chama roda no render e avisa enquanto se preenche.** Montar o formulário inteiro pra descobrir no fim que a pessoa já tinha call é retrabalho garantido; o salvar continua bloqueando. Ver `liveConflict` em screens/agenda.jsx
- **Vão livre é AÇÃO, não espaço em branco (idem): num calendário, todo buraco de 1h ou mais vira botão que já abre o formulário com a pessoa e a hora daquele vão.** É o que transforma "olhar a agenda" em "marcar a call". Ver a visão Equipe em screens/agenda-grid.jsx
- **As peças da história viram componente (14/09/2026, handoff do protótipo de 33 telas): `components/story.jsx`.** `AvisoTopo` (o aviso com prazo + o botão da ação), `CorrenteDoDinheiro` (setas com a taxa em cima), `FunilHorizontal` (passagem por degrau, vermelha abaixo de 45%), `BarraComposicao` (empilhada + legenda), `Info`/`InfoNota`/`InfoLink` (os três formatos do ⓘ) e `BarraFiltros` (pílulas + `mais ▾`). **Tela nova usa de lá; não redesenha a sua.** Duas réguas moram dentro das peças: as fatias da barra somam o total (divergência vira aviso no console) e o texto do ⓘ sai em `--fg-3`, com só o glifo em `--fg-4`.
  - A corrente é **grid `auto-fit`, nunca `flex-wrap`**: no wrap o último passo cai sozinho na segunda linha, sem seta. A seta viaja DENTRO do passo.
  - No `AvisoTopo` vale **uma cor forte por linha**: o ponto e o título tomam a cor do tom, o botão fica neutro.
- **A moldura dos painéis também é componente (14/09): `components/overlay.jsx`.** `Modal`, `Drawer` e `PassosDoPainel`, sobre `--scrim`/`--scrim-soft` e a escala `--z-popover: 60 · --z-drawer: 70 · --z-modal: 80 · --z-alarme: 100 · --z-command: 120` (tokens.css). Véu, camada, Esc, clique fora e `ErrorBoundary variant="modal"` vêm com a peça; `fechavel={false}` enquanto salva ou quando o backdrop não pode jogar fora formulário preenchido. **O smoke varre o fonte e falha se alguém escrever véu na mão** — exceções registradas lá: modo foco do treino, portão do treino e o `ErrorBoundary`.
- **Menu e seletor de linha abrem por `Popover`, nunca `position: absolute` (14/09).** Toda tabela larga vive num `.tbl-x` (`overflow-x: auto`), e overflow automático num eixo recorta o outro: o `⋯` e o seletor de telas nasciam cortados nas últimas linhas de Contratos, Propostas, Formulário de integração, Assinaturas, Consultas e Configurações. `MoreMenu` (atoms.jsx) já faz isso por dentro. `useEsc` mora em `lib/use-esc.js` desde então, pra atoms e popover não se importarem em círculo.
- **Controle que não faz nada é o pior defeito (14/09).** O checkbox do card do Pipeline existia desde sempre e não abria ação nenhuma. Antes de fechar uma tela, clicar em tudo que ela oferece.
- **As seis réguas do pacote de redesenho (13/09/2026, pacote "Cockpit e design system" do Leo) — valem pra TODA tela nova:**
  1. fileira de números soltos (`StatTile`) vira **um bloco que conta a história**: corrente do dinheiro, funil, esteira ou barra de composição (ver `CorrenteDoDinheiro` em metrics.jsx, a esteira do blog e a temperatura em calls.jsx);
  2. **o aviso com prazo sobe pro topo, com o botão da ação ao lado** (sem resposta, vencidos, em risco, parados) — ver o Inbox, Consultas, Integração e o Resumo do Financeiro;
  3. filtros repetidos viram **um segmentado + `mais ▾`**, nunca mais de 4 controles na barra (ver o Inbox: seis viraram três);
  4. parágrafo explicativo de rodapé vira **ⓘ** no elemento que ele explica (ver "como a conta é feita" na Análise de Pace e "mais números" nas Redes sociais);
  5. **uma ação principal por linha**; o resto entra no `⋯`;
  6. coluna de tabela **agrega dado**: valor + linha de contexto embaixo ("4 toques · há 2 d").
- **Número que é soma dos outros não vira tile (idem): "Total de pedidos" e "Gerado" são vitrine.** No lugar entra o que exige ação.
- **Menu lateral quando as abas não cabem numa linha (13/09, Configurações): seis abas de nome comprido quebram em duas linhas e empurram o conteúdo.** Coluna de ~196px grudada no topo, com media query que devolve a linha rolável no mobile (`.set-cols`/`.set-nav` em tokens.css)
- **Contagem no menu só com a régua da tela dona (13/09): o badge de atrasados do Pipeline usa o mesmo `nextTouch`.** Contagem que a moldura teria que recalcular sozinha (fila do dia, inbox, tarefas) fica de fora até existir um endpoint de contadores — dois números para a mesma pergunta é pior que nenhum
- Modal: overlay `fixed inset-0` `oklch(0 0 0 / 0.45)` z-80 + painel `--bg-1`/`--r-3`/`--shadow-pop`; confirmar exclusão = `components/ConfirmDelete.jsx` ou `window.confirm` nomeando o item + consequência (TODA destrutiva confirma); detalhe de lead = drawer `LeadDetail` (screens/deal.jsx); todo modal dentro de `ErrorBoundary variant="modal"`; **todo modal fecha no Esc** via `useEsc(onClose)` (atoms.jsx, PILHA: aninhado fecha um por vez; passe null enquanto salva). Exceção deliberada: alarmes que exigem decisão (WaHotAlert, TrainingGate) não fecham no Esc
- Toast: `window.toast(msg, tone)` + `ToastHost` (atoms.jsx, montado no app.jsx). REGRA: mutação otimista NUNCA falha em silêncio — todo `.catch` de update/create chama `toast("… · tente de novo", "neg")` além do console.warn
- Botão WhatsApp: `WaButton` (atoms.jsx) ou tokens `--wa-brand/-fg/-deep`; nunca hex solto
- Blocos do LEAD: `components/lead-blocks.jsx` — `clientSummary` (os fatos compilados, `{ full: true }` na ficha), `ClientSummaryCard`, `AttributionCard`, `LeadChecklist`, `ScriptBlocks` (como se comportar + objetivo + passo a passo com "copiar") e `DealProductField` (produto vendido no fechamento: select do catálogo real vindo do SEED + os preços como atalho pro valor). REGRA (12/08): o card do lead (deal.jsx) e o painel de atividade (today.jsx) mostram a MESMA informação com o mesmo título, a mesma ordem e o mesmo desenho — painel novo que fale de lead usa estes blocos em vez de remontar
- Estado vazio: `EmptyState` (atoms.jsx: título 15/600 + hint + ação central)
- Skeleton de carregamento: não existe — padrão OFICIAL é texto `mono dim` 12px ("carregando…") no lugar do bloco; lista cortada mostra "+N" expansível (nunca corte silencioso)

### Cards e ficha do lead — handoff de 14/09/2026

- `components/lead-card.jsx` e `lead-card.css` concentram `LeadGrade`,
  `LeadSection` e `LeadDisclosure`. Cards brancos, borda `--line-1`, raio
  `--r-3`, padding 16px × 18px (14px no celular).
- `LeadDetail` é a ficha global em `Drawer` de 520px: identidade e fatos,
  próximo passo, ação de agora, histórico e dados do cliente. Agenda detalhada,
  qualificação e roteiro são expansíveis; todos os movimentos continuam nos
  gates existentes, inclusive voltar, ganhar e perder.
- `ScriptPanel` mantém o modal de 1120px com duas colunas iguais: roteiro à
  esquerda, cliente e histórico à direita, “Depois da ação” no rodapé. Abaixo
  de 760px, as colunas se empilham.
- `ClientSummaryCard` e `ScriptBlocks` usam a mesma superfície em todos os
  contextos. O roteiro fica em um único card, com comportamento, objetivo e
  passos numerados; as falas continuam copiáveis. O resumo usa fatos em grade
  e a dor abaixo, sem outra caixa colorida. O inbox reutiliza o mesmo resumo.

## Padrões de tela

### Moldura do handoff — 14/09/2026

A referência aprovada em `design/handoff-cockpit/` orienta a moldura em
`chrome.jsx`, a busca e as notificações. Esta etapa não redesenha o conteúdo
das telas.

- Lateral de **248px** (`--rail-width`), navy nos dois temas (`--bg-rail`),
  com tokens `--rail-*` próprios para texto, linha, hover e seleção. Não
  sobrescrever `--fg-*` dentro do nav: os popovers continuam usando o tema.
- Produto/alternador no topo, busca logo abaixo, grupos recolhíveis e conta
  real no rodapé (perfil, senha, sair). Os grupos mostram todos os itens
  permitidos quando abertos; entrar numa tela revela seu grupo.
- Barra superior de **58px** no desktop: breadcrumb, período à esquerda,
  busca e sino à direita. O ICP foi preservado como controle discreto;
  o resumo aparece quando há largura. Conta saiu da barra superior.
- Ícones SVG e logos reais foram preservados; o `reset` do protótipo não é
  ação de produção. Badges usam as réguas e contadores existentes.
- Seletor de produto, conta, ICP e notificações usam o `Popover` compartilhado;
  busca e menu móvel usam `Modal`/`Drawer`. Navegação fecha os periféricos.
- Abaixo de 900px, o período passa à segunda linha; abaixo de 768px a lateral
  abre como drawer. Controles globais têm alvos de 44px no mobile.
- Prévia do App real com API fictícia: `vite.preview.config.js`, URL
  `/?shell=1#overview`. Mantém os previews individuais existentes. Não inicia
  API, automações ou conexões com o banco.

### Conteúdo das telas

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

**Régua de meta — decisão de 14/09/2026, atualizada após a escolha da opção 2:**
manter as dimensões originais (coluna de 140px; barra de 96 × 300px). O
preenchimento tem superfície líquida com duas ondas contínuas (4 e 6 segundos)
e reflexo interno discreto; o trilho vazio é liso. Preservar a entrada subindo,
o follow-up empilhado e o ponto pulsante no percentual. Não desenhar líquido
para uma fatia zerada. Os movimentos respeitam `prefers-reduced-motion`.
O pace é apenas uma marca tracejada contrastante acima dos efeitos,
sem texto ou valor junto dela. O saldo para atingir a meta aparece no contexto
ao lado, sem ampliar o termômetro. O percentual continua sobre a meta base,
inclusive acima de 100%; período encerrado não mostra marca de pace.
Referência: `Termometro` em `screens/overview.jsx` e `.vg-meta-pace-marker` em
`screens/overview.css`.

**Carteira e Aquisição — 14/09/2026:** os dois resumos usam listas de definição
com rótulo e contexto à esquerda, valor e complemento alinhados à direita.
O MRR tem destaque; CG é explicado no cabeçalho. CPL, CAC e ROAS ficam na mesma
faixa, com unidade de leitura; a lista abaixo é nomeada "Leads por origem" e
separa o nome da origem de sua descrição. As contas e o recorte por período
continuam iguais. Referências: `KVRow`, `AcquisitionMetric` e `overview.css`.

**Desempenho do time — 15/09/2026:** uma pessoa por card, em grade de uma a
quatro colunas conforme o espaço (mínimo de 260px, limitado à largura disponível).
Nome, papel, receita e contratos ficam visíveis, com réguas lisas de 6px.
CS e mídia mostram dois indicadores do próprio papel. Todas as submetas e
notas continuam no expansível "Detalhes"; clicar na identidade abre o pipeline
filtrado pela pessoa.
Preservar ranking, metas mensais, marca de pace e degraus de super meta.
Referências: `TeamBoard`, `PersonCard` e `.vg-team-grid` em `overview.css`.

## Dívidas conhecidas

Rodada de 2026-08-08 EXECUTADA (PRs #621, #631, #633, #634): kickers e títulos
varridos no app inteiro, Card/PageHead na régua, toast global + regra do catch,
Esc nos modais, verde WA por token, +N em lista cortada, desfazer em concluir
tarefa. O que segue em aberto:

Rodada 2 (2026-08-08, PR #639): Esc universal em pilha nos 13 popups restantes
(incl. drawer do lead), zero catch silencioso no app, excluir consulta com
confirmação, `SecondaryButton` + `.inp` + `.tbl` criados.

| Divergência | Onde aparece | Padrão que deve prevalecer |
|---|---|---|
| Cabeçalho de página hand-rolado (estrutura), classes já aplicadas | pipeline, today, training e outras | migrar pro componente `PageHead` quando tocar na tela |
| SecondaryButton/.inp/.tbl criados mas legados não migrados | quase toda tela | adotar quando tocar na tela (novo código já usa) |
| Campos do checklist do lead em 26px (denso) em vez de `.inp` 30 | `lead-blocks.jsx` (card do lead + Meu dia) | decidir se a lista densa vira exceção registrada ou sobe pra 30 nos dois painéis de uma vez |
| Card do lead no inbox monta resumo e checklist por conta própria | `LeadSideCard` (whatsapp.jsx, coluna de 300px) | já usa `clientSummary`; falta uma variante compacta dos blocos de `lead-blocks.jsx` |
| Contraste: fg-4 em 10px ≈ 2.9:1 (checklist pede 4.5:1) | kickers/fineprints do app inteiro | DECISÃO DO LEO: escurecer `--fg-4` (claro) ou aceitar como micro-texto decorativo |
| Persistência de filtros locais (busca/aba por tela) | customers, forms, listas | padrão localStorage `cockpit_<tela>_<filtro>` como o Meu dia faz com a pessoa |
| Auditoria de checklist completo (12 blocos) tela a tela | todas menos Meu dia | funcional global (estados/Esc/toast/destrutivas/busy) FEITO no app; resta o passe fino por tela seguindo a ordem do inventário |

### Inbox — handoff de 14/09/2026

- Lista de 250px, conversa flexível e card de 300px; abaixo de 1360px, o card
  passa para baixo. No celular, lista e conversa são telas alternadas.
- `wa-thread.jsx` recebe `variant="inbox"` para bolhas, identificação do robô
  e respostas rápidas; os demais chats mantêm sua apresentação. Menus usam
  `Popover` e o cadastro de contato usa `Modal`.
- O resumo do cliente fica visível; edição de qualificação/combinado e dados
  complementares ficam em seções expansíveis. Nenhum dado foi descartado.
- Qualificação no card lateral (15/09): lista de perguntas com resposta abaixo,
  em 12px/fg-3 e 13.5px/fg-1, respectivamente. Divisores usam `--line-1`;
  respostas preservam quebras de linha e quebram e-mails longos. A dor do
  anúncio tem rótulo próprio e o combinado fica separado das respostas.
