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
import { brtToIso } from "./lead-flow.js";
import { resolveWabaId } from "./wa-health.js";
import { raiseAlert } from "./wa-call-flow.js";
import { slotsForLead, slotLabel, wallNow } from "./agenda-slots.js";
import { SDR_TEMPLATES } from "./sdr-templates.leverads.js";

export const SDR_AUTHOR = "sdr-bot";
const HOUR = 3_600_000, MIN = 60_000;
const TEMPLATE_BODY = Object.fromEntries(SDR_TEMPLATES.map((t) => [t.name, t.body]));

const firstName = (v) => String(v || "").trim().split(/\s+/)[0] || "";
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const outsideWindow = (err) => err?.code === 131047 || err?.code === 470;

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
    // Fase 2 (conversa com IA): chave PRÓPRIA, nasce desligada — só liga
    // depois de passar na bateria de replay (sdr-replay.js).
    conversation: cfg.conversation === true,
    firstTouchDelayMin: num(cfg.firstTouchDelayMin, 3), // "um humano viu" > resposta em 2s
    freshHours: num(cfg.freshHours, 24),                // lead mais velho que isso é fila humana
    templates: {
      firstTouch: cfg.templates?.firstTouch || "sdr_primeiro_toque",
      reminder: cfg.templates?.reminder || "sdr_lembrete_call",
      rescue: cfg.templates?.rescue || "sdr_resgate_noshow",
    },
  };
}

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
export function firstTouchText({ nome, sdrName, resumo, slots = [], now }) {
  const oi = nome ? `Oiii, ${nome}.` : "Oiii.";
  const eu = sdrName ? `${sdrName} falando, da LeverAds.` : "Aqui é da LeverAds.";
  const base = `${oi} ${eu} Vi seu diagnóstico aqui: ${resumo}. Consigo te mostrar a plataforma funcionando nas suas próprias contas, ao vivo, numa call rápida.`;
  if (slots.length >= 2) return `${base} Tenho ${slotLabel(slots[0].at, now)} ou ${slotLabel(slots[1].at, now)} livres, qual fica melhor pra você?`;
  if (slots.length === 1) return `${base} Tenho ${slotLabel(slots[0].at, now)} livre, fica bom pra você?`;
  return `${base} Ainda essa semana, qual período fica melhor pra você: manhã ou tarde?`;
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
  if (key === "24h") return `${oi} Confirmando nossa call ${quando}, tudo certo? Qualquer imprevisto me fala por aqui que eu remarco sem problema.`;
  if (key === "1h") return `${oi} Está tudo certo pra nossa call ${quando}? Nosso especialista vai estar te esperando pra te mostrar tudo ao vivo, nas suas contas. Te espero lá!`;
  return link
    ? `${nome ? nome + ", nossa" : "Nossa"} call começa em 10 minutos! Link pra entrar: ${link}`
    : `${nome ? nome + ", nossa" : "Nossa"} call começa em 10 minutos! Te espero lá.`;
}

// A mensagem de resgate é a que o time já usa e recupera no-show (mineração:
// "passei na nossa call no horário e não te encontrei, acontece!"), com os
// próximos horários reais na sequência.
function rescueText({ nome, slots = [], now }) {
  const oi = nome ? `Oi ${nome},` : "Oi,";
  const base = `${oi} passei na nossa call no horário e não te encontrei, acontece! Quer que eu remarque?`;
  if (slots.length >= 2) return `${base} Tenho ${slotLabel(slots[0].at, now)} ou ${slotLabel(slots[1].at, now)} livres, me diz qual fica bom que eu já reservo.`;
  if (slots.length === 1) return `${base} Consigo te encaixar ${slotLabel(slots[0].at, now)}, fica bom?`;
  return `${base} Me diz um horário que fica bom pra você que eu já reservo.`;
}

// Resposta a um lembrete: o que é confirmação e o que precisa de gente.
// Remarcação/negativa é testada ANTES ("sim, mas preciso remarcar" é humano).
const RESCHEDULE_RX = /remarc|reagend|mudar|trocar|outro hor|adiar|cancel|imprevisto|nao vou|nao consigo|nao vai dar|nao poss/;
const AFFIRM_RX = /(^|\s)(sim|confirmo|confirmad[oa]|pode ser|pode sim|combinado|fechado|show|beleza|blz|ok|okay|claro|com certeza|certo|perfeito|top|bora|estarei|vou estar|isso)(\s|[!.,)]|$)/;
export function classifyReminderReply(text) {
  const t = norm(text);
  if (!t.trim()) return "other";
  if (RESCHEDULE_RX.test(t)) return "reschedule";
  if (AFFIRM_RX.test(t) || String(text || "").includes("👍") || String(text || "").includes("✅")) return "confirm";
  return "other";
}

export function makeSdrRunner({ repo, whatsapp: wa, log = console, now = () => new Date() } = {}) {
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
    return messageId;
  }
  async function sendTemplate({ phone, name, params, phoneId, saas, leadId }) {
    const components = params.length ? [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t || "") })) }] : [];
    const { messageId } = await wa.sendTemplate(phone, name, "pt_BR", components, { phoneId });
    const rendered = (TEMPLATE_BODY[name] || name).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || "");
    await recordMessage(repo, { id: messageId, phone, direction: "out", text: rendered, status: "sent", author: SDR_AUTHOR, waPhoneId: phoneId || "", saas, leadId });
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
    const stats = { firstTouch: 0, reminders: 0, rescue: 0, skipped: 0 };
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
        !l.internal && !l.formExit && !l.disqualified &&
        !l.whatsappOptOut && !l.whatsappInvalid && digits(l.waPhone || l.phone);

      // ── 1. Primeiro toque ────────────────────────────────────────────────
      if (cfg.firstTouch) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead)) continue;
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
          const nome = firstName(lead.name);
          const sdrName = firstName(users.find((u) => u.id === lead.owner)?.name);
          const resumo = leadDigest(product, lead);
          const to = thread?.phone || phone;
          try {
            let via;
            if (windowOpen) {
              const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 2 });
              await sendText({ phone: to, text: firstTouchText({ nome, sdrName, resumo, slots, now: wnow }), phoneId, saas: product.id, leadId: lead.id });
              via = "text";
            } else {
              const names = await approvedNames();
              if (!names.has(cfg.templates.firstTouch)) { stats.skipped++; continue; } // espera a aprovação da Meta
              await sendTemplate({ phone: to, name: cfg.templates.firstTouch, params: [nome || "tudo bem", sdrName || "o time", resumo], phoneId, saas: product.id, leadId: lead.id });
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

      // ── 2. Lembretes da call (véspera · 1h · 10min) ──────────────────────
      if (cfg.reminders) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead)) continue;
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
          const nome = firstName(lead.name);
          const quando = slotLabel(lead.callAt, wnow);
          const phone = lead.waPhone || lead.phone;
          const thread = await findThreadByPhone(repo, phone);
          const to = thread?.phone || phone;
          try {
            try {
              await sendText({ phone: to, text: reminderText(due.key, { nome, quando, link: lead.callUrl || "" }), phoneId, saas: product.id, leadId: lead.id });
            } catch (err) {
              if (!outsideWindow(err)) throw err;
              // Janela de 24h fechada: template aprovado reabre; sem template,
              // alerta quente — o lembrete é justamente o anti no-show, não
              // pode morrer calado.
              const names = await approvedNames();
              if (names.has(cfg.templates.reminder)) {
                await sendTemplate({ phone: to, name: cfg.templates.reminder, params: [nome || "tudo bem", quando], phoneId, saas: product.id, leadId: lead.id });
              } else {
                await raiseAlert(repo, thread || { id: digits(phone), phone: digits(phone), name: lead.name || "", leadId: lead.id, saas: product.id }, {
                  text: `Lembrete ${due.key} da call não entregue (janela fechada, sem template aprovado) · confirmar na mão`,
                });
              }
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
      if (cfg.rescue) {
        for (const lead of leads) {
          if (sends >= CAP) break;
          if (!eligible(lead)) continue;
          if (!isNoShowStage(lead.stage)) continue;
          const sinceMs = Date.parse(lead.stageSince || "");
          if (!Number.isFinite(sinceMs)) continue;
          if (enabledMs && sinceMs < enabledMs) continue;
          if (nowMs - sinceMs > 48 * HOUR) continue; // furo velho é retomada humana
          if (lead.sdrLog?.noshowFor === lead.stageSince) continue;

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
          const nome = firstName(lead.name);
          const to = thread?.phone || phone;
          try {
            let via = "text";
            if (windowOpen) {
              const { slots } = await slotsForLead(repo, { lead, saas: product.id, now: wnow, limit: 2 });
              await sendText({ phone: to, text: rescueText({ nome, slots, now: wnow }), phoneId, saas: product.id, leadId: lead.id });
            } else {
              const names = await approvedNames();
              if (names.has(cfg.templates.rescue)) {
                await sendTemplate({ phone: to, name: cfg.templates.rescue, params: [nome || "tudo bem"], phoneId, saas: product.id, leadId: lead.id });
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
  // Com a CONVERSA da Fase 2 ligada, quem responde é o sdr-brain (que levanta
  // alerta só nos handoffs) — pop-up em toda resposta viraria ruído.
  const product = lead.saas ? await repo.get("products", lead.saas) : null;
  if (sdrBotConfig(product)?.conversation) return null;
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
export function startSdrFlow(repo, { whatsapp, intervalMs = 60_000, log = console } = {}) {
  const runner = makeSdrRunner({ repo, whatsapp, log });
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
