// Transcrição inteira de uma sala do Meet: como se busca no Google e onde fica
// guardada.
//
// A busca é a do resumo automático (call-summaries.js usa esta mesma função):
// Meet API primeiro, o Doc de transcrição no Drive do organizador depois, com
// os mesmos motivos de falha.
//
// A guarda existe porque o Google só entrega pela Meet API por um tempo, buscar
// de novo é lento (são várias chamadas por sala) e a conta de quem organizou
// pode sair do ar (pessoa desconectou o Google, saiu da empresa). Uma linha por
// sala em `meeting_transcripts`, com o código do Meet como id. A coleção é
// privada (fora do CRUD genérico e do tempo real): só o agente Cases lê, pela
// rota de cases-feed.js. Nunca usar repo.list() nela: cada linha tem o texto
// inteiro de uma reunião.

export const TRANSCRIPTS = "meeting_transcripts";

export const meetCode = (url) => (String(url || "").match(/meet\.google\.com\/([a-z0-9-]+)/i) || [])[1] || "";

// Devolve { ok: true, t } ou { ok: false, reason, detail? } com os motivos que
// a tela já traduz: call_in_progress e transcript_not_ready.
export async function fetchRoomTranscript(g, { code, eventId = "", leadName = "", since = "" }, { log = console, ctx = {} } = {}) {
  // 1º a Meet API (conferenceRecords). Se ela não devolver (comum quando quem
  // hospeda a call é outra conta que não a conectada), cai no fallback do Drive:
  // lê o Doc de transcrição no Drive do organizador (a conta conectada).
  // A Meet API LANÇA em 4xx (API desabilitada no Cloud, sala de outra conta,
  // escopo faltando) — sem este catch a exceção subia e matava o fallback do
  // Drive, então a call ficava pra sempre sem resumo e o poller só logava
  // warn. Erro dela vira diagnóstico e o Drive segue sendo tentado.
  let t = null;
  let detail = "";
  let live = false;
  try {
    t = await g.fetchTranscript(code);
    // Sala ainda ABERTA: não existe transcrição enquanto alguém está lá
    // dentro (o Google fecha a gravação quando o último sai). Vira reason
    // próprio pra tela mandar encerrar a sala em vez de "não está pronta".
    if (t?.live) { live = true; t = null; }
  } catch (err) {
    detail = `meet: ${String(err.message || err).slice(0, 160)}`;
    log.warn?.({ ...ctx, err: err.message }, "Meet API falhou (segue pro fallback do Drive)");
  }
  if (!t && typeof g.fetchTranscriptFromDrive === "function") {
    // Os dois motivos SOMAM (meet + drive): quando nenhum caminho traz a
    // transcrição, o diagnóstico precisa dizer o que cada um respondeu.
    const add = (s) => { detail = detail ? `${detail} · ${s}` : s; };
    try {
      t = await g.fetchTranscriptFromDrive({ eventId, leadName, since });
      if (!t) add("drive: Doc de transcrição não encontrado (confira o título/horário da call ou a conta do Drive)");
    } catch (err) {
      // 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT aqui = reconectar o Google (escopo drive.readonly novo).
      add(`drive: ${String(err.message || err).slice(0, 160)}`);
      log.warn?.({ ...ctx, err: err.message }, "fallback de transcrição pelo Drive falhou");
    }
  }
  // Sala aberta e o Drive (ainda) sem o Doc: o motivo é a call que não fechou,
  // não "transcrição processando" — é acionável (sair da sala destrava).
  if (!t && live) {
    return { ok: false, reason: "call_in_progress", detail: "a sala do Meet ainda está aberta: o Google só gera a transcrição quando o último participante sai" };
  }
  if (!t) return { ok: false, reason: "transcript_not_ready", ...(detail ? { detail } : {}) };
  return { ok: true, t };
}

// A transcrição guardada só vale para uma reunião se foi buscada depois do
// horário dela. A mesma sala às vezes serve a mais de uma call do lead (call
// remarcada leva a sala junto), e o Google devolve a conferência mais recente:
// o que foi buscado antes desta reunião não pode ser dela.
export const freshFor = (fetchedAt, at) => {
  const got = Date.parse(fetchedAt || "");
  const when = Date.parse(at || "");
  return Number.isFinite(got) && Number.isFinite(when) && got >= when;
};

export async function storedTranscript(repo, code, at) {
  const doc = code ? await repo.get(TRANSCRIPTS, code) : null;
  return doc && freshFor(doc.fetchedAt, at) ? doc : null;
}

// Grava (ou regrava) a transcrição de uma sala. `by` diz quem buscou: "resumo"
// (o resumo automático) ou "agente" (a rota do agente Cases).
export async function keepTranscript(repo, { code, kind = "", leadId = "", saas = "", eventId = "", t, by = "", now = new Date() }) {
  const text = String(t?.text || "");
  if (!code || !text) return null;
  const doc = {
    id: code, kind, lead: leadId, saas, eventId,
    text, chars: text.length,
    source: t.source === "drive" ? "drive" : "meet",
    conferenceRecord: t.conferenceRecord || "", startTime: t.startTime || "", endTime: t.endTime || "",
    recordingUrl: t.recordingUrl || "",
    fetchedAt: now.toISOString(), fetchedBy: by,
  };
  if (await repo.get(TRANSCRIPTS, code)) return repo.update(TRANSCRIPTS, code, doc);
  // Duas buscas da mesma sala ao mesmo tempo: a segunda criação bate na chave
  // e vira regravação.
  try { return await repo.create(TRANSCRIPTS, doc); } catch { return repo.update(TRANSCRIPTS, code, doc); }
}
