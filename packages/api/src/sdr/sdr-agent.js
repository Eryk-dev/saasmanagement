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
import { sdrBotConfig, agentOwns, touchOn, SDR_AUTHOR } from "./sdr-flow.js";
import { touchId, claimUntil, claimValue, ABSORBED, FALLBACK_KINDS } from "./sdr-agent-touch.js";
import { humanMuteHolds } from "./sdr-state.js";
import { bookCall, cancelCall } from "./sdr-brain.js";
import { windowOpenAt } from "./sdr-signals.js";

const SLOT_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SDR_KINDS = new Set(["novo", "contato", "qualificacao", "call"]); // a região do cérebro nativo (BRAIN_KINDS)
const refuse = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// O print do case que o agente manda (base64): só PNG ou JPEG de verdade (pelos
// bytes, não pelo nome) e até 4 MB (a Meta aceita 5 MB em imagem).
const IMAGE_MAX = 4 * 1024 * 1024;
export function imageOf(image) {
  const b64 = typeof image === "string" ? image : String(image?.b64 || "");
  if (!b64 || b64.length > Math.ceil(IMAGE_MAX / 3) * 4 + 8 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const buffer = Buffer.from(b64, "base64");
  if (!buffer.length || buffer.length > IMAGE_MAX) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { buffer, mime: "image/png", ext: "png" };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { buffer, mime: "image/jpeg", ext: "jpg" };
  return null;
}

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
    // Lead do SDR proativo: o texto fixo do link sai de cena (decisão 29) e quem
    // responde à positiva é o próprio agente.
    const confirmedMs = Date.parse(lead.confirmLog?.confirmed || "");
    if (!touchOn(c.cfg, lead) && lead.callConfirmed && Number.isFinite(confirmedMs) && confirmedMs >= Date.parse(lastIn.at || 0) - 5000) return refuse(409, "reminder_confirmed");
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
    // A OFERTA do agente fica carimbada: é a âncora da reativação de quem
    // recebeu os horários e sumiu (sdr-agent-touch.js, decisões 30 e 31).
    const cur = (await repo.get("leads", c.lead.id))?.sdrLog || {};
    await repo.update("leads", c.lead.id, { sdrLog: { ...cur, agentOfferAt: now().toISOString(), agentOfferSlots: wanted } }).catch(() => {});
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

  // O lead confirmou a presença NO DIA da demonstração, em conversa com o
  // agente (a régua só lê a positiva curta ao lembrete; "simm, mto obg" e o
  // "pode ser hoje às 18h" de quem marcou no mesmo dia passavam sem a marca).
  // Grava a MESMA marca da régua (callConfirmed + confirmLog.confirmed): o link
  // sai pelo fluxo (2c), o lembrete de 2h não pede de novo e o aviso de
  // confirmados do time enxerga. Véspera não vale: o lembrete da manhã é quem
  // confirma o dia. Link que o agente já mandou nesta troca não se repete.
  async function confirm(leadId) {
    const c = await load(leadId);
    if (c.fail) return c.fail;
    const { lead, product, msgs } = c;
    if (!lead.callAt || kindOf(product, lead.stage) !== "call") return refuse(409, "no_call");
    const clock = wall().toISOString().slice(0, 16);
    if (lead.callAt.slice(0, 10) !== clock.slice(0, 10) || lead.callAt <= clock) return refuse(409, "not_today");
    if (lead.callConfirmed) return { status: 200, body: { ok: true, already: true } };
    const iso = now().toISOString();
    const log0 = lead.confirmLog && lead.confirmLog.at === lead.callAt ? lead.confirmLog : { at: lead.callAt };
    const lastInMs = Date.parse([...msgs].reverse().find((m) => m.direction === "in")?.at || 0);
    const linkSent = !!lead.callUrl && msgs.some((m) => m.direction === "out" && Date.parse(m.at || 0) > lastInMs && String(m.text || "").includes(lead.callUrl));
    await repo.update("leads", lead.id, { callConfirmed: true, confirmLog: { ...log0, confirmed: iso, ...(linkSent ? { linkSentAt: iso } : {}) } });
    return { status: 200, body: { ok: true, link: linkSent ? "sent" : lead.callUrl ? "flow" : "none" } };
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

  // TOQUE DO RELÓGIO (SDR proativo, sdr-agent-touch.js): o agente entrega o
  // que o relógio pediu. Só vale a linha de sdr_touches em "pedido", no prazo,
  // pra mesma reunião; o lead que escreveu depois do pedido, ou gente do time
  // que falou, encerra o toque sem texto (a conversa viva cobre). Os balões
  // saem em ordem e o print do case, quando vem, logo depois do primeiro.
  // `silencio` fecha o toque sem mandar nada: na confirmação e no link o passo
  // volta pro lembrete fixo (o lead não fica sem); no resto, nada sai.
  async function touch(leadId, { key = "", parts = [], image = null, case: caseId = "", silencio = "" } = {}) {
    const id = touchId(String(leadId || ""), String(key || ""));
    const rec = key ? await repo.get("sdr_touches", id) : null;
    const iso = now().toISOString(), nowMs = now().getTime();
    const close = async (patch) => { if (rec) await repo.update("sdr_touches", id, { ...patch, atualizadoEm: iso }); };
    // Os passos do lembrete fixo que este toque reservou: devolvidos agora
    // (o fixo sai) ou fechados de vez (a conversa viva cobre).
    const settle = async (lead, how) => {
      if (!rec?.covers?.length || !lead?.confirmLog || lead.confirmLog.at !== rec.callAt) return;
      const log0 = { ...lead.confirmLog };
      let changed = false;
      for (const s of rec.covers) {
        if (how === "sent") { log0[s] = iso; changed = true; }
        else if (Number.isFinite(claimUntil(log0[s]))) { log0[s] = how === "absorb" ? ABSORBED : claimValue(nowMs); changed = true; }
      }
      if (changed) await repo.update("leads", lead.id, { confirmLog: log0 });
    };
    if (!rec) return refuse(404, "touch_unknown");
    if (rec.estado !== "pedido") return refuse(409, "touch_closed", { estado: rec.estado });
    const c = await load(leadId);
    if (c.fail) {
      const lead = await repo.get("leads", String(leadId));
      await close({ estado: "pulado", motivo: c.fail.body.error });
      await settle(lead, "release");
      return c.fail;
    }
    const { lead, cfg, thread, msgs, users } = c;
    if (!touchOn(cfg, lead)) { await close({ estado: "pulado", motivo: "desligado" }); await settle(lead, "release"); return refuse(409, "touch_off"); }
    if (nowMs > Date.parse(rec.prazo || "")) { await close({ estado: "expirado", motivo: "entregue depois do prazo" }); return refuse(409, "touch_expired"); }
    if (rec.callAt && lead.callAt !== rec.callAt) { await close({ estado: "pulado", motivo: "remarcada" }); return refuse(409, "call_changed"); }
    const pedidoMs = Date.parse(rec.pedidoEm || 0);
    const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
    // O lead escreveu depois do pedido: o atendimento dele responde a conversa
    // inteira. O link da sala, esse não pode faltar: volta pro fixo.
    if (lastIn && Date.parse(lastIn.at || 0) > pedidoMs) {
      const absorb = rec.tipo !== "link_sala";
      await close({ estado: absorb ? "absorvido" : "pulado", motivo: "o lead escreveu depois do pedido" });
      await settle(lead, absorb ? "absorb" : "release");
      return refuse(409, "superseded");
    }
    if (msgs.some((m) => m.direction === "out" && users.has(m.author) && Date.parse(m.at || 0) > pedidoMs)) {
      await close({ estado: "pulado", motivo: "alguém do time falou" });
      await settle(lead, "release");
      return refuse(409, "human_answered");
    }
    if (silencio) {
      const back = FALLBACK_KINDS.has(rec.tipo);
      await close({ estado: "silencio", motivo: String(silencio).slice(0, 200), fallback: back });
      await settle(lead, back ? "release" : "keep");
      return { status: 200, body: { ok: true, silencio: true, fallback: back } };
    }
    const texts = (Array.isArray(parts) ? parts : []).map((p) => String(p || "").trim()).filter(Boolean);
    if (!texts.length || texts.length > 4 || texts.some((t) => t.length > 600)) return refuse(400, "parts: de 1 a 4 balões de até 600 caracteres");
    let picture = null;
    if (image) {
      picture = imageOf(image);
      if (!picture) return refuse(400, "image: PNG ou JPEG de até 4 MB, em base64");
      if (!rec.comCase || !/^K-\d{4}$/.test(String(caseId || ""))) return refuse(400, "image: só o print do case pedido neste toque");
    }
    if (lead.whatsappInvalid) return refuse(409, "invalid_number");
    if (!thread) return refuse(409, "no_thread");
    if (!windowOpenAt(msgs, nowMs)) {
      await close({ estado: "pulado", motivo: "a janela de 24 horas fechou" });
      await settle(lead, "release");
      return refuse(409, "window_closed");
    }
    const phoneId = thread.waPhoneId || c.product?.waPhoneId || undefined;
    if (!wa?.configured?.(phoneId)) return refuse(503, "whatsapp_not_configured");
    const to = thread.phone || thread.id;
    let mediaId = "";
    if (picture) {
      try { mediaId = await wa.uploadMedia(picture.buffer, { mime: picture.mime, filename: `${caseId}.${picture.ext}`, phoneId }); }
      catch (err) { return refuse(502, "image_upload_failed", { sent: 0, detail: String(err.message || err).slice(0, 160) }); }
      if (!mediaId) return refuse(502, "image_upload_failed", { sent: 0 });
    }
    const ids = [];
    const record = (messageId, text, media = null) => recordMessage(repo, { id: messageId, phone: to, direction: "out", text, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas: lead.saas || "", leadId: lead.id, via: "toque", ...(media ? { media } : {}) });
    try {
      for (const [i, text] of texts.entries()) {
        if (i && partDelayMs) await sleep(Math.min(5000, partDelayMs + text.length * 25));
        const { messageId } = await wa.sendText(to, text, { phoneId });
        await record(messageId, text);
        ids.push(messageId);
        if (i === 0 && mediaId) {
          if (partDelayMs) await sleep(partDelayMs);
          const sentImg = await wa.sendMedia(to, { kind: "image", mediaId }, { phoneId });
          await record(sentImg.messageId, "", { kind: "image", id: mediaId, mime: picture.mime, filename: `${caseId}.${picture.ext}` });
          ids.push(sentImg.messageId);
        }
      }
    } catch (err) {
      log?.warn?.(`sdr agent touch ${lead.id}: ${err.message}`);
      if (ids.length) { await close({ estado: "enviado", via: "agente", parcial: true, enviadoEm: iso, case: caseId || "", messageIds: ids }); await settle(lead, "sent"); }
      return refuse(502, "send_failed", { sent: ids.length, detail: String(err.message || err).slice(0, 160) });
    }
    await close({ estado: "enviado", via: "agente", enviadoEm: iso, case: caseId || "", comPrint: !!mediaId, messageIds: ids });
    await settle(lead, "sent");
    return { status: 200, body: { ok: true, messageIds: ids } };
  }

  return { send, hold, book, cancel, confirm, handoff, optOut, callback, touch };
}
