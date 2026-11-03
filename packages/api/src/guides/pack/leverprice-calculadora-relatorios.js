// Guia do LeverPrice: Calculadora e Relatórios, as telas que só aparecem quando
// ligadas para a empresa (03/11/2026). Prints da UI real (develop) com dados
// fictícios; a Calculadora em 1440 px para caber a tabela inteira. Fatos do
// código: v3/routes.ts (NAV_V3), App.tsx (flags leverprice_calculator_enabled e
// leverprice_reports_enabled), v3/screens/Calculadora.tsx e v3/relatorios/.

export default {
  key: "leverprice-calculadora-relatorios",
  version: 1,
  title: "LeverPrice · Calculadora e Relatórios (quando ligados para a empresa)",
  summary: "A Calculadora de preço (preço \"De\" e \"Por\" no Clássico e no Premium a partir do custo, sem precisar de anúncio) e os Relatórios (DRE, lucro por produto e fornecedor, promoções, relatório por conversa e envio por e-mail). As duas telas só aparecem na barra da esquerda quando estão ligadas para a empresa.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "quando-aparecem",
      title: "Quando estas telas aparecem",
      body: [
        "**Calculadora** e **Relatórios** não fazem parte do LeverPrice de todo cliente: só aparecem na barra da esquerda (entre **Produtos** e **Configurações**) quando estão ligadas para a empresa. Sem a liberação, o item não aparece e o link direto cai no Início.",
        "",
        "Antes da call, confira se o cliente tem essas telas. Se não tem, não mostre nem prometa: se ele pedir, registre o pedido no card do cliente.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/calculadora-relatorios-03-relatorios-central.png", caption: "Barra da esquerda com Calculadora e Relatórios ligados para a empresa." },
      ],
    },
    {
      id: "calculadora",
      title: "Calculadora de preço: o preço para anunciar a partir do custo",
      body: [
        "Serve para precificar um produto **antes de ter anúncio** (produto novo, cotação de fornecedor).",
        "",
        "**Seus números** (esquerda):",
        "- **Conta**: imposto, custos e margens vêm dela;",
        "- **Custo do produto**: quanto o cliente paga por unidade. Sem custo, a direita mostra **\"Digite o custo do produto\"**;",
        "- **Imposto**: o padrão da conta ou uma regra de imposto;",
        "- **Margens** (da empresa): **Margem de venda** (o preço \"Por\", na promoção) e **Margem cheia** (o preço \"De\", do anúncio);",
        "- **Custos além do ML**: os outros custos da conta, cada um com a caixa para incluir ou não; **+ Custo** e **+ Crédito** para simular outros;",
        "- **Mercado Livre** (cotado no ML): comissão do Clássico e do Premium, **Peso do pacote** (e **+ Medidas do pacote**) e o frete abaixo e acima de R$ 79.",
        "",
        "**Preço para anunciar** (direita): o **De** (preço do anúncio) e o **Por** (preço na promoção, com o desconto) no **Clássico** e no **Premium**, com a conta inteira embaixo (comissão, frete, imposto, custo, custos além do ML, **Sobra** e **Margem**). Digitar um preço numa coluna mostra a margem que ele dá; **Voltar ao preço das margens** desfaz.",
        "",
        "> Me fala um produto que você quer lançar e quanto ele te custa: a calculadora mostra por quanto anunciar no Clássico e no Premium para ganhar a sua margem.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/calculadora-relatorios-01-calculadora.png", caption: "Calculadora sem custo: os números da conta preenchidos e o pedido do custo." },
        { file: "leverprice/calculadora-relatorios-02-calculadora-com-custo.png", caption: "Com o custo: o preço \"De\" e \"Por\" no Clássico e no Premium, com a conta." },
        { file: "leverprice/calculadora-relatorios-05-calculadora-mercado-livre.png", caption: "Comissão, peso do pacote e frete cotados no Mercado Livre." },
      ],
    },
    {
      id: "relatorios-central",
      title: "Relatórios: a central",
      body: [
        "Em **Relatórios**:",
        "- **Monte um relatório conversando**: o cliente escreve a pergunta (\"quanto sobrou por fornecedor nos últimos 3 meses?\") e clica em **Montar**; há sugestões prontas embaixo. A IA monta o relatório e conversa sobre ele.",
        "- **Modelos prontos**: **DRE do período**, **DRE mês a mês**, **Lucro por produto · curva ABC**, **Lucro por fornecedor**, **Promoções por campanha** e **Vendas abaixo da margem**, cada card com o destaque do período.",
        "- **Salvos da empresa**: relatórios salvos por qualquer pessoa da empresa, com a marca de envio por e-mail (\"Mensal\").",
        "- **Suas conversas**: as conversas com a IA, visíveis só para quem conversou, por 30 dias.",
        "- **Envios agendados** (no topo): os relatórios que saem por e-mail.",
      ].join("\n"),
      tip: "Relatório só é bom com custo cadastrado: vendas sem custo ficam fora das contas. Na integração, mostre a central e volte a ela no acompanhamento, quando os custos estiverem completos.",
      images: [
        { file: "leverprice/calculadora-relatorios-03-relatorios-central.png", caption: "Central de Relatórios: conversa, modelos prontos, salvos e conversas." },
      ],
    },
    {
      id: "relatorio-dre",
      title: "Um relatório aberto: o DRE do período",
      body: [
        "Ao abrir um modelo (por exemplo **DRE do período**):",
        "- período (**Este mês**, **Mês passado**, **30 dias**, **12 meses** ou o calendário) e **Comparar com …** o período anterior;",
        "- um comentário da IA sobre o período, com **Perguntar mais**;",
        "- os números de topo: **Vendido**, **Mercado Livre levou**, **Custo dos produtos**, **Sobrou** e **Lucro**;",
        "- avisos do que ficou fora da conta (**vendas sem custo**, **devoluções**), que abrem a lista;",
        "- a tabela do DRE, linha a linha, com o percentual do vendido, o período comparado e a variação.",
        "",
        "No topo: **Salvar** (vira um relatório da empresa), **Enviar por e-mail** (envio mensal ou semanal, por exemplo para o contador) e **Excel**.",
        "",
        "**‹ Relatórios** volta à central.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/calculadora-relatorios-04-relatorio-dre.png", caption: "DRE do período: comentário da IA, números de topo e a tabela linha a linha." },
      ],
    },
  ],
};
