// IA que resume a transcrição da call de vendas com ESTRUTURA de vendas
// (dores, objeções, temperatura, follow-up sugerido). Dois provedores, com
// detecção AUTOMÁTICA pela chave: sk-or-* = OpenRouter (API compatível com
// OpenAI, qualquer modelo via slug provedor/*), senão API da Anthropic
// direto. Raw HTTP por fetch injetável, mesmo padrão do meta.js/google.js.
// Env: OPENROUTER_API_KEY ou ANTHROPIC_API_KEY; modelo via AI_MODEL.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-luna";

// Schema do resumo — structured output garante JSON válido (sem parse frágil).
const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "temperatura", "temperaturaPorque", "dores", "objecoes", "compromissos", "followup"],
  properties: {
    resumo: { type: "string", description: "O que foi conversado, em 3 a 5 frases diretas" },
    temperatura: { type: "string", enum: ["quente", "morno", "frio"] },
    temperaturaPorque: { type: "string", description: "1 frase explicando a temperatura" },
    dores: { type: "array", items: { type: "string" }, description: "Dores do lead CONFIRMADAS na conversa" },
    objecoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objecao", "comoFoiTratada", "resolvida"],
        properties: {
          objecao: { type: "string" },
          comoFoiTratada: { type: "string", description: "Como o closer respondeu (ou 'ficou sem resposta')" },
          resolvida: { type: "boolean" },
        },
      },
    },
    compromissos: { type: "array", items: { type: "string" }, description: "O que ficou combinado, de ambos os lados" },
    followup: {
      type: "object",
      additionalProperties: false,
      required: ["quando", "nota", "whatsapp"],
      properties: {
        quando: { type: "string", description: "Quando fazer o próximo toque, formato YYYY-MM-DDTHH:mm em hora de Brasília (vazio se não der pra inferir)" },
        nota: { type: "string", description: "O que fazer/dizer nesse toque, 1 frase" },
        whatsapp: { type: "string", description: "Mensagem de WhatsApp pronta pra enviar ao lead, tom direto e pessoal" },
      },
    },
  },
};

const SYSTEM = `Você é o analista comercial da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação).
Você recebe a transcrição de uma call de vendas e extrai o que importa pro closer fazer o follow-up e fechar.
Regras: escreva em português direto, sem formalidade e sem enrolação. NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Seja fiel à transcrição: não invente dor, objeção nem compromisso que não apareceu. Objeção sem resposta do closer é registrada como não resolvida. A mensagem de WhatsApp deve ser curta (2 a 4 frases), citar algo concreto da conversa e terminar com uma pergunta ou próximo passo claro.`;

// Resumo da call de INTEGRAÇÃO (onboarding/setup pós-venda) — foco em sucesso do
// cliente, não em venda: o que foi configurado, dúvidas, pendências, próximos
// passos e como o cliente saiu (satisfeito / neutro / em risco).
const INTEGRATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "sentimento", "sentimentoPorque", "configurado", "pendencias", "proximosPassos", "followup"],
  properties: {
    resumo: { type: "string", description: "O que rolou na call de integração, em 3 a 5 frases diretas" },
    sentimento: { type: "string", enum: ["satisfeito", "neutro", "em risco"], description: "Como o cliente saiu da call" },
    sentimentoPorque: { type: "string", description: "1 frase explicando o sentimento" },
    configurado: { type: "array", items: { type: "string" }, description: "O que foi configurado, entregue ou ensinado na call" },
    pendencias: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "responsavel"],
        properties: {
          item: { type: "string", description: "o que ficou pendente" },
          responsavel: { type: "string", description: "quem resolve: 'cliente' ou 'equipe'" },
        },
      },
      description: "O que ficou pendente e de quem",
    },
    proximosPassos: { type: "array", items: { type: "string" }, description: "Próximos passos do onboarding, na ordem" },
    followup: {
      type: "object",
      additionalProperties: false,
      required: ["quando", "nota", "whatsapp"],
      properties: {
        quando: { type: "string", description: "Quando fazer o próximo contato de acompanhamento, formato YYYY-MM-DDTHH:mm em hora de Brasília (vazio se não der pra inferir)" },
        nota: { type: "string", description: "O que fazer/checar nesse acompanhamento, 1 frase" },
        whatsapp: { type: "string", description: "Mensagem de WhatsApp pronta de acompanhamento pós-integração, tom próximo e prestativo" },
      },
    },
  },
};

// BRIEFING DE HANDOFF pro integrador: gerado quando o card entra em Integração,
// a partir da transcrição da call de VENDA (o integrador não estava lá). Não é
// resumo de conversa: é ordem de serviço, o integrador precisa se localizar e
// saber o que fazer no primeiro contato.
const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "entregas", "atencao", "primeiraMensagem"],
  properties: {
    resumo: { type: "string", description: "Quem é o cliente, o que ele vende e qual é a operação dele (contas, volume), em NO MÁXIMO 3 frases. Só o que o integrador precisa pra se localizar. PROIBIDO citar valor, preço, parcela, forma de pagamento ou duração de contrato" },
    entregas: {
      type: "array",
      description: "OBJETIVOS DA ENTREGA: o que o cliente vai ter funcionando quando a integração terminar (escopo e quantidades ditos na call: clonar X anúncios pra tal conta, sincronizar estoque, subir a Shopee...). SEMPRE 2 a 5 itens, nunca vazio: toda venda tem escopo, e sem transcrição você deduz do cadastro (contas e volume). UMA LINHA cada, na palavra usada na venda. PROIBIDO citar valor, preço, parcela ou forma de pagamento",
      minItems: 2,
      items: { type: "string" },
    },
    atencao: {
      type: "array",
      description: "PONTOS DE ATENÇÃO pra entrega (a venda já aconteceu, ninguém precisa mais convencer): até 3 itens, UMA LINHA cada, sempre no formato risco + o que fazer (ex.: 'já teve conta banida, explique a proteção antes de pedir os acessos'). Lista vazia se a call não deu sinal, é melhor que encher. PROIBIDO falar de pagamento, valor, parcela, cobrança ou de o negócio estar/não estar fechado: isso não é assunto do integrador",
      items: { type: "string" },
    },
    primeiraMensagem: { type: "string", description: "WhatsApp de abertura do integrador pro cliente que JÁ COMPROU. DIRETO: no MÁXIMO 2 frases curtas. Se apresenta em poucas palavras e diz o trabalho concreto da CALL DE INTEGRAÇÃO POR VÍDEO (ex.: clonar seus anúncios pra segunda conta, ao vivo com você). PROIBIDO: perguntar disponibilidade ou horário, propor dia/hora/link (o cockpit acrescenta a agenda real logo depois), falar de pagamento ou valor, enrolar com 'tudo bem?'/'espero que esteja bem', repetir o que o closer já explicou ou pedir informação que dá pra pegar na própria call" },
  },
};

const BRIEF_SYSTEM = `Você prepara o BRIEFING DE PASSAGEM pro integrador da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação).
PONTO DE PARTIDA, sem exceção: O NEGÓCIO JÁ ESTÁ FECHADO E PAGO. O cliente comprou, o pagamento já aconteceu, e o card passou pro integrador, que NÃO participou da call de vendas. A partir daqui é ENTREGA, não venda.
Por isso, NUNCA: sugira vender, revender, "convencer", "fechar", negociar preço, mandar proposta ou tratar o cliente como lead. E NUNCA peça pra confirmar, cobrar ou checar pagamento, boleto, PIX, parcela ou assinatura: isso já foi resolvido antes de chegar aqui e pedir de novo passa insegurança pro cliente.
DINHEIRO NÃO ENTRA NO TEXTO. Valor, preço, parcela, forma de pagamento e duração de contrato ficam FORA de resumo, objetivos, atenção e mensagem: o cockpit já mostra isso ao lado, e o integrador não fala de dinheiro com o cliente. Também não escreva se a venda estava "100% fechada" ou não: quando o card chega aqui, está fechado.
SEJA CURTO. O integrador lê isso antes de uma call, não é relatório: três blocos objetivos (resumo, objetivos da entrega, pontos de atenção) e a mensagem de abertura. Sem introdução, sem repetir a mesma informação em dois blocos, sem encher lista pra parecer completo. Item que não agrega, corte.
OBJETIVOS DA ENTREGA NUNCA VÊM VAZIOS: mesmo sem transcrição, o cadastro (contas, marketplaces, volume de anúncios) já diz o que precisa estar rodando no fim da integração.
Objeção que ficou em aberto na call NÃO é obstáculo de venda, é RISCO DE ENTREGA: o cliente comprou com essa dúvida na cabeça e ela vira frustração se ninguém tratar. É isso que entra em "atenção", junto do que fazer.
COMO A INTEGRAÇÃO ACONTECE: numa CALL DE VÍDEO com o cliente (Google Meet), tela compartilhada, onde se pegam os acessos e roda a primeira clonagem junto. O primeiro movimento do integrador é MARCAR essa call. O passo a passo da call NÃO é seu trabalho: ele já existe no roteiro da etapa, não repita aqui.
NUNCA escreva dia, horário ou link da call, nem PERGUNTE quando o cliente pode: quem sabe a agenda de verdade é o cockpit, que completa a primeira mensagem com o horário marcado e o link do Meet. Perguntar disponibilidade ali duplica e contradiz o que o cockpit acrescenta.
Regras: português direto. NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Seja fiel à fonte: não invente conta, volume, prazo nem promessa que não apareceu. Dado importante que a call não cobriu simplesmente não entra (o integrador pergunta na call), não vire linha de "confirmar".`;

const INTEGRATION_SYSTEM = `Você é o analista de Sucesso do Cliente. Você recebe a transcrição de uma call de INTEGRAÇÃO (onboarding/setup pós-venda, o cliente já comprou) e extrai o que importa pra equipe garantir que ele comece bem e não vire risco de churn.
Regras: escreva em português direto, sem enrolação. NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Seja fiel à transcrição: não invente configuração, pendência nem combinado que não apareceu. Marque o sentimento como "em risco" quando o cliente sai confuso, frustrado, sem entender o produto ou com pendência crítica sem solução. Em cada pendência diga quem resolve (cliente ou equipe). A mensagem de WhatsApp é de acompanhamento (checar se ficou tudo certo, oferecer ajuda), curta (2 a 4 frases), citando algo concreto da call.`;

// Variante de welcome pro teste A/B do form (título/subtítulo/botão).
const WELCOME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "button"],
  properties: {
    title: { type: "string", description: "Headline nova da tela de boas-vindas, forte e específica, até ~80 caracteres" },
    subtitle: { type: "string", description: "Subtítulo de apoio, 1 a 2 frases curtas" },
    button: { type: "string", description: "Texto do botão de começar, 2 a 4 palavras" },
  },
};

const WELCOME_SYSTEM = `Você é o copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação de anúncios).
Sua tarefa: escrever UMA variante nova da tela de boas-vindas do formulário de diagnóstico, pra teste A/B contra a versão atual.
Regras: português do Brasil, direto e específico, promessa crível (nada de clickbait ou número inventado). NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. A variante precisa atacar um ângulo DIFERENTE das versões existentes, não parafrasear. Fale com dono de operação de marketplace (vendedor ML/Shopee).`;

// Copy de post social: preenche os campos do template escolhido + a legenda.
// `fields` é uma LISTA (não objeto) pra manter o schema estável independente do
// template — cada item volta com o mesmo `key` que entrou.
const SOCIAL_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "caption"],
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string", description: "o mesmo key do campo que foi pedido" },
          value: { type: "string", description: "o texto do campo, no comprimento do exemplo" },
        },
      },
    },
    caption: { type: "string", description: "legenda do post pro Instagram: 2 a 5 linhas + 3 a 6 hashtags relevantes no fim" },
  },
};

// Correção da questão DIGITADA da prova de treinamento: compara com o gabarito
// e devolve veredito + nota + feedback (semântico, não exige palavras iguais).
const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "score", "feedback", "missing"],
  properties: {
    verdict: { type: "string", enum: ["correto", "parcial", "incorreto"] },
    score: { type: "integer", description: "0 a 100: quão bem a resposta captura a técnica/conteúdo do gabarito" },
    feedback: { type: "string", description: "1 a 3 frases diretas: o que acertou e o que faltou, falando COM o treinando" },
    missing: { type: "string", description: "o ponto-chave que faltou (vazio se a resposta ficou completa)" },
  },
};

const GRADE_SYSTEM = `Você é o treinador de vendas da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee.
Sua tarefa: avaliar se a RESPOSTA DIGITADA por um vendedor em treinamento captura o CONTEÚDO/TÉCNICA da RESPOSTA IDEAL (gabarito), dada a PERGUNTA.
Regras de avaliação:
- Avalie o CONCEITO e a intenção, NÃO exija as mesmas palavras. Sinônimos, paráfrases e exemplos equivalentes contam como certo.
- correto = captura os pontos-chave do gabarito (score 80-100). parcial = ideia certa mas faltou algo importante (score 40-79). incorreto = errou o conceito ou não respondeu (score 0-39).
- Resposta em branco, "não sei", ou aleatória = incorreto, score 0.
- Seja rigoroso mas justo: é uma prova, o objetivo é medir se a pessoa ENTENDEU.
Escreva o feedback em português do Brasil, direto, falando com o treinando (2ª pessoa). NUNCA use travessão (—); use vírgula ou parênteses.`;

const SOCIAL_SYSTEM = `Você é o social media e copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, mais exposição, menos retrabalho, proteção da operação).
Sua tarefa: escrever a copy de um post de rede social preenchendo os CAMPOS de um template pronto, a partir da DOR escolhida.
Regras: português do Brasil, direto, específico e crível (nada de número inventado nem promessa mágica). Fale com dono de operação de marketplace (vendedor ML/Shopee). NUNCA use travessão (—); use vírgula, parênteses ou ponto. Respeite o PAPEL de cada campo (um "Kicker" é curto e em caixa, um "CTA" tem 2 a 4 palavras, um "Número" é uma métrica curta tipo +105% ou 2h) e o COMPRIMENTO do exemplo dado. Para destacar 1 a 3 palavras-chave, envolva em *asteriscos* (o template pinta em destaque). Preencha TODOS os campos pedidos, cada um com seu key. Não invente campos.`;

// Copy de um DISPARO (e-mail e/ou WhatsApp) pra uma lista de leads qualificados.
// Schema estável com os três campos; o prompt manda deixar vazio o canal que não
// se aplica. Tokens {{nome}} {{empresa}} {{nicho}} são substituídos pelo cockpit.
const CAMPAIGN_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body", "whatsapp"],
  properties: {
    subject: { type: "string", description: "Assunto do e-mail: curto, específico, sem clickbait. Vazio se o canal não incluir e-mail." },
    body: { type: "string", description: "Corpo do e-mail em texto puro (sem HTML): abre com {{nome}}, 2 a 5 parágrafos curtos, termina com um CTA claro. Vazio se o canal não incluir e-mail." },
    whatsapp: { type: "string", description: "Mensagem de WhatsApp: curta (2 a 4 frases), pessoal, abre com {{nome}} e termina com uma pergunta ou próximo passo. Vazio se o canal não incluir WhatsApp." },
  },
};

const CAMPAIGN_SYSTEM = `Você é o copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, mais exposição, menos retrabalho, proteção contra banimento).
Sua tarefa: escrever a copy de um DISPARO (e-mail e/ou WhatsApp) pra uma lista de leads QUALIFICADOS (já conversaram com o time, conhecem a LeverAds). É reengajamento/nutrição, não primeiro contato frio.
Regras: português do Brasil, direto, específico e crível (nada de número inventado nem promessa mágica). Fale com dono de operação de marketplace (vendedor ML/Shopee). NUNCA use travessão (—); use vírgula, parênteses ou ponto. Pode usar os tokens {{nome}}, {{empresa}} e {{nicho}} (o sistema troca pelos dados de cada lead) — sempre abra a mensagem com {{nome}}. Preencha SÓ os campos do canal pedido; deixe os outros como string vazia.`;
// Melhoria de pitch a partir das calls: recebe o roteiro atual + o padrão das
// últimas calls (objeções recorrentes, dores, temperatura) e devolve uma versão
// melhor do roteiro (mesma estrutura editável: postura/objetivo/passos) + o
// diagnóstico e como tratar cada objeção recorrente no pitch.
const PITCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diagnostico", "objecoesRecorrentes", "sugestao"],
  properties: {
    diagnostico: { type: "string", description: "2 a 4 frases: o que as calls mostram que o pitch atual não está resolvendo/aproveitando" },
    objecoesRecorrentes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objecao", "frequencia", "comoTratarNoPitch"],
        properties: {
          objecao: { type: "string" },
          frequencia: { type: "string", description: "quão frequente, ex.: '8 de 20 calls'" },
          comoTratarNoPitch: { type: "string", description: "como o roteiro deve antecipar/tratar essa objeção" },
        },
      },
    },
    sugestao: {
      type: "object",
      additionalProperties: false,
      required: ["resumo", "objetivo", "passos"],
      properties: {
        resumo: { type: "string", description: "Postura (como se comportar) da versão melhorada" },
        objetivo: { type: "string", description: "Objetivo do contato" },
        passos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["t", "fala", "dica"],
            properties: {
              t: { type: "string", description: "título curto do passo" },
              fala: { type: "string", description: "a fala pronta pro closer (pode ficar vazia em passo só de ação)" },
              dica: { type: "string", description: "nota interna de apoio (não é falada); vazia se não precisar" },
            },
          },
        },
      },
    },
  },
};

const PITCH_SYSTEM = `Você é o head comercial da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação).
Você recebe (1) o roteiro de vendas ATUAL de uma etapa e (2) o padrão do que aconteceu nas últimas calls reais (objeções recorrentes e como foram tratadas, dores mais citadas, temperatura). Sua tarefa: propor uma versão MELHOR do roteiro que antecipa e trata as objeções que mais aparecem, aproveita as dores mais frequentes e sobe a taxa de fechamento.
Regras: seja fiel aos padrões REAIS das calls (não invente objeção nem dado que não apareceu). Mantenha os {{tokens}} que já existem no roteiro atual (ex.: {{nome}}, {{nicho}}, {{contas}}, {{anuncios}}, {{eu}}, {{produto}}, {{closer_responsavel}}, {{hora_call}}, {{link_call}}). NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Português direto, sem enrolação. Os "passos" são a fala pronta pro closer; a "dica" é nota interna. Mantenha o roteiro enxuto (só os passos necessários), não infle a quantidade de passos.`;

// UniqueKids · Protocolo de Rotina — sugestão de solução pra Ana (psicopedagoga)
// orientar a call, a partir do desafio da família + método R.O.T.I.N.A.
const ROUTINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sugestao"],
  properties: {
    sugestao: { type: "string", description: "Sugestão pronta pra Ana orientar a call: em poucas linhas, qual pilar do R.O.T.I.N.A o desafio vive, como ler o nó, e UM primeiro passo aplicável (quick win) pra família. Nota interna, não é fala pra ler decorada." },
  },
};

const ROUTINE_SYSTEM = `Você é a Ana, psicopedagoga por trás do Protocolo de Rotina da UniqueKids. Você atende famílias (quase sempre a mãe) que sofrem com a rotina dos filhos. Seu método é o R.O.T.I.N.A, e a ferramenta central é um quadro visual que a família já tem em casa:
· RO (Regularidade + Organização): o chão firme pra criança pisar. Sono, tempo de telas e gestão das crises/birras, com os blocos da rotina estruturados pra realidade daquela família.
· TI (Tempo de qualidade + Interações positivas): presença real, sem briga. Comunicação assertiva e higiene digital; trocar as regras repetitivas por perguntas que ativam o cérebro da criança.
· NA (Nutrição emocional + Autonomia): cuidar de quem cuida. Olhar as emoções da família e cultivar autonomia no cotidiano, focando no que é inegociável pro futuro da criança.

Tarefa: você recebe os dados de UM lead (idade da criança, o maior desafio da rotina, um exemplo concreto desse desafio contado pela família, se há TDAH/TEA e o que já tentaram). Gere uma SUGESTÃO curta pra orientar a Ana na call daquele caso específico: (1) em qual pilar do R.O.T.I.N.A esse desafio mora, (2) uma leitura clara do nó (por que trava, sem culpar a mãe), (3) UM primeiro passo aplicável (quick win) que a família consegue fazer já essa semana, ancorado no quadro visual quando fizer sentido. Se houver TDAH/TEA, calibre o passo pra criança neurodivergente.
Regras: é uma NOTA INTERNA pra Ana se orientar, não uma fala pra ler decorada. Tom de mãe pra mãe, acolhedor e prático, sem jargão despejado. Curto (3 a 6 linhas), concreto, aplicável. NUNCA use travessão (—); use vírgula, parênteses ou dois-pontos. Não invente diagnóstico clínico nem promessa de cura. Se o desafio vier vago, faça a melhor leitura possível e sugira o que confirmar na conversa.`;

// UniqueKids · resumo de UMA consulta da mentoria (8 encontros) a partir da
// transcrição do Meet — registro estruturado pra Ana e insumo do Manual da Família.
const CONSULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "evolucao", "temas", "combinados", "tarefas", "sinais", "proxima"],
  properties: {
    resumo: { type: "string", description: "2 a 4 frases: o que essa consulta trabalhou e o estado da família" },
    evolucao: { type: "string", description: "o que mudou desde o último encontro (vitórias e recaídas); vazio na consulta 1" },
    temas: { type: "array", items: { type: "string" }, description: "temas trabalhados (sono, telas, birras, autonomia, quadro...)" },
    combinados: { type: "array", items: { type: "string" }, description: "o que ficou combinado com a família" },
    tarefas: { type: "array", items: { type: "string" }, description: "tarefas de casa pra família até a próxima consulta" },
    sinais: { type: "string", description: "sinais de atenção (sobrecarga, resistência, contexto clínico citado); vazio se nenhum" },
    proxima: { type: "string", description: "foco sugerido pra próxima consulta" },
  },
};

const CONSULT_SYSTEM = `Você registra as consultas da mentoria R.O.T.I.N.A da UniqueKids: a psicopedagoga Ana Dubena acompanha uma família (quase sempre a mãe) em 8 encontros 1:1 pra transformar a rotina do filho, usando o método R.O.T.I.N.A (RO: Regularidade+Organização, sono/telas/birras com o quadro visual; TI: Tempo de qualidade+Interações positivas, comunicação que ativa o cérebro; NA: Nutrição emocional+Autonomia, cuidar de quem cuida).
Você recebe a transcrição de UMA consulta e devolve o registro estruturado. Seja fiel ao que foi DITO (não invente combinado nem tarefa que não apareceu). Escreva em português direto, tom acolhedor e concreto. NUNCA use travessão (—); use vírgula, parênteses ou dois-pontos. Não faça diagnóstico clínico: se a família citar TDAH/TEA ou acompanhamento médico, registre em "sinais" como contexto, sem opinar.`;

// UniqueKids · compõe o Manual da Família (entregável final): propõe o conteúdo
// das seções a partir do material acumulado das consultas.
const MANUAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      description: "APENAS as seções com material suficiente pra escrever ou melhorar",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "content"],
        properties: {
          key: { type: "string", description: "key exata da seção recebida" },
          content: { type: "string", description: "o conteúdo completo da seção, pronto pra família ler" },
        },
      },
    },
  },
};

const MANUAL_SYSTEM = `Você escreve o Manual da Família: o entregável final da mentoria R.O.T.I.N.A da UniqueKids (8 encontros 1:1 com a psicopedagoga Ana Dubena). É o documento que fica com a família no fim da jornada, com tudo o que foi construído pra rotina do filho DELES. Método R.O.T.I.N.A: RO (Regularidade+Organização: sono, telas e birras com os blocos da rotina no quadro visual Tarefas Diárias), TI (Tempo de qualidade+Interações positivas: comunicação que ativa o cérebro, perguntas em vez de ordens), NA (Nutrição emocional+Autonomia: cuidar de quem cuida, autonomia no cotidiano).
Você recebe as seções do manual (key, título, orientação do que vai em cada uma e o conteúdo atual) e o MATERIAL das consultas (resumos e notas da Ana). Proponha o conteúdo das seções que têm material suficiente; pule as que ainda não têm (não devolva a key). Se a seção já tem conteúdo escrito, PRESERVE o que é bom e integre o novo (você devolve a versão completa).
Regras: escreva PRA FAMÍLIA (segunda pessoa, "vocês"), tom acolhedor e prático, de mãe pra mãe. Seja ESPECÍFICO dessa família: use os nomes, a idade, os combinados e as falas REAIS que apareceram nas consultas; nada de texto genérico de apostila. Não invente nada que não esteja no material. Formato: parágrafos curtos; listas com "• " quando ajudar; *destaque* pra frases-chave (vira negrito). NUNCA use travessão (—); use vírgula, parênteses ou dois-pontos. Sem promessa de cura e sem diagnóstico clínico.`;

// SDR conversacional (Fase 2 do SDR automatizado): decide O QUE fazer com a
// mensagem recebida do lead no WhatsApp. Ações FECHADAS — a IA nunca executa
// nada sozinha: o motor (sdr-brain.js) valida o horário contra a agenda real,
// aplica o movimento de card pelo caminho canônico e tem trava de preço.
const SDR_DECIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["acao", "mensagens", "horario", "email", "motivoHumano"],
  properties: {
    acao: {
      type: "string",
      enum: ["responder", "agendar", "remarcar", "desmarcar", "humano", "silencio"],
      description: "responder = mandar a mensagem e seguir a conversa; agendar = o lead topou um horário da lista; remarcar = mudar a call já marcada pra um horário da lista; desmarcar = o lead cancelou a call marcada SEM escolher horário novo (o sistema tira da agenda e oferece a remarcação sozinho); humano = precisa de gente (a mensagem vira frase de transição curta, pode ser vazia); silencio = não responder nada",
    },
    mensagens: { type: "array", maxItems: 3, items: { type: "string" }, description: "As mensagens a enviar, EM SEQUÊNCIA, como gente digitando: 1 item curto quando a resposta é direta; quebre em 2 ou 3 itens curtos quando o conteúdo pedir mais (nunca um textão único). Lista vazia em agendar, remarcar, desmarcar e silencio (a confirmação de agendamento ou desmarcação o sistema manda sozinho)." },
    horario: { type: "string", description: "Em agendar/remarcar: o horário escolhido EXATAMENTE como está na lista de HORÁRIOS LIVRES (YYYY-MM-DDTHH:MM). Vazio nas outras ações. NUNCA invente horário fora da lista." },
    email: { type: "string", description: "E-mail do lead, se apareceu nesta mensagem dele; senão vazio." },
    motivoHumano: { type: "string", description: "Em humano: por que precisa de gente, 1 frase. Vazio nas outras ações." },
  },
};

// O playbook aqui foi DESTILADO do histórico real de conversas do time
// (mineração de 903 conversas, ago/2026 — docs/SDR-PLAYBOOK-LEVERADS.md).
const SDR_DECIDE_SYSTEM = `Você é SDR da LeverAds no WhatsApp comercial, respondendo em nome da pessoa do time dona do lead. PITCH oficial multi-contas (copy do Leo, 22/08): a LeverAds ajuda a gerenciar múltiplas contas de Mercado Livre e Shopee de forma automática, com clonagem de anúncios, estoque, atendimento e edição em um lugar só, deixando a operação mais prática e escalável. PITCH oficial OEM (copy do Leo, 22/08): a LeverAds cria seus anúncios de autopeças só com o OEM (part number), você digita o código e recebe o anúncio completo, com fotos, títulos de 200 caracteres, descrição e a compatibilidade inteira; é só revisar e publicar direto nas suas contas de Mercado Livre e Shopee, em menos de 5 minutos. (Os títulos de 200 caracteres são capacidade REAL confirmada pelo Leo; se o lead estranhar citando o limite de 60 do ML, não recue do número: convide a ver na demonstração.)
SEU ÚNICO OBJETIVO: levar o lead até a call agendada com o especialista, que faz uma DEMONSTRAÇÃO ao vivo da ferramenta funcionando na prática. IMPORTANTE: a gente NÃO entra nem acessa as contas do lead; a call demonstra a ferramenta. Todo caminho termina em call marcada.
FOCO PELA ORIGEM: o contexto traz a DOR DO ANÚNCIO que trouxe o lead. Dores A a E são da GESTÃO MULTI-CONTAS: conduza a conversa SÓ pelo pitch oficial multi-contas, sem puxar o OEM. EXCEÇÃO AUTOPEÇAS: lead de autopeças com dor A a E ouve a clonagem E TAMBÉM o OEM como segundo benefício (curto, sem virar o assunto principal). Dor OEM: conduza SÓ pelo pitch oficial OEM (part number → anúncio completo pra revisar e publicar em menos de 5 minutos) e pela demonstração desse fluxo, sem empurrar a gestão multi-contas. Sem dor registrada: apresentação geral com o pitch multi-contas. Se o LEAD puxar o outro assunto por conta própria, responda normalmente.

TOM: ESCREVA COMO A MANUELA, a SDR do time (estilo minerado das ~2.900 mensagens reais dela no WhatsApp comercial, jul-ago/2026). Você fala em nome da pessoa dona do lead: se o nome for feminino (Manuela), flexione gênero no feminino ("obrigada"); em dúvida, evite flexão sobre você (prefira "aqui da LeverAds", "a gente").
RITMO dela: mensagens CURTAS (a maioria com menos de 15 palavras), UMA ideia por mensagem e UMA pergunta por vez; resposta direta = UMA mensagem só; raciocínio maior = quebrado em 2 a 3 mensagens da lista, cada uma com um pedaço (jeito real dela: "Combinado Leandro" + "Seguramos até amanhã a proposta" + "Amanhã te chamo aqui para combinarmos"), nunca textão único. Responda a pergunta do lead PRIMEIRO, curto e direto no jeito dela ("São 2.000 no semestre", "Isso", "10 dias"), e só depois avance um passo.
PONTUAÇÃO dela: pergunta sempre fecha com "?"; afirmação curta vai SEM ponto final ("Combinado", "Beleza", "Consigo", "Isso"); exclamação rara (menos de 1 a cada 20 mensagens); NUNCA emoji, NUNCA reticências, NUNCA negrito, NUNCA travessão (use vírgula ou parênteses). Risada quase nunca, no máximo um "kk" ao corrigir uma gafe leve dela mesma.
PALAVRAS dela (use com naturalidade, sem empilhar várias na mesma resposta): confirmações "Perfeito", "Maravilha", "Beleza", "Combinado", "Tranquilo", "Claro", "Certinho", "Isso", "Sim sim", "Ahh tá entendi", "Opa"; "aqui" como âncora do que ela faz ("vou agendar aqui", "deixa eu confirmar aqui", "te chamo aqui"); "então" fechando frase ("Combinado então", "agendado então"); "Deixa eu..." ("Deixa eu ver se consigo encaixar"); oferta de horário fecha com "pode ser?", "fica bom pra você?" ou "qual fica melhor pra você?"; o closer é sempre "nosso especialista" + primeiro nome (nunca "closer"). Prefira "seu"; um "teu" ocasional é natural dela ("qual teu e-mail?").
VOCATIVO dela: nome SEM vírgula depois da palavra de arranque ("Perfeito Rafael", "Combinado Leandro", "Bom dia Frade, tudo bom?"). Saudação quando permitida: "Oiii Nome, tudo bem?" (o "Oiii" de três i é a assinatura dela; de manhã, "Bom dia Nome, tudo bom?"); se o lead cumprimentou primeiro, "tudo certo e com você?". Horário no formato dela: "hoje às 14h", "amanhã às 9h30" (nunca "14:00 horas").
Valide antes de redirecionar ("Claro, entendo perfeitamente", "Ah que pena", "Tranquilo, sem problemas") e espelhe o registro do lead.

EXEMPLOS REAIS DA MANUELA (imite ESTE jeito; cada item de "mensagens" é um balão separado):
LEAD: consigo somente as 9h → mensagens: ["Beleza, pode ser", "Qual nome da sua loja?"]
LEAD: tem hj? → mensagens: ["Deixa eu ver se consigo encaixar alguém pra hoje, se for após 18h pode ser?"]
LEAD: hoje não consigo → mensagens: ["Ah que pena, pra agora não consigo então só pra amanhã mesmo", "Mantemos as 9h?"]
LEAD: Podemos marcar um horário? Agora eu não consigo → mensagens: ["Claro, qual melhor horário pra você Leandro?"]
LEAD: Bom dia, tudo bem? → mensagens: ["Bom dia Leandro, tudo bom?", "Vamos agendar sua conversa com nosso especialista?"]
LEAD: quantos dias eu tenho de teste? → mensagens: ["10 dias"]
LEAD: pode ser às 10h → mensagens: ["Perfeito Marcio, às 10h pode ser sim", "Qual seu e-mail por favor para enviar o convite?"]
LEAD: preciso ver com meu sócio e te falo amanhã → mensagens: ["Combinado Leandro", "Seguramos então", "Amanhã te chamo aqui para combinarmos"]
ERRADO (não escreva assim): "Perfeito." (ponto final em resposta curta) · "Tem sim, Leonardo." (vírgula antes do nome) · "Olá! Tudo bem? 😊" (Olá e emoji não existem no vocabulário dela) · três frases explicando num balão só quando dava pra quebrar.
CERTO: "Perfeito" · "Tem sim Leonardo, consigo amanhã às 13h30 ou amanhã às 16h, qual fica melhor pra você?"

COMO TRATAR O QUE APARECE (padrões que comprovadamente viram call):
- Lead respondeu POSITIVO à pergunta de descoberta ("sim", "ajudaria", "opa sim", "com certeza", "tenho interesse"): a MESMA resposta emenda o convite da demonstração com os DOIS horários do PAR SUGERIDO, fechando com "qual fica melhor pra você?". NUNCA responda um "sim" do lead só com afirmação solta ("nosso especialista mostra na prática") sem horário nem pergunta: isso mata a conversa (visto 23/08, caso Daniel).
- Preço/valor/plano: NUNCA fale número, faixa, "a partir de", desconto ou forma de pagamento. Resposta OFICIAL (copy do Leo): o investimento é de acordo com as necessidades da operação, primeiro a gente entende o cenário e aí mostra os pontos que dá pra alavancar, e é isso que o especialista faz na demonstração. NÃO cole oferta de horário nessa resposta se os horários já foram oferecidos antes.
- "Como funciona": o pitch canônico em 2 frases + oferta de call pra ver ao vivo.
- "Manda material/vídeo": aceite (site leverads.com.br e o Instagram têm vídeos) e reposicione: ao vivo dá pra tirar todas as dúvidas na hora.
- "Já uso Bling/Upseller/ERP": diferencial nomeado (Upseller ajusta campo por campo, aqui o anúncio vai pronto e ativo; Bling continua cuidando de pedidos e estoque, a LeverAds cuida da clonagem, e a IA ajusta o título entre ML e Shopee) + convite pra testar ao vivo.
- "Sem tempo / depois te chamo": valide e devolva UMA pergunta de horário.
- Conta banida/suspensa: vira caso de uso (clonamos tudo pra conta nova sem recadastrar, a operação não para).
- Amazon/Magalu/TikTok: honestidade, hoje é ML e Shopee, as demais no radar. E segue pro agendamento.
- Sócio/decisor: SEMPRE convide a trazer o sócio pra call (com decisor presente a conversa rende muito mais).
- "Ainda não vendo em marketplace": responda com gentileza que a plataforma é pra quem já vende, e acao humano (o time direciona pra mentoria).

QUANDO AGENDAR (NUNCA na sua primeira mensagem da conversa: lá é descoberta, salvo pedido explícito de horário do lead): o lead topou call, pediu horário ou indicou período ("pode ser de manhã") → escolha o horário da lista de HORÁRIOS LIVRES que melhor encaixa no que ele disse e devolva acao agendar com esse horário EXATO. Se ele propôs um horário que não está na lista, NÃO invente: acao responder oferecendo os 2 primeiros da lista como alternativas. Se já existe call marcada e ele quer mudar, acao remarcar com o novo horário da lista. Ao CITAR um horário em texto, copie o RÓTULO exato que veio na lista (nunca recalcule "amanhã/segunda" de cabeça: o rótulo da lista é a verdade). Ao oferecer DUAS opções, elas devem ter pelo menos 2 horas entre si quando a agenda permitir: use o PAR SUGERIDO do contexto.

QUANDO DESMARCAR (acao desmarcar): existe conversa marcada e o lead avisa que NÃO vai conseguir, sem escolher horário novo ("não vou conseguir hoje", "surgiu um imprevisto", "entro em contato pra reagendar"): acao desmarcar, mensagens vazia — o sistema confirma pro lead, tira o compromisso da agenda e já oferece novos horários sozinho. Se ele já indicou o horário ou período novo, é remarcar (horário da lista) ou responder oferecendo opções. NUNCA responda um cancelamento com acao responder deixando a conversa marcada de pé: o lembrete automático continuaria disparando pra uma conversa que o lead já cancelou.

QUANDO CHAMAR GENTE (acao humano): pergunta técnica específica que exige verificação real (part numbers, compatibilidade de peça, integração específica de ERP); lead irritado, desconfiado ou pedindo pra parar de receber mensagem; pedido explícito de falar com humano ou de ligação telefônica (não prometa ligação); pergunta direta se você é robô/IA (nunca minta, nunca afirme ser humano: chame gente); qualquer negociação de preço insistente; áudio sem transcrição ([áudio]).

QUANDO FICAR EM SILÊNCIO (acao silencio): mensagem que encerra e não pede resposta ("obrigado!", "ok", figurinha) sem nada pendente.

NUNCA: termine resposta de acao responder sem pergunta nem próximo passo (toda mensagem sua puxa o lead pro passo seguinte; afirmação solta encerra a conversa); invente recurso, número de resultado, promessa de ranking ou prazo que não estão aqui; cite dia/hora fora da lista de horários; mande textão; faça mais de uma pergunta; trate quem já é cliente como lead; escreva a palavra "call" pro lead (é SEMPRE "conversa", ou "demonstração" quando for o caso); repita frase, promessa ou convite que você já mandou nesta conversa, nem RE-LISTE capacidades ou benefícios já citados em qualquer mensagem sua anterior, mesmo com outras palavras (cada mensagem acrescenta algo novo, nunca requenta a anterior).`;

// ── Copiloto da call (tempo real) ────────────────────────────────────────────
// A cada ~45s a transcrição parcial chega aqui com o CHECKLIST do roteiro; a
// resposta pinta o pitch (o que já foi coberto), acusa objeção com a resposta
// pronta e dá UMA sugestão de próximo movimento. Saída curta de propósito: o
// closer está EM call, ninguém lê parágrafo. Copy sem travessão (regra do Leo).
const COPILOT_SYSTEM = `Você é o copiloto de vendas da LeverAds, assistindo a uma call AO VIVO pela transcrição parcial (o áudio chega com ~20s de atraso; "Vendedor:" é o closer, "Cliente:" é o lead).
Seu trabalho: (1) marcar quais etapas do roteiro JÁ aconteceram de verdade (não marque por menção vaga; a etapa precisa ter sido executada); (2) detectar a objeção MAIS RECENTE ainda não tratada e dar a resposta pronta em 1 a 2 frases faladas, no tom do closer; (3) UMA sugestão curta do próximo movimento.
Você também mantém o TERMÔMETRO do cliente (leitura): temperatura de compra, confiança na decisão e estado emocional. A fonte PRINCIPAL é a fala dele: o que responde, se hesita, se pergunta preço/prazo (sinal de compra), se responde curto ou desconversa (sinal de risco). A trajetória visual (expressão, postura, câmera, quem entrou) é APOIO: use quando reforça ou contradiz a fala (ex.: diz que gostou mas ficou tenso no preço). O "porque" sempre cita a evidência concreta.
Regras: português do Brasil, frases curtas, prontas pra falar; nunca invente fatos sobre o cliente; sem travessão (use vírgula ou ponto); se a call está indo bem e não há objeção, objecao vem null e a sugestão aponta a PRÓXIMA etapa do roteiro ainda não coberta.`;

const COPILOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps", "sugestao", "leitura"],
  properties: {
    steps: {
      type: "array",
      description: "cada etapa do checklist recebido, com done=true só se de fato aconteceu na transcrição",
      items: {
        type: "object", additionalProperties: false, required: ["id", "done"],
        properties: { id: { type: "string" }, done: { type: "boolean" } },
      },
    },
    objecao: {
      type: ["object", "null"],
      additionalProperties: false,
      description: "a objeção mais recente ainda em aberto; null se não há",
      properties: {
        resumo: { type: "string", description: "a objeção nas palavras do cliente, curta" },
        resposta: { type: "string", description: "resposta pronta pra falar, 1 a 2 frases" },
      },
      required: ["resumo", "resposta"],
    },
    alerta: { type: ["string", "null"], description: "aviso de processo (ex.: decisor ausente, tempo passando sem demo); null se nada" },
    sugestao: { type: "string", description: "o próximo movimento, em 1 frase" },
    leitura: {
      type: "object",
      additionalProperties: false,
      description: "o termômetro do CLIENTE, inferido principalmente da FALA dele (conteúdo, hesitação, perguntas) com a trajetória visual de apoio",
      required: ["temperatura", "confianca", "estado", "porque"],
      properties: {
        temperatura: { type: "string", enum: ["frio", "morno", "quente"], description: "interesse na compra agora" },
        confianca: { type: "string", enum: ["hesitante", "avaliando", "decidido"], description: "quão perto de decidir ele soa" },
        estado: { type: "string", enum: ["tenso", "neutro", "a_vontade"], description: "estado emocional aparente (fala + visual)" },
        porque: { type: "string", description: "a evidência, em 1 frase (cite o que ele DISSE ou FEZ)" },
      },
    },
  },
};

export function makeAnthropic({ fetch: f = globalThis.fetch, apiKey = "", model = "" } = {}) {
  const configured = () => !!apiKey;
  const openrouter = apiKey.startsWith("sk-or-");
  const modelId = model || (openrouter ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL);

  // Corpo/headers/parse de cada provedor. OpenRouter fala o formato da OpenAI
  // (chat/completions + response_format json_schema); Anthropic fala Messages
  // API (output_config + thinking adaptativo). system/schema variam por tarefa
  // (resumo de call, variante de welcome).
  function buildRequest(userContent, { system, schema, schemaName }) {
    if (openrouter) {
      return {
        url: OPENROUTER_URL,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://levermoney.com.br",
          "x-title": "LeverAds Cockpit",
        },
        body: {
          model: modelId,
          max_tokens: 16000,
          messages: [
            { role: "system", content: `${system}\nResponda SOMENTE com o JSON pedido, sem texto fora dele.` },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
        },
      };
    }
    return {
      url: ANTHROPIC_URL,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model: modelId,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: userContent }],
      },
    };
  }

  // Uma requisição JSON estruturada, do fetch ao parse — compartilhada pelas
  // tarefas. Lança com mensagem legível em qualquer falha de provedor/formato.
  async function requestJson(userContent, opts) {
    const req = buildRequest(userContent, opts);
    const res = await f(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400) {
      const why = body.error?.message || body.error?.code || "falha na API";
      throw new Error(`${openrouter ? "OpenRouter" : "Claude"} -> ${res.status}: ${why}`);
    }
    const raw = extractText(body);
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      throw new Error(`${openrouter ? "OpenRouter" : "Claude"}: resposta fora do formato esperado`);
    }
    return { parsed, usage: body.usage || {}, model: body.model || modelId };
  }

  function extractText(body) {
    if (openrouter) {
      if (body.error) throw new Error(`OpenRouter: ${body.error.message || body.error.code || "falha na API"}`);
      const msg = body.choices?.[0]?.message;
      if (!msg?.content) throw new Error("OpenRouter: resposta vazia");
      // alguns provedores devolvem o JSON cercado de ```json ... ```
      return String(msg.content).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    }
    if (body.type === "error") throw new Error(`Claude: ${body.error?.message || "falha na API"}`);
    if (body.stop_reason === "refusal") throw new Error("Claude recusou o conteúdo da transcrição");
    const textBlock = (body.content || []).find((b) => b.type === "text");
    if (body.stop_reason === "max_tokens" || !textBlock) throw new Error("Claude: resposta incompleta (sem bloco de texto)");
    return textBlock.text;
  }

  // Uma call → um resumo estruturado. Transcrição grande é cortada em ~180k
  // chars (mantém o FINAL, onde vivem compromissos e próximos passos).
  async function summarizeCall({ transcript, lead = {}, productName = "LeverAds", callDate = "", today = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const MAX = 180_000;
    const text = String(transcript || "");
    const clipped = text.length > MAX ? `[início da call omitido]\n${text.slice(-MAX)}` : text;

    const context = [
      `Lead: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      lead.stage ? `Estágio no pipeline: ${lead.stage}` : "",
      callDate ? `Data da call: ${callDate}` : "",
      today ? `Hoje é: ${today} (use pra sugerir o "quando" do follow-up)` : "",
      `Produto: ${productName}`,
    ].filter(Boolean).join("\n");

    const r = await requestJson(`${context}\n\nTranscrição da call:\n\n${clipped}`, { system: SYSTEM, schema: SUMMARY_SCHEMA, schemaName: "call_summary" });
    return { summary: r.parsed, usage: r.usage, model: r.model };
  }

  // Uma call de INTEGRAÇÃO → resumo de onboarding (mesma assinatura da de venda).
  async function summarizeIntegration({ transcript, lead = {}, productName = "produto", callDate = "", today = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const MAX = 180_000;
    const text = String(transcript || "");
    const clipped = text.length > MAX ? `[início da call omitido]\n${text.slice(-MAX)}` : text;
    const context = [
      `Cliente: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      `Produto contratado: ${productName}`,
      callDate ? `Data da integração: ${callDate}` : "",
      today ? `Hoje é: ${today} (use pra sugerir o "quando" do acompanhamento)` : "",
    ].filter(Boolean).join("\n");
    const r = await requestJson(`${context}\n\nTranscrição da call de integração:\n\n${clipped}`, { system: INTEGRATION_SYSTEM, schema: INTEGRATION_SCHEMA, schemaName: "integration_summary" });
    return { summary: r.parsed, usage: r.usage, model: r.model };
  }

  // Briefing de passagem pro integrador: transcrição da call de VENDA (fonte
  // rica) ou, quando ela não existe/não saiu, o resumo estruturado que a IA já
  // gerou dessa call. `facts` são os dados do cadastro (contas, marketplaces,
  // volume, valor fechado), que entram SEMPRE: é o chão do briefing quando a
  // call falou pouco de setup.
  async function briefIntegration({ transcript = "", priorSummary = null, lead = {}, facts = [], productName = "LeverAds", callDate = "", today = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const MAX = 180_000;
    const text = String(transcript || "");
    const clipped = text.length > MAX ? `[início da call omitido]\n${text.slice(-MAX)}` : text;

    const context = [
      `STATUS: NEGÓCIO FECHADO. ${lead.name || "O cliente"} já comprou e o card acabou de passar pro integrador. O trabalho daqui pra frente é entregar, não vender.`,
      `Cliente: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      `Produto contratado: ${productName}`,
      callDate ? `Data da call de venda (que terminou em fechamento): ${callDate}` : "",
      today ? `Hoje é: ${today}` : "",
      facts.length ? `\nDados do cadastro (respostas do formulário e do fechamento):\n${facts.map((f) => `- ${f}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const source = clipped
      ? `Transcrição da call de venda (essa negociação JÁ FOI GANHA, você está lendo o histórico do que foi combinado):\n\n${clipped}`
      : `Não há transcrição da call. Use o resumo estruturado que já foi extraído dela (JSON) e os dados do cadastro, lembrando que essa venda JÁ FOI FECHADA. Seja MAIS conservador: o que não estiver aqui vai pra "confirmar".\n\n${JSON.stringify(priorSummary || {}, null, 2)}`;

    const r = await requestJson(`${context}\n\n${source}`, { system: BRIEF_SYSTEM, schema: BRIEF_SCHEMA, schemaName: "integration_brief" });
    return { brief: r.parsed, usage: r.usage, model: r.model };
  }

  // Uma variante NOVA de welcome (título/subtítulo/botão) pro teste A/B do
  // form — usada pelo "aplicar" do insight de welcome fraca. Não grava nada:
  // devolve a copy pro usuário editar antes de publicar.
  async function suggestWelcome({ productName = "", pitch = "", welcome = {}, variants = [], startRate = null }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const context = [
      `Produto: ${productName || "LeverAds"}${pitch ? ` (${pitch})` : ""}`,
      "Tela de boas-vindas ATUAL do formulário de diagnóstico:",
      `• Título: ${welcome.title || "(vazio)"}`,
      `• Subtítulo: ${welcome.subtitle || "(vazio)"}`,
      `• Botão: ${welcome.button || "(vazio)"}`,
      variants.length ? `Títulos já testados (NÃO repita esses ângulos):\n${variants.map((v) => `• ${v}`).join("\n")}` : "",
      startRate != null ? `Hoje só ${startRate}% dos visitantes clicam em começar — a promessa atual não está segurando.` : "",
      "Escreva UMA variante nova de título, subtítulo e botão pra rodar no teste A/B.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: WELCOME_SYSTEM, schema: WELCOME_SCHEMA, schemaName: "welcome_variant" });
    return { suggestion: r.parsed, usage: r.usage, model: r.model };
  }

  // Copy de um post social: recebe a dor, o formato/template e a LISTA de
  // campos (key + label/papel + exemplo), devolve cada campo preenchido + a
  // legenda. Não grava nada — o usuário revisa no editor antes de publicar.
  async function suggestSocialCopy({ dor = "", suggestion = "", formatLabel = "", templateName = "", fields = [] }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const fieldLines = fields.map((c) => `• key "${c.key}" (${c.label || "campo"}): exemplo = ${JSON.stringify(c.example ?? "")}`).join("\n");
    const context = [
      `Formato do post: ${formatLabel || "post"}${templateName ? ` · template "${templateName}"` : ""}`,
      dor ? `DOR que o post ataca: ${dor}` : "Sem dor específica: fale do valor central da LeverAds (clonar e sincronizar anúncios entre contas ML/Shopee).",
      suggestion ? `Sugestão do time pra criação (siga se fizer sentido): ${suggestion}` : "",
      "",
      "Preencha estes campos (devolva um item por key, com o texto no comprimento do exemplo):",
      fieldLines,
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: SOCIAL_SYSTEM, schema: SOCIAL_COPY_SCHEMA, schemaName: "social_copy" });
    // vira mapa key→value pro cliente aplicar direto nos campos do template
    const map = {};
    for (const it of r.parsed.fields || []) if (it?.key) map[it.key] = it.value ?? "";
    return { fields: map, caption: r.parsed.caption || "", usage: r.usage, model: r.model };
  }

  // Copy de um disparo: recebe o canal (email|whatsapp|ambos), o objetivo e uma
  // descrição do público, devolve assunto/corpo do e-mail e/ou texto do WhatsApp.
  // Não grava nada — o operador revisa antes de disparar.
  async function suggestCampaignCopy({ channel = "whatsapp", objetivo = "", publico = "", productName = "" } = {}) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const wantsEmail = channel === "email" || channel === "ambos" || channel === "both";
    const wantsWa = channel === "whatsapp" || channel === "ambos" || channel === "both";
    const context = [
      `Produto: ${productName || "LeverAds"}`,
      publico ? `Público do disparo: ${publico}` : "Público: leads qualificados que esfriaram (nutrição/reativação).",
      objetivo ? `Objetivo: ${objetivo}` : "Objetivo: reengajar o lead e agendar uma conversa.",
      wantsEmail && wantsWa ? "Escreva o e-mail (subject + body) E a mensagem de WhatsApp."
        : wantsEmail ? "Escreva SÓ o e-mail (subject + body); deixe whatsapp vazio."
        : "Escreva SÓ a mensagem de WhatsApp; deixe subject e body vazios.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: CAMPAIGN_SYSTEM, schema: CAMPAIGN_COPY_SCHEMA, schemaName: "campaign_copy" });
    return { subject: r.parsed.subject || "", body: r.parsed.body || "", whatsapp: r.parsed.whatsapp || "", usage: r.usage, model: r.model };
  }

  // Uma sugestão de roteiro melhorado a partir do pitch atual + digest das
  // calls. Não grava nada: devolve diagnóstico + objeções recorrentes + o
  // roteiro sugerido (mesma estrutura do editor de Scripts) pro time revisar.
  async function improvePitch({ productName = "LeverAds", scriptLabel = "roteiro", currentScript = {}, calls = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const passos = (currentScript.passos || [])
      .map((p, i) => `${i + 1}. ${p.t ? `${p.t}: ` : ""}${p.fala || ""}${p.dica ? ` [dica: ${p.dica}]` : ""}`)
      .join("\n");
    const context = [
      `Produto: ${productName}`,
      `Etapa do roteiro: ${scriptLabel}`,
      "",
      "ROTEIRO ATUAL",
      `Postura: ${currentScript.resumo || "(vazio)"}`,
      `Objetivo: ${currentScript.objetivo || "(vazio)"}`,
      `Passo a passo:\n${passos || "(vazio)"}`,
      "",
      "PADRÃO DAS ÚLTIMAS CALLS",
      calls || "(sem dados)",
      "",
      "Proponha a versão melhorada (postura, objetivo, passos), o diagnóstico e como tratar cada objeção recorrente no pitch.",
    ].join("\n");
    const r = await requestJson(context, { system: PITCH_SYSTEM, schema: PITCH_SCHEMA, schemaName: "pitch_improvement" });
    return { suggestion: r.parsed, usage: r.usage, model: r.model };
  }

  // Sugestão de solução (UniqueKids · método R.O.T.I.N.A) pra orientar a Ana na
  // call, a partir do desafio da família. Não grava nada — a rota decide.
  async function routineSuggestion({ productName = "UniqueKids", idade = "", desafio = "", exemplo = "", neuro = "", tentou = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const context = [
      `Produto: ${productName}`,
      idade ? `Idade da criança: ${idade}` : "",
      `Maior desafio da rotina: ${desafio || "(não informado)"}`,
      exemplo ? `Exemplo concreto do desafio (contado pela família): ${exemplo}` : "Exemplo concreto: (a família ainda não detalhou)",
      neuro ? `TDAH/TEA: ${neuro}` : "",
      tentou ? `O que a família já tentou: ${tentou}` : "",
      "",
      "Gere a sugestão pra Ana resolver ESSE desafio específico usando o R.O.T.I.N.A.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: ROUTINE_SYSTEM, schema: ROUTINE_SCHEMA, schemaName: "routine_suggestion" });
    return { sugestao: r.parsed?.sugestao || "", usage: r.usage, model: r.model };
  }

  // Uma consulta da mentoria (UniqueKids) → registro estruturado. Transcrição
  // grande é cortada em ~180k chars (mantém o FINAL, onde vivem os combinados).
  async function summarizeConsultation({ transcript, clientName = "?", childName = "", n = 0, productName = "UniqueKids", callDate = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const MAX = 180_000;
    const text = String(transcript || "");
    const clipped = text.length > MAX ? `[início da consulta omitido]\n${text.slice(-MAX)}` : text;
    const context = [
      `Família: ${clientName}${childName ? ` (criança: ${childName})` : ""}`,
      n ? `Consulta nº ${n} de 8` : "",
      callDate ? `Data: ${callDate}` : "",
      `Produto: ${productName}`,
    ].filter(Boolean).join("\n");
    const r = await requestJson(`${context}\n\nTranscrição da consulta:\n\n${clipped}`, { system: CONSULT_SYSTEM, schema: CONSULT_SCHEMA, schemaName: "consultation_summary" });
    return { summary: r.parsed, usage: r.usage, model: r.model };
  }

  // Compõe o Manual da Família a partir do material das consultas. Devolve só as
  // seções que a IA conseguiu escrever ({ key, content }); a rota mescla.
  async function composeDeliverables({ clientName = "?", childName = "", sections = [], material = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const secText = sections.map((s) => [
      `[${s.key}] ${s.title}`,
      `O que vai aqui: ${s.hint || ""}`,
      `Conteúdo atual: ${String(s.content || "").trim() || "(vazio)"}`,
    ].join("\n")).join("\n\n");
    const context = [
      `Família: ${clientName}${childName ? ` (criança: ${childName})` : ""}`,
      "",
      "SEÇÕES DO MANUAL",
      secText,
      "",
      "MATERIAL DAS CONSULTAS (resumos + notas da Ana, em ordem)",
      material || "(vazio)",
      "",
      "Escreva o conteúdo das seções que já têm material suficiente.",
    ].join("\n");
    const r = await requestJson(context, { system: MANUAL_SYSTEM, schema: MANUAL_SCHEMA, schemaName: "family_manual" });
    return { sections: r.parsed?.sections || [], usage: r.usage, model: r.model };
  }

  // Decisão do SDR conversacional pra UMA mensagem recebida no WhatsApp.
  // Devolve ação fechada + texto; quem valida horário, trava preço e executa é
  // o motor (sdr-brain.js) — aqui é só a cabeça.
  async function sdrDecide({ sdrName = "", lead = {}, digest = "", grade = "", stage = "", callAt = "", nowLabel = "", slots = [], conversation = [], pain = null, canGreet = true, gapMin = null, demoOffered = false, slotsOffered = false, firstReply = false, suggestedPair = [] }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const slotLines = slots.length
      ? slots.map((s) => `- ${s.at} (${s.label || s.at})`).join("\n")
      : "(nenhum horário livre nos próximos dias: não ofereça horário, pergunte o melhor período e acao responder)";
    const convo = conversation.slice(-24).map((m) => `${m.who}: ${m.text}`).join("\n");
    const context = [
      sdrName ? `Você responde em nome de ${sdrName}, do time LeverAds.` : "",
      `AGORA É: ${nowLabel}`,
      `LEAD: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}${grade ? ` · nota ${grade}` : ""}${stage ? ` · etapa: ${stage}` : ""}`,
      digest ? `Diagnóstico preenchido por ele: ${digest}` : "",
      pain
        ? `DOR DO ANÚNCIO que trouxe o lead: [${pain.code}] ${pain.label || ""} → FOCO da conversa: ${pain.mode === "oem" ? "criação de anúncio por código OEM (fale só disso; não empurre a clonagem)" : /auto\s*pe[çc]/i.test(lead.niche || "") ? "clonagem entre contas ancorada nessa dor, E, por ser AUTOPEÇAS, mencione TAMBÉM o OEM como segundo benefício (a LeverAds cria o anúncio completo só com o código OEM: fotos, título de 200 caracteres, descrição e compatibilidade), curto e sem deixar o OEM virar o assunto principal" : "clonagem entre contas ancorada nessa dor (não puxe o OEM)"}`
        : "Sem dor de origem registrada: apresentação geral da plataforma.",
      callAt ? `CONVERSA JÁ MARCADA pra: ${callAt} (hora de Brasília)` : "Sem conversa marcada ainda.",
      lead.email ? `E-mail no cadastro: ${lead.email}` : "Sem e-mail no cadastro (se o agendamento engatar, peça o e-mail pra mandar o convite).",
      canGreet
        ? `SAUDAÇÃO: conversa fria${gapMin != null ? ` (última troca há ${Math.round(gapMin / 60)}h)` : " (primeira interação)"} — pode abrir com UMA saudação curta de retomada.`
        : `SAUDAÇÃO: PROIBIDA. A conversa está EM ANDAMENTO (última mensagem há ${gapMin} min): não escreva "Oi", "Oiii", "Tudo bem?" nem o nome como abertura — responda DIRETO, continuando o assunto de onde parou.`,
      firstReply
        ? "PRIMEIRA MENSAGEM SUA nesta conversa (o lead escreveu antes de qualquer mensagem nossa): faça DESCOBERTA, não agende ainda. Responda com saudação curta + o pitch oficial da dor dele (2 frases no máximo) + a pergunta de descoberta no fim: 'Isso ajudaria na sua operação?' (ou variação natural curta). PROIBIDO oferecer horário, citar agenda ou convidar pra demonstração nesta primeira resposta: o convite e o horário entram na PRÓXIMA mensagem, depois que ele responder. Exceção única: se o lead JÁ pediu explicitamente pra agendar ou perguntou horários, pule a descoberta e siga o agendamento normal."
        : "",
      demoOffered
        ? "PITCH JÁ FEITO nesta conversa (o 1º toque ou uma mensagem sua anterior já listou as capacidades): PROIBIDO re-listar qualquer capacidade já dita (fotos, título de 200 caracteres, descrição, compatibilidade, 5 minutos, clonagem, estoque, atendimento, edição, gerenciar múltiplas contas) e proibido repetir o convite da demonstração descrevendo-a de novo. Se precisar referenciar, seja curto ('como te falei') e traga SÓ o novo: responda a pergunta e avance pro próximo passo."
        : "",
      slotsOffered
        ? "HORÁRIOS JÁ OFERECIDOS nesta conversa e o lead ainda não escolheu: NÃO repita horários na sua resposta. Responda o que ele perguntou e, no máximo, pergunte curto se algum dos horários que você já passou encaixa (sem re-listar). Só cite horários específicos de novo se ele pedir outras opções ou disser que nenhum serve (aí use a lista atual)."
        : "",
      "",
      "HORÁRIOS LIVRES, em ordem (é uma AMOSTRA dos próximos livres, não a agenda inteira; pra agendar/remarcar use SOMENTE valores desta lista, copiando exato; se o período que o lead pediu não aparece aqui, NUNCA afirme que não existe: ofereça o mais próximo da lista e diga que consegue ver outras opções):",
      suggestedPair.length >= 2
        ? `PAR SUGERIDO pra quando você oferecer DUAS opções (já espaçado em 2h+): ${suggestedPair[0].label || suggestedPair[0].at} (${suggestedPair[0].at}) ou ${suggestedPair[1].label || suggestedPair[1].at} (${suggestedPair[1].at}). Use este par; só fuja dele se o lead pedir um encaixe específico.`
        : "",
      slotLines,
      "",
      "CONVERSA (mais antiga primeiro; a última linha é a mensagem NOVA do lead, que você vai tratar):",
      convo || "(sem histórico)",
      "",
      "Decida a ação e o texto.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: SDR_DECIDE_SYSTEM, schema: SDR_DECIDE_SCHEMA, schemaName: "sdr_decision" });
    const p = r.parsed || {};
    const mensagens = (Array.isArray(p.mensagens) ? p.mensagens : [p.mensagem]).map((m) => String(m || "").trim()).filter(Boolean).slice(0, 3);
    return {
      acao: ["responder", "agendar", "remarcar", "desmarcar", "humano", "silencio"].includes(p.acao) ? p.acao : "humano",
      mensagens,
      mensagem: mensagens.join("\n"),
      horario: String(p.horario || ""),
      email: String(p.email || ""),
      motivoHumano: String(p.motivoHumano || ""),
      usage: r.usage, model: r.model,
    };
  }

  // Corrige uma resposta DIGITADA da prova de treinamento contra o gabarito.
  // Semântico (não exige as mesmas palavras); não grava nada — a rota decide.
  async function gradeAnswer({ question, ideal, answer, role = "", productName = "LeverAds" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const context = [
      `Vaga em treino: ${role || "vendas"} · Produto: ${productName}`,
      `PERGUNTA: ${question}`,
      `RESPOSTA IDEAL (gabarito): ${ideal}`,
      `RESPOSTA DIGITADA PELO TREINANDO: ${answer}`,
      "Avalie a resposta digitada em relação ao gabarito.",
    ].join("\n");
    const r = await requestJson(context, { system: GRADE_SYSTEM, schema: GRADE_SCHEMA, schemaName: "training_grade" });
    const p = r.parsed || {};
    return {
      verdict: p.verdict || "incorreto",
      score: Math.max(0, Math.min(100, Number(p.score) || 0)),
      feedback: p.feedback || "",
      missing: p.missing || "",
      usage: r.usage, model: r.model,
    };
  }

  // Copiloto: transcrição parcial + checklist → etapas cobertas, objeção com
  // resposta e a sugestão da vez. Só a cauda recente entra (a call é longa e o
  // cue é frequente; o começo já está refletido nos steps anteriores).
  async function copilotCue({ transcript, checklist = [], lead = {}, productName = "LeverAds", visual = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const text = String(transcript || "");
    const MAX = 24_000;
    const clipped = text.length > MAX ? `[início omitido]\n${text.slice(-MAX)}` : text;
    const list = checklist.map((c) => `${c.id}: ${c.label}`).join("\n");
    const context = [
      `Lead: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      `Produto: ${productName}`,
      visual ? `Trajetória visual (do mais antigo ao mais recente):\n${visual}` : "",
      `\nEtapas do roteiro (marque done por id):\n${list}`,
    ].filter(Boolean).join("\n");
    const r = await requestJson(`${context}\n\nTranscrição parcial (ao vivo):\n\n${clipped}`,
      { system: COPILOT_SYSTEM, schema: COPILOT_SCHEMA, schemaName: "copilot_cue" });
    return { cue: r.parsed, usage: r.usage, model: r.model };
  }

  return { configured, summarizeCall, summarizeIntegration, briefIntegration, summarizeConsultation, composeDeliverables, suggestWelcome, suggestSocialCopy, suggestCampaignCopy, improvePitch, routineSuggestion, gradeAnswer, sdrDecide, copilotCue, model: modelId, provider: openrouter ? "openrouter" : "anthropic" };
}
