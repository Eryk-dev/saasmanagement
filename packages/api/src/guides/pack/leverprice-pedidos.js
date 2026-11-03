// Guia do LeverPrice: a tela Pedidos (03/11/2026). Prints da UI real (develop)
// com dados fictícios. Fatos do código: v3/screens/Pedidos.tsx, v3/pedidos/logic.ts
// e o e2e de Pedidos.

export default {
  key: "leverprice-pedidos",
  version: 1,
  title: "LeverPrice · Pedidos: quanto sobrou em cada venda",
  summary: "As vendas do Mercado Livre com a conta de cada uma: vendido, comissão, frete, imposto, custo e quanto sobrou. Períodos, comparação, filtros, custo direto na venda e o painel da venda com o anúncio de agora.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "para-que-serve",
      title: "Para que serve Pedidos",
      body: [
        "**Pedidos** lista as vendas do Mercado Livre da conta escolhida, com quanto sobrou em cada uma depois de comissão, frete, imposto e custo. É onde o cliente vê, venda a venda, se está ganhando o que espera.",
        "",
        "O título conta as vendas do período (**\"9 vendas\"**). Embaixo, os números do período: **vendido**, **custo dos produtos**, **sobrou** (em verde), **margem**, **abaixo da margem de venda** (em vermelho) e **sem custo** (em amarelo).",
        "",
        "Cada linha: foto e título do anúncio (com a quantidade e a hora), **SKU · MLB**, **robô** (**Ligado** ou **Desligado** naquele anúncio), **vendido** (com a etiqueta quando houve rebate do Mercado Livre), **custo un.**, **sobrou** e **margem** (vermelha quando abaixo da margem de venda).",
        "",
        "> Aqui você vê cada venda e quanto sobrou dela de verdade, já tirando comissão, frete, imposto e o custo.",
      ].join("\n"),
      tip: "Numa conta recém-integrada, as vendas aparecem conforme chegam. Vendas antigas sem custo cadastrado entram como \"sem custo\" até o custo ser preenchido.",
      images: [
        { file: "leverprice/pedidos-01-hoje.png", caption: "Pedidos de hoje: os números do período e a conta de cada venda." },
        { file: "leverprice/pedidos-02-numeros-do-periodo.png", caption: "Vendido, custo dos produtos, sobrou, margem, abaixo da margem de venda e sem custo." },
      ],
    },
    {
      id: "periodo",
      title: "Período e calendário",
      body: [
        "- Atalhos **Hoje**, **Ontem**, **7 dias** e **30 dias**.",
        "- O botão com a data abre o calendário: atalhos **Hoje**, **Ontem**, **Últimos 7 dias**, **Últimos 30 dias**, **Este mês**, **Mês passado** e a escolha de um dia ou um intervalo no calendário (até 365 dias).",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/pedidos-03-30-dias.png", caption: "Últimos 30 dias." },
        { file: "leverprice/pedidos-04-calendario.png", caption: "Calendário com os atalhos de período." },
      ],
    },
    {
      id: "comparar",
      title: "Comparar com o período anterior",
      body: [
        "O botão **comparar com …** (à direita do título) compara os números com o mesmo trecho do período anterior. Quando o período termina hoje, a comparação para na mesma hora (\"até 10:00\"), para ser justa. **Não comparar** desliga.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/pedidos-06-comparar.png", caption: "Comparar com o mesmo trecho do período anterior, ou Não comparar." },
      ],
    },
    {
      id: "busca-e-filtrar",
      title: "Buscar e filtrar",
      body: [
        "- **Buscar anúncio, MLB, SKU ou pedido**: aceita um termo ou uma lista colada (separada por vírgula ou linha). Os números de cima passam a ser só os da busca.",
        "- **Filtrar › margem**: **Todas**, **Abaixo da margem de venda**, **Sem custo** e **Com rebate**, com a contagem. Clique em **Ver N vendas**. Com mais de uma conta, dá para escolher as contas também.",
        "",
        "Os números **abaixo da margem de venda** e **sem custo** do topo também filtram a lista ao clicar.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/pedidos-05-filtrar.png", caption: "Filtrar por margem: abaixo da margem de venda, sem custo e com rebate." },
      ],
    },
    {
      id: "sem-custo",
      title: "Venda sem custo: preencher na própria linha",
      body: [
        "Venda de SKU sem custo mostra o campo **R$ sem custo** em amarelo na coluna **custo un.**, e **sobrou** e **margem** ficam em branco.",
        "",
        "Clique no campo, digite o custo unitário e confirme: o custo é gravado no SKU (vale para os anúncios dele e para as próximas vendas) e a venda é recalculada.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/pedidos-01-hoje.png", caption: "A venda da lâmpada sem custo: o campo amarelo na coluna \"custo un.\"." },
      ],
    },
    {
      id: "painel-da-venda",
      title: "O painel da venda",
      body: [
        "Clique numa venda para abrir o painel: **\"Pedido N · hoje HH:MM\"**, o anúncio, as abas **Resumo** e **Histórico** e as setas para a venda anterior e a próxima.",
        "",
        "**Esta venda**: **Vendido**, **Comissão do Mercado Livre** (com o tipo e o percentual), **Frete que você pagou**, **Imposto**, **Custo do produto** e **Sobrou**, com a margem.",
        "- **+ Adicionar custo**: lança um custo só deste pedido (por exemplo, um frete pago por fora ou uma embalagem especial).",
        "",
        "**Anúncio agora**: a conta do mesmo anúncio com o preço de hoje, para comparar com o da venda. **Abrir em Anúncios ↗** abre o anúncio na lista de Anúncios, com o painel dele.",
      ].join("\n"),
      tip: "Pergunta comum: \"por que essa venda sobrou pouco?\". Abra o painel e leia a conta linha a linha com o cliente; quase sempre é frete ou promoção.",
      images: [
        { file: "leverprice/pedidos-07-painel-da-venda.png", caption: "Painel da venda: a conta desta venda e o anúncio agora." },
      ],
    },
  ],
};
