// Roteiros de abordagem por etapa ("o que falar com esse lead AGORA") — o motor
// da tela Meu dia. A fala certa vem em camadas: roteiro da etapa escrito em
// Ajustes → Funil (product.funnel[].script, texto livre com {{tokens}}) vence;
// sem override, cai no roteiro padrão por KIND daqui. Tokens viram dados reais
// do lead; token sem valor vira lacuna destacada ("perguntar na ligação") — a
// lacuna É instrução: o que faltar no cadastro se descobre nesse contato.

import { stageKind, openStages } from "./funnel.js";
import { currentUser } from "./users.js";

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

export const DEFAULT_SCRIPTS = {
  novo: {
    titulo: "1º ato · novo lead (prioridade máxima)",
    resumo: "O lead acabou de entrar: é o topo da fila, sempre (cadastro de fim de semana se trabalha na segunda, nos primeiros horários). A sessão é uma só: ligue 2 vezes; não atendeu, deixe o WhatsApp de apresentação. Tom leve, sorriso na voz. Atendeu? Siga a sequência de perguntas do passo a passo, confirmando e corrigindo os campos ao lado. Registrou o toque, o card segue sozinho pra Qualificando.",
    objetivo: "Conversa breve de confirmação: dados completos na ordem (nicho, empresa, contas, anúncios, expansão, time, e-mail por último) e call agendada. Não atendeu? Apresentação no WhatsApp pedindo o melhor horário.",
    passos: [
      { t: "Identificação (ligar 2 vezes)", fala: "Olá {{nome}}, tudo bom? Sou {{eu}}, da {{produto}}. Recebi o seu cadastro com interesse na nossa ferramenta de clonar anúncios, você confirma pra mim?", dica: "Não atendeu? Liga de novo em seguida. Caiu na caixa duas vezes, manda o WhatsApp do passo 2 e registra o toque." },
      { t: "Não atendeu: WhatsApp de apresentação", fala: "Olá {{nome}}, tudo bem? Aqui é {{eu}}, da plataforma {{produto}}. Recebemos o seu cadastro dizendo estar interessado no nosso serviço de clonagem de anúncios. Tem algum horário em que a gente possa te retornar pra conversar sobre?", dica: "Depois registra o toque: o card vai pra Qualificando e o GPS marca a retomada pra amanhã." },
      { t: "Atendeu: transição", fala: "Que bom! Queria confirmar só algumas informações com você, essa primeira conversa é bem breve." },
      { t: "Nicho", fala: "Vi que você preencheu que trabalha com {{nicho}}, é isso mesmo?" },
      { t: "Nome da empresa", fala: "Legal! E qual o nome da sua loja, da sua empresa?", dica: "Preenche no campo ao lado. Abrir a loja na hora cria assunto e arma o closer pra call." },
      { t: "Contas nos marketplaces", fala: "Hoje você opera quantas contas dentro dos marketplaces? No formulário você marcou {{contas}}." },
      { t: "Anúncios na maior conta", fala: "E na sua maior conta, quantos anúncios publicados você tem? Você indicou {{anuncios}}." },
      { t: "Abrir mais contas", fala: "E você pretende abrir mais contas nos próximos meses?", dica: "Resposta do formulário: {{expansao}}." },
      { t: "Time de marketing", fala: "Quantas pessoas você tem hoje no time de marketing, cuidando dos anúncios?" },
      { t: "E-mail, por último", fala: "Perfeito, já confirmei tudo por aqui. Me passa seu melhor e-mail? É pra onde vai o convite da nossa call.", dica: "Preenche no campo ao lado; o convite do Meet vai automático pra ele." },
      { t: "Agendar a call", fala: "Fechado {{nome}}! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada no lead e gera o link da videochamada." },
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
  qualificacao: {
    titulo: "Qualificando · sessões diárias",
    resumo: "Retomada do dia: ligue 2 vezes; sem resposta, manda o WhatsApp da sessão. Atendeu? Roda a qualificação completa e sai com a call marcada. O processo inteiro são 3 sessões (1º ato + 2 retomadas); acabou a terceira sem retorno, o card vai pra Nutrição.",
    objetivo: "Qualificação completa (formulário confirmado + empresa, time de marketing e e-mail) e call agendada com o closer.",
    passos: [
      { t: "Atendeu: identificação", fala: "Oi {{nome}}, tudo bom? Sou {{eu}}, da {{produto}}. A gente se falou sobre o seu interesse na clonagem de anúncios. Consegue falar rapidinho agora?" },
      { t: "Rodar a sequência de dados", fala: "Deixa eu confirmar o que tenho: nicho de {{nicho}}, loja {{empresa}}, {{contas}} nos marketplaces e uns {{anuncios}} anúncios na maior conta, confere?", dica: "Siga a ordem dos campos ao lado e complete o que faltar: expansão ({{expansao}}), time de marketing ({{equipe}}) e o e-mail por último." },
      { t: "Agendar a call", fala: "Fechado! Vou te colocar com nosso especialista pra você ver a ferramenta clonando anúncio de verdade na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário. Marcou? Registra em Call agendada e gera o link da videochamada." },
      { t: "Sessão 2, sem resposta (WhatsApp)", fala: "Oi, tudo bem? Estou falando com {{nome_completo}}? Sou {{eu}}, da plataforma {{produto}}, sobre o seu cadastro de interesse na clonagem de anúncios." },
      { t: "Sessão 3, última (WhatsApp)", fala: "Oi {{nome}}! A gente entende que às vezes o momento não é o ideal. Você gostaria de conhecer a plataforma {{produto}} ou podemos finalizar o seu atendimento por aqui?", dica: "Sem retorno até o fim do dia: mover o card pra Nutrição. O GPS devolve ele pra fila em 20 dias, num dia útil." },
    ],
  },
  nutricao: {
    titulo: "Nutrição · reativação (20 dias)",
    resumo: "Lead que não respondeu ao primeiro ciclo. Passaram 20 dias: recomece como se fosse um lead novo, com leveza, sem cobrar o silêncio. Mesmo ritmo: 2 ligações + WhatsApp, até 3 sessões em dias seguidos.",
    objetivo: "Reabrir a conversa e voltar pro fluxo de qualificação, ou encerrar com clareza.",
    passos: [
      { t: "Ligar (2 tentativas)", fala: "Olá {{nome}}, tudo bom? Aqui é {{eu}}, da {{produto}}. Faz um tempo que você se cadastrou pra conhecer nossa ferramenta de clone de anúncios e eu queria retomar com você." },
      { t: "WhatsApp, se não atender", fala: "Oi {{nome}}! Há um tempo você demonstrou interesse na {{produto}} (clonagem de anúncios entre contas de marketplace). Muita coisa evoluiu por aqui desde então. Faz sentido a gente conversar 5 minutinhos essa semana?" },
      { t: "Sessão 3, encerramento (WhatsApp)", fala: "Oi {{nome}}! Pra não te incomodar, vou encerrar seu atendimento por aqui. Quando fizer sentido clonar seus anúncios, é só responder esta conversa que eu te atendo na hora.", dica: "Sem retorno: mover pra Desqualificado (motivo: sem resposta). Respondeu? Volta pra Qualificando e segue o fluxo normal." },
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
export function resolveScript(saasCfg, lead) {
  const stage = lead?.stage || saasCfg?.funnel?.[0]?.stage || "";
  const kind = stageKind(saasCfg, stage);
  const reactivation = (kind === "contato" || kind === "qualificacao") &&
    lead?.stage && !openStages(saasCfg).includes(stage);
  const base = reactivation ? DEFAULT_SCRIPTS.nutricao : (DEFAULT_SCRIPTS[kind] || DEFAULT_SCRIPTS.outro);
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
