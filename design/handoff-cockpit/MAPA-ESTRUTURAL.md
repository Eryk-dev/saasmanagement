# Mapa estrutural do protótipo

Índice de navegação do `Cockpit - Prototipo.dc.html` (16.733 linhas) e as receitas
de estilo já medidas de cada peça que se repete. Escrito em 14/09/2026 para que
portar uma tela não custe reler o arquivo inteiro.

Este arquivo é **referência**, não código de produção: nada daqui entra no bundle.
Ao implementar, use os componentes do repo (`components/viz.jsx`, `atoms.jsx`,
`components/story.jsx`) e as variáveis de `tokens.css`, nunca os hexadecimais
abaixo.

## Como o arquivo é organizado

| Linhas | Conteúdo |
|---|---|
| 9-15 | `<helmet>`: CSS de tokens do DS e `_ds_bundle.js` |
| 16-36 | `<style>`: keyframes `fluxo`, `crista`, `subir` e as classes `.fluxo .crista .ponto-vivo .col-sobe .fade-num` |
| 37-7284 | o `<x-dc>`: moldura, as 24 pranchas, o painel genérico e os overlays |
| 7285-16731 | o `<script type="text/x-dc">`: estado, seeds e os `view()` que devolvem as amarrações de cada tela |

### Sintaxe do runtime (`support.js`)

| No protótipo | Em React |
|---|---|
| `<sc-for list="{{ lista }}" as="i">` | `lista.map((i) => …)` |
| `<sc-if value="{{ cond }}">` | `{cond && …}` (não existe `sc-else`: cada ramo é um `sc-if` com booleano invertido) |
| `{{ expr }}` | interpolação, inclusive **dentro de `style="…"`**, que é como toda cor e largura dinâmica funciona |
| `hint-placeholder-count` / `hint-placeholder-val` | só para o editor de design; descartar |
| `<x-import component-from-global-scope="…">` | os 4 componentes do DS (`Input`, `Textarea`, `Chip`, `Button`), usados **só** no Inbox |

Não há rota: cada tela é um booleano `telaXxx: s.tela === "<id>"`.

## Onde fica cada tela

Na coluna "view" está a linha do `view()` que monta as amarrações daquela tela no
bloco de script.

| Tela (id) | Prancha (HTML) | view (JS) | Prancha do Leo |
|---|---|---|---|
| `overview` | 114 | 16607 | 1a/1b |
| `today` | 314 | 10563 | 6a/6b |
| `pipeline` | 533 | 10322 | 4a/4b e 5a |
| `customers` | 726 | 10095 | 3a-3d |
| `proposals` | 917 | 16518 | 7a |
| `whatsapp` | 1032 | 9599 | 9b |
| `training` | 1272 | 9823 | 2a-2e |
| `agenda` | 1468 | 10992 | 8a-8d |
| `disparos` | 1661 | 15910 | 11c |
| `blog` | 2017 | 11249 | 11d |
| `creative` | 2431 | 11551 | 11e |
| `forms` | 2528 | 11699 | 10b |
| `metrics` | 2913 | 11934 | 10a |
| `social` | 3162 | 12140 | 11a/11b |
| `intform` | 3543 | 12350 | 7d |
| `consultas` | 3746 | 12627 | 9c/9d |
| `contracts` | 4030 | 12782 | 7c |
| `offers` | 4326 | 13086 | 7b |
| `tasks` | 4514 | 13421 | 13a |
| `remuneracao` | 4905 | 13721 | 13c |
| `settings` | 5147 | 13825 | 13f |
| `expenses` | 5526 | 14329 | 13d |
| `mindmaps` | 6059 | 15014 | 13e |
| `metas` | 6270 | 15432 | 13b |
| **painel genérico** | 6543 | `painelDaTela` 15527 · `historiaDaTela` 11113 | rodada 5 |
| "em breve" | 6655 | 16627 | |

Cada prancha vai até a linha anterior à próxima.

### O painel genérico

`telaPainel` serve as 9 telas que nunca ganharam prancha própria: `landingpages`,
`analise`, `calls`, `integrations`, `desempenho`, `eloapp`, `aquisicao`,
`outbound` e `funcionarios`. Ele é a **implementação de referência** da ordem de
leitura do handoff:

> aviso com prazo → bloco que conta a história → faixa de KPIs (só se não houver
> história) → tabela → ⓘ

e traz a lógica que **resgata para o ⓘ** todo KPI que a história, o subtítulo e a
tabela não mostram (linhas 16449-16480). O casamento exige número **e** palavra do
rótulo a menos de 60 caracteres um do outro, com token exato: sem isso "23" casa
dentro de "23%" e a métrica some em silêncio.

Duas coisas que **não** se portam: os ramos de `historiaDaTela` para `proposals`,
`agenda`, `whatsapp`, `training` e `disparos` estão inalcançáveis (essas telas
ganharam prancha própria depois), e `painelDaTela` trata `funcionarios` e
`desempenho` como a mesma tela.

## Overlays

| Overlay | Linha | O que é |
|---|---|---|
| `blgTemSel` | 2147 | ficha do post (drawer) |
| `blgEhModalPauta` | 2377 | nova pauta |
| `blgEhModalDigest` | 2413 | "o que a IA lê" |
| `pbPickAberto` | 3142 | seletor de colunas do gerenciador |
| `rsWizardAberto` | 3476 | criar post em 3 passos |
| `fiFichaAberta` | 3625 | respostas do formulário de integração |
| `fiModalAberto` | 3701 | solicitar formulário |
| `csFichaAberta` | 3891 | ficha da consulta |
| `csEditorAberto` | 3997 | editor do Manual |
| `ctMenuAberto` | 4139 | o `⋯` dos contratos, **como modal centrado** |
| `ctDrawerAberto` | 4156 | usar/editar modelo (3 passos) |
| `ctVerAberto` | 4291 | contrato gerado, leitura |
| `lkModalAberto` | 4485 | gerar link de pagamento |
| `tkFichaAberta` | 4818 | ficha da tarefa |
| `cfgTelasAberto` | 5401 | telas por pessoa |
| `mmEsbocoAberto` | 6247 | esboço do mapa mental |
| `leadAberto` | 6667 | card do lead (drawer de 520px) |
| `trSessaoAberta` | 6726 | sessão de estudo |
| `trProvaAberta` | 6777 | prova de checkpoint |
| `cliFichaAberta` | 6820 | ficha do cliente |
| `pipGateAberto` | 6900 | gate de perda/ganho/handoff |
| `roteiroAberto` | 6961 | painel de roteiro |
| `agEditorAberto` | 7127 | editor da agenda |
| `buscaAberta` | 7222 | busca ⌘K |
| `notificacoesAbertas` | 7258 | sino |

Todos fecham pelo mesmo caminho: `overlaysFechados()` entra em todo
`salvar({tela: …})`, então navegação e Escape limpam a pilha inteira. No repo isso
já acontece por construção, porque trocar de tela desmonta a tela e os overlays
que vivem dentro dela.

## Tokens: do protótipo para o repo

O protótipo escreve os valores; o repo tem as variáveis. **Use sempre a coluna da
direita.**

| Uso | Protótipo | `tokens.css` |
|---|---|---|
| Texto principal / navy | `#0c1d2b` | `--fg-1` |
| Texto secundário | `#3d4f5c` | `--fg-2` |
| Texto de apoio | `#5a6b77` | `--fg-3` |
| Texto fraco (só kicker e o glifo ⓘ) | `#8b99a4` | `--fg-4` |
| Acento (teal) | `#0f766e` | `--accent` |
| Acento suave / linha | `#e9f5f3` · `rgba(15,118,110,.38)` | `--accent-soft` · `--accent-line` |
| Linha | `#e4e8eb` | `--line-1` |
| Linha de controle | `#cbd4da` | `--line-2` |
| Linha fraca (divisória de tabela) | `#eef1f3` · `#f4f6f7` | `--bg-2` · `--line-faint` |
| Papel | `#fff` · `#f7f8fa` · `#fbfcfd` | `--bg-1` · `--bg-0` · `--bg-inset` |
| Positivo | `#177a4c` · `#e9f6ef` | `--pos` · `--pos-soft` |
| Atenção | `#a16207` (ou `#8a5a00`) · `#fdf5e6` | `--warn` · `--warn-soft` |
| Negativo | `#b42318` (ou `#b02a2a`) · `#fdeeee` | `--neg` · `--neg-soft` |
| Botão primário | `#0c1d2b` / `#fff` | `--btn-bg` / `--btn-fg` |
| Sombra de card | `0 1px 2px 0 rgba(16,24,40,.03)` | `--shadow-card` |
| Sombra de popover | `0 12px 30px rgba(2,16,28,.18)` | `--shadow-pop` |

Escala de espaçamento: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 22 · 28.
Raios: 6 campo · 8 botão/chip quadrado · 10 interno · 12 card · 999 pílula
(`--r-2`, `--r-3`, `--r-4`).
Tipografia: 11px kicker (caixa alta, `.06em`, 600) · 12-12,5px apoio ·
13-13,5px corpo de tabela · 14px campo · 15,5-17px título de card · 26px título
de tela. Número sempre com `tabular-nums`.
Contraste: piso de 4,5:1 (3:1 só em título grande).

## As peças que se repetem

### Aviso com prazo (`AvisoTopo`)

```
seção:  card + padding 13px 18px, flex, gap 12, wrap
ponto:  8px, redondo, na cor do aviso
texto:  flex 1, min-width 220, 13,5px/600, NA COR DO AVISO, text-wrap pretty
botão:  32px de altura, 0 14px, borda --line-1, fundo --bg-1, 12,5px/600, NEUTRO
```

Cor é `--neg` (urgente) ou `--warn`. O ponto e o texto tomam a cor; o botão fica
neutro. Variante de duas linhas (Financeiro, Consultas) ganha uma nota 12,5px
`--fg-3` embaixo do título. Na Visão geral o ponto vira uma barra vertical de 4px
`align-self: stretch` e o botão é escuro.

**Regra:** nenhuma tela abre com fileira de número solto. Abre com o aviso que tem
prazo e o botão da ação ao lado.

### Corrente do dinheiro (`CorrenteDoDinheiro`)

```
seção:  card + padding 20px 22px
        display grid; grid-template-columns repeat(auto-fit, minmax(150px,1fr))
        gap 14px 4px; align-items start
passo:  flex, gap 4, min-width 0
  rótulo 12,5px --fg-3
  valor  24px/700, -0.02em, tabular, margin-top 2
  nota   11,5px --fg-4, margin-top 3, text-wrap pretty
seta:   coluna, padding 0 8px, flex-shrink 0
  taxa   11,5px/600 --accent, tabular
  glifo  "→" 16px --line-2, line-height 1
  legenda 10,5px --fg-4, nowrap
```

É **grid, não flex**: no `flex-wrap` o último passo caía sozinho numa segunda
linha, sem seta (crítica 1 da rodada 5). A seta aparece quando `índice > 0`. O
último passo costuma vir tingido de `--pos`.

Variantes de tamanho: Publicidade usa kicker de 11px e valor de 22px; Propostas
usa rótulo 12,5px, valor 26px e seta com `padding 0 18px`; Metas rola de lado
(`overflow-x:auto`, `min-width:max-content`) com passo de 88px e `title` em cada
um.

### Funil horizontal (`FunilHorizontal`)

```
seção:  card + padding 18px 22px, coluna, gap 10
linha:  flex, align center, gap 12, wrap
  rótulo    flex 0 0 128px; 12,5px --fg-2
  trilho    flex 1 1 160px; min-width 120; altura 22; raio 6; fundo --bg-0
  preenche  altura 22; largura {pct}; cor do degrau
  valor     flex 0 0 84px; direita; 14,5px/700; tabular
  passagem  flex 0 0 62px; direita; 12px/600; tabular
  nota      flex 0 0 90px; 11,5px --fg-4
```

Contas: largura `= max(4, round(valor/maior*100))%`; cor pela rampa
`#cbd4da → #a9d5cf → #5aa79f → #2f8f86 → #0f766e` (índice capado em 4);
`passagem` é `—` no primeiro degrau, senão `round(v/anterior*100)%`; **a passagem
fica `--neg` abaixo de 45%**, senão `--fg-4`.

### Barra de composição (`BarraComposicao`)

```
seção:   card + padding 18px 22px
título:  13px/650
barra:   flex; altura 26; raio 7; overflow hidden; margin-top 12; fundo --bg-0
fatia:   altura 26; largura {pct}; title="{rótulo} · {valor} · {pct}"
legenda: flex; gap 18; wrap; margin-top 12
  quadrado 9px, raio 3   ·   rótulo 12,5px --fg-2
  valor 13px/700 tabular ·   pct 11px --fg-4 tabular
```

Largura `= max(1, round(parte/total*100))%`.

**Duas réguas, não uma:** as fatias somam o total **e** nenhum rótulo de fatia
repete o rótulo de um KPI que mede outra grandeza. Foi por checar só a aritmética
que Redes sociais passou mostrando "seguidores 50.076" na barra (que media
alcance) e "seguidores 17.441" no ⓘ a poucos centímetros.

Variante fina (Links de pagamento): altura 12, raio 999, pontos de legenda de 6px,
texto 11,5px `--fg-3`.

### O ⓘ (`Info`)

Três formatos, todos sobre o `title` nativo:

1. **Nota de rodapé da tela**: flex, gap 8, `max-width 760`; glifo 13px `--fg-4`;
   texto **12,5px `--fg-3`**, `line-height 1.6`. É onde caem os KPIs resgatados.
2. **Sufixo de rótulo**: `<span title="…" style="cursor:help; color:--fg-4">ⓘ</span>`
   colado num subtítulo de 12,5px.
3. **Link de ajuda à direita**: a frase inteira é o alvo ("detalhes do número ⓘ",
   "mais números ⓘ", "como o status funciona ⓘ"), 11-12,5px, `cursor:help`.
   Serve também como sufixo de cabeçalho de tabela.

**O texto do ⓘ nunca sai em `--fg-4`** (2,75:1 sobre papel). Só o glifo. O texto é
`--fg-3` (5,19:1), porque ele virou o único lugar de métricas que antes eram KPI
de 26px.

### Menu `⋯` da linha (`MoreMenu`)

Duas variantes, escolhidas por onde a linha vive:

- **Popover** (Inbox): gatilho 32px com `title` listando o que tem dentro; painel
  `absolute; top 38; right 0; width 250; raio 10; --shadow-pop; padding 4`; itens
  com rótulo 12,5px/600 e nota 11px `--fg-4`.
- **Modal centrado** (Contratos): quando a linha vive dentro de um scroller, o
  popover é recortado. Fundo `fixed inset 0` escuro, painel `min(340px,100%)`,
  título 13,5px/700, sub "mais ações deste modelo", itens 13px com a destrutiva em
  `--neg`, rodapé com "fechar".

**Regra:** uma ação principal por linha, o resto no `⋯`, com o `title` do botão
dizendo o que tem dentro.

### Segmentado, pílulas de filtro e `mais ▾`

```
segmentado: trilho flex; gap 2; padding 3; fundo --bg-2; raio 9
  item 30px (26 em barra densa); 0 14px; raio 7; 12,5px
  ativo   fundo --bg-1; --fg-1; 600; --shadow-segment
  inativo transparente; --fg-3; 500

pílula de filtro: 30px; 0 12px; raio 999; 12,5px/600
  ativa   --accent-soft / --accent / --accent-line
  inativa --bg-1 / --fg-3 / --line-1
  o rótulo carrega a contagem: "Ativos · 12"

mais ▾: 30px; 0 10px; raio 999; 11,5px/600; --fg-3
  os filtros escondidos ficam no `title`
```

Segmentado é para trocar de visão; pílula é para filtrar dado. Filtro repetido
vira segmentado + `mais ▾`, nunca mais de 4 controles na barra.

### Cabeçalhos e cards

```
card:        --bg-1; borda --line-1; raio --r-4; --shadow-card
             padding 18px 20px | 18px 22px | 20px 22px
             (0 + overflow hidden quando embrulha tabela)
h1 da tela:  26px/700; -0.02em     ·  sub 14,5px --fg-3; margin-top 4
título card: 15,5px/700; -0.01em   ·  sub 12,5px --fg-3; margin-top 2
kicker:      11px/600; .06em; caixa alta; --fg-4
KPI:         valor 26px/700 tabular · rótulo 12px --fg-3 · nota 12px --fg-4
faixa KPI:   grid repeat(auto-fit, minmax(150px,1fr)); gap 20
página:      padding 28px 28px 56px; coluna; gap 14-16
duas colunas: principal flex 1 1 0 (min-width 0) + aside flex 0 1 280-320px
```

### Tabelas

Duas implementações; escolha pela quantidade de colunas.

**Tabela flex** (painel genérico, Propostas, Clientes):
```
cabeçalho: flex; gap 12-14; nowrap; padding 9-11px 18-20px; fundo --bg-inset
           célula 10,5-11px/600; .06em; caixa alta; --fg-4; flex {g} 1 0; min-width 0
linha:     flex; gap 14; align start; padding 13px 18px; border-top --bg-2
  principal 13,5px/600-700; tabular; line-height 1.35; text-wrap pretty
  sub       11,5px --fg-4; margin-top 2
```
Cabeçalho ordenável é botão e ganha " ↑" / " ↓" no rótulo.

**Tabela em grid** (Links, Minhas atividades, A/B dos Formulários, Redes): um
`grid-template-columns` repetido no cabeçalho e nas linhas. No repo isso é
constante exportada com orçamento conferido no smoke (`QUEUE_GRID`, `TABLE_GRID`,
`LIST_GRID`…), teto de 716px.

Altura de linha 44-48px. Faixa do cabeçalho `--bg-inset`, separador do cabeçalho
`--line-1`, separador de linha `--bg-2`. Número à direita com `tabular-nums`;
identificador, hora e telefone em mono 10,5-12px `--fg-3`. Linha apagada (churn,
concluída) com `opacity .55`. **Toda tabela tem estado vazio escrito**, 12,5-13,5px
`--fg-4`, centrado, padding 22-28px.

## O que o protótipo deixou anotado

- **Derivar, nunca gravar duas vezes:** `recebido = contratado − cobranças em
  aberto`; `pace = receita × 2,625`; `custo por etapa = investido / etapa`. Todo
  percentual de aviso sai do mesmo número que a tela desenha. Várias rodadas de
  crítica foram gastas tirando literal escrito à mão que brigava com a tela.
- **Os gates são regra de negócio:** perder lead exige motivo; erro do pente fino
  bloqueia aprovar e publicar no Blog; mover para Ganho pede valor e plano; o
  handoff só oferece closers; conflito de agenda não deixa salvar por cima.
- **A mesma entidade não é renderizada por duas fontes.** Onde já existe dado, a
  tela lê de lá, nunca de literal.
