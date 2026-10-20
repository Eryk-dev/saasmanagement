// Tags do lead e tipo de negócio (Lever CRM, Fase 2). Tags são etiquetas
// livres do time ("evento-x", "indicação-bia"): minúsculas, sem repetir, até 12
// por lead e 30 caracteres cada. O tipo de negócio separa a primeira venda do
// upsell, da renovação e da reativação no mesmo cliente.

export const DEAL_TYPES = ["nova_venda", "upsell", "renovacao", "reativacao"];

export function cleanTags(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const t = String(raw || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
    if (out.length === 12) break;
  }
  return out;
}

// O que o POST/PATCH de lead grava de tags e de tipo de negócio (só os campos
// que vieram; tipo desconhecido vira nova_venda).
export function leadTagPatch(body) {
  const out = {};
  if (body && "tags" in body) out.tags = cleanTags(body.tags);
  if (body && "dealType" in body) out.dealType = DEAL_TYPES.includes(body.dealType) ? body.dealType : "nova_venda";
  return out;
}
