// SDR automatizado · Fase 1 (determinística, sem IA no loop). Três frentes,
// todas em nome do SDR dono do lead mas com autoria interna "sdr-bot" (fora da
// régua de contato humano do metrics-core, que só conta gente):
//
//   1. PRIMEIRO TOQUE (SLA): lead novo do produto recebe a primeira mensagem
//      em minutos, 24/7. Janela de 24h aberta (o lead escreveu) = texto livre
//      já com 2 horários reais da agenda; lead que nunca escreveu = template
//      aprovado da Meta (sdr_primeiro_toque). Se um humano (ou o fluxo de
//      ligação) já falou na conversa, o robô não fala por cima.
//   2. LEMBRETES ANTI NO-SHOW: cadência ancorada no callAt (véspera 24h, 1h e
//      10min antes, com o link do Meet). Executa sozinho o que hoje é tarefa
//      manual do Meu dia: grava nas MESMAS chaves do lead.confirmLog, então a
//      fila manual enxerga o passo como feito (e vice-versa: SDR que já
//      confirmou na mão cala o robô naquele passo).
//   3. RESGATE DE NO-SHOW: card movido pra etapa "No show" recebe na hora a
//      mensagem de reencaixe com os próximos horários livres.
//
// Guardrails: só age com product.sdrBot.enabled; só em lead criado DEPOIS de
// ligar (enabledAt) no primeiro toque; opt-out/número inválido/lead interno e
// saídas laterais ficam de fora; mensagem humana prévia silencia o primeiro
// toque; teto de envios por ciclo. Resposta do lead a um lembrete: confirmação
// marca lead.callConfirmed; pedido de remarcação (ou qualquer outra resposta)
// vira alerta quente pro humano (handleSdrInbound, chamado pelo webhook).
//
// O motor é um poller de 60s no molde do drip-runner (single-flight, no-op sem
// produto ligado), iniciado no index.js.
import { findThreadByPhone, listMessages, recordMessage } from "./wa-store.js";
import { digits } from "./whatsapp.js";
import { kindOf, firstStage, isNoShowStage, isWonLead, stageByKind } from "./stages.js";
import { brtToIso, onOutboundMessage, applyStageMove } from "./lead-flow.js";
import { isBusinessHours } from "./business-hours.js";
import { resolveWabaId, getWaHealth } from "./wa-health.js";
import { raiseAlert } from "./wa-call-flow.js";
import { slotsForLead, slotLabel, wallNow, spreadPair, wholeHourSlots, OFFER_HOURS, activeHolds, holdSlots, withoutHeld } from "./agenda-slots.js";
import { SDR_TEMPLATES } from "./sdr-templates.leverads.js";

export const SDR_AUTHOR = "sdr-bot";
const HOUR = 3_600_000, MIN = 60_000;
// Teto do segundo toque (seção 1b) — também é a linha de corte da campanha de
// backlog, que só pega lead DEPOIS que essa janela expira (nunca dose dupla).
const SECOND_TOUCH_MAX_MS = 96 * HOUR;
// Gente falou na conversa há menos que isso: o robô não manda lembrete por
// cima (a confirmação já foi feita na mão, e as duas assinam o mesmo nome).
const HUMAN_QUIET_MS = 60 * MIN;
// Espalhamento do 2º toque: leads tocados no mesmo lote não voltam juntos.
const SECOND_TOUCH_JITTER_MIN = 90;
const SECOND_TOUCH_PER_TICK = 3;
const DAY = 24 * HOUR;
// Escada de retomada: pingando, nunca em lote. 2 por ciclo de 60s já dá o teto
// diário de 60 numa manhã, e o teto diário é quem manda de verdade.
const LADDER_PER_TICK = 2;
// Quantos candidatos o ciclo abre (carregar mensagens é o custo do passe): sem
// isso, um dia com 400 cards em Qualificando lê 400 conversas por minuto.
const LADDER_SCAN_PER_TICK = 25;
// Corte pra Nutrição: quantos cards por ciclo (o movimento é barato, mas o
// kanban não pode dar um salto de 300 cards de uma vez na cara do time).
const LADDER_DROP_PER_TICK = 5;
// Hash estável de string (FNV-1a) — o mesmo lead cai sempre no mesmo atraso e
// no mesmo template, sem guardar sorteio nenhum.
const hashInt = (s) => {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
};
const jitterMs = (id) => (hashInt(id) % SECOND_TOUCH_JITTER_MIN) * MIN;
// ÚLTIMA VEZ QUE A GENTE TOCOU O LEAD, pelo carimbo mais recente que existir.
// O 1º toque é só um dos caminhos: lead que entrou pela campanha de backlog
// tem backlogRescueAt e nenhum firstTouchAt. Devolve 0 pra quem nunca recebeu
// nada nosso (esse fica fora da escada). `lastBot` só é passado no passe que
// já leu a conversa; no passe barato valem os carimbos do próprio lead.
const touchedAt = (lead, lastBot = null) => Math.max(
  Date.parse(lead?.sdrLog?.firstTouchAt || "") || 0,
  Date.parse(lead?.sdrLog?.secondTouchAt || "") || 0,
  Date.parse(lead?.sdrLog?.backlogRescueAt || "") || 0,
  lastBot ? (Date.parse(lastBot.at || "") || 0) : 0,
);
// Folga mínima entre a MARCAÇÃO e a véspera: marcou "amanhã no mesmo horário"
// e a véspera cairia minutos depois do combinado.
const VESPERA_MIN_GAP_MS = 3 * HOUR;
const TEMPLATE_BODY = Object.fromEntries(SDR_TEMPLATES.map((t) => [t.name, t.body]));

const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const outsideWindow = (err) => err?.code === 131047 || err?.code === 470;

// NOME DE SAUDAÇÃO. O campo `name` vem do que o lead digitou no form (ou do
// perfil do WhatsApp) e chega sujo: em prod 24/08 o robô mandou "Oi PECAS!",
// "Oiii GMS", "Oi Gostariademaisi!", "Perfeito PEDRO" e "Oiii silas". Nada
// denuncia robô mais rápido que cumprimentar alguém pelo nome errado, e
// saudação SEM nome não denuncia nada — então na dúvida devolve "" e o texto
// cai no fallback que já existe ("Oiii, tudo bem?").
const BIZ_WORDS = /^(pecas|peca|auto|autopecas|autopeca|loja|lojas|comercio|distribuidora|imports|import|store|shop|parts|motos|moto|car|cars|ltda|me|mei|eireli|empresa|vendas|atacado|varejo|teste|test|sim|nao|ok|oi|ola|gostaria|quero|preciso|info|contato|whats|whatsapp|cliente|admin|user|usuario)$/;
export function greetName(raw) {
  const first = firstName(raw).replace(/[^\p{L}'-]/gu, ""); // pontuação/emoji fora
  if (!first || /\d/.test(firstName(raw))) return "";
  const flat = norm(first);
  if (flat.length < 3) return "";              // "Jr", "M" — não dá pra saudar
  if (BIZ_WORDS.test(flat)) return "";         // "PECAS", "Loja", "Gostaria"
  // Sigla: caixa alta curta é nome de empresa ("GMS", "RT"), não de gente.
  // Caixa alta LONGA ("PEDRO", "JOSNIEL") é nome gritado — só normaliza.
  if (first === first.toUpperCase() && first.length <= 4) return "";
  // Aglutinação do form ("Gostariademaisi", "Alcindotzwicins"): palavra única
  // longa demais pra ser primeiro nome de gente.
  if (flat.length > 12) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Config normalizada do robô por produto; null = desligado (default de todo
// produto: mensagem automática pro lead é opt-in, igual às regras do inbox).
export function sdrBotConfig(product) {
  const cfg = product?.sdrBot;
  if (!cfg?.enabled) return null;
  const num = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };
  return {
    enabledAt: cfg.enabledAt || "",
    firstTouch: cfg.firstTouch !== false,
    reminders: cfg.reminders !== false,
    rescue: cfg.rescue !== false,
    // 2ª tentativa do no-show (24h depois, se o lead não respondeu nada).
    // Acompanha a chave do resgate; `rescue2: false` desliga só ela.
    rescue2: cfg.rescue2 == null ? cfg.rescue !== false : cfg.rescue2 === true,
    // Segundo toque: 1º toque há 24h sem NENHUMA resposta → re-toque único, em
    // horário comercial, com a retomada que a Manuela já manda na mão (Leo, 23/08).
    // Acompanha a chave do 1º toque; `secondTouch: false` desliga só ele.
    secondTouch: cfg.secondTouch == null ? cfg.firstTouch !== false : cfg.secondTouch === true,
    // ESCADA DE RETOMADA ATÉ O CORTE (Leo, 26/08). O que a campanha de 25/08
    // ensinou, medido em 560 leads: a resposta cai com o tempo parado (23,3%
    // com 3 a 5 dias de silêncio, 17,2% com 6 a 10, 15,1% com 11 a 20, 10,9%
    // com 21 a 40) e 66 das 67 respostas chegaram em menos de 24h. Logo:
    // retomada CEDO, e silêncio se declara RÁPIDO. Nasce desligada porque
    // MOVE CARD (é mudança de funil, não só de mensagem).
    ladder: cfg.ladder === true,
    // FRIO (nunca respondeu nada): o degrau de +24h é a seção 1b; este é o
    // encerramento, no 5º dia depois do 1º toque.
    ladderColdDays: num(cfg.ladderColdDays, 5),
    // MORNO (respondeu alguma vez e sumiu): converteu 18,3% contra 13,9% do
    // frio, então ganha um degrau a mais e mais espaçado. O relógio conta da
    // ÚLTIMA mensagem DELE e zera toda vez que ele volta a falar.
    ladderWarmDays: Array.isArray(cfg.ladderWarmDays) && cfg.ladderWarmDays.length
      ? cfg.ladderWarmDays
      : [3, 8, 13],
    // Silêncio depois do último degrau = sem retorno. 48h é o dobro da margem
    // (97% das respostas vieram em 24h); esperar mais só envelhece o card na
    // etapa errada.
    ladderDropHours: num(cfg.ladderDropHours, 48),
    ladderDrop: cfg.ladderDrop !== false,
    // Teto DIÁRIO da escada. O que a Meta puniu em 25/08 foi rajada (560 num
    // dia, 65 falhas de "healthy ecosystem engagement"), não cadência: o mesmo
    // volume pingado não arma o freio deles.
    ladderPerDay: num(cfg.ladderPerDay, 60),
    // Piso entre duas mensagens do robô pro MESMO lead, em qualquer frente.
    ladderCooldownDays: num(cfg.ladderCooldownDays, 3),
    // Campanha de resgate do backlog (Qualificando + Nutrição): lotes de
    // perBatch a cada meia hora das janelas configuradas, dias úteis, mais
    // novos primeiro. Nasce DESLIGADA: é campanha, não régua permanente.
    backlogRescue: cfg.backlogRescue === true,
    backlogRescuePerBatch: num(cfg.backlogRescuePerBatch, 100),
    // DISJUNTOR (Leo, 24/08 — "medo de ser banido"): a campanha se pausa
    // sozinha quando a Meta começa a recusar entrega. Limiar em % de falhas
    // das mensagens do robô nas últimas 2h, com piso de amostra pra um azar
    // isolado não derrubar a campanha.
    backlogRescueMaxFailPct: num(cfg.backlogRescueMaxFailPct, 15),
    backlogRescueMinSample: num(cfg.backlogRescueMinSample, 20),
    backlogRescueHours: Array.isArray(cfg.backlogRescueHours) && cfg.backlogRescueHours.length
      ? cfg.backlogRescueHours
      : [9, 9.5, 10, 10.5, 11, 11.5, 13, 13.5, 14, 14.5, 15, 15.5, 16],
    // Fase 2 (conversa com IA): chave PRÓPRIA, nasce desligada — só liga
    // depois de passar na bateria de replay (sdr-replay.js).
    conversation: cfg.conversation === true,
    // MODO TESTE (Leo, 22/08): com esta chave, o robô INTEIRO (1º toque,
    // lembretes, resgate e a conversa com IA) atende leads INTERNOS (teste da
    // equipe) — que normalmente ficam fora de tudo. Dá pra sentir a
    // experiência completa no próprio WhatsApp sem tocar nenhum lead real, e
    // sem sujar métrica (lead interno segue fora do isRealLead).
    conversationTest: cfg.conversationTest === true,
    firstTouchDelayMin: num(cfg.firstTouchDelayMin, 3), // "um humano viu" > resposta em 2s
    // Debounce de RAJADA (Leo, 23/08): ao receber mensagem, o cérebro espera
    // esse tempo; chegou outra no meio, só a última responde, compilando a
    // rajada inteira numa resposta só.
    debounceSec: num(cfg.debounceSec, 20),
    freshHours: num(cfg.freshHours, 24),                // lead mais velho que isso é fila humana
    templates: {
      // 1º toque escolhido pela DOR DE ORIGEM; o v2 genérico é o fallback
      // enquanto os específicos não estão aprovados na Meta.
      firstTouchMulti: cfg.templates?.firstTouchMulti || "sdr_primeiro_toque_multi",
      firstTouchOem: cfg.templates?.firstTouchOem || "sdr_primeiro_toque_oem",
      firstTouch: cfg.templates?.firstTouch || "sdr_primeiro_toque_v2",
      // "call" nunca chega no lead (Leo, 23/08): templates novos falam
      // "conversa"; os antigos aprovados seguem de fallback até a revisão.
      reminder: cfg.templates?.reminder || "sdr_lembrete_conversa",
      rescue: cfg.templates?.rescue || "sdr_resgate_conversa",
      secondTouch: cfg.templates?.secondTouch || "sdr_retomada_conversa",
      // Variações aprovadas da retomada: o lote de 2º toque sorteia entre elas
      // (pelo id do lead) em vez de mandar a MESMA frase pra todo mundo. Só
      // entram as que a Meta já aprovou; com uma só, é o comportamento de antes.
      secondTouchVariants: Array.isArray(cfg.templates?.secondTouchVariants) ? cfg.templates.secondTouchVariants : [],
      backlogRescue: cfg.templates?.backlogRescue || "sdr_retomada_conversa",
      backlogRescueNutri: cfg.templates?.backlogRescueNutri || "sdr_retomada_novidades",
      // Último degrau da escada: encerramento (dá permissão pro não). Sem ele
      // APROVADO na Meta a escada não fecha, e o corte nunca acontece.
      ladderBreakup: cfg.templates?.ladderBreakup || "sdr_encerramento_atendimento",
      rescue2: cfg.templates?.rescue2 || "sdr_remarcar_noshow",
    },
  };
}

// Dor de ORIGEM do anúncio que trouxe o lead (lead.sourcePain, gravado pelo
// form, lido contra product.painMap). Decisão do Leo (22/08): A a E são dores
// do CLONE (clonagem/sincronização entre contas) e a conversa fala SÓ disso;
// OEM é a criação de anúncio por código OEM e a conversa fala SÓ disso. Sem
// dor registrada, apresentação geral.
export function leadPainFocus(product, lead) {
  const code = String(lead?.sourcePain || "").toUpperCase().trim();
  if (!code) return null;
  // Dor OEM só cabe em autopeças: lead de OUTRO nicho que clicou no anúncio de
  // part number conversa pela clonagem (o pitch OEM dizia "sua autopeça" pra
  // lead de eletrônicos — visto 23/08). Nicho vazio mantém o OEM: o anúncio
  // segmenta autopeças.
  const oemFits = !lead?.niche || isAutoPecas(lead.niche);
  return { code, label: product?.painMap?.[code] || "", mode: code === "OEM" && oemFits ? "oem" : "clone" };
}

// A conversa com IA vale pra este lead? Modo normal: chave `conversation` e
// lead REAL. Modo teste: chave `conversationTest` e lead INTERNO — nunca os
// dois cruzados (teste não fala com lead real; produção não fala com teste).
export const conversationActive = (cfg, lead) =>
  !!cfg && (lead?.internal ? cfg.conversationTest : cfg.conversation);

// "3 a 5 contas · autopeças · 500 a 2 mil anúncios" — o que o lead respondeu no
// diagnóstico, com os RÓTULOS do painel de qualificação do produto
// (product.leadQuestions, sincronizado do form). É o que faz o primeiro toque
// soar como gente que leu, não como blast.
export function leadDigest(product, lead) {
  const qs = Array.isArray(product?.leadQuestions) ? product.leadQuestions : [];
  const label = (key) => {
    const v = lead?.[key];
    if (v == null || v === "") return "";
    const q = qs.find((x) => x.key === key);
    const opt = (q?.options || []).find((o) => o.value === v);
    return String(opt?.label || v);
  };
  const parts = [];
  const accounts = label("accounts");
  const niche = label("niche");
  const listings = label("listings");
  if (accounts) parts.push(accounts.toLowerCase());
  if (niche) parts.push(niche.toLowerCase());
  if (listings) parts.push(`${listings.toLowerCase()} anúncios`);
  return parts.length ? parts.join(" · ") : "sua operação de marketplace";
}

// Copy calibrada na mineração do histórico real (ago/2026): a persona do
// número abre com "Oiii", não usa emoji digitado, referencia o cadastro e
// fecha com pergunta única. Oferta de 2 horários concretos é o padrão de
// agendamento mais usado do time.
// O 1º toque virou pergunta de DESCOBERTA (decisão do Leo, 23/08): pitch do
// ângulo que trouxe o lead + "isso ajudaria na sua operação?" — sem oferecer
// horário na abertura; a agenda entra na resposta seguinte, pelo cérebro,
// quando o lead engaja.
// Lead de AUTOPEÇAS que veio por dor de gestão (A-E) ouve a clonagem E o OEM
// junto (Leo, 23/08): o OEM entra como segundo benefício, sem virar o assunto.
export const isAutoPecas = (niche) => /auto\s*pe[çc]/i.test(String(niche || ""));

export function firstTouchText({ nome, sdrName, resumo, pain = null, niche = "" }) {
  const oi = nome ? `Oiii, ${nome}.` : "Oiii.";
  const eu = sdrName ? `${sdrName} falando, da LeverAds.` : "Aqui é da LeverAds.";
  const oemSide = pain?.mode !== "oem" && isAutoPecas(niche)
    ? " E pra autopeças, ela ainda cria o anúncio completo só com o código OEM: fotos, título, descrição e compatibilidade."
    : "";
  const pitch = pain?.mode === "oem"
    ? "A LeverAds cria o anúncio completo da sua autopeça só com o OEM (part number): fotos, título de 200 caracteres, descrição e compatibilidade inteira, pronto pra revisar e publicar em menos de 5 minutos. Isso ajudaria na sua operação?"
    : `A LeverAds te ajuda a gerenciar múltiplas contas de Mercado Livre e Shopee de forma automática, com clonagem de anúncios, estoque, atendimento e edição em um lugar só.${oemSide} Isso ajudaria na sua operação hoje?`;
  return `${oi} ${eu} Recebi seu diagnóstico aqui: ${resumo}. ${pitch}`;
}

// Lembretes ancorados no callAt. `grace` = janela de disparo depois do ponto
// (poller de 60s + eventual downtime): passou dela, o passo não sai atrasado —
// lembrete de véspera chegando 3h depois soa robô quebrado.
const REMINDERS = [
  { key: "24h", beforeMs: 24 * HOUR, graceMs: 45 * MIN },
  { key: "1h", beforeMs: 1 * HOUR, graceMs: 20 * MIN },
  { key: "10min", beforeMs: 10 * MIN, graceMs: 8 * MIN },
];

// Véspera pede confirmação; o lembrete de 1h é a mensagem que o time já manda
// 70+ vezes por mês na mão (mineração ago/2026), agora automática; o de 10min
// entrega o link. Tudo sem emoji, no tom da persona do número.
function reminderText(key, { nome, quando, link }) {
  const oi = nome ? `Oi ${nome}!` : "Oi!";
  if (key === "24h") return `${oi} Confirmando nossa conversa ${quando}, tudo certo? Qualquer imprevisto me fala por aqui que eu remarco sem problema.`;
  if (key === "1h") return `${oi} Está tudo certo pra nossa conversa ${quando}? Nosso especialista vai estar te esperando pra te fazer a demonstração ao vivo. Te espero lá!`;
  return link
    ? `${nome ? nome + ", nossa" : "Nossa"} conversa começa em 10 minutos! Link pra entrar: ${link}`
    : `${nome ? nome + ", nossa" : "Nossa"} conversa começa em 10 minutos! Te espero lá.`;
}

// A mensagem de resgate é a que o time já usa e recupera no-show (mineração:
// "passei na nossa call no horário e não te encontrei, acontece!"), com os
// próximos horários reais na sequência.
// SEGUNDO toque do no-show (Leo, 24/08: "quando um cartão for sinalizado como
// no show, vamos entrar em contato para remarcar"): o 1º resgate sai na hora do
// furo; quem não respondeu ganha MAIS UMA tentativa no dia seguinte, agora com
// horário concreto na mão (oferta fechada converte mais que "me diz um
// horário"). Depois desse, o lead fica pro time — insistir mais vira chateação.
function rescue2Text({ nome, slots = [], now }) {
  const oi = nome ? `Oi ${nome},` : "Oi,";
  if (slots.length >= 2) return `${oi} consegui dois horários novos com nosso especialista: ${slotLabel(slots[0].at, now)} ou ${slotLabel(slots[1].at, now)}. Qual fica melhor pra você?`;
  if (slots.length === 1) return `${oi} consegui um horário novo com nosso especialista, ${slotLabel(slots[0].at, now)}. Fica bom pra você?`;
  return `${oi} ainda dá tempo de remarcar nossa conversa. Me diz o melhor dia e período que eu vejo aqui na agenda.`;
}

function rescueText({ nome, slots = [], now }) {
  const oi = nome ? `Oi ${nome},` : "Oi,";
  const base = `${oi} passei no nosso horário marcado e não te encontrei, acontece! Quer que eu remarque?`;
  if (slots.length >= 2) return `${base} Tenho ${slotLabel(slots[0].at, now)} ou ${slotLabel(slots[1].at, now)} livres, me diz qual fica bom que eu já reservo.`;
  if (slots.length === 1) return `${base} Consigo te encaixar ${slotLabel(slots[0].at, now)}, fica bom?`;
  return `${base} Me diz um horário que fica bom pra você que eu já reservo.`;
}

// Resposta a um lembrete: o que é confirmação e o que precisa de gente.
// Remarcação/negativa é testada ANTES ("sim, mas preciso remarcar" é humano).
const RESCHEDULE_RX = /remarc|reagend|mudar|trocar|outro hor|adiar|cancel|imprevisto|nao vou|nao consigo|nao vai dar|nao poss/;
// Lead avisando que a conversa JÁ está rolando (ou já rolou): o lembrete que
// vem depois disso só faz o robô parecer desligado do que está acontecendo.
const IN_CALL_RX = /\bna sala\b|na (reuniao|chamada)\b|ja (conversamos|conversei|falei|estou|entrei)|estou (conversando|falando com)|entrei na/;
const AFFIRM_RX = /(^|\s)(sim|confirmo|confirmad[oa]|pode ser|pode sim|combinado|fechado|show|beleza|blz|ok|okay|claro|com certeza|certo|perfeito|top|bora|estarei|vou estar|isso)(\s|[!.,)]|$)/;
export function classifyReminderReply(text) {
  const t = norm(text);
  if (!t.trim()) return "other";
  if (RESCHEDULE_RX.test(t)) return "reschedule";
  if (AFFIRM_RX.test(t) || String(text || "").includes("👍") || String(text || "").includes("✅")) return "confirm";
  return "other";
}

export function makeSdrRunner({ repo, whatsapp: wa, autoCallMeet = null, log = console, now = () => new Date() } = {}) {
  // Templates APROVADOS (só o nome importa aqui) com cache de 5 min — sem a
  // permissão de management no token, segue sem templates (o primeiro toque de
  // quem não escreveu espera a aprovação; o resto do motor funciona igual).
  let tplCache = { at: 0, names: null };
  async function approvedNames() {
    if (tplCache.names && Date.now() - tplCache.at < 5 * 60_000) return tplCache.names;
    let names = new Set();
    try {
      const wabaId = await resolveWabaId(repo, wa);
      if (wabaId) names = new Set((await wa.listTemplates(wabaId)).map((t) => t.name));
    } catch { /* fail-open: sem listagem, sem template */ }
    tplCache = { at: Date.now(), names };
    return names;
  }

  const stampLog = async (lead, patch) =>
    repo.update("leads", lead.id, { sdrLog: { ...(lead.sdrLog || {}), ...patch } });

  async function sendText({ phone, text, phoneId, saas, leadId }) {
    const { messageId } = await wa.sendText(phone, text, { phoneId });
    await recordMessage(repo, { id: messageId, phone, direction: "out", text, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas, leadId });
    // Mensagem do robô = lead sendo qualificado: novo ganha o toque, contato
    // vai pra qualificação; lembrete de call e resgate de no-show são no-op.
    await onOutboundMessage(repo, leadId, { author: SDR_AUTHOR, text: "1º toque do SDR" });
    return messageId;
  }
  async function sendTemplate({ phone, name, params, phoneId, saas, leadId, moveCard = true }) {
    const components = params.length ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t || "") })) }] : [];
    const { messageId } = await wa.sendTemplate(phone, name, "pt_BR", components, { phoneId });
    const rendered = (TEMPLATE_BODY[name] || name).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || "");
    await recordMessage(repo, { id: messageId, phone, direction: "out", text: rendered, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas, leadId });
    // moveCard=false: campanha de resgate não mexe no card no ENVIO — o card
    // anda quando o lead RESPONDER (fluxo do inbound), senão a Nutrição
    // esvaziaria na rajada sem nenhum lead ter falado nada.
    if (moveCard) await onOutboundMessage(repo, leadId, { author: SDR_AUTHOR, text: "1º toque do SDR" });
    return messageId;
  }

  async function tick() {
    if (!wa?.configured) return null;
    const at = now();
    const nowMs = at.getTime();
    const nowIso = at.toISOString();
    const wnow = wallNow(at);
    const products = await repo.list("products");
    const active = products
      .map((p) => ({ product: p, cfg: sdrBotConfig(p) }))
      .filter((x) => x.cfg);
    if (!active.length) return null;

    const anyPhone = products.some((p) => p.waPhoneId);
    const [users, allLeads] = await Promise.all([repo.list("users"), repo.list("leads")]);
    const humanIds = new Set(users.map((u) => u.id));
    const stats = { firstTouch: 0, secondTouch: 0, ladder: 0, nurtured: 0, reminders: 0, rescue: 0, rescue2: 0, backlogRescue: 0, skipped: 0 };
    let sends = 0;
    const CAP = 25; // teto por ciclo: rajada nunca vira metralhadora

    for (const { product, cfg } of active) {
      // Mesma resolução de número das rotas: número do produto; multi-número
      // ativo sem número próprio = bloqueia; legado single-tenant = env.
      const phoneId = product.waPhoneId || (anyPhone ? null : undefined);
      if (phoneId === null || !wa.configured(phoneId)) continue;
      const leads = allLeads.filter((l) => l.saas === product.id);
      const enabledMs = cfg.enabledAt ? Date.parse(cfg.enabledAt) : 0;
      const eligible = (l) =>
        (!l.internal || cfg.conversationTest) && !l.formExit && !l.disqualified &&
        !l.whatsappOptOut && !l.whatsappInvalid && !l.sdrOff && digits(l.waPhone || l.phone);
      // Cada frente roda pro lead quando a chave DELA está ligada (produção)
      // OU quando é lead interno com o modo teste ligado — assim o test-drive
      // cobre a jornada inteira mesmo com a produção toda desligada.
      const passOn = (flag, l) => flag || (cfg.conversationTest && l.internal);

      // ── 1. Primeiro toque ────────────────────────────────────────────────
      if (cfg.firstTouch || cfg.conversationTest) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead) || !passOn(cfg.firstTouch, lead)) continue;
          const created = Date.parse(lead.createdAt || "");
          if (!Number.isFinite(created)) continue;
          if (enabledMs && created < enabledMs) continue; // backlog é fila humana
          if (nowMs - created < cfg.firstTouchDelayMin * MIN) continue;
          if (nowMs - created > cfg.freshHours * HOUR) continue;
          if (kindOf(product, lead.stage || firstStage(product)) !== "novo") continue;
          if (isWonLead(product, lead)) continue;
          if (lead.sdrLog?.firstTouchAt) continue;
          if ((Number(lead.sdrLog?.firstTouchTries) || 0) >= 3) continue;

          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          let hasOut = false, windowOpen = false;
          if (thread) {
            const msgs = await listMessages(repo, thread.id);
            hasOut = msgs.some((m) => m.direction === "out");
            const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
            windowOpen = !!lastIn && nowMs - Date.parse(lastIn.at || 0) < 24 * HOUR;
          }
          if (hasOut) { // gente (ou o fluxo de ligação) já falou: não fala por cima
            await stampLog(lead, { firstTouchAt: nowIso, firstTouchVia: "human" });
            continue;
          }
          const nome = greetName(lead.name);
          const sdrName = firstName(users.find((u) => u.id === lead.owner)?.name);
          const resumo = leadDigest(product, lead);
          const to = thread?.phone || phone;
          const pain = leadPainFocus(product, lead);
          try {
            let via;
            if (windowOpen) {
              await sendText({ phone: to, text: firstTouchText({ nome, sdrName, resumo, pain, niche: lead.niche }), phoneId, saas: product.id, leadId: lead.id });
              via = "text";
            } else {
              const names = await approvedNames();
              // Template POR DOR (multi × OEM); o v2 genérico cobre enquanto o
              // específico não estiver aprovado. Sem nenhum aprovado, espera.
              const wanted = pain?.mode === "oem" ? cfg.templates.firstTouchOem : cfg.templates.firstTouchMulti;
              const tplName = names.has(wanted) ? wanted : names.has(cfg.templates.firstTouch) ? cfg.templates.firstTouch : null;
              if (!tplName) { stats.skipped++; continue; }
              await sendTemplate({ phone: to, name: tplName, params: [nome || "tudo bem", sdrName || "o time", resumo], phoneId, saas: product.id, leadId: lead.id });
              via = "template";
            }
            sends++; stats.firstTouch++;
            await stampLog(lead, { firstTouchAt: nowIso, firstTouchVia: via });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: primeiro toque falhou");
            await stampLog(lead, { firstTouchTries: (Number(lead.sdrLog?.firstTouchTries) || 0) + 1, firstTouchError: String(err.message || err).slice(0, 200) });
          }
        }
      }

      // ── 1b. Segundo toque: 1º toque há 24h sem NENHUMA resposta ──────────
      // Re-toque ÚNICO a partir de 24h do 1º, com a retomada que a Manuela já
      // manda na mão. Lead que respondeu qualquer coisa fica de fora (a
      // conversa é do cérebro/humano); humano que já falou também trava.
      // Só em HORÁRIO COMERCIAL (Leo, 24/08): o 1º toque é 24/7, então as 24h
      // herdam a hora dele — lead das 23h levaria a retomada às 23h do dia
      // seguinte. Fora do expediente o toque espera a régua do business-hours
      // (a mesma do fluxo de ligação e do plantão); o teto é 96h porque 24h
      // completadas na quinta à noite só viram expediente na segunda de manhã
      // (~86h depois do 1º toque) — com 72h esses leads perderiam a retomada.
      if ((cfg.secondTouch || cfg.conversationTest) && isBusinessHours(product, at)) {
        let secondTouchNow = 0;
        for (const lead of leads) {
          if (sends >= CAP || secondTouchNow >= SECOND_TOUCH_PER_TICK) break;
          if (!eligible(lead) || !passOn(cfg.secondTouch, lead)) continue;
          const t0 = Date.parse(lead.sdrLog?.firstTouchAt || "");
          if (!Number.isFinite(t0)) continue;
          if (lead.sdrLog?.firstTouchVia === "human") continue; // 1º toque foi gente: fila humana
          if (lead.sdrLog?.secondTouchAt || lead.sdrLog?.backlogRescueAt || lead.sdrLog?.sendFailedAlertAt) continue;
          // JITTER + TETO POR CICLO (Leo, 24/08). O 1º toque saiu em lote (o
          // liga-geral tocou 9 leads no mesmo segundo), então as 24h cravadas
          // devolviam o MESMO lote, a mesma frase, no mesmo segundo — e a Meta
          // bloqueou 3 dos 9 na hora por frequência ("healthy ecosystem
          // engagement"). Rajada idêntica e simultânea é assinatura de spam.
          // O atraso é derivado do id do lead: estável entre ciclos (não fica
          // sorteando a cada tick) e diferente por lead.
          if (nowMs - t0 < 24 * HOUR + jitterMs(lead.id) || nowMs - t0 > SECOND_TOUCH_MAX_MS) continue;
          const kind = kindOf(product, lead.stage || firstStage(product));
          if (!["novo", "qualificacao"].includes(kind)) continue;
          if (isWonLead(product, lead) || lead.callAt) continue;
          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          if (thread) {
            const msgs = await listMessages(repo, thread.id);
            if (thread.hasIn || msgs.some((m) => m.direction === "in")) continue;
            const lastOut = [...msgs].reverse().find((m) => m.direction === "out");
            if (lastOut && lastOut.author && lastOut.author !== SDR_AUTHOR) continue; // humano já falou
          }
          // Lead nunca escreveu = janela fechada por definição: só template.
          // VARIAÇÃO: com mais de um template de retomada aprovado, o lote deixa
          // de ser a mesma frase pra todo mundo (o lead escolhido é sempre o
          // mesmo, pelo id, então re-tentativa não troca o texto no meio).
          const names = await approvedNames();
          const variants = [...new Set([cfg.templates.secondTouch, ...cfg.templates.secondTouchVariants])].filter((n) => names.has(n));
          if (!variants.length) { stats.skipped++; continue; }
          const tplRetomada = variants[hashInt(lead.id) % variants.length];
          const nome = greetName(lead.name);
          try {
            await sendTemplate({ phone: thread?.phone || phone, name: tplRetomada, params: [nome || "de novo"], phoneId, saas: product.id, leadId: lead.id });
            sends++; stats.secondTouch++; secondTouchNow++;
            await stampLog(lead, { secondTouchAt: nowIso });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: segundo toque falhou");
            await stampLog(lead, { secondTouchError: String(err.message || err).slice(0, 200) });
          }
        }
      }

      // ── 1c. Escada de retomada até o corte (Leo, 26/08) ──────────────────
      // Dois públicos, porque na campanha de 25/08 quem JÁ tinha respondido
      // alguma vez converteu 18,3% contra 13,9% de quem nunca falou:
      //
      //   FRIO  (nunca respondeu nada): 1º toque · +24h (seção 1b) · +5d
      //         ENCERRAMENTO. Fecha o ciclo de Qualificando em 7 dias.
      //   MORNO (respondeu e sumiu): relógio conta da ÚLTIMA MENSAGEM DELE e
      //         ZERA toda vez que ele volta a falar · +3d · +8d · +13d
      //         ENCERRAMENTO. Um degrau a mais e mais espaçado: ele vale mais
      //         e já teve conversa de verdade, então não se cobra a cada dia.
      //
      // O último degrau é sempre a mensagem de encerramento, não uma quarta
      // cobrança: ela dá permissão pro não e é o que separa quem estava só
      // ocupado de quem morreu. Sem resposta depois dela, a seção 1d manda o
      // card pra Nutrição.
      if ((cfg.ladder || cfg.conversationTest) && isBusinessHours(product, at)) {
        // Teto DIÁRIO em app_config (sobrevive a restart, igual à campanha).
        const ymdL = `${wnow.getUTCFullYear()}-${String(wnow.getUTCMonth() + 1).padStart(2, "0")}-${String(wnow.getUTCDate()).padStart(2, "0")}`;
        const ladderId = `sdr_ladder_${product.id}`;
        let lrec = await repo.get("app_config", ladderId).catch(() => null);
        if (!lrec) lrec = await repo.create("app_config", { id: ladderId, day: ymdL, sent: 0 });
        else if (lrec.day !== ymdL) { lrec = { ...lrec, day: ymdL, sent: 0 }; await repo.update("app_config", ladderId, { day: ymdL, sent: 0 }); }
        let dayQuota = Math.max(0, cfg.ladderPerDay - (Number(lrec.sent) || 0));

        const names = await approvedNames();
        // Degrau → template. O último é sempre o encerramento; antes dele vêm
        // a retomada da Manuela e a de novidades, ambas já aprovadas.
        const stepTemplate = (step, steps) => step >= steps.length - 1
          ? cfg.templates.ladderBreakup
          : (step === 0 ? cfg.templates.secondTouch : cfg.templates.backlogRescueNutri);

        // Passe BARATO primeiro (só campos do lead): ler a conversa é o custo
        // do ciclo, e não dá pra abrir 400 threads por minuto. Mais novos
        // primeiro, como na campanha — a curva de resposta cai com a idade.
        const cands = leads
          .filter((l) => eligible(l) && passOn(cfg.ladder, l))
          .filter((l) => !isWonLead(product, l) && !l.callAt && !isNoShowStage(l.stage))
          .filter((l) => ["novo", "qualificacao"].includes(kindOf(product, l.stage || firstStage(product))))
          // A ESCADA VALE PRA QUEM A GENTE JÁ TOCOU, não só pra quem levou o 1º
          // toque do robô: em 26/08 só 41 dos 448 cards em Qualificando tinham
          // firstTouchAt (os outros 364 entraram pela campanha de backlog, que
          // carimba backlogRescueAt). Exigir o 1º toque deixaria de fora 9 em
          // cada 10 cards que a escada existe justamente pra drenar. Quem
          // nunca recebeu NADA nosso fica de fora: "não consegui falar com
          // você" pressupõe que a gente tentou.
          .filter((l) => touchedAt(l))
          .filter((l) => l.sdrLog?.firstTouchVia !== "human")   // 1º toque foi gente: fila humana
          .filter((l) => !l.sdrLog?.ladder?.done)               // escada terminada: quem age é o corte
          .sort((a, b) => touchedAt(b) - touchedAt(a));

        let scanned = 0, ladderNow = 0;
        for (const lead of cands) {
          if (sends >= CAP || ladderNow >= LADDER_PER_TICK || dayQuota <= 0) break;
          if (scanned >= LADDER_SCAN_PER_TICK) break;
          scanned++;
          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          const msgs = thread ? await listMessages(repo, thread.id) : [];
          const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
          const inMs = lastIn ? Date.parse(lastIn.at || 0) : NaN;
          // ÂNCORA DO SILÊNCIO: a última vez que o LEAD falou. Sem isso, a
          // última vez que a GENTE falou (1º toque quando existe; senão a
          // mensagem mais recente do robô ou o carimbo da campanha). É ela que
          // define o público e reinicia a escada sozinha.
          const lastBot = [...msgs].reverse().find((m) => m.direction === "out" && m.author === SDR_AUTHOR);
          const warm = Number.isFinite(inMs);
          const anchor = warm ? inMs : (Date.parse(lead.sdrLog?.firstTouchAt || "") || touchedAt(lead, lastBot));
          // Humano na conversa depois da âncora: a conversa é dele, não do robô.
          const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
          if (lastHumanOut && Date.parse(lastHumanOut.at || 0) >= anchor) continue;
          const steps = warm ? cfg.ladderWarmDays : [cfg.ladderColdDays];
          const st = lead.sdrLog?.ladder || {};
          const anchorIso = new Date(anchor).toISOString();
          const step = st.at === anchorIso ? (Number(st.step) || 0) : 0; // falou de novo = escada do zero
          if (step >= steps.length) continue;
          if (nowMs - anchor < steps[step] * DAY + jitterMs(lead.id)) continue;
          // PISO ENTRE MENSAGENS DO ROBÔ. Template empilhado em cima de
          // mensagem recente é o que a Meta lê como frequência abusiva (65 das
          // 76 falhas de 25/08 foram "healthy ecosystem engagement"). Conta a
          // última saída do robô por QUALQUER frente (1º/2º toque, lembrete,
          // resposta da IA), não só pela escada.
          const lastBotOut = [...msgs].reverse().find((m) => m.direction === "out" && m.author === SDR_AUTHOR);
          if (lastBotOut && nowMs - Date.parse(lastBotOut.at || 0) < cfg.ladderCooldownDays * DAY) continue;

          const wanted = stepTemplate(step, steps);
          if (!names.has(wanted)) { stats.skipped++; continue; } // sem aprovação da Meta, o degrau espera
          const nome = greetName(lead.name);
          const params = wanted === cfg.templates.backlogRescueNutri
            ? [nome || "de novo", firstName(users.find((u) => u.id === lead.owner)?.name) || "Manuela"]
            : [nome || "de novo"];
          const last = step === steps.length - 1;
          try {
            // moveCard=false: retomada não é "1º contato", e o card só anda
            // quando o lead RESPONDER (mesma semântica da campanha).
            await sendTemplate({ phone: thread?.phone || digits(phone), name: wanted, params, phoneId, saas: product.id, leadId: lead.id, moveCard: false });
            sends++; ladderNow++; dayQuota--; stats.ladder++;
            lrec = { ...lrec, sent: (Number(lrec.sent) || 0) + 1 };
            await repo.update("app_config", ladderId, { day: lrec.day, sent: lrec.sent });
            await stampLog(lead, { ladder: { at: anchorIso, step: step + 1, lastAt: nowIso, warm, done: last } });
          } catch (err) {
            log.warn?.({ lead: lead.id, step, err: err.message }, "sdr: degrau da escada falhou");
            await stampLog(lead, { ladder: { ...st, at: anchorIso, step, error: String(err.message || err).slice(0, 200) } });
          }
        }
      }

      // ── 1d. Corte pra Nutrição (Leo, 26/08) ──────────────────────────────
      // Silêncio depois do encerramento = sem retorno. 48h porque 66 das 67
      // respostas da campanha de 25/08 vieram em menos de 24h e só UMA depois
      // disso: esperar mais não recupera ninguém, só envelhece o card na etapa
      // errada (a mediana em Qualificando era de 9,1 dias, com 448 cards).
      // Qualificando vira fila de trabalho; Nutrição vira o reservatório.
      if (cfg.ladderDrop && (cfg.ladder || cfg.conversationTest)) {
        const target = stageByKind(product, "contato");
        let dropped = 0;
        for (const lead of leads) {
          if (dropped >= LADDER_DROP_PER_TICK) break;
          if (!target || target.stage === lead.stage) continue;
          if (!eligible(lead) || !passOn(cfg.ladder, lead)) continue;
          const st = lead.sdrLog?.ladder || {};
          if (!st.done || lead.sdrLog?.nurtureAt) continue;
          const doneMs = Date.parse(st.lastAt || "");
          if (!Number.isFinite(doneMs) || nowMs - doneMs < cfg.ladderDropHours * HOUR) continue;
          if (isWonLead(product, lead) || lead.callAt || isNoShowStage(lead.stage)) continue;
          if (!["novo", "qualificacao"].includes(kindOf(product, lead.stage || firstStage(product)))) continue;
          // Falou (ou gente falou) depois do encerramento: a escada reinicia
          // sozinha na seção 1c, e o card fica onde está.
          const thread = await findThreadByPhone(repo, lead.waPhone || lead.phone);
          const msgs = thread ? await listMessages(repo, thread.id) : [];
          if (msgs.some((m) => Date.parse(m.at || 0) > doneMs
            && (m.direction === "in" || (m.direction === "out" && humanIds.has(m.author))))) continue;
          try {
            const moved = await applyStageMove(repo, { lead, toStage: target.stage, author: SDR_AUTHOR, now: at });
            await repo.update("leads", lead.id, {
              ...moved,
              stage: target.stage,
              sdrLog: { ...(lead.sdrLog || {}), nurtureAt: nowIso },
            });
            dropped++; stats.nurtured++;
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: corte pra Nutrição falhou");
            await stampLog(lead, { nurtureError: String(err.message || err).slice(0, 200) });
          }
        }
      }

      // ── 2. Lembretes da call (véspera · 1h · 10min) ──────────────────────
      if (cfg.reminders || cfg.conversationTest) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead) || !passOn(cfg.reminders, lead)) continue;
          if (kindOf(product, lead.stage) !== "call" || !lead.callAt) continue;
          const callMs = Date.parse(brtToIso(lead.callAt));
          if (!Number.isFinite(callMs) || callMs <= nowMs) continue;
          // confirmLog amarrado ao horário VIGENTE (remarcou = zera), a MESMA
          // semântica da fila do Meu dia (confirmStepDone).
          const log0 = lead.confirmLog && lead.confirmLog.at === lead.callAt ? lead.confirmLog : { at: lead.callAt };
          const due = REMINDERS.find((r) => {
            const fireAt = callMs - r.beforeMs;
            return nowMs >= fireAt && nowMs <= fireAt + r.graceMs && !log0[r.key];
          });
          if (!due) continue;
          if (due.key === "24h" && (lead.callConfirmed || log0.confirmed)) {
            await repo.update("leads", lead.id, { confirmLog: { ...log0, [due.key]: nowIso } });
            continue; // já confirmou: véspera vira silêncio (1h/10min seguem)
          }
          // VÉSPERA SÓ SE A MARCAÇÃO FOR VELHA (Leo, 24/08). A véspera dispara
          // 24h cravadas antes da call, e o lead quase sempre marca pra "amanhã
          // no mesmo horário" — aí o "confirmando nossa conversa amanhã" caía 5
          // minutos depois do próprio agendamento (6 vezes em prod 24/08, caso
          // Amilton: marcou 13h55, confirmação às 14h). Gente nenhuma pede
          // confirmação de um combinado que acabou de fazer: marcação feita
          // dentro da janela pula a véspera (o lembrete de 1h e o de 10min
          // seguem normais). Lead antigo, sem callSetAt gravado, mantém o
          // comportamento de antes.
          const setAtMs = Date.parse(lead.callSetAt || "");
          if (due.key === "24h" && Number.isFinite(setAtMs) && callMs - due.beforeMs - setAtMs < VESPERA_MIN_GAP_MS) {
            await repo.update("leads", lead.id, { confirmLog: { ...log0, [due.key]: nowIso } });
            continue;
          }
          const nome = greetName(lead.name);
          const quando = slotLabel(lead.callAt, wnow);
          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          const to = thread?.phone || phone;
          // Janela de 24h checada ANTES do envio, como no 1º toque e no resgate:
          // a Meta ACEITA o texto livre com janela fechada (devolve id) e só
          // reprova depois, pelo webhook de status (131047) — o catch síncrono
          // nunca via o erro e o lembrete morria calado como "enviada".
          let windowOpen = false, humanRecent = false;
          if (thread) {
            const msgs = await listMessages(repo, thread.id);
            const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
            windowOpen = !!lastIn && nowMs - Date.parse(lastIn.at || 0) < 24 * HOUR;
            // GENTE ACABOU DE FALAR: o robô não repete o que a pessoa já disse.
            // Em prod 24/08 a Manuela confirmou na mão e minutos depois o robô
            // mandou a MESMA confirmação (as duas assinadas por ela) em 6
            // conversas; no encaixe do Junior ela teve que escrever "pode
            // desconsiderar a mensagem anterior". O resgate de no-show já
            // respeitava humano na conversa; o lembrete não respeitava.
            const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
            humanRecent = !!lastHumanOut && nowMs - Date.parse(lastHumanOut.at || 0) < HUMAN_QUIET_MS;
          }
          if (humanRecent) { // passo carimbado: gente cobriu, e não sai atrasado depois
            await repo.update("leads", lead.id, { confirmLog: { ...log0, [due.key]: "humano" } });
            continue;
          }
          // LINK DO MEET. O lembrete de 10min é quem entrega o link, e sem ele
          // sai um "te espero lá" sem lugar nenhum (prod 24/08: o lead perguntou
          // "vão mandar algum link?" e a SDR correu atrás na mão). Na hora do
          // lembrete de 1h ainda dá tempo de criar a sala: tenta agora.
          let callUrl = lead.callUrl || "";
          if (due.key === "1h" && !callUrl && autoCallMeet) {
            try {
              await autoCallMeet(lead.id);
              callUrl = (await repo.get("leads", lead.id))?.callUrl || "";
            } catch (err) {
              log.warn?.({ lead: lead.id, err: err.message }, "sdr: criação do Meet no lembrete falhou");
            }
          }
          // Chegou nos 10 minutos sem sala: o lembrete ainda sai (silêncio na
          // véspera da hora é pior), mas gente é avisada pra mandar o link.
          if (due.key === "10min" && !callUrl && thread) {
            await raiseAlert(repo, thread, { text: `Conversa em 10 min sem link do Meet · manda o link pro lead (${quando})` }).catch(() => {});
          }
          // Janela fechada: template aprovado reabre; sem template, alerta
          // quente — o lembrete é justamente o anti no-show, não pode morrer
          // calado.
          const viaTemplate = async () => {
            const names = await approvedNames();
            const tplLembrete = [cfg.templates.reminder, "sdr_lembrete_call"].find((n) => names.has(n));
            if (tplLembrete) {
              await sendTemplate({ phone: to, name: tplLembrete, params: [nome || "tudo bem", quando], phoneId, saas: product.id, leadId: lead.id });
            } else {
              await raiseAlert(repo, thread || { id: digits(phone), phone: digits(phone), name: lead.name || "", leadId: lead.id, saas: product.id }, {
                text: `Lembrete ${due.key} da call não entregue (janela fechada, sem template aprovado) · confirmar na mão`,
              });
            }
          };
          try {
            if (windowOpen) {
              try {
                await sendText({ phone: to, text: reminderText(due.key, { nome, quando, link: callUrl }), phoneId, saas: product.id, leadId: lead.id });
              } catch (err) {
                if (!outsideWindow(err)) throw err; // nosso registro dizia aberta, a Meta discorda
                await viaTemplate();
              }
            } else {
              await viaTemplate();
            }
            sends++; stats.reminders++;
            await repo.update("leads", lead.id, { confirmLog: { ...log0, [due.key]: nowIso } });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: lembrete falhou");
            await repo.update("leads", lead.id, { confirmLog: { ...log0, [due.key]: "erro:" + String(err.message || err).slice(0, 120) } });
          }
        }
      }

      // ── 3. Resgate de no-show ────────────────────────────────────────────
      if (cfg.rescue || cfg.conversationTest) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead) || !passOn(cfg.rescue, lead)) continue;
          if (!isNoShowStage(lead.stage)) continue;
          const sinceMs = Date.parse(lead.stageSince || "");
          if (!Number.isFinite(sinceMs)) continue;
          if (enabledMs && sinceMs < enabledMs) continue;
          if (nowMs - sinceMs > 48 * HOUR) continue; // furo velho é retomada humana
          if (lead.sdrLog?.noshowFor === lead.stageSince) continue;
          // "PASSEI NO HORÁRIO E NÃO TE ENCONTREI" SÓ DEPOIS DO HORÁRIO. O card
          // vai pra No show quando o time já sabe que o lead não vem — às vezes
          // ANTES da hora marcada (prod 24/08: card movido 09h38, call era 10h;
          // e o lead que tinha cancelado às 10h33 levou o resgate às 10h39). O
          // texto ficava mentindo sobre um horário que nem chegou.
          const callMs = lead.callAt ? Date.parse(brtToIso(lead.callAt)) : NaN;
          if (Number.isFinite(callMs) && callMs > nowMs) continue;

          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          let humanAfter = false, windowOpen = false;
          if (thread) {
            const msgs = await listMessages(repo, thread.id);
            humanAfter = msgs.some((m) => m.direction === "out" && humanIds.has(m.author) && Date.parse(m.at || 0) > sinceMs);
            const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
            windowOpen = !!lastIn && nowMs - Date.parse(lastIn.at || 0) < 24 * HOUR;
          }
          if (humanAfter) { await stampLog(lead, { noshowFor: lead.stageSince, noshowVia: "human" }); continue; }
          const nome = greetName(lead.name);
          const to = thread?.phone || phone;
          try {
            let via = "text";
            if (windowOpen) {
              const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 8, ...OFFER_HOURS });
              // Mesma reserva da conversa com IA: o horário oferecido aqui não
              // pode ser oferecido a outro lead enquanto este decide.
              const holds = await activeHolds(repo, product.id, { now: at }).catch(() => []);
              const pair = spreadPair(wholeHourSlots(withoutHeld(slots, holds, lead.id)));
              await sendText({ phone: to, text: rescueText({ nome, slots: pair, now: wnow }), phoneId, saas: product.id, leadId: lead.id });
              await holdSlots(repo, { saas: product.id, leadId: lead.id, slots: pair, now: at }).catch(() => {});
            } else {
              const names = await approvedNames();
              const tplResgate = [cfg.templates.rescue, "sdr_resgate_noshow"].find((n) => names.has(n));
              if (tplResgate) {
                await sendTemplate({ phone: to, name: tplResgate, params: [nome || "tudo bem"], phoneId, saas: product.id, leadId: lead.id });
                via = "template";
              } else {
                await raiseAlert(repo, thread || { id: digits(phone), phone: digits(phone), name: lead.name || "", leadId: lead.id, saas: product.id }, {
                  text: "No-show sem resgate automático (janela fechada, sem template aprovado) · ligar pro lead",
                });
                via = "alert";
              }
            }
            if (via !== "alert") { sends++; stats.rescue++; }
            await stampLog(lead, { noshowFor: lead.stageSince, noshowVia: via, noshowAt: nowIso });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: resgate de no-show falhou");
            await stampLog(lead, { noshowFor: lead.stageSince, noshowVia: "erro:" + String(err.message || err).slice(0, 120) });
          }
        }
      }

      // ── 3b. Segunda tentativa do no-show (24h depois, sem resposta) ──────
      // O 1º resgate sai no calor do furo e muita gente nem vê. Este é o
      // "vamos remarcar mesmo" do dia seguinte, com horário concreto. Lead que
      // respondeu qualquer coisa (ou que o time já atendeu) fica de fora.
      if (cfg.rescue2 || cfg.conversationTest) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead) || !passOn(cfg.rescue2, lead)) continue;
          if (!isNoShowStage(lead.stage)) continue;
          if (lead.sdrLog?.noshowFor !== lead.stageSince) continue;      // 1º resgate não saiu pra ESTE furo
          if (!["text", "template"].includes(lead.sdrLog?.noshowVia)) continue; // humano/erro: fila humana
          if (lead.sdrLog?.noshow2For === lead.stageSince) continue;      // já teve a 2ª
          if (lead.callAt && Date.parse(brtToIso(lead.callAt)) > nowMs) continue; // já remarcou
          const firstMs = Date.parse(lead.sdrLog?.noshowAt || lead.stageSince || "");
          if (!Number.isFinite(firstMs)) continue;
          if (nowMs - firstMs < 24 * HOUR || nowMs - firstMs > 72 * HOUR) continue;
          // Só em horário comercial: re-toque de madrugada queima a paciência.
          const h2 = wnow.getUTCHours();
          if (wnow.getUTCDay() === 0 || wnow.getUTCDay() === 6 || h2 < 9 || h2 >= 19) continue;

          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          let quiet = true, windowOpen = false;
          if (thread) {
            const msgs = await listMessages(repo, thread.id);
            // Respondeu depois do 1º resgate? Ou gente falou? Então não insiste.
            quiet = !msgs.some((m) => Date.parse(m.at || 0) > firstMs
              && (m.direction === "in" || (m.direction === "out" && humanIds.has(m.author))));
            const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
            windowOpen = !!lastIn && nowMs - Date.parse(lastIn.at || 0) < 24 * HOUR;
          }
          if (!quiet) { await stampLog(lead, { noshow2For: lead.stageSince, noshow2Via: "skip" }); continue; }
          const nome = greetName(lead.name);
          const to = thread?.phone || phone;
          try {
            let via = "text";
            const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 8, ...OFFER_HOURS });
            // Reserva dos horários ofertados, igual ao 1º resgate e à conversa
            // com IA: o que outro lead está decidindo não entra nesta oferta.
            const holds2 = await activeHolds(repo, product.id, { now: at }).catch(() => []);
            const pair = spreadPair(wholeHourSlots(withoutHeld(slots, holds2, lead.id)));
            if (windowOpen) {
              await sendText({ phone: to, text: rescue2Text({ nome, slots: pair, now: wnow }), phoneId, saas: product.id, leadId: lead.id });
            } else {
              // Janela fechada (o normal 24h depois): template. Com dois
              // horários reais na agenda, vai o template que os CARREGA no
              // corpo; sem agenda livre, cai na retomada genérica. Repetir o
              // template de resgate de ontem soaria robô travado.
              const names = await approvedNames();
              const withSlots = pair.length >= 2 && names.has(cfg.templates.rescue2);
              const tpl = withSlots ? cfg.templates.rescue2
                : [cfg.templates.secondTouch, cfg.templates.rescue].find((n) => names.has(n));
              if (!tpl) { stats.skipped++; continue; }
              const params = withSlots
                ? [nome || "tudo bem", slotLabel(pair[0].at, wnow), slotLabel(pair[1].at, wnow)]
                : [nome || "tudo bem"];
              await sendTemplate({ phone: to, name: tpl, params, phoneId, saas: product.id, leadId: lead.id, moveCard: false });
              via = "template";
            }
            sends++; stats.rescue2++;
            await holdSlots(repo, { saas: product.id, leadId: lead.id, slots: pair, now: at }).catch(() => {});
            await stampLog(lead, { noshow2For: lead.stageSince, noshow2Via: via, noshow2At: nowIso });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: 2ª tentativa do no-show falhou");
            await stampLog(lead, { noshow2For: lead.stageSince, noshow2Via: "erro:" + String(err.message || err).slice(0, 120) });
          }
        }
      }
    }

      // ── 4. Resgate do backlog (Qualificando + Nutrição) ──────────────────
      // Campanha (Leo, 24/08): lotes de perBatch a cada meia hora nas janelas
      // configuradas (default 9h→11h30 e 13h→16h BRT), só dia útil, MAIS NOVOS
      // primeiro e Qualificando na frente da Nutrição. Cada lead recebe UMA vez
      // (sdrLog.backlogRescueAt); conversa com atividade nos últimos dias fica
      // de fora (3d qualificação, 7d nutrição); saúde do número em "danger"
      // pausa sozinha. Progresso do lote em app_config (sobrevive a restart).
      for (const { product, cfg } of active) {
        if (!cfg.backlogRescue || sends >= CAP) continue;
        const phoneId = product.waPhoneId || (anyPhone ? null : undefined);
        if (phoneId === null || !wa.configured(phoneId)) continue;
        const frac = wnow.getUTCHours() + (wnow.getUTCMinutes() >= 30 ? 0.5 : 0);
        const isWeekday = wnow.getUTCDay() >= 1 && wnow.getUTCDay() <= 5;
        if (!isWeekday || !cfg.backlogRescueHours.includes(frac)) continue;
        // Pausa pela saúde: sinais DE ENVIO (número sinalizado/qualidade caída
        // ou template do resgate com qualidade vermelha). A violação antiga da
        // CONTA (ligações, removidas em 22/08) não trava a campanha — ela já
        // aparece na régua de saúde do inbox pro time acompanhar.
        const health = await getWaHealth(repo).catch(() => null);
        const tplQ4 = (n) => String(health?.templates?.[n]?.quality || "").toUpperCase();
        const numQ = String(health?.number?.quality || "").toUpperCase();
        if (String(health?.number?.event || "").toUpperCase() === "FLAGGED"
          || numQ === "RED" || numQ === "YELLOW"
          || tplQ4(cfg.templates.backlogRescue) === "RED" || tplQ4(cfg.templates.backlogRescueNutri) === "RED") {
          log.warn?.({ saas: product.id, numQ }, "sdr: resgate do backlog pausado (número sinalizado/qualidade caída ou template vermelho)");
          continue;
        }
        // DISJUNTOR: a Meta recusando entrega é o primeiro sinal de excesso
        // (o "healthy ecosystem engagement" é a régua de marketing por
        // usuário). Passou do limiar nas últimas 2h, a campanha para sozinha
        // e um alerta chama o time — vale mais um resgate pela metade que um
        // número queimado.
        const since2h = new Date(nowMs - 2 * HOUR).toISOString();
        const recent = await repo.listWhere("wa_messages", { at: { gte: since2h } }, { fields: ["author", "status", "at"] }).catch(() => []);
        const mine = recent.filter((m) => m.author === SDR_AUTHOR);
        const failed = mine.filter((m) => m.status === "failed").length;
        const failPct = mine.length ? Math.round((100 * failed) / mine.length) : 0;
        if (mine.length >= cfg.backlogRescueMinSample && failPct >= cfg.backlogRescueMaxFailPct) {
          log.warn?.({ saas: product.id, failPct, sample: mine.length }, "sdr: DISJUNTOR — resgate do backlog pausado por taxa de falha");
          if (!(await repo.get("app_config", `sdr_backlog_breaker_${product.id}`).catch(() => null))) {
            await repo.create("app_config", { id: `sdr_backlog_breaker_${product.id}`, at: nowIso, failPct, sample: mine.length }).catch(() => {});
            await raiseAlert(repo, { id: "campanha", phone: "", name: "Campanha de resgate", saas: product.id }, {
              text: `DISJUNTOR: resgate do backlog pausado · ${failPct}% das mensagens do robô falharam nas últimas 2h (${failed}/${mine.length}) · confira a saúde do número antes de religar`,
            }).catch(() => {});
          }
          continue;
        }
        const mm = wnow.getUTCMinutes() >= 30 ? "30" : "00";
        const ymd = `${wnow.getUTCFullYear()}-${String(wnow.getUTCMonth() + 1).padStart(2, "0")}-${String(wnow.getUTCDate()).padStart(2, "0")}`;
        const batchKey = `${ymd}T${String(wnow.getUTCHours()).padStart(2, "0")}:${mm}`;
        const recId = `sdr_backlog_rescue_${product.id}`;
        let rec = await repo.get("app_config", recId).catch(() => null);
        if (!rec) rec = await repo.create("app_config", { id: recId, batch: batchKey, sent: 0 });
        else if (rec.batch !== batchKey) { rec = { ...rec, batch: batchKey, sent: 0 }; await repo.update("app_config", recId, { batch: batchKey, sent: 0 }); }
        let quota = Math.max(0, cfg.backlogRescuePerBatch - (Number(rec.sent) || 0));
        if (quota <= 0) continue;
        const names = await approvedNames();
        const tplQ = names.has(cfg.templates.backlogRescue) ? cfg.templates.backlogRescue : null;
        if (!tplQ) { stats.skipped++; continue; }
        const tplN = names.has(cfg.templates.backlogRescueNutri) ? cfg.templates.backlogRescueNutri : tplQ;
        const okLead = (l) =>
          (!l.internal || cfg.conversationTest) && !l.formExit && !l.disqualified &&
          !l.whatsappOptOut && !l.whatsappInvalid && !l.sdrOff && digits(l.waPhone || l.phone);
        const IDLE_DAYS = { qualificacao: 3, contato: 7 };
        let pool = allLeads
          .filter((l) => (l.saas || "") === product.id)
          .filter((l) => okLead(l) && !l.callAt && !isWonLead(product, l) && !isNoShowStage(l.stage))
          .filter((l) => !l.sdrLog?.backlogRescueAt && !l.sdrLog?.secondTouchAt && !l.sdrLog?.sendFailedAlertAt)
          .filter((l) => { const ft = Date.parse(l.sdrLog?.firstTouchAt || ""); return !(Number.isFinite(ft) && nowMs - ft < SECOND_TOUCH_MAX_MS); })
          .map((l) => ({ l, kind: kindOf(product, l.stage || firstStage(product)) }))
          // Com a ESCADA ligada, Qualificando é dela (seção 1c): a campanha
          // fica só com a Nutrição, senão o mesmo lead levaria a retomada por
          // duas frentes com réguas diferentes.
          .filter((x) => x.kind === "contato" || (x.kind === "qualificacao" && !cfg.ladder));
        // ORDEM POR ENGAJAMENTO (Leo, 24/08): quem JÁ conversou com a gente
        // alguma vez vai primeiro — responde mais e quase nunca bloqueia. Lead
        // que nunca respondeu nada é o de maior risco de bloqueio/denúncia,
        // então fica no fim: se o disjuntor cortar a campanha, o que já saiu é
        // justamente a parte boa da base.
        const engagedThreads = new Set((await repo.listWhere("wa_messages", { direction: "in" }, { fields: ["leadId"] }).catch(() => []))
          .map((m) => m.leadId).filter(Boolean));
        pool.sort((a, b) => {
          const ea = engagedThreads.has(a.l.id) ? 0 : 1, eb = engagedThreads.has(b.l.id) ? 0 : 1;
          if (ea !== eb) return ea - eb;
          if (a.kind !== b.kind) return a.kind === "qualificacao" ? -1 : 1;
          return String(b.l.createdAt || "").localeCompare(String(a.l.createdAt || ""));
        });
        for (const { l, kind } of pool) {
          if (quota <= 0 || sends >= CAP) break;
          const idleMs = IDLE_DAYS[kind] * 24 * HOUR;
          const thread = await findThreadByPhone(repo, l.waPhone || l.phone);
          const lastAt = Date.parse(thread?.lastAt || "") || 0;
          const since = Date.parse(l.stageSince || l.createdAt || "") || 0;
          if (Math.max(since, lastAt) > nowMs - idleMs) continue; // atividade recente: fora
          const nome = greetName(l.name);
          const tpl = kind === "contato" ? tplN : tplQ;
          try {
            const params = tpl === cfg.templates.backlogRescueNutri
              ? [nome || "de novo", firstName(users.find((u) => u.id === l.owner)?.name) || "Manuela"]
              : [nome || "de novo"];
            await sendTemplate({ phone: thread?.phone || digits(l.waPhone || l.phone), name: tpl, params, phoneId, saas: product.id, leadId: l.id, moveCard: false });
            sends++; stats.backlogRescue++; quota--;
            rec = { ...rec, sent: (Number(rec.sent) || 0) + 1 };
            await repo.update("app_config", recId, { batch: rec.batch, sent: rec.sent });
            await stampLog(l, { backlogRescueAt: nowIso });
          } catch (err) {
            log.warn?.({ lead: l.id, err: err.message }, "sdr: resgate do backlog falhou");
            await stampLog(l, { backlogRescueError: String(err.message || err).slice(0, 200) });
          }
        }
      }
    return stats;
  }

  return { tick, approvedNames };
}

// Gancho do webhook pra CADA mensagem recebida (depois de fluxos/regras):
//   1. Resposta a um lembrete de call vira confirmação (callConfirmed) ou
//      alerta quente pra gente assumir (remarcação e qualquer outra resposta).
//      Só age quando um lembrete DESTE horário de call já saiu.
//   2. Resposta ao 1º TOQUE do robô (até 72h) vira alerta quente — o mesmo
//      pop-up que a saudação automática sempre gerou (thread.callFlow); a
//      conversa aberta pelo robô não tem callFlow, então a cobertura vem daqui.
// Conversa normal não passa por nenhum dos dois. Best-effort: nunca derruba a
// entrega do webhook.
const FIRST_TOUCH_HOT_MS = 72 * HOUR;
export async function handleSdrInbound(repo, { message, now = new Date() } = {}) {
  const thread = await findThreadByPhone(repo, message?.from || "");
  if (!thread?.leadId) return null;
  const lead = await repo.get("leads", thread.leadId);
  if (!lead) return null;

  // ── 1. Lembrete pendente deste horário de call ────────────────────────────
  const log0 = lead.confirmLog;
  const callMs = lead.callAt ? Date.parse(brtToIso(lead.callAt)) : NaN;
  const askedByBot = !!log0 && log0.at === lead.callAt
    && [log0["24h"], log0["1h"], log0["10min"]].some((v) => typeof v === "string" && v.length > 0 && !v.startsWith("erro:"));
  // LEAD JÁ ESTÁ NA CONVERSA (Leo, 24/08): "já estou na sala", "já conversamos",
  // "estou aguardando na reunião" — o lembrete seguinte não pode chamar pra uma
  // conversa que já está acontecendo (prod 24/08: o lead avisou às 17h01 que já
  // estava falando com o especialista e às 17h50 levou "começa em 10 minutos").
  // Carimba os passos restantes DESTE horário como feitos.
  // "não consigo entrar na sala" é o oposto disso: segue pro alerta, que é onde
  // gente aparece pra ajudar.
  const inboundText = norm(message?.text || "");
  if (Number.isFinite(callMs) && lead.callAt && IN_CALL_RX.test(inboundText) && !/\bnao\b/.test(inboundText)) {
    const base = log0 && log0.at === lead.callAt ? log0 : { at: lead.callAt };
    const stamped = { ...base };
    for (const r of REMINDERS) if (!stamped[r.key]) stamped[r.key] = "na-conversa";
    await repo.update("leads", lead.id, { confirmLog: stamped });
    return "in-call";
  }
  if (askedByBot && Number.isFinite(callMs) && callMs > now.getTime()) {
    const verdict = classifyReminderReply(message?.text || "");
    if (verdict === "confirm") {
      if (!lead.callConfirmed) {
        await repo.update("leads", lead.id, { callConfirmed: true, confirmLog: { ...log0, confirmed: now.toISOString() } });
      }
      return "confirmed";
    }
    // Remarcação ou resposta que o robô não entende: gente assume. Um alerta
    // por horário de call (remarcou = pode alertar de novo).
    if (lead.sdrLog?.confirmAlertFor === lead.callAt) return null;
    await raiseAlert(repo, thread, {
      text: verdict === "reschedule"
        ? `Quer remarcar a call: "${String(message?.text || "").slice(0, 160)}"`
        : `Respondeu o lembrete da call: "${String(message?.text || "").slice(0, 160)}"`,
    });
    await repo.update("leads", lead.id, { sdrLog: { ...(lead.sdrLog || {}), confirmAlertFor: lead.callAt } });
    return "alert";
  }

  // ── 2. Resposta quente ao 1º toque do robô ────────────────────────────────
  // Com a CONVERSA da Fase 2 ligada (real ou modo teste), quem responde é o
  // sdr-brain (que levanta alerta só nos handoffs) — pop-up em toda resposta
  // viraria ruído.
  const product = lead.saas ? await repo.get("products", lead.saas) : null;
  if (conversationActive(sdrBotConfig(product), lead)) return null;
  const ft = lead.sdrLog?.firstTouchAt;
  if (ft && ["text", "template"].includes(lead.sdrLog?.firstTouchVia)
    && now.getTime() - Date.parse(ft) <= FIRST_TOUCH_HOT_MS) {
    await raiseAlert(repo, thread, { text: String(message?.text || "").slice(0, 300) });
    return "hot";
  }
  return null;
}

// Poller de produção: 60s (o lembrete de 10min precisa de granularidade fina),
// single-flight, primeiro passe logo após o boot. No-op sem produto ligado.
export function startSdrFlow(repo, { whatsapp, autoCallMeet = null, intervalMs = 60_000, log = console } = {}) {
  const runner = makeSdrRunner({ repo, whatsapp, autoCallMeet, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runner.tick(); }
    catch (err) { log.warn?.({ err: err.message }, "poller do SDR automatizado falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 25_000).unref?.();
  return { stop: () => clearInterval(timer), run };
}
