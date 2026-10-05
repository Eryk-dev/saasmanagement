// Mentoria Lever — a oferta de quem AINDA NÃO VENDE em marketplace.
//
// Esse lead já existia no cockpit: o form do diagnóstico pergunta "você já vende
// em marketplace?" e quem responde "ainda não" sai pela lateral (formExit
// "mentoria") pra coluna Mentoria, fora do funil de venda e fora do CPL. Até
// agora essa fila era um depósito — o comentário do migrateFormVendeMarketplace
// dizia, literalmente, "o produto pra essa fila ainda vai existir". Agora existe.
//
// Duas trilhas (desenho fechado com o Leo em 16/08/2026):
//   Começar  · quem ainda não vende: Curso (1k) → Assistido (3k) → +Importação
//              como UPSELL de quem já comprou (+2k), nunca na proposta de entrada.
//   Escalar  · quem já vende e travou: Marketplace (4k), Importação (4k) e o
//              combo (6k). Não sai do form: nasce da base e do lead que chega
//              pro software mas ainda não tem volume pra ele.
//
// Tudo é COMPRA ÚNICA (plano "unico") em até 12x no cartão, sem boleto.
//
// A régua de encaixe é a VERBA declarada no form (`lead.aprender_verba`), que é
// exatamente pra isso que ela é perguntada. Ela não escolhe o deck: a
// apresentação é uma só (abre no Assistido, com o Curso como degrau secreto de
// resgate). Ela escolhe o que o closer OFERECE e por onde ele começa a conversa.
//
// Preço mora no template (`calc.mentoria.products`, banco), igual ao catálogo do
// LeverAds: mexer no preço não pede deploy. Este módulo é a matéria-prima da
// migração e a régua de leitura. Espelho no web: packages/web/src/lib/mentoria.js
// (a tabela de verba e os ids andam juntos).

export const MENTORIA_TRACKS = {
  comecar: "Começar · ainda não vende",
  escalar: "Escalar · já vende",
};

// Ordem = ordem do select de fechamento. `oneOff` é o produto todo: mentoria é
// compra única, não assinatura.
export const MENTORIA_PRODUCTS = {
  men_curso: {
    name: "Mentoria · Curso",
    track: "comecar",
    price: 1000,
    short: "curso gravado (5 módulos) + 1 hora de assessoria",
  },
  men_assistido: {
    name: "Mentoria · Assistido",
    track: "comecar",
    price: 3000,
    short: "curso + 4 encontros + WhatsApp 90 dias + nosso produto validado na conta dele",
  },
  men_assistido_imp: {
    name: "Mentoria · Assistido + Importação",
    track: "comecar",
    price: 5000,
    short: "Assistido com o módulo de importação junto (fechado na entrada)",
  },
  men_upsell_imp: {
    name: "Mentoria · Upsell de Importação",
    track: "comecar",
    price: 2000,
    short: "só pra quem JÁ comprou o Assistido, oferecido durante a mentoria",
  },
  men_escalar_mkt: {
    name: "Mentoria · Escalar Marketplace",
    track: "escalar",
    price: 4000,
    short: "4 encontros: raio-x da conta e plano de escala",
  },
  men_escalar_imp: {
    name: "Mentoria · Escalar Importação",
    track: "escalar",
    price: 4000,
    short: "importação aplicada na primeira compra real dele",
  },
  men_escalar_full: {
    name: "Mentoria · Escalar Completo",
    track: "escalar",
    price: 6000,
    short: "Marketplace + Importação, R$2.000 a menos que os dois avulsos",
  },
};

export const MENTORIA_PRODUCT_IDS = Object.keys(MENTORIA_PRODUCTS);
export const MENTORIA_LABEL = Object.fromEntries(
  MENTORIA_PRODUCT_IDS.map((id) => [id, MENTORIA_PRODUCTS[id].name]),
);

// ── Régua: verba declarada → o que oferecer ────────────────────────────────
// `offer` é a oferta que abre a conversa, `rescue` é o degrau de baixo (o
// Curso, revelado só se o preço travar) e `upsell` marca quem é candidato ao
// módulo de importação DEPOIS de comprar. `note` é a instrução pro closer.
//
// Distribuição real da fila em 16/08/2026 (127 cards): 79 até 1k, 22 de 1k a
// 5k, 11 de 5k a 20k e 14 acima de 20k. Ou seja: a maioria abre no Curso, e o
// dinheiro da fila está nos 47 cards de 1k pra cima.
export const VERBA_FIT = {
  "ate-1k": {
    label: "Até R$ 1 mil",
    offer: "men_curso",
    rescue: "",
    upsell: false,
    note: "Verba curta: abre no Curso. Se ele quiser mão na massa, o Assistido em 12x de R$250 cabe no mesmo bolso e o valor do Curso vira crédito em 30 dias.",
  },
  "1k-5k": {
    label: "R$ 1 mil a R$ 5 mil",
    offer: "men_assistido",
    rescue: "men_curso",
    upsell: false,
    note: "Abre no Assistido: o nosso produto validado segura as primeiras vendas e a verba dele fica livre pro estoque próprio. Curso só se travar no preço.",
  },
  "5k-20k": {
    label: "R$ 5 mil a R$ 20 mil",
    offer: "men_assistido",
    rescue: "men_curso",
    upsell: true,
    note: "Assistido com folga de caixa pro estoque. Candidato natural ao upsell de importação (+R$2.000) durante a mentoria, quando ele sentir a margem.",
  },
  "20k+": {
    label: "Mais de R$ 20 mil",
    offer: "men_assistido",
    rescue: "",
    upsell: true,
    note: "Verba de operação, não de teste. Assistido na entrada e importação já no primeiro mês. Se descobrir na conversa que ele JÁ vende, a rota é a trilha Escalar.",
  },
};

const VERBA_DEFAULT = {
  label: "não declarada",
  offer: "men_assistido",
  rescue: "men_curso",
  upsell: false,
  note: "Sem verba declarada: pergunta antes de falar preço. Sem esse número não dá pra saber se ele compra o Curso ou o Assistido.",
};

export const isMentoriaLead = (lead) => String(lead?.formExit || "") === "mentoria";

// Leitura pronta pro card e pro roteiro: qual oferta encaixa neste lead.
export function mentoriaFit(lead) {
  if (!isMentoriaLead(lead)) return null;
  const band = String(lead?.aprender_verba || "");
  const fit = VERBA_FIT[band] || VERBA_DEFAULT;
  const p = MENTORIA_PRODUCTS[fit.offer] || null;
  return {
    verba: band,
    verbaLabel: fit.label,
    product: fit.offer,
    productName: p?.name || "",
    price: p?.price || 0,
    rescue: fit.rescue,
    rescueName: MENTORIA_PRODUCTS[fit.rescue]?.name || "",
    upsell: !!fit.upsell,
    note: fit.note,
  };
}

// ── Catálogo do fechamento ─────────────────────────────────────────────────
// Mesmo contrato do dealCatalog do LeverAds (id/label/prices), com `group` pra
// o select agrupar e `oneOff` pra travar o plano em "Serviço único". Só devolve
// linha quando o TEMPLATE tem o bloco `calc.mentoria`: é isso que impede outro
// deck selecionável (o Starter, por exemplo) de arrastar os produtos da mentoria
// pro gate de fechamento sem querer.
export const hasMentoria = (calc) => !!(calc && calc.mentoria && calc.mentoria.products);

export function mentoriaDealCatalog(calc) {
  if (!hasMentoria(calc)) return [];
  const fromDb = calc.mentoria.products;
  const out = [];
  for (const id of MENTORIA_PRODUCT_IDS) {
    const base = MENTORIA_PRODUCTS[id];
    const db = fromDb[id];
    if (!db) continue; // produto tirado do catálogo no banco
    const value = Math.round(Number(db?.price ?? base.price)) || 0;
    if (!value) continue;
    out.push({
      id,
      label: db?.name || base.name,
      group: "Mentoria",
      oneOff: true,
      prices: [{ plan: "unico", label: "à vista ou 12x no cartão", value }],
    });
  }
  return out;
}

// Potencial do card quando a apresentação da mentoria é gerada: o preço da
// oferta que a verba encaixa (o deck abre no Assistido, mas quem declarou até
// R$ 1 mil vale o Curso). 0 quando não é lead da fila ou o template não é o da
// mentoria — aí quem chamou cai na régua de sempre.
export function mentoriaAmount(lead, calc) {
  if (!hasMentoria(calc) || !isMentoriaLead(lead)) return 0;
  const fit = mentoriaFit(lead);
  const db = calc.mentoria.products[fit?.product || ""];
  return Math.round(Number(db?.price ?? fit?.price ?? 0)) || 0;
}

// Bloco `calc.mentoria` que a migração grava no template (fonte de verdade do
// preço). Só nome e preço: o resto do produto é texto do deck.
export function mentoriaCalcBlock() {
  const products = {};
  for (const id of MENTORIA_PRODUCT_IDS) {
    products[id] = { name: MENTORIA_PRODUCTS[id].name, price: MENTORIA_PRODUCTS[id].price };
  }
  return {
    products,
    // Rótulo das faixas de verba pro deck ({{answers.aprender_verba}}).
    verbaLabels: Object.fromEntries(Object.entries(VERBA_FIT).map(([k, v]) => [k, v.label])),
  };
}

// ── Apresentação ───────────────────────────────────────────────────────────
// Deck no MESMO layout do pt_leverads (hero → cards → steps → compare →
// pricing, alternando claro/escuro), com o tema da casa. Uma apresentação só
// pra fila inteira: abre no Assistido e guarda o Curso como degrau secreto
// (offer2, Shift+1), que é como o closer trata objeção de preço sem começar
// oferecendo o produto barato. A verba não troca o deck, troca o que o closer
// oferece (VERBA_FIT, lido no cockpit).
//
// Nasce como RASCUNHO + `selectable`: o publicado do leverads continua sendo o
// pt_leverads (o deck padrão de quem já vende), e a Mentoria vira uma opção no
// select "Qual apresentação gerar" do card, igual ao Starter.
export const MENTORIA_TEMPLATE_ID = "pt_mentoria";

export const MENTORIA_THEME = {
  bg: "#F3FBFF",
  fg: "#051C2C",
  font: "'Space Grotesk', system-ui, sans-serif",
  accent: "#23D8D3",
  accentFg: "#051C2C",
  surface: "#181b22",
  radius: 14,
  logoUrl: "https://copy.levermoney.com.br/lever/logo-icon-color.svg",
  logoHeight: 72,
  brandName: "Mentoria Lever",
};

export const MENTORIA_SLIDES = [
  {
    key: "hero",
    type: "hero",
    bg: "",
    tag: "Mentoria Lever · confidencial",
    title: "*{{lead.firstName}}*, sua primeira venda não precisa começar no escuro.",
    subtitle: "A gente coloca um produto nosso, que já vende todo dia, na sua conta nova. Enquanto ele faz as suas primeiras vendas, a gente escolhe e compra o seu estoque junto com você.",
    meta: [
      { label: "Cliente", value: "{{lead.name}}" },
      { label: "WhatsApp", value: "{{lead.phone}}" },
      { label: "Objetivo", value: "primeira venda no marketplace" },
      { label: "Formato", value: "online, com acompanhamento" },
    ],
  },
  {
    key: "sobre_nos",
    type: "cards",
    bg: "dark",
    eyebrow: "Quem vai te ensinar",
    title: "Quem te ensina *vende todo dia*, não só dá aula.",
    lead: "A gente não é escola de marketplace. A gente opera marketplace: as contas, o estoque, a nota fiscal, o anúncio e o problema de terça à noite. O que a gente ensina é o que a gente faz.",
    cards: [
      { label: "No marketplace", value: "10 anos", tag: "operando e vendendo todos os dias" },
      { label: "Volume próprio", value: "+10 mil", tag: "pedidos por mês na nossa operação" },
      { label: "Onde você aprende", value: "Na prática", small: true, tag: "com a nossa operação aberta pra você" },
    ],
    highlight: {
      pill: "aula de quem vende",
      label: "O que isso muda pra você",
      title: "Você aprende o que funciona hoje, não o que funcionava há três anos.",
    },
  },
  {
    key: "como_funciona",
    type: "steps",
    bg: "",
    eyebrow: "Como funciona · 3 etapas",
    title: "Da conta zerada às *primeiras 10 vendas*, em 3 etapas.",
    pills: ["conta e CNPJ", "anúncio que vende", "produto validado na sua conta", "escolha do seu estoque", "planilha de precificação"],
    steps: [
      {
        tag: "ETAPA 01 · ESTRUTURA",
        title: "A conta em pé, do jeito certo",
        text: "Conta criada e configurada, CNPJ, marca, emissor de nota fiscal e controle de estoque. É a parte chata que, feita errada, trava a operação inteira lá na frente.",
      },
      {
        tag: "ETAPA 02 · PRIMEIRAS VENDAS",
        title: "Nosso produto validado na sua conta",
        text: "Conta nova não aparece na busca porque não tem venda, e sem aparecer não vende. A gente quebra esse círculo com um produto nosso, que já vende, fazendo as suas primeiras 10 vendas e esquentando a sua conta.",
      },
      {
        tag: "ETAPA 03 · SEU ESTOQUE",
        title: "A gente escolhe e compra junto com você",
        text: "Enquanto a conta ganha relevância, a gente analisa fornecedor, custo e margem e escolhe o que VOCÊ vai vender. Você compra com a conta feita na planilha, não no chute.",
      },
    ],
  },
  {
    key: "impacto",
    type: "compare",
    bg: "dark",
    eyebrow: "O impacto",
    title: "A diferença entre *começar sozinho* e começar acompanhado.",
    before: {
      kicker: "Sozinho",
      label: "Conta nova, sem histórico",
      num: "0",
      unit: "vendas de largada",
      tone: "bad",
      sub: "Você compra estoque no chute, sobe o anúncio e descobre depois que ninguém acha a sua conta. O dinheiro já foi.",
      points: [
        "Estoque escolhido por palpite",
        "Conta sem relevância na busca",
        "Erro de nota, preço e ficha custa caro",
      ],
    },
    after: {
      kicker: "Com a mentoria",
      label: "Primeiras vendas com produto validado",
      num: "10",
      unit: "primeiras vendas",
      tone: "good",
      sub: "A conta começa vendendo com produto nosso enquanto a gente escolhe o seu. Você aprende comprando certo, não errando.",
      points: [
        "Produto que já vende na sua conta",
        "Seu estoque escolhido com a gente",
        "Assessoria direta no WhatsApp",
      ],
    },
  },
  {
    key: "investimento",
    type: "pricing",
    bg: "",
    eyebrow: "Investimento",
    title: "*{{lead.firstName}}*, o que custa começar do jeito certo.",
    planTag: "MENTORIA ASSISTIDA",
    price: "3.000",
    per: "à vista",
    cycles: "12x de *250*/mês",
    cyclesLabel: "ou",
    currency: false,
    pricePrefix: "",
    planPill: "12x sem juros no cartão de crédito",
    revealPrice: true,
    featuresTitle: "O que está incluído",
    benefitGroups: [
      {
        title: "O método",
        items: [
          "Curso completo: conta e ecossistema do Mercado Livre, anúncios e vendas",
          "Estrutura da empresa: CNPJ, marca, tributação, nota fiscal e estoque",
          "Fornecedores nacionais, análise de custo e margem, lista pronta pra busca",
          "Planilha de precificação automática (taxas, margem e simulação de preço)",
        ],
        synth: "Você para de *procurar tutorial solto no YouTube*: o caminho inteiro, na ordem, com a conta certa.",
      },
      {
        title: "A mão na massa",
        items: [
          "4 encontros de 1 hora com a gente",
          "Assessoria individual no WhatsApp por 90 dias",
          "Acompanhamento das decisões: o que comprar, por quanto vender, o que anunciar",
        ],
        synth: "Dúvida na hora da compra tem *resposta no mesmo dia*, não daqui a duas semanas.",
      },
      {
        title: "O que só a gente faz",
        items: [
          "Nosso produto já validado anunciado na sua conta",
          "As primeiras 10 vendas pra sua conta ganhar relevância",
          "Escolha e compra do SEU estoque feitas junto com a gente",
        ],
        synth: "É o que tira o risco do começo: você vende *antes* de apostar o seu dinheiro em estoque.",
      },
    ],
    features: [
      "Curso completo do Mercado Livre, do zero à venda",
      "Estrutura da empresa: CNPJ, marca, nota fiscal e estoque",
      "Planilha de precificação automática",
      "4 encontros de 1 hora",
      "Assessoria individual no WhatsApp por 90 dias",
      "Nosso produto já validado anunciado na sua conta",
      "Escolha e compra do seu estoque junto com a gente",
    ],
    guaranteeHead: "Garantia",
    guaranteeTitle: "7 dias pra desistir, sem pergunta.",
    guaranteeText: "O que a gente garante é execução: sua conta no ar, anunciando e vendendo com produto validado. Ninguém aqui promete faturamento, porque isso depende de decisão sua também.",
    // Degrau secreto (Shift+1): o Curso sozinho, pra quando o preço trava a
    // conversa. Não abre junto de propósito, senão vira a oferta principal.
    offer2: {
      planTag: "SÓ O CURSO",
      price: "1.000",
      per: "à vista",
      cycles: "12x de *83*/mês",
      cyclesLabel: "ou",
      currency: false,
      pricePrefix: "",
      planPill: "vira crédito integral no Assistido em até 30 dias",
      sub: "curso gravado completo + 1 hora de assessoria comigo",
    },
  },
];

// O deck que um lead da fila deve receber quando ninguém escolheu deck: o
// template da mentoria, se ele existir com preço no banco. Fora da fila (ou sem
// o template), devolve null e a geração segue pro publicado do produto.
export function mentoriaTemplateOf(templates, lead) {
  if (!isMentoriaLead(lead)) return null;
  return (templates || []).find((t) => t
    && t.id === MENTORIA_TEMPLATE_ID
    && (!t.saas || t.saas === lead.saas)
    && hasMentoria(t.calc)) || null;
}

export function mentoriaTemplateDoc() {
  return {
    id: MENTORIA_TEMPLATE_ID,
    saas: "leverads",
    name: "Mentoria Lever · quem ainda não vende",
    // Rascunho + selectable = opção no select do card, sem tirar o pt_leverads
    // do lugar de deck padrão do produto.
    status: "draft",
    selectable: true,
    pickLabel: "Mentoria (não vende ainda)",
    theme: { ...MENTORIA_THEME },
    acceptStage: "",
    calc: {
      validDays: 7,
      mentoria: mentoriaCalcBlock(),
      answerLabels: {
        aprender_verba: Object.fromEntries(Object.entries(VERBA_FIT).map(([k, v]) => [k, v.label])),
        aprender_interesse: { sim: "Quer começar", nao: "Só estava olhando" },
      },
    },
    slides: JSON.parse(JSON.stringify(MENTORIA_SLIDES)),
  };
}

