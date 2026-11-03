// Guia LeverAds · Compatibilidades (03/11/2026): a tela /compatibility, que
// propaga a lista de veículos de um anúncio base. Prints da UI real com
// backend mockado e dados fictícios.

export default {
  key: "leverads-compatibilidades",
  version: 1,
  title: "LeverAds · Compatibilidades veiculares",
  summary: "Como usar a página Compatibilidades: pegar um anúncio com a lista de veículos certa e propagar essa lista para os anúncios do mesmo produto em todas as contas, com a busca avançada, o histórico e os erros mais comuns. Só para organizações com o módulo de Compatibilidades.",
  audience: "integrador",
  product: "leverads",
  steps: [
    {
      id: "o-que-e",
      title: "Para que serve e quem vê",
      body: [
        "No menu da esquerda, **Compatibilidades** (grupo Operação). O título é **Compatibilidades veiculares**.",
        "",
        "É para autopeças: a lista de veículos compatíveis (a tabela *\"Compatível com\"* do Mercado Livre) dá trabalho para montar. Aqui o cliente usa **um anúncio que já tem a lista certa** como base e copia essa lista para os outros anúncios do mesmo produto, em todas as contas, de uma vez.",
        "",
        "A página **só aparece** quando:",
        "- a organização tem o módulo de **Compatibilidades** contratado/ligado; e",
        "- o usuário é administrador ou tem a permissão de **compatibilidades** (Contas › Usuários).",
        "",
        "Sem o módulo, o item nem aparece no menu. Se o cliente vende autopeças e não tem, é oportunidade de upgrade: fale com o comercial, não prometa na call.",
        "",
        "> fala: Você monta a tabela de carros uma vez, num anúncio, e a gente replica essa tabela pros outros anúncios do mesmo produto nas suas outras contas.",
      ].join("\n"),
      tip: "Mesmo fluxo da página Editar: colar o anúncio base, conferir a lista, aplicar. Quem aprendeu um aprende o outro.",
      images: [
        { file: "leverads/compatibilidades-01-tela-inicial.png", caption: "Compatibilidades veiculares: o campo do anúncio base e o histórico das propagações." },
      ],
    },
    {
      id: "anuncio-base",
      title: "1. Colar o anúncio base (o que tem a lista certa)",
      body: [
        "No card **01 Anúncio base** (*origem das compatibilidades*), colar o **link, ID, MLB ou SKU** do anúncio cuja lista de veículos está correta. A busca roda sozinha.",
        "",
        "- **Link/ID/MLB**: a base aparece direto, com foto, título, conta, preço e, em verde, **N compatibilidades** (quantos veículos ele tem).",
        "- **SKU**: aparece a lista de anúncios com aquele SKU em todas as contas, com o filtro **Todos · Mercado Livre · Shopee**; clicar em **Usar como base →** no anúncio certo.",
        "",
        "O selo **Todos os canais** indica que a busca olha Mercado Livre e Shopee juntos; não há seletor de canal: o canal do anúncio base define o resto. Na Shopee, o cartão da base mostra os veículos como etiquetas (marca · modelo · ano · versão).",
      ].join("\n"),
      tip: "Peça ao cliente o anúncio que ele considera \"o certo\" (normalmente o da conta principal, o mais vendido). A lista dele vai substituir a dos destinos.",
      images: [
        { file: "leverads/compatibilidades-03-banner-base.png", caption: "Base escolhida: conta, preço e, em verde, quantas compatibilidades ela tem." },
        { file: "leverads/compatibilidades-10-busca-base-sku.png", caption: "Colando um SKU: os anúncios desse SKU em todas as contas para escolher a base." },
      ],
    },
    {
      id: "sem-compatibilidade",
      title: "Erro: o anúncio não tem compatibilidades",
      body: [
        "Se o anúncio colado não tem nenhuma compatibilidade no Mercado Livre, a base não é aceita: o campo é limpo e aparece o aviso vermelho *MLB… nao possui compatibilidades ativas.*",
        "",
        "O que fazer:",
        "- usar outro anúncio do mesmo produto que já tenha a lista; ou",
        "- montar a lista primeiro: no Mercado Livre, ou pela LeverAds em **Editar › Editar dados… › Compatibilidades** (com o módulo ligado), e depois voltar aqui para propagar.",
        "",
        "Outros erros comuns: *Item não encontrado nas contas conectadas* (a conta do anúncio não está conectada ou caiu: ver Contas).",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/compatibilidades-08-sem-compatibilidade.png", caption: "Anúncio sem compatibilidades: o campo volta vazio e o aviso vermelho aparece embaixo." },
      ],
    },
    {
      id: "aplicar-em",
      title: "2. Aplicar em: conferir os anúncios que recebem a lista",
      body: [
        "Com a base aceita, a LeverAds busca sozinha os anúncios com o **mesmo SKU** nas outras contas e abre o card **02 Aplicar em**, com todos **marcados**: a base no topo (*(base)*) e os demais com conta, código, preço e situação (ativo/pausado).",
        "",
        "- Clicar na linha marca ou desmarca.",
        "- **Selecionar todos / Desmarcar todos** no canto, ao lado de *N de M selecionados*.",
        "- Se nenhum outro anúncio tiver o SKU: *Nenhum outro anúncio encontrado com esse SKU. Apenas o anúncio base será editado.*",
        "",
        "> fala: Esses aqui são os anúncios do mesmo produto nas suas outras contas. Todos vão ficar com a mesma tabela de carros da base.",
      ].join("\n"),
      tip: "A lista do destino é **substituída** pela da base, não somada. Se uma conta tem uma versão do produto com aplicação diferente, desmarque.",
      images: [
        { file: "leverads/compatibilidades-02-base-e-destinos.png", caption: "Base com 37 compatibilidades e o card Aplicar em, com os anúncios do mesmo SKU marcados." },
        { file: "leverads/compatibilidades-04-aplicar-em.png", caption: "Aplicar em: marque ou desmarque cada anúncio; Selecionar/Desmarcar todos no canto." },
      ],
    },
    {
      id: "busca-avancada",
      title: "Busca avançada: destinos por SKU ou MLB específico",
      body: [
        "Quando o SKU não é igual entre as contas (ou o cliente quer incluir um anúncio de outro SKU, como um kit), abrir **Buscar destinos por SKU ou MLB específico (avançado)** embaixo da lista:",
        "1. Colar SKUs e/ou MLBs separados por vírgula, espaço ou quebra de linha (na Shopee, IDs). Números de 10 dígitos soltos são lidos como MLB.",
        "2. O contador mostra *N/50 itens · X SKUs · Y MLBs* (limite de 50 por busca).",
        "3. Clicar em **Buscar manualmente**.",
        "",
        "O resultado **substitui** a lista do card. O que não foi achado aparece em amarelo: *SKUs sem resultados: …* e *MLBs sem resultados: …*.",
        "",
        "Se a base não tem SKU, essa área já vem aberta: é o único jeito de escolher destinos.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/compatibilidades-06-busca-avancada.png", caption: "Busca avançada: SKUs e MLBs colados, contador de itens e os que não foram encontrados." },
      ],
    },
    {
      id: "salvar-e-propagar",
      title: "Salvar e propagar",
      body: [
        "A barra no fim do fluxo resume: **Propagar para N anúncios em X lojas:** *37 compatibilidades aplicadas em todos os anúncios marcados*, com as etiquetas conta · anúncio de cada destino.",
        "",
        "Clicar em **Salvar e propagar**. **Cancelar** limpa tudo e volta ao início.",
        "",
        "Se a organização usa a **ficha permanente de compatibilidade** e o SKU já tem uma lista diferente salva, o navegador pergunta antes: *Este SKU tem uma ficha permanente de compatibilidade (revisão X, N veículos). Trocar pela lista do anúncio base, com M veículos?* Confirmar troca a ficha do SKU, e os anúncios dela passam a seguir a lista nova; cancelar não muda nada.",
      ].join("\n"),
      tip: "Confira o número de lojas no resumo antes de clicar: é a forma rápida de ver se alguma conta ficou de fora.",
      images: [
        { file: "leverads/compatibilidades-05-salvar-e-propagar.png", caption: "Resumo antes de propagar: quantos anúncios, em quantas lojas e quantas compatibilidades." },
      ],
    },
    {
      id: "enviado-e-historico",
      title: "Enviado e histórico: acompanhar o resultado",
      body: [
        "Depois de propagar, aparece o card **Enviado**: *Copiando N destinos em segundo plano. Acompanhe no histórico abaixo.* O cliente pode sair da tela.",
        "",
        "O card **Histórico (N)** mostra cada propagação: data, origem, SKUs, status (**Sucesso**, **Parcial**, **Erro**, *Copiando...*), destinos, sucessos e erros. Os filtros **Todos · Em andamento · Sucesso · Erros · Parcial** ajudam a achar; enquanto há uma em andamento, a lista se atualiza sozinha.",
        "",
        "Clicar na linha abre **Erros (N)**, com o anúncio, a conta e o motivo, e **Sucesso (N)**. O motivo mais comum é a categoria do anúncio de destino não aceitar compatibilidades (anúncio cadastrado na categoria errada).",
      ].join("\n"),
      tip: "Erro de categoria se resolve no anúncio de destino (recategorizar), não aqui. Anote o MLB e trate com o cliente depois da call.",
      images: [
        { file: "leverads/compatibilidades-07-enviado.png", caption: "Enviado: a propagação roda em segundo plano e entra no histórico." },
        { file: "leverads/compatibilidades-09-historico.png", caption: "Histórico com uma propagação Parcial aberta: o destino com erro e o motivo." },
      ],
    },
    {
      id: "pela-pagina-editar",
      title: "Também pela página Editar: tirar e adicionar veículos",
      body: [
        "Esta página **copia** a lista como está. Para **mudar** a lista (tirar um veículo, adicionar um modelo) e já propagar, use **Editar**: colar o anúncio base, marcar os anúncios, **Editar dados…** e a seção **06 Compatibilidades**.",
        "",
        "Lá a lista vem agrupada por modelo (ex.: *Volkswagen Gol 2013–2015*), com **×** para tirar um modelo inteiro, a seta para abrir e tirar veículo por veículo, e **Adicionar veículos** buscando marca, modelo e anos numa linha só (*vw gol 2008 2013*). Ao aplicar, a base fica com a lista nova e ela é copiada para os outros selecionados.",
        "",
        "Compatibilidade gerida pelo catálogo do Mercado Livre aparece só como marca e total, e não pode ser apagada pela API.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverads/editar-20-editar-dados-compat.png", caption: "Editar › Editar dados… › Compatibilidades: a lista do base por modelo e a busca para adicionar veículos." },
      ],
    },
  ],
};
