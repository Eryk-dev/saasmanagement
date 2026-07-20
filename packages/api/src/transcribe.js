// Transcrição de áudio (fala → texto). Usada pela ligação do WhatsApp feita
// pelo cockpit: o browser grava os dois lados e manda o arquivo pra cá.
//
// Dois backends, decididos pelas chaves que EXISTEM no servidor:
//  • openrouter (PADRÃO): usa a MESMA OPENROUTER_API_KEY que já roda a IA do
//    cockpit — nada novo pra configurar, e sai ~15x mais barato que o Whisper
//    (modelo de áudio do Gemini via chat completions com input_audio).
//  • openai (Whisper): fallback/alternativa se você preferir. Endpoint próprio,
//    chave OPENAI_API_KEY.
//
// Env: TRANSCRIBE_PROVIDER (openrouter|openai, senão escolhe pela chave),
// TRANSCRIBE_MODEL (troca de modelo sem deploy). Sem NENHUMA chave,
// `configured()` é false e quem chama só não transcreve — a ligação em si
// nunca depende disso.
//
// ⚠ Nota de qualidade: em áudio LIMPO (que é o caso, já que a gravação é
// estéreo com uma voz por canal) o Gemini transcreve muito bem. Em trecho com
// as DUAS vozes 100% sobrepostas ele pode INVENTAR fala plausível (o Whisper,
// no mesmo trecho, devolve texto ruim mas honesto). O prompt abaixo trava o
// máximo disso ("nunca invente, ininteligível vira [inaudível]").

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const OAI_URL = "https://api.openai.com/v1/audio/transcriptions";
const OR_DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const OAI_DEFAULT_MODEL = "whisper-1";

const ANTI_HALLUCINATION = "Você é um transcritor. Transcreva LITERALMENTE a fala do áudio, em português. " +
  "REGRAS: nunca invente nem complete conteúdo; trecho que não der pra entender vira [inaudível]; " +
  "se não houver fala inteligível, devolva vazio. Devolva só o texto falado, sem comentários seus.";

// mime → format string que o input_audio aceita. O browser manda webm/opus.
function fmtFromMime(mime = "") {
  const m = String(mime).toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "webm";
}

export function makeTranscriber({
  fetch: f = globalThis.fetch,
  openrouterKey = process.env.OPENROUTER_API_KEY || "",
  openaiKey = process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY || "",
  provider = process.env.TRANSCRIBE_PROVIDER || "",
  model = process.env.TRANSCRIBE_MODEL || "",
} = {}) {
  // Provider explícito manda; senão OpenRouter na frente (chave já em prod),
  // Whisper se só ela existir.
  const chosen = provider || (openrouterKey ? "openrouter" : openaiKey ? "openai" : "");
  const key = chosen === "openai" ? openaiKey : openrouterKey;
  const modelId = model || (chosen === "openai" ? OAI_DEFAULT_MODEL : OR_DEFAULT_MODEL);
  const configured = () => !!key && (chosen === "openrouter" || chosen === "openai");

  async function viaOpenRouter(buffer, { mime, prompt }) {
    const b64 = Buffer.isBuffer(buffer) ? buffer.toString("base64") : Buffer.from(buffer).toString("base64");
    const sys = prompt ? `${ANTI_HALLUCINATION} Nomes próprios que podem aparecer: ${String(prompt).slice(0, 300)}.` : ANTI_HALLUCINATION;
    const res = await f(OR_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        temperature: 0, // determinístico: menos margem pra completar o que não ouviu
        messages: [{ role: "user", content: [
          { type: "text", text: sys },
          { type: "input_audio", input_audio: { data: b64, format: fmtFromMime(mime) } },
        ] }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      throw new Error(`transcrição falhou (${res.status}): ${body?.error?.message || "erro desconhecido"}`);
    }
    return String(body.choices?.[0]?.message?.content || "").trim();
  }

  async function viaOpenAI(buffer, { filename, mime, language }) {
    const fd = new FormData();
    fd.append("file", new Blob([buffer], { type: mime }), filename);
    fd.append("model", modelId);
    if (language) fd.append("language", language);
    const res = await f(OAI_URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`transcrição falhou (${res.status}): ${body?.error?.message || "erro desconhecido"}`);
    return String(body.text || "").trim();
  }

  // buffer → texto. `prompt` = nomes próprios do negócio (marca/produto/lead),
  // onde a transcrição mais erra.
  async function transcribe(buffer, { filename = "call.webm", mime = "audio/webm", language = "pt", prompt = "" } = {}) {
    if (!configured()) throw new Error("transcrição não configurada — defina OPENROUTER_API_KEY (ou OPENAI_API_KEY) no servidor");
    return chosen === "openai"
      ? viaOpenAI(buffer, { filename, mime, language })
      : viaOpenRouter(buffer, { mime, prompt });
  }

  return { configured, transcribe, model: modelId, provider: chosen };
}

export const transcriber = makeTranscriber();
