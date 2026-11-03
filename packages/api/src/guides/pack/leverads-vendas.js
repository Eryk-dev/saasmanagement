// Guia LeverAds · Vendas (aba /dashboard). Prints com dados fictícios, tela
// renderizada com o backend mockado (03/11/2026).

export default {
  key: "leverads-vendas",
  version: 1,
  title: "LeverAds · Vendas: o painel de resultado",
  summary: "O que cada número da aba Vendas significa, quem enxerga a aba, os resumos do topo (Vendas geradas e Cota) e como apresentar o painel ao cliente, inclusive nos primeiros dias, quando ainda não há venda.",
  audience: "integrador",
  product: "leverads",
  steps: [
    {
      id: "o-que-e",
      title: "Para que serve a aba Vendas e quem enxerga",
      body: [
        "A aba **Vendas** (menu da esquerda, grupo *Operação*) é o painel de resultado: o faturamento de hoje, quanto dele veio dos anúncios que a LeverAds criou e a evolução dos últimos dias. É a tela que prova o valor do produto para o dono da loja.",
        "",
        "Quem vê a aba:",
        "- o **dono da conta** (o e-mail do cadastro) sempre vê;",
        "- outro usuário só vê se o dono liberar em **Contas › Usuários**, na opção **Ver as vendas da empresa**. Nem um administrador consegue liberar para outra pessoa: só o dono.",
        "",
        "Os números vêm das contas conectadas, no fuso de Brasília, e são conferidos a cada 5 minutos. Pedidos cancelados ou não pagos não contam. O subtítulo da tela diz \"Contas do Mercado Livre conectadas\", mas as lojas Shopee também entram (na tabela por conta aparecem com \"(Shopee)\").",
        "",
        "No topo, o botão **Resumo / Detalhado** troca o nível de detalhe: o Resumo mostra os cartões e o gráfico de 14 dias; o Detalhado acrescenta as tabelas por conta, os últimos 7 dias e a explicação de cada cálculo.",
      ].join("\n"),
      tip: "Se o cliente diz que não acha a aba Vendas, confira se ele entrou com o e-mail do dono. Funcionário só enxerga depois que o dono libera em Contas › Usuários.",
      images: [
        { file: "leverads/vendas-01-resumo.png", caption: "Aba Vendas no modo Resumo: cartões do dia, desde a instalação e faturamento dos últimos 14 dias." },
      ],
    },
    {
      id: "cartoes-hoje",
      title: "Primeira linha: o dia de hoje e o total gerado",
      body: [
        "- **Faturamento hoje**: tudo o que a loja vendeu hoje nas contas conectadas, com o número de vendas.",
        "- **Gerado pela LeverAds hoje**: a parte desse faturamento que veio de anúncios criados pela LeverAds (cópias e anúncios criados na plataforma). Mostra quantas vendas foram influenciadas e o percentual do faturamento do dia.",
        "- **Gerado pela LeverAds no total**: a soma desde a instalação, com o número de vendas.",
        "",
        "Importante para explicar: o \"gerado\" soma só os **itens** do pedido cujo anúncio a LeverAds criou, não o pedido inteiro. Se o comprador levou um item copiado e outro antigo, só o copiado entra.",
        "",
        "> Esse cartão verde é o que os anúncios que a gente replicou já venderam. Ele cresce conforme as cópias começam a vender nas outras contas.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/vendas-02-cards.png", caption: "Faturamento hoje, Gerado pela LeverAds hoje e Gerado pela LeverAds no total." },
      ],
    },
    {
      id: "desde-instalacao",
      title: "Segunda linha: participação, crescimento e tempo economizado",
      body: [
        "- **Participação média da LeverAds**: quanto do faturamento veio dos anúncios LeverAds desde a 1ª venda de um deles (a data aparece embaixo).",
        "- **Crescimento após a LeverAds**: a média diária de faturamento depois da 1ª venda LeverAds comparada com até 30 dias antes. Mostra as duas médias (antes → depois).",
        "- **Tempo economizado**: anúncios criados pela plataforma × 15 minutos, o tempo médio de montar um anúncio à mão no Mercado Livre.",
        "",
        "O crescimento não aparece de imediato. No lugar do número fica **…** com o motivo:",
        "- *disponível após 7 dias da 1ª venda*;",
        "- *coletando o histórico anterior à instalação*;",
        "- *sem base de comparação suficiente* (a loja não tinha vendas antes).",
      ].join("\n"),
      tip: "Não prometa o percentual de crescimento na call: ele só sai depois de 7 dias de vendas dos anúncios copiados. Combine de olhar junto com o cliente no acompanhamento.",
      images: [
        { file: "leverads/vendas-03-instalacao.png", caption: "Participação média, crescimento após a LeverAds (média diária antes → depois) e tempo economizado." },
      ],
    },
    {
      id: "grafico",
      title: "Faturamento por dia",
      body: [
        "O gráfico mostra o faturamento de cada dia: em verde a parte **LeverAds**, em cinza as **Demais vendas**. No Resumo são os últimos 14 dias; no Detalhado, 30.",
        "",
        "Passe o mouse sobre uma barra para ver os valores do dia. A barra de hoje é parcial (o dia ainda não terminou).",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/vendas-04-grafico.png", caption: "Faturamento por dia: verde = vendas de anúncios LeverAds; cinza = demais vendas." },
      ],
    },
    {
      id: "detalhado",
      title: "Modo Detalhado: por conta e últimos 7 dias",
      body: [
        "Clique em **Detalhado**, no canto de cima. Aparecem, abaixo do gráfico:",
        "- **Por conta (hoje)**: vendas, faturamento e parte LeverAds de cada conta (lojas Shopee com \"(Shopee)\" ao lado), com o percentual entre parênteses. É aqui que o cliente vê que as contas que recebem as cópias também estão vendendo.",
        "- **Últimos 7 dias**: a mesma conta, dia a dia (a primeira linha é *Hoje*).",
        "",
        "Sem venda hoje, a tabela por conta mostra *Nenhuma venda registrada hoje até agora*.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/vendas-05-por-conta.png", caption: "Por conta (hoje): vendas, faturamento e parte LeverAds de cada conta conectada." },
        { file: "leverads/vendas-06-ultimos-7.png", caption: "Últimos 7 dias, com a parte LeverAds e o percentual de cada dia." },
      ],
    },
    {
      id: "como-calculamos",
      title: "Como calculamos (para responder dúvidas do cliente)",
      body: [
        "No fim do modo Detalhado, o bloco **Como calculamos** explica cada métrica com as palavras do produto. Use-o quando o cliente questionar um número:",
        "- *Gerado pela LeverAds*: só os itens do pedido cujo anúncio foi criado pela LeverAds.",
        "- *Participação média*: parte LeverAds ÷ faturamento total desde a 1ª venda de um anúncio LeverAds.",
        "- *Crescimento*: média diária após a 1ª venda LeverAds comparada aos até 30 dias anteriores (dias completos; hoje fica de fora).",
        "- *Tempo economizado*: anúncios criados × 15 minutos.",
        "",
        "Se o número do painel não bate com o do Mercado Livre, lembre: cancelados e não pagos ficam de fora, e o painel atualiza a cada 5 minutos.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/vendas-07-como-calculamos.png", caption: "Bloco \"Como calculamos\", no fim do modo Detalhado." },
      ],
    },
    {
      id: "vendas-geradas-topo",
      title: "No topo de qualquer tela: Vendas geradas",
      body: [
        "Na barra de cima, à direita, o resumo **Vendas geradas** aparece em todas as telas (para quem vê vendas e com a assinatura ativa). Clique nele para abrir o detalhe:",
        "- **Total (ML + Shopee)**;",
        "- a parte do **Mercado Livre** e a da **Shopee**;",
        "- quantos pedidos e quantos anúncios entraram na conta, e quando foi a última atualização.",
        "",
        "São os pedidos pagos dos anúncios criados pela LeverAds. Esse número é recalculado de tempos em tempos (não a cada venda; o horário aparece no rodapé do quadro), por isso pode diferir um pouco do cartão *Gerado pela LeverAds no total* da aba Vendas, que atualiza a cada 5 minutos.",
      ].join("\n"),
      tip: "Durante o período de teste o topo mostra o chip **Teste X/Y** (cópias usadas do teste) com o botão **Upgrade**, no lugar de Vendas geradas e Cota.",
      images: [
        { file: "leverads/vendas-08-vendas-geradas.png", caption: "Vendas geradas, aberto: total, Mercado Livre, Shopee, pedidos e anúncios." },
      ],
    },
    {
      id: "cota",
      title: "No topo: Cota diária de cópias",
      body: [
        "Ao lado fica a **Cota**: cópias feitas hoje / limite do plano, e quantas publicações foram criadas no Mercado Livre. Clique para ver por conta de destino:",
        "- cada conta de destino tem a própria cota por dia (por exemplo 500);",
        "- **Publicações ML hoje**: anúncios criados hoje em cada conta. O Mercado Livre aceita até 10.000 por dia por conta; em conta de variação (PxV) cada variação copiada é uma publicação;",
        "- a cota reinicia à meia-noite (horário de Brasília); o tempo restante aparece no topo do quadro.",
        "",
        "Só cópias bem-sucedidas e as que ficaram aguardando correção contam. Cópia com erro não gasta cota.",
      ].join("\n"),
      tip: "Cliente com catálogo grande querendo replicar tudo no primeiro dia: mostre a cota e combine o ritmo (os campeões primeiro, o resto ao longo dos dias).",
      images: [
        { file: "leverads/vendas-09-cota.png", caption: "Cota diária aberta: total do plano, cota por conta de destino e publicações no Mercado Livre hoje." },
      ],
    },
    {
      id: "sem-vendas",
      title: "Primeiros dias: \"Nenhuma venda registrada ainda\"",
      body: [
        "Logo depois da integração é normal a aba mostrar **Nenhuma venda registrada ainda** e *Coletando vendas a partir da ativação*. O painel enche conforme as vendas entram nas contas conectadas.",
        "",
        "> Aqui vai aparecer o quanto os anúncios que a gente replicou estão vendendo. Nos primeiros dias ele vai se enchendo; na semana que vem a gente olha junto.",
      ].join("\n"),
      tip: "Use essa tela para marcar o acompanhamento: é ela que mostra o primeiro resultado e abre a conversa da indicação.",
      images: [
        { file: "leverads/vendas-10-vazio.png", caption: "Aba Vendas antes da primeira venda registrada." },
      ],
    },
  ],
};
