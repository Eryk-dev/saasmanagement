// Guia LeverAds · Planilhas (03/11/2026): a aba /sheets (SheetsPage), com a
// replicação da planilha do Mercado Livre e a planilha do ERP Citel. Prints
// da tela real renderizada com dados fictícios (backend mockado).

export default {
  key: "leverads-planilhas",
  version: 1,
  title: "LeverAds · Planilhas",
  summary: "A aba Planilhas reúne dois adicionais: Replicar planilha (a planilha de anúncios do Mercado Livre da conta principal vira uma planilha por conta, trocando só o código de barras) e a planilha diária de vinculação SKU ↔ anúncio para o ERP Citel.",
  audience: "integrador",
  product: "leverads",
  steps: [
    {
      id: "visao-geral",
      title: "O que é a aba Planilhas e quando aparece",
      body: [
        "A aba **Planilhas** só existe quando a organização tem pelo menos um destes adicionais ligados:",
        "- **Replicar planilha**: para quem cadastra anúncios no Mercado Livre pela planilha de anúncios em massa do próprio ML. Aparece para o administrador e para o operador que pode publicar em conta do Mercado Livre.",
        "- **Vinculação SKU ↔ anúncio (ERP Citel)**: para clientes que usam o ERP Citel.",
        "",
        "Sem nenhum dos dois, a aba some do menu. Com só um, a página mostra só aquele bloco.",
        "",
        "Para que serve a replicação: o cliente monta a planilha uma vez na conta principal, sobe no ML e quer a mesma planilha nas outras contas. O Mercado Livre não aceita o mesmo código de barras (código universal) em contas diferentes, então a LeverAds gera uma planilha por conta trocando **só o código de barras** de cada categoria. Todo o resto fica igual.",
        "",
        "> Você monta a planilha uma vez, na conta principal. Aqui a gente gera uma cópia pronta para cada conta, só trocando o código de barras, e você sobe pelo caminho de sempre do Mercado Livre.",
      ].join("\n"),
      tip: "Esta aba não tem o botão Como usar esta página. Se o cliente não usa a planilha de anúncios em massa do ML, o caminho para replicar anúncios é a aba Copiar, não esta.",
      images: [
        { file: "leverads/planilhas-01-tela-inicial.png", caption: "Aba Planilhas › Replicar planilha, etapa 1: enviar a planilha da conta principal." },
      ],
    },
    {
      id: "enviar-planilha",
      title: "1 · Enviar a planilha da conta principal",
      body: [
        "Na aba **Replicar** (a outra é **Planilhas geradas**), as etapas ficam no topo: **1 · Enviar planilha**, **2 · Códigos de barras**, **3 · Baixar**.",
        "",
        "1. Arraste o arquivo **.xlsx** do Mercado Livre para o quadro **Arraste a planilha aqui**, ou clique nele e escolha o arquivo.",
        "2. A planilha é lida e aparece o resumo: nome do arquivo, \"N categorias · N anúncios na planilha\" e um chip por aba (categoria), com quantos anúncios tem e o código de barras usado hoje (**hoje 789…**).",
        "3. Arquivo errado? **Trocar planilha**.",
        "",
        "Erros comuns:",
        "- Use **a mesma planilha que foi subida na conta principal**, baixada do ML.",
        "- **Não abra e salve em outro programa** (Google Planilhas, LibreOffice, outra versão do Excel): as listas e validações do Mercado Livre se perdem e a leitura falha ou o ML recusa depois.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/planilhas-02-planilha-lida.png", caption: "Planilha lida: 3 categorias, 111 anúncios e o código de barras atual de cada aba." },
      ],
    },
    {
      id: "codigos-de-barras",
      title: "2 · Escolher as contas e informar os códigos de barras",
      body: [
        "1. Em **Contas de destino**, clique nas contas que vão receber a planilha (o chip fica marcado). Aparecem as contas do Mercado Livre conectadas.",
        "2. Para cada conta marcada abre um quadro com uma linha por categoria: **Categoria** (com o caminho e os SKUs da aba), **Anúncios** e **Código de barras nesta conta**.",
        "3. Digite o código de barras (EAN/GTIN) daquela categoria naquela conta. Um código por categoria.",
        "",
        "Atalho: se o cliente tem os códigos numa coluna do Excel, copie a coluna inteira e cole no primeiro campo: preenche daqui para baixo, um por linha.",
        "",
        "O campo confere o dígito verificador na hora: código digitado errado fica em vermelho com **Dígito verificador não confere**.",
      ].join("\n"),
      tip: "Os códigos de barras são do cliente (comprados na GS1 ou do fabricante). Peça a lista antes da call: sem eles não dá para gerar.",
      images: [
        { file: "leverads/planilhas-03-codigos-com-erro.png", caption: "Códigos de uma conta: um repetido em duas categorias e um com dígito errado." },
        { file: "leverads/planilhas-05-codigos-ok.png", caption: "Conta com um código válido e diferente por categoria." },
      ],
    },
    {
      id: "avisos",
      title: "Os avisos que impedem gerar",
      body: [
        "Enquanto houver problema, aparece a lista em amarelo acima do botão e o **Gerar** fica desligado:",
        "- **faltam N código(s) de barras**: a conta marcada tem categoria sem código;",
        "- **… não é um código válido**: dígito verificador errado (erro de digitação);",
        "- **o código … está repetido em …**: o mesmo código em duas categorias da mesma conta. O Mercado Livre aceita um código por categoria; é o erro que derruba o lote depois de publicado.",
        "",
        "Resolva cada linha e o botão libera sozinho.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/planilhas-04-avisos.png", caption: "Avisos: código inválido, código repetido entre categorias e códigos faltando." },
      ],
    },
    {
      id: "gerar-e-subir",
      title: "3 · Gerar, baixar e subir no Mercado Livre",
      body: [
        "1. Clique em **Gerar N planilhas** (N = contas marcadas).",
        "2. O download começa sozinho: com uma conta, um .xlsx; com várias, um .zip. Cada arquivo leva o nome da conta.",
        "3. A tela **Planilhas prontas** confirma o nome do arquivo baixado. **Voltar aos códigos** permite ajustar e gerar de novo; **Replicar outra planilha** recomeça.",
        "4. O cliente sobe **cada arquivo na conta correspondente**, logado nela, pelo caminho de sempre do Mercado Livre (planilha de anúncios em massa).",
        "",
        "O envio ao Mercado Livre é manual: não existe API para isso, então a LeverAds não sobe a planilha sozinha.",
        "",
        "> Cada arquivo tem o nome da conta. Entra em cada conta e sobe o arquivo dela, igual você fez na principal.",
      ].join("\n"),
      tip: "Na call, acompanhe o envio de pelo menos uma conta na tela do cliente: é ali que aparecem os erros do próprio ML.",
      images: [
        { file: "leverads/planilhas-07-prontas.png", caption: "Planilhas prontas: o arquivo foi baixado; suba cada um na sua conta." },
      ],
    },
    {
      id: "planilhas-geradas",
      title: "Planilhas geradas: controlar quais contas já receberam",
      body: [
        "A aba **Planilhas geradas** guarda cada lote: planilha de origem, data, categorias, anúncios e \"N de M enviadas\".",
        "",
        "Para cada conta de destino:",
        "- **Baixar**: baixa de novo o arquivo daquela conta;",
        "- **Já subi no Mercado Livre**: marque quando subir. Fica **Enviada** com data e hora; sem marcar, **Pendente**.",
        "",
        "A marcação é do lote, não do navegador: quem mais da equipe abrir vê o mesmo status. **Apagar** remove o lote. As planilhas ficam guardadas por 90 dias.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/planilhas-08-geradas.png", caption: "Planilhas geradas: uma conta já enviada, outra pendente." },
      ],
    },
    {
      id: "citel",
      title: "Vinculação SKU ↔ anúncio (ERP Citel)",
      body: [
        "Só aparece com o adicional **Citel** ligado. Serve para o ERP Citel saber qual anúncio corresponde a cada SKU.",
        "",
        "- **Todo dia às 04:00** o sistema gera a planilha com o SKU e o ID de cada anúncio criado pela plataforma, no padrão de importação do Citel. É só baixar.",
        "- Precisa de uma versão mais nova? **Gerar agora — Mercado Livre** ou **Gerar agora — Shopee**. A linha mostra **Gerando…** e atualiza sozinha.",
        "- Cada linha mostra a plataforma, a data, se foi **automática** ou **a pedido de** alguém, e os **Vínculos** (linhas e anúncios).",
        "- **Baixar** baixa o CSV e marca **Baixada** com data e quem baixou. O quadro **Pendente / Baixada** também pode ser marcado à mão.",
        "",
        "No canto, \"N a baixar\" ou **Tudo baixado** resume o que falta importar no ERP.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/planilhas-09-citel.png", caption: "Planilha do ERP Citel: uma gerando, uma a baixar e uma já baixada." },
      ],
    },
  ],
};
