// Qual IA o robô SDR usa: provedor + modelo escolhidos na aba Robô da Inbox
// (product.sdrBot.ai). Sem escolha, vale o cliente padrão do servidor
// (ctx.anthropic: OPENROUTER_API_KEY na frente, AI_MODEL). A escolha só troca
// o cliente da conversa do robô e da bateria de replay; resumo de call, blog
// e o resto seguem no padrão.
//
// Provedor escolhido sem chave no servidor cai no padrão (o robô não pode
// ficar mudo por configuração); a aba mostra o aviso pelo `resolve`.
import { makeAnthropic } from "../integrations/anthropic.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const CATALOG_TTL_MS = 3600_000;

export const AI_PROVIDERS = ["openrouter", "anthropic"];

export function makeSdrAi({
  base = null,
  fetch: f = globalThis.fetch,
  openrouterKey = process.env.OPENROUTER_API_KEY || "",
  anthropicKey = process.env.ANTHROPIC_API_KEY || "",
  makeClient = makeAnthropic,
} = {}) {
  const keys = { openrouter: openrouterKey, anthropic: anthropicKey };
  const providerClients = {
    openrouter: openrouterKey ? makeClient({ fetch: f, apiKey: openrouterKey }) : null,
    anthropic: anthropicKey ? makeClient({ fetch: f, apiKey: anthropicKey }) : null,
  };
  const configured = (p) => !!keys[p];

  // { client, provider, model, fallback } pra escolha { provider, model }.
  function resolve(choice = {}) {
    const provider = AI_PROVIDERS.includes(choice?.provider) ? choice.provider : "";
    const model = String(choice?.model || "").trim();
    if (provider && providerClients[provider]) {
      const own = providerClients[provider];
      const client = model ? own.clone({ model }) : own;
      return { client, provider, model: client.model, fallback: "" };
    }
    // Sem provedor: o modelo vale no cliente padrão (mesma chave, outro slug).
    const client = model && !provider && base?.clone ? base.clone({ model }) : base;
    const fallback = provider ? `${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} não está no servidor; o robô segue no padrão` : "";
    return { client, provider: base?.provider || "", model: client?.model || "", fallback };
  }

  // Catálogo de modelos por provedor, com cache de 1h. OpenRouter: só os que
  // aceitam saída estruturada (o robô responde em JSON com schema), com preço
  // por 1M tokens. Anthropic: a lista da conta, paginada por after_id.
  const cache = new Map();
  async function listModels(provider) {
    if (!AI_PROVIDERS.includes(provider)) throw new Error("provedor desconhecido");
    if (!configured(provider)) throw new Error(`${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} não está no servidor`);
    const hit = cache.get(provider);
    if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.models;
    const models = provider === "openrouter" ? await openrouterModels() : await anthropicModels();
    cache.set(provider, { at: Date.now(), models });
    return models;
  }

  async function openrouterModels() {
    const res = await f(OPENROUTER_MODELS_URL, { headers: { authorization: `Bearer ${keys.openrouter}` } });
    const body = await res.json().catch(() => ({}));
    if (res.status >= 400) throw new Error(`OpenRouter -> ${res.status}: ${body?.error?.message || "falha ao listar modelos"}`);
    const perM = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e6 * 1000) / 1000 : null);
    return (body.data || [])
      .filter((m) => (m.supported_parameters || []).some((p) => p === "structured_outputs" || p === "response_format"))
      .map((m) => ({ id: m.id, name: m.name || m.id, context: m.context_length || null, priceIn: perM(m.pricing?.prompt), priceOut: perM(m.pricing?.completion) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function anthropicModels() {
    const out = [];
    let after = "";
    for (let page = 0; page < 10; page++) {
      const url = `${ANTHROPIC_MODELS_URL}?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
      const res = await f(url, { headers: { "x-api-key": keys.anthropic, "anthropic-version": "2023-06-01" } });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400) throw new Error(`Claude -> ${res.status}: ${body?.error?.message || "falha ao listar modelos"}`);
      for (const m of body.data || []) out.push({ id: m.id, name: m.display_name || m.id, context: m.max_input_tokens || null, priceIn: null, priceOut: null });
      if (!body.has_more || !body.last_id) break;
      after = body.last_id;
    }
    return out;
  }

  return {
    resolve,
    listModels,
    providers: () => ({ openrouter: configured("openrouter"), anthropic: configured("anthropic") }),
    defaultInfo: () => ({ provider: base?.provider || "", model: base?.model || "", configured: !!base?.configured?.() }),
  };
}
