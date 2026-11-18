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

const MAPPING = { name: "nome", company: "empresa", email: "email", phone: "whatsapp" };

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
// A empresa entra EMPILHADA na tela do nome (Leo, 22/10/2026): o SDR precisa
// saber de que loja é o lead antes de ligar, e `mapping.company` leva a
// resposta pra `lead.company` sem virar pergunta de qualificação no card.
const CONTATO = [
  { key: "nome", label: "Como você se chama?", type: "text", required: true, placeholder: "Seu primeiro nome" },
  { key: "empresa", label: "E o nome da sua *empresa*?", type: "text", required: true, stack: true, placeholder: "Nome da empresa ou da loja" },
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

// A variável vira o RÓTULO da resposta ("1 conta", "2 a 3 contas", "Só
// online"), então o texto não repete a unidade. O OEM publicado não tem mais
// a pergunta `niche` (é autopeças por definição): 233 leads em set/2026
// chegaram com "Minha operação: {{niche}}, 1 conta contas" — a migração
// ensureFormPrefillV2 troca o texto dos forms já publicados.
export const PREFILL = {
  oem: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever OEM. Minha operação: autopeças, {{channel}}, {{accounts}}, {{listings}} anúncios ativos.",
  ads: "Oi, me chamo {{nome}} e quero saber mais sobre o Lever Ads. Minha operação: {{niche}}, {{accounts}}, {{listings}} anúncios ativos.",
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
    // O corte de CNPJ entra na frente e o ramo da Mentoria no fim (ver
    // comGateDeEmpresa, no pé do arquivo).
    questions: comGateDeEmpresa([
      NUCLEO[0],                                        // nicho
      ...(linha === "oem" ? FISICO : []),               // loja física: só no OEM
      ...NUCLEO.slice(1),                               // contas → ticket
      ...CONTATO,
    ], MAPPING),
    exits: { ...EXITS },
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


// ── Corte de qualificação: empresa aberta (Leo, 18/11/2026) ─────────────────
// Recupera nos três formulários v2 a SAÍDA LATERAL que existia desde jul/2026
// e tinha ficado só no formulário antigo (`fo_diagnostico_leverads`, sem
// tráfego desde 16/09): quem não é do perfil sai do fluxo de venda em vez de
// entrar como lead. Entre jul e set isso filtrava 12% a 19% dos envios por
// mês; de out/2026 em diante a trava não existia e esse público voltou a
// contar conversão pra Meta e a receber ligação do robô.
//
// O corte agora é o CNPJ (decisão do Leo, 18/11): quem ainda não tem empresa
// aberta vai pro ramo da Mentoria. Quem tem CNPJ segue no funil de venda,
// inclusive quem ainda não vende em marketplace.
//
// A CHAVE do ramo é a mesma de julho de propósito (`aprender_verba`): a régua de
// verba → oferta (mentoria.js), a ordenação da coluna, o roteiro de call, o
// bloco da Mentoria no placar e o tile "Fora do perfil" na Publicidade já leem
// exatamente essa resposta.
export const GATE_KEY = "tem_empresa";

export const GATE = Object.freeze({
  key: GATE_KEY,
  label: "Antes de tudo: você já tem *empresa aberta* (CNPJ)?",
  type: "select",
  required: true,
  // Resposta constante em todo lead de venda ("Sim, tenho CNPJ"): no resumo do
  // aviso de lead novo ela roubaria uma das três vagas sem dizer nada.
  noSummary: true,
  options: [
    { value: "sim", label: "Sim, tenho CNPJ" },
    // Sai do fluxo de venda e carrega a saída "mentoria" até o fim, o que deixa
    // reusar as MESMAS perguntas de contato (o mapping continua valendo).
    { value: "nao", label: "Ainda não tenho empresa", to: "aprender_verba", exit: "mentoria" },
  ],
});

// Ramo de quem ainda não tem empresa. Fica no FIM da lista de perguntas: o
// fluxo de quem é do perfil não muda em nada, só ganha a tela do corte.
// O ramo é uma pergunta só. A de interesse ("quer aprender e começar a vender?")
// existia com a recusa como segunda resposta; o Leo tirou a recusa em 18/11, e
// pergunta de resposta única não é pergunta: era um clique a mais e um dado
// constante. Quem não tem empresa agora vai direto pra verba, que é o que
// decide a oferta, e ninguém mais sai do formulário sem deixar contato.
export function ramoMentoria(mapping = MAPPING) {
  return [
    {
      key: "aprender_verba",
      label: "Qual é sua *verba pra começar*?",
      type: "select", required: true,
      to: mapping.name, // volta pras perguntas de contato do fluxo normal
      options: [
        { value: "ate-1k", label: "Até R$ 1 mil" },
        { value: "1k-5k", label: "R$ 1 mil a R$ 5 mil" },
        { value: "5k-20k", label: "R$ 5 mil a R$ 20 mil" },
        { value: "20k+", label: "Mais de R$ 20 mil" },
        // Sem "ainda não sei" de propósito: a verba é o que qualifica essa fila
        // e a saída fácil esvaziava a pergunta (decisão do Leo em 22/07).
      ],
    },
  ];
}

// Telas finais das duas saídas. A da Mentoria guarda o lead na coluna Mentoria;
// a de quem não quer vender não cria card nenhum (acontece antes do contato).
// Uma saída só: a de quem não quer começar a vender saiu junto com a recusa
// (saída sem nenhuma opção apontando pra ela é configuração morta).
export const EXITS = Object.freeze({
  mentoria: {
    label: "Ainda não tem empresa aberta",
    stage: "Mentoria",
    title: "Recebemos! Você está *no começo da jornada*.",
    subtitle: "A nossa plataforma é pra quem já vende, mas a Mentoria Lever é exatamente pra quem está começando: a gente coloca um produto nosso, que já vende todo dia, na sua conta pra fazer as primeiras vendas enquanto você escolhe e compra o seu estoque com a gente. Vamos te chamar no WhatsApp pra conversar.",
  },
});

// Monta a lista de perguntas com o corte na frente e o ramo no fim. É a MESMA
// função que a migração usa nos formulários já publicados, pra não existirem
// duas versões do mesmo fluxo. Idempotente: lista que já tem o corte volta igual.
export function comGateDeEmpresa(questions, mapping = MAPPING) {
  const qs = (questions || []).map((q) => ({ ...q }));
  if (qs.some((q) => q?.key === GATE_KEY)) return qs;

  // A pergunta do nome da empresa é PULADA no ramo: pedir o nome da empresa de
  // quem acabou de responder que não tem empresa desmente a própria pergunta.
  const empresaKey = mapping?.company || "";
  const iEmpresa = empresaKey ? qs.findIndex((q) => q.key === empresaKey) : -1;
  if (iEmpresa >= 0) qs[iEmpresa] = { ...qs[iEmpresa], hideOnExit: ["mentoria"] };

  // O último passo do fluxo de venda precisa TERMINAR explicitamente, senão
  // cairia nas perguntas do ramo, que ficam logo abaixo dele.
  const contato = new Set([mapping?.name, mapping?.company, mapping?.phone, mapping?.email].filter(Boolean));
  const iUltimo = qs.map((q, i) => (contato.has(q.key) ? i : -1)).filter((i) => i >= 0).pop();
  if (iUltimo != null) qs[iUltimo] = { ...qs[iUltimo], to: "_end" };

  const gate = { ...GATE, options: GATE.options.map((o) => ({ ...o })) };
  return [gate, ...qs, ...ramoMentoria(mapping)];
}

// Avaliado no load, por isso fica no fim: depende das constantes do corte.
export const FORMS_V2 = Object.keys(FORM_IDS).map(formV2);
