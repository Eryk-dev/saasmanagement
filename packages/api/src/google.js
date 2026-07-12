// Google (OAuth 2.0 + Calendar API) — cria a call com GOOGLE MEET direto na
// agenda da conta conectada, com o lead convidado por e-mail quando houver.
// Single-tenant: UMA conta do time conectada; o refresh token vive no banco
// (app_config, id "google_oauth") e as credenciais do app OAuth no env
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Factory com fetch injetável pra
// testar offline, mesmo padrão do meta.js/mp.js.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_URL = "https://www.googleapis.com/calendar/v3";
// calendar.events cria evento+Meet; meetings.space.* configura a SALA (acesso
// aberto sem "pedir pra entrar", gravação e transcrição automáticas); openid/
// email só mostra QUAL conta está conectada em Ajustes.
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.settings",
  "openid",
  "email",
].join(" ");
const MEET_URL = "https://meet.googleapis.com/v2";

export function makeGoogle({ fetch: f = globalThis.fetch, clientId = "", clientSecret = "", repo } = {}) {
  const configured = () => !!(clientId && clientSecret);
  let cache = { token: "", exp: 0 }; // access token em memória (refresh sob demanda)

  const stored = async () => (repo ? repo.get("app_config", "google_oauth") : null);
  const connected = async () => !!(await stored())?.refreshToken;
  const account = async () => (await stored())?.account || "";

  function authUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline", // refresh token
      prompt: "consent",      // garante refresh token mesmo em reconexão
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  async function tokenPost(params) {
    const res = await f(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400 || body.error) {
      throw new Error(`Google -> ${res.status}: ${body.error_description || body.error || "falha no token"}`);
    }
    return body;
  }

  // Troca o code do callback por tokens e PERSISTE o refresh token. O e-mail
  // da conta sai do id_token (payload base64; sem validar — uso é só display).
  async function exchangeCode(code, redirectUri) {
    const b = await tokenPost({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    });
    let acct = "";
    try { acct = JSON.parse(Buffer.from(String(b.id_token).split(".")[1], "base64url").toString()).email || ""; } catch { /* opcional */ }
    const prev = await stored();
    const rec = {
      id: "google_oauth",
      refreshToken: b.refresh_token || prev?.refreshToken || "",
      account: acct || prev?.account || "",
      connectedAt: new Date().toISOString(),
    };
    if (prev) await repo.update("app_config", "google_oauth", rec);
    else await repo.create("app_config", rec);
    cache = { token: b.access_token || "", exp: Date.now() + (Number(b.expires_in) || 3600) * 1000 - 60_000 };
    return rec;
  }

  async function accessToken() {
    if (cache.token && Date.now() < cache.exp) return cache.token;
    const t = await stored();
    if (!t?.refreshToken) throw new Error("Google não conectado — Ajustes → Integrações → Conectar Google");
    const b = await tokenPost({
      refresh_token: t.refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token",
    });
    cache = { token: b.access_token, exp: Date.now() + (Number(b.expires_in) || 3600) * 1000 - 60_000 };
    return cache.token;
  }

  // Evento no calendário PRIMÁRIO da conta conectada, com Meet anexado.
  // start/end no formato do Calendar ({ dateTime, timeZone? }) — quem chama
  // decide o fuso (callAt do lead é hora de Brasília, sem sufixo Z).
  async function createMeetEvent({ summary, description = "", start, end, attendees = [] }) {
    const token = await accessToken();
    const res = await f(`${CAL_URL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary,
        description,
        start,
        end,
        ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
        conferenceData: {
          createRequest: {
            requestId: `lever-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400 || body.error) {
      throw new Error(`Google Calendar -> ${res.status}: ${body.error?.message || "falha ao criar o evento"}`);
    }
    const meetUrl = body.hangoutLink
      || (body.conferenceData?.entryPoints || []).find((e) => e.entryPointType === "video")?.uri
      || "";
    if (!meetUrl) throw new Error("Google Calendar: evento criado sem link do Meet (verifique se a conta pode criar Meet)");
    return { meetUrl, eventId: body.id, htmlLink: body.htmlLink || "" };
  }

  // Configura a SALA do Meet criada pelo evento: acesso ABERTO (ninguém "pede
  // pra entrar"), gravação e transcrição automáticas. Cada ajuste é best-effort
  // e INDEPENDENTE — gravação/transcrição exigem plano Workspace com gravação
  // (Business Standard+); o retorno diz o que o plano aceitou.
  async function configureSpace(meetingCode, { open = true, record = true, transcribe = true } = {}) {
    const token = await accessToken();
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    // O patch exige o resource name real (spaces/{space}) — o meetingCode é só alias no GET.
    const got = await f(`${MEET_URL}/spaces/${encodeURIComponent(meetingCode)}`, { headers });
    const space = await got.json().catch(() => ({}));
    if (got.status >= 400 || !space.name) return { open: false, recording: false, transcription: false };

    const applied = { open: false, recording: false, transcription: false };
    const patch = async (config, mask) => {
      const res = await f(`${MEET_URL}/${space.name}?updateMask=${encodeURIComponent(mask)}`, {
        method: "PATCH", headers, body: JSON.stringify({ config }),
      });
      if (res.status >= 400) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `Meet -> ${res.status}`);
      }
    };
    if (open) {
      try {
        await patch({ accessType: "OPEN", entryPointAccess: "ALL" }, "config.accessType,config.entryPointAccess");
        applied.open = true;
      } catch { /* plano/conta não permite — sala fica no padrão */ }
    }
    if (record) {
      try {
        await patch({ artifactConfig: { recordingConfig: { autoRecordingGeneration: "ON" } } }, "config.artifactConfig.recordingConfig.autoRecordingGeneration");
        applied.recording = true;
      } catch { /* exige Workspace com gravação */ }
    }
    if (transcribe) {
      try {
        await patch({ artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: "ON" } } }, "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration");
        applied.transcription = true;
      } catch { /* idem gravação */ }
    }
    return applied;
  }

  return { configured, connected, account, authUrl, exchangeCode, accessToken, createMeetEvent, configureSpace };
}
