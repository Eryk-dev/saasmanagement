// As MÃOS do agente SDR externo (OpenBot) dentro do cockpit. O agente conversa
// com o lead fora daqui (instruções, memória e travas de texto são dele); este
// módulo é o que ele consegue FAZER: mandar a resposta pelo número do produto,
// reservar os horários que vai oferecer, marcar, desmarcar, chamar o time e
// registrar a saída da base. Cada ação reusa o caminho canônico do robô nativo
// (bookCall, cancelCall, reserva de oferta, Meet, alerta do Inbox), então card,
// agenda, lembretes e histórico ficam iguais aos de uma marcação do robô.
//
// Só age em lead que é do agente (agentOwns, sdr-flow.js) e que o time não
// parou ("parar robô" = lead.sdrOff), e respeita as MESMAS cercas do cérebro
// nativo: a região do funil que é do SDR (novo, contato, qualificação, call) e
// a pausa de humano ativo (alguém do time falou há pouco: a conversa é dele).
// Recusa devolve { status, body } com um `error` curto que o agente sabe ler;
// nunca lança por regra de negócio.
import { findThreadByPhone, listMessages, recordMessage } from "../whatsapp/wa-store.js";
import { onOutboundMessage } from "../crm/lead-flow.js";
import { raiseAlert } from "../whatsapp/wa-call-flow.js";
import { slotsForLead, activeHolds, holdSlots, releaseHolds, wallNow, OFFER_HOURS, HOLD_MIN } from "../crm/agenda-slots.js";
import { upsertNotification } from "../tasks/tasks-core.js";
import { kindOf, firstStage, isWonLead } from "../crm/stages.js";
import { sdrBotConfig, agentOwns, SDR_AUTHOR } from "./sdr-flow.js";
import { humanMuteHolds } from "./sdr-state.js";
import { bookCall, cancelCall } from "./sdr-brain.js";
import { windowOpenAt } from "./sdr-signals.js";

const SLOT_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SDR_KINDS = new Set(["novo", "contato", "qualificacao", "call"]); // a região do cérebro nativo (BRAIN_KINDS)
const refuse = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeSdrAgent({ repo, whatsapp: wa, autoCallMeet = null, cancelCallMeet = null, now = () => new Date(), wall = wallNow, partDelayMs = 1800, log = console }) {
  // O lead, o produto e a conversa, ou a recusa. `paused` e `not_agent_lead`
  // valem pra TODA ação: lead parado pelo time ou devolvido ao robô nativo não
  // recebe nada do agente, nem no meio de um atendimento em curso.
  async function load(leadId) {
    const lead = await repo.get("leads", String(leadId || ""));
    if (!lead) return { fail: refuse(404, "lead_not_found") };
    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const cfg = sdrBotConfig(product);
    if (!agentOwns(cfg, lead)) return { fail: refuse(409, "not_agent_lead") };
    if (lead.sdrOff) return { fail: refuse(409, "paused") };
    if (lead.formExit || lead.disqualified || isWonLead(product, lead) || !SDR_KINDS.has(kindOf(product, lead.stage || firstStage(product)))) return { fail: refuse(409, "out_of_region") };
    const thread = await findThreadByPhone(repo, lead.waPhone || lead.phone || "");
    const msgs = thread ? await listMessages(repo, thread.id) : [];
    const users = new Set((await repo.list("users")).map((u) => u.id));
    const lastHumanOut = [...msgs].reverse().find((m) => m.direction === "out" && users.has(m.author));
    if (humanMuteHolds(cfg, lastHumanOut, now().getTime())) return { fail: refuse(409, "human_active") };
    return { lead, product, cfg, thread, msgs, users };
  }

  // Horários livres pro lead como o robô os vê, sem o que OUTRO lead segura.
  async function freeFor(lead, { from = "", days = 5 } = {}) {
    const holds = await activeHolds(repo, lead.saas, { now: now() });
    const { slots } = await slotsForLead(repo, { lead, saas: lead.saas, sdr: true, ...OFFER_HOURS, holds, days, limit: 0, ...(from ? { startDate: `${from}T00:00` } : {}) });
    return slots;
  }
  const near = (slots, at, count = 3) => [...slots].sort((a, b) => Math.abs(Date.parse(a.at) - Date.parse(at)) - Math.abs(Date.parse(b.at) - Date.parse(at))).slice(0, count).map((s) => s.at).sort();

  // Manda os balões da resposta, em ordem, como o robô (autor sdr-bot).
  // `replyTo` é a última mensagem do lead que o agente leu: se o lead escreveu
  // de novo, ou alguém do time respondeu depois dela, a resposta já nasceu
  // velha e NÃO sai (o próximo atendimento lê a conversa inteira).
  async function send(leadId, { parts = [], replyTo = "" } = {}) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const { lead, product, thread, msgs, users } = c;
    const texts = (Array.isArray(parts) ? parts : []).map((p) => String(p || "").trim()).filter(Boolean);
    if (!texts.length || texts.length > 4 || texts.some((t) => t.length > 600)) return refuse(400, "parts: de 1 a 4 balões de até 600 caracteres");
    if (lead.whatsappInvalid) return refuse(409, "invalid_number");
    if (!thread) return refuse(409, "no_thread");
    const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
    if (!lastIn) return refuse(409, "no_inbound");
    if (replyTo && lastIn.id !== replyTo) return refuse(409, "superseded");
    // A positiva ao lembrete da call é da régua da call (handleSdrInbound
    // carimbou a confirmação NESTA mensagem): o link vai pelo fluxo (2c).
    const confirmedMs = Date.parse(lead.confirmLog?.confirmed || "");
    if (lead.callConfirmed && Number.isFinite(confirmedMs) && confirmedMs >= Date.parse(lastIn.at || 0) - 5000) return refuse(409, "reminder_confirmed");
    if (msgs.some((m) => m.direction === "out" && users.has(m.author) && Date.parse(m.at || 0) > Date.parse(lastIn.at || 0))) return refuse(409, "human_answered");
    if (!windowOpenAt(msgs, now().getTime())) return refuse(409, "window_closed");
    const phoneId = thread.waPhoneId || product?.waPhoneId || undefined;
    if (!wa?.configured?.(phoneId)) return refuse(503, "whatsapp_not_configured");
    const to = thread.phone || thread.id;
    const ids = [];
    try {
      for (const [i, text] of texts.entries()) {
        if (i && partDelayMs) await sleep(Math.min(5000, partDelayMs + text.length * 25));
        const { messageId } = await wa.sendText(to, text, { phoneId });
        await recordMessage(repo, { id: messageId, phone: to, direction: "out", text, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas: lead.saas || "", leadId: lead.id });
        ids.push(messageId);
      }
    } catch (err) {
      log?.warn?.(`sdr agent send ${lead.id}: ${err.message}`);
      return refuse(502, "send_failed", { sent: ids.length, detail: String(err.message || err).slice(0, 160) });
    }
    await onOutboundMessage(repo, lead.id, { author: SDR_AUTHOR, text: "conversa com o SDR" }).catch(() => {});
    // 1ª resposta = 1º toque dado (o mesmo carimbo do cérebro nativo): o fluxo
    // não manda o 1º toque por cima e a escada de retomada conta a partir daqui.
    const log0 = (await repo.get("leads", lead.id))?.sdrLog || {};
    if (!log0.firstTouchAt) await repo.update("leads", lead.id, { sdrLog: { ...log0, firstTouchAt: now().toISOString(), firstTouchVia: "agent" } }).catch(() => {});
    return { status: 200, body: { ok: true, messageIds: ids } };
  }

  // Segura por 30 min os horários que o agente vai OFERECER a este lead. A
  // oferta nova substitui a anterior. Horário que outro lead segura ou que saiu
  // da agenda é recusado com os mais próximos.
  async function hold(leadId, { slots = [] } = {}) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const wanted = [...new Set((Array.isArray(slots) ? slots : []).map(String))];
    if (!wanted.length || wanted.length > 3 || wanted.some((s) => !SLOT_RX.test(s))) return refuse(400, "slots: de 1 a 3 horários AAAA-MM-DDTHH:MM");
    const free = await freeFor(c.lead, { from: wanted.slice().sort()[0].slice(0, 10), days: 15 });
    const open = new Set(free.map((s) => s.at));
    const taken = wanted.filter((s) => !open.has(s));
    if (taken.length) return refuse(409, "taken", { taken, alternatives: near(free, taken[0]) });
    await holdSlots(repo, { saas: c.lead.saas, leadId: c.lead.id, slots: wanted.map((at) => ({ at })), now: now() });
    return { status: 200, body: { ok: true, held: wanted, minutes: HOLD_MIN } };
  }

  // Marca (ou remarca) no horário que o lead escolheu. O closer é o da agenda,
  // não o que o agente pedir. A sala do Meet nasce junto (falha da sala não
  // desfaz a marcação: o card fica com o erro pro time ver).
  async function book(leadId, { at = "" } = {}) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const { lead, product } = c;
    if (!SLOT_RX.test(String(at))) return refuse(400, "at: AAAA-MM-DDTHH:MM");
    if (lead.callAt === at) return { status: 200, body: { ok: true, already: true, ...callOf(lead, await repo.list("users")) } };
    const free = await freeFor(lead, { from: at.slice(0, 10), days: 3 });
    const slot = free.find((s) => s.at === at);
    if (!slot) return refuse(409, "taken", { alternatives: near(free, at) });
    await bookCall(repo, { lead, product, at, closer: slot.closer, now: now() });
    await releaseHolds(repo, { saas: lead.saas, leadId: lead.id, now: now() });
    if (autoCallMeet) await Promise.resolve(autoCallMeet(lead.id)).catch((err) => log?.warn?.(`sdr agent meet ${lead.id}: ${err.message}`));
    const fresh = (await repo.get("leads", lead.id)) || lead;
    return { status: 200, body: { ok: true, ...callOf(fresh, await repo.list("users")) } };
  }
  const callOf = (lead, users) => ({ callAt: lead.callAt || "", closer: lead.closer || "", closerName: users.find((u) => u.id === lead.closer)?.name || "", callUrl: lead.callUrl || "", stage: lead.stage || "" });

  // Desmarca sem horário novo: card volta pra qualificação, lembretes param e o
  // convite do Meet morre (o PATCH genérico deixa o evento vivo na agenda).
  async function cancel(leadId) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const { lead, product } = c;
    if (!lead.callAt) return { status: 200, body: { ok: true, already: true } };
    await cancelCall(repo, { lead, product, now: now() });
    await releaseHolds(repo, { saas: lead.saas, leadId: lead.id, now: now() });
    if (cancelCallMeet) await Promise.resolve(cancelCallMeet(lead.id)).catch((err) => log?.warn?.(`sdr agent cancel meet ${lead.id}: ${err.message}`));
    return { status: 200, body: { ok: true, was: lead.callAt } };
  }

  // Chama o time: carimba o handoff (o lembrete de handoff insiste de 2h em 2h
  // até alguém falar), levanta o alerta do Inbox e avisa quem cuida do lead.
  async function handoff(leadId, { kind = "", why = "" } = {}) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const { lead, thread } = c;
    const k = String(kind || "").slice(0, 30), text = String(why || "").trim().slice(0, 260);
    if (!k || !text) return refuse(400, "kind e why são obrigatórios");
    const iso = now().toISOString();
    const cur = (await repo.get("leads", lead.id))?.sdrLog || {};
    await repo.update("leads", lead.id, { sdrLog: { ...cur, handoffAt: iso, handoffKind: `agente:${k}`, handoffWhy: text } });
    // LEAD NA SALA sem especialista (pedido do sócio, 26/11): além de quem cuida
    // do lead, avisa quem do MESMO time de closers está com a agenda livre nos
    // próximos 45 min e pode assumir a sala agora.
    let free = null;
    if (k === "sala") {
      const { slots = [] } = await slotsForLead(repo, { lead, saas: lead.saas, sdr: true, ...OFFER_HOURS, now: wall(), minNoticeMin: 0, days: 1, limit: 0 }).catch(() => ({}));
      const limit = wall().getTime() + 45 * 60_000;
      free = slots.find((x) => x.closer && x.closer !== lead.closer && Date.parse(`${x.at}:00Z`) <= limit) || null;
    }
    const people = await repo.list("users");
    const freeName = free ? people.find((u) => u.id === free.closer)?.name || "" : "";
    if (thread) await raiseAlert(repo, thread, { text: `${k === "sala" ? "LEAD NA SALA sem especialista · " : ""}Agente SDR chamou o time: ${text}${freeName ? ` · ${freeName} está livre às ${free.at.slice(11)}` : ""}` }).catch(() => {});
    const users = new Set(people.map((u) => u.id));
    if (free && users.has(free.closer)) {
      await upsertNotification(repo, {
        user: free.closer, task: "", taskTitle: "", saas: lead.saas || "", by: "api", key: `agent-sala:${lead.id}:${iso}`, type: "sdr_handoff",
        text: `LEAD NA SALA sem especialista: ${lead.name || "lead"}. Você está com a agenda livre às ${free.at.slice(11)}: consegue assumir agora? (${text})`,
        link: { screen: "whatsapp", thread: thread?.id || "", lead: lead.id },
      }, { now: iso }).catch(() => {});
    }
    const user = [lead.closer, lead.owner].find((u) => u && users.has(u));
    if (user) {
      await upsertNotification(repo, {
        user, task: "", taskTitle: "", saas: lead.saas || "", by: "api", key: `agent-handoff:${lead.id}:${iso}`, type: "sdr_handoff",
        text: `Agente SDR entregou ${lead.name || "o lead"}: ${text}`, link: { screen: "whatsapp", thread: thread?.id || "", lead: lead.id },
      }, { now: iso }).catch(() => {});
    }
    return { status: 200, body: { ok: true, notified: user || "", ...(freeName ? { free: freeName } : {}) } };
  }

  // O lead pediu pra não receber mais mensagem: sai dos disparos, do drip e do
  // fluxo do robô (whatsappOptOut), como o "parar promoções" nativo.
  async function optOut(leadId) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    await repo.update("leads", c.lead.id, { whatsappOptOut: true, whatsappOptOutAt: now().toISOString() });
    await releaseHolds(repo, { saas: c.lead.saas, leadId: c.lead.id, now: now() });
    return { status: 200, body: { ok: true } };
  }

  // Retorno combinado ("me chama na terça"): o mesmo carimbo do robô nativo,
  // que segura a cobrança de oferta até o dia e chama o lead como combinado
  // (sdr-flow.js, 1f). `day` é AAAA-MM-DD; a hora é 09:30 de Brasília.
  async function callback(leadId, { day = "" } = {}) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return refuse(400, "day: AAAA-MM-DD");
    const at = new Date(`${day}T09:30:00-03:00`);
    if (!(at.getTime() > now().getTime())) return refuse(400, "day: uma data futura");
    const cur = (await repo.get("leads", c.lead.id))?.sdrLog || {};
    const { callbackDoneAt: _done, callbackVia: _via, ...rest } = cur;
    await repo.update("leads", c.lead.id, { sdrLog: { ...rest, callbackAt: at.toISOString(), callbackSetAt: now().toISOString() } });
    return { status: 200, body: { ok: true, callbackAt: at.toISOString() } };
  }

  return { send, hold, book, cancel, handoff, optOut, callback };
}
