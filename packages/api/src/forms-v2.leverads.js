// Formulários v2, um por linha de produto (OEM · Ads · Price).
//
// Espelham o padrão do `fo_diagnostico_leverads`: mesmo tema, mesmo mapping
// (nome/email/whatsapp), mesmo handoff de WhatsApp no fim com a mensagem já
// preenchida. O que muda é o CONTEÚDO — as perguntas que alimentam a
// classificação por produto, e a headline virada pra ganho de performance em
// vez de redução de tempo operacional.
//
// Ordem das telas: cliques baratos primeiro, as duas abertas no meio (depois
// que a pessoa já investiu quatro respostas), volume em seguida e contato por
// último. Perguntar faturamento antes de entregar qualquer coisa inverte a
// ordem de reciprocidade e derruba o preenchimento.

const TEMA = {
  bg: "#f7f8fa", surface: "#ffffff", fg: "#0c1d2b",
  accent: "#0F766E", accentFg: "#ffffff",
  font: "'Instrument Sans', system-ui, sans-serif",
  radius: 12, logoUrl: "", logoHeight: 24,
};

const MAPPING = { name: "nome", email: "email", phone: "whatsapp" };

// Núcleo comum. É o que torna os leads comparáveis entre as três linhas e o
// que permite detectar porta errada (autopeças que entra pelo form de Ads).
const NUCLEO = [
  {
    key: "niche", label: "Qual o seu *principal nicho*?", type: "select", required: true,
    options: [
      { value: "autopecas", label: "Autopeças" },
      { value: "eletronicos", label: "Eletrônicos" },
      { value: "moda", label: "Moda" },
      { value: "casa", label: "Casa & Decoração" },
      { value: "beleza", label: "Beleza" },
      { value: "outros", label: "Outro" },
    ],
  },
  {
    key: "accounts", label: "Quantas *contas de anúncio* você opera?", type: "select", required: true,
    options: [
      { value: "1", label: "1 conta" },
      { value: "2-3", label: "2 a 3 contas" },
      { value: "4-6", label: "4 a 6 contas" },
      { value: "7-10", label: "7 a 10 contas" },
      { value: "10+", label: "Mais de 10 contas" },
    ],
  },
  {
    key: "listings", label: "Quantos *anúncios ativos* ao todo?", type: "select", required: true,
    options: [
      { value: "0-500", label: "Até 500" },
      { value: "500-1000", label: "500 a 1.000" },
      { value: "1000-5000", label: "1.000 a 5.000" },
      { value: "5000-10000", label: "5.000 a 10.000" },
      { value: "10000+", label: "Mais de 10.000" },
    ],
  },
  {
    // Única aberta do formulário. Com a pergunta do "o que já tentou" fora, é
    // daqui que sai TODA a leitura de intenção — por isso o peso dela na régua
    // subiu (ver qualificacao() em classificacao.js).
    key: "trigger", label: "O que fez você procurar uma solução *agora*?", type: "textarea", required: true,
    placeholder: "Pode ser direto — o que mudou ou o que travou.",
    help: "Quanto mais específico, mais rápido conseguimos te ajudar.",
  },
  {
    key: "orders", label: "Quantos *pedidos por mês*, aproximadamente?", type: "select", required: true,
    options: [
      { value: "0-200", label: "Até 200" },
      { value: "200-500", label: "200 a 500" },
      { value: "500-1000", label: "500 a 1.000" },
      { value: "1000-2000", label: "1.000 a 2.000" },
      { value: "2000+", label: "Mais de 2.000" },
    ],
  },
  {
    key: "ticket", label: "Qual o seu *ticket médio*?", type: "select", required: true,
    options: [
      { value: "0-70", label: "Até R$ 70" },
      { value: "70-150", label: "R$ 70 a 150" },
      { value: "150-300", label: "R$ 150 a 300" },
      { value: "300-600", label: "R$ 300 a 600" },
      { value: "600+", label: "Mais de R$ 600" },
    ],
  },
];

// Loja física só no formulário de OEM: é lá que ela muda alguma coisa (o
// lojista com catálogo grande e pouco anúncio é o lead de maior potencial da
// linha). Nos outros dois seria pergunta sem consequência.
//
// O "quantas unidades?" é condicional via BRANCHING (`to`), que é o mecanismo
// que o builder tem — quem responde "só online" pula direto pra pergunta de
// contas; quem tem loja física cai na de unidades.
const FISICO = [
  {
    key: "channel", label: "Você vende *só online* ou também tem loja física?", type: "select", required: true,
    options: [
      { value: "online", label: "Só online", to: "accounts" },
      { value: "online-fisico", label: "Online + loja física" },
    ],
  },
  {
    key: "stores", label: "Quantas unidades?", type: "select", required: true,
    options: [
      { value: "1", label: "1 loja" },
      { value: "2-3", label: "2 a 3 lojas" },
      { value: "4+", label: "4 ou mais" },
    ],
  },
];

// Contato por último: os campos que mais custam vêm depois do investimento.
const CONTATO = [
  { key: "nome", label: "Como você se chama?", type: "text", required: true, placeholder: "Seu primeiro nome" },
  { key: "whatsapp", label: "Qual o seu *WhatsApp*?", type: "phone", required: true, stack: false },
  { key: "email", label: "E o seu melhor e-mail?", type: "email", required: true, stack: true },
];


// Headlines viradas pra GANHO de performance, não pra redução de tempo
// operacional — é a direção nova da comunicação dos anúncios.
// Sem número de perguntas no subtítulo: o rodapé calcula as etapas sozinho
// (12, com o e-mail empilhado no WhatsApp) e prometer 10 desmente a própria
// tela na primeira etapa.
const WELCOME = {
  oem: {
    title: "Descubra quanto sua operação *deixa de vender* com anúncio de peça sem a compatibilidade certa.",
    subtitle: "Leva menos de um minuto, e nosso time te mostra, em reais, o tamanho do catálogo que dá pra colocar no ar.",
    button: "Começar",
  },
  ads: {
    title: "Descubra como *aumentar sua margem* usando as mesmas automações das grandes operações de ML.",
    subtitle: "Leva menos de um minuto, e nosso time te mostra onde está o dinheiro parado nas suas contas.",
    button: "Começar",
  },
  price: {
    title: "Descubra quanto *preço desatualizado* custa por mês na sua operação.",
    subtitle: "Leva menos de um minuto, e nosso time te mostra quanto dá pra recuperar ajustando preço na hora certa.",
    button: "Começar",
  },
};

const PREFILL = {
  oem: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever OEM. Minha operação: {{niche}}, {{accounts}} contas, {{listings}} anúncios ativos.",
  ads: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever Ads. Minha operação: {{niche}}, {{accounts}} contas, {{listings}} anúncios ativos.",
  price: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever Price. Minha operação: {{niche}}, {{listings}} anúncios ativos, {{orders}} pedidos por mês.",
};

const NOMES = { oem: "Diagnóstico Lever OEM", ads: "Diagnóstico Lever Ads", price: "Diagnóstico Lever Price" };

export const FORM_IDS = { oem: "fo_oem_v2", ads: "fo_ads_v2", price: "fo_price_v2" };

export function formV2(linha) {
  return {
    id: FORM_IDS[linha],
    name: NOMES[linha],
    saas: "leverads",
    // Nasce em rascunho: publicar é ato deliberado, não efeito de deploy. O
    // A/B só manda tráfego pra formulário publicado.
    status: "draft",
    theme: { ...TEMA },
    welcome: { ...WELCOME[linha] },
    submitLabel: "Receber meu diagnóstico",
    questions: [
      NUCLEO[0],                                        // nicho
      ...(linha === "oem" ? FISICO : []),               // loja física: só no OEM
      ...NUCLEO.slice(1),                               // contas → ticket
      ...CONTATO,
    ].map((q) => ({ ...q })),
    thanks: {
      title: "Seu perfil foi *aprovado*.",
      subtitle: "Vamos te levar pro WhatsApp com o resumo do seu perfil. É só enviar a mensagem que já vai pronta que nosso time responde na sequência.",
      whatsapp: "5541936183835",
      whatsappMsg: "Te levando pro WhatsApp, é só enviar a mensagem que já está pronta.",
      whatsappAuto: true,
      whatsappPrefill: PREFILL[linha],
    },
    mapping: { ...MAPPING },
    // Marca a linha de origem: a classificação usa pra detectar porta errada.
    formProduct: linha,
  };
}

export const FORMS_V2 = Object.keys(FORM_IDS).map(formV2);
