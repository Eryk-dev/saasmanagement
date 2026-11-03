// Guia do LeverPrice: a tela Produtos (03/11/2026). Prints da UI real (develop)
// com dados fictícios; tirados em 1440 px de largura porque em 1280 px o filtro
// "Fornecedor" invade a barra da esquerda. Fatos do código: v3/screens/Produtos.tsx,
// v3/produtos/logic.ts e o e2e de Produtos.

export default {
  key: "leverprice-produtos",
  version: 1,
  title: "LeverPrice · Produtos: custos, imposto e margens por SKU",
  summary: "Onde o cliente cadastra o custo de cada SKU (sem custo o robô não age), escolhe a regra de imposto, ajusta margens por produto, sobe a planilha de custos e faz alterações em massa.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "para-que-serve",
      title: "Para que serve Produtos",
      body: [
        "Em **Produtos** cada linha é um **SKU**: o mesmo produto pode estar em vários anúncios, e o custo cadastrado aqui vale para todos os anúncios com aquele SKU.",
        "",
        "O título resume o que existe: **\"N produtos e M anúncios sem custo\"**. Os anúncios sem custo aparecem no fim da lista, com o campo de custo vazio.",
        "",
        "Colunas: **produto** (SKU, nome, fornecedor), **custo**, **regra de imposto**, **margem** (a margem de venda em vigor) e **contas** (em quantas contas do Mercado Livre o SKU tem anúncio).",
        "",
        "**Por que importa:** sem custo o LeverPrice não calcula a margem e o robô não mexe naquele anúncio. É a primeira tarefa depois do primeiro acesso.",
        "",
        "> Aqui ficam os seus produtos. O mais importante é o custo: com ele o LeverPrice sabe quanto sobra em cada venda.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/produtos-01-lista.png", caption: "Produtos: um SKU por linha, com custo, regra de imposto, margem e contas." },
      ],
    },
    {
      id: "barra",
      title: "A barra de cima: fornecedor, busca, filtros e planilha",
      body: [
        "- **Fornecedor**: mostra só os produtos de um fornecedor.",
        "- **Buscar produto ou SKU**: busca pelo SKU ou pelo nome. Com **SKU parcial** ligado, acha os SKUs que contêm o que foi digitado (útil para famílias, como \"PST-\").",
        "- **Filtrar**: custo **Todos**, **Com custo** ou **Sem custo**, com a contagem de cada um. Clique em **Ver …** para aplicar; o filtro aplicado vira um chip com **×** para tirar.",
        "- **Novo produto**, **Planilha de exemplo** e **Subir planilha**: nos próximos passos.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/produtos-02-barra-de-ferramentas.png", caption: "Fornecedor, busca, SKU parcial, Filtrar, Novo produto, Planilha de exemplo e Subir planilha." },
        { file: "leverprice/produtos-03-filtrar.png", caption: "Filtrar por custo: Todos, Com custo ou Sem custo." },
      ],
    },
    {
      id: "sem-custo",
      title: "Cadastrar o custo na linha (anúncios sem custo)",
      body: [
        "O jeito mais rápido para poucos SKUs: abra o recorte sem custo (card **anúncios sem custo cadastrado** do Início, ou **Filtrar › Sem custo**). O título vira **\"N anúncios sem custo\"** e cada linha traz **SKU**, **anúncio**, **custo** e **regra de imposto**.",
        "1. Clique no campo **R$ Custo** da linha.",
        "2. Digite o custo unitário (quanto o cliente paga pelo produto) e aperte **Enter**.",
        "3. A linha vira produto e sai da lista; o título diminui.",
        "",
        "Anúncio **Sem SKU** não tem campo de custo: o cliente precisa colocar o SKU no anúncio do Mercado Livre primeiro (o custo é sempre por SKU).",
        "",
        "Comece pelos mais vendidos: é onde o robô faz diferença primeiro.",
        "",
        "> Vamos começar pelos que mais vendem. Me fala o custo desse aqui, quanto você paga nele?",
      ].join("\n"),
      tip: "Custo é o que o cliente paga pelo produto (com IPI e frete de compra, se ele considera). Não é o preço de venda. Erro aqui vira preço errado: confira os primeiros com ele.",
      images: [
        { file: "leverprice/produtos-11-sem-custo.png", caption: "Recorte \"Sem custo\": cada linha com o campo de custo e a regra de imposto." },
        { file: "leverprice/produtos-12-custo-na-linha.png", caption: "Custo digitado na linha: Enter grava e a linha vira produto." },
      ],
    },
    {
      id: "planilha-de-exemplo",
      title: "Planilha de exemplo: baixar para preencher os custos",
      body: [
        "Para muitos SKUs, use a planilha. Clique em **Planilha de exemplo**:",
        "- **Em branco**: só o modelo, com as colunas certas.",
        "- **Lote 1** (e depois Lote 2, 3...): a planilha já preenchida com os produtos do cliente e, em seguida, os SKUs dos anúncios sem custo, em lotes de até 1.000 linhas. Cada lote baixado libera o próximo até acabar.",
        "",
        "O cliente preenche a coluna de custo (no Excel ou no Google Planilhas, salvando em .xlsx) e sobe pelo **Subir planilha**.",
        "",
        "> Vou baixar uma planilha com todos os seus SKUs. Você ou o seu financeiro preenche o custo e me devolve, ou sobe direto aqui.",
      ].join("\n"),
      tip: "Se o cliente já tem os custos no ERP, peça a exportação e cole na coluna de custo da planilha do lote, casando pelo SKU.",
      images: [
        { file: "leverprice/produtos-09-planilha-de-exemplo.png", caption: "Planilha de exemplo: em branco ou em lotes com os SKUs do cliente." },
      ],
    },
    {
      id: "subir-planilha",
      title: "Subir planilha: conferir a prévia antes de gravar",
      body: [
        "Clique em **Subir planilha** e escolha o arquivo. Antes de gravar, o LeverPrice mostra a prévia **\"Subir N linhas da planilha?\"**:",
        "- **A planilha cria X e atualiza Y produtos.**",
        "- **Ainda sem anúncio: o custo fica guardado**: SKUs que ainda não têm anúncio; o custo vale quando o anúncio aparecer.",
        "- **Custo arredondado para centavos**: linhas com mais de duas casas.",
        "- **Linhas ficam de fora** (em vermelho), com a linha, o SKU e o motivo de cada uma (por exemplo **Custo deve ser positivo**, **SKU é obrigatório**).",
        "",
        "Se estiver certo, clique em **Subir N** (só as linhas válidas). No fim aparece uma frase com quantos produtos foram gravados e quantas linhas foram rejeitadas. Corrija as rejeitadas na planilha e suba de novo: as que já entraram só são atualizadas.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/produtos-10-previa-da-planilha.png", caption: "Prévia da planilha: o que cria, o que atualiza e as linhas que ficam de fora, com o motivo." },
      ],
    },
    {
      id: "novo-produto",
      title: "Novo produto (SKU que ainda não tem anúncio)",
      body: [
        "**Novo produto** abre **\"Novo produto na conta X\"** com **SKU** (igual ao do anúncio no Mercado Livre), **nome**, **custo** e **preço mínimo**. **Cadastrar** grava.",
        "",
        "Use para deixar o custo pronto antes de publicar um anúncio novo. Para produto que já tem anúncio, é mais rápido pelo campo de custo na linha.",
      ].join("\n"),
      tip: "O SKU precisa ser exatamente igual ao do anúncio (letras, traços e espaços). Diferente, o LeverPrice não liga o custo ao anúncio.",
      images: [
        { file: "leverprice/produtos-08-novo-produto.png", caption: "Novo produto: SKU, nome, custo e preço mínimo." },
      ],
    },
    {
      id: "imposto-na-linha",
      title: "Regra de imposto na linha",
      body: [
        "A coluna **regra de imposto** mostra a alíquota que vale para o SKU: o padrão da conta (o imposto do primeiro acesso, por exemplo **8%**) ou uma regra própria, como **Monofásico · 4,3%**.",
        "",
        "Clique na pílula da linha e escolha a regra. As regras são criadas em **Configurações › Imposto › Nova regra**.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/produtos-04-regra-de-imposto-na-linha.png", caption: "A regra de imposto escolhida na própria linha do produto." },
      ],
    },
    {
      id: "em-massa",
      title: "Alterar vários produtos de uma vez (Imposto e Margem)",
      body: [
        "1. Marque as caixas das linhas, ou a caixa do cabeçalho para a tela inteira.",
        "2. Aparece a faixa **\"Os N desta tela estão selecionados.\"** com **Selecionar todos os N** para pegar o recorte inteiro (por exemplo, todos os SKUs de uma busca).",
        "3. Na barra escura de baixo: **Imposto** (escolher a regra) ou **Margem** (margens próprias para os selecionados).",
        "4. O LeverPrice pede confirmação (\"Aplicar … em N produtos?\") e mostra o resultado numa frase.",
        "",
        "Exemplo comum: buscar \"OLE-\" com **SKU parcial**, selecionar todos e aplicar a regra **Monofásico** de uma vez.",
      ].join("\n"),
      tip: "Antes de aplicar em todos os N, confira o título: ele diz exatamente o recorte (busca e filtros) que vai ser alterado.",
      images: [
        { file: "leverprice/produtos-05-selecao.png", caption: "Seleção: a faixa \"Selecionar todos os N\" e a barra com Imposto e Margem." },
        { file: "leverprice/produtos-06-imposto-em-massa.png", caption: "\"Qual regra de imposto?\": a regra para todos os selecionados." },
      ],
    },
    {
      id: "painel-do-produto",
      title: "O painel do produto",
      body: [
        "Clique no produto (SKU ou nome) para abrir o painel. No topo, o SKU e \"produto · N anúncios em N contas\".",
        "- **nome**: vem do título do anúncio; **editar** troca.",
        "- **custo** e **regra de imposto**.",
        "- **margem de venda**, **margem cheia** e **teto**: em cinza, as que o produto herda da conta; digitar cria margens próprias para este SKU.",
        "- **preço mínimo**: o robô nunca põe o anúncio abaixo dele, nem em promoção.",
        "- **fornecedor**.",
        "- **Em N contas**: imposto e margem de venda que valem em cada conta e quantos anúncios.",
        "",
        "**Salvar** grava; **Salvar e próximo** grava e já abre o próximo produto da lista (bom para revisar custos em sequência). \"Vale para N anúncios\" lembra quantos anúncios mudam.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/produtos-07-painel-do-produto.png", caption: "Painel do produto: custo, imposto, margens, preço mínimo, fornecedor e as contas." },
      ],
    },
  ],
};
