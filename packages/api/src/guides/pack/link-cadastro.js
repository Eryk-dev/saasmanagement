// Guia comum: o link de cadastro e a criação da conta no LeverAds e no
// LeverPrice (03/11/2026). Fatos do código: Cockpit (SignupInviteLink), LeverAds
// (frontend/src/pages/Signup.tsx) e LeverPrice (v3/auth/AuthV3.tsx). O
// LeverPrice é liberado sozinho quando a venda está paga
// (billing/leverprice-access.js, decisão do usuário em 03/11/2026).

export default {
  key: "link-cadastro",
  version: 2,
  title: "Link de cadastro e criação da conta",
  summary: "Onde pegar o link de cadastro no Cockpit, como mandar para o cliente, o que ele preenche no LeverAds e no LeverPrice, como a conta fica ligada à venda e os erros mais comuns.",
  audience: "integrador",
  product: "",
  steps: [
    {
      id: "onde-pegar",
      title: "Onde pegar o link no Cockpit",
      body: [
        "O botão aparece só enquanto o cliente **não tem conta** no produto. Ele está:",
        "- no topo do **card da Integração**, ao lado do nome do cliente;",
        "- no topo do **card do Negócio**;",
        "- na ficha do cliente, no bloco **conta LeverId**.",
        "",
        "Venda só de LeverAds mostra **Link de cadastro**. Venda com os dois produtos mostra **Link de cadastro LeverAds** e **Link de cadastro LeverPrice**. O clique **copia o link** (aparece \"link copiado\").",
        "",
        "O link leva o convite da venda: a conta criada por ele já nasce ligada ao cliente certo no Cockpit, mesmo que o cliente use outro e-mail.",
      ].join("\n"),
      tip: "Sumiu o botão? O cliente já tem conta naquele produto. Confira o badge do LeverId ao lado do nome.",
      images: [
        { file: "cockpit/integracao-02-link-cadastro.png", caption: "No topo do card da Integração: clique em Link de cadastro para copiar" },
      ],
    },
    {
      id: "mandar",
      title: "Mandar o link para o cliente",
      body: [
        "O botão copia só o endereço. Mande com uma linha de contexto, no WhatsApp ou no chat do Meet:",
        "",
        "> Oi {nome}! Pra gente já começar, cria seu acesso por este link: {link}. Leva menos de um minuto: nome da empresa, WhatsApp, e-mail e uma senha.",
        "",
        "Para o **LeverPrice**, avise antes sobre a senha:",
        "> A senha do LeverPrice precisa ter pelo menos 12 caracteres, com letra maiúscula, minúscula, número e símbolo.",
      ].join("\n"),
      tip: "Cliente com os dois produtos: mande primeiro o do LeverAds e, no LeverPrice, peça para usar o MESMO e-mail (e a senha do LeverAds, ver o passo do LeverPrice).",
      images: [],
    },
    {
      id: "cadastro-leverads",
      title: "Cadastro no LeverAds",
      body: [
        "Tela **Criar sua conta**:",
        "- **Nome da empresa**",
        "- **WhatsApp** (com DDD)",
        "- **E-mail**",
        "- **Crie uma senha**: no mínimo 6 caracteres (o medidor sugere maiúscula e número, mas não obriga)",
        "",
        "Botão **Começar grátis**. Não tem confirmação de e-mail: o cliente entra direto.",
        "",
        "Pelo link da venda, o plano contratado é aplicado em segundos e o cliente cai no **Primeiro acesso** (conectar as contas). Siga o guia **LeverAds · Primeiro acesso**.",
      ].join("\n"),
      tip: "Se aparecer a tela \"Cadastro recebido\" (pedido de aprovação), o cadastro não veio pelo link da venda ou a venda está sem assinatura no Cockpit. Confira o card do cliente antes de seguir.",
      images: [
        { file: "leverads/signup-01-form.png", caption: "Criar sua conta no LeverAds: nome da empresa, WhatsApp, e-mail e senha" },
        { file: "leverads/primeiro-acesso-02-cadastro-recebido.png", caption: "Cadastro recebido: aparece quando o cadastro não veio pelo link da venda" },
      ],
    },
    {
      id: "cadastro-leverprice",
      title: "Cadastro no LeverPrice",
      body: [
        "Tela **Crie sua conta.**:",
        "- **Empresa**",
        "- **WhatsApp** (com DDD)",
        "- **E-mail**",
        "- **Senha**: no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo; sem o e-mail ou o nome da empresa e sem o mesmo caractere 4 vezes seguidas",
        "- marcar **Li e aceito os termos de uso e a política de privacidade**",
        "- concluir a verificação (a caixa \"não sou robô\"), quando aparecer",
        "",
        "Botão **Criar conta**. Não tem confirmação de e-mail.",
        "",
        "**Cliente que já usa o LeverAds com o mesmo e-mail**: a tela avisa \"Este e-mail já tem um LeverId. Digite a senha dele no campo Senha para continuar.\" É a **senha do LeverAds**.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/signup-01-form.png", caption: "Crie sua conta no LeverPrice: senha de 12 caracteres, aceite dos termos e a verificação" },
      ],
    },
    {
      id: "liberacao",
      title: "Liberação do acesso",
      body: [
        "- **LeverAds**: pelo link da venda, libera na hora.",
        "- **LeverPrice**: libera **sozinho quando o pagamento da venda está confirmado no Cockpit** (assinatura ativa e fatura paga), em até 10 minutos.",
        "",
        "O que o cliente vê no LeverPrice, nesta ordem:",
        "1. o convite para ativar a **verificação em duas etapas** (o administrador pode adiar alguns dias com **Agora não**; depois disso ela é obrigatória);",
        "2. se o pagamento ainda não entrou: **\"Sua organização ainda não tem o LeverPrice liberado\"**. Não clicar no menu dessa tela; depois do pagamento, **recarregar a página**;",
        "3. liberado: o assistente de primeiro acesso. Siga o guia **LeverPrice · Primeiro acesso**.",
        "",
        "**Aplicar preços no Mercado Livre** fica desligado no começo (em Configurações › Contas aparece \"Escrita não liberada\"): o robô propõe e o cliente pode aprovar, mas nada muda no Mercado Livre até a Lever liberar a aplicação de preços depois da integração. Explique isso ao cliente na call.",
      ].join("\n"),
      tip: "Pagamento confirmado e ainda trancado depois de 10 minutos? Avise o admin do Cockpit: a liberação do LeverPrice tem um relatório com o motivo de cada cliente.",
      images: [
        { file: "leverprice/signup-03-mfa-convite.png", caption: "Convite da verificação em duas etapas (dá para adiar por alguns dias com Agora não)" },
        { file: "leverprice/signup-02-nao-liberado.png", caption: "Antes do pagamento: ainda não tem o LeverPrice liberado. Depois do pagamento, recarregar a página" },
        { file: "leverprice/signup-04-mfa-qr.png", caption: "Ativar a verificação: ler o QR code no aplicativo autenticador" },
        { file: "leverprice/signup-05-mfa-codigos.png", caption: "Códigos de recuperação: guardar num lugar seguro" },
      ],
    },
    {
      id: "conferir",
      title: "Conferir no Cockpit que a conta ficou ligada",
      body: [
        "- O botão **Link de cadastro** daquele produto some do card.",
        "- No **▶ Modo integração**, em *Contrato › Produtos*, o produto aparece como **conta ok**.",
        "- O badge do **LeverId** ao lado do nome pode levar alguns minutos para aparecer.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "cockpit/integracao-06-painel-cliente.png", caption: "Em Contrato › Produtos: conta ok ou sem conta, por produto" },
      ],
    },
    {
      id: "erros",
      title: "Erros comuns no cadastro",
      body: [
        "- **\"Email ja cadastrado\"** (LeverAds): o cliente já tem conta. Ele entra por *Já tem conta? Entrar* em vez de cadastrar.",
        "- **\"Celular inválido — informe DDD + número.\"**: faltou o DDD.",
        "- **\"Muitas tentativas de cadastro deste endereço\"**: o LeverAds aceita 3 cadastros por hora da mesma internet. Espere ou use outra rede.",
        "- **\"A senha precisa de…\"** (LeverPrice): a senha não cumpre a regra; o medidor mostra o que falta.",
        "- **\"Esta empresa já usa o LeverPrice\"**: a empresa já tem conta; o cliente entra com o login dele.",
        "- O e-mail de boas-vindas ainda chega com o nome antigo (**Levercopy**): avise o cliente que é da gente.",
      ].join("\n"),
      tip: "",
      images: [],
    },
  ],
};
