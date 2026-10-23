// Variáveis das mensagens de disparo ({{nome}}, {{empresa}}…): a MESMA regra
// na prévia da tela e no envio (campanha, sequência, modelo da Meta). Antes a
// prévia mostrava o rótulo da resposta ("2 a 3 contas") e o envio mandava o
// valor cru ("2-3"). Módulo puro: a SPA importa.

export const CAMPAIGN_TOKENS = [
  ["nome", "primeiro nome"],
  ["empresa", "empresa"],
  ["nicho", "nicho"],
  ["contas", "contas"],
  ["anuncios", "anúncios"],
];

// Rótulo humano de uma resposta de qualificação (value → label das perguntas do produto).
export function answerLabel(product, lead, key) {
  const v = lead?.[key];
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "";
  const q = (product?.leadQuestions || []).find((x) => x.key === key);
  const lut = Object.fromEntries((q?.options || []).map((o) => (typeof o === "string" ? [o, o] : [o.value, o.label || o.value])));
  return Array.isArray(v) ? v.map((x) => lut[x] || x).join(", ") : (lut[v] || String(v));
}

export function campaignTokens(lead, product) {
  return {
    nome: String(lead?.name || "").trim().split(/\s+/)[0] || "",
    empresa: lead?.company || "",
    nicho: answerLabel(product, lead, "niche"),
    contas: answerLabel(product, lead, "accounts"),
    anuncios: answerLabel(product, lead, "listings"),
  };
}

// Troca {{token}} pelos dados do lead; token desconhecido fica visível (pra o
// operador notar o erro de digitação na prévia).
export const interpolate = (text, toks) => String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (toks && toks[k] != null ? toks[k] : `{{${k}}}`));
