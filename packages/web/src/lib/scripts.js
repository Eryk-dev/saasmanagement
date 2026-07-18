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
    suspensa: answerLabel(saasCfg, lead, "suspended"),
    decisor: answerLabel(saasCfg, lead, "decider"),
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
  suspensa: "perguntar se já teve conta suspensa",
  decisor: "perguntar quem decide junto",
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
  { t: "Rodar a sequência de dados", fala: "Deixa eu confirmar o que tenho: nicho de {{nicho}}, loja {{empresa}}, {{contas}} nos marketplaces e uns {{anuncios}} anúncios na maior conta, confere?", dica: "Siga a ordem dos campos ao lado e complete o que faltar: expansão ({{expansao}}), time de marketing ({{equipe}}), conta suspensa ({{suspensa}}) e quem decide junto ({{decisor}}). O e-mail fica pro final, depois de marcar a call." },
  { t: "Agendar a call", fala: "Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada e gera o link da videochamada." },
  { t: "Preparar a call (logins + decisor)", fala: "Pra call render de verdade, anota duas coisas: entra já logado no Mercado Livre e na Shopee, porque o especialista clona anúncios de verdade nas suas contas, ao vivo. E se alguém decide junto com você, chama pra assistir, é rapidinho e vale a pena.", dica: "Sem login na call o teste não roda e o fechamento adia. Com sócio na decisão ({{decisor}}), a call só fecha se a pessoa estiver presente." },
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
      { t: "Conta suspensa (dor de proteção)", fala: "E você já passou por conta suspensa ou banida no Mercado Livre?", dica: "Registra no campo ao lado. Quem já perdeu conta compra proteção: metade das calls que fecham chega machucada. Avisa o closer no handoff que a call é de blindagem da operação." },
      { t: "Quem decide junto", fala: "Se a ferramenta fizer sentido pra você, você bate o martelo sozinho ou tem sócio, esposa, consultor que decide junto?", dica: "Registra ao lado. Decisor fora da call não fecha na hora: já convida a pessoa pra call do especialista." },
      { t: "Agendar a call", fala: "Fechado {{nome}}! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada no lead e gera o link da videochamada." },
      { t: "Preparar a call (logins + decisor)", fala: "Pra call render de verdade, anota duas coisas: entra já logado no Mercado Livre e na Shopee, porque o especialista clona anúncios de verdade nas suas contas, ao vivo. E se alguém decide junto com você, chama pra assistir, é rapidinho e vale a pena.", dica: "Sem login na call o teste não roda e o fechamento adia. Com sócio na decisão, a call só fecha se a pessoa estiver presente." },
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
      { t: "Não atendeu: WhatsApp da 3ª tentativa (encerramento)", fala: "Oi {{nome}}! Tentei falar com você algumas vezes por aqui e não consegui. A gente entende que às vezes o momento não é o ideal. Você ainda quer conhecer a {{produto}} pra clonar seus anúncios entre as contas, ou posso encerrar seu atendimento por enquanto?", dica: "Sem retorno até o fim do dia: mover o card pra Nutrição (o GPS devolve em 7 dias, num dia útil)." },
      ...QUALIFY_STEPS,
    ],
  },
  // Nutrição = reativação de lead frio, 3 contatos com 7 dias úteis entre eles
  // (entrada também 7 dias). Cada contato traz um gancho DIFERENTE pra dar motivo de
  // responder (prova → oferta sem risco → saída elegante). O painel mostra só o
  // contato do dia (resolveScript pelo nº de toques). Liga 1x; não atendeu, o
  // WhatsApp do contato. Atendeu? Emenda na qualificação (QUALIFY_STEPS).
  nutricao1: {
    titulo: "Nutrição · 1º contato (prova de resultado)",
    resumo: "Lead frio, 7 dias depois. Sem cobrar o silêncio: reabre com um resultado concreto pra reacender a curiosidade. Liga 1 vez; não atendeu, manda o WhatsApp da prova. Atendeu? Retoma a qualificação.",
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
      { t: "1h antes: confirmação (WhatsApp)", fala: "Oi {{nome}}! Tudo bem? Aqui é {{eu}}, da {{produto}}. Tá tudo certo pra nossa call de hoje às {{hora_call}}. O especialista {{closer_responsavel}} já está se preparando pra te receber no link: {{link_call}}. Duas dicas pra call render: entra já logado no Mercado Livre e na Shopee (ele clona anúncios de verdade nas suas contas, ao vivo) e, se alguém decide junto com você, chama pra assistir. Qualquer mudança de plano, pode me avisar aqui, ok? Te esperamos!", dica: "Logins em mãos e decisor presente são o que mais decide a call: sem login o teste ao vivo não roda; sem o sócio, a decisão adia." },
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
  // Estrutura tirada da análise das transcrições (jul/2026, 22 calls): toda call
  // que chegou a clonar anúncio real NAS CONTAS DO LEAD fechou ou saiu com
  // integração agendada; decisor ausente nunca fechou na hora. A call inteira é
  // desenhada pra chegar na demo ao vivo o mais rápido possível.
  call: {
    titulo: "Call de fechamento",
    resumo: "A call é desenhada pra chegar rápido na demo AO VIVO nas contas do lead: nas transcrições analisadas, toda call que clonou anúncio de verdade fechou ou saiu com integração agendada. Antes de entrar: confira o card (contas, anúncios, suspensão, decisor) e garanta que o SDR cobrou logins em mãos e decisor presente na confirmação.",
    objetivo: "Sair com pagamento feito na call e integração agendada com dia e hora. Não fechou? Tarefa concreta, data marcada e o decisor presente na retomada.",
    passos: [
      { t: "Raio-X da operação (5 min)", fala: "Me conta como está a operação hoje: são {{contas}} e uns {{anuncios}} anúncios, certo? Quem sobe anúncio hoje? E quanto vocês estão faturando por mês?", dica: "Dados do SDR nos campos ao lado: time {{equipe}}, expansão {{expansao}}. Complete o que faltar, cada lacuna é pergunta." },
      { t: "Pergunta da suspensão (define a narrativa)", fala: "E você já teve conta suspensa ou derrubada no Mercado Livre? Como foi?", dica: "Resposta do SDR: {{suspensa}}. Metade dos leads chega machucado e esse é o gatilho mais forte. Se sim, a call vira PROTEÇÃO (blindar a operação: qualquer conta nova recebe tudo em minutos). Se não, vira CRESCIMENTO (multiplicar presença no catálogo)." },
      { t: "Espelho da dor (2 min)", fala: "Deixa eu ver se entendi: hoje o gargalo é braço. Subir esses {{anuncios}} anúncios em outra conta, na mão, levaria meses, é isso?", dica: "Devolver a dor nas palavras do lead antes da tese. As duas dores que dominam: falta de braço (quase todas as calls) e medo de perder conta (metade)." },
      { t: "Tese em 3 etapas + vacina da canibalização", fala: "Nosso método tem 3 etapas: clonagem entre contas, conta mãe segurando o estoque com baixa automática (sem furo, roda junto com Bling e Tiny) e IA completando título e atributos pro anúncio chegar com nota máxima. E antes que você pergunte: replicar não canibaliza. A Unique dobrou a conta 2 e a conta 1 ainda subiu 20%.", dica: "Responder a canibalização ANTES de perguntarem desarma a objeção mais comum da fase de tese (apareceu em 3 calls, resolvida 3 vezes com esse case)." },
      { t: "Demo AO VIVO nas contas dele (o coração)", fala: "Bora ver rodando na tua operação? Conecta as contas comigo que eu clono 10 anúncios teus agora, de verdade, na tua frente.", dica: "É aqui que a venda acontece. Sem login não tem demo (cobrar do SDR na confirmação). Deu erro? Chama o integrador e corrige na hora: vira prova de suporte (foi assim que fechou a Juliana, com pagamento na call). Objeções técnicas que sempre caem, todas com resposta pronta: estoque/furo (conta mãe + baixa automática), migração em massa (integrador sobe 150 anúncios em 5 a 10 min), limitações tipo Amazon/vídeo/catálogo (honestidade + roadmap)." },
      { t: "Prova com números", fala: "Dois exemplos rápidos: a Unique subiu 105% espelhando as contas, e a Dyno Nutri fez 60 mil a mais em 20 dias.", dica: "Case certo pra dor certa: Unique pra quem duvida da estratégia de contas, Dyno Nutri pra quem tem pressa, e pra autopeça a criação por OEM com 100 por mês inclusos." },
      { t: "Oferta com âncora única", fala: "O investimento é o plano anual: 7.188, em 12x de 599 sem juros, ou 6.488 à vista no Pix com 10% de desconto. Preço fixo, sem taxa por pedido: a gente não quer ser teu sócio. E tudo que lançarmos durante o teu contrato está incluso.", dica: "A escada (semestral e, por último, o serviço único de réplica) SÓ entra se travar em caixa, e com validade real: a condição vale nesta call. Questionaram a multa de cancelamento? Responde com o valor do primeiro dia (teus anúncios migram amanhã), não com a multa." },
      { t: "Fechamento = agendar a integração", fala: "Então bora deixar rodando: que horário amanhã pro nosso integrador migrar teus {{anuncios}} anúncios, 13h ou 17h?", dica: "Não pergunte 'quer fechar?'. Pagamento ainda na call: Pix na hora ou link do cartão em 12x. Quem sai 'pra pagar depois' vira follow-up de cobrança." },
      { t: "Não fechou: tarefa + data + decisor", fala: "Fechado, então combina assim: você resolve isso [logins, abrir a Shopee, falar com o sócio] e a gente se fala nesse dia, nesse horário. Se o sócio decide junto, traz ele que eu reapresento em 15 minutos.", dica: "Nunca aceite 'vou pensar' seco. Decisor ausente ({{decisor}}) nunca fechou na call: a remarcação é COM a pessoa. Registra a tarefa e a data no GPS do lead." },
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
  followup1: {
    titulo: "Follow-up · 1º contato",
    resumo: "Primeiro retorno depois da call. Negociação aberta: cobre a decisão com leveza e feche com um próximo passo DATADO. Sem compromisso combinado, o lead esfria.",
    objetivo: "Puxar a decisão (ou a objeção real) e sair com um dia marcado pra bater o martelo.",
    passos: [
      { t: "Cobrança leve", fala: "Oi {{nome}}, tudo bom? Aqui é {{eu}}. Depois da nossa call você ficou de me dar um retorno sobre a {{produto}}. Conseguiu pensar por aí?" },
      { t: "Puxar a objeção real", fala: "Me fala com sinceridade o que está pegando: é o investimento, o momento, ou ficou alguma dúvida sobre a ferramenta?" },
      { t: "Compromisso datado", fala: "Fechado. Então me diz um dia bom ainda essa semana pra gente bater o martelo, que eu já deixo tudo pronto pra você começar.", dica: "Sai daqui com data. Sem retorno, o GPS traz de volta em 3 dias úteis pro 2º contato." },
    ],
  },
  followup2: {
    titulo: "Follow-up · 2º contato",
    resumo: "3 dias depois, sem retorno. Reconhece o silêncio sem cobrar, ataca a objeção mais provável e reforça que o risco é baixo. Pede uma sinalização objetiva.",
    objetivo: "Derrubar a objeção que travou a decisão e reabrir a conversa com um próximo passo.",
    passos: [
      { t: "Retomada sem peso", fala: "Oi {{nome}}! Sei que a correria aperta, então não quero te deixar sem um retorno meu sobre a {{produto}}." },
      { t: "Quebra de objeção + prova", fala: "Uma dúvida comum aqui é o quanto dá de trabalho, mas no seu caso é o contrário: a gente clona seus melhores anúncios pra outras contas em minutos, e um cliente nosso subiu 105% as vendas fazendo exatamente isso. O risco pra você é baixo." },
      { t: "Pedido objetivo", fala: "Faz sentido a gente retomar? Me responde só com um 'bora' que eu já te reservo um horário pra fechar, ou me diz o que ainda está te segurando.", dica: "Sem resposta, o GPS devolve em mais 3 dias úteis pro 3º contato (último)." },
    ],
  },
  followup3: {
    titulo: "Follow-up · 3º contato (último)",
    resumo: "Última tentativa antes de encerrar. Saída elegante que pede um sim ou não claro, sem constranger. Sem resposta, o card vai pra Desqualificado.",
    objetivo: "Fechar a decisão nos dois sentidos: retomar agora ou encerrar com respeito e liberar a fila.",
    passos: [
      { t: "Saída elegante", fala: "Oi {{nome}}, tudo certo? Vou parar de te chamar pra não virar chateação. Só me ajuda a entender: clonar seus anúncios entre contas ainda faz sentido pra sua operação agora?" },
      { t: "Sim ou não claro", fala: "Se ainda fizer, eu retomo com prioridade e a gente fecha essa semana. Se não for a hora, sem problema nenhum, é só me falar que eu encerro seu atendimento por aqui e deixo a porta aberta pra quando quiser voltar.", dica: "Sem resposta depois deste contato, mova o card pra Desqualificado (motivo: sem retorno)." },
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
// Qual CHAVE de DEFAULT_SCRIPTS um lead resolve (sem aplicar override). É o que
// liga o lead ao roteiro editável em Ajustes → Scripts (product.scripts[chave]).
export function scriptKeyFor(saasCfg, lead) {
  const stage = lead?.stage || saasCfg?.funnel?.[0]?.stage || "";
  const kind = stageKind(saasCfg, stage);
  const reactivation = (kind === "contato" || kind === "qualificacao") &&
    lead?.stage && !openStages(saasCfg).includes(stage);
  const attempts = Number(lead?.stageAttempts) || 0;
  if (isNoShowStage(stage)) return attempts >= 1 ? "noshow2" : "noshow1";
  if (reactivation) return attempts >= 2 ? "nutricao3" : attempts === 1 ? "nutricao2" : "nutricao1";
  if (kind === "qualificacao") return attempts >= 1 ? "qualificacao3" : "qualificacao2";
  if (kind === "followup") return attempts >= 2 ? "followup3" : attempts === 1 ? "followup2" : "followup1";
  return DEFAULT_SCRIPTS[kind] ? kind : "outro";
}

// Aplica um override de product.scripts[chave] sobre o roteiro padrão. Aceita
// dois formatos: OBJETO estruturado { resumo?, objetivo?, passos:[{t,fala,dica}] }
// (editor da aba Scripts, substitui os campos presentes) ou STRING livre (legado
// do funnel[].script, substitui só o passo a passo via parseCustomScript).
// Retorna null quando não há override aplicável.
export function applyScriptOverride(base, over) {
  if (!over) return null;
  if (typeof over === "string") {
    return over.trim() ? { ...base, custom: true, passos: parseCustomScript(over) } : null;
  }
  if (typeof over === "object" && !Array.isArray(over)) {
    const patch = {};
    if (over.resumo != null && String(over.resumo).trim()) patch.resumo = over.resumo;
    if (over.objetivo != null && String(over.objetivo).trim()) patch.objetivo = over.objetivo;
    if (Array.isArray(over.passos) && over.passos.length) patch.passos = over.passos;
    return Object.keys(patch).length ? { ...base, ...patch, custom: true } : null;
  }
  return null;
}

export function resolveScript(saasCfg, lead) {
  const key = scriptKeyFor(saasCfg, lead);
  const base = DEFAULT_SCRIPTS[key] || DEFAULT_SCRIPTS.outro;
  // Prioridade: override por chave editado em Ajustes → Scripts
  // (product.scripts[key]) > override legado por estágio (funnel[].script) >
  // padrão do código.
  const applied = applyScriptOverride(base, saasCfg?.scripts?.[key]);
  if (applied) return applied;
  const stage = lead?.stage || saasCfg?.funnel?.[0]?.stage || "";
  const row = (saasCfg?.funnel || []).find((f) => f && f.stage === stage);
  if (row?.script && String(row.script).trim()) {
    return { ...base, custom: true, passos: parseCustomScript(row.script) };
  }
  return base;
}

// Roteiro de confirmação da call. Passos base: [0]=1h antes, [1]=10min positiva
// (cliente confirmou), [2]=10min ligar (sem resposta). A tarefa de confirmação
// na fila é DIVIDIDA em duas janelas (Meu dia): passar `window` mostra só a
// mensagem daquela janela — "1h" = passo [0]; "10min" = [1] ou [2] conforme o
// lead.callConfirmed (o SDR marca "cliente confirmou" e o passo troca). Sem
// window (drawer antigo), mostra 1h + a de 10min certa. Respeita override
// product.scripts.confirmacao quando saasCfg é passado.
export function confirmationScript(lead, saasCfg, window) {
  const base = applyScriptOverride(DEFAULT_SCRIPTS.confirmacao, saasCfg?.scripts?.confirmacao) || DEFAULT_SCRIPTS.confirmacao;
  const confirmed = !!lead?.callConfirmed;
  const all = base.passos || [];
  let passos;
  if (window === "1h") passos = all.filter((_, i) => i === 0);
  else if (window === "10min") passos = all.filter((_, i) => confirmed ? i === 1 : i === 2);
  else passos = all.filter((_, i) => i === 0 || (confirmed ? i === 1 : i === 2));
  return { ...base, passos };
}

// Passo a passo → texto editável (o formato que parseCustomScript lê de volta):
// cada passo vira "Título:\n<fala>", separados por linha em branco. A dica
// interna não entra (é nota de apoio, não faz parte da fala pro cliente).
export function passosToText(passos) {
  return (passos || [])
    .map((p) => (p?.t ? p.t + ":\n" : "") + (p?.fala || ""))
    .filter((s) => s && s.trim())
    .join("\n\n");
}

// Catálogo dos roteiros pra tela de Ajustes → Scripts: cada item aponta a chave
// de DEFAULT_SCRIPTS, um rótulo, a fase do processo e como achar a cadência do
// estágio relacionado (por kind ou por nome da coluna). confirmacao não tem
// cadência de estágio (as janelas 1h/10min são regra fixa).
export const SCRIPT_CATALOG = [
  { key: "novo",          label: "Novo lead · 1º ato",            phase: "Pré-venda (SDR)", stageKind: "novo" },
  { key: "qualificacao2", label: "Qualificando · 2ª tentativa",   phase: "Pré-venda (SDR)", stageKind: "qualificacao" },
  { key: "qualificacao3", label: "Qualificando · 3ª tentativa",   phase: "Pré-venda (SDR)", stageKind: "qualificacao" },
  { key: "confirmacao",   label: "Confirmação da call",           phase: "Pré-venda (SDR)" },
  { key: "noshow1",       label: "No show · 1ª remarcação",       phase: "Pré-venda (SDR)", stageMatch: "noshow" },
  { key: "noshow2",       label: "No show · 2ª remarcação",       phase: "Pré-venda (SDR)", stageMatch: "noshow" },
  { key: "nutricao1",     label: "Nutrição · 1º contato (prova)", phase: "Reativação",      stageMatch: "nutri" },
  { key: "nutricao2",     label: "Nutrição · 2º contato (oferta)",phase: "Reativação",      stageMatch: "nutri" },
  { key: "nutricao3",     label: "Nutrição · 3º contato (saída)", phase: "Reativação",      stageMatch: "nutri" },
  { key: "call",          label: "Call de fechamento",            phase: "Closer",          stageKind: "call" },
  { key: "proposta",      label: "Proposta enviada",              phase: "Closer",          stageKind: "proposta" },
  { key: "followup1",     label: "Follow-up · 1º contato",        phase: "Closer",          stageKind: "followup" },
  { key: "followup2",     label: "Follow-up · 2º contato",        phase: "Closer",          stageKind: "followup" },
  { key: "followup3",     label: "Follow-up · 3º contato (último)",phase: "Closer",         stageKind: "followup" },
  { key: "integracao",    label: "Integração",                    phase: "Entrega",         stageKind: "integracao" },
  { key: "posvenda",      label: "Pós-venda",                     phase: "Entrega",         stageKind: "posvenda" },
];

// Acha a linha do funil que casa com um item do catálogo (pra ler/editar a
// cadência daquele estágio). stageMatch usa nome (No show / Nutrição).
export function catalogStageRow(saasCfg, item) {
  const funnel = saasCfg?.funnel || [];
  if (item.stageMatch === "noshow") return funnel.find((f) => isNoShowStage(f?.stage)) || null;
  if (item.stageMatch === "nutri") return funnel.find((f) => /nutri/i.test(String(f?.stage || ""))) || null;
  if (item.stageKind) return funnel.find((f) => f && f.kind === item.stageKind) || null;
  return null;
}

// Checklist de dados do lead pro painel do roteiro, NA ORDEM DA CONVERSA que o
// Leo definiu: nicho → empresa → contas → anúncios → expansão → time de
// marketing → e-mail por último (quando já está tudo confirmado). Cada item sai
// com type/options pro painel renderizar o campo EDITÁVEL (select com as opções
// do formulário; texto onde é livre). `key` é o campo do lead a ser gravado.
const CHECKLIST_ORDER = ["niche", "company", "accounts", "listings", "plan_expand", "staff", "suspended", "decider"];

export function scriptChecklist(saasCfg, lead) {
  const qs = saasCfg?.leadQuestions || [];
  const byKey = Object.fromEntries(qs.map((q) => [q.key, q]));
  // "Nome da loja / empresa" é campo de venda B2B (LeverAds vende pra lojista, o
  // SDR pergunta na ligação). Só entra quando o produto usa o formulário estilo
  // LeverAds (tem nicho/contas/anúncios...); produto B2C (ex.: UniqueKids, que
  // vende pra mãe) não mostra esse campo no checklist do roteiro.
  const wantsCompany = ["niche", "accounts", "listings", "plan_expand", "staff"].some((k) => byKey[k]);
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
      if (wantsCompany) items.push({ key: "company", label: "Nome da loja / empresa", type: "text", options: [], value: lead?.company || "", raw: lead?.company || "" });
    } else if (byKey[k]) {
      items.push(fromQuestion(byKey[k]));
    }
  }
  // Perguntas extras do produto (fora da ordem canônica) entram antes do e-mail.
  for (const q of qs) if (!seen.has(q.key)) items.push(fromQuestion(q));
  items.push({ key: "email", label: "E-mail (convite da call) · por último", type: "text", options: [], value: lead?.email || "", raw: lead?.email || "" });
  return items;
}
