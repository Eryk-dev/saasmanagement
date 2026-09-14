# Protótipo do cockpit — placar das rodadas

Barra: a tela só fecha quando alguém que usa o cockpit todo dia, vendo os dois
lado a lado, não achar nada que ele faz hoje e sumiu aqui. Cada rodada é
build + crítica cega contra o `screens/*.jsx` do repo.

Arquivo vivo: `Cockpit - Prototipo.dc.html`

| Tela | Rodada | Estado | Maior lacuna aberta |
|---|---|---|---|
| Agenda | 1 — fechada (4 críticas) | grade semana/mês/equipe, criar/editar/excluir, conflito, recorrência, filtro de pessoa, buraco livre | grade fica abaixo da dobra: muito cabeçalho antes do calendário |
| Minhas atividades | 2 — fechada (1 crítica) | 8 grupos de prioridade, 2 tarefas de confirmação, níveis S/A/B/C, roteiro com rodapé fixo, trilho, social selling, tarefas | roteiro não tem "ver o resumo inteiro" nem atribuição/checklist do lead |
| Pipeline | 3 — fechada (1 crítica) | arrastar entre etapas com gate, fase do processo, ordenação global, filtro de pessoa, seleção múltipla, descartados, lista em seções | sem coluna expansível quando a etapa passa de ~10 cards |
| Clientes | 4 — fechada (1 crítica) | abas Base/Indicações/Assinaturas, coluna Dinheiro, régua de marcos, próximas ações com baixa, ficha, churn, conta grande | ficha não edita plano/valor inline como no repo |
| Propostas | — | funil + templates + geradas | ligar o botão "cobrar" ao histórico do lead |
| Treinamentos | 6 — fechada (1 crítica) | baralhos com domínio, fila de repetição espaçada, sessão com os 4 graus, modo foco, prova de checkpoint, Equipe e Editar | falta editar card a card (hoje só adiciona) e as referências não abrem |
| Inbox WhatsApp | 7 — fechada (1 crítica) | lista com filtros, thread real com envio, respostas rápidas, janela de 24 h, saúde do número, card do cliente | falta o "mais ▾" (encerradas · pra humano · sem lead) filtrar de verdade |
| Metas | 8 — entregue | régua de receita e de contratos com pace, cadeia como funil horizontal, metas por vaga com o que a cadeia exige, meta por pessoa (nível do plano + ajuste), agenda de metas com regra de crescimento | as 6 taxas do funil são fonte própria da tela (o resto do protótipo não tem contato/agendamento medidos) |
| Mapas mentais | 9 — entregue | editor de verdade: posição derivada da árvore, 5 layouts, teclado (Tab/Enter/setas/espaço/F2/Delete/⌘Z), arrastar reparenta, nota/ícone/cor/forma/limite, conexões com rótulo, esboço que lê e reescreve o mapa, busca, foco, gaveta de mapas | sem imagem no nó nem colar de fora (o protótipo não tem upload) |
| Financeiro | 10 — entregue | 6 abas do repo: Resumo (avisos + foto do mês + fluxo de caixa + DRE por setor), Conciliação (fila única de entradas e saídas, sugestão, regras aprendidas), A pagar, Folha, Pagamentos (espelho MP) e Custos | sem importar relatório do MP de verdade (o sync só avisa) |
| Configurações | 11 — entregue | 6 abas: Funil & estágios (etapas editáveis com migração dos leads, motivos de perda, conversão automática), Próximos passos, Scripts, Equipe, Campos e Integrações | sem telas por papel de verdade (a coluna Telas grava, o menu não filtra ainda) |
| Remuneração | 12 — entregue | regras da casa, as 3 trilhas com tabela editável por nível, simulador das duas pernas (degrau, cliff em 80%, escada aberta acima de 140%), bônus de time com as duas condições do mês e o pagamento de indicação por quem colheu | só a tela de gestão: não gera a folha (isso é o Financeiro → Folha) |
| Tarefas | 13 — entregue | quadro com arrastar entre colunas, filtros/ordenar/agrupar/opções do repo, 4 visões (quadro, lista, calendário, cronograma) e a ficha com subtarefas e comentários | sem multi-responsável, anexos e capa do card |
| Links de pagamento | 14 — entregue | faixa do dinheiro com barra pago/aberto/recusado, abas Devendo/Pagos/Recusados/Todos, tabela por cliente que expande nos links, cobrar/copiar, marcar pago e desfazer, e o modal de gerar link | sem Mercado Pago de verdade (o link é uma URL de exemplo) |
| Contratos | 15 — entregue | modelos em linhas com uma ação principal (usar →) e o resto no ⋯, histórico do que já saiu preso ao cliente, e o drawer de três passos (cliente · quadro resumo · gerar) com o contrato se atualizando ao lado | a impressão chama o print do navegador, sem o CSS jurídico A4 do repo |
| Consultas | 16 — entregue | agenda da semana clicável, aviso das jornadas sem próxima marcada, jornadas por família com as bolinhas do pacote, ficha da consulta com recap/Meet/resumo e a aba Entregáveis com o editor do Manual | sem Meet e IA de verdade (as ações simulam o retorno) |
| Formulário de Integração | 17 — entregue | faixa com a espera mais longa, abas + busca, tabela com "aguardando há N dias" e a ação de cobrar, ficha com as respostas por seção e o termo assinado, e o modal de solicitar (cliente ou lead → link) | o link é de exemplo; o formulário público não existe aqui |
| Redes sociais | 18 — entregue | abas Painel/Comentários com badge, criativos de hoje, 4 tiles + "mais números ⓘ", crescimento com bruto, alcance seguidores × não-seguidores + por formato, interações por tipo, audiência (3 públicos), radar (concorrentes, marcaram, hashtags), publicações e stories, fila de comentários e o assistente de criar post | sem Meta de verdade (o post publicado nasce com métricas zeradas) |
| Publicidade | 19 — entregue | corrente do dinheiro, regras do gerenciador (aplicar com confirmação), regras de veiculação com histórico, custo por etapa, origem dos leads, por dor e o gerenciador com 3 níveis, toggle, colunas modeláveis e totais | sem Meta de verdade (sincronizar e criar anúncio só devolvem aviso) |
| Formulários | 20 — entregue | lista com o funil do form, teste A/B de headline por dor com campeã, envios recentes, editor (perguntas, tipos, branching, saídas, mapeamento → lead) com preview e a tela de respostas | o preview não roda o form de verdade (é a primeira tela, não o fluxo) |
| Blog | 22 — entregue | automação do motor (4 chaves, cadência, dias, mínimos, CTA) + estado do motor, filtros por estado, ficha do post com pente fino, campos de SEO, texto, FAQ, "de onde veio", histórico e IA | o preview é o texto renderizado aqui, não a página do site |
| Disparos | 11c — entregue | 3 passos (público por etapa, mensagem com tokens e prévia, conferência com custo e limite), campanhas salvas, Sequências (gatilho, passos por canal com dias, saídas, métricas, fila de WhatsApp) e Templates | — |
| Canvas | 21 — entregue | formato (story/feed/carrossel), 18 templates do repo, arte com tema claro/escuro por slide, textos e tamanho de fonte por elemento, elemento novo com slide de destino, PNG por slide | o PNG não renderiza de verdade (o render roda no servidor) |
| 11 telas restantes | 5 | aviso com prazo no topo + o bloco que conta a história (corrente do dinheiro, funil, barra de composição) + tabela + ó | cada uma ainda precisa da estrutura própria da prancha (abas, drawer, ações de linha) |

## Rodada 1 — Agenda (fechada)

**Entregue:** grade de 7 dias × 07–21h com calls, integrações, follow-ups,
consultas, compromissos e bloqueios; clique em horário vazio cria; clique em
item abre editar (compromisso/bloqueio) ou o card do lead; sobreposição em
faixas lado a lado; faixa da cor do responsável; ✓ de confirmação do lead;
lavada = já aconteceu; vermelha = furou. Visões Mês e Equipe (uma coluna por
pessoa, com o botão do buraco livre). Modal com tipo, título/motivo, pessoas
(multi), data, dia inteiro, início de 15 em 15 min, duração de 15 min a 6 h,
recorrência (não repete · toda X · seg–sex · todos os dias · dias escolhidos),
conflito checado por pessoa antes de salvar e excluir com confirmação de
recorrente.

**Crítica 1 → reprovada em 5 pontos, todos corrigidos:**
1. tooltip repetia o tipo e o título ("call · call · Juliana") — rótulo limpo
   e passo do lead no tooltip;
2. `agendaResumo` calculado e nunca mostrado — entrou na barra de controles;
3. mês afogado pelos bloqueios recorrentes de almoço — chips passaram a
   priorizar call → integração → consulta → compromisso → follow-up → bloqueio;
4. na visão Equipe o chip "livre das…" era cortado e a linha estourava —
   cabeçalho virou duas linhas;
5. legenda sem o item da faixa de responsável.

**Crítica 2 → reprovada em 2 pontos, corrigidos:** aviso dizia "1 leads" e
contava só o furo (era 4 atrasados); "Agenda de" quebrava separado dos chips.

**Crítica 3 → reprovada por defeito de correção, corrigido:** cabeçalho da
grade e corpo eram dois scrollers separados com células de larguras diferentes
(82px contra 104px na semana), então os itens apareciam embaixo do dia errado —
o bloqueio de sábado caía sob domingo e a 7ª coluna ficava fora da vista.
Agora cabeçalho e corpo vivem num único `overflow-x:auto` com a mesma largura
de coluna (104px na semana, 150px na equipe): medido no DOM, delta 0 em repouso
e depois de rolar. Mesmo ajuste na visão Equipe.

**Crítica 4 → reprovada por texto cortado, corrigido:** a altura do cartão vem
da duração, então cartão de 30 min (21px) não cabia hora + título e mostrava
7px de uma linha de 14px; cartão de 1h cortava a 2ª/3ª linha do título das
consultas. Agora o cartão tem orçamento de linhas: abaixo de 34px vira uma
linha só ("15:00 · Bruno Teixeira"), de 34px a 47px mostra hora + título em
uma linha com reticências, e de 48px pra cima entra a linha de participantes.
O detalhe inteiro (empresa, valor, etapa, próximo passo, quem) segue no
tooltip. Medido no DOM: 20 cartões na semana e 4 na equipe, zero cortes e zero
estouros.

**Falso alarme:** os `select` de hora/duração pareciam mostrar 07:00 / 15 min
nas capturas — o capturador de tela perde estado de `select`. No DOM estão
corretos (09:00 e 1h).

## Rodada 2 — Minhas atividades (fechada)

**Entregue:** a fila do dia agrupada pelos 8 grupos de prioridade do
`GROUP_ORDER` (confirmar call · compromisso marcado · leads novos · furou a
call · retomadas · follow-up do closer · nutrição · sem agenda), cada um com
contagem e a nota do porquê da ordem. Call de hoje gera **duas** tarefas de
confirmação como no repo — 2h antes (manda) e 10 min antes (positiva ou liga) —
e a de 2h já vem riscada quando o lead confirmou no lembrete. Pílula de horário
navy com a previsão embaixo ("agora", "em 1h20", "atrasado 2 d"), nível S/A/B/C
no lead, dono, progresso do dia, busca, filtro de pessoa num chip só, bloco
"Agora", trilho "O que vem" (amanhã por hora, próximos dias por data), bloco
"Sem data", tarefas do time e o contador de social selling com +1.

Painel de roteiro (6b): atalhos da chamada com **registrar no-show**, "como se
comportar", objetivo do toque, passos numerados, resumo da última conversa,
ficha do cliente, anotação que entra no histórico, e a barra **Depois da ação**
fixa no rodapé (WhatsApp · agendou call · sem resposta/retomar com as 4 datas ·
Ganhou · Perdeu) mais "a próxima da fila é X · pular para ela".

**Crítica 1 → reprovada em 6 pontos, corrigidos:**
1. abrir o roteiro derrubava a tela (branco) — o seed antigo no localStorage não
   tinha os campos novos do lead; versão do seed subiu e o roteiro passou a
   tolerar lead sem campo;
2. nível do lead saía vazio (mesma causa);
3. dado incoerente: lead nível A com 1 conta e 1.920 anúncios — contas,
   anúncios e faixa de faturamento passaram a derivar do valor (R$ 3.100 → 3
   contas, 12.400 anúncios);
4. a barra "Depois da ação" tinha voltado a ser o fim de uma página que rola —
   virou rodapé fixo com o meio do painel rolando (medido: rodapé visível,
   miolo 259 de 664px);
5. faltavam os atalhos da chamada e o registro de no-show, que no repo são
   bloco próprio da call;
6. os 2 leads sem próximo passo não apareciam em lugar nenhum (dado morto) —
   entrou o bloco "Sem data", e o badge do menu passou a contar os pendentes da
   fila (9) em vez de atrasados + hoje (10).

**Crítica 2 → reprovada por função morta, corrigida:** a linha da fila usava
`minmax(150px,…)`/`minmax(160px,…)` e somava 786px numa coluna de 626px, então
"WhatsApp" e "roteiro" ficavam 139px fora da seção com `overflow:hidden` — as
duas ações primárias da tela não clicavam em nenhuma das 12 linhas, e sem
scroller não havia como alcançá-las. A linha virou responsiva
(`24px 72px minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,0.9fr) auto`) com as
colunas de texto abreviando em reticências, porque rolar de lado para apertar
"roteiro" em cada item é pior que abreviar. Medido: 12 linhas com os botões
dentro dos limites da seção e zero cortes sem reticências.

## Rodada 3 — Pipeline (fechada)

**Entregue:** kanban com **arrastar e soltar** entre etapas e o gate de movimento
do repo — cair em Ganho pede valor e plano, cair em Perdido **exige motivo**
(preço · sem perfil · sem resposta · foi pro concorrente · momento errado), e
Qualificação → Call marcada abre o handoff para escolher o closer. Barra de
controle única com busca, **fase do processo** (Todas/SDR/Closer, que fatia as
colunas visíveis), filtro de pessoa com contagem e **ordenação global**
(próximo toque · último toque · qualidade) valendo para todas as colunas.
Cabeçalho de coluna com "N atrasados · N hoje" e total. Seleção múltipla com
barra de ações em massa (mover para · atribuir · registrar toque). Resumo do
Ganho no mês no fim do board. Coluna de **descartados** escondida por padrão,
com motivo e "voltar ao funil". Lista agrupada com **Atrasados na primeira
seção** (no repo é a 5ª), depois Hoje, Amanhã, Próximos dias e Sem próximo
passo.

**Verificado no DOM, ponta a ponta:** fechar venda moveu Fernanda Dias de Novo
lead (3→2) para o Ganho (3→4), somou R$ 2.100 no mês e baixou os abertos de 13
para 12; o handoff só oferece Lucas e Tiago (os closers); perder sem motivo é
bloqueado com aviso; perdido com motivo vira descartado (3) e "voltar ao funil"
devolve o lead (abertos 12, descartados 2).

**Crítica 1 → reprovada em 3 pontos, corrigidos:** "1 atrasados" no cabeçalho
da coluna; coluna sempre tracejada (o tracejado agora só aparece enquanto se
arrasta, com a sombra de card no repouso); e o pior — **"marcar perdido" no
card do lead e "Perdeu" no roteiro apagavam o lead sem pedir motivo**, enquanto
no repo a perda exige motivo e o lead vira descartado. Os dois passaram a abrir
o mesmo gate.

## Rodada 4 — Clientes (fechada)

**Entregue:** as três abas do repo. **Base** com KPIs (ativos, MRR cheio e MRR
sem a conta grande, em integração, churn), filtro Ativos/Todos/Churn, busca,
ordenação por clique no cabeçalho (cliente · plano e MRR · dinheiro · marcos ·
situação) e a coluna **Dinheiro** com barra recebido/contratado. Ao lado, a fila
**Próximas ações** do repo: cobrança a vencer e o próximo marco de cada
cliente, com "dar baixa" e "concluir" funcionando, 6 fechadas + "ver as N".
Cliente em churn fica esmaecido e fora do MRR; conta grande leva ★ e sai das
médias. **Indicações** com link público, comissão paga e a origem de cada
indicação. **Assinaturas** com plano, ciclo, valor, status e próxima cobrança.
Ficha do cliente em drawer: régua de 6 marcos clicável, cobranças com "marcar
paga", quem o cliente indicou, e marcar churn / reativar.

**Crítica 1 → reprovada em 5 pontos, corrigidos:**
1. **os três leads "Ganho" do seed apareciam em duplicidade** com os clientes da
   base (Melo, Braga, RN) — 10 ativos e R$ 54.500 de MRR contra os 7 e
   R$ 43.550 reais; agora só ganho que ainda não é cliente entra na base;
2. dado incoerente: contratado R$ 19.800 com recebido R$ 19.800 e uma cobrança
   de R$ 6.600 aberta — o recebido passou a ser derivado (contratado menos as
   cobranças abertas), então dar baixa move o dinheiro de verdade (testado:
   a receber R$ 6.600 → R$ 0, cobrança "paga");
3. "de R$ 19.8…" cortava na coluna Dinheiro — o contratado desceu para a linha
   do percentual ("100% de R$ 19.800");
4. valor da assinatura cortava com "/ anual" redundante (o ciclo já está na
   linha de baixo);
5. a fila de ações quebrava para baixo em tela estreita e o que estava vencido
   ficava invisível — entrou o aviso no topo ("2 cobranças vencidas · 1 vence
   hoje · R$ 10.000 a receber") com a baixa da mais antiga ao lado.

**Crítica 2 → reprovada por classe de bug, corrigida:** overlay sobrevivia à
navegação — abrir a ficha do cliente (ou o roteiro, o editor da agenda, o gate
do pipeline) e clicar no menu trocava a tela por baixo, mas o painel antigo
ficava montado com backdrop `fixed`, e a tela de destino não recebia nenhum
clique. Em vez de remendar caso a caso, entrou um `overlaysFechados()` único que
navegação, Escape e abrir-lead compartilham — overlay novo entra nessa lista e
não vaza. Medido nos dois casos do relato: h1 "Agenda"/"Treinamentos" com o
painel fora do DOM e os cliques voltando a cair dentro do `main`.

## Rodada 5 — as 25 telas restantes, em lote (aberta)

O painel genérico que servia todas elas era exatamente o que as regras 1 e 2 do
handoff proibiam: uma fileira de números soltos, sem aviso no topo. Agora cada
uma das 25 tem:

- **o aviso com prazo no topo, com a ação ao lado** — "9 contas paradas há mais
  de 7 dias", "7 conversas esperando resposta · a mais antiga há 5 h",
  "3 jornadas sem próxima marcada", "R$ 12.400 vencidos a receber", "33 pagaram
  e não ativaram o app", "CPL em R$ 86 contra a meta de R$ 80", e o botão leva
  para a tela que resolve;
- **a fileira de números soltos trocada por um bloco que conta a história**, no
  formato que cada tela pede: **corrente do dinheiro** (Publicidade e Aquisição:
  investido → leads → clientes → receita com CPL, CAC e ROAS nas setas; Metas:
  verba → leads → calls → contratos; Disparos; Inbox; Formulário de integração;
  Pace), **funil** com a passagem de cada degrau em vermelho quando cai abaixo
  de 45% (Landing pages, Formulários, Análise do App) e **barra de composição**
  (Outbound, Treinamentos, Links de pagamento, Redes, Blog, Pitches, Integração,
  Equipe, Tarefas, Remuneração e o DRE do Financeiro).

A faixa de KPIs só aparece onde não há história — as duas nunca convivem, para
não repetir o mesmo número em dois lugares.

**Crítica 1 → reprovada em 1 ponto, corrigido:** a corrente quebrava em
`flex-wrap` e o último passo ("receita R$ 34.200") caía solto numa segunda linha
sem seta; virou grid `auto-fit` e agora quebra em blocos alinhados.

**O que ainda falta nessas 25:** a estrutura própria de cada prancha — abas
(Redes: painel/comentários; Consultas: agenda/entregáveis; Financeiro: as 6
abas), drawers (editor do Manual, thread do WhatsApp, drawer da tarefa) e ação
principal por linha. São as próximas rodadas, uma tela por vez.

**Crítica 2 → reprovada por perda de função, corrigida:** trocar a faixa pela
história estava **apagando** os KPIs que a história não reproduzia — sumiram
"conclusão média 68%" e "12 simulações" (Treinamentos), "janela aberta 23" e
"saúde do número · limite 250/dia" (Inbox), "manuais a entregar 2" e "1 faltou ·
2 desmarcadas" (Consultas), "limite do time: 6" (Tarefas), "conversão 72%"
(Links de pagamento). Redesign que perde função é downgrade, e era sistêmico nas
20 telas com história.

A correção não foi devolver a faixa (isso desfaz a regra 1), e sim **garantir
que nada evapore em silêncio**: agora a tela compara cada KPI com tudo que ela
de fato mostra (subtítulo, aviso, história, tabela) e manda o que sobrou para o
ⓘ — em dois passos, o KPI inteiro quando o número não aparece, e só a nota
explicativa quando o número aparece mas a explicação não. O casamento exige
número **e** palavra do rótulo a menos de 60 caracteres um do outro, com token
exato, senão "23" casava dentro de "23%" e a métrica continuava sumindo (foi o
que aconteceu nas duas primeiras tentativas). KPI novo agora nunca desaparece
sem aviso. Verificado nas cinco telas do relato: todas recuperaram os números.
Aproveitei para trocar a barra dos Links de pagamento de valor para contagem de
links, que era o que os KPIs diziam.

**Crítica 3 → reprovada em 2 pontos, corrigidos:**
1. **a história contradizia os números da própria tela** — literais escritos à
   mão em vez de amarrados ao que a tela mostra. No Outbound o subtítulo dizia
   "21 viraram lead" e a barra logo abaixo dizia 9; em Treinamentos a barra
   tinha "13 pessoas · 7 concluíram" enquanto a tabela somava 13 conclusões em
   19 inscrições (os 68% do ⓘ). Agora a fatia sai da mesma grandeza que a tela
   exibe: radar 38+24+45+**21** = 128, trilhas 13+3+3 = **19** com concluíram =
   68%, jornadas ativas 6+3 = 9 (jornada concluída saiu de "ativas"), Inbox sem
   o 18 colidir com o "23" da janela aberta, e o formulário com "prontos para a
   call 1", que é o único "completo" da tabela.
2. **os números resgatados caíram no token mais fraco do DS**: o ⓘ estava em
   `--ink-faint` (#8B99A4) sobre `--paper`, 2,75:1 — abaixo do piso de 4,5:1 —
   e ele agora é o único lugar de métricas que antes eram KPI de 26px. O texto
   passou para `--ink-muted` (#5A6B77), medido em **5,19:1**; só o glifo ⓘ
   continua faint.

**Crítica 4 → reprovada em 1 ponto, corrigido:** a varredura anterior usou o
critério errado. Eu conferi se as fatias **somavam** o total, e por isso Redes
sociais passou: a aritmética estava certa (78.324/128.400 = 61%, igual ao KPI),
o rótulo não — as fatias mediam **alcance por origem** mas estavam rotuladas com
o substantivo do KPI, então a tela mostrava "seguidores 50.076" na barra e
"seguidores 17.441" no ⓘ a poucos centímetros. As fatias passaram a dizer
"alcance de quem já segue" / "alcance de quem não segue".

**Régua que fica valendo para as próximas histórias** (as duas coisas, não só a
primeira): as fatias têm de somar o total **e** nenhum rótulo de fatia pode
repetir o rótulo de um KPI medindo outra grandeza.

**Crítica 5 → reprovada em 1 ponto, corrigido (e mais 2 achados pela régua
nova):** o aviso da Análise de Pace dizia "12% abaixo da meta" como string fixa
enquanto a corrente logo abaixo mostrava pace de R$ 28.744 contra meta de
R$ 128.000 — 78%, não 12%. O gap passou a ser derivado do mesmo cálculo que a
tela renderiza (`pace = receita × 2,625`), no aviso e no KPI gêmeo; medido:
aviso "78% abaixo" com pace R$ 28.744, aritmética conferida. Aplicando a régua
nos outros avisos achei mais dois literais errados: Pitches dizia "20 calls com
objeção em aberto" quando a tabela soma 11+9+3 = **23**, e Tarefas dizia
"4 atrasadas" contra o KPI de 3 — agora diz "4 no quadro · 3 em a fazer e 1 em
fazendo", que é a soma explícita.

**Régua completa, terceiro item:** nenhum percentual ou comparação escrito à mão
em aviso ou nota pode divergir do que a tela calcula. Foi por checar só as
fatias, e não os avisos, que este passou.

**Crítica 6 → reprovada em 1 ponto, corrigido na fonte:** a mesma tarefa tinha
três prazos em duas telas — "venceu há 2 d" no trilho de Minhas atividades,
"venceu 9/set" na tabela de Tarefas e "há 9 dias" no aviso (o 9 tinha sido
copiado da string da data como se fosse contagem de dias, quando hoje é 13/09).
A causa não era o texto: a tela 13a era montada por literais enquanto o trilho
lia `dados.tarefas`. Agora **as duas leem a mesma fonte** — tabela, barra, KPIs
e aviso saem de `dados.tarefas`, com o prazo formatado pela mesma régua e a data
calculada a partir de hoje. Medido: trilho "venceu há 2 d" e tabela "venceu há
2 d · 11/09" (13/09 − 2), aviso "2 atrasadas · a mais antiga há 5 dias" (t6 =
−5) e barra 4+2+1+2 = 9.

**Régua completa, quarto item:** a mesma entidade não pode ser renderizada por
duas fontes — onde já existe dado em `dados.*`, a tela lê de lá, nunca de
literal. (Ainda valendo para os painéis que inventam linhas sobre clientes e
leads que já existem no estado — é o que as próximas rodadas resolvem tela por
tela.)

## Rodada 6 — Treinamentos (fechada)

**O defeito era de domínio, não de layout.** O painel genérico tinha inventado
"trilhas", "módulos" e "prazos" — vocabulário que não existe na tela real. No
repo e na prancha 2a–2e, Treinamentos é **flashcard com repetição espaçada**:
baralhos, fila do dia, sessão de estudo, prova de checkpoint. Tela reconstruída
no domínio certo:

- **Estudar**: bloco "Da vez" com os cards do dia separados em novos /
  aprendendo / a revisar, "Estudar →", "◐ foco" e o sorteio 4fun que não mexe na
  agenda de revisões; "Seus baralhos" com pontuação de domínio, barra, quantos
  caem hoje e escopo (todo o time / sua vaga); "Referências"; e no trilho
  Consistência com mapa de calor, domínio geral e a prova.
- **Sessão**: pergunta, resposta revelada num clique e os quatro graus da
  repetição espaçada — errei (volta hoje), difícil (1 dia), bom (sobe um nível),
  fácil (sobe dois) — com os intervalos 1·2·4·7·15·30. Responder move o card de
  verdade: nível sobe, data de volta muda e as contagens da fila acompanham.
  Modo foco escurece a tela inteira, como na prancha 2b.
- **Prova de checkpoint**: 5 cards já aprendidos, alternativas montadas com as
  respostas de outros cards, nota mínima 70 e resultado aprovado/reprovado.
- **Equipe**: domínio, consistência e última prova por pessoa, com aviso de quem
  está abaixo de 70.
- **Editar**: baralho a baralho, com nível e quando cada card volta; card novo
  entra como novo e cai na fila de hoje.

Os 24 flashcards têm conteúdo real do negócio (ICP, dor que fecha, token do ML,
variação fora do padrão, objeção de preço, quando desistir de um lead).

**Crítica 1 → reprovada em 2 pontos, corrigidos:** o botão ◐ foco existia e não
fazia nada (a prancha 2b tem o modo escuro) — agora escurece overlay, card,
linhas e rodapé; e, ao escurecer, o rótulo de estado ficou em 3,68:1, porque
`ESTADO_CARD` só tinha cores para fundo claro. Cada estado ganhou a variante do
tema escuro e o pior texto da sessão em foco passou a **6,74:1** (medido: 6,74 a
17,98 em todos os textos do card).

## Rodada 7 — Inbox WhatsApp (fechada)

**Entregue** a prancha 9b em três colunas. O aviso vermelho no topo com o que
está esperando resposta e "responder agora" (que salta para a mais antiga), ao
lado do resumo do número — saúde, janela aberta e conversas em 7 dias — com
qualidade, limite, vazão, custo e conversas sem lead no **ⓘ**, como o handoff
decidiu. Lista com busca, os 3 filtros + `mais ▾` (Sem resposta · Todas · Com
lead), faixa colorida na conversa ativa e na que o robô conduz, prévia com "→"
quando a última fala é nossa, tempo de espera em âmbar/vermelho e badge de não
lidas. Thread com separador de dia, bolha da pessoa, nossa e do robô (roxo,
rotulada). Rodapé com respostas rápidas que **escrevem o texto de verdade**
conforme a etapa do lead, campo de resposta, envio e o aviso da janela de 24 h
com as horas que faltam. À direita o card do cliente (nível, etapa, valor, no
funil, anúncios, qualificação, próximo passo) ou, quando o número não tem lead,
o caminho de cadastrar.

**Tudo derivado das conversas**, não de literais: as 5 em espera, a mais antiga,
a janela aberta e o total de 7 dias saem das mensagens. Enviar uma resposta tira
a conversa da fila de espera na hora — medido: 5 esperando → 4, e o Rafael sai
do filtro "Sem resposta".

**Crítica 2 → reprovada em 3 pontos, corrigidos:**
1. os três filtros da lista estavam **cortados** — 52px de caixa para 96px de
   texto, então ninguém lia as contagens ("Sem r…", "Todas…", "Com l…"). A causa
   não era a fonte: o segmentado dividia uma linha de 165px com o chip "mais ▾".
   O chip subiu para a linha da busca e os filtros ganharam a linha inteira;
2. a thread abria no topo e a mensagem mais nova — inclusive a que você acabava
   de enviar — ficava fora da vista, sem retorno visual nenhum. Resolvido com
   `column-reverse` + array invertido, que prende o viewport no fim nativamente
   (medido: a mensagem mais recente é a visível);
3. **o bundle do design system nunca havia sido carregado** — `_ds_bundle.js`
   não estava no `<helmet>` e todos os controles eram recriados à mão, o que é
   exatamente o que causava o defeito 1 (a `SegmentedControl` do DS dimensiona
   pelo conteúdo; o segmentado caseiro esmagava três rótulos em 52px). O bundle
   entrou e os controles do Inbox passaram a ser os componentes reais —
   `SegmentedControl`, `Input`, `Chip`, `Textarea` e `Button` — como a prancha
   aprovada faz. Medido: 18 componentes disponíveis e os botões do segmentado
   com clientWidth == scrollWidth.

**Crítica 3 → reprovada em 1 ponto, corrigido:** a `SegmentedControl` do DS se
dimensiona pelo conteúdo (315px) e foi posta numa coluna de 224px — o
`overflow-x:auto` a tornou rolável em vez de fazê-la caber, então "Com lead · 6"
nascia fora do clip e **fora do hit-test**: o clique caía na conversa ao lado.
Troquei por uma fileira de chips que quebra linha. Tentei primeiro com o `Chip`
do DS e apareceu um defeito pior: os mounts de `x-import` dentro de um `sc-for`
não re-renderizam todos os itens quando as props mudam, e o estado "selecionado"
ficava **dividido entre dois chips** (um com o fundo, outro com o peso). Para
estado que muda a cada clique o controle tem de ser da minha camada, então o
chip de filtro é nativo com os tokens do DS (`var(--brand-soft)`, `var(--line)`,
`var(--ink-muted)`); `Input`, `Textarea`, `Button` e o `Chip` estático do
"mais ▾" seguem sendo do DS. Medido: os três clicáveis, nenhum cortado, e
trocar o filtro muda a lista (7 → 6 conversas, o número sem lead sai).

**Crítica 4 → reprovada por perda de função, corrigida:** eu havia lido a
prancha 9b e deixado de fora controles que ela declara, além de entregar três
que não faziam nada — perda de função por implementação parcial, não por CSS:

1. **o seletor de canal não existia.** A prancha declara quatro destinos
   (WhatsApp · Instagram · Facebook · **Automações**) e a tela chama-se "Inbox"
   justamente por isso. Entraram os quatro: WhatsApp é a caixa; Instagram e
   Facebook mostram honestamente que o canal não está conectado, com o caminho
   de conectar; **Automações** recupera o `wa-automations.jsx` — as cinco
   automações do robô (qualificação, lembrete de 24 h e de 1 h, retomada de
   proposta, pós-venda) com disparos em 7 dias e pausar/ligar funcionando, mais
   os templates com o estado de aprovação da Meta e "usar na conversa", que
   escreve o texto no campo de resposta;
2. **o filtro "Robô" tinha virado "Com lead"** — a tela mostrava conversa
   conduzida por robô (bolha e faixa roxas) e não deixava isolá-las, que é como
   se audita o bot. "Robô" voltou como terceiro chip e o "mais ▾" passou a
   revelar os outros quatro (com lead · encerradas · pra humano · sem lead), que
   agora filtram de verdade — medido: os 7 chips com contagem, e o "mais ▾" com
   onClick;
3. **três controles mortos ou mentirosos:** "criar template" sem onClick, o
   "mais ▾" sem onClick no meio de filtros que funcionavam, e o "⋯" anunciando
   cinco ações no `title` e executando uma navegação inesperada. O "⋯" abre um
   menu com as cinco ações reais — abrir o lead, esconder o card, ligar no app,
   pausar/religar o robô (que troca o estado da conversa) e encerrar a conversa.

O seed subiu de versão, então a mensagem que os meus testes tinham gravado no
localStorage saiu junto.

**Dívida registrada:** as outras telas usam os *valores* dos tokens do DS mas
ainda desenham os controles à mão. Trocar pelos componentes do DS, tela por tela,
entra na fila junto com o resto de cada prancha.

**Crítica 1 → reprovada em 3 pontos, corrigidos:** as três colunas não caíam em
676px e a conversa ficava fora da vista (agora lista + thread lado a lado e o
card do cliente quebra por último); o separador de dia renderizava uma bolha
vazia logo abaixo dele; e o cabeçalho da conversa espremia o nome em duas linhas
para caber o botão de ação — o nome deixou de encolher e o botão desce de linha
quando não cabe.

## Rodada 8 — Metas (13b)

A tela era um dos painéis genéricos (KPIs + corrente + tabela de literais), ou seja
**não editava meta nenhuma** — e editar meta é a única coisa que a tela do repo faz.
Reconstruída em cima de `screens/metas.jsx` e `routes.metas.js`:

- **Meta do mês**: régua de receita e régua de contratos com a marca do pace
  (13/30 do mês), coloridas pela escala vermelho → teal → verde → dourado, e os
  dois campos que as editam logo abaixo — digitar move a barra na hora, salvar é
  o que grava (medido: 200.000 digitado → régua 5% e a cadeia inteira refeita).
  Campo vazio mostra de onde vem o número que vale (padrão do produto ou regra de
  crescimento); `Meta de contratos` em branco segue a venda ÷ ticket e avisa
  quando o digitado briga com a divisão em mais de 15%.
- **A cadeia dessa meta** como funil horizontal dentro do mesmo cartão: leads →
  contatos → agendadas → realizadas → ganhos → venda, com a taxa em cada degrau e
  a origem no hover ("medida nos últimos 30 dias (33 de 104 leads trabalhados
  marcaram call)"). `derivar metas do pace` preenche só os campos de VOLUME das
  vagas e deixa as taxas em paz, porque taxa é a ambição que alimenta a cadeia.
- **Metas por vaga**: os 4 papéis do `META_CATALOG` com as 28 métricas, o
  denominador de cada taxa por extenso, a parte de cada pessoa nas metas de time
  ("86 por pessoa · 2 na vaga") e o que a meta do mês exige no placeholder.
  Contratos e receita de SDR e closer não têm campo: seguem o nível da pessoa no
  plano de Remuneração, e o bloco mostra a régua de cada um.
- **Meta por pessoa**: lista do time com o nível (salva na hora, com o chip
  "elegível a Sênior" de quem tem 3 meses fechados), o alvo vigente no
  placeholder com a origem no hover, o ajuste que vence plano/vaga/derivado e a
  lista genérica "Outras metas por pessoa" com adicionar e remover.
- **Agenda de metas** no fim (planejamento mexe pouco): a % de crescimento como
  ação — `definir os 6 meses` compõe por cima da meta do mês atual (medido:
  200.000 → 216.000 → 233.280 → … → 317.375) e os valores ficam visíveis pra
  conferir antes de salvar.

Dirty de verdade: `descartar` e `salvar metas` só ficam ativos quando há
diferença contra o último salvo, e o salvo persiste no localStorage.

## Rodada 9 — Mapas mentais (13e)

Era o painel genérico com uma tabela de mapas inventados ("Funil de aquisição ·
6 nós · Bia") — a tela do repo **é um editor**, e o painel não editava nada.
Reconstruída em cima de `screens/mindmaps.jsx` + `lib/mindmap.js`, com a parte
pura portada quase verbatim (a regra central: **a posição do nó é derivada da
árvore**, `x/y` só valem desanexado ou no layout livre):

- **5 layouts** do `LAYOUTS` — árvore, radial, organograma, lista e livre — com
  as mesmas contas de vão, recuo e queda do repo; trocar para livre congela as
  posições atuais para nada pular.
- **Teclado manda**: Tab cria filho, Enter cria irmão, setas navegam pelo cone
  de 90°, espaço recolhe, F2 renomeia, Delete apaga a subárvore, ⌘Z/⌘⇧Z desfaz
  e refaz (pilha de 60), ⌘F busca, ⌘A seleciona tudo, ⌘. entra no foco,
  ⌘⇧H enquadra, ⌘↑/↓ reordena entre irmãos, ⌥1-3 recolhe por nível, ⌥C conecta,
  ⌥N abre a nota, digitar com o nó selecionado já entra em edição.
- **Arrastar reparenta**: soltar no meio do alvo vira filho, no topo/base vira
  irmão antes/depois (com a marca de 2px), e soltar no vazio desanexa com ⌥.
- **Nó rico**: cor do ramo em rodízio da paleta (a explícita vence), 4 formas,
  negrito, nota, ícone, limite do ramo e recolher com a contagem no badge.
- **Conexões** entre nós com rótulo editável e remover; **esboço** que mostra o
  mapa como lista com recuo e, no "aplicar", reescreve o mapa a partir do texto
  (o mesmo `parseOutline`); **busca** com próximo e expansão dos ancestrais.
- **Gaveta de mapas** (fechada por padrão, a tela abre no mapa, como o repo
  decidiu em 13/09): abrir, renomear, duplicar, apagar e + novo.

Os três mapas do seed têm conteúdo do negócio, e o de onboarding lê os marcos
de `MARCOS` em vez de repetir a lista à mão.

## Rodada 10 — Financeiro (13d)

O painel genérico tinha 4 KPIs e um "DRE" de seis linhas escritas à mão. A tela
real são **seis abas** (`expenses.jsx` + `finance-hub.jsx` + `finance.jsx`), e
cada uma existe porque alguma decisão de dinheiro acontece nela:

- **Resumo**: abre pelas pendências com prazo (vencidos a receber → cobrar em
  Clientes, contas vencidas → A pagar, entradas sem dono → Conciliação), depois
  a foto do mês em uma linha (recebido, a receber, despesas, a pagar, margem
  bruta, resultado), o **fluxo de caixa** de 6 meses (entrada/saída/saldo, com o
  previsto embaixo) e o **DRE por setor**: receita por tipo → deduções → receita
  líquida → COGS → lucro bruto com margem → S&M → P&D → G&A → resultado.
- **Conciliação**: a fila é **uma só**, entradas e saídas por data. Entrada tem
  sugestão (nome parecido ou mesmo valor de uma cobrança aberta), vincular
  cliente ou desconsiderar com motivo, e o **aprendizado**: com "lembrar deste
  pagador" ligado, a ação vira regra e o mesmo pagador não é mais perguntado
  (medido: pendentes 3 → 2 e regras 2 → 3 num clique). Saída casa com a conta a
  pagar — mesmo valor já vem sugerido — e a baixa acontece junto.
- **A pagar**: tiles de vencidos/hoje/a vencer/pagos, formulário com a categoria
  por setor (é ela que decide onde a conta cai no DRE), fornecedor ou
  colaborador, vencimento e recorrência; na linha, informar pagamento, reabrir,
  encerrar a recorrência e excluir.
- **Folha**: as mesmas contas na lente por colaborador, com "+ pagamento" e a
  categoria vindo do papel da pessoa.
- **Pagamentos**: o espelho do Mercado Pago com filtros por status, busca, bruto
  e líquido, e "vincular" para quem está sem dono.
- **Custos**: os automáticos (Publicidade, IA com o US$, WhatsApp com as
  conversas), os lançados à mão em R$ **ou %** sobre ganhos/cartão/recebidos (o
  valor é calculado pela base do mês), e as contas a pagar do mês em leitura.

**Tudo amarrado numa fonte só**: as faturas em aberto e vencidas são as mesmas
da tela Clientes (mesmo construtor base + ganhos que ainda não são cliente); o
recebido do mês sai dos pagamentos casados do espelho MP; o total da aba Custos
é o mesmo número que o Resumo mostra em "despesas do mês". A recorrência nasce
sozinha nos outros meses da janela, como o servidor faz (medido: em agosto as
contas caem de R$ 20.818 para R$ 18.740 e o lançamento avulso de setembro não
aparece). O seed subiu para a versão 12, então o estado salvo antigo sai junto.

## Rodada 11 — Configurações (13f)

O painel genérico listava as etapas do funil numa tabela **de leitura** — e a tela
real é o lugar onde a operação se configura. Refeita em cima de
`screens/settings.jsx`, com menu lateral e as seis abas do repo:

- **Funil & estágios**: as etapas de verdade — renomear, mover, trocar o tipo
  (`KINDS` do repo), a fase, a cadência (SLA do 1º toque, toques máximos e
  retry) e ver quantos leads estão ali agora. **Renomear migra os leads ao
  salvar** (medido: “Qualificação” → “Diagnóstico” renomeou a coluna do Pipeline
  e levou os cards junto), porque o funil da tela passou a ser a fonte que o
  Pipeline lê. Mais os **motivos de perda** (que o gate de perda usa) e a
  **conversão automática** em três chaves.
- **Próximos passos**: por roteiro, quais botões “Depois da ação” aparecem em
  Minhas atividades e em que ordem — e o rodapé do roteiro passou a ser montado
  a partir daqui (medido: em Qualificação o rodapé virou WhatsApp · agendou call
  · retomar · **mandar para nutrição** · Perdeu, que é exatamente a lista da
  configuração).
- **Scripts**: o roteiro de cada tipo, uma linha por passo (“Título: texto”),
  com o padrão no placeholder e “voltar ao padrão”. Escrever aqui troca o
  roteiro que o painel de Minhas atividades mostra (medido).
- **Equipe**: papéis (SDR, closer, integração, mídia social, admin) que decidem
  quem aparece no handoff do pipeline, **nível de carreira compartilhado com a
  tela Metas** (salva na hora, como no repo), produto e a lista de telas por
  pessoa.
- **Campos**: campos próprios de deal, cliente e lead, com chave derivada do
  rótulo e opções para escolha única.
- **Integrações**: Mercado Pago (token expirando em 8 dias, o mesmo aviso da
  notificação), Google, Meta Ads, WhatsApp Cloud, Mercado Livre e IA — com
  estado, campos de token e testar/desconectar.

O botão do topo segue o repo: **descartar** e **salvar alterações** valem para a
tela inteira (o rascunho vive em `state.cfg` e só o salvar grava), com o
“salvo ✓” por alguns segundos. O seed subiu para a versão 13.

**Perdi tempo com um falso negativo**: `innerText` não trouxe o overlay do
roteiro e `getAttribute("style")` não casa com `position:fixed` (o React grava
com espaço). O painel estava abrindo o tempo todo — a régua para as próximas
verificações é `textContent` + `getComputedStyle`.

## Rodada 12 — Remuneração (13c)

O painel genérico era uma tabela de cargos × níveis com strings do tipo
“R$ 2.600 + 6%” — o plano real tem **duas pernas, bandas em degrau e uma escada
sem teto**, e nada disso cabe em texto. Refeita em cima de
`screens/remuneracao.jsx`:

- **Regras da casa**: as dez decisões, na íntegra, porque é o contrato que a
  tabela precifica.
- **Três trilhas** (SDR, Closer com fixo CLT e PJ, Integrador · CS) com a tabela
  por nível editável — fixo, metas de contratos e receita, bônus de 80/100/120/
  140% (ou NPS e churn no CS) — e **quem está em cada faixa** como chip, lendo
  os papéis de Configurações → Equipe e o nível das Metas.
- **Simulador** por trilha com a conta do repo: `remPerna` é degrau, não rampa
  (medido: 167% cai na banda 160% e paga R$ 3.400 = 2.700 + 600 + 100), zera
  abaixo de 80% e não tem teto acima de 140%. O do CS soma indicação com
  reunião feita, indicação fechada (que substitui, não soma), NPS e churn.
- **Bônus de time** com a tabela por cargo e nível, as **duas condições do mês
  medidas na casa** (meta de venda R$ 10.950 de R$ 128.000 — a mesma das Metas e
  do Financeiro — e churn 12,5% contra o limite de 15%), o total se o mês fechar
  (R$ 2.200 para as 4 pessoas do plano) e os meses fechados com recalcular.
- **Indicação · o que o mês deve pagar**, por quem colheu, saindo das mesmas
  indicações da aba Indicações de Clientes (o seed ganhou `colhidaPor` e
  `reuniao`, que é o que o pagamento precisa).

**Fonte única de verdade:** o plano por nível saiu do const que as Metas usavam
e passou a viver em `dados.remuneracao` — editar aqui muda a régua de lá
(medido: closer sênior 15 → 16 contratos apareceu no card de Metas do Lucas). A
meta do mês virou um método só (`metaDoMesAtual`), usado pelas Metas e pelo
bônus de time. O seed subiu para a versão 14.

## Rodada 13 — Tarefas (13a)

O painel genérico era 4 KPIs e uma tabela de leitura; a tela do repo é um
**quadro de trabalho** com 22 arquivos. Reconstruída com o que a
operação usa todo dia:

- **Quadro** com as 4 colunas do board e **arrastar entre colunas** (soltar em
  Concluído carimba a conclusão); card com checkbox, labels coloridas,
  prioridade, prazo por extenso (“Hoje”, “Amanhã”, dia da semana até 6 dias,
  depois “11 set” — a régua do `dueState`), contagem de subtarefas e de
  comentários, e avatar do responsável. “+” na coluna cria a tarefa ali.
- **Filtrar** (rápidos, responsável, prazo por balde, prioridade, label,
  criador e coluna, com contador e limpar), **Ordenar** (7 critérios +
  crescente/decrescente), **Agrupar** (coluna, responsável, prazo, prioridade,
  label — e arrastar entre grupos muda o campo) e **Opções** (campos do card,
  concluídas: todas / últimos 14 dias / ocultar, ocultar colunas vazias, cards
  compactos, restaurar padrão). A **faixa de filtros ativos** traz cada um com
  o seu ✕ e o “limpar tudo” (medido: “Atrasadas” leva de 9 para 2 tarefas).
- **Quatro visões**: quadro, lista agrupada, calendário do mês (com as tarefas
  no dia do prazo e “+N” quando passa de três) e cronograma com uma barra por
  tarefa nas quatro semanas em volta de hoje.
- **Ficha em drawer**: título e descrição editáveis, coluna, responsável,
  prioridade, prazo, labels, subtarefas com progresso (medido: adicionar levou
  de “1 de 2” para “1 de 3 feitas”), comentários, curtir e apagar.

As tarefas continuam em `dados.tarefas` — os campos `texto`, `quem`, `prazo` e
`coluna` são os mesmos que Minhas atividades lê, e o quadro só acrescentou o
que faltava (descrição, prioridade, labels, subtarefas, comentários). Seed na
versão 15.

## Rodada 14 — Links de pagamento (7b)

A tela do repo responde "quem falta pagar?" — e o painél genérico respondia com
três números e uma lista de links soltos. Refeita em cima de `screens/offers.jsx`:

- **Faixa do dinheiro** com o em aberto grande e primeiro (é o que exige ação),
  recebido, links gerados e recusado, a barra pago/aberto/recusado sobre o
  gerado, a legenda e o “como o status funciona ⓘ”.
- **Abas** Devendo (padrão) · Pagos · Recusados · Todos com contagem por
  cliente, seletor de vendedor (quem gerou) e busca.
- **Uma linha por cliente ou lead** com links, pago, em aberto (com a pill do
  estado), último link e a ação principal: **cobrar** (abre a conversa) e
  copiar. Expandir mostra cada link com origem, quem gerou, valor, quando,
  status e as ações — copiar, **marcar pago** e **desfazer**.
- **Aviso de backlog**: link em aberto de antes da janela de 30 dias aparece
  numa linha em vez de sumir (1 link de R$ 2.600 no seed).
- **Gerar link** no modal, no nome de um cliente ou de um lead.

**Fonte única**: o link de cliente É a cobrança da ficha — marcar pago aqui dá
a mesma baixa da tela Clientes (medido: em aberto R$ 49.550 → R$ 24.550 ao
baixar a parcela da Galante, e o desfazer devolve) — e o recebido sai dos
pagamentos casados do espelho do Mercado Pago, o mesmo número do Financeiro
(R$ 38.400). Só os links no nome de LEAD moram em `dados.fin.links`, porque
não há cobrança de onde derivar. Seed na versão 16.

## Rodada 15 — Contratos (7c)

O painel genérico listava modelos como cartões iguais e não preenchia nada. A
tela do repo é “resgatar o modelo, preencher e mandar assinar”, com controle do
que saiu — foi isso que entrou:

- **Modelos em linhas**: nome, quantos campos o quadro resumo tem, etiqueta,
  quantos contratos já saíram daquele modelo e o último (cliente · data). Uma
  ação principal, `usar →`, com `editar` ao lado e o resto no ⋯ (imprimir em
  branco, que de propósito **não registra**, duplicar e excluir).
- **Drawer de três passos** (cliente · quadro resumo · gerar), com a contagem
  de campos no topo: vincular o cliente preenche razão social e representante
  vazios, os campos saem dos tokens `{{chave}}` do próprio corpo (os quatro
  primeiros à vista e “+N campos” para o resto) e o contrato ao lado se
  atualiza, com linha em branco onde o campo está vazio.
- **Gerar** fecha a coluna: imprimir, baixar ou copiar registra o contrato no
  histórico preso ao cliente, e o chip diz em qual histórico ele vai cair;
  gerar duas vezes o mesmo papel não vira duas linhas.
- **Histórico** com busca, contagem, quando (dia e hora), cliente clicável (que
  filtra por ele), modelo com etiqueta e valor, quem gerou, abrir e excluir.
- **Editor do modelo** com corpo em texto (`#` título, `##` cláusula,
  `| rótulo | valor` no quadro) e pré-visualização do papel ao lado.

Medido: vincular RN Distribuidora preencheu a razão social e “registrar sem
imprimir” levou o histórico de 3 para 4 contratos. Seed na versão 17.

## Rodada 16 — Consultas (9c/9d)

A operação pós-venda da mentoria, em cima de `screens/consultas.jsx`:

- **Agenda**: semana seg–sáb × 08–19h com navegação (‹ hoje ›), consulta na
  célula com a cor do status e clique em horário vazio marcando a consulta.
- **Jornadas por família** ordenadas por RISCO: quem está sem próxima marcada
  vem primeiro (aviso no topo com “a mais parada” e o botão que marca a
  próxima), bolinhas de 1 a 8 com o estado de cada encontro, e uma ação
  principal por linha (marcar a Nª / abrir consulta) + Manual ↗.
- **Resumo da semana** com faltas e desmarcadas e o “Manual a entregar” de quem
  chega na última consulta.
- **Ficha da consulta**: cliente, criança, contato, nº, duração, dia e hora,
  status, anotações, **recap da consulta anterior** (foco combinado, tarefas de
  casa, sinais), criar Meet com aviso de para quem vai o convite e resumir com
  IA.
- **Entregáveis**: manuais em linhas com as barras das 6 seções, estado e a
  ação certa (terminar / revisar e entregar / ver página), e o **editor do
  Manual** com índice das seções sempre à vista, compor com IA (que só preenche
  o que está vazio e carimba de quais consultas veio) e marcar entregue.

Medido: 5 famílias, 2 jornadas sem próxima marcada e 4 manuais com um pronto
para entregar. Seed na versão 18.

## Rodada 17 — Formulário de Integração (7d)

Em cima de `screens/integration-forms.jsx`, o que a tela precisa responder é
"quem está devendo o formulário e há quanto tempo":

- **Faixa** com aguardando, a **espera mais longa** (em dias, vermelha a partir
  de 5, com o nome de quem mais espera) e prontos para a call — em vez do
  "total de pedidos", que era a soma dos outros dois.
- **Abas** Todos / Aguardando / Respondidos com contagem e busca.
- **Tabela** com cliente e data do pedido, a situação como ESPERA ("aguardando
  há 9 dias") em vez da data crua, o resumo do que veio (contas, rotas, ERP,
  estoque), quem pediu e a ação principal: **cobrar** no WhatsApp para quem
  está devendo, **ver respostas** para quem respondeu, mais copiar e excluir.
- **Ficha** com as respostas no snapshot das seções (contas e rotas como
  cartões de rótulo/valor, não tabela apertada) e o **termo assinado** com
  nome, documento, data e IP.
- **Solicitar** no modal: cliente ou lead que fechou, busca digitável, e o link
  único com copiar e mandar no WhatsApp.

Seed na versão 19.

## Rodada 18 — Redes sociais (10a)

Em cima de `screens/social.jsx`, a tela deixou de ser “uma barra de composição”
e virou o painel inteiro:

- **Abas Painel / Comentários** com badge dos pendentes e o **+ criar post**.
- **Criativos de hoje** com −/+ (o contador que alimenta a Análise de
  Desempenho).
- **Quatro tiles** (seguidores, alcance, engajamento médio, posts no mês de 12)
  e a segunda faixa recolhida no **“mais números ⓘ”**, como o repo decidiu.
- **Crescimento de seguidores** com o bruto do período (+412 seguiram, −128
  deixaram), porque o líquido esconde o churn.
- **Alcance seguidores × não-seguidores** com os rótulos corretos (“alcance de
  quem já segue”) mais o alcance por formato, e **interações por tipo** com os
  cliques do perfil.
- **Quem é o seu público** com os três públicos (seguidores · alcançados ·
  engajados) em gênero, faixa etária e cidades.
- **Radar do mercado**: concorrentes com a linha “nós” primeiro (adicionar e
  remover funcionam), quem marcou a conta e hashtags monitoradas.
- **Publicações** com o toggle por alcance / por data (o padrão é o que mais
  rendeu) e as métricas por post, mais a tabela de **stories** capturados.
- **Comentários**: fila com quem está esperando, responder (que publica e muda
  o estado) e ocultar.
- **Criar post** em três passos: formato (Feed/Story/Reels) → tipo (estático,
  carrossel, sequência, vídeo, conforme o formato) → legenda e redes, com a
  regra do repo: story não tem legenda e a página do Facebook só recebe feed.

Seed na versão 20.

## Rodada 19 — Publicidade (10b)

Em cima de `screens/metrics.jsx`, a tela trocou a corrente genérica pelo
gerenciador inteiro:

- **Do anúncio ao dinheiro** com os seis passos do repo — investido → visitas
  no form → leads (com "24 fora do perfil") → custo por lead contra a meta →
  clientes (CAC) → receita (ROAS e LTV/CAC).
- **Regras do gerenciador**: as recomendações de pausar e subir 20%, com
  confirmação em dois toques e dispensar.
- **Regras de veiculação** (as que rodam sozinhas no servidor): agenda cheia
  pausa, janela de fim de semana, sexta curta e orçamento alvo, com liga/desliga
  e o histórico do que cada uma fez.
- **Custo por etapa do funil** nos marcos (entrada → call → proposta →
  integração → ganho) e **origem dos leads** com o aproveitamento (leads, calls
  e ganhos por origem).
- **Por dor**: o código [X] do nome do anúncio com investido, CPL, ganhos,
  R$/ganho e ROAS.
- **Gerenciador**: abas Campanhas · Conjuntos · Anúncios, toggle por linha com
  **pausa herdada** (pausar campanha marca os filhos como "pausado pela
  campanha"), filtro de veiculação com "ativas" ligado, drill-down clicando no
  nome (vira chip que filtra o nível de baixo), **colunas modeláveis** (21
  colunas, 12 no padrão) e linha de totais.

Seed na versão 21.

## Rodada 20 — Formulários (10c)

Em cima de `screens/forms.jsx`:

- **Lista** com um cartão por form; publicado ocupa a largura toda e conta a
  história inteira — visitas → começaram → envios → viraram cliente → receita,
  com a conversão de cada passo embaixo e "último envio". Rascunho fica
  compacto, com a contagem de perguntas.
- **Teste A/B de headline** agrupado por dor (BASE e [1]), com o texto real de
  cada variante, visitas, começaram, leads, clientes ABC, call, fecharam,
  receita — e o veredito da campeã pela taxa de lead, com "volume baixo pra
  decidir" abaixo de 200 visitas.
- **Envios recentes**: nome, e-mail, empresa, origem com o anúncio atribuído e
  quando; clicar abre as respostas do form.
- **Editor**: nome, boas-vindas, perguntas (8 tipos, chave derivada do título,
  obrigatória, "mesma tela que a anterior", opções com **pular para** — outra
  pergunta, fim, fim não qualificado ou saída lateral), tela final com WhatsApp
  automático, tela de não qualificado, saídas laterais com coluna do pipeline,
  mapeamento → lead e **preview** da primeira tela com a barra de progresso.
  Validação do repo: nome, ao menos uma pergunta, chave em toda pergunta e
  chaves sem duplicidade.
- **Respostas** por formulário, com as perguntas do form listadas no pé.

Publicar/despublicar é um clique no ponto de status. Seed na versão 24.

**Crítica 1 → reprovada por perda de função, corrigida:** o editor media um
teste que ninguém podia criar — o cartão mostrava as variantes A/B/C/D com o
veredito da campeã e o editor não tinha o `VariantsEditor`/`PainWelcomesEditor`
do repo. Entraram as **variantes da headline** dentro do card de Boas-vindas
(id, headline, código da dor e a medida de cada uma), alimentando a mesma lista
que a tabela A/B lê — editar a headline muda a linha da tabela. Também faltavam
o **"Texto do botão de enviar (última tela)"** em Básico e a seção **Tema da
marca** (cor da marca, fundo e texto), que agora pinta o preview.

## Rodada 21 — Canvas (10d)

Em cima de `screens/creative.jsx`:

- **Formato** Story 1080×1920 · Feed 1080×1350 · Carrossel 1080×1350, com os
  templates do grupo aparecendo conforme a escolha, como o `visibleTemplates`
  do repo.
- **18 templates** com os nomes reais (Chamada, Lista, Número (claro), Foto,
  Pergunta, Agenda (claro), Frase, Antes e depois, Dica, Dor e solução, Passo a
  passo, Case, Mitos e verdades, Bastidores, Perguntas frequentes), com 📷 nos
  que pedem foto e a contagem de slides.
- **Arte** no tamanho real reduzido, com o tema do template — e o **Case** vira
  claro no 2º slide, que é o `mode: ["dark","light","dark","dark"]` do repo.
- **Conteúdo por slide**: cada campo com o texto e o **tamanho da fonte**
  (20 a 300, como o input do repo); o carrossel guarda conteúdo separado por
  slide (medido: editar "MITO" no slide 1 não mexe no slide 2).
- **Elemento de texto novo** com o seletor "em qual slide entra" e remoção.
- **PNG** por slide (ou os 4 do carrossel) e "voltar ao texto padrão".

Seed não mudou (a arte vive no estado da tela, não no seed).

## Rodada 22 — Blog (10f)

Em cima de `screens/blog.jsx`, a mesa de revisão do blog SEO:

- **Automação**: motor ligado · minerar pautas · escrever rascunhos · publicar
  sem revisão (as quatro chaves com a dependência do repo — desligar o motor
  esmaece as outras), cadência de 1 a 5 posts, hora de Brasília, mínimos na fila
  (pautas e rascunhos), dias de publicação (recusa deixar zero) e o link do CTA
  com a nota das UTMs. Ao lado, **estado do motor** (IA, último ciclo, últimas
  pautas, último rascunho, última publicação, próximo slot) e "Ver o que a IA lê".
- **Fila** com os cinco estados do repo (pauta → rascunho → agendado →
  publicado, arquivado fora) com contagem, busca e a coluna **pente fino**
  (ok · N avisos · N erros).
- **Ficha do post** em drawer: pente fino com o motivo, título x/60, slug que
  **trava depois de publicado** com a URL do site, descrição x/155,
  palavra-chave, intenção, categoria, tags, texto em markdown com contagem de
  palavras, perguntas frequentes, **de onde veio** (ângulo, roteiro, evidências
  do cockpit, modelo e tokens da IA) e histórico.
- **Ações por estado**: gerar rascunho (pauta), reescrever com IA por instrução,
  do zero, aprovar e agendar (com data opcional ou o próximo slot), publicar
  agora, voltar pra rascunho, despublicar, arquivar, restaurar e excluir.

**Erro do pente fino bloqueia** aprovar e publicar, como no repo — testado: o
rascunho com "clonar" é recusado, a reescrita da IA tira o erro e aí o aprovar
agenda (agendados 1 → 2). Seed na versão 25, então o estado salvo anterior foi
descartado.

## Próxima rodada

Rodada 7 — **Inbox WhatsApp (9b)** e **Outbound (9a)**: as duas telas de
operação diária que sobraram sem estrutura própria (thread de conversa, filtros,
coluna de toques).
