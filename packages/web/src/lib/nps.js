// NPS no SPA: a mesma classificação do servidor (packages/api/src/nps.js).
// Nota de 0 a 10 por resposta; promotor 9-10, neutro 7-8, detrator 0-6. O
// ÍNDICE (promotores − detratores) é calculado no servidor e chega pronto no
// card de CS do placar — aqui só rotulamos a nota de um cliente.

export const npsBucket = (score) => {
  // Espelha o guard do servidor: `Number("")` e `Number(null)` são 0 e virariam
  // detrator, mas nota em branco é ausência de nota, não nota ruim.
  if (score === "" || score === null || score === undefined || typeof score === "boolean") return "";
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 10) return "";
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
};

export const NPS_TONE = { promotor: "pos", neutro: "mut", detrator: "neg" };

// Última resposta de um cliente (a coleção `nps` chega no SEED.NPS).
export function lastNps(customer, all) {
  const meus = (all || [])
    .filter((n) => n.customer === customer?.id && Number.isFinite(Number(n.score)))
    .sort((a, b) => String(b.answeredAt || b.askedAt || "").localeCompare(String(a.answeredAt || a.askedAt || "")));
  return meus[0] || null;
}

// Último pedido em aberto (mandado e ainda sem resposta).
export function pendingNps(customer, all) {
  const meus = (all || [])
    .filter((n) => n.customer === customer?.id && n.status === "asked")
    .sort((a, b) => String(b.askedAt || "").localeCompare(String(a.askedAt || "")));
  return meus[0] || null;
}
