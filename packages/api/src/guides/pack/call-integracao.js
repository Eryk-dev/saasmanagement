// Guia comum: a call de integração, do convite ao encerramento (03/11/2026,
// conteúdo aprovado com o usuário: ordem da call, texto de apresentação e
// "qualquer navegador, pelo computador").

export default {
  key: "call-integracao",
  version: 2,
  title: "Call de integração: do convite ao encerramento",
  summary: "Como conduzir a call de integração de um cliente recém-fechado, de LeverAds ou LeverPrice: confirmar, entrar na chamada, apresentar o produto, pedir o compartilhamento de tela, criar a conta, configurar e fechar com o acompanhamento e a indicação.",
  audience: "integrador",
  product: "",
  steps: [
    {
      id: "confirmar",
      title: "No dia: confirmar a call",
      body: [
        "Cliente já pagou: não confirme pagamento nem fale de dinheiro. Mande a confirmação pelo WhatsApp no dia (o card da Integração e Minhas atividades têm o convite pronto):",
        "",
        "> Oi {nome}! Aqui é {seu nome}, da {produto}. Nossa integração é hoje às {hora}, por vídeo: {link}. Pra já sair rodando, entra pelo computador e deixa os logins das contas em mãos, a gente conecta tudo junto na call. Confirma pra mim?",
        "",
        "- O cliente entra **pelo computador**, em qualquer navegador.",
        "- Sem resposta até 30 minutos antes: ligue.",
      ].join("\n"),
      tip: "Se o formulário de integração ainda não foi respondido, mande o link junto: a call rende muito mais com as contas e as regras já em mãos.",
      images: [
        { file: "cockpit/integracao-03-sala-convite.png", caption: "Card da Integração: copiar convite ou mandar no Whats, com o dia, a hora e a sala" },
      ],
    },
    {
      id: "entrar",
      title: "Entrar na chamada",
      body: [
        "Entre **2 minutos antes**. O link da sala está em qualquer um destes lugares no Cockpit:",
        "- **card da Integração**: na linha *Sala*, \"Meet ↗\";",
        "- **▶ Modo integração**: no topo, \"entrar no Meet ↗\";",
        "- **card do Negócio**: \"Entrar na sala ↗\";",
        "- **Minhas atividades**: \"Entrar na integração ↗\".",
        "",
        "Sem sala criada, use \"Criar sala do Meet\" no card do Negócio (precisa da sua conta Google conectada em Configurações → Integrações).",
        "",
        "Abra também o **▶ Modo integração** no card da Integração: ele mostra o checklist como roteiro, os guias de cada passo e o que o cliente respondeu no formulário.",
      ].join("\n"),
      tip: "Deixe o Modo integração numa janela e o Meet em outra: você acompanha o roteiro sem tirar o olho da tela do cliente.",
      images: [
        { file: "cockpit/integracao-03-sala-convite.png", caption: "A sala do Meet no card da Integração (Sala › Meet ↗)" },
        { file: "cockpit/integracao-07-entrar-meet.png", caption: "No Modo integração, o link fica no topo: entrar no Meet ↗" },
      ],
    },
    {
      id: "apresentacao",
      title: "Apresentação (1 minuto)",
      body: [
        "Antes de mexer em qualquer coisa, diga o que vai sair pronto da call. Use **replicar** e **copiar** (nunca \"clonar\").",
        "",
        "**LeverAds**",
        "> Antes de começar, deixa eu te mostrar o que a gente vai deixar rodando hoje. A LeverAds faz o seu catálogo vender em todas as suas contas sem retrabalho: você publica uma vez na conta principal, a conta-mãe, e a gente replica para as outras contas do Mercado Livre e da Shopee, com o estoque integrado e pela API oficial, sem robô de navegador. Cada conta mantém a reputação dela. Hoje a gente conecta suas contas e faz a primeira cópia na sua frente.",
        "",
        "**LeverPrice**",
        "> O LeverPrice cuida do preço dos seus anúncios pelo custo, pela margem e pelo imposto que você cadastra. Ele confere seus anúncios no Mercado Livre o dia todo, mantém o seu lucro dentro do esperado e coloca seus produtos nas promoções que valem a pena. Hoje a gente configura imposto e margem, você escolhe como o robô age e já conecta a conta.",
      ].join("\n"),
      tip: "Não prometa número. Mostre rodando: o resultado aparece nos primeiros dias, e é ele que vai virar a indicação.",
      images: [],
    },
    {
      id: "compartilhar-tela",
      title: "Pedir para o cliente compartilhar a tela no Meet",
      body: [
        "As contas do marketplace são conectadas **no navegador do cliente**, logado na conta dele. Por isso é ele quem compartilha a tela, e você conduz.",
        "",
        "> Vou te pedir pra compartilhar a sua tela, porque a conexão das contas é feita no seu navegador, logado na sua conta. Eu vou te guiando.",
        "",
        "Como o cliente compartilha, no Meet pelo computador:",
        "1. Na barra de baixo da chamada, clicar no botão de **apresentar** (o ícone de uma tela com uma seta para cima, \"Apresentar agora\").",
        "2. Escolher **A tela inteira** (mais simples: você vê tudo, inclusive as janelas de autorização que abrem) ou **Uma guia**.",
        "3. Selecionar a tela ou a guia e clicar em **Compartilhar**.",
        "",
        "Se aparecer que o navegador não tem permissão para gravar a tela (comum no Mac), o cliente libera em *Ajustes do Sistema → Privacidade e Segurança → Gravação de tela*, marca o navegador e o reabre.",
      ].join("\n"),
      tip: "Peça para fechar abas com dados pessoais antes de compartilhar a tela inteira. Se ele compartilhar só uma guia, as janelas de login do Mercado Livre que abrem em outra janela não aparecem para você.",
      images: [],
    },
    {
      id: "criar-conta",
      title: "Criar a conta pelo link de cadastro (se ainda não criou)",
      body: [
        "Confira no card da Integração: se o botão **Link de cadastro** ainda aparece, o cliente não tem conta naquele produto. Copie o link, mande no chat do Meet ou no WhatsApp e acompanhe o cadastro na tela dele.",
        "",
        "O passo a passo, os campos e os erros comuns estão no guia **Link de cadastro e criação da conta**.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "cockpit/integracao-02-link-cadastro.png", caption: "O botão Link de cadastro aparece ao lado do nome enquanto o cliente não tem conta" },
      ],
    },
    {
      id: "configurar",
      title: "Conectar as contas e configurar o produto",
      body: [
        "Siga o guia de primeiro acesso do produto vendido:",
        "- **LeverAds · Primeiro acesso**: conectar as contas do Mercado Livre e da Shopee e definir a conta principal.",
        "- **LeverPrice · Primeiro acesso**: imposto, margem, as perguntas do robô e a conta do Mercado Livre.",
        "",
        "Confira as respostas do formulário no painel da direita do Modo integração: contas, conta principal, ERP, regras e o que não pode ser copiado.",
      ].join("\n"),
      tip: "Item do checklist feito, \"Feito e seguir\" no Modo integração: o card da integração fica com o progresso certo para o time inteiro.",
      images: [
        { file: "cockpit/integracao-05-modo-integracao.png", caption: "Modo integração: o checklist como roteiro, o passo do guia e o que saber do cliente" },
        { file: "cockpit/integracao-06-painel-cliente.png", caption: "Painel do cliente: contrato, contatos, formulário, resumo da venda e pendências" },
      ],
    },
    {
      id: "primeira-entrega",
      title: "A primeira entrega na frente do cliente",
      body: [
        "Não termine a call sem o cliente ver o produto trabalhando:",
        "- **LeverAds**: a primeira cópia rodando, dos anúncios mais vendidos.",
        "  > Olha rodando: esses anúncios já estão saindo pras outras contas. Daqui pra frente é publicar na matriz e deixar replicar.",
        "- **LeverPrice**: os anúncios importados e os primeiros custos cadastrados, com o robô mostrando o preço que ele sugere.",
      ].join("\n"),
      tip: "",
      images: [],
    },
    {
      id: "acompanhamento",
      title: "Fechar e combinar o acompanhamento",
      body: [
        "> Ficou alguma dúvida do que a gente fez agora? Eu te acompanho essa semana, me chama aqui a qualquer hora. Semana que vem eu te procuro pra ver como está o volume.",
      ].join("\n"),
      tip: "",
      images: [],
    },
    {
      id: "indicacao",
      title: "Plantar a indicação",
      body: [
        "> Última coisa: em alguns dias você já vê os primeiros números. Quando isso acontecer, vou te pedir duas indicações de lojistas que sofrem com isso que a gente acabou de resolver. Vou te lembrar, combinado?",
      ].join("\n"),
      tip: "A semente é plantada aqui e colhida na entrega do 1º resultado. Indicação é o lead que mais converte.",
      images: [],
    },
    {
      id: "depois",
      title: "Depois da call, no Cockpit",
      body: [
        "- Marque os itens feitos do checklist (ou use \"Feito e seguir\" no Modo integração).",
        "- No card do Negócio, \"✨ Resumir integração\" gera o resumo da call e separa o que ficou pendente com o cliente.",
        "- Se faltou algo do lado do cliente (um acesso, uma planilha), registre como pendência: o Cockpit cobra no prazo.",
        "- Integração concluída com tudo feito: mude a etapa para **Concluída** no card.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "cockpit/integracao-04-checklist.png", caption: "Checklist do card da Integração, com o Modo integração e o como fazer → de cada item" },
      ],
    },
  ],
};
