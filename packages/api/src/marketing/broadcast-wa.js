// Broadcast de WhatsApp pela API oficial (docs/PLANO-DISPAROS.md, fase 3).
// A campanha (na tela: "broadcast") escolhe um MODELO APROVADO da Meta e liga
// cada variável {{n}} a um campo do lead ou a um texto fixo. "Enviar" só põe os
// leads na fila (`campaign.sent[lead].waStatus = "queued"`); o envio sai no
// servidor, em lotes, por este runner — nunca do navegador.
//
// Proteções do número (o mesmo espírito do resgate do SDR):
//  - teto diário pela faixa do número (shared/wa-tier.js, 80% da faixa);
//  - pausa quando a Meta sinaliza o número (saúde "danger");
//  - disjuntor: muita falha seguida pausa o broadcast com o motivo;
//  - quem pediu para sair (whatsappOptOut) ou tem número inválido fica fora.
// Cada mensagem vai para o Inbox (wa_messages, autor "disparo") e para a
// timeline do lead; o webhook de status atualiza entregue/lida/falhou.

import { logActivity } from "../crm/lead-flow.js";
import { recordMessage } from "../whatsapp/wa-store.js";
import { getWaHealth, waHealthSummary } from "../whatsapp/wa-health.js";
import { digits } from "../whatsapp/whatsapp.js";
import { broadcastDailyCap } from "../shared/wa-tier.js";
import { campaignTokens } from "../shared/campaign-tokens.js";
import { dayKey } from "../metrics/metrics-core.js";

export const BROADCAST_AUTHOR = "disparo";
// Broadcast que sai por WhatsApp: só WhatsApp ou os dois canais ("both"; o e-mail tem a própria fila em broadcast-email.js).
export const hasWhatsappChannel = (c) => c?.channel === "whatsapp" || c?.channel === "both";
// Ainda há envio na fila de algum canal? Só sem nada na fila o broadcast fica "concluído".
export const hasQueued = (c) => Object.values(c?.sent || {}).some((s) => s?.waStatus === "queued" || s?.emailStatus === "queued");
const PER_TICK = 20;          // envios por ciclo (ciclo de 30 s ≈ 40/min)
const BREAKER_MIN = 20;       // amostra mínima para o disjuntor
const BREAKER_MAX_FAIL = 0.2; // >20% de falha nas últimas tentativas pausa
const tplMediaKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64);

// Valor de cada variável do modelo para este lead: { source: "token", value: "nome" } ou { source: "text", value }.
export function templateParams(template, lead, product) {
  const toks = campaignTokens(lead, product);
  return Array.from({ length: Number(template?.params) || 0 }, (_, i) => {
    const p = (template?.vars || [])[i] || {};
    return String(p.source === "text" ? p.value || "" : toks[p.value] || "").trim();
  });
}
export const renderTemplate = (body, params) => String(body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || "");

// Foto do cabeçalho de um modelo com imagem: a padrão salva no Inbox, subida pro
// número que vai enviar. Sem foto, lança (o modelo não sai sem o parâmetro).
export async function templateHeaderMedia(repo, wa, tpl, phoneId) {
  if (tpl?.header !== "image") return "";
  const def = await repo.get("wa_template_media", tplMediaKey(tpl.name)).catch(() => null);
  if (!def?.data) throw new Error("o modelo tem imagem no cabeçalho e a foto padrão não está salva");
  return wa.uploadMedia(Buffer.from(def.data, "base64"), { mime: def.mime || "image/jpeg", filename: def.filename || "foto.jpg", phoneId });
}

// Envia UM modelo para UM lead e registra no Inbox e na timeline. Usado pelo
// passo de WhatsApp das sequências; o broadcast tem o próprio ciclo em lote.
export async function sendTemplateToLead(repo, wa, { tpl, lead, product, phoneId, author, activity = {}, now = new Date() }) {
  const params = templateParams(tpl, lead, product);
  if (params.some((p) => !p)) throw Object.assign(new Error("variável sem valor para este lead"), { skip: true });
  const headerMediaId = await templateHeaderMedia(repo, wa, tpl, phoneId);
  const components = [];
  if (tpl.header === "image") components.push({ type: "header", parameters: [{ type: "image", image: { id: headerMediaId } }] });
  if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
  const at = now.toISOString();
  const { messageId } = await wa.sendTemplate(lead.phone, tpl.name, tpl.language || "pt_BR", components, { phoneId });
  const text = renderTemplate(tpl.body, params);
  await recordMessage(repo, { id: messageId, phone: lead.phone, direction: "out", text, at, status: "sent", author, leadId: lead.id, saas: lead.saas || product?.id || "", waPhoneId: phoneId || "" }).catch(() => null);
  await logActivity(repo, { saas: lead.saas || product?.id || "", lead: lead.id, type: "whatsapp", text: activity.text || "", meta: { template: tpl.name, stageAtSend: lead.stage || "", ...(activity.meta || {}) }, author, at }).catch(() => null);
  return { messageId, text };
}

// Por que este lead não entra no broadcast de WhatsApp ("" = entra).
export function waSkipReason(lead, campaign, product) {
  if (!lead) return "lead não encontrado";
  if (campaign.saas && lead.saas && lead.saas !== campaign.saas) return "lead de outro produto";
  if (!digits(lead.phone || "")) return "sem telefone";
  if (lead.whatsappOptOut) return "pediu para não receber";
  if (lead.whatsappInvalid) return "número sem WhatsApp";
  const st = campaign.sent?.[lead.id];
  if (st?.whatsapp || ["queued", "sent", "delivered", "read"].includes(st?.waStatus)) return "já recebeu";
  const params = templateParams(campaign.wa?.template, lead, product);
  if (params.some((p) => !p)) return "variável sem valor para este lead";
  return "";
}

// Põe os leads na fila. Não envia nada; o runner envia.
export async function enqueueWaBroadcast(repo, campaign, leadIds, { now = new Date() } = {}) {
  const tpl = campaign.wa?.template;
  if (!tpl?.name) throw Object.assign(new Error("escolha o modelo aprovado da Meta"), { statusCode: 400 });
  const product = campaign.saas ? await repo.get("products", campaign.saas) : null;
  if (tpl.header === "image" && !(await repo.get("wa_template_media", tplMediaKey(tpl.name)).catch(() => null))?.data) {
    throw Object.assign(new Error("esse modelo tem imagem no cabeçalho: salve a foto padrão dele no Inbox antes de disparar"), { statusCode: 400 });
  }
  const sent = { ...(campaign.sent || {}) };
  const skipped = [];
  let queued = 0;
  for (const id of [...new Set(leadIds || [])]) {
    const lead = await repo.get("leads", id);
    const reason = waSkipReason(lead, { ...campaign, sent }, product);
    if (reason) { skipped.push({ leadId: id, reason }); continue; }
    sent[id] = { ...(sent[id] || {}), waStatus: "queued", queuedAt: now.toISOString() };
    queued++;
  }
  const patch = { sent, ...(queued ? { status: "sending", pauseReason: "", doneAt: "" } : {}) };
  const updated = await repo.update("campaigns", campaign.id, patch);
  return { queued, skipped, campaign: updated };
}

// Quantos broadcasts de WhatsApp saíram hoje (dia do negócio) pelo número.
function sentTodayByPhone(campaigns, productsById, today) {
  const out = new Map();
  for (const c of campaigns) {
    const phoneId = productsById.get(c.saas)?.waPhoneId || "";
    for (const st of Object.values(c.sent || {})) {
      if (st?.whatsapp && st.waStatus && st.waStatus !== "queued" && dayKey(st.whatsapp) === today) out.set(phoneId, (out.get(phoneId) || 0) + 1);
    }
  }
  return out;
}

// Um ciclo do runner. Devolve um resumo (teste e log).
export async function runWaBroadcastTick(repo, { wa, now = () => new Date(), perTick = PER_TICK, log = console, numberInfoCache = new Map() } = {}) {
  const report = { sent: 0, failed: 0, paused: [], done: [] };
  if (!wa?.configured?.()) return report;
  const campaigns = (await repo.list("campaigns")).filter(hasWhatsappChannel);
  const active = campaigns.filter((c) => c.status === "sending" && Object.values(c.sent || {}).some((s) => s?.waStatus === "queued"));
  if (!active.length) {
    // Terminou a fila: fecha quem ficou "enviando" sem ninguém na fila.
    for (const c of campaigns.filter((x) => x.status === "sending" && !hasQueued(x))) {
      await repo.update("campaigns", c.id, { status: "done", doneAt: now().toISOString() });
      report.done.push(c.id);
    }
    return report;
  }
  const health = waHealthSummary(await getWaHealth(repo));
  if (health.level === "danger") {
    for (const c of active) { await repo.update("campaigns", c.id, { status: "paused", pauseReason: health.messages[0] || "número sinalizado pela Meta" }); report.paused.push(c.id); }
    return report;
  }
  const products = await repo.list("products");
  const productsById = new Map(products.map((p) => [p.id, p]));
  const today = dayKey(now().toISOString());
  const usedToday = sentTodayByPhone(campaigns, productsById, today);
  let budget = perTick;
  for (const c of active) {
    if (budget <= 0) break;
    const product = productsById.get(c.saas) || null;
    const phoneId = product?.waPhoneId || undefined;
    const key = phoneId || "";
    if (!numberInfoCache.has(key)) numberInfoCache.set(key, await wa.numberInfo?.({ phoneId }).catch(() => null));
    const cap = broadcastDailyCap(numberInfoCache.get(key)?.tier);
    const left = cap == null ? 250 - (usedToday.get(key) || 0) : cap - (usedToday.get(key) || 0); // sem faixa conhecida: a menor (250)
    if (left <= 0) continue; // teto do dia: segue amanhã
    const tpl = c.wa.template;
    let headerMediaId = "";
    if (tpl.header === "image") {
      const def = await repo.get("wa_template_media", tplMediaKey(tpl.name)).catch(() => null);
      if (!def?.data) { await repo.update("campaigns", c.id, { status: "paused", pauseReason: "o modelo tem imagem no cabeçalho e a foto padrão sumiu" }); report.paused.push(c.id); continue; }
      try { headerMediaId = await wa.uploadMedia(Buffer.from(def.data, "base64"), { mime: def.mime || "image/jpeg", filename: def.filename || "foto.jpg", phoneId }); }
      catch (err) { log.warn?.(`broadcast ${c.id}: falha ao subir a foto do cabeçalho: ${err.message}`); continue; }
    }
    const sent = { ...(c.sent || {}) };
    const queue = Object.entries(sent).filter(([, s]) => s?.waStatus === "queued").map(([id]) => id).slice(0, Math.min(budget, left));
    const attempts = [];
    for (const leadId of queue) {
      const lead = await repo.get("leads", leadId);
      const at = now().toISOString();
      const reason = waSkipReason(lead, { ...c, sent: { ...sent, [leadId]: undefined } }, product);
      if (reason) { sent[leadId] = { ...sent[leadId], waStatus: "skipped", waError: reason, at }; continue; }
      const params = templateParams(tpl, lead, product);
      const components = [];
      if (tpl.header === "image") components.push({ type: "header", parameters: [{ type: "image", image: { id: headerMediaId } }] });
      if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text })) });
      const text = renderTemplate(tpl.body, params);
      budget--;
      try {
        const { messageId } = await wa.sendTemplate(lead.phone, tpl.name, tpl.language || "pt_BR", components, { phoneId });
        sent[leadId] = { ...sent[leadId], whatsapp: at, waStatus: "sent", waMessageId: messageId || "" };
        attempts.push(true);
        report.sent++;
        usedToday.set(key, (usedToday.get(key) || 0) + 1);
        await recordMessage(repo, { id: messageId, phone: lead.phone, direction: "out", text, at, status: "sent", author: BROADCAST_AUTHOR, leadId: lead.id, saas: lead.saas || c.saas || "", waPhoneId: phoneId || "" }).catch(() => null);
        await logActivity(repo, { saas: lead.saas || c.saas || "", lead: lead.id, type: "whatsapp", text: `broadcast: ${c.name || "sem nome"}`, meta: { campaign: c.id, template: tpl.name, stageAtSend: lead.stage || "" }, author: BROADCAST_AUTHOR, at }).catch(() => null);
      } catch (err) {
        sent[leadId] = { ...sent[leadId], waStatus: "failed", waError: String(err.message || err).slice(0, 200), at };
        attempts.push(false);
        report.failed++;
      }
    }
    // Disjuntor: as últimas tentativas do broadcast (as deste ciclo + as anteriores).
    const recent = Object.values(sent).filter((s) => s?.at || s?.whatsapp).map((s) => ({ ok: s.waStatus !== "failed", at: s.at || s.whatsapp }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
    const fails = recent.filter((r) => !r.ok).length;
    const patch = { sent };
    if (recent.length >= BREAKER_MIN && fails / recent.length > BREAKER_MAX_FAIL) {
      patch.status = "paused";
      patch.pauseReason = `${fails} de ${recent.length} envios recentes falharam; confira o modelo e o número antes de retomar`;
      report.paused.push(c.id);
    } else if (!hasQueued({ sent })) {
      patch.status = "done";
      patch.doneAt = now().toISOString();
      report.done.push(c.id);
    }
    await repo.update("campaigns", c.id, patch);
  }
  return report;
}

// Progresso do broadcast: fila e entrega (o webhook atualiza o status em wa_messages).
export async function waBroadcastProgress(repo, campaign) {
  const out = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, email: { queued: 0, sent: 0, failed: 0, skipped: 0 } };
  const ids = new Map();
  for (const s of Object.values(campaign.sent || {})) {
    if (s?.emailStatus && s.emailStatus in out.email) out.email[s.emailStatus]++;
    else if (s?.email && !s?.emailStatus) out.email.sent++; // enviado antes da fila (rota antiga)
  }
  for (const [leadId, s] of Object.entries(campaign.sent || {})) {
    if (!s?.waStatus) continue;
    if (s.waStatus === "sent" && s.waMessageId) ids.set(s.waMessageId, leadId);
    else out[s.waStatus] = (out[s.waStatus] || 0) + 1;
  }
  if (ids.size) {
    const msgs = await repo.listWhere("wa_messages", { author: BROADCAST_AUTHOR, saas: campaign.saas || undefined }, { fields: ["status"] }).catch(() => []);
    const byId = new Map(msgs.map((m) => [m.id, m.status]));
    for (const id of ids.keys()) {
      const st = String(byId.get(id) || "sent");
      if (st === "read") out.read++;
      else if (st === "delivered") out.delivered++;
      else if (st === "failed") out.failed++;
      else out.sent++;
    }
  }
  return out;
}

// Runner do servidor: um ciclo por vez, a cada 30 s.
export function startWaBroadcasts(repo, { whatsapp, log = console, intervalMs = 30_000 } = {}) {
  let running = false;
  const numberInfoCache = new Map();
  let cacheAt = 0;
  async function tick() {
    if (running) return;
    running = true;
    try {
      if (Date.now() - cacheAt > 10 * 60_000) { numberInfoCache.clear(); cacheAt = Date.now(); } // faixa muda pouco
      const r = await runWaBroadcastTick(repo, { wa: whatsapp, log, numberInfoCache });
      if (r.sent || r.failed || r.paused.length) log.info?.(`[broadcast] ${r.sent} enviado(s), ${r.failed} falha(s)${r.paused.length ? `, pausado(s): ${r.paused.join(", ")}` : ""}`);
    } catch (err) {
      log.warn?.(`[broadcast] ciclo falhou: ${String(err.message || err).slice(0, 200)}`);
    } finally { running = false; }
  }
  const id = setInterval(tick, intervalMs);
  id.unref?.();
  return { tick, stop: () => clearInterval(id) };
}
