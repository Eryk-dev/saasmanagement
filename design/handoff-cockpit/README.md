# Handoff: Cockpit — protótipo completo (33 telas)

## O que é isto

Pacote de entrega do redesign do cockpit para ser implementado com **Claude Code**
dentro do repositório real `Eryk-dev/saasmanagement` (branch `main`, código web em
`packages/web/src`).

O arquivo `Cockpit - Prototipo.dc.html` é o **protótipo funcional** de 33 telas:
abre direto no navegador, guarda estado no `localStorage`, e cada tela tem as
funções reais (arrastar, filtrar, salvar, publicar, conciliar, simular). Ele foi
construído lendo o código do próprio repositório, tela por tela, com uma rodada de
crítica por tela — o log dessas decisões está em `DECISOES-POR-TELA.md`.

## Como usar (VS Code + Claude Code)

1. Copie esta pasta para dentro do seu projeto, por exemplo em
   `design/handoff-cockpit/` (pode ficar fora do build; não é código de produção).
2. Abra o protótipo no navegador (`Cockpit - Prototipo.dc.html`) e deixe numa aba
   ao lado — é a referência viva de comportamento.
3. No VS Code, com o Claude Code aberto no repositório, cole o conteúdo de
   `PROMPT-CLAUDE-CODE.md` como primeira mensagem.
4. Trabalhe **uma tela por vez**, na ordem da tabela "Mapa de telas". Cada tela é
   um PR pequeno: porta a tela, roda, compara com o protótipo, ajusta.

## Sobre os arquivos deste pacote

Os arquivos aqui são **referência de design em HTML** — um protótipo que mostra a
aparência e o comportamento pretendidos, **não código para copiar e colar**. A
tarefa é **recriar estas telas no ambiente que já existe no repositório**: React
com JSX em `packages/web/src/screens/*.jsx`, os componentes de
`components/viz.jsx` (`PageHead`, `Card`, `Segmented`, `FilterTab`, `Pill`),
`atoms.jsx` (`PrimaryButton`, `SecondaryButton`, `EmptyState`, `toast`, `useEsc`),
os tokens de `tokens.css` e os dados via `lib/api.js` — nunca o HTML servido
direto.

| Arquivo | Para que serve |
|---|---|
| `Cockpit - Prototipo.dc.html` | O protótipo das 33 telas (abre no navegador) |
| `support.js` | Runtime do protótipo (só para ele rodar localmente) |
| `_ds/…` | Tokens e bundle do design system usados pelo protótipo |
| `DECISOES-POR-TELA.md` | Log rodada a rodada: o que foi entregue, o que foi reprovado na crítica e por quê |
| `PROMPT-CLAUDE-CODE.md` | Prompt pronto para colar no Claude Code |

## Fidelidade

**Alta (hifi).** Cores, tipografia, espaçamento, estados e comportamento estão
definidos. O protótipo usa os **valores** dos tokens do design system escritos
inline; na implementação use as **variáveis CSS** do repositório
(`var(--fg-1)`, `var(--accent)`, …) em vez dos hexadecimais.

Uma dívida conhecida: o protótipo desenha a maioria dos controles à mão (só o
Inbox usa os componentes do design system). No repositório, use sempre os
componentes existentes — é o caminho certo, não uma regressão.

## Regras de design que valem para todas as telas

Foram aplicadas em todas as 33 telas e devem ser mantidas na implementação:

1. **Aviso com prazo no topo, com a ação ao lado.** Nunca uma fileira de números
   soltos como abertura ("9 contas paradas há mais de 7 dias" + botão que leva
   para a tela que resolve).
2. **Bloco que conta a história** no lugar da faixa de KPIs: corrente do dinheiro,
   funil com a passagem de cada degrau, ou barra de composição. Faixa de KPIs só
   onde não há história — as duas nunca convivem.
3. **Nada evapora em silêncio.** Todo número que existia antes continua visível:
   se não cabe na história, vai para o ⓘ.
4. **As fatias somam o total e nenhum rótulo de fatia repete o rótulo de um KPI
   que mede outra grandeza.**
5. **Nenhum percentual ou comparação escrito à mão** em aviso ou nota pode
   divergir do que a tela calcula.
6. **A mesma entidade nunca é renderizada por duas fontes** — onde já existe dado,
   a tela lê de lá, nunca de literal.
7. **Uma ação principal por linha**; o resto vai para `⋯` (menu em modal quando a
   linha vive dentro de um scroller, senão o popover é recortado).
8. **Filtros repetidos** viram um segmentado + `mais ▾`.
9. **Texto explicativo de rodapé** vira ⓘ — e o texto do ⓘ em `--ink-muted`
   (#5A6B77, 5,19:1), nunca em `--ink-faint`.
10. **Overlay não sobrevive à navegação**: drawer, modal e gate compartilham um
    fechamento único (navegação e Escape).

## Mapa de telas

Protótipo → arquivos do repositório. A coluna "Estado" diz o que já foi levado ao
repositório antes deste pacote.

| Tela no protótipo | Arquivos do repositório | Estado |
|---|---|---|
| Visão geral | `screens/overview.jsx` · `components/viz.jsx` | implementada no repo |
| Minhas atividades | `screens/today.jsx` · `components/lead-blocks.jsx` · `lib/scripts.js` · `lib/tasks.js` | só protótipo |
| Pipeline + card do lead | `screens/pipeline.jsx` · `screens/deal.jsx` · `components/stage-move.jsx` | só protótipo |
| Clientes (base, indicações, assinaturas, ficha) | `screens/customers.jsx` · `customers-analysis.jsx` · `subscriptions.jsx` · `lib/milestones.js` · `lib/payments.js` | só protótipo |
| Agenda (semana, mês, equipe, editor) | `screens/agenda.jsx` · `pipeline.jsx` (`AgendaView`) · `lib/users.js` | só protótipo |
| Treinamentos | `screens/training.jsx` · `training-focus.jsx` | só protótipo |
| Propostas | `screens/proposals.jsx` | só protótipo |
| Links de pagamento | `screens/offers.jsx` · `components/payment-link.jsx` | só protótipo |
| Contratos | `screens/contracts.jsx` · `lib/contracts.js` | só protótipo |
| Formulário de integração | `screens/integration-forms.jsx` | só protótipo |
| Outbound | `screens/outbound.jsx` | só protótipo |
| Inbox WhatsApp (+ automações) | `screens/whatsapp.jsx` · `components/wa-thread.jsx` · `components/wa-automations.jsx` | só protótipo |
| Consultas (agenda + entregáveis/Manual) | `screens/consultas.jsx` | só protótipo |
| Publicidade | `screens/metrics.jsx` | só protótipo |
| Formulários | `screens/forms.jsx` | só protótipo |
| Landing pages | `screens/landingpages.jsx` | só protótipo |
| Redes sociais (painel + comentários) | `screens/social.jsx` | só protótipo |
| Disparos (disparos, sequências, templates) | `screens/disparos.jsx` | só protótipo |
| Blog | `screens/blog.jsx` | só protótipo |
| Canvas | `screens/creative.jsx` | só protótipo |
| Análises (aquisição, pitches, integração, pace, equipe, desempenho, app) | `screens/aquisicao.jsx` · `calls.jsx` · `integrations.jsx` · `analise.jsx` · `funcionarios.jsx` · `desempenho.jsx` · `eloapp.jsx` | só protótipo |
| Tarefas | `screens/tasks/` (index, toolbar, filters, drawer) | só protótipo |
| Metas | `screens/metas.jsx` · `api/src/routes.metas.js` · `api/src/comp-plan.js` · `lib/levels.js` | só protótipo |
| Remuneração | `screens/remuneracao.jsx` | só protótipo |
| Financeiro (6 abas) | `screens/expenses.jsx` · `finance-hub.jsx` · `finance.jsx` | só protótipo |
| Mapas mentais | `screens/mindmaps.jsx` · `lib/mindmap.js` | só protótipo |
| Configurações (6 abas) | `screens/settings.jsx` | só protótipo |
| Moldura (nav, busca ⌘K, notificações) | `chrome.jsx` · `components/CommandSearch.jsx` · `components/notifications.jsx` | só protótipo |

## Tokens de design

O protótipo escreve os valores; o repositório tem as variáveis. Use a coluna da
direita.

| Uso | Valor no protótipo | Variável no repo |
|---|---|---|
| Texto principal / navy | `#0c1d2b` | `--fg-1` |
| Texto secundário | `#3d4f5c` | `--fg-2` |
| Texto de apoio | `#5a6b77` | `--fg-3` / `--ink-muted` |
| Texto fraco (só kicker e glifo ⓘ) | `#8b99a4` | `--fg-4` / `--ink-faint` |
| Acento (teal) | `#0f766e` | `--accent` |
| Acento suave / linha do acento | `#e9f5f3` · `rgba(15,118,110,.38)` | `--accent-soft` · `--accent-line` |
| Linha | `#e4e8eb` | `--line-1` / `--line-2` |
| Linha fraca | `#f4f6f7` | `--line-faint` |
| Papel | `#fff` · inset `#fbfcfd` | `--bg-1` · `--bg-inset` |
| Positivo | `#177a4c` · fundo `#e9f6ef` | `--pos` · `--pos-soft` |
| Atenção | `#8a5a00` · fundo `#fdf5e6` | `--warn` · `--warn-soft` |
| Negativo | `#b02a2a` · fundo `#fdeeee` | `--neg` · `--neg-soft` |
| Botão primário | fundo `#0c1d2b`, texto `#fff` | `--btn-bg` · `--btn-fg` |

Escala de espaçamento usada: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 22 · 28.
Raios: 6 (campo) · 8 (botão/chip quadrado) · 10–12 (card) · 999 (pílula).
Tipografia: 11px kicker (caixa alta, `letter-spacing:.06em`, peso 600) · 12–12,5px
apoio · 13–13,5px corpo de tabela · 14px campo · 15,5–17px título de card ·
26px título de tela. Números sempre com `font-variant-numeric: tabular-nums` e a
fonte mono do design system.
Contraste: piso de 4,5:1 para texto (3:1 só em título grande).

## Comportamento e estado

O protótipo guarda **um estado só** no `localStorage` (`cockpit_proto_v2`, campo
`versao` para invalidar o seed) e todas as telas leem dele — é essa amarração que
faz "dar baixa numa cobrança" mudar o dinheiro na tela Clientes e no Financeiro ao
mesmo tempo.

Na implementação, o equivalente é a API que já existe: `lib/api.js` +
`data.jsx` (`useData`, `version`) + o evento `cockpit-change` (SSE) que as telas
já escutam. Ao portar:

- **não invente endpoint**: onde o protótipo calcula, o repositório já tem rota —
  use a rota e mantenha o cálculo no servidor;
- **fonte única**: se o protótipo deriva um número de outro (recebido = contratado
  − cobranças abertas, pace = receita × fator, custo por etapa = investido/etapa),
  derive igual, não grave o número duas vezes;
- **gates de ação**: perder lead exige motivo; erro do lint bloqueia aprovar e
  publicar no Blog; mover para Ganho pede valor e plano; o handoff só oferece
  closers. Esses bloqueios são regra de negócio, não enfeite de UI.

## Perguntas que o protótipo deixou abertas

Achados durante as rodadas, que valem decisão de produto antes ou durante a
implementação:

- **Publicidade e Análise de Aquisição respondem à mesma pergunta** com números
  diferentes — candidatas a fundir.
- `pipeline.jsx` tem `AgendaView`, `AnaliseView`, `PaceChart`, `GoalReversePlan`,
  `ForecastView` e `FunnelAnalytics` **inalcançáveis** (`VIEWS` só tem kanban e
  list).
- `outbound` e `funcionarios` estão com `hidden: true` no `NAV` — chega-se a elas
  só por link.
- A busca ⌘K só acha lead, mas o menu tem 35 itens (o protótipo passou a incluir
  telas e ações).

## Assets

Nenhuma imagem própria. O protótipo não usa nenhum arquivo de imagem: tudo é
tipografia, cor e layout. Onde houver necessidade de imagem no produto (criativos
do Canvas, foto de perfil), a tela usa placeholder — as imagens reais vêm do
sistema.
