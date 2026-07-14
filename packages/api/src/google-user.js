// Google Calendar POR USUÁRIO — cada pessoa conecta a PRÓPRIA conta Google pra
// receber a réplica das calls/integrações na agenda pessoal. Usa o MESMO app
// OAuth do google.js (GOOGLE_CLIENT_ID/SECRET), mas:
//   - escopo mínimo (calendar.events + openid/email) — só o suficiente pra criar
//     o evento e mostrar qual conta está conectada;
//   - o refresh token vive em CADA usuário (users.google), não no app_config.
// Convive com a conta única do time (google.js): esta é ADITIVA — a conta do
// time segue criando o Meet e o resumo por IA; aqui só espelhamos o compromisso
// na agenda de quem é responsável (closer na call, integrator na integração).
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_URL = "https://www.googleapis.com/calendar/v3";
const USER_SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");
const TZ = "America/Sao_Paulo";

export function makeGoogleUser({ fetch: f = globalThis.fetch, clientId = "", clientSecret = "", repo } = {}) {
  const configured = () => !!(clientId && clientSecret);
  const cache = new Map(); // userId -> { token, exp } (access token em memória)

  const userRec = async (userId) => (userId && repo ? await repo.get("users", userId) : null);
  const connectedFor = async (userId) => !!(await userRec(userId))?.google?.refreshToken;
  const accountFor = async (userId) => (await userRec(userId))?.google?.account || "";

  function authUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code",
      scope: USER_SCOPE, access_type: "offline", prompt: "consent", state,
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

  // Troca o code do callback pelos tokens e PERSISTE o refresh token no usuário.
  async function exchangeCodeForUser(code, redirectUri, userId) {
    if (!userId) throw new Error("exchangeCodeForUser: userId obrigatório");
    const b = await tokenPost({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    });
    let acct = "";
    try { acct = JSON.parse(Buffer.from(String(b.id_token).split(".")[1], "base64url").toString()).email || ""; } catch { /* opcional */ }
    const u = await userRec(userId);
    const prev = u?.google || {};
    const google = {
      refreshToken: b.refresh_token || prev.refreshToken || "",
      account: acct || prev.account || "",
      scopes: b.scope || prev.scopes || "",
      connectedAt: new Date().toISOString(),
    };
    await repo.update("users", userId, { google });
    cache.set(userId, { token: b.access_token || "", exp: Date.now() + (Number(b.expires_in) || 3600) * 1000 - 60_000 });
    return { account: google.account };
  }

  async function accessToken(userId) {
    const c = cache.get(userId);
    if (c && c.token && Date.now() < c.exp) return c.token;
    const g = (await userRec(userId))?.google;
    if (!g?.refreshToken) throw new Error("Usuário sem Google conectado");
    const b = await tokenPost({
      refresh_token: g.refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token",
    });
    const tok = { token: b.access_token, exp: Date.now() + (Number(b.expires_in) || 3600) * 1000 - 60_000 };
    cache.set(userId, tok);
    return tok.token;
  }

  async function disconnect(userId) {
    cache.delete(userId);
    if (await userRec(userId)) await repo.update("users", userId, { google: null });
  }

  // Upsert de evento SIMPLES (sem Meet) no calendário primário do usuário.
  // sendUpdates=none: NÃO manda convite pro cliente pela conta pessoal (a conta
  // do time já convida no Meet) — é só o bloco de agenda de quem é responsável.
  // Evento apagado na mão (404 no PATCH) → recria do zero.
  async function upsertEvent(userId, { eventId = "", summary, description = "", start, end }) {
    const token = await accessToken(userId);
    const base = `${CAL_URL}/calendars/primary/events`;
    const url = (eventId ? `${base}/${encodeURIComponent(eventId)}` : base) + "?sendUpdates=none";
    const res = await f(url, {
      method: eventId ? "PATCH" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ summary, description, start, end }),
    });
    const b = await res.json().catch(() => ({}));
    if (res.status === 404 && eventId) return upsertEvent(userId, { summary, description, start, end });
    if (res.status >= 400 || b.error) throw new Error(`Calendar -> ${res.status}: ${b.error?.message || "falha ao gravar o evento"}`);
    return { eventId: b.id };
  }

  async function deleteEvent(userId, eventId) {
    if (!eventId) return;
    try {
      const token = await accessToken(userId);
      await f(`${CAL_URL}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
        method: "DELETE", headers: { authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
  }

  return { configured, connectedFor, accountFor, authUrl, exchangeCodeForUser, accessToken, disconnect, upsertEvent, deleteEvent };
}

// callAt/integrationAt são hora de Brasília sem fuso ("YYYY-MM-DDTHH:MM"): o
// Calendar recebe o horário cru + timeZone (sem conversão). Data pura (10 chars)
// vira evento de dia inteiro.
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

// Espelha call/integração do lead na agenda PESSOAL do responsável. Best-effort
// puro: nunca lança. Guarda o eventId + o dono na própria lead (calCall*/calInteg*)
// pra que reagendar atualize o MESMO evento e reatribuir/limpar apague o antigo.
// Retorna um patch com os campos de rastreio (aplicado na lead pelo chamador).
export async function syncPersonalCalendar(repo, gu, lead) {
  if (!gu || !gu.configured() || !lead) return {};
  const who = (lead.company ? `${lead.name} (${lead.company})` : lead.name) || "cliente";
  const meetLine = lead.callUrl ? `Meet: ${lead.callUrl}` : "";

  async function one({ at, responsible, minutes, idField, userField, summary }) {
    const curId = lead[idField] || "";
    const curUser = lead[userField] || "";
    const patch = {};
    let want = false;
    try { want = !!(at && responsible && (await gu.connectedFor(responsible))); } catch { want = false; }
    if (want) {
      const { start, end } = calTimes(at, minutes);
      const description = [`Lead: ${lead.name}`, lead.phone ? `WhatsApp: ${lead.phone}` : "", lead.email ? `E-mail: ${lead.email}` : "", meetLine]
        .filter(Boolean).join("\n");
      let eventId = curId;
      // Reatribuído pra outra pessoa: apaga da agenda antiga.
      if (curId && curUser && curUser !== responsible) { await gu.deleteEvent(curUser, curId); eventId = ""; }
      try {
        const r = await gu.upsertEvent(responsible, { eventId, summary, description, start, end });
        if (r.eventId !== curId || curUser !== responsible) { patch[idField] = r.eventId; patch[userField] = responsible; }
      } catch { /* mantém o que tinha */ }
    } else if (curId && curUser) {
      await gu.deleteEvent(curUser, curId);
      patch[idField] = ""; patch[userField] = "";
    }
    return patch;
  }

  const patch = {
    ...(await one({ at: lead.callAt, responsible: lead.closer, minutes: 45, idField: "calCallEventId", userField: "calCallUser", summary: `Call · ${who}` })),
    ...(await one({ at: lead.integrationAt, responsible: lead.integrator, minutes: 60, idField: "calIntegEventId", userField: "calIntegUser", summary: `Integração · ${who}` })),
  };
  if (Object.keys(patch).length) { try { await repo.update("leads", lead.id, patch); } catch { /* fail-open */ } }
  return patch;
}
