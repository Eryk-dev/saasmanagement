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

As demais 26 páginas aguardam esta rodada; registros históricos não são aceite
 de fidelidade ao CRM final.
