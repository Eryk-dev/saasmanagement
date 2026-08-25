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
import { kindOf, firstStage, isNoShowStage, isWonLead } from "./stages.js";
import { brtToIso, onOutboundMessage } from "./lead-flow.js";
import { isBusinessHours } from "./business-hours.js";
import { resolveWabaId, getWaHealth } from "./wa-health.js";
import { raiseAlert } from "./wa-call-flow.js";
import { slotsForLead, slotLabel, wallNow, spreadPair, OFFER_HOURS, activeHolds, holdSlots, withoutHeld } from "./agenda-slots.js";
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
// Hash estável de string (FNV-1a) — o mesmo lead cai sempre no mesmo atraso e
// no mesmo template, sem guardar sorteio nenhum.
const hashInt = (s) => {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
};
const jitterMs = (id) => (hashInt(id) % SECOND_TOUCH_JITTER_MIN) * MIN;
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
    // Segundo toque: 1º toque há 24h sem NENHUMA resposta → re-toque único, em
    // horário comercial, com a retomada que a Manuela já manda na mão (Leo, 23/08).
    // Acompanha a chave do 1º toque; `secondTouch: false` desliga só ele.
    secondTouch: cfg.secondTouch == null ? cfg.firstTouch !== false : cfg.secondTouch === true,
    // Campanha de resgate do backlog (Qualificando + Nutrição): lotes de
    // perBatch a cada meia hora das janelas configuradas, dias úteis, mais
    // novos primeiro. Nasce DESLIGADA: é campanha, não régua permanente.
    backlogRescue: cfg.backlogRescue === true,
    backlogRescuePerBatch: num(cfg.backlogRescuePerBatch, 100),
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
    const stats = { firstTouch: 0, secondTouch: 0, reminders: 0, rescue: 0, backlogRescue: 0, skipped: 0 };
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
              const pair = spreadPair(withoutHeld(slots, holds, lead.id));
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
            await stampLog(lead, { noshowFor: lead.stageSince, noshowVia: via });
          } catch (err) {
            log.warn?.({ lead: lead.id, err: err.message }, "sdr: resgate de no-show falhou");
            await stampLog(lead, { noshowFor: lead.stageSince, noshowVia: "erro:" + String(err.message || err).slice(0, 120) });
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
        // Pausa pela saúde: sinais DE ENVIO (número sinalizado pela Meta ou
        // template do resgate com qualidade vermelha). A violação antiga da
        // CONTA (ligações, removidas em 22/08) não trava a campanha — ela já
        // aparece na régua de saúde do inbox pro time acompanhar.
        const health = await getWaHealth(repo).catch(() => null);
        const tplQ4 = (n) => String(health?.templates?.[n]?.quality || "").toUpperCase();
        if (String(health?.number?.event || "").toUpperCase() === "FLAGGED"
          || tplQ4(cfg.templates.backlogRescue) === "RED" || tplQ4(cfg.templates.backlogRescueNutri) === "RED") {
          log.warn?.({ saas: product.id }, "sdr: resgate do backlog pausado (número sinalizado ou template vermelho)");
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
        const pool = allLeads
          .filter((l) => (l.saas || "") === product.id)
          .filter((l) => okLead(l) && !l.callAt && !isWonLead(product, l) && !isNoShowStage(l.stage))
          .filter((l) => !l.sdrLog?.backlogRescueAt && !l.sdrLog?.secondTouchAt && !l.sdrLog?.sendFailedAlertAt)
          .filter((l) => { const ft = Date.parse(l.sdrLog?.firstTouchAt || ""); return !(Number.isFinite(ft) && nowMs - ft < SECOND_TOUCH_MAX_MS); })
          .map((l) => ({ l, kind: kindOf(product, l.stage || firstStage(product)) }))
          .filter((x) => x.kind === "qualificacao" || x.kind === "contato")
          .sort((a, b) => (a.kind === b.kind
            ? String(b.l.createdAt || "").localeCompare(String(a.l.createdAt || ""))
            : a.kind === "qualificacao" ? -1 : 1));
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
