// IA que resume a transcrição da call de vendas com ESTRUTURA de vendas
// (dores, objeções, temperatura, follow-up sugerido). Dois provedores, com
// detecção AUTOMÁTICA pela chave: sk-or-* = OpenRouter (API compatível com
// OpenAI, modelos Claude via slug anthropic/*), senão API da Anthropic
// direto. Raw HTTP por fetch injetável, mesmo padrão do meta.js/google.js.
// Env: OPENROUTER_API_KEY ou ANTHROPIC_API_KEY; modelo via AI_MODEL.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-opus-4.8";

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
  const openrouter = apiKey.startsWith("sk-or-");
  const modelId = model || (openrouter ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL);

  // Corpo/headers/parse de cada provedor. OpenRouter fala o formato da OpenAI
  // (chat/completions + response_format json_schema); Anthropic fala Messages
  // API (output_config + thinking adaptativo).
  function buildRequest(userContent) {
    if (openrouter) {
      return {
        url: OPENROUTER_URL,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://levermoney.com.br",
          "x-title": "LeverAds Cockpit",
        },
        body: {
          model: modelId,
          max_tokens: 16000,
          messages: [
            { role: "system", content: `${SYSTEM}\nResponda SOMENTE com o JSON pedido, sem texto fora dele.` },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_schema", json_schema: { name: "call_summary", strict: true, schema: SUMMARY_SCHEMA } },
        },
      };
    }
    return {
      url: ANTHROPIC_URL,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: {
        model: modelId,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
        messages: [{ role: "user", content: userContent }],
      },
    };
  }

  function extractText(body) {
    if (openrouter) {
      if (body.error) throw new Error(`OpenRouter: ${body.error.message || body.error.code || "falha na API"}`);
      const msg = body.choices?.[0]?.message;
      if (!msg?.content) throw new Error("OpenRouter: resposta vazia");
      // alguns provedores devolvem o JSON cercado de ```json ... ```
      return String(msg.content).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    }
    if (body.type === "error") throw new Error(`Claude: ${body.error?.message || "falha na API"}`);
    if (body.stop_reason === "refusal") throw new Error("Claude recusou o conteúdo da transcrição");
    const textBlock = (body.content || []).find((b) => b.type === "text");
    if (body.stop_reason === "max_tokens" || !textBlock) throw new Error("Claude: resposta incompleta (sem bloco de texto)");
    return textBlock.text;
  }

  // Uma call → um resumo estruturado. Transcrição grande é cortada em ~180k
  // chars (mantém o FINAL, onde vivem compromissos e próximos passos).
  async function summarizeCall({ transcript, lead = {}, productName = "LeverAds", callDate = "", today = "" }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
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

    const req = buildRequest(`${context}\n\nTranscrição da call:\n\n${clipped}`);
    const res = await f(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400) {
      const why = body.error?.message || body.error?.code || "falha na API";
      throw new Error(`${openrouter ? "OpenRouter" : "Claude"} -> ${res.status}: ${why}`);
    }
    const raw = extractText(body);
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      throw new Error(`${openrouter ? "OpenRouter" : "Claude"}: resposta fora do formato esperado`);
    }
    return { summary: parsed, usage: body.usage || {}, model: body.model || modelId };
  }

  return { configured, summarizeCall, model: modelId, provider: openrouter ? "openrouter" : "anthropic" };
}
