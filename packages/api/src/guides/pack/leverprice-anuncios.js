// Guia do LeverPrice: a tela Anúncios, o painel do anúncio e Anúncios bloqueados
// (03/11/2026). Prints da UI real (develop) com dados fictícios. Fatos do código:
// v3/screens/Listas.tsx, v3/listas/ (PainelAnuncio, detalhe, logic) e
// v3/screens/Bloqueados.tsx.

export default {
  key: "leverprice-anuncios",
  version: 1,
  title: "LeverPrice · Anúncios: lista, painel do anúncio e bloqueados",
  summary: "A lista de todos os anúncios do Mercado Livre com preço, custo, margem, posição no catálogo e o robô de cada um; os filtros, a seleção em massa, o painel do anúncio (conta da margem, promoções, robô e histórico) e os anúncios que o LeverPrice não consegue precificar.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "para-que-serve",
      title: "Para que serve Anúncios",
      body: [
        "É a lista de todos os anúncios importados da conta do Mercado Livre escolhida na barra da esquerda. O título conta quantos anúncios estão na lista com os filtros de agora (**\"1.200 anúncios\"**).",
        "",
        "Cada linha mostra:",
        "- **anúncio**: foto, título, tipo (**Tradicional** ou **Catálogo**), selo **FULL** quando é do Full, SKU, MLB, vendas e estoque;",
        "- **preço \"Por\"**: o preço que o comprador paga. Em promoção, aparece o ícone de etiqueta e o \"De\" riscado embaixo;",
        "- **custo**: o custo do SKU (\"sem custo\" em amarelo quando falta);",
        "- **margem**: a margem de hoje; em vermelho quando está abaixo da margem de venda;",
        "- **catálogo**: **1º lugar**, **Atrás** ou \"—\" no tradicional;",
        "- **margens** (de venda, cheia e teto) e, mais à direita, o **robô** de cada anúncio.",
        "",
        "> Aqui estão todos os seus anúncios, com a margem de cada um já calculada. Vermelho é o que está vendendo abaixo do mínimo que você definiu.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-01-lista.png", caption: "Anúncios: preço \"Por\", custo, margem, posição no catálogo e as três margens de cada anúncio." },
      ],
    },
    {
      id: "abas-e-barra",
      title: "Abas e barra de ferramentas",
      body: [
        "- Abas **Todos**, **Tradicional** e **Catálogo**, cada uma com a contagem. Na aba Catálogo aparecem também as colunas **para ganhar** (preço e margem para ganhar o 1º lugar).",
        "- **Nome, SKU ou MLB**: busca. Dá para colar uma lista de SKUs ou MLBs.",
        "- **Filtrar**, **Ordenar** (o botão com a ordem atual, como **Menor margem primeiro**), **Colunas** (o ícone de barras) e **⋯** (Mais ações): nos próximos passos.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-02-barra-de-ferramentas.png", caption: "Abas, busca, Filtrar, Ordenar, Colunas e o menu ⋯." },
        { file: "leverprice/anuncios-03-aba-catalogo.png", caption: "Aba Catálogo: posição no catálogo e o preço e a margem para ganhar o 1º lugar." },
      ],
    },
    {
      id: "filtrar",
      title: "Filtrar",
      body: [
        "**Filtrar** abre um painel com a contagem de cada opção:",
        "- **promoção**: Todas, Com promoção, Sem promoção;",
        "- **robô**: Todos, Ligado, Desligado;",
        "- **custo**: Todos, Com custo, Sem custo, Sem SKU;",
        "- **fornecedor**;",
        "- **margem**: Abaixo da margem de venda, Entre a de venda e a cheia, Da cheia ao teto, Acima do teto;",
        "- **catálogo**: 1º lugar, 1º dividido, Atrás, Fora da disputa e **Dá para ganhar o 1º**.",
        "",
        "Escolha e clique em **Ver N anúncios**. **Limpar** volta tudo. Os filtros aplicados aparecem como chips embaixo do título.",
        "",
        "Os cards do Início abrem esta lista já filtrada (por exemplo, \"anúncios abaixo da margem de venda\").",
      ].join("\n"),
      tip: "Para a call, o filtro mais útil é margem › Abaixo da margem de venda: mostra na hora onde o cliente está perdendo dinheiro.",
      images: [
        { file: "leverprice/anuncios-04-filtrar.png", caption: "Painel Filtrar: promoção, robô, custo, fornecedor, margem e catálogo, com as contagens." },
        { file: "leverprice/anuncios-19-recorte-abaixo-da-margem.png", caption: "Lista aberta pelo card do Início, já no recorte \"abaixo da margem de venda\"." },
      ],
    },
    {
      id: "ordenar-e-colunas",
      title: "Ordenar e escolher as colunas (e onde fica o robô)",
      body: [
        "- **Ordenar**: menor ou maior margem, menor ou maior preço, menor ou maior custo.",
        "- **Colunas**: marca ou desmarca **custo**, **margem**, **catálogo**, **para ganhar**, **margens · de venda, cheia e teto** e **robô**. **Voltar ao padrão** desfaz.",
        "",
        "Em tela menor (notebook), a coluna **robô** fica escondida à direita. Desmarcar **margens** em Colunas faz ela aparecer sem rolar: cada anúncio tem o seu interruptor do robô (escuro = ligado).",
        "",
        "As margens de cada linha também são editáveis: clique no número da margem de venda, cheia ou teto da linha, digite e confirme com o ✓.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-05-ordenar.png", caption: "Ordenar por margem, preço ou custo." },
        { file: "leverprice/anuncios-06-colunas.png", caption: "Colunas: escolher o que aparece na lista." },
        { file: "leverprice/anuncios-07-coluna-robo.png", caption: "Sem a coluna de margens, o interruptor do robô aparece em cada linha." },
      ],
    },
    {
      id: "custo-na-linha",
      title: "Cadastrar o custo direto na lista",
      body: [
        "Clique em **sem custo** (ou no custo de qualquer linha). Abre o campo **R$** com a frase **\"Custo do SKU X · N anúncios nesta conta\"**: o custo vale para todos os anúncios com aquele SKU. Digite e clique em **Salvar** (ou Enter).",
        "",
        "Anúncio **sem SKU** não aceita custo: o SKU precisa ser cadastrado no anúncio do Mercado Livre.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-08-custo-na-linha.png", caption: "Custo na linha: vale para todos os anúncios do mesmo SKU nesta conta." },
      ],
    },
    {
      id: "mais-acoes",
      title: "Menu ⋯: importar, exportar e anúncios bloqueados",
      body: [
        "O **⋯** no canto direito tem:",
        "- **Importar anúncios da conta**: busca de novo os anúncios no Mercado Livre. Enquanto roda, o título vira **\"Importando N anúncios da conta\"** com a barra **\"Anúncios já com o LeverPrice\"** e o item do menu fica **Importando anúncios…**. A importação automática já acontece; use quando o cliente acabou de publicar muitos anúncios.",
        "- **Exportar esta lista**: baixa uma planilha com a lista do jeito que está (abas, busca e filtros).",
        "- **Anúncios bloqueados · N**: abre os anúncios que o LeverPrice não consegue precificar (passo próprio, mais abaixo).",
      ].join("\n"),
      tip: "Logo depois do primeiro acesso, a importação inicial aparece aqui. Se o cliente estranhar poucos anúncios, mostre a barra de avanço.",
      images: [
        { file: "leverprice/anuncios-09-mais-acoes.png", caption: "Menu ⋯: Importar anúncios da conta, Exportar esta lista e Anúncios bloqueados." },
        { file: "leverprice/anuncios-18-importando.png", caption: "Importação em andamento: \"Anúncios já com o LeverPrice\"." },
      ],
    },
    {
      id: "selecao-em-massa",
      title: "Alterar vários anúncios de uma vez",
      body: [
        "1. Marque as caixas das linhas (ou a do cabeçalho).",
        "2. A faixa mostra **\"N anúncios selecionados\"** com **Selecionar todos os N do recorte** (todos os da busca e filtros, não só os da tela) e **Limpar**.",
        "3. Na barra escura de baixo: **Ligar o robô**, **Desligar o robô**, **Margens** (\"Com que margens esses anúncios trabalham?\": margem de venda, cheia e teto) e **Preço mínimo**.",
        "4. Toda ação em massa pede confirmação e mostra o andamento.",
        "",
        "Uso típico na integração: filtrar **custo › Com custo** e **robô › Desligado**, selecionar todos do recorte e **Ligar o robô**.",
      ].join("\n"),
      tip: "Ligar o robô em anúncio sem custo não adianta: ele fica parado. Filtre \"Com custo\" antes de ligar em massa.",
      images: [
        { file: "leverprice/anuncios-10-selecao.png", caption: "Seleção com a barra: Ligar o robô, Desligar o robô, Margens e Preço mínimo." },
        { file: "leverprice/anuncios-11-margens-em-massa.png", caption: "Margens em massa: margem de venda, cheia e teto para os selecionados." },
      ],
    },
    {
      id: "painel-resumo",
      title: "O painel do anúncio: a conta da margem",
      body: [
        "Clique numa linha para abrir o painel à direita (as setas **‹ ›** passam para o anúncio anterior ou o próximo; **×** fecha).",
        "",
        "Na aba **Resumo**:",
        "- **Conferido no Mercado Livre**: quando o LeverPrice leu o anúncio pela última vez (\"a cada 24 h\").",
        "- **Cálculo de margem**: **Preço de venda**, **Comissão** (com o tipo e o percentual, como \"Clássico 12%\"), **Frete**, **Impostos**, **Custo do produto** e **Sobra para você**, com a margem.",
        "",
        "É a melhor tela para o cliente confiar no número: cada linha da conta é dele.",
        "",
        "> Olha a conta desse anúncio: vende a tanto, o Mercado Livre leva isso de comissão, tem o frete, o imposto e o custo. Sobra isso aqui, que é a sua margem.",
      ].join("\n"),
      tip: "Se o cliente disser que a conta está errada, quase sempre é custo ou imposto. Corrija no próprio painel ou em Produtos e veja a margem mudar.",
      images: [
        { file: "leverprice/anuncios-12-painel-resumo.png", caption: "Painel do anúncio: conferência no Mercado Livre e o cálculo da margem." },
      ],
    },
    {
      id: "painel-promocoes-e-robo",
      title: "O painel do anúncio: promoções e como o robô cuida",
      body: [
        "**Promoções** é uma tabela com **Sem promoção** na primeira linha e cada promoção disponível: **rebate** (o que o Mercado Livre paga), **desconto**, **preço \"Por\"**, **início**, **fim** e a **margem** naquela promoção (vermelha quando fica abaixo da margem de venda). A linha destacada com o ícone do LeverPrice é a que o robô escolheria.",
        "",
        "**Entrar** pede confirmação (**\"Entrar na …?\"**, com o preço \"Por\" de agora → na promoção, a margem e a vigência) e **Entrar na promoção**. Promoção que deixa a margem abaixo da de venda não mostra o botão (ou pede um \"Entrar mesmo assim\" quando o Mercado Livre permite).",
        "",
        "**Como o robô cuida**:",
        "- **Robô** ligado ou desligado neste anúncio;",
        "- **Margens** (de venda, cheia e teto) só deste anúncio;",
        "- **Quero vender a**: digite um preço e o LeverPrice calcula a margem que ele daria;",
        "- **Preço mínimo** deste anúncio.",
        "",
        "Enquanto a Lever não liberar a aplicação de preços na conta, não prometa que o clique muda o Mercado Livre na hora: confira o resultado em **Robô › Histórico**.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-13-painel-margem-e-custos.png", caption: "Promoções do anúncio com rebate, preço \"Por\" e margem, e o bloco \"Como o robô cuida\"." },
        { file: "leverprice/anuncios-14-entrar-na-promocao.png", caption: "Entrar numa promoção: o preço \"Por\", a margem e a vigência antes de confirmar." },
      ],
    },
    {
      id: "painel-historico",
      title: "O painel do anúncio: Histórico",
      body: [
        "A aba **Histórico** mostra o **preço de venda hoje** e, embaixo, tudo o que mudou no anúncio: o que o robô fez e o que alguém fez à mão (**Manual**, com o nome da pessoa), com data e hora.",
        "",
        "Use quando o cliente perguntar \"quem mudou o preço desse anúncio?\".",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/anuncios-15-painel-historico.png", caption: "Histórico do anúncio: mudanças manuais e do robô." },
      ],
    },
    {
      id: "bloqueados",
      title: "Anúncios bloqueados: os que o LeverPrice não consegue precificar",
      body: [
        "Pelo **⋯ › Anúncios bloqueados**. O título conta **\"N anúncios sem preço do LeverPrice\"**. O primeiro chip (**com o robô parado**) junta todos; os outros separam os motivos:",
        "- **parados pela trava de 50%**: o robô quis mudar o preço mais de 50% de uma vez (\"Mudança de +65% de uma vez · trava de 50%\"). Quase sempre é custo errado: confira o custo do SKU. Se estiver certo, a mudança vai para a aprovação em **Robô**.",
        "- **não aceitos**: o Mercado Livre recusou a mudança (por exemplo, \"O Mercado Livre recusou a promoção do vendedor\").",
        "- **sem medidas**: \"Sem medidas do pacote no Mercado Livre\". Sem as medidas o frete não é calculado; o cliente cadastra as medidas no anúncio do Mercado Livre.",
        "- **pausados**: \"Pausado no Mercado Livre\". Nada a fazer no LeverPrice.",
        "",
        "Cada linha tem **anúncio**, **SKU**, **por quê** e o interruptor do **robô**. **‹ Anúncios** volta para a lista.",
      ].join("\n"),
      tip: "Na primeira semana, revise os \"parados pela trava de 50%\" com o cliente: é onde aparecem os custos digitados errado.",
      images: [
        { file: "leverprice/anuncios-16-bloqueados.png", caption: "Anúncios bloqueados: os motivos em chips e o porquê de cada anúncio." },
        { file: "leverprice/anuncios-17-bloqueados-trava.png", caption: "Só os parados pela trava de 50%." },
      ],
    },
  ],
};
