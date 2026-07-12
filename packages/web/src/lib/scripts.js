// Roteiros de abordagem por etapa ("o que falar com esse lead AGORA") — o motor
// da tela Meu dia. A fala certa vem em camadas: roteiro da etapa escrito em
// Ajustes → Funil (product.funnel[].script, texto livre com {{tokens}}) vence;
// sem override, cai no roteiro padrão por KIND daqui. Tokens viram dados reais
// do lead; token sem valor vira lacuna destacada ("perguntar na ligação") — a
// lacuna É instrução: o que faltar no cadastro se descobre nesse contato.

import { stageKind } from "./funnel.js";

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
    produto: saasCfg?.name || "",
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
  produto: "produto",
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
    titulo: "1º contato · novo lead",
    resumo: "Ligação rápida de boas-vindas: a pessoa ACABOU de se cadastrar, então o interesse está quente. Tom leve, sorriso na voz, ritmo ágil. Você não vende a ferramenta aqui (a demonstração é da call), você confirma dados e agenda.",
    objetivo: "Sair com a call agendada e o cadastro completo: nicho, contas, anúncios e nome da loja.",
    passos: [
      { t: "Abertura, confirmar o cadastro", fala: "Olá {{nome}}, bom dia! Tudo bom? Vi que você se cadastrou no nosso formulário pra conhecer nossa ferramenta de clone de anúncios, você confirma?" },
      { t: "Confirmar o nicho", fala: "Vi aqui que você trabalha com {{nicho}}, legal! É seu foco principal hoje?" },
      { t: "Contas nos marketplaces", fala: "E atualmente você opera quantas contas dentro dos marketplaces? Aqui no formulário você marcou {{contas}}, é isso?", dica: "Se mudou, corrija no cadastro: esse número mede o tamanho da dor." },
      { t: "Anúncios na maior conta", fala: "E de volume, quantos anúncios você tem na sua maior conta? Você indicou {{anuncios}}." },
      { t: "Nome da loja", fala: "Qual o nome da sua loja, da sua empresa? Vou dar uma olhada aqui enquanto a gente conversa.", dica: "Anote em Empresa. Abrir a loja na hora cria assunto (rapport) e arma o closer pra call." },
      { t: "Agendar a call", fala: "Perfeito {{nome}}! Com esse volume faz muito sentido você ver a ferramenta rodando na prática, clonando anúncio de verdade. São uns 20 minutos. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "Sempre 2 opções de horário, nunca pergunta aberta. Marcou? Registra em Call agendada e já gera o link da videochamada no lead." },
    ],
  },
  contato: {
    titulo: "Tentativa de contato",
    resumo: "O lead ainda não atendeu. Alterne canal e horário a cada tentativa: ligação em horário comercial, WhatsApp fora dele. Mensagem curta, sempre terminando com pergunta.",
    objetivo: "Conseguir a primeira conversa (daí o roteiro de 1º contato assume) ou esgotar a cadência com consciência limpa.",
    passos: [
      { t: "Ligação", fala: "Olá {{nome}}, tudo bom? Falo da {{produto}}. Você se cadastrou pra conhecer nossa ferramenta de clone de anúncios, consegue falar 3 minutinhos agora?" },
      { t: "WhatsApp, se não atender", fala: "Oi {{nome}}! Vi seu cadastro aqui na {{produto}} (a ferramenta que clona anúncios entre contas de marketplace). Te liguei mas não consegui. Qual o melhor horário pra gente trocar uma ideia rápida?", dica: "Registre cada tentativa no toque do card: o GPS agenda a próxima sozinho." },
    ],
  },
  qualificacao: {
    titulo: "Qualificação",
    resumo: "Conversa aberta: complete o que falta do cadastro e esquente o lead pra call. Você não demonstra a ferramenta, você mostra que entendeu a operação dele.",
    objetivo: "Cadastro completo + call agendada com o closer.",
    passos: [
      { t: "Retomar o contexto", fala: "Oi {{nome}}, tudo bom? Da última vez você me contou da sua operação de {{nicho}}. Te peguei num bom horário?" },
      { t: "Completar os dados", fala: "Deixa eu confirmar o que tenho aqui: são {{contas}} nos marketplaces e uns {{anuncios}} anúncios na maior conta, é isso?" },
      { t: "Gerar valor", fala: "É exatamente esse cenário que a ferramenta resolve: ela clona seus anúncios entre as contas em minutos, sem redigitar nada." },
      { t: "Fechar a call", fala: "Vou te colocar com nosso especialista pra você ver isso rodando na sua operação. Fica melhor amanhã de manhã ou no fim da tarde?", dica: "2 opções de horário. Marcou? Call agendada + link da videochamada no lead." },
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
export function resolveScript(saasCfg, lead) {
  const stage = lead?.stage || saasCfg?.funnel?.[0]?.stage || "";
  const kind = stageKind(saasCfg, stage);
  const base = DEFAULT_SCRIPTS[kind] || DEFAULT_SCRIPTS.outro;
  const row = (saasCfg?.funnel || []).find((f) => f && f.stage === stage);
  if (row?.script && String(row.script).trim()) {
    return { ...base, custom: true, passos: parseCustomScript(row.script) };
  }
  return base;
}

// Checklist de dados do lead pro painel do roteiro (o que confirmar na ligação).
// Cobre as perguntas de qualificação do produto + empresa/loja.
export function scriptChecklist(saasCfg, lead) {
  const items = [];
  for (const q of saasCfg?.leadQuestions || []) {
    items.push({ label: q.label, value: answerLabel(saasCfg, lead, q.key) });
  }
  items.push({ label: "Nome da loja / empresa", value: lead?.company || "" });
  return items;
}
