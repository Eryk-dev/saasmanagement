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

// Variante de welcome pro teste A/B do form (título/subtítulo/botão).
const WELCOME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "subtitle", "button"],
  properties: {
    title: { type: "string", description: "Headline nova da tela de boas-vindas, forte e específica, até ~80 caracteres" },
    subtitle: { type: "string", description: "Subtítulo de apoio, 1 a 2 frases curtas" },
    button: { type: "string", description: "Texto do botão de começar, 2 a 4 palavras" },
  },
};

const WELCOME_SYSTEM = `Você é o copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, proteção contra banimento, economia de operação de anúncios).
Sua tarefa: escrever UMA variante nova da tela de boas-vindas do formulário de diagnóstico, pra teste A/B contra a versão atual.
Regras: português do Brasil, direto e específico, promessa crível (nada de clickbait ou número inventado). NUNCA use travessão (—) em nenhum texto; use vírgula ou parênteses. A variante precisa atacar um ângulo DIFERENTE das versões existentes, não parafrasear. Fale com dono de operação de marketplace (vendedor ML/Shopee).`;

// Copy de post social: preenche os campos do template escolhido + a legenda.
// `fields` é uma LISTA (não objeto) pra manter o schema estável independente do
// template — cada item volta com o mesmo `key` que entrou.
const SOCIAL_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields", "caption"],
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string", description: "o mesmo key do campo que foi pedido" },
          value: { type: "string", description: "o texto do campo, no comprimento do exemplo" },
        },
      },
    },
    caption: { type: "string", description: "legenda do post pro Instagram: 2 a 5 linhas + 3 a 6 hashtags relevantes no fim" },
  },
};

const SOCIAL_SYSTEM = `Você é o social media e copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, mais exposição, menos retrabalho, proteção da operação).
Sua tarefa: escrever a copy de um post de rede social preenchendo os CAMPOS de um template pronto, a partir da DOR escolhida.
Regras: português do Brasil, direto, específico e crível (nada de número inventado nem promessa mágica). Fale com dono de operação de marketplace (vendedor ML/Shopee). NUNCA use travessão (—); use vírgula, parênteses ou ponto. Respeite o PAPEL de cada campo (um "Kicker" é curto e em caixa, um "CTA" tem 2 a 4 palavras, um "Número" é uma métrica curta tipo +105% ou 2h) e o COMPRIMENTO do exemplo dado. Para destacar 1 a 3 palavras-chave, envolva em *asteriscos* (o template pinta em destaque). Preencha TODOS os campos pedidos, cada um com seu key. Não invente campos.`;

// Copy de um DISPARO (e-mail e/ou WhatsApp) pra uma lista de leads qualificados.
// Schema estável com os três campos; o prompt manda deixar vazio o canal que não
// se aplica. Tokens {{nome}} {{empresa}} {{nicho}} são substituídos pelo cockpit.
const CAMPAIGN_COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body", "whatsapp"],
  properties: {
    subject: { type: "string", description: "Assunto do e-mail: curto, específico, sem clickbait. Vazio se o canal não incluir e-mail." },
    body: { type: "string", description: "Corpo do e-mail em texto puro (sem HTML): abre com {{nome}}, 2 a 5 parágrafos curtos, termina com um CTA claro. Vazio se o canal não incluir e-mail." },
    whatsapp: { type: "string", description: "Mensagem de WhatsApp: curta (2 a 4 frases), pessoal, abre com {{nome}} e termina com uma pergunta ou próximo passo. Vazio se o canal não incluir WhatsApp." },
  },
};

const CAMPAIGN_SYSTEM = `Você é o copywriter de resposta direta da LeverAds, SaaS que clona e sincroniza anúncios entre contas de Mercado Livre e Shopee (multi-contas, mais exposição, menos retrabalho, proteção contra banimento).
Sua tarefa: escrever a copy de um DISPARO (e-mail e/ou WhatsApp) pra uma lista de leads QUALIFICADOS (já conversaram com o time, conhecem a LeverAds). É reengajamento/nutrição, não primeiro contato frio.
Regras: português do Brasil, direto, específico e crível (nada de número inventado nem promessa mágica). Fale com dono de operação de marketplace (vendedor ML/Shopee). NUNCA use travessão (—); use vírgula, parênteses ou ponto. Pode usar os tokens {{nome}}, {{empresa}} e {{nicho}} (o sistema troca pelos dados de cada lead) — sempre abra a mensagem com {{nome}}. Preencha SÓ os campos do canal pedido; deixe os outros como string vazia.`;

export function makeAnthropic({ fetch: f = globalThis.fetch, apiKey = "", model = "" } = {}) {
  const configured = () => !!apiKey;
  const openrouter = apiKey.startsWith("sk-or-");
  const modelId = model || (openrouter ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL);

  // Corpo/headers/parse de cada provedor. OpenRouter fala o formato da OpenAI
  // (chat/completions + response_format json_schema); Anthropic fala Messages
  // API (output_config + thinking adaptativo). system/schema variam por tarefa
  // (resumo de call, variante de welcome).
  function buildRequest(userContent, { system, schema, schemaName }) {
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
            { role: "system", content: `${system}\nResponda SOMENTE com o JSON pedido, sem texto fora dele.` },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
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
        system,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: userContent }],
      },
    };
  }

  // Uma requisição JSON estruturada, do fetch ao parse — compartilhada pelas
  // tarefas. Lança com mensagem legível em qualquer falha de provedor/formato.
  async function requestJson(userContent, opts) {
    const req = buildRequest(userContent, opts);
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
    return { parsed, usage: body.usage || {}, model: body.model || modelId };
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

    const r = await requestJson(`${context}\n\nTranscrição da call:\n\n${clipped}`, { system: SYSTEM, schema: SUMMARY_SCHEMA, schemaName: "call_summary" });
    return { summary: r.parsed, usage: r.usage, model: r.model };
  }

  // Uma variante NOVA de welcome (título/subtítulo/botão) pro teste A/B do
  // form — usada pelo "aplicar" do insight de welcome fraca. Não grava nada:
  // devolve a copy pro usuário editar antes de publicar.
  async function suggestWelcome({ productName = "", pitch = "", welcome = {}, variants = [], startRate = null }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const context = [
      `Produto: ${productName || "LeverAds"}${pitch ? ` (${pitch})` : ""}`,
      "Tela de boas-vindas ATUAL do formulário de diagnóstico:",
      `• Título: ${welcome.title || "(vazio)"}`,
      `• Subtítulo: ${welcome.subtitle || "(vazio)"}`,
      `• Botão: ${welcome.button || "(vazio)"}`,
      variants.length ? `Títulos já testados (NÃO repita esses ângulos):\n${variants.map((v) => `• ${v}`).join("\n")}` : "",
      startRate != null ? `Hoje só ${startRate}% dos visitantes clicam em começar — a promessa atual não está segurando.` : "",
      "Escreva UMA variante nova de título, subtítulo e botão pra rodar no teste A/B.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: WELCOME_SYSTEM, schema: WELCOME_SCHEMA, schemaName: "welcome_variant" });
    return { suggestion: r.parsed, usage: r.usage, model: r.model };
  }

  // Copy de um post social: recebe a dor, o formato/template e a LISTA de
  // campos (key + label/papel + exemplo), devolve cada campo preenchido + a
  // legenda. Não grava nada — o usuário revisa no editor antes de publicar.
  async function suggestSocialCopy({ dor = "", suggestion = "", formatLabel = "", templateName = "", fields = [] }) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const fieldLines = fields.map((c) => `• key "${c.key}" (${c.label || "campo"}): exemplo = ${JSON.stringify(c.example ?? "")}`).join("\n");
    const context = [
      `Formato do post: ${formatLabel || "post"}${templateName ? ` · template "${templateName}"` : ""}`,
      dor ? `DOR que o post ataca: ${dor}` : "Sem dor específica: fale do valor central da LeverAds (clonar e sincronizar anúncios entre contas ML/Shopee).",
      suggestion ? `Sugestão do time pra criação (siga se fizer sentido): ${suggestion}` : "",
      "",
      "Preencha estes campos (devolva um item por key, com o texto no comprimento do exemplo):",
      fieldLines,
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: SOCIAL_SYSTEM, schema: SOCIAL_COPY_SCHEMA, schemaName: "social_copy" });
    // vira mapa key→value pro cliente aplicar direto nos campos do template
    const map = {};
    for (const it of r.parsed.fields || []) if (it?.key) map[it.key] = it.value ?? "";
    return { fields: map, caption: r.parsed.caption || "", usage: r.usage, model: r.model };
  }

  // Copy de um disparo: recebe o canal (email|whatsapp|ambos), o objetivo e uma
  // descrição do público, devolve assunto/corpo do e-mail e/ou texto do WhatsApp.
  // Não grava nada — o operador revisa antes de disparar.
  async function suggestCampaignCopy({ channel = "whatsapp", objetivo = "", publico = "", productName = "" } = {}) {
    if (!configured()) throw new Error("IA não configurada — defina OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) no servidor");
    const wantsEmail = channel === "email" || channel === "ambos" || channel === "both";
    const wantsWa = channel === "whatsapp" || channel === "ambos" || channel === "both";
    const context = [
      `Produto: ${productName || "LeverAds"}`,
      publico ? `Público do disparo: ${publico}` : "Público: leads qualificados que esfriaram (nutrição/reativação).",
      objetivo ? `Objetivo: ${objetivo}` : "Objetivo: reengajar o lead e agendar uma conversa.",
      wantsEmail && wantsWa ? "Escreva o e-mail (subject + body) E a mensagem de WhatsApp."
        : wantsEmail ? "Escreva SÓ o e-mail (subject + body); deixe whatsapp vazio."
        : "Escreva SÓ a mensagem de WhatsApp; deixe subject e body vazios.",
    ].filter(Boolean).join("\n");
    const r = await requestJson(context, { system: CAMPAIGN_SYSTEM, schema: CAMPAIGN_COPY_SCHEMA, schemaName: "campaign_copy" });
    return { subject: r.parsed.subject || "", body: r.parsed.body || "", whatsapp: r.parsed.whatsapp || "", usage: r.usage, model: r.model };
  }

  return { configured, summarizeCall, suggestWelcome, suggestSocialCopy, suggestCampaignCopy, model: modelId, provider: openrouter ? "openrouter" : "anthropic" };
}
