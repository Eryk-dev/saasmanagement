// Cadência de contato (7 dias) e trilhas de nutrição.
//
// A cadência é CONCENTRADA NA FRENTE e alterna canal e janela de horário —
// ligar sempre no mesmo horário só alcança quem está livre naquele horário.
// E não é uniforme: cadência igual pra todo mundo gasta o mesmo SDR num lead
// D e num S. Três perfis, escolhidos pelo cruzamento porte × intenção
// (ver `cadencia` em classificacao.js), não nove.

// `day` é o offset em dias a partir da entrada no estágio; dois passos no
// mesmo dia são propositais (o D1 do perfil prioritário), em janelas
// diferentes.
export const CADENCIAS = {
  // S/A quente e B/C quente: o lead que justifica hora de gente.
  prioritario: {
    maxAttempts: 6,
    firstTouchHours: 0.25, // 15 min — o toque que mais conecta é o imediato
    steps: [
      { day: 0, canal: "ligacao", janela: "imediato" },
      { day: 0, canal: "whats", janela: "tarde" },
      { day: 1, canal: "ligacao", janela: "oposta-ao-d1" },
      { day: 2, canal: "audio", janela: "manha" },
      { day: 4, canal: "ligacao", janela: "oposta-ao-d2" },
      { day: 6, canal: "whats", janela: "encerramento" },
    ],
  },
  // Meio da tabela: começa por escrito, liga no meio da semana.
  padrao: {
    maxAttempts: 4,
    firstTouchHours: 2,
    steps: [
      { day: 0, canal: "whats", janela: "imediato" },
      { day: 1, canal: "ligacao", janela: "manha" },
      { day: 4, canal: "ligacao", janela: "tarde" },
      { day: 6, canal: "whats", janela: "encerramento" },
    ],
  },
  // D/E ou intenção baixa: praticamente já é nutrição. Sem ligação — é isto
  // que preserva a hora do SDR pra quem tem porte.
  leve: {
    maxAttempts: 2,
    firstTouchHours: 8,
    steps: [
      { day: 0, canal: "whats", janela: "imediato" },
      { day: 3, canal: "whats", janela: "encerramento" },
    ],
  },
};

// O toque de encerramento (D7) não é sobra: é o de maior resposta da cadência,
// porque aciona perda em vez de pedir tempo. E é o handoff limpo pra nutrição.
export const ENCERRAMENTO_DIA = 6;

// ── Nutrição ──────────────────────────────────────────────────────────────
// A trilha é escolhida pelo MOTIVO da saída, não por "todo mundo depois de 7
// dias". O `lostReason` já é obrigatório no kind desqualificado, então o
// roteamento sai de graça.
//
// Mandar o vídeo da plataforma pra quem é pequeno demais produz o pior
// resultado possível: ele responde, ocupa SDR e não fecha.
export const TRILHAS = {
  // Tamanho certo, momento errado. É a pilha que mais volta.
  oferta: {
    id: "nutricao-oferta",
    nome: "Vídeo da plataforma + CTA",
    reasons: ["sem_resposta_7d", "nao_e_agora"],
    // Frequência decrescente: o interesse não some, mas a paciência sim.
    steps: [
      { delayDays: 0, channel: "whatsapp", templateId: "video-plataforma-cta" },
      { delayDays: 14, channel: "email", templateId: "video-plataforma-cta" },
      { delayDays: 24, channel: "whatsapp", templateId: "video-plataforma-cta" },
      { delayDays: 45, channel: "email", templateId: "video-plataforma-cta" },
    ],
  },
  // Não pode comprar hoje. Só conteúdo — demo aqui queima credibilidade.
  educacional: {
    id: "nutricao-educacional",
    nome: "Linha educacional",
    reasons: ["porte_abaixo_do_piso", "fora_icp", "nao_tem_interesse"],
    steps: [
      { delayDays: 0, channel: "email", templateId: "edu-1" },
      { delayDays: 7, channel: "email", templateId: "edu-2" },
      { delayDays: 14, channel: "email", templateId: "edu-3" },
      { delayDays: 21, channel: "email", templateId: "edu-4" },
    ],
  },
};

// Motivos que NÃO entram em nenhuma trilha.
export const SEM_NUTRICAO = new Set(["optout", "numero_invalido", "concorrente", "cliente_atual"]);

export function trilhaPara(lostReason) {
  if (!lostReason || SEM_NUTRICAO.has(lostReason)) return null;
  for (const t of Object.values(TRILHAS)) if (t.reasons.includes(lostReason)) return t.id;
  return TRILHAS.educacional.id; // motivo novo/desconhecido cai no mais conservador
}

// Regra de convivência: oferta e educacional nunca na mesma semana, senão o
// educacional vira embalagem de oferta e perde a função. Como as duas trilhas
// são exclusivas por motivo, isso já vale por construção — a função existe pra
// travar o caso de alguém inscrever manualmente nas duas.
export const conflita = (a, b) => a !== b && a && b;
