import { scriptSegments, scriptTokens } from "./scripts.js";

// Modelos de mensagem do SDR por WHATSAPP: o fluxo inteiro de qualificação até
// marcar a call, na ordem da conversa. É o mesmo processo dos roteiros de
// ligação (lib/scripts.js), reescrito pra texto: mensagem curta, UMA pergunta
// por vez e o próximo passo sempre explícito.
//
// Os {{tokens}} são os mesmos dos roteiros (scriptTokens): o que o lead já
// respondeu no formulário entra pronto; o que falta vira [lembrete] pro SDR
// completar antes de enviar (nunca sai um buraco pro cliente).
//
// Override por produto em `saasCfg.waTemplates` (mesmo formato) — dá pra
// reescrever a copy sem deploy, igual aos roteiros.
export const WA_FLOW = [
  {
    group: "Abertura",
    items: [
      {
        label: "1º contato (veio do formulário)",
        text: "Oi {{nome}}, tudo bem? Aqui é o {{eu}}, da LeverAds.\n\nVocê preencheu nosso diagnóstico sobre anunciar em várias contas no marketplace. Posso te fazer duas perguntas rápidas pra entender seu cenário?",
      },
      {
        label: "Não atendeu a ligação",
        text: "Oi {{nome}}, aqui é o {{eu}} da LeverAds. Tentei te ligar agora e não consegui falar com você.\n\nQual o melhor horário pra gente trocar 10 minutos, hoje ou amanhã?",
      },
      {
        label: "2ª tentativa (não respondeu ontem)",
        text: "{{nome}}, passando de novo por aqui. Sei que o dia a dia come o tempo.\n\nMe responde só isso: hoje você sobe os anúncios nas outras contas na mão?",
      },
    ],
  },
  {
    group: "Qualificação",
    items: [
      {
        // Os rótulos do formulário já vêm escritos ("3 a 5 contas", "500 a 2
        // mil"), então a frase entra como complemento e não repete a palavra.
        // Uma pergunta por mensagem: no WhatsApp, duas juntas só ganham uma
        // resposta.
        label: "Confirmar as contas",
        text: "Só pra eu confirmar: hoje você anuncia em {{contas}}, certo?",
      },
      {
        label: "Confirmar o volume de anúncios",
        text: "E hoje você tem uns {{anuncios}} anúncios no ar?",
      },
      {
        label: "Como sobe os anúncios hoje",
        text: "E quem cuida de subir esses anúncios nas outras contas? É um por um, na mão?",
      },
      {
        label: "Tempo gasto na operação",
        text: "Quanto tempo por semana isso toma do seu time? Pergunto porque é exatamente aí que a gente devolve tempo.",
      },
      {
        // Sem token de propósito: a resposta do formulário no meio da frase
        // ("[perguntar sobre abrir contas]") deixaria a pergunta sem pé quando
        // o lead não respondeu, e esta funciona nos dois casos.
        label: "Planos de expansão",
        text: "Você pretende abrir mais contas nos próximos meses, ou a ideia é aproveitar melhor as que já tem?",
      },
      {
        label: "Quem decide junto",
        text: "Além de você, mais alguém participa dessa decisão?",
      },
    ],
  },
  {
    group: "Prova e valor",
    items: [
      {
        label: "O que a LeverAds faz (resumo)",
        text: "Resumindo o que a gente faz: você cria o anúncio em uma conta e a LeverAds replica ele em todas as suas outras contas, no Mercado Livre e na Shopee.\n\nMudou preço ou atributo? Atualiza em todas de uma vez.",
      },
      {
        label: "Case: +105% em 1 mês",
        text: "Um cliente nosso clonou o catálogo da conta principal pra segunda conta. No mesmo mês, a conta 2 fez *+105% de receita*, com os mesmos anúncios que ele já tinha.",
      },
      {
        label: "Teste sem risco (na call)",
        text: "Se quiser, na call eu clono 10 dos seus melhores anúncios ao vivo, em poucos minutos. Você vê acontecendo na sua conta antes de decidir qualquer coisa.",
      },
      {
        label: "Objeção: já tenho quem faça",
        text: "Faz sentido. A diferença é que a pessoa continua no time, só que cuidando de venda em vez de copiar e colar anúncio. O que hoje leva duas horas passa a levar minutos.",
      },
      {
        label: "Objeção: preciso pensar",
        text: "Claro. Só me ajuda a entender: o que ainda está te deixando em dúvida? Se for algo que dá pra resolver na call, a gente resolve em 20 minutos.",
      },
    ],
  },
  {
    group: "Agendar a call",
    items: [
      {
        label: "Propor a call",
        text: "Faz sentido a gente marcar 20 minutos pra eu te mostrar isso rodando na *sua* conta? Consigo hoje no fim da tarde ou amanhã de manhã, o que fica melhor pra você?",
      },
      {
        label: "Oferecer dois horários",
        text: "Tenho estes horários livres: amanhã às 10h ou às 15h. Qual funciona melhor?",
      },
      {
        label: "Confirmar o horário",
        text: "Fechado, {{call}}. Já deixo reservado aqui.",
      },
      {
        label: "Pedir o e-mail (depois de marcar)",
        text: "Me passa seu melhor e-mail? É só pra você receber o convite com o link da call.",
      },
      {
        label: "Mandar o link da call",
        text: "{{nome}}, nossa call é {{call}}.\n\nLink pra entrar: {{link_call}}",
      },
    ],
  },
  {
    group: "Sem resposta",
    items: [
      {
        label: "Follow-up leve",
        text: "Oi {{nome}}, chegou a ver minha mensagem? Se preferir, me diz um horário que eu te chamo.",
      },
      {
        label: "Encerramento (sim ou não)",
        text: "{{nome}}, pra eu não ficar te incomodando: faz sentido conversarmos agora, ou prefere que eu volte mais pra frente?",
      },
    ],
  },
  {
    group: "Antes e depois da call",
    items: [
      {
        label: "Lembrete no dia",
        text: "Bom dia, {{nome}}! Confirmando nossa call de hoje às {{hora_call}}. Está de pé?",
      },
      {
        label: "Não apareceu na call",
        text: "Passei na call no horário e não te encontrei, {{nome}}. Acontece!\n\nQuer remarcar? Me diz um horário que funcione pra você.",
      },
      {
        label: "Depois da call",
        text: "{{nome}}, foi ótimo falar com você. Qualquer dúvida que surgir, me chama por aqui.",
      },
    ],
  },
];

// Catálogo do produto: override em saasCfg.waTemplates vence o padrão (mesma
// regra dos roteiros). Formato inválido cai no padrão em vez de sumir com tudo.
export function waFlowFor(saasCfg) {
  const over = saasCfg?.waTemplates;
  if (Array.isArray(over) && over.length && over.every((g) => Array.isArray(g?.items))) return over;
  return WA_FLOW;
}

// Texto pronto pra caixa de envio: token preenchido entra como valor; token
// vazio vira [lembrete] entre colchetes — o SDR vê o que falta antes de mandar,
// em vez de enviar uma frase com buraco.
export function fillTemplate(text, tokens) {
  return scriptSegments(text, tokens || {})
    .map((s) => (s.text != null ? s.text : s.value != null ? s.value : `[${s.gap}]`))
    .join("");
}

// O catálogo pronto pra conversa: mesmos tokens dos roteiros de ligação, então
// o que o lead respondeu no formulário já entra no texto.
export function waTemplatesFor(lead, saasCfg) {
  const tokens = scriptTokens(lead || {}, saasCfg);
  return waFlowFor(saasCfg).map((g) => ({
    group: g.group,
    items: (g.items || []).map((it) => ({ label: it.label, text: fillTemplate(it.text, tokens) })),
  }));
}
