// SDR conversacional (Fase 2 do SDR automatizado): responde a mensagem do lead
// no WhatsApp e marca a call sozinho. A IA (anthropic.sdrDecide) é SÓ a cabeça:
// devolve uma ação de lista fechada; quem valida e executa é este motor, com
// as travas todas do lado determinístico:
//
//   - horário de agendamento TEM que estar na lista de horários livres reais
//     (agenda-slots.js) — horário inventado vira re-oferta dos 2 primeiros;
//   - movimento de card SÓ pelo caminho canônico (applyStageMove), com o
//     arquivo do callAt antigo (callHistory) igual ao PATCH da API;
//   - cancelamento do lead desmarca DE VERDADE (cancelCall): card volta pra
//     qualificação, lembretes param, convite do Meet morre e a resposta já
//     oferece a remarcação;
//   - trava de preço: se a resposta da IA citar valor, ela é trocada pelo
//     desvio com autoridade (a IA nunca fala número com lead);
//   - handoff silencia o robô na conversa até um humano falar; mensagem humana
//     recente também silencia; teto de mensagens por conversa/dia;
//   - roda SÓ com product.sdrBot.conversation ligado (chave separada da Fase 1,
//     nasce desligada: só liga depois da bateria de replay — sdr-replay.js).
//
// Chamado pelo webhook DESTACADO (sem await): a resposta da Meta não espera a
// IA. Um pequeno atraso antes do envio faz o ritmo parecer de gente.
import { findThreadByPhone, listMessages, recordMessage, findLeadByPhone, linkThreadToLead, waMatchKey } from "./wa-store.js";
import { digits } from "./whatsapp.js";
import { kindOf, firstStage, stageByKind, isWonLead } from "./stages.js";
import { brtToIso, applyStageMove, onOutboundMessage, autoLeadOwner, logActivity, initialNextActionAt } from "./lead-flow.js";
import { raiseAlert } from "./wa-call-flow.js";
import { leadGrade } from "./routes.marketing.js";
import { slotLabel, slotLabelFull, wallNow, spreadPair, wholeHourSlots, activeHolds, holdSlots, releaseHolds } from "./agenda-slots.js";
import { sdrSlotsForLead, sdrAgendaWindow } from "./sdr-agenda.js";
import { sdrBotConfig, leadDigest, conversationActive, leadPainFocus, greetName, SDR_AUTHOR, DEVICE_TIP } from "./sdr-flow.js";
import { transcriber as defaultTranscriber } from "./transcribe.js";

const HOUR = 3_600_000;
const BRAIN_KINDS = new Set(["novo", "contato", "qualificacao", "call"]);
const HUMAN_MUTE_MS = 4 * HOUR;   // gente falou há pouco: a conversa é dela
const GREETING_GAP_MS = 6 * HOUR; // conversa parada há menos disso = SEM saudação nova (Leo, 22/08)
// O pitch (ou o convite de demonstração) já saiu nesta conversa? Então NADA
// disso se repete (Leo, 22-23/08): capacidade já listada não se re-lista, as
// mensagens seguintes referenciam curto e trazem só o novo. O template do 1º
// toque também conta como pitch feito.
const DEMO_RX = /demonstra|mostrar (a |o )?(leverads|plataforma|ferramenta)|funcionando ao vivo/i;
const PITCH_RX = /t[íi]tulo de 200|part number|compatibilidade inteira|clonagem de an[úu]ncios|estoque, atendimento e edi[çc][ãa]o|gerenciar m[úu]ltiplas contas/i;
// Horário já oferecido não se repete enquanto o lead não escolher (Leo,
// 23/08): a re-oferta a cada resposta soa insistente (e o modelo ainda
// rotulava o dia errado ao re-citar de cabeça).
const SLOTS_RX = /(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo) às \d{1,2}h/i;
const DAILY_CAP = 15;             // mensagens do robô por conversa por dia
// VALOR dito por nós. PREÇO É CONVERSA DA CALL (Leo, 18/09): a LeverAds tem
// planos diferentes e o plano certo sai da escuta das dores na call de vendas,
// então nenhum número, faixa, parcela, desconto ou NOME de plano sai do robô
// (nem de gente pelo WhatsApp: ver a escada de preço lá embaixo). O "piso de
// preço" do raio-x de 17/09 (robô dizia "a partir de R$ X") durou um dia:
// saiu por decisão do Leo em 18/09. A régua é única: o replay importa daqui.
export const PRICE_RX = new RegExp([
  /r\$/,                                                                                   // "R$ 299", "R$ mil"
  /\b\d{2,}\s*(reais|por m[eê]s|\/m[eê]s|mensais|mensal|ao m[eê]s|por ano|\/ano|anuais|anual)\b/,
  /\b\d[\d.,]*\s*(mil|k)\s*(reais|por m[eê]s|\/m[eê]s|mensais|de investimento)/,            // "2 mil reais", "1,5k/mês"
  /\b(cem|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil)(\s+e\s+\w+)?\s+reais\b/,
  /\ba partir de\s*(r\$)?\s*\d/,
  /\b(custa|sai por|fica em|fica por|em torno de|por volta de|cerca de|na faixa de)\s*(uns\s+)?\d[\d.,]*\s*(reais|mil\b|k\b|por m[eê]s|\/m[eê]s|mensais|,\d{2}\b)/,
  /\b\d{1,2}x\s*de\s*(r\$)?\s*\d/,                                                          // "12x de 250"
  /\bparcelas?\s+de\s*(r\$)?\s*\d/,
  /\b\d{1,3}\s*%\s*(de\s+)?desconto|\bdesconto\s+de\s+\d/,
  /\bplano\s+(essencial|escala|enterprise)\b/,                                              // nome do plano = escolha da call
].map((r) => r.source).join("|"), "i");
// Auto-atendimento do OUTRO lado (visto 23/08: "MAF Imports agradece seu
// contato. Como podemos ajudar? informe os 7 últimos números do chassi"):
// resposta instantânea de loja não é gente — responder vira robô falando com
// robô. Só se aplica à PRIMEIRA resposta da conversa; gente de verdade escrevendo
// depois segue o fluxo normal.
// Lead sinalizou INTERESSE ("sim", "ajudaria", "quero"...): a resposta tem
// que puxar o próximo passo. O prompt já manda, mas prompt não é garantia —
// a trava de beco (motor) emenda a oferta quando a IA esquecer (caso Daniel,
// 23/08: "Opa sim" respondido com afirmação solta matou a conversa).
// Oferta FANTASMA: a IA cita horários "que te passei" sem nunca ter passado
// nenhum (visto 25/08 com o Gabriel, logo depois da retomada — que é template
// SEM horário). Prompt já proíbe; aqui o motor garante, trocando a frase
// mentirosa pela oferta de verdade.
// AFILIADO da Shopee/ML (Leo, 25/08): divulga produto dos outros por comissão,
// não tem conta de vendedor nem anúncio pra clonar — não é cliente. O robô
// marcou call pra uma afiliada e ainda manteve o horário "pro especialista
// avaliar", queimando agenda. Aqui o motor bloqueia: não agenda, desmarca o que
// já estava marcado e chama gente. Sem \b no fim (o \b do JS é ASCII).
const AFFILIATE_RX = /\b(sou|somos|trabalho como|atuo como)\s+(um[ao]?\s+)?afil[ih]ad|afil[ih]ad[ao]s?\s+(d[ao]|na|no)\s+(shopee|mercado\s*livre|ml\b)|programa de afiliad|link de afiliad|divulgo produtos? (de|d[ao]s)/i;
// Dia SOLTO sem hora ("retomar amanhã", "que tal na terça?"): o lead não tem o
// que responder e a conversa gasta mais uma rodada. Se a resposta propõe dia e
// não escreve NENHUMA hora, o motor emenda o par real (visto 25/08, Gabriel).
// Sem \b no fim de propósito: o \b do JavaScript é ASCII, então "amanhã," não
// fecha fronteira e a palavra escapava da checagem.
const DAY_WORD_RX = /\b(hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|essa semana|semana que vem)/i;
const HAS_HOUR_RX = /\b\d{1,2}\s?h(\d{2})?\b|\b\d{1,2}:\d{2}\b/;
// Recusa SECA de horário ("esse horário não consigo"): quando o horário caiu
// depois de a gente oferecer, a resposta tem que pedir desculpa e dizer que
// outro cliente pegou. Sem \b no fim (o \b do JS é ASCII).
const DRY_REFUSAL_RX = /n[ãa]o (consigo|tenho|d[áa]|vai dar)\s*(esse|nesse|este|neste|nesse dia)?\s*hor[áa]ri|esse hor[áa]rio n[ãa]o (consigo|tenho|est[áa]|d[áa]|vai)|hor[áa]rio (j[áa] )?(n[ãa]o est[áa]|ficou) (dispon[íi]vel|livre)/i;
const FAKE_OFFER_RX = /(hor[áa]rios?|op[çc][õo]es)\s+que\s+(eu\s+)?(te\s+)?(passei|mandei|enviei)|algum\s+d(os|aqueles)\s+hor[áa]rios|aqueles\s+hor[áa]rios/i;
const INTEREST_RX = /\b(sim|ajudaria|com certeza|claro|tenho interesse|quero|pode ser|bora|show|top|gostei|perfeito)\b/i;
// ── Ajustes do Leo, 17/09 ───────────────────────────────────────────────────
// OFERTA DE VERDADE ≠ qualquer menção de horário. "Consigo hoje às 14h ou
// amanhã às 9h, qual fica melhor?" é oferta; "agendado então pra amanhã
// (17/09) às 13h", "nossa conversa é hoje às 13h" (lembrete) e "confirmando
// nossa conversa amanhã às 13h" NÃO são. O robô do Renan (16/09) leu o próprio
// lembrete como "horários que te passei" e insistiu numa oferta que nunca fez.
const OFFER_CUE_RX = /consigo|tenho .*(?:livre|dispon)|qual fica melhor|fica bom pra voc|pode ser\?|encaix|op[çc][õo]es/i;
const NOT_OFFER_RX = /nossa conversa|agendad|remarcad|confirmando|est[áa] tudo certo|te espero|come[çc]a em|separou|marcad[oa] (?:ent[ãa]o )?pra/i;
const isOfferMsg = (t) => SLOTS_RX.test(t || "") && OFFER_CUE_RX.test(t || "") && !NOT_OFFER_RX.test(t || "");
// DURAÇÃO INVENTADA: "é uma conversa de 20 minutos" saiu em 9 conversas no
// dia 17/09; a duração é de acordo com a necessidade do lead, então o motor
// tira o número da frase. "Em menos de 5 minutos" (pitch OEM) não é duração
// de conversa e fica de fora pelo lookbehind.
const DURATION_CTX_RX = /conversa|demonstra|reuni[ãa]o|meet|dura/i;
const DURATION_RX = /(?<!menos de )(?<!menos )\b\d{1,3}\s*(?:min|minutos)\b|\bmeia hora\b|\b(?:cerca de |uns |em torno de )?(?:uma|1) hora(?:zinha)?\b/i;
export function stripDuration(text) {
  let t = String(text || "");
  if (!DURATION_CTX_RX.test(t) || !DURATION_RX.test(t)) return t;
  t = t.replace(/\bdura(?:ção)?\s*(?:é\s*)?(?:de\s*)?(?:cerca de |uns |em torno de |mais ou menos |aproximadamente )?(?:\d{1,3}\s*(?:min|minutos)|meia hora|(?:uma|1) hora)\b/gi, "a duração vai de acordo com o que você quiser ver");
  t = t.replace(/(?<!menos)\s+(?:de|com)\s+(?:cerca de |uns |em torno de |mais ou menos |aproximadamente )?(?:\d{1,3}\s*(?:min|minutos)|meia hora|(?:uma|1) hora(?:zinha)?)\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  if (DURATION_RX.test(t)) return ""; // sobrou duração em forma que não dá pra podar: a frase cai
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// CELULAR × COMPUTADOR: nunca perguntar por onde o lead entra; quando ele
// fala em celular, "pode sim" + a recomendação do computador por perto.
const DEVICE_ASK_RX = /(?:pelo\s+)?celular\s+ou\s+(?:pelo\s+)?computador|computador\s+ou\s+(?:pelo\s+)?celular|por onde (?:voc[êe] )?vai entrar/i;
const LEAD_MOBILE_RX = /celular|pelo (?:cel|fone|telefone)\b|no telefone|pelo app/i;
export function stripDeviceAsk(text) {
  return String(text || "").replace(/[^.?!]*(?:(?:pelo\s+)?celular\s+ou\s+(?:pelo\s+)?computador|computador\s+ou\s+(?:pelo\s+)?celular|por onde (?:voc[êe] )?vai entrar)[^.?!]*[.?!]?/gi, "").replace(/\s{2,}/g, " ").trim();
}
// LEAD NEGA A CONVERSA MARCADA ("não tenho call às 13h", "não marquei nada"):
// o card pode estar errado (foi o caso do Renan, 16/09) e quem confere é gente.
const DENY_CALL_RX = /n[ãa]o (?:tenho|marquei|agendei|combinei|sei de|lembro de)\s*(?:nenhuma?|essa|esta|nada|dessa|de|a)?\s*(?:call|conversa|reuni[ãa]o|hor[áa]rio|agendamento|nada)|n[ãa]o sei do que (?:se trata|voc[êe] (?:est[áa]|ta) falando)|n[ãa]o (?:foi|era) (?:eu|comigo)/i;
// DESCOBERTA ANTES DO HORÁRIO: só oferece horário depois que o lead disse que
// a ferramenta ajudaria ou pediu pra agendar. A mensagem automática do form
// ("quero saber mais sobre a LeverAds. Minha operação: ...") não conta: tem
// "quero" mas é o clique do botão, não a pessoa respondendo (Eduardo, 15/09).
const FORM_MSG_RX = /quero saber mais sobre|resumo da minha opera|minha opera[çc][ãa]o:/i;
const SCHEDULE_ASK_RX = /hor[áa]rio|agendar|marcar|agenda\b|dispon[íi]vel|quando|que horas|\bhoje\b|\bamanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|manh[ãa]|tarde|noite|\bvamos\b/i;
const leadEngaged = (msgs) => msgs.some((m) => {
  if (m.direction !== "in") return false;
  const t = String(m.transcript || m.text || "");
  return !FORM_MSG_RX.test(t) && (INTEREST_RX.test(t) || SCHEDULE_ASK_RX.test(t) || HAS_HOUR_RX.test(t));
});
// Pedido de dia/período do lead: aí a oferta pode pular a vaga de hoje.
const PERIOD_ASK_RX = /manh[ãa]|tarde|noite|depois d[ao]s|antes d[ao]s|a partir d[ao]s|semana que vem|outro dia|s[óo] (?:na |no )?(?:segunda|ter[çc]a|quarta|quinta|sexta)/i;
// Só frases que SÓ robô de atendimento escreve. Nada de "esse número é do…" ou
// "clique no link", que gente de verdade também manda ("esse número é do meu
// sócio") — o preço do falso positivo aqui é o robô emudecer com uma pessoa
// falando, e a saída errada já tem a trava de redirecionamento embaixo.
const AUTO_REPLY_RX = /agradece (o |pelo )?(seu )?contato|como podemos (te )?ajudar|atendimento autom|escolha uma (das )?op[çc][õo]es|digite (o n[úu]mero|uma? op[çc][ãa]o)|menu de atendimento|hor[áa]rio de atendimento|consulte (o )?nosso (site|estoque|cat[áa]logo)|informe os? \d+ [úu]ltimos|voc[êe] (contatou|entrou em contato com (a|o|nossa|nosso))|deixe (a )?sua mensagem|responderemos assim que|retornaremos (o |seu |em )|n[ãa]o estamos dispon[íi]veis no momento/i;

// REDIRECIONAMENTO PRA OUTRO CANAL. O robô É o canal: mandar o lead pra outro
// número/link de WhatsApp nunca é resposta certa. Em prod 24/08 (Alexandre) a
// resposta automática do LEAD dizia "aqui é o pós-vendas, para VENDAS clique em
// wa.me/…" e a IA leu aquilo como instrução PRA ELA, devolvendo o lead pro
// número da própria empresa dele. Texto que veio do outro lado é dado, nunca
// ordem — e esta trava é o que garante isso na saída, inclusive quando a IA
// escreve o telefone em vez do link. (Link de reunião não cai aqui: quem manda
// o Meet é o lembrete do sdr-flow, e ele não tem dígito em forma de telefone.)
const REDIRECT_RX = /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send|\b\d{4}[-\s.]?\d{4}\b|\+?55\s?\(?\d{2}\)?\s?9?\d{4}/i;

// O LEAD pedindo preço (≠ PRICE_RX, que pega VALOR dito por nós).
const PRICE_ASK_RX = /pre[çc]o|\bvalor(es)?\b|quanto (custa|fica|sai|é|e)\b|mensalidade|qual o (investimento|custo)|tabela de pre[çc]/i;

const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";

const lastInboundText = (msgs) => {
  const m = [...msgs].reverse().find((x) => x.direction === "in");
  return String(m?.transcript || m?.text || "");
};

// Ponte pro humano quando o lead insiste no preço pela TERCEIRA vez: promete
// gente, nunca número nem "te passo o valor por aqui" (o preço só aparece na
// call, e o alerta que sai junto diz isso pra quem assume).
function priceBridgeText(nome) {
  return `Entendo${nome ? ` ${nome}` : ""}, vou pedir pra alguém do time falar contigo por aqui`;
}

// SEGUNDA vez que o lead pede preço (Leo, 18/09). Nem repetir a parede (foi o
// que fez a lead da RT Eleven encerrar em 24/08), nem gente mandar o valor
// pelo WhatsApp (o remendo depois daquele dia), nem o piso do catálogo (o
// raio-x de 17/09): o robô explica o PORQUÊ com honestidade e puxa pra call,
// que é onde o preço existe. São planos diferentes, e o certo pra cada
// operação sai da escuta das dores.
function priceExplainText(nome, { callAt, slots, slotsOffered, wnow }) {
  const oi = nome ? `Te explico o porquê ${nome}:` : "Te explico o porquê:";
  const motivo = `${oi} a gente tem planos diferentes, e qual faz sentido pra você depende da sua operação. Por isso o valor a gente só fecha na call, depois de ouvir o seu cenário, senão eu te passo um número que não é o seu.`;
  if (callAt) return `${motivo} Na nossa call de ${slotLabelFull(callAt, wnow)} o especialista já te mostra o plano certo e o valor.`;
  if (slotsOffered) return `${motivo} Qual dos horários que te passei fica melhor pra você?`;
  if (slots.length >= 2) return `${motivo} Consigo ${slotLabel(slots[0].at, wnow)} ou ${slotLabel(slots[1].at, wnow)}, qual fica melhor pra você?`;
  if (slots.length === 1) return `${motivo} Consigo ${slotLabel(slots[0].at, wnow)}, fica bom pra você?`;
  return `${motivo} Qual período fica melhor pra você, manhã ou tarde?`;
}

// A resposta é requentada? Compara com o que o robô JÁ mandou nesta conversa,
// sem pontuação/acento: 75% das palavras de conteúdo repetidas é a MESMA frase
// pro lead ("primeiro entendemos o cenário" × "primeiro a gente entende o
// cenário" foi o par que perdeu a lead da RT Eleven em 24/08). O limiar deixa
// passar oferta de horário nova, que compartilha o esqueleto mas troca os dados
// ("consigo amanhã às 10h ou às 14h" × "consigo hoje às 17h ou às 19h").
const bag = (s) => new Set(String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
export function sameSentence(a, b) {
  const A = bag(a), B = bag(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size) >= 0.75;
}
// Confirmação curta ("Perfeito", "Combinado", "Isso") PODE repetir: é assim que
// gente fala. A trava é pra frase de conteúdo — pitch, deflexão, convite.
const alreadySaid = (text, msgs) => bag(text).size >= 4 && msgs.some((m) =>
  m.direction === "out" && m.author === SDR_AUTHOR && sameSentence(text, m.text));

// "sexta, 22/08, 10h32 (hora de Brasília)" — o relógio que a IA enxerga.
const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function nowLabelOf(wnow) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${WEEKDAYS[wnow.getUTCDay()]}, ${p2(wnow.getUTCDate())}/${p2(wnow.getUTCMonth() + 1)}, ${wnow.getUTCHours()}h${p2(wnow.getUTCMinutes())} (hora de Brasília)`;
}

// Resposta OFICIAL de preço (copy do Leo, 23/08) — o texto que entra no lugar
// de QUALQUER resposta da IA que tenha citado valor. Sem horário junto: a
// re-oferta de agenda colada no preço soava insistente.
function priceDeferral(nome) {
  const oi = nome ? `${nome}, o` : "O";
  return `${oi} investimento é de acordo com as necessidades da sua operação: primeiro a gente entende o seu cenário, e aí te mostra os pontos que dá pra alavancar. É exatamente isso que o especialista faz na demonstração.`;
}

// Confirmação de agendamento ENXUTA (Leo, 23/08), na letra da Manuela
// (minerado ago/2026: "Certinho, agendado então para amanhã 15:30h", vocativo
// sem vírgula, "te chamo aqui"): combinado por escrito + aviso do convite por
// e-mail (SÓ quando o card tem e-mail, senão vira promessa falsa e o link
// chega pelo lembrete de 10min) + sócio/decisor + aviso de lembrete. Sem
// re-descrever a demonstração e sem pedir e-mail.
function bookingConfirmText(nome, quando, hasEmail) {
  const convite = hasEmail ? ", o convite vai chegar no seu e-mail" : "";
  return `Perfeito${nome ? ` ${nome}` : ""}, agendado então pra ${quando}${convite}. Se tiver sócio ou alguém que decida junto, chama junto que rende mais. Te chamo aqui um pouco antes com o lembrete!`;
}

// Remarcação: confirmação CURTA (a íntegra com sócio+lembrete já foi dita na
// marcação; repetir palavra por palavra soa robô — Gilberto, 23/08). "Convite
// atualizado" só quando o convite existe de verdade (o moveCallMeet PATCHa o
// evento e o Google manda o e-mail de atualização).
function rebookConfirmText(nome, quando, conviteAtualizado) {
  return `Perfeito${nome ? ` ${nome}` : ""}, remarcado então pra ${quando}${conviteAtualizado ? ", o convite atualizado vai chegar no seu e-mail" : ""}!`;
}

// Desmarcação a pedido do lead: confirma que o compromisso SAIU da agenda e já
// abre a porta da remarcação com horários reais (Leo, 24/08: o robô aceitou o
// cancelamento mas deixou a call de pé — o lembrete de 1h disparou depois — e
// não sugeriu reagendar). Oferta leve, sem cobrança: o lead acabou de cancelar.
function cancelConfirmText(nome, slots, wnow) {
  const oi = `Tranquilo${nome ? ` ${nome}` : ""}, sem problemas, já desmarquei aqui`;
  if (slots.length >= 2) return [oi, `Quer que eu já deixe outro horário reservado? Consigo ${slotLabel(slots[0].at, wnow)} ou ${slotLabel(slots[1].at, wnow)}, qual fica melhor pra você?`];
  if (slots.length === 1) return [oi, `Quer que eu já deixe outro horário reservado? Consigo ${slotLabel(slots[0].at, wnow)}, fica bom pra você?`];
  return [oi, "Quando quiser remarcar me chama aqui que eu vejo os horários pra você"];
}

// Horário que a gente OFERECEU e o lead escolheu, mas foi preenchido no meio do
// caminho (Leo, 25/08): a culpa é da nossa agenda, não dele. Então pede
// desculpa e diz o que houve de verdade — "não consigo" seco depois de ter
// oferecido soa descaso.
function reofferText(nome, slots, wnow) {
  const oi = nome ? `Ahh ${nome}, ` : "Ahh, ";
  const desculpa = `${oi}esse horário acabou de ser preenchido por outro cliente, me desculpa!`;
  if (slots.length >= 2) return `${desculpa} Consigo ${slotLabel(slots[0].at, wnow)} ou ${slotLabel(slots[1].at, wnow)}, qual fica melhor pra você?`;
  if (slots.length === 1) return `${desculpa} Consigo ${slotLabel(slots[0].at, wnow)}, fica bom pra você?`;
  return "Não tenho horário disponível nesse dia. Qual outra data fica melhor pra você?";
}

// Marca (ou remarca) a call pelo MESMO caminho do PATCH da API: applyStageMove
// no movimento de etapa, callHistory quando o horário antigo já passou, GPS no
// compromisso e callConfirmed zerado (a confirmação é do horário novo).
export async function bookCall(repo, { lead, product, at, closer, author = SDR_AUTHOR, now = new Date() }) {
  const target = stageByKind(product, "call");
  if (!target) throw new Error("funil sem etapa de call");
  // QUANDO a marcação foi feita. É o que deixa o lembrete de véspera saber que
  // o combinado é fresco: marcou "amanhã às 14h" agora às 13h55 e a véspera
  // (24h antes) cairia 5 minutos depois — confirmação de algo que acabou de ser
  // combinado (sdr-flow.js, VESPERA_MIN_GAP_MS).
  const patchExtra = { callConfirmed: false, callSetAt: new Date(now).toISOString() };
  const oldAt = String(lead.callAt || "");
  if (oldAt && oldAt !== at) {
    const oldT = Date.parse(brtToIso(oldAt));
    const hist = Array.isArray(lead.callHistory) ? lead.callHistory : [];
    if (Number.isFinite(oldT) && oldT < now.getTime() && !hist.some((h) => String(h?.at || "") === oldAt)) {
      patchExtra.callHistory = [...hist, { at: oldAt, closer: lead.closer || "" }].slice(-60);
    }
  }
  let moved = {};
  if (lead.stage !== target.stage) {
    moved = await applyStageMove(repo, { lead, toStage: target.stage, patch: { callAt: at, closer }, author, now });
    moved.stage = target.stage;
  } else {
    moved.nextActionAt = brtToIso(at); // remarcação na mesma etapa: GPS segue o compromisso
  }
  return repo.update("leads", lead.id, { ...patchExtra, ...moved, callAt: at, closer });
}

// DESMARCA a call sem horário novo pelo caminho canônico: o card volta pra
// qualificação (etapa de call sem callAt é card fantasma — Agenda, slot do
// closer e lembretes do sdr-flow leem callAt), a confirmação zera e horário
// antigo que JÁ passou vira histórico, igual ao PATCH da API.
export async function cancelCall(repo, { lead, product, author = SDR_AUTHOR, now = new Date() }) {
  const patchExtra = { callAt: "", callConfirmed: false };
  const oldAt = String(lead.callAt || "");
  if (oldAt) {
    const oldT = Date.parse(brtToIso(oldAt));
    const hist = Array.isArray(lead.callHistory) ? lead.callHistory : [];
    if (Number.isFinite(oldT) && oldT < now.getTime() && !hist.some((h) => String(h?.at || "") === oldAt)) {
      patchExtra.callHistory = [...hist, { at: oldAt, closer: lead.closer || "" }].slice(-60);
    }
  }
  const target = stageByKind(product, "qualificacao") || stageByKind(product, "contato") || { stage: firstStage(product) };
  let moved = {};
  if (target.stage && lead.stage !== target.stage) {
    moved = await applyStageMove(repo, { lead, toStage: target.stage, patch: patchExtra, author, now });
    moved.stage = target.stage;
  }
  return repo.update("leads", lead.id, { ...patchExtra, ...moved });
}

export function makeSdrBrain({ repo, whatsapp: wa, anthropic, autoCallMeet = null, cancelCallMeet = null, transcriber = defaultTranscriber, log = console, now = () => new Date(), replyDelayMs = 6000, partDelayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // ÁUDIO do lead: 13% das mensagens recebidas (mineração) — sem isso, todo
  // áudio viraria handoff. Transcreve a nota de voz (cache wa_media primeiro,
  // Graph depois) e grava o texto NA mensagem (campo transcript), então a
  // conversa inteira fica legível pra IA nas próximas decisões também.
  // Falhou/não configurado: segue como "🎤 áudio" e o prompt manda pra humano.
  async function transcriptOf(m, lead) {
    if (m.transcript) return m.transcript;
    if (m.media?.kind !== "audio" || !transcriber?.configured?.()) return "";
    try {
      let buf = null, mime = m.media.mime || "audio/ogg";
      const cached = await repo.get("wa_media", m.id).catch(() => null);
      if (cached?.data) { buf = Buffer.from(cached.data, "base64"); mime = cached.mime || mime; }
      else if (wa?.fetchMedia && m.media.id) {
        ({ buf, mime } = await wa.fetchMedia(m.media.id));
        if (buf && buf.length <= 16 * 1024 * 1024) {
          try { await repo.create("wa_media", { id: m.id, mime, size: buf.length, data: buf.toString("base64"), at: new Date().toISOString() }); }
          catch { /* cache é bônus */ }
        }
      }
      if (!buf || buf.length < 1024 || buf.length > 25 * 1024 * 1024) return "";
      const text = await transcriber.transcribe(buf, {
        filename: `wa-${m.id}.ogg`, mime,
        prompt: ["LeverAds", lead?.name, lead?.company].filter(Boolean).join(", "),
      });
      if (text) await repo.update("wa_messages", m.id, { transcript: text }).catch(() => {});
      return text || "";
    } catch (err) {
      log.warn?.({ msg: m.id, err: err.message }, "sdr-brain: transcrição do áudio falhou");
      return "";
    }
  }

  async function sendBot({ phone, text, phoneId, saas, leadId }) {
    const { messageId } = await wa.sendText(phone, text, { phoneId });
    await recordMessage(repo, { id: messageId, phone, direction: "out", text, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas, leadId });
    // Resposta do robô na conversa = lead sendo qualificado (novo/contato →
    // qualificação; estágios de closer, No show e ganho ficam onde estão).
    await onOutboundMessage(repo, leadId, { author: SDR_AUTHOR, text: "conversa com o SDR" });
    return messageId;
  }

  // Merge em cima do sdrLog FRESCO do banco (17/09): dois carimbos na mesma
  // decisão (handoffAt e depois firstTouchAt na 1ª resposta) sobrescreviam um
  // ao outro quando partiam do objeto local, já velho.
  const stamp = async (lead, patch) => {
    const cur = (await repo.get("leads", lead.id).catch(() => null))?.sdrLog || lead.sdrLog || {};
    const sdrLog = { ...cur, ...patch };
    lead.sdrLog = sdrLog;
    return repo.update("leads", lead.id, { sdrLog });
  };

  // ── Walk-in: conversa SEM lead ──────────────────────────────────────────
  // Contato que chegou direto no número (sem passar pelo form) não tinha card,
  // então o robô ficava mudo (caso José Larino, 23/08). Agora o robô ADOTA:
  // cria o lead, vincula a conversa e atende normal. A mensagem pronta do form
  // ("me chamo X ... segmento - Y, contas - Z, anúncios - W") vira cadastro
  // preenchido; os RÓTULOS viram os values do painel via product.leadQuestions.
  function parseFormPrefill(text, product) {
    const t = String(text || "");
    const out = {};
    const nome = t.match(/me chamo\s+(.{2,60}?)(?:\s+e\s+quero\b|[.,\n]|$)/i);
    if (nome) out.name = nome[1].trim();
    const byLabel = (key, raw) => {
      const q = (product?.leadQuestions || []).find((x) => x.key === key);
      const hit = (q?.options || []).find((o) => String(o.label || "").toLowerCase() === String(raw || "").trim().toLowerCase());
      return hit ? hit.value : "";
    };
    const seg = t.match(/segmento\s*[-:]\s*([^,\n]+)/i);
    if (seg) out.niche = byLabel("niche", seg[1]) || seg[1].trim().toLowerCase();
    const contas = t.match(/contas no ML\/Shopee\s*[-:]\s*([^,\n]+)/i);
    if (contas) out.accounts = byLabel("accounts", contas[1]);
    const an = t.match(/an[úu]ncios na maior conta\s*[-:]\s*([^,.\n]+)/i);
    if (an) out.listings = byLabel("listings", an[1]);
    if (seg || contas) out.vende_marketplace = "sim"; // veio do fluxo do form
    return out;
  }

  async function adoptWalkIn({ thread, product, message }) {
    const phone = digits(thread.phone || thread.id);
    if (!phone) return null;
    // Cliente da casa escrevendo no comercial não é lead novo: fica pro time.
    const customers = await repo.list("customers").catch(() => []);
    if (customers.some((c) => c.phone && waMatchKey(c.phone) === waMatchKey(phone))) return null;
    // Corrida/duplicata: se um lead com esse número já existe, só vincula.
    const existing = await findLeadByPhone(repo, phone);
    if (existing) { await linkThreadToLead(repo, thread.id, existing); return existing; }
    const parsed = parseFormPrefill(message?.text || thread.lastText || "", product);
    const stage = firstStage(product);
    const nowIso = new Date().toISOString();
    const lead = await repo.create("leads", {
      saas: product.id,
      owner: (await autoLeadOwner(repo, product.id)) || "",
      name: parsed.name || thread.name || "",
      nome: parsed.name || thread.name || "",
      phone, whatsapp: phone,
      stage, stageSince: nowIso, createdAt: nowIso,
      priority: "P2", source: "WhatsApp · chegou direto",
      nextActionAt: initialNextActionAt(product, stage) || "",
      ...(parsed.niche ? { niche: parsed.niche } : {}),
      ...(parsed.accounts ? { accounts: parsed.accounts } : {}),
      ...(parsed.listings ? { listings: parsed.listings } : {}),
      ...(parsed.vende_marketplace ? { vende_marketplace: parsed.vende_marketplace } : {}),
    });
    await linkThreadToLead(repo, thread.id, lead);
    await logActivity(repo, { saas: product.id, lead: lead.id, type: "system", text: "Lead criado pelo SDR automático (conversa sem cadastro no WhatsApp)" }).catch(() => {});
    log.info?.({ lead: lead.id, phone }, "sdr-brain: walk-in adotado");
    return lead;
  }

  // Uma mensagem recebida → uma decisão aplicada. Devolve a ação executada (ou
  // null quando o gate segurou). NUNCA lança: falha vira log + alerta espaçado.
  //
  // CARIMBO DA DECISÃO (16/09): toda mensagem tratada deixa em thread.brain o
  // id dela e a ação tomada (inclusive silêncio e gate). É o que permite à
  // varredura (resumeStalled) saber que uma mensagem recebida ficou SEM
  // decisão — o caso do processo reiniciando no meio do debounce/IA/atraso, em
  // que a resposta morria com ele sem alerta nenhum (Vinicius, 16/09 22:06).
  // `resumed` = disparo da varredura: sem debounce (o lead já esperou).
  // Mensagem em tratamento neste processo (IA lenta passando dos 90s da
  // varredura): o segundo disparo pra ela é ignorado, senão sairiam duas
  // respostas. Reinício zera o conjunto — aí a varredura é quem entra.
  const inflight = new Set();
  // USO DA IA POR DIA (17/09): até aqui o robô recebia model/usage de cada
  // decisão e jogava fora, então ninguém sabia quanto custava nem qual modelo
  // respondeu. Um doc por produto e dia em app_config (sdr_ai_usage_<saas>_<dia>)
  // soma chamadas, tokens e latência por modelo. Best-effort: contagem nunca
  // derruba a resposta.
  async function bumpAiUsage(saas, meta) {
    if (!saas || !meta?.model) return;
    const day = now().toISOString().slice(0, 10);
    const id = `sdr_ai_usage_${saas}_${day}`;
    const u = meta.usage || {};
    const add = (a = {}) => ({
      calls: (a.calls || 0) + 1, in: (a.in || 0) + (u.in || 0), out: (a.out || 0) + (u.out || 0),
      cacheRead: (a.cacheRead || 0) + (u.cacheRead || 0), cacheWrite: (a.cacheWrite || 0) + (u.cacheWrite || 0),
      ms: (a.ms || 0) + (meta.ms || 0),
    });
    const cur = await repo.get("app_config", id).catch(() => null);
    const next = { ...(cur || { id, saas, day }), ...add(cur || {}), byModel: { ...(cur?.byModel || {}), [meta.model]: add(cur?.byModel?.[meta.model] || {}) } };
    if (cur) await repo.update("app_config", id, next); else await repo.create("app_config", next);
  }

  async function handleInbound({ message, resumed = false } = {}) {
    if (message?.id && inflight.has(message.id)) return "inflight";
    if (message?.id) inflight.add(message.id);
    let action;
    const meta = {}; // model/usage/ms da decisão, preenchido pelo decide
    try {
      action = await decide({ message, resumed, meta });
    } catch (err) {
      log.warn?.({ err: err.message }, "sdr-brain falhou");
      try {
        const thread = await findThreadByPhone(repo, message?.from || "");
        const lead = thread?.leadId ? await repo.get("leads", thread.leadId) : null;
        if (thread && lead && !(lead.sdrLog?.brainErrorAlertAt && Date.now() - Date.parse(lead.sdrLog.brainErrorAlertAt) < 6 * HOUR)) {
          await raiseAlert(repo, thread, { text: "IA do SDR falhou nesta conversa · responde na mão" });
          await stamp(lead, { brainErrorAlertAt: new Date().toISOString() });
        }
      } catch { /* alerta é best-effort */ }
      action = "error";
    }
    // "superseded" não carimba: a decisão desta mensagem é do disparo mais
    // novo, e é ELE quem carimba (se morrer no caminho, a varredura o retoma).
    if (message?.id && action !== "superseded") {
      try {
        const thread = await findThreadByPhone(repo, message.from || "");
        if (thread) await repo.update("wa_threads", thread.id, { brain: { msgId: message.id, action: action || "gate", at: now().toISOString(), ...(meta.model ? { model: meta.model, usage: meta.usage || null, ms: meta.ms || 0 } : {}), ...(meta.slots ? { slots: meta.slots, pair: meta.pair } : {}) } });
        if (meta.model) await bumpAiUsage(thread?.saas || meta.saas || "", meta);
      } catch { /* carimbo é best-effort: sem ele a varredura só tenta de novo */ }
    }
    if (message?.id) inflight.delete(message.id);
    return action;
  }

  // VARREDURA DE MENSAGEM SEM DECISÃO. Conversa cuja última mensagem é do lead
  // (lastDir=in), recebida há mais que o tempo normal de resposta e há menos
  // que `maxAgeMs`, e cujo carimbo (thread.brain.msgId) NÃO é essa mensagem:
  // o disparo do webhook morreu no meio (deploy/crash) e ninguém respondeu.
  // Chama o mesmo handleInbound, sem debounce; todos os gates valem igual
  // (humano ativo, handoff, teto, elegibilidade), então retomar nunca fala por
  // cima de gente. Poucas por ciclo: retomada é conserto, não rajada.
  async function resumeStalled({ minAgeMs = 90_000, maxAgeMs = 2 * HOUR, limit = 5 } = {}) {
    const nowMs = now().getTime();
    const threads = await repo.listWhere("wa_threads", { lastDir: "in", lastAt: { gte: new Date(nowMs - maxAgeMs).toISOString() } });
    const stalled = threads.filter((t) => {
      const age = nowMs - (Date.parse(t.lastAt || "") || 0);
      if (!(age >= minAgeMs && age <= maxAgeMs)) return false;
      if (!t.lastInId) return false; // thread antiga sem o id: fica pro webhook
      return t.brain?.msgId !== t.lastInId;
    }).sort((a, b) => String(a.lastAt || "").localeCompare(String(b.lastAt || ""))).slice(0, limit);
    const done = [];
    for (const t of stalled) {
      const action = await handleInbound({ message: { from: t.phone || t.id, text: t.lastText || "", id: t.lastInId }, resumed: true });
      log.info?.({ thread: t.id, msg: t.lastInId, action }, "sdr-brain: mensagem sem decisão retomada");
      done.push({ thread: t.id, action });
    }
    return done;
  }

  async function decide({ message, resumed = false, meta = {} }) {
    const at = now();
    const thread = await findThreadByPhone(repo, message?.from || "");
    if (!thread) return null;
    // Sem lead ainda? Walk-in: segue até depois do debounce/auto-reply e adota.
    let lead = thread.leadId ? await repo.get("leads", thread.leadId) : null;
    if (thread.leadId && !lead) return null;
    const saas = lead?.saas || thread.saas || "";
    const product = saas ? await repo.get("products", saas) : null;
    const cfg = sdrBotConfig(product);
    // Modo normal: chave conversation + lead real. Modo teste: chave
    // conversationTest + lead INTERNO (a experiência completa no WhatsApp do
    // time, sem tocar lead de verdade).
    if (!conversationActive(cfg, lead)) return null;
    if (!anthropic?.configured?.()) return null;

    // Elegibilidade — as mesmas cercas da Fase 1 + região do funil. Walk-in
    // (sem lead) pula as cercas: o card nasce limpo logo adiante.
    if (lead) {
      if (lead.formExit || lead.disqualified) return null;
      if (lead.whatsappOptOut || lead.whatsappInvalid) return null;
      // Botão "parar robô" do inbox (lead.sdrOff): a conversa é 100% humana.
      if (lead.sdrOff) return null;
      if (isWonLead(product, lead)) return null;
      const kind = kindOf(product, lead.stage || firstStage(product));
      if (!BRAIN_KINDS.has(kind)) return null;
    }

    // DEBOUNCE DE RAJADA (Leo, 23/08): espera o lead terminar de digitar. Ao
    // acordar, se chegou mensagem MAIS NOVA que a que disparou esta decisão,
    // aborta — o disparo da última mensagem é quem responde, lendo a rajada
    // inteira e compilando um retorno só.
    if (cfg.debounceSec > 0 && !resumed) await sleep(cfg.debounceSec * 1000);
    const msgs = await listMessages(repo, thread.id);
    if (message?.id) {
      const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
      if (lastIn && lastIn.id !== message.id) return "superseded";
    }
    // Resposta automática de estabelecimento (menu, "você contatou o pós-vendas",
    // "deixe sua mensagem") não é a pessoa falando: responder vira robô
    // conversando com robô. Vale em QUALQUER posição da conversa (Leo, 24/08 —
    // antes só a 1ª mensagem era filtrada, e a de mercado/pós-venda que chega no
    // meio passava direto). O alerta de lead quente do inbox continua valendo.
    {
      const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
      if (lastIn && AUTO_REPLY_RX.test(lastIn.text || "")) return "auto-reply";
    }
    // Walk-in: adota AGORA (depois do debounce, do supersede e do filtro de
    // auto-reply — rajada não duplica card e robô de loja não vira lead).
    if (!lead) {
      const t2 = await findThreadByPhone(repo, message?.from || "");
      lead = t2?.leadId ? await repo.get("leads", t2.leadId) : null;
      if (!lead) lead = await adoptWalkIn({ thread, product, message });
      if (!lead) return null;
    }
    // O lead pode ter chegado agora (walk-in/vínculo pelo telefone): o botão
    // "parar robô" vale pra ele também.
    if (lead.sdrOff) return "off";
    const humanIds = new Set((await repo.list("users")).map((u) => u.id));
    const nowMs = at.getTime();
    const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
    // Gente falou há pouco: a conversa é dela. Handoff pendente (sem humano
    // depois dele): o robô segue calado esperando gente assumir.
    if (lastHumanOut && nowMs - Date.parse(lastHumanOut.at || 0) < HUMAN_MUTE_MS) return "human-active";
    const handoffAt = lead.sdrLog?.handoffAt ? Date.parse(lead.sdrLog.handoffAt) : 0;
    if (handoffAt && !(lastHumanOut && Date.parse(lastHumanOut.at || 0) > handoffAt)) return "waiting-human";
    // Teto diário por conversa: rajada nunca vira metralhadora.
    const botToday = msgs.filter((m) => m.direction === "out" && m.author === SDR_AUTHOR && nowMs - Date.parse(m.at || 0) < 24 * HOUR).length;
    if (botToday >= DAILY_CAP) {
      if (lead.sdrLog?.capAlertAt !== lead.callAt || !lead.sdrLog?.capAlertAt) {
        await raiseAlert(repo, thread, { text: "Conversa longa com o robô (teto do dia) · assume aí" });
        await stamp(lead, { capAlertAt: new Date(nowMs).toISOString(), handoffAt: new Date(nowMs).toISOString() });
      }
      return "cap";
    }

    const phoneId = thread.waPhoneId || product.waPhoneId || undefined;
    const to = thread.phone || digits(lead.waPhone || lead.phone);
    // "Digitando…" enquanto a IA pensa (o visto azul vai junto): humano de
    // verdade lê e digita. Best-effort; re-disparado entre as partes.
    const typing = () => { if (message?.id && wa.sendTyping) wa.sendTyping(message.id, { phoneId }).catch(() => {}); };
    typing();

    // Nota de voz que disparou a decisão vira texto (as antigas já carregam o
    // transcript gravado); sem transcrição possível, fica "🎤 áudio" e o
    // prompt manda pra humano.
    const lastIn = [...msgs].reverse().find((x) => x.direction === "in");
    if (lastIn && lastIn.media?.kind === "audio" && !lastIn.transcript) {
      const t = await transcriptOf(lastIn, lead);
      if (t) lastIn.transcript = t;
    }
    // Contexto pra decisão: agenda real + conversa + relógio BRT.
    const wnow = wallNow(at);
    // Horário que OUTRO lead está decidindo agora sai da oferta: era o que fazia
    // o robô oferecer "amanhã às 10h" e, na resposta do lead 27 minutos depois,
    // negar o próprio horário (prod 24/08, Guilherme). Ver agenda-slots.js.
    const holds = await activeHolds(repo, product.id, { now: at }).catch(() => []);
    const { slots, requested: requestedDate, startDate: offerDate } = await sdrSlotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 0, messages: msgs, holds });
    const slotList = slots.map((s) => ({ ...s, label: slotLabel(s.at, wnow) }));
    // A OFERTA sai só de hora cheia; slotList inteiro (com as quebradas) segue
    // valendo pra AGENDAR quando o lead pede um horário específico.
    const offerPool = wholeHourSlots(slotList);
    const suggestedPair = spreadPair(offerPool);
    // A resposta automática entra na conversa SEM O CONTEÚDO: só o rótulo. O
    // texto de um menu automático costuma vir em forma de ordem ("clique no
    // link", "digite 1", "para vendas chame o outro número") e a IA obedecia
    // como se a ordem fosse pra ela (prod 24/08, Alexandre). Ela precisa saber
    // que a máquina do outro lado respondeu; não precisa ler o que a máquina
    // mandou fazer.
    const conversation = msgs.slice(-24).map((m) => ({
      who: m.direction === "in" ? "LEAD" : "VOCÊ",
      text: m.direction === "in" && AUTO_REPLY_RX.test(m.text || "")
        ? "[resposta automática do estabelecimento, não é a pessoa falando]"
        : String(m.transcript ? `[áudio] ${m.transcript}` : (m.text || "")).slice(0, 500) || "[mensagem]",
    }));
    // Saudação só em conversa FRIA: gap desde a mensagem ANTERIOR à que
    // disparou esta decisão. Menos de 6h = em andamento, sem "Oi" de novo.
    const prevMsg = msgs.length >= 2 ? msgs[msgs.length - 2] : null;
    const gapMin = prevMsg ? Math.round((nowMs - Date.parse(prevMsg.at || 0)) / 60_000) : null;
    const canGreet = gapMin == null || gapMin >= GREETING_GAP_MS / 60_000;
    const demoOffered = msgs.some((m) => m.direction === "out" && (DEMO_RX.test(m.text || "") || PITCH_RX.test(m.text || "")));
    const slotsOffered = msgs.some((m) => m.direction === "out" && isOfferMsg(m.text || ""));
    // Última fala do lead (áudio já transcrito acima) e se ele já ENGAJOU
    // (respondeu positivo à descoberta ou pediu horário): antes disso, nada de
    // horário na resposta (Leo, 17/09).
    const lastInText = lastInboundText(msgs);
    const engaged = leadEngaged(msgs);
    // O que a agenda tinha na hora da decisão vai pro carimbo da thread
    // (thread.brain): sem isso, "por que ofereceu amanhã?" não tem resposta.
    Object.assign(meta, { slots: slotList.slice(0, 3).map((s) => s.label), pair: suggestedPair.map((s) => s.label) });
    // Lead escreveu ANTES de qualquer mensagem nossa (o clique do form chega
    // antes do 1º toque): a primeira resposta é DESCOBERTA, com a pergunta do
    // template ("isso ajudaria na sua operação?"), nunca oferta de horário
    // (Leo, 23/08). O horário entra só depois que o lead responder.
    const firstReply = !msgs.some((m) => m.direction === "out");
    // Nome do form passa pela higiene (greetName): "Oi PECAS", "Oiii GMS" e
    // "Perfeito PEDRO" saíram em prod 24/08. Sem nome utilizável, "" — e os
    // textos caem no fallback sem nome, que soa natural.
    const nome = greetName(lead.name);
    const decision = await anthropic.sdrDecide({
      sdrName: firstName((await repo.get("users", lead.owner).catch(() => null))?.name),
      lead: { name: nome, company: lead.company, email: lead.email, niche: lead.niche },
      digest: leadDigest(product, lead),
      grade: leadGrade(lead) || "",
      stage: lead.stage || firstStage(product),
      callAt: lead.callAt || "",
      nowLabel: nowLabelOf(wnow),
      slots: slotList,
      conversation,
      pain: leadPainFocus(product, lead),
      canGreet,
      gapMin,
      demoOffered,
      slotsOffered,
      firstReply,
      engaged,
      suggestedPair,
      requestedDate,
      offerDate,
    });
    // Quem respondeu e quanto custou: vai pro carimbo da thread e pro uso do dia.
    Object.assign(meta, { model: decision.model || "", usage: decision.usage || null, ms: decision.ms || 0, saas: product.id });

    // Envio em PARTES, como gente digitando (Leo, 23/08): a 1ª mensagem sai
    // depois do atraso de resposta; as seguintes com 5s entre cada uma.
    //
    // ABORTO NO MEIO DO CAMINHO (Leo, 24/08): entre o atraso da 1ª parte e o
    // envio da última passam ~15s, e o lead escreve nesse intervalo. A resposta
    // já em voo então cruzava com a mensagem nova e a conversa desencontrava
    // (prod 24/08, Amilton: o robô perguntou "conseguiu acessar o link?" e 24s
    // depois respondeu "tranquilo, imprevistos acontecem" à mensagem anterior).
    // Antes de cada parte o motor confere se ainda é o turno dele; chegou coisa
    // nova, o resto da fala é descartado e o próximo disparo responde a rajada
    // inteira, com contexto completo.
    const stillMyTurn = async () => {
      if (!message?.id) return true;
      const fresh = await listMessages(repo, thread.id).catch(() => null);
      if (!fresh) return true;
      const lastIn = [...fresh].reverse().find((m) => m.direction === "in");
      if (lastIn && lastIn.id !== message.id) return false;
      // Gente escreveu na conversa depois que esta decisão começou (Eduardo,
      // 15/09: a SDR deu "bom dia" entre a 1ª e a 2ª parte do robô, e o robô
      // seguiu falando por cima): o resto da fala é dela.
      return !fresh.some((m) => m.direction === "out" && humanIds.has(m.author) && Date.parse(m.at || 0) > nowMs);
    };
    let aborted = false;
    // 1º TOQUE PELA IA (raio-x 17/09): quando o lead escreve primeiro (clique do
    // form) a resposta da IA É o primeiro toque, mas nada carimbava
    // sdrLog.firstTouchAt. Sem o carimbo, 355 dos 536 leads novos ficavam fora
    // do 2º toque de 24h (seção 1b) e do passe barato da escada (1c): 98 dos
    // 152 sem resposta nunca receberam retomada. Carimba na primeira mensagem
    // do robô nesta conversa; via "brain" não dispara o alerta quente do
    // handleSdrInbound (a conversa com IA já cuida da resposta).
    const firstBotReply = !msgs.some((m) => m.direction === "out" && m.author === SDR_AUTHOR);
    const send = async (textOrParts) => {
      const parts = (Array.isArray(textOrParts) ? textOrParts : [textOrParts])
        .map((t) => String(t || "").trim()).filter(Boolean).slice(0, 3);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) typing(); // o envio anterior derruba o indicador: reacende
        await sleep(i === 0 ? replyDelayMs : partDelayMs);
        if (!(await stillMyTurn())) { aborted = true; return; }
        await sendBot({ phone: to, text: parts[i].slice(0, 900), phoneId, saas: product.id, leadId: lead.id });
        if (i === 0 && firstBotReply && !lead.sdrLog?.firstTouchAt) {
          const stampAt = new Date(nowMs).toISOString();
          await stamp(lead, { firstTouchAt: stampAt, firstTouchVia: "brain" }).catch(() => {});
          lead.sdrLog = { ...(lead.sdrLog || {}), firstTouchAt: stampAt, firstTouchVia: "brain" };
        }
      }
    };

    // E-mail capturado na mensagem entra no cadastro (o convite do Meet usa).
    if (decision.email && /.+@.+\..+/.test(decision.email) && !lead.email) {
      try { await repo.update("leads", lead.id, { email: decision.email.trim() }); lead.email = decision.email.trim(); } catch { /* best-effort */ }
    }

    // LEAD NEGA A CONVERSA MARCADA (Leo, 17/09): com call no card e o lead
    // dizendo que não tem/não marcou, o card pode estar errado (Renan, 16/09:
    // callAt em UTC, lembrete disse 13h pra uma call das 10h). Gente confere;
    // o robô só avisa que vai confirmar. Vale seja qual for a ação da IA.
    if (lead.callAt && DENY_CALL_RX.test(lastInText)) {
      await raiseAlert(repo, thread, { text: `Lead nega a conversa marcada (${slotLabelFull(lead.callAt, wnow)}) · confere o card e responde: "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString(), denyCallGuardAt: new Date(nowMs).toISOString() });
      await send(`${nome ? `${nome}, d` : "D"}eixa eu confirmar aqui com o especialista e já te retorno`);
      return "nega-call-humano";
    }

    if (decision.acao === "silencio") return "silencio";

    // ESCADA DE PREÇO (Leo, 18/09), determinística e na frente da ação da IA:
    //   1ª vez  → a IA desvia com a resposta oficial (a trava PRICE_RX embaixo
    //             garante que nenhum número passe);
    //   2ª vez  → o motor explica o porquê (planos diferentes, o certo sai da
    //             call) e puxa pra call;
    //   3ª vez+ → gente assume, com o alerta dizendo que PREÇO SÓ NA CALL.
    // Lead escolhendo horário tem prioridade: agendar/remarcar/desmarcar seguem.
    const askingNow = PRICE_ASK_RX.test(lastInboundText(msgs));
    const priceAsks = msgs.filter((m) => m.direction === "in" && PRICE_ASK_RX.test(m.transcript || m.text || "")).length;
    const insisting = priceAsks >= 2 || (lead.sdrLog?.priceGuardAt && askingNow);
    if (insisting && !["agendar", "remarcar", "desmarcar"].includes(decision.acao)) {
      const iso = new Date(nowMs).toISOString();
      if (!lead.sdrLog?.priceExplainedAt) {
        await send(priceExplainText(nome, { callAt: lead.callAt, slots: suggestedPair.length ? suggestedPair : offerPool.slice(0, 1), slotsOffered, wnow }));
        await stamp(lead, { priceGuardAt: lead.sdrLog?.priceGuardAt || iso, priceExplainedAt: iso });
        return "preco-explicado";
      }
      await raiseAlert(repo, thread, { text: `Insistiu no preço ${priceAsks}x · assume a conversa, mas PREÇO SÓ NA CALL (planos diferentes, o certo sai da escuta das dores): não fala valor por aqui, leva pra call: "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: iso, priceHandoffAt: iso });
      await send(priceBridgeText(nome));
      return "preco-humano";
    }

    if (decision.acao === "humano") {
      await raiseAlert(repo, thread, { text: `SDR IA pediu humano: ${decision.motivoHumano || "precisa de gente"} · "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString() });
      const transition = ((Array.isArray(decision.mensagens) && decision.mensagens[0]) || String(decision.mensagem || "")).trim();
      if (transition && !PRICE_RX.test(transition) && transition.length <= 240) await send(transition);
      return "humano";
    }

    // TRAVA DE AFILIADO: o lead disse que é afiliado em QUALQUER mensagem desta
    // conversa → nada de agendar. Call já marcada é desmarcada (libera o slot),
    // o time recebe alerta e o robô sai da conversa.
    const disseAfiliado = msgs.some((m) => m.direction === "in" && AFFILIATE_RX.test(m.transcript || m.text || ""));
    if (disseAfiliado && !lead.sdrLog?.affiliateGuardAt) {
      const fresh = (await repo.get("leads", lead.id)) || lead;
      const tinhaCall = !!fresh.callAt;
      if (tinhaCall) {
        await cancelCall(repo, { lead: fresh, product, now: at });
        if (cancelCallMeet) cancelCallMeet(lead.id).catch(() => { /* o alerta cobre */ });
      }
      await raiseAlert(repo, thread, {
        text: `Lead é AFILIADO da Shopee/ML (não é cliente)${tinhaCall ? " · call desmarcada e horário liberado" : ""} · confirma e desqualifica`,
      });
      await stamp(lead, { affiliateGuardAt: new Date(nowMs).toISOString(), handoffAt: new Date(nowMs).toISOString() });
      await send(`${nome ? `${nome}, ` : ""}obrigada por explicar! A LeverAds atende quem vende com conta PRÓPRIA de Mercado Livre e Shopee, porque o que a gente faz é espelhar e criar os anúncios da sua conta. Pra quem trabalha com afiliação ela não se aplica${tinhaCall ? ", então já liberei o horário aqui" : ""}. Qualquer coisa é só me chamar!`);
      return "afiliado";
    }

    // Pergunta de descoberta do motor quando a IA tenta pular a qualificação.
    const discoveryQuestion = msgs.some((m) => m.direction === "out" && /ajudaria/i.test(m.text || ""))
      ? "Qual a maior dificuldade da sua operação hoje: gerenciar as contas, criar anúncio, estoque ou atendimento?"
      : "Isso ajudaria na sua operação hoje?";
    if (decision.acao === "agendar" && !engaged && !lead.callAt) {
      log.info?.({ lead: lead.id }, "sdr-brain: agendar sem o lead ter engajado virou descoberta");
      decision.acao = "responder";
      decision.mensagens = [discoveryQuestion];
    }

    if (decision.acao === "agendar" || decision.acao === "remarcar") {
      const pick = slotList.find((s) => s.at === decision.horario);
      if (!pick) {
        // Horário fora da agenda real: re-oferta determinística (com o par
        // espaçado), nada de marcar no escuro.
        await send(reofferText(nome, suggestedPair, wnow));
        return "reoferta";
      }
      const fresh = await repo.get("leads", lead.id);
      const rebook = decision.acao === "remarcar" || !!(fresh || lead).callAt;
      await bookCall(repo, { lead: fresh || lead, product, at: pick.at, closer: pick.closer, now: at });
      // Marcou: o que este lead segurava volta pro pool na hora (o horário dele
      // agora ocupa a agenda de verdade).
      await releaseHolds(repo, { saas: product.id, leadId: lead.id, now: at }).catch(() => {});
      // Confirmação com a DATA cravada (Leo, 24/08): "hoje/amanhã" solto na
      // confirmação vira mal-entendido quando o lead relê depois.
      await send(rebook
        ? rebookConfirmText(nome, slotLabelFull(pick.at, wnow), !!(lead.email && (fresh || lead).callUrl))
        : bookingConfirmText(nome, slotLabelFull(pick.at, wnow), !!lead.email));
      if (autoCallMeet) autoCallMeet(lead.id).catch(() => { /* o lembrete de 10min entrega o link quando existir */ });
      return decision.acao;
    }

    // Lead CANCELOU a call sem escolher horário novo (Leo, 24/08): aceitar de
    // boca e deixar o callAt de pé mantinha o compromisso na agenda e o
    // lembrete de 1h ainda disparava DEPOIS do cancelamento. Aqui o
    // compromisso sai de verdade (card volta pra qualificação, convite do
    // Meet cancelado) e a resposta já oferece a remarcação.
    if (decision.acao === "desmarcar") {
      const fresh = (await repo.get("leads", lead.id)) || lead;
      if (fresh.callAt) {
        const quando = slotLabelFull(fresh.callAt, wnow);
        await cancelCall(repo, { lead: fresh, product, now: at });
        if (cancelCallMeet) cancelCallMeet(lead.id).catch(() => { /* evento fica; o time vê pelo alerta */ });
        await raiseAlert(repo, thread, { text: `Desmarcou a call de ${quando} · robô tirou da agenda e ofereceu remarcação` });
        await send(cancelConfirmText(nome, suggestedPair, wnow));
        return "desmarcar";
      }
      // Sem call marcada não há o que desmarcar: segue como resposta comum.
    }

    // responder — com a trava de preço na frente de tudo, sobre o conjunto.
    const parts = (Array.isArray(decision.mensagens) && decision.mensagens.length
      ? decision.mensagens : [decision.mensagem]).map((t) => String(t || "").trim()).filter(Boolean);
    if (!parts.length) return "silencio";
    // TRAVA DE PREÇO (1ª vez): a IA citou valor → sai a resposta oficial no
    // lugar. A 2ª e a 3ª insistência já foram tratadas pela escada lá em cima.
    if (PRICE_RX.test(parts.join(" "))) {
      await send(priceDeferral(nome));
      await stamp(lead, { priceGuardAt: new Date(nowMs).toISOString() });
      return "preco-travado";
    }
    // TRAVA DE REDIRECIONAMENTO: a resposta manda o lead pra outro número ou
    // link de WhatsApp. Isso nunca é certo (o robô já ESTÁ no canal) e, quando
    // aparece, é sinal de que a IA confundiu quem é quem — foi assim que ela
    // devolveu o lead pro número da própria empresa dele em 24/08. A fala
    // inteira é descartada (nem a parte "sem link" presta, ela continua a
    // mesma confusão) e gente assume.
    if (REDIRECT_RX.test(parts.join(" "))) {
      await raiseAlert(repo, thread, { text: `Robô tentou mandar o lead pra outro número/link · confundiu o canal, assume: "${String(message?.text || "").slice(0, 120)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString(), redirectGuardAt: new Date(nowMs).toISOString() });
      log.warn?.({ lead: lead.id, texto: parts.join(" ").slice(0, 200) }, "sdr-brain: trava de redirecionamento");
      return "redirect-travado";
    }
    // FRASE REQUENTADA (Leo, 24/08): "qual fica melhor pra você?" e a deflexão
    // de preço saíam palavra por palavra duas, três vezes na mesma conversa. O
    // prompt já proíbe, mas prompt não é garantia — aqui o motor corta a parte
    // que repete algo que o robô já disse. Sobrou nada pra falar: é sinal de que
    // a conversa travou, e quem destrava é gente.
    const fresh = parts.filter((t) => !alreadySaid(t, msgs));
    if (!fresh.length) {
      await raiseAlert(repo, thread, { text: `Robô sem resposta nova (ia repetir o que já disse) · assume: "${String(message?.text || "").slice(0, 140)}"` });
      await stamp(lead, { handoffAt: new Date(nowMs).toISOString(), repeatGuardAt: new Date(nowMs).toISOString() });
      return "repeticao-humano";
    }
    parts.length = 0;
    parts.push(...fresh);
    // A lista é a autorização do motor, não só uma sugestão no prompt.
    // Oferta com dia/hora fora dela vira o par permitido, inclusive quando
    // a IA tenta abrir outros dias porque amanhã lotou.
    const offerMentions = /(?:(?:hoje|amanh[ãa]|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|domingo)(?: \d{1,2}\/\d{1,2})?|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\s+(?:[àa]s?\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})/gi;
    const allowedLabels = new Set(slotList.map((s) => s.label.toLowerCase()));
    const allowedDays = new Set(slotList.map((s) => s.at.slice(0, 10)));
    const actualOffer = suggestedPair.length >= 2
      ? `Consigo ${suggestedPair[0].label} ou ${suggestedPair[1].label}, qual fica melhor pra você?`
      : suggestedPair.length ? `Consigo ${suggestedPair[0].label}, fica bom pra você?`
        : "Não tenho horário disponível nesse dia. Qual outra data fica melhor pra você?";
    let replacedOffer = false;
    for (let i = parts.length - 1; i >= 0; i--) {
      const mentions = [...parts[i].matchAll(offerMentions)];
      const offeredWindow = sdrAgendaWindow([{ direction: "in", text: parts[i] }], wnow);
      const wrongDay = offeredWindow.requested && !allowedDays.has(offeredWindow.startDate);
      if ((!lead.callAt || OFFER_CUE_RX.test(parts[i])) && (mentions.some((m) => !allowedLabels.has(m[0].toLowerCase())) || wrongDay)) {
        parts.splice(i, 1);
        replacedOffer = true;
      }
    }
    if (replacedOffer) parts.push(actualOffer);
    // TRAVA DE RECUSA SECA: o horário que a gente ofereceu caiu, e a resposta
    // devolve um "não consigo" sem explicação nem desculpa (visto 25/08 com o
    // Gabriel, que tinha escolhido um horário NOSSO). Troca pela re-oferta com
    // desculpa e a causa real.
    if (parts.some((t) => DRY_REFUSAL_RX.test(t))) {
      const kept = parts.filter((t) => !DRY_REFUSAL_RX.test(t));
      parts.length = 0;
      parts.push(...kept, reofferText(nome, suggestedPair.length ? suggestedPair : offerPool.slice(0, 1), wnow));
      await stamp(lead, { slotTakenGuardAt: new Date(nowMs).toISOString() });
      log.info?.({ lead: lead.id }, "sdr-brain: recusa seca virou desculpa + re-oferta");
    }

    // TRAVA DE OFERTA FANTASMA: nunca oferecemos horário nesta conversa, mas a
    // resposta fala de horários "que te passei" — tira a frase e coloca a
    // oferta real no lugar (mesma régua determinística da trava de preço).
    if (!slotsOffered && parts.some((t) => FAKE_OFFER_RX.test(t))) {
      const real = suggestedPair.length >= 2
        ? `Consigo ${slotLabel(suggestedPair[0].at, wnow)} ou ${slotLabel(suggestedPair[1].at, wnow)}, qual fica melhor pra você?`
        : offerPool.length
          ? `Consigo ${slotLabel(offerPool[0].at, wnow)}, fica bom pra você?`
          : "Qual período fica melhor pra você, manhã ou tarde?";
      const kept = parts.filter((t) => !FAKE_OFFER_RX.test(t));
      parts.length = 0;
      parts.push(...kept, real);
      await stamp(lead, { fakeOfferGuardAt: new Date(nowMs).toISOString() });
      log.info?.({ lead: lead.id }, "sdr-brain: trava de oferta fantasma trocou a frase pela oferta real");
    }

    // TRAVA DE DURAÇÃO (Leo, 17/09): "é uma conversa de 20 minutos" vira
    // "é uma conversa"; a duração é de acordo com a necessidade do lead.
    {
      const podadas = parts.map(stripDuration).filter(Boolean);
      if (podadas.join("\n") !== parts.join("\n")) {
        parts.length = 0;
        parts.push(...podadas);
        log.info?.({ lead: lead.id }, "sdr-brain: trava de duração tirou o tempo da conversa");
      }
    }
    // TRAVA CELULAR × COMPUTADOR (Leo, 17/09): a pergunta "vai entrar pelo
    // celular ou pelo computador?" sai; se o lead falou em celular, entra a
    // recomendação do computador por perto (uma vez por conversa).
    {
      const semPergunta = parts.map((t) => (DEVICE_ASK_RX.test(t) ? stripDeviceAsk(t) : t)).filter(Boolean);
      const jaRecomendou = msgs.some((m) => m.direction === "out" && /computador por perto/i.test(m.text || ""));
      const leadNoCelular = LEAD_MOBILE_RX.test(lastInText);
      if (leadNoCelular && !jaRecomendou && !semPergunta.some((t) => /computador/i.test(t))) {
        if (semPergunta.length >= 3) semPergunta[0] = `${semPergunta[0]}. ${DEVICE_TIP}`;
        else semPergunta.splice(1, 0, DEVICE_TIP);
      }
      if (semPergunta.join("\n") !== parts.join("\n")) {
        parts.length = 0;
        parts.push(...(semPergunta.length ? semPergunta : [DEVICE_TIP]));
        log.info?.({ lead: lead.id }, "sdr-brain: trava celular × computador");
      }
    }
    // TRAVA DE QUALIFICAÇÃO (Leo, 17/09): o lead ainda não disse que a
    // ferramenta ajudaria nem pediu horário → a oferta de horário cai e a
    // descoberta fica (Eduardo, 15/09: pergunta de descoberta + horários na
    // mesma resposta, sem o lead ter respondido nada).
    if (!engaged && !lead.callAt && parts.some((t) => SLOTS_RX.test(t))) {
      const kept = parts.filter((t) => !SLOTS_RX.test(t));
      parts.length = 0;
      parts.push(...kept);
      if (!parts.some((t) => t.includes("?"))) parts.push(discoveryQuestion);
      log.info?.({ lead: lead.id }, "sdr-brain: trava de qualificação tirou a oferta de horário");
    }
    // TRAVA DO MAIS CEDO PRIMEIRO (Leo, 17/09): a agenda tinha "hoje às 14h"
    // e a IA ofereceu "amanhã às 11h ou 13h" (16/09; de novo 17/09 às 7h53).
    // Sem o lead ter pedido dia/período, a oferta tem que conter o primeiro
    // horário do par sugerido; se não contém, o motor reescreve a oferta.
    if (!lead.callAt && suggestedPair.length && !PERIOD_ASK_RX.test(lastInText) && !DAY_WORD_RX.test(lastInText) && !HAS_HOUR_RX.test(lastInText)) {
      const idx = parts.findIndex(isOfferMsg);
      if (idx >= 0 && !parts[idx].includes(suggestedPair[0].label)) {
        parts[idx] = suggestedPair.length >= 2
          ? `Consigo ${suggestedPair[0].label} ou ${suggestedPair[1].label}, qual fica melhor pra você?`
          : `Consigo ${suggestedPair[0].label}, fica bom pra você?`;
        await stamp(lead, { earliestGuardAt: new Date(nowMs).toISOString() });
        log.info?.({ lead: lead.id, pair: meta.pair }, "sdr-brain: trava do mais cedo primeiro reescreveu a oferta");
      }
    }

    // TRAVA DE BECO: lead demonstrou interesse, ainda não tem call marcada e a
    // resposta veio SEM pergunta → o motor emenda a oferta (par sugerido; já
    // ofereceu antes = repescagem curta). Determinístico, como a trava de preço.
    // Sem pergunta OU propondo dia sem hora nenhuma: nos dois casos o lead fica
    // sem o que responder, então o motor emenda a oferta concreta.
    const semSaida = !parts.some((t) => t.includes("?"));
    const diaSemHora = DAY_WORD_RX.test(parts.join(" ")) && !HAS_HOUR_RX.test(parts.join(" "));
    if ((semSaida || diaSemHora) && !lead.callAt && engaged && INTEREST_RX.test(lastInText) && !FORM_MSG_RX.test(lastInText)) {
      // Já ofereceu antes: repesca com os horários ESCRITOS ("algum dos
      // horários que te passei" é a frase proibida do raio-x, item 4 do Leo).
      const push = slotsOffered && suggestedPair.length >= 2
        ? `Fica melhor ${suggestedPair[0].label} ou ${suggestedPair[1].label}?`
        : suggestedPair.length >= 2
          ? `Consigo ${slotLabel(suggestedPair[0].at, wnow)} ou ${slotLabel(suggestedPair[1].at, wnow)}, qual fica melhor pra você?`
          : offerPool.length
            ? `Consigo ${slotLabel(offerPool[0].at, wnow)}, fica bom pra você?`
            : "Qual período costuma ser melhor pra você, manhã ou tarde?";
      if (parts.length >= 3) parts[2] = `${parts[2]} ${push}`;
      else parts.push(push);
      log.info?.({ lead: lead.id }, "sdr-brain: trava de beco emendou a oferta");
    }
    await send(parts);
    if (aborted) return "abortado";
    // Horário citado na resposta fica RESERVADO enquanto o lead decide: some da
    // oferta dos outros leads por 30 min (agenda-slots.js). Só quando a resposta
    // realmente ofereceu horário.
    if (suggestedPair.length && parts.some((t) => SLOTS_RX.test(t))) {
      await holdSlots(repo, { saas: product.id, leadId: lead.id, slots: suggestedPair, now: at }).catch(() => {});
    }
    return "responder";
  }

  return { handleInbound, resumeStalled };
}

// Poller da varredura: 60s, single-flight, no-op sem cérebro. Ver resumeStalled.
export function startSdrBrainSweep(brain, { intervalMs = 60_000, log = console } = {}) {
  if (!brain?.resumeStalled) return { stop: () => {}, run: async () => {} };
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await brain.resumeStalled(); }
    catch (err) { log.warn?.({ err: err.message }, "varredura do sdr-brain falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 40_000).unref?.();
  return { stop: () => clearInterval(timer), run };
}
