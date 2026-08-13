// Helpers compartilhados da atribuição de marketing. A dor pode estar marcada
// no nome do anúncio, do conjunto OU da campanha: contas antigas da Meta usam
// as três convenções, então olhar só o anúncio perde a origem de parte dos leads.

// Código "[X]" em qualquer posição do nome. O limite de 1-3 caracteres evita
// que rótulos operacionais como "[TESTE]" virem uma dor inexistente.
export function painCode(name) {
  const m = String(name || "").match(/\[([A-Za-z0-9]{1,3})\]/);
  return m ? m[1].toUpperCase() : null;
}

// O nível mais específico vence. Se o anúncio não carrega o código, cai para
// conjunto e campanha, que é como vários criativos legados estão nomeados.
export function attributionPain(row) {
  return painCode(row?.adName) || painCode(row?.adsetName) || painCode(row?.campaignName) || "";
}
