// Transcrição de áudio (fala → texto). Usada pela ligação do WhatsApp feita
// pelo cockpit: o browser grava os dois lados e manda o arquivo pra cá.
//
// O cliente de IA do cockpit (anthropic.js / OpenRouter) só faz TEXTO — áudio
// precisa de um endpoint próprio. Aqui é a API da OpenAI (whisper-1 por
// padrão, o mais barato: ~US$ 0,006/min).
//
// Env: OPENAI_API_KEY (ou TRANSCRIBE_API_KEY se você quiser uma chave só pra
// isso) e TRANSCRIBE_MODEL pra trocar de modelo sem deploy de código.
// Sem chave, `configured()` é false e quem chama só não transcreve — a
// ligação em si nunca depende disso.

const URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-1";

export function makeTranscriber({ fetch: f = globalThis.fetch, apiKey = "", model = "" } = {}) {
  const key = apiKey || process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY || "";
  const modelId = model || process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL;
  const configured = () => !!key;

  // buffer → texto. `prompt` ajuda o modelo com nomes próprios do negócio
  // (marca, produto, nome do lead), que é onde o Whisper mais erra.
  async function transcribe(buffer, { filename = "call.webm", mime = "audio/webm", language = "pt", prompt = "" } = {}) {
    if (!configured()) throw new Error("transcrição não configurada — defina OPENAI_API_KEY no servidor");
    const fd = new FormData();
    fd.append("file", new Blob([buffer], { type: mime }), filename);
    fd.append("model", modelId);
    if (language) fd.append("language", language);
    if (prompt) fd.append("prompt", String(prompt).slice(0, 800));
    const res = await f(URL, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`transcrição falhou (${res.status}): ${body?.error?.message || "erro desconhecido"}`);
    }
    return String(body.text || "").trim();
  }

  return { configured, transcribe, model: modelId };
}

export const transcriber = makeTranscriber();
