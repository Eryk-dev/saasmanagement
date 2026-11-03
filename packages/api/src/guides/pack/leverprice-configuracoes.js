// Guia do LeverPrice: Configurações (03/11/2026). Prints da UI real (develop)
// com dados fictícios. Fatos do código: v3/screens/Configuracoes.tsx,
// v3/config/secoes/*.tsx e v3/config/resumo.ts ("Escrita não liberada" quando
// /summary.writes_enabled é falso). Escrita desligada em org nova até a Lever
// ligar "Aplicar preços" no Super Admin (decisão do dono em 03/11/2026; quem e
// quando liberar ainda em definição).

export default {
  key: "leverprice-configuracoes",
  version: 1,
  title: "LeverPrice · Configurações: imposto, margens, robô, contas e pessoas",
  summary: "Cada seção de Configurações do LeverPrice: imposto e regras por produto, outros custos, margens, preço de atacado, as regras do robô, quem aplica, contas (incluindo \"Escrita não liberada\" e pausar o robô), pessoas, chaves de API e a conta de quem está logado.",
  audience: "integrador",
  product: "leverprice",
  steps: [
    {
      id: "como-funciona",
      title: "Como a tela funciona",
      body: [
        "**Configurações** tem uma coluna à esquerda, uma linha por assunto, com o valor em vigor ao lado (**Imposto 8%**, **Margens 20%**, **Quem aplica Você aprova**, **Contas Escrita não liberada**...). Clique numa linha para abrir a seção à direita.",
        "",
        "Ordem das seções: **Imposto**, **Outros custos** (só quando ligado para a empresa), **Margens**, **Preço de atacado**, **Robô**, **Quem aplica**, **Contas**, **Pessoas**, **API** e **Minha conta**.",
        "",
        "**Como salvar:** o que mexe em preço (imposto, margens, robô...) não grava sozinho. Ao mudar algo, a linha ganha um ponto e aparece embaixo uma **barra escura** com o resumo da mudança, **Desfazer** e **Salvar**. Se o cliente tentar sair da seção sem salvar, o LeverPrice pergunta antes. **Contas** e **Pessoas** agem na hora.",
        "",
        "Cada seção vale para a conta escolhida no topo da barra da esquerda (\"Qual é o imposto da LOJAEXEMPLO?\").",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-01-imposto.png", caption: "Configurações: a coluna dos assuntos com o valor em vigor e a seção aberta." },
        { file: "leverprice/configuracoes-16-barra-de-salvar.png", caption: "Mudança feita: a barra escura com o resumo, Desfazer e Salvar." },
      ],
    },
    {
      id: "imposto",
      title: "Imposto e regras por produto",
      body: [
        "**\"Qual é o imposto da conta?\"**: o percentual padrão, o mesmo do primeiro acesso. Vale para todo produto sem regra própria.",
        "",
        "**Por produto**: regras com nome e alíquota, para produtos com imposto diferente (por exemplo **Monofásico 4,3%**, **Substituição tributária 6%**). A coluna **vale em** diz em quais contas.",
        "- **Nova regra** abre uma linha: **Nome da regra**, a alíquota em % e o **×** para cancelar. Depois, salve na barra escura.",
        "- A regra é ligada aos SKUs em **Produtos** (na linha, no painel do produto ou em massa).",
      ].join("\n"),
      tip: "Imposto é a configuração que mais muda a margem de tudo. Se o cliente não tem certeza, deixe anotado para confirmar com o contador.",
      images: [
        { file: "leverprice/configuracoes-01-imposto.png", caption: "Imposto padrão da conta e as regras por produto." },
        { file: "leverprice/configuracoes-02-nova-regra.png", caption: "Nova regra: nome e alíquota." },
      ],
    },
    {
      id: "outros-custos",
      title: "Outros custos (quando ligado para a empresa)",
      body: [
        "**\"Que custos você tem além do Mercado Livre?\"**: embalagem, publicidade (Mercado Ads), devolução, taxa do ERP... Cada custo tem:",
        "- **quanto**: valor fixo (\"R$ 1,50 por unidade\") ou percentual (\"3% da venda\");",
        "- **vale em**: as contas;",
        "- **anúncios**: em quantos anúncios ele entra na conta da margem.",
        "",
        "**+ Custo** cria um custo; **+ Crédito** cria um crédito (algo que volta para o cliente, como crédito de imposto). Clique na linha para editar.",
        "",
        "Essa seção só aparece quando os outros custos estão ligados para a empresa. Sem ela, a margem considera só comissão, frete, imposto e custo do produto.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-03-outros-custos.png", caption: "Outros custos: embalagem por unidade e publicidade em % da venda." },
      ],
    },
    {
      id: "margens",
      title: "Margens",
      body: [
        "**\"Qual é a sua margem de venda?\"**: as três margens de cada conta, **venda**, **cheia** e **teto**, as mesmas do primeiro acesso. Embaixo da cheia aparece quanto o preço cheio fica acima do preço de venda ideal (\"+17% do preço de venda ideal\").",
        "",
        "**Nunca vender com margem abaixo de zero** (ligado): o robô nunca coloca um preço que dê prejuízo, mesmo que alguma regra mande.",
        "",
        "Margens próprias de um produto ou de um anúncio ficam no painel do produto (Produtos) e no painel do anúncio (Anúncios) e valem antes destas.",
      ].join("\n"),
      tip: "Mudou a margem? Avise o cliente que o robô recalcula os anúncios e a fila de Aprovações pode crescer.",
      images: [
        { file: "leverprice/configuracoes-04-margens.png", caption: "Margens da conta (venda, cheia e teto) e a trava de margem abaixo de zero." },
      ],
    },
    {
      id: "preco-de-atacado",
      title: "Preço de atacado",
      body: [
        "Desconto por quantidade nos anúncios (o comprador leva mais e paga menos por unidade). Por conta:",
        "- o interruptor liga ou desliga;",
        "- **desconto em** **%** ou **R$**;",
        "- **+ Nova faixa**: a quantidade mínima e o desconto de cada faixa (por exemplo, a partir de 3 unidades, 3%);",
        "- **Pode ficar abaixo da margem de venda**: desligado, o atacado nunca passa da margem de venda; ligar pede um aceite.",
        "",
        "Começa desligado. Só configure se o cliente já vende no atacado pelo Mercado Livre.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-05-preco-de-atacado.png", caption: "Preço de atacado: desligado, com o tipo de desconto e Nova faixa." },
      ],
    },
    {
      id: "robo",
      title: "Robô: as regras do jogo, uma por linha",
      body: [
        "**\"Como o robô deve agir?\"**: as mesmas regras respondidas no jogo do primeiro acesso, uma por linha, com a escolha à direita: onde o robô age, anúncio novo, o que pode mudar, abaixo da margem de venda, promoção abaixo da margem, acima da margem cheia, sem campanha que valha a pena, tradicional sem promoção, mais de uma promoção na margem, tradicional com catálogo, as quatro de catálogo, limite de subida por dia e mudança acima de 50%.",
        "",
        "Clique numa linha para abrir as opções em cartas (o que ganha e do que abre mão) e o **Não entendi como funciona**. Escolha e salve na barra escura.",
        "",
        "**Ver meu robô em vídeo** passa o vídeo com todas as escolhas.",
        "",
        "Explicação de cada regra e o que recomendar: guia **LeverPrice · Primeiro acesso**, passos do robô.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-07-robo-regras.png", caption: "Todas as regras do robô com a escolha em vigor." },
        { file: "leverprice/configuracoes-15-robo-regra-aberta.png", caption: "Uma regra aberta: as opções em cartas, como no jogo do primeiro acesso." },
      ],
    },
    {
      id: "quem-aplica",
      title: "Quem aplica (e o que o robô pode mudar em cada conta)",
      body: [
        "**\"O que o robô pode mudar?\"**: uma linha por conta com:",
        "- **preço**: o robô pode mudar o preço base;",
        "- **promoções**: o robô pode entrar e sair de promoções;",
        "- **quem aplica**: **Você aprova** (padrão: tudo passa por Robô › Aprovações) ou **Sozinho** (o robô aplica e o cliente acompanha no Histórico).",
        "",
        "**Quem aplica: como funciona** abre o vídeo.",
        "",
        "Recomendação: comece em **Você aprova** e passe para **Sozinho** depois de uma ou duas semanas aprovando sem mudanças. Lembre que, enquanto a Lever não liberar a aplicação de preços, nem as aprovadas chegam ao Mercado Livre.",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-08-quem-aplica.png", caption: "Quem aplica: preço, promoções e Você aprova ou Sozinho, por conta." },
      ],
    },
    {
      id: "contas",
      title: "Contas: \"Escrita não liberada\", pausar o robô e conectar contas",
      body: [
        "O título conta as contas (**\"1 conta.\"**) e cada linha mostra o estado:",
        "- **Escrita não liberada** (âmbar): a aplicação de preços no Mercado Livre ainda não foi liberada para a empresa. É o estado de toda conta nova. O robô calcula e propõe, o cliente pode aprovar, mas nada muda no Mercado Livre. **A Lever libera a aplicação de preços depois da integração; até lá o robô só propõe.** O cliente não consegue liberar sozinho.",
        "- **Robô ligado**: aplicação liberada; o botão **Pausar** para o robô naquela conta na hora (vira **Robô pausado**, com **Religar**).",
        "- **Desligada** (com **Ligar**) e **Desconectada** (vermelho, com **Reconectar**: o acesso ao Mercado Livre venceu e o cliente precisa autorizar de novo).",
        "",
        "**Conectar conta** conecta outra conta do Mercado Livre (mesmo processo do primeiro acesso: estar logado na conta certa e liberar o pop-up).",
        "",
        "Com mais de uma conta aparecem também **Custo do produto igual em todas as contas** e, no rodapé, **Pausar o robô em todas as contas** (freio de emergência da empresa).",
        "",
        "> Repare aqui: \"Escrita não liberada\". Por enquanto o robô só propõe; a gente libera a aplicação dos preços no Mercado Livre depois da integração.",
      ].join("\n"),
      tip: "Não prometa prazo para a liberação. Registre no card da integração que o cliente está esperando a aplicação de preços e avise quando for liberada.",
      images: [
        { file: "leverprice/configuracoes-09-contas.png", caption: "Conta nova: \"Escrita não liberada\"." },
        { file: "leverprice/configuracoes-10-contas-escrita-liberada.png", caption: "Depois da liberação: \"Robô ligado\" e o botão Pausar." },
      ],
    },
    {
      id: "pessoas",
      title: "Pessoas: quem mais usa o LeverPrice",
      body: [
        "O título conta as pessoas (**\"3 pessoas.\"**); cada linha tem nome, e-mail e **acesso**:",
        "- **Administrador**: tudo, inclusive configurações e pessoas;",
        "- **Ajusta e aprova**: mexe em preço e custo e aprova as propostas do robô;",
        "- **Só ajusta**: mexe em preço e custo, sem aprovar;",
        "- **Só leitura**: vê as contas liberadas, não muda nada;",
        "- **Sem acesso**: não entra no LeverPrice.",
        "",
        "Troque o acesso no seletor da linha. O **⋯** tem **Contas liberadas**, **Reenviar convite** (ou **Trocar senha**), **Desativar**/**Reativar** e **Remover**.",
        "",
        "**Nova pessoa**: **Nome**, **E-mail**, **Acesso** e as **Contas** que a pessoa vê; **Criar** manda o convite por e-mail. A pessoa cria a própria senha pelo link.",
        "",
        "**Histórico dos últimos 90 dias**: quem convidou, mudou ou tirou acesso de quem.",
      ].join("\n"),
      tip: "Operador sem nenhuma conta marcada entra e vê \"Nenhuma conta do Mercado Livre liberada para você\". Marque as contas no convite.",
      images: [
        { file: "leverprice/configuracoes-11-pessoas.png", caption: "Pessoas: acesso de cada um e o histórico de 90 dias." },
        { file: "leverprice/configuracoes-12-convidar-pessoa.png", caption: "Nova pessoa: nome, e-mail, acesso e contas." },
      ],
    },
    {
      id: "api",
      title: "API: chaves para o ERP",
      body: [
        "Para o ERP ou um sistema do cliente ler produtos e atualizar custos sozinho. O título conta as chaves ativas.",
        "- **Nova chave**: nome, permissões (**Ler produtos e cadastros**, **Mudar custo e preço mínimo**, **Mudar fornecedor, imposto, robô e margens**) e validade (sem validade, 30, 90, 180 dias ou 1 ano). Pede a senha e, se for o caso, o código do app autenticador.",
        "- O segredo da chave aparece **uma vez só**: o cliente copia e cola no ERP na hora.",
        "- Na lista: **permissões** (Lê, Custo, Regras), **validade e uso** e o **⋯** com **Gerar de novo** e **Revogar**.",
        "- **Documentação** abre a documentação da API para o desenvolvedor.",
        "",
        "Só configure na call se o cliente pedir integração com o ERP; o normal é cadastrar custos pela planilha.",
      ].join("\n"),
      tip: "Nunca peça para o cliente mandar o segredo da chave por WhatsApp. Ele cola direto no ERP.",
      images: [
        { file: "leverprice/configuracoes-13-api.png", caption: "API: uma chave ativa, com permissões e validade (dados fictícios)." },
      ],
    },
    {
      id: "minha-conta",
      title: "Minha conta: verificação em duas etapas e sessões",
      body: [
        "- **Verificação em duas etapas**: **Ativa** (ou o convite para ativar) e quantos **códigos de recuperação** ainda restam (\"10 de 10\"). O **⋯** tem **Gerar novos códigos de recuperação**.",
        "- **Sessões**: onde a conta está aberta (navegador e aparelho, IP, último uso, quando termina). **Esta sessão** marca o computador de agora. **Encerrar as outras** derruba as demais sessões.",
        "",
        "Use quando o cliente perder o celular (entra com um código de recuperação e refaz a verificação) ou suspeitar de acesso de outra pessoa (encerrar as outras e trocar a senha).",
      ].join("\n"),
      tip: "",
      images: [
        { file: "leverprice/configuracoes-14-minha-conta.png", caption: "Minha conta: verificação em duas etapas ativa e as sessões abertas." },
      ],
    },
  ],
};
