// IA que resume a transcrição da call de vendas com ESTRUTURA de vendas
// (dores, objeções, temperatura, follow-up sugerido). Dois provedores, com
// detecção AUTOMÁTICA pela chave: sk-or-* = OpenRouter (API compatível com
// OpenAI, modelos Claude via slug anthropic/*), senão API da Anthropic
// direto. Raw HTTP por fetch injetável, mesmo padrão do meta.js/google.js.
// Env: OPENROUTER_API_KEY ou ANTHROPIC_API_KEY; modelo via AI_MODEL.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-opus-4.8";

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
  required: ["resumo", "operacao", "vendido", "expectativa", "atencao", "confirmar", "checklist", "primeiraMensagem"],
  properties: {
    resumo: { type: "string", description: "Quem é o cliente, o que ele vende e o que contratou, em 3 a 5 frases diretas. Escreva pra alguém que NÃO estava na call" },
    operacao: {
      type: "array",
      description: "Fatos da operação dele que mudam o setup (contas, marketplaces, volume de anúncios, ERP/hub, conta banida, particularidades). Só o que apareceu na call ou nos dados do cadastro",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "valor"],
        properties: {
          item: { type: "string", description: "o que é (ex.: contas de Mercado Livre)" },
          valor: { type: "string", description: "o dado (ex.: 4 contas, 2 delas novas)" },
        },
      },
    },
    vendido: { type: "array", items: { type: "string" }, description: "O que o closer prometeu/vendeu: escopo, entregas, prazos e condições ditos na call. Fiel à transcrição" },
    expectativa: { type: "string", description: "O resultado que o cliente espera ver e em quanto tempo, nas palavras dele" },
    atencao: {
      type: "array",
      description: "Riscos pro onboarding: objeção que ficou em aberto, expectativa desalinhada, pressa, desconfiança, limitação técnica",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ponto", "porque"],
        properties: {
          ponto: { type: "string", description: "o risco, em poucas palavras" },
          porque: { type: "string", description: "o que na call indica isso e como não pisar nele" },
        },
      },
    },
    confirmar: { type: "array", items: { type: "string" }, description: "O que o integrador precisa perguntar/confirmar logo no começo (dado que faltou ou ficou vago na venda)" },
    checklist: {
      type: "array",
      description: "O que fazer na integração, EM ORDEM, do primeiro passo ao cliente rodando",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["passo", "porque"],
        properties: {
          passo: { type: "string", description: "a ação, no imperativo (ex.: pedir acesso às 4 contas)" },
          porque: { type: "string", description: "por que esse passo importa NESSE cliente, 1 frase" },
        },
      },
    },
    primeiraMensagem: { type: "string", description: "WhatsApp de abertura do integrador pro cliente: se apresenta, cita algo concreto da venda e propõe o próximo passo. 2 a 4 frases" },
  },
};

const BRIEF_SYSTEM = `Você prepara o BRIEFING DE PASSAGEM pro integrador da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação).
O cliente ACABOU DE FECHAR e o card passou pro integrador, que NÃO participou da call de vendas e vai fazer o onboarding. Ele precisa de duas coisas: se localizar (quem é esse cliente, o que compraram dele, o que foi prometido) e saber o que fazer (passos concretos, em ordem).
Regras: português direto, sem enrolação e sem repetir o óbvio. NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Seja fiel à fonte: não invente conta, volume, prazo nem promessa que não apareceu. Quando um dado importante do setup não foi tratado na call, NÃO chute: coloque em "confirmar". Promessa feita pelo closer entra em "vendido" com as palavras que foram usadas, porque é o que o cliente vai cobrar. O checklist é do trabalho REAL de integração desse cliente (acessos, contas de origem e destino, o que clonar primeiro, atributos, combinar acompanhamento), não uma lista genérica. A primeira mensagem é de quem assume o cliente, cita algo concreto da venda e termina propondo dia/horário ou um próximo passo claro.`;

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
      `Cliente: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      `Produto contratado: ${productName}`,
      callDate ? `Data da call de venda: ${callDate}` : "",
      today ? `Hoje é: ${today}` : "",
      facts.length ? `\nDados do cadastro (respostas do formulário e do fechamento):\n${facts.map((f) => `- ${f}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const source = clipped
      ? `Transcrição da call de venda:\n\n${clipped}`
      : `Não há transcrição da call. Use o resumo estruturado que já foi extraído dela (JSON) e os dados do cadastro. Seja MAIS conservador: o que não estiver aqui vai pra "confirmar".\n\n${JSON.stringify(priorSummary || {}, null, 2)}`;

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

  return { configured, summarizeCall, summarizeIntegration, briefIntegration, summarizeConsultation, composeDeliverables, suggestWelcome, suggestSocialCopy, suggestCampaignCopy, improvePitch, routineSuggestion, gradeAnswer, model: modelId, provider: openrouter ? "openrouter" : "anthropic" };
}
