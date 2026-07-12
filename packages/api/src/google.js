// Google (OAuth 2.0 + Calendar API) — cria a call com GOOGLE MEET direto na
// agenda da conta conectada, com o lead convidado por e-mail quando houver.
// Single-tenant: UMA conta do time conectada; o refresh token vive no banco
// (app_config, id "google_oauth") e as credenciais do app OAuth no env
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Factory com fetch injetável pra
// testar offline, mesmo padrão do meta.js/mp.js.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_URL = "https://www.googleapis.com/calendar/v3";
// calendar.events basta pra criar evento+Meet; openid/email só pra mostrar
// QUAL conta está conectada em Ajustes.
const SCOPE = "https://www.googleapis.com/auth/calendar.events openid email";

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
  async function createMeetEvent({ summary, description = "", start, end, attendeeEmail = "" }) {
    const token = await accessToken();
    const res = await f(`${CAL_URL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary,
        description,
        start,
        end,
        ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
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

  return { configured, connected, account, authUrl, exchangeCode, accessToken, createMeetEvent };
}
