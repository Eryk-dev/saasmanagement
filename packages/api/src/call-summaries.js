// Resumo estratégico de call — cola o circuito Meet → transcrição → Claude →
// timeline do lead. summarizeLead faz UMA call; startCallSummaries é o poller
// que detecta calls encerradas (Meet criado pelo cockpit) e resume sozinho.
// O resumo vira activity "call_summary" (visível no drawer) e preenche o
// próximo toque do GPS quando a IA sugere follow-up e o lead está em aberto.
import { logActivity, appointmentAt } from "./lead-flow.js";

const CLOSED_STAGE = /perdid|ganh|fechad|won|lost|cliente/i;

// Dois tipos de call por lead, cada um com seu Meet e dedup próprios (a call de
// integração NÃO sobrescreve a de venda): campos do lead, marcador de dedup e o
// método de IA que resume. `call` = venda; `integracao` = onboarding pós-venda.
const MEET_KINDS = {
  call: {
    urlField: "callUrl", eventField: "meetEventId", schedField: "meetScheduledAt",
    dedupField: "callSummaryFor", stampField: "callSummaryAt", ai: "summarizeCall",
  },
  integracao: {
    urlField: "integrationCallUrl", eventField: "integrationMeetEventId", schedField: "integrationScheduledAt",
    dedupField: "integrationSummaryFor", stampField: "integrationSummaryAt", ai: "summarizeIntegration",
  },
};

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

// Texto da timeline da call de INTEGRAÇÃO (onboarding).
export function formatIntegrationText(s) {
  const lines = [
    `Resumo da integração (IA) · cliente ${s.sentimento}${s.sentimentoPorque ? ` (${s.sentimentoPorque})` : ""}`,
    "",
    s.resumo,
  ];
  if (s.configurado?.length) lines.push("", "Configurado:", ...s.configurado.map((c) => `• ${c}`));
  if (s.pendencias?.length) {
    lines.push("", "Pendências:");
    for (const p of s.pendencias) lines.push(`• ${p.item} (${p.responsavel})`);
  }
  if (s.proximosPassos?.length) lines.push("", "Próximos passos:", ...s.proximosPassos.map((p) => `• ${p}`));
  if (s.followup?.nota) lines.push("", `Acompanhamento: ${s.followup.nota}`);
  if (s.followup?.whatsapp) lines.push("", `WhatsApp sugerido: "${s.followup.whatsapp}"`);
  return lines.join("\n");
}

export function makeCallSummarizer({ repo, google, anthropic, log = console }) {
  // Resume a última call do lead. Devolve { ok, reason?, summary? } — reasons
  // são estáveis pro drawer traduzir: not_configured, not_connected, no_meet,
  // transcript_not_ready, already_done.
  async function summarizeLead(leadId, { force = false, kind = "call" } = {}) {
    if (!anthropic.configured()) return { ok: false, reason: "not_configured" };
    if (!(await google.connected())) return { ok: false, reason: "not_connected" };
    const cfg = MEET_KINDS[kind] || MEET_KINDS.call;
    const lead = await repo.get("leads", leadId);
    if (!lead) return { ok: false, reason: "not_found" };
    const code = (String(lead[cfg.urlField] || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
    if (!code) return { ok: false, reason: "no_meet" };
    if (!force && lead[cfg.dedupField] && lead[cfg.dedupField] === lead[cfg.eventField]) {
      return { ok: false, reason: "already_done" };
    }

    // 1º a Meet API (conferenceRecords). Se ela não devolver (comum quando quem
    // hospeda a call é outra conta que não a conectada), cai no fallback do Drive:
    // lê o Doc de transcrição no Drive do organizador (a conta conectada).
    // A Meet API LANÇA em 4xx (API desabilitada no Cloud, sala de outra conta,
    // escopo faltando) — sem este catch a exceção subia e matava o fallback do
    // Drive, então a call ficava pra sempre sem resumo e o poller só logava
    // warn. Erro dela vira diagnóstico e o Drive segue sendo tentado.
    let t = null;
    let detail = "";
    try {
      t = await google.fetchTranscript(code);
    } catch (err) {
      detail = `meet: ${String(err.message || err).slice(0, 160)}`;
      log.warn?.({ lead: leadId, kind, err: err.message }, "Meet API falhou (segue pro fallback do Drive)");
    }
    if (!t && typeof google.fetchTranscriptFromDrive === "function") {
      // Os dois motivos SOMAM (meet + drive): quando nenhum caminho traz a
      // transcrição, o diagnóstico precisa dizer o que cada um respondeu.
      const add = (s) => { detail = detail ? `${detail} · ${s}` : s; };
      try {
        t = await google.fetchTranscriptFromDrive({ eventId: lead[cfg.eventField], leadName: lead.name, since: lead[cfg.schedField] });
        if (!t) add("drive: Doc de transcrição não encontrado (confira o título/horário da call ou a conta do Drive)");
      } catch (err) {
        // 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT aqui = reconectar o Google (escopo drive.readonly novo).
        add(`drive: ${String(err.message || err).slice(0, 160)}`);
        log.warn?.({ lead: lead.id, kind, err: err.message }, "fallback de transcrição pelo Drive falhou");
      }
    }
    if (!t) return { ok: false, reason: "transcript_not_ready", ...(detail ? { detail } : {}) };

    const product = lead.saas ? await repo.get("products", lead.saas) : null;
    const brt = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const { summary } = await anthropic[cfg.ai]({
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
      text: kind === "integracao" ? formatIntegrationText(summary) : formatSummaryText(summary),
      meta: {
        event: "call_summary",
        kind, // "call" (venda) | "integracao" (onboarding) — o card e a análise de pitch se orientam por isso
        recordingUrl: t.recordingUrl || "",
        meetEventId: lead[cfg.eventField] || "",
        temperatura: summary.temperatura || summary.sentimento || "",
        summary,
      },
      author: "cockpit",
      at: t.endTime || undefined,
    });

    // Follow-up/acompanhamento sugerido entra como próximo toque do GPS (só em
    // lead aberto e com horário no futuro; "quando" vem em hora de Brasília).
    const patch = { [cfg.dedupField]: lead[cfg.eventField] || code, [cfg.stampField]: new Date().toISOString() };
    const q = summary.followup?.quando || "";
    if (q && !CLOSED_STAGE.test(String(lead.stage || ""))) {
      const at = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(q) ? q : `${q.length === 16 ? `${q}:00` : q}-03:00`);
      if (Number.isFinite(at.getTime()) && at.getTime() > Date.now()) {
        // COMPROMISSO MARCADO MANDA: com call/integração já agendada, a sugestão
        // da IA não muda o HORÁRIO do GPS (o card mostraria uma hora que não é a
        // do compromisso e o time lê errado). A NOTA dela entra do mesmo jeito,
        // que é onde está o valor ("confirmar o pagamento antes da reunião").
        const product = lead.saas ? await repo.get("products", lead.saas).catch(() => null) : null;
        const booked = appointmentAt(product, lead);
        patch.nextActionAt = booked || at.toISOString();
        if (summary.followup.nota) patch.nextActionNote = summary.followup.nota;
      }
    }
    await repo.update("leads", lead.id, patch);
    return { ok: true, kind, summary, recordingUrl: t.recordingUrl || "" };
  }

  // Um passe do poller: TODAS as calls (venda + integração) cujo horário já
  // passou (folga de 50 min pra acontecer) e que ainda não foram resumidas.
  async function tick() {
    if (!anthropic.configured() || !(await google.connected())) return { scanned: 0, summarized: 0 };
    const now = Date.now();
    const jobs = [];
    for (const l of await repo.list("leads")) {
      for (const kind of Object.keys(MEET_KINDS)) {
        const cfg = MEET_KINDS[kind];
        if (!String(l[cfg.urlField] || "").includes("meet.google.com")) continue;
        if (l[cfg.dedupField] && l[cfg.dedupField] === l[cfg.eventField]) continue;
        const at = l[cfg.schedField] ? new Date(l[cfg.schedField]).getTime() : NaN;
        if (!Number.isFinite(at)) continue;
        if (at + 50 * 60_000 < now && at > now - 7 * 86_400_000) jobs.push({ id: l.id, kind }); // terminou há pouco, até 7 dias
      }
    }
    let done = 0;
    for (const j of jobs) {
      try {
        const r = await summarizeLead(j.id, { kind: j.kind });
        if (r.ok) { done++; log.info?.({ lead: j.id, kind: j.kind }, "call resumida"); }
      } catch (err) {
        log.warn?.({ lead: j.id, kind: j.kind, err: err.message }, "resumo de call falhou (re-tenta no próximo ciclo)");
      }
    }
    return { scanned: jobs.length, summarized: done };
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
