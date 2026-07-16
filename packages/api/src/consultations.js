// Consultas 1:1 (UniqueKids · mentoria de 8 encontros) — a lógica fora das
// rotas: espelho na agenda Google PESSOAL da responsável (Ana) e o resumo
// automático por IA (Meet → transcrição → summarizeConsultation), no mesmo
// padrão do circuito de calls de venda (call-summaries.js), mas num poller
// próprio pra não mexer no fluxo de leads.
//
// Registro (collection `consultations`): { id, saas, customerId, leadId,
// clientName, n (1..8), at ("YYYY-MM-DDTHH:MM" hora de Brasília, sem fuso),
// durationMin, status scheduled|done|no_show|canceled, notes, owner (userId da
// responsável), meetUrl/meetEventId/meetScheduledAt (Meet do time, transcrição
// automática), calEventId/calEventUser (espelho pessoal), summary (IA),
// summaryDoneFor/summaryAt (dedup), transcriptUrl }.

const TZ = "America/Sao_Paulo";

// Mesma semântica do calTimes do google-user.js (módulo-privado lá): hora de
// Brasília crua + timeZone; data pura vira evento de dia inteiro.
function calTimes(at, minutes) {
  const v = String(at || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + "T00:00:00");
    const nx = new Date(d.getTime() + 86_400_000);
    const day = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { start: { date: day(d) }, end: { date: day(nx) } };
  }
  const s = new Date(v + (v.length === 16 ? ":00" : ""));
  const e = new Date(s.getTime() + minutes * 60_000);
  const naive = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
  return { start: { dateTime: naive(s), timeZone: TZ }, end: { dateTime: naive(e), timeZone: TZ } };
}

// Espelha a consulta na agenda pessoal da responsável. Best-effort puro (nunca
// lança). Rastreia calEventId + calEventUser no próprio registro: remarcar
// atualiza o MESMO evento; desmarcar/cancelar apaga; trocar a responsável move.
export async function syncConsultationCalendar(repo, gu, c) {
  if (!gu || !gu.configured() || !c) return {};
  const curId = c.calEventId || "";
  const curUser = c.calEventUser || "";
  const patch = {};
  let want = false;
  try { want = !!(c.at && c.owner && c.status !== "canceled" && (await gu.connectedFor(c.owner))); } catch { want = false; }
  if (want) {
    const { start, end } = calTimes(c.at, Number(c.durationMin) || 60);
    const description = [
      `Cliente: ${c.clientName || "?"}`,
      c.childName ? `Criança: ${c.childName}` : "",
      c.phone ? `WhatsApp: ${c.phone}` : "",
      c.meetUrl ? `Meet: ${c.meetUrl}` : "",
    ].filter(Boolean).join("\n");
    let eventId = curId;
    if (curId && curUser && curUser !== c.owner) { await gu.deleteEvent(curUser, curId); eventId = ""; }
    try {
      const r = await gu.upsertEvent(c.owner, { eventId, summary: `Consulta ${c.n || "?"}/8 · ${c.clientName || "cliente"}`, description, start, end });
      if (r.eventId !== curId || curUser !== c.owner) { patch.calEventId = r.eventId; patch.calEventUser = c.owner; }
    } catch { /* mantém o que tinha */ }
  } else if (curId && curUser) {
    await gu.deleteEvent(curUser, curId);
    patch.calEventId = ""; patch.calEventUser = "";
  }
  if (Object.keys(patch).length) { try { await repo.update("consultations", c.id, patch); } catch { /* fail-open */ } }
  return patch;
}

// Texto plano do resumo da consulta (timeline/compose; sem travessão).
export function formatConsultationText(s) {
  const lines = [`Consulta (resumo IA)`, "", s.resumo || ""];
  if (s.evolucao) lines.push("", `Evolução: ${s.evolucao}`);
  if (s.temas?.length) lines.push("", "Temas trabalhados:", ...s.temas.map((t) => `• ${t}`));
  if (s.combinados?.length) lines.push("", "Combinados:", ...s.combinados.map((c) => `• ${c}`));
  if (s.tarefas?.length) lines.push("", "Tarefas de casa:", ...s.tarefas.map((t) => `• ${t}`));
  if (s.sinais) lines.push("", `Sinais de atenção: ${s.sinais}`);
  if (s.proxima) lines.push("", `Foco da próxima: ${s.proxima}`);
  return lines.join("\n");
}

// Resume UMA consulta: acha a transcrição do Meet (API do Meet, fallback Drive)
// e grava o resumo estruturado no próprio registro. Dedup por meetEventId.
export function makeConsultationSummarizer({ repo, google, anthropic, log = console }) {
  async function summarize(id, { force = false } = {}) {
    if (!anthropic?.configured?.()) return { ok: false, reason: "not_configured" };
    if (!(await google.connected())) return { ok: false, reason: "not_connected" };
    const c = await repo.get("consultations", id);
    if (!c) return { ok: false, reason: "not_found" };
    const code = (String(c.meetUrl || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
    if (!code) return { ok: false, reason: "no_meet" };
    const doneFor = c.meetEventId || code;
    if (!force && c.summaryDoneFor === doneFor) return { ok: false, reason: "already_done" };

    let t = null;
    try { t = await google.fetchTranscript(code); } catch (err) { log.warn?.(`consulta ${id}: transcrição Meet falhou: ${err.message}`); }
    if (!t?.text) {
      try { t = await google.fetchTranscriptFromDrive({ eventId: c.meetEventId || "", leadName: c.clientName || "", since: c.meetScheduledAt || "" }); }
      catch (err) { log.warn?.(`consulta ${id}: transcrição Drive falhou: ${err.message}`); }
    }
    if (!t?.text) return { ok: false, reason: "no_transcript" };

    const product = c.saas ? await repo.get("products", c.saas) : null;
    const r = await anthropic.summarizeConsultation({
      transcript: t.text,
      clientName: c.clientName || "?",
      childName: c.childName || "",
      n: c.n || 0,
      productName: product?.name || "UniqueKids",
      callDate: (t.startTime || c.meetScheduledAt || "").slice(0, 10),
    });
    await repo.update("consultations", c.id, {
      summary: r.summary,
      summaryDoneFor: doneFor,
      summaryAt: new Date().toISOString(),
      ...(t.recordingUrl ? { transcriptUrl: t.recordingUrl } : {}),
      ...(c.status === "scheduled" ? { status: "done" } : {}), // transcrição chegou = consulta aconteceu
    });
    return { ok: true, summary: r.summary };
  }
  return { summarize };
}

// Poller: detecta consultas encerradas (Meet criado pelo cockpit, horário >50min
// atrás e <7 dias) sem resumo e resume sozinho. Mesmo esqueleto single-flight do
// startCallSummaries; no-op sem IA/Google.
export function startConsultationSummaries(repo, { google, anthropic, intervalMs = 600_000, log = console } = {}) {
  const s = makeConsultationSummarizer({ repo, google, anthropic, log });
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      if (!anthropic?.configured?.() || !(await google.connected())) return;
      const all = await repo.list("consultations");
      const now = Date.now();
      for (const c of all) {
        if (!String(c.meetUrl || "").includes("meet.google.com")) continue;
        if (c.summaryDoneFor && c.summaryDoneFor === (c.meetEventId || "")) continue;
        const sched = new Date(c.meetScheduledAt || 0).getTime();
        if (!sched || now - sched < 50 * 60_000 || now - sched > 7 * 86_400_000) continue;
        try { await s.summarize(c.id); } catch (err) { log.warn?.(`resumo da consulta ${c.id} falhou: ${err.message}`); }
      }
    } catch (err) {
      log.warn?.(`poller de consultas falhou: ${err.message}`);
    } finally { running = false; }
  }
  const timer = setInterval(tick, intervalMs);
  const first = setTimeout(tick, 20_000);
  return { stop: () => { clearInterval(timer); clearTimeout(first); }, run: tick, summarizer: s };
}
