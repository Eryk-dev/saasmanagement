// Claude (API da Anthropic) — resume a transcrição da call de vendas com
// ESTRUTURA de vendas (dores, objeções, temperatura, follow-up sugerido).
// Raw HTTP por fetch injetável, mesmo padrão do meta.js/google.js (os testes
// rodam offline). Chave via ANTHROPIC_API_KEY; modelo via ANTHROPIC_MODEL.
const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";

// Schema do resumo — structured output garante JSON válido (sem parse frágil).
const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "temperatura", "temperaturaPorque", "dores", "objecoes", "compromissos", "followup"],
  properties: {
    resumo: { type: "string", description: "O que foi conversado, em 3 a 5 frases diretas" },
    temperatura: { type: "string", enum: ["quente", "morno", "frio"] },
    temperaturaPorque: { type: "string", description: "1 frase explicando a temperatura" },
    dores: { type: "array", items: { type: "string" }, description: "Dores do lead CONFIRMADAS na conversa" },
    objecoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objecao", "comoFoiTratada", "resolvida"],
        properties: {
          objecao: { type: "string" },
          comoFoiTratada: { type: "string", description: "Como o closer respondeu (ou 'ficou sem resposta')" },
          resolvida: { type: "boolean" },
        },
      },
    },
    compromissos: { type: "array", items: { type: "string" }, description: "O que ficou combinado, de ambos os lados" },
    followup: {
      type: "object",
      additionalProperties: false,
      required: ["quando", "nota", "whatsapp"],
      properties: {
        quando: { type: "string", description: "Quando fazer o próximo toque, formato YYYY-MM-DDTHH:mm em hora de Brasília (vazio se não der pra inferir)" },
        nota: { type: "string", description: "O que fazer/dizer nesse toque, 1 frase" },
        whatsapp: { type: "string", description: "Mensagem de WhatsApp pronta pra enviar ao lead, tom direto e pessoal" },
      },
    },
  },
};

const SYSTEM = `Você é o analista comercial da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação).
Você recebe a transcrição de uma call de vendas e extrai o que importa pro closer fazer o follow-up e fechar.
Regras: escreva em português direto, sem formalidade e sem enrolação. NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. Seja fiel à transcrição: não invente dor, objeção nem compromisso que não apareceu. Objeção sem resposta do closer é registrada como não resolvida. A mensagem de WhatsApp deve ser curta (2 a 4 frases), citar algo concreto da conversa e terminar com uma pergunta ou próximo passo claro.`;

export function makeAnthropic({ fetch: f = globalThis.fetch, apiKey = "", model = "" } = {}) {
  const configured = () => !!apiKey;
  const modelId = model || DEFAULT_MODEL;

  // Uma call → um resumo estruturado. Transcrição grande é cortada em ~180k
  // chars (mantém o FINAL, onde vivem compromissos e próximos passos).
  async function summarizeCall({ transcript, lead = {}, productName = "LeverAds", callDate = "", today = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina ANTHROPIC_API_KEY no servidor");
    const MAX = 180_000;
    const text = String(transcript || "");
    const clipped = text.length > MAX ? `[início da call omitido]\n${text.slice(-MAX)}` : text;

    const context = [
      `Lead: ${lead.name || "?"}${lead.company ? ` (${lead.company})` : ""}`,
      lead.niche ? `Nicho: ${lead.niche}` : "",
      lead.stage ? `Estágio no pipeline: ${lead.stage}` : "",
      callDate ? `Data da call: ${callDate}` : "",
      today ? `Hoje é: ${today} (use pra sugerir o "quando" do follow-up)` : "",
      `Produto: ${productName}`,
    ].filter(Boolean).join("\n");

    const res = await f(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
        messages: [{
          role: "user",
          content: `${context}\n\nTranscrição da call:\n\n${clipped}`,
        }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400 || body.type === "error") {
      throw new Error(`Claude -> ${res.status}: ${body.error?.message || "falha na API"}`);
    }
    if (body.stop_reason === "refusal") throw new Error("Claude recusou o conteúdo da transcrição");
    const textBlock = (body.content || []).find((b) => b.type === "text");
    if (body.stop_reason === "max_tokens" || !textBlock) {
      throw new Error("Claude: resposta incompleta (sem bloco de texto)");
    }
    let parsed;
    try { parsed = JSON.parse(textBlock.text); } catch {
      throw new Error("Claude: resposta fora do formato esperado");
    }
    return { summary: parsed, usage: body.usage || {}, model: body.model || modelId };
  }

  return { configured, summarizeCall, model: modelId };
}
