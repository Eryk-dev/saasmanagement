// Faixa de envio do número na Meta → quantos contatos NOVOS por dia (janela de
// 24h) ele pode receber em conversas iniciadas pela empresa. A Meta devolve
// "TIER_250", "TIER_1K", "TIER_2K", "TIER_10K", "TIER_100K", "TIER_UNLIMITED"
// (e já devolveu o número cru, "TIER_1000"). Antes a tela fazia
// Number(tier.replace(/\D/g, "")) e "TIER_1K" virava 1. Módulo puro (a SPA importa).
export function tierLimit(tier) {
  const t = String(tier || "").toUpperCase();
  if (!t) return null;
  if (/UNLIMITED/.test(t)) return Infinity;
  const m = t.match(/(\d+(?:\.\d+)?)\s*([KM])?/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Teto que o disparo usa por dia: margem de 20% para o que o SDR e o Inbox
// também iniciam no mesmo número.
export const BROADCAST_SHARE = 0.8;
export function broadcastDailyCap(tier) {
  const lim = tierLimit(tier);
  if (lim == null) return null;
  return lim === Infinity ? Infinity : Math.floor(lim * BROADCAST_SHARE);
}
