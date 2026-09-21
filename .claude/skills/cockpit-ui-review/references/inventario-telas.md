# Inventário de telas do cockpit

Gerado em 2026-08-08 a partir de `app.jsx` (mapa de rotas `crumbsFor` + render).
Rota = hash (`#pipeline`). Arquivos em `packages/web/src/screens/`.
**Revisão** = auditoria da skill (checklist completo), não mexida pontual.

> **Rodadas de ago/2026 (PRs #621, #631, #633, #634, #639, #643): todas as telas
> receberam (1) a régua de cabeçalhos e tokens, (2) a camada funcional: toast em
> toda mutação, Esc em pilha nos popups, confirmação nas destrutivas, e (3) o
> passe fino: abas persistentes, tabelas com rolagem no mobile, loading/vazio
> conferidos.** "✓ padronização + funcional + passe fino" = essas 3 camadas;
> leitura linha a linha dos 12 blocos (nível Meu dia) fica como refinamento
> contínuo quando cada tela for mexida.

## Revisão da moldura CRM final — 20/09/2026

NavRail/TopBar/conta conferidos contra a prancha em 1440 e 1920px, com fontes
carregadas e estados equivalentes (Visão geral recolhida e Clientes/Comercial
aberto). Geometria, hierarquia, ícones, tipografia e controles corrigidos em
`chrome.css`; mobile 390px e interações da moldura conferidos com mocks.
As telas internas permanecem fora do escopo desta revisão.

## Rodada CRM final — 20/09/2026

As 30 rotas do novo protótipo receberam a direção Cápsula. O
[mapa de implementação e validação](../../../../design/crm-final/IMPLEMENTACAO.md)
registra fontes, adaptações funcionais e limites dos checks em 390/1440/1920px.
Esta rodada é implementação visual e verificação de renderização; não substitui
uma auditoria completa de todas as mutações e integrações externas.

## Rodada do protótipo de 33 telas (14/09/2026)

O Leo entregou um protótipo funcional hi-fi das 33 telas (`design/handoff-cockpit/`,
com `MAPA-ESTRUTURAL.md` indexando onde fica a prancha de cada uma). Conferi as
33 contra o código. **A maioria já estava no desenho**, porque o protótipo foi
construído lendo este repo depois do pacote de 12-13/09. O que a rodada mudou:

| Onde | O que |
|---|---|
| `components/story.jsx` (novo) | as seis peças da história, uma vez só |
| `components/overlay.jsx` (novo) | `Modal`/`Drawer`/`PassosDoPainel` sobre um véu e uma escala |
| `today` | fila numerada, busca, progresso do dia, "Sem data" fora do trilho |
| `pipeline` | a seleção deixou de ser controle morto (barra de massa) + busca no kanban |
| `customers` | o vencido subiu do trilho pro topo, com a baixa ao lado; ficha ganhou Esc |
| `agenda` | os três avisos da semana (furou · sem remarcar · sem confirmar) |
| `social` | as fatias mediam alcance e diziam "seguidores" |
| `metrics` | a corrente era flex-wrap (último passo órfão) |
| `overview` | termômetro no tamanho original com ondas líquidas contínuas, reflexo discreto e follow-up empilhado; pace tracejado fixo e movimento reduzido respeitado (opção 2, decisão de 14/09) |
| `overview` · Carteira e Aquisição | valores e complementos alinhados à direita, MRR destacado, CG explicado; custos agrupados e leads identificados por origem (14/09) |
| `overview` · Desempenho do time | cards compactos em até quatro colunas, receita e contratos com barras curtas, indicadores próprios para CS/mídia e detalhes recolhidos (15/09) |
| `eloapp` | abria com 5 tiles e o funil de lado; agora aviso + funil + foto em linha |
| `settings` | seletor de telas recortado + dois `className` que se anulavam |
| app inteiro | `⋯` recortado dentro de `.tbl-x`; 17 véus escritos na mão |

Conferidas **sem diferença**: `proposals`, `offers`, `contracts`, `intform`,
`whatsapp`, `tasks`, `consultas`, `training`, `disparos`, `blog`, `forms`,
`landingpages`, `creative`, `metas`, `remuneracao`, `expenses`, `mindmaps`,
`analise`, `calls`, `integrations`, `desempenho`. Fora de escopo por decisão do
Leo: `outbound` e `funcionarios` (seguem `hidden`).

## Continuação do comercial — 14/09/2026

- `intform`: adaptação da prancha 7d, com indicadores compactos, status em ponto
  e texto, uma ação por linha e menu secundário. A tabela vira cards no celular;
  carregamento, vazio e falha com nova tentativa têm estados separados. As
  respostas continuam usando o snapshot do formulário e o termo da API.
  Smoke SSR (incluindo orçamento de 704px/716px), suíte da API e build web
  passaram. Conferido no Chrome em desktop e celular de 380px: filtros, busca,
  respostas, solicitação e cópia de link fictício, vazio e recuperação de erro.
  A revisão corrigiu a largura mínima herdada da tabela: os cards ocupam 347px
  no celular, sem rolagem lateral. A exclusão só teve a confirmação aberta;
  nenhuma exclusão foi confirmada.
- `agenda`: cabeçalho com o espaçamento da prancha 8a–8d, avisos agrupados e
  filtros de tipo/toques recolhidos em “mais”. O filtro ativo e a ação de
  recuperar eventos ocultos continuam visíveis; a legenda fica junto à grade.
  Controles e editor têm alvos maiores no celular, e o mês mantém uma largura
  legível com rolagem. Smoke das quatro visões, sobreposição, conflitos,
  recorrência e filtro persistido passou, assim como a suíte da API e o build.
  Conferidas no Chrome a navegação nas quatro visões, aplicação e limpeza de
  filtro, layout em 1024px e 380px e abertura/cancelamento do editor no celular.
- Preview isolado: `/?shell=1#intform`, com dados fictícios; `&intform=empty`
  e `&intform=error` exercitam vazio e falha recuperável. Nenhum dado real é
  enviado ao WhatsApp pelo preview. A Agenda usa `/?shell=1#agenda`.

## Cards de leads — 14/09/2026

Padronizados conforme o handoff: cards do kanban, ficha global (`LeadDetail`),
painel de roteiro de Minhas Atividades e resumo do lead no inbox. A ficha global
atende também Agenda, Propostas, busca e as demais entradas de `openLead`.
Componentes compartilhados em `components/lead-card.jsx`/`lead-blocks.jsx`;
campos, gates de movimento e operações via API preservados.

## Telas navegáveis

**Inbox · qualificação (15/09/2026):** revisão pontual do card lateral. Perguntas
e respostas saíram do parágrafo concatenado para uma lista com hierarquia,
divisores e quebra de texto. O combinado aparece em bloco próprio sem ocultar
respostas. Conferidos desktop e celular de 390px, claro/escuro, resposta longa,
edição e estado vazio com o preview `?shell=1&inbox=1&qualification=full#whatsapp`
(variantes `note` e `empty`). Suíte da API, smoke SSR e build web passaram.

| Rota | Arquivo | Tela (NAV) | Função | Componentes-chave | Revisão |
|---|---|---|---|---|---|
| `overview` | overview.jsx | Visão geral | placar do funil, metas e pace por pessoa (modelo ago/2026: réguas+donuts) | StatTile, IcpCard, charts, period-picker | ✓ padronização + funcional + passe fino (ago/2026) |
| `overview` (Elo) | overview-elo.jsx | Visão geral · Elo | visão B2C do app (checkout, ativação, retenção) | charts | ✓ padronização + funcional + passe fino (ago/2026) |
| `today` | today.jsx | Minhas atividades | fila do dia por grupo de prioridade + painel de roteiro (exporta peças que Agenda/Consultas/Ajustes usam) | AgoraBlock, QueueRow, ScriptPanel, DayScore, TasksCard, SlotGrid | **REDESENHADA 12/09/2026** (handoff do Leo, 3 blocos: #924/#925/#926) · bloco Agora, grupo virou cabeçalho, ação no lugar da etapa, Depois da ação no rodapé, um chip de pessoa · orçamento da linha no smoke |
| `pipeline` | pipeline.jsx | Pipeline | Kanban + Lista (Agenda e Análise viraram telas próprias, que IMPORTAM AgendaView/AnaliseView daqui) | Segmented, FilterTab, Card, LeadCard, LeadDetail (deal.jsx) | **REDESENHADA 12/09/2026** (handoff do Leo, 3 blocos: #920/#921/#922) · card do lead com faixa de fatos e próximo passo no topo, board com estado clicável, Lista começando por Atrasados (LIST_SECTIONS + orçamento no smoke) |
| `outbound` | outbound.jsx | Comercial · Outbound | prospecção ativa (classes Semente/Rede/Alvo, Receita Previsível) | tabela manual | ✓ padronização + funcional + passe fino (ago/2026) |
| `customers` | customers.jsx | Clientes | base ativa, ficha do cliente, indicações e assinaturas (aba) | CustomersAnalysis, CustomerModal, ReferralsTab, SubscriptionsScreen, Segmented, FilterTab | **REDESENHADA 12/09/2026** (handoff do Leo, 4 blocos: #915/#916/#917/#918) · tabela de 13 colunas → 6 sem rolagem (orçamento no smoke), ficha em 4 abas, fila de indicação, faixa de estado do billing · **ajuste 16/09/2026:** dinheiro do período e saúde da carteira no topo, antes da lista e da fila de cobrança; caixa confirmado por data via API, separado do contratado anualizado, com estados de carga/erro e filtro de período |
| `proposals` | proposals.jsx | Comercial · Propostas | templates e propostas (snapshots), editor + preview | editor-split, ProposalActions, FilterTab, MoreMenu | **REDESENHADA 12/09/2026** (handoff 4telas: #931) · faixa do funil (geradas 30d → abertas → fecharam com a conversão entre os passos), templates em linhas ordenadas por conversão, UMA tabela de geradas com filtros (a aba "Geradas" e a seção "Geradas recentemente" eram a mesma lista) · `abrir ↗` usa `cockpitProposalUrl` pra conferência do time não contar como abertura · TPL_GRID/PROP_GRID no smoke |
| `offers` | offers.jsx | Comercial · Links de pagamento | histórico dos links gerados por lead/cliente (status pago/aguardando vindo do MP) + gerar link; os 3 links fixos viraram seção recolhida no pé | StatTile, FilterTab, Pill, payment-link-modal, WaButton | **REDESENHADA 12/09/2026** (handoff 4telas: #928) · faixa de dinheiro com "Em aberto" primeiro e barra empilhada, rodapé de 6 linhas virou "como o status funciona ⓘ", filtro padrão "Devendo", 8 → 7 colunas (Gerado sai, é soma) e a ação que faltava: **cobrar** no WhatsApp com o link em aberto |
| `contracts` | contracts.jsx | Comercial · Contratos | biblioteca de modelos + histórico do que já saiu pra assinatura (contract_issues) | MoreMenu, CardHead, IssueViewer, lib/contracts.js | **REDESENHADA 12/09/2026** (handoff 4telas: #932) · modelos em linhas com "usar →" primário (imprimir em branco foi pro ⋯, porque não registra nada), drawer com os 3 passos (1 cliente · 2 quadro resumo · 3 gerar) e o bloco de gerar no pé da coluna que se preenche, "+N campos ▾" no quadro longo, histórico em tabela · o parágrafo de instruções do pé da tela saiu · MODEL_GRID/HIST_GRID no smoke |
| `intform` | integration-forms.jsx | Comercial · Formulário de Integração | pedidos dos questionários que o cliente fechado responde pelo link /fi/:id: integração (antes da call) e **dados pra nota fiscal** (kind `nota_fiscal`, 17/09/2026: seletor no pedido, etiqueta na linha, filtro por tipo, cadastro vai pra `customer.fiscal`) | FilterTab, MoreMenu, WaButton | **REDESENHADA 12/09/2026** (handoff 4telas: #929/#930) · faixa com Aguardando / espera mais longa / Prontos para a call ("Total de pedidos" saiu, era soma), "aguardando há N dias" na linha (warn <5, neg ≥5) e ação de **cobrar** no WhatsApp |
| `agenda` | agenda.jsx + **agenda-grid.jsx** | Comercial · Agenda | agenda única do time: calls, integrações, consultas, compromissos e bloqueios | AgendaView (4 visões), AgendaItemModal, Segmented, FilterTab, Avatar | **REDESENHADA 12/09/2026** (handoff do Leo, 5 blocos: #934-#939) · a grade saiu do pipeline pra módulo próprio; uma barra de controles no lugar de duas, legenda de 11 itens virou title, card com valor/▶/✓, conflito vivo no modal, visões **Mês** e **Equipe** (com os vãos livres clicáveis) |
| `whatsapp` | whatsapp.jsx + whatsapp.css | Comercial · Inbox | inbox multi-número + chat (Cloud API), promove lead no 1º toque | wa-thread, Popover, Modal, Segmented | **ADAPTADA AO PROTÓTIPO 14/09/2026** · lista/chat/card responsivos, canais agrupados, ações no ⋯, respostas rápidas, cadastro e vínculo de contato, filtro Sem resposta alinhado à API; validação no navegador com dados fictícios |
| `consultas` | consultas.jsx | Comercial · Consultas | consultas UniqueKids (agenda, jornadas e o Manual da Família) | MoreMenu | **REDESENHADA 13/09/2026** (pacote, 9c/9d: #943) · jornadas em linhas ordenadas por RISCO (sem próxima marcada primeiro) + aviso no topo; manuais em linhas com uma ação principal |
| `social` | social.jsx | Marketing · Redes sociais | publicar IG/FB, métricas, comentários (webhook) | social-metrics | **REDESENHADA 13/09/2026** (pacote, 11a/11b: #945) · 2ª faixa de tiles virou "mais números ⓘ", publicações por alcance (não pela ordem do feed) e os comentários viraram fila com o aviso no topo |
| `metrics` | metrics.jsx | Marketing · Publicidade | gerenciador Meta Ads + **a aquisição inteira** (a tela Análise de Aquisição foi fundida aqui em 13/09) | CorrenteDoDinheiro, insights, meta-connect | **REDESENHADA 13/09/2026** (pacote, 10a + decisão de fundir: #944) · sete tiles viraram "Do anúncio ao dinheiro" (investido → visitas → leads → CPL → clientes → receita) |
| `landingpages` | landingpages.jsx | Marketing · Landing pages | páginas e SEO da home | — | **REDESENHADA 13/09/2026** (pacote, 10c: #944) · os dois cartões "por origem" viraram UMA tabela (visitas do beacon + pedidos do checkout) e as curvas ficaram no mesmo cartão |
| `forms` | forms.jsx | Marketing · Formulários | dashboard do form diagnóstico (5 etapas, drop-off) | charts, theme-inputs | **REDESENHADA 13/09/2026** (pacote, 10b: #944) · a linha do form conta visitas → começaram → envios → viraram cliente (won/revenue novos no funil da API) |
| `creative` | creative.jsx | Marketing · Canvas | editor de estáticos (18 templates) | canvas próprio | ✓ padronização + funcional + passe fino (ago/2026) |
| `disparos` | disparos.jsx | Marketing · Disparos | nutrição da base: WhatsApp assistido + e-mail + drip | tabela manual | **REDESENHADA 13/09/2026** (pacote, 11c: #945) · público, mensagem e envio viraram 3 passos numerados, com prévia, custo estimado e limite do número antes do botão |
| `eloapp` | eloapp.jsx | Análises · Análise do App | métricas do app Elo | charts | **REDESENHADA 13/09/2026** (pacote, 12g: #946) · missões e streaks viraram um bloco de retenção só |
| `aquisicao` | aquisicao.jsx | Análises · Análise de Aquisição | funil de mídia, CPL, origem | charts, period-picker | ✓ padronização + funcional + passe fino (ago/2026) |
| `calls` | calls.jsx | Análises · Análise de Pitches | calls transcritas + resumo IA, estrutura do pitch | — | **REDESENHADA 13/09/2026** (pacote, 12b: #946) · temperatura virou barra com proporção e cada objeção ganhou "virar treino →" |
| `integrations` | integrations.jsx | Análises · Análise de Integração | ordens de serviço de integração (briefing, checklist) | — | **REDESENHADA 13/09/2026** (pacote, 12c: #946) · "em risco" subiu pro topo com nomes e ação; o resto virou barra de como saíram |
| `analise` | analise.jsx | Análises · Análise de Pace | engenharia reversa da meta (gap → ganhos → calls → leads) | charts | **REDESENHADA 13/09/2026** (pacote, 12d: #947) · pace/meta/forecast num quadro só (com o risquinho de onde deveria estar) e a engenharia reversa virou lista de compromissos; o parágrafo virou ⓘ |
| `funcionarios` | funcionarios.jsx | Análises · Análise de Equipe | carga e cobertura por pessoa | tabela manual | ✓ padronização + funcional + passe fino (ago/2026) |
| `tasks` | tasks.jsx | Geral · Tarefas | quadro de tarefas + cards vindos do widget de feedback | board próprio | **REDESENHADA 10/09 e 13/09/2026** (#884-#893 e pacote 13a: #953) · quadro nível Asana; o cabeçalho passou a dizer atrasadas e o que vence na semana |
| `remuneracao` | remuneracao.jsx | Geral · Remuneração | plano de remuneração (admin-only, comp_plans) | tabela manual | **REDESENHADA 13/09/2026** (pacote, 13c: #949) · cada faixa mostra quem está nela (leitura; o nível é definido em Metas) |
| `mindmaps` | mindmaps.jsx | Geral · Mapas mentais | mapas mentais | canvas próprio | **REDESENHADA 13/09/2026** (pacote, 13e: #952) · a lista de mapas virou gaveta e a tela abre no mapa |
| `metas` | metas.jsx | Geral · Metas | metas por vaga/pessoa, SUPER METAS, regra de crescimento (#622) | réguas próprias | **REDESENHADA 13/09/2026** (pacote, 13b: #948) · a cadeia deixou de ser cartão separado e virou seção que explica a meta logo abaixo dela |
| `training` | training.jsx + training.css | Treinamentos | flashcards FSRS por pessoa + provas + dash da equipe + manual da empresa | IcpCard, Segmented, Avatar, FocusShell, CardFace, Modal, AvisoTopo, InfoNota | **ADAPTADA AO PROTÓTIPO 14/09/2026** · estudo por baralho, domínio e consistência no trilho, estudo/prova em modal, Equipe com quatro colunas e raio-x preservado, criação rápida e editor de cards em modal; revisão web em desktop/mobile e temas claro/escuro |
| `expenses` | expenses.jsx + finance.jsx | Geral · Financeiro | abas Pagamentos (espelho MP, cobrança, baixa) + Custos (% por lançamento) | tabela manual | **REDESENHADA 13/09/2026** (pacote, 13d: #948) · o Resumo abre pelas pendências com prazo (vencidos a receber, contas vencidas, entradas sem dono); a foto do mês virou uma linha |
| `settings` | settings.jsx | Geral · Configurações | usuários/telas, produto (funil, ICP), integrações, tema | EntityForm, theme-inputs | **REDESENHADA 13/09/2026** (pacote, 13f: #949) · as seis abas viraram menu lateral e a lista de etapas ganhou "Leads agora" |

## Sub-telas, overlays e chrome (auditar junto da tela-mãe ou como lote próprio)

**Moldura do handoff — 14/09/2026:** NavRail, TopBar, alternador de produto,
conta, busca global e notificações adaptados à referência. Lateral navy de
248px, topbar de 58px no desktop e drawer no celular. Conferidos na prévia
com dados fictícios: navegação/permissões por produto, grupos recolhíveis,
busca por teclado, período, notificações e conta; larguras 1440, 1024 e 390px,
além do tema escuro. Esta etapa não altera o conteúdo das telas navegáveis.

| Peça | Arquivo | O que é |
|---|---|---|
| LeadDetail | screens/deal.jsx | drawer de lead usado por pipeline/today/whatsapp/agenda (o maior overlay do app) |
| FocusShell | screens/training-focus.jsx | modo foco do treino (tela cheia escura) |
| Aba Assinaturas | subscriptions.jsx | renderizada dentro de Clientes (`initialTab="billing"`) |
| Análise de clientes | customers-analysis.jsx | bloco dentro de Clientes |
| Métricas sociais | social-metrics.jsx | bloco dentro de Redes sociais |
| Elo (marca) | brand-elo.jsx, overview-elo.jsx | variantes do workspace Elo |
| Splash e transições (16/09/2026) | components/screen-loading.jsx | ✓ referência Splash Loading CRM: entrada, Visão Geral e transição compartilhada; espera pelas consultas, saída de espera longa, temas e mobile |
| Seletor global de datas (17/09/2026) | components/period-picker.jsx | ✓ Popover limitado à viewport; desktop, celular e janela baixa; aplicar, cancelar e Esc conferidos |
| NavRail + TopBar | chrome.jsx | sidebar, breadcrumb, sino, seletor de produto |
| CommandSearch | components/CommandSearch.jsx | busca global ⌘K |
| Widget de feedback | components/feedback-widget.jsx | FAB bug/melhoria em toda tela |
| WaHotAlert | components/wa-hot-alert.jsx | alerta de lead quente (salta em qualquer tela) |
| TrainingGate | training.jsx | portão do treino diário (overlay global) |
| SettingsLite | settings.jsx | Configurações reduzida p/ quem não tem a tela |

## Ordem sugerida de auditoria (uso diário primeiro)

Revisão pontual em 16/09/2026: `expenses` → Resumo ganhou pizza de despesas
por categoria abaixo do fluxo de caixa, com percentual e valor na legenda.
Conferidos desktop, celular de 390px, temas claro/escuro e troca de mês.
Preview com dados fictícios: `/?shell=1&finance=1#expenses`.

1. `today` (fila do dia — a tela mais usada pelo time)
2. `pipeline` + LeadDetail (coração do comercial)
3. `overview` (a tela do gestor)
4. `whatsapp` (inbox diário)
5. componentes compartilhados (tabela, botão secundário, toast/loading — maior alavancagem, resolve o resto por tabela)
6. demais telas por categoria (Comercial → Marketing → Análises → Geral)

## Continuação do handoff — Marketing (14/09/2026)

Adaptação conferida no App real com API fictícia (`?shell=1&marketing=1`):

| Rota | Revisão desta entrega |
| --- | --- |
| `social` | Cabeçalho, métricas e listas de audiência; detalhes em ajuda; troca de workspace fecha o criador de post. |
| `metrics` | Aquisição em duas colunas responsivas, origem dos leads compacta e navegação saindo de Publicidade sem erro. |
| `forms` | Corrente de visitas até receita, ação de respostas, carregamento/erro com nova tentativa e publicação com estado de espera. Editor e variantes preservados. |
| `landingpages` | Funil e origem agregada com pedidos/receita juntos; curvas, planos e CTAs recolhidos. Funil ajustado para celular. |
| `creative` | Templates por formato, prévia e conteúdo por slide, fonte editável, texto adicional e PNG com feedback. |
| `disparos` | Público, mensagem e conferência numerados; troca de canal insere as variáveis no campo correto; campanhas salvas e sequências preservadas. |
| `blog` | Revisão pendente no topo e tabela com estado em ponto + texto; editor e bloqueio por erro do pente fino conferidos. |

Conferência visual em desktop e celular de 390px, com amostras nos temas claro
e escuro. Interações verificadas: navegação entre telas, respostas e editor do
form, seleção de campanha, troca de canal, variáveis e salvamento fictício,
ficha do Blog, troca de slides e exportação de PNG. Integrações externas não
foram acionadas. Cada tela tem commit próprio; CSS e preview são compartilhados.

## Apresentação C — ordem e provas sociais (14/09/2026)

Revisão pontual do deck em `packages/api/src/proposal-slides-page.js`:
“Anúncio perfeito” antecede “Efeito teia”, com os rótulos de sequência ajustados.
Os quatro cases publicados (Motvia, Lupa Autopeças, Dyno Nutri e 123tudo) foram
recuperados na cópia vazia da apresentação aberta via API REST, preservando
a configuração e os preços. Ordem e página 12 conferidas no navegador.

**Reorganização de 15/09/2026:** os três badges da operação ficam abaixo do
texto institucional em “Quem somos”. O parágrafo de resultado agregado aparece
abaixo dos quatro cases em “Quem já está dentro”. O slide “A operação em
números” foi removido; o contador acompanha a nova quantidade de páginas.
Espaçamentos e tipografia ajustados ao palco 16:9, mantendo os textos e valores.

**Resultados reais (15/09/2026):** o rodapé dos cases usa os totais do painel
LeverAds na mesma janela por cliente, com participação calculada e data da
consulta visível. Valores antigos fixos saíram; falha de consulta mantém a
última leitura identificada. Atualização automática no servidor a cada seis horas.


## Revisão de fidelidade das 30 páginas — 20/09/2026

Referência exclusiva: `design/crm-final/Cockpit - protótipo.dc.html` e as 30
pranchas importadas. A conferência anterior de renderização não equivale a
esta revisão de geometria, conteúdo e fluxos. Uma página é encerrada e
entregue antes de iniciar a seguinte. Moldura preservada; sem API/banco reais.

Ordem: overview → today → training → pipeline → customers → proposals →
offers → contracts → intform → agenda → whatsapp → tickets → quick_replies →
support_settings → social → metrics → forms → creative → disparos → blog →
analise → calls → integrations → desempenho → tasks → mindmaps → metas →
remuneracao → expenses → settings.

### 01. Visão geral (`#overview`) — validada

- **Importante, corrigido:** trilho de 280px em 1440, termômetro de 180px,
  hierarquia das duas linhas e aquisição separada divergiam da prancha. Agora
  o trilho tem 340px, termômetro 236px, duas linhas alinhadas e Aquisição dentro
  de Carteira. Cabeçalhos, régua, linhas de venda, avatar/ranking e submetas
  seguem as medidas da referência.
- **Importante, corrigido:** seletor de mês duplicado, "Detalhes da meta",
  notas financeiras extras e legendas removidas da prancha deixaram de ser
  renderizados. As submetas que existem no protótipo permanecem. Nenhum registro
  ou regra financeira foi apagado.
- **Bloqueante, corrigido:** erros de consultas podiam parecer carga eterna.
  Leituras têm estado por bloco, retry e chave de produto/período para não
  exibir dados da seleção anterior durante a troca. A mudança de período deixa
  os blocos independentes utilizáveis.
- **Componente compartilhado:** Modal/Drawer passam a mover o foco para o
  painel, conter Tab/Shift+Tab e devolver o foco ao gatilho no fechamento.
  As próximas telas reutilizarão essa correção; nesta etapa a venda/detalhe
  e o período foram novamente exercitados.
- **Fluxo:** venda abre o detalhe existente e fecha com Escape; pessoa abre
  Atividades com o filtro correspondente; disclosure por Enter; seletor global
  de período preservado. Mobile em 390px, controles de 44px, sem overflow do
  documento; tema escuro e redução de movimento preservados.
- **Evidência reproduzível:** `npm run test:review:overview -w packages/web`
  inicia apenas Vite com mocks e Chromium; salva capturas e medidas em
  `packages/web/.review-artifacts/overview/`. Compara título, card principal,
  termômetro, barra, história, vendas, posição/largura de equipe/carteira e
  primeiro card da pessoa em 1440 e 1920px (tolerância de 1px).
- **Diferenças de dados permitidas:** altura da segunda linha depende dos
  avisos reais; valores, nomes, papéis, submissões e cores de atingimento usam
  as réguas existentes. O protótipo usa faixas ilustrativas fixas (80%/50%);
  produção preserva pace e super metas. Os dados de comparação vivem apenas
  em `preview/overview-mock.js` (`?shell&review=overview#overview`).

Validação: 1.729 testes API, testes web/smoke e build aprovados. Comparação
automática: 34 medidas por largura, diferença máxima 0px em 1440/1920.

### 02. Atividades (`#today`) — validada

- **Importante, corrigido:** cabeçalho ocupava só a coluna da fila; painel
  vazio tinha 520px e as colunas tinham proporções diferentes. Cabeçalho,
  colunas iguais, destaque de 168px e painel vazio de 163px seguem a prancha.
- **Importante, corrigido:** fila com seis colunas, duplicação de Agora,
  cabeçalhos de grupos, Sem data, agenda futura, tarefas, placar e social
  selling foram removidos da apresentação, inclusive do estado vazio.
  Ordenação, responsáveis, consultas e cadências continuam nos helpers reais.
- **Importante, corrigido:** busca compacta com ícone, dez itens por página,
  feitas fora do card, indicadores arredondados e pessoa com contador.
  Roteiro passa a mostrar próximo passo, etapas marcáveis e mensagem copiável;
  postura, objetivo redundante, histórico e atribuição não são renderizados.
- **Bloqueante, corrigido:** foco entra no roteiro e retorna ao gatilho com
  Escape; trocar pessoa/produto fecha o roteiro anterior; editor recebe chave
  por atividade para não reaproveitar anotações de outro lead. No mobile, o
  modal fica no body para o botão flutuante não cobrir as ações do rodapé.
- **Funções reais preservadas:** anotações e anexos, Meet/propostas quando
  aplicáveis, destinos do funil e confirmações/remarcação usam os handlers
  existentes. O botão demonstrativo “Registrar e concluir” não substitui
  validações de etapa. A prévia dos scripts em Configurações mantém o roteiro
  completo. Tarefas e agenda permanecem em suas próprias telas.
- **Evidências:** `npm run test:review:today -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/today/`. Compara 28
  medidas fixas por largura em 1440/1920 (tolerância 1px); altura da lista
  varia com a quantidade real. Confere busca sem resultado/limpeza, paginação,
  pessoa, checklist, cópia, feitas, Escape/foco, modal 390px, vazio, leitura
  lenta, erro/retry, tema escuro e confirmação gravada apenas no mock.
- **Fora do escopo:** handlers de movimento e confirmação já eram otimistas
  e podem avançar antes de uma falha de persistência. Esse comportamento de
  domínio foi preservado e requer revisão separada de recuperação/rollback.

Validação: API, testes web/smoke, build e revisão visual aprovados.
### 03. Treinamentos (`#training`) — validada

- **Importante, corrigido:** trilho de 320px, blocos sem alinhamento entre
  linhas e subtítulo extra substituídos pelo cabeçalho e grade de 340px da
  referência. Da vez/Consistência ocupam a primeira linha; Baralhos/Referências
  e Domínio/Checkpoint ocupam a segunda. Memória fica visível no card correto.
- **Importante, corrigido:** a sessão comum abre dentro do destaque navy,
  com card branco, progresso e notas. Postura/microcopy extra saíram. A sessão
  mantém FSRS, retorno de cards no mesmo dia, 4fun, provas, imagens, cloze e
  oclusão. Foco mantém tela cheia/áudio, largura de 640px e redução de movimento.
- **Importante, corrigido:** Equipe usa cinco colunas com fila própria e
  métricas expandidas sob a pessoa. Avisos e relatório extenso antigos deixaram
  essa apresentação. Ordenação por urgência e métricas reais permanecem.
- **Importante, corrigido:** Editar usa seletor de baralho, criação na lista,
  frente/verso editáveis e prévia local. Editor avançado, busca, configuração,
  salvar/descartar e confirmação de exclusão preservam funções da base real.
  O resumo do baralho usa configurações reais; não inventa estado FSRS de
  cada pessoa em um endpoint que fornece apenas a base oficial.
- **Bloqueante, corrigido:** erro de histórico não deixa spinner eterno nem
  inutiliza o estudo; erros de equipe/base oferecem retry. Falha ao revisar
  mantém o mesmo card; falha ao salvar mantém o rascunho. Escape fecha estudo;
  a troca de aba avisa quando há alterações não salvas. No mobile, cabeçalho
  e abas empilham, campos crescem e a equipe rola dentro da tabela.
- **Evidências:** `npm run test:review:training -w packages/web`, capturas e
  medidas em `packages/web/.review-artifacts/training/`. Em 1440 e 1920 são
  40 comparações por largura, incluindo destaque, consistência, referências,
  checkpoint e card/superfície/botão da sessão: diferença máxima **0px**.
  Alturas que dependem da quantidade de baralhos variam com dados reais.
  Conferidos também 390px, dark, referências, teclado, revisão/erro/retry,
  modo foco, prova até o resultado, expansão da equipe, edição básica e
  avançada, inclusão, salvamento e releitura dos cards no mock.

Validação: 1.729 testes API, testes web/smoke, build e revisão visual aprovados.
### 04. Pipeline (`#pipeline`) — validada

- **Importante, corrigido:** cabeçalho com subtítulo extra, duas visões com
  filtros separados e quadro sem limite vertical substituídos pela composição
  aprovada. Kanban, Lista e Análise compartilham busca, fase, pessoa e ordem.
  Colunas de 262px, cards de 115px e rolagem interna mantêm a moldura estável.
- **Importante, corrigido:** lista contínua com nível, lead/empresa, etapa,
  próximo passo, valor e prazo. Origem, responsável redundante, idade e grupos
  antigos deixaram a apresentação. Descartados ficam no rodapé com retorno
  pelo mesmo handler de movimento. Ganhos usam mês comercial e `wonAt` reais.
- **Importante, corrigido:** Análise apresenta a esteira e o forecast usando
  `analysisBuckets`/`winProbByKind` e `pipelinePace`, sem mudar as definições de
  domínio. A barra mede valor ponderado. Carregamento e erro/retry são locais;
  as demais abas continuam utilizáveis.
- **Importante, corrigido:** ficha de 428px a 18px da borda, com resumo,
  respostas, origem, histórico e anotações. Próximo passo fica no rodapé.
  Fatos duplicados do cabeçalho e campos extras saíram da apresentação. A
  edição, propostas, pagamento, requalificação e agendamento mantêm seus
  handlers. Logística real de call/integração continua no editor de agendamento;
  os gates reais permanecem em modal para comportar horários e validações.
- **Bloqueante, corrigido:** modal compartilhado de pagamento passou a usar
  `Modal`, com papel de diálogo, foco inicial, contenção e restauração do foco.
  Antes, o teclado podia permanecer preso na ficha sob o modal. A seleção em
  massa é limpa na troca de produto. O cadastro de entidades usa `Drawer`,
  com foco controlado, Escape e fechamento bloqueado durante o salvamento.
- **Evidências:** `npm run test:review:pipeline -w packages/web`; capturas e
  `geometry.json` em `packages/web/.review-artifacts/pipeline/`. São comparados
  quadro, filtros, lista/células, análise e limites da ficha em 1440/1920:
  **148 medidas por largura**, diferença máxima **1px**. Foram exercitados
  busca, fase/pessoa/ordem, persistência entre abas, seleção/toque em massa,
  arrasto, retorno de descartado, anotações, adiamento, gates, geração de
  proposta, pagamento, cadastro, vazio, erro/retry, carga lenta e mobile390.
  Fluxos usam `preview/pipeline-mock.js`; nenhuma API/banco é iniciada.
- **Fora do escopo:** os handlers existentes de movimento/edição e ações em
  massa são otimistas. Uma falha de persistência gera aviso, mas o rollback
  requer revisão própria. Não foram alteradas regras financeiras ou de etapa.

### 05. Clientes (`#customers`) — validada

- **Importante, corrigido:** cabeçalho, aviso de vencidas, quatro indicadores,
  tabela de cinco colunas e trilho de 340px seguem a referência. Análise
  adicional, prova do MP no dinheiro e detalhes redundantes saíram da base.
  Ativos/Todos/Churn/Sem dono, busca e ordem permanecem ao fechar a ficha ou
  trocar de aba; tabelas estreitas rolam internamente.
- **Importante, corrigido:** ficha lateral de 420px com Contrato, Régua de
  marcos e Dinheiro. Recebe os mesmos totais/status da tabela, calculados pelos
  helpers atuais. Edição, upsell, churn, indicação e gestão de cobranças usam
  formulários/handlers reais; o resumo antigo não volta como expansível.
  Cases e Indicações mantêm as funções existentes onde a prancha é demonstrativa.
- **Importante, corrigido:** Cobranças mostra quatro indicadores e tabelas
  de seis/sete colunas. Baixa, planos, recorrências do MP, mudança/pausa/cancelamento
  de assinatura e billing mantêm os endpoints e as regras existentes.
- **Bloqueante, corrigido:** falha de leitura não aparece como saldo zerado.
  Base e cobranças têm carregamento, erro e retry locais; refresh preserva
  dados já carregados. Ações de cobrança bloqueiam repetição enquanto executam
  e exibem falha. A ficha usa o controle compartilhado de foco/Escape; seu portal
  evita que o widget de feedback cubra o rodapé no mobile. O listener duplicado
  de Escape do modal antigo foi removido. Alvos de toque e foco do seletor
  manual de pagamento foram conferidos.
- **Evidências:** `npm run test:review:customers -w packages/web`; capturas e
  `geometry.json` em `packages/web/.review-artifacts/customers/`. Base, ficha,
  Faturas e Assinaturas totalizam **206 medidas em 1440/1920**, diferença
  máxima **0px**. Alturas dependentes da quantidade de registros ficam fora
  da comparação fixa. Conferidos busca/filtros/ordem, marcos, baixa, edição,
  cadastro, rascunho de case, pausa de assinatura, abertura de upsell/churn,
  Cases/Indicações, foco/Escape, vazio, erro/retry de leitura e escrita,
  leitura lenta, paginação, rolagem em 390px, rodapé desobstruído e tema escuro.
- **Fora do escopo:** marcação de marcos e status manual usam os patches
  otimistas existentes; falhas avisam e solicitam refresh, sem introduzir novo
  rollback. A baixa pela fila atualiza a fatura local, mas o acumulado recebido
  ainda depende do refresh/SSE existente. Regras financeiras e banco preservados.

Validação: 1.729 testes da API, testes web/smoke, build e revisão visual aprovados.
### 06. Propostas (`#proposals`) — validada

- **Importante, corrigido:** removido o subtítulo adicional; cabeçalho,
  funil compacto com conversão nas setas e aviso à esquerda seguem a prancha.
  Templates e propostas geradas usam os mesmos pisos, espaçamentos, tipografia,
  pílulas e filtros da referência; ambas têm rolagem interna no mobile.
- **Importante, corrigido:** Duplicar/Excluir ficam visíveis. Nome abre o editor
  existente e formato abre a prévia pública. Abrir proposta mantém
  `from=cockpit` para não contar acesso interno; cópia/WhatsApp mantêm URL limpa.
  Aceite, visualizações, ordenação e cálculos existentes foram preservados.
- **Bloqueante, corrigido:** carregamento não é apresentado como funil zerado;
  leitura/exclusão mostram falha e permitem nova tentativa. Cópia aguarda a
  área de transferência antes do sucesso. Respostas antigas da prévia não
  substituem a edição atual; falhas têm retry. Salvar mantém o rascunho em
  caso de erro e cancelar edição alterada pede confirmação.
- **Bloqueante, corrigido:** o editor em 390px cortava campos e o botão Salvar.
  Formulário e prévia empilham, cabeçalho permanece acessível e grupos de
  campos quebram em linhas. Escape, foco inicial e retorno ao controle que
  abriu o editor foram exercitados; alvos de toque têm 44px.
- **Evidências:** `npm run test:review:proposals -w packages/web`; capturas e
  medidas em `packages/web/.review-artifacts/proposals/`. **168 medidas em
  1440/1920**, incluindo células das duas tabelas, diferença máxima **0px**.
  Conferidos filtros, URLs, cópia, edição, duplicação/salvamento, confirmação
  de exclusão, criação, slide adicional, descarte cancelado, erros de leitura,
  exclusão, gravação e prévia, espera longa, vazio, teclado, mobile e tema escuro.
- **Fora do escopo:** o cálculo existente de conversão por template usa geradas
  de 30 dias com abertas/aceites de toda a lista; não foi alterado. O payload
  antigo do editor não inclui `layout` ao criar a cópia; o comportamento do
  catálogo/renderer requer revisão de domínio separada.

Validação: 1.729 testes da API, testes web/smoke, build e revisão visual aprovados.
### 07. Links de pagamento (`#offers`) — validada

- **Importante, corrigido:** cabeçalho sem subtítulo, faixa de valores, filtros
  dentro do card, grupos por cliente e expansão compacta seguem a referência.
  Aviso de saldo anterior ao período, contagem no rodapé e metadados adicionais
  de cada recibo saíram da apresentação, sem remoção de dados. Valores de cobrança
  mantêm centavos; totais, contagens e grupos continuam vindo prontos da API.
- **Bloqueante, corrigido:** Cobrar/Copiar não apareciam porque a interface
  comparava o objeto retornado por `linkStatusOf` com uma string. A seleção do
  link aberto usa o status existente; WhatsApp abre a URL correta e cópia só
  confirma após concluir. Abrir checkout, copiar e desfazer baixa permanecem no
  menu do link; pagamento do MP não ganha ação de estorno manual.
- **Bloqueante, corrigido:** leituras têm retry e proteção contra respostas
  antigas; atualizações preservam tabela, filtros, expansão e foco. A primeira
  carga não mostra dinheiro zerado. Falha ao atualizar identifica os dados
  anteriores. Baixa de fatura, baixa manual e geração usam os endpoints reais,
  bloqueiam repetição e preservam o formulário após erro. Desfazer baixa pede
  confirmação; nenhum cálculo ou autorização foi alterado.
- **Importante, corrigido:** expansão por teclado, foco visível, rolagem interna
  da tabela e controles de toque de 44px. Modais desta rota são portais para
  manter a camada acima do feedback. Autofocus dos modais de pagamento foi
  removido para o controle compartilhado restaurar o foco ao fechar; a geração
  bloqueia saída/troca de alvo durante o envio.
- **Evidências:** `npm run test:review:offers -w packages/web`; capturas e
  `geometry.json` em `packages/web/.review-artifacts/offers/`. **368 medidas em
  1440/1920**, incluindo faixa, tabela, células e expansão; diferença máxima
  **0px**. Conferidos abas, busca/limpeza, vendedor, cópia/URL de cobrança,
  geração para lead/cliente, baixa manual/fatura, desfazer/cancelar,
  falhas de leitura/gravação, espera longa, envio pendente, vazio, conta
  desconectada, perfil closer, teclado/foco, mobile e tema escuro. Regressão
  dos consumidores anteriores do modal de pagamento: Pipeline e Clientes.
- **Fora do escopo:** Pagos continua incluindo grupos com algum recebimento,
  mesmo com saldo aberto; o protótipo conta só grupos sem saldo. Preservada a
  régua financeira existente. Filtros de período e vendedor continuam globais/
  autorizados pelo backend; não houve mudança em API, schema ou banco.

Validação: 1.729 testes da API, testes web/smoke, build e revisão visual aprovados.
### 08. Contratos (`#contracts`) — validada

- **Importante, corrigido:** cabeçalho sem subtítulo, biblioteca de modelos e
  histórico seguem as colunas, espaçamentos, fontes e ações do CRM final.
  Busca mantém o recorte ao abrir e fechar um registro. Tabelas rolam dentro
  do card em larguras menores, com nomes completos disponíveis em tooltip.
- **Importante, corrigido:** gaveta de 520px com cliente, campos do modelo e
  prévia do quadro; a contratada vem do documento real. Edição, duplicação,
  documento completo, download e registro sem impressão ficam no menu.
  O botão principal identifica a geração de PDF; não promete envio para uma
  plataforma de assinatura que não existe no fluxo atual.
- **Bloqueante, corrigido:** falha de histórico não aparece como zero gerados
  ou modelo nunca usado. Leituras têm retry independente e proteção contra
  respostas antigas. Erro de gravação mantém dados e permite nova tentativa;
  cópia só confirma após concluir. Mutação em andamento bloqueia repetição.
- **Bloqueante, corrigido:** Escape usa apenas o listener do Drawer; o listener
  anterior da tela era bloqueado pela pilha de overlays. Fechamento e troca
  para edição confirmam descarte. Foco volta ao controle de origem e uma
  prévia sobre a gaveta fecha separadamente. No celular, editor e documento
  empilham e as ações permanecem acessíveis acima do widget de feedback.
- **Evidências:** `npm run test:review:contracts -w packages/web`; capturas e
  `geometry.json` em `packages/web/.review-artifacts/contracts/`. **384 medidas
  em 1440/1920**, diferença máxima **0px**, para cabeçalho, tabelas, células e
  estrutura da gaveta. A prévia varia conforme o corpo e os campos reais.
  Conferidos busca, paginação, criação/edição, duplicação, exclusão confirmada,
  impressão/reimpressão, download, cópia, deduplicação do snapshot, descarte,
  erro/retry, espera longa, popup bloqueado, vazio, mobile e tema escuro.
- **Fora do escopo:** preservados preenchimento parcial para completar no
  papel, vínculo manual e HTML de impressão. Duplicar continua reconstruindo
  os campos a partir dos tokens do corpo; o payload existente não copia os
  metadados de `fields`. Nenhuma regra de contrato, API ou banco foi alterada.

Validação: 1.729 testes da API, testes web/smoke, build e revisão visual aprovados.
### 09. Formulário de Integração (`#intform`) — validada

- **Importante, corrigido:** cabeçalho sem subtítulo adicional, faixa navy
  com espera/retorno e ação de cobrança, filtros dentro do card e tabela
  de cinco colunas seguem a prancha. Pedidos pendentes aparecem primeiro,
  com os mais antigos no topo. Tipo, situação e busca permanecem ao fechar
  a ficha; listas extensas mostram mais 50 registros por vez.
- **Importante, corrigido:** ficha de 470px com seções de respostas, termo e
  ações no rodapé. Arrays, campos booleanos, texto longo e dados da assinatura
  continuam íntegros. `doc.sections` permanece a fonte dos rótulos de respostas
  enviadas; perguntas de pedidos pendentes e a prévia usam a definição atual
  pelo endpoint existente `GET /api/integration-forms/questions?kind=`.
- **Bloqueante, corrigido:** falha inicial não mostra contadores zerados;
  leitura tem retry e ignora respostas de uma navegação anterior. Solicitação
  e exclusão bloqueiam repetição e fechamento durante o envio. Falha preserva
  o contexto para tentar novamente. Cópia só confirma depois da conclusão.
- **Importante, corrigido:** modais em portal, com foco/Escape compartilhados;
  campos e ações de toque têm 44px. Tabelas rolam internamente em 390px e a
  ficha comporta respostas longas sem extravasar. Contato sem telefone oferece
  cópia do link; não apresenta um destino de WhatsApp inexistente.
- **Evidências:** `npm run test:review:intform -w packages/web`; capturas e
  `geometry.json` em `packages/web/.review-artifacts/intform/`. **352 medidas
  em 1440/1920**, diferença máxima **0,016px**, para faixa, filtros, tabela,
  células e estrutura da ficha. Conteúdo interno usa perguntas e respostas
  reais, portanto varia em relação ao texto resumido demonstrativo.
  Conferidos filtros/busca, cobrança e URLs, cópia de respostas/mensagem/link,
  perguntas dos dois tipos, pedido para cliente/lead, exclusão/cancelamento,
  erro/retry de leitura/gravação/perguntas, espera longa, clipboard bloqueado,
  vazio, paginação, foco, alvos desobstruídos, mobile e tema escuro.
- **Fora do escopo:** o CTA demonstrativo de marcar a call não possuía handler
  de agendamento nesta tela. Mantida a ação real de copiar respostas, sem
  introduzir um segundo fluxo de agenda. Tipos, snapshots, termo, autor,
  permissões e geração dos links continuam nos endpoints existentes.

Validação final após incorporar a main: 1.739 testes da API, testes web/smoke,
build e revisão visual aprovados.
### 10. Agenda (`#agenda`) — validada

- **Importante, corrigido:** cabeçalho, avisos com nota visível, seletor de tipo
  direto na barra, navegação, legenda e calendário seguem `TelaAgenda.dc.html`.
  Opções de toques e ajuda permanecem na legenda, preservando os controles reais.
- **Bloqueante, corrigido:** criar/editar/excluir aguardam a resposta da API.
  O editor bloqueia repetição e fechamento durante o envio; falhas mantêm os
  campos e o item original. Em recorrência com resultado parcial, informa quantos
  registros foram salvos e bloqueia reenvio para evitar duplicar os dias aceitos.
- **Importante, corrigido:** gaveta lateral de 400px com campos roláveis e ações
  fixas; confirmação de exclusão e descarte, foco contido e retorno ao controle
  de origem. Dias do mês e compromissos são acessíveis pelo teclado; 390px mantém
  a rolagem dentro da grade e controles de toque de 44px.
- **Evidências:** `npm run test:review:agenda -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/agenda/`. **160 medidas**
  das quatro visões em 1440/1920, diferença máxima **0,797px**, para cabeçalho,
  avisos, barra e calendário. Fluxos de criação/edição/exclusão, cancelamento,
  falhas/retry, escrita demorada, recorrência parcialmente salva, filtros,
  teclado, vazio, mobile e tema escuro conferidos com mocks.
- **Fora do escopo:** preservados participantes, conflitos por hora, produtos,
  consultas, recorrência e durações reais (incluindo follow-up de 20 minutos).
  O conteúdo da gaveta tem mais controles que a demonstração. O aviso de no-show
  já chamava `isNoShowStage(saasCfg, stage)` embora o helper aceite apenas o
  estágio; a classificação deve ser corrigida em revisão de domínio separada.
  A leitura de consultas continua com o tratamento de falha anterior.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
### 11. Inbox (`#whatsapp`) — validada

- **Importante, corrigido:** cabeçalho, faixa navy única de atendimento/saúde,
  proporções dos três painéis, filas, tipografia, bolhas e composição seguem
  `TelaInbox.dc.html`. Filtros da referência ficam visíveis; Encerradas e Pra
  humano continuam em Mais. Indicadores e conteúdo dependem dos dados reais.
- **Bloqueante, corrigido:** falha ao carregar conversas ou mensagens tem erro
  explícito e nova tentativa, sem simular lista vazia ou janela fechada. Falha
  nos indicadores informa indisponibilidade. Após um envio aceito, falha na
  releitura não mantém o texto como se não tivesse sido enviado.
- **Bloqueante, corrigido:** Instagram/Messenger usavam `box` inexistente e
  quebravam a renderização. Agora usam a superfície compartilhada dos painéis;
  a indisponibilidade do canal aparece normalmente. Detalhes do número abrem
  em portal, fora do contexto de empilhamento da faixa navy.
- **Importante, corrigido:** no celular, abrir a conversa recolhe cabeçalho e
  indicadores para dar espaço ao histórico/composer; voltar recupera a lista.
  A ficha continua acessível por rolagem e pelo menu da conversa. Automações
  têm rolagem própria e continuam disponíveis como canal adicional.
- **Evidências:** `npm run test:review:whatsapp -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/whatsapp/`. **56 medidas**
  em 1440/1920, diferença máxima **0px**, para cabeçalho, faixa e três painéis.
  Busca, filtros, detalhes, resposta mock, erro/retry, envio demorado, releitura
  após envio, janela fechada, encerramento, canais, vazio, 390/1024px e tema
  escuro conferidos. Nenhuma mensagem externa foi enviada.
- **Fora do escopo:** qualificação completa, gates do funil, respostas por etapa,
  anexos/áudio, templates e automações permanecem nos componentes reais. A ficha
  tem mais campos que a demonstração; Próxima ação mantém a lógica existente.
  Edição otimista de qualificação e cálculos de atendimento não foram refeitos.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 12. Tickets (`#tickets`) — validada

- **Importante, corrigido:** cabeçalho, faixa compacta do atendente, filtros,
  Kanban e Lista seguem `TelaTickets.dc.html`. Colunas preservam a rolagem
  interna, conclusão, arraste, contadores e filtros reais. Linhas/cards abrem
  com Enter ou Espaço sem interceptar os botões internos.
- **Importante, corrigido:** detalhe em gaveta de 560px com Conversa, Atividade
  e Dados. A aba Linear permanece quando vinculada. Histórico rola dentro da
  gaveta; resposta fica acessível no rodapé. Campos, SLA, anexos e responsáveis
  usam os mesmos componentes/endpoints. Assunto cresce para caber no celular.
- **Bloqueante, corrigido:** criação, resposta e exclusão bloqueiam repetição
  e fechamento durante a requisição. Falha conserva o preenchimento e permite
  nova tentativa. Criar/fechar confirma descarte; excluir confirma a consequência.
  Leitura da ficha tem retry explícito. Sobreposições usam portal e foco comum.
- **Evidências:** `npm run test:review:tickets -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/tickets/`. **48 medidas**
  em 1440/1920, diferença máxima **0px**, para título/cabeçalho, faixa, filtros,
  quadro e coluna. Lista/gaveta, busca, filtros, abas, CRUD e resposta mock,
  falha/retry, gravações demoradas, teclado, vazio, mobile e escuro conferidos.
- **Fora do escopo:** regras de SLA, autorização, conclusão/arraste otimistas,
  vínculo Linear, anexos e autosave existentes foram preservados. A aba Dados
  contém mais campos que a demonstração. Falhas de leitura de atividade ainda
  seguem o tratamento anterior; esta rodada não refez integrações de suporte.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 13. Respostas rápidas (`#quick_replies`) — validada

- **Importante, corrigido:** cabeçalho, filtros, lista e coluna de variáveis de
  330px seguem `TelaRespostasRapidas.dc.html`. Duplicação pessoal fica visível
  na linha; ações reais de editar/ver/excluir continuam no menu. Variáveis
  embutidas vêm antes das personalizadas, com cópia e identificação acessível.
- **Importante, corrigido:** editor em portal de 620px, campos e prévia em uma
  coluna, conteúdo rolável e ações fixas. Campos têm nomes acessíveis, e
  controles de toque têm 44px. Escopo continua bloqueado em respostas existentes.
- **Bloqueante, corrigido:** guardar/apagar/duplicar bloqueiam repetição; o
  editor bloqueia fechamento e edição durante a gravação. Falha mantém dados
  para retry. Escape e véu passam pela confirmação de descarte. A prévia mostra
  falha/retry e ignora retornos antigos; o mock agora recebe o texto como a API.
- **Importante, corrigido:** variáveis em edição sobrevivem à atualização da
  listagem, têm validação de nomes e salvamento explícito com erro local. O
  token compartilhado `--line-faint` é recalculado no tema escuro, corrigindo
  divisores claros também em Tickets e outras listas que usam esse token.
- **Evidências:** `npm run test:review:quick-replies -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/quick_replies/`. **36 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para cabeçalho, barra,
  posição/largura das duas colunas. CRUD, duplicação, busca/filtros, variáveis,
  inserção por teclado, clipboard, falha/retry, espera, leitura sem permissão
  de edição, descarte, vazio, mobile e escuro conferidos; Tickets revalidado.
- **Fora do escopo:** renderização de variáveis, escopos, validação definitiva
  e permissões continuam na API. O painel usa descrições reais das variáveis
  em vez de valores fictícios fixos; nomes personalizados continuam editáveis.
  A altura das listas depende do conteúdo. Não há confirmação de saída da
  rota SPA para variáveis não salvas; Descartar/Salvar permanecem explícitos.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 14. Configurações de SLA (`#support_settings`) — validada

- **Importante, corrigido:** cabeçalho e cards em três colunas fluidas seguem
  `TelaConfiguracoesSLA.dc.html`; prioridades mantêm números/unidades legíveis,
  categorias usam pills, e os atendentes aparecem em linhas com acesso por
  produto. Avisos de novos tickets continuam com controle próprio, separado
  do acesso. Admin permanece com acesso aos produtos bloqueado para edição.
- **Bloqueante, corrigido:** Salvar bloqueia repetição e edição durante a
  gravação; falha mantém o rascunho e indica retry. Resolução anterior à primeira
  resposta desabilita o envio; Descartar repõe os valores salvos. Retornos de
  leitura de outro produto são ignorados. Estado limpo mostra Tudo salvo.
- **Bloqueante, corrigido:** falhas de leitura de atendentes e catálogo Linear
  têm erro/retry. Alterações de acesso bloqueiam concorrência na UI e mantêm
  rollback em falhas. Horas continuam convertidas em minutos pelo helper real.
- **Bloqueante, corrigido:** o Popover compartilhado abre em portal; a folha
  mobile do seletor Linear deixava opções atrás do botão de feedback por causa
  do empilhamento da página. Foco/Escape e os mesmos seletores foram preservados.
- **Evidências:** `npm run test:review:sla -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/support_settings/`.
  **28 medidas** em 1440/1920, diferença máxima **0px**, para cabeçalho e
  início/largura das colunas. Horas fracionárias, validação/descarte, categorias,
  expediente, cópia do portal, atendentes, falhas/retry, espera, 390/1024px,
  tema escuro e seletores Linear com mock conferidos. Tickets e Respostas
  rápidas revalidados após o ajuste do componente compartilhado.
- **Fora do escopo:** regras de SLA, expediente, pausa, fechamento automático,
  notificações e autorização continuam na API. Pausas, texto do portal e
  integração Linear permanecem disponíveis, embora a prancha os resuma/omita;
  por isso as alturas e distribuição dos cards dependem do conteúdo real.
  A integração Linear fica após Atendentes. A navegação entre rotas continua
  sem confirmação global de rascunho desta tela.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 15. Redes sociais (`#social`) — validada

- **Importante, corrigido:** cabeçalho, faixa navy, indicadores em superfície
  única e gráficos na proporção 2:1 seguem `TelaRedesSociais.dc.html`.
  Publicações mantêm as 16 métricas reais com rolagem horizontal. Audiência,
  interações, stories e radar continuam acessíveis após os blocos principais.
- **Importante, corrigido:** comentários usam filtros próprios e linhas contínuas;
  responder, resolver/reabrir e ocultar continuam disponíveis. Leituras antigas
  não substituem a consulta atual. Falhas de métricas, publicações, stories,
  audiência, comentários e radar têm feedback e nova tentativa.
- **Bloqueante, corrigido:** publicação impede duplo envio e fechamento durante
  a requisição; falhas mantêm a legenda. Resultado parcialmente aceito impede
  repetir a publicação inteira e informa o resultado por rede. O criador de
  post abre em portal, confirma descarte e preserva vídeo/editor/IA existentes.
  Respostas e edição de concorrentes/hashtags bloqueiam gravações concorrentes.
- **Evidências:** `npm run test:review:social -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/social/`. **30 medidas**
  em 1440/1920, diferença máxima **0px**, para título, cabeçalho, faixa e KPIs.
  Registro de criativos, ordenação, resposta, ocultação, resolução, publicação
  de vídeo com mock, falha/retry, parcial, espera, descarte, 390/1024px, escuro,
  vazio e desconectado conferidos. Nenhum post foi enviado a redes externas.
- **Fora do escopo:** contagem, fórmulas e integrações permanecem na API.
  O gráfico preserva o acumulado real, mesmo com barras na referência; o
  formatter compacto e a meta fixa de 12 posts são anteriores. O contador de
  criativos mantém sua regra de elegibilidade e tratamento anterior de leitura.
  Pautas, classificação de comentário e conversão em lead da demonstração não
  viraram funções fictícias. A comparação estrutural não equivale a pixels
  idênticos nos gráficos, conteúdo e controles reais.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 16. Publicidade (`#metrics`) — validada

- **Importante, corrigido:** cabeçalho compacto, faixa navy, recomendações em
  linhas, regras de veiculação expansíveis e painéis na proporção 2:1 seguem
  `TelaPublicidade.dc.html`. Valores monetários mantêm centavos e deixam de
  cortar no celular. Explicações e parâmetros das regras continuam disponíveis.
- **Bloqueante, corrigido:** gasto manual e sincronização bloqueiam repetição;
  registro mantém valores em falhas, confirma descarte e mostra conclusão.
  Campos e cancelamento da criação de anúncios ficam bloqueados enquanto
  enviam/processam; um job aceito impede repetir a criação pelo mesmo painel.
  Resultados de outro produto não substituem o aviso atual, e a conclusão
  atualiza as métricas da janela vigente.
- **Importante, corrigido:** gerenciador mantém todos os níveis, filtros,
  colunas, orçamentos e totais reais. Nomes e ordenação funcionam por teclado;
  orçamento e seleção têm rótulos acessíveis. Colunas usa Popover em portal,
  com folha mobile. Prévia do criativo também usa portal e oferece retry.
- **Bloqueante, corrigido:** recomendações usam o Modal compartilhado com
  foco/Escape e bloqueio de fechamento/gravações concorrentes. O componente
  também atende Formulários; botões descrevem a ação e Dispensa fica visível.
  Regras de veiculação mostram erros locais e impedem gravação simultânea
  com checagem; falha de leitura oferece nova tentativa.
- **Evidências:** `npm run test:review:metrics -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/metrics/`. **20 medidas**
  em 1440/1920, diferença máxima **0px**, para título/cabeçalho e posição/largura
  da faixa. Gasto manual, teclado, drilldown, filtros, colunas, prévia, orçamento,
  liga/desliga, regras, recomendação, dois criadores de anúncio, falha/retry,
  processamento recusado, espera, descarte, 390/1024px, escuro, vazio e sem Meta
  conferidos com mock. Nenhuma campanha ou verba externa foi alterada.
- **Fora do escopo:** cálculos, atribuição, orçamento, limites, jobs e regras
  automáticas continuam na API. A faixa mantém visitas/CPL/CAC/LTV reais, em
  vez de trocar definições para copiar números da prancha. As alturas dependem
  de observações e dados reais; a referência simplifica as regras de veiculação.
  Os criadores inline e seus seletores existentes foram preservados. Navegação
  global ainda pode sair de um job em andamento; o processamento é do servidor.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
### 17. Formulários (`#forms`) — validada

- **Importante, corrigido:** cabeçalho, lista contínua, cards arredondados,
  ações em pills e funil seguem `TelaFormularios.dc.html`. Receitas mostram
  números completos. Métricas, conversões e decisão de vencedor A/B mantêm
  os cálculos existentes; falha de leitura oferece nova tentativa.
- **Importante, corrigido:** editor em duas colunas dá prioridade a nome,
  chamada inicial e perguntas. Boas-vindas e teste A/B ficam em seção
  expansível; todos os campos e a prévia da identidade pública permanecem.
  Perguntas têm rótulos acessíveis e controles adaptados ao celular.
- **Bloqueante, corrigido:** gravação e publicação impedem repetição; falhas
  preservam o rascunho. Cancelar confirma descarte. Prévia ignora retornos
  antigos e oferece retry. Resultados de outro produto não fecham o editor atual.
- **Importante, corrigido:** respostas têm indicadores do período, filtros
  Todas/Nível S e A/Últimas 48h, tabela e expansão das respostas completas.
  O histórico completo é identificado separadamente dos KPIs do período.
  O nível vem do helper real do lead vinculado, no mesmo produto, e é rotulado
  como nível atual; leads ausentes não recebem classificação fictícia.
- **Evidências:** `npm run test:review:forms -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/forms/`. **20 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para cabeçalho, título
  e posição/largura do primeiro card. Clipboard, criação, edição, publicação,
  respostas/filtros, falha/retry, espera, descarte, 390/1024px, vazio e escuro
  conferidos com mock. Nenhum formulário real foi publicado.
- **Fora do escopo:** perguntas, ramificações, publicação, conversões e A/B
  continuam com os contratos REST existentes. A prévia mantém a marca do
  formulário; o editor real tem mais opções que a prancha. As alturas dependem
  dos dados e variantes reais. Navegação global SPA ainda não confirma saída
  de rascunho; Cancelar e fechamento da janela têm proteção local.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
### 18. Canvas (`#creative`) — validada

- **Importante, corrigido:** cabeçalho com formatos, galeria em lista,
  prévia e campos seguem `TelaCanvas.dc.html`. Os três painéis mantêm a
  proporção da referência; controles usam pills e tipografia do cockpit.
  A galeria fica compacta no celular e os controles têm alvos de 44px.
- **Bloqueante, corrigido:** trocar de template e resetar pedem confirmação
  quando há alterações. A exportação bloqueia repetição e edição local;
  falha preserva a arte e permite repetir. O PNG usa canvas separado, sem
  levar o contorno de seleção. Falhas dos assets da marca têm retry.
- **Importante, corrigido:** elementos adicionais de botão ficam disponíveis
  junto aos textos, usando o renderer existente. Tamanho da fonte permanece
  legível e limitado ao intervalo anterior. Fotos atrasadas de outro template
  são ignoradas. O editor reinicia ao trocar de produto.
- **Evidências:** `npm run test:review:creative -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/creative/`. **32 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho e
  posição/largura das três colunas. Edição, descarte, fontes, fotos, slides,
  PNG individual e quatro arquivos do carrossel, falha/retry, espera, 390/1024px,
  escuro e marca Elo conferidos. PNGs inspecionados em 1080×1920 e 1080×1350.
- **Fora do escopo:** as artes mantêm identidade, copy e fontes públicas da
  marca, distintas da UI do CRM. A galeria conserva os nove modelos reais
  de stories, incluindo sequências; alturas diferem do catálogo simplificado
  da prancha. O contrato do editor embutido em Redes sociais foi preservado.
  Navegação global SPA ainda pode descartar a edição; a proteção de saída é
  local ao template/reset e ao fechamento da janela. Arquitetura do renderer,
  persistência da arte e dependência de fontes externas não foram refeitas.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
### 19. Disparos (`#disparos`) — validada

- **Importante, corrigido:** cabeçalho e três abas seguem `TelaDisparos.dc.html`.
  Público e composição usam duas colunas 2:1; campanhas salvas ficam junto da
  mensagem. Sequências e Templates mantêm o mesmo padrão de cards, pills,
  campos rotulados e biblioteca/fila em linhas. Tabelas largas rolam no celular.
- **Bloqueante, corrigido:** campanha, geração de texto, envio, sequência,
  marcação da fila e template bloqueiam ações concorrentes. Campos e troca
  de aba ficam bloqueados durante a operação. Falhas preservam o rascunho;
  excluir identifica o item e o envio nativo de e-mail confirma a quantidade.
- **Bloqueante, corrigido:** leituras têm estados de carga, falha e retry;
  uma falha não substitui silenciosamente os dados anteriores por lista vazia.
  Retornos antigos são ignorados e trocar de produto reinicia o contexto local.
  Atualizações globais deixam de apagar o template em edição.
- **Importante, corrigido:** carregar outra campanha, trocar sequência e sair
  da aba de edição confirmam descarte. A edição da campanha permanece ao
  alternar abas; fechamento da janela avisa sobre alterações não salvas.
- **Evidências:** `npm run test:review:disparos -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/disparos/`. **26 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho e
  posição/largura das colunas. Campanha, tokens/prévia, IA, envio assistido e
  nativo com mock, sequência/fila, templates, exclusão, falha/retry, descarte,
  espera, vazio, 390/1024px e escuro conferidos. Nenhuma mensagem real enviada.
- **Fora do escopo:** qualificação, seleção inicial do público, interpolação,
  cálculo de custo/limite, atribuição e automações mantêm as regras reais.
  Abrir WhatsApp/Gmail continua registrando a abertura conforme o comportamento
  anterior; a UI explica que o envio assistido termina no aplicativo. A prancha
  simplifica estágios, dados, canais e catálogo. Navegação global SPA ainda não
  tem confirmação de rascunho; a proteção cobre as ações e abas desta tela.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
### 20. Blog (`#blog`) — validada

- **Importante, corrigido:** cabeçalho, chamada de revisão, motor em duas
  colunas e lista seguem `TelaBlog.dc.html`. Switches usam o componente comum;
  cadência/dias ficam visíveis e estado detalhado/CTA ficam em seção expansível.
  Falta de IA e último erro do motor permanecem visíveis sem abrir os detalhes.
- **Bloqueante, corrigido:** pauta usa um único submit e bloqueia repetição,
  edição e fechamento durante criação; Cancelar confirma descarte. Editor e
  modais usam as molduras compartilhadas em portal, com foco e Escape.
- **Bloqueante, corrigido:** salvar, reescrever, aprovar e montar prévia usam
  exclusão mútua na UI. Falha ao salvar interrompe a abertura da prévia e
  preserva o rascunho. Tags entram imediatamente no estado de edição e no
  aviso de descarte. Leitura do post/digest oferece retry; exclusão concluída
  não tenta reler o post apagado.
- **Importante, corrigido:** automação bloqueia gravações simultâneas, informa
  erro local e mantém rollback. Revalidação preserva campos ainda em edição;
  retorno antigo não sobrescreve regras recém-salvas. Trocar produto reinicia
  o estado local. Posts publicados ficam com campos desabilitados para não-admin.
- **Evidências:** `npm run test:review:blog -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/blog/`. **28 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho,
  aviso e posição/largura do motor. Filtros, pauta sem duplicação, texto/tags,
  prévia, agendamento BRT, publicação/despublicação/arquivo/exclusão, IA,
  regras, erro/retry, espera, descarte, 390/1024px, vazio, escuro e permissões
  conferidos com mock. Nenhum artigo real foi publicado ou removido.
- **Fora do escopo:** lint, motor, cadência, autorização e URLs mantêm a API
  existente. O editor conserva metadados, FAQ, evidências e histórico reais,
  ocupando uma gaveta mais larga que o exemplo simplificado. Detalhes extras
  alteram a altura do motor. A navegação SPA global ainda não confirma saída
  de rascunho; fechar o editor ou a janela tem proteção local.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 21. Análise de Pace (`#analise`) — validada

- **Importante, corrigido:** cabeçalho, resumo da meta, gráfico, engenharia
  reversa e forecast seguem `TelaAnalisePace.dc.html`, com superfícies de 24px,
  hierarquia de títulos e valores completos nos indicadores e tabela.
- **Importante, corrigido:** detalhes de ritmo diário, histórico e origem das
  taxas ficam em seção expansível; cobertura da esteira e taxa que impede o
  cálculo permanecem visíveis. Link para Pipeline respeita a permissão existente.
- **Bloqueante, corrigido:** falha de leitura oferece nova tentativa, carregamento
  é explícito e respostas antigas são ignoradas. Produto reinicia o contexto.
  Gráfico tem descrição acessível e não excede a largura no celular; tabela
  mantém rolagem própria. Textos secundários usam contraste legível no escuro.
- **Evidências:** `npm run test:review:analise -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/analise/`. **22 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho e
  resumo da meta. Meta batida, supermeta, taxa zerada, vazio, carga, erro/retry,
  detalhes, 390/1024px e escuro conferidos com dados fictícios.
- **Fora do escopo:** API de Pace só fornece mês corrente; meses anteriores da
  prancha não viraram filtros sem dados. Preservados reconhecimento financeiro,
  probabilidades, calibração, dias úteis e cálculo de leads novos. O gráfico
  conserva a série diária real, e a cadeia mantém todos os passos da aplicação.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 22. Análise de Pitches (`#calls`) — validada

- **Importante, corrigido:** cabeçalho, filtro de grupo/pessoa, temperatura em
  papel, padrões em duas colunas e diagnóstico navy seguem `TelaAnalisePitches.dc.html`.
  Barras, distribuição e calls recentes têm componentes de análise reutilizáveis.
- **Bloqueante, corrigido:** leitura tem carga, erro e retry. Troca de grupo/pessoa
  remove o diagnóstico anterior imediatamente; troca de produto reinicia a tela.
  Respostas antigas são ignoradas, inclusive a IA após sair do contexto.
- **Bloqueante, corrigido:** geração usa bloqueio contra repetição e desabilita
  filtros enquanto está em curso. Falha oferece nova tentativa; ausência de IA
  tem explicação visível. Nenhum roteiro é aplicado automaticamente.
- **Importante, corrigido:** calls recentes abrem por botão/teclado, com gravação
  em link separado, data/hora BRT e nome completo no rótulo acessível. Leads
  indisponíveis ou de outro produto não oferecem abertura. Atalhos para treino
  e configurações respeitam as permissões das telas.
- **Evidências:** `npm run test:review:calls -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/calls/`. **30 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho,
  filtros e temperatura. Grupo, pessoa, parâmetros do diagnóstico, erro/retry,
  repetição, troca de produto durante IA, abertura por teclado, gravação,
  390/1024px, escuro, vazio, amostra pequena e IA indisponível conferidos com mock.
- **Fora do escopo:** agregações e deduplicação da API mantidas; a tela identifica
  o histórico do grupo, sem inventar período. IA e treino conservam os contratos
  atuais. Datas e responsáveis reais tornam as linhas mais completas que a prancha.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 23. Análise de Integração (`#integrations`) — validada

- **Importante, corrigido:** cabeçalho, risco navy, faixa de atrasos, distribuição
  de sentimento e padrões em duas colunas seguem `TelaAnaliseIntegracao.dc.html`.
  Reusa cards, barras e lista acessível da Análise de Pitches.
- **Bloqueante, corrigido:** leitura oferece carga, falha e retry; respostas de
  contexto antigo são ignoradas e trocar produto reinicia a tela. Risco/atraso
  só permitem abrir leads disponíveis no produto ativo.
- **Importante, corrigido:** integrações recentes abrem por teclado, trazem
  data/hora BRT e o link separado da gravação retornada pela API. No celular,
  resumo e ações quebram linha sem rolagem horizontal na página.
- **Evidências:** `npm run test:review:integrations -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/integrations/`. **30 medidas**
  estruturais em 1440/1920, diferença máxima **0px**, para título/cabeçalho,
  risco e atrasos. Abertura de risco/atraso/recentes por teclado, gravação,
  erro/retry, carga, troca de produto, sem risco, vazio, amostra pequena,
  lead indisponível, 390/1024px e escuro conferidos com mocks.
- **Fora do escopo:** sentimento, pendências, deduplicação e responsabilidade
  dos atrasos mantêm as regras da API. A prancha mostra métricas de tempo e
  contas conectadas que o endpoint não entrega; elas não foram inventadas.
  Risco é histórico das calls resumidas e recentes continuam limitadas a 25.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 24. Análise de Desempenho (`#desempenho`) — validada

- **Importante, corrigido:** seções por papel, cabeçalhos compactos, ritmo,
  métricas e detalhes seguem `TelaAnaliseDesempenho.dc.html`. Valores de receita
  e ticket aparecem completos, inclusive no relatório copiado. A cópia fica
  no detalhe da pessoa, junto das evidências, como na prancha.
- **Bloqueante, corrigido:** leitura combina placar e detalhes sem converter
  falhas em zeros ou em equipe vazia; oferece retry e identifica dados da
  leitura anterior quando uma atualização falha. Troca de janela/produto
  remove dados do contexto anterior e ignora respostas antigas.
- **Bloqueante, corrigido:** contadores usam trava contra repetição; período,
  relatório e outros incrementos ficam bloqueados durante a gravação. Se a
  gravação foi aceita e só a releitura falhou, a UI explica e o retry apenas
  relê os dados, evitando repetir um incremento aceito.
- **Importante, corrigido:** botão da pessoa abre detalhes por teclado, com
  estado expandido; contadores nomeiam ação, métrica e pessoa. Ritmo tem
  descrição acessível. Tabelas têm rolagem própria no celular, com detalhes
  ajustados à viewport e controles de toque de 44px.
- **Evidências:** `npm run test:review:desempenho -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/desempenho/`. **20 medidas**
  estruturais em 1440/1920, diferença máxima **0,5px**, para título/cabeçalho e
  posição/largura da primeira seção. Dia/semana/mês, navegação de período,
  detalhes/lead, cópia real no clipboard de teste, contadores, falhas de leitura
  e gravação, aceitação antes de falhar, espera, produto, lente individual,
  Instagram parcial, vazio, 390/1024px e escuro conferidos com mocks.
- **Fora do escopo:** métricas, ICP S/A/B, financeiro reconhecido, atribuição,
  produção da conta e permissões mantêm as regras reais. Controles de período
  e contadores existentes foram preservados, embora simplificados na prancha.
  Altura de linha depende das objeções retornadas; não há dados inventados.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 25. Tarefas (`#tasks`) — validada

- **Importante, corrigido:** cabeçalho, quatro visões, faixa de filtros,
  seleção dos campos e colunas de 272px seguem `TelaTarefas.dc.html`.
  Cards usam superfície suave, metadados agrupados e foco visível; menus,
  filtros avançados, agrupamentos e ordenações reais foram preservados.
  Lista, calendário e cronograma mantêm suas interações em superfícies de 24px.
- **Bloqueante, corrigido:** painel tem identidade por tarefa, enfileira as
  gravações de campos e aguarda título/descrição antes de fechar ou abrir outra
  tarefa pelos controles internos. Uma resposta pendente não apaga o texto
  mais recente; falha mantém o campo e oferece nova tentativa explícita.
- **Bloqueante, corrigido:** criação por quadro/lista/calendário bloqueia
  repetição durante a requisição e conserva o texto em caso de erro. Renomear
  coluna não envia duas vezes por Enter+blur; concluir tem trava durante envio.
- **Importante, corrigido:** leitura com falha não exibe vazio nem remove o
  deep link como se o registro não existisse. Retry e respostas antigas foram
  tratados; resumo do cabeçalho usa o mesmo workspace dos cards.
- **Importante, corrigido:** campos dos cards recolhidos no celular, painel
  em portal com foco/scroll, seletores acima dele, rótulos em campos/ações,
  ordenação da lista e abertura dos cards do calendário por teclado.
- **Evidências:** `npm run test:review:tasks -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/tasks/`. **30 medidas**
  de título/cabeçalho/filtros/campos em 1440/1920 com diferença **0px**.
  Busca/prioridade, campos, recolher coluna, quatro visões, criação única,
  edição concorrente, falha/retry, concluir/desfazer, seleção em lote,
  workspace, vazio, 390/1024px, menu/prazo mobile e escuro usam mocks locais.
- **Fora do escopo:** regras de colunas, recorrência, permissões e REST
  permanecem. A guarda de salvamento cobre navegação interna do painel;
  não foi criada uma guarda global de rotas, reload ou troca de workspace.
  Alturas e conteúdos dos cards dependem dos registros reais. Filtros e menus
  adicionais do produto permanecem disponíveis além da simplificação visual
  da prancha. Operações de anexos/comentários e integrações não foram executadas
  contra serviços reais.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.


### 26. Mapas mentais (`#mindmaps`) — validada

- **Importante, corrigido:** lista e canvas na proporção 0,55:2 da prancha
  `TelaMapasMentais.dc.html`, cabeçalho compacto, nome editável na barra,
  alternância Mapa/Esboço, estado de gravação e zoom junto ao canvas.
  Ferramentas adicionais de layout/níveis/busca continuam disponíveis;
  exportação mantém Markdown, PNG e SVG. O seletor não cobre mais a barra.
- **Bloqueante, corrigido:** autosave envia um documento por vez, atualiza
  `baseVersion` com a resposta e depois envia a edição mais recente. Troca,
  criação, duplicação, renomeação e exclusão pelos controles da página aguardam
  a gravação. Ações de documento bloqueiam repetição e edição concorrente.
- **Bloqueante, corrigido:** falhas de lista e gravação têm mensagem e nova
  tentativa; conflito 409 preserva a escolha entre versão remota e gravação
  explícita. Renomear preserva o texto em caso de erro e atualiza a versão
  do editor; copiar o mapa aberto usa o documento salvo mais recente.
- **Importante, corrigido:** lista com botões acessíveis e menu explícito,
  nós focáveis, atalhos não capturam o Enter dos botões, menus/popovers
  compartilhados em portal. O primeiro nó também pode ser criado por botão.
  O enquadramento inicial espera fontes e medidas atuais, inclusive no celular.
- **Evidências:** `npm run test:review:mindmaps -w packages/web`, capturas e
  `geometry.json` em `packages/web/.review-artifacts/mindmaps/`. **36 medidas**
  em 1440/1920, diferença **0px**, para título/cabeçalho/corpo e posição/largura
  da lista e editor. Esboço, layout, busca, clipboard, foco, nota, criação,
  renomear/falhar/repetir, versões consecutivas, troca durante salvamento,
  conflito/versão remota, duplicação, cancelar/confirmar exclusão, vazio,
  390/1024px, enquadramento e popover mobile, tema escuro testados com mocks.
- **Fora do escopo:** algoritmos de árvore/layout, paleta de dados, migração
  de mapas antigos e regras da API foram preservados. Nós e altura da lista
  dependem dos documentos. A guarda cobre ações internas desta página; rotas,
  reload e troca global de workspace não ganharam uma nova guarda. Exportação
  por imagem e upload permanecem, sem envio a serviços reais nesta validação.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 27. Metas (`#metas`) — validada

- Cabeçalho, papel, campos compactos, cards por vaga e agenda em linhas seguem
  `TelaMetas.dc.html`; cadeia com valor antes do rótulo, seções com hierarquia
  e réguas com indicação do pace sem sobrepor o valor no celular.
- Corrigido erro de renderização da cadeia: `infoDot` estava fora do escopo.
  Leitura inicial e réguas têm erro/nova tentativa, sem fabricar dados.
- Gravação e classificação bloqueiam repetição/edição concorrente. Rascunhos
  permanecem em falhas. Se gravar e falhar na releitura, a ação atualiza a tela
  sem reenviar a escrita. A tela é remontada por produto; permissões preservadas.
- Campos por pessoa/ajuste têm rótulos acessíveis, tabela com scroll e controles
  de 44px no celular. Nenhuma fórmula, precedência de metas, payload, regra de
  promoção ou autorização no servidor mudou.
- Evidências: `npm run test:review:metas -w packages/web`, capturas/medidas em
  `.review-artifacts/metas`. 16 medidas de posição/largura do título, cabeçalho
  e primeiro card em 1440/1920 conferidas (diferença <1px). Alturas dependem
  dos dados/regras vigentes (metas individuais de remuneração preservadas).
  Derivar, crescimento, limpar ajuste, descartar, classificação/rollback,
  erro/retry, leitura após escrita sem duplicar, 390/1024, vazio, não admin e
  escuro conferidos com mocks. Navegação global não ganhou guarda de rascunho.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.

### 28. Remuneração (`#remuneracao`) — validada

- Cabeçalho, regras expansíveis, tabelas, simuladores e bônus de time seguem
  `TelaRemuneracao.dc.html`, com papel 24px, controles compactos e scroll mobile.
  Preservados campos de observações, pessoas no nível e salvamento por trilha.
- Falha de leitura não apresenta defaults como se fossem valores salvos. Nova
  tentativa no plano, condições do bônus, extrato e indicações; acesso à leitura
  do plano só começa após conferir a concessão explícita/admin.
- Gravação por card bloqueia repetição e edição pendente. Salvar uma trilha
  não apaga os rascunhos das outras; resposta REST atualiza só o plano salvo.
  Erros inline, descarte por card e recálculo confirmado sem repetição.
- Tabelas têm nomes acessíveis nos campos; pessoa com concessão só lê o plano
  e pode usar o simulador local. Recálculo/edição continuam exclusivos de admin.
  Texto da regra CS corrigido para os R$500 já vigentes no default (sem mudar
  valores salvos ou cálculo). Regras financeiras, nível, bandas e API intactos.
- Evidências: `npm run test:review:remuneracao -w packages/web`, artefatos em
  `.review-artifacts/remuneracao`. 22 medidas em 1440/1920 de título/cabeçalho,
  regras e primeiro card, diferença ≤0,5px. Alturas das trilhas variam com
  pessoas/observações preservadas. Simulações, rascunhos em duas trilhas,
  create/update, descartar, erros/retry, recálculo/cancelar, permissão, vazio,
  390/1024 e escuro conferidos. Navegação global não ganhou guarda de rascunho.

Validação: 1.739 testes da API, testes web/smoke, build e revisão visual aprovados.
As demais 2 páginas aguardam esta rodada; registros históricos não são aceite
 de fidelidade ao CRM final.
