// Rotas das consultas 1:1 e do Manual da Família (UniqueKids). O CRUD básico
// vem do genérico (/api/consultations, /api/deliverables); aqui ficam as ações:
// Meet da consulta (conta do time, transcrição automática), resumo manual por
// IA, compor o manual a partir das consultas e a página pública /m/:id.
import { makeConsultationSummarizer, syncConsultationCalendar, formatConsultationText } from "./consultations.js";
import { publicManual, sameFamily } from "./deliverables.js";
import { manualPageHtml } from "./manual-page.js";

const TZ = "America/Sao_Paulo";

export function registerConsultationRoutes(app, repo, { google, googleUser, anthropic } = {}) {
  const summarizer = makeConsultationSummarizer({ repo, google, anthropic, log: app.log });

  // Meet da consulta: evento na conta do TIME (é ela que tem gravação +
  // transcrição automáticas), convite pro e-mail do cliente quando houver, e
  // re-espelho na agenda pessoal da responsável já com o link.
  app.post("/api/consultations/:id/meet", async (req, reply) => {
    if (!google?.configured?.()) return reply.code(503).send({ error: "Google não configurado (GOOGLE_CLIENT_ID/SECRET)" });
    if (!(await google.connected())) return reply.code(503).send({ error: "Google não conectado — Ajustes → Integrações → Conectar Google" });
    const c = await repo.get("consultations", req.params.id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (!c.at) return reply.code(400).send({ error: "consulta sem dia/horário" });

    // c.at = hora de Brasília sem fuso (datetime-local) — Calendar recebe cru + timeZone.
    const s = new Date(c.at + (c.at.length === 16 ? ":00" : ""));
    const e = new Date(s.getTime() + (Number(c.durationMin) || 60) * 60_000);
    const naive = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;

    // Convidado: e-mail do cliente (customer ou lead de origem).
    const emailOk = (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || "").trim());
    let clientEmail = "";
    try {
      const customer = c.customerId ? await repo.get("customers", c.customerId) : null;
      const lead = !customer && c.leadId ? await repo.get("leads", c.leadId) : null;
      clientEmail = String(customer?.email || lead?.email || "").trim().toLowerCase();
    } catch { /* sem convidado */ }
    const attendees = [clientEmail, ...(Array.isArray(req.body?.guests) ? req.body.guests : [])]
      .map((x) => String(x || "").trim().toLowerCase()).filter(emailOk).slice(0, 10);

    // Continuidade: a consulta seguinte recebe o resumo da anterior. Se a
    // consulta anterior da MESMA família já foi resumida pela IA, o recap entra
    // na descrição do evento (quem abre o convite chega contextualizado).
    let recap = "";
    try {
      const prev = (await repo.list("consultations"))
        .filter((x) => x.id !== c.id && sameFamily(x, c) && x.summary && (Number(x.n) || 0) < (Number(c.n) || 99))
        .sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0))[0] || null;
      if (prev) recap = `\n\nResumo da consulta anterior (nº ${prev.n || "?"}):\n${formatConsultationText(prev.summary)}`.slice(0, 3500);
    } catch { /* recap é bônus, nunca trava o Meet */ }

    try {
      const { meetUrl, eventId, htmlLink } = await google.createMeetEvent({
        summary: `Consulta ${c.n || "?"}/${c.packageTotal || 8} · ${c.clientName || "cliente"}`,
        description: [`Cliente: ${c.clientName || "?"}`, c.childName ? `Criança: ${c.childName}` : "", "Mentoria R.O.T.I.N.A · UniqueKids"].filter(Boolean).join("\n") + recap,
        start: { dateTime: naive(s), timeZone: TZ },
        end: { dateTime: naive(e), timeZone: TZ },
        attendees,
        calendarId: process.env.GOOGLE_MEET_CALENDAR_ID || "primary",
      });
      // Sala aberta + gravação/transcrição automáticas (best-effort).
      let meetConfig = { open: false, recording: false, transcription: false };
      const code = (meetUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
      if (code) {
        try { meetConfig = await google.configureSpace(code); }
        catch (err) { req.log.warn({ err: err.message }, "Google: configuração da sala falhou (Meet criado mesmo assim)"); }
      }
      // Referência do poller em ISO UTC (c.at é Brasília sem fuso).
      const meetScheduledAt = new Date(`${c.at}${c.at.length === 16 ? ":00" : ""}-03:00`).toISOString();
      const patch = { meetUrl, meetEventId: eventId, meetScheduledAt };
      await repo.update("consultations", c.id, patch);
      try { await syncConsultationCalendar(repo, googleUser, { ...c, ...patch }); } catch { /* fail-open */ }
      return { ok: true, meetUrl, eventId, htmlLink, attendees, meetConfig };
    } catch (err) {
      req.log.warn({ err: err.message, consultation: c.id }, "Google: criação do Meet da consulta falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Resumo manual da consulta (o poller faz sozinho; isto é o botão).
  app.post("/api/consultations/:id/summary", async (req, reply) => {
    if (!anthropic?.configured?.()) return reply.code(503).send({ error: "IA não configurada no servidor" });
    try {
      const r = await summarizer.summarize(req.params.id, { force: !!req.body?.force });
      if (!r.ok && r.reason === "not_found") return reply.code(404).send({ error: "Not found" });
      return r;
    } catch (err) {
      req.log.warn({ err: err.message, consultation: req.params.id }, "resumo da consulta falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Compor o Manual da Família: junta o material das consultas do cliente
  // (resumos IA + notas da Ana) e pede pra IA propor o conteúdo das seções.
  // Sobrescreve o content das seções retornadas (a Ana revisa e edita depois).
  app.post("/api/deliverables/:id/compose", async (req, reply) => {
    if (!anthropic?.configured?.()) return reply.code(503).send({ error: "IA não configurada no servidor" });
    const m = await repo.get("deliverables", req.params.id);
    if (!m) return reply.code(404).send({ error: "Not found" });

    const all = await repo.list("consultations");
    const mine = all
      .filter((c) => sameFamily(c, m))
      .filter((c) => c.status === "done" || c.summary || String(c.notes || "").trim())
      .sort((a, b) => (a.n || 0) - (b.n || 0));
    if (!mine.length) return reply.code(400).send({ error: "nenhuma consulta com material (resumo ou notas) ainda" });

    const material = mine.map((c) => {
      const parts = [`CONSULTA ${c.n || "?"}${c.at ? ` (${String(c.at).slice(0, 10)})` : ""}`];
      if (c.summary) parts.push(formatConsultationText(c.summary));
      if (String(c.notes || "").trim()) parts.push(`Notas da Ana: ${c.notes}`);
      return parts.join("\n");
    }).join("\n\n").slice(0, 150_000);

    try {
      const r = await anthropic.composeDeliverables({
        clientName: m.clientName || "?",
        childName: m.childName || "",
        sections: (m.sections || []).map((s) => ({ key: s.key, title: s.title, hint: s.hint, content: s.content || "" })),
        material,
      });
      const byKey = new Map((r.sections || []).map((s) => [s.key, s.content]));
      const now = new Date().toISOString();
      const ns = mine.map((c) => c.n || 0).filter(Boolean);
      const sections = (m.sections || []).map((s) => byKey.has(s.key)
        ? { ...s, content: byKey.get(s.key), sources: ns, updatedAt: now }
        : s);
      const updated = await repo.update("deliverables", m.id, { sections });
      return { ok: true, updatedKeys: [...byKey.keys()], sections: updated.sections };
    } catch (err) {
      req.log.warn({ err: err.message, deliverable: m.id }, "compor manual falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Página pública do Manual da Família (o id opaco é o token, igual proposta).
  app.get("/m/:id", async (req, reply) => {
    const m = await repo.get("deliverables", req.params.id);
    if (!m) {
      return reply.code(404).type("text/html").send("<!doctype html><meta charset='utf-8'><body style='font-family:system-ui;display:grid;place-items:center;height:100vh'><p>Manual não encontrado.</p></body>");
    }
    return reply.type("text/html").header("cache-control", "no-store").send(manualPageHtml(publicManual(m)));
  });

  return { summarizer };
}
