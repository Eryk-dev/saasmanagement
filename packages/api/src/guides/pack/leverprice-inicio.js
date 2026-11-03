// Guia do LeverPrice: a tela Início (03/11/2026). Prints da UI real (develop)
// com dados fictícios. Fatos do código: v3/screens/Home.tsx e o e2e da Home.

export default {
  key: "leverprice-inicio",
  version: 1,
  title: "LeverPrice · Início: os números e os atalhos do dia",
  summary: "A primeira tela do LeverPrice: quanto foi vendido com preço do LeverPrice, o que ele recuperou em promoções, as promoções por dia, quantos anúncios estão com o robô ligado e os cinco cards que levam ao que precisa de atenção.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "para-que-serve",
      title: "Para que serve o Início",
      body: [
        "É a tela que abre ao entrar e no item **Início** da barra da esquerda. Em cima, o resultado do LeverPrice no período; embaixo, cinco cards com o que pede atenção agora.",
        "",
        "A barra da esquerda tem o nome da conta do Mercado Livre em cima (com mais de uma conta, é ali que se troca) e os itens **Início**, **Pedidos**, **Anúncios**, **Robô** (com o número de preços esperando aprovação), **Produtos** e **Configurações**. **Calculadora** e **Relatórios** só aparecem quando estão ligados para a empresa. Embaixo, o nome de quem está logado e **Sair**.",
        "",
        "> Essa é a tela que você vai abrir todo dia: em cima o que o LeverPrice já fez, embaixo o que precisa de você.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-01-visao-geral.png", caption: "Início com 30 dias de uso (dados fictícios)." },
      ],
    },
    {
      id: "vendido",
      title: "Vendido com preço do LeverPrice e os três números ao lado",
      body: [
        "- **Vendido com preço do LeverPrice**: o valor das vendas feitas com um preço ou uma promoção que o LeverPrice aplicou, no período escolhido. A pílula verde compara com o período anterior do mesmo tamanho.",
        "- **Recuperado pelo LeverPrice em promoções**: o rebate que o Mercado Livre pagou nas campanhas em que o LeverPrice entrou.",
        "- **Catálogos ganhos pelo LeverPrice**: anúncios de catálogo que passaram a ganhar o 1º lugar com o preço do robô.",
        "- **Margem protegida pelo LeverPrice**: anúncios que estão dentro das margens do cliente.",
        "",
        "Numa conta nova esses números começam em zero e crescem conforme o robô age e as vendas acontecem.",
      ].join("\n"),
      tip: "Não use esses números para prometer resultado na call. Mostre onde eles vão aparecer e combine de olhar juntos no acompanhamento.",
      images: [
        { file: "leverprice/inicio-02-vendido-e-tiles.png", caption: "Vendido com preço do LeverPrice, com a comparação e os três números de apoio." },
      ],
    },
    {
      id: "acumulado",
      title: "Acumulado no período",
      body: [
        "O gráfico **Acumulado no período** soma, dia a dia, o vendido com preço do LeverPrice. A linha cheia é o período atual; a tracejada, o período anterior. Linha cheia acima da tracejada = vendendo mais que antes.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-03-acumulado.png", caption: "Curva acumulada do período atual contra a do período anterior (tracejada)." },
      ],
    },
    {
      id: "promocoes-e-robo",
      title: "Promoções por dia e anúncios com o robô ligado",
      body: [
        "- **Promoções em que o LeverPrice entrou, por dia**: o total do período, a comparação com o anterior e uma barra por dia.",
        "- **Anúncios com o robô ligado**: o percentual e \"X de Y anúncios precificáveis\". Só entram os anúncios ativos que o LeverPrice já consegue precificar (com custo cadastrado e dados suficientes do Mercado Livre). Anúncio sem custo não entra na conta.",
        "",
        "Se o percentual está baixo, há duas causas: robô desligado nos anúncios (ligar em **Anúncios**) ou custo faltando (cadastrar em **Produtos**).",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-04-promocoes-e-robo.png", caption: "Promoções por dia e o medidor de anúncios com o robô ligado." },
      ],
    },
    {
      id: "cards",
      title: "Os cinco cards: o que pede atenção",
      body: [
        "Cada card mostra um número e abre a lista já filtrada ao clicar:",
        "1. **preços esperando sua aprovação** → **Robô › Aprovações**.",
        "2. **anúncios sem custo cadastrado** → **Produtos**, só os sem custo.",
        "3. **anúncios abaixo da margem de venda** (número em vermelho) → **Anúncios**, já filtrado.",
        "4. **promoções prontas para o LeverPrice aplicar** → **Anúncios** com promoção pronta.",
        "5. **catálogos que o LeverPrice pode ganhar** → **Anúncios** de catálogo que dá para ganhar.",
        "",
        "Card com zero fica apagado e sem clique.",
        "",
        "Ordem de trabalho para ensinar ao cliente: primeiro custos (card 2), depois aprovações (card 1), depois o resto.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-05-cards.png", caption: "Os cinco cards do Início." },
      ],
    },
    {
      id: "periodo",
      title: "Trocar o período",
      body: [
        "No canto superior direito, a pílula do período (**Últimos 30 dias**) abre: **Últimos 7 dias**, **Últimos 30 dias** e **Últimos 90 dias**, sempre comparados com o mesmo número de dias anteriores. Tudo da parte de cima acompanha o período; os cards mostram o que está pendente agora.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-06-periodo.png", caption: "Menu do período: 7, 30 ou 90 dias." },
      ],
    },
    {
      id: "conta-nova",
      title: "Conta nova: o Início zerado",
      body: [
        "Logo depois do primeiro acesso, o Início fica quase todo em zero e só o card **anúncios sem custo cadastrado** tem número. Isso é esperado: o robô só age em anúncio com custo, e a aplicação de preços no Mercado Livre ainda não foi liberada pela Lever.",
        "",
        "> Por enquanto está tudo zerado porque a gente acabou de começar. Conforme você cadastra os custos, o robô começa a trabalhar e esses números aparecem.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-08-conta-nova.png", caption: "Início de uma conta recém-integrada: tudo zerado, anúncios sem custo em destaque." },
      ],
    },
    {
      id: "tudo-em-dia",
      title: "\"Tudo em dia. O LeverPrice cuida do resto.\"",
      body: [
        "Quando não há nada pendente (nenhum preço esperando, nenhum anúncio sem custo ou abaixo da margem, nenhuma promoção ou catálogo esperando), os cards somem e aparece só a linha **\"Tudo em dia. O LeverPrice cuida do resto.\"**",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/inicio-09-tudo-em-dia.png", caption: "Nada pendente: os cards dão lugar à linha \"Tudo em dia\"." },
      ],
    },
  ],
};
