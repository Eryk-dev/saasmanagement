// Roteiros de abordagem por etapa ("o que falar com esse lead AGORA") — o motor
// da tela Meu dia. A fala certa vem em camadas: roteiro da etapa escrito em
// Ajustes → Funil (product.funnel[].script, texto livre com {{tokens}}) vence;
// sem override, cai no roteiro padrão por KIND daqui. Tokens viram dados reais
// do lead; token sem valor vira lacuna destacada ("perguntar na ligação") — a
// lacuna É instrução: o que faltar no cadastro se descobre nesse contato.

import { stageKind, openStages } from "./funnel.js";
import { currentUser, displayName } from "./users.js";

// Etapa "No show" (cliente furou a call) — detectada pelo nome (kind é contato,
// mas precisa de roteiro/grupo próprios, distintos da Nutrição).
export const isNoShowStage = (stage) => /no.?show/i.test(String(stage || ""));

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Rótulo humano de uma resposta de qualificação (value → label do leadQuestions).
function answerLabel(saasCfg, lead, key) {
  const v = lead?.[key];
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "";
  const q = (saasCfg?.leadQuestions || []).find((x) => x.key === key);
  if (!q) return Array.isArray(v) ? v.join(", ") : String(v);
  const lut = Object.fromEntries((q.options || []).map((o) => [o.value, o.label]));
  return Array.isArray(v) ? v.map((x) => lut[x] || x).join(", ") : (lut[v] || String(v));
}

// Tokens disponíveis nos roteiros. Valor vazio → lacuna destacada na renderização.
export function scriptTokens(lead, saasCfg) {
  const call = lead?.callAt ? new Date(lead.callAt) : null;
  const callOk = call && Number.isFinite(call.getTime());
  return {
    nome: firstName(lead?.name),
    nome_completo: String(lead?.name || "").trim(),
    empresa: lead?.company || "",
    nicho: answerLabel(saasCfg, lead, "niche") || (lead?.niche || ""),
    contas: answerLabel(saasCfg, lead, "accounts"),
    anuncios: answerLabel(saasCfg, lead, "listings"),
    expansao: answerLabel(saasCfg, lead, "plan_expand"),
    equipe: answerLabel(saasCfg, lead, "staff"),
    email: lead?.email || "",
    produto: saasCfg?.name || "",
    eu: firstName(currentUser()?.name),
    call: callOk ? call.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "",
    hora_call: callOk ? call.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "",
    closer_responsavel: lead?.closer ? displayName(lead.closer) : "",
    link_call: lead?.callUrl || "",
  };
}

// O que sugerir quando o token está vazio (a lacuna vira lembrete de pergunta).
const GAP_HINTS = {
  nome: "nome do lead",
  nome_completo: "nome do lead",
  empresa: "perguntar o nome da loja",
  nicho: "perguntar o nicho",
  contas: "perguntar quantas contas",
  anuncios: "perguntar o volume de anúncios",
  expansao: "perguntar sobre abrir contas",
  equipe: "perguntar o time de marketing",
  email: "pedir o e-mail",
  produto: "produto",
  eu: "seu nome",
  call: "marcar o horário",
  hora_call: "o horário da call",
  closer_responsavel: "o closer da call",
  link_call: "gerar o link no lead",
};

// Divide um texto com {{tokens}} em segmentos prontos pra renderização:
// { text } literal · { value, token } dado preenchido · { gap, token } faltando.
export function scriptSegments(text, tokens) {
  const out = [];
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi;
  let last = 0, m;
  const str = String(text || "");
  while ((m = re.exec(str))) {
    if (m.index > last) out.push({ text: str.slice(last, m.index) });
    const k = m[1].toLowerCase();
    const v = tokens[k];
    if (v) out.push({ value: String(v), token: k });
    else out.push({ gap: GAP_HINTS[k] || k.replace(/_/g, " "), token: k });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ text: str.slice(last) });
  return out;
}

// ── Roteiros padrão por kind ────────────────────────────────────────────────
// Cada roteiro: resumo (postura na abordagem), objetivo (com o que sair do
// contato) e passos [{ t: título, fala, dica? }]. Copy sem travessão.

// Passos de "atendeu → qualifica" — comuns às duas tentativas de Qualificando:
// se o lead atende em qualquer dia, o objetivo é sempre confirmar os dados e
// marcar a call. O que muda entre as tentativas é só a mensagem de WhatsApp.
const QUALIFY_STEPS = [
  { t: "Atendeu: identificação", fala: "Oi {{nome}}, tudo bom? Sou {{eu}}, da {{produto}}. A gente se falou sobre o seu interesse na clonagem de anúncios. Consegue falar rapidinho agora?" },
  { t: "Rodar a sequência de dados", fala: "Deixa eu confirmar o que tenho: nicho de {{nicho}}, loja {{empresa}}, {{contas}} nos marketplaces e uns {{anuncios}} anúncios na maior conta, confere?", dica: "Siga a ordem dos campos ao lado e complete o que faltar: expansão ({{expansao}}) e time de marketing ({{equipe}}). O e-mail fica pro final, depois de marcar a call." },
  { t: "Agendar a call", fala: "Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada e gera o link da videochamada." },
  { t: "E-mail pra receber o convite", fala: "Perfeito! Pra fechar, me confirma seu melhor e-mail? Te mando o convite da nossa call por ele.", dica: "Preenche no campo ao lado; o convite do Meet vai automático pra ele." },
];

export const DEFAULT_SCRIPTS = {
  novo: {
    titulo: "1º ato · novo lead (prioridade máxima)",
    resumo: "O lead acabou de entrar: é o topo da fila, sempre (cadastro de fim de semana se trabalha na segunda, nos primeiros horários). A sessão é uma só: ligue 2 vezes; não atendeu, deixe o WhatsApp de apresentação. Tom leve, sorriso na voz. Atendeu? Siga a sequência de perguntas do passo a passo, confirmando e corrigindo os campos ao lado. Registrou o toque, o card segue sozinho pra Qualificando.",
    objetivo: "Conversa breve de confirmação: dados completos na ordem (nicho, empresa, contas, anúncios, expansão, time), call agendada e o e-mail confirmado no fechamento, pra receber o convite. Não atendeu? Apresentação no WhatsApp pedindo o melhor horário.",
    passos: [
      { t: "Ligar (2 tentativas)", dica: "Ainda sem fala: liga e aguarda. Não atendeu? Liga de novo em seguida. Caiu na caixa duas vezes, manda o WhatsApp do passo 2 e registra o toque." },
      { t: "Não atendeu: WhatsApp de apresentação", fala: "Olá {{nome}}, tudo bem? Aqui é {{eu}}, da plataforma {{produto}}. Recebemos o seu cadastro dizendo estar interessado no nosso serviço de clonagem de anúncios. Tem algum horário em que a gente possa te retornar pra conversar sobre?", dica: "Depois registra o toque: o card vai pra Qualificando e o GPS marca a retomada pra amanhã." },
      { t: "Atendeu: identificação", fala: "Olá {{nome}}, tudo bom? Sou {{eu}}, da {{produto}}. Recebi o seu cadastro com interesse na nossa ferramenta de clonar anúncios, você confirma pra mim?" },
      { t: "Transição", fala: "Que bom! Queria confirmar só algumas informações com você, essa primeira conversa é bem breve." },
      { t: "Nicho", fala: "Vi que você preencheu que trabalha com {{nicho}}, é isso mesmo?" },
      { t: "Nome da empresa", fala: "Legal! E qual o nome da sua loja, da sua empresa?", dica: "Preenche no campo ao lado. Abrir a loja na hora cria assunto e arma o closer pra call." },
      { t: "Contas nos marketplaces", fala: "Hoje você opera quantas contas dentro dos marketplaces? No formulário você marcou {{contas}}." },
      { t: "Anúncios na maior conta", fala: "E na sua maior conta, quantos anúncios publicados você tem? Você indicou {{anuncios}}." },
      { t: "Abrir mais contas", fala: "E você pretende abrir mais contas nos próximos meses?", dica: "Resposta do formulário: {{expansao}}." },
      { t: "Time de marketing", fala: "Quantas pessoas você tem hoje no time de marketing, cuidando dos anúncios?" },
      { t: "Agendar a call", fala: "Fechado {{nome}}! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada no lead e gera o link da videochamada." },
      { t: "E-mail pra receber o convite", fala: "Perfeito! Pra fechar, me confirma seu melhor e-mail? Te mando o convite da nossa call por ele.", dica: "Preenche no campo ao lado; o convite do Meet vai automático pra ele." },
    ],
  },
  contato: {
    titulo: "Tentativa de contato",
    resumo: "O lead ainda não atendeu. Alterne canal e horário a cada tentativa: ligação em horário comercial, WhatsApp fora dele. Mensagem curta, sempre terminando com pergunta.",
    objetivo: "Conseguir a primeira conversa (daí o roteiro de qualificação assume) ou esgotar a cadência com consciência limpa.",
    passos: [
      { t: "Ligação", fala: "Olá {{nome}}, tudo bom? Falo da {{produto}}. Você se cadastrou pra conhecer nossa ferramenta de clone de anúncios, consegue falar 3 minutinhos agora?" },
      { t: "WhatsApp, se não atender", fala: "Oi {{nome}}! Vi seu cadastro aqui na {{produto}} (a ferramenta que clona anúncios entre contas de marketplace). Te liguei mas não consegui. Qual o melhor horário pra gente trocar uma ideia rápida?", dica: "Registre cada tentativa no toque do card: o GPS agenda a próxima sozinho." },
    ],
  },
  // Qualificando tem 2 tentativas (fecha as 3 abordagens do processo: 1 no Novo
  // lead + 2 aqui). O painel resolve QUAL mostrar pelo nº de toques na etapa
  // (resolveScript): 0 toques = 2ª tentativa; 1+ = 3ª (última).
  qualificacao2: {
    titulo: "Qualificando · 2ª tentativa",
    resumo: "Primeira retomada. Já tentamos no cadastro (1º ato) e não deu. Liga 2 vezes; não atendeu, manda o WhatsApp confirmando que é a pessoa certa e reforçando o interesse. Atendeu? Roda a qualificação e sai com a call marcada.",
    objetivo: "Falar com o lead (e qualificar + marcar call) ou deixar a mensagem certa pedindo o melhor horário.",
    passos: [
      { t: "Ligar (2 tentativas)", dica: "Sem fala: liga e aguarda; não atendeu, liga de novo em seguida." },
      { t: "Não atendeu: WhatsApp da 2ª tentativa", fala: "Oi, tudo bem? Estou falando com {{nome_completo}}? Sou {{eu}}, da plataforma {{produto}}. Você se cadastrou pra conhecer nossa ferramenta de clonagem de anúncios e ontem não consegui te encontrar. Qual o melhor horário pra gente conversar 5 minutinhos?", dica: "Depois registra o toque: o GPS traz o card de volta amanhã na 3ª (última) tentativa." },
      ...QUALIFY_STEPS,
    ],
  },
  qualificacao3: {
    titulo: "Qualificando · 3ª tentativa (última)",
    resumo: "Última tentativa antes da Nutrição. Liga 2 vezes; não atendeu, manda o WhatsApp de encerramento (uma saída elegante pedindo um sim ou não). Atendeu? Qualifica normalmente.",
    objetivo: "Última chance de falar e qualificar; sem retorno, encerrar o ciclo mandando o card pra Nutrição.",
    passos: [
      { t: "Ligar (2 tentativas)", dica: "Sem fala: liga e aguarda; não atendeu, liga de novo." },
      { t: "Não atendeu: WhatsApp da 3ª tentativa (encerramento)", fala: "Oi {{nome}}! Tentei falar com você algumas vezes por aqui e não consegui. A gente entende que às vezes o momento não é o ideal. Você ainda quer conhecer a {{produto}} pra clonar seus anúncios entre as contas, ou posso encerrar seu atendimento por enquanto?", dica: "Sem retorno até o fim do dia: mover o card pra Nutrição (o GPS devolve em 20 dias, num dia útil)." },
      ...QUALIFY_STEPS,
    ],
  },
  // Nutrição = reativação de lead frio, 3 contatos com 7 dias úteis entre eles
  // (entrada 20 dias). Cada contato traz um gancho DIFERENTE pra dar motivo de
  // responder (prova → oferta sem risco → saída elegante). O painel mostra só o
  // contato do dia (resolveScript pelo nº de toques). Liga 1x; não atendeu, o
  // WhatsApp do contato. Atendeu? Emenda na qualificação (QUALIFY_STEPS).
  nutricao1: {
    titulo: "Nutrição · 1º contato (prova de resultado)",
    resumo: "Lead frio, 20 dias depois. Sem cobrar o silêncio: reabre com um resultado concreto pra reacender a curiosidade. Liga 1 vez; não atendeu, manda o WhatsApp da prova. Atendeu? Retoma a qualificação.",
    objetivo: "Reabrir a conversa com um gancho de valor e, se ele responder, voltar pro fluxo de qualificação.",
    passos: [
      { t: "Ligar (1 tentativa)", dica: "Sem fala: liga e aguarda; não atendeu, manda o WhatsApp abaixo e registra o toque (o GPS traz de volta em 7 dias úteis)." },
      { t: "Não atendeu: WhatsApp (prova de resultado)", fala: "Oi {{nome}}! Aqui é {{eu}}, da {{produto}}. Faz um tempo que você olhou a gente pra clonar seus anúncios entre contas. Só pra te dar um dado: um cliente nosso subiu 105% as vendas depois de espelhar os anúncios entre as contas. Posso te mostrar como isso ficaria na sua operação? Leva 5 minutinhos." },
      ...QUALIFY_STEPS,
    ],
  },
  nutricao2: {
    titulo: "Nutrição · 2º contato (oferta sem risco)",
    resumo: "Segundo toque, 7 dias depois. Agora derruba a barreira com o teste sem compromisso. Liga 1 vez; não atendeu, manda o WhatsApp da oferta. Atendeu? Retoma a qualificação.",
    objetivo: "Tirar o risco da decisão (teste grátis) pra ele topar ver a ferramenta rodando.",
    passos: [
      { t: "Ligar (1 tentativa)", dica: "Sem fala: liga e aguarda; não atendeu, manda o WhatsApp abaixo e registra o toque." },
      { t: "Não atendeu: WhatsApp (oferta sem risco)", fala: "Oi {{nome}}! Voltando aqui: a gente faz um teste sem compromisso, clona 10 dos seus melhores anúncios em menos de 1 minuto e você vê o resultado na sua própria conta antes de decidir qualquer coisa. Quer que eu prepare esse teste pra você essa semana?" },
      ...QUALIFY_STEPS,
    ],
  },
  nutricao3: {
    titulo: "Nutrição · 3º contato (última, porta aberta)",
    resumo: "Último toque do ciclo, 7 dias depois. Saída elegante com uma CTA de 1 palavra, fácil de responder. Liga 1 vez; não atendeu, manda o WhatsApp de encerramento. Atendeu? Retoma a qualificação.",
    objetivo: "Última chance com fricção mínima; sem retorno, encerrar em Desqualificado.",
    passos: [
      { t: "Ligar (1 tentativa)", dica: "Sem fala: liga e aguarda; não atendeu, manda o WhatsApp abaixo." },
      { t: "Não atendeu: WhatsApp (encerramento, porta aberta)", fala: "Oi {{nome}}! Vou parar de te escrever pra não incomodar. Mas se replicar anúncio na mão ainda consome o tempo do seu time, me responde só um 'quero ver' que eu te mostro a ferramenta rodando na sua conta. Se não fizer sentido agora, tudo certo, deixo a porta aberta pra quando precisar.", dica: "Sem resposta: mover pra Desqualificado (motivo: sem resposta). Respondeu? Volta pra Qualificando e segue o fluxo normal." },
      ...QUALIFY_STEPS,
    ],
  },

  // Confirmação da call (tarefa do SDR antes do closer entrar): 1h antes confirma;
  // respondeu, manda a de 10 min; sem resposta, LIGA 10 min antes. Tom incisivo:
  // a call já está de pé (especialista reservado), o cliente só entra.
  confirmacao: {
    titulo: "Confirmação da call",
    resumo: "Antes do especialista entrar, você garante a presença do cliente. 1h antes manda a confirmação; se ele responder, manda a de 10 min; sem resposta, LIGA 10 min antes. Sem abrir brecha pra cancelar: a call já está reservada, o cliente só entra.",
    objetivo: "Garantir a presença na call e reduzir no-show.",
    passos: [
      { t: "1h antes: confirmação (WhatsApp)", fala: "Oi {{nome}}! Tudo bem? Aqui é {{eu}}, da {{produto}}. Tá tudo certo pra nossa call de hoje às {{hora_call}}. O especialista {{closer_responsavel}} já está se preparando pra te receber no link: {{link_call}}. Qualquer mudança de plano, pode me avisar aqui, ok? Te esperamos!" },
      { t: "10 min antes: cliente respondeu (WhatsApp)", fala: "Maravilha! Obrigado pelo retorno. Em 10 minutos ele já vai estar te aguardando." },
      { t: "10 min antes: sem resposta, LIGA", fala: "Oi {{nome}}, é {{eu}}, da {{produto}}. Nossa call é agora, o especialista já está na sala. Tô te mandando o link, entra que já vamos começar.", dica: "Não atendeu? Manda no WhatsApp: o especialista já está te esperando na sala, entra agora: {{link_call}}. Já começamos!" },
    ],
  },

  // No show: cliente furou a call (o closer sinalizou). 2 remarcações, 1 dia útil
  // entre elas; a 1ª cai 1h depois do no-show. Painel mostra só a tentativa do dia.
  noshow1: {
    titulo: "No show · 1ª remarcação",
    resumo: "O cliente furou a call. Você reengaja pra remarcar sem dar brecha pra cancelar: o especialista já separou um novo horário, o cliente só escolhe. Liga 1 vez; não atendeu, manda o WhatsApp.",
    objetivo: "Remarcar a call. Marcou? O card volta pra Call agendada com o novo horário e o closer.",
    passos: [
      { t: "Ligar (1 tentativa)", dica: "Não atendeu? Manda o WhatsApp abaixo e registra o toque (o GPS traz de volta em 1 dia útil pra 2ª tentativa)." },
      { t: "Não atendeu: WhatsApp (remarcar)", fala: "Oi {{nome}}! Você não conseguiu entrar na call de hoje. O especialista já separou um novo horário exclusivo pra você: prefere amanhã de manhã ou no fim da tarde?", dica: "Marcou? Registra o novo horário em Call agendada e mova o card de volta pra lá (volta pro closer)." },
    ],
  },
  noshow2: {
    titulo: "No show · 2ª remarcação (última)",
    resumo: "Segunda e última tentativa. Coloca a decisão na mão do cliente com firmeza: ou ele retoma, ou você encerra. Liga 1 vez; não atendeu, manda o WhatsApp.",
    objetivo: "Última chance de remarcar; sem retorno, encerrar (Desqualificado).",
    passos: [
      { t: "Ligar (1 tentativa)", dica: "Não atendeu? Manda o WhatsApp abaixo." },
      { t: "Não atendeu: WhatsApp (retoma ou encerra)", fala: "Oi {{nome}}! Ainda faz sentido pra você escalar sua operação usando nosso método? Assim eu consigo continuar com seu atendimento, ou até mesmo encerrar se agora não for a hora certa.", dica: "Sem resposta: mover pra Desqualificado (motivo: sem resposta). Respondeu com horário? Marca em Call agendada e move o card de volta." },
    ],
  },
  call: {
    titulo: "Call de fechamento",
    resumo: "Antes da call: olhe a loja do lead, o nicho e o volume dele (está tudo no card). Confirme presença 1h antes pelo WhatsApp. Na call, demonstre na operação DELE e ancore no case Unique (+105% de vendas).",
    objetivo: "Sair da call com proposta apresentada e o teste combinado: 10 anúncios clonados em 2 horas.",
    passos: [
      { t: "Confirmar presença (1h antes, WhatsApp)", fala: "Oi {{nome}}! Confirmado pra nossa call {{call}}? O link é esse: {{link_call}}" },
      { t: "Quebra-gelo", fala: "Dei uma olhada na {{empresa}} antes da nossa conversa. Me conta rapidinho como está a operação hoje." },
      { t: "Aprofundar a dor", fala: "Hoje, pra replicar um anúncio nas suas {{contas}}, quanto tempo o seu time gasta?" },
      { t: "Demonstração ao vivo", fala: "Deixa eu te mostrar na prática: escolhe um anúncio seu que eu clono aqui, agora, na sua frente." },
      { t: "Prova social", fala: "Um cliente nosso, a Unique, aumentou 105% as vendas depois de espelhar as contas com a ferramenta." },
      { t: "Fechamento", fala: "Faz sentido pra você? Então o próximo passo é assim: a gente clona 10 anúncios seus em 2 horas de teste, e você vê o resultado na sua conta." },
    ],
  },
  proposta: {
    titulo: "Proposta enviada · follow-up",
    resumo: "A proposta está na mão do lead. Follow-up curto retomando a dor e o resultado prometido. Nunca só 'e aí, viu a proposta?'.",
    objetivo: "Resposta concreta: aceite, objeção declarada ou próximo passo com data.",
    passos: [
      { t: "Retomar", fala: "Oi {{nome}}! Te mandei a proposta pra clonagem das contas da {{empresa}}. Conseguiu ver com calma?" },
      { t: "Reancorar o valor", fala: "Só lembrando o que travamos lá: seus {{anuncios}} anúncios replicados entre as contas sem trabalho manual." },
      { t: "Destravar", fala: "Me fala com sinceridade: o que falta pra gente começar? Se for investimento, me conta que eu vejo o que consigo por aqui." },
    ],
  },
  followup: {
    titulo: "Negociação · follow-up",
    resumo: "Negociação aberta: cobre a decisão com leveza e feche cada contato com um compromisso datado. Sem próximo passo combinado, o lead esfria.",
    objetivo: "Decisão (ganho, ou perdido honesto com motivo) ou próximo toque agendado com o lead.",
    passos: [
      { t: "Cobrança leve", fala: "Oi {{nome}}, tudo bom? Você ficou de me dar um retorno sobre a {{produto}}. Como decidiu por aí?" },
      { t: "Puxar a objeção real", fala: "Me fala com sinceridade o que está pegando: é o investimento, o momento, ou alguma dúvida sobre a ferramenta?" },
      { t: "Compromisso", fala: "Fechado. Então me diz um dia bom essa semana pra gente bater o martelo, que eu já te chamo." },
    ],
  },
  integracao: {
    titulo: "Integração · kickoff",
    resumo: "Cliente fechado, hora de entregar rápido: quanto antes a primeira clonagem rodar, menor o risco de arrependimento. Conduza o checklist com objetividade.",
    objetivo: "Acessos conectados, conta-mãe definida e a primeira leva de anúncios clonada.",
    passos: [
      { t: "Kickoff", fala: "Oi {{nome}}! Bem-vindo à {{produto}}. Vou te guiar na integração, leva uns 20 minutos. Consegue fazer comigo hoje ainda?" },
      { t: "Checklist técnico", fala: "Vou precisar do acesso das contas que vamos espelhar e a gente define juntos qual é a conta-mãe, a matriz dos seus anúncios." },
      { t: "Primeira vitória", fala: "Fechando a conexão eu já disparo a primeira clonagem pra você ver rodando hoje mesmo." },
    ],
  },
  posvenda: {
    titulo: "Pós-venda · acompanhamento",
    resumo: "Cliente rodando: ligue com dado na mão (anúncios clonados, tempo economizado) e transforme resultado em prova social. Cliente atendido indica.",
    objetivo: "Cliente saudável, resultado documentado e uma indicação pedida.",
    passos: [
      { t: "Check-in de resultado", fala: "Oi {{nome}}! Passando pra ver como a {{produto}} está rodando aí na {{empresa}}. Como está sendo pra vocês?" },
      { t: "Virar case", fala: "Posso usar esse resultado da {{empresa}} como case nosso? A gente te marca e divulga a loja junto." },
      { t: "Pedir indicação", fala: "Você conhece outro lojista que sofre pra replicar anúncio entre contas? Se indicar e fechar, tenho uma condição especial pra você." },
    ],
  },
  outro: {
    titulo: "Contato",
    resumo: "Etapa sem roteiro próprio. Dá pra escrever um em Ajustes, na aba Funil & estágios (coluna do lápis).",
    objetivo: "Registrar o contato e deixar o próximo passo agendado no lead.",
    passos: [
      { t: "Abertura", fala: "Olá {{nome}}, tudo bom? Falo da {{produto}}." },
    ],
  },
};

// Texto livre de Ajustes → passos. Blocos separados por linha em branco viram
// passos; primeira linha terminando em ":" vira o título do passo.
function parseCustomScript(text) {
  const blocks = String(text || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b) => {
    const lines = b.split("\n");
    if (lines.length > 1 && /:$/.test(lines[0].trim())) {
      return { t: lines[0].trim().replace(/:$/, ""), fala: lines.slice(1).join("\n").trim() };
    }
    return { t: "", fala: b };
  });
}

// Roteiro efetivo de um lead: override da etapa (Ajustes) > padrão do kind.
// Fila SDR fora da régua (ex.: Nutrição, depois do Ganho) tem roteiro próprio
// de reativação — o contato ali não é a 1ª tentativa, é retomada de silêncio.
// Qualificando tem roteiro POR TENTATIVA: 0 toques na etapa = 2ª tentativa;
// 1+ toques = 3ª (última). O painel mostra só a abordagem daquele dia.
export function resolveScript(saasCfg, lead) {
  const stage = lead?.stage || saasCfg?.funnel?.[0]?.stage || "";
  const kind = stageKind(saasCfg, stage);
  const reactivation = (kind === "contato" || kind === "qualificacao") &&
    lead?.stage && !openStages(saasCfg).includes(stage);
  const attempts = Number(lead?.stageAttempts) || 0;
  let base;
  if (isNoShowStage(stage)) base = attempts >= 1 ? DEFAULT_SCRIPTS.noshow2 : DEFAULT_SCRIPTS.noshow1;
  else if (reactivation) base = attempts >= 2 ? DEFAULT_SCRIPTS.nutricao3 : attempts === 1 ? DEFAULT_SCRIPTS.nutricao2 : DEFAULT_SCRIPTS.nutricao1;
  else if (kind === "qualificacao") base = attempts >= 1 ? DEFAULT_SCRIPTS.qualificacao3 : DEFAULT_SCRIPTS.qualificacao2;
  else base = DEFAULT_SCRIPTS[kind] || DEFAULT_SCRIPTS.outro;
  const row = (saasCfg?.funnel || []).find((f) => f && f.stage === stage);
  if (row?.script && String(row.script).trim()) {
    return { ...base, custom: true, passos: parseCustomScript(row.script) };
  }
  return base;
}

// Checklist de dados do lead pro painel do roteiro, NA ORDEM DA CONVERSA que o
// Leo definiu: nicho → empresa → contas → anúncios → expansão → time de
// marketing → e-mail por último (quando já está tudo confirmado). Cada item sai
// com type/options pro painel renderizar o campo EDITÁVEL (select com as opções
// do formulário; texto onde é livre). `key` é o campo do lead a ser gravado.
const CHECKLIST_ORDER = ["niche", "company", "accounts", "listings", "plan_expand", "staff"];

export function scriptChecklist(saasCfg, lead) {
  const qs = saasCfg?.leadQuestions || [];
  const byKey = Object.fromEntries(qs.map((q) => [q.key, q]));
  const fromQuestion = (q) => ({
    key: q.key, label: q.label,
    type: (q.options || []).length ? "select" : "text",
    options: q.options || [],
    value: answerLabel(saasCfg, lead, q.key),
    raw: lead?.[q.key] ?? "",
  });
  const items = [];
  const seen = new Set(["email"]);
  for (const k of CHECKLIST_ORDER) {
    seen.add(k);
    if (k === "company") {
      items.push({ key: "company", label: "Nome da loja / empresa", type: "text", options: [], value: lead?.company || "", raw: lead?.company || "" });
    } else if (byKey[k]) {
      items.push(fromQuestion(byKey[k]));
    }
  }
  // Perguntas extras do produto (fora da ordem canônica) entram antes do e-mail.
  for (const q of qs) if (!seen.has(q.key)) items.push(fromQuestion(q));
  items.push({ key: "email", label: "E-mail (convite da call) · por último", type: "text", options: [], value: lead?.email || "", raw: lead?.email || "" });
  return items;
}
