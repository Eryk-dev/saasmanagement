// VALIDADOR ÚNICO DA SAÍDA DO ROBÔ (R-003, R-006, R-008, R-009, R-011, R-020,
// R-021, R-022, R-026, R-028, R-029, R-030, R-031, R-050, R-060, R-061).
//
// Tudo que o cérebro manda pro lead (IA, roteiro OEM/Price, confirmação,
// transição pra humano, texto de trava) passa por AQUI, na mesma ordem. Cada
// validador é puro: `check(draft, ctx)` devolve as violações e `fix(draft,
// ctx)` devolve o draft corrigido + os efeitos (carimbos, alertas, resultado
// final) que o cérebro aplica DEPOIS do envio. Nada de I/O.
//
// Modo `audit`: só check, conta violações (é o que roda em produção na
// sombra, sobre o texto final de cada caminho). Modo `enforce`: check + fix em
// ordem; no fim os checks rodam de novo e sobra `residual` (o que o replay e a
// auditoria contam por regra).
//
// A ORDEM é a precedência e, até o PR5, reproduz byte a byte a cadeia de
// reescritas que vivia no bloco `responder` do sdr-brain.js (os testes de
// cena asseveram `shadowDiff` vazio). Reordenar é mudança de comportamento e
// entra com chave de config.
//
// Exceções declaradas no rulebook (sdr-rules.js, campo `except`) entram como
// `exempt: true` na violação: contadas em balde próprio, nunca corrigidas
// (ex.: a M3 do roteiro OEM/Price diz "30/40 minutos" por decisão do Leo).

import { sdrAgendaWindow } from "./sdr-agenda.js";
import { SLOTS_RX, OFFER_CUE_RX, FORM_MSG_RX, isOfferMsg, expandSameDay, slotsInText } from "./sdr-signals.js";
import { DAY_WORD_RX, HAS_HOUR_RX, INTEREST_RX, LEAD_MOBILE_RX, PERIOD_ASK_RX, plainReply } from "./sdr-intents.js";
import { offerLine, NO_SLOT_TEXT } from "./sdr-offer.js";
import { DEVICE_TIP } from "./sdr-flow.js";
import { SDR_AUTHOR } from "./sdr-flow.js";

// ── Regex sobre o texto NOSSO ───────────────────────────────────────────────
// VALOR dito por nós. PREÇO É CONVERSA DA CALL (Leo, 18/09): nenhum número,
// faixa, parcela, desconto ou NOME de plano sai do robô. O replay importa daqui.
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
// REDIRECIONAMENTO PRA OUTRO CANAL (R-008): o robô É o canal.
export const REDIRECT_RX = /wa\.me\/|api\.whatsapp\.com|whatsapp\.com\/send|\b\d{4}[-\s.]?\d{4}\b|\+?55\s?\(?\d{2}\)?\s?9?\d{4}/i;
// Recusa SECA de horário (R-028). Sem \b no fim (o \b do JS é ASCII).
export const DRY_REFUSAL_RX = /n[ãa]o (consigo|tenho|d[áa]|vai dar)\s*(esse|nesse|este|neste|nesse dia)?\s*hor[áa]ri|esse hor[áa]rio n[ãa]o (consigo|tenho|est[áa]|d[áa]|vai)|hor[áa]rio (j[áa] )?(n[ãa]o est[áa]|ficou) (dispon[íi]vel|livre)/i;
// Oferta FANTASMA (R-029): "os horários que te passei" sem ter passado.
export const FAKE_OFFER_RX = /(hor[áa]rios?|op[çc][õo]es)\s+que\s+(eu\s+)?(te\s+)?(passei|mandei|enviei)|algum\s+d(os|aqueles)\s+hor[áa]rios|aqueles\s+hor[áa]rios|qual\s+d(?:os|as)\s+(?:dois|duas|2)?\s*(?:hor[áa]rios|op[çc][õo]es)/i;
// LOTOU SEM PROVA (R-041, 28/10): "na sexta já lotou", "depois das 18h já
// lotou", "não tenho vaga", "acabou de ser preenchido" ditos pela IA quando
// o motor NÃO disse que o pedido lotou (Claudenilson: a sexta tinha 9h-17h
// livres; Alberto: o humano encaixou 18h cinco minutos depois). Só o motor
// pode afirmar lotação (requestedEmpty, hora pedida fora da lista, horário
// escolhido que foi tomado).
export const LOTOU_CLAIM_RX = /\blot(?:ou|ad[ao]s?|aram)\b|n[ãa]o (?:tenho|temos|tem|t[áa]|est[áa]) (?:mais )?(?:nenhuma? )?(?:vaga|hor[áa]rio|janela|agenda|disponibilidade)|n[ãa]o est[áa] mais (?:livre|dispon)|n[ãa]o est[ãa]o mais (?:livres|dispon)|(?:foi|foram|acabou de ser|acabaram de ser|j[áa] foi|j[áa] foram) preenchid|(?:j[áa] )?(?:est[áa]|ficou|ficaram|est[ãa]o) (?:todo |toda |todos |todas )?(?:ocupad|tomad|cheia|cheio)/i;
// PROMESSA DE VOLTAR DEPOIS (R-030): ninguém volta.
// 28/10: "te passo as opções", "vou encaminhar seu contato", "vou pedir pro
// time", "deixo sinalizado aqui" também são promessas que ninguém cumpre.
export const PROMISE_RX = /\bte (?:confirmo|retorno|aviso|respondo|passo)\b|\bj[áa] te (?:falo|aviso|confirmo|retorno|respondo|passo)\b|\b(?:vou|deixa eu|vamos|consigo) (?:ver|verificar|checar|confirmar|consultar|olhar|dar uma olhada)\b[^.?!]*\b(?:agenda|hor[áa]rio|especialista|time|aqui|vaga|disponibilidade)|\bem (?:alguns |poucos |uns )?(?:minutos|instantes|minutinhos)\b|\bvou (?:te )?(?:passar|encaminhar|repassar|direcionar|sinalizar)\b|\bvou (?:pedir|avisar|falar com|deixar sinalizado)\b|\bencaminho\b|\brepasso\b|\bpe[çc]o pr[ao]\b|\bdeixo sinalizado\b/i;
// Pergunta solta de dia ao lado de uma oferta concreta (R-026).
export const SCHEDULE_ASK_Q_RX = /\bqual (?:dia|data|hor[áa]rio|per[íi]odo|outro dia)\b[^?]*\?/i;
// DURAÇÃO INVENTADA (R-060). "Em menos de 5 minutos" (pitch OEM) fica de fora.
export const DURATION_CTX_RX = /conversa|demonstra|reuni[ãa]o|meet|dura/i;
export const DURATION_RX = /(?<!menos de )(?<!menos )\b\d{1,3}\s*(?:min|minutos)\b|\bmeia hora\b|\b(?:cerca de |uns |em torno de )?(?:uma|1) hora(?:zinha)?\b/i;
export function stripDuration(text) {
  let t = String(text || "");
  if (!DURATION_CTX_RX.test(t) || !DURATION_RX.test(t)) return t;
  t = t.replace(/\bdura(?:ção)?\s*(?:é\s*)?(?:de\s*)?(?:cerca de |uns |em torno de |mais ou menos |aproximadamente )?(?:\d{1,3}\s*(?:min|minutos)|meia hora|(?:uma|1) hora)\b/gi, "a duração vai de acordo com o que você quiser ver");
  t = t.replace(/(?<!menos)\s+(?:de|com)\s+(?:cerca de |uns |em torno de |mais ou menos |aproximadamente )?(?:\d{1,3}\s*(?:min|minutos)|meia hora|(?:uma|1) hora(?:zinha)?)\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  if (DURATION_RX.test(t)) return ""; // sobrou duração em forma que não dá pra podar: a frase cai
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// CELULAR × COMPUTADOR (R-061): nunca perguntar por onde o lead entra.
export const DEVICE_ASK_RX = /(?:pelo\s+)?celular\s+ou\s+(?:pelo\s+)?computador|computador\s+ou\s+(?:pelo\s+)?celular|por onde (?:voc[êe] )?vai entrar/i;
export function stripDeviceAsk(text) {
  return String(text || "").replace(/[^.?!]*(?:(?:pelo\s+)?celular\s+ou\s+(?:pelo\s+)?computador|computador\s+ou\s+(?:pelo\s+)?celular|por onde (?:voc[êe] )?vai entrar)[^.?!]*[.?!]?/gi, "").replace(/\s{2,}/g, " ").trim();
}
// A palavra "call" não chega ao lead (R-006): é "conversa".
export const CALL_WORD_RX = /\bcall\b/i;
// Dia + hora citados no texto (R-020): a lista é a autorização.
export const OFFER_MENTIONS_RX = /(?:(?:hoje|amanh[ãa]|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|domingo)(?: \d{1,2}\/\d{1,2})?|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\s+(?:[àa]s?\s+)?\d{1,2}(?:h\d{0,2}|:\d{2})/gi;

// A resposta é requentada? 75% das palavras de conteúdo repetidas é a MESMA
// frase pro lead (R-009). O limiar deixa passar oferta nova, que compartilha
// o esqueleto mas troca os dados.
const bag = (s) => new Set(String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
export function sameSentence(a, b) {
  const A = bag(a), B = bag(b);
  if (!A.size || !B.size) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size) >= 0.75;
}
// Confirmação curta ("Perfeito", "Combinado") PODE repetir: é assim que gente
// fala. A trava é pra frase de conteúdo.
export const alreadySaid = (text, msgs) => bag(text).size >= 4 && msgs.some((m) =>
  m.direction === "out" && m.author === SDR_AUTHOR && sameSentence(text, m.text));
// Oferta com horário NOVO é informação nova, mesmo que o esqueleto da frase
// seja o mesmo ("Consigo hoje às 13h ou às 15h" depois de "Consigo hoje às
// 14h ou às 16h" compartilha 7 de 9 palavras). R-009 compara texto; aqui a
// comparação é por slot (28/10: a trava comia o par novo depois da recusa e o
// lead ficava sem oferta nenhuma).
export function isFreshOffer(text, msgs = [], nowIso = "") {
  if (!isOfferMsg(text)) return false;
  const slots = slotsInText(text, nowIso || new Date().toISOString()).map((s) => s.at);
  if (!slots.length) return false;
  const before = new Set();
  for (const m of msgs) if (m.direction === "out" && m.author === SDR_AUTHOR && isOfferMsg(m.text || "")) for (const s of slotsInText(m.text, m.at)) before.add(s.at);
  return slots.some((at) => !before.has(at));
}

// Pergunta de VERDADE ≠ saudação com interrogação ("Oiii Cristiano, tudo
// bem?"). Em 28/10 "tudo bem?" contava como pergunta e a resposta saía só
// com a saudação (Cristiano, Giovani, Rhenan: turno 1 vazio).
export const GREETING_Q_RX = /\btudo (?:bem|bom|certo|joia|tranquilo)\s*\?|\bcomo (?:vai|vc est[áa]|voc[êe] est[áa]|c[êe] t[áa])\s*\?/i;
export function isRealQuestion(text) {
  const t = String(text || "");
  if (!t.includes("?")) return false;
  // Tira cada frase-saudação com "?" e vê se sobrou alguma interrogação.
  return t.replace(/[^?]*\?/g, (m) => (GREETING_Q_RX.test(m) ? "" : m)).includes("?");
}

// PERGUNTA DE DESCOBERTA do motor, por roteiro e nunca a mesma duas vezes
// (R-011/R-012, 28/10: a pergunta era um literal fixo e saiu 2x pro Flavio,
// que já tinha dito a dor). A ordem mantém "Isso ajudaria" primeiro enquanto
// o pitch não terminou com ela.
const DISCOVERY = {
  clone: [
    "Isso ajudaria na sua operação hoje?",
    "Qual a maior dificuldade da sua operação hoje: gerenciar as contas, criar anúncio, estoque ou atendimento?",
    "Hoje você vende em marketplace com conta própria?",
    "Quantas contas de Mercado Livre e Shopee você opera hoje?",
  ],
  oem: [
    "Isso ajudaria na sua operação hoje?",
    "Hoje você monta os anúncios pelo código OEM ou faz tudo manualmente?",
    "Você já vende no Mercado Livre ou Shopee com conta própria?",
    "O que mais trava hoje na hora de cadastrar: ficha, compatibilidade ou fotos?",
  ],
  price: [
    "Isso ajudaria na sua operação hoje?",
    "Hoje sua maior dificuldade está em manter os preços atualizados sem sair da margem?",
    "Você já vende em marketplace com conta própria?",
    "Como você entra nas promoções do Mercado Livre hoje, uma a uma?",
  ],
};
const DISCOVERY_FALLBACK = "Me conta um pouco de como funciona sua operação hoje?";
// "Dia sem hora" (R-031): proposta de dia sem horário ("conseguimos essa
// semana?"). "Hoje" fica de fora: aparece em toda pergunta de descoberta
// ("hoje sua maior dificuldade…?") sem propor dia nenhum.
export const DAY_PROPOSAL_RX = /\b(amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|essa semana|semana que vem|pr[óo]xima semana|outra semana)(?![\p{L}])/iu; // sem \b no fim: "amanhã," não fecha fronteira ASCII
export function discoveryQuestionFor(script, msgs = []) {
  const list = DISCOVERY[script] || DISCOVERY.clone;
  const outs = (msgs || []).filter((m) => m.direction === "out").map((m) => plainReply(m.text || ""));
  const asked = (q) => { const key = plainReply(q).replace(/\?$/, "").slice(0, 28); return outs.some((t) => t.includes(key) || sameSentence(q, t)); };
  return list.find((q) => !asked(q)) || DISCOVERY_FALLBACK;
}

// ── Draft ───────────────────────────────────────────────────────────────────
// { parts: [{ text, kind }], stop?: { result, effects } }
// kind: "ia" (texto do modelo) | "roteiro" (M1-M4/preço do doc) | "confirmacao"
// | "motor" (texto fixo do cérebro) | "trava" (injetado por um validador).
export const makeDraft = (texts, kind = "ia") => ({
  parts: (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || "").trim()).filter(Boolean).map((text) => ({ text, kind })),
});
const texts = (d) => d.parts.map((p) => p.text);
const withParts = (d, parts) => ({ ...d, parts });
const part = (text, kind = "trava", extra = {}) => ({ text, kind, ...extra });
const joined = (d) => texts(d).join(" ");

// Oferta REAL do motor (R-020/R-026): pra onde cai qualquer oferta inventada,
// promessa ou hora pedida que não existe.
export function realOfferOf(ctx) {
  const { suggestedPair = [], wnow, requestedEmpty = false, offerDate = "", dayLabelOf = null } = ctx;
  const lotouDay = requestedEmpty && offerDate && dayLabelOf ? dayLabelOf(offerDate) : "";
  return offerLine(suggestedPair, { style: lotouDay && suggestedPair.length ? "lotou" : "consigo", wnow, lotouDay });
}

// ── Os validadores, em ordem ────────────────────────────────────────────────
export const GUARDS = [
  { id: "priceLeak", rule: "R-050", enforce: true,
    applies: () => true,
    check: (d) => (PRICE_RX.test(joined(d)) ? [{ why: "valor/plano no texto" }] : []),
    fix: (d, ctx) => ({ draft: { ...d, parts: [part(ctx.priceDeferral, "trava")], stop: { result: "preco-travado" } },
      effects: [{ type: "stamp", patch: { priceGuardAt: ctx.nowIso } }] }) },
  { id: "redirect", rule: "R-008", enforce: true,
    applies: () => true,
    check: (d) => (REDIRECT_RX.test(joined(d)) ? [{ why: "manda o lead pra outro número/link" }] : []),
    fix: (d, ctx) => ({ draft: { ...d, parts: [], stop: { result: "redirect-travado" } },
      effects: [
        { type: "alert", text: `Robô tentou mandar o lead pra outro número/link · confundiu o canal, assume: "${String(ctx.inboundText || "").slice(0, 120)}"` },
        { type: "stamp", patch: { handoffAt: ctx.nowIso, redirectGuardAt: ctx.nowIso, handoffKind: "redirect" } },
        { type: "log", level: "warn", msg: "sdr-brain: trava de redirecionamento", data: { texto: joined(d).slice(0, 200) } },
      ] }) },
  { id: "noRepeat", rule: "R-009", enforce: true,
    applies: () => true,
    check: (d, ctx) => d.parts.filter((p) => !p.reask && alreadySaid(p.text, ctx.msgs || []) && !((ctx.requestedDate || ctx.hourReply) && isOfferMsg(p.text)) && !isFreshOffer(p.text, ctx.msgs || [], ctx.nowIso)).map((p) => ({ why: "frase já dita", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const fresh = d.parts.filter((p) => p.reask || !alreadySaid(p.text, ctx.msgs || []) || ((ctx.requestedDate || ctx.hourReply) && isOfferMsg(p.text)) || isFreshOffer(p.text, ctx.msgs || [], ctx.nowIso));
      if (fresh.length) return { draft: withParts(d, fresh), effects: [] };
      if (ctx.inCallWindow) return { draft: { ...d, parts: [], stop: { result: "silencio" } }, effects: [] };
      return { draft: { ...d, parts: [], stop: { result: "repeticao-humano" } }, effects: [
        { type: "alert", text: `Robô sem resposta nova (ia repetir o que já disse) · assume: "${String(ctx.inboundText || "").slice(0, 140)}"` },
        { type: "stamp", patch: { handoffAt: ctx.nowIso, repeatGuardAt: ctx.nowIso, handoffKind: "repeticao" } },
      ] };
    } },
  { id: "slotInList", rule: "R-020", enforce: true,
    applies: () => true,
    check: (d, ctx) => offendingOffers(d, ctx).map((i) => ({ why: "dia/hora fora da lista", part: d.parts[i].text.slice(0, 80) })),
    fix: (d, ctx) => {
      const bad = new Set(offendingOffers(d, ctx));
      if (!bad.size) return { draft: d, effects: [] };
      return { draft: withParts(d, [...d.parts.filter((_, i) => !bad.has(i)), part(realOfferOf(ctx))]), effects: [] };
    } },
  { id: "noSameOfferAfterRefusal", rule: "R-040", enforce: true,
    // Compara HORÁRIOS, não texto: "Fica melhor hoje às 16h ou às 18h?" com
    // outra moldura ainda é o par que o lead acabou de recusar (28/10,
    // Wilian, Alberto, Everton 3x, Alexsandro).
    applies: (ctx) => (ctx.excludeSlots || []).length > 0 || (ctx.refusedDays || []).length > 0,
    check: (d, ctx) => d.parts.filter((p) => SLOTS_RX.test(p.text) && refusedOffer(p.text, ctx)).map((p) => ({ why: "re-oferece o que o lead recusou", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !(SLOTS_RX.test(p.text) && refusedOffer(p.text, ctx)));
      const pair = ctx.suggestedPair || [];
      const real = pair.length && !refusedOffer(offerLine(pair, { wnow: ctx.wnow }), ctx) ? realOfferOf(ctx) : NO_SLOT_TEXT.periodo;
      return { draft: withParts(d, [...kept, part(real)]), effects: [
        { type: "stamp", patch: { refusedOfferGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: "sdr-brain: trava da recusa trocou o par repetido pela agenda real" },
      ] };
    } },
  { id: "noPromise", rule: "R-030", enforce: true,
    // Com call marcada também vale (28/10, Roberto: "te passo as próximas
    // opções" com a call de hoje ainda no card): a promessa cai e a resposta
    // lembra que a conversa segue marcada.
    applies: (ctx, d) => !d.parts.some((p) => isOfferMsg(p.text)),
    check: (d, ctx) => d.parts.filter((p) => p.kind !== "motor" && p.kind !== "trava" && PROMISE_RX.test(p.text) && !HAS_HOUR_RX.test(p.text)).map((p) => ({ why: "promessa de ver depois", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !(p.kind !== "motor" && p.kind !== "trava" && PROMISE_RX.test(p.text) && !HAS_HOUR_RX.test(p.text)));
      const real = ctx.callAt && !ctx.rescheduling
        ? (ctx.callLabel ? `Nossa conversa segue marcada pra ${ctx.callLabel}, qualquer imprevisto me avisa aqui` : "")
        : (ctx.suggestedPair || []).length ? realOfferOf(ctx) : NO_SLOT_TEXT["sem-vaga"];
      return { draft: withParts(d, real ? [...kept, part(real)] : kept), effects: [
        { type: "stamp", patch: { promiseGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: "sdr-brain: trava da promessa trocou o 'te confirmo' pela agenda real" },
      ] };
    } },
  { id: "apologyOnTakenSlot", rule: "R-028", enforce: true,
    applies: () => true,
    check: (d) => d.parts.filter((p) => DRY_REFUSAL_RX.test(p.text)).map((p) => ({ why: "recusa seca de horário", part: p.text.slice(0, 80) })),
    // A desculpa "outro cliente pegou" só vale quando o lead escolheu um
    // horário que a GENTE ofereceu e ele caiu (ctx.takenSlot). Hora que ele
    // pediu e nunca existiu na lista ("pode ser às 12hs?", "oito da noite")
    // recebe a verdade: "às 12h não tenho vaga" + o par real (28/10, Everton,
    // Sérgio, VitorMatheus: a desculpa saía sobre horário que ninguém ofereceu).
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !DRY_REFUSAL_RX.test(p.text));
      const slots = (ctx.suggestedPair || []).length ? ctx.suggestedPair : (ctx.offerPool || []).slice(0, 1);
      const honest = !ctx.takenSlot;
      const line = honest
        ? (ctx.leadHour != null ? offerLine(slots, { style: "sem-vaga-hora", hour: ctx.leadHour, wnow: ctx.wnow }) : realOfferOf(ctx))
        : offerLine(slots, { style: "desculpa", nome: ctx.nome, wnow: ctx.wnow });
      return { draft: withParts(d, [...kept, part(line)]), effects: [
        { type: "stamp", patch: { slotTakenGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: honest ? "sdr-brain: recusa seca virou 'não tenho vaga nessa hora' + oferta real" : "sdr-brain: recusa seca virou desculpa + re-oferta" },
      ] };
    } },
  { id: "lotouWithProof", rule: "R-041", enforce: true,
    // Prova do motor: pedido sem vaga (requestedEmpty), hora pedida fora da
    // lista (hourReply) ou horário escolhido que foi tomado (takenSlot).
    applies: (ctx) => !ctx.requestedEmpty && !ctx.hourReply && !ctx.takenSlot,
    check: (d) => d.parts.filter((p) => p.kind === "ia" && !isOfferMsg(p.text) && LOTOU_CLAIM_RX.test(p.text)).map((p) => ({ why: "diz que lotou sem o motor ter dito", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !(p.kind === "ia" && !isOfferMsg(p.text) && LOTOU_CLAIM_RX.test(p.text)));
      if (!kept.some((p) => isOfferMsg(p.text)) && !ctx.callAt) kept.push(part((ctx.suggestedPair || []).length ? realOfferOf(ctx) : NO_SLOT_TEXT.periodo));
      return { draft: withParts(d, kept), effects: [
        { type: "stamp", patch: { lotouGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: "sdr-brain: trava do 'lotou' sem prova trocou a frase pela oferta real" },
      ] };
    } },
  { id: "noPhantomOffer", rule: "R-029", enforce: true,
    applies: (ctx) => !ctx.slotsOffered,
    check: (d) => d.parts.filter((p) => FAKE_OFFER_RX.test(p.text)).map((p) => ({ why: "cita horários que nunca passou", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const pair = ctx.suggestedPair || [], pool = ctx.offerPool || [];
      const real = pair.length >= 2 ? offerLine(pair, { wnow: ctx.wnow }) : pool.length ? offerLine(pool.slice(0, 1), { wnow: ctx.wnow }) : NO_SLOT_TEXT.periodo;
      return { draft: withParts(d, [...d.parts.filter((p) => !FAKE_OFFER_RX.test(p.text)), part(real)]), effects: [
        { type: "stamp", patch: { fakeOfferGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: "sdr-brain: trava de oferta fantasma trocou a frase pela oferta real" },
      ] };
    } },
  { id: "noDuration", rule: "R-060", enforce: true,
    applies: () => true,
    // Exceção R-070: a M3 do roteiro (kind roteiro) diz a duração por decisão do Leo.
    check: (d) => d.parts.filter((p) => DURATION_CTX_RX.test(p.text) && DURATION_RX.test(p.text)).map((p) => ({ why: "duração da conversa", part: p.text.slice(0, 80), exempt: p.kind === "roteiro" })),
    fix: (d) => {
      const podadas = d.parts.map((p) => (p.kind === "roteiro" ? p : { ...p, text: stripDuration(p.text) })).filter((p) => p.text);
      if (podadas.map((p) => p.text).join("\n") === texts(d).join("\n")) return { draft: d, effects: [] };
      return { draft: withParts(d, podadas), effects: [{ type: "log", level: "info", msg: "sdr-brain: trava de duração tirou o tempo da conversa" }] };
    } },
  { id: "noDeviceAsk", rule: "R-061", enforce: true,
    applies: () => true,
    // Duas faces da R-061: a pergunta não sai; e lead que falou em celular ouve
    // a dica do computador uma vez (sem ela, a resposta está incompleta).
    check: (d, ctx) => [
      ...d.parts.filter((p) => DEVICE_ASK_RX.test(p.text)).map((p) => ({ why: "pergunta celular ou computador", part: p.text.slice(0, 80) })),
      ...(needsDeviceTip(d, ctx) ? [{ why: "lead no celular sem a dica do computador" }] : []),
    ],
    fix: (d, ctx) => {
      const sem = d.parts.map((p) => (DEVICE_ASK_RX.test(p.text) ? { ...p, text: stripDeviceAsk(p.text) } : p)).filter((p) => p.text);
      const jaRecomendou = (ctx.msgs || []).some((m) => m.direction === "out" && /computador por perto/i.test(m.text || ""));
      const leadNoCelular = LEAD_MOBILE_RX.test(ctx.lastInText || "");
      if (leadNoCelular && !jaRecomendou && !sem.some((p) => /computador/i.test(p.text))) {
        if (sem.length >= 3) sem[0] = { ...sem[0], text: `${sem[0].text}. ${DEVICE_TIP}` };
        else sem.splice(1, 0, part(DEVICE_TIP));
      }
      if (sem.map((p) => p.text).join("\n") === texts(d).join("\n")) return { draft: d, effects: [] };
      return { draft: withParts(d, sem.length ? sem : [part(DEVICE_TIP)]), effects: [{ type: "log", level: "info", msg: "sdr-brain: trava celular × computador" }] };
    } },
  { id: "noOfferBeforeEngaged", rule: "R-011", enforce: true,
    applies: (ctx) => !ctx.engaged && !ctx.callAt,
    check: (d) => d.parts.filter((p) => SLOTS_RX.test(p.text)).map((p) => ({ why: "horário antes da descoberta", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !SLOTS_RX.test(p.text));
      const effects = [{ type: "log", level: "info", msg: "sdr-brain: trava de qualificação tirou a oferta de horário" }];
      if (!kept.some((p) => isRealQuestion(p.text))) kept.push(...nextQuestion(ctx, effects));
      return { draft: withParts(d, kept), effects };
    } },
  { id: "noOfferWhenPostponed", rule: "R-084", enforce: true,
    // "Estou em viagem", "te aviso", "vou ver com meu sócio": sem oferta em
    // cima do adiamento (29/10, Ariel levou "fica melhor amanhã às 13h ou 16h?").
    applies: (ctx) => !!ctx.postponed && !ctx.callAt,
    check: (d) => d.parts.filter((p) => isOfferMsg(p.text)).map((p) => ({ why: "oferta em cima do adiamento", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !isOfferMsg(p.text));
      if (!kept.length) kept.push(part(`Combinado${ctx.nome ? ` ${ctx.nome}` : ""}, quando der me chama aqui que a gente combina a demonstração`));
      return { draft: withParts(d, kept), effects: [{ type: "log", level: "info", msg: "sdr-brain: adiamento do lead tirou a oferta" }] };
    } },
  { id: "noOfferWithCall", rule: "R-038", enforce: true,
    // Conversa já marcada e sem pedido de remarcação: horário novo não sai
    // (28/10, Roberto: "estou em viagem" e o robô ofereceu hoje às 15h ou 17h
    // com a call de hoje no card).
    applies: (ctx) => !!ctx.callAt && !ctx.rescheduling,
    check: (d) => d.parts.filter((p) => isOfferMsg(p.text)).map((p) => ({ why: "oferta de horário com conversa marcada", part: p.text.slice(0, 80) })),
    fix: (d, ctx) => {
      const kept = d.parts.filter((p) => !isOfferMsg(p.text));
      if (!kept.length && ctx.callLabel) kept.push(part(`Nossa conversa segue marcada pra ${ctx.callLabel}, qualquer imprevisto me avisa aqui`));
      if (!kept.length) return { draft: { ...d, parts: [], stop: { result: "silencio" } }, effects: [] };
      return { draft: withParts(d, kept), effects: [{ type: "log", level: "info", msg: "sdr-brain: trava da call marcada tirou a oferta de horário" }] };
    } },
  { id: "earliestFirst", rule: "R-022", enforce: true,
    applies: (ctx) => !ctx.callAt && (ctx.suggestedPair || []).length > 0 && !PERIOD_ASK_RX.test(ctx.lastInText || "") && !DAY_WORD_RX.test(ctx.lastInText || "") && !HAS_HOUR_RX.test(ctx.lastInText || ""),
    check: (d, ctx) => {
      const idx = d.parts.findIndex((p) => isOfferMsg(p.text));
      return idx >= 0 && !d.parts[idx].text.includes(ctx.suggestedPair[0].label) ? [{ why: "oferta pula o mais cedo", part: d.parts[idx].text.slice(0, 80) }] : [];
    },
    fix: (d, ctx) => {
      const idx = d.parts.findIndex((p) => isOfferMsg(p.text));
      const parts = d.parts.slice();
      parts[idx] = part(offerLine(ctx.suggestedPair, { wnow: ctx.wnow }));
      return { draft: withParts(d, parts), effects: [
        { type: "stamp", patch: { earliestGuardAt: ctx.nowIso } },
        { type: "log", level: "info", msg: "sdr-brain: trava do mais cedo primeiro reescreveu a oferta" },
      ] };
    } },
  { id: "nextStep", rule: "R-031", enforce: true,
    // TODA RESPOSTA AVANÇA (28/10): antes só valia com interesse na última
    // mensagem; "Conta jurídica" → "Perfeito Kelly" e fim passava limpo
    // (21 becos no raio-x). Agora vale sem call marcada, fora da janela da
    // call, salvo despedida/adiamento/desinteresse do lead ou texto do form.
    applies: (ctx) => !ctx.callAt && !ctx.inCallWindow && !FORM_MSG_RX.test(ctx.lastInText || "") && !ctx.closing && !ctx.postponed && !ctx.noInterest && !ctx.handoff,
    check: (d) => {
      const semSaida = !d.parts.some((p) => isRealQuestion(p.text) || isOfferMsg(p.text));
      const diaSemHora = DAY_PROPOSAL_RX.test(joined(d)) && !HAS_HOUR_RX.test(joined(d));
      return semSaida || diaSemHora ? [{ why: semSaida ? "sem pergunta nem próximo passo" : "dia sem hora" }] : [];
    },
    fix: (d, ctx) => {
      const effects = [{ type: "log", level: "info", msg: "sdr-brain: trava de beco emendou o próximo passo" }];
      const parts = d.parts.slice();
      if (!ctx.engaged) {
        // Lead ainda não engajou: a saída é pergunta (pendente ou de descoberta), nunca horário.
        parts.push(...nextQuestion(ctx, effects));
        return { draft: withParts(d, parts), effects };
      }
      const pair = ctx.suggestedPair || [], pool = ctx.offerPool || [];
      const push = ctx.slotsOffered && pair.length >= 2 ? offerLine(pair, { style: "fica-melhor", wnow: ctx.wnow })
        : pair.length >= 2 ? offerLine(pair, { wnow: ctx.wnow })
          : pool.length ? offerLine(pool.slice(0, 1), { wnow: ctx.wnow }) : NO_SLOT_TEXT["periodo-costuma"];
      if (parts.length >= 3) parts[2] = { ...parts[2], text: `${parts[2].text} ${push}` };
      else parts.push(part(push));
      return { draft: withParts(d, parts), effects };
    } },
  { id: "oneOfferPerReply", rule: "R-026", enforce: true,
    applies: () => true,
    check: (d) => {
      const offers = d.parts.filter((p) => isOfferMsg(p.text)).length;
      const loose = offers > 0 && d.parts.some((p) => !isOfferMsg(p.text) && SCHEDULE_ASK_Q_RX.test(p.text));
      return offers > 1 ? [{ why: `${offers} ofertas na mesma resposta` }] : loose ? [{ why: "pergunta solta de dia ao lado da oferta" }] : [];
    },
    fix: (d) => {
      const offers = d.parts.map((p, i) => (isOfferMsg(p.text) ? i : -1)).filter((i) => i >= 0);
      if (!offers.length) return { draft: d, effects: [] };
      const keep = offers[offers.length - 1];
      const trimmed = d.parts.filter((p, i) => i === keep || (!isOfferMsg(p.text) && !SCHEDULE_ASK_Q_RX.test(p.text)));
      if (trimmed.length === d.parts.length) return { draft: d, effects: [] };
      return { draft: withParts(d, trimmed), effects: [{ type: "log", level: "info", msg: "sdr-brain: uma oferta por resposta" }] };
    } },
  // Só auditoria (sem fix até o PR5): a palavra "call", mais de uma pergunta,
  // e o orçamento de balões.
  { id: "noCallWord", rule: "R-006", enforce: false,
    applies: () => true,
    check: (d) => d.parts.filter((p) => CALL_WORD_RX.test(p.text)).map((p) => ({ why: "\"call\" pro lead", part: p.text.slice(0, 80) })) },
  { id: "singleQuestion", rule: "R-003", enforce: false,
    applies: () => true,
    // Saudação com "?" ("tudo bem?") não conta como pergunta (28/10).
    check: (d) => { const n = (joined(d).replace(/[^?]*\?/g, (m) => (GREETING_Q_RX.test(m) ? "" : m)).match(/\?/g) || []).length; return n > 1 ? [{ why: `${n} perguntas na mesma resposta` }] : []; } },
  { id: "budget", rule: "R-003", enforce: false,
    applies: () => true,
    check: (d) => [...(d.parts.length > 3 ? [{ why: `${d.parts.length} balões` }] : []), ...d.parts.filter((p) => p.text.length > 900).map((p) => ({ why: "balão com mais de 900 caracteres" }))] },
];
export const guardById = (id) => GUARDS.find((g) => g.id === id) || null;

// Próxima pergunta do motor quando a resposta ficou sem saída e o lead ainda
// não engajou: a pergunta PENDENTE (R-047, refeita uma vez, isenta da R-009)
// ou a de descoberta que ainda não foi feita (R-011/R-012).
export function nextQuestionFor(ctx) {
  if (ctx.pendingQuestion && ctx.pendingQuestionId) return { text: ctx.pendingQuestion, reask: true };
  return { text: ctx.discoveryQuestion || DISCOVERY_FALLBACK, reask: false };
}
function nextQuestion(ctx, effects) {
  const nq = nextQuestionFor(ctx);
  if (nq.reask) effects.push({ type: "stamp", patch: { reaskedFor: ctx.pendingQuestionId } });
  return [part(nq.text, "trava", nq.reask ? { reask: true } : {})];
}

// A oferta no texto só tem horários que o lead recusou (R-040)? Lê os slots
// de volta do texto com a mesma régua da cobrança (offeredSlotsIn), relativo
// a agora.
function refusedOffer(text, ctx) {
  const slots = slotsInText(text, ctx.nowIso || new Date().toISOString());
  if (!slots.length) return false;
  const exclude = new Set(ctx.excludeSlots || []);
  const refusedDays = new Set(ctx.refusedDays || []);
  return slots.every((s) => exclude.has(s.at) || refusedDays.has(s.at.slice(0, 10)));
}

// Lead disse que vai pelo celular, ninguém recomendou o computador ainda e a
// resposta não fala em computador: falta a dica (R-061).
function needsDeviceTip(d, ctx) {
  const jaRecomendou = (ctx.msgs || []).some((m) => m.direction === "out" && /computador por perto/i.test(m.text || ""));
  const sem = d.parts.map((p) => (DEVICE_ASK_RX.test(p.text) ? stripDeviceAsk(p.text) : p.text)).filter(Boolean);
  return LEAD_MOBILE_RX.test(ctx.lastInText || "") && !jaRecomendou && !sem.some((t) => /computador/i.test(t));
}

// Ofertas com dia/hora fora da lista autorizada (R-020). Replica a conferência
// do cérebro: rótulo fora de allowedLabels ou dia fora de allowedDays; com call
// marcada só a parte que É oferta (OFFER_CUE_RX) é conferida.
function offendingOffers(d, ctx) {
  const slotList = ctx.slotList || [];
  const allowedLabels = new Set(slotList.map((s) => String(s.label || "").toLowerCase()));
  const allowedDays = new Set(slotList.map((s) => String(s.at || "").slice(0, 10)));
  const out = [];
  d.parts.forEach((p, i) => {
    const mentions = [...expandSameDay(p.text).matchAll(OFFER_MENTIONS_RX)];
    const offeredWindow = ctx.wnow ? sdrAgendaWindow([{ direction: "in", text: p.text }], ctx.wnow) : { requested: false };
    // Só DIA citado fora da lista é oferta errada; a pergunta de período
    // ("manhã ou tarde?") não cita dia nenhum (28/10: ela caía aqui).
    const wrongDay = offeredWindow.requested && !offeredWindow.periodOnly && !allowedDays.has(offeredWindow.startDate);
    if ((!ctx.callAt || OFFER_CUE_RX.test(p.text)) && (mentions.some((m) => !allowedLabels.has(m[0].toLowerCase())) || wrongDay)) out.push(i);
  });
  return out;
}

// Roda os validadores em ordem. `audit`: só check. `enforce`: check + fix dos
// que têm enforce (ou todos, se `force`), parando no primeiro `stop`.
export function validateDraft(draft, ctx, { mode = "audit", force = false } = {}) {
  let d = { ...draft, parts: (draft.parts || []).map((p) => ({ ...p })) };
  const fired = [], violations = [], effects = [];
  if (!d.parts.length) return { draft: d, fired, violations, residual: [], effects };
  for (const g of GUARDS) {
    if (!g.applies(ctx, d)) continue;
    const found = g.check(d, ctx);
    if (!found.length) continue;
    fired.push(g.id);
    violations.push(...found.map((v) => ({ ...v, guard: g.id, rule: g.rule })));
    if (mode !== "enforce" || !g.fix || !(g.enforce || force)) continue;
    if (found.every((v) => v.exempt)) continue;
    const r = g.fix(d, ctx);
    d = r.draft;
    effects.push(...(r.effects || []));
    if (d.stop) break;
  }
  const residual = d.stop ? [] : GUARDS.flatMap((g) => (g.applies(ctx, d) ? g.check(d, ctx).map((v) => ({ ...v, guard: g.id, rule: g.rule })) : []));
  return { draft: d, fired, violations, residual, effects };
}
