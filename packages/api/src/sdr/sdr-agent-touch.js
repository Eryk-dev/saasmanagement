// TOQUES DO AGENTE SDR EXTERNO: o relógio do SDR proativo (decisões do Eryk de
// 27/11/2026, números 26 a 33). O agente do OpenBot só falava quando o lead
// escrevia; com a chave ligada ele também toma a iniciativa em horário certo:
// confirma a demonstração, manda o case do nicho a quem confirmou, o link da
// sala, e reativa quem recebeu os horários e sumiu.
//
// QUEM DECIDE A HORA É ESTE ARQUIVO, não o modelo. A cada ciclo do motor
// (sdr-flow.js, seção 0) o plano do lead diz qual toque está na vez; o pedido
// vira uma linha em `sdr_touches` (estado "pedido"), a porta do SDR (VPS2)
// entrega como job ao agente, e o agente escreve e devolve pela rota
// POST /api/sdr/agent/leads/:id/touch (sdr-agent.js). Cada linha é também o
// registro do toque (contrato entre os robôs, interface 6): o Analista lê daqui.
//
// SEM DOBRA E SEM BURACO (decisão 29). O toque que toma o lugar de um lembrete
// fixo (manhã, 2h, 10min) RESERVA esse passo no confirmLog com o prazo do
// agente ("agente:ate:<iso>"). Enquanto o prazo corre, o lembrete fixo espera;
// entregue, o passo fica carimbado com a hora e o fixo não sai; vencido sem
// entrega (agente fora, porta fora, modelo travado) ou com a chave desligada,
// o passo volta ao fluxo e o lembrete fixo sai dali em diante. Janela de 24h
// fechada: texto livre não passa na Meta, o toque nem é pedido e o fixo
// (template aprovado) segue como sempre.
//
// Chave: sdrBot.agentTouch (todos os leads do agente) ou sdrBot.agentTouchLeads
// (ids, pra teste). Desligada, nada aqui roda e o motor é exatamente o de antes.
import { brtToIso, applyStageMove } from "../crm/lead-flow.js";
import { wallNow } from "../crm/agenda-slots.js";
import { kindOf, firstStage, isWonLead, isNoShowStage } from "../crm/stages.js";
import { NOMES_DIAS, ETAPA_NUTRICAO } from "../crm/cadencia-stages.js";
import { isNationalHoliday } from "../shared/holidays.js";
import { lastWindowInbound } from "./sdr-signals.js";
import { humanMuteHolds, callbackPending } from "./sdr-state.js";
import { POSTPONE_RX, NO_INTEREST_RX, plainReply } from "./sdr-intents.js";
import { SDR_AUTHOR, touchOn } from "./sdr-flow.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const TOUCH_KINDS = ["confirmacao_vespera", "confirmacao_dia", "segunda_confirmacao", "case", "link_sala", "reativacao_1", "reativacao_2"];
// Reunião antes das 10h é "cedo" (decisão 27): confirma às 19h da véspera, com o
// case junto, e de novo no dia, 1 hora antes.
const EARLY_BEFORE_MIN = 10 * 60;
const VESPERA = "19:00", VESPERA_UNTIL = "21:00";
const MORNING = "08:00", SECOND = "10:00";
const SPREAD_MIN = 10;               // 8h e 19h espalham os leads em 10 min (rajada idêntica a Meta lê como spam)
const DEADLINE_MS = 20 * MIN;        // prazo do agente pra entregar o toque
const LINK_AT_MS = 11 * MIN;         // o link sai 10 min antes (decisão 26): pedido aos 11, prazo aos 6
const LINK_DEADLINE_MS = 6 * MIN;
const CASE_BEFORE_MS = 2 * HOUR;     // case 2h antes, só pra quem confirmou (decisão 26)
const CASE_LAST_MS = 30 * MIN;       // a menos de 30 min da reunião o case não sai mais
const WINDOW_MARGIN_MS = 15 * MIN;   // a janela de 24h tem de durar o bastante pro agente escrever
const LIVE_MS = 30 * MIN;            // lead falou há menos disso: o toque espera a conversa assentar
const REACT_MIN_GAP_MS = 6 * HOUR;   // "manhã seguinte" = a primeira manhã útil 6h ou mais depois da oferta
const REACT_START = "09:00", REACT_UNTIL = "11:30", REACT_SPREAD_MIN = 40;
const REACT2_DAYS = 2;               // "mais uma dois dias depois" (decisão 30)
const NURTURE_AFTER_MS = 48 * HOUR;  // sem resposta depois da segunda: Nutrição (a mesma folga da escada)
// Estados de uma linha de sdr_touches: pedido (com o agente), enviado, absorvido
// (o lead escreveu e a conversa viva cobre o toque), silencio (o agente decidiu
// não mandar), pulado (não dava: o motivo diz por quê), expirado (o agente não
// entregou no prazo: o lembrete fixo reservado sai no lugar).
const SENT = new Set(["enviado", "absorvido"]);
// Toque que, sem entrega, devolve o passo ao lembrete fixo (o lead não pode
// ficar sem confirmação nem sem link). Os outros são a mais: sem entrega, nada.
export const FALLBACK_KINDS = new Set(["confirmacao_dia", "segunda_confirmacao", "link_sala"]);

const SLOT_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const hashInt = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); };
const ms = (naive) => Date.parse(brtToIso(naive));            // "YYYY-MM-DDTHH:MM" de Brasília → epoch
const ymdPlus = (ymd, days) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const wallYmd = (epoch) => wallNow(new Date(epoch)).toISOString().slice(0, 10);
const minutesOf = (naive) => Number(naive.slice(11, 13)) * 60 + Number(naive.slice(14, 16));
const sentStamp = (v) => typeof v === "string" && /^20\d\d-/.test(v);       // o passo SAIU (carimbo com hora), não é pulo nem reserva
export const isBusinessDay = (ymd) => { const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return dow >= 1 && dow <= 5 && !isNationalHoliday(ymd); };
const nextBusinessDay = (ymd) => { let d = ymd; for (let i = 0; i < 10 && !isBusinessDay(d); i++) d = ymdPlus(d, 1); return d; };

export const touchId = (leadId, key) => `${leadId}:${key}`;
// Quando cada passo do lembrete fixo sairia (a mesma conta de sdr-flow.js, seção 2).
export function reminderFireMs(callAt, step) {
  if (step === "manha") return ms(`${callAt.slice(0, 10)}T${MORNING}`);
  if (step === "2h") return ms(callAt) - 2 * HOUR;
  if (step === "10min") return ms(callAt) - 10 * MIN;
  return NaN;
}

// ── a reserva do passo no confirmLog ──────────────────────────────────────
const CLAIM = "agente:ate:";
export const ABSORBED = "agente:absorvido";       // a conversa viva cobriu o passo: o fixo não sai
export const claimUntil = (v) => (typeof v === "string" && v.startsWith(CLAIM) ? Date.parse(v.slice(CLAIM.length)) : NaN);
export const claimValue = (untilMs) => CLAIM + new Date(untilMs).toISOString();
// O passo está com o agente (reservado até o prazo, ou coberto pela conversa
// viva)? Não é lembrete enviado: ninguém pediu a confirmação ao lead ainda.
export const agentHeld = (v) => typeof v === "string" && v.startsWith("agente:");
// Chamado pelos lembretes (sdr-flow.js, seção 2) antes de qualquer conta: a
// reserva vencida, ou de lead que saiu do proativo, é apagada e o passo volta
// ao fluxo, com o horário empurrado pro fim do prazo (`agenteLiberou`), pra
// que o lembrete fixo ainda saia (fallback) mesmo depois da tolerância normal.
// Reserva viva fica: o passo está "feito" pro motor até o prazo.
export function releaseAgentClaims(log0, { on, nowMs }) {
  let changed = false;
  for (const step of ["manha", "2h", "10min"]) {
    const until = claimUntil(log0[step]);
    const absorbedOff = log0[step] === ABSORBED && !on;
    if (!Number.isFinite(until) && !absorbedOff) continue;
    if (on && nowMs < until) continue;
    delete log0[step];
    log0.agenteLiberou = { ...(log0.agenteLiberou || {}), [step]: new Date(Number.isFinite(until) ? Math.min(until, nowMs) : nowMs).toISOString() };
    changed = true;
  }
  return changed;
}
// Horário efetivo do passo depois de uma reserva que não foi entregue.
export function releasedFireMs(log0, step, fireMs) {
  const back = Date.parse(log0?.agenteLiberou?.[step] || "");
  return Number.isFinite(back) ? Math.max(fireMs, back) : fireMs;
}

// ── o plano ───────────────────────────────────────────────────────────────
// Os toques possíveis no momento do lead, cada um com a hora em que sai
// (`atMs`), até quando ainda vale pedir (`untilMs`), o prazo do agente
// (`deadlineMs`) e os passos do lembrete fixo que ele substitui (`covers`).
// Não olha janela nem quem falou: isso é `blockedReason`, na hora do pedido.
export function touchPlan({ lead, product, recs = [], nowMs }) {
  const rec = (tipo, anchor) => recs.find((r) => r.tipo === tipo && r.anchor === anchor);
  return planAll({ lead, product, recs, nowMs, rec }).filter((t) => !rec(t.tipo, t.anchor));     // um toque por chave, pra sempre
}
function planAll({ lead, product, recs, nowMs, rec }) {
  const out = [];
  const kind = kindOf(product, lead.stage || firstStage(product));
  const callAt = String(lead.callAt || "");
  if (kind === "call" && SLOT_RX.test(callAt)) {
    const callMs = ms(callAt);
    if (!(callMs > nowMs)) return out;
    const day = callAt.slice(0, 10);
    const early = minutesOf(callAt) < EARLY_BEFORE_MIN;
    const log0 = lead.confirmLog && lead.confirmLog.at === callAt ? lead.confirmLog : {};
    const setMs = Date.parse(lead.callSetAt || "") || 0;
    const confirmed = !!(lead.callConfirmed || log0.confirmed);
    const spread = (hashInt(lead.id) % SPREAD_MIN) * MIN;
    const base = { callAt, anchor: callAt };
    // Passo fixo que já SAIU antes de o proativo assumir: o toque que o
    // substituiria não sai por cima (o lead não recebe em dobro).
    const fixedSent = (steps) => steps.some((s) => sentStamp(log0[s]) && !rec(s === "10min" ? "link_sala" : "confirmacao_dia", callAt));
    if (early) {
      const vesp = ms(`${ymdPlus(day, -1)}T${VESPERA}`) + spread;
      if (setMs < vesp - 30 * MIN) out.push({ ...base, tipo: "confirmacao_vespera", atMs: vesp, untilMs: ms(`${ymdPlus(day, -1)}T${VESPERA_UNTIL}`), deadlineMs: vesp + DEADLINE_MS, covers: [], withCase: true });
      const dia = callMs - HOUR;
      if (!confirmed && setMs < dia - 30 * MIN && !fixedSent(["manha", "2h"])) out.push({ ...base, tipo: "confirmacao_dia", atMs: dia, untilMs: dia + 30 * MIN, deadlineMs: dia + DEADLINE_MS, covers: ["manha", "2h"], withCase: false });
    } else {
      const dia = ms(`${day}T${MORNING}`) + spread;
      if (!confirmed && setMs < ms(`${day}T${MORNING}`) - 30 * MIN && !fixedSent(["manha"])) out.push({ ...base, tipo: "confirmacao_dia", atMs: dia, untilMs: dia + HOUR, deadlineMs: dia + DEADLINE_MS, covers: ["manha"], withCase: false });
      // Segunda mensagem 2 horas depois pra quem não respondeu (decisão 26),
      // nunca a menos de 1 hora da reunião (reunião às 10h: a segunda é às 9h).
      const first = rec("confirmacao_dia", callAt);
      const askedMs = first && SENT.has(first.estado) ? Date.parse(first.enviadoEm || first.atualizadoEm || "") : sentStamp(log0.manha) ? Date.parse(log0.manha) : NaN;
      const seg = Math.min(ms(`${day}T${SECOND}`), callMs - HOUR);
      if (!confirmed && Number.isFinite(askedMs) && !sentStamp(log0["2h"])) out.push({ ...base, tipo: "segunda_confirmacao", atMs: seg, untilMs: seg + 30 * MIN, deadlineMs: seg + DEADLINE_MS, covers: ["2h"], withCase: false, askedMs });
    }
    // Case só pra quem confirmou, 2h antes; reunião de manhã: logo depois da
    // confirmação. Quem já recebeu um case pra esta reunião (a véspera da
    // reunião cedo leva) não recebe outro.
    const caseSent = recs.some((r) => r.anchor === callAt && r.case && SENT.has(r.estado));
    const confirmedMs = Date.parse(log0.confirmed || "") || 0;
    if (confirmed && !caseSent) {
      const at = Math.max(callMs - CASE_BEFORE_MS, confirmedMs + MIN);
      if (at <= callMs - CASE_LAST_MS) out.push({ ...base, tipo: "case", atMs: at, untilMs: callMs - CASE_LAST_MS, deadlineMs: at + DEADLINE_MS, covers: [], withCase: true });
    }
    if (lead.callUrl && !sentStamp(log0["10min"])) out.push({ ...base, tipo: "link_sala", atMs: callMs - LINK_AT_MS, untilMs: callMs - LINK_DEADLINE_MS - MIN, deadlineMs: callMs - LINK_DEADLINE_MS, covers: ["10min"], withCase: false });
    return out;
  }
  // REATIVAÇÃO (decisões 30 e 31): só quem recebeu os horários do agente e
  // sumiu. Não vale depois de falta, com demonstração marcada nem fora da
  // qualificação; desinteresse, "vou ver com meu sócio" e retorno combinado
  // são barrados na hora do pedido (`blockedReason`).
  if (callAt || isWonLead(product, lead) || isNoShowStage(lead.stage) || lead.sdrLog?.noshowFor) return out;
  if (!["novo", "qualificacao"].includes(kind) && !NOMES_DIAS.includes(lead.stage)) return out;
  const offerAt = String(lead.sdrLog?.agentOfferAt || "");
  const offerMs = Date.parse(offerAt);
  if (!Number.isFinite(offerMs)) return out;
  const spread = (hashInt(lead.id) % REACT_SPREAD_MIN) * MIN;
  const morning = (ymd) => ms(`${ymd}T${REACT_START}`) + spread;
  let day1 = nextBusinessDay(wallYmd(offerMs));
  if (morning(day1) < offerMs + REACT_MIN_GAP_MS) day1 = nextBusinessDay(ymdPlus(day1, 1));
  const at1 = morning(day1);
  const base = { anchor: offerAt, callAt: "", offerMs };
  out.push({ ...base, tipo: "reativacao_1", atMs: at1, untilMs: ms(`${day1}T${REACT_UNTIL}`), deadlineMs: at1 + DEADLINE_MS, covers: [], withCase: true });
  const r1 = rec("reativacao_1", offerAt);
  if (r1?.estado === "enviado") {
    const sentMs = Date.parse(r1.enviadoEm || "");
    const day2 = nextBusinessDay(ymdPlus(wallYmd(sentMs), REACT2_DAYS));
    const at2 = morning(day2);
    out.push({ ...base, tipo: "reativacao_2", atMs: at2, untilMs: ms(`${day2}T${REACT_UNTIL}`), deadlineMs: at2 + DEADLINE_MS, covers: [], withCase: false, template: true, sinceMs: sentMs });
  }
  return out;
}

// Por que o toque não pode ser pedido AGORA ("" = pode). As mesmas cercas da
// rota do agente (sdr-agent.js), mais as do proativo.
export function blockedReason(touch, { lead, product, cfg, msgs = [], humanIds = new Set(), nowMs }) {
  if (!touchOn(cfg, lead)) return "desligado";
  if (lead.formExit || lead.disqualified || lead.whatsappOptOut || lead.whatsappInvalid) return "fora";
  if (lead.sdrOff) return "parado";
  if (callbackPending(lead, nowMs)) return "retorno_combinado";
  if (touch.callAt) {
    if (lead.callAt !== touch.callAt) return "remarcada";
    if (ms(touch.callAt) <= nowMs) return "passou";
    if (kindOf(product, lead.stage) !== "call") return "fora_da_etapa";
    const log0 = lead.confirmLog && lead.confirmLog.at === lead.callAt ? lead.confirmLog : {};
    if (log0.rescheduleAskedAt && touch.tipo !== "link_sala") return "pediu_remarcar";
    if (["confirmacao_dia", "segunda_confirmacao"].includes(touch.tipo) && (lead.callConfirmed || log0.confirmed)) return "ja_confirmou";
    if (touch.tipo === "case" && !(lead.callConfirmed || log0.confirmed)) return "nao_confirmou";
  } else if (lead.sdrLog?.noInterestAt && Date.parse(lead.sdrLog.noInterestAt) >= touch.offerMs - DAY) {
    return "sem_interesse";
  }
  const lastHuman = [...msgs].reverse().find((m) => m.direction === "out" && humanIds.has(m.author));
  if (humanMuteHolds(cfg, lastHuman, nowMs)) return "humano_ativo";
  const lastIn = lastWindowInbound(msgs);
  const inMs = lastIn ? Date.parse(lastIn.at || 0) : NaN;
  if (!touch.template && (!Number.isFinite(inMs) || inMs + DAY - nowMs < WINDOW_MARGIN_MS)) return "janela_fechada";
  if (touch.tipo === "segunda_confirmacao" && msgs.some((m) => m.direction === "in" && Date.parse(m.at || 0) > touch.askedMs)) return "respondeu";
  if (touch.tipo === "reativacao_1" || touch.tipo === "reativacao_2") {
    const lastOut = [...msgs].reverse().find((m) => m.direction === "out");
    if (!lastOut || lastOut.author !== SDR_AUTHOR || Date.parse(lastOut.at || 0) < touch.offerMs - MIN) return "conversa_andou";
    const since = touch.tipo === "reativacao_1" ? touch.offerMs - MIN : touch.sinceMs;
    if (msgs.some((m) => Date.parse(m.at || 0) > since && (m.direction === "in" || humanIds.has(m.author)))) return "respondeu";
    // O motor fixo já tocou este lead depois da oferta (cobrança da oferta, 2º
    // toque, escada: tudo "via flow"), por exemplo com a chave ligada no meio
    // da manhã: a reativação não sai por cima.
    if (msgs.some((m) => m.direction === "out" && m.via === "flow" && Date.parse(m.at || 0) > since)) return "ja_cobrado";
    const before = [...msgs].reverse().find((m) => m.direction === "in" && Date.parse(m.at || 0) <= touch.offerMs);
    const said = plainReply(before?.transcript || before?.text || "");
    if (POSTPONE_RX.test(said) || NO_INTEREST_RX.test(said)) return "adiou";
    return "";
  }
  // O lead acabou de falar: quem responde é o atendimento, que já vê a reunião.
  // O toque espera a conversa assentar (ou, no fim do prazo, é absorvido por ela).
  if (Number.isFinite(inMs) && nowMs - inMs < LIVE_MS && !["case", "link_sala"].includes(touch.tipo)) return "conversa_viva";
  return "";
}
// Motivos que valem pra hora do toque mesmo vistos antes dela (a reserva
// antecipada só acontece se nenhum destes estiver no caminho).
const STRUCTURAL = new Set(["desligado", "fora", "parado", "remarcada", "passou", "fora_da_etapa", "ja_confirmou", "janela_fechada", "pediu_remarcar", "retorno_combinado"]);
// Motivos que passam (o time despausou, a pessoa do time saiu da conversa, o
// lead parou de escrever): o toque tenta de novo até o fim da janela dele.
// Enquanto isso o lembrete fixo reservado é devolvido (pausa e gente mandam
// nele pelas regras de sempre); a conversa viva, essa, segura o passo.
const TRANSIENT = new Set(["conversa_viva", "humano_ativo", "parado"]);

// ── o ciclo ───────────────────────────────────────────────────────────────
// Seção 0 do motor (sdr-flow.js): reserva os lembretes fixos que o toque
// substitui, pede ao agente o toque que está na vez, fecha o que venceu,
// manda a reativação 2 (dois dias sem resposta: só cabe template) e leva à
// Nutrição quem não respondeu nem a ela. Devolve as linhas por lead, que as
// outras seções do motor usam pra não tocar por cima.
export async function runAgentTouches({ repo, product, cfg, leads, humanIds, threadOf, listMessages, now, approvedNames, sendTemplate, log = console }) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const all = await repo.listWhere("sdr_touches", { saas: product.id }).catch(() => []);
  const byLead = new Map();
  for (const r of all) byLead.set(r.leadId, [...(byLead.get(r.leadId) || []), r]);
  const stats = { pedidos: 0, pulados: 0, vencidos: 0, absorvidos: 0, reservas: 0, templates: 0, nutridos: 0 };
  const write = async (rec, patch) => { Object.assign(rec, patch, { atualizadoEm: nowIso }); await repo.update("sdr_touches", rec.id, { ...patch, atualizadoEm: nowIso }); };
  const create = async (rec) => {
    const row = { ...rec, criadoEm: nowIso, atualizadoEm: nowIso };
    await repo.create("sdr_touches", row);
    byLead.set(rec.leadId, [...(byLead.get(rec.leadId) || []), row]);
    return row;
  };
  // Os passos do lembrete fixo que o toque substitui: reservados até o prazo
  // do agente ("claim", vazio ou reserva antiga; carimbo de quem já mandou não
  // se mexe), devolvidos agora ("release") ou fechados de vez ("absorb").
  const settle = async (lead, steps, how, untilMs = nowMs) => {
    if (!steps?.length || !lead.callAt) return;
    const log0 = lead.confirmLog && lead.confirmLog.at === lead.callAt ? { ...lead.confirmLog } : { at: lead.callAt };
    let changed = false;
    for (const s of steps) {
      const held = Number.isFinite(claimUntil(log0[s]));
      if (how === "claim" ? !log0[s] || held : held || (how === "absorb" && !log0[s])) {
        log0[s] = how === "absorb" ? ABSORBED : claimValue(how === "claim" ? untilMs : nowMs);
        changed = true;
      }
    }
    if (changed) { await repo.update("leads", lead.id, { confirmLog: log0 }); lead.confirmLog = log0; }
  };

  for (const lead of leads) {
    const recs = byLead.get(lead.id) || [];
    const on = touchOn(cfg, lead);
    // Linha pedida que já não vale: chave desligada, reunião remarcada, prazo
    // do agente vencido. A reserva carrega o próprio prazo, então o lembrete
    // fixo volta mesmo sem este passo; aqui a linha só fecha com o motivo.
    for (const r of recs.filter((x) => x.estado === "pedido")) {
      const gone = !on ? "desligado" : r.callAt && r.callAt !== lead.callAt ? (lead.callAt ? "remarcada" : "desmarcada") : "";
      if (gone) { await write(r, { estado: "pulado", motivo: gone }); await settle(lead, r.covers, "release"); stats.pulados++; }
      else if (nowMs > Date.parse(r.prazo || "")) { await write(r, { estado: "expirado", motivo: "o agente não entregou no prazo" }); stats.vencidos++; }
    }
    if (!on || lead.formExit || lead.disqualified || lead.whatsappOptOut || lead.whatsappInvalid) continue;     // fora do robô: nem plano
    const r2Open = recs.find((r) => r.tipo === "reativacao_2" && r.estado === "enviado" && !r.nutridoEm);
    if (!lead.callAt && !lead.sdrLog?.agentOfferAt && !r2Open) continue;
    const plan = touchPlan({ lead, product, recs, nowMs });
    if (!plan.length && !r2Open) continue;
    const thread = threadOf(lead);
    const msgs = thread ? await listMessages(repo, thread.id) : [];
    const ctx = { lead, product, cfg, msgs, humanIds, nowMs };

    // RESERVA ANTECIPADA: o passo fixo que o toque substitui é reservado logo
    // antes da hora dele, mesmo quando o toque sai depois (reunião às 11h: o
    // fixo de 2h sairia às 9h, a segunda mensagem do agente é às 10h).
    for (const t of plan) {
      if (!t.covers.length) continue;
      const log0 = lead.confirmLog && lead.confirmLog.at === lead.callAt ? lead.confirmLog : {};
      const due = t.covers.filter((s) => !log0[s] && nowMs >= Math.min(t.atMs, reminderFireMs(t.callAt, s)) - 2 * MIN);
      if (!due.length || nowMs > t.untilMs || STRUCTURAL.has(blockedReason(t, { ...ctx, nowMs: Math.max(nowMs, t.atMs) }))) continue;
      await settle(lead, due, "claim", t.deadlineMs);
      stats.reservas++;
    }

    for (const t of plan) {
      if (nowMs < t.atMs) continue;
      if ((byLead.get(lead.id) || []).some((r) => r.estado === "pedido")) break;     // um toque por vez por lead
      const key = `${t.tipo}:${t.anchor}`;
      const base = { id: touchId(lead.id, key), leadId: lead.id, saas: product.id, key, tipo: t.tipo, anchor: t.anchor, callAt: t.callAt, covers: t.covers,
        hora: new Date(t.atMs).toISOString(), thread: thread?.id || "", case: "", casesEnviados: [...new Set(recs.filter((r) => r.case && SENT.has(r.estado)).map((r) => r.case))] };
      const why = blockedReason(t, ctx);
      if (TRANSIENT.has(why)) {
        if (why !== "conversa_viva") await settle(lead, t.covers, "release");
        if (nowMs <= t.untilMs) continue;                                          // tenta de novo no próximo ciclo
        if (why === "conversa_viva") {
          await create({ ...base, estado: "absorvido", motivo: "o lead seguiu conversando até o fim da janela do toque" });
          await settle(lead, t.covers, "absorb");
          stats.absorvidos++;
          continue;
        }
      }
      if (why || nowMs > t.untilMs) {
        await create({ ...base, estado: "pulado", motivo: why || "tarde" });
        await settle(lead, t.covers, "release");
        stats.pulados++;
        continue;
      }
      if (t.template) {        // reativação 2: dois dias sem resposta, a janela fechou, só template
        const names = await approvedNames();
        const tpl = [cfg.templates.ladderBreakup, cfg.templates.secondTouch].find((n) => n && names.has(n));
        if (!tpl) { await create({ ...base, estado: "pulado", motivo: "sem template aprovado" }); stats.pulados++; continue; }
        try {
          const nome = String(lead.name || "").trim().split(/\s+/)[0] || "";
          await sendTemplate({ phone: thread?.phone || lead.waPhone || lead.phone, name: tpl, params: [nome || "de novo"], leadId: lead.id, moveCard: false });
          await create({ ...base, estado: "enviado", via: "template", template: tpl, enviadoEm: nowIso });
          stats.templates++;
        } catch (err) {
          log.warn?.({ lead: lead.id, err: err.message }, "sdr: reativação 2 falhou");
          await create({ ...base, estado: "pulado", motivo: "erro: " + String(err.message || err).slice(0, 120) });
        }
        continue;
      }
      const prazo = Math.max(t.deadlineMs, nowMs + 5 * MIN);
      await settle(lead, t.covers, "claim", prazo);
      await create({ ...base, estado: "pedido", pedidoEm: nowIso, prazo: new Date(prazo).toISOString(), comCase: t.withCase });
      stats.pedidos++;
      break;
    }

    // NUTRIÇÃO: sem resposta 48h depois da reativação 2 (decisão 30).
    if (r2Open && nowMs - Date.parse(r2Open.enviadoEm || "") >= NURTURE_AFTER_MS) {
      const answered = msgs.some((m) => Date.parse(m.at || 0) > Date.parse(r2Open.enviadoEm) && (m.direction === "in" || humanIds.has(m.author)));
      const target = (product.funnel || []).find((f) => f?.stage === ETAPA_NUTRICAO);
      if (answered || !target || lead.callAt || lead.stage === target.stage || !["novo", "qualificacao"].includes(kindOf(product, lead.stage || firstStage(product)))) {
        await write(r2Open, { nutridoEm: nowIso, nutrido: answered ? "respondeu" : "fora" });
      } else {
        try {
          const moved = await applyStageMove(repo, { lead, toStage: target.stage, author: SDR_AUTHOR, now });
          await repo.update("leads", lead.id, { ...moved, stage: target.stage, sdrLog: { ...(lead.sdrLog || {}), nurtureAt: nowIso } });
          await write(r2Open, { nutridoEm: nowIso, nutrido: "sim" });
          stats.nutridos++;
        } catch (err) {
          log.warn?.({ lead: lead.id, err: err.message }, "sdr: Nutrição depois da reativação falhou");
        }
      }
    }
  }
  return { byLead, stats };
}

// A reativação deste lead está em curso? Enquanto estiver, o 2º toque, a escada
// e a cobrança da oferta do motor não tocam por cima (o lead não recebe em
// dobro). Termina sozinha: na resposta do lead (a oferta nova muda a âncora),
// na Nutrição, ou quando a reativação 2 não pôde sair.
export function inReactivation(recs = [], lead, nowMs) {
  const offerAt = String(lead?.sdrLog?.agentOfferAt || "");
  if (!offerAt) return false;
  const mine = recs.filter((r) => r.anchor === offerAt);
  if (mine.some((r) => r.estado === "pedido")) return true;
  const r1 = mine.find((r) => r.tipo === "reativacao_1" && ["enviado", "silencio"].includes(r.estado));
  const r2 = mine.find((r) => r.tipo === "reativacao_2");
  if (r2) return r2.estado === "enviado" && !r2.nutridoEm;
  return !!r1 && nowMs - Date.parse(r1.atualizadoEm || r1.enviadoEm || 0) < 6 * DAY;
}
