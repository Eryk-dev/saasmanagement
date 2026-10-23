// Broadcast de E-MAIL em fila no servidor (docs/PLANO-DISPAROS.md). Antes a
// rota send-email mandava tudo dentro da própria requisição, um e-mail atrás
// do outro com o respiro do Resend: com algumas centenas de leads o proxy
// derrubava a conexão no meio. Agora "enviar" só enfileira
// (`campaign.sent[lead].emailStatus = "queued"`) e este runner manda em lotes.
// Mesmas regras de antes: pula sem e-mail, descadastrado e devolvido; corpo com
// link de descadastro e o header List-Unsubscribe; toque na timeline do lead.
// Muita falha seguida (ex.: domínio não verificado) pausa o broadcast com o motivo.

import { logActivity } from "../crm/lead-flow.js";
import { baseUrl, emailBodyWithUnsub, interpolate, leadTokens, unsubToken } from "./disparos-util.js";
import { hasQueued } from "./broadcast-wa.js";

const PER_TICK = 40;          // com o respiro de 550 ms do mailer, ~22 s por ciclo
const BREAKER_MIN = 10;
const BREAKER_MAX_FAIL = 0.5;
export const hasEmailChannel = (c) => c?.channel === "email" || c?.channel === "both" || (!c?.channel && !!c?.channels?.email);

// Por que este lead não recebe o e-mail do broadcast ("" = recebe).
export function emailSkipReason(lead, campaign) {
  if (!lead) return "lead não encontrado";
  if (campaign.saas && lead.saas && lead.saas !== campaign.saas) return "lead de outro produto";
  if (!lead.email) return "sem e-mail";
  if (lead.emailOptOut) return "descadastrado";
  if (lead.emailInvalid) return "e-mail devolvido";
  const st = campaign.sent?.[lead.id];
  if (st?.email || ["queued", "sent"].includes(st?.emailStatus)) return "já recebeu";
  return "";
}

export async function enqueueEmailBroadcast(repo, campaign, leadIds, { by = "", now = new Date() } = {}) {
  if (!campaign.email?.subject && !campaign.email?.body) throw Object.assign(new Error("broadcast sem assunto/corpo de e-mail"), { statusCode: 400 });
  const sent = { ...(campaign.sent || {}) };
  const skipped = [];
  let queued = 0;
  for (const id of [...new Set(leadIds || [])]) {
    const lead = await repo.get("leads", id);
    const reason = emailSkipReason(lead, { ...campaign, sent });
    if (reason) { skipped.push({ leadId: id, reason }); continue; }
    sent[id] = { ...(sent[id] || {}), emailStatus: "queued", emailQueuedAt: now.toISOString(), ...(by ? { emailBy: by } : {}) };
    queued++;
  }
  const patch = { sent, ...(queued ? { status: "sending", pauseReason: "", doneAt: "" } : {}) };
  const updated = await repo.update("campaigns", campaign.id, patch);
  return { queued, skipped, campaign: updated };
}

// Um ciclo do runner. Devolve um resumo (teste e log).
export async function runEmailBroadcastTick(repo, { mailer, now = () => new Date(), perTick = PER_TICK, log = console } = {}) {
  const report = { sent: 0, failed: 0, paused: [], done: [] };
  const active = (await repo.list("campaigns")).filter((c) => c.status === "sending" && Object.values(c.sent || {}).some((s) => s?.emailStatus === "queued"));
  if (!active.length || !mailer || !(await mailer.ready())) return report; // sem provedor: a fila espera
  const base = baseUrl();
  let budget = perTick;
  for (const c of active) {
    if (budget <= 0) break;
    const product = c.saas ? await repo.get("products", c.saas) : null;
    const sent = { ...(c.sent || {}) };
    const queue = Object.entries(sent).filter(([, s]) => s?.emailStatus === "queued").map(([id]) => id).slice(0, budget);
    let attempts = 0, fails = 0, lastError = "";
    for (const leadId of queue) {
      const lead = await repo.get("leads", leadId);
      const at = now().toISOString();
      const reason = emailSkipReason(lead, { ...c, sent: { ...sent, [leadId]: undefined } });
      if (reason) { sent[leadId] = { ...sent[leadId], emailStatus: "skipped", emailError: reason }; continue; }
      budget--;
      attempts++;
      const toks = leadTokens(lead, product);
      const unsubUrl = `${base}/u/${unsubToken(lead.id)}`;
      try {
        await mailer.send({ to: lead.email, subject: interpolate(c.email?.subject || "", toks), text: emailBodyWithUnsub(c.email?.body || "", toks, unsubUrl), headers: { "List-Unsubscribe": `<${unsubUrl}>` } });
        sent[leadId] = { ...sent[leadId], email: at, emailStatus: "sent" };
        report.sent++;
        await logActivity(repo, { saas: lead.saas || c.saas || "", lead: lead.id, type: "email", text: `broadcast: ${c.name || "sem nome"}`, meta: { campaign: c.id, stageAtSend: lead.stage || "" }, author: sent[leadId].emailBy || "disparo", at }).catch(() => null);
      } catch (err) {
        lastError = String(err.message || err).slice(0, 200);
        sent[leadId] = { ...sent[leadId], emailStatus: "failed", emailError: lastError, emailFailedAt: at };
        fails++;
        report.failed++;
      }
    }
    const patch = { sent };
    if (attempts >= BREAKER_MIN && fails / attempts > BREAKER_MAX_FAIL) {
      patch.status = "paused";
      patch.pauseReason = `${fails} de ${attempts} e-mails falharam (${lastError}); confira o e-mail em Configurações → Integrações antes de retomar`;
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

// Runner do servidor: um ciclo por vez, a cada 30 s.
export function startEmailBroadcasts(repo, { mailer, log = console, intervalMs = 30_000 } = {}) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const r = await runEmailBroadcastTick(repo, { mailer, log });
      if (r.sent || r.failed || r.paused.length) log.info?.(`[broadcast-email] ${r.sent} enviado(s), ${r.failed} falha(s)${r.paused.length ? `, pausado(s): ${r.paused.join(", ")}` : ""}`);
    } catch (err) {
      log.warn?.(`[broadcast-email] ciclo falhou: ${String(err.message || err).slice(0, 200)}`);
    } finally { running = false; }
  }
  const id = setInterval(tick, intervalMs);
  id.unref?.();
  return { tick, stop: () => clearInterval(id) };
}
