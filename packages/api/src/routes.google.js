// Google Meet no cockpit — conectar a conta (OAuth) e criar a call do lead
// direto na agenda: POST /api/leads/:id/meet cria o evento com Meet no
// calendário da conta conectada (lead convidado por e-mail quando houver) e
// grava o link em lead.callUrl (o mesmo campo do drawer/Agenda).
import { randomUUID } from "node:crypto";
import { makeGoogle } from "./google.js";
import { publicBase } from "./routes.js";
import { logActivity } from "./lead-flow.js";
import { makeCallSummarizer } from "./call-summaries.js";

export function registerGoogleRoutes(app, repo, { google, anthropic } = {}) {
  const client = google || makeGoogle({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    repo,
  });
  const summarizer = anthropic ? makeCallSummarizer({ repo, google: client, anthropic, log: app.log }) : null;

  // Anti-CSRF do callback (rota aberta): só aceita state emitido por aqui,
  // com validade curta. Memória do processo basta (fluxo de segundos).
  const states = new Map(); // state -> expiraEm
  const sweep = () => { const now = Date.now(); for (const [k, exp] of states) if (exp < now) states.delete(k); };

  const redirectUri = (req) => `${publicBase(req)}/api/google/callback`;

  app.get("/api/google/status", async () => ({
    configured: client.configured(),
    connected: await client.connected(),
    account: await client.account(),
  }));

  app.get("/api/google/auth-url", async (req, reply) => {
    if (!client.configured()) {
      return reply.code(503).send({ error: "Google não configurado — defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor" });
    }
    sweep();
    const state = randomUUID();
    states.set(state, Date.now() + 10 * 60_000);
    return { url: client.authUrl(redirectUri(req), state) };
  });

  // Callback do consentimento (ABERTA — o navegador chega sem a key; o state
  // de uso único é a autorização). Fecha num HTML mínimo.
  app.get("/api/google/callback", async (req, reply) => {
    const { code, state, error } = req.query || {};
    const page = (title, body) => reply.type("text/html").send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:48px;max-width:520px;margin:auto"><h2>${title}</h2><p style="color:#555;line-height:1.5">${body}</p></body>`,
    );
    sweep();
    if (error) return page("Conexão cancelada", `O Google retornou: ${String(error).slice(0, 120)}. Volte ao cockpit e tente de novo.`);
    if (!state || !states.has(String(state))) { reply.code(400); return page("Link expirado", "Este link de conexão não é mais válido. Volte ao cockpit (Ajustes → Integrações) e clique em Conectar Google de novo."); }
    states.delete(String(state));
    if (!code) return page("Faltou o código", "O Google não enviou o código de autorização. Tente conectar de novo.");
    try {
      const rec = await client.exchangeCode(String(code), redirectUri(req));
      return page("Google conectado ✓", `Conta <b>${rec.account || "conectada"}</b> pronta pra criar calls com Meet. Pode fechar esta aba e voltar pro cockpit.`);
    } catch (err) {
      req.log.warn({ err: err.message }, "Google: exchangeCode falhou");
      return page("Falha na conexão", String(err.message || err).slice(0, 200));
    }
  });

  // Cria a call do lead: evento no calendário primário da conta conectada,
  // horário = lead.callAt (hora de Brasília) ou daqui a 30 min, duração 45 min.
  app.post("/api/leads/:id/meet", async (req, reply) => {
    if (!client.configured()) return reply.code(503).send({ error: "Google não configurado (GOOGLE_CLIENT_ID/SECRET)" });
    if (!(await client.connected())) return reply.code(503).send({ error: "Google não conectado — Ajustes → Integrações → Conectar Google" });
    const lead = await repo.get("leads", req.params.id);
    if (!lead) return reply.code(404).send({ error: "Not found" });
    const product = lead.saas ? await repo.get("products", lead.saas) : null;

    // callAt vem do input datetime-local (sem fuso) e SIGNIFICA hora de
    // Brasília — o Calendar recebe o horário cru + timeZone, sem conversão.
    const TZ = "America/Sao_Paulo";
    let start, end;
    if (lead.callAt) {
      const s = new Date(lead.callAt + (lead.callAt.length === 16 ? ":00" : ""));
      const e = new Date(s.getTime() + 45 * 60_000);
      const naive = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
      start = { dateTime: naive(s), timeZone: TZ };
      end = { dateTime: naive(e), timeZone: TZ };
    } else {
      const s = new Date(Date.now() + 30 * 60_000);
      start = { dateTime: s.toISOString() };
      end = { dateTime: new Date(s.getTime() + 45 * 60_000).toISOString() };
    }

    // Convidados: e-mail do LEAD (quando cadastrado) + extras do body
    // (body.guests) + extras salvos no lead (meetGuests, string com vírgulas).
    const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
    const extraFromBody = Array.isArray(req.body?.guests) ? req.body.guests : [];
    const extraFromLead = String(lead.meetGuests || "").split(/[,;\s]+/);
    const attendees = [...new Set([lead.email, ...extraFromBody, ...extraFromLead]
      .map((e) => String(e || "").trim().toLowerCase())
      .filter(emailOk))].slice(0, 15);
    // Extras novos ficam salvos no lead pro próximo Meet já vir preenchido.
    const guestsToSave = attendees.filter((e) => e !== String(lead.email || "").toLowerCase()).join(", ");

    try {
      const { meetUrl, eventId, htmlLink } = await client.createMeetEvent({
        summary: `Call ${product?.name || "LeverAds"} · ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
        description: [`Lead: ${lead.name}`, lead.phone ? `WhatsApp: ${lead.phone}` : "", lead.company ? `Empresa: ${lead.company}` : ""].filter(Boolean).join("\n"),
        start, end,
        attendees,
      });
      // Sala aberta (sem "pedir pra entrar") + gravação/transcrição automáticas —
      // best-effort: o que o plano da conta não suportar volta como false.
      let meetConfig = { open: false, recording: false, transcription: false };
      const code = (meetUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1];
      if (code) {
        try { meetConfig = await client.configureSpace(code); }
        catch (err) { req.log.warn({ err: err.message }, "Google: configuração da sala falhou (Meet criado mesmo assim)"); }
      }
      // Horário REAL da call em ISO UTC (callAt é hora de Brasília sem fuso) —
      // é a referência do poller que resume a call depois que ela termina.
      const meetScheduledAt = lead.callAt
        ? new Date(`${lead.callAt}${lead.callAt.length === 16 ? ":00" : ""}-03:00`).toISOString()
        : new Date(Date.now() + 30 * 60_000).toISOString();
      await repo.update("leads", lead.id, { callUrl: meetUrl, meetEventId: eventId, meetScheduledAt, ...(guestsToSave ? { meetGuests: guestsToSave } : {}) });
      try {
        await logActivity(repo, {
          saas: lead.saas || "", lead: lead.id, type: "system",
          meta: { event: "meet_created", url: meetUrl, calendarEvent: htmlLink, attendees, meetConfig },
          author: "cockpit",
        });
      } catch { /* fail-open */ }
      return { ok: true, callUrl: meetUrl, eventId, htmlLink, attendees, meetConfig };
    } catch (err) {
      req.log.warn({ err: err.message, lead: lead.id }, "Google: criação do Meet falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  // Resumo estratégico da call (transcrição do Meet → Claude → timeline).
  // force = re-resumir mesmo já tendo resumo desta call.
  app.post("/api/leads/:id/call-summary", async (req, reply) => {
    if (!summarizer) return reply.code(503).send({ error: "IA não configurada — defina ANTHROPIC_API_KEY no servidor" });
    try {
      const r = await summarizer.summarizeLead(req.params.id, { force: !!req.body?.force });
      if (!r.ok && r.reason === "not_found") return reply.code(404).send({ error: "Not found" });
      return r;
    } catch (err) {
      req.log.warn({ err: err.message, lead: req.params.id }, "resumo de call falhou");
      return reply.code(502).send({ error: String(err.message || err).slice(0, 300) });
    }
  });

  return client;
}
