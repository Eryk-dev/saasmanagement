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
  "https://www.googleapis.com/auth/meetings.space.readonly", // ler gravações/transcrições pós-call
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
    if (got.status >= 400 || !space.name) {
      const why = space.error?.message || `Meet API -> ${got.status}`;
      // 403 SERVICE_DISABLED = Meet API não habilitada no projeto do Cloud;
      // ACCESS_TOKEN_SCOPE_INSUFFICIENT = precisa reconectar (escopos novos).
      return { open: false, recording: false, transcription: false, errors: { sala: String(why).slice(0, 180) } };
    }

    const applied = { open: false, recording: false, transcription: false, errors: {} };
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
      } catch (e) { applied.errors.aberta = String(e.message || e).slice(0, 180); }
    }
    if (record) {
      try {
        await patch({ artifactConfig: { recordingConfig: { autoRecordingGeneration: "ON" } } }, "config.artifactConfig.recordingConfig.autoRecordingGeneration");
        applied.recording = true;
      } catch (e) { applied.errors.gravacao = String(e.message || e).slice(0, 180); }
    }
    if (transcribe) {
      try {
        await patch({ artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: "ON" } } }, "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration");
        applied.transcription = true;
      } catch (e) { applied.errors.transcricao = String(e.message || e).slice(0, 180); }
    }
    if (!Object.keys(applied.errors).length) delete applied.errors;
    return applied;
  }

  // GET autenticado na Meet API com paginação (nextPageToken) — devolve a
  // lista concatenada de `field` ou lança com a mensagem do Google.
  async function meetList(path, field, params = {}) {
    const token = await accessToken();
    const out = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) });
      const res = await f(`${MEET_URL}/${path}${q.size ? `?${q}` : ""}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400 || body.error) {
        throw new Error(`Meet API ${path} -> ${res.status}: ${body.error?.message || "falha"}`);
      }
      out.push(...(body[field] || []));
      pageToken = body.nextPageToken || "";
    } while (pageToken && out.length < 5000);
    return out;
  }

  // Transcrição COMPLETA da última call encerrada de uma sala: resolve o
  // space, acha o conferenceRecord mais recente já encerrado, monta o texto
  // fala-a-fala com o nome de quem falou e anexa o link da gravação no Drive.
  // Retorna null quando o Google ainda está processando (quem chama re-tenta).
  async function fetchTranscript(meetingCode) {
    const token = await accessToken();
    const got = await f(`${MEET_URL}/spaces/${encodeURIComponent(meetingCode)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const space = await got.json().catch(() => ({}));
    if (got.status >= 400 || !space.name) {
      throw new Error(`Meet API spaces/${meetingCode} -> ${got.status}: ${space.error?.message || "sala não encontrada"}`);
    }

    const records = await meetList("conferenceRecords", "conferenceRecords", {
      filter: `space.name = "${space.name}"`,
    });
    const done = records.filter((r) => r.endTime).sort((a, b) => String(b.endTime).localeCompare(String(a.endTime)));
    if (!done.length) return null; // call não aconteceu ou ainda está rolando

    const rec = done[0];
    const transcripts = await meetList(`${rec.name}/transcripts`, "transcripts");
    const ready = transcripts.find((t) => t.state === "ENDED") || transcripts[0];
    if (!ready || ready.state !== "ENDED") return null; // Google ainda processando

    const [entries, participants, recordings] = await Promise.all([
      meetList(`${ready.name}/entries`, "transcriptEntries", { pageSize: "1000" }),
      meetList(`${rec.name}/participants`, "participants", { pageSize: "250" }).catch(() => []),
      meetList(`${rec.name}/recordings`, "recordings").catch(() => []),
    ]);
    if (!entries.length) return null;

    const nameOf = new Map(participants.map((p) => [
      p.name,
      p.signedinUser?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || "",
    ]));
    const text = entries
      .map((e) => `${nameOf.get(e.participant) || "Participante"}: ${String(e.text || "").trim()}`)
      .filter((l) => !l.endsWith(": "))
      .join("\n");

    const recFile = recordings.find((r) => r.driveDestination?.file)?.driveDestination;
    return {
      text,
      startTime: rec.startTime || "",
      endTime: rec.endTime || "",
      recordingUrl: recFile ? (recFile.exportUri || `https://drive.google.com/file/d/${recFile.file}/view`) : "",
      conferenceRecord: rec.name,
    };
  }

  return { configured, connected, account, authUrl, exchangeCode, accessToken, createMeetEvent, configureSpace, fetchTranscript };
}
