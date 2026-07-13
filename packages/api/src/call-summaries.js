// Resumo estratégico de call — cola o circuito Meet → transcrição → Claude →
// timeline do lead. summarizeLead faz UMA call; startCallSummaries é o poller
// que detecta calls encerradas (Meet criado pelo cockpit) e resume sozinho.
// O resumo vira activity "call_summary" (visível no drawer) e preenche o
// próximo toque do GPS quando a IA sugere follow-up e o lead está em aberto.
import { logActivity } from "./lead-flow.js";

const CLOSED_STAGE = /perdid|ganh|fechad|won|lost|cliente/i;

// Texto da timeline (plain, multiline, sem travessão — regra do Leo).
export function formatSummaryText(s) {
  const lines = [
    `Resumo da call (IA) · temperatura: ${s.temperatura}${s.temperaturaPorque ? ` (${s.temperaturaPorque})` : ""}`,
    "",
    s.resumo,
  ];
  if (s.dores?.length) lines.push("", "Dores confirmadas:", ...s.dores.map((d) => `• ${d}`));
  if (s.objecoes?.length) {
    lines.push("", "Objeções:");
    for (const o of s.objecoes) lines.push(`• ${o.objecao} ${o.resolvida ? "(tratada)" : "(EM ABERTO)"}: ${o.comoFoiTratada}`);
  }
  if (s.compromissos?.length) lines.push("", "Combinados:", ...s.compromissos.map((c) => `• ${c}`));
  if (s.followup?.nota) lines.push("", `Follow-up sugerido: ${s.followup.nota}`);
  if (s.followup?.whatsapp) lines.push("", `WhatsApp sugerido: "${s.followup.whatsapp}"`);
  return lines.join("\n");
}

export function makeCallSummarizer({ repo, google, anthropic, log = console }) {
  // Resume a última call do lead. Devolve { ok, reason?, summary? } — reasons
  // são estáveis pro drawer traduzir: not_configured, not_connected, no_meet,
  // transcript_not_ready, already_done.
  async function summarizeLead(leadId, { force = false } = {}) {
    if (!anthropic.configured()) return { ok: false, reason: "not_configured" };
    if (!(await google.connected())) return { ok: false, reason: "not_connected" };
    const lead = await repo.get("leads", leadId);
    if (!lead) return { ok: false, reason: "not_found" };
    const code = (String(lead.callUrl || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
    if (!code) return { ok: false, reason: "no_meet" };
    if (!force && lead.callSummaryFor && lead.callSummaryFor === lead.meetEventId) {
      return { ok: false, reason: "already_done" };
    }

    // 1º a Meet API (conferenceRecords). Se ela não devolver (comum quando quem
    // hospeda a call é outra conta que não a conectada), cai no fallback do Drive:
    // lê o Doc de transcrição no Drive do organizador (a conta conectada).
    let t = await google.fetchTranscript(code);
    if (!t && typeof google.fetchTranscriptFromDrive === "function") {
      try {
        t = await google.fetchTranscriptFromDrive({ eventId: lead.meetEventId, leadName: lead.name, since: lead.meetScheduledAt });
      } catch (err) {
        log.warn?.({ lead: lead.id, err: err.message }, "fallback de transcrição pelo Drive falhou");
      }
    }
    if (!t) return { ok: false, reason: "transcript_not_ready" };

    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const brt = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const { summary } = await anthropic.summarizeCall({
      transcript: t.text,
      lead: { name: lead.name, company: lead.company, niche: lead.niche, stage: lead.stage },
      productName: product?.name || "LeverAds",
      callDate: t.startTime ? brt(t.startTime) : "",
      today: brt(new Date()),
    });

    await logActivity(repo, {
      saas: lead.saas || "",
      lead: lead.id,
      type: "system",
      text: formatSummaryText(summary),
      meta: {
        event: "call_summary",
        recordingUrl: t.recordingUrl || "",
        meetEventId: lead.meetEventId || "",
        temperatura: summary.temperatura,
        summary,
      },
      author: "cockpit",
      at: t.endTime || undefined,
    });

    // Follow-up sugerido entra como próximo toque do GPS (só em lead aberto e
    // com horário no futuro; "quando" vem em hora de Brasília, sem fuso).
    const patch = { callSummaryFor: lead.meetEventId || code, callSummaryAt: new Date().toISOString() };
    const q = summary.followup?.quando || "";
    if (q && !CLOSED_STAGE.test(String(lead.stage || ""))) {
      const at = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(q) ? q : `${q.length === 16 ? `${q}:00` : q}-03:00`);
      if (Number.isFinite(at.getTime()) && at.getTime() > Date.now()) {
        patch.nextActionAt = at.toISOString();
        if (summary.followup.nota) patch.nextActionNote = summary.followup.nota;
      }
    }
    await repo.update("leads", lead.id, patch);
    return { ok: true, summary, recordingUrl: t.recordingUrl || "" };
  }

  // Um passe do poller: calls do Meet cujo horário já passou (com folga de
  // 50 min pra call acontecer) e que ainda não foram resumidas.
  async function tick() {
    if (!anthropic.configured() || !(await google.connected())) return { scanned: 0, summarized: 0 };
    const now = Date.now();
    const leads = (await repo.list("leads")).filter((l) => {
      if (!String(l.callUrl || "").includes("meet.google.com")) return false;
      if (l.callSummaryFor && l.callSummaryFor === l.meetEventId) return false;
      const base = l.meetScheduledAt || "";
      const at = base ? new Date(base).getTime() : NaN;
      if (!Number.isFinite(at)) return false;
      return at + 50 * 60_000 < now && at > now - 7 * 86_400_000; // janela: terminou há pouco, até 7 dias
    });
    let done = 0;
    for (const l of leads) {
      try {
        const r = await summarizeLead(l.id);
        if (r.ok) { done++; log.info?.({ lead: l.id }, "call resumida"); }
      } catch (err) {
        log.warn?.({ lead: l.id, err: err.message }, "resumo de call falhou (re-tenta no próximo ciclo)");
      }
    }
    return { scanned: leads.length, summarized: done };
  }

  return { summarizeLead, tick };
}

// Poller de produção: a cada 10 min, single-flight, mesmo padrão do
// startMarketingAutoSync. Silencioso quando IA/Google não estão configurados.
export function startCallSummaries(repo, { google, anthropic, intervalMs = 600_000, log = console } = {}) {
  const worker = makeCallSummarizer({ repo, google, anthropic, log });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await worker.tick(); }
    catch (err) { log.warn?.({ err: err.message }, "poller de resumos falhou"); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 15_000).unref?.(); // primeiro passe pouco depois do boot
  return { stop: () => clearInterval(timer), run };
}
