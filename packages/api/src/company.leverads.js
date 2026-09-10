// A empresa em texto, do lado da API: voz oficial pro motor do blog
// (blog-knowledge.js) e pra qualquer prompt que precise falar "de nós".
//
// ESPELHO de `COMPANY` em packages/web/src/screens/training.jsx (a web não
// importa da API neste repo). Alterou lá, altera aqui: o teste
// test/blog-knowledge.test.js compara o `what` dos dois arquivos.

export const LEVERADS_COMPANY = {
  what: "Somos uma empresa de tecnologia que escala operações de venda em marketplace. Construímos uma plataforma própria que publica e mantém anúncios sincronizados entre várias contas de Mercado Livre e Shopee, com estoque integrado e ficha técnica completada por IA. Vendemos por assinatura, com preço fixo e sem taxa por pedido, e entregamos a operação do cliente rodando já na primeira semana. Somos um time enxuto que opera tudo dentro do nosso próprio cockpit: da primeira ligação ao acompanhamento pós-venda, cada etapa tem processo, dado e responsável.",
  mission: "Ser o motor tecnológico que faz uma operação de marketplace crescer sem crescer o time: o que levaria meses de trabalho manual, a gente entrega em minutos.",
  vision: "Ser a plataforma padrão de operação de marketplace no Brasil, o sistema que roda por trás de quem vende em escala.",
  facts: [
    { k: "Produto", v: "Plataforma SaaS de operação em marketplace (Mercado Livre e Shopee): publicação em várias contas, sincronização, estoque integrado e IA na ficha técnica." },
    { k: "Modelo", v: "Assinatura anual com preço fixo, sem percentual por pedido. Tudo que lançamos durante o contrato entra sem custo extra." },
    { k: "Mercado", v: "Lojistas que já vendem em marketplace e querem crescer operando mais contas sem inchar o time." },
    { k: "Como operamos", v: "Time enxuto em 4 frentes (mídia social, pré-venda, vendas e sucesso do cliente), com processo e métrica de ponta a ponta no cockpit." },
  ],
  pillars: [
    { t: "Velocidade", d: "Lead novo se atende em minutos, cliente novo roda no dia seguinte. Quem chega primeiro e entrega rápido, ganha." },
    { t: "Mostrar rodando, não prometer", d: "A gente prova ao vivo: demo na conta do cliente, case com print real. Falar é fácil; nós mostramos." },
    { t: "Honestidade sempre", d: "O que não temos, a gente diz que não tem. Expectativa certa na venda é cliente satisfeito na entrega." },
    { t: "Dono do processo", d: "Cada um segue e registra o seu processo: toque registrado, card atualizado, dado na mão. O sistema só ajuda quem alimenta ele." },
    { t: "Cliente vira fã", d: "Entrega bem feita vira resultado, resultado vira case, case vira indicação. É assim que a gente cresce." },
  ],
};

// Fatos da plataforma que o redator PODE afirmar como verdade, sem preço e sem
// nome de cliente. Tudo que não está aqui (nem nos cards) o texto não inventa.
export const BLOG_FACTS = [
  "A plataforma publica o mesmo anúncio em várias contas de Mercado Livre e Shopee a partir de uma conta principal (a conta-mãe).",
  "O estoque fica integrado: a venda em qualquer conta baixa o estoque nas outras, o que reduz furo de estoque e venda sem produto.",
  "A ficha técnica (título, atributos, descrição) é completada por IA pra o anúncio chegar o mais completo possível nas contas novas.",
  "Preço, foto, descrição e estoque editados na conta principal replicam pras demais contas.",
  "A operação do cliente entra no ar na primeira semana: a primeira carga de anúncios é feita junto com o time.",
  "O modelo é assinatura com preço fixo, sem percentual por pedido ou por venda.",
  "Integração oficial via API do Mercado Livre e da Shopee, sem robô de navegador: é o caminho que os marketplaces autorizam, o que evita as punições que automação irregular costuma gerar.",
  "Para autopeças, o anúncio pode nascer do part number (código OEM): a plataforma monta foto, descrição e compatibilidades veiculares e publica na conta do lojista.",
  "Compatibilidades veiculares podem ser copiadas em lote de um produto pra outros.",
  "As contas seguem independentes no marketplace: reputação, vendas e atendimento continuam separados por conta.",
];

// Cases anonimizados por padrão. `namePublic: true` libera o nome no texto
// (decisão do Leo, caso a caso).
export const BLOG_CASES = [
  { namePublic: false, text: "Um lojista de moda infantil colocou uma segunda conta no ar a partir da conta principal e, em poucos meses, a operação vendia cerca de 50% a mais, com a conta principal seguindo no ritmo de antes." },
  { namePublic: false, text: "Lojistas de autopeças com duas ou mais contas e catálogo entre 2 mil e 10 mil anúncios são o perfil que mais cresce com a plataforma." },
  { namePublic: false, text: "Quem chega com uma conta nova parada (ou uma conta reaberta depois de suspensão) costuma ter o catálogo inteiro no ar na primeira semana, sem recadastrar anúncio por anúncio." },
];

// Regras de posicionamento (decisão do Leo, 18/07/2026 e depois): a LeverAds
// é a empresa que escala operação com tecnologia, não "um clonador de anúncios".
export const POSITIONING_RULES = [
  "A LeverAds é uma empresa de tecnologia que escala operações de venda em marketplace. Fale de publicar, replicar, sincronizar, operar e escalar. Nunca use clonar, clonagem ou clone.",
  "Escreva em português do Brasil, direto, sem enrolação e sem jargão vazio de marketing. Frases curtas.",
  "Ao falar da empresa, use primeira pessoa do plural (nós, a gente, a LeverAds).",
  "Nunca use travessão (o traço longo). Use vírgula, ponto, dois pontos ou parênteses.",
  "Nunca escreva preço, valor, parcela, plano, desconto ou condição comercial. O preço é conversa de call.",
  "Nunca cite nome de pessoa, loja ou cliente. Diga 'um lojista de autopeças', 'uma operação com quatro contas'.",
  "Só use números que estejam na seção RESULTADOS REAIS do material, e sempre com o recorte que veio junto. Sem número, escreva de forma qualitativa.",
  "Nada de promessa de ganho garantido, 'dobre suas vendas' ou '100% de'. Mostre o mecanismo e o que muda na rotina.",
  "Sem emoji. Sem tabela e sem imagem no markdown.",
  "O leitor é quem já vende em marketplace e quer crescer sem inchar o time: fale do problema como ele vive no dia a dia.",
];
