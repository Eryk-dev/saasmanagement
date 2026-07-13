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
  "https://www.googleapis.com/auth/gmail.send", // disparos: enviar e-mail pela conta conectada
  "https://www.googleapis.com/auth/drive.readonly",          // ler o Doc de transcrição no Drive do organizador (fallback)
  "openid",
  "email",
].join(" ");
const MEET_URL = "https://meet.googleapis.com/v2";
const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1";
const DRIVE_URL = "https://www.googleapis.com/drive/v3";

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
      // Escopos concedidos NESTA conexão (o Google devolve em `scope`): serve pra
      // saber se o `gmail.send` foi autorizado sem tentar enviar. Reconexão sem o
      // campo (versão antiga) mantém o que já havia.
      scopes: b.scope || prev?.scopes || "",
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
  // calendarId = calendário onde o evento nasce (default "primary" da conta
  // conectada). Apontar pra um calendário de outra identidade (ex.:
  // contato@leverads.com.br) faz o convite sair COM essa identidade — só
  // funciona se a conta conectada tiver acesso de escrita a esse calendário.
  async function createMeetEvent({ summary, description = "", start, end, attendees = [], calendarId = "primary" }) {
    const token = await accessToken();
    const res = await f(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
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

  // Envio de e-mail pela conta conectada (Gmail API). `gmail.send` só; a conta
  // do Workspace já autentica o domínio, então cai bem melhor que rascunho de
  // Gmail pessoal. Monta o MIME RFC822, base64url, e posta em messages/send.
  // `headers` extras (ex.: List-Unsubscribe) entram no cabeçalho.
  async function sendGmail({ to, subject = "", text = "", html = "", fromName = "", headers = {} }) {
    if (!to) throw new Error("sendGmail: destinatário (to) obrigatório");
    const token = await accessToken();
    const from = fromName ? `${encodeHeader(fromName)} <${await account()}>` : (await account());
    const parts = [];
    parts.push(`From: ${from}`);
    parts.push(`To: ${to}`);
    parts.push(`Subject: ${encodeHeader(subject)}`);
    for (const [k, v] of Object.entries(headers)) if (v) parts.push(`${k}: ${v}`);
    parts.push("MIME-Version: 1.0");
    parts.push(`Content-Type: text/${html ? "html" : "plain"}; charset=UTF-8`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(Buffer.from(html || text, "utf8").toString("base64"));
    const raw = Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
    const res = await f(`${GMAIL_URL}/users/me/messages/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400 || body.error) {
      throw new Error(`Gmail -> ${res.status}: ${body.error?.message || "falha ao enviar o e-mail"}`);
    }
    return { id: body.id, threadId: body.threadId };
  }

  // O escopo gmail.send foi concedido na conexão atual? (sem tentar enviar).
  async function gmailReady() {
    const s = await stored();
    return !!(s?.refreshToken && String(s?.scopes || "").includes("gmail.send"));
  }

  // Evento do Calendar por id — título exato da call (pra casar o Doc) e anexos
  // (o Meet às vezes cola o Doc de transcrição como anexo do evento). Best-effort.
  async function getCalendarEvent(eventId, calendarId = process.env.GOOGLE_MEET_CALENDAR_ID || "primary") {
    if (!eventId) return null;
    const token = await accessToken();
    const res = await f(`${CAL_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400 || body.error) return null;
    return body;
  }

  // Fallback de transcrição pelo DRIVE: o Meet salva a transcrição como um Google
  // Doc no Drive do ORGANIZADOR (a conta conectada). Quando a Meet API não devolve
  // o conferenceRecord (ex.: quem hospeda a call é OUTRA conta que não a conectada),
  // lê o Doc direto: acha pelo anexo do evento OU busca pelo título ("…Transcrição/
  // Transcript") perto do horário da call e exporta como texto. Exige drive.readonly
  // (reconectar o Google depois de subir este escopo). Retorna null se não achar.
  async function fetchTranscriptFromDrive({ eventId = "", leadName = "", since = "" } = {}) {
    const token = await accessToken();
    const auth = { authorization: `Bearer ${token}` };
    const ev = eventId ? await getCalendarEvent(eventId) : null;
    const title = String(ev?.summary || leadName || "").trim();
    const startIso = ev?.start?.dateTime || ev?.start?.date || since || "";

    // 1) Anexo do evento cujo título parece transcrição (Doc).
    let fileId = "";
    for (const a of ev?.attachments || []) {
      if (/ranscri/i.test(String(a.title || "")) && a.fileId) { fileId = a.fileId; break; }
    }

    // 2) Busca no Drive: Doc com "Transcri/Transcript" no título, criado a partir
    //    de ~2h antes da call, casando pelo nome do lead (parte após o "·" do
    //    título "Call LeverAds · <lead>"). Pega o mais recente que casar.
    if (!fileId) {
      const esc = (s) => String(s).replace(/'/g, "\\'");
      const clauses = ["mimeType = 'application/vnd.google-apps.document'", "name contains 'ranscri'"];
      const nameKey = (title.split("·").pop() || title).trim();
      if (nameKey) clauses.push(`name contains '${esc(nameKey)}'`);
      const floor = startIso ? new Date(new Date(startIso).getTime() - 2 * 3600_000) : null;
      if (floor && Number.isFinite(floor.getTime())) clauses.push(`createdTime > '${floor.toISOString()}'`);
      // encodeURIComponent (não URLSearchParams): espaço vira %20, não "+" — o
      // parser do `q` do Drive trata "+" como literal e quebraria a query.
      const qs = `q=${encodeURIComponent(clauses.join(" and "))}&orderBy=${encodeURIComponent("createdTime desc")}&pageSize=10&fields=${encodeURIComponent("files(id,name,createdTime)")}`;
      const res = await f(`${DRIVE_URL}/files?${qs}`, { headers: auth });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400 || body.error) throw new Error(`Drive files -> ${res.status}: ${body.error?.message || "falha na busca"}`);
      fileId = body.files?.[0]?.id || "";
    }
    if (!fileId) return null;

    // 3) Exporta o Doc como texto puro (o corpo é a transcrição fala a fala).
    const exp = await f(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("text/plain")}`, { headers: auth });
    if (exp.status >= 400) throw new Error(`Drive export -> ${exp.status}`);
    const text = String(await exp.text()).trim();
    if (!text) return null;
    return {
      text,
      startTime: startIso,
      endTime: "",
      recordingUrl: `https://docs.google.com/document/d/${fileId}/view`,
      conferenceRecord: "",
      source: "drive",
    };
  }

  return { configured, connected, account, authUrl, exchangeCode, accessToken, createMeetEvent, configureSpace, fetchTranscript, sendGmail, gmailReady, getCalendarEvent, fetchTranscriptFromDrive };
}

// Cabeçalho de e-mail com não-ASCII (nome, assunto): codifica em MIME
// "encoded-word" (RFC 2047) só quando precisa, senão devolve cru.
function encodeHeader(s) {
  const str = String(s || "");
  return /^[\x20-\x7E]*$/.test(str) ? str : `=?UTF-8?B?${Buffer.from(str, "utf8").toString("base64")}?=`;
}
