// Código de dor "[X]" no nome do anúncio — ESPELHO do painCode da API
// (packages/api/src/marketing/attribution.js); mantenha os dois em sincronia.
//
// Mora num módulo próprio, sem React nem a camada de api, pra poder ser
// testado por `node --test` (packages/web/test/pains.test.js): a divergência
// entre os dois lados é silenciosa e caríssima — em 07/10/2026 a API já
// resolvia `[PRICE]` e o cockpit ainda não, então o lead chegava com a dor
// gravada e o card mostrava "sem dor", o "Por dor" da Publicidade jogava o
// gasto em "Sem código" e o fluxo de criar anúncio não achava a campanha.
//
// Código = 1-3 alfanuméricos ("[TESTE]" não vira dor fantasma), mais PRICE,
// que é linha de produto e não cabia no limite.
export function painCodeOf(adName) {
  const m = String(adName || "").match(/\[(PRICE|[A-Za-z0-9]{1,3})\]/i);
  return m ? m[1].toUpperCase() : null;
}
