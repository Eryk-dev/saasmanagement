// Rascunho inicial do guia de implantação (03/11/2026). Sai do que o cockpit já
// tinha: o roteiro da call de integração (web/src/lib/scripts.js, chave
// `integracao`), o checklist padrão "Implantação inicial"
// (customers/onboarding-templates.js) e o formulário de integração. Nasce como
// RASCUNHO: o time completa os detalhes de cada tela e cola os prints.
//
// Os ids dos passos são fixos para o checklist apontar para eles
// (STARTER_LINKS: título do item do modelo → passo).

export const STARTER_ID = "implantacao";

export const STARTER_GUIDE = {
  starter: STARTER_ID,
  title: "Implantação · call de integração",
  summary: "O passo a passo da integração de um cliente recém-fechado: o que conferir antes, como conduzir a call com tela compartilhada e como fechar. Cada passo corresponde a um item do checklist da integração.",
  audience: "integrador",
  product: "leverads",
  status: "rascunho",
  steps: [
    {
      id: "antes-da-call",
      title: "Antes da call: conferir o que o cliente respondeu",
      body: [
        "Abra o card da integração e confira:",
        "- **Formulário de integração**: contas e marketplaces, qual é a conta principal, ERP e estoque, rotas (de onde para onde copiar), bloqueios e regras.",
        "- **Resumo da venda**: o que foi prometido na call de venda e os pontos de atenção.",
        "- **Plano e produtos** contratados e se o cliente já tem conta no sistema (badge do LeverId ou o link de cadastro).",
        "",
        "Se o formulário não foi respondido, mande o link de novo antes de marcar a call.",
      ].join("\n"),
      tip: "Cole aqui o print do card da integração com o formulário respondido.",
      images: [],
    },
    {
      id: "marcar-call",
      title: "Marcar a call e pedir os acessos",
      body: [
        "Cliente já pagou: não confirme pagamento. Combine uma call de vídeo com tela compartilhada (uns 20 minutos).",
        "",
        "> Oi! Sou eu que vou tocar sua integração. A gente faz numa call de vídeo, com tela compartilhada, leva uns 20 minutos e já sai rodando. Qual o melhor dia e horário pra você?",
        "",
        "Peça para deixar em mãos os acessos das contas que vão ser espelhadas.",
      ].join("\n"),
      tip: "",
      images: [],
    },
    {
      id: "abrir-call",
      title: "Abrir a call (kickoff)",
      body: [
        "Compartilhe a tela e confirme antes de mexer:",
        "",
        "> Quais contas entram agora e qual delas é a principal, a que tem os anúncios bons?",
      ].join("\n"),
      tip: "",
      images: [],
    },
    {
      id: "conectar-contas",
      title: "Conectar as contas e definir a conta-mãe",
      body: [
        "Conecte cada conta do marketplace e defina a conta principal como conta-mãe (a matriz).",
        "",
        "> Essa vira a conta-mãe. O que você publicar nela replica pras outras, e o que já está lá a gente clona agora.",
        "",
        "Descreva aqui, tela por tela, onde clicar para conectar e onde marcar a conta-mãe.",
      ].join("\n"),
      tip: "Cole os prints das telas de conexão e da escolha da conta-mãe.",
      images: [],
    },
    {
      id: "configuracao",
      title: "Configuração da conta",
      body: "Ajuste as configurações combinadas no formulário: rotas, regras de preço, bloqueios e estoque. Descreva aqui cada tela e o que conferir.",
      tip: "Cole os prints das telas de configuração.",
      images: [],
    },
    {
      id: "primeira-clonagem",
      title: "Primeira clonagem na tela",
      body: [
        "Rode a primeira leva com o cliente olhando.",
        "",
        "> Olha rodando: esses anúncios já estão saindo pras outras contas. Daqui pra frente é publicar na matriz e deixar replicar.",
      ].join("\n"),
      tip: "Cole o print de onde acompanhar a clonagem em andamento.",
      images: [],
    },
    {
      id: "treinamento",
      title: "Treinar o time do cliente",
      body: "Mostre o dia a dia: onde publicar, onde ver o que replicou e onde pedir ajuda. Anote nas notas da integração quem participou.",
      tip: "",
      images: [],
    },
    {
      id: "go-live",
      title: "Go-live e acompanhamento",
      body: [
        "Confirme com o cliente que está rodando e combine o acompanhamento:",
        "",
        "> Ficou alguma dúvida do que a gente fez agora? Eu te acompanho essa semana, me chama aqui a qualquer hora. Semana que vem eu te procuro pra ver como está o volume.",
      ].join("\n"),
      tip: "",
      images: [],
    },
    {
      id: "indicacao",
      title: "Plantar a indicação",
      body: [
        "> Em alguns dias você já vê os primeiros números. Quando isso acontecer, vou te pedir duas indicações de lojistas que sofrem com isso que a gente acabou de resolver. Vou te lembrar, combinado?",
      ].join("\n"),
      tip: "A semente é plantada aqui e colhida na entrega do 1º resultado. Indicação é o lead que mais converte.",
      images: [],
    },
  ],
};

// Item do checklist padrão "Implantação inicial" → passo do guia.
export const STARTER_LINKS = {
  "Formulário de integração respondido": "antes-da-call",
  "Acesso às contas dos marketplaces": "marcar-call",
  "Kickoff com o cliente": "abrir-call",
  "Contas conectadas e configuração feita": "conectar-contas",
  "Primeira entrega no ar (anúncios ou regras)": "primeira-clonagem",
  "Treinamento do time do cliente": "treinamento",
  "Go-live confirmado com o cliente": "go-live",
};
